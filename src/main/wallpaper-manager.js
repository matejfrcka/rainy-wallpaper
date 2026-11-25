'use strict';
/**
 * Creates one borderless wallpaper window per monitor and embeds it behind
 * the desktop icons. Rebuilds automatically when monitors change or when
 * Explorer restarts (which destroys the WorkerW and our child windows).
 */
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const win32 = require('./win32');

const isWin = process.platform === 'win32';

class WallpaperManager {
  constructor({ preload, log = () => {}, onStatus = () => {} }) {
    this.preload = preload;
    this.log = log;
    this.onStatus = onStatus;
    this.attach = { mode: null, error: null, failures: 0 };
    this.windows = new Map();      // displayId -> BrowserWindow
    this.enabled = false;
    this.suspended = false;
    this.paused = false;
    this.rebuildTimer = null;
    this.closing = false;

    const schedule = () => this.scheduleRebuild();
    screen.on('display-added', schedule);
    screen.on('display-removed', schedule);
    screen.on('display-metrics-changed', schedule);
  }

  physicalRect(display) {
    return isWin ? screen.dipToScreenRect(null, display.bounds) : display.bounds;
  }

  enable() {
    this.enabled = true;
    this.build();
  }

  disable() {
    this.enabled = false;
    this.destroyAll();
  }

  scheduleRebuild(delay = 800) {
    if (!this.enabled) return;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => { this.destroyAll(); this.build(); }, delay);
  }

  build() {
    if (!this.enabled || this.closing) return;
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const rects = displays.map((d) => this.physicalRect(d));
    const origin = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };

    displays.forEach((display, i) => {
      if (this.windows.has(display.id)) return;
      const isPrimary = display.id === primary.id;
      const win = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        backgroundColor: '#000000',
        type: isWin ? undefined : 'desktop',
        title: 'Rainy Glass Wallpaper',
        webPreferences: {
          preload: this.preload,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          spellcheck: false,
        },
      });
      win.setMenu(null);
      win.__displayId = display.id;
      win.__intentionalClose = false;

      win.loadFile(path.join(__dirname, '..', 'renderer', 'wallpaper', 'index.html'), {
        query: { display: String(display.id), primary: isPrimary ? '1' : '0' },
      });

      win.once('ready-to-show', async () => {
        if (!isWin) { win.showInactive(); this.sendState(win); return; }
        const handle = win.getNativeWindowHandle();
        const host = await win32.attachToDesktop(handle, rects[i], origin, this.log);
        if (win.isDestroyed()) return;
        if (!host) {
          // Never show a window that would cover the desktop icons.
          this.attach.failures++;
          this.attach.mode = 'failed';
          this.attach.error = 'Could not place the wallpaper behind the desktop icons.';
          this.log(`display ${display.id}: attach failed (#${this.attach.failures})`);
          win.__intentionalClose = true;
          win.destroy();
          this.windows.delete(display.id);
          if (this.attach.failures <= 3) this.scheduleRebuild(3000);
          this.onStatus();
          return;
        }
        this.attach.mode = host.mode;
        this.attach.error = null;
        this.attach.failures = 0;
        win.showInactive();
        win32.restack(host);
        setTimeout(() => !win.isDestroyed() && win32.restack(host), 1000);
        win.__host = host;
        this.log(`display ${display.id}: attached (${host.mode}) ${rects[i].width}x${rects[i].height}`);
        this.sendState(win);
        this.onStatus();
      });

      // Explorer restart destroys our parent → our window dies: rebuild.
      win.on('closed', () => {
        this.windows.delete(display.id);
        if (!win.__intentionalClose && this.enabled && !this.closing) this.scheduleRebuild(2000);
      });
      win.webContents.on('render-process-gone', () => this.scheduleRebuild(1500));

      this.windows.set(display.id, win);
    });
  }

  destroyAll() {
    for (const win of this.windows.values()) {
      win.__intentionalClose = true;
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
  }

  sendState(win) {
    if (win.isDestroyed()) return;
    win.webContents.send('wallpaper:suspend', this.suspended);
    win.webContents.send('wallpaper:pause', this.paused);
  }

  broadcast(channel, ...args) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    }
  }

  setSuspended(s) {
    if (this.suspended === s) return;
    this.suspended = s;
    this.broadcast('wallpaper:suspend', s);
  }

  setPaused(p) {
    this.paused = p;
    this.broadcast('wallpaper:pause', p);
  }

  /** Relay a lightning strike from the primary monitor to the others (synchronised flash). */
  relayLightning(senderId, distance) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed() && win.webContents.id !== senderId) win.webContents.send('wallpaper:lightning', distance);
    }
  }

  ownHandles() {
    const set = new Set();
    for (const win of this.windows.values()) if (!win.isDestroyed()) set.add(win32.handleToNumber(win.getNativeWindowHandle()));
    return set;
  }

  displays() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d) => {
      const r = this.physicalRect(d);
      return { id: d.id, primary: d.id === primary.id, width: r.width, height: r.height, scaleFactor: d.scaleFactor, refreshRate: d.displayFrequency || 60, active: this.windows.has(d.id) };
    });
  }

  shutdown() {
    this.closing = true;
    clearTimeout(this.rebuildTimer);
    this.destroyAll();
    if (isWin) win32.refreshDesktop();
  }
}

module.exports = { WallpaperManager };
