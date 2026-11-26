/* Screensaver window: rain over the monitor's background + optional clock. Any input exits. */
(async function () {
  'use strict';
  const api = window.rainApi;
  const params = new URLSearchParams(location.search);
  const displayId = Number(params.get('display')) || null;
  const isPrimary = params.get('primary') === '1';

  const engine = new RainGlass.Engine(document.getElementById('glass'), { audio: false, lightningSource: isPrimary });
  const state = await api.getState();
  engine.setSettings({ ...state.settings, mouseInteraction: false });
  try { await engine.setBackgroundMedia(await api.readImage(displayId)); } catch { /* gradient */ }
  engine.start();
  api.onSettings((s) => engine.setSettings({ ...s, mouseInteraction: false }));

  // Clock
  const clock = document.getElementById('clock');
  const lang = { sk: 'sk-SK', cs: 'cs-CZ', de: 'de-DE', es: 'es-ES', it: 'it-IT', hu: 'hu-HU', fr: 'fr-FR' }[state.lang];
  function tick() {
    const d = new Date();
    clock.innerHTML = '';
    clock.append(d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }));
    const small = document.createElement('small');
    small.textContent = d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
    clock.append(small);
  }
  if (state.settings.screensaverClock && isPrimary) {
    tick();
    setInterval(tick, 1000);
    setTimeout(() => clock.classList.add('show'), 600);
  }

  // Exit on input (ignore the tiny mouse jitter right after opening).
  const t0 = performance.now();
  let origin = null;
  const exit = () => { if (performance.now() - t0 > 800) api.exitScreensaver(); };
  window.addEventListener('mousemove', (e) => {
    if (!origin) { origin = [e.screenX, e.screenY]; return; }
    if (Math.hypot(e.screenX - origin[0], e.screenY - origin[1]) > 12) exit();
  });
  for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, exit);
})();
