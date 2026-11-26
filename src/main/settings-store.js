'use strict';
/**
 * Persistent settings + presets (JSON files in the user data folder).
 * Writes are debounced and atomic (tmp file + rename).
 */
const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, PRESET_KEYS, MODE_KEYS, BUILTIN_PRESETS, sanitize } = require('../shared/defaults');

class SettingsStore {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.presetsFile = path.join(dir, 'presets.json');
    fs.mkdirSync(dir, { recursive: true });
    const raw = this.readJson(this.settingsFile, {});
    // v2: default droplet size changed 50 → 20; move users still on the old default.
    if (raw && typeof raw === 'object' && !(raw.settingsVersion >= 2)) {
      if (raw.dropletSize === 50) raw.dropletSize = 20;
      raw.settingsVersion = 2;
    }
    // v3: new snow defaults; move users still on the old ones.
    if (raw && typeof raw === 'object' && raw.settingsVersion === 2) {
      const moved = { snowIntensity: [50, 34], snowMelt: [30, 56], snowFall: [60, 100], frost: [0, 28] };
      for (const [k, [from, to]] of Object.entries(moved)) if (raw[k] === from || raw[k] === undefined) raw[k] = to;
      raw.settingsVersion = 3;
    }
    this.settings = sanitize(raw);
    const presets = this.readJson(this.presetsFile, []);
    this.userPresets = Array.isArray(presets) ? presets.filter((p) => p && typeof p.name === 'string' && p.values) : [];
    this.saveTimer = null;
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  get() {
    return { ...this.settings };
  }

  /** Merge a partial update; returns { settings, changed: string[] }. */
  update(partial) {
    partial = this.switchMode(partial);
    const next = sanitize({ ...this.settings, ...partial });
    const same = (a, b) => a === b || (typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b));
    const changed = Object.keys(next).filter((k) => !same(next[k], this.settings[k]));
    this.settings = next;
    if (changed.length) this.scheduleSave();
    return { settings: this.get(), changed };
  }

  /**
   * Toggling rain ↔ snow on its own: remember the current look for the old
   * mode and bring back the one used last time in the new mode (rain falls
   * back to the default rain look), so snow settings don't leak into rain.
   */
  switchMode(partial) {
    const keys = Object.keys(partial || {});
    const to = partial && partial.precipitation;
    const from = this.settings.precipitation;
    if (keys.length !== 1 || !to || to === from) return partial;
    const looks = { ...(this.settings.modeLooks || {}) };
    looks[from] = Object.fromEntries(MODE_KEYS.map((k) => [k, this.settings[k]]));
    const saved = looks[to] || (to === 'rain' ? Object.fromEntries(MODE_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])) : {});
    return { ...saved, precipitation: to, modeLooks: looks };
  }

  reset() {
    // Keep the chosen image and system options; reset the look.
    const keep = ['backgroundPath', 'spanMonitors', 'useSystemWallpaper', 'galleryMatchLook', 'startWithWindows', 'wallpaperEnabled', 'pauseOnFullscreen', 'pauseOnBattery', 'pauseWhenCovered', 'mouseInteraction', 'weatherSync', 'weatherCity', 'weatherLat', 'weatherLon', 'autoDayNight', 'hotkeysEnabled', 'autoUpdate', 'language', 'screensaverEnabled', 'screensaverMinutes', 'screensaverClock', 'screensaverRain', 'screensaverSnow', 'scheduleEnabled', 'schedule', 'pauseApps', 'parallax', 'pixabayKey', 'taskbarStyle', 'taskbarLightIcons', 'taskbarSavedTheme', 'startTransparent', 'startSavedTransparency', 'onlinePhotoQuality', 'onlineVideoQuality', 'widgetClock', 'widgetMedia', 'widgetPosition', 'rgbEnabled', 'musicReactive', 'musicSensitivity', 'musicGlow', 'musicLightning'];
    const next = { ...DEFAULT_SETTINGS };
    for (const k of keep) next[k] = this.settings[k];
    return this.update(next);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      this.writeJson(this.settingsFile, this.settings);
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  presets() {
    return [...BUILTIN_PRESETS, ...this.userPresets.map((p) => ({ ...p, builtin: false }))];
  }

  savePreset(name, values, valuesOnly = false) {
    name = String(name || '').trim().slice(0, 48);
    if (!name) throw new Error('Preset name is required');
    if (BUILTIN_PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A built-in preset already uses this name');
    const src = sanitize({ ...(valuesOnly ? DEFAULT_SETTINGS : this.settings), ...(values || {}) });
    const picked = {};
    for (const k of PRESET_KEYS) picked[k] = src[k];
    const idx = this.userPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    const preset = { name, values: picked, created: Date.now() };
    if (idx >= 0) this.userPresets[idx] = preset;
    else this.userPresets.push(preset);
    this.writeJson(this.presetsFile, this.userPresets);
    return this.presets();
  }

  deletePreset(name) {
    this.userPresets = this.userPresets.filter((p) => p.name !== name);
    this.writeJson(this.presetsFile, this.userPresets);
    return this.presets();
  }

  /** Apply a preset's values over the current settings (image is never changed). */
  applyPreset(name) {
    const p = this.presets().find((x) => x.name === name);
    if (!p) throw new Error('Preset not found');
    const values = {};
    for (const k of PRESET_KEYS) values[k] = k in p.values ? p.values[k] : DEFAULT_SETTINGS[k];
    return this.update(values);
  }
}

module.exports = { SettingsStore };
