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
  let built = '';
  let clockEls = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICON = {
    prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
    voldown: '<path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15 11h6v2h-6z"/>',
    volup: '<path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M17 8h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/>',
  };

  /** Text that scrolls right → left (like music players) when it does not fit. */
  function marquee(cls, text) {
    const box = el('div', 'w-scroll ' + cls);
    const track = el('span', 'w-track');
    track.append(el('span', 'w-copy', text));
    box.append(track);
    let tries = 0;
    const measure = () => {
      if (!box.isConnected) return;
      const copy = track.firstChild;
      if (!box.clientWidth) { if (++tries < 20) setTimeout(measure, 150); return; } // not laid out yet
      if (copy.offsetWidth <= box.clientWidth + 1) return;
      track.append(el('span', 'w-copy', text)); // second copy → seamless loop
      const dist = copy.offsetWidth; // includes the gap (padding-right)
      track.style.setProperty('--dist', -dist + 'px');
      track.style.animationDuration = Math.max(6, dist / 32) + 's';
      box.classList.add('run');
    };
    setTimeout(measure, 30);
    return box;
  }

  function updateClock() {
    if (!clockEls) return;
    const d = new Date();
    clockEls[0].textContent = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    clockEls[1].textContent = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /** Rebuilds only when something visible changed, so the scrolling title keeps running. */
  function renderWidget() {
    const s = wset;
    const showClock = isPrimary && s.widgetClock;
    const showMedia = isPrimary && s.widgetMedia && media && media.title;
    const sig = JSON.stringify([showClock, showMedia && [media.title, media.artist, media.playing], s.widgetPosition]);
    if (sig === built) { updateClock(); return; }
    built = sig;
    hovered = null;
    widget.className = 'widget ' + (s.widgetPosition || 'top-right') + (showClock || showMedia ? ' show' : '');
    widget.innerHTML = '';
    clockEls = null;
    if (showClock) {
      clockEls = [el('div', 'w-time'), el('div', 'w-date')];
      widget.append(...clockEls);
      updateClock();
    }
    if (showMedia) {
      const row = el('div', 'w-media' + (media.playing ? '' : ' paused'));
      const note = el('div', 'w-note', media.playing ? '♪' : '❚❚');
      const txt = el('div', 'w-text');
      txt.append(marquee('w-title', media.title), marquee('w-artist', media.artist || ''));
      row.append(note, txt);
      const ctr = el('div', 'w-controls');
      const btns = [['prev', 'prev'], ['playpause', media.playing ? 'pause' : 'play'], ['next', 'next'], null, ['voldown', 'voldown'], ['volup', 'volup']];
      for (const def of btns) {
        if (!def) { ctr.append(el('div', 'w-gap')); continue; }
        const b = el('div', 'w-btn' + (def[0] === 'playpause' ? ' main' : '') + (def[0].startsWith('vol') ? ' small' : ''));
        b.dataset.cmd = def[0];
        b.innerHTML = '<svg viewBox="0 0 24 24">' + ICON[def[1]] + '</svg>';
        ctr.append(b);
      }
      widget.append(row, ctr);
    }
  }
  // Clicks: the wallpaper sits behind the desktop icons on Windows, so the main
  // process forwards desktop clicks; DOM clicks cover other platforms.
  function pressButton(target) {
    const b = target && target.closest && target.closest('.w-btn');
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
    const t = document.elementFromPoint(x, y);
    const b = t && t.closest ? t.closest('.w-btn') : null;
    if (b === hovered) return;
    if (hovered) hovered.classList.remove('hover');
    hovered = b;
    if (b) b.classList.add('hover');
  }
  renderWidget();
  setInterval(renderWidget, 10000);
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
