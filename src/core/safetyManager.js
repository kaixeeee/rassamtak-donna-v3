const { resolveSingleOrder } = require('./orderMatcher');

function validate(decision, db) {
  const d = decision || {};
  if (d.intent === 'chat_advice' || d.intent === 'ignore') return { ok: true, decision: d };
  if (d.intent === 'create_order') {
    const f = d.orderFields || {};
    const missing = [];
    if (!f.phone) missing.push('phone');
    if (!f.area) missing.push('area');
    if (!f.product) missing.push('product');
    if (!f.price) missing.push('price');
    if (missing.length) return { ok: false, clarify: true, question: `الطلب ناقص: ${missing.join(', ')}. كملهم برسالة وحدة.` };
    return { ok: true, decision: d };
  }
  if (['delay_order','cancel_order','mark_company_handoff','mark_customer_delivered','update_order'].includes(d.intent)) {
    const resolved = resolveSingleOrder(db, d);
    if (!resolved.ok) {
      if (resolved.reason === 'multiple') {
        const list = resolved.candidates.slice(0,5).map(o => `${o.orderId} ${o.name || ''} ${o.product || ''}`).join('\n');
        return { ok: false, clarify: true, question: `لقيت أكثر من طلب. أي واحد تقصد؟\n${list}` };
      }
      return { ok: false, clarify: true, question: 'أي طلب تقصد؟ اكتب رقم الطلب أو اعمل Reply على كرت الطلب.' };
    }
    if (d.intent === 'delay_order' && !d.newDateText) return { ok: false, clarify: true, question: 'لمتى بدك أأجل الطلب؟' };
    if (d.intent === 'update_order' && (!d.patch || !Object.keys(d.patch).length)) return { ok: false, clarify: true, question: 'شو التعديل المطلوب على الطلب؟' };
    return { ok: true, decision: { ...d, resolvedOrder: resolved.order } };
  }
  if (['get_today_handoff','get_registered_today','get_product_summary_today','get_shipped_today','get_future_orders','get_company_account','get_order_details','help_menu','learn_rule'].includes(d.intent)) return { ok: true, decision: d };
  if (d.intent === 'clarify') return { ok: false, clarify: true, question: d.question || 'وضحلي أكثر شو بدك أعمل؟' };
  return { ok: true, decision: { intent: 'chat_advice', shouldTouchData: false, chatAnswer: '' } };
}

module.exports = { validate };
