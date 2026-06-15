const { getProductPricing } = require('./productCatalog');

function toNumber(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[٫٬]/g,'.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const x = Number(n);
  return Number.isInteger(x) ? String(x) : String(Number(x.toFixed(2)));
}

function getPricing(product = '', notes = '') {
  const joined = [product, notes].filter(Boolean).join(' + ');
  const byJoined = getProductPricing(joined || product);
  if (byJoined?.normalPrice) return byJoined;
  return getProductPricing(product || '');
}

function isMissingOrZero(actual) {
  return actual === null || actual === undefined || Number(actual) <= 0;
}

function isUnrealisticHigh(actual, expected) {
  if (actual === null || actual === undefined) return false;
  if (actual > 300) return true;
  if (expected && actual > Math.max(80, expected * 4)) return true;
  return false;
}

function checkPrice({ product = '', price = '', notes = '' } = {}) {
  const info = getPricing(product, notes);
  const actual = toNumber(price);
  const expected = toNumber(info.normalPrice);
  if (!product || expected === null || !expected) {
    return { hasWarning: false, actual, expected, product: info.name || product, confidence: info.confidence || 0, components: info.components || [] };
  }

  if (isMissingOrZero(actual)) {
    return {
      hasWarning: true,
      severity: 'auto_calculated',
      actual: actual ?? null,
      expected,
      difference: expected,
      product: info.name || product,
      confidence: info.confidence || 0,
      components: info.components || [],
      inferredPrice: expected,
      message: buildWarning({ product: info.name || product, actual: actual ?? '-', expected, difference: expected, severity: 'auto_calculated', components: info.components || [] })
    };
  }

  if (isUnrealisticHigh(actual, expected)) {
    return {
      hasWarning: true,
      severity: 'invalid_repaired',
      actual,
      expected,
      difference: Number((actual - expected).toFixed(2)),
      product: info.name || product,
      confidence: info.confidence || 0,
      components: info.components || [],
      inferredPrice: expected,
      message: buildWarning({ product: info.name || product, actual, expected, difference: Number((actual - expected).toFixed(2)), severity: 'invalid_repaired', components: info.components || [] })
    };
  }

  const diff = Number((expected - actual).toFixed(2));
  const under = diff > 0.009;
  // السعر الأعلى من الطبيعي مقبول عندك، فلا نحذّر عليه.
  const hasWarning = under;
  return {
    hasWarning,
    severity: under ? 'danger' : 'ok',
    actual,
    expected,
    difference: under ? diff : 0,
    product: info.name || product,
    confidence: info.confidence || 0,
    components: info.components || [],
    message: hasWarning ? buildWarning({ product: info.name || product, actual, expected, difference: diff, severity: 'danger', components: info.components || [] }) : ''
  };
}

function componentText(components = []) {
  return components.length > 1
    ? `\nتفصيل المتوقع: ${components.map(c => `${c.qty && c.qty > 1 ? c.qty + '× ' : ''}${c.name} = ${formatMoney(c.totalPrice ?? c.normalPrice)} د`).join(' + ')}`
    : '';
}

function buildWarning({ product, actual, expected, difference, severity, components = [] }) {
  const details = componentText(components);
  if (severity === 'auto_calculated') {
    return `🧠 تم حساب السعر تلقائياً من قائمة الأسعار\n` +
      `الصنف: ${product}\n` +
      `السعر الموجود: ${actual === null || actual === '-' ? 'غير موجود/0' : formatMoney(actual) + ' د'}\n` +
      `السعر المحسوب: ${formatMoney(expected)} د${details}\n` +
      `إذا السعر الحقيقي مختلف: بوت عدل طلب رقم الطلب السعر ...`;
  }
  if (severity === 'invalid_repaired') {
    return `🚨 سعر غير منطقي تم إصلاحه تلقائياً\n` +
      `الصنف: ${product}\n` +
      `السعر المدخل: ${formatMoney(actual)} د\n` +
      `السعر المحسوب من القائمة: ${formatMoney(expected)} د${details}\n` +
      `واضح إنه كان خلط بتاريخ/رقم/خانة، فتم اعتماد السعر المحسوب مؤقتاً.\n` +
      `إذا السعر الحقيقي مختلف: بوت عدل طلب رقم الطلب السعر ...`;
  }
  return `🚨 تحذير سعر خطير\n` +
    `الصنف: ${product}\n` +
    `السعر المدخل: ${formatMoney(actual)} د\n` +
    `السعر الطبيعي: ${formatMoney(expected)} د${details}\n` +
    `الفرق الناقص: ${formatMoney(difference)} د\n` +
    `ممكن يكون في غلط بالحسابات.\n` +
    `للتصحيح: بوت عدل طلب رقم الطلب السعر ${formatMoney(expected)}\n` +
    `ولو السعر صح: بوت السعر صحيح طلب رقم الطلب`;
}

function applyPriceGuardFields(order = {}) {
  const check = checkPrice(order);
  const patch = {
    priceExpected: check.expected === null ? '' : formatMoney(check.expected),
    priceActualChecked: check.actual === null ? '' : formatMoney(check.actual),
    priceWarning: check.hasWarning ? check.message : '',
    priceWarningStatus: check.hasWarning ? (check.severity || 'open') : '',
  };

  if ((check.severity === 'auto_calculated' || check.severity === 'invalid_repaired') && check.inferredPrice) {
    patch.price = formatMoney(check.inferredPrice);
    patch.priceAutoCalculated = 'true';
    const shortNote = check.severity === 'auto_calculated'
      ? `🧠 تم حساب السعر تلقائياً من قائمة الأسعار: ${formatMoney(check.inferredPrice)} د.`
      : `🚨 كان السعر غير منطقي (${formatMoney(check.actual)} د) وتم اعتماد سعر القائمة: ${formatMoney(check.inferredPrice)} د.`;
    patch.notes = [order.notes, shortNote].filter(Boolean).join(' | ');
    return { check, patch };
  }

  if (check.hasWarning) {
    const shortNote = `⚠️ سعر أقل من الطبيعي: المدخل ${formatMoney(check.actual)} د، الطبيعي ${formatMoney(check.expected)} د، الفرق ${formatMoney(check.difference)} د.`;
    patch.priceWarningStatus = 'open';
    patch.notes = [order.notes, shortNote].filter(Boolean).join(' | ');
  } else if (order.priceWarningStatus !== 'acknowledged') {
    patch.priceWarning = '';
    patch.priceWarningStatus = '';
  }
  return { check, patch };
}

function acknowledgePrice(order = {}) {
  return {
    priceWarning: '',
    priceWarningStatus: 'acknowledged',
    notes: [order.notes, '✅ تم تأكيد السعر من الأدمن كصحيح.'].filter(Boolean).join(' | ')
  };
}

module.exports = { checkPrice, applyPriceGuardFields, acknowledgePrice, formatMoney, toNumber };
