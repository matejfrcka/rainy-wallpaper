'use strict';
/**
 * Rainy Glass Wallpaper Engine – main process.
 * Owns settings, the tray, the settings window and the per-monitor wallpaper windows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showSettings());
  app.whenReady().then(init);
}

let store, wallpapers, monitor, tray, settingsWin, logFile;
const status = { suspended: false, reason: null, paused: false, fps: 0, error: null };

/** Diagnostic log: %APPDATA%\\Rainy Glass Wallpaper Engine\\rainy-glass.log */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  console.log(line.trimEnd());
}

function fullStatus() {
  return { ...status, paused: wallpapers.paused, displays: wallpapers.displays(), enabled: wallpapers.enabled, attach: wallpapers.attach };
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
  });

  // A missing image (moved / deleted) falls back to the neutral background.
  const s = store.get();
  if (s.backgroundPath) {
    try { images.validate(s.backgroundPath); } catch { store.update({ backgroundPath: null }); }
  }

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
  const { settings, changed } = store.update(partial);
  if (!changed.length) return settings;
  wallpapers.broadcast('settings:changed', settings, changed);
  if (!origin || origin !== (settingsWin && settingsWin.webContents)) sendToSettings('settings:changed', settings, changed);
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
    settings: store.get(),
    presets: store.presets(),
    status: fullStatus(),
    version: app.getVersion(),
    platform: process.platform,
    formats: images.EXTENSIONS,
  }));

  ipcMain.handle('settings:set', (e, partial) => applySettings(partial || {}, e.sender));
  ipcMain.handle('settings:reset', () => {
    const { settings, changed } = store.reset();
    wallpapers.broadcast('settings:changed', settings, changed);
    return settings;
  });

  ipcMain.handle('image:select', () => selectImage());
  ipcMain.handle('image:set', (_e, file) => {
    images.validate(file);
    return applySettings({ backgroundPath: file });
  });
  ipcMain.handle('image:remove', () => applySettings({ backgroundPath: null }));
  ipcMain.handle('image:read', () => {
    const p = store.get().backgroundPath;
    if (!p) return null;
    const { data, mime, name } = images.readImage(p);
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mime, name, path: p };
  });

  ipcMain.handle('preset:save', (_e, name) => store.savePreset(name));
  ipcMain.handle('preset:delete', (_e, name) => store.deletePreset(name));
  ipcMain.handle('preset:apply', (_e, name) => {
    const { settings, changed } = store.applyPreset(name);
    wallpapers.broadcast('settings:changed', settings, changed);
    return settings;
  });

  ipcMain.handle('rain:pause', (_e, p) => setPaused(p));
  ipcMain.handle('rain:reset', () => wallpapers.broadcast('wallpaper:reset'));

  ipcMain.on('wallpaper:lightning', (e, distance) => wallpapers.relayLightning(e.sender.id, Number(distance) || 0.5));
  ipcMain.on('wallpaper:fps', (_e, fps) => {
    status.fps = Number(fps) || 0;
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
    buildWallpaperEngineProject(out, s, s.backgroundPath);
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
