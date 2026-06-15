const fs = require('fs');
const path = require('path');
const config = require('../config');
const { hasWakeword } = require('../utils/normalize');
const { detectOrders, extractPrice } = require('../core/orderIntake');
const { decide } = require('../brain/masterBrain');
const { validate } = require('../core/safetyManager');
const { execute } = require('../core/toolExecutor');
const { computeCompanyHandoffDate, resolveDateText, addDays, toDateOnly } = require('../core/dateResolver');
const { applyPriceGuardFields } = require('../core/priceGuard');
const { chooseDeliveryCompany } = require('../core/jordanAreas');
const { normalizeProduct, getProductPricing } = require('../core/productCatalog');


function statusLabel(status) {
  return {
    working: 'قيد العمل',
    company_handoff: 'سُلّم للشركة',
    customer_delivered: 'تم للمشتري',
    cancelled: 'ملغي',
    delayed: 'مؤجل'
  }[status] || status || 'قيد العمل';
}

function formatOrderReceipt(order, { mode = 'new' } = {}) {
  const title = mode === 'followup'
    ? `متابعة ${order.orderId}`
    : mode === 'handoff'
      ? `تسليم شركة ${order.orderId}`
      : `✅ تم تسجيل ${order.orderId}`;

  const warning = order.priceWarning && order.priceWarningStatus !== 'acknowledged'
    ? `\n\n${String(order.priceWarning).replace('رقم الطلب', order.orderId)}`
    : '';

  const deliveryCompany = order.deliveryCompany || 'نت';
  const actionLine = mode === 'new' ? 'اختار شركة التوصيل فقط: 🚚 نت | 👤 تامر' : 'اختار الحالة بالرياكت: ✅ تم | ❌ ملغي | ⏰ تأجل'; return [
    title,
    '',
    `👤 ${order.name || 'بدون اسم'}`,
    `📍 المنطقة: ${order.area || '-'}`,
    `📞 ${order.phone || '-'}`,
    `🎨 ${order.product || '-'}`,
    `💰 ${order.price || '-'} د`,
    `🚚 شركة التوصيل: ${deliveryCompany}`,
    `🗓️ موعد الزبون: ${order.customerDeliveryDate || '-'}`,
    `📦 تسليم الشركة: ${order.companyHandoffDate || '-'}`,
    `الحالة: ${statusLabel(order.status)}${warning}`,
    '',
    actionLine,
  ].join('\n');
}

class WhatsAppGateway {
  constructor({ db, sheets, discord = null }) {
    this.db = db;
    this.sheets = sheets;
    this.discord = discord;
    this.client = null;
    this.targetChat = null;
    this.ready = false;
    this.launching = false;
    this.recoverAttempts = 0;
    this.startupTimer = null;
    this.recoverTimer = null;
  }

  async alertDiscord(text, key = 'whatsapp') {
    try {
      if (this.discord && typeof this.discord.alert === 'function') {
        await this.discord.alert(text, { key });
      }
    } catch (_) {}
  }

  createClient() {
    const qrcode = require('qrcode-terminal');
    const { Client, LocalAuth } = require('whatsapp-web.js');

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: config.whatsapp.sessionId,
        dataPath: path.join(config.rootDir, '.wwebjs_auth')
      }),
      puppeteer: {
        headless: config.whatsapp.headless,
        protocolTimeout: config.whatsapp.protocolTimeoutMs,
        timeout: config.whatsapp.navigationTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      },
      authTimeoutMs: config.whatsapp.authTimeoutMs
    });

    client.on('qr', qr => {
      console.log('📱 امسح QR لربط واتساب:');
      qrcode.generate(qr, { small: true });
      this.alertDiscord('واتساب طلب QR جديد. افتح التيرمنال وامسح الكود من Linked Devices.', 'wa_qr');
    });

    client.on('ready', async () => {
      this.ready = true;
      this.launching = false;
      this.recoverAttempts = 0;
      this.clearStartupWatchdog();
      console.log('✅ WhatsApp: متصل ومشغّل');
      await this.findTargetGroup().catch(err => console.log('⚠️ فشل فحص القروب:', err.message));
    });

    client.on('disconnected', reason => {
      console.log('⚠️ WhatsApp disconnected:', reason);
      this.ready = false;
      this.launching = false;
      this.alertDiscord(`واتساب فصل عن Donna. السبب: ${reason || 'غير معروف'}\nرح أحاول أرجعه تلقائياً.`, 'wa_disconnected');
      this.scheduleRecover('disconnected');
    });

    client.on('auth_failure', msg => {
      console.log('💥 WhatsApp auth failure:', msg);
      this.ready = false;
      this.launching = false;
      this.alertDiscord(`فشل تسجيل دخول واتساب/Auth failure: ${msg || 'بدون تفاصيل'}\nغالباً تحتاج QR جديد.`, 'wa_auth_failure');
      this.scheduleRecover('auth_failure');
    });

    client.on('message_create', msg => this.onMessage(msg).catch(err => console.log('⚠️ خطأ رسالة واتساب:', err.message)));
    client.on('message_reaction', reaction => this.onReaction(reaction).catch(err => console.log('⚠️ خطأ رياكشن واتساب:', err.message)));

    return client;
  }

  async init({ fromRecover = false } = {}) {
    if (!config.whatsapp.enabled) return false;
    if (this.ready || this.launching) return this.ready;

    this.launching = true;
    this.targetChat = null;
    this.client = this.createClient();
    this.startStartupWatchdog();

    try {
      await this.client.initialize();
      return true;
    } catch (err) {
      this.launching = false;
      this.ready = false;
      this.clearStartupWatchdog();
      console.log('💥 خطأ WhatsApp:', err.message);
      this.alertDiscord(`خطأ تشغيل واتساب: ${err.message}\nDonna ستبقى شغالة وتحاول الإنقاذ.`, 'wa_startup_error');

      if (config.whatsapp.autoRecoverEnabled) {
        this.scheduleRecover(fromRecover ? 'recover_init_failed' : 'startup_init_failed', 3000);
        return false;
      }

      throw err;
    }
  }

  startStartupWatchdog() {
    if (!config.whatsapp.autoRecoverEnabled) return;
    this.clearStartupWatchdog();
    this.startupTimer = setTimeout(() => {
      if (!this.ready) {
        console.log('🛟 WhatsApp startup watchdog: واتساب طول، بحاول إنقاذ...');
        this.alertDiscord('واتساب طول بفتح الصفحة. بدأت محاولة إنقاذ تلقائية.', 'wa_startup_watchdog');
        this.recover('startup_watchdog').catch(err => console.log('⚠️ فشل إنقاذ واتساب:', err.message));
      }
    }, config.whatsapp.startupWatchdogMs);
  }

  clearStartupWatchdog() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  scheduleRecover(reason = 'unknown', delay = config.whatsapp.stuckRecoverAfterMs) {
    if (!config.whatsapp.autoRecoverEnabled || this.ready) return;
    if (this.recoverTimer) return;
    console.log(`🛟 جدولة إنقاذ واتساب بسبب: ${reason}`);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      this.recover(reason).catch(err => console.log('⚠️ فشل إنقاذ واتساب:', err.message));
    }, delay);
  }

  cleanWhatsappCache() {
    if (!config.whatsapp.recoveryClearCache) return;
    fs.rmSync(path.join(config.rootDir, '.wwebjs_cache'), { recursive: true, force: true });
    const authDir = path.join(config.rootDir, '.wwebjs_auth', `session-${config.whatsapp.sessionId}`);
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      fs.rmSync(path.join(authDir, name), { force: true });
    }
  }

  async recover(reason = 'manual') {
    if (this.ready) return;
    if (this.launching) {
      try { await this.client?.destroy(); } catch (_) {}
      this.launching = false;
    }
    if (this.recoverAttempts >= config.whatsapp.recoveryMaxAttempts) {
      console.log('🛑 واتساب فشل أكثر من الحد المسموح. أوقفه وشغّل npm start أو امسح QR إذا طلب.');
      await this.alertDiscord('واتساب فشل أكثر من الحد المسموح في محاولات الإنقاذ. افتح الجهاز وافحص QR/Chrome.', 'wa_recovery_failed');
      return;
    }

    this.recoverAttempts += 1;
    console.log(`🛟 محاولة إنقاذ واتساب ${this.recoverAttempts}/${config.whatsapp.recoveryMaxAttempts} (${reason})`);

    try { await this.client?.destroy(); } catch (_) {}
    this.client = null;
    this.targetChat = null;
    this.ready = false;
    this.launching = false;
    this.clearStartupWatchdog();
    this.cleanWhatsappCache();

    setTimeout(() => {
      this.init({ fromRecover: true }).catch(err => console.log('⚠️ فشل بدء واتساب بعد الإنقاذ:', err.message));
    }, 3000);
  }


  defaultCustomerDate() { return toDateOnly(addDays(new Date(), 1)); }

  async syncOrder(order) {
    if (this.sheets && config.sheets.syncOnWrite) await this.sheets.upsertOrder(order).catch(() => null);
  }

  normalizeDigits(v = '') { return String(v || '').replace(/\D/g, ''); }

  isBotReactionSender(sender = '') {
    const bot = this.normalizeDigits(config.whatsapp.botNumber || '');
    if (!bot) return false;
    const from = this.normalizeDigits(sender);
    return !!from && (from.endsWith(bot) || bot.endsWith(from));
  }

  async sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async addQuickReactions(message, emojis = []) {
    if (!config.whatsapp.seedReactions || !message || typeof message.react !== 'function') return;
    // ملاحظة: واتساب قد يستبدل رياكشن نفس الرقم بآخر رياكشن. نخليها best-effort فقط،
    // والاختيار الحقيقي هو رياكشن الفريق أو الرد النصي على نفس كرت الطلب.
    for (const emoji of emojis) {
      try {
        await message.react(emoji);
        await this.sleep(config.whatsapp.reactionDelayMs || 250);
      } catch (_) { return; }
    }
  }

  orderForReactionMessage(msgId = '') {
    const orders = this.db.getOrders();
    return orders.find(o => {
      const src = o.source || {};
      return src.receiptMessageId === msgId || src.handoffMessageId === msgId || src.followupMessageId === msgId;
    });
  }

  async sendOrderCard(order, { quoteMsg = null, mode = 'new' } = {}) {
  // حتى لو الشركة فاضية لأي سبب قديم، الكرت الجديد لازم يظهر نت ويحفظها.
  if (!order.deliveryCompany) {
    const updatedDefaultCompany = this.db.updateOrder(
      order.orderId,
      { deliveryCompany: 'نت' },
      'default_company_net_before_card',
      { reason: 'empty_delivery_company' }
    );
    if (updatedDefaultCompany) {
      order = updatedDefaultCompany;
      await this.syncOrder(order);
    } else {
      order.deliveryCompany = 'نت';
    }
  }

  const text = formatOrderReceipt(order, { mode });
  let sent = null;

  if (quoteMsg && typeof quoteMsg.reply === 'function') sent = await quoteMsg.reply(text);
  else sent = await this.sendToTarget(text);

  const msgId = sent?.id?._serialized || sent?.id?.id || '';

  if (msgId) {
    const key = mode === 'followup' ? 'followupMessageId' : mode === 'handoff' ? 'handoffMessageId' : 'receiptMessageId';
    const updated = this.db.updateOrder(order.orderId, { source: { ...(order.source || {}), [key]: msgId } }, `${key}_linked`, { msgId });
    if (updated) order = updated;
  }

  const emojis = ['🚚', '👤', '✅', '❌', '⏰'];
  await this.addQuickReactions(sent, emojis);
  return sent;
}

async sendOrderActionCards(orders = [], { mode = 'handoff', header = '' } = {}) {
    if (!orders.length) return;
    if (header) await this.sendToTarget(header);
    for (const order of orders) await this.sendOrderCard(order, { mode });
  }

  async onReaction(reaction) {
  if (!reaction || !reaction.reaction) return;

  const sender = reaction.senderId?._serialized || reaction.senderId || reaction.author || '';
  if (this.isBotReactionSender(sender)) return;

  const msgId = reaction.msgId?._serialized || reaction.msgId?.id || reaction.msgId || '';
  if (!msgId) return;

  const emoji = reaction.reaction;
  const order = this.orderForReactionMessage(msgId);
  if (!order) return;

  if (emoji === '🚚') {
    const updated = this.db.updateOrder(order.orderId, { deliveryCompany: 'نت' }, 'company_set_by_reaction', { emoji });
    await this.syncOrder(updated);
    await this.sendToTarget(`🚚 تم تحديد شركة ${updated.orderId}: نت`);
    return;
  }

  if (emoji === '👤') {
    const updated = this.db.updateOrder(order.orderId, { deliveryCompany: 'تامر' }, 'company_set_by_reaction', { emoji });
    await this.syncOrder(updated);
    await this.sendToTarget(`👤 تم تحويل ${updated.orderId} إلى تامر`);
    return;
  }

  if (emoji === '✅') {
    const updated = this.db.updateOrder(order.orderId, { status: 'customer_delivered' }, 'delivered_by_reaction', { emoji });
    await this.syncOrder(updated);
    await this.sendToTarget(`✅ تم تسليم ${updated.orderId} للمشتري.`);
    return;
  }

  if (emoji === '❌') {
    const updated = this.db.updateOrder(order.orderId, { status: 'cancelled' }, 'cancelled_by_reaction', { emoji });
    await this.syncOrder(updated);
    await this.sendToTarget(`❌ تم إلغاء ${updated.orderId}.`);
    return;
  }

  if (emoji === '⏰') {
    await this.sendToTarget(`⏰ لمتى تأجل ${order.orderId}؟ اكتب: بوت أجل ${order.orderId} للأربعاء / بكرا / بعد أسبوع`);
    return;
  }
}

async getQuotedOrder(msg) {
    if (!msg || !msg.hasQuotedMsg || typeof msg.getQuotedMessage !== 'function') return null;
    try {
      const quoted = await msg.getQuotedMessage();
      const qid = quoted?.id?._serialized || quoted?.id?.id || '';
      if (!qid) return null;
      return this.orderForReactionMessage(qid) || null;
    } catch (_) { return null; }
  }

  replyDecisionForOrder(text = '', order = {}) {
    const raw = String(text || '').trim();
    const t = raw.replace(/[#]/g, '').trim();
    const lower = t.toLowerCase();
    const patch = {};
    const status = {};

    if (/^(نت|net)$/i.test(lower) || /(?:مع|شركة|توصيل)\s*نت/i.test(lower)) {
      return { type: 'patch', patch: { deliveryCompany: 'نت' }, event: 'company_set_by_reply', reply: `🚚 تم تحديد شركة ${order.orderId}: نت` };
    }
    if (/^تامر$/i.test(lower) || /(?:مع|شركة|توصيل)\s*تامر/i.test(lower)) {
      return { type: 'patch', patch: { deliveryCompany: 'تامر' }, event: 'company_set_by_reply', reply: `📦 تم تحديد شركة ${order.orderId}: تامر` };
    }
    if (/^(ملغي|الغيه|الغاء|إلغاء|كنسل|cancel)$/i.test(lower) || /(ملغي|كنسل)/i.test(lower)) {
      return { type: 'patch', patch: { status: 'cancelled' }, event: 'cancelled_by_reply', reply: `❌ تم إلغاء ${order.orderId}.` };
    }
    if (/^(تم|وصل|استلم|استلمت|خلص|✅)$/i.test(lower) || /(وصل|استلم).*(الزبون|الزبونة|المشتري|العميل)/i.test(lower)) {
      return { type: 'patch', patch: { status: 'customer_delivered' }, event: 'delivered_by_reply', reply: `✅ تم تحديث ${order.orderId}: وصل للمشتري.` };
    }
    if (/^(سلم|سلّم|طلع|طلعت|الشركة|للشركة)$/i.test(lower) || /(سلم|طلع).*(شركة|توصيل)/i.test(lower)) {
      return { type: 'patch', patch: { status: 'company_handoff' }, event: 'company_handoff_by_reply', reply: `🚚 تم تحديث ${order.orderId}: سُلّم للشركة.` };
    }
    if (/(اجل|أجل|تاجل|تأجل|موجل|مؤجل|بكرا|غدا|غداً|الاسبوع|الأسبوع|الاربعاء|الأربعاء|الخميس|السبت|الاحد|الأحد|الاثنين|الثلاثاء|الجمعة)/i.test(lower)) {
      const customerDate = resolveDateText(raw);
      if (!customerDate) return { type: 'ask', reply: `⏰ لمتى تأجل ${order.orderId}؟ اكتب اليوم أو التاريخ.` };
      const companyHandoffDate = computeCompanyHandoffDate(customerDate, config.business.handoffDaysBefore);
      return { type: 'patch', patch: { status: 'delayed', customerDeliveryDate: customerDate, companyHandoffDate, notes: [order.notes, `تأجيل من Reply: ${raw}`].filter(Boolean).join(' | ') }, event: 'delayed_by_reply', reply: `⏰ تم تأجيل ${order.orderId}. موعد الزبون: ${customerDate} | تسليم الشركة: ${companyHandoffDate}` };
    }

    const price = extractPrice(raw);
    if (price && /(سعر|السعر|ب\s*\d|دينار|د|خليه|حط|عدل)/i.test(raw)) {
      patch.price = price;
    }
    const company = /تامر/.test(raw) ? 'تامر' : /نت|net/i.test(raw) ? 'نت' : '';
    if (company && /(شركة|توصيل|مع)/.test(raw)) patch.deliveryCompany = company;
    const productText = (raw.match(/(?:الصنف|المنتج|بدل|حط|خلي|خليه)\s+(.+)$/) || [])[1];
    if (productText && !price && !company) patch.product = normalizeProduct(productText.trim());

    // تعديل ذكي بالـ Reply: لو رديت على كرت الطلب باسم منتج فقط مثل "بوكس 60" أو "دفتر 48"
    // اعتبرها تعديل صنف للطلب، بدون ما تحتاج تكتب "بوت" أو "حط الصنف".
    if (!Object.keys(patch).length && !price && !company) {
      const looksLikeQuestion = /(شو|ايش|ليش|كيف|متى|كم|طلبات|حساب|جرد|اوامر|الأوامر|الاوامر|مساعدة|help)/i.test(raw);
      const pricing = getProductPricing(raw);
      const productConf = Number(pricing?.confidence || 0);
      const hasKnownProduct = !!(pricing?.normalPrice && productConf >= 70);
      if (!looksLikeQuestion && hasKnownProduct) {
        patch.product = pricing.name;
      }
    }

    if (/شيل|احذف/.test(raw)) patch.notes = [order.notes, `طلب تعديل من Reply: ${raw}`].filter(Boolean).join(' | ');
    if (Object.keys(patch).length) return { type: 'patch_priceguard', patch, event: 'updated_by_reply', reply: `✅ تم تعديل ${order.orderId}.` };

    return { type: 'ask', reply: `مش فاهم التعديل على ${order.orderId}. اكتب مثلاً: نت / تامر / ملغي / تم / سلم / أجل للأربعاء / السعر 18 / بوكس 60 / دفتر 48` };
  }

  async handleReplyToOrder(body, msg, order) {
    const decision = this.replyDecisionForOrder(body, order);
    if (decision.type === 'ask') {
      await msg.reply(decision.reply);
      return true;
    }
    let patch = { ...decision.patch };
    if (decision.type === 'patch_priceguard' && (patch.price || patch.product)) {
      const candidate = { ...order, ...patch };
      const pg = applyPriceGuardFields(candidate);
      patch = { ...patch, ...pg.patch };
    }
    const updated = this.db.updateOrder(order.orderId, patch, decision.event, { via: 'reply', body });
    await this.syncOrder(updated);
    await msg.reply(`${decision.reply}
${updated.product ? `🎨 ${updated.product}
` : ''}${updated.price ? `💰 ${updated.price} د
` : ''}${updated.deliveryCompany ? `🚚 ${updated.deliveryCompany}
` : ''}${updated.customerDeliveryDate ? `🗓️ ${updated.customerDeliveryDate}` : ''}`.trim());
    return true;
  }


  async findTargetGroup() {
    if (!this.ready || !this.client) return null;
    const chats = await this.client.getChats();
    this.targetChat = chats.find(c => c.isGroup && String(c.name).includes(config.whatsapp.groupName));
    if (this.targetChat) console.log(`✅ القروب المستهدف: "${this.targetChat.name}"`);
    else console.log(`⚠️ لم أجد قروب يحتوي: ${config.whatsapp.groupName}`);
    return this.targetChat;
  }

  async sendToTarget(text) {
    if (!this.ready) return false;
    if (!this.targetChat) await this.findTargetGroup();
    if (!this.targetChat) return false;
    await this.targetChat.sendMessage(text);
    return true;
  }

  async onMessage(msg) {
    if (!this.ready) return;
    if (msg.fromMe) return;
    const chat = await msg.getChat();
    if (!chat.isGroup || !String(chat.name).includes(config.whatsapp.groupName)) return;
    const body = (msg.body || '').trim();
    if (!body) return;
    if (/^(✅ تم تسجيل|📦 طلبات لازم|🧾 الطلبات المسجلة|🎨 الأصناف|🚚 الطلبات اللي|💰 حساب|DONNA|Donna v3)/.test(body)) return;

    const quotedOrder = await this.getQuotedOrder(msg);
    if (quotedOrder && !hasWakeword(body, config.whatsapp.wakeword)) {
      const handled = await this.handleReplyToOrder(body, msg, quotedOrder);
      if (handled) return;
    }

    if (hasWakeword(body, config.whatsapp.wakeword)) {
      const reply = await this.handleAssistantMessage(body, msg);
      if (reply) await msg.reply(reply);
      return;
    }

    const orders = detectOrders(body, { defaultDeliveryCompany: config.business.defaultDeliveryCompany, defaultCustomerDeliveryDate: this.defaultCustomerDate(), handoffDaysBefore: config.business.handoffDaysBefore });
    if (orders.length) {
      for (const o of orders) {
        const customerDate = o.customerDeliveryDate || resolveDateText(o.customerDeliveryDateText || '') || this.defaultCustomerDate();
        let orderInput = {
          ...o,
          customerDeliveryDate: customerDate,
          companyHandoffDate: o.companyHandoffDate || computeCompanyHandoffDate(customerDate, config.business.handoffDaysBefore),
          area: o.area || (/عمان/.test(body) ? 'عمان' : ''),
    deliveryCompany: chooseDeliveryCompany({ area: o.area || (/عمان/.test(body) ? 'عمان' : ''), explicitCompany: o.deliveryCompany, defaultCompany: config.business.defaultDeliveryCompany || 'نت' })
        };
        const priceGuard = applyPriceGuardFields(orderInput);
        orderInput = { ...orderInput, ...priceGuard.patch };
        let order = this.db.createOrder(orderInput, { whatsappMessageId: msg.id?._serialized, sender: msg.author || msg.from });
        if (order.companyHandoffDate) this.db.addReminder({ orderId: order.orderId, type: 'handoff', dueDate: order.companyHandoffDate, message: `طلب ${order.orderId} لازم يطلع لشركة التوصيل اليوم.` });
        await this.syncOrder(order);
        await this.sendOrderCard(order, { quoteMsg: msg, mode: 'new' });
      }
    }
  }

  async handleAssistantMessage(body, msg) {
    const decision = await decide({ message: body, db: this.db, businessRules: config.business, wakeword: config.whatsapp.wakeword });
    const safe = validate(decision, this.db);
    if (!safe.ok) return safe.question || 'وضحلي أكثر.';
    const result = await execute(safe.decision, { db: this.db, sheets: this.sheets });
    return result.text;
  }
}

module.exports = { WhatsAppGateway };
