const fs = require('fs');
const config = require('../config');
const { toDateOnly } = require('../core/dateResolver');
const { repairOrder, isReportableOrder, isBadHugePrice } = require('../core/orderRepair');

const HEADERS = [
  'رقم الطلب',
  'تاريخ التسجيل',
  'الاسم',
  'رقم التواصل',
  'المنطقة',
  'الصنف',
  'السعر',
  'شركة التوصيل',
  'موعد الزبون',
  'موعد تسليم الشركة',
  'الحالة',
  'ملاحظات',
  'تنبيه السعر'
];

function normalizeStatus(v = '') {
  const s = String(v || '').trim();
  if (/ملغي|cancel/i.test(s)) return 'cancelled';
  if (/مؤجل|موجل|delayed/i.test(s)) return 'delayed';
  if (/مشتري|زبون|customer|تم للمشتري/i.test(s)) return 'customer_delivered';
  if (/شركة|سلم|سُلّم|handoff/i.test(s)) return 'company_handoff';
  if (/working|قيد العمل|جاري/i.test(s)) return 'working';
  return s || 'working';
}

function statusLabel(status) {
  return {
    working: 'قيد العمل',
    company_handoff: 'سُلّم للشركة',
    customer_delivered: 'تم للمشتري',
    cancelled: 'ملغي',
    delayed: 'مؤجل'
  }[normalizeStatus(status)] || status || 'قيد العمل';
}

function displayDateTime(v = '') {
  const s = String(v || '').trim();
  if (!s) return '';
  // ISO -> readable compact for Sheets
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return s.replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function priceWarningText(o = {}) {
  if (!o.priceWarning) return '';
  if (o.priceWarningStatus === 'acknowledged') return 'تم تأكيد السعر';
  const expected = o.priceExpected ? `الطبيعي ${o.priceExpected} د` : 'أقل من الطبيعي';
  return `⚠️ ${expected}`;
}

function val(row, idx) { return (row[idx] ?? '').toString().trim(); }
function colIndex(headers, names, fallback) {
  const norm = x => String(x || '').replace(/[\x00]/g,'').trim();
  for (const name of names) {
    const i = headers.findIndex(h => norm(h).includes(name));
    if (i >= 0) return i;
  }
  return fallback;
}

const C = {
  white: { red: 1, green: 1, blue: 1 },
  header: { red: 0.05, green: 0.22, blue: 0.38 },
  header2: { red: 0.09, green: 0.36, blue: 0.33 },
  border: { red: 0.82, green: 0.86, blue: 0.90 },
  today: { red: 1.0, green: 0.96, blue: 0.78 },
  working: { red: 1.0, green: 1.0, blue: 1.0 },
  handoff: { red: 0.82, green: 0.91, blue: 1.0 },
  delivered: { red: 0.82, green: 0.94, blue: 0.82 },
  cancelled: { red: 0.96, green: 0.82, blue: 0.82 },
  delayed: { red: 1.0, green: 0.88, blue: 0.70 },
  warning: { red: 1.0, green: 0.75, blue: 0.72 }
};

class SheetsSync {
  constructor() { this.ready = false; this.sheets = null; }

  async init() {
    if (!config.sheets.enabled) return false;
    if (!config.sheets.spreadsheetId || !fs.existsSync(config.sheets.credentialsPath)) {
      console.log('⚠️ Google Sheets غير مفعّل أو ملف الاعتماد غير موجود. بتشتغل قاعدة البيانات محلياً.');
      return false;
    }
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({ keyFile: config.sheets.credentialsPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    this.sheets = google.sheets({ version: 'v4', auth });
    this.ready = true;
    await this.ensureHeader();
    await this.formatSheet().catch(err => console.log('⚠️ تنسيق الشيت لم يكتمل:', err.message));
    console.log('✅ Google Sheets Sync: جاهز');
    return true;
  }

  async ensureHeader() {
    if (!this.ready) return;
    const range = `${config.sheets.sheetName}!A1:M1`;
    const res = await this.sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range }).catch(() => ({ data: { values: [] } }));
    const values = res.data.values || [];
    if (!values[0] || values[0].join('') === '' || values[0].length < HEADERS.length) {
      await this.sheets.spreadsheets.values.update({ spreadsheetId: config.sheets.spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values: [HEADERS] } });
    }
  }

  async sheetId() {
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId });
    const sheet = (meta.data.sheets || []).find(s => s.properties.title === config.sheets.sheetName);
    return sheet?.properties?.sheetId;
  }

  async sheetMeta() {
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: config.sheets.spreadsheetId, fields: 'sheets(properties(sheetId,title),conditionalFormats)' });
    return (meta.data.sheets || []).find(s => s.properties.title === config.sheets.sheetName);
  }

  conditionalRule(sheetId, formula, color) {
    return {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
            format: { backgroundColor: color }
          }
        },
        index: 0
      }
    };
  }

  async formatSheet() {
    if (!this.ready) return;
    const sheet = await this.sheetMeta();
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined) return;

    const deleteRules = [];
    const count = (sheet.conditionalFormats || []).length;
    for (let i = count - 1; i >= 0; i--) {
      deleteRules.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    }

    const widths = [90, 135, 155, 120, 170, 260, 75, 105, 115, 125, 110, 300, 150];
    const widthRequests = widths.map((pixelSize, i) => ({
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: 'pixelSize' }
    }));

    const requests = [
      ...deleteRules,
      { updateSheetProperties: { properties: { sheetId, rightToLeft: true, gridProperties: { frozenRowCount: 1 } }, fields: 'rightToLeft,gridProperties.frozenRowCount' } },
      // Clear old heavy fills in the visible working area, including extra empty columns.
      { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 20 }, cell: { userEnteredFormat: { backgroundColor: C.white, textFormat: { fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length }, cell: { userEnteredFormat: { backgroundColor: C.header, textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 1 }, properties: { pixelSize: 56 }, fields: 'pixelSize' } },
      ...widthRequests,
      { updateBorders: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: HEADERS.length }, top: { style: 'SOLID', width: 1, color: C.border }, bottom: { style: 'SOLID', width: 1, color: C.border }, left: { style: 'SOLID', width: 1, color: C.border }, right: { style: 'SOLID', width: 1, color: C.border }, innerHorizontal: { style: 'SOLID', width: 1, color: C.border }, innerVertical: { style: 'SOLID', width: 1, color: C.border } } },
      { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: HEADERS.length } } } },
      // Status/date conditional colors. Order matters: warnings and final states override today's yellow.
      this.conditionalRule(sheetId, '=AND($J2=TODAY(),NOT(REGEXMATCH($K2,"ملغي|تم للمشتري")))', C.today),
      this.conditionalRule(sheetId, '=REGEXMATCH($K2,"سُلّم|سلم|شركة")', C.handoff),
      this.conditionalRule(sheetId, '=REGEXMATCH($K2,"تم للمشتري|مشتري")', C.delivered),
      this.conditionalRule(sheetId, '=REGEXMATCH($K2,"ملغي|cancel")', C.cancelled),
      this.conditionalRule(sheetId, '=REGEXMATCH($K2,"مؤجل|موجل|delayed")', C.delayed),
      this.conditionalRule(sheetId, '=LEN($M2)>0', C.warning)
    ];

    await this.sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheets.spreadsheetId, requestBody: { requests } });
  }

  rowValues(input) {
    const o = repairOrder(input || {});
    return [
      o.orderId,
      displayDateTime(o.createdAt),
      o.name,
      o.phone,
      o.area,
      o.product,
      o.price,
      o.deliveryCompany,
      o.customerDeliveryDate,
      o.companyHandoffDate,
      statusLabel(o.status),
      o.notes,
      priceWarningText(o)
    ];
  }

  async findRow(orderId) {
    if (!this.ready) return null;
    const range = `${config.sheets.sheetName}!A:A`;
    const res = await this.sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range });
    const rows = res.data.values || [];
    const idx = rows.findIndex(r => r[0] === orderId);
    return idx >= 0 ? idx + 1 : null;
  }

  parseUpdatedRow(updatedRange = '') {
    const m = String(updatedRange).match(/![A-Z]+(\d+):/);
    return m ? Number(m[1]) : null;
  }

  async upsertOrder(order) {
    if (!this.ready) return false;
    await this.ensureHeader();
    const row = await this.findRow(order.orderId);
    const values = [this.rowValues(order)];
    let targetRow = row;
    if (row) {
      await this.sheets.spreadsheets.values.update({ spreadsheetId: config.sheets.spreadsheetId, range: `${config.sheets.sheetName}!A${row}:M${row}`, valueInputOption: 'USER_ENTERED', requestBody: { values } });
    } else {
      const res = await this.sheets.spreadsheets.values.append({ spreadsheetId: config.sheets.spreadsheetId, range: `${config.sheets.sheetName}!A:M`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values } });
      targetRow = this.parseUpdatedRow(res?.data?.updates?.updatedRange) || null;
    }
    if (targetRow) await this.styleOrderRow(targetRow, order).catch(() => null);
    return true;
  }

  async styleOrderRow(rowNumber, order = {}) {
    if (!this.ready || !rowNumber || rowNumber < 2) return;
    const sheetId = await this.sheetId();
    if (sheetId === undefined) return;
    const status = normalizeStatus(order.status);
    let bg = C.working;
    if (order.companyHandoffDate === toDateOnly(new Date()) && !['cancelled','customer_delivered'].includes(status)) bg = C.today;
    if (status === 'company_handoff') bg = C.handoff;
    if (status === 'customer_delivered') bg = C.delivered;
    if (status === 'cancelled') bg = C.cancelled;
    if (status === 'delayed') bg = C.delayed;
    if (order.priceWarning && order.priceWarningStatus !== 'acknowledged') bg = C.warning;

    await this.sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheets.spreadsheetId, requestBody: { requests: [
      { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: HEADERS.length }, cell: { userEnteredFormat: { backgroundColor: bg, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER', textFormat: { fontSize: 10 } } }, fields: 'userEnteredFormat(backgroundColor,wrapStrategy,verticalAlignment,horizontalAlignment,textFormat)' } },
      { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
      { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 11, endColumnIndex: 12 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } }
    ] } });
  }

  
async readOrders() {
  if (!this.ready) return [];
  await this.ensureHeader();
  const range = `${config.sheets.sheetName}!A2:M`;
  const res = await this.sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range,
  }).catch(() => ({ data: { values: [] } }));
  const rows = res.data.values || [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.join('').trim()) continue;
    out.push(repairOrder({
      orderId: val(row, 0),
      createdAt: val(row, 1),
      name: val(row, 2),
      phone: val(row, 3),
      area: val(row, 4),
      product: val(row, 5),
      price: val(row, 6),
      deliveryCompany: val(row, 7) || config.business.defaultDeliveryCompany,
      customerDeliveryDate: val(row, 8),
      companyHandoffDate: val(row, 9),
      status: normalizeStatus(val(row, 10)),
      notes: val(row, 11),
      priceWarning: val(row, 12),
      sheetRow: i + 2,
    }));
  }
  return out;
}

async softDeleteOrder(orderId, extraNote = '') {
  if (!this.ready) return false;
  await this.ensureHeader();
  const row = await this.findRow(orderId);
  if (!row) return false;
  const current = await this.sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.sheetName}!A${row}:M${row}`,
  }).catch(() => ({ data: { values: [[]] } }));
  const values = (current.data.values || [[]])[0] || [];
  const oldNotes = val(values, 11);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const note = [oldNotes, extraNote || `تم الحذف بواسطة المستخدم ${stamp}`].filter(Boolean).join(' | ');
  await this.sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${config.sheets.sheetName}!K${row}:L${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['محذوف', note]] },
  });
  return true;
}
 async importExistingOrders(db) {
    if (!this.ready || !db) return { imported: 0 };
    await this.ensureHeader();
    const range = `${config.sheets.sheetName}!A:M`;
    const res = await this.sheets.spreadsheets.values.get({ spreadsheetId: config.sheets.spreadsheetId, range }).catch(() => ({ data: { values: [] } }));
    const rows = res.data.values || [];
    if (rows.length <= 1) return { imported: 0 };
    const headers = rows[0] || HEADERS;
    const idx = {
      orderId: colIndex(headers, ['رقم الطلب','order'], 0),
      createdAt: colIndex(headers, ['تاريخ التسجيل','created'], 1),
      name: colIndex(headers, ['الاسم','name'], 2),
      phone: colIndex(headers, ['رقم التواصل','الهاتف','phone'], 3),
      area: colIndex(headers, ['المنطقة','area'], 4),
      product: colIndex(headers, ['الصنف','منتج','product'], 5),
      price: colIndex(headers, ['السعر','price'], 6),
      deliveryCompany: colIndex(headers, ['شركة التوصيل','delivery'], 7),
      customerDeliveryDate: colIndex(headers, ['موعد الزبون','موعد التوصيل','customer'], 8),
      companyHandoffDate: colIndex(headers, ['موعد تسليم الشركة','handoff'], 9),
      status: colIndex(headers, ['الحالة','status'], 10),
      notes: colIndex(headers, ['ملاحظات','notes'], 11),
      priceWarning: colIndex(headers, ['تنبيه السعر','تحذير السعر'], 12)
    };
    let imported = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.join('').trim()) continue;
      const rawOrder = {
        orderId: val(row, idx.orderId),
        createdAt: val(row, idx.createdAt) || new Date().toISOString(),
        name: val(row, idx.name),
        phone: val(row, idx.phone),
        area: val(row, idx.area),
        product: val(row, idx.product),
        price: val(row, idx.price),
        deliveryCompany: val(row, idx.deliveryCompany) || config.business.defaultDeliveryCompany,
        customerDeliveryDate: val(row, idx.customerDeliveryDate),
        companyHandoffDate: val(row, idx.companyHandoffDate),
        status: normalizeStatus(val(row, idx.status)),
        notes: val(row, idx.notes),
        priceWarning: val(row, idx.priceWarning),
        sheetRow: r + 1
      };
      const order = repairOrder(rawOrder);
      if (!order.phone && !order.product && !order.area) continue;
      // Do not import legacy rows that are obviously shifted/garbage; keep them in sheet but protect Donna DB/reports.
      if (!isReportableOrder(order) && (!order.phone || isBadHugePrice(order.price, order.product))) continue;
      db.upsertImportedOrder(order, { channel: 'sheets', row: r + 1 });
      imported++;
    }
    return { imported };
  }
}

module.exports = { SheetsSync, HEADERS, statusLabel };
