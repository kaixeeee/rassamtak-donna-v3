const { toEnglishDigits, normalizeArabic } = require('../utils/normalize');

function pad(n) { return String(n).padStart(2, '0'); }
function toDateOnly(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function nextWeekday(target, base = new Date()) {
  const today = new Date(base); today.setHours(0,0,0,0);
  const cur = today.getDay(); // 0 Sunday
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff);
}

function resolveDateText(text = '', base = new Date()) {
  const raw = toEnglishDigits(String(text));
  const t = normalizeArabic(raw);
  const today = new Date(base); today.setHours(0,0,0,0);
  if (!t) return '';
  if (/اليوم|هسا|الحين/.test(t)) return toDateOnly(today);
  if (/بكره|بكرا|غدا|غداً/.test(t)) return toDateOnly(addDays(today, 1));
  if (/بعد\s*بكره|بعد\s*بكرا/.test(t)) return toDateOnly(addDays(today, 2));
  if (/بعد\s*يومين|يومين/.test(t)) return toDateOnly(addDays(today, 2));
  if (/بعد\s*ثلاث|بعد\s*3/.test(t)) return toDateOnly(addDays(today, 3));
  if (/الاسبوع\s*الجاي|الأسبوع\s*الجاي|الاسبوع\s*القادم|اسبوع\s*جاي|اسبوع\s*القادم/.test(t)) return toDateOnly(addDays(today, 7));

  const weekdays = [
    ['الاحد', 0], ['الأحد', 0], ['احد', 0],
    ['الاثنين', 1], ['الإثنين', 1], ['اثنين', 1],
    ['الثلاثاء', 2], ['ثلاثاء', 2],
    ['الاربعاء', 3], ['الأربعاء', 3], ['اربعاء', 3],
    ['الخميس', 4], ['خميس', 4],
    ['الجمعه', 5], ['الجمعة', 5], ['جمعه', 5], ['جمعة', 5],
    ['السبت', 6], ['سبت', 6]
  ];
  for (const [name, day] of weekdays) {
    if (t.includes(normalizeArabic(name))) return toDateOnly(nextWeekday(day, today));
  }

  const dm = raw.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!Number.isNaN(d.getTime())) return toDateOnly(d);
  }

  // لا تعتبر أي رقم داخل عنوان/ملاحظة كأنه يوم بالشهر. مثال: عمارة رقم 10.
  // نقبل الرقم فقط إذا كان النص كله قصير أو مكتوب قبله كلمة يوم.
  const onlyDay = t.match(/^(?:يوم\s*)?(\d{1,2})$/) || t.match(/\bيوم\s*(\d{1,2})\b/);
  if (onlyDay) {
    const d = new Date(today);
    d.setDate(Number(onlyDay[1]));
    if (d < today) d.setMonth(d.getMonth() + 1);
    return toDateOnly(d);
  }
  return '';
}

function computeCompanyHandoffDate(customerDeliveryDate, daysBefore = 1) {
  if (!customerDeliveryDate) return '';
  const d = new Date(customerDeliveryDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return toDateOnly(addDays(d, -Number(daysBefore || 0)));
}

function isToday(dateOnly) { return dateOnly === toDateOnly(startOfToday()); }
function isFutureOrToday(dateOnly) { return dateOnly && dateOnly >= toDateOnly(startOfToday()); }
module.exports = { resolveDateText, computeCompanyHandoffDate, toDateOnly, addDays, isToday, isFutureOrToday, nextWeekday };
