#!/usr/bin/env node
/* Builds dist-we/RainyGlass – a Wallpaper Engine web wallpaper project.
 * Usage: npm run build:we [-- path/to/default-image.jpg] */
'use strict';
const path = require('path');
const { buildWallpaperEngineProject } = require('../src/main/we-export');

const out = path.join(__dirname, '..', 'dist-we', 'RainyGlass');
const image = process.argv[2] ? path.resolve(process.argv[2]) : null;
buildWallpaperEngineProject(out, undefined, image);
console.log('Wallpaper Engine project written to', out);
