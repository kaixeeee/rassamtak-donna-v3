const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toEnglishDigits(input = '') {
  return String(input)
    .replace(/[٠-٩۰-۹]/g, ch => {
      const ar = AR_DIGITS.indexOf(ch);
      if (ar >= 0) return String(ar);
      const fa = FA_DIGITS.indexOf(ch);
      if (fa >= 0) return String(fa);
      return ch;
    })
    .replace(/[٫٬]/g, '.')
    .replace(/،/g, ',');
}

function normalizeArabic(input = '') {
  return toEnglishDigits(String(input))
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWakeword(text = '', wakeword = 'بوت') {
  const t = String(text).trim();
  const re = new RegExp(`^\\s*${wakeword}\\s*[:：،,-]*\\s*`, 'i');
  return t.replace(re, '').trim();
}

function hasWakeword(text = '', wakeword = 'بوت') {
  return normalizeArabic(text).startsWith(normalizeArabic(wakeword));
}

function cleanNumberText(text = '') {
  return toEnglishDigits(text)
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { toEnglishDigits, normalizeArabic, stripWakeword, hasWakeword, cleanNumberText };
