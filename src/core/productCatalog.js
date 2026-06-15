const { normalizeArabic, toEnglishDigits } = require('../utils/normalize');

const PRODUCTS = [
  { key: 'yox24', name: 'يوكس ماركر 24 لون مع ستاند', category: 'ماركر', normalPrice: 4, aliases: ['يوكس 24', 'ماركر 24', '24 لون يوكس', 'يوكس ماركر 24', 'yox 24', 'بوكس 24', 'بوكس24', 'بكس 24', 'بكس24', 'الوان 24', 'ألوان 24', 'كحول 24'] },
  { key: 'yox60', name: 'يوكس ماركر 60 لون مع ستاند', category: 'ماركر', normalPrice: 8, aliases: ['يوكس 60', 'ماركر 60', '60 لون يوكس', 'يوكس ماركر 60', 'yox 60', 'بوكس 60', 'بوكس60', 'بكس 60', 'بكس60', 'الوان 60', 'ألوان 60', 'كحول 60', '٦٠ لون'] },
  { key: 'yox120', name: 'يوكس ماركر 120 لون مع ستاند', category: 'ماركر', normalPrice: 15, aliases: ['يوكس 120', 'ماركر 120', '120 لون', '١٢٠ لون', 'الوان 120', 'ألوان 120', 'يوكس ماركر 120', 'yox 120', 'بوكس 120', 'بوكس120', 'بكس 120', 'بكس120', 'بوكسين 120', 'كحولية 120', 'كحول 120', 'علبة 120'] },
  { key: 'mandala100', name: 'دفتر تلوين ماندالا 100 صفحة', category: 'دفتر وكتب تلوين', normalPrice: 4, aliases: ['دفتر 100', 'مندالا 100', 'ماندالا 100', 'مانديلا 100', 'منديلا 100', 'دفتر كبير', 'دفتر تلوين 100', 'دفتر رسم كبير', 'دفتر الرسم الكبير', 'كبير 100', 'دفتر كبير 100'] },
  { key: 'mandala48', name: 'دفتر تلوين ماندالا 48 صفحة', category: 'دفتر وكتب تلوين', normalPrice: 2, aliases: ['دفتر 48', 'مندالا 48', 'ماندالا 48', 'مانديلا 48', 'منديلا 48', 'دفتر صغير', 'دفتر تلوين 48', 'دفتر رسم صغير', 'دفتر الرسم صغير', 'دفتر الرسم الصغير', 'اطفال صغير', 'أطفال صغير', 'دفتر اطفال', 'دفتر أطفال', 'اطفال', 'صغير', 'دفترين 48', 'دفترين تلوين 48', 'دفترين ماندالا صغار', 'دفترين ماندالا صغير'] },
  { key: 'gsm24', name: 'ماركر ب 24 - 3 رؤوس - GSM 120', category: 'دفتر وكتب تلوين', normalPrice: 5.5, aliases: ['ماركر 3 رؤوس', '3 رؤوس', 'ثلاث رؤوس', 'دفتر ماركر 24', 'gsm 120', 'ماركر ب24', 'a3', 'A3'] },
  { key: 'acrylicBook24', name: 'دفتر أكريليك 24 لون - أبيض (راشيل / من دير 12 قلم)', category: 'ألوان أكريليك', normalPrice: 8.5, aliases: ['دفتر اكريليك', 'دفتر أكريليك', 'اكريليك دفتر', 'اكريلك دفتر', 'راشيل', 'من دير 12'] },
  { key: 'acrylicPens24', name: 'أقلام أكريليك 24 لون - من منير', category: 'ألوان أكريليك', normalPrice: 8, aliases: ['اقلام اكريليك 24', 'أقلام أكريليك 24', 'اكريليك 24', 'اكريلك 24', 'اقلام اكريلك', 'علبة اكريلك 24', 'علبة اكريليك 24', 'منير'] },
  { key: 'pen3', name: 'قلم تحديد / رسم 3 مم', category: 'أقلام تحديد', normalPrice: 1, aliases: ['قلم 3 مم', 'تحديد 3', 'رسم 3', '3 ملي', '3mm'] },
  { key: 'pen2', name: 'قلم تحديد / رسم 2 مم', category: 'أقلام تحديد', normalPrice: 1, aliases: ['قلم 2 مم', 'تحديد 2', 'رسم 2', '2 ملي', '2mm'] },
  { key: 'pen1', name: 'قلم تحديد / رسم 1 مم', category: 'أقلام تحديد', normalPrice: 1, aliases: ['قلم 1 مم', 'تحديد 1', 'رسم 1', '1 ملي', '1mm'] },
  { key: 'pen05', name: 'قلم تحديد / رسم 0.5 مم', category: 'أقلام تحديد', normalPrice: 1, aliases: ['قلم 0.5', 'تحديد 0.5', 'رسم 0.5', 'نص ملي', '0.5mm'] }
];

function tokenList(s = '') {
  return normalizeArabic(toEnglishDigits(s))
    .replace(/[^\u0600-\u06FF\w\s.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreProduct(input, product) {
  const n = normalizeArabic(toEnglishDigits(input));
  const candidates = [product.name, ...(product.aliases || [])].map(x => normalizeArabic(toEnglishDigits(x)));
  let score = 0;
  for (const c of candidates) {
    if (!c || !n) continue;
    if (n === c) score = Math.max(score, 100);
    if (n.includes(c) || c.includes(n)) score = Math.max(score, Math.min(94, 55 + Math.min(n.length, c.length)));
    const inTok = new Set(tokenList(n));
    const cTok = tokenList(c);
    const hits = cTok.filter(t => inTok.has(t)).length;
    if (hits) score = Math.max(score, Math.round((hits / Math.max(cTok.length, 1)) * 82));
  }
  return score;
}

function matchProduct(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return { input: raw, product: '', confidence: 0, category: '' };
  let best = { product: '', confidence: 0, category: '', key: '', normalPrice: null };
  for (const p of PRODUCTS) {
    const s = scoreProduct(raw, p);
    if (s > best.confidence) best = { product: p.name, confidence: s, category: p.category, key: p.key, normalPrice: p.normalPrice };
  }
  if (best.confidence < 45) return { input: raw, product: raw, confidence: best.confidence, category: '', normalPrice: null };
  return { input: raw, ...best };
}

function normalizeProduct(input = '') {
  const pricing = getProductPricing(input);
  if (pricing.components && pricing.components.length > 1) return pricing.name;
  const m = matchProduct(input);
  return m.product || String(input || '').trim();
}

function quantityNear(text, alias) {
  const n = normalizeArabic(toEnglishDigits(text));
  const a = normalizeArabic(toEnglishDigits(alias));
  const idx = n.indexOf(a);
  if (idx < 0) return 1;
  const before = n.slice(Math.max(0, idx - 16), idx).trim();
  const after = n.slice(idx + a.length, idx + a.length + 12).trim();
  if (/(بوكسين|دفترين|علبتين|قلمين|اثنين|اتنين)$/.test(before)) return 2;
  const mBefore = before.match(/(?:عدد|x|\*)\s*(\d+)$/) || before.match(/(\d+)\s*(?:حبات|حبه|قطع|قطعه|دفاتر|دفتر|علب|علبه|بوكس)$/);
  if (mBefore) {
    const q = Number(mBefore[1]);
    if (q > 1 && q < 20) return q;
  }
  const mAfter = after.match(/^(?:عدد|x|\*)?\s*(\d+)\s*(?:حبات|حبه|قطع|قطعه|دفاتر|دفتر|علب|علبه|بوكس)/);
  if (mAfter) {
    const q = Number(mAfter[1]);
    if (q > 1 && q < 20) return q;
  }
  return 1;
}


function findMentionedProducts(input = '') {
  const raw = String(input || '').trim();
  const n = normalizeArabic(toEnglishDigits(raw));
  if (!n) return [];
  const hits = [];
  const used = new Set();
  for (const p of PRODUCTS) {
    const candidates = [p.name, ...(p.aliases || [])]
      .map(x => normalizeArabic(toEnglishDigits(x)))
      .filter(x => x && x.length >= 3)
      .sort((a,b) => b.length - a.length);
    let bestAlias = '';
    for (const c of candidates) {
      if (n.includes(c)) { bestAlias = c; break; }
    }
    if (bestAlias && !used.has(p.key)) {
      used.add(p.key);
      let qty = quantityNear(n, bestAlias);
      if (/(بوكسين|دفترين|علبتين|قلمين|اثنين|اتنين)/.test(bestAlias)) qty = Math.max(qty, 2);
      hits.push({ key: p.key, name: p.name, category: p.category, normalPrice: p.normalPrice, alias: bestAlias, qty, totalPrice: Number((p.normalPrice * qty).toFixed(2)) });
    }
  }
  if (!hits.length) {
    const best = matchProduct(raw);
    if (best.confidence >= 75) {
      const p = PRODUCTS.find(x => x.key === best.key || normalizeArabic(x.name) === normalizeArabic(best.product));
      if (p) return [{ key: p.key, name: p.name, category: p.category, normalPrice: p.normalPrice, alias: best.product, qty: 1, totalPrice: p.normalPrice }];
    }
  }
  return hits;
}

function getProductInfo(input = '') {
  const m = matchProduct(input);
  const byName = PRODUCTS.find(p => p.key === m.key || normalizeArabic(p.name) === normalizeArabic(m.product || input));
  if (byName) return { name: byName.name, category: byName.category, normalPrice: byName.normalPrice, confidence: Math.max(m.confidence || 0, 100), key: byName.key };
  return { name: m.product || String(input || '').trim(), category: m.category || '', normalPrice: m.normalPrice ?? null, confidence: m.confidence || 0, key: m.key || '' };
}

function getProductPricing(input = '') {
  const mentions = findMentionedProducts(input);
  if (mentions.length >= 1) {
    const total = mentions.reduce((s,p)=>s + Number(p.totalPrice ?? p.normalPrice ?? 0), 0);
    return {
      name: mentions.map(p => p.qty && p.qty > 1 ? `${p.qty}× ${p.name}` : p.name).join(' + '),
      category: [...new Set(mentions.map(p => p.category).filter(Boolean))].join(' + '),
      normalPrice: Number(total.toFixed(2)),
      confidence: mentions.length > 1 ? 95 : 88,
      components: mentions
    };
  }
  const single = getProductInfo(input);
  return { ...single, components: single.normalPrice != null ? [{ name: single.name, category: single.category, normalPrice: single.normalPrice, qty: 1, totalPrice: single.normalPrice }] : [] };
}

function listProducts() { return PRODUCTS.slice(); }
module.exports = { PRODUCTS, matchProduct, normalizeProduct, getProductInfo, getProductPricing, findMentionedProducts, listProducts };
