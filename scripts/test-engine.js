#!/usr/bin/env node
/* Self-checks: settings sanitizing, preset store, WE export and – when
 * Playwright is installed – a headless WebGL render of the engine. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitize, DEFAULT_SETTINGS } = require('../src/shared/defaults');
const { SettingsStore } = require('../src/main/settings-store');
const { buildWallpaperEngineProject } = require('../src/main/we-export');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rainy-'));
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
};

(async () => {
  await test('sanitize clamps and drops unknown keys', () => {
    const s = sanitize({ rainIntensity: 900, fitMode: 'zoom', merging: 0, evil: 1, backgroundPath: '' });
    assert.strictEqual(s.rainIntensity, 100);
    assert.strictEqual(s.fitMode, 'fill');
    assert.strictEqual(s.merging, false);
    assert.strictEqual(s.backgroundPath, null);
    assert.ok(!('evil' in s));
  });

  await test('settings store persists and presets round-trip', () => {
    const dir = path.join(tmp, 'store');
    const store = new SettingsStore(dir);
    store.update({ rainIntensity: 12, backgroundPath: '/x.jpg' });
    store.flush();
    store.savePreset('Mine');
    const again = new SettingsStore(dir);
    assert.strictEqual(again.get().rainIntensity, 12);
    assert.ok(again.presets().some((p) => p.name === 'Mine' && !p.builtin));
    again.update({ rainIntensity: 90 });
    again.applyPreset('Mine');
    assert.strictEqual(again.get().rainIntensity, 12);
    assert.strictEqual(again.get().backgroundPath, '/x.jpg', 'presets must not change the image');
    assert.throws(() => again.savePreset('Thunderstorm'));
    again.reset();
    assert.strictEqual(again.get().rainIntensity, DEFAULT_SETTINGS.rainIntensity);
    assert.strictEqual(again.get().backgroundPath, '/x.jpg');
  });

  const weDir = path.join(tmp, 'we');
  await test('wallpaper engine export', () => {
    buildWallpaperEngineProject(weDir, { rainIntensity: 77 });
    const project = JSON.parse(fs.readFileSync(path.join(weDir, 'project.json'), 'utf8'));
    assert.strictEqual(project.type, 'web');
    assert.strictEqual(project.general.properties.rainintensity.value, 77);
    assert.strictEqual(project.general.properties.backgroundimage.type, 'file');
    for (const f of ['index.html', 'we-main.js', 'config.js', 'engine/engine.js']) assert.ok(fs.existsSync(path.join(weDir, f)), f);
  });

  let playwright = null;
  try { playwright = require('playwright'); } catch { /* optional */ }
  if (!playwright) {
    console.log('  – WebGL render test skipped (playwright not installed)');
  } else {
    await test('engine renders rain over a custom image (WebGL2)', async () => {
      const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('file://' + path.join(weDir, 'index.html'));
      await page.evaluate(() => window.wallpaperPropertyListener.applyUserProperties({ rainintensity: { value: 80 }, streaksenabled: { value: true } }));
      await page.waitForTimeout(2500);
      const shot = await page.screenshot();
      await browser.close();
      assert.deepStrictEqual(errors, []);
      assert.ok(shot.length > 20000, 'render output looks empty');
    });
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} test(s) passed${process.exitCode ? ', some FAILED' : ''}.`);
})();
