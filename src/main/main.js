'use strict';
/**
 * Rainy Glass Wallpaper Engine – main process.
 * Owns settings, the tray, the settings window and the per-monitor wallpaper windows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen, protocol } = require('electron');
const { SettingsStore } = require('./settings-store');
const { WallpaperManager } = require('./wallpaper-manager');
const { SystemMonitor } = require('./system-monitor');
const images = require('./image-manager');
const { buildWallpaperEngineProject } = require('./we-export');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const startHidden = process.argv.includes('--hidden');

// Rain sound must play without a click on the desktop.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('com.rainyglass.wallpaper');

// rainmedia:// streams the current background video (Range requests, CORS for WebGL).
protocol.registerSchemesAsPrivileged([
  { scheme: 'rainmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showSettings());
  app.whenReady().then(init);
}

let store, wallpapers, monitor, tray, settingsWin, logFile;
let currentImage = { key: 'none', source: null, path: null, name: null };
const status = { suspended: false, reason: null, paused: false, fps: 0, error: null };

/** Diagnostic log: %APPDATA%\\Rainy Glass Wallpaper Engine\\rainy-glass.log */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  console.log(line.trimEnd());
}

/* ------------------------------------------------------- background image */

/**
 * Custom image/video wins (same on every monitor); otherwise the current
 * Windows wallpaper – per monitor when Windows reports one for each.
 * Returns { key, source, path (primary), name, displays: { [displayId]: path } }.
 */
function resolveImage() {
  const s = store.get();
  const all = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const stamp = (p) => { try { const st = fs.statSync(p); return `${st.mtimeMs}|${st.size}`; } catch { return '0'; } };
  if (s.backgroundPath) {
    const displays = Object.fromEntries(all.map((d) => [d.id, s.backgroundPath]));
    return { key: `custom|${s.backgroundPath}|${stamp(s.backgroundPath)}`, source: 'custom', path: s.backgroundPath, name: path.basename(s.backgroundPath), displays };
  }
  if (s.useSystemWallpaper) {
    const win32 = require('./win32');
    const fallback = images.findSystemWallpaper(win32.getSystemWallpaperPath());
    const perMonitor = win32.getMonitorWallpapers() || [];
    const displays = {};
    for (const d of all) {
      const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
      const m = perMonitor.find((x) => Math.abs(x.rect.x - r.x) < 2 && Math.abs(x.rect.y - r.y) < 2);
      const own = m && m.path ? images.findSystemWallpaper(m.path) : null;
      const pick = own || fallback;
      if (pick) displays[d.id] = pick.path;
    }
    const primary = displays[primaryId] || (fallback && fallback.path);
    if (primary) {
      const key = 'windows|' + all.map((d) => `${d.id}:${displays[d.id]}:${stamp(displays[d.id])}`).join(',');
      return { key, source: 'windows', path: primary, name: 'Windows wallpaper', displays };
    }
  }
  return { key: 'none', source: null, path: null, name: null, displays: {} };
}

function imagePathFor(displayId) {
  return (displayId && currentImage.displays[displayId]) || currentImage.path;
}

/** Settings as sent to renderers: plus which image is effectively shown. */
function withImage(settings) {
  return { ...settings, imageKey: currentImage.key, imageSource: currentImage.source };
}

/** Re-resolve the image; broadcast when it changed (e.g. Windows wallpaper slideshow). */
function refreshImage(force = false) {
  const next = resolveImage();
  if (!force && next.key === currentImage.key) return false;
  currentImage = next;
  log(`background: ${next.source || 'gradient'} ${next.path || ''}`);
  const s = withImage(store.get());
  wallpapers.broadcast('settings:changed', s, ['imageKey']);
  sendToSettings('settings:changed', s, ['imageKey']);
  return true;
}

function fullStatus() {
  return { ...status, paused: wallpapers.paused, displays: wallpapers.displays(), enabled: wallpapers.enabled, attach: wallpapers.attach, metrics };
}

/* ------------------------------------------------------------ performance */

const metrics = { cpu: 0, memMB: 0, gpu: '', fpsAvg: 0 };
let fpsSamples = [];

/** CPU / memory of all app processes every 5 s, written to the log every minute. */
function startMetrics() {
  app.getGPUInfo('complete').then((info) => {
    const dev = (info.gpuDevice || []).find((d) => d.active) || (info.gpuDevice || [])[0] || {};
    metrics.gpu = (info.auxAttributes && info.auxAttributes.glRenderer) || `${dev.vendorString || dev.vendorId || ''} ${dev.deviceString || dev.deviceId || ''}`.trim();
    log(`gpu: ${metrics.gpu}`);
  }).catch(() => {});
  let tick = 0;
  setInterval(() => {
    const list = app.getAppMetrics();
    metrics.cpu = Math.round(list.reduce((s, m) => s + (m.cpu ? m.cpu.percentCPUUsage : 0), 0) * 10) / 10;
    metrics.memMB = Math.round(list.reduce((s, m) => s + (m.memory ? m.memory.workingSetSize : 0), 0) / 1024);
    metrics.fpsAvg = fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : 0;
    if (++tick % 12 === 0) {
      log(`perf: fps=${metrics.fpsAvg} cpu=${metrics.cpu}% mem=${metrics.memMB}MB suspended=${status.suspended} covered=${[...wallpapers.covered].length}`);
      fpsSamples = [];
    }
    sendToSettings('status:changed', fullStatus());
  }, 5000);
}

function init() {
  store = new SettingsStore(app.getPath('userData'));
  logFile = path.join(app.getPath('userData'), 'rainy-glass.log');
  try { fs.writeFileSync(logFile, ''); } catch { /* ignore */ }
  log(`start v${app.getVersion()} ${process.platform} ${os.release()} electron ${process.versions.electron}`);
  log(`win32 integration: ${require('./win32').isAvailable() ? 'ok' : 'unavailable'}`);
  wallpapers = new WallpaperManager({ preload: PRELOAD, log, onStatus: () => pushStatus() });
  monitor = new SystemMonitor({
    getSettings: () => store.get(),
    getOwnHandles: () => wallpapers.ownHandles(),
    onChange: (suspended, reason) => {
      status.suspended = suspended;
      status.reason = reason;
      wallpapers.setSuspended(suspended);
      pushStatus();
    },
    onCovered: (rects) => { wallpapers.setCovered(rects); pushStatus(); },
  });
  startMetrics();

  // A missing image (moved / deleted) falls back to the neutral background.
  const s = store.get();
  if (s.backgroundPath) {
    try { images.validate(s.backgroundPath); } catch { store.update({ backgroundPath: null }); }
  }

  protocol.handle('rainmedia', (request) => {
    try {
      const id = new URL(request.url).pathname.replace(/^\//, '');
      const file = imagePathFor(id === 'primary' ? null : Number(id));
      if (!file) return new Response(null, { status: 404 });
      return images.streamResponse(file, request);
    } catch (e) {
      return new Response(null, { status: 500 });
    }
  });

  currentImage = resolveImage();
  screen.on('display-added', () => refreshImage());
  screen.on('display-removed', () => refreshImage());
  log(`background: ${currentImage.source || 'gradient'} ${currentImage.path || ''}`);
  setInterval(() => refreshImage(), 10000);

  registerIpc();
  createTray();
  applyLoginItem(store.get().startWithWindows);
  if (store.get().wallpaperEnabled) wallpapers.enable();
  monitor.start();
  if (!startHidden) showSettings();
}

/* ------------------------------------------------------------------ windows */

function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e1014',
    title: 'Rainy Glass Wallpaper Engine',
    icon: path.join(ASSETS, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#0e1014', symbolColor: '#c9d4e3', height: 44 } : false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function sendToSettings(channel, ...args) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, ...args);
}

function pushStatus() {
  status.paused = wallpapers.paused;
  sendToSettings('status:changed', fullStatus());
  updateTrayMenu();
}

/* --------------------------------------------------------------------- tray */

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, process.platform === 'win32' ? 'tray.png' : 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Rainy Glass Wallpaper Engine');
  tray.on('click', showSettings);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const s = store.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Settings', click: showSettings },
    { type: 'separator' },
    { label: 'Live wallpaper', type: 'checkbox', checked: s.wallpaperEnabled, click: (i) => applySettings({ wallpaperEnabled: i.checked }) },
    { label: wallpapers.paused ? 'Resume rain' : 'Pause rain', click: () => setPaused(!wallpapers.paused) },
    { label: 'Change background…', click: () => selectImage() },
    { label: 'Rain sound', type: 'checkbox', checked: s.soundEnabled, click: (i) => applySettings({ soundEnabled: i.checked }) },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: s.startWithWindows, click: (i) => applySettings({ startWithWindows: i.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

/* ----------------------------------------------------------------- settings */

function applyLoginItem(enabled) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
  } catch (e) {
    console.warn('Login item failed', e);
  }
}

/** Central place where settings change: persist, broadcast, react to system keys. */
function applySettings(partial, origin) {
  const { settings: raw, changed } = store.update(partial);
  const prevKey = currentImage.key;
  if (changed.includes('backgroundPath') || changed.includes('useSystemWallpaper')) currentImage = resolveImage();
  const settings = withImage(raw);
  if (!changed.length) return settings;
  wallpapers.broadcast('settings:changed', settings, changed);
  // The settings window needs the echo when the effective image changed.
  if (!origin || origin !== (settingsWin && settingsWin.webContents) || prevKey !== currentImage.key) sendToSettings('settings:changed', settings, changed);
  if (changed.includes('startWithWindows')) applyLoginItem(settings.startWithWindows);
  if (changed.includes('wallpaperEnabled')) {
    if (settings.wallpaperEnabled) wallpapers.enable();
    else wallpapers.disable();
    setTimeout(pushStatus, 300);
  }
  if (changed.some((k) => k === 'pauseOnFullscreen' || k === 'pauseOnBattery')) monitor.evaluate();
  if (changed.some((k) => ['soundEnabled', 'wallpaperEnabled', 'startWithWindows'].includes(k))) updateTrayMenu();
  return settings;
}

function setPaused(p) {
  wallpapers.setPaused(!!p);
  sendToSettings('wallpaper:pause', !!p);
  pushStatus();
}

async function selectImage() {
  try {
    const file = await images.pickImage(settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined);
    if (!file) return null;
    return applySettings({ backgroundPath: file });
  } catch (e) {
    dialog.showErrorBox('Unable to use this image', e.message);
    return null;
  }
}

/* ---------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    settings: withImage(store.get()),
    presets: store.presets(),
    status: fullStatus(),
    version: app.getVersion(),
    platform: process.platform,
    formats: images.EXTENSIONS,
  }));

  ipcMain.handle('settings:set', (e, partial) => applySettings(partial || {}, e.sender));
  ipcMain.handle('settings:reset', () => {
    const { changed } = store.reset();
    currentImage = resolveImage();
    const settings = withImage(store.get());
    wallpapers.broadcast('settings:changed', settings, changed);
    return settings;
  });

  ipcMain.handle('image:select', () => selectImage());
  ipcMain.handle('image:set', (_e, file) => {
    images.validate(file);
    return applySettings({ backgroundPath: file });
  });
  ipcMain.handle('image:remove', () => applySettings({ backgroundPath: null }));
  ipcMain.handle('image:read', (_e, displayId) => {
    const img = currentImage;
    const file = imagePathFor(displayId);
    if (!file) return null;
    const meta = { name: img.name, path: file, source: img.source, key: img.key };
    if (images.isVideo(file)) {
      // Videos are streamed through rainmedia:// instead of copied over IPC.
      return { ...meta, kind: 'video', mime: images.mimeOf(file), url: `rainmedia://media/${displayId || 'primary'}?k=${encodeURIComponent(img.key)}` };
    }
    const { data, mime } = images.readImage(file, img.source === 'windows');
    return { ...meta, kind: 'image', mime, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  });

  ipcMain.handle('preset:save', (_e, name) => store.savePreset(name));
  ipcMain.handle('preset:delete', (_e, name) => store.deletePreset(name));
  ipcMain.handle('preset:apply', (_e, name) => {
    const { changed } = store.applyPreset(name);
    const settings = withImage(store.get());
    wallpapers.broadcast('settings:changed', settings, changed);
    return settings;
  });

  ipcMain.handle('rain:pause', (_e, p) => setPaused(p));
  ipcMain.handle('rain:reset', () => wallpapers.broadcast('wallpaper:reset'));

  ipcMain.on('wallpaper:lightning', (e, distance) => wallpapers.relayLightning(e.sender.id, Number(distance) || 0.5));
  ipcMain.on('wallpaper:fps', (_e, fps) => {
    status.fps = Number(fps) || 0;
    if (status.fps) fpsSamples.push(status.fps);
    sendToSettings('status:changed', fullStatus());
  });
  ipcMain.on('wallpaper:error', (_e, msg) => {
    status.error = msg;
    log('[wallpaper] ' + msg);
    pushStatus();
  });

  ipcMain.handle('log:open', () => shell.showItemInFolder(logFile));

  ipcMain.handle('export:we', async () => {
    const res = await dialog.showOpenDialog(settingsWin, {
      title: 'Choose a folder for the Wallpaper Engine project',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const out = path.join(res.filePaths[0], 'RainyGlass');
    const s = store.get();
    const bundle = currentImage.source && currentImage.path && !images.isVideo(currentImage.path) ? currentImage.path : null;
    buildWallpaperEngineProject(out, s, bundle);
    shell.openPath(out);
    return out;
  });
}

/* ---------------------------------------------------------------- lifecycle */

app.on('window-all-closed', () => {
  // Keep running in the tray (wallpaper windows don't count as user windows).
});

app.on('before-quit', () => {
  if (monitor) monitor.stop();
  if (store) store.flush();
  if (wallpapers) wallpapers.shutdown();
});
