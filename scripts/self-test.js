const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'donna-v38-'));
process.env.DONNA_AI_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ENABLED = 'false';
process.env.WHATSAPP_ENABLED = 'false';
process.env.DEFAULT_DELIVERY_COMPANY = 'نت';
process.env.DELIVERY_COMPANY_HANDOFF_DAYS_BEFORE = '1';

const config = require('../src/config');
const { JsonDatabase } = require('../src/db/jsonDatabase');
const { detectOrders, parseCompactBlock } = require('../src/core/orderIntake');
const { resolveDateText, computeCompanyHandoffDate, toDateOnly, addDays } = require('../src/core/dateResolver');
const { localFallback } = require('../src/brain/masterBrain');
const { validate } = require('../src/core/safetyManager');
const { execute } = require('../src/core/toolExecutor');
const { SheetsSync, HEADERS } = require('../src/sheets/sheetsSync');
const { matchProduct, getProductPricing } = require('../src/core/productCatalog');
const { checkPrice } = require('../src/core/priceGuard');
const { repairOrder, isReportableOrder, moneyNumber } = require('../src/core/orderRepair');
const { chooseDeliveryCompany, isAmmanArea, isNonAmmanArea } = require('../src/core/jordanAreas');
const { WhatsAppGateway } = require('../src/channels/whatsappGateway');

async function main() {
  assert.strictEqual(typeof SheetsSync, 'function');
  assert.ok(Array.isArray(HEADERS) && HEADERS.length >= 13);
  assert.ok(HEADERS.includes('تنبيه السعر'));
  const db = new JsonDatabase(config.dataDir);
  db.init();

  const compact = parseCompactBlock('وبنة سوالمة\nاربد\n0790015555\n120 لون\nب 18');
  assert.strictEqual(compact.phone, '0790015555');
  assert.strictEqual(compact.area, 'اربد');
  assert.ok(compact.product.includes('120'));
  assert.strictEqual(compact.price, '18');
  assert.ok(isNonAmmanArea('اربد'));
  assert.ok(isAmmanArea('مرج الحمام'));
  assert.strictEqual(chooseDeliveryCompany({ area: 'إربد قرب اربد مول' }), 'نت');
  assert.strictEqual(chooseDeliveryCompany({ area: 'شفا بدران - عيون الذيب' }), '');

  const tomorrow = toDateOnly(addDays(new Date(), 1));
  const orders = detectOrders('0795649915\nمرج الحمام\n٦٠ لون\n١٠.٥', { defaultDeliveryCompany: 'نت', defaultCustomerDeliveryDate: tomorrow, handoffDaysBefore: 1 });
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].phone, '0795649915');
  assert.strictEqual(orders[0].area, 'مرج الحمام');
  assert.ok(orders[0].product.includes('60'));
  assert.strictEqual(orders[0].price, '10.5');
  assert.strictEqual(orders[0].deliveryCompany, ''); // مرج الحمام داخل عمان: نختار نت/تامر بالرد أو الرياكت
  assert.strictEqual(orders[0].customerDeliveryDate, tomorrow);
  assert.strictEqual(orders[0].companyHandoffDate, toDateOnly(new Date()));

  const structured = detectOrders(`الاسم: Duaa\nرقم التواصل: 0797195154\nمنطقة التوصيل: شفا بدران - عيون الذيب\nموعد التوصيل: اليوم\nالصنف: دفترين تلوين 48 صفحة + بوكس ماركر 24 لون\nالسعر المتفق عليه: 10.5 دينار\nملاحظات: لا يوجد`, { defaultDeliveryCompany: 'نت', defaultCustomerDeliveryDate: tomorrow, handoffDaysBefore: 1 });
  assert.strictEqual(structured.length, 1);
  assert.strictEqual(structured[0].name, 'Duaa');
  assert.strictEqual(structured[0].phone, '0797195154');
  assert.ok(structured[0].area.includes('شفا بدران'));
  assert.strictEqual(structured[0].price, '10.5');
  assert.strictEqual(structured[0].customerDeliveryDate, toDateOnly(new Date()));
  assert.ok(structured[0].product.includes('دفتر') && structured[0].product.includes('24'));

  const qOrder = detectOrders(`0798656886\nبوكس ١٢٠\nمانديلا ١٠٠\nخميس باليل / جمعة صبح\n٢٢\nكنانة`, { defaultDeliveryCompany: 'نت', defaultCustomerDeliveryDate: tomorrow, handoffDaysBefore: 1 });
  assert.strictEqual(qOrder.length, 1);
  assert.strictEqual(qOrder[0].phone, '0798656886');
  assert.strictEqual(qOrder[0].area, 'كنانة');
  assert.strictEqual(qOrder[0].price, '22');
  assert.ok(qOrder[0].product.includes('120') && qOrder[0].product.includes('100'));
  assert.strictEqual(qOrder[0].deliveryCompany, 'نت'); // كنانة خارج عمان: نت تلقائياً

  assert.ok(matchProduct('دفتر 48').product.includes('48'));
  assert.ok(matchProduct('يوكس 120').product.includes('120'));
  assert.ok(matchProduct('قلم 3 ملي').product.includes('3'));
  assert.strictEqual(matchProduct('يوكس 120').normalPrice, 15);
  assert.strictEqual(getProductPricing('بوكسين 120 + علبة اكريلك 24 لون').normalPrice, 38);
  assert.strictEqual(getProductPricing('دفترين تلوين 48 صفحة + بوكس ماركر 24 لون').normalPrice, 8);

  const lowPrice = checkPrice({ product: 'يوكس ماركر 120 لون مع ستاند', price: '12' });
  assert.strictEqual(lowPrice.hasWarning, true);
  assert.strictEqual(lowPrice.expected, 15);
  const highPrice = checkPrice({ product: 'يوكس ماركر 120 لون مع ستاند', price: '22' });
  assert.strictEqual(highPrice.hasWarning, false);
  assert.strictEqual(highPrice.severity, 'ok');
  const missingPrice = checkPrice({ product: 'يوكس ماركر 60 لون مع ستاند', price: '0' });
  assert.strictEqual(missingPrice.severity, 'auto_calculated');
  assert.strictEqual(missingPrice.inferredPrice, 8);
  const invalidPrice = checkPrice({ product: 'يوكس ماركر 24 لون مع ستاند', price: '46300' });
  assert.strictEqual(invalidPrice.severity, 'invalid_repaired');
  const bundleOk = checkPrice({ product: 'يوكس 120 + دفتر رسم صغير', price: '17' });
  assert.strictEqual(bundleOk.expected, 17);
  assert.strictEqual(bundleOk.hasWarning, false);

  const broken = repairOrder({ orderId:'#999', name:'0795649915', phone:'مرج الحمام', area:'بكرا', product:'نت', price:'46300', customerDeliveryDate:'10.5' });
  assert.strictEqual(broken.phone, '0795649915');
  assert.strictEqual(broken.area, '');
  assert.strictEqual(broken.price, '10.5');
  assert.ok(!isReportableOrder({ ...broken, product:'نت' }));
  assert.strictEqual(moneyNumber('46300'), 46300);

  assert.strictEqual(resolveDateText('بكرا'), tomorrow);
  assert.strictEqual(computeCompanyHandoffDate(tomorrow, 1), toDateOnly(new Date()));
  assert.ok(resolveDateText('الأربعاء'));
  assert.strictEqual(resolveDateText('عمان جبل التاج دخلة مدرسة ابن ماجد عمارة رقم 10'), '');

  const created = db.createOrder({ phone: '0790015555', area: 'اربد', product: '120 لون', price: '18', deliveryCompany: 'نت', customerDeliveryDate: tomorrow, companyHandoffDate: toDateOnly(new Date()) });
  assert.strictEqual(created.orderId, '#001');

  const help = localFallback('بوت شو الاوامر', 'شو الاوامر');
  assert.strictEqual(help.intent, 'help_menu');
  const helpResult = await execute(help, { db, sheets: null });
  assert.ok(helpResult.text.includes('أوامر Donna'));

  assert.strictEqual(localFallback('بوت شو عنا طلبات اليوم', 'شو عنا طلبات اليوم').intent, 'get_today_handoff');
  assert.strictEqual(localFallback('بوت شو الطلبات المسجلة', 'شو الطلبات المسجلة').intent, 'get_registered_today');
  assert.strictEqual(localFallback('بوت احكيلي شو كل الاصناف الي انطلبت اليوم', 'احكيلي شو كل الاصناف الي انطلبت اليوم').intent, 'get_product_summary_today');
  assert.strictEqual(localFallback('بوت شو في طلبات طلعت اليوم', 'شو في طلبات طلعت اليوم').intent, 'get_shipped_today');

  const delayMissing = validate(localFallback('بوت أجل الطلب للأسبوع الجاي', 'أجل الطلب للأسبوع الجاي'), db);
  assert.strictEqual(delayMissing.ok, false);
  assert.ok(delayMissing.question.includes('أي طلب'));

  const lowOrderResult = await execute({ intent: 'create_order', orderFields: { phone: '0792222222', area: 'عمان', product: 'يوكس 120', price: '12', deliveryCompany: 'نت' } }, { db, sheets: null });
  assert.ok(lowOrderResult.text.includes('تحذير سعر خطير'));
  assert.ok(db.findOrderById('#002').priceWarning);

  const hugeOrderResult = await execute({ intent: 'create_order', orderFields: { phone: '0793333333', area: 'عمان', product: 'يوكس 24', price: '46300', deliveryCompany: 'نت' } }, { db, sheets: null });
  assert.ok(hugeOrderResult.text.includes('غير منطقي') || hugeOrderResult.text.includes('تم اعتماد سعر القائمة'));
  assert.strictEqual(db.findOrderById('#003').price, '4');

  const acc = await execute({ intent: 'get_company_account', company: 'نت' }, { db, sheets: null });
  assert.ok(acc.text.includes('المجموع غير الملغي'));

  const repairedZero = repairOrder({ phone:'0795555555', area:'عمان', product:'يوكس ماركر 120 لون مع ستاند', price:'0', deliveryCompany:'نت' });
  assert.strictEqual(repairedZero.price, '15');
  assert.strictEqual(repairedZero.priceAutoCalculated, 'true');

  const fakeGateway = new WhatsAppGateway({ db, sheets: null });
  const replyCompany = fakeGateway.replyDecisionForOrder('تامر', { orderId: '#001' });
  assert.strictEqual(replyCompany.patch.deliveryCompany, 'تامر');
  const replyCancel = fakeGateway.replyDecisionForOrder('ملغي', { orderId: '#001' });
  assert.strictEqual(replyCancel.patch.status, 'cancelled');
  const replyPrice = fakeGateway.replyDecisionForOrder('السعر 20', { orderId: '#001' });
  assert.strictEqual(replyPrice.patch.price, '20');
  const replyProduct = fakeGateway.replyDecisionForOrder('بوكس 60', { orderId: '#001', price: '0' });
  assert.ok(replyProduct.patch.product.includes('60'));

  assert.ok(config.whatsapp.protocolTimeoutMs >= 180000);
  const { DiscordAlerts } = require('../src/channels/discordAlerts');
  assert.strictEqual(typeof DiscordAlerts, 'function');
  console.log('✅ Donna v3.10 self-test passed: amman-company-rule/reply-edit/no-bot-needed OK');
}

main().catch(err => { console.error('❌ Donna v3.10 self-test failed:', err); process.exit(1); });
