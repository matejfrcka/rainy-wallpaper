/**
 * GlassRenderer – WebGL2 pipeline.
 *
 *   image ─compose(fit/pos/zoom/brightness)─▶ scene ─(user blur)─▶ scene'
 *   scene' ─downsample + gaussian─▶ blur
 *   scene' + blur + waterMap + fogMask ─glass shader─▶ screen
 *
 * The background passes run only when the image, size or background
 * settings change; per frame only the water map upload + one full-screen
 * pass happen.
 */
(function (root) {
  'use strict';
  const S = () => root.RainGlass.Shaders;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uniforms };
  }

  /** Neutral default background (soft dusk gradient with bokeh) – used when no image is selected. */
  function makeDefaultBackground() {
    const w = 1600, h = 900;
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b2a3d');
    g.addColorStop(0.55, '#2c4058');
    g.addColorStop(1, '#0f1824');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const lights = [
      [0.2, 0.62, 160, 'rgba(255,190,120,0.45)'], [0.36, 0.7, 110, 'rgba(120,180,255,0.35)'],
      [0.58, 0.58, 190, 'rgba(255,150,120,0.30)'], [0.78, 0.68, 130, 'rgba(140,220,255,0.30)'],
      [0.9, 0.5, 90, 'rgba(255,220,160,0.35)'], [0.08, 0.45, 80, 'rgba(200,170,255,0.25)'],
    ];
    for (const [x, y, r, col] of lights) {
      const rg = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    return c;
  }

  class GlassRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.settings = {};
      this.source = null;          // ImageBitmap / canvas
      this.sceneDirty = true;
      this.lost = false;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); this.sceneDirty = true; });
      this.init();
    }

    init() {
      const gl = this.canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL2 is not available on this system.');
      this.gl = gl;
      const sh = S();
      this.progCompose = program(gl, sh.VERT, sh.COMPOSE);
      this.progBlur = program(gl, sh.VERT, sh.BLUR);
      this.progGlass = program(gl, sh.VERT, sh.GLASS);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.imageTex = this.createTexture(true);
      this.waterTex = this.createTexture(false);
      this.fogTex = this.createTexture(false);
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.targets = {};
      this.uploadImage(this.source || makeDefaultBackground());
    }

    createTexture(mipmap) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return t;
    }

    /** Render target (texture + framebuffer), re-created when its size changes. */
    target(name, w, h) {
      const gl = this.gl;
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      let t = this.targets[name];
      if (t && t.w === w && t.h === h) return t;
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = this.targets[name] = { tex, fbo, w, h };
      return t;
    }

    /** Set the background source (ImageBitmap, HTMLImageElement, canvas) or null for the default. */
    setBackground(source) {
      if (this.source && this.source !== source && typeof this.source.close === 'function') this.source.close();
      this.source = source || null;
      this.uploadImage(this.source || makeDefaultBackground());
    }

    uploadImage(src) {
      const gl = this.gl;
      this.imageSize = [src.width, src.height];
      gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.sceneDirty = true;
    }

    setSettings(s) {
      const prev = this.settings;
      this.settings = s;
      const bgKeys = ['fitMode', 'bgBrightness', 'bgBlur', 'bgPosX', 'bgPosY', 'bgZoom'];
      if (bgKeys.some((k) => prev[k] !== s[k])) this.sceneDirty = true;
    }

    resize(w, h) {
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.sceneDirty = true;
      }
    }

    draw(prog, target) {
      const gl = this.gl;
      if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.w, target.h); }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    blurPass(src, a, b, iterations, spread) {
      const gl = this.gl;
      const { p, u } = this.progBlur;
      gl.useProgram(p);
      gl.uniform1i(u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      let cur = src;
      for (let i = 0; i < iterations; i++) {
        const s = spread * (1 + i * 0.5);
        gl.bindTexture(gl.TEXTURE_2D, cur.tex);
        gl.uniform2f(u.uDir, s / cur.w, 0);
        this.draw(this.progBlur, a);
        gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform2f(u.uDir, 0, s / a.h);
        this.draw(this.progBlur, b);
        cur = b;
      }
      return cur;
    }

    /** Copy (downsample) a texture into a target using a zero-spread blur. */
    copy(src, dst) {
      const gl = this.gl;
      const { p, u } = this.progBlur;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uDir, 0, 0);
      this.draw(this.progBlur, dst);
    }

    updateScene() {
      const gl = this.gl;
      const s = this.settings;
      const W = this.canvas.width, H = this.canvas.height;

      const compose = this.target('compose', W, H);
      const { p, u } = this.progCompose;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
      gl.uniform1i(u.uImage, 0);
      gl.uniform2f(u.uCanvasSize, W, H);
      gl.uniform2f(u.uImageSize, this.imageSize[0], this.imageSize[1]);
      gl.uniform1i(u.uFitMode, { fill: 0, fit: 1, stretch: 2 }[s.fitMode] ?? 0);
      gl.uniform2f(u.uPos, (s.bgPosX ?? 50) / 100, (s.bgPosY ?? 50) / 100);
      gl.uniform1f(u.uZoom, (s.bgZoom ?? 100) / 100);
      gl.uniform1f(u.uBrightness, (s.bgBrightness ?? 100) / 100);
      this.draw(this.progCompose, compose);

      // Optional user blur of the background itself.
      let scene = compose;
      const ub = (s.bgBlur ?? 0) / 100;
      if (ub > 0.001) {
        const scale = ub > 0.4 ? 0.25 : 0.5;
        const a = this.target('ubA', W * scale, H * scale);
        const b = this.target('ubB', W * scale, H * scale);
        this.copy(compose, b);
        scene = this.blurPass(b, a, b, 1 + Math.round(ub * 5), 0.6 + ub * 1.6);
      }
      this.sceneTarget = scene;

      // Heavy blur used for condensation, frosted glass and big-drop defocus.
      const q = 0.125;
      const h1 = this.target('half', W * 0.5, H * 0.5);
      this.copy(scene, h1);
      const ba = this.target('blurA', W * q, H * q);
      const bb = this.target('blurB', W * q, H * q);
      this.copy(h1, bb);
      this.blurTarget = this.blurPass(bb, ba, bb, 3, 1.4);
      this.sceneDirty = false;
    }

    uploadCanvas(tex, canvas) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }

    render(sim, time, flash) {
      if (this.lost) return;
      const gl = this.gl;
      if (this.sceneDirty) this.updateScene();
      const s = this.settings;

      this.uploadCanvas(this.waterTex, sim.water);
      this.uploadCanvas(this.fogTex, sim.fog);

      const { p, u } = this.progGlass;
      gl.useProgram(p);
      const bind = (unit, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u[name], unit);
      };
      bind(0, this.sceneTarget.tex, 'uScene');
      bind(1, this.blurTarget.tex, 'uBlur');
      bind(2, this.waterTex, 'uWater');
      bind(3, this.fogTex, 'uFog');
      const f = (k, d) => ((s[k] ?? d) / 100);
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uRefraction, f('refraction', 60));
      gl.uniform1f(u.uDistortion, f('distortion', 25));
      gl.uniform1f(u.uChromatic, f('chromatic', 30));
      gl.uniform1f(u.uTransparency, f('glassTransparency', 85));
      gl.uniform1f(u.uReflection, f('reflection', 45));
      gl.uniform1f(u.uCondensation, s.condensationEnabled === false ? 0 : f('condensation', 35));
      gl.uniform1f(u.uBlurAmt, f('blur', 50));
      gl.uniform1f(u.uStreaks, s.streaksEnabled === false ? 0 : f('streaks', 35) * (0.3 + 0.7 * f('rainIntensity', 55)));
      gl.uniform1f(u.uRainAmt, f('rainIntensity', 55));
      gl.uniform1f(u.uFlash, flash || 0);
      gl.uniform1f(u.uDayNight, (f('dayNight', 50) - 0.5) * 2);
      this.draw(this.progGlass, null);
    }

    destroy() {
      if (this.source && typeof this.source.close === 'function') this.source.close();
      const ext = this.gl && this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  root.RainGlass = root.RainGlass || {};
  root.RainGlass.GlassRenderer = GlassRenderer;
})(typeof self !== 'undefined' ? self : this);
