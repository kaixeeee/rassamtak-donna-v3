function extractJson(text = '') {
  const raw = String(text).trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (_) {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = raw.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch (_) {}
  }
  return null;
}

function normalizeDecision(d = {}) {
  const out = {
    intent: d.intent || 'chat_advice',
    confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : 0.5,
    shouldTouchData: Boolean(d.shouldTouchData),
    orderRef: d.orderRef || '',
    orderNumber: d.orderNumber || '',
    newDateText: d.newDateText || '',
    status: d.status || '',
    company: d.company || '',
    question: d.question || '',
    chatAnswer: d.chatAnswer || '',
    orderFields: d.orderFields || {},
    patch: d.patch || {},
    missing: Array.isArray(d.missing) ? d.missing : []
  };
  const dataIntents = ['create_order','delay_order','cancel_order','mark_company_handoff','mark_customer_delivered','update_order','delete_order','get_today_handoff','get_registered_today','get_product_summary_today','get_shipped_today','get_future_orders','get_company_account','get_order_details','batch_mark_company_handoff','batch_mark_customer_delivered','batch_cancel_orders','batch_update_company','learn_rule'];
  if (dataIntents.includes(out.intent)) out.shouldTouchData = true;
  if (out.intent === 'chat_advice' || out.intent === 'ignore' || out.intent === 'help_menu') out.shouldTouchData = false;
  return out;
}

module.exports = { extractJson, normalizeDecision };
