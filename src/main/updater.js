'use strict';
/**
 * Automatic updates from GitHub Releases (electron-updater).
 * Only active in the installed (NSIS) build – not in development, the
 * portable exe or the Microsoft Store build (the Store updates by itself).
 */
const { app, dialog, Notification } = require('electron');

let autoUpdater = null;
let log = () => {};
let getSettings = () => ({});
let onState = () => {};
const state = { status: 'idle', version: null, error: null };

function supported() {
  if (!app.isPackaged || process.platform !== 'win32' || process.windowsStore || process.env.PORTABLE_EXECUTABLE_DIR) return false;
  // Only the NSIS installer ships app-update.yml (ZIP / unpacked builds don't).
  return require('fs').existsSync(require('path').join(process.resourcesPath, 'app-update.yml'));
}

function init(opts) {
  ({ log, getSettings, onState } = { ...{ log, getSettings, onState }, ...opts });
  if (!supported()) { state.status = 'unsupported'; return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log('updater unavailable: ' + e.message);
    state.status = 'unsupported';
    return;
  }
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => log('update: ' + m), warn: (m) => log('update warn: ' + m), error: (m) => log('update error: ' + m), debug: () => {} };
  const set = (status, extra = {}) => { Object.assign(state, { status, error: null }, extra); onState({ ...state }); };
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-available', (i) => set('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => set('latest'));
  autoUpdater.on('download-progress', (p) => set('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('error', (e) => set('error', { error: e.message }));
  autoUpdater.on('update-downloaded', (i) => {
    set('ready', { version: i.version });
    if (Notification.isSupported()) {
      new Notification({ title: 'Rainy Glass', body: `Update ${i.version} is ready – it will be installed when you quit the app.` }).show();
    }
  });
  setTimeout(() => check(false), 30 * 1000);
  setInterval(() => check(false), 6 * 60 * 60 * 1000);
}

async function check(manual) {
  if (!autoUpdater) {
    if (manual) dialog.showMessageBox({ type: 'info', message: 'Automatic updates are available in the installed version (Setup.exe). The Store version updates through Microsoft Store.' });
    return;
  }
  if (!manual && !getSettings().autoUpdate) return;
  autoUpdater.autoDownload = manual || !!getSettings().autoUpdate;
  try {
    const r = await autoUpdater.checkForUpdates();
    if (manual && (!r || !r.updateInfo || r.updateInfo.version === app.getVersion())) {
      dialog.showMessageBox({ type: 'info', message: `You have the latest version (${app.getVersion()}).` });
    }
  } catch (e) {
    if (manual) dialog.showMessageBox({ type: 'warning', message: 'Update check failed: ' + e.message });
  }
}

function quitAndInstall() {
  if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall();
}

module.exports = { init, check, quitAndInstall, state };
