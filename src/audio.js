// Procedural, soft, ASMR-like sound: plop + splash, a fizz hiss that follows the fizz, tiny bubble
// pops, gentle lapping, drain gurgle and the refill pour. Starts on the first user gesture.
export class Audio {
  constructor() {
    this.ctx = null; this.muted = false; this.ready = false;
    this.fizzLevel = 0; this.stirLevel = 0;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.4; }
    // fizz bed: band-passed hiss whose level follows the fizz
    this.fizzGain = ctx.createGain(); this.fizzGain.gain.value = 0;
    const fz = this.loopNoise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    fz.connect(bp).connect(hp).connect(this.fizzGain).connect(this.master);
    // lapping: low, slow-modulated water bed
    this.lapGain = ctx.createGain(); this.lapGain.gain.value = 0.035;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lfoG = ctx.createGain(); lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    this.loopNoise().connect(lp).connect(this.lapGain).connect(this.master);
    // stir swish
    this.stirGain = ctx.createGain(); this.stirGain.gain.value = 0;
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 900; sbp.Q.value = 0.9;
    this.loopNoise().connect(sbp).connect(this.stirGain).connect(this.master);
    // drain gurgle / pour beds
    this.drainGain = ctx.createGain(); this.drainGain.gain.value = 0;
    const dbp = ctx.createBiquadFilter(); dbp.type = 'bandpass'; dbp.frequency.value = 260; dbp.Q.value = 5;
    const dlfo = ctx.createOscillator(); dlfo.frequency.value = 5.5; const dlg = ctx.createGain(); dlg.gain.value = 120;
    dlfo.connect(dlg).connect(dbp.frequency); dlfo.start();
    this.loopNoise().connect(dbp).connect(this.drainGain).connect(this.master);
    this.pourGain = ctx.createGain(); this.pourGain.gain.value = 0;
    const pbp = ctx.createBiquadFilter(); pbp.type = 'lowpass'; pbp.frequency.value = 2600;
    const pbp2 = ctx.createBiquadFilter(); pbp2.type = 'highpass'; pbp2.frequency.value = 180;
    this.loopNoise().connect(pbp).connect(pbp2).connect(this.pourGain).connect(this.master);
    this.ready = true;
  }

  loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // one-shots
  plop(strength = 1) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
    // splash: bright noise burst
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.6;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0, t); ng.gain.linearRampToValueAtTime(0.35 * strength, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    n.connect(f).connect(ng).connect(this.master); n.start(t, Math.random()); n.stop(t + 0.75);
    // droplets falling back
    for (let i = 0; i < 7; i++) this.pop(0.25 + Math.random() * 0.5, 0.15 + Math.random() * 0.5);
  }

  pop(gain = 0.12, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = 'sine';
    const f0 = 700 + Math.random() * 1600;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.035);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * 0.12, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.06);
  }

  bump(v) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(0.18, v * 4), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.14);
  }

  tick() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1800;
    const g = c.createGain(); g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.05);
  }

  // continuous levels, eased
  update(dt, { fizz = 0, stir = 0, drain = 0, pour = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.fizzGain.gain.setTargetAtTime(Math.min(0.22, fizz * 0.16), t, 0.15);
    this.stirGain.gain.setTargetAtTime(Math.min(0.25, stir * 0.5), t, 0.08);
    this.drainGain.gain.setTargetAtTime(drain * 0.35, t, 0.3);
    this.pourGain.gain.setTargetAtTime(pour * 0.22, t, 0.3);
    // crackle: tiny pops scale with fizz
    if (fizz > 0.05 && Math.random() < dt * 26 * fizz) this.pop(0.4 + Math.random() * 0.8);
    if (drain > 0.2 && Math.random() < dt * 3) this.pop(1.5, 0);
  }
}
