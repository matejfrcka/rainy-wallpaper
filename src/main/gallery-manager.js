'use strict';
/**
 * Resolves gallery scenes to files and downloads animated loops on demand.
 */
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { SCENES, VIDEO_BASE_URL, parse } = require('../shared/gallery');

// Unpacked from the asar (see package.json asarUnpack) so videos can be streamed.
const ASSET_DIR = path.join(__dirname, '..', '..', 'assets', 'backgrounds').replace('app.asar', 'app.asar.unpacked');
const cacheDir = () => path.join(app.getPath('userData'), 'gallery');

function imagePath(id) {
  return path.join(ASSET_DIR, id + '.jpg');
}

/** Bundled or previously downloaded loop, or null. */
function localVideo(id) {
  const bundled = path.join(ASSET_DIR, 'video', id + '.mp4');
  if (fs.existsSync(bundled)) return bundled;
  const cached = path.join(cacheDir(), id + '.mp4');
  return fs.existsSync(cached) ? cached : null;
}

/** 'gallery:…' → absolute file (falls back to the still image if the loop is missing). */
function resolve(ref) {
  const g = parse(ref);
  if (!g) return null;
  return (g.video && localVideo(g.id)) || imagePath(g.id);
}

function list() {
  return SCENES.map((s) => ({ ...s, hasVideo: !!localVideo(s.id) }));
}

const downloads = new Map();

/** Download the animated loop for a scene into the cache; onProgress(0..1). */
function downloadVideo(id, onProgress = () => {}) {
  if (!SCENES.some((s) => s.id === id)) return Promise.reject(new Error('Unknown scene'));
  const existing = localVideo(id);
  if (existing) return Promise.resolve(existing);
  if (downloads.has(id)) return downloads.get(id);
  const job = (async () => {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const res = await net.fetch(VIDEO_BASE_URL + id + '.mp4');
    if (!res.ok) throw new Error(res.status === 404 ? 'This animated background is not available yet.' : 'Download failed: HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = path.join(cacheDir(), id + '.mp4.part');
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
    const final = path.join(cacheDir(), id + '.mp4');
    fs.renameSync(tmp, final);
    return final;
  })().finally(() => downloads.delete(id));
  downloads.set(id, job);
  return job;
}

module.exports = { list, resolve, imagePath, downloadVideo, parse };
