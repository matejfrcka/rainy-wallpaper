'use strict';
/**
 * Builds a Wallpaper Engine (web wallpaper) project folder that runs the same
 * rain engine. Used by the "Export" button and by `npm run build:we`.
 */
const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, sanitize } = require('../shared/defaults');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE_FILES = ['shaders.js', 'rain-simulation.js', 'renderer.js', 'audio.js', 'engine.js'];

const slider = (order, text, value, min = 0, max = 100) => ({ order, text, type: 'slider', min, max, value, editable: true });
const bool = (order, text, value) => ({ order, text, type: 'bool', value });

function properties(s) {
  let o = 0;
  return {
    backgroundimage: { order: o++, text: 'Background image (any JPG/PNG/WEBP/BMP)', type: 'file', value: '' },
    fitmode: { order: o++, text: 'Image mode', type: 'combo', value: s.fitMode, options: [{ label: 'Fill', value: 'fill' }, { label: 'Fit', value: 'fit' }, { label: 'Stretch', value: 'stretch' }] },
    bgbrightness: slider(o++, 'Background brightness', s.bgBrightness, 0, 200),
    bgblur: slider(o++, 'Background blur', s.bgBlur),
    bgposx: slider(o++, 'Background position X', s.bgPosX),
    bgposy: slider(o++, 'Background position Y', s.bgPosY),
    rainintensity: slider(o++, 'Rain intensity', s.rainIntensity),
    dropletdensity: slider(o++, 'Droplet density', s.dropletDensity),
    dropletsize: slider(o++, 'Droplet size', s.dropletSize),
    dropletspeed: slider(o++, 'Droplet speed', s.dropletSpeed),
    traillength: slider(o++, 'Water trail length', s.trailLength),
    merging: bool(o++, 'Droplet merging', s.merging),
    randomgeneration: bool(o++, 'Random droplet generation', s.randomGeneration),
    refraction: slider(o++, 'Refraction', s.refraction),
    distortion: slider(o++, 'Distortion', s.distortion),
    chromatic: slider(o++, 'Chromatic refraction', s.chromatic),
    glasstransparency: slider(o++, 'Glass transparency', s.glassTransparency),
    reflection: slider(o++, 'Reflections', s.reflection),
    condensationenabled: bool(o++, 'Condensation / fog', s.condensationEnabled),
    condensation: slider(o++, 'Condensation intensity', s.condensation),
    blur: slider(o++, 'Blur intensity', s.blur),
    streaksenabled: bool(o++, 'Rain streaks', s.streaksEnabled),
    streaks: slider(o++, 'Rain streaks intensity', s.streaks),
    soundenabled: bool(o++, 'Rain sound', s.soundEnabled),
    volume: slider(o++, 'Rain ambience volume', s.volume),
    thunderenabled: bool(o++, 'Thunder', s.thunderEnabled),
    lightning: bool(o++, 'Lightning flashes', s.lightning),
    daynight: slider(o++, 'Day / night', s.dayNight),
  };
}

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

/**
 * @param {string} outDir    destination folder (created)
 * @param {object} settings  initial values
 * @param {string|null} imagePath  optional bundled default background
 */
function buildWallpaperEngineProject(outDir, settings = DEFAULT_SETTINGS, imagePath = null) {
  const s = sanitize(settings);
  fs.mkdirSync(outDir, { recursive: true });
  copy(path.join(ROOT, 'wallpaper-engine', 'index.html'), path.join(outDir, 'index.html'));
  copy(path.join(ROOT, 'wallpaper-engine', 'we-main.js'), path.join(outDir, 'we-main.js'));
  copy(path.join(ROOT, 'src', 'shared', 'defaults.js'), path.join(outDir, 'engine', 'defaults.js'));
  for (const f of ENGINE_FILES) copy(path.join(ROOT, 'src', 'engine', f), path.join(outDir, 'engine', f));

  let bundled = null;
  if (imagePath && fs.existsSync(imagePath)) {
    let ext = path.extname(imagePath).toLowerCase();
    if (!ext) { // e.g. Windows "TranscodedWallpaper" has no extension
      const head = fs.readFileSync(imagePath).subarray(0, 4);
      ext = head[0] === 0x89 ? '.png' : head[0] === 0x42 ? '.bmp' : '.jpg';
    }
    bundled = 'background' + ext;
    copy(imagePath, path.join(outDir, bundled));
  }
  const project = {
    file: 'index.html',
    title: 'Rainy Glass',
    description: 'Realistic animated rain on glass over any image you choose.',
    type: 'web',
    tags: ['Nature', 'Relaxing'],
    general: { supportsaudioprocessing: false, properties: properties(s) },
  };
  fs.writeFileSync(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(outDir, 'config.js'), `window.RAINY_GLASS_CONFIG = ${JSON.stringify({ settings: s, bundledImage: bundled }, null, 2)};\n`);
  return outDir;
}

module.exports = { buildWallpaperEngineProject };
