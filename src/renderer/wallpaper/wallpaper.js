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

  /* ---- music reactivity (primary analyses, others follow) ---- */
  let music = null, lastSent = 0;
  async function syncMusic(s) {
    if (!isPrimary) return;
    if (s.musicReactive && !music) {
      music = new RainGlass.MusicReactor({
        onLevel: (l) => {
          engine.setMusicLevel(l);
          const now = performance.now();
          if (now - lastSent > 66) { lastSent = now; api.musicLevel(l); }
        },
        onBeat: (b) => engine.musicBeat(b),
      });
      try { await music.start(); } catch (e) { api.reportError('Music: ' + e.message); music = null; }
    } else if (!s.musicReactive && music) {
      music.stop();
      music = null;
      api.musicLevel(0);
    }
    if (music) music.sensitivity = (s.musicSensitivity ?? 50) / 100;
  }
  api.onMusic((l) => engine.setMusicLevel(l));
  syncMusic(state.settings);

  /* ---- glass widget: clock + now playing (primary monitor only) ---- */
  const widget = document.getElementById('widget');
  const locale = { sk: 'sk-SK', cs: 'cs-CZ', de: 'de-DE', es: 'es-ES', it: 'it-IT', hu: 'hu-HU', fr: 'fr-FR' }[state.lang];
  let media = isPrimary ? await api.getMedia() : null;
  let wset = state.settings;
  function renderWidget() {
    const s = wset;
    const showClock = isPrimary && s.widgetClock;
    const showMedia = isPrimary && s.widgetMedia && media && media.title;
    widget.className = 'widget ' + (s.widgetPosition || 'top-right') + (showClock || showMedia ? ' show' : '');
    widget.innerHTML = '';
    if (showClock) {
      const d = new Date();
      const t = document.createElement('div'); t.className = 'w-time';
      t.textContent = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      const dt = document.createElement('div'); dt.className = 'w-date';
      dt.textContent = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
      widget.append(t, dt);
    }
    if (showMedia) {
      const row = document.createElement('div'); row.className = 'w-media' + (media.playing ? '' : ' paused');
      const note = document.createElement('div'); note.className = 'w-note'; note.textContent = media.playing ? '♪' : '❚❚';
      const txt = document.createElement('div'); txt.style.minWidth = '0';
      const ti = document.createElement('div'); ti.className = 'w-title'; ti.textContent = media.title;
      const ar = document.createElement('div'); ar.className = 'w-artist'; ar.textContent = media.artist || '';
      txt.append(ti, ar); row.append(note, txt); widget.append(row);
      const ctr = document.createElement('div'); ctr.className = 'w-controls';
      const ICON = {
        prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
        play: '<path d="M7 4v16l13-8z"/>',
        pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
        next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
      };
      for (const [cmd, icon] of [['prev', 'prev'], ['playpause', media.playing ? 'pause' : 'play'], ['next', 'next']]) {
        const b = document.createElement('div');
        b.className = 'w-btn' + (cmd === 'playpause' ? ' main' : '');
        b.dataset.cmd = cmd;
        b.innerHTML = '<svg viewBox="0 0 24 24">' + ICON[icon] + '</svg>';
        ctr.append(b);
      }
      widget.append(ctr);
    }
  }
  // Clicks: the wallpaper sits behind the desktop icons on Windows, so the main
  // process forwards desktop clicks; DOM clicks cover other platforms.
  function pressButton(el) {
    const b = el && el.closest && el.closest('.w-btn');
    if (!b) return false;
    b.classList.add('press');
    setTimeout(() => b.classList.remove('press'), 150);
    api.mediaCommand(b.dataset.cmd);
    return true;
  }
  widget.addEventListener('click', (e) => pressButton(e.target));
  api.onClick((x, y) => pressButton(document.elementFromPoint(x, y)));
  let hovered = null;
  function hover(x, y) {
    const el = document.elementFromPoint(x, y);
    const b = el && el.closest ? el.closest('.w-btn') : null;
    if (b === hovered) return;
    if (hovered) hovered.classList.remove('hover');
    hovered = b;
    if (b) b.classList.add('hover');
  }
  renderWidget();
  setInterval(renderWidget, 15000);
  api.onMedia((m) => { media = m; renderWidget(); });

  api.onSettings((settings) => {
    wset = settings;
    renderWidget();
    syncMusic(settings);
    engine.setSettings(settings);
    loadBackground(settings.imageKey);
  });
  api.onPause((p) => engine.setPaused(p));
  api.onSuspend((s) => engine.setSuspended(s));
  api.onHidden((h) => engine.setHidden(h));
  api.onSpan((span) => engine.setSpan(span));
  api.onPointer((x, y) => { engine.pointer(x, y); if (isPrimary) hover(x, y); });
  api.onSleep((endsAt) => engine.setSleep(endsAt));
  api.getSleep().then((endsAt) => engine.setSleep(endsAt));
  api.onReset(() => engine.reset());
  api.onLightning((d) => engine.lightning(d, false));

  // Free GPU memory on unload.
  window.addEventListener('beforeunload', () => engine.destroy());
})();
