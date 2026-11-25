/**
 * RainSimulation – CPU physics for water on glass.
 *
 * Produces a "water map" canvas every frame which the WebGL renderer uses
 * as a refraction normal map:
 *   R,G = surface normal (x,y) encoded 0..1
 *   B   = water thickness (scaled by drop size → larger drops = thicker lens)
 *   A   = water coverage (soft; thresholded in the shader → merging blobs)
 * and a low-res "fog mask" canvas where moving water wipes condensation.
 *
 * Physics model (all distances in water-map pixels, time in 1/60 s ticks):
 *  - stick–slip motion: drops stay pinned by surface tension until a random
 *    "slip" adds momentum; heavier drops slip more often and harder.
 *  - gravity acceleration with a terminal velocity and lateral meandering.
 *  - moving drops leave beads + a wiped path (trail) and lose volume.
 *  - collisions merge drops, conserving (most of) the volume.
 *  - tiny static droplets accumulate on a separate layer and are wiped away
 *    under moving drops; they slowly evaporate.
 */
(function (root) {
  'use strict';

  const SIZE_BUCKETS = 8;
  const SPRITE = 128;

  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Normal-encoded drop sprite. `thickness` scales the B channel. */
  function makeDropSprite(thickness) {
    const c = makeCanvas(SPRITE, SPRITE);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SPRITE, SPRITE);
    const d = img.data;
    for (let y = 0; y < SPRITE; y++) {
      for (let x = 0; x < SPRITE; x++) {
        const nx = ((x + 0.5) / SPRITE) * 2 - 1;
        // Slightly flatten the top and bulge the bottom: gravity sag.
        let ny = ((y + 0.5) / SPRITE) * 2 - 1;
        ny = ny < 0 ? ny * 1.12 : ny * 0.96;
        const r2 = nx * nx + ny * ny;
        const i = (y * SPRITE + x) * 4;
        if (r2 >= 1) { d[i + 3] = 0; continue; }
        const z = Math.sqrt(1 - r2);
        d[i] = Math.round((0.5 + nx * 0.5) * 255);
        d[i + 1] = Math.round((0.5 + ny * 0.5) * 255);
        d[i + 2] = Math.round(Math.min(1, z * thickness) * 255);
        d[i + 3] = Math.round(Math.min(1, (1 - r2) * 1.05) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Soft white disc used to wipe droplets / condensation. */
  function makeClearSprite() {
    const s = 64;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return c;
  }

  class Drop {
    constructor(x, y, r) {
      this.x = x; this.y = y; this.r = r;
      this.vy = 0;          // vertical momentum (px / tick)
      this.vx = 0;          // lateral drift
      this.spreadX = 0;     // impact / merge wobble
      this.spreadY = 0;
      this.shrink = 0;      // evaporation per tick
      this.travel = 0;      // distance since last trail bead
      this.nextBead = 0;
      this.isTrail = false;
      this.parent = null;
      this.dead = false;
      this.age = 0;
    }
  }

  class RainSimulation {
    constructor(width, height) {
      this.dropSprites = [];
      for (let i = 0; i < SIZE_BUCKETS; i++) this.dropSprites.push(makeDropSprite(0.3 + 0.7 * (i / (SIZE_BUCKETS - 1))));
      this.clearSprite = makeClearSprite();
      this.drops = [];
      this.params = {};
      this.fogFrame = 0;
      this.evapFrame = 0;
      this.setSettings({});
      this.resize(width, height);
    }

    resize(width, height) {
      width = Math.max(64, Math.round(width));
      height = Math.max(64, Math.round(height));
      if (this.width === width && this.height === height) return;
      this.width = width;
      this.height = height;
      // Unit so drop sizes look the same on 1080p, 1440p and 4K.
      this.unit = Math.min(width, height) / 540;

      this.water = makeCanvas(width, height);
      this.waterCtx = this.water.getContext('2d');
      this.droplets = makeCanvas(width, height);
      this.dropletsCtx = this.droplets.getContext('2d');
      this.fog = makeCanvas(Math.ceil(width / 4), Math.ceil(height / 4));
      this.fogCtx = this.fog.getContext('2d');
      this.fogCtx.fillStyle = '#000';
      this.fogCtx.fillRect(0, 0, this.fog.width, this.fog.height);

      this.drops = [];
      this.seed();
    }

    /** Derive physical parameters from 0..100 UI settings. */
    setSettings(s) {
      const v = (k, d) => (s[k] === undefined ? d : s[k]) / 100;
      const p = this.params;
      p.intensity = v('rainIntensity', 55);
      p.density = v('dropletDensity', 60);
      p.size = v('dropletSize', 50);
      p.speed = v('dropletSpeed', 50);
      p.trail = v('trailLength', 50);
      p.merging = s.merging !== undefined ? !!s.merging : true;
      p.randomGen = s.randomGeneration !== undefined ? !!s.randomGeneration : true;
      p.condensation = (s.condensationEnabled === false) ? 0 : v('condensation', 35);
      this.updateDerived();
    }

    updateDerived() {
      const p = this.params;
      const u = this.unit || 1;
      p.minR = (2 + p.size * 3) * u;          // smallest moving-capable drop
      p.maxR = (7 + p.size * 26) * u;             // largest spawned drop
      p.moveR = p.minR * 1.6;                      // below this drops are pinned
      p.gravity = (0.25 + p.speed * 1.6) * u;
      p.terminal = (2 + p.speed * 14) * u;
      p.maxDrops = Math.round(250 + p.intensity * 650);
    }

    /** Populate the glass so it doesn't start dry. */
    seed() {
      this.updateDerived();
      const n = Math.round(this.params.maxDrops * 0.45);
      for (let i = 0; i < n; i++) this.spawnDrop(true);
      const tiny = Math.round(this.width * this.height / 900 * (0.2 + this.params.density));
      for (let i = 0; i < tiny; i++) this.spawnTiny();
    }

    clear() {
      this.drops = [];
      this.dropletsCtx.clearRect(0, 0, this.width, this.height);
    }

    spawnDrop(initial) {
      const p = this.params;
      // Power distribution: lots of small drops, few big ones.
      const t = Math.pow(Math.random(), 2.6);
      const r = p.minR * 0.6 + (p.maxR - p.minR * 0.6) * t;
      const d = new Drop(rand(0, this.width), rand(-p.maxR, this.height * (initial ? 1 : 0.98)), r);
      d.spreadX = initial ? 0 : 1.2;
      d.spreadY = initial ? 0 : 1.2;
      d.nextBead = rand(p.minR, p.maxR);
      this.drops.push(d);
      // The impact absorbs the tiny droplets underneath it.
      this.wipe(d.x, d.y, d.r * 1.3);
      return d;
    }

    spawnTiny() {
      const u = this.unit;
      const r = rand(0.5, 2.1) * u * (0.6 + this.params.size * 0.8);
      const x = rand(0, this.width), y = rand(0, this.height);
      const ctx = this.dropletsCtx;
      ctx.drawImage(this.dropSprites[0], x - r, y - r, r * 2, r * 2.1);
    }

    wipe(x, y, r) {
      const ctx = this.dropletsCtx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.clearSprite, x - r, y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    clearFog(x, y, r, strength) {
      const ctx = this.fogCtx;
      ctx.globalAlpha = strength;
      ctx.drawImage(this.clearSprite, (x - r) / 4, (y - r) / 4, r / 2, r / 2);
      ctx.globalAlpha = 1;
    }

    update(dtSeconds) {
      const ts = Math.min(dtSeconds, 0.1) * 60; // ticks
      if (ts <= 0) return;
      const p = this.params;
      const drops = this.drops;

      // ---- spawning --------------------------------------------------------
      if (p.randomGen && p.intensity > 0) {
        const rate = (0.15 + p.intensity * p.intensity * 4.5) * ts * (this.width * this.height) / (960 * 540);
        let n = Math.floor(rate) + (chance(rate % 1) ? 1 : 0);
        while (n-- > 0 && drops.length < p.maxDrops) this.spawnDrop(false);
      }
      if (p.density > 0) {
        const rate = p.density * p.density * 30 * ts * (this.width * this.height) / (960 * 540);
        let n = Math.floor(rate) + (chance(rate % 1) ? 1 : 0);
        while (n-- > 0) this.spawnTiny();
      }

      // Evaporation of the tiny droplet layer (keeps an equilibrium).
      if ((this.evapFrame += ts) > 20) {
        this.evapFrame = 0;
        const ctx = this.dropletsCtx;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${0.03 + (1 - p.density) * 0.08})`;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Condensation slowly re-forms over wiped paths.
      if ((this.fogFrame += ts) > 8) {
        this.fogFrame = 0;
        const ctx = this.fogCtx;
        ctx.fillStyle = 'rgba(0,0,0,0.035)';
        ctx.fillRect(0, 0, this.fog.width, this.fog.height);
      }

      // ---- physics ---------------------------------------------------------
      const newDrops = [];
      const H = this.height;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.dead) continue;
        d.age += ts;

        // Stick-slip: probability of breaking free grows with mass.
        if (d.r > p.moveR) {
          const mass = (d.r - p.moveR) / (p.maxR - p.moveR + 1e-3);
          if (chance(Math.min(1, (0.02 + mass * 0.35) * ts * (0.3 + p.speed)))) {
            d.vy += rand(0.2, 1) * p.gravity * (0.3 + mass * 1.7);
          }
        }
        // Trail beads and tiny drops evaporate.
        if (d.r < p.minR && chance(0.03 * ts)) d.shrink += 0.004 * this.unit;
        d.r -= d.shrink * ts;
        if (d.r <= 0.3) { d.dead = true; continue; }

        if (d.vy > 0) {
          // Terminal velocity & meander.
          if (d.vy > p.terminal) d.vy = p.terminal;
          if (chance(0.04 * ts)) d.vx = rand(-0.6, 0.6) * this.unit * (d.vy / p.terminal);
          const dy = d.vy * ts;
          d.y += dy;
          d.x += d.vx * ts;
          d.travel += dy;

          // Trail: drop deposits beads and loses volume.
          const beadGap = d.nextBead * (1.6 - p.trail * 1.2);
          if (p.trail > 0 && d.travel > beadGap) {
            d.travel = 0;
            d.nextBead = rand(p.minR, p.maxR) * 0.8 + (p.maxR - d.r) * 0.3;
            const br = d.r * rand(0.16, 0.22 + p.trail * 0.16);
            const b = new Drop(d.x + rand(-0.3, 0.3) * d.r * 0.2, d.y - d.r * 0.9, br);
            b.isTrail = true;
            b.parent = d;
            b.shrink = 0.0008 * this.unit * rand(0.5, 1.5);
            newDrops.push(b);
            d.r *= 0.985 - p.trail * 0.01;
          }
          // Moving water wipes droplets and condensation along its path.
          this.wipe(d.x, d.y - d.r * 0.3, d.r * (0.85 + p.trail * 0.25));
          if (p.condensation > 0) this.clearFog(d.x, d.y, d.r * 1.25, 0.9);

          // Friction: momentum decays, small drops stop (stick again).
          d.vy -= Math.max(0.05, p.moveR * 0.04 - d.vy * 0.02) * 0.25 * ts * (d.r < p.moveR ? 3 : 1);
          if (d.vy < 0) d.vy = 0;
          d.vx *= Math.pow(0.85, ts);
          d.spreadY = Math.max(d.spreadY, Math.min(0.5, d.vy / p.terminal * 0.45));

          if (d.y - d.r * 2 > H) d.dead = true;
        }
        d.spreadX *= Math.pow(0.55, ts);
        d.spreadY *= Math.pow(0.8, ts);
      }

      // ---- merging (spatial hash) ------------------------------------------
      if (p.merging) this.merge(drops);

      // Compact the drop list.
      let w = 0;
      for (let i = 0; i < drops.length; i++) if (!drops[i].dead) drops[w++] = drops[i];
      drops.length = w;
      for (const b of newDrops) if (drops.length < p.maxDrops * 1.6) drops.push(b);
    }

    merge(drops) {
      const cell = Math.max(8, this.params.maxR * 2.2);
      const cols = Math.ceil(this.width / cell) + 2;
      const grid = new Map();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.dead) continue;
        const key = (Math.floor(d.y / cell) + 1) * cols + Math.floor(d.x / cell) + 1;
        let arr = grid.get(key);
        if (!arr) grid.set(key, (arr = []));
        arr.push(d);
      }
      for (let i = 0; i < drops.length; i++) {
        const a = drops[i];
        if (a.dead || (a.vy <= 0 && a.age > 2)) continue; // only moving / new drops initiate
        const cx = Math.floor(a.x / cell) + 1, cy = Math.floor(a.y / cell) + 1;
        for (let oy = -1; oy <= 1 && !a.dead; oy++) {
          for (let ox = -1; ox <= 1 && !a.dead; ox++) {
            const arr = grid.get((cy + oy) * cols + cx + ox);
            if (!arr) continue;
            for (let k = 0; k < arr.length; k++) {
              const b = arr[k];
              if (b === a || b.dead || b.parent === a || a.parent === b) continue;
              const dx = b.x - a.x, dy = b.y - a.y;
              const reach = (a.r + b.r) * 0.75;
              if (dx * dx + dy * dy > reach * reach) continue;
              // Larger drop absorbs the smaller one.
              const big = a.r >= b.r ? a : b;
              const small = big === a ? b : a;
              const area = big.r * big.r + small.r * small.r * 0.85;
              big.r = Math.min(Math.sqrt(area), this.params.maxR * 1.6);
              big.x += (small.x - big.x) * (small.r / (big.r + small.r)) * 0.3;
              big.vy += small.vy * 0.5 + this.params.gravity * 0.6 * (small.r / big.r);
              big.spreadX = Math.max(big.spreadX, 0.35);
              big.spreadY = Math.max(big.spreadY, 0.25);
              big.isTrail = false;
              big.parent = null;
              big.shrink = 0;
              small.dead = true;
              if (small === a) break;
            }
          }
        }
      }
    }

    /** Rasterize the current state into the water-map canvas. */
    render() {
      const ctx = this.waterCtx;
      const p = this.params;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.drawImage(this.droplets, 0, 0);
      const sprites = this.dropSprites;
      const maxR = p.maxR * 1.3;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        const bucket = Math.min(SIZE_BUCKETS - 1, Math.floor((d.r / maxR) * SIZE_BUCKETS));
        const spr = sprites[bucket];
        const sx = 1 + d.spreadX * 0.6 - d.spreadY * 0.15;
        const sy = 1 + d.spreadY + d.spreadX * 0.2;
        const w = d.r * 2 * sx, h = d.r * 2 * sy;
        // Moving drops get a narrower "neck" above them → pear shape.
        if (d.vy > 0.4 && d.r > p.moveR) {
          const nr = d.r * 0.62;
          const ny = d.y - d.r * 0.75 * sy;
          ctx.drawImage(sprites[Math.max(0, bucket - 2)], d.x - nr, ny - nr * 1.3, nr * 2, nr * 2.6);
        }
        ctx.drawImage(spr, d.x - w / 2, d.y - h * 0.55, w, h);
      }
    }
  }

  root.RainGlass = root.RainGlass || {};
  root.RainGlass.RainSimulation = RainSimulation;
})(typeof self !== 'undefined' ? self : this);
