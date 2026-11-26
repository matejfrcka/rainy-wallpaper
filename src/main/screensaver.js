'use strict';
/**
 * Rain / snow screensaver: after N idle minutes, opens a topmost full-screen rain
 * window on every monitor (with an optional clock). Any input closes it.
 * Not started while a fullscreen app, video or presentation is running.
 */
const path = require('path');
const { BrowserWindow, powerMonitor, screen } = require('electron');
const win32 = require('./win32');

class Screensaver {
  constructor({ preload, getSettings, log }) {
    this.preload = preload;
    this.getSettings = getSettings;
    this.log = log;
    this.windows = [];
    this.lastIdle = 0;
    this.startedAt = 0;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 3000);
  }

  get active() { return this.windows.length > 0; }

  tick() {
    const s = this.getSettings();
    const idle = powerMonitor.getSystemIdleTime(); // seconds
    if (this.active) {
      // Input anywhere (also on other apps) resets the idle counter → close.
      if (idle < this.lastIdle && Date.now() - this.startedAt > 2000) this.stop();
      this.lastIdle = idle;
      return;
    }
    this.lastIdle = idle;
    if (!s.screensaverEnabled || idle < s.screensaverMinutes * 60) return;
    if (powerMonitor.getSystemIdleState(1) === 'locked') return;
    if (win32.getFullscreenState().fullscreen) return;
    this.show();
  }

  show() {
    if (this.active) return;
    this.startedAt = Date.now();
    const s = this.getSettings();
    const kinds = [s.screensaverRain && 'rain', s.screensaverSnow && 'snow'].filter(Boolean);
    if (kinds.length > 1) this.turn = (this.turn || 0) + 1; // both ticked: take turns
    const weather = kinds.length ? kinds[(this.turn || 0) % kinds.length] : '';
    const primary = screen.getPrimaryDisplay().id;
    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...d.bounds,
        frame: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        fullscreenable: true,
        backgroundColor: '#000000',
        title: 'Rainy Glass Screensaver',
        webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
      });
      win.setMenu(null);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.loadFile(path.join(__dirname, '..', 'renderer', 'screensaver', 'index.html'), {
        query: { display: String(d.id), primary: d.id === primary ? '1' : '0', weather },
      });
      win.once('ready-to-show', () => {
        win.setBounds(d.bounds);
        win.setFullScreen(true);
        win.show();
        win.focus();
      });
      win.on('closed', () => { this.windows = this.windows.filter((w) => w !== win); });
      this.windows.push(win);
    }
    this.log('screensaver: started' + (weather ? ` (${weather})` : ''));
  }

  stop() {
    if (!this.active) return;
    for (const w of this.windows) if (!w.isDestroyed()) w.destroy();
    this.windows = [];
    this.log('screensaver: stopped');
  }

  broadcast(channel, ...args) {
    for (const w of this.windows) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }

  handles() {
    return this.windows.filter((w) => !w.isDestroyed()).map((w) => win32.handleToNumber(w.getNativeWindowHandle()));
  }
}

module.exports = { Screensaver };
