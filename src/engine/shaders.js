/**
 * GLSL ES 3.0 shaders for the glass renderer.
 * Coordinate convention: `vUv` is GL screen space (0,0 bottom-left).
 * DOM sources (image, canvases) are uploaded unflipped, so they are sampled
 * with a flipped v.
 */
(function (root) {
  'use strict';

  const VERT = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  /** Background composition: fit / fill / stretch, focal point, zoom, brightness. */
  const COMPOSE = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uImage;
  uniform vec2 uCanvasSize;
  uniform vec2 uImageSize;
  uniform int uFitMode;        // 0 fill, 1 fit, 2 stretch
  uniform vec2 uPos;           // focal point 0..1 (y: 0 = top)
  uniform float uZoom;
  uniform float uBrightness;
  uniform vec4 uSpan;          // this monitor's part of the spanned desktop (x, y, w, h; y from top)
  uniform float uSpanAspect;   // aspect of the whole spanned desktop (0 = not spanning)
  void main() {
    float ac = uSpanAspect > 0.0 ? uSpanAspect : uCanvasSize.x / uCanvasSize.y;
    vec2 cuv = uSpanAspect > 0.0 ? vec2(uSpan.x + vUv.x * uSpan.z, 1.0 - uSpan.y - uSpan.w + vUv.y * uSpan.w) : vUv;
    float ai = uImageSize.x / uImageSize.y;
    vec2 sz;
    if (uFitMode == 0) sz = ai > ac ? vec2(ai / ac, 1.0) : vec2(1.0, ac / ai);
    else if (uFitMode == 1) sz = ai > ac ? vec2(1.0, ac / ai) : vec2(ai / ac, 1.0);
    else sz = vec2(1.0);
    sz *= uZoom;
    vec2 pos = vec2(uPos.x, 1.0 - uPos.y);
    vec2 origin = (1.0 - sz) * pos;
    vec2 iuv = (cuv - origin) / sz;
    vec2 tuv = vec2(iuv.x, 1.0 - iuv.y);
    vec3 col;
    if (any(lessThan(iuv, vec2(0.0))) || any(greaterThan(iuv, vec2(1.0)))) {
      // Letterbox area for "Fit": a dark, very blurred ambient version of the image.
      vec2 amb = vec2(cuv.x, 1.0 - cuv.y);
      col = textureLod(uImage, amb, 7.0).rgb * 0.35;
    } else {
      col = texture(uImage, tuv).rgb;
    }
    outColor = vec4(col * uBrightness, 1.0);
  }`;

  /** Separable Gaussian (9 taps via 5 linear fetches). */
  const BLUR = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uTex;
  uniform vec2 uDir;           // (spread / width, 0) or (0, spread / height)
  void main() {
    vec4 c = texture(uTex, vUv) * 0.2270270270;
    c += texture(uTex, vUv + uDir * 1.3846153846) * 0.3162162162;
    c += texture(uTex, vUv - uDir * 1.3846153846) * 0.3162162162;
    c += texture(uTex, vUv + uDir * 3.2307692308) * 0.0702702703;
    c += texture(uTex, vUv - uDir * 3.2307692308) * 0.0702702703;
    outColor = c;                          // alpha preserved (also used as a copy)
  }`;

  /** Final composite: glass, condensation, refracting drops, streaks, light. */
  const GLASS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uScene;    // background (sharp, after user blur)
  uniform sampler2D uBlur;     // heavily blurred background
  uniform sampler2D uWater;    // water normal map (GPU render target)
  uniform sampler2D uFog;      // condensation clear mask (GPU render target)
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uRefraction;
  uniform float uDistortion;
  uniform float uChromatic;
  uniform float uTransparency;
  uniform float uReflection;
  uniform float uCondensation;
  uniform float uBlurAmt;
  uniform float uStreaks;
  uniform float uRainAmt;
  uniform float uFlash;
  uniform float uDayNight;     // -1 night .. 0 neutral .. 1 day
  uniform sampler2D uSnow;     // snow stuck on the glass (coverage in r)
  uniform float uSnowMode;     // 1 = snow falls outside instead of rain
  uniform float uFrost;        // ice crystals on the glass
  uniform vec2 uParallax;      // background offset (cursor parallax)
  uniform float uPZoom;        // background over-scan for parallax
  uniform float uPulse;        // music level: lights behind the glass pulse

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // Rain falling outside, behind the glass (out of focus streaks).
  float streakLayer(vec2 uv, float scale, float speed, float density, float seed) {
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    p.x += p.y * 0.06;                    // slight wind slant
    p *= vec2(scale, scale * 0.18);
    p.y += uTime * speed;
    vec2 id = floor(p);
    vec2 f = fract(p);
    float h = hash(id + seed);
    if (h > density) return 0.0;
    float x = 0.2 + 0.6 * hash(id * 1.7 + seed);
    float w = 0.035;
    float line = smoothstep(w, 0.0, abs(f.x - x));
    float len = 0.35 + 0.5 * hash(id * 3.1 + seed);
    float start = hash(id * 5.3 + seed) * (1.0 - len);
    float seg = smoothstep(start, start + 0.1, f.y) * smoothstep(start + len, start + len - 0.15, f.y);
    return line * seg * (0.5 + 0.5 * h / density);
  }

  // Snow falling outside: flakes of different sizes that flutter and drift
  // with the wind. Near layers are bigger, faster and out of focus.
  float flakeField(vec2 uv, float scale, float speed, float size, float soft, float density, float seed) {
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(uv.x * aspect, uv.y) * scale;
    float t = uTime * speed;
    p.y += t;
    p.x += t * 0.28 + sin(uTime * 0.17 + seed) * 0.9;     // wind drift + slow gusts
    vec2 id0 = floor(p);
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 id = id0 + vec2(float(i), float(j));
        float h = hash(id + seed);
        if (h > density) continue;
        vec2 c = id + vec2(hash(id * 1.31 + seed), hash(id * 2.73 + seed));
        float ph = hash(id * 4.11 + seed) * 6.283;
        c.x += sin(uTime * (0.7 + h) + ph) * 0.28;          // flutter
        c.y += cos(uTime * (0.5 + h) * 0.8 + ph) * 0.12;
        float r = size * (0.45 + 0.9 * hash(id * 5.93 + seed));
        float d = length(p - c);
        acc += smoothstep(r, r * soft, d) * (0.6 + 0.4 * hash(id * 7.7 + seed));
      }
    }
    return acc;
  }

  // Ridged fbm → branching ice-crystal veins.
  float frostPattern(vec2 p) {
    float n = 0.0, a = 0.55;
    for (int i = 0; i < 5; i++) {
      n += a * (1.0 - abs(noise(p) * 2.0 - 1.0));
      p = p * 2.07 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return n;
  }

  void main() {
    vec2 uv = vUv;
    // Background coordinates: over-scanned and shifted for cursor parallax.
    vec2 suv = (uv - 0.5) / uPZoom + 0.5 + uParallax;
    vec2 aspect = vec2(uRes.y / uRes.x, 1.0);

    // ---- glass surface imperfections --------------------------------------
    vec2 wave = vec2(noise(uv * vec2(4.0, 9.0) + 3.1), noise(uv * vec2(5.0, 8.0) - 7.3)) - 0.5;
    wave += 0.5 * (vec2(noise(uv * 23.0 + 1.0), noise(uv * 21.0 - 4.0)) - 0.5);
    vec2 guv = suv + wave * uDistortion * 0.006;

    // ---- water map ---------------------------------------------------------
    vec4 w = texture(uWater, uv);
    w.rgb /= max(w.a, 0.004);              // water map is premultiplied
    float cov = smoothstep(0.30, 0.42, w.a);
    vec2 n = vec2(w.r * 2.0 - 1.0, -(w.g * 2.0 - 1.0));
    float nl = clamp(length(n), 0.0, 1.0);
    float thick = w.b;

    // ---- glass (no drop) ---------------------------------------------------
    float cleared = texture(uFog, uv).r;
    float fog = uCondensation * (1.0 - cleared);
    vec3 gSharp = texture(uScene, guv).rgb;
    vec3 gBlur = texture(uBlur, guv).rgb;
    vec3 glass = mix(gSharp, gBlur, clamp(fog * 1.4, 0.0, 1.0));
    // Condensation is milky: lifts shadows and scatters light.
    vec3 fogTint = gBlur * 0.75 + vec3(0.10, 0.115, 0.13) + luma(gBlur) * 0.15;
    glass = mix(glass, fogTint, fog * 0.55);
    // Glass transparency: less transparent = more diffuse + grey tinted.
    float opacity = 1.0 - uTransparency;
    glass = mix(glass, gBlur * 0.8 + vec3(0.06, 0.07, 0.08), opacity * 0.7);

    // Ice crystals grow from the window edges; wiped by water and the mouse.
    float frostMask = 0.0;
    if (uFrost > 0.0) {
      vec2 e = min(uv, 1.0 - uv);
      float edge = 1.0 - clamp(min(e.x * uRes.x / uRes.y, e.y) * 2.6, 0.0, 1.0);
      vec2 fp = uv * vec2(uRes.x / uRes.y, 1.0);
      float pat = frostPattern(fp * 11.0) * 0.7 + frostPattern(fp * 3.0 + 4.0) * 0.45;
      float grow = edge * 1.1 + uFrost * 0.55 - 0.35;           // ice grows inward from the frame
      frostMask = smoothstep(0.62, 0.95, pat * grow + uFrost * 0.25);
      frostMask = max(frostMask, smoothstep(0.85, 1.0, edge) * uFrost * 0.9);
      frostMask *= 1.0 - cleared * 0.9;
      vec3 ice = gBlur * 0.45 + vec3(0.74, 0.84, 0.95) * (0.32 + luma(gBlur) * 0.45);
      ice *= 0.8 + smoothstep(0.9, 1.3, frostPattern(fp * 26.0)) * 0.45;   // crystalline veins
      glass = mix(glass, ice, frostMask * 0.85);
    }

    // Snow falling outside the window.
    if (uSnowMode > 0.5 && uStreaks > 0.0) {
      float dens = 0.25 + 0.6 * uStreaks;
      float far  = flakeField(uv, 34.0, 1.6, 0.07, 0.15, dens, 1.0);
      float mid  = flakeField(uv, 15.0, 1.15, 0.09, 0.2, dens * 0.85, 5.0);
      float near = flakeField(uv, 6.5, 0.85, 0.11, 0.35, dens * 0.6, 9.0);
      float bokeh = flakeField(uv, 2.4, 0.5, 0.16, 0.0, 0.18 + 0.2 * uStreaks, 13.0);
      vec3 lit = vec3(0.92, 0.95, 1.0) * (0.45 + luma(gBlur) * 0.6);
      glass = mix(glass, glass * 0.9 + lit * 0.12, uStreaks * 0.35);    // snowy haze
      float sn = far * 0.35 + mid * 0.6 + near * 0.85 + bokeh * 0.22;
      glass = mix(glass, lit, clamp(sn * (0.35 + 0.65 * uStreaks), 0.0, 0.95) * (1.0 - fog * 0.4));
    }
    // Rain streaks outside the window.
    else if (uStreaks > 0.0) {
      float s = streakLayer(uv, 38.0, 2.6, 0.10 + uRainAmt * 0.25, 1.0) * 0.6
              + streakLayer(uv, 70.0, 3.4, 0.08 + uRainAmt * 0.2, 7.0) * 0.4
              + streakLayer(uv, 120.0, 4.4, 0.06 + uRainAmt * 0.18, 13.0) * 0.25;
      glass += s * uStreaks * (0.06 + luma(gBlur) * 0.35) * (1.0 - fog * 0.6);
    }

    // ---- drops: convex lenses ---------------------------------------------
    vec3 drop = glass;
    if (cov > 0.001) {
      // Refraction: a water lens shows a magnified, inverted image of what
      // lies behind it → sample against the normal, more for thicker drops.
      vec2 off = -n * (0.015 + 0.11 * uRefraction) * (0.35 + thick * 0.9) * aspect;
      off += wave * uDistortion * 0.01;
      float ca = uChromatic * 0.18;
      vec2 base = suv + off;
      vec3 sharp = vec3(
        texture(uScene, suv + off * (1.0 + ca)).r,
        texture(uScene, base).g,
        texture(uScene, suv + off * (1.0 - ca)).b);
      vec3 blurred = texture(uBlur, base).rgb;
      // Larger (thicker) drops defocus the background more.
      float db = uBlurAmt * smoothstep(0.35, 1.0, thick) * 0.85;
      drop = mix(sharp, blurred, db);
      // Lens focusing: brighter centre, light loss at the rim.
      drop *= 0.92 + 0.18 * thick;
      float rim = smoothstep(0.55, 1.0, nl);
      drop = mix(drop, drop * 0.28 + gBlur * 0.05, rim * 0.75);
      // Depth: drops are slightly darker and more contrasted than the glass.
      drop = mix(drop, drop * drop * 1.25, 0.15);

      // Specular highlight (light from upper-left) + bottom caustic crescent.
      vec3 N = normalize(vec3(n * 1.8, 1.0));
      vec3 L = normalize(vec3(-0.45, 0.65, 1.0));
      vec3 R = reflect(-L, N);
      float spec = pow(max(R.z, 0.0), 60.0);
      float spec2 = pow(max(dot(N, normalize(vec3(-0.3, 0.5, 1.0))), 0.0), 220.0);
      float caustic = smoothstep(0.35, 0.8, nl) * smoothstep(0.0, -0.8, n.y) * smoothstep(1.0, 0.85, nl);
      vec3 env = gBlur + 0.15;
      drop += (spec * 0.55 + spec2 * 0.9) * uReflection * (0.6 + env * 0.6);
      drop += caustic * uReflection * 0.35 * env;
    }

    vec3 col = mix(glass, drop, cov);

    // Snow stuck on the glass: packed crystals with relief, thin edges let light through.
    float sc = texture(uSnow, uv).r;
    if (sc > 0.002) {
      vec2 px = 2.0 / uRes;
      float sx = texture(uSnow, uv + vec2(px.x, 0.0)).r - texture(uSnow, uv - vec2(px.x, 0.0)).r;
      float sy = texture(uSnow, uv + vec2(0.0, px.y)).r - texture(uSnow, uv - vec2(0.0, px.y)).r;
      vec2 fp = uv * uRes / uRes.y;
      float crystal = frostPattern(fp * 80.0);
      float grain = 0.75 + 0.5 * noise(uv * uRes / 2.5);
      float dens = sc * grain * (0.75 + 0.35 * crystal);
      float cover = smoothstep(0.04, 0.55, dens);
      float light = clamp(0.5 + (sx - sy) * 4.0, 0.0, 1.0);          // light from the upper left
      vec3 snowCol = vec3(0.93, 0.96, 1.0) * (0.5 + luma(gBlur) * 0.55);
      snowCol *= 0.78 + 0.44 * light;
      vec3 thin = mix(gBlur * 1.1, vec3(0.86, 0.91, 1.0), 0.4);          // translucent edges
      snowCol = mix(thin, snowCol, smoothstep(0.3, 0.95, dens));
      snowCol += step(0.985, hash(floor(uv * uRes / 2.0))) * 0.3 * uReflection * light;   // sparkles
      col = mix(col, snowCol, cover * 0.9);
    }

    // ---- glass reflections -----------------------------------------------
    float sheen = smoothstep(0.0, 1.0, 1.0 - uv.y) * 0.03
                + smoothstep(0.08, 0.0, abs(fract((uv.x * 0.6 + uv.y) * 0.9 - 0.2) - 0.5) - 0.32) * 0.025;
    col += sheen * uReflection * (0.5 + luma(gBlur));

    // ---- music: bright lights (bokeh, lamps, windows) pulse with the beat ---
    if (uPulse > 0.001) {
      float bright = smoothstep(0.35, 0.9, luma(gBlur));
      col += (gBlur * 0.55 + 0.04) * bright * uPulse * 0.9 + col * uPulse * 0.06;
    }

    // ---- lightning ----------------------------------------------------------
    col += uFlash * (col * 0.9 + vec3(0.16, 0.17, 0.2) + gBlur * 0.4 + cov * 0.25);

    // ---- day / night grading -----------------------------------------------
    if (uDayNight < 0.0) {
      float t = -uDayNight;
      col *= mix(1.0, 0.55, t);
      col = mix(col, col * vec3(0.72, 0.86, 1.25), t * 0.85);
    } else {
      float t = uDayNight;
      col *= vec3(1.0 + 0.12 * t, 1.0 + 0.05 * t, 1.0 - 0.06 * t);
    }

    // Subtle vignette for depth.
    vec2 vc = uv - 0.5;
    col *= 1.0 - dot(vc, vc) * 0.25;

    // Tiny dither to avoid banding in dark skies.
    col += (hash(uv * uRes + fract(uTime)) - 0.5) / 255.0;
    outColor = vec4(col, 1.0);
  }`;

  /** Instanced sprites for the GPU water map (drops, droplets, wipes, fog). */
  const SPRITE_VERT = `#version 300 es
  layout(location = 0) in vec2 aCorner;
  layout(location = 1) in vec4 aRect;    // x, y, w, h in simulation pixels (top-left origin)
  layout(location = 2) in vec2 aMeta;    // atlas bucket, alpha
  uniform vec2 uRes;
  out vec2 vUv;
  out float vBucket;
  out float vAlpha;
  void main() {
    vec2 p = aRect.xy + aCorner * aRect.zw;
    vUv = aCorner;
    vBucket = aMeta.x;
    vAlpha = aMeta.y;
    gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  }`;

  const SPRITE_FRAG = `#version 300 es
  precision highp float;
  in vec2 vUv;
  in float vBucket;
  in float vAlpha;
  out vec4 outColor;
  uniform sampler2D uAtlas;
  uniform float uBuckets;
  uniform int uMode;          // 0 drop sprite, 1 soft disc, 2 solid fill
  uniform vec4 uColor;
  void main() {
    if (uMode == 0) {
      vec4 c = texture(uAtlas, vec2((vBucket + clamp(vUv.x, 0.004, 0.996)) / uBuckets, vUv.y));
      float a = c.a * vAlpha;
      outColor = vec4(c.rgb * a, a);        // premultiplied
    } else if (uMode == 1) {
      float d = length(vUv * 2.0 - 1.0);
      float a = d < 0.6 ? mix(1.0, 0.9, d / 0.6) : mix(0.9, 0.0, clamp((d - 0.6) / 0.4, 0.0, 1.0));
      a *= uColor.a * vAlpha;
      outColor = vec4(uColor.rgb * a, a);
    } else {
      outColor = vec4(uColor.rgb * uColor.a, uColor.a);
    }
  }`;

  root.RainGlass = root.RainGlass || {};
  root.RainGlass.Shaders = { VERT, COMPOSE, BLUR, GLASS, SPRITE_VERT, SPRITE_FRAG };
})(typeof self !== 'undefined' ? self : this);
