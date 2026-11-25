/* Wallpaper window: one per monitor. The primary monitor also owns audio and lightning timing. */
(async function () {
  'use strict';
  const api = window.rainApi;
  const params = new URLSearchParams(location.search);
  const isPrimary = params.get('primary') === '1';

  let engine;
  try {
    engine = new RainGlass.Engine(document.getElementById('glass'), { audio: isPrimary, lightningSource: isPrimary });
  } catch (e) {
    api.reportError(e.message);
    return;
  }

  let currentPath;
  async function loadBackground(path) {
    if (path === currentPath) return;
    currentPath = path;
    try {
      if (!path) { engine.setBackground(null); return; }
      const img = await api.readImage();
      if (!img || currentPath !== path) return;
      await engine.setBackgroundFromBlob(new Blob([img.data], { type: img.mime }));
    } catch (e) {
      api.reportError('Background: ' + e.message);
      engine.setBackground(null);
    }
  }

  const state = await api.getState();
  engine.setSettings(state.settings);
  await loadBackground(state.settings.backgroundPath);
  engine.start();

  if (isPrimary) {
    engine.onLightning = (d) => api.lightning(d);
    engine.onFrame = (fps) => api.reportFps(fps);
  }

  api.onSettings((settings) => {
    engine.setSettings(settings);
    loadBackground(settings.backgroundPath);
  });
  api.onPause((p) => engine.setPaused(p));
  api.onSuspend((s) => engine.setSuspended(s));
  api.onReset(() => engine.reset());
  api.onLightning((d) => engine.lightning(d, false));

  // Free GPU memory on unload.
  window.addEventListener('beforeunload', () => engine.destroy());
})();
