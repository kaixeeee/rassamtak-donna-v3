const path = require('path');
try { require('dotenv').config(); } catch (_) {}

function bool(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function num(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}
function str(name, def = '') {
  return process.env[name] ?? def;
}

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(rootDir, str('DATA_DIR', './data'));

module.exports = {
  rootDir,
  dataDir,
  timezone: str('TIMEZONE', 'Asia/Amman'),
  port: num('PORT', 3000),

  ai: {
    enabled: bool('DONNA_AI_ENABLED', true),
    apiKey: str('GEMINI_API_KEY', ''),
    model: str('GEMINI_MODEL', 'gemini-2.5-flash'),
    strictJson: bool('DONNA_AI_STRICT_JSON', true),
    timeoutMs: num('DONNA_AI_TIMEOUT_MS', 45000)
  },

  whatsapp: {
    enabled: bool('WHATSAPP_ENABLED', true),
    groupName: str('WHATSAPP_GROUP_NAME', 'مبيعات رسمتك'),
    sessionId: str('WHATSAPP_SESSION_ID', 'rassamtak-donna-v3'),
    wakeword: str('WAKEWORD', 'بوت'),
    headless: bool('WHATSAPP_HEADLESS', true),
    protocolTimeoutMs: num('WA_PROTOCOL_TIMEOUT_MS', 300000),
    navigationTimeoutMs: num('WA_NAVIGATION_TIMEOUT_MS', 300000),
    authTimeoutMs: num('WA_AUTH_TIMEOUT_MS', 180000),
    autoRecoverEnabled: bool('WA_AUTO_RECOVER_ENABLED', true),
    startupWatchdogMs: num('WA_STARTUP_WATCHDOG_MS', 300000),
    stuckRecoverAfterMs: num('WA_STUCK_RECOVER_AFTER_MS', 360000),
    recoveryMaxAttempts: num('WA_RECOVERY_MAX_ATTEMPTS', 5),
    recoveryClearCache: bool('WA_RECOVERY_CLEAR_CACHE', true),
    adminNumbers: str('ADMIN_WHATSAPP_NUMBERS', '').split(',').map(x => x.trim()).filter(Boolean),
    botNumber: str('BOT_WHATSAPP_NUMBER', ''),
    seedReactions: bool('WA_SEED_REACTION_OPTIONS', false),
    reactionDelayMs: num('WA_REACTION_DELAY_MS', 250)
  },

  business: {
    defaultDeliveryCompany: str('DEFAULT_DELIVERY_COMPANY', 'نت'),
    handoffDaysBefore: num('DELIVERY_COMPANY_HANDOFF_DAYS_BEFORE', 1)
  },

  sheets: {
    enabled: bool('GOOGLE_SHEETS_ENABLED', true),
    spreadsheetId: str('GOOGLE_SHEET_ID', ''),
    sheetName: str('GOOGLE_SHEET_NAME', 'طلبات رسمتك'),
    credentialsPath: path.resolve(rootDir, str('GOOGLE_CREDENTIALS_PATH', './google-credentials.json')),
    syncOnWrite: bool('SHEETS_SYNC_ON_WRITE', true)
  },

  reminders: {
    enabled: bool('REMINDERS_ENABLED', true),
    hour: num('REMINDER_HOUR', 9),
    minute: num('REMINDER_MINUTE', 0),
    followupHour: num('FOLLOWUP_REMINDER_HOUR', 21),
    followupMinute: num('FOLLOWUP_REMINDER_MINUTE', 0),
    mentionAll: bool('REMINDER_MENTION_ALL', true),
    checkIntervalMs: num('REMINDER_CHECK_INTERVAL_MS', 60000)
  },

  discord: {
    enabled: bool('DISCORD_ENABLED', false),
    token: str('DISCORD_TOKEN', ''),
    alertsChannel: str('DISCORD_ALERTS_CHANNEL', ''),
    ownerId: str('DISCORD_OWNER_ID', ''),
    dmAlertsEnabled: bool('DM_ALERTS_ENABLED', true),
    cooldownMinutes: num('DISCORD_ALERT_COOLDOWN_MINUTES', 15)
  }
};
