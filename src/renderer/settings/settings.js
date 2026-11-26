/* Settings window: schema-driven controls + live preview engine. */
(async function () {
  'use strict';
  const api = window.rainApi;
  const { DEFAULT_SETTINGS } = window.RainGlassDefaults;
  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  };

  const ICONS = {
    background: '<path d="M4 5h16v14H4z"/><path d="m4 16 5-5 4 4 3-3 4 4"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    rain: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    glass: '<path d="M5 3h14v18H5z"/><path d="m8 7 3-3M8 12l7-7M11 16l5-5"/>',
    atmosphere: '<path d="M7 18a4 4 0 0 1-.7-7.9A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="m11 13-2 4h3l-2 4"/>',
    presets: '<path d="M5 4h14v16l-7-4-7 4z"/>',
    system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    image: '<path d="M4 5h16v14H4z"/><path d="m4 16 5-5 4 4 3-3 4 4"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7M8 20v-6h8v6"/>',
    export: '<path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v6H4V5h6"/>',
  };
  const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = ICONS[name]; return s; };

  /* ------------------------------------------------------------- schema */
  const slider = (key, label, opts = {}) => ({ type: 'slider', key, label, min: 0, max: 100, unit: '%', ...opts });
  const toggle = (key, label, opts = {}) => ({ type: 'toggle', key, label, ...opts });
  const seg = (key, label, options, opts = {}) => ({ type: 'segmented', key, label, options, ...opts });

  const SECTIONS = [
    {
      id: 'background', title: 'Background', lead: 'Choose any image from your computer. The rain layer never modifies it.',
      custom: 'image',
      groups: [
        { title: 'Source', items: [
          toggle('useSystemWallpaper', 'Use Windows wallpaper automatically', { hint: 'When no custom image is selected, the rain is applied over your current Windows desktop wallpaper.' }),
        ] },
        { title: 'Layout', items: [
          seg('fitMode', 'Scaling', [['fill', 'Fill'], ['fit', 'Fit'], ['stretch', 'Stretch']], { hint: 'Fill crops to cover the monitor, Fit shows the whole image.' }),
          slider('bgZoom', 'Zoom', { min: 100, max: 200 }),
          slider('bgPosX', 'Horizontal position', { unit: '', format: (v) => (v < 45 ? 'Left ' : v > 55 ? 'Right ' : 'Center ') + Math.round(v) }),
          slider('bgPosY', 'Vertical position', { unit: '', format: (v) => (v < 45 ? 'Top ' : v > 55 ? 'Bottom ' : 'Center ') + Math.round(v) }),
        ] },
        { title: 'Adjustments', items: [
          slider('bgBrightness', 'Brightness', { max: 200 }),
          slider('bgBlur', 'Blur'),
        ] },
      ],
    },
    {
      id: 'rain', title: 'Rain', lead: 'Physics of the water on the glass.',
      groups: [
        { title: 'Amount', items: [
          slider('rainIntensity', 'Rain intensity', { hint: 'How often new drops hit the window.' }),
          slider('dropletDensity', 'Droplet density', { hint: 'Tiny static droplets covering the glass.' }),
          slider('dropletSize', 'Droplet size'),
        ] },
        { title: 'Motion', items: [
          slider('dropletSpeed', 'Droplet speed'),
          slider('trailLength', 'Water trail length'),
          toggle('merging', 'Droplet merging', { hint: 'Drops that touch combine into larger, faster drops.' }),
          toggle('randomGeneration', 'Random droplet generation', { hint: 'New drops keep forming. Off = the glass slowly dries.' }),
        ] },
      ],
    },
    {
      id: 'glass', title: 'Glass', lead: 'Optical properties of the window and the water lenses.',
      groups: [
        { title: 'Optics', items: [
          slider('refraction', 'Refraction intensity'),
          slider('distortion', 'Distortion intensity'),
          slider('chromatic', 'Chromatic refraction'),
          slider('blur', 'Blur intensity', { hint: 'Defocus inside large drops.' }),
        ] },
        { title: 'Surface', items: [
          slider('glassTransparency', 'Glass transparency'),
          slider('reflection', 'Reflection intensity'),
          toggle('condensationEnabled', 'Condensation / fog'),
          slider('condensation', 'Condensation intensity', { dependsOn: 'condensationEnabled' }),
          toggle('streaksEnabled', 'Rain streaks', { hint: 'Out-of-focus rain falling outside.' }),
          slider('streaks', 'Streak intensity', { dependsOn: 'streaksEnabled' }),
        ] },
      ],
    },
    {
      id: 'atmosphere', title: 'Atmosphere', lead: 'Sound and light. Audio plays from the desktop wallpaper.',
      groups: [
        { title: 'Sound', items: [
          toggle('soundEnabled', 'Rain sound'),
          slider('volume', 'Rain ambience volume', { dependsOn: 'soundEnabled' }),
          toggle('thunderEnabled', 'Thunder', { hint: 'Occasional distant or close thunder.' }),
          toggle('lightning', 'Lightning flashes', { dependsOn: 'thunderEnabled' }),
        ] },
        { title: 'Color', items: [
          slider('dayNight', 'Day / Night', { unit: '', format: (v) => (v < 40 ? 'Night ' : v > 60 ? 'Day ' : 'Neutral ') + Math.round(v) }),
        ] },
      ],
    },
    { id: 'presets', title: 'Presets', lead: 'Save and load your favourite looks. Presets never change your image.', custom: 'presets', groups: [] },
    {
      id: 'system', title: 'System', lead: 'Desktop integration and performance.',
      custom: 'system',
      groups: [
        { title: 'Desktop', items: [
          toggle('wallpaperEnabled', 'Live wallpaper', { hint: 'Show the rain on your desktop (all monitors).' }),
          toggle('startWithWindows', 'Start with Windows'),
          toggle('pauseOnFullscreen', 'Pause when a fullscreen app or game runs'),
          toggle('pauseOnBattery', 'Pause on battery power'),
        ] },
        { title: 'Performance', items: [
          seg('fpsLimit', 'Frame rate', [[30, '30'], [60, '60'], [0, 'Max']]),
          slider('renderScale', 'Render resolution', { min: 50, max: 100, hint: 'Lower values save GPU on 4K displays.' }),
        ] },
      ],
    },
  ];

  /* -------------------------------------------------------------- state */
  const state = await api.getState();
  let settings = { ...DEFAULT_SETTINGS, ...state.settings };
  let presets = state.presets;
  let status = state.status;
  let paused = !!status.paused;
  const controls = new Map(); // key -> { update(value) }

  /* ------------------------------------------------------------ preview */
  const canvas = $('#preview');
  let engine = null;
  try {
    engine = new RainGlass.Engine(canvas, { audio: false, lightningSource: true });
    engine.setSettings(settings);
    engine.setPaused(paused);
    engine.start();
  } catch (e) {
    $('#previewBadge').textContent = 'Preview unavailable: ' + e.message;
  }

  let previewKey;
  let thumbUrl = null;
  async function loadPreviewImage() {
    const key = settings.imageKey;
    if (key === previewKey) return;
    previewKey = key;
    if (!key || key === 'none') { engine && engine.setBackground(null); renderImageCard(null); return; }
    try {
      const img = await api.readImage();
      if (!img || previewKey !== key) return;
      const blob = new Blob([img.data], { type: img.mime });
      if (engine) await engine.setBackgroundFromBlob(blob);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = URL.createObjectURL(blob);
      renderImageCard({ url: thumbUrl, name: img.name, path: img.path, source: img.source });
    } catch (e) {
      toast('This image could not be decoded: ' + e.message, true);
      if (settings.imageSource === 'custom') applyRemote(await api.removeImage());
      else { engine && engine.setBackground(null); renderImageCard(null); }
    }
  }

  // Match the preview's aspect ratio to the primary monitor.
  const primary = (status.displays || []).find((d) => d.primary);
  if (primary) $('#previewCard').style.aspectRatio = `${primary.width} / ${primary.height}`;

  /* ---------------------------------------------------------- settings */
  let pending = {};
  let sendTimer = null;
  function change(patch) {
    Object.assign(settings, patch);
    Object.assign(pending, patch);
    if (engine) engine.setSettings(patch);
    refreshDependencies();
    if (!sendTimer) {
      sendTimer = setTimeout(async () => {
        const p = pending; pending = {}; sendTimer = null;
        await api.setSettings(p);
      }, 60);
    }
  }

  function applyRemote(s) {
    settings = { ...DEFAULT_SETTINGS, ...s };
    if (engine) engine.setSettings(settings);
    for (const [key, c] of controls) c.update(settings[key]);
    refreshDependencies();
    loadPreviewImage();
  }

  function refreshDependencies() {
    for (const sec of SECTIONS) for (const g of sec.groups) for (const it of g.items) {
      if (!it.dependsOn) continue;
      const c = controls.get(it.key);
      if (c) c.row.classList.toggle('disabled', !settings[it.dependsOn]);
    }
  }

  /* ---------------------------------------------------------- controls */
  function buildControl(it) {
    const row = h('div', { class: 'row' });
    const head = h('div', { class: 'row-head' });
    const labelBox = h('div', {}, h('div', { class: 'row-label' }, it.label), it.hint ? h('div', { class: 'row-hint' }, it.hint) : null);
    head.append(labelBox);
    row.append(head);
    let update;

    if (it.type === 'slider') {
      const val = h('div', { class: 'row-value' });
      const input = h('input', { type: 'range', min: it.min, max: it.max, step: it.step || 1 });
      const fmt = (v) => (it.format ? it.format(v) : Math.round(v) + it.unit);
      update = (v) => {
        input.value = v;
        input.style.setProperty('--p', ((v - it.min) / (it.max - it.min)) * 100 + '%');
        val.textContent = fmt(v);
      };
      input.addEventListener('input', () => {
        const v = Number(input.value);
        update(v);
        change({ [it.key]: v });
      });
      input.addEventListener('dblclick', () => { const d = DEFAULT_SETTINGS[it.key]; update(d); change({ [it.key]: d }); });
      head.append(val);
      row.append(input);
    } else if (it.type === 'toggle') {
      const input = h('input', { type: 'checkbox' });
      const t = h('label', { class: 'toggle' }, input, h('span'));
      update = (v) => { input.checked = !!v; };
      input.addEventListener('change', () => change({ [it.key]: input.checked }));
      head.append(t);
    } else if (it.type === 'segmented') {
      const box = h('div', { class: 'segmented' });
      const buttons = it.options.map(([value, label]) => {
        const b = h('button', { onclick: () => { update(value); change({ [it.key]: value }); } }, label);
        b.__value = value;
        box.append(b);
        return b;
      });
      update = (v) => buttons.forEach((b) => b.classList.toggle('active', b.__value === v));
      head.append(box);
    }
    update(settings[it.key]);
    controls.set(it.key, { update, row });
    return row;
  }

  /* -------------------------------------------------- custom: image card */
  const imageCard = h('div', { class: 'image-card glass' });
  function renderImageCard(img) {
    imageCard.innerHTML = '';
    const thumb = h('div', { class: 'image-thumb', title: 'Click to choose an image', onclick: selectImage });
    if (img) thumb.append(h('img', { src: img.url, alt: '' }));
    else thumb.append(h('div', { class: 'empty' }, icon('upload'), 'Select or drop an image', h('span', { style: 'font-size:11px' }, state.formats.map((f) => f.toUpperCase()).join(' · '))));
    const custom = img && img.source === 'custom';
    const label = custom ? img.name
      : img ? 'Windows wallpaper (automatic)'
      : settings.useSystemWallpaper ? 'Windows wallpaper not found – neutral gradient in use' : 'No image selected – neutral gradient in use';
    const meta = h('div', { class: 'image-meta' }, icon('image'), h('div', { class: 'image-name', title: img ? img.path : '' }, label),
      img ? h('span', { class: 'preset-tag' }, custom ? 'Custom' : 'Windows') : null);
    const actions = h('div', { class: 'image-actions' },
      h('button', { class: 'btn primary', onclick: selectImage }, icon('upload'), custom ? 'Change image' : 'Select image'),
      h('button', { class: 'btn danger', onclick: removeImage, disabled: custom ? false : 'disabled', title: 'Remove the custom image (falls back to the Windows wallpaper)' }, icon('trash'), 'Remove'));
    imageCard.append(thumb, meta, actions);
  }
  renderImageCard(null);

  async function selectImage() {
    const s = await api.selectImage();
    if (s) { applyRemote(s); toast('Background updated'); }
  }
  async function removeImage() {
    const s = await api.removeImage();
    applyRemote(s);
    toast('Background removed');
  }

  /* ----------------------------------------------- custom: presets panel */
  const presetBox = h('div');
  function renderPresets() {
    presetBox.innerHTML = '';
    const list = h('div', { class: 'preset-list' });
    for (const p of presets) {
      list.append(h('div', { class: 'preset' },
        h('div', { class: 'preset-name' }, p.name),
        p.builtin ? h('span', { class: 'preset-tag' }, 'Built-in') : null,
        h('button', { class: 'btn small', onclick: async () => { applyRemote(await api.applyPreset(p.name)); toast(`Preset “${p.name}” loaded`); } }, 'Load'),
        p.builtin ? null : h('button', { class: 'btn small danger', title: 'Delete', onclick: async () => { presets = await api.deletePreset(p.name); renderPresets(); } }, icon('trash'))));
    }
    const name = h('input', { type: 'text', placeholder: 'Preset name', maxlength: 48 });
    const save = async () => {
      try {
        await flush();
        presets = await api.savePreset(name.value);
        renderPresets();
        toast('Preset saved');
      } catch (e) {
        toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
      }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    presetBox.append(
      h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, 'Save current look'), h('div', { class: 'row' }, h('div', { class: 'preset-save' }, name, h('button', { class: 'btn primary', onclick: save }, icon('save'), 'Save')))),
      h('div', { class: 'group-title', style: 'margin:4px 2px 8px' }, 'Library'), list);
  }
  renderPresets();

  /* ------------------------------------------------ custom: system extra */
  const monitorsBox = h('div');
  const MODES = { progman: 'Behind icons (Windows 11 24H2+)', classic: 'Behind icons (WorkerW)', failed: 'Failed – see log' };
  function renderMonitors() {
    monitorsBox.innerHTML = '';
    const mode = status.attach && status.attach.mode;
    if (mode) monitorsBox.append(h('div', { class: 'row-hint', style: 'margin:4px 0 6px' }, 'Desktop mode: ' + (MODES[mode] || mode)));
    for (const d of status.displays || []) {
      monitorsBox.append(h('div', { class: 'monitor' }, icon('monitor'),
        h('div', {}, h('b', {}, `${d.width} × ${d.height}`), ` · ${Math.round(d.scaleFactor * 100)}% · ${d.refreshRate} Hz${d.primary ? ' · Primary' : ''}`)));
    }
  }
  const systemExtra = h('div', {},
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, 'Monitors'), monitorsBox),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, 'Wallpaper Engine'),
      h('div', { class: 'row' },
        h('div', { class: 'row-hint', style: 'margin-bottom:10px' }, 'Export a web wallpaper project (with your image and current settings) that can be imported into Wallpaper Engine.'),
        h('button', { class: 'btn', onclick: async () => { const out = await api.exportWallpaperEngine(); if (out) toast('Exported to ' + out); } }, icon('export'), 'Export project…'))),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, 'Diagnostics'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => api.openLog() }, icon('export'), 'Open log file'))),
    h('div', { class: 'nav-foot', style: 'display:block;padding:4px 2px' }, `Version ${state.version} · ${state.platform}`));
  renderMonitors();

  /* ------------------------------------------------------- build layout */
  const nav = $('#nav');
  const panel = $('#panel');
  for (const sec of SECTIONS) {
    const item = h('div', { class: 'nav-item', 'data-id': sec.id, onclick: () => show(sec.id) }, icon(sec.id), h('span', {}, sec.title));
    nav.append(item);
    const el = h('section', { class: 'section', 'data-id': sec.id }, h('h2', {}, sec.title), h('p', { class: 'lead' }, sec.lead));
    if (sec.custom === 'image') el.append(imageCard);
    if (sec.custom === 'presets') el.append(presetBox);
    for (const g of sec.groups) el.append(h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, g.title), g.items.map(buildControl)));
    if (sec.custom === 'system') el.append(systemExtra);
    panel.append(el);
  }
  nav.append(h('div', { class: 'nav-spacer' }), h('div', { class: 'nav-foot' }, 'Double-click a slider to reset it'));
  refreshDependencies();

  function show(id) {
    for (const n of nav.querySelectorAll('.nav-item')) n.classList.toggle('active', n.dataset.id === id);
    for (const s of panel.querySelectorAll('.section')) s.classList.toggle('active', s.dataset.id === id);
    try { localStorage.setItem('tab', id); } catch { /* ignore */ }
  }
  let initialTab = 'background';
  try { initialTab = localStorage.getItem('tab') || initialTab; } catch { /* ignore */ }
  show(SECTIONS.some((s) => s.id === initialTab) ? initialTab : 'background');

  /* ------------------------------------------------------------ toolbar */
  const btnPause = $('#btnPause');
  function renderPause() {
    btnPause.innerHTML = '';
    btnPause.append(icon(paused ? 'play' : 'pause'), h('span', {}, paused ? 'Resume rain' : 'Pause rain'));
  }
  btnPause.addEventListener('click', () => { paused = !paused; engine && engine.setPaused(paused); renderPause(); api.setPaused(paused); });
  $('#btnResetRain').addEventListener('click', () => { engine && engine.reset(); api.resetRain(); });
  $('#btnFullscreen').addEventListener('click', () => $('#previewCard').requestFullscreen().catch(() => {}));
  $('#btnResetSettings').addEventListener('click', async () => { applyRemote(await api.resetSettings()); toast('Settings restored to defaults'); });
  renderPause();

  async function flush() {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; const p = pending; pending = {}; await api.setSettings(p); }
  }

  /* ------------------------------------------------------------- status */
  function renderStatus() {
    const el = $('#status');
    el.className = 'status';
    let text;
    if (status.attach && status.attach.mode === 'failed') { el.classList.add('error'); text = 'Desktop attach failed'; el.title = status.attach.error || ''; }
    else if (status.error) { el.classList.add('error'); text = 'Wallpaper error'; el.title = status.error; }
    else if (!status.enabled) text = 'Wallpaper off';
    else if (status.suspended) { el.classList.add('suspended'); text = 'Sleeping · ' + ({ fullscreen: 'fullscreen app', battery: 'on battery', locked: 'locked', sleep: 'system sleep' }[status.reason] || 'paused'); }
    else if (paused) { el.classList.add('paused'); text = 'Paused'; }
    else { el.classList.add('live'); text = 'Live' + (status.fps ? ` · ${status.fps} FPS` : ''); }
    $('#statusText').textContent = text;

    const info = $('#infoRow');
    info.innerHTML = '';
    const n = (status.displays || []).length;
    info.append(
      h('span', { class: 'chip' }, 'Monitors ', h('b', {}, String(n))),
      h('span', { class: 'chip' }, 'Preview ', h('b', {}, engine ? `${engine.fps || '–'} FPS` : 'off')),
      h('span', { class: 'chip' }, 'Drops ', h('b', {}, engine ? String(engine.sim.drops.length) : '–')));
  }
  renderStatus();
  setInterval(renderStatus, 1000);

  /* -------------------------------------------------------------- events */
  api.onSettings((s) => applyRemote(s));
  api.onPause((p) => { paused = p; engine && engine.setPaused(p); renderPause(); renderStatus(); });
  api.onStatus((s) => { status = s; renderStatus(); renderMonitors(); });

  // Pause the preview while the window is hidden/minimised.
  document.addEventListener('visibilitychange', () => engine && engine.setSuspended(document.hidden));

  // Drag & drop images.
  const overlay = $('#dropOverlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; overlay.classList.add('show'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('show'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('show');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const p = api.pathForFile(file);
    try {
      applyRemote(await api.setImagePath(p));
      toast('Background updated');
    } catch (err) {
      toast(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    }
  });

  // Space toggles pause (outside text inputs).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) { e.preventDefault(); btnPause.click(); }
  });

  let toastTimer;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!error);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  loadPreviewImage();
})();
