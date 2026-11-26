/* Wallpaper window: one per monitor. The primary monitor also owns audio and lightning timing. */
(async function () {
  'use strict';
  const api = window.rainApi;
  const params = new URLSearchParams(location.search);
  const isPrimary = params.get('primary') === '1';
  const displayId = Number(params.get('display')) || null;

  let engine;
  try {
    engine = new RainGlass.Engine(document.getElementById('glass'), { audio: isPrimary, lightningSource: isPrimary });
  } catch (e) {
    api.reportError(e.message);
    return;
  }

  let currentKey;
  async function loadBackground(key) {
    if (key === currentKey) return;
    currentKey = key;
    try {
      if (!key || key === 'none') { engine.setBackground(null); return; }
      const img = await api.readImage(displayId);
      if (!img || currentKey !== key) return;
      await engine.setBackgroundMedia(img);
    } catch (e) {
      api.reportError('Background: ' + e.message);
      engine.setBackground(null);
    }
  }

  const state = await api.getState();
  engine.setSettings(state.settings);
  await loadBackground(state.settings.imageKey);
  engine.start();

  if (isPrimary) {
    engine.onLightning = (d) => api.lightning(d);
    engine.onFrame = (fps) => api.reportFps(fps);
  }

  api.onSettings((settings) => {
    engine.setSettings(settings);
    loadBackground(settings.imageKey);
  });
  api.onPause((p) => engine.setPaused(p));
  api.onSuspend((s) => engine.setSuspended(s));
  api.onHidden((h) => engine.setHidden(h));
  api.onPointer((x, y) => engine.pointer(x, y));
  api.onReset(() => engine.reset());
  api.onLightning((d) => engine.lightning(d, false));

  // Free GPU memory on unload.
  window.addEventListener('beforeunload', () => engine.destroy());
})();
