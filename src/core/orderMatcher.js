const { normalizeArabic } = require('../utils/normalize');

function normalizeOrderId(ref = '') {
  const digits = String(ref).replace(/[^0-9]/g, '');
  return digits ? `#${digits.padStart(3, '0')}` : '';
}

function findCandidates(db, ref = '') {
  const orders = db.getOrders();
  const id = normalizeOrderId(ref);
  if (id) return orders.filter(o => o.orderId === id);
  const nref = normalizeArabic(ref);
  if (!nref) return [];
  return orders.filter(o => {
    const hay = normalizeArabic([o.name, o.phone, o.area, o.product, o.deliveryCompany, o.orderId].join(' '));
    return hay.includes(nref) || nref.includes(normalizeArabic(o.name || '')) && o.name;
  });
}

function resolveSingleOrder(db, { orderNumber, orderRef }) {
  const ref = orderNumber || orderRef || '';
  const candidates = findCandidates(db, ref);
  if (candidates.length === 1) return { ok: true, order: candidates[0] };
  if (candidates.length > 1) return { ok: false, reason: 'multiple', candidates };
  return { ok: false, reason: 'not_found', candidates: [] };
}

module.exports = { normalizeOrderId, findCandidates, resolveSingleOrder };
