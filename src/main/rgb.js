'use strict';
/**
 * Razer Chroma (Synapse's local REST API): keyboard, mouse, headset … glow in a
 * calm rain blue and flash white with every lightning strike.
 * Needs Razer Synapse with Chroma Connect running; silently does nothing otherwise.
 */
const { net } = require('electron');

const BASE = 'http://localhost:54235/razer/chromasdk';
const DEVICES = ['keyboard', 'mouse', 'headset', 'mousepad', 'keypad', 'chromalink'];
const bgr = (r, g, b) => (b << 16) | (g << 8) | r;
const IDLE = bgr(20, 55, 140);
const FLASH = bgr(235, 240, 255);

class ChromaRGB {
  constructor({ log }) {
    this.log = log;
    this.uri = null;
    this.timer = null;
  }

  async req(method, url, body) {
    const res = await net.fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.ok ? res.json().catch(() => ({})) : null;
  }

  async start() {
    if (this.uri) return;
    try {
      const r = await this.req('POST', BASE, {
        title: 'Rainy Glass', description: 'Rain on glass wallpaper lighting',
        author: { name: 'Rainy Glass', contact: 'https://github.com/matejfrcka/rainy-wallpaper' },
        device_supported: DEVICES, category: 'application',
      });
      if (!r || !r.uri) throw new Error('no session');
      this.uri = r.uri;
      await new Promise((res) => setTimeout(res, 800)); // the SDK needs a moment after init
      this.timer = setInterval(() => this.req('PUT', this.uri + '/heartbeat').catch(() => {}), 10000);
      await this.color(IDLE);
      this.log('rgb: Razer Chroma connected');
    } catch (e) {
      this.uri = null;
      this.log('rgb: Razer Chroma not available (' + e.message + ')');
    }
  }

  async color(c) {
    if (!this.uri) return;
    await Promise.all(DEVICES.map((d) => this.req('PUT', `${this.uri}/${d}`, { effect: 'CHROMA_STATIC', param: { color: c } }).catch(() => null)));
  }

  /** Lightning: quick white flash (stronger = closer), then back to rain blue. */
  async flash(strength = 1) {
    if (!this.uri) return;
    await this.color(FLASH);
    setTimeout(() => this.color(IDLE), 90 + strength * 120);
    if (strength > 0.6) setTimeout(() => this.color(FLASH), 260);
    if (strength > 0.6) setTimeout(() => this.color(IDLE), 360);
  }

  async stop() {
    clearInterval(this.timer);
    if (this.uri) await this.req('DELETE', this.uri).catch(() => {});
    this.uri = null;
  }
}

module.exports = { ChromaRGB };
