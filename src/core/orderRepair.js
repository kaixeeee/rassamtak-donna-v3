const { extractPhone, extractPrice } = require('./orderIntake');
const { normalizeProduct, getProductPricing } = require('./productCatalog');
const { resolveDateText, computeCompanyHandoffDate, addDays, toDateOnly } = require('./dateResolver');
const { applyPriceGuardFields, toNumber } = require('./priceGuard');
const { chooseDeliveryCompany, normalizeDeliveryCompany } = require('./jordanAreas');
const config = require('../config');

function n(v='') { return String(v || '').trim(); }
function moneyNumber(v) {
  const raw = n(v).replace(/[٫٬]/g,'.');
  const x = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(x) ? x : null;
}
function isValidPhone(v='') { return /^07[789]\d{7}$/.test(extractPhone(v)); }
function isDeliveryCompanyWord(v='') { return /^(نت|تامر)$/i.test(n(v)); }
function isLikelyDateText(v='') { return !!resolveDateText(v) || /^\d{4}-\d{2}-\d{2}$/.test(n(v)); }
function defaultCustomerDate() { return toDateOnly(addDays(new Date(), 1)); }
function isBadHugePrice(v, product='') {
  const p = moneyNumber(v);
  if (p === null) return false;
  if (p > 300) return true;
  const pricing = getProductPricing(product || '');
  const expected = moneyNumber(pricing.normalPrice);
  if (expected && p > Math.max(80, expected * 4)) return true;
  return false;
}
function isProbablyBrokenOrder(o = {}) {
  if (!o) return true;
  const phoneOk = isValidPhone(o.phone);
  const productBad = isDeliveryCompanyWord(o.product) || !n(o.product);
  const badPrice = isBadHugePrice(o.price, o.product);
  const shiftedDatePrice = moneyNumber(o.customerDeliveryDate) !== null && !/^\d{4}-/.test(n(o.customerDeliveryDate));
  return (!phoneOk && productBad) || badPrice || (productBad && shiftedDatePrice);
}

function repairOrder(order = {}, opts = {}) {
  const out = { ...order };
  const allText = [out.name, out.phone, out.area, out.product, out.price, out.customerDeliveryDate, out.companyHandoffDate, out.notes].join(' ');
  const phone = extractPhone(out.phone) || extractPhone(allText);
  if (phone) out.phone = phone;
  if (extractPhone(out.name)) out.name = '';

  // Field shifts from old broken versions: name=phone, phone=area, date=price.
  if (!isValidPhone(out.phone) && out.phone && !out.area && /[\u0600-\u06FF]/.test(out.phone)) {
    out.area = out.phone;
    out.phone = phone || '';
  }
  // Old shifted rows sometimes stored the price inside customerDeliveryDate.
  const earlyCdMoney = moneyNumber(out.customerDeliveryDate);
  if (earlyCdMoney !== null && earlyCdMoney >= 0.5 && earlyCdMoney <= 300 && !/^\d{4}-/.test(n(out.customerDeliveryDate))) {
    const currentPrice = moneyNumber(out.price);
    if (!out.price || currentPrice === null || currentPrice > 300) {
      out.price = String(earlyCdMoney);
      out.customerDeliveryDate = '';
    }
  }

  if (isLikelyDateText(out.area)) {
    if (!out.customerDeliveryDate || !/^\d{4}-/.test(n(out.customerDeliveryDate))) out.customerDeliveryDate = resolveDateText(out.area) || out.customerDeliveryDate;
    out.area = '';
  }
  const cdMoney = moneyNumber(out.customerDeliveryDate);
  if (cdMoney !== null && cdMoney >= 0.5 && cdMoney <= 300 && !/^\d{4}-/.test(n(out.customerDeliveryDate))) {
    const currentPrice = moneyNumber(out.price);
    if (!out.price || currentPrice === null || currentPrice > 300) {
      out.price = String(cdMoney);
      out.customerDeliveryDate = '';
    }
  }

  // Normalize product using product + notes when possible, because old imports may have lost bundled items.
  if (out.product && !isDeliveryCompanyWord(out.product)) {
    const pricingInput = [out.product, out.notes].filter(Boolean).join(' + ');
    const pricing = getProductPricing(pricingInput || out.product);
    out.product = pricing?.name || normalizeProduct(out.product);
  }
  if (isDeliveryCompanyWord(out.product) && !out.deliveryCompany) {
    out.deliveryCompany = out.product;
    out.product = '';
  }
  out.deliveryCompany = normalizeDeliveryCompany(out.deliveryCompany);
  if (!out.deliveryCompany) {
    out.deliveryCompany = chooseDeliveryCompany({
      area: out.area,
      explicitCompany: out.deliveryCompany,
      defaultCompany: opts.defaultDeliveryCompany || config.business.defaultDeliveryCompany || 'نت'
    });
  }

  let price = extractPrice(out.price) || (moneyNumber(out.price) !== null ? String(moneyNumber(out.price)) : '');
  let autoPriceMessage = '';
  const pricingForRepair = getProductPricing([out.product, out.notes].filter(Boolean).join(' + '));
  const expectedForRepair = toNumber(pricingForRepair.normalPrice);
  const numericPrice = moneyNumber(price);
  const missingOrZero = !price || numericPrice === null || numericPrice <= 0;

  if ((missingOrZero || (price && isBadHugePrice(price, out.product))) && expectedForRepair) {
    // Do not leave reports with 0 or corrupted huge numbers; infer from the product catalog and keep an audit note.
    const original = price || out.price || '0';
    out.price = String(expectedForRepair);
    out.priceAutoCalculated = 'true';
    if (missingOrZero) {
      autoPriceMessage = `🧠 تم حساب السعر تلقائياً من قائمة الأسعار: ${expectedForRepair} د.`;
      out.notes = [out.notes, autoPriceMessage].filter(Boolean).join(' | ');
    } else {
      autoPriceMessage = `🚨 السعر كان غير منطقي (${original} د)، تم اعتماد سعر القائمة: ${expectedForRepair} د.`;
      out.notes = [out.notes, autoPriceMessage].filter(Boolean).join(' | ');
    }
  } else if (price) {
    out.price = price;
  }

  if (!out.customerDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(n(out.customerDeliveryDate))) {
    const resolved = resolveDateText(out.customerDeliveryDate || out.customerDeliveryDateText || '') || opts.defaultCustomerDeliveryDate || defaultCustomerDate();
    out.customerDeliveryDate = resolved;
  }
  if (!out.companyHandoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(n(out.companyHandoffDate))) {
    out.companyHandoffDate = computeCompanyHandoffDate(out.customerDeliveryDate, opts.handoffDaysBefore ?? config.business.handoffDaysBefore ?? 1);
  }

  if (out.product && out.price) {
    const pg = applyPriceGuardFields(out);
    Object.assign(out, pg.patch);
    if (autoPriceMessage) {
      out.priceWarning = autoPriceMessage;
      out.priceWarningStatus = 'auto_calculated';
      out.priceAutoCalculated = 'true';
    }
  }
  return out;
}

function isReportableOrder(o = {}) {
  if (!o) return false;
  if (!isValidPhone(o.phone)) return false;
  if (!o.product || isDeliveryCompanyWord(o.product)) return false;
  if (isBadHugePrice(o.price, o.product)) return false;
  return true;
}

module.exports = { repairOrder, isProbablyBrokenOrder, isReportableOrder, isBadHugePrice, isValidPhone, moneyNumber };
