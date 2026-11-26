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
    useSystemWallpaper: true,
    galleryMatchLook: true,    // picking a gallery scene also applies its matching preset  // no custom image → use the current Windows desktop wallpaper
    fitMode: 'fill',           // 'fill' | 'fit' | 'stretch'
    bgBrightness: 100,         // 0..200 %
    bgBlur: 0,                 // 0..100
    bgPosX: 50,                // 0..100 (focal point when cropping)
    bgPosY: 50,
    bgZoom: 100,               // 100..200 %
    spanMonitors: false,       // stretch one image across all monitors

    // Rain
    rainIntensity: 55,         // 0..100
    dropletDensity: 60,
    dropletSize: 20,
    dropletSpeed: 50,
    trailLength: 50,
    merging: true,
    randomGeneration: true,
    precipitation: 'rain',     // 'rain' | 'snow'
    frost: 28,                 // snow mode: ice crystals on the glass (0 = off)
    snowIntensity: 34,         // snow mode: how much snow sticks to the glass
    flakeSize: 40,             // snow mode: size of the flakes on the glass
    snowMelt: 56,              // snow mode: how fast stuck snow melts
    snowFall: 100,              // snow mode: snow falling outside the window (0 = off)

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
    thunderFrequency: 40,      // how often thunder strikes (0 = rarely … 100 = very often)
    lightning: true,
    dayNight: 50,              // 0 = deep night, 50 = neutral, 100 = warm day
    autoDayNight: false,       // follow the sun (location from weather or time zone)
    soundscape: 'window',      // 'window' | 'roof' | 'leaves' | 'car'
    windEnabled: false,
    windVolume: 40,

    // Interaction & weather
    parallax: 25,              // background follows the cursor (depth behind the glass)
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
    settingsVersion: 3,        // bumped when defaults change (one-time migrations)
    screensaverEnabled: false, // rain screensaver after inactivity
    screensaverMinutes: 10,
    screensaverClock: true,
    screensaverRain: true,     // weather shown by the screensaver; both ticked = take turns
    screensaverSnow: false,
    scheduleEnabled: false,    // time-of-day schedule (see `schedule`)
    schedule: [],              // [{ time: 'HH:MM', preset: name|'', image: path|'' }]
    pauseApps: '',
    pixabayKey: '',
    onlinePhotoQuality: 'best', // 'best' | '1280' | '640'
    onlineVideoQuality: 'best', // 'best' | '2160' | '1080' | '720' | '540'
    musicReactive: false,      // lights pulse / lightning with the music playing on the PC
    musicSensitivity: 50,
    musicGlow: 60,
    musicLightning: true,
    widgetClock: false,        // glass widget on the desktop: clock …
    widgetMedia: false,        // … and the song that is playing
    widgetPosition: 'top-right',
    rgbEnabled: false,         // Razer Chroma: rain-blue glow, white flash on lightning
    taskbarLightIcons: true,   // with a see-through taskbar: dark system theme so the clock/icons are white
    taskbarSavedTheme: -1,     // internal: user's SystemUsesLightTheme while we changed it (-1 = untouched)
    taskbarStyle: 'default',   // 'default' | 'clear' | 'blur' | 'acrylic' – see the rain under the taskbar            // optional own Pixabay API key (built-in key used when empty)             // comma separated exe names that pause the wallpaper when in front
    hotkeysEnabled: true,      // Ctrl+Alt+R pause, Ctrl+Alt+W wallpaper on/off
    autoUpdate: true,
    language: 'auto',          // 'auto' | 'en' | 'sk' | 'cs' | 'de' | 'es' | 'it' | 'hu' | 'fr'
  });

  // Numeric ranges used for clamping / validation and by the UI.
  const RANGES = {
    bgBrightness: [0, 200], bgBlur: [0, 100], bgPosX: [0, 100], bgPosY: [0, 100], bgZoom: [100, 200],
    rainIntensity: [0, 100], dropletDensity: [0, 100], dropletSize: [0, 100], dropletSpeed: [0, 100],
    trailLength: [0, 100], refraction: [0, 100], distortion: [0, 100], chromatic: [0, 100],
    glassTransparency: [0, 100], reflection: [0, 100], condensation: [0, 100], blur: [0, 100],
    streaks: [0, 100], volume: [0, 100], dayNight: [0, 100], fpsLimit: [0, 240], renderScale: [50, 100],
    windVolume: [0, 100], weatherLat: [-90, 90], weatherLon: [-180, 180],
    frost: [0, 100], parallax: [0, 100], screensaverMinutes: [1, 120],
    thunderFrequency: [0, 100], musicSensitivity: [0, 100], musicGlow: [0, 100], taskbarSavedTheme: [-1, 1], snowIntensity: [0, 100], flakeSize: [0, 100], snowMelt: [0, 100], snowFall: [0, 100], settingsVersion: [0, 1000],
  };

  const ENUMS = { fitMode: ['fill', 'fit', 'stretch'], soundscape: ['window', 'roof', 'leaves', 'car'], precipitation: ['rain', 'snow'], taskbarStyle: ['default', 'clear', 'blur', 'acrylic'], onlinePhotoQuality: ['best', '1280', '640'], widgetPosition: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'], onlineVideoQuality: ['best', '2160', '1080', '720', '540'], language: ['auto', 'en', 'sk', 'cs', 'de', 'es', 'it', 'hu', 'fr'] };
  const STRINGS = { weatherCity: 80, pauseApps: 600, pixabayKey: 80 };

  function sanitizeSchedule(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map((e) => ({
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(e && e.time) ? e.time : '08:00',
      preset: typeof (e && e.preset) === 'string' ? e.preset.slice(0, 48) : '',
      image: typeof (e && e.image) === 'string' ? e.image.slice(0, 1024) : '',
    }));
  }

  // Keys that describe the "look" (presets store only these, never the image or system options).
  const PRESET_KEYS = [
    'rainIntensity', 'dropletDensity', 'dropletSize', 'dropletSpeed', 'trailLength', 'merging',
    'randomGeneration', 'refraction', 'distortion', 'chromatic', 'glassTransparency', 'reflection',
    'condensationEnabled', 'condensation', 'blur', 'streaksEnabled', 'streaks', 'soundEnabled', 'volume',
    'thunderEnabled', 'thunderFrequency', 'lightning', 'dayNight', 'bgBrightness', 'bgBlur', 'soundscape', 'windEnabled', 'windVolume', 'precipitation', 'frost',
    'snowIntensity', 'flakeSize', 'snowMelt', 'snowFall',
  ];

  const BUILTIN_PRESETS = [
    { name: 'Gentle Drizzle', builtin: true, values: { rainIntensity: 25, dropletDensity: 70, dropletSize: 15, dropletSpeed: 35, trailLength: 35, condensation: 20, streaks: 15, thunderEnabled: false, dayNight: 55 } },
    { name: 'Steady Rain', builtin: true, values: { rainIntensity: 55, dropletDensity: 60, dropletSize: 20, dropletSpeed: 50, trailLength: 50, condensation: 35, streaks: 35, thunderEnabled: false, dayNight: 50 } },
    { name: 'Thunderstorm', builtin: true, values: { rainIntensity: 95, dropletDensity: 80, dropletSize: 35, dropletSpeed: 80, trailLength: 75, condensation: 30, streaks: 80, thunderEnabled: true, lightning: true, soundEnabled: true, dayNight: 30, bgBrightness: 85 } },
    { name: 'Foggy Morning', builtin: true, values: { rainIntensity: 20, dropletDensity: 85, dropletSize: 20, dropletSpeed: 30, trailLength: 60, condensationEnabled: true, condensation: 80, glassTransparency: 70, streaks: 5, dayNight: 62 } },
    { name: 'After the Storm', builtin: true, values: { rainIntensity: 3, dropletDensity: 90, dropletSize: 30, dropletSpeed: 35, trailLength: 70, randomGeneration: true, condensation: 45, streaks: 0, thunderEnabled: false, dayNight: 58, bgBrightness: 105 } },
    { name: 'Snowy Window', builtin: true, values: { precipitation: 'snow', snowIntensity: 65, flakeSize: 45, snowMelt: 20, snowFall: 70, rainIntensity: 45, dropletDensity: 40, dropletSize: 20, dropletSpeed: 25, trailLength: 40, condensation: 40, frost: 25, streaks: 60, dayNight: 45, windEnabled: true } },
    { name: 'Frosty Morning', builtin: true, values: { precipitation: 'snow', snowIntensity: 25, flakeSize: 30, snowMelt: 10, snowFall: 20, rainIntensity: 10, dropletDensity: 30, dropletSize: 15, dropletSpeed: 20, condensation: 55, frost: 75, streaks: 15, dayNight: 62 } },
    { name: 'Night Window', builtin: true, values: { rainIntensity: 60, dropletDensity: 65, dropletSize: 25, dropletSpeed: 50, trailLength: 55, condensation: 40, reflection: 65, streaks: 40, dayNight: 12, bgBrightness: 80 } },
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
      else if (key === 'schedule') out[key] = sanitizeSchedule(val);
      else if (ENUMS[key]) out[key] = ENUMS[key].includes(val) ? val : def;
      else if (STRINGS[key]) out[key] = typeof val === 'string' ? val.slice(0, STRINGS[key]) : def;
      else if (typeof def === 'boolean') out[key] = Boolean(val);
      else if (typeof def === 'number') out[key] = clampNumber(val, RANGES[key] || [-Infinity, Infinity], def);
    }
    return out;
  }

  return { DEFAULT_SETTINGS, RANGES, ENUMS, STRINGS, PRESET_KEYS, BUILTIN_PRESETS, sanitize };
});
