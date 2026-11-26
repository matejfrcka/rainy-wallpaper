/* Settings window: schema-driven controls + live preview engine. */
(async function () {
  'use strict';
  const api = window.rainApi;
  const { DEFAULT_SETTINGS } = window.RainGlassDefaults;
  const state = await api.getState();
  const { t } = window.RainGlassI18n;
  window.RainGlassI18n.setLanguage(state.lang);
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.textContent.trim());
  for (const el of document.querySelectorAll('[title]')) el.title = t(el.title);
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
    online: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
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
      id: 'background', title: t('Background'), lead: t('Choose any image from your computer. The rain layer never modifies it.'),
      custom: 'image',
      groups: [
        { title: t('Source'), items: [
          toggle('useSystemWallpaper', t('Use Windows wallpaper automatically'), { hint: t('When no custom image is selected, the rain is applied over your current Windows desktop wallpaper.') }),
        ] },
        { title: t('Layout'), items: [
          seg('fitMode', t('Scaling'), [['fill', t('Fill')], ['fit', t('Fit')], ['stretch', t('Stretch')]], { hint: t('Fill crops to cover the monitor, Fit shows the whole image.') }),
          slider('bgZoom', t('Zoom'), { min: 100, max: 200 }),
          slider('bgPosX', t('Horizontal position'), { unit: '', format: (v) => (v < 45 ? t('Left ') : v > 55 ? t('Right ') : t('Center ')) + Math.round(v) }),
          slider('bgPosY', t('Vertical position'), { unit: '', format: (v) => (v < 45 ? t('Top ') : v > 55 ? t('Bottom ') : t('Center ')) + Math.round(v) }),
        ] },
        { title: t('Adjustments'), items: [
          slider('bgBrightness', t('Brightness'), { max: 200 }),
          slider('bgBlur', t('Blur')),
          slider('parallax', t('Depth parallax'), { hint: t('The background moves slightly with the cursor, like looking through a real window.') }),
        ] },
      ],
    },
    {
      id: 'rain', title: t('Rain'), lead: t('Physics of the water on the glass.'),
      groups: [
        { title: t('Weather'), items: [
          seg('precipitation', t('Weather'), [['rain', t('Rain')], ['snow', t('Snow')]], { hint: t('Snow shows its own settings below.') }),
        ] },
        { title: t('Snow'), showIf: (st) => st.precipitation === 'snow', items: [
          slider('snowIntensity', t('Snow intensity'), { hint: t('How much snow sticks to the glass.') }),
          slider('flakeSize', t('Flake size')),
          slider('snowMelt', t('Melting speed'), { hint: t('How fast the snow on the glass melts away.') }),
          slider('snowFall', t('Falling snow outside'), { hint: t('Snowflakes falling behind the window. 0 = off.') }),
          slider('frost', t('Frost'), { hint: t('Ice crystals grow from the window frame. Wipe them with the mouse.') }),
        ] },
        { title: t('Amount'), showIf: (st) => st.precipitation !== 'snow', items: [
          slider('rainIntensity', t('Rain intensity'), { hint: t('How often new drops hit the window.') }),
          slider('dropletDensity', t('Droplet density'), { hint: t('Tiny static droplets covering the glass.') }),
          slider('dropletSize', t('Droplet size')),
        ] },
        { title: t('Motion'), showIf: (st) => st.precipitation !== 'snow', items: [
          slider('dropletSpeed', t('Droplet speed')),
          slider('trailLength', t('Water trail length')),
          toggle('merging', t('Droplet merging'), { hint: t('Drops that touch combine into larger, faster drops.') }),
          toggle('randomGeneration', t('Random droplet generation'), { hint: t('New drops keep forming. Off = the glass slowly dries.') }),
        ] },
        { title: t('Interaction'), items: [
          toggle('mouseInteraction', t('Wipe the glass with the mouse'), { hint: t('Moving the cursor over the desktop wipes condensation and droplets, like a finger.') }),
        ] },
      ],
    },
    {
      id: 'glass', title: t('Glass'), lead: t('Optical properties of the window and the water lenses.'),
      groups: [
        { title: t('Optics'), items: [
          slider('refraction', t('Refraction intensity')),
          slider('distortion', t('Distortion intensity')),
          slider('chromatic', t('Chromatic refraction')),
          slider('blur', t('Blur intensity'), { hint: t('Defocus inside large drops.') }),
        ] },
        { title: t('Surface'), items: [
          slider('glassTransparency', t('Glass transparency')),
          slider('reflection', t('Reflection intensity')),
          toggle('condensationEnabled', t('Condensation / fog')),
          slider('condensation', t('Condensation intensity'), { dependsOn: 'condensationEnabled' }),
          toggle('streaksEnabled', t('Rain streaks'), { hint: t('Out-of-focus rain falling outside.') }),
          slider('streaks', t('Streak intensity'), { dependsOn: 'streaksEnabled' }),
        ] },
      ],
    },
    {
      id: 'atmosphere', title: t('Atmosphere'), lead: t('Sound and light. Audio plays from the desktop wallpaper.'),
      custom: 'weather',
      groups: [
        { title: t('Sound'), items: [
          toggle('soundEnabled', t('Rain sound')),
          slider('volume', t('Rain ambience volume'), { dependsOn: 'soundEnabled' }),
          seg('soundscape', t('Soundscape'), [['window', t('Window')], ['roof', t('Tin roof')], ['leaves', t('Leaves')], ['car', t('Car')]], { dependsOn: 'soundEnabled' }),
          toggle('windEnabled', t('Wind'), { dependsOn: 'soundEnabled' }),
          slider('windVolume', t('Wind volume'), { dependsOn: 'windEnabled' }),
          toggle('thunderEnabled', t('Thunder'), { hint: t('Occasional distant or close thunder.') }),
          slider('thunderFrequency', t('Thunder frequency'), { dependsOn: 'thunderEnabled', unit: '', format: (v) => (v < 25 ? t('Rarely') : v < 60 ? t('Sometimes') : v < 85 ? t('Often') : t('Very often')) + ' · ' + Math.round(v) }),
          toggle('lightning', t('Lightning flashes'), { dependsOn: 'thunderEnabled' }),
        ] },
        { title: t('Color'), items: [
          toggle('autoDayNight', t('Automatic day / night'), { hint: t('Follows the sun at your location (weather city, otherwise your time zone).') }),
          slider('dayNight', t('Day / Night'), { disabledBy: 'autoDayNight', unit: '', format: (v) => (v < 40 ? t('Night ') : v > 60 ? t('Day ') : t('Neutral ')) + Math.round(v) }),
        ] },
      ],
    },
    { id: 'online', title: t('Online'), lead: t('Search millions of free photos and videos and use them as the background.'), custom: 'online', groups: [] },
    { id: 'presets', title: t('Presets'), lead: t('Save and load your favourite looks. Presets never change your image.'), custom: 'presets', groups: [] },
    {
      id: 'system', title: t('System'), lead: t('Desktop integration and performance.'),
      custom: 'system',
      groups: [
        { title: t('Desktop'), items: [
          toggle('wallpaperEnabled', t('Live wallpaper'), { hint: t('Show the rain on your desktop (all monitors).') }),
          state.store
            ? toggle('startWithWindows', t('Start with Windows'), { hint: t('Microsoft Store version: turn on "Rainy Glass" in Task Manager → Startup apps.'), disabled: true })
            : toggle('startWithWindows', t('Start with Windows')),
          toggle('pauseOnFullscreen', t('Pause when a fullscreen app or game runs')),
          toggle('pauseWhenCovered', t('Pause on monitors covered by maximized windows'), { hint: t('Saves GPU while you work; sound keeps playing.') }),
          toggle('pauseOnBattery', t('Pause on battery power')),
          seg('taskbarStyle', t('Taskbar'), [['default', t('Default')], ['clear', t('Clear')], ['blur', t('Blur')], ['acrylic', t('Frosted')]], { hint: t('Makes the taskbar see-through so the rain keeps running underneath it. Works best on Windows 10 and Windows 11 21H2; newer Windows 11 builds may partly ignore it.') }),
          toggle('hotkeysEnabled', t('Global shortcuts'), { hint: t('Ctrl+Alt+R pause / resume rain · Ctrl+Alt+W wallpaper on / off · Ctrl+Alt+S open settings') }),
          { type: 'text', key: 'pauseApps', label: t('Pause for these apps'), placeholder: 'photoshop.exe, premiere.exe', hint: t('Comma separated program names. The wallpaper pauses while one of them is in front.') },
        ] },
        { title: t('Screensaver'), items: [
          toggle('screensaverEnabled', t('Rain screensaver')),
          slider('screensaverMinutes', t('Start after'), { min: 1, max: 120, unit: ' min', dependsOn: 'screensaverEnabled' }),
          toggle('screensaverClock', t('Show clock'), { dependsOn: 'screensaverEnabled' }),
          { type: 'button', label: t('Try screensaver'), onClick: () => api.testScreensaver() },
        ] },
        { title: t('Language'), items: [
          { type: 'select', key: 'language', label: t('Language'), options: [['auto', t('Automatic')], ['en', 'English'], ['sk', 'Slovenčina'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['hu', 'Magyar']] },
        ] },
        { title: t('Updates'), items: [
          toggle('autoUpdate', t('Install updates automatically')),
        ] },
        { title: t('Performance'), items: [
          seg('fpsLimit', t('Frame rate'), [[30, '30'], [60, '60'], [0, t('Max')]]),
          slider('renderScale', t('Render resolution'), { min: 50, max: 100, hint: t('Lower values save GPU on 4K displays.') }),
        ] },
      ],
    },
  ];

  /* -------------------------------------------------------------- state */
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
    $('#previewBadge').textContent = t('Preview unavailable: ') + e.message;
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
      if (engine) await engine.setBackgroundMedia(img);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrl = img.kind === 'video' ? null : URL.createObjectURL(new Blob([img.data], { type: img.mime }));
      renderImageCard({ url: thumbUrl || img.url, video: img.kind === 'video', name: img.name, path: img.path, source: img.source });
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
    renderGallery();
    if (document.querySelector('.section.active[data-id="presets"]')) { renderPresets(); renderSchedule(); }
  }

  function refreshDependencies() {
    // Groups shown only for one weather type (rain / snow).
    for (const sec of SECTIONS) for (const g of sec.groups) {
      if (g.showIf && g.__el) g.__el.style.display = g.showIf(settings) ? '' : 'none';
    }
    for (const sec of SECTIONS) for (const g of sec.groups) for (const it of g.items) {
      if (!it.dependsOn && !it.disabledBy && !it.disabled) continue;
      const c = controls.get(it.key);
      const off = it.disabled || (it.dependsOn && !settings[it.dependsOn]) || (it.disabledBy && settings[it.disabledBy]);
      if (c) c.row.classList.toggle('disabled', !!off);
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
    } else if (it.type === 'text') {
      const input = h('input', { type: 'text', placeholder: it.placeholder || '', maxlength: 600, style: 'margin-top:8px;width:100%' });
      update = (v) => { if (document.activeElement !== input) input.value = v || ''; };
      input.addEventListener('change', () => change({ [it.key]: input.value }));
      row.append(input);
    } else if (it.type === 'select') {
      const sel = h('select', { class: 'select', style: 'flex:0 0 auto;min-width:150px' }, it.options.map(([v, l]) => h('option', { value: v }, l)));
      update = (v) => { sel.value = v; };
      sel.addEventListener('change', () => change({ [it.key]: sel.value }));
      head.append(sel);
    } else if (it.type === 'button') {
      head.append(h('button', { class: 'btn small', onclick: it.onClick }, it.label));
      labelBox.innerHTML = '';
      update = () => {};
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
    controls.set(it.key || it.label, { update, row });
    return row;
  }

  /* -------------------------------------------------- custom: image card */
  const imageCard = h('div', { class: 'image-card glass' });
  function renderImageCard(img) {
    imageCard.innerHTML = '';
    const thumb = h('div', { class: 'image-thumb', title: t('Click to choose an image'), onclick: selectImage });
    if (img && img.video) {
      const v = h('video', { src: img.url, muted: '', autoplay: '', loop: '', playsinline: '', crossorigin: 'anonymous' });
      v.muted = true;
      thumb.append(v);
    } else if (img) thumb.append(h('img', { src: img.url, alt: '' }));
    else thumb.append(h('div', { class: 'empty' }, icon('upload'), t('Select or drop an image'), h('span', { style: 'font-size:11px' }, state.formats.map((f) => f.toUpperCase()).join(' · '))));
    const custom = img && img.source === 'custom';
    if (img && img.credit) img.name = `${img.credit.provider} · ${img.credit.user}`;
    const label = custom ? img.name
      : img ? t('Windows wallpaper (automatic)')
      : settings.useSystemWallpaper ? t('Windows wallpaper not found – neutral gradient in use') : t('No image selected – neutral gradient in use');
    const meta = h('div', { class: 'image-meta' }, icon('image'), h('div', { class: 'image-name', title: img ? img.path : '' }, label),
      img ? h('span', { class: 'preset-tag' }, img.gallery ? t('Gallery') : custom ? t('Custom') : t('Windows')) : null);
    const actions = h('div', { class: 'image-actions' },
      h('button', { class: 'btn primary', onclick: selectImage }, icon('upload'), custom ? t('Change image') : t('Select image')),
      h('button', { class: 'btn danger', onclick: removeImage, disabled: custom ? false : 'disabled', title: t('Remove the custom image (falls back to the Windows wallpaper)') }, icon('trash'), t('Remove')));
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

  /* ------------------------------------------- custom: online (Pixabay) */
  const onl = { type: 'photo', query: '', page: 1, total: 0, items: [], busy: false, progress: new Map() };
  const onlineGrid = h('div', { class: 'preset-grid online-grid' });
  const onlineInfo = h('div', { class: 'row-hint' });
  const onlineMore = h('button', { class: 'btn', style: 'display:none;margin-top:10px', onclick: () => onlineSearch(false) }, t('Load more'));
  const onlineHistoryBox = h('div', { class: 'preset-grid online-grid' });
  const searchInput = h('input', { type: 'text', placeholder: t('Search, e.g. rainy city night'), maxlength: 100 });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onl.query = searchInput.value; onlineSearch(true); } });
  const typeSeg = h('div', { class: 'segmented' });
  for (const [val, label] of [['photo', t('Photos')], ['video', t('Videos')]]) {
    const b = h('button', { onclick: () => { onl.type = val; renderTypeSeg(); onlineSearch(true); } }, label);
    b.__v = val;
    typeSeg.append(b);
  }
  function renderTypeSeg() { for (const b of typeSeg.children) b.classList.toggle('active', b.__v === onl.type); }
  renderTypeSeg();
  const CATS = [['rainy street', t('Rain')], ['city night', t('Night city')], ['forest fog', t('Forest')], ['mountains lake', t('Mountains')],
    ['snow winter', t('Snow')], ['cozy cabin', t('Cozy')], ['autumn', t('Autumn')], ['ocean waves', t('Ocean')], ['neon', t('Neon')], ['abstract', t('Abstract')]];
  const chips = h('div', { class: 'chips' }, CATS.map(([q, label]) => h('button', { class: 'chip-btn', onclick: () => { searchInput.value = q; onl.query = q; onlineSearch(true); } }, label)));

  function onlineCard(it, fromHistory) {
    const p = onl.progress.get(it.id);
    const use = async () => {
      if (onl.progress.has(it.id)) return;
      onl.progress.set(it.id, 0);
      renderOnline();
      try {
        applyRemote(await api.onlineUse(it));
        toast(t('Background updated'));
      } catch (e) {
        toast(errText(e), true);
      } finally {
        onl.progress.delete(it.id);
        renderOnline();
        refreshOnlineHistory();
      }
    };
    return h('div', { class: 'preset-card' },
      h('div', { class: 'preset-thumb', style: `background-image:url(${it.thumb})`, onclick: use, title: it.tags || '' },
        it.type === 'video' ? h('span', { class: 'thumb-badge' }, '▶ ' + (it.duration ? it.duration + ' s' : '')) : null,
        p !== undefined ? h('span', { class: 'thumb-progress' }, Math.round(p * 100) + ' %') : null),
      h('div', { class: 'preset-meta' },
        h('div', { class: 'preset-name', title: it.user }, it.user || 'Pixabay'),
        h('button', { class: 'btn small ghost', title: t('Open on Pixabay'), onclick: () => api.onlineOpen(it.page) }, icon('export'))));
  }

  function renderOnline() {
    onlineGrid.innerHTML = '';
    for (const it of onl.items) onlineGrid.append(onlineCard(it));
    onlineMore.style.display = onl.items.length && onl.items.length < onl.total ? '' : 'none';
  }

  async function onlineSearch(reset) {
    if (onl.busy) return;
    onl.busy = true;
    if (reset) { onl.page = 1; onl.items = []; renderOnline(); }
    onlineInfo.textContent = t('Searching…');
    try {
      const res = await api.onlineSearch({ type: onl.type, query: onl.query, page: onl.page });
      onl.total = res.total;
      onl.items = onl.items.concat(res.items);
      onl.page++;
      onlineInfo.textContent = onl.items.length ? `${res.total} ${t('results')} · ${t('Images and videos from Pixabay')}` : t('Nothing found – try another word (English works best).');
      renderOnline();
    } catch (e) {
      const msg = errText(e);
      onlineInfo.textContent = msg === 'NO_KEY' ? t('No Pixabay API key – enter your own key below.') : msg;
    } finally {
      onl.busy = false;
    }
  }

  async function refreshOnlineHistory() {
    const list = await api.onlineHistory();
    onlineHistoryBox.innerHTML = '';
    for (const m of list.slice(0, 12)) {
      onlineHistoryBox.append(h('div', { class: 'preset-card' },
        h('div', { class: 'preset-thumb', style: `background-image:url(${m.thumb})`, title: m.user,
          onclick: async () => { applyRemote(await api.setImagePath(m.file)); toast(t('Background updated')); } },
        m.type === 'video' ? h('span', { class: 'thumb-badge' }, '▶') : null),
        h('div', { class: 'preset-meta' }, h('div', { class: 'preset-name' }, m.user || 'Pixabay'))));
    }
    historyGroup.style.display = list.length ? '' : 'none';
  }
  api.onOnlineProgress(({ id, progress }) => {
    onl.progress.set(id, progress);
    const idx = onl.items.findIndex((x) => x.id === id);
    const el = onlineGrid.children[idx] && onlineGrid.children[idx].querySelector('.thumb-progress');
    if (el) el.textContent = Math.round(progress * 100) + ' %';
  });

  const historyGroup = h('div', { class: 'group glass', style: 'display:none' }, h('div', { class: 'group-title' }, t('Recently used')), h('div', { class: 'row' }, onlineHistoryBox));
  const onlineBox = h('div', {},
    h('div', { class: 'group glass' },
      h('div', { class: 'row' },
        h('div', { class: 'preset-save' }, searchInput, h('button', { class: 'btn primary', onclick: () => { onl.query = searchInput.value; onlineSearch(true); } }, icon('search'), t('Search'))),
        h('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap' }, typeSeg, chips)),
      h('div', { class: 'row' }, onlineInfo, onlineGrid, onlineMore)),
    historyGroup,
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Own API key (optional)')),
      buildControl({ type: 'text', key: 'pixabayKey', label: t('Pixabay API key'), placeholder: t('Leave empty to use the built-in key'), hint: t('Get a free key at pixabay.com/api/docs after logging in.') })));
  refreshOnlineHistory();
  let onlineStarted = false;

  /* ---------------------------------------------- custom: scene gallery */
  const G = window.RainGlassGallery;
  const galleryGrid = h('div', { class: 'preset-grid' });
  const progress = new Map(); // scene id -> 0..1 while downloading
  let scenes = G.SCENES.map((x) => ({ ...x, hasVideo: false }));
  async function pickScene(ref) {
    try {
      applyRemote(await api.setGallery(ref));
      toast(t('Background updated'));
    } catch (e) {
      toast(errText(e), true);
    } finally {
      progress.clear();
      scenes = await api.galleryList();
      renderGallery();
    }
  }
  function renderGallery() {
    galleryGrid.innerHTML = '';
    const cur = G.parse(settings.backgroundPath);
    for (const sc of scenes) {
      const active = cur && cur.id === sc.id;
      const p = progress.get(sc.id);
      galleryGrid.append(h('div', { class: 'preset-card' + (active ? ' active' : '') },
        h('div', { class: 'preset-thumb', style: `background-image:url(../../../assets/backgrounds/thumbs/${sc.id}.jpg)`, onclick: () => pickScene(G.ref(sc.id)), title: t(sc.name) }),
        h('div', { class: 'preset-meta' }, h('div', { class: 'preset-name' }, t(sc.name)), active ? h('span', { class: 'preset-tag' }, cur.video ? t('Animated') : t('Image')) : null),
        h('div', { class: 'preset-actions' },
          h('button', { class: 'btn small', onclick: () => pickScene(G.ref(sc.id)) }, t('Image')),
          h('button', { class: 'btn small', disabled: p !== undefined ? 'disabled' : false, onclick: () => { progress.set(sc.id, 0); renderGallery(); pickScene(G.ref(sc.id, true)); } },
            icon('play'), p !== undefined ? Math.round(p * 100) + ' %' : (sc.hasVideo ? t('Animated') : t('Animated') + ' ↓')))));
    }
  }
  api.onGalleryProgress(({ id, progress: pr }) => {
    progress.set(id, pr);
    const btns = galleryGrid.querySelectorAll('.preset-card');
    const idx = scenes.findIndex((x) => x.id === id);
    const b = btns[idx] && btns[idx].querySelectorAll('button')[1];
    if (b) b.lastChild.textContent = Math.round(pr * 100) + ' %';
  });
  const galleryBox = h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Gallery')),
    buildControl(toggle('galleryMatchLook', t('Match the look'), { hint: t('Choosing a scene also applies the rain preset that suits it.') })),
    h('div', { class: 'row' }, galleryGrid));
  api.galleryList().then((list) => { scenes = list; renderGallery(); });

  /* ----------------------------------------------- custom: presets panel */
  const presetBox = h('div');
  const thumbs = new Map();     // preset name + image key -> data URL
  let thumbEngine = null, thumbBusy = false;

  /** Render a small still of each preset over the current background (offscreen WebGL). */
  async function generateThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    try {
      const todo = presets.filter((p) => !thumbs.has(p.name + '|' + settings.imageKey));
      if (!todo.length) return;
      if (!thumbEngine) {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        thumbEngine = new RainGlass.Engine(c, { audio: false, lightningSource: false, pixelRatio: 1 });
        thumbEngine.imageKey = null;
      }
      if (thumbEngine.imageKey !== settings.imageKey) {
        thumbEngine.imageKey = settings.imageKey;
        const img = settings.imageKey && settings.imageKey !== 'none' ? await api.readImage() : null;
        await thumbEngine.setBackgroundMedia(img);
        thumbEngine.updateMedia(performance.now());
      }
      for (const p of todo) {
        thumbEngine.setSettings({ ...DEFAULT_SETTINGS, ...settings, ...p.values, renderScale: 100, fpsLimit: 0 });
        thumbEngine.sim.clear();
        thumbEngine.sim.seed();
        for (let i = 0; i < 150; i++) thumbEngine.sim.update(1 / 60);
        thumbEngine.renderOnce();
        thumbs.set(p.name + '|' + settings.imageKey, thumbEngine.canvas.toDataURL('image/jpeg', 0.82));
        const el = presetBox.querySelector(`[data-thumb="${CSS.escape(p.name)}"]`);
        if (el) el.style.backgroundImage = `url(${thumbs.get(p.name + '|' + settings.imageKey)})`;
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      console.error('thumbnails', e);
    } finally {
      thumbBusy = false;
    }
  }

  const errText = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function renderPresets() {
    presetBox.innerHTML = '';
    const grid = h('div', { class: 'preset-grid' });
    for (const p of presets) {
      const thumb = thumbs.get(p.name + '|' + settings.imageKey);
      const load = async () => { applyRemote(await api.applyPreset(p.name)); toast(`${t('Preset loaded')}: ${p.name}`); };
      grid.append(h('div', { class: 'preset-card' },
        h('div', { class: 'preset-thumb', 'data-thumb': p.name, style: thumb ? `background-image:url(${thumb})` : '', onclick: load, title: t('Load') }),
        h('div', { class: 'preset-meta' },
          h('div', { class: 'preset-name' }, p.name),
          p.builtin ? h('span', { class: 'preset-tag' }, t('Built-in')) : null),
        h('div', { class: 'preset-actions' },
          h('button', { class: 'btn small', onclick: load }, t('Load')),
          h('button', { class: 'btn small ghost', title: t('Export'), onclick: async () => { try { if (await api.exportPreset(p.name)) toast(t('Preset exported')); } catch (e) { toast(errText(e), true); } } }, icon('export')),
          p.builtin ? null : h('button', { class: 'btn small danger', title: t('Delete'), onclick: async () => { presets = await api.deletePreset(p.name); renderPresets(); } }, icon('trash')))));
    }
    const name = h('input', { type: 'text', placeholder: t('Preset name'), maxlength: 48 });
    const save = async () => {
      try {
        await flush();
        presets = await api.savePreset(name.value);
        thumbs.delete(name.value.trim() + '|' + settings.imageKey);
        renderPresets();
        toast(t('Preset saved'));
      } catch (e) {
        toast(errText(e), true);
      }
    };
    const importBtn = h('button', { class: 'btn', onclick: async () => {
      try { const r = await api.importPresets(); if (r) { presets = r; renderPresets(); toast(t('Preset imported')); } } catch (e) { toast(errText(e), true); }
    } }, icon('upload'), t('Import…'));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    presetBox.append(
      h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Save current look')),
        h('div', { class: 'row' }, h('div', { class: 'preset-save' }, name, h('button', { class: 'btn primary', onclick: save }, icon('save'), t('Save')), importBtn))),
      h('div', { class: 'group-title', style: 'margin:4px 2px 8px' }, t('Library')), grid);
    if (document.querySelector('.section.active[data-id="presets"]')) generateThumbs();
  }
  renderPresets();

  /* ---------------------------------------------- custom: live weather */
  const weatherInfo = h('div', { class: 'row-hint', style: 'margin-top:8px' });
  const cityInput = h('input', { type: 'text', placeholder: t('City, e.g. Bratislava'), maxlength: 80 });
  const searchWeather = async () => {
    if (!cityInput.value.trim()) return;
    try {
      applyRemote(await api.searchWeather(cityInput.value.trim()));
      toast(t('Weather location set: ') + settings.weatherCity);
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
    }
  };
  cityInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchWeather(); });
  function renderWeather() {
    cityInput.placeholder = settings.weatherCity || t('City, e.g. Bratislava');
    const w = status.weather;
    weatherInfo.textContent = !settings.weatherCity ? t('Rain intensity and thunder follow the real weather at your location (Open-Meteo).')
      : w && w.error ? `${settings.weatherCity}: ${w.error}`
      : w && w.text ? `${settings.weatherCity}: ${w.text}, ${Math.round(w.temp)} °C, ${w.precip} mm/h · ${t('updated')} ${new Date(w.time).toLocaleTimeString()}`
      : settings.weatherCity;
  }
  const weatherBox = h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Live weather')),
    buildControl(toggle('weatherSync', t('Sync rain with real weather'), { hint: t('Updates every 10 minutes: rain, snow, thunder, fog and wind follow the real weather. Manual changes are overwritten on the next update.') })),
    h('div', { class: 'row' }, h('div', { class: 'preset-save' }, cityInput, h('button', { class: 'btn primary', onclick: searchWeather }, t('Set location'))), weatherInfo));
  renderWeather();

  /* ---------------------------------------------- custom: sleep timer */
  let sleepAction = 'sound';
  try { sleepAction = localStorage.getItem('sleepAction') || 'sound'; } catch { /* ignore */ }
  const actionSeg = h('div', { class: 'segmented' });
  for (const [val, label] of [['sound', t('Sound off')], ['shutdown', t('Shut down PC')], ['sleep', t('Sleep PC')]]) {
    const b = h('button', { onclick: () => {
      sleepAction = val;
      try { localStorage.setItem('sleepAction', val); } catch { /* ignore */ }
      // Re-arm a running timer with the new action (keeps the remaining time).
      if (status.sleep) api.setSleep(Math.max(1, Math.round((status.sleep.endsAt - Date.now()) / 60000)), val);
      renderSleep();
    } }, label);
    b.__a = val;
    actionSeg.append(b);
  }
  const sleepSeg = h('div', { class: 'segmented' });
  const sleepInfo = h('div', { class: 'row-hint', style: 'margin-top:6px' });
  for (const m of [0, 15, 30, 60, 90, 120]) {
    const b = h('button', { onclick: () => api.setSleep(m, sleepAction) }, m ? `${m} min` : t('Off'));
    b.__m = m;
    sleepSeg.append(b);
  }
  function renderSleep() {
    const sl = status.sleep;
    const act = sl ? sl.action : sleepAction;
    for (const b of actionSeg.children) b.classList.toggle('active', b.__a === act);
    for (const b of sleepSeg.children) b.classList.toggle('active', sl ? b.__m === sl.minutes : b.__m === 0);
    if (sl) {
      const left = Math.max(0, Math.round((sl.endsAt - Date.now()) / 60000));
      const what = { sound: t('Sound fades out in'), shutdown: t('PC shuts down in'), sleep: t('PC goes to sleep in') }[sl.action] || t('Sound fades out in');
      sleepInfo.textContent = `${what} ${left} min`;
    } else {
      sleepInfo.textContent = { sound: t('The rain sound slowly fades out and turns off.'), shutdown: t('The sound fades out, then the PC shuts down. Windows warns you a minute before so you can still cancel it.'), sleep: t('The sound fades out, then the PC goes to sleep.') }[act];
    }
  }
  const sleepBox = h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Sleep timer')),
    h('div', { class: 'row' }, h('div', { class: 'row-head' }, h('div', {}, h('div', { class: 'row-label' }, t('When the time is up'))), actionSeg)),
    h('div', { class: 'row' }, h('div', { class: 'row-head' }, h('div', {}, h('div', { class: 'row-label' }, t('After'))), sleepSeg), sleepInfo));
  renderSleep();
  setInterval(renderSleep, 15000);

  /* ------------------------------------------------- custom: scheduler */
  const scheduleList = h('div');
  function saveSchedule(list) { change({ schedule: list }); renderSchedule(); }
  function renderSchedule() {
    scheduleList.innerHTML = '';
    const list = (settings.schedule || []).map((e) => ({ ...e }));
    list.forEach((e, i) => {
      const time = h('input', { type: 'time', value: e.time, class: 'time-input' });
      time.addEventListener('change', () => { list[i].time = time.value || '08:00'; saveSchedule(list); });
      const sel = h('select', { class: 'select' }, h('option', { value: '' }, t('Keep current look')),
        presets.map((p) => h('option', { value: p.name, selected: p.name === e.preset ? '' : false }, p.name)));
      sel.addEventListener('change', () => { list[i].preset = sel.value; saveSchedule(list); });
      // Image: keep / gallery scene (still or animated) / custom file
      const G = window.RainGlassGallery;
      const isFile = e.image && !G.parse(e.image);
      const imgSel = h('select', { class: 'select', title: e.image || '' },
        h('option', { value: '' }, t('Keep current image')),
        G.SCENES.map((sc) => h('option', { value: G.ref(sc.id), selected: e.image === G.ref(sc.id) ? '' : false }, t(sc.name))),
        G.SCENES.map((sc) => h('option', { value: G.ref(sc.id, true), selected: e.image === G.ref(sc.id, true) ? '' : false }, `${t(sc.name)} · ${t('Animated')}`)),
        isFile ? h('option', { value: e.image, selected: '' }, e.image.split(/[\\/]/).pop().slice(0, 24)) : null,
        h('option', { value: '__file' }, t('Custom file…')));
      imgSel.addEventListener('change', async () => {
        if (imgSel.value === '__file') {
          const p = await api.pickScheduleImage();
          if (p) list[i].image = p;
        } else list[i].image = imgSel.value;
        saveSchedule(list);
      });
      const imgBtn = imgSel, clearImg = null;
      const del = h('button', { class: 'btn small danger', title: t('Delete'), onclick: () => { list.splice(i, 1); saveSchedule(list); } }, icon('trash'));
      scheduleList.append(h('div', { class: 'schedule-row' }, time, sel, imgBtn, clearImg, del));
    });
    scheduleList.append(h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => {
      const last = list[list.length - 1];
      const next = last ? `${String((Number(last.time.slice(0, 2)) + 6) % 24).padStart(2, '0')}:00` : '07:00';
      list.push({ time: next, preset: '', image: '' });
      saveSchedule(list);
    } }, '+ ' + t('Add time')));
  }
  const scheduleBox = h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Schedule')),
    buildControl(toggle('scheduleEnabled', t('Change the look during the day'), { hint: t('E.g. foggy morning, steady rain in the afternoon, storm at night – with its own image.') })),
    h('div', { class: 'row' }, scheduleList));
  renderSchedule();

  /* ------------------------------------------------ custom: system extra */
  const updateInfo = h('div', { class: 'row-hint' });
  const updateBtn = h('button', { class: 'btn primary', style: 'display:none', onclick: () => api.installUpdate() }, t('Restart to update'));
  function renderUpdate() {
    const u = status.update || {};
    const map = { unsupported: t('Automatic updates work in the installed version.'), checking: t('Checking for updates…'), latest: t('You have the latest version.'),
      available: `${t('Downloading update')} ${u.version || ''}`, downloading: `${t('Downloading update')} ${u.percent || 0} %`, ready: `${t('Update ready')}: ${u.version}`, error: `${t('Update failed')}: ${u.error}` };
    updateInfo.textContent = map[u.status] || '';
    updateBtn.style.display = u.status === 'ready' ? '' : 'none';
  }
  const monitorsBox = h('div');
  const perfBox = h('div', { class: 'info-row', style: 'padding:6px 0 10px' });
  const MODES = { progman: t('Behind icons (Windows 11 24H2+)'), classic: t('Behind icons (WorkerW)'), failed: t('Failed – see log') };
  function renderMonitors() {
    monitorsBox.innerHTML = '';
    const mode = status.attach && status.attach.mode;
    if (mode) monitorsBox.append(h('div', { class: 'row-hint', style: 'margin:4px 0 6px' }, t('Desktop mode: ') + (MODES[mode] || mode)));
    for (const d of status.displays || []) {
      monitorsBox.append(h('div', { class: 'monitor' }, icon('monitor'),
        h('div', {}, h('b', {}, `${d.width} × ${d.height}`), ` · ${Math.round(d.scaleFactor * 100)}% · ${d.refreshRate} Hz${d.primary ? t(' · Primary') : ''}${d.covered ? t(' · paused (covered)') : ''}`)));
    }
    const m = status.metrics;
    if (m) {
      perfBox.innerHTML = '';
      perfBox.append(
        h('span', { class: 'chip' }, t('Wallpaper FPS '), h('b', {}, String(status.fps || m.fpsAvg || '–'))),
        h('span', { class: 'chip' }, t('CPU '), h('b', {}, m.cpu + ' %')),
        h('span', { class: 'chip' }, t('RAM '), h('b', {}, m.memMB + ' MB')),
        m.gpu ? h('span', { class: 'chip', title: m.gpu }, t('GPU '), h('b', {}, m.gpu.length > 38 ? m.gpu.slice(0, 38) + '…' : m.gpu)) : null);
    }
  }
  const systemExtra = h('div', {},
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Monitors')), monitorsBox),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Live performance')), perfBox),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Wallpaper Engine')),
      h('div', { class: 'row' },
        h('div', { class: 'row-hint', style: 'margin-bottom:10px' }, t('Export a web wallpaper project (with your image and current settings) that can be imported into Wallpaper Engine.')),
        h('button', { class: 'btn', onclick: async () => { const out = await api.exportWallpaperEngine(); if (out) toast('Exported to ' + out); } }, icon('export'), t('Export project…')))),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Updates')),
      h('div', { class: 'row' }, updateInfo, h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        h('button', { class: 'btn', onclick: () => api.checkUpdates() }, t('Check for updates')),
        updateBtn))),
    h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, t('Diagnostics')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => api.openLog() }, icon('export'), t('Open log file')))),
    h('div', { class: 'nav-foot', style: 'display:block;padding:4px 2px' }, `${t('Version')} ${state.version} · ${state.platform}`));
  renderMonitors();

  /* ------------------------------------------------------- build layout */
  const nav = $('#nav');
  const panel = $('#panel');
  for (const sec of SECTIONS) {
    const item = h('div', { class: 'nav-item', 'data-id': sec.id, onclick: () => show(sec.id) }, icon(sec.id), h('span', {}, sec.title));
    nav.append(item);
    const el = h('section', { class: 'section', 'data-id': sec.id }, h('h2', {}, sec.title), h('p', { class: 'lead' }, sec.lead));
    if (sec.custom === 'image') el.append(imageCard, galleryBox);
    if (sec.custom === 'presets') el.append(scheduleBox, presetBox);
    for (const g of sec.groups) {
      g.__el = h('div', { class: 'group glass' }, h('div', { class: 'group-title' }, g.title), g.items.map(buildControl));
      el.append(g.__el);
    }
    if (sec.custom === 'system') el.append(systemExtra);
    if (sec.custom === 'weather') el.append(sleepBox, weatherBox);
    if (sec.custom === 'online') el.append(onlineBox);
    panel.append(el);
  }
  nav.append(h('div', { class: 'nav-spacer' }), h('div', { class: 'nav-foot' }, t('Double-click a slider to reset it')));
  refreshDependencies();

  function show(id) {
    for (const n of nav.querySelectorAll('.nav-item')) n.classList.toggle('active', n.dataset.id === id);
    for (const s of panel.querySelectorAll('.section')) s.classList.toggle('active', s.dataset.id === id);
    try { localStorage.setItem('tab', id); } catch { /* ignore */ }
    if (id === 'presets') generateThumbs();
    if (id === 'online' && !onlineStarted) { onlineStarted = true; searchInput.value = 'night city lights'; onl.query = 'night city lights'; onlineSearch(true); }
  }
  let initialTab = 'background';
  try { initialTab = localStorage.getItem('tab') || initialTab; } catch { /* ignore */ }
  show(SECTIONS.some((s) => s.id === initialTab) ? initialTab : 'background');

  /* ------------------------------------------------------------ toolbar */
  const btnPause = $('#btnPause');
  function renderPause() {
    btnPause.innerHTML = '';
    btnPause.append(icon(paused ? 'play' : 'pause'), h('span', {}, paused ? t('Resume rain') : t('Pause rain')));
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
    if (status.attach && status.attach.mode === 'failed') { el.classList.add('error'); text = t('Desktop attach failed'); el.title = status.attach.error || ''; }
    else if (status.error) { el.classList.add('error'); text = t('Wallpaper error'); el.title = status.error; }
    else if (!status.enabled) text = t('Wallpaper off');
    else if (status.suspended) { el.classList.add('suspended'); text = t('Sleeping · ') + (String(status.reason).startsWith('app:') ? String(status.reason).slice(4) : t({ fullscreen: 'fullscreen app', battery: 'on battery', locked: 'locked', sleep: 'system sleep' }[status.reason] || 'paused')); }
    else if (paused) { el.classList.add('paused'); text = t('Paused'); }
    else { el.classList.add('live'); text = t('Live') + (status.fps ? ` · ${status.fps} FPS` : ''); }
    $('#statusText').textContent = text;

    const info = $('#infoRow');
    info.innerHTML = '';
    const n = (status.displays || []).length;
    info.append(
      h('span', { class: 'chip' }, t('Monitors '), h('b', {}, String(n))),
      h('span', { class: 'chip' }, t('Preview '), h('b', {}, engine ? `${engine.fps || '–'} FPS` : 'off')),
      h('span', { class: 'chip' }, t('Drops '), h('b', {}, engine ? String(engine.sim.drops.length) : '–')));
  }
  renderStatus();
  setInterval(renderStatus, 1000);

  /* -------------------------------------------------------------- events */
  api.onSettings((s) => applyRemote(s));
  api.onPause((p) => { paused = p; engine && engine.setPaused(p); renderPause(); renderStatus(); });
  api.onStatus((s) => { status = s; renderStatus(); renderMonitors(); renderWeather(); renderUpdate(); renderSleep(); });
  renderUpdate();

  // Mouse over the preview wipes the glass too.
  canvas.addEventListener('pointermove', (e) => engine && engine.pointer(e.offsetX, e.offsetY));

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
