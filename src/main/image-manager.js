'use strict';
/**
 * Background image selection & validation. Only the image the user picked
 * can be read by renderers (no arbitrary file access over IPC).
 */
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
const MAX_BYTES = 256 * 1024 * 1024;

// Magic numbers – reject files that only pretend to be images.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return null;
}

function validate(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid file path');
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw new Error(`Unsupported format ".${ext}". Use JPG, PNG, WEBP or BMP.`);
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_BYTES) throw new Error('Image is larger than 256 MB');
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!sniff(head)) throw new Error('The file is not a valid image');
  return file;
}

async function pickImage(parent) {
  const res = await dialog.showOpenDialog(parent, {
    title: 'Select background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: EXTENSIONS }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return validate(res.filePaths[0]);
}

function readImage(file) {
  validate(file);
  const data = fs.readFileSync(file);
  return { data, mime: sniff(data), name: path.basename(file) };
}

module.exports = { pickImage, readImage, validate, EXTENSIONS };
