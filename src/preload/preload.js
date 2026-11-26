'use strict';
/**
 * Safe bridge between renderers and the main process (contextIsolation + sandbox).
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('rainApi', {
  // State
  getState: () => ipcRenderer.invoke('state:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: on('settings:changed'),

  // Background image
  selectImage: () => ipcRenderer.invoke('image:select'),
  setImagePath: (p) => ipcRenderer.invoke('image:set', p),
  removeImage: () => ipcRenderer.invoke('image:remove'),
  readImage: (displayId) => ipcRenderer.invoke('image:read', displayId),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },

  // Presets
  savePreset: (name) => ipcRenderer.invoke('preset:save', name),
  deletePreset: (name) => ipcRenderer.invoke('preset:delete', name),
  applyPreset: (name) => ipcRenderer.invoke('preset:apply', name),

  // Playback
  setPaused: (p) => ipcRenderer.invoke('rain:pause', p),
  resetRain: () => ipcRenderer.invoke('rain:reset'),
  onPause: on('wallpaper:pause'),
  onSuspend: on('wallpaper:suspend'),
  onHidden: on('wallpaper:hidden'),
  onReset: on('wallpaper:reset'),
  onLightning: on('wallpaper:lightning'),
  lightning: (distance) => ipcRenderer.send('wallpaper:lightning', distance),
  onStatus: on('status:changed'),

  // Misc
  openLog: () => ipcRenderer.invoke('log:open'),
  exportWallpaperEngine: () => ipcRenderer.invoke('export:we'),
  reportFps: (fps) => ipcRenderer.send('wallpaper:fps', fps),
  reportError: (msg) => ipcRenderer.send('wallpaper:error', String(msg)),
});
