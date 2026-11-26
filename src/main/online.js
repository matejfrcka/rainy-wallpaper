'use strict';
/**
 * Online backgrounds from Pixabay (photos and videos).
 *
 * Pixabay API rules respected here:
 *  - search responses are cached for 24 h,
 *  - files are downloaded (never hot-linked as the background),
 *  - the UI always shows that results come from Pixabay.
 *
 * API key: user override in settings → PIXABAY_KEY env → build-keys.json
 * (generated in CI from a repository secret, never committed).
 */
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');

const DAY = 24 * 60 * 60 * 1000;
const cache = new Map(); // url (without key) -> { time, data }
const dir = () => path.join(app.getPath('userData'), 'online');
const indexFile = () => path.join(dir(), 'index.json');

function builtInKey() {
  try { return require('./build-keys.json').pixabay || ''; } catch { return ''; }
}

function apiKey(settings) {
  return (settings && settings.pixabayKey) || process.env.PIXABAY_KEY || builtInKey();
}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return []; }
}

function writeIndex(list) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(list.slice(0, 80), null, 1));
}

function mapPhoto(h) {
  return {
    id: 'pxp-' + h.id, type: 'photo', provider: 'Pixabay',
    thumb: h.webformatURL, full: h.largeImageURL,
    width: h.imageWidth, height: h.imageHeight,
    user: h.user, page: h.pageURL, tags: h.tags,
  };
}

function mapVideo(h) {
  const v = h.videos || {};
  // Best rendition that is at least Full HD when available.
  const pick = [v.large, v.medium, v.small].find((x) => x && x.url && x.width >= 1920) || v.large || v.medium || v.small || v.tiny;
  return {
    id: 'pxv-' + h.id, type: 'video', provider: 'Pixabay',
    thumb: (v.medium && v.medium.thumbnail) || (v.tiny && v.tiny.thumbnail) || '',
    full: pick && pick.url, width: pick && pick.width, height: pick && pick.height,
    duration: h.duration, user: h.user, page: h.pageURL, tags: h.tags,
  };
}

/**
 * Search Pixabay. type: 'photo' | 'video'. Returns { total, items[] }.
 */
async function search(settings, { type = 'photo', query = '', page = 1 } = {}) {
  const key = apiKey(settings);
  if (!key) throw new Error('NO_KEY');
  const base = type === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
  const params = new URLSearchParams({
    q: String(query).trim().slice(0, 100), safesearch: 'true', per_page: '30', page: String(page), order: 'popular',
  });
  if (type === 'photo') { params.set('image_type', 'photo'); params.set('orientation', 'horizontal'); params.set('min_width', '1920'); }
  const cacheKey = base + '?' + params.toString();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.time < DAY) return hit.data;

  params.set('key', key);
  const res = await net.fetch(base + '?' + params.toString());
  if (res.status === 400 && page > 1) return { total: 0, items: [] }; // past the last page
  if (!res.ok) throw new Error(res.status === 429 ? 'Too many searches – try again in a minute.' : 'Pixabay error ' + res.status);
  const json = await res.json();
  const data = { total: json.totalHits || 0, items: (json.hits || []).map(type === 'video' ? mapVideo : mapPhoto).filter((x) => x.full) };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

/** Download a result into the local library; onProgress(0..1). Returns the file path. */
async function download(item, onProgress = () => {}) {
  if (!item || !/^px[pv]-\d+$/.test(item.id) || !/^https:\/\/(cdn\.)?pixabay\.com\//.test(item.full)) throw new Error('Invalid item');
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), item.id + (item.type === 'video' ? '.mp4' : '.jpg'));
  if (!fs.existsSync(file)) {
    const res = await net.fetch(item.full);
    if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let done = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      out.write(Buffer.from(value));
      done += value.length;
      if (total) onProgress(done / total);
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    fs.renameSync(tmp, file);
  }
  // History (newest first) with what's needed for credits.
  const meta = { id: item.id, type: item.type, provider: item.provider, user: item.user, page: item.page, thumb: item.thumb, file, time: Date.now() };
  writeIndex([meta, ...readIndex().filter((x) => x.id !== item.id)]);
  return file;
}

/** History entries whose files still exist. */
function history() {
  return readIndex().filter((x) => x.file && fs.existsSync(x.file));
}

/** Credit line for a downloaded file, or null. */
function creditFor(file) {
  const m = readIndex().find((x) => x.file === file);
  return m ? { provider: m.provider, user: m.user, page: m.page } : null;
}

module.exports = { search, download, history, creditFor, apiKey };
