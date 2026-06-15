const INTENTS = [
  'chat_advice','create_order','delay_order','cancel_order','mark_company_handoff','mark_customer_delivered',
  'update_order','get_today_handoff','get_registered_today','get_product_summary_today','get_shipped_today','get_future_orders','get_company_account','get_order_details','help_menu','learn_rule','clarify','ignore'
];

function buildPrompt({ message, wakewordStripped, businessRules = {}, recentOrders = [] }) {
  const contextOrders = recentOrders.slice(-8).map(o => ({
    orderId: o.orderId,
    name: o.name,
    phone: o.phone,
    area: o.area,
    product: o.product,
    status: o.status,
    company: o.deliveryCompany,
    customerDeliveryDate: o.customerDeliveryDate,
    companyHandoffDate: o.companyHandoffDate
  }));

  return `أنت Donna، سكرتيرة عمليات ذكية لمتجر رسمتك في الأردن. المطلوب فهم نية الرسالة باللهجة الأردنية/السعودية/العامية والأخطاء الإملائية.
لا تكتب شرحاً. أعد JSON صالح فقط.

القواعد التجارية:
- إذا السؤال دردشة/نصيحة/صياغة رد ولا يطلب تعديل بيانات: intent = chat_advice و shouldTouchData=false.
- إذا طلب تعديل شيت/طلب/حالة/تأجيل/تقرير: اختر intent مناسب.
- إذا التنفيذ ناقصه رقم طلب أو مرجع واضح: intent=clarify مع سؤال واحد فقط.
- لا تخمن رقم طلب. إذا الاسم يطابق أكثر من طلب، اطلب توضيح.
- معنى "طلبات اليوم" في رسمتك: الطلبات التي يجب تسليمها لشركة التوصيل اليوم حتى تصل للزبون بموعدها.
- "الطلبات المسجلة اليوم" تعني الطلبات التي أضيفت اليوم.
- "الأصناف اللي انطلبت اليوم / شو كل الأصناف" تعني ملخص الأصناف من الطلبات المسجلة اليوم.
- "طلبات طلعت اليوم / تسلمت للشركة اليوم" تعني الطلبات التي حالتها سُلّمت للشركة اليوم.
- "سلم" = سُلّم لشركة التوصيل. "تم" = وصل للمشتري. "ملغي/التغى" = cancel. "أجل/مؤجل" = delay.
- شركة التوصيل الافتراضية: ${businessRules.defaultDeliveryCompany || 'نت'}.
- لا تخلط كلام مثل "زبون مأجل مرتين" مع شركة توصيل.

النوايا المسموحة:
${INTENTS.join(', ')}

أعد JSON بهذه الحقول فقط قدر الإمكان:
{
  "intent": "chat_advice|create_order|delay_order|cancel_order|mark_company_handoff|mark_customer_delivered|update_order|get_today_handoff|get_registered_today|get_product_summary_today|get_shipped_today|get_future_orders|get_company_account|get_order_details|learn_rule|clarify|ignore",
  "confidence": 0.0,
  "shouldTouchData": false,
  "orderRef": "",
  "orderNumber": "",
  "newDateText": "",
  "status": "",
  "company": "",
  "question": "",
  "chatAnswer": "",
  "orderFields": {"name":"","phone":"","area":"","product":"","price":"","deliveryCompany":"","customerDeliveryDateText":"","notes":""},
  "missing": []
}

طلبات حديثة مختصرة للسياق:
${JSON.stringify(contextOrders, null, 2)}

الرسالة الأصلية:
${message}

بعد إزالة كلمة بوت إن وجدت:
${wakewordStripped}`;
}

module.exports = { buildPrompt, INTENTS };
