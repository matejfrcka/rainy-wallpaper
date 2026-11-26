/**
 * RainAudio – procedurally synthesized rain ambience and thunder (WebAudio).
 * No audio files are needed: layered filtered noise + random droplet ticks on
 * the glass + rumbling thunder with lowpass sweeps.
 */
(function (root) {
  'use strict';

  function noiseBuffer(ctx, seconds, type) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852; b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        } else if (type === 'brown') {
          last = (last + 0.02 * white) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = white;
      }
      // Crossfade the loop seam.
      const fade = Math.min(2048, len >> 4);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[i] = d[i] * t + d[len - fade + i] * (1 - t);
      }
    }
    return buf;
  }

  /**
   * Soundscapes: filter tuning of the three noise layers and of the
   * droplet ticks. [hissHP, hissLP, bodyLP, patterBP, patterQ,
   * tickFreqMin, tickFreqMax, tickQMin, tickQMax, tickDecay, tickAmp, gains{hiss,body,patter}]
   */
  const PROFILES = {
    window: { hiss: [400, 7500], body: 900, patter: [1800, 0.8], tick: [1800, 6800, 4, 10, 0.03, 1], gain: [1, 1, 1] },
    roof:   { hiss: [250, 5000], body: 600, patter: [900, 2.0], tick: [500, 2600, 9, 22, 0.12, 1.6], gain: [0.8, 1.5, 1.3] },
    leaves: { hiss: [1200, 9500], body: 1200, patter: [3200, 0.6], tick: [2500, 8500, 1, 3, 0.02, 0.6], gain: [1.4, 0.5, 1.2] },
    car:    { hiss: [150, 1800], body: 400, patter: [700, 1.2], tick: [250, 1200, 2, 5, 0.06, 1.8], gain: [0.6, 1.7, 1.1] },
  };

  class RainAudio {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.volume = 0.5;
      this.intensity = 0.5;
      this.suspended = false;
      this.profile = PROFILES.window;
      this.wind = false;
      this.windVolume = 0.4;
    }

    ensure() {
      if (this.ctx) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);

      this.pink = noiseBuffer(ctx, 6, 'pink');
      this.brown = noiseBuffer(ctx, 8, 'brown');
      this.white = noiseBuffer(ctx, 1, 'white');

      // Layer 1: broadband rain hiss.
      this.hiss = this.loop(this.pink, [['highpass', 400, 0.5], ['lowpass', 7500, 0.5]]);
      // Layer 2: heavy rain body / roof rumble.
      this.body = this.loop(this.brown, [['lowpass', 900, 0.7]]);
      // Layer 3: mid "patter" band, slowly modulated.
      this.patter = this.loop(this.pink, [['bandpass', 1800, 0.8]]);
      // Layer 4: wind – band-passed brown noise with a wandering centre frequency.
      this.windLayer = this.loop(this.brown, [['bandpass', 400, 1.2]]);
      this.windTimer = setInterval(() => this.gust(), 2500);
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.08;
      this.lfo.connect(lfoGain).connect(this.patter.gain.gain);
      this.lfo.start();

      this.applyLevels(0.01);
      this.tickTimer = setInterval(() => this.scheduleTicks(), 100);
    }

    loop(buffer, filters) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buffer.duration;
      let node = src;
      this._lastFilters = [];
      for (const [type, freq, q] of filters) {
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        node.connect(f); node = f;
        this._lastFilters.push(f);
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(this.master);
      src.start(0, Math.random() * buffer.duration);
      return { src, gain, filters: node === src ? [] : this._lastFilters };
    }

    applyLevels(ramp = 0.6) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const i = this.intensity;
      const on = this.enabled && !this.suspended;
      if (!this.fading) this.master.gain.setTargetAtTime(on ? this.volume * 0.9 : 0, t, ramp);
      const P = this.profile, g = P.gain;
      this.hiss.gain.gain.setTargetAtTime((0.12 + i * 0.45) * g[0], t, ramp);
      this.body.gain.gain.setTargetAtTime((0.05 + i * i * 0.6) * g[1], t, ramp);
      this.patter.gain.gain.setTargetAtTime((0.06 + i * 0.25) * g[2], t, ramp);
      const [hp, lp] = this.hiss.filters;
      hp.frequency.setTargetAtTime(P.hiss[0], t, ramp);
      lp.frequency.setTargetAtTime(P.hiss[1], t, ramp);
      this.body.filters[0].frequency.setTargetAtTime(P.body, t, ramp);
      this.patter.filters[0].frequency.setTargetAtTime(P.patter[0], t, ramp);
      this.patter.filters[0].Q.setTargetAtTime(P.patter[1], t, ramp);
      this.windLayer.gain.gain.setTargetAtTime(this.wind ? this.windVolume * 0.9 : 0, t, ramp * 2);
    }

    /** Wind gusts: wander the band centre and level. */
    gust() {
      if (!this.ctx || !this.wind) return;
      const t = this.ctx.currentTime;
      const f = this.windLayer.filters[0];
      f.frequency.setTargetAtTime(180 + Math.random() * 650, t, 1.5);
      f.Q.setTargetAtTime(0.8 + Math.random() * 2, t, 1.5);
      this.windLayer.gain.gain.setTargetAtTime(this.windVolume * (0.4 + Math.random() * 0.9), t, 1.2);
    }

    /** Short droplet impacts on the glass, randomly panned. */
    scheduleTicks() {
      if (!this.ctx || !this.enabled || this.suspended || this.ctx.state !== 'running') return;
      const ctx = this.ctx;
      const n = Math.round((4 + this.intensity * 40) * 0.1 * (0.5 + Math.random()));
      for (let k = 0; k < n; k++) {
        const t = ctx.currentTime + 0.05 + Math.random() * 0.1;
        const src = ctx.createBufferSource();
        src.buffer = this.white;
        const [fMin, fMax, qMin, qMax, decay, ampK] = this.profile.tick;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fMin + Math.random() * (fMax - fMin);
        bp.Q.value = qMin + Math.random() * (qMax - qMin);
        const g = ctx.createGain();
        const amp = (0.04 + Math.random() * 0.12) * ampK;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay + Math.random() * decay);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        let node = src.connect(bp).connect(g);
        if (pan) { pan.pan.value = Math.random() * 2 - 1; node = node.connect(pan); }
        node.connect(this.master);
        src.start(t, Math.random() * 0.7, 0.3);
        src.onended = () => src.disconnect();
      }
    }

    /** Thunder clap; `distance` 0 (overhead crack) .. 1 (far rumble). */
    thunder(distance = 0.5) {
      if (!this.ctx || !this.enabled || this.suspended) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + 0.05;
      const dur = 5 + Math.random() * 5;
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(distance < 0.35 ? 2500 : 900, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + dur);
      const g = ctx.createGain();
      const peak = (1.4 - distance) * 1.1;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (distance < 0.35 ? 0.04 : 0.6));
      // Irregular rolling.
      let tt = t + 0.6;
      while (tt < t + dur - 0.5) {
        tt += 0.25 + Math.random() * 0.8;
        g.gain.exponentialRampToValueAtTime(peak * (0.25 + Math.random() * 0.75) * (1 - (tt - t) / dur * 0.7), tt);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp).connect(g).connect(this.master);
      src.start(t, Math.random() * 2, dur + 0.2);
      src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); };
    }

    setOptions({ enabled, volume, intensity, soundscape, wind, windVolume }) {
      if (soundscape !== undefined) this.profile = PROFILES[soundscape] || PROFILES.window;
      if (wind !== undefined) this.wind = !!wind;
      if (windVolume !== undefined) this.windVolume = windVolume;
      if (enabled !== undefined) this.enabled = enabled;
      if (volume !== undefined) this.volume = volume;
      if (intensity !== undefined) this.intensity = intensity;
      if (this.enabled) {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended' && !this.suspended) this.ctx.resume().catch(() => {});
      }
      this.applyLevels();
    }

    /** Sleep timer: fade the whole ambience to silence over `seconds`. */
    fadeOut(seconds) {
      if (!this.ctx) return;
      this.fading = true;
      const g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + seconds);
    }

    cancelFade() {
      if (!this.fading) return;
      this.fading = false;
      if (this.ctx) this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.applyLevels(1.5);
    }

    setSuspended(s) {
      this.suspended = s;
      if (!this.ctx) return;
      this.applyLevels(0.2);
      if (s) setTimeout(() => { if (this.suspended && this.ctx) this.ctx.suspend().catch(() => {}); }, 500);
      else if (this.enabled) this.ctx.resume().catch(() => {});
    }

    destroy() {
      clearInterval(this.tickTimer);
      clearInterval(this.windTimer);
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  root.RainGlass = root.RainGlass || {};
  root.RainGlass.RainAudio = RainAudio;
})(typeof self !== 'undefined' ? self : this);
