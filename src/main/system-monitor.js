'use strict';
/**
 * Decides when the wallpaper should be suspended to save resources:
 * fullscreen apps/games, battery power, locked screen, system sleep.
 */
const { powerMonitor } = require('electron');
const win32 = require('./win32');

class SystemMonitor {
  constructor({ getSettings, getOwnHandles, onChange, onCovered = () => {} }) {
    this.onCovered = onCovered;
    this.coveredKey = '';
    this.getSettings = getSettings;
    this.getOwnHandles = getOwnHandles;
    this.onChange = onChange;
    this.state = { fullscreen: false, battery: false, locked: false, sleeping: false, app: null };
    this.suspended = false;
    this.timer = null;
  }

  start() {
    try { this.state.battery = powerMonitor.isOnBatteryPower(); } catch { /* not supported */ }
    powerMonitor.on('on-battery', () => this.set('battery', true));
    powerMonitor.on('on-ac', () => this.set('battery', false));
    powerMonitor.on('lock-screen', () => this.set('locked', true));
    powerMonitor.on('unlock-screen', () => this.set('locked', false));
    powerMonitor.on('suspend', () => this.set('sleeping', true));
    powerMonitor.on('resume', () => this.set('sleeping', false));
    this.timer = setInterval(() => this.poll(), 1500);
    this.evaluate();
  }

  poll() {
    const s = this.getSettings();
    const own = this.getOwnHandles();
    // Our own screensaver is fullscreen too – never pause for it.
    const fs = s.pauseOnFullscreen && !(this.isScreensaver && this.isScreensaver()) ? win32.getFullscreenState(own).fullscreen : false;
    this.set('fullscreen', fs);
    // Pause rules: listed apps in the foreground.
    const rules = String(s.pauseApps || '').toLowerCase().split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)
      .map((x) => (x.endsWith('.exe') ? x : x + '.exe'));
    const fgApp = rules.length ? win32.getForegroundProcessName() : null;
    this.set('app', fgApp && rules.includes(fgApp) ? fgApp : null);
    // Monitors whose desktop is hidden by maximized windows: stop drawing there.
    const covered = s.pauseWhenCovered ? win32.getCoveredMonitors(own) : [];
    const key = covered.map((r) => `${r.x},${r.y}`).sort().join('|');
    if (key !== this.coveredKey) {
      this.coveredKey = key;
      this.onCovered(covered);
    }
  }

  set(key, value) {
    if (this.state[key] === value) return;
    this.state[key] = value;
    this.evaluate();
  }

  evaluate() {
    const s = this.getSettings();
    const st = this.state;
    const suspended = st.locked || st.sleeping || !!st.app || (s.pauseOnFullscreen && st.fullscreen) || (s.pauseOnBattery && st.battery);
    if (suspended !== this.suspended) {
      this.suspended = suspended;
      this.onChange(suspended, this.reason());
    }
  }

  reason() {
    const st = this.state;
    if (st.sleeping) return 'sleep';
    if (st.locked) return 'locked';
    if (st.fullscreen) return 'fullscreen';
    if (st.app) return 'app:' + st.app;
    if (st.battery) return 'battery';
    return null;
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = { SystemMonitor };
