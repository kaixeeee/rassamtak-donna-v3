const config = require('../config');

class DiscordAlerts {
  constructor() {
    this.client = null;
    this.lastAlerts = new Map();
  }

  async init() {
    if (!config.discord.enabled || !config.discord.token) {
      console.log('ℹ️ Discord Alerts: غير مفعّل');
      return false;
    }
    const { Client, GatewayIntentBits } = require('discord.js');
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await this.client.login(config.discord.token);
    console.log(`✅ Discord Alerts: ${this.client.user.tag}`);
    return true;
  }

  shouldSend(key) {
    const now = Date.now();
    const cooldownMs = Math.max(0, config.discord.cooldownMinutes || 0) * 60 * 1000;
    const last = this.lastAlerts.get(key) || 0;
    if (cooldownMs && now - last < cooldownMs) return false;
    this.lastAlerts.set(key, now);
    return true;
  }

  async sendChannel(text) {
    if (!this.client || !config.discord.alertsChannel) return false;
    const ch = await this.client.channels.fetch(config.discord.alertsChannel).catch(() => null);
    if (!ch) return false;
    await ch.send(text);
    return true;
  }

  async sendDM(text) {
    if (!this.client || !config.discord.dmAlertsEnabled || !config.discord.ownerId) return false;
    const user = await this.client.users.fetch(config.discord.ownerId).catch(() => null);
    if (!user) return false;
    await user.send(text);
    return true;
  }

  async alert(text, { key = 'general', force = false } = {}) {
    if (!this.client) return false;
    if (!force && !this.shouldSend(key)) return false;
    const msg = `🚨 Donna Alert\n${text}`;
    await Promise.allSettled([
      this.sendChannel(msg),
      this.sendDM(msg)
    ]);
    return true;
  }

  async send(text) {
    return this.alert(text, { key: 'manual', force: true });
  }
}

module.exports = { DiscordAlerts };
