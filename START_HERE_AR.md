# Donna v3.10 - إصلاح Reply المنتج

## الجديد
- لو عملت Reply على كرت طلب وكتبت فقط: `بوكس 60` أو `دفتر 48` أو `يوكس 120`، Donna تفهمها كتعديل صنف لنفس الطلب.
- لا تحتاج تكتب `بوت` داخل الـ Reply على كرت الطلب.
- بعد تعديل الصنف، Price Guard يشتغل: إذا السعر ناقص/0 يحسبه من الكتالوج، وإذا أقل من الطبيعي يحذر.
- أضفت مرادفات مثل: بوكس60 / بكس 60 / بوكس120.

## التركيب
استبدل:
```txt
src
scripts/self-test.js
package.json
START_HERE_AR.md
```

ولا تلمس:
```txt
.env
google-credentials.json
.wwebjs_auth
data
```

بعدها:
```powershell
npm test
npm start
```
