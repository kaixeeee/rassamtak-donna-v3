const { toEnglishDigits, normalizeArabic } = require('../utils/normalize');
const { normalizeProduct, findMentionedProducts } = require('./productCatalog');
const { resolveDateText, computeCompanyHandoffDate } = require('./dateResolver');
const { chooseDeliveryCompany, normalizeDeliveryCompany } = require('./jordanAreas');

const JORDAN_AREAS = [
  'عمان','اربد','إربد','الزرقاء','زرقاء','السلط','مادبا','جرش','عجلون','المفرق','الكرك','الطفيله','الطفيلة','معان','العقبه','العقبة',
  'مرج الحمام','الجاردنز','خريبه السوق','خريبة السوق','صويلح','ابو نصير','أبو نصير','شفا بدران','الجبيهه','الجبيهة','خلدا','تلاع العلي','البيادر','الوحدات','ماركا','الياسمين','ناعور','سحاب','المدينه الرياضيه','المدينة الرياضية','صافوط','ام قمر','أم قمر','الخالديه','الخالدية','جبل التاج','عيون الذيب'
];

function compactDigits(text = '') { return toEnglishDigits(text).replace(/[\s\-()]/g, ''); }
function extractPhone(text) {
  const t = compactDigits(text);
  const m = t.match(/(?:\+?962|00962|0)?7[789]\d{7}/);
  if (!m) return '';
  let p = m[0];
  p = p.replace(/^00962/, '962').replace(/^\+/, '');
  if (p.startsWith('962')) p = '0' + p.slice(3);
  if (!p.startsWith('0')) p = '0' + p;
  return p.slice(0, 10);
}
function isPhone(text) { return /^07[789]\d{7}$/.test(extractPhone(text)); }

function isDateText(line='') {
  if (!line) return false;
  if (isPhone(line) || isPurePriceLine(line)) return false;
  const n = normalizeArabic(toEnglishDigits(line));
  if (/(لون|دفتر|بوكس|علبه|علبة|ماركر|قلم|اكريلك|اكريليك|مندالا|ماندالا|مانديلا|منديلا)/.test(n)) return false;
  return !!resolveDateText(line);
}
function isPurePriceLine(line='') {
  const t = normalizeArabic(toEnglishDigits(line)).replace(/دينار|د|jd/gi, '').trim();
  return /^(?:ب\s*)?\d+(?:\.\d+)?$/.test(t);
}
function moneyNumbers(text='') {
  const t = toEnglishDigits(text);
  const out = [];
  const re = /(?:السعر|سعر|المبلغ|متفق|ب)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi;
  for (const m of t.matchAll(re)) out.push(Number(m[1]));
  const jd = /(\d+(?:\.\d+)?)\s*(?:دينار|jd|د\b)/gi;
  for (const m of t.matchAll(jd)) out.push(Number(m[1]));
  return out.filter(n => Number.isFinite(n) && n >= 0.5 && n <= 300);
}
function extractPrice(text) {
  const explicit = moneyNumbers(text);
  if (explicit.length) return String(explicit[explicit.length - 1]);
  const lines = String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (isPhone(line) || isDateText(line)) continue;
    if (isPurePriceLine(line)) {
      const n = Number(toEnglishDigits(line).replace(/[^0-9.]/g, ''));
      if (n >= 0.5 && n <= 300) return String(n);
    }
  }
  return '';
}

function lineLooksProduct(line) {
  const n = normalizeArabic(line);
  if (!n || isPhone(line) || isPurePriceLine(line) || isDateText(line)) return false;
  if (findMentionedProducts(line).length) return true;
  return /(لون|الوان|ألوان|كحول|اكريلك|اكريليك|دفتر|بوكس|علبه|علبة|ماركر|قلم|اقلام|أقلام|فرش|كانفس|مندالا|ماندالا|مانديلا|منديلا|رسم|اطفال|أطفال)/.test(n);
}
function lineLooksArea(line) {
  const n = normalizeArabic(line);
  if (!n || isPhone(line) || isPurePriceLine(line) || isDateText(line) || lineLooksProduct(line)) return false;
  if (JORDAN_AREAS.some(a => n.includes(normalizeArabic(a)))) return true;
  return /^[\u0600-\u06FF\s\-\/]{4,90}$/.test(line.trim());
}
function lineLooksName(line, known = {}) {
  if (!line || isPhone(line) || isPurePriceLine(line) || isDateText(line) || lineLooksProduct(line)) return false;
  if (line === known.area || line === known.product) return false;
  const n = normalizeArabic(line);
  if (JORDAN_AREAS.some(a => n.includes(normalizeArabic(a)))) return false;
  return /^[\u0600-\u06FFa-zA-Z'\s]{3,70}$/.test(line.trim());
}

function parseStructured(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (const line of lines) {
    const clean = line.replace(/^[-*•\s]+/, '').trim();
    const m = clean.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!m) continue;
    const key = normalizeArabic(m[1]);
    const val = m[2].trim();
    // Order matters: موعد التوصيل must NOT be treated as منطقة التوصيل.
    if (/موعد|تاريخ|يوم|تسليم/.test(key)) out.customerDeliveryDateText = val;
    else if (/اسم/.test(key)) out.name = val;
    else if (/رقم|تواصل|هاتف|موبايل|جوال/.test(key)) out.phone = extractPhone(val) || val;
    else if (/منطقه|منطقة|عنوان/.test(key)) out.area = val;
    else if (/صنف|منتج|طلب|المنتج/.test(key)) out.product = val;
    else if (/سعر|متفق|المبلغ/.test(key)) out.price = extractPrice(val) || val;
    else if (/شركة|مندوب/.test(key)) out.deliveryCompany = val;
    else if (/ملاحظه|ملاحظات|نوت/.test(key)) out.notes = val;
  }
  return out;
}

function collectProductLines(lines) {
  const prodLines = lines.filter(lineLooksProduct);
  if (!prodLines.length) return '';
  // Join product-looking lines, but avoid duplicating a structured product line exactly.
  return prodLines.join(' + ');
}

function parseCompactBlock(block) {
  const structured = parseStructured(block);
  const text = String(block);
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const out = { ...structured };

  out.phone = out.phone || extractPhone(text);
  out.price = out.price || extractPrice(text);

  if (!out.customerDeliveryDateText) {
    const dateLine = lines.find(line => isDateText(line));
    if (dateLine) out.customerDeliveryDateText = dateLine;
  }

  if (!out.product) out.product = collectProductLines(lines);
  if (!out.area) {
    const knownAreaLine = lines.find(line => JORDAN_AREAS.some(a => normalizeArabic(line).includes(normalizeArabic(a))));
    const areaLine = knownAreaLine || lines.find(line => lineLooksArea(line));
    if (areaLine) out.area = areaLine;
  }
  if (!out.name) {
    const nameLine = lines.find(line => lineLooksName(line, out));
    if (nameLine) out.name = nameLine;
  }
  if (!out.notes) {
    const noteLines = lines.filter(line => /(ملاحظه|ملاحظات|ملاحظة|نوت|يرن|اتصال|الظهر|الصبح|المسا|مساء|بعد العصر|واتساب|اونلاين|أونلاين|اجنبيه|اجنبية)/.test(normalizeArabic(line)) && line !== out.customerDeliveryDateText && line !== out.product);
    if (noteLines.length) out.notes = noteLines.join(' | ');
  }
  return sanitizeOrder(out);
}

function sanitizeOrder(o) {
  const out = { ...o };
  // Search phone anywhere if missing or shifted.
  out.phone = extractPhone(out.phone) || extractPhone([out.name, out.area, out.product, out.notes].join(' ')) || '';
  if (out.name && extractPhone(out.name)) out.name = '';
  if (out.area && isDateText(out.area)) {
    if (!out.customerDeliveryDateText) out.customerDeliveryDateText = out.area;
    out.area = '';
  }
  if (out.price) {
    const p = extractPrice(String(out.price)) || (isPurePriceLine(out.price) ? String(Number(toEnglishDigits(out.price).replace(/[^0-9.]/g, ''))) : '');
    out.price = p || '';
  }
  if (!out.price && out.customerDeliveryDateText && isPurePriceLine(out.customerDeliveryDateText)) {
    out.price = extractPrice(out.customerDeliveryDateText);
    out.customerDeliveryDateText = '';
  }
  if (out.product) out.product = normalizeProduct(out.product);
  if (out.deliveryCompany) {
    const d = normalizeArabic(out.deliveryCompany);
    out.deliveryCompany = normalizeDeliveryCompany(out.deliveryCompany);
  }
  return out;
}

function splitPotentialBlocks(text) {
  const raw = String(text).trim();
  if (!raw) return [];
  // Split only when a new phone/structured name starts after a blank-ish boundary.
  const parts = raw.split(/\n\s*(?=(?:\+?962|00962|0)?\s*7[789][\d\s\-]{7,}|الاسم\s*[:：]|اسم\s*[:：])/g).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [raw];
}

function detectOrders(text, opts = {}) {
  const blocks = splitPotentialBlocks(text);
  const orders = blocks.map(parseCompactBlock).filter(o => {
    const score = [o.phone, o.area, o.product, o.price].filter(Boolean).length;
    return score >= 3 || (o.phone && o.price && o.product);
  });
  return orders.map(o => {
    const customerDeliveryDate = resolveDateText(o.customerDeliveryDateText || '') || opts.defaultCustomerDeliveryDate || '';
    const companyHandoffDate = customerDeliveryDate ? computeCompanyHandoffDate(customerDeliveryDate, opts.handoffDaysBefore ?? 1) : '';
    return {
      ...o,
      deliveryCompany: chooseDeliveryCompany({ area: o.area, explicitCompany: o.deliveryCompany, defaultCompany: opts.defaultDeliveryCompany || '' }),
      customerDeliveryDate: o.customerDeliveryDate || customerDeliveryDate,
      companyHandoffDate: o.companyHandoffDate || companyHandoffDate
    };
  });
}

module.exports = { detectOrders, parseCompactBlock, parseStructured, sanitizeOrder, extractPhone, extractPrice, isPurePriceLine };
