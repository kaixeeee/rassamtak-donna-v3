const config = require('../config');
const { toDateOnly, isFutureOrToday } = require('../core/dateResolver');
const { repairOrder, isReportableOrder, moneyNumber, isBadHugePrice } = require('../core/orderRepair');
const { getProductPricing } = require('../core/productCatalog');

function normalizeStatus(status = '') {
  const s = String(status || '').trim();
  if (/محذوف|deleted/i.test(s)) return 'deleted';
  if (/ملغي|cancel/i.test(s)) return 'cancelled';
  if (/مؤجل|موجل|delayed/i.test(s)) return 'delayed';
  if (/مشتري|زبون|customer|تم للمشتري/i.test(s)) return 'customer_delivered';
  if (/شركة|سلم|سُلّم|handoff/i.test(s)) return 'company_handoff';
  if (/working|قيد العمل|جاري/i.test(s)) return 'working';
  return s || 'working';
}

function active(o) {
  return !['cancelled', 'deleted'].includes(normalizeStatus(o.status));
}

function repaired(o) {
  const r = repairOrder(o || {});
  r.status = normalizeStatus(r.status);
  return r;
}

function noSheetsText() {
  return '⚠️ Google Sheets غير متصل. حسب القاعدة الجديدة ما بطلع تقارير من ذاكرة Donna. شغّل الشيت أو افحص الاعتمادات.';
}

async function reportOrders(source) {
  if (source && source.ready && typeof source.readOrders === 'function') {
    const rows = await source.readOrders();
    return rows.map(repaired).filter(isReportableOrder).filter(o => normalizeStatus(o.status) !== 'deleted');
  }

  // فقط للاختبارات المحلية عندما يكون Google Sheets مطفأ صراحة.
  if (source && typeof source.getOrders === 'function' && config.sheets.enabled === false) {
    return source.getOrders().map(repaired).filter(isReportableOrder).filter(o => normalizeStatus(o.status) !== 'deleted');
  }

  return null;
}

function money(o) {
  const r = repaired(o);
  if (!active(r)) return 0;
  if (r.priceWarningStatus === 'open' && isBadHugePrice(r.price, r.product)) return 0;
  const n = moneyNumber(r.price);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(status) {
  return {
    working: 'قيد العمل',
    company_handoff: 'سُلّم للشركة',
    customer_delivered: 'تم للمشتري',
    cancelled: 'ملغي',
    delayed: 'مؤجل',
    deleted: 'محذوف',
  }[normalizeStatus(status)] || status || '-';
}

function niceDate(d = '') {
  return d || '-';
}

function priceDisplay(o) {
  const r = repaired(o);
  if (isBadHugePrice(r.price, r.product)) return `${r.price} د ⚠️ غير محسوب`;
  return `${r.price || '-'} د`;
}

function cleanField(v, fallback = '-') {
  const s = String(v == null ? '' : v).trim();
  return s || fallback;
}
function oneLine(v, fallback = '-') {
  return cleanField(v, fallback).replace(/\s+/g, ' ');
}
function line(o, i = 0) {
  const r = repaired(o);
  const rows = [];
  rows.push((i ? i + ') ' : '') + cleanField(r.orderId) + ' | ' + cleanField(r.name, 'بدون اسم') + ' | ' + cleanField(r.phone));
  rows.push('📍 ' + oneLine(r.area) + ' | 💰 ' + priceDisplay(r) + ' | 🚚 ' + cleanField(r.deliveryCompany));
  rows.push('🎨 ' + oneLine(r.product));
  rows.push('📅 الزبون: ' + niceDate(r.customerDeliveryDate) + ' | الشركة: ' + niceDate(r.companyHandoffDate));
  rows.push('الحالة: ' + statusLabel(r.status));
  if (r.notes) rows.push('📝 ' + oneLine(r.notes).slice(0, 120));
  if (r.priceWarning) rows.push('⚠️ تحذير السعر: ' + String(r.priceWarning).split('\n')[0].replace('⚠️', '').trim());
  return rows.join('\n');
}
function totalLine(orders) {
  return `\n المجموع غير الملغي والسليم: ${orders.reduce((s, o) => s + money(o), 0)} د`;
}

function byCreatedToday(o, today) {
  return (o.createdAt || '').startsWith(today);
}

function byUpdatedToday(o, today) {
  return (o.updatedAt || o.createdAt || '').startsWith(today);
}

async function todayHandoff(source) {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const today = toDateOnly(new Date());
  const orders = all.filter(o => active(o) && o.companyHandoffDate === today);
  if (!orders.length) return '✅ ما في طلبات لازم تطلع لشركة التوصيل اليوم.';
  return ` طلبات لازم تطلع لشركة التوصيل اليوم (${today})\nعدد الطلبات: ${orders.length}\n\n` +
    orders.map((o, i) => line(o, i + 1)).join('\n────────────────\n') + totalLine(orders);
}

async function registeredToday(source) {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const today = toDateOnly(new Date());
  const orders = all.filter(o => byCreatedToday(o, today));
  if (!orders.length) return 'ما في طلبات مسجلة اليوم.';
  return ` الطلبات المسجلة اليوم (${today})\nعدد الطلبات: ${orders.length}\n\n` +
    orders.map((o, i) => line(o, i + 1)).join('\n────────────────\n') + totalLine(orders.filter(active));
}

async function productSummaryToday(source) {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const today = toDateOnly(new Date());
  const orders = all.filter(o => active(o) && byCreatedToday(o, today));
  if (!orders.length) return 'ما في أصناف مطلوبة اليوم لأن ما في طلبات مسجلة اليوم.';
  const map = new Map();
  for (const o of orders) {
    const pricing = getProductPricing(o.product || '');
    const components = pricing.components?.length ? pricing.components : [{ name: o.product || 'بدون صنف', qty: 1, totalPrice: money(o) }];
    for (const c of components) {
      const key = c.qty && c.qty > 1 ? `${c.qty}× ${c.name}` : c.name;
      const cur = map.get(key) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(c.totalPrice || c.normalPrice || 0);
      map.set(key, cur);
    }
  }
  const rows = [...map.entries()].map(([name, v], i) => `${i + 1}. ${name} — ${v.count} مرة — الطبيعي ${v.total} د`);
  return ` الأصناف اللي انطلبت اليوم (${today})\nعدد الأصناف: ${map.size}\nعدد الطلبات: ${orders.length}\n\n` + rows.join('\n') + totalLine(orders);
}

async function shippedToday(source) {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const today = toDateOnly(new Date());
  const orders = all.filter(o => active(o) && normalizeStatus(o.status) === 'company_handoff' && byUpdatedToday(o, today));
  if (!orders.length) return 'ما في طلبات محدثة كـ سُلّمت للشركة اليوم.';
  return ` الطلبات اللي طلعت/تسلمت للشركة اليوم (${today})\nعدد الطلبات: ${orders.length}\n\n` +
    orders.map((o, i) => line(o, i + 1)).join('\n────────────────\n') + totalLine(orders);
}

async function futureOrders(source) {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const orders = all.filter(o => active(o) && isFutureOrToday(o.customerDeliveryDate)).sort((a, b) => (a.customerDeliveryDate || '').localeCompare(b.customerDeliveryDate || ''));
  if (!orders.length) return 'ما في طلبات مستقبلية حالياً.';
  let current = '';
  const chunks = [];
  for (const o of orders) {
    if (o.customerDeliveryDate !== current) {
      current = o.customerDeliveryDate;
      chunks.push(`\n ${current}`);
    }
    chunks.push(line(o));
  }
  return ` الطلبات المجدولة / المستقبلية\nعدد الطلبات: ${orders.length}\n` + chunks.join('\n────────────────\n');
}

async function companyAccount(source, company = '') {
  const all = await reportOrders(source);
  if (!all) return noSheetsText();
  const c = String(company || '').trim();
  const orders = all.filter(o => active(o) && (!c || (o.deliveryCompany || '').includes(c)));
  if (!orders.length) return `ما في طلبات مفتوحة${c ? ' مع ' + c : ''}.`;
  return ` حساب ${c || 'كل الشركات'}\nعدد الطلبات: ${orders.length}\n\n` +
    orders.map((o, i) => line(o, i + 1)).join('\n────────────────\n') + totalLine(orders);
}

function helpMenu() {
  return ` أوامر Donna المفصلة\n\n` +
    ` الطلبات:\n` +
    `- بوت طلبات اليوم / شو عنا اليوم = طلبات لازم تطلع للشركة اليوم\n` +
    `- بوت الطلبات اللي دخلتها اليوم = الطلبات المسجلة اليوم\n` +
    `- بوت طلبات مجدولة = الطلبات حسب تاريخ الزبون\n` +
    `- بوت الأصناف اللي انطلبت اليوم\n\n` +
    `✏️ التعديل:\n` +
    `- بوت عدل طلب 4 السعر 18\n` +
    `- بوت غير شركة طلب 5 تامر\n` +
    `- بوت أجل طلب 3 للأربعاء\n` +
    `- بوت الطلب 6 ملغي\n` +
    `- بوت حذف طلب 6 = يخفيه من القوائم ويجعله محذوف في الشيت\n` +
    `- بوت السعر صحيح طلب 4\n\n` +
    ` التوصيل والحساب:\n` +
    `- بوت شو مع تامر اليوم\n` +
    `- بوت حساب نت\n` +
    `- بوت شو في طلبات طلعت اليوم\n\n` +
    ` التعليم:\n` +
    `- بوت تعلم منتج: دفتر صغير = دفتر تلوين ماندالا 48 صفحة\n` +
    `- إذا ما فهم حقل، رح يسألك سؤال واحد وتصححه.`;
}

module.exports = {
  todayHandoff,
  registeredToday,
  productSummaryToday,
  shippedToday,
  futureOrders,
  companyAccount,
  helpMenu,
  line,
  money,
  reportOrders,
};
