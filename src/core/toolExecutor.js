const config = require('../config');
const { resolveDateText, computeCompanyHandoffDate, addDays, toDateOnly } = require('./dateResolver');
const { normalizeProduct } = require('./productCatalog');
const { applyPriceGuardFields, acknowledgePrice } = require('./priceGuard');
const { todayHandoff, registeredToday, productSummaryToday, shippedToday, futureOrders, companyAccount, helpMenu } = require('../tools/reports');

function statusText(status) {
  return {
    working: 'قيد العمل',
    company_handoff: 'سُلّم للشركة',
    customer_delivered: 'تم تسليمه للمشتري',
    cancelled: 'ملغي',
    delayed: 'مؤجل'
  }[status] || status;
}

function defaultCustomerDate() { return toDateOnly(addDays(new Date(), 1)); }
function handoffFor(customerDate) { return computeCompanyHandoffDate(customerDate, config.business.handoffDaysBefore); }
function addHandoffReminder(db, order) {
  if (!order || !order.companyHandoffDate) return;
  db.addReminder({ orderId: order.orderId, type: 'handoff', dueDate: order.companyHandoffDate, message: `طلب ${order.orderId} لازم يطلع لشركة التوصيل اليوم.` });
}
function addFollowupReminder(db, order) {
  if (!order || !order.customerDeliveryDate) return;
  const dueDate = toDateOnly(addDays(new Date(order.customerDeliveryDate + 'T00:00:00'), 1));
  db.addReminder({ orderId: order.orderId, type: 'followup', dueDate, hour: 21, message: `متابعة طلب ${order.orderId}: تم / ملغي / تأجل؟` });
}

function applyOrderPatch(order, patch = {}) {
  const out = { ...patch };
  if (out.product) out.product = normalizeProduct(out.product);
  if (out.price || out.product) {
    out.priceWarningStatus = '';
  }
  if (out.removeProductText) {
    const remove = String(out.removeProductText).trim();
    out.notes = [order.notes, `طلب تعديل: إزالة/تغيير ${remove}`].filter(Boolean).join(' | ');
    delete out.removeProductText;
  }
  if (out.customerDeliveryDateText && !out.customerDeliveryDate) out.customerDeliveryDate = resolveDateText(out.customerDeliveryDateText);
  if (out.customerDeliveryDate) out.companyHandoffDate = handoffFor(out.customerDeliveryDate);
  return out;
}

 async function batchUpdateOrdersByRange({ db, sheets, start, end, patch, eventType, label, followup = false }) { let a = Number(start); let b = Number(end); if (!Number.isFinite(a) || !Number.isFinite(b)) return { text: 'مش فاهم أرقام الطلبات. اكتب مثلاً: بوت الطلب من 51 ل 60 مسلم' }; if (b < a) { const t = a; a = b; b = t; } const total = b - a + 1; if (total > 50) return { text: 'النطاق كبير شوي. قسمه على دفعات أصغر عشان ما نعدل طلبات بالغلط.' }; const updated = []; const missing = []; for (let n = a; n <= b; n++) { const id = '#' + String(n).padStart(3, '0'); const order = db.findOrderById ? db.findOrderById(n) : (db.getOrders().find(o => o.orderId === id) || null); if (!order) { missing.push(id); continue; } const u = db.updateOrder(order.orderId, patch, eventType, { batchRange: a + '-' + b }); if (!u) { missing.push(id); continue; } updated.push(u.orderId); if (followup) addFollowupReminder(db, u); if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(u).catch(() => null); } const lines = [`✅ تم تحديث ${updated.length} طلب من #${String(a).padStart(3, '0')} إلى #${String(b).padStart(3, '0')}`, `التعديل: ${label}`]; if (missing.length) lines.push('⚠️ ما لقيت: ' + missing.join('، ')); return { text: lines.join('\n') }; } async function batchUpdateOrdersByNumbers({ db, sheets, numbers, patch, eventType, label, followup = false }) {
  const list = Array.isArray(numbers) ? numbers.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0) : [];
  const unique = [];
  for (const n of list) if (!unique.includes(n)) unique.push(n);
  if (!unique.length) return { text: 'مش فاهم أرقام الطلبات. اكتب مثلاً: بوت طلب 51 و 53 و 60 تامر' };
  if (unique.length > 50) return { text: 'في أرقام كثيرة. قسمها على دفعات أصغر عشان ما نعدل طلبات بالغلط.' };
  const updated = [];
  const missing = [];
  for (const n of unique) {
    const id = '#' + String(n).padStart(3, '0');
    const order = db.findOrderById ? db.findOrderById(n) : (db.getOrders().find(o => o.orderId === id) || null);
    if (!order) { missing.push(id); continue; }
    const u = db.updateOrder(order.orderId, patch, eventType, { batchNumbers: unique.join(',') });
    if (!u) { missing.push(id); continue; }
    updated.push(u.orderId);
    if (followup) addFollowupReminder(db, u);
    if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(u).catch(() => null);
  }
  const lines = ['✅ تم تحديث ' + updated.length + ' طلب', 'الأرقام: ' + updated.join('، '), 'التعديل: ' + label];
  if (missing.length) lines.push('⚠️ ما لقيت: ' + missing.join('، '));
  return { text: lines.join('\n') };
}

async function execute(decision, { db, sheets }) {
  const d = decision;
  switch (d.intent) {
    case 'help_menu': return { text: helpMenu() };
    case 'chat_advice':
      return { text: d.chatAnswer || 'تمام، فاهم عليك. احكيلي شو بدك بالضبط وبساعدك كسكرتيرة شغل.' };
    case 'create_order': {
      const f = d.orderFields || {};
      const customerDate = f.customerDeliveryDate || resolveDateText(f.customerDeliveryDateText || '') || defaultCustomerDate();
      const handoffDate = handoffFor(customerDate);
      let orderInput = {
        ...f,
        product: normalizeProduct(f.product || ''),
        deliveryCompany: f.deliveryCompany || config.business.defaultDeliveryCompany,
        customerDeliveryDate: customerDate,
        companyHandoffDate: handoffDate,
        status: 'working'
      };
      // Price guard is applied inside db.createOrder/repairOrder so the final saved order and the reply stay consistent.
      const order = db.createOrder(orderInput, { channel: 'whatsapp', via: 'donna' });
      addHandoffReminder(db, order);
      addFollowupReminder(db, order);
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(order).catch(() => null);
      return { text: `✅ تم تسجيل ${order.orderId}\n👤 ${order.name || 'بدون اسم'}\n📞 ${order.phone || '-'}\n📍 ${order.area}\n🎨 ${order.product}\n💰 ${order.price} د\n🚚 ${order.deliveryCompany}\n🗓️ موعد الزبون: ${order.customerDeliveryDate}\n📦 تسليم الشركة: ${order.companyHandoffDate}` + (order.priceWarning ? `\n\n${order.priceWarning.replace('رقم الطلب', order.orderId)}` : '') + `\n\nرد/رياكشن لتحديد الشركة: 🚚 نت | 📦 تامر` };
    }
    case 'update_order': {
      const order = d.resolvedOrder;
      let patch = applyOrderPatch(order, d.patch || {});
      if (patch.priceWarningAcknowledged) {
        patch = { ...patch, ...acknowledgePrice(order) };
        delete patch.priceWarningAcknowledged;
      }
      const candidate = { ...order, ...patch };
      if (patch.price || patch.product) {
        const pg = applyPriceGuardFields(candidate);
        patch = { ...patch, ...pg.patch };
      }
      const updated = db.updateOrder(order.orderId, patch, 'updated_by_command', { patch });
      if (updated.companyHandoffDate) addHandoffReminder(db, updated);
      if (updated.customerDeliveryDate) addFollowupReminder(db, updated);
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null);
      return { text: `✅ تم تعديل ${updated.orderId}\n👤 ${updated.name || 'بدون اسم'}\n🎨 ${updated.product || '-'}\n💰 ${updated.price || '-'} د\n🚚 ${updated.deliveryCompany || '-'}\n🗓️ ${updated.customerDeliveryDate || '-'} | 📦 ${updated.companyHandoffDate || '-'}` + (updated.priceWarning ? `\n\n${updated.priceWarning.replace('رقم الطلب', updated.orderId)}` : '') };
    }
    case 'delay_order': {
      const order = d.resolvedOrder;
      const customerDate = resolveDateText(d.newDateText || '') || defaultCustomerDate();
      const patch = { status: 'delayed', customerDeliveryDate: customerDate, companyHandoffDate: handoffFor(customerDate) };
      patch.notes = [order.notes, `تأجيل بواسطة Donna: ${d.newDateText || ''}`].filter(Boolean).join(' | ');
      const updated = db.updateOrder(order.orderId, patch, 'delayed', { newDateText: d.newDateText });
      addHandoffReminder(db, updated);
      addFollowupReminder(db, updated);
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null);
      return { text: `تمام، أجّلت ${updated.orderId} لموعد الزبون ${updated.customerDeliveryDate}. تسليم الشركة: ${updated.companyHandoffDate}.` };
    }
    case 'delete_order': { const order = d.resolvedOrder; const deletedAt = new Date().toISOString(); const notes = [order.notes, `تم الحذف بواسطة المستخدم ${deletedAt}`].filter(Boolean).join(' | '); const updated = db.updateOrder(order.orderId, { status: 'محذوف', notes, deletedAt }, 'deleted_by_command'); if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null); return { text: `🗑️ تم حذف الطلب ${updated.orderId} من القوائم.
بقي موجود في Google Sheets بحالة: محذوف.` }; } case 'cancel_order': {
      const updated = db.updateOrder(d.resolvedOrder.orderId, { status: 'cancelled' }, 'cancelled');
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null);
      return { text: `تم إلغاء الطلب ${updated.orderId}. ما رح يدخل بالحساب.` };
    }
    case 'mark_company_handoff': {
      const updated = db.updateOrder(d.resolvedOrder.orderId, { status: 'company_handoff' }, 'company_handoff');
      addFollowupReminder(db, updated);
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null);
      return { text: `تم تحديث ${updated.orderId}: سُلّم لشركة التوصيل.` };
    }
    case 'mark_customer_delivered': {
      const updated = db.updateOrder(d.resolvedOrder.orderId, { status: 'customer_delivered' }, 'customer_delivered');
      if (sheets && config.sheets.syncOnWrite) await sheets.upsertOrder(updated).catch(() => null);
      return { text: `تم تحديث ${updated.orderId}: وصل للمشتري. ما رح أذكرك فيه مرة ثانية.` };
    }
    case 'batch_mark_company_handoff': return await batchUpdateOrdersByRange({ db, sheets, start: d.rangeStart, end: d.rangeEnd, patch: { status: 'company_handoff' }, eventType: 'batch_company_handoff', label: 'سُلّم للشركة', followup: true }); case 'batch_mark_customer_delivered': return await batchUpdateOrdersByRange({ db, sheets, start: d.rangeStart, end: d.rangeEnd, patch: { status: 'customer_delivered' }, eventType: 'batch_customer_delivered', label: 'تم للمشتري' }); case 'batch_cancel_orders': return await batchUpdateOrdersByRange({ db, sheets, start: d.rangeStart, end: d.rangeEnd, patch: { status: 'cancelled' }, eventType: 'batch_cancelled', label: 'ملغي' }); case 'batch_update_company': return await batchUpdateOrdersByRange({ db, sheets, start: d.rangeStart, end: d.rangeEnd, patch: { deliveryCompany: d.company || config.business.defaultDeliveryCompany }, eventType: 'batch_delivery_company', label: 'شركة التوصيل: ' + (d.company || config.business.defaultDeliveryCompany) }); case 'batch_update_company_list': return await batchUpdateOrdersByNumbers({ db, sheets, numbers: d.orderNumbers, patch: { deliveryCompany: d.company || config.business.defaultDeliveryCompany }, eventType: 'batch_delivery_company_list', label: 'شركة التوصيل: ' + (d.company || config.business.defaultDeliveryCompany) }); case 'get_today_handoff': return { text: await todayHandoff(sheets || db) };
    case 'get_registered_today': return { text: await registeredToday(sheets || db) };
    case 'get_product_summary_today': return { text: await productSummaryToday(sheets || db) };
    case 'get_shipped_today': return { text: await shippedToday(sheets || db) };
    case 'get_future_orders': return { text: await futureOrders(sheets || db) };
    case 'get_company_account': return { text: await companyAccount(sheets || db, d.company) };
    case 'get_order_details': return { text: 'اكتب رقم الطلب أو الاسم عشان أطلعلك التفاصيل.' };
    case 'learn_rule': return { text: 'تمام، سجّللي التصحيح بصيغة: بوت تعلم منتج: كلمة = اسم المنتج الصحيح' };
    default: return { text: 'مش متأكد شو المطلوب. احكيلي بشكل أبسط أو اكتب رقم الطلب.' };
  }
}

module.exports = { execute, statusText, addHandoffReminder, addFollowupReminder };
