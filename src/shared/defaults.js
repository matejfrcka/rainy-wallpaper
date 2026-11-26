/**
 * Shared settings schema, defaults and built-in presets.
 * UMD: usable from the Electron main process (require) and from
 * renderers / Wallpaper Engine (global `RainGlassDefaults`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RainGlassDefaults = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    // Background layer
    backgroundPath: null,      // absolute path of the user's image (null = Windows wallpaper / gradient)
    useSystemWallpaper: true,  // no custom image → use the current Windows desktop wallpaper
    fitMode: 'fill',           // 'fill' | 'fit' | 'stretch'
    bgBrightness: 100,         // 0..200 %
    bgBlur: 0,                 // 0..100
    bgPosX: 50,                // 0..100 (focal point when cropping)
    bgPosY: 50,
    bgZoom: 100,               // 100..200 %

    // Rain
    rainIntensity: 55,         // 0..100
    dropletDensity: 60,
    dropletSize: 50,
    dropletSpeed: 50,
    trailLength: 50,
    merging: true,
    randomGeneration: true,

    // Glass
    refraction: 60,
    distortion: 25,
    chromatic: 30,
    glassTransparency: 85,
    reflection: 45,
    condensationEnabled: true,
    condensation: 35,
    blur: 50,                  // blur of glass behind / inside large drops
    streaksEnabled: true,
    streaks: 35,

    // Atmosphere
    soundEnabled: false,
    volume: 50,
    thunderEnabled: false,
    lightning: true,
    dayNight: 50,              // 0 = deep night, 50 = neutral, 100 = warm day
    autoDayNight: false,       // follow the sun (location from weather or time zone)
    soundscape: 'window',      // 'window' | 'roof' | 'leaves' | 'car'
    windEnabled: false,
    windVolume: 40,

    // Interaction & weather
    mouseInteraction: true,    // cursor over the desktop wipes condensation
    weatherSync: false,        // drive rain/thunder from the real weather
    weatherCity: '',
    weatherLat: 0,
    weatherLon: 0,

    // Performance / system
    fpsLimit: 60,              // 30 | 60 | 144(0 = vsync)
    renderScale: 100,          // 50..100 % of physical resolution
    pauseOnFullscreen: true,
    pauseWhenCovered: true,    // stop drawing on monitors hidden behind maximized windows
    pauseOnBattery: false,
    startWithWindows: false,
    wallpaperEnabled: true,
    hotkeysEnabled: true,      // Ctrl+Alt+R pause, Ctrl+Alt+W wallpaper on/off
    autoUpdate: true,
    language: 'auto',          // 'auto' | 'en' | 'sk'
  });

  // Numeric ranges used for clamping / validation and by the UI.
  const RANGES = {
    bgBrightness: [0, 200], bgBlur: [0, 100], bgPosX: [0, 100], bgPosY: [0, 100], bgZoom: [100, 200],
    rainIntensity: [0, 100], dropletDensity: [0, 100], dropletSize: [0, 100], dropletSpeed: [0, 100],
    trailLength: [0, 100], refraction: [0, 100], distortion: [0, 100], chromatic: [0, 100],
    glassTransparency: [0, 100], reflection: [0, 100], condensation: [0, 100], blur: [0, 100],
    streaks: [0, 100], volume: [0, 100], dayNight: [0, 100], fpsLimit: [0, 240], renderScale: [50, 100],
    windVolume: [0, 100], weatherLat: [-90, 90], weatherLon: [-180, 180],
  };

  const ENUMS = { fitMode: ['fill', 'fit', 'stretch'], soundscape: ['window', 'roof', 'leaves', 'car'], language: ['auto', 'en', 'sk'] };
  const STRINGS = { weatherCity: 80 };

  // Keys that describe the "look" (presets store only these, never the image or system options).
  const PRESET_KEYS = [
    'rainIntensity', 'dropletDensity', 'dropletSize', 'dropletSpeed', 'trailLength', 'merging',
    'randomGeneration', 'refraction', 'distortion', 'chromatic', 'glassTransparency', 'reflection',
    'condensationEnabled', 'condensation', 'blur', 'streaksEnabled', 'streaks', 'soundEnabled', 'volume',
    'thunderEnabled', 'lightning', 'dayNight', 'bgBrightness', 'bgBlur', 'soundscape', 'windEnabled', 'windVolume',
  ];

  const BUILTIN_PRESETS = [
    { name: 'Gentle Drizzle', builtin: true, values: { rainIntensity: 25, dropletDensity: 70, dropletSize: 35, dropletSpeed: 35, trailLength: 35, condensation: 20, streaks: 15, thunderEnabled: false, dayNight: 55 } },
    { name: 'Steady Rain', builtin: true, values: { rainIntensity: 55, dropletDensity: 60, dropletSize: 50, dropletSpeed: 50, trailLength: 50, condensation: 35, streaks: 35, thunderEnabled: false, dayNight: 50 } },
    { name: 'Thunderstorm', builtin: true, values: { rainIntensity: 95, dropletDensity: 80, dropletSize: 70, dropletSpeed: 80, trailLength: 75, condensation: 30, streaks: 80, thunderEnabled: true, lightning: true, soundEnabled: true, dayNight: 30, bgBrightness: 85 } },
    { name: 'Foggy Morning', builtin: true, values: { rainIntensity: 20, dropletDensity: 85, dropletSize: 40, dropletSpeed: 30, trailLength: 60, condensationEnabled: true, condensation: 80, glassTransparency: 70, streaks: 5, dayNight: 62 } },
    { name: 'Night Window', builtin: true, values: { rainIntensity: 60, dropletDensity: 65, dropletSize: 55, dropletSpeed: 50, trailLength: 55, condensation: 40, reflection: 65, streaks: 40, dayNight: 12, bgBrightness: 80 } },
  ];

  function clampNumber(v, [min, max], fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** Returns a sanitized, complete settings object (unknown keys dropped). */
  function sanitize(input) {
    const out = { ...DEFAULT_SETTINGS };
    if (!input || typeof input !== 'object') return out;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in input)) continue;
      const def = DEFAULT_SETTINGS[key];
      const val = input[key];
      if (key === 'backgroundPath') out[key] = typeof val === 'string' && val.length ? val : null;
      else if (ENUMS[key]) out[key] = ENUMS[key].includes(val) ? val : def;
      else if (STRINGS[key]) out[key] = typeof val === 'string' ? val.slice(0, STRINGS[key]) : def;
      else if (typeof def === 'boolean') out[key] = Boolean(val);
      else if (typeof def === 'number') out[key] = clampNumber(val, RANGES[key] || [-Infinity, Infinity], def);
    }
    return out;
  }

  return { DEFAULT_SETTINGS, RANGES, ENUMS, STRINGS, PRESET_KEYS, BUILTIN_PRESETS, sanitize };
});
