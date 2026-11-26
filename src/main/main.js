'use strict';
/**
 * Rainy Glass Wallpaper Engine – main process.
 * Owns settings, the tray, the settings window and the per-monitor wallpaper windows.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen, protocol, globalShortcut, session, desktopCapturer } = require('electron');
const { SettingsStore } = require('./settings-store');
const { WallpaperManager } = require('./wallpaper-manager');
const { SystemMonitor } = require('./system-monitor');
const images = require('./image-manager');
const { buildWallpaperEngineProject } = require('./we-export');
const weather = require('./weather');
const i18n = require('../shared/i18n');
const updater = require('./updater');
const { Screensaver } = require('./screensaver');
const gallery = require('./gallery-manager');
const online = require('./online');
const { NowPlaying } = require('./now-playing');
const { ChromaRGB } = require('./rgb');
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

let store, wallpapers, monitor, tray, settingsWin, logFile, screensaver, nowPlaying, rgb;
let mediaInfo = null;
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
  const g = gallery.parse(s.backgroundPath);
  if (g) {
    const file = gallery.resolve(s.backgroundPath);
    const scene = gallery.list().find((x) => x.id === g.id);
    const displays = Object.fromEntries(all.map((d) => [d.id, file]));
    return { key: `custom|${s.backgroundPath}|${file}|${stamp(file)}`, source: 'custom', gallery: g.id, path: file, name: scene.name, displays };
  }
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

/**
 * "Span across monitors": the same image is stretched over the bounding box of
 * all monitors and every monitor shows its own part. Only for one shared image.
 */
function spanFor(displayId) {
  const s = store.get();
  const all = screen.getAllDisplays();
  if (!s.spanMonitors || all.length < 2 || currentImage.source !== 'custom') return null;
  const minX = Math.min(...all.map((d) => d.bounds.x)), minY = Math.min(...all.map((d) => d.bounds.y));
  const maxX = Math.max(...all.map((d) => d.bounds.x + d.bounds.width)), maxY = Math.max(...all.map((d) => d.bounds.y + d.bounds.height));
  const W = maxX - minX, H = maxY - minY;
  const d = all.find((x) => x.id === displayId);
  if (!d) return null;
  return { x: (d.bounds.x - minX) / W, y: (d.bounds.y - minY) / H, w: d.bounds.width / W, h: d.bounds.height / H, aspect: W / H };
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
  wallpapers.updateSpan();
  return true;
}

function fullStatus() {
  return { ...status, paused: wallpapers.paused, displays: wallpapers.displays(), enabled: wallpapers.enabled, attach: wallpapers.attach, metrics, weather: weatherState, update: { ...updater.state }, sleep: sleep ? { endsAt: sleep.endsAt, minutes: sleep.minutes, action: sleep.action } : null };
}

/* ----------------------------------------------------------- sleep timer */

let sleep = null; // { endsAt, minutes, action, timers[] }

/** Run a Windows command (shutdown / sleep); no-op elsewhere. */
function winCommand(file, args) {
  if (process.platform !== 'win32') { log(`(skipped on ${process.platform}) ${file} ${args.join(' ')}`); return; }
  require('child_process').execFile(file, args, { windowsHide: true }, (err) => { if (err) log(`${file} failed: ${err.message}`); });
}

/**
 * Sleep timer. action: 'sound' – fade out and turn off the rain sound,
 * 'shutdown' – shut the PC down (Windows shows its own 60 s warning),
 * 'sleep' – put the PC to sleep. The sound always fades out first.
 */
function setSleepTimer(minutes, action = 'sound') {
  const pendingShutdown = sleep && sleep.shutdownScheduled;
  if (sleep) sleep.timers.forEach(clearTimeout);
  if (pendingShutdown) winCommand('shutdown', ['/a']); // cancel a shutdown that is already counting down
  sleep = null;
  minutes = Number(minutes) || 0;
  if (!['sound', 'shutdown', 'sleep'].includes(action)) action = 'sound';
  if (minutes > 0) {
    const ms = minutes * 60 * 1000;
    const endsAt = Date.now() + ms;
    const st = sleep = { endsAt, minutes, action, timers: [], shutdownScheduled: false };
    if (action === 'shutdown') {
      // Hand over to Windows one minute early so the user gets the system warning and can still cancel.
      st.timers.push(setTimeout(() => {
        st.shutdownScheduled = true;
        winCommand('shutdown', ['/s', '/t', '60', '/c', 'Rainy Glass: sleep timer – the PC will shut down in 1 minute.']);
        log('sleep timer: shutdown scheduled');
      }, Math.max(0, ms - 60000)));
    }
    st.timers.push(setTimeout(() => {
      log(`sleep timer: ${action}`);
      sleep = null;
      applySettings({ soundEnabled: false });
      wallpapers.broadcast('audio:sleep', null);
      if (action === 'sleep') winCommand('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
      pushStatus();
      updateTrayMenu();
    }, ms));
    if (!store.get().soundEnabled && action === 'sound') applySettings({ soundEnabled: true });
    log(`sleep timer: ${minutes} min, action=${action}`);
  }
  wallpapers.broadcast('audio:sleep', sleep ? sleep.endsAt : null);
  pushStatus();
  updateTrayMenu();
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
      if (gallery.parse(active.image)) setGallery(active.image, false).catch((e) => log('schedule gallery: ' + e.message));
      else {
        images.validate(active.image);
        applySettings({ backgroundPath: active.image });
      }
    }
  } catch (e) {
    log('schedule error: ' + e.message);
  }
}

function startScheduler() {
  runSchedule(true);
  setInterval(() => runSchedule(), 30 * 1000);
}

/* --------------------------------------------------------------- gallery */

/** Use a gallery scene; downloads its animated loop first when needed. */
async function setGallery(ref, matchLook = store.get().galleryMatchLook) {
  const g = gallery.parse(ref);
  if (!g) throw new Error('Unknown gallery scene');
  if (g.video) {
    await gallery.downloadVideo(g.id, (p) => sendToSettings('gallery:progress', { id: g.id, progress: p }));
    sendToSettings('gallery:progress', { id: g.id, progress: 1 });
  }
  const scene = gallery.list().find((x) => x.id === g.id);
  if (matchLook && scene.preset) applyPresetByName(scene.preset);
  return applySettings({ backgroundPath: ref });
}

/* --------------------------------------------------------------- taskbar */

let taskbarTimer = null;
let taskbarActive = false;
const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

function regQueryLightTheme() {
  try {
    const out = require('child_process').execFileSync('reg', ['query', PERSONALIZE, '/v', 'SystemUsesLightTheme'], { windowsHide: true, encoding: 'utf8' });
    const m = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    return m ? parseInt(m[1], 16) : 0;
  } catch { return -1; }
}

function regSetLightTheme(value) {
  if (process.platform !== 'win32') return;
  try {
    require('child_process').execFileSync('reg', ['add', PERSONALIZE, '/v', 'SystemUsesLightTheme', '/t', 'REG_DWORD', '/d', String(value), '/f'], { windowsHide: true });
  } catch (e) { log('taskbar: could not change system theme: ' + e.message); }
}

/**
 * See-through taskbar so the rain continues underneath. 'default' leaves the
 * taskbar completely to Windows. With light icons on, Windows' system theme is
 * switched to dark while the effect is active (white clock and icons) and the
 * user's original value is restored afterwards – also after a crash, because
 * it is remembered in the settings.
 */
function startTaskbar() {
  clearInterval(taskbarTimer);
  taskbarTimer = null;
  const s = store.get();
  const wantLight = s.taskbarStyle !== 'default' && s.taskbarLightIcons;
  if (process.platform === 'win32') {
    if (wantLight && s.taskbarSavedTheme < 0) {
      const cur = regQueryLightTheme();
      if (cur >= 0) {
        store.update({ taskbarSavedTheme: cur });
        if (cur !== 0) regSetLightTheme(0);
      }
    } else if (!wantLight && s.taskbarSavedTheme >= 0) {
      regSetLightTheme(s.taskbarSavedTheme);
      store.update({ taskbarSavedTheme: -1 });
    }
  }
  if (s.taskbarStyle === 'default') {
    if (taskbarActive) win32.restoreTaskbar();
    taskbarActive = false;
    log('taskbar: Windows default');
    return;
  }
  taskbarActive = true;
  if (wantLight) win32.restoreTaskbar(); // let Explorer pick up the dark theme first
  const n = win32.setTaskbarStyle(s.taskbarStyle);
  log(`taskbar: ${s.taskbarStyle}${wantLight ? ' + light icons' : ''} (${n} taskbar${n === 1 ? '' : 's'})`);
  taskbarTimer = setInterval(() => win32.setTaskbarStyle(store.get().taskbarStyle), 400);
}

function stopTaskbar() {
  clearInterval(taskbarTimer);
  const s = store && store.get();
  if (!s) return;
  if (s.taskbarSavedTheme >= 0) { regSetLightTheme(s.taskbarSavedTheme); store.update({ taskbarSavedTheme: -1 }); store.flush(); }
  if (taskbarActive) win32.restoreTaskbar();
}

/* ------------------------------------------- music, widget, RGB lighting */

function startExtras() {
  // System audio for "react to music": loopback capture (Windows) without any picker.
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
        .catch(() => cb({}));
    });
  }
  nowPlaying = new NowPlaying({
    log,
    onChange: (info) => { mediaInfo = info; wallpapers.broadcast('widget:media', info); },
  });
  rgb = new ChromaRGB({ log });
  syncExtras();
}

function syncExtras() {
  const s = store.get();
  if (s.widgetMedia && s.wallpaperEnabled) nowPlaying.start(); else nowPlaying.stop();
  if (s.rgbEnabled) rgb.start(); else rgb.stop();
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

/** Forward the cursor (and desktop clicks for the widget buttons) to the wallpaper under it (30 Hz, only over the desktop). */
function startPointer() {
  let last = '';
  let wasDown = false;
  setInterval(() => {
    const s = store.get();
    const clicks = s.widgetMedia && !!mediaInfo;
    if (!(s.mouseInteraction || s.parallax > 0 || clicks) || !wallpapers.enabled || status.suspended || !wallpapers.windows.size) { wasDown = false; return; }
    const isWin = process.platform === 'win32';
    const down = isWin && clicks ? win32.isLeftMouseDown() : false;
    const pressed = down && !wasDown;
    wasDown = down;
    const phys = isWin ? win32.getDesktopCursor(wallpapers.ownHandles()) : screen.getCursorScreenPoint();
    if (!phys) return;
    const key = phys.x + ',' + phys.y;
    if (key === last && !pressed) return;
    last = key;
    for (const d of screen.getAllDisplays()) {
      const r = wallpapers.physicalRect(d);
      if (phys.x < r.x || phys.y < r.y || phys.x >= r.x + r.width || phys.y >= r.y + r.height) continue;
      const win = wallpapers.windows.get(d.id);
      if (win && !win.isDestroyed()) {
        const x = (phys.x - r.x) * (d.bounds.width / r.width), y = (phys.y - r.y) * (d.bounds.height / r.height);
        win.webContents.send('wallpaper:pointer', x, y);
        if (pressed) win.webContents.send('wallpaper:click', x, y);
      }
      break;
    }
  }, 33);
}

/** Play/pause, next or previous track in whatever player Windows' media controls point at. */
let lastMediaCmd = { cmd: '', at: 0 };
function mediaCommand(cmd) {
  if (!['playpause', 'next', 'prev'].includes(cmd)) return;
  const now = Date.now();
  if (lastMediaCmd.cmd === cmd && now - lastMediaCmd.at < 400) return; // DOM click + desktop click for the same press
  lastMediaCmd = { cmd, at: now };
  if (process.platform !== 'win32') { log('media: ' + cmd + ' (Windows only)'); return; }
  win32.sendMediaKey(cmd);
  if (cmd === 'playpause' && mediaInfo) { // instant feedback; the next media poll confirms it
    mediaInfo = { ...mediaInfo, playing: !mediaInfo.playing };
    wallpapers.broadcast('widget:media', mediaInfo);
  }
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
  setInterval(updateWeather, 10 * 60 * 1000);
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
  wallpapers = new WallpaperManager({ preload: PRELOAD, log, onStatus: () => pushStatus(), getSpan: spanFor });
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
  startTaskbar();
  startExtras();
  startMetrics();
  registerHotkeys();
  updater.init({ log, getSettings: () => store.get(), onState: () => { pushStatus(); updateTrayMenu(); } });
  startPointer();
  startWeather();
  startDayNight();

  // A missing image (moved / deleted) falls back to the neutral background.
  const s = store.get();
  if (s.backgroundPath && !gallery.parse(s.backgroundPath)) {
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
    { label: t('Sleep timer'), submenu: [
      ...[0, 15, 30, 60, 90].map((m) => ({
        label: m ? `${t('Sound off')} · ${m} min` : t('Off'), type: 'radio',
        checked: m ? !!sleep && sleep.action === 'sound' && sleep.minutes === m : !sleep, click: () => setSleepTimer(m, 'sound'),
      })),
      { type: 'separator' },
      ...[30, 60, 90, 120].map((m) => ({
        label: `${t('Shut down PC')} · ${m} min`, type: 'radio',
        checked: !!sleep && sleep.action === 'shutdown' && sleep.minutes === m, click: () => setSleepTimer(m, 'shutdown'),
      })),
    ] },
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
  if (changed.includes('taskbarStyle') || changed.includes('taskbarLightIcons')) startTaskbar();
  if (changed.some((k) => ['widgetMedia', 'rgbEnabled', 'wallpaperEnabled'].includes(k))) syncExtras();
  if (changed.includes('spanMonitors') || changed.includes('backgroundPath') || changed.includes('useSystemWallpaper')) wallpapers.updateSpan();
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
    const meta = { name: img.name, path: file, source: img.source, key: img.key, gallery: img.gallery || null, credit: online.creditFor(file) };
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

  ipcMain.on('wallpaper:lightning', (e, distance) => {
    const d = Number(distance);
    wallpapers.relayLightning(e.sender.id, Number.isFinite(d) ? d : 0.5);
    if (rgb) rgb.flash(1 - (Number.isFinite(d) ? d : 0.5));
  });
  ipcMain.on('music:level', (e, level) => wallpapers.relayMusic(e.sender.id, Number(level) || 0));
  ipcMain.handle('widget:media', () => mediaInfo);
  ipcMain.on('media:command', (_e, cmd) => mediaCommand(String(cmd)));
  ipcMain.on('wallpaper:fps', (_e, fps) => {
    status.fps = Number(fps) || 0;
    if (status.fps) fpsSamples.push(status.fps);
    sendToSettings('status:changed', fullStatus());
  });
  ipcMain.on('wallpaper:error', (_e, msg) => {
    if (/^Music:/.test(msg)) { log('[wallpaper] ' + msg); return; } // optional feature, not a wallpaper failure
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
  ipcMain.handle('sleep:set', (_e, minutes, action) => setSleepTimer(minutes, action));
  ipcMain.on('screensaver:exit', () => screensaver.stop());
  ipcMain.handle('screensaver:test', () => { if (settingsWin) settingsWin.minimize(); setTimeout(() => screensaver.show(), 400); });
  ipcMain.handle('schedule:pick-image', async () => {
    try { return await images.pickImage(settingsWin); } catch (e) { dialog.showErrorBox('Unable to use this image', e.message); return null; }
  });

  ipcMain.handle('online:status', () => ({ hasKey: !!online.apiKey(store.get()) }));
  ipcMain.handle('online:search', (_e, q) => online.search(store.get(), q || {}));
  ipcMain.handle('online:history', () => online.history());
  ipcMain.handle('online:use', async (_e, item) => {
    const s = store.get();
    const quality = item && item.type === 'video' ? s.onlineVideoQuality : s.onlinePhotoQuality;
    const file = await online.download(item, (p) => sendToSettings('online:progress', { id: item.id, progress: p }), quality);
    return applySettings({ backgroundPath: file });
  });
  ipcMain.handle('online:open', (_e, url) => {
    if (/^https:\/\/pixabay\.com\//.test(String(url))) shell.openExternal(url);
  });

  ipcMain.handle('gallery:list', () => gallery.list());
  ipcMain.handle('gallery:set', (_e, ref) => setGallery(ref));

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
  stopTaskbar();
  if (nowPlaying) nowPlaying.stop();
  if (rgb) rgb.stop();
  if (monitor) monitor.stop();
  if (store) store.flush();
  if (wallpapers) wallpapers.shutdown();
});
