# Donna v3 - سكرتيرة عمليات رسمتك

Donna v3 ليست باتش فوق النسخة القديمة، بل نظام جديد نظيف يعمل بالتوازي.

## المكونات

- WhatsApp Gateway: استقبال وإرسال رسائل القروب.
- Master Brain: Gemini يفهم النية ويرجع JSON.
- Safety Manager: يمنع التنفيذ بدون طلب واضح.
- JSON Database: قاعدة بيانات محلية مبدئية خفيفة.
- Sheets Sync: مزامنة الطلبات إلى Google Sheets.
- Reminder Scheduler: تذكير يومي بالطلبات التي لازم تطلع لشركة التوصيل.

## النوايا

- create_order
- delay_order
- cancel_order
- mark_company_handoff
- mark_customer_delivered
- get_today_handoff
- get_registered_today
- get_future_orders
- get_company_account
- chat_advice
- clarify

## قاعدة الأمان

Gemini لا يكتب بالشيت مباشرة. يختار نية فقط. الكود ينفذ بعد التحقق.

إذا قال المستخدم: `بوت أجل الطلب للأسبوع الجاي` بدون رقم، النظام يسأل: أي طلب؟

إذا قال: `بوت شو أعمل مع زبون زعلان؟` النظام يرد دردشة ولا يلمس البيانات.
