/* Wallpaper Engine entry point: maps user properties to engine settings. */
(function () {
  'use strict';
  const cfg = window.RAINY_GLASS_CONFIG || { settings: {}, bundledImage: null };
  const settings = Object.assign({}, RainGlassDefaults.DEFAULT_SETTINGS, cfg.settings);
  const engine = new RainGlass.Engine(document.getElementById('glass'), { audio: true, lightningSource: true });
  engine.setSettings(settings);
  engine.start();

  // WE property name -> engine setting key
  const MAP = {
    fitmode: 'fitMode', bgbrightness: 'bgBrightness', bgblur: 'bgBlur', bgposx: 'bgPosX', bgposy: 'bgPosY',
    rainintensity: 'rainIntensity', dropletdensity: 'dropletDensity', dropletsize: 'dropletSize',
    dropletspeed: 'dropletSpeed', traillength: 'trailLength', merging: 'merging', randomgeneration: 'randomGeneration',
    refraction: 'refraction', distortion: 'distortion', chromatic: 'chromatic', glasstransparency: 'glassTransparency',
    reflection: 'reflection', condensationenabled: 'condensationEnabled', condensation: 'condensation', blur: 'blur',
    streaksenabled: 'streaksEnabled', streaks: 'streaks', soundenabled: 'soundEnabled', volume: 'volume',
    thunderenabled: 'thunderEnabled', lightning: 'lightning', daynight: 'dayNight',
  };

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load: ' + url));
      img.src = url;
    });
  }

  async function setImage(url) {
    try {
      if (!url) { engine.setBackground(null); return; }
      const img = await loadImage(url);
      const max = Math.min(engine.renderer.maxTex || 8192, 8192);
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const bmp = await createImageBitmap(img, scale < 1 ? { resizeWidth: Math.round(img.naturalWidth * scale), resizeHeight: Math.round(img.naturalHeight * scale), resizeQuality: 'high' } : {});
      engine.setBackground(bmp);
    } catch (e) {
      console.error(e);
      engine.setBackground(null);
    }
  }

  setImage(cfg.bundledImage);

  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      const patch = {};
      for (const [prop, key] of Object.entries(MAP)) {
        if (props[prop] !== undefined) patch[key] = props[prop].value;
      }
      if (Object.keys(patch).length) engine.setSettings(patch);
      if (props.backgroundimage) {
        const v = props.backgroundimage.value;
        setImage(v ? 'file:///' + decodeURIComponent(v) : cfg.bundledImage);
      }
    },
    setPaused(paused) {
      engine.setSuspended(paused);
    },
  };
})();
