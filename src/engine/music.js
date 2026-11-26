/**
 * MusicReactor – listens to what the PC is playing (Windows audio loopback via
 * getDisplayMedia + the main process' display-media handler) and turns it into
 * a smooth level (0..1) for light pulsing plus beat events for lightning.
 */
(function (root) {
  'use strict';

  class MusicReactor {
    constructor({ onLevel = () => {}, onBeat = () => {} } = {}) {
      this.onLevel = onLevel;
      this.onBeat = onBeat;
      this.sensitivity = 0.5;
      this.running = false;
    }

    async start() {
      if (this.running) return;
      // Video is required by the API; ask for the cheapest possible stream and keep it idle.
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { frameRate: 1, width: 16, height: 16 } });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('System audio capture is not available');
      }
      this.stream = stream;
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.55;
      src.connect(this.analyser); // analysis only – never played back
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.level = 0;
      this.bassAvg = 0;
      this.lastBeat = 0;
      this.running = true;
      this.timer = setInterval(() => this.tick(), 33);
    }

    tick() {
      const a = this.analyser;
      a.getByteFrequencyData(this.bins);
      const b = this.bins;
      let bass = 0, all = 0;
      for (let i = 1; i < 9; i++) bass += b[i];          // ~40–380 Hz
      for (let i = 1; i < 200; i++) all += b[i];
      bass /= 8 * 255;
      all /= 199 * 255;
      const k = 0.4 + this.sensitivity * 1.6;
      const target = Math.min(1, (all * 0.6 + bass * 0.8) * k * 1.6);
      this.level += (target - this.level) * (target > this.level ? 0.5 : 0.12);
      // Beat: bass jumps clearly above its running average (steady rain noise doesn't).
      this.bassAvg += (bass - this.bassAvg) * 0.05;
      const now = performance.now();
      if (bass > 0.25 && bass > this.bassAvg * (1.55 - this.sensitivity * 0.4) && now - this.lastBeat > 280) {
        this.lastBeat = now;
        this.onBeat(Math.min(1, (bass - this.bassAvg) * 3 * k));
      }
      this.onLevel(this.level);
    }

    stop() {
      clearInterval(this.timer);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      this.stream = this.ctx = null;
      this.running = false;
      this.onLevel(0);
    }
  }

  root.RainGlass = root.RainGlass || {};
  root.RainGlass.MusicReactor = MusicReactor;
})(typeof self !== 'undefined' ? self : this);
