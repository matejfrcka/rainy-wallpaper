/**
 * RainGlassEngine – ties simulation, renderer, audio and the frame loop together.
 *
 *   const engine = new RainGlass.Engine(canvas, { audio: true, lightningSource: true });
 *   engine.setSettings(settings);
 *   await engine.setBackgroundFromBlob(blob);   // or setBackgroundFromUrl / setBackground(null)
 *   engine.start();
 */
(function (root) {
  'use strict';
  const RG = root.RainGlass;

  const WATER_MAX_DIM = 1600; // cap water-map resolution (upscaled smoothly by the shader)

  async function decodeImage(blob, maxDim) {
    const probe = await createImageBitmap(blob);
    const { width, height } = probe;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    if (scale >= 1) return probe;
    probe.close();
    return createImageBitmap(blob, {
      resizeWidth: Math.round(width * scale),
      resizeHeight: Math.round(height * scale),
      resizeQuality: 'high',
    });
  }

  class RainGlassEngine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = Object.assign({ audio: false, lightningSource: true, pixelRatio: null }, opts);
      this.settings = Object.assign({}, (root.RainGlassDefaults || {}).DEFAULT_SETTINGS || {});
      this.renderer = new RG.GlassRenderer(canvas);
      this.sim = new RG.RainSimulation(256, 256);
      this.audio = this.opts.audio ? new RG.RainAudio() : null;
      this.running = false;
      this.paused = false;        // user pause (rain frozen, still rendered)
      this.suspended = false;     // system pause (fullscreen app etc.) – nothing rendered
      this.time = 0;
      this.flashPulses = [];
      this.nextLightning = 8 + Math.random() * 10;
      this.onLightning = null;    // callback(distance) – used to sync multiple monitors
      this.onFrame = null;        // callback(fps)
      this.fps = 0;
      this._frames = 0;
      this._fpsTime = 0;
      this._loop = this._loop.bind(this);
      this._last = 0;

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
    }

    resize() {
      const dpr = this.opts.pixelRatio || root.devicePixelRatio || 1;
      const scale = (this.settings.renderScale || 100) / 100;
      const cw = this.canvas.clientWidth || this.canvas.width;
      const ch = this.canvas.clientHeight || this.canvas.height;
      const w = Math.max(1, Math.round(cw * dpr * scale));
      const h = Math.max(1, Math.round(ch * dpr * scale));
      this.renderer.resize(w, h);
      const ws = Math.min(1, WATER_MAX_DIM / Math.max(w, h), 0.75);
      this.sim.resize(w * ws, h * ws);
      this.sim.setSettings(this.settings);
      if (!this.running || this.paused) this.renderOnce();
    }

    setSettings(s) {
      const prevScale = this.settings.renderScale;
      this.settings = Object.assign({}, this.settings, s);
      this.sim.setSettings(this.settings);
      this.renderer.setSettings(this.settings);
      if (prevScale !== this.settings.renderScale) this.resize();
      if (this.audio) {
        this.audio.setOptions({
          enabled: !!this.settings.soundEnabled,
          volume: (this.settings.volume ?? 50) / 100,
          intensity: (this.settings.rainIntensity ?? 50) / 100,
        });
      }
      if (!this.running || this.paused || this.suspended) this.renderOnce();
    }

    setBackground(source) {
      this.renderer.setBackground(source);
      this.renderOnce();
    }

    async setBackgroundFromBlob(blob) {
      const max = Math.min(this.renderer.maxTex || 8192, 8192);
      const bmp = await decodeImage(blob, max);
      this.setBackground(bmp);
    }

    async setBackgroundFromUrl(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Unable to load image: ' + res.status);
      await this.setBackgroundFromBlob(await res.blob());
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._last = performance.now();
      this.raf = requestAnimationFrame(this._loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }

    /** User pause: freezes the rain but keeps the frame visible. */
    setPaused(p) {
      this.paused = !!p;
      this.renderOnce();
    }

    /** System suspend: stops the loop entirely (fullscreen game, battery...). */
    setSuspended(s) {
      s = !!s;
      if (s === this.suspended) return;
      this.suspended = s;
      if (this.audio) this.audio.setSuspended(s);
      if (!s && this.running) {
        this._last = performance.now();
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(this._loop);
      }
    }

    /** Trigger a lightning flash (visual) and optionally the thunder sound. */
    lightning(distance = Math.random(), withSound = true) {
      if (this.settings.lightning !== false) {
        const t = this.time;
        const strength = 0.55 + (1 - distance) * 0.6;
        this.flashPulses.push({ t, a: strength });
        const flickers = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < flickers; i++) this.flashPulses.push({ t: t + 0.08 + Math.random() * 0.35, a: strength * (0.4 + Math.random() * 0.6) });
      }
      if (withSound && this.audio) {
        // Light travels faster than sound.
        setTimeout(() => this.audio && this.audio.thunder(distance), 150 + distance * 2800);
      }
    }

    reset() {
      this.sim.clear();
      this.sim.seed();
      this.renderOnce();
    }

    flash() {
      let f = 0;
      const t = this.time;
      this.flashPulses = this.flashPulses.filter((p) => t - p.t < 1.5);
      for (const p of this.flashPulses) {
        const dt = t - p.t;
        if (dt >= 0) f = Math.max(f, p.a * Math.exp(-dt * 9));
      }
      return f;
    }

    renderOnce() {
      if (!this.renderer || this.renderer.lost) return;
      this.sim.render();
      this.renderer.render(this.sim, this.time, this.flash());
    }

    _loop(now) {
      if (!this.running || this.suspended) return;
      this.raf = requestAnimationFrame(this._loop);
      const limit = this.settings.fpsLimit || 0;
      const elapsed = now - this._last;
      if (limit > 0 && elapsed < 1000 / limit - 1.5) return;
      const dt = Math.min(elapsed / 1000, 0.1);
      this._last = now;
      this.time += dt;

      if (!this.paused) {
        this.sim.update(dt);
        if (this.opts.lightningSource && this.settings.thunderEnabled) {
          this.nextLightning -= dt;
          if (this.nextLightning <= 0) {
            const i = (this.settings.rainIntensity ?? 50) / 100;
            this.nextLightning = (12 + Math.random() * 40) * (1.4 - i);
            const distance = Math.random();
            this.lightning(distance, true);
            if (this.onLightning) this.onLightning(distance);
          }
        }
      }
      this.sim.render();
      this.renderer.render(this.sim, this.time, this.flash());

      this._frames++;
      if (now - this._fpsTime > 1000) {
        this.fps = Math.round(this._frames * 1000 / (now - this._fpsTime));
        this._frames = 0;
        this._fpsTime = now;
        if (this.onFrame) this.onFrame(this.fps);
      }
    }

    destroy() {
      this.stop();
      this.resizeObserver.disconnect();
      if (this.audio) this.audio.destroy();
      this.renderer.destroy();
    }
  }

  RG.Engine = RainGlassEngine;
})(typeof self !== 'undefined' ? self : this);
