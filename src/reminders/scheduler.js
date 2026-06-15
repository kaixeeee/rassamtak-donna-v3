const config = require('../config');
const { toDateOnly } = require('../core/dateResolver');
const { line } = require('../tools/reports');

class ReminderScheduler {
  constructor({ db, whatsapp }) {
    this.db = db;
    this.whatsapp = whatsapp;
    this.timer = null;
    this.lastDailyKey = '';
    this.lastFollowupKey = '';
  }
  start() {
    if (!config.reminders.enabled) return;
    this.timer = setInterval(() => this.tick().catch(err => console.log('⚠️ Reminder error:', err.message)), config.reminders.checkIntervalMs);
    console.log('⏰ Reminder scheduler شغال');
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    const now = new Date();
    const handoffKey = `${toDateOnly(now)}-${config.reminders.hour}:${config.reminders.minute}`;
    if (this.lastDailyKey !== handoffKey && now.getHours() === config.reminders.hour && now.getMinutes() === config.reminders.minute) {
      this.lastDailyKey = handoffKey;
      await this.sendDailyHandoffReminder();
    }

    const followupHour = config.reminders.followupHour || 21;
    const followupMinute = config.reminders.followupMinute || 0;
    const followupKey = `${toDateOnly(now)}-${followupHour}:${followupMinute}`;
    if (this.lastFollowupKey !== followupKey && now.getHours() === followupHour && now.getMinutes() === followupMinute) {
      this.lastFollowupKey = followupKey;
      await this.sendFollowupReminders();
    }
  }
  async sendDailyHandoffReminder() {
    const today = toDateOnly(new Date());
    const orders = this.db.getOrders().filter(o => !['cancelled','customer_delivered'].includes(o.status) && o.companyHandoffDate === today);
    if (!orders.length) return;
    const mention = config.reminders.mentionAll ? '@everyone\n' : '';
    const header = `${mention}صباح الخير، في ${orders.length} طلب/طلبات لازم يتسلموا لشركة التوصيل اليوم عشان يوصلوا بموعدهم.\nرح أرسل كل طلب لحاله، اختار الشركة بالرياكت: 🚚 نت | 📦 تامر`;
    if (typeof this.whatsapp?.sendOrderActionCards === 'function') await this.whatsapp.sendOrderActionCards(orders, { mode: 'handoff', header }).catch(() => null);
    else await this.whatsapp?.sendToTarget(header + '\n\n' + orders.map((o,i)=>line(o,i+1)).join('\n────────────────\n')).catch(() => null);
  }
  async sendFollowupReminders() {
    const today = toDateOnly(new Date());
    const reminders = this.db.getReminders().filter(r => !r.done && r.type === 'followup' && r.dueDate === today);
    if (!reminders.length) return;
    const orders = reminders.map(r => this.db.findOrderById(r.orderId)).filter(o => o && !['cancelled','customer_delivered'].includes(o.status));
    if (!orders.length) {
      for (const r of reminders) this.db.markReminderDone(r.id);
      return;
    }
    const mention = config.reminders.mentionAll ? '@everyone\n' : '';
    const header = `${mention}متابعة طلبات التسليم 👇\nرح أرسل كل طلب لحاله. اختار الحالة بالرياكت: ✅ تم للمشتري | ❌ ملغي | ⏰ تأجل\nإذا ضغطت ⏰ اكتب بعدها: بوت أجل #رقم الطلب للأربعاء / بكرا / بعد أسبوع`;
    if (typeof this.whatsapp?.sendOrderActionCards === 'function') await this.whatsapp.sendOrderActionCards(orders, { mode: 'followup', header }).catch(() => null);
    else await this.whatsapp?.sendToTarget(header + '\n\n' + orders.map((o,i)=>line(o,i+1)).join('\n────────────────\n')).catch(() => null);
  }
}

module.exports = { ReminderScheduler };
