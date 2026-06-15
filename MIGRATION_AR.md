# النقل من البوت القديم إلى Donna v3

## لا توقف القديم مباشرة

شغل Donna v3 أولاً في مجلد منفصل. القديم يبقى احتياط.

## الملفات التي تنقلها

من القديم إلى الجديد:

```txt
.env
google-credentials.json
```

اختياري:

```txt
.wwebjs_auth
```

لو نقلت `.wwebjs_auth` قد لا تحتاج QR جديد. إذا صار مشاكل، احذفها من مجلد Donna v3 فقط وامسح QR من جديد.

## Google Sheets

Donna v3 تكتب إلى نفس تبويب `طلبات رسمتك` إذا وضعت نفس `GOOGLE_SHEET_ID` و `GOOGLE_SHEET_NAME`.

## البيانات الجديدة

Donna v3 يحفظ:

```txt
data/orders.json
data/events.jsonl
data/reminders.json
```

هذه لا تحذفها.
