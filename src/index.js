const http = require('http');
const config = require('./config');
const db = require('./db');
const { SheetsSync } = require('./sheets/sheetsSync');
const { WhatsAppGateway } = require('./channels/whatsappGateway');
const { DiscordAlerts } = require('./channels/discordAlerts');
const { ReminderScheduler } = require('./reminders/scheduler');

async function main() {
  console.log(`\n╔══════════════════════════════════════════════╗\n║          DONNA v3 - سكرتيرة رسمتك           ║\n║ WhatsApp → Gemini Brain → DB → Sheets       ║\n╚══════════════════════════════════════════════╝\n`);

  db.init();
  console.log('✅ Database: جاهزة');

  const sheets = new SheetsSync();
  await sheets.init().catch(err => console.log('⚠️ Sheets init:', err.message));
  if (sheets.ready) {
    const result = await sheets.importExistingOrders(db).catch(err => { console.log('⚠️ فشل استيراد الشيت:', err.message); return { imported: 0 }; });
    if (result.imported) console.log(`📥 تم استيراد/مزامنة ${result.imported} طلب من الشيت إلى Donna DB`);
  }
  const repair = db.repairExistingOrders({ defaultDeliveryCompany: config.business.defaultDeliveryCompany, handoffDaysBefore: config.business.handoffDaysBefore });
  if (repair.changed) console.log(`🧹 تم تنظيف/تصحيح قاعدة Donna: ${repair.count} طلب صالح، حذف ${repair.removed} صف مكسور قديم`);

  const discord = new DiscordAlerts();
  await discord.init().catch(err => console.log('⚠️ Discord init:', err.message));

  const whatsapp = new WhatsAppGateway({ db, sheets, discord });

  const reminders = new ReminderScheduler({ db, whatsapp });
  reminders.start();

  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'Donna v3', whatsappReady: whatsapp.ready, whatsappRecoverAttempts: whatsapp.recoverAttempts, discordAlerts: !!discord.client, orders: db.getOrders().length }));
  }).listen(config.port, () => console.log(`💚 Health server: http://localhost:${config.port}`));

  console.log('🚀 Donna v3 جاهزة. واتساب رح يشتغل بالخلفية، وإذا تأخر نظام الإنقاذ بحاول يصلحه.');
  console.log('⏳ WhatsApp: تشغيل بالخلفية... لا تعتبره واقف إلا إذا ما صار جاهز بعد عدة دقائق.');
  setTimeout(() => {
    whatsapp.init().catch(err => {
      console.log('⚠️ WhatsApp لم يبدأ الآن، Donna ستظل شغالة وتحاول الإنقاذ:', err.message);
    });
  }, 250);

  process.on('SIGINT', async () => {
    console.log('\n👋 إيقاف Donna...');
    reminders.stop();
    try { await whatsapp.client?.destroy(); } catch (_) {}
    process.exit(0);
  });
}

main().catch(err => { console.error('💥 Startup error:', err); process.exit(1); });
