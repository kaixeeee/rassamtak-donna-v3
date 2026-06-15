const fs = require('fs');
const path = require('path');
const { makeOrderId } = require('../utils/ids');
const { repairOrder, isProbablyBrokenOrder } = require('../core/orderRepair');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return fallback; }
}
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
function orderNumberValue(orderId = '') {
  const n = Number(String(orderId).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

class JsonDatabase {
  constructor(dataDir) {
    this.dataDir = dataDir;
    ensureDir(dataDir);
    this.ordersFile = path.join(dataDir, 'orders.json');
    this.eventsFile = path.join(dataDir, 'events.jsonl');
    this.remindersFile = path.join(dataDir, 'reminders.json');
    this.metaFile = path.join(dataDir, 'meta.json');
  }

  init() {
    if (!fs.existsSync(this.ordersFile)) writeJson(this.ordersFile, []);
    if (!fs.existsSync(this.remindersFile)) writeJson(this.remindersFile, []);
    if (!fs.existsSync(this.metaFile)) writeJson(this.metaFile, { nextOrderNumber: 1 });
  }

  getMeta() { return readJson(this.metaFile, { nextOrderNumber: 1 }); }
  setMeta(meta) { writeJson(this.metaFile, meta); }
  getOrders() { return readJson(this.ordersFile, []); }

  repairExistingOrders(opts = {}) {
    const orders = this.getOrders();
    let changed = false;
    const repaired = [];
    let removed = 0;
    for (const o of orders) {
      const r = repairOrder(o, opts);
      // Remove only the obvious old garbage rows created by broken imports: no real phone + product became delivery company.
      if (isProbablyBrokenOrder(r) && (!r.phone || !/^07[789]\d{7}$/.test(String(r.phone))) && (!r.product || /^(نت|تامر)$/.test(String(r.product)))) {
        removed++; changed = true;
        this.logEvent(o.orderId || '', 'auto_pruned_broken_order', { before: o, after: r });
        continue;
      }
      if (JSON.stringify(o) !== JSON.stringify(r)) changed = true;
      repaired.push(r);
    }
    if (changed) this.saveOrders(repaired);
    return { changed, removed, count: repaired.length };
  }
  saveOrders(orders) { writeJson(this.ordersFile, orders); }
  getReminders() { return readJson(this.remindersFile, []); }
  saveReminders(reminders) { writeJson(this.remindersFile, reminders); }

  ensureNextOrderNumber() {
    const orders = this.getOrders();
    const max = orders.reduce((m, o) => Math.max(m, orderNumberValue(o.orderId)), 0);
    const meta = this.getMeta();
    if ((meta.nextOrderNumber || 1) <= max) {
      meta.nextOrderNumber = max + 1;
      this.setMeta(meta);
    }
  }

  nextOrderId() {
    this.ensureNextOrderNumber();
    const meta = this.getMeta();
    const id = makeOrderId(meta.nextOrderNumber || 1);
    meta.nextOrderNumber = (meta.nextOrderNumber || 1) + 1;
    this.setMeta(meta);
    return id;
  }

  logEvent(orderId, type, payload = {}) {
    const event = { at: new Date().toISOString(), orderId, type, payload };
    fs.appendFileSync(this.eventsFile, JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  normalizeOrderInput(input = {}) {
    return {
      orderId: input.orderId || '',
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString(),
      status: input.status || 'working',
      name: input.name || '',
      phone: input.phone || '',
      area: input.area || '',
      product: input.product || '',
      price: input.price || '',
      deliveryCompany: input.deliveryCompany || '',
      customerDeliveryDate: input.customerDeliveryDate || '',
      companyHandoffDate: input.companyHandoffDate || '',
      notes: input.notes || '',
      priceExpected: input.priceExpected || '',
      priceActualChecked: input.priceActualChecked || '',
      priceWarning: input.priceWarning || '',
      priceWarningStatus: input.priceWarningStatus || '',
      priceAutoCalculated: input.priceAutoCalculated || '',
      source: input.source || {},
      sheetRow: input.sheetRow || null
    };
  }

  createOrder(input, source = {}) {
    const orders = this.getOrders();
    const now = new Date().toISOString();
    const order = this.normalizeOrderInput(repairOrder({
      ...input,
      orderId: this.nextOrderId(),
      createdAt: now,
      updatedAt: now,
      source,
    }));
    orders.push(order);
    this.saveOrders(orders);
    this.logEvent(order.orderId, 'created', { order, source });
    return order;
  }

  upsertImportedOrder(input, source = {}) {
    const normalized = this.normalizeOrderInput(repairOrder({ ...input, source: { imported: true, ...source } }));
    if (!normalized.orderId) normalized.orderId = this.nextOrderId();
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.orderId === normalized.orderId || (normalized.phone && o.phone === normalized.phone && o.product === normalized.product && o.price === normalized.price));
    if (idx >= 0) {
      orders[idx] = { ...orders[idx], ...normalized, updatedAt: new Date().toISOString() };
      this.saveOrders(orders);
      this.logEvent(orders[idx].orderId, 'import_updated', { source });
      this.ensureNextOrderNumber();
      return orders[idx];
    }
    orders.push(normalized);
    this.saveOrders(orders);
    this.logEvent(normalized.orderId, 'imported', { source });
    this.ensureNextOrderNumber();
    return normalized;
  }

  updateOrder(orderId, patch, eventType = 'updated', eventPayload = {}) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.orderId === orderId || o.orderId === `#${String(orderId).replace(/^#/, '').padStart(3, '0')}`);
    if (idx < 0) return null;
    orders[idx] = { ...orders[idx], ...patch, updatedAt: new Date().toISOString() };
    this.saveOrders(orders);
    this.logEvent(orders[idx].orderId, eventType, { patch, ...eventPayload });
    return orders[idx];
  }

  findOrderById(ref) {
    if (!ref) return null;
    const id = `#${String(ref).replace(/[^0-9]/g, '').padStart(3, '0')}`;
    return this.getOrders().find(o => o.orderId === id) || null;
  }

  addReminder(reminder) {
    const reminders = this.getReminders();
    const exists = reminders.find(r => !r.done && r.orderId === reminder.orderId && r.type === reminder.type && r.dueDate === reminder.dueDate);
    if (exists) return exists;
    const item = { id: `rem_${Date.now()}_${Math.random().toString(16).slice(2)}`, done: false, createdAt: new Date().toISOString(), ...reminder };
    reminders.push(item);
    this.saveReminders(reminders);
    this.logEvent(reminder.orderId || '', 'reminder_created', item);
    return item;
  }

  markReminderDone(id) {
    const reminders = this.getReminders();
    const idx = reminders.findIndex(r => r.id === id);
    if (idx >= 0) {
      reminders[idx].done = true;
      reminders[idx].doneAt = new Date().toISOString();
      this.saveReminders(reminders);
    }
  }
}

module.exports = { JsonDatabase };
