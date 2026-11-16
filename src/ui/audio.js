/** Tiny procedural audio: ambience plus battle feedback. No external files. */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.lastHit = 0;
    this.ambientNodes = [];
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  }

  ambient() {
    this.init();
    if (!this.ctx || this.ambientNodes.length) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    const o1 = this.ctx.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine'; o2.frequency.value = 82.4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    o1.connect(lp); o2.connect(lp); lp.connect(g);
    o1.start(); o2.start();
    this.ambientNodes = [o1, o2, g];

    // wind
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 420; nf.Q.value = 0.7;
    const ng = this.ctx.createGain(); ng.gain.value = 0.03;
    noise.connect(nf); nf.connect(ng); ng.connect(this.master);
    noise.start();
    this.ambientNodes.push(noise, ng);
  }

  blip(freq = 440, dur = 0.09, type = 'triangle', gain = 0.14) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  }

  hit() {
    if (!this.ctx || !this.enabled) return;
    const now = performance.now();
    if (now - this.lastHit < 70) return;
    this.lastHit = now;
    this.blip(120 + Math.random() * 60, 0.06, 'square', 0.05);
  }

  build() { this.blip(320, 0.14, 'triangle', 0.09); }
  recruit() { this.blip(520, 0.12, 'sine', 0.1); }
  victory() {
    [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.32, 'sine', 0.16), i * 160));
  }
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.42, 'sine', 0.16), i * 190));
  }
}
