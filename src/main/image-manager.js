'use strict';
/**
 * Background image selection & validation. Only the image the user picked
 * can be read by renderers (no arbitrary file access over IPC).
 */
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const VIDEO_EXT = ['mp4', 'webm'];
const EXTENSIONS = [...IMAGE_EXT, ...VIDEO_EXT];
const MAX_BYTES = 256 * 1024 * 1024;          // images
const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024; // videos are streamed, never loaded whole

// Magic numbers – reject files that only pretend to be images.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

function validate(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid file path');
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw new Error(`Unsupported format ".${ext}". Use JPG, PNG, WEBP, BMP, GIF, MP4 or WEBM.`);
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Not a file');
  const video = VIDEO_EXT.includes(ext);
  if (st.size > (video ? MAX_VIDEO_BYTES : MAX_BYTES)) throw new Error(video ? 'Video is too large' : 'Image is larger than 256 MB');
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!sniff(head)) throw new Error('The file is not a valid image or video');
  return file;
}

/** MIME type from the file's magic bytes. */
function mimeOf(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  return sniff(head);
}

const isVideo = (file) => /^video\//.test(mimeOf(file) || '');

/**
 * Stream a file for the rainmedia:// protocol with HTTP Range support
 * (needed for video seeking / looping).
 */
function streamResponse(file, request) {
  const { Readable } = require('stream');
  const st = fs.statSync(file);
  const mime = mimeOf(file) || 'application/octet-stream';
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  let start = 0, end = st.size - 1, status = 200;
  if (range) {
    start = range[1] ? parseInt(range[1], 10) : 0;
    end = range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status, headers });
}

async function pickImage(parent) {
  const res = await dialog.showOpenDialog(parent, {
    title: 'Select background image or video',
    properties: ['openFile'],
    filters: [{ name: 'Images & videos', extensions: EXTENSIONS }, { name: 'Images', extensions: IMAGE_EXT }, { name: 'Videos', extensions: VIDEO_EXT }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return validate(res.filePaths[0]);
}

/** Like validate() but for the Windows wallpaper, which may lack an extension (TranscodedWallpaper). */
function validateSystem(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid file path');
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_BYTES || st.size < 16) throw new Error('Invalid wallpaper file');
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!sniff(head)) throw new Error('Unsupported wallpaper format');
  return st;
}

/**
 * Locate the current Windows desktop wallpaper.
 * @param {string|null} spiPath  path reported by SystemParametersInfo
 * @returns {{path:string, mtime:number, size:number}|null}
 */
function findSystemWallpaper(spiPath) {
  // Empty path = solid colour background: nothing to use.
  if (!spiPath) return null;
  const candidates = [spiPath];
  if (process.env.APPDATA) {
    const themes = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Themes');
    candidates.push(path.join(themes, 'TranscodedWallpaper'));
    try {
      const cached = path.join(themes, 'CachedFiles');
      for (const f of fs.readdirSync(cached)) candidates.push(path.join(cached, f));
    } catch { /* none */ }
  }
  for (const c of candidates) {
    try {
      const st = validateSystem(c);
      return { path: c, mtime: st.mtimeMs, size: st.size };
    } catch { /* try next */ }
  }
  return null;
}

function readImage(file, system = false) {
  if (system) validateSystem(file);
  else validate(file);
  const data = fs.readFileSync(file);
  return { data, mime: sniff(data), name: path.basename(file) };
}

module.exports = { pickImage, readImage, validate, findSystemWallpaper, isVideo, mimeOf, streamResponse, EXTENSIONS };
