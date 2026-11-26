/**
 * Built-in background gallery. Images ship with the app (assets/backgrounds);
 * animated loops are bundled when present (assets/backgrounds/video/<id>.mp4)
 * or downloaded on demand from the GitHub release below and cached.
 * UMD – used by the main process and the settings window.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RainGlassGallery = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIDEO_BASE_URL = 'https://github.com/matejfrcka/rainy-wallpaper/releases/download/gallery-v1/';

  // `preset`: the look that suits the scene (applied when "Match the look" is on).
  const SCENES = [
    { id: 'forest-cabin', name: 'Forest Cabin', preset: 'Steady Rain' },
    { id: 'old-town', name: 'Old Town at Night', preset: 'Night Window' },
    { id: 'reading-nook', name: 'Reading Nook', preset: 'Gentle Drizzle' },
    { id: 'misty-lake', name: 'Misty Lake', preset: 'Foggy Morning' },
    { id: 'autumn-park', name: 'Autumn Park', preset: 'After the Storm' },
    { id: 'snowy-village', name: 'Snowy Village', preset: 'Snowy Window' },
    { id: 'tokyo-alley', name: 'Tokyo Alley', preset: 'Night Window' },
    { id: 'lighthouse', name: 'Stormy Lighthouse', preset: 'Thunderstorm' },
  ];

  /** 'gallery:<id>' or 'gallery:<id>:video' → { id, video } | null */
  function parse(p) {
    const m = /^gallery:([a-z0-9-]+)(:video)?$/.exec(p || '');
    return m && SCENES.some((s) => s.id === m[1]) ? { id: m[1], video: !!m[2] } : null;
  }

  const ref = (id, video) => `gallery:${id}${video ? ':video' : ''}`;

  return { SCENES, VIDEO_BASE_URL, parse, ref };
});
