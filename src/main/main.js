'use strict';
/**
 * Rainy Glass Wallpaper Engine – main process.
 * Owns settings, the tray, the settings window and the per-monitor wallpaper windows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen, protocol, globalShortcut } = require('electron');
const { SettingsStore } = require('./settings-store');
const { WallpaperManager } = require('./wallpaper-manager');
const { SystemMonitor } = require('./system-monitor');
const images = require('./image-manager');
const { buildWallpaperEngineProject } = require('./we-export');
const weather = require('./weather');
const i18n = require('../shared/i18n');
const updater = require('./updater');
const { Screensaver } = require('./screensaver');
const t = (x) => i18n.t(x);
const win32 = require('./win32');

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const isStore = !!process.windowsStore;
// Store build: the MSIX startup task can't pass --hidden, so a launch right after login starts in the tray.
const startHidden = process.argv.includes('--hidden') || (isStore && os.uptime() < 240);

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

let store, wallpapers, monitor, tray, settingsWin, logFile, screensaver;
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
  return { ...status, paused: wallpapers.paused, displays: wallpapers.displays(), enabled: wallpapers.enabled, attach: wallpapers.attach, metrics, weather: weatherState, update: { ...updater.state }, sleep: sleep ? { endsAt: sleep.endsAt, minutes: sleep.minutes } : null };
}

/* ----------------------------------------------------------- sleep timer */

let sleep = null; // { endsAt, timer }

function setSleepTimer(minutes) {
  if (sleep) clearTimeout(sleep.timer);
  sleep = null;
  minutes = Number(minutes) || 0;
  if (minutes > 0) {
    const endsAt = Date.now() + minutes * 60 * 1000;
    sleep = {
      endsAt, minutes,
      timer: setTimeout(() => {
        log('sleep timer: sound off');
        sleep = null;
        applySettings({ soundEnabled: false });
        wallpapers.broadcast('audio:sleep', null);
        pushStatus();
      }, minutes * 60 * 1000),
    };
    if (!store.get().soundEnabled) applySettings({ soundEnabled: true });
    log(`sleep timer: ${minutes} min`);
  }
  wallpapers.broadcast('audio:sleep', sleep ? sleep.endsAt : null);
  pushStatus();
}

/* ------------------------------------------------------------- scheduler */

let scheduleKey = null;

/** Apply a preset by name (shared by IPC, tray and the scheduler). */
function applyPresetByName(name) {
  const { changed } = store.applyPreset(name);
  const settings = withImage(store.get());
  wallpapers.broadcast('settings:changed', settings, changed);
  sendToSettings('settings:changed', settings, changed);
  return settings;
}

/** Time-of-day schedule: the entry whose time passed most recently is active. */
function runSchedule(force = false) {
  const s = store.get();
  if (!s.scheduleEnabled || !s.schedule.length) { scheduleKey = null; return; }
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const sorted = [...s.schedule].sort((a, b) => toMin(a.time) - toMin(b.time));
  const active = [...sorted].reverse().find((e) => toMin(e.time) <= mins) || sorted[sorted.length - 1];
  const key = JSON.stringify(active);
  if (!force && key === scheduleKey) return;
  scheduleKey = key;
  log(`schedule: ${active.time} preset="${active.preset}" image="${active.image}"`);
  try {
    if (active.preset) applyPresetByName(active.preset);
    if (active.image) {
      images.validate(active.image);
      applySettings({ backgroundPath: active.image });
    }
  } catch (e) {
    log('schedule error: ' + e.message);
  }
}

function startScheduler() {
  runSchedule(true);
  setInterval(() => runSchedule(), 30 * 1000);
}

/* --------------------------------------------------------------- hotkeys */

function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!store.get().hotkeysEnabled) return;
  const keys = {
    'CommandOrControl+Alt+R': () => setPaused(!wallpapers.paused),
    'CommandOrControl+Alt+W': () => applySettings({ wallpaperEnabled: !store.get().wallpaperEnabled }),
    'CommandOrControl+Alt+S': () => showSettings(),
  };
  for (const [accel, fn] of Object.entries(keys)) {
    try {
      if (!globalShortcut.register(accel, fn)) log(`hotkey ${accel} is used by another app`);
    } catch (e) { log(`hotkey ${accel}: ${e.message}`); }
  }
}

/* --------------------------------------------------- desktop interaction */

/** Forward the cursor to the wallpaper under it (30 Hz, only over the desktop). */
function startPointer() {
  let last = '';
  setInterval(() => {
    const s = store.get();
    if (!(s.mouseInteraction || s.parallax > 0) || !wallpapers.enabled || status.suspended || !wallpapers.windows.size) return;
    let phys;
    if (process.platform === 'win32') phys = win32.getDesktopCursor(wallpapers.ownHandles());
    else phys = screen.getCursorScreenPoint();
    if (!phys) return;
    const key = phys.x + ',' + phys.y;
    if (key === last) return;
    last = key;
    for (const d of screen.getAllDisplays()) {
      const r = wallpapers.physicalRect(d);
      if (phys.x < r.x || phys.y < r.y || phys.x >= r.x + r.width || phys.y >= r.y + r.height) continue;
      const win = wallpapers.windows.get(d.id);
      if (win && !win.isDestroyed()) {
        win.webContents.send('wallpaper:pointer', (phys.x - r.x) * (d.bounds.width / r.width), (phys.y - r.y) * (d.bounds.height / r.height));
      }
      break;
    }
  }, 33);
}

/* ----------------------------------------------------- weather & daylight */

let weatherState = null;

async function updateWeather() {
  const s = store.get();
  if (!s.weatherSync || !s.weatherCity) return;
  try {
    const w = await weather.current(s.weatherLat, s.weatherLon);
    weatherState = { ...w, city: s.weatherCity };
    const patch = weather.toSettings(w);
    log(`weather: ${w.text} ${w.temp}°C ${w.precip}mm → rain ${patch.rainIntensity}%`);
    applySettings(patch);
  } catch (e) {
    weatherState = { error: e.message, city: s.weatherCity, time: Date.now() };
    log('weather error: ' + e.message);
  }
  pushStatus();
}

function startWeather() {
  updateWeather();
  setInterval(updateWeather, 15 * 60 * 1000);
}

function updateDayNight() {
  const s = store.get();
  if (!s.autoDayNight) return;
  const loc = s.weatherCity ? { lat: s.weatherLat, lon: s.weatherLon } : weather.guessLocation();
  const value = weather.dayNightFor(weather.sunElevation(new Date(), loc.lat, loc.lon));
  if (Math.abs(value - s.dayNight) >= 1) applySettings({ dayNight: value });
}

function startDayNight() {
  updateDayNight();
  setInterval(updateDayNight, 60 * 1000);
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
  i18n.setLanguage(i18n.resolve(store.get().language, app.getLocale()));
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
  screensaver = new Screensaver({ preload: PRELOAD, getSettings: () => store.get(), log });
  screensaver.start();
  monitor.isScreensaver = () => screensaver.active;
  startScheduler();
  startMetrics();
  registerHotkeys();
  updater.init({ log, getSettings: () => store.get(), onState: () => { pushStatus(); updateTrayMenu(); } });
  startPointer();
  startWeather();
  startDayNight();

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
    { label: t('Open Settings'), click: showSettings },
    { type: 'separator' },
    { label: t('Live wallpaper'), type: 'checkbox', checked: s.wallpaperEnabled, click: (i) => applySettings({ wallpaperEnabled: i.checked }) },
    { label: wallpapers.paused ? t('Resume rain') : t('Pause rain'), click: () => setPaused(!wallpapers.paused) },
    { label: t('Change background…'), click: () => selectImage() },
    { label: t('Rain sound'), type: 'checkbox', checked: s.soundEnabled, click: (i) => applySettings({ soundEnabled: i.checked }) },
    { label: t('Sleep timer'), submenu: [0, 15, 30, 60, 90].map((m) => ({
      label: m ? `${m} min` : t('Off'), type: 'radio', checked: m ? !!sleep && sleep.minutes === m : !sleep, click: () => { setSleepTimer(m); updateTrayMenu(); },
    })) },
    { type: 'separator' },
    { label: t('Start with Windows'), type: 'checkbox', checked: s.startWithWindows, click: (i) => applySettings({ startWithWindows: i.checked }) },
    updater.state.status === 'ready'
      ? { label: `${t('Restart to update')} (${updater.state.version})`, click: () => updater.quitAndInstall() }
      : { label: t('Check for updates'), click: () => updater.check(true) },
    { type: 'separator' },
    { label: t('Quit'), click: () => app.quit() },
  ]));
}

/* ----------------------------------------------------------------- settings */

function applyLoginItem(enabled) {
  if (isStore) return; // MSIX: controlled by the startup task (Task Manager → Startup apps)
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
  if (screensaver) screensaver.broadcast('settings:changed', settings, changed);
  // The settings window needs the echo when the effective image changed.
  if (!origin || origin !== (settingsWin && settingsWin.webContents) || prevKey !== currentImage.key) sendToSettings('settings:changed', settings, changed);
  if (changed.includes('startWithWindows')) applyLoginItem(settings.startWithWindows);
  if (changed.includes('wallpaperEnabled')) {
    if (settings.wallpaperEnabled) wallpapers.enable();
    else wallpapers.disable();
    setTimeout(pushStatus, 300);
  }
  if (changed.some((k) => k === 'pauseOnFullscreen' || k === 'pauseOnBattery')) monitor.evaluate();
  if (changed.includes('weatherSync') && settings.weatherSync) updateWeather();
  if (changed.includes('language')) {
    i18n.setLanguage(i18n.resolve(settings.language, app.getLocale()));
    updateTrayMenu();
    if (settingsWin && !settingsWin.isDestroyed()) setTimeout(() => settingsWin.reload(), 150);
  }
  if (changed.includes('hotkeysEnabled')) registerHotkeys();
  if (changed.includes('schedule') || changed.includes('scheduleEnabled')) runSchedule(true);
  if (changed.includes('autoDayNight') && settings.autoDayNight) updateDayNight();
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
    lang: i18n.language,
    store: isStore,
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
    screensaver.broadcast('settings:changed', settings, changed);
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

  ipcMain.handle('weather:search', async (_e, city) => {
    const loc = await weather.geocode(String(city || '').slice(0, 80));
    const wasOn = store.get().weatherSync;
    applySettings({ weatherCity: loc.name, weatherLat: loc.lat, weatherLon: loc.lon, weatherSync: true });
    if (wasOn) await updateWeather(); // otherwise turning sync on already triggered an update
    return withImage(store.get());
  });

  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:install', () => updater.quitAndInstall());

  ipcMain.handle('preset:export', async (_e, name) => {
    const p = store.presets().find((x) => x.name === name);
    if (!p) throw new Error('Preset not found');
    const res = await dialog.showSaveDialog(settingsWin, { title: 'Export preset', defaultPath: `${p.name}.rainyglass.json`, filters: [{ name: 'Rainy Glass preset', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, JSON.stringify({ format: 'rainy-glass-preset', version: 1, name: p.name, values: p.values }, null, 2));
    return res.filePath;
  });
  ipcMain.handle('preset:import', async () => {
    const res = await dialog.showOpenDialog(settingsWin, { title: 'Import preset', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Rainy Glass preset', extensions: ['json'] }] });
    if (res.canceled) return null;
    let presets = store.presets();
    for (const file of res.filePaths) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || data.format !== 'rainy-glass-preset' || typeof data.values !== 'object') throw new Error(path.basename(file) + ' is not a Rainy Glass preset');
      let name = String(data.name || path.basename(file, '.json')).slice(0, 40);
      if (presets.some((x) => x.builtin && x.name.toLowerCase() === name.toLowerCase())) name += ' (imported)';
      presets = store.savePreset(name, data.values, true);
    }
    return presets;
  });

  ipcMain.handle('sleep:get', () => (sleep ? sleep.endsAt : null));
  ipcMain.handle('sleep:set', (_e, minutes) => setSleepTimer(minutes));
  ipcMain.on('screensaver:exit', () => screensaver.stop());
  ipcMain.handle('screensaver:test', () => { if (settingsWin) settingsWin.minimize(); setTimeout(() => screensaver.show(), 400); });
  ipcMain.handle('schedule:pick-image', async () => {
    try { return await images.pickImage(settingsWin); } catch (e) { dialog.showErrorBox('Unable to use this image', e.message); return null; }
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

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('before-quit', () => {
  if (monitor) monitor.stop();
  if (store) store.flush();
  if (wallpapers) wallpapers.shutdown();
});
