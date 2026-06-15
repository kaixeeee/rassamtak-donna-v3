const config = require('../config');
const { buildPrompt } = require('./prompt');
const { extractJson, normalizeDecision } = require('./jsonRepair');
const { stripWakeword, normalizeArabic } = require('../utils/normalize');

function pickOrderNumber(t) {
  return (t.match(/(?:طلب\s*)?#?\s*(\d{1,4})/) || [])[1] || '';
}


function pickOrderRange(t) {
  const arabicDigits = {
    '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
    '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
    '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
    '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9'
  };

  const text = String(t || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, d => arabicDigits[d] || d);

  const linkWords = '(?:\\u0627\\u0644\\u0649|\\u0625\\u0644\\u0649|\\u0644\\u063a\\u0627\\u064a\\u0629|\\u062d\\u062a\\u0649|\\u0644|to|-)';
  const re = new RegExp('#?\\s*(\\d{1,4})\\s*' + linkWords + '\\s*#?\\s*(\\d{1,4})', 'i');

  const m = text.match(re);
  if (!m) return null;

  const start = Number(m[1]);
  const end = Number(m[2]);

  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start <= 0 || end <= 0) return null;

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const count = to - from + 1;

  return {
    start: from,
    end: to,
    from,
    to,
    count,
    tooLarge: count > 50,
    orderNumbers: Array.from({ length: count }, (_, i) => String(from + i))
  };
}


function pickCompany(t) {
  return (t.match(/(تامر|نت)/) || [])[1] || '';
}

function localFallback(message, wakewordStripped) {
  const original = String(wakewordStripped || message || '').trim();
  const t = normalizeArabic(original);
  if (!t) return normalizeDecision({ intent: 'ignore', confidence: 0.2 });

  if (/^(الاوامر|الأوامر|اوامر|أوامر|مساعده|مساعدة|help|شو الاوامر|شو الأوامر)$/.test(t) || /شو.*(اوامر|أوامر|الاوامر|الأوامر)/.test(t)) {
    return normalizeDecision({ intent: 'help_menu', confidence: 0.98, shouldTouchData: false });
  }

  if (/(زبون|زبونة|عميل|عميلة).*(مأجل|ماجل|موجل|مؤجل|زعلان|زعلانه|زعلانة)/.test(t) && /(شو|كيف|اكتب|رد|اعمل|اسوي|نحكي|صيغه|صيغة)/.test(t)) {
    return normalizeDecision({ intent: 'chat_advice', confidence: 0.9, shouldTouchData: false, chatAnswer: '' });
  }

  if (/(اصناف|صنف|الاصناف|الأصناف).*(اليوم|انطلبت)|كل.*(اصناف|الأصناف|صنف).*(اليوم)/.test(t)) return normalizeDecision({ intent: 'get_product_summary_today', confidence: 0.95, shouldTouchData: true });
  if (/(طلعت|طلعوا|تسلمت|سلمت|سلمنا).*(اليوم)|اليوم.*(طلعت|تسلمت|سلمت)/.test(t)) return normalizeDecision({ intent: 'get_shipped_today', confidence: 0.93, shouldTouchData: true });
  if (/المسجله|المسجلة|انضافت|سجلت|تسجلت|دخلت|دخلتها|اعطيتك|أعطيتك/.test(t)) return normalizeDecision({ intent: 'get_registered_today', confidence: 0.93, shouldTouchData: true });
  if (/مستقبليه|مستقبلية|قادمه|قادمة|الغد|بكرا|مجدوله|مجدولة/.test(t) && /طلبات|شو|هات|في/.test(t)) return normalizeDecision({ intent: 'get_future_orders', confidence: 0.9, shouldTouchData: true });
  if (/(طلبات.*اليوم|شو.*اليوم|وش.*اليوم|لازم.*اليوم|يطلع.*اليوم|تطلع.*اليوم|اسلمها.*اليوم|أسلمها.*اليوم|هات.*طلبات.*اليوم)/.test(t)) return normalizeDecision({ intent: 'get_today_handoff', confidence: 0.92, shouldTouchData: true });

  if (/حساب|فلوس|مصاري|كم لازم|كم مع|مع مين|جرد/.test(t)) {
    const company = pickCompany(t);
    return normalizeDecision({ intent: 'get_company_account', confidence: 0.86, company, shouldTouchData: true });
  }


  const range = pickOrderRange(t); if (range) { if (range.tooLarge) return normalizeDecision({ intent: 'clarify', confidence: 0.86, shouldTouchData: false, question: 'النطاق كبير شوي. اكتب نعم إذا متأكد أو قسمه على دفعات أصغر.' }); const company = pickCompany(t); if (company) return normalizeDecision({ intent: 'batch_update_company', confidence: 0.93, rangeStart: String(range.start), rangeEnd: String(range.end), company, shouldTouchData: true }); if (/ملغي|ملغيه|الغيه|الغاء|إلغاء|كنسل|cancel/.test(t)) return normalizeDecision({ intent: 'batch_cancel_orders', confidence: 0.93, rangeStart: String(range.start), rangeEnd: String(range.end), shouldTouchData: true }); if (/(تم|وصل|استلم|اخذه|أخذه).*(المشتري|الزبون|الزبونه|الزبونة|عميل)|تم\s*(?:للمشتري|للزبون|للزبونه|للزبونة)/.test(t)) return normalizeDecision({ intent: 'batch_mark_customer_delivered', confidence: 0.93, rangeStart: String(range.start), rangeEnd: String(range.end), shouldTouchData: true }); if (/(مسلم|مسلمات|مسلمه|مسلّم|مسلّمه|سلم|سلّم|سلمنا|طلع|طلعت|تسليم|تسلمت)/.test(t)) return normalizeDecision({ intent: 'batch_mark_company_handoff', confidence: 0.93, rangeStart: String(range.start), rangeEnd: String(range.end), shouldTouchData: true }); } if (/(السعر|سعر).*(صحيح|صح|مزبوط)|(?:صح|مزبوط).*(السعر|سعر)/.test(t) && /(طلب\s*)?#?\s*\d+/.test(t)) {
    const n = pickOrderNumber(t);
    return normalizeDecision({ intent: 'update_order', confidence: 0.9, orderNumber: n, patch: { priceWarningAcknowledged: true }, shouldTouchData: true });
  }

  if (((/شركه|شركة|توصيل/.test(t) && pickCompany(t) && pickOrderNumber(t)) || /(?:تامر|نت).*(طلب\s*)?#?\s*\d+/.test(t))) {
    const n = pickOrderNumber(t);
    const company = pickCompany(t);
    if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.8, question: 'أي طلب بدك أغير شركة توصيله؟' });
    return normalizeDecision({ intent: 'update_order', confidence: 0.9, orderNumber: n, patch: { deliveryCompany: company }, shouldTouchData: true });
  }

  if (/(^|\s)(حذف|احذف|امسح|شطب)(\s|$)/.test(t) && /(طلب\s*)?#?\s*\d+/.test(t)) { const n = pickOrderNumber(t); if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.8, question: 'أي طلب بدك أحذفه؟ اكتب رقم الطلب.' }); return normalizeDecision({ intent: 'delete_order', confidence: 0.93, orderNumber: n, shouldTouchData: true }); } if (/(عدل|غير|غيّر|زيد|نقص|حط|شيل|احذف|بدل)/.test(t) && /(طلب\s*)?#?\s*\d+/.test(t)) {
    const n = pickOrderNumber(t);
    const patch = {};
    const price = (original.match(/(?:السعر|سعر)\s*(?:صار|خليه|خلي|=|:)?\s*(\d+(?:\.\d+)?)/i) || original.match(/(?:^|\s)ب\s*(\d+(?:\.\d+)?)(?:\s|$)/i) || original.match(/حط\s*(?:السعر)?\s*(\d+(?:\.\d+)?)/i) || [])[1];
    if (price) patch.price = price;
    const company = pickCompany(t);
    if (/شركه|شركة|توصيل/.test(t) && company) patch.deliveryCompany = company;
    const removeWord = (original.match(/(?:شيل|احذف)\s+(.+?)(?:\s+من|$)/) || [])[1];
    const productText = (original.match(/(?:الصنف|المنتج|حط|بدل|غير)\s+(.+)$/) || [])[1];
    if (removeWord) patch.removeProductText = removeWord.trim();
    else if (productText && !price && !company) patch.product = productText.trim();
    if (!Object.keys(patch).length) return normalizeDecision({ intent: 'clarify', confidence: 0.78, question: 'شو بالضبط بدك أعدل في الطلب؟ السعر، الصنف، الشركة، أو الموعد؟' });
    return normalizeDecision({ intent: 'update_order', confidence: 0.88, orderNumber: n, patch, shouldTouchData: true });
  }

  if (/اجل|أجل|موجل|مؤجل|تاجل|تأجل/.test(t)) {
    const n = pickOrderNumber(t);
    if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.78, question: 'أي طلب بدك أأجله؟ اكتب رقم الطلب أو اعمل Reply على كرت الطلب.' });
    return normalizeDecision({ intent: 'delay_order', confidence: 0.9, orderNumber: n, newDateText: original, shouldTouchData: true });
  }
  if (/ملغي|الغيه|الغاء|إلغاء|كنسل|cancel/.test(t)) {
    const n = pickOrderNumber(t);
    if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.78, question: 'أي طلب بدك ألغيه؟ اكتب رقم الطلب أو اعمل Reply على كرت الطلب.' });
    return normalizeDecision({ intent: 'cancel_order', confidence: 0.9, orderNumber: n, shouldTouchData: true });
  }
  if (/(سلم|سلّم|طلع|طلعت).*(شركة|توصيل)|سلمنا.*طلب/.test(t)) {
    const n = pickOrderNumber(t);
    if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.75, question: 'أي طلب تم تسليمه للشركة؟' });
    return normalizeDecision({ intent: 'mark_company_handoff', confidence: 0.88, orderNumber: n, shouldTouchData: true });
  }
  if (/(تم|وصل|استلم|اخذه|أخذه).*(المشتري|الزبون|الزبونة|عميل)|تم\s*(طلب\s*)?#?\s*\d+/.test(t)) {
    const n = pickOrderNumber(t);
    if (!n) return normalizeDecision({ intent: 'clarify', confidence: 0.75, question: 'أي طلب تم تسليمه للمشتري؟' });
    return normalizeDecision({ intent: 'mark_customer_delivered', confidence: 0.88, orderNumber: n, shouldTouchData: true });
  }

  if (/شو|وش|ايش|كيف|اكتب|رتب|رايك|رأيك|اعمل|اسوي|رد|صيغه|صيغة/.test(t)) {
    return normalizeDecision({ intent: 'chat_advice', confidence: 0.72, shouldTouchData: false, chatAnswer: '' });
  }

  return normalizeDecision({ intent: 'chat_advice', confidence: 0.55, shouldTouchData: false, chatAnswer: '' });
}

async function decide({ message, db, businessRules = {}, wakeword = 'بوت' }) {
  const wakewordStripped = stripWakeword(message, wakeword);
  const recentOrders = db ? db.getOrders().slice(-12) : [];
  const local = localFallback(message, wakewordStripped);
  if (local.intent !== 'chat_advice' && local.confidence >= 0.82) return local;
  if (!config.ai.enabled || !config.ai.apiKey) return local;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.ai.apiKey);
    const model = genAI.getGenerativeModel({ model: config.ai.model });
    const prompt = buildPrompt({ message, wakewordStripped, businessRules, recentOrders });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = extractJson(text);
    if (!parsed) return local;
    return normalizeDecision(parsed);
  } catch (err) {
    console.log(`⚠️ Donna Brain فشل، رجعت للحزام المحلي: ${err.message}`);
    return local;
  }
}

module.exports = { decide, localFallback };
