// 纯 WebAudio 合成：无任何音频文件
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.musicOn = true;
    this.params = { speed: 0, pedaling: true, night: 0, cadence: 0 };
    this.volume = 0.8;
    this.musicVolume = 0.55;
    this.sfxVolume = 0.9;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // 混响总线
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    const mSend = ctx.createGain();
    mSend.gain.value = 0.5;
    this.musicBus.connect(mSend).connect(this.reverb);

    this.noise = this.noiseBuffer();
    this.brown = this.brownBuffer();

    // 风声
    this.wind = this.loop(this.noise);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx);

    // 胎噪
    this.roll = this.loop(this.brown);
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 260;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.roll.connect(this.rollFilter).connect(this.rollGain).connect(this.sfx);

    // 海浪（左侧）+ 慢速 LFO
    this.surf = this.loop(this.brown);
    const surfF = ctx.createBiquadFilter();
    surfF.type = 'lowpass';
    surfF.frequency.value = 700;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(this.surfGain.gain);
    lfo.start();
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.6;
    this.surf.connect(surfF).connect(this.surfGain).connect(pan).connect(this.sfx);

    this.nextTick = 0;
    this.enabled = true;
    // 音乐调度
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), 25);
    this.nextGull = ctx.currentTime + 4;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  brownBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicOn ? v : 0, this.ctx.currentTime, 0.1);
  }
  setMusic(on) {
    this.musicOn = on;
    this.setMusicVolume(this.musicVolume);
  }
  mute(m) {
    if (!this.ctx) return;
    if (m) this.ctx.suspend();
    else this.ctx.resume();
  }

  update(p) {
    Object.assign(this.params, p);
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const v = p.speed;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, v * v * 0.0022), t, 0.2);
    this.windFilter.frequency.setTargetAtTime(250 + v * 70, t, 0.2);
    this.rollGain.gain.setTargetAtTime(p.airborne ? 0 : Math.min(0.35, v * 0.028), t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(160 + v * 22, t, 0.2);
    // 滑行时的飞轮棘轮声
    if (!p.pedaling && v > 0.5 && t > this.nextTick) {
      this.click(t, 0.05);
      this.nextTick = t + Math.max(0.012, 0.35 / v);
    }
    if (t > this.nextGull) {
      this.gull(t);
      this.nextGull = t + 7 + Math.random() * 12;
    }
  }

  click(t, vol) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random(), 0.03);
  }

  tone({ freq, type = 'sine', t, dur, vol, attack = 0.005, dest, detune = 0, glide }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  bell() {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime;
    for (const off of [0, 0.16]) {
      const t = t0 + off;
      const base = 2350;
      [1, 2.63, 4.17, 5.43].forEach((r, i) => {
        const g = this.tone({ freq: base * r, t, dur: 1.4 - i * 0.25, vol: 0.18 / (i + 1), detune: i * 4 });
        g.connect(this.reverb);
      });
      this.tone({ freq: base * 1.004, t, dur: 1.2, vol: 0.08 });
    }
  }

  honk() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.linearRampToValueAtTime(240, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    const vib = ctx.createOscillator();
    vib.frequency.value = 28;
    const vg = ctx.createGain();
    vg.gain.value = 18;
    vib.connect(vg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 720;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1250;
    f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverb);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.55);
    vib.stop(t + 0.55);
  }

  gulp(golden) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 420, glide: 90, t, dur: 0.18, vol: 0.35 });
    this.tone({ freq: 260, glide: 70, t: t + 0.12, dur: 0.2, vol: 0.25 });
    // 收集音：五声音阶上行琶音
    const notes = golden ? [79, 83, 86, 91, 95] : [76, 81, 88];
    notes.forEach((n, i) => {
      const g = this.tone({ freq: midi(n), t: t + 0.05 + i * 0.07, dur: 0.6, vol: 0.12, type: 'triangle' });
      g.connect(this.reverb);
    });
  }

  splash() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.5;
    s.connect(f).connect(g).connect(pan).connect(this.sfx);
    s.start(t, Math.random(), 0.6);
  }

  thump() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 110, glide: 45, t, dur: 0.25, vol: 0.5 });
    this.click(t, 0.2);
  }

  whoosh() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random(), 0.6);
  }

  gull(t) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.3 - Math.random() * 0.6;
    const out = ctx.createGain();
    out.gain.value = 0.05;
    out.connect(pan).connect(this.sfx);
    out.connect(this.reverb);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.28;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(1500, s);
      o.frequency.exponentialRampToValueAtTime(2300, s + 0.06);
      o.frequency.exponentialRampToValueAtTime(1100, s + 0.22);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2000;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(1, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24);
      o.connect(f).connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.3);
    }
  }

  // ------- 生成式音乐：速度跟随踏频 -------
  schedule() {
    if (!this.enabled || !this.musicOn) return;
    const ctx = this.ctx;
    const bpm = Math.min(126, Math.max(72, this.params.cadence || 84));
    const sixteenth = 60 / bpm / 4;
    // 音乐关闭/后台期间不补发积压的音符
    if (this.nextNote < ctx.currentTime) this.nextNote = ctx.currentTime + 0.05;
    while (this.nextNote < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextNote, sixteenth);
      const swing = this.step % 2 ? 0.92 : 1.08;
      this.nextNote += sixteenth * swing;
      this.step = (this.step + 1) % 256;
    }
  }

  playStep(step, t, dur) {
    const night = this.params.night;
    // D 大调：Dmaj9 - Bm9 - Gmaj9 - A13
    const chords = [
      [50, 57, 61, 64, 66],
      [47, 54, 57, 61, 62],
      [43, 50, 54, 57, 59],
      [45, 52, 55, 59, 61],
    ];
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const ch = chords[bar];
    const bus = this.musicBus;
    if (s === 0) {
      // 柔和铺底和弦
      ch.forEach((n, i) => {
        const g = this.tone({ freq: midi(n + 12), type: 'triangle', t, dur: dur * 16, vol: 0.045, attack: 0.4, dest: bus, detune: (i % 2 ? 6 : -6) });
        void g;
      });
      this.tone({ freq: midi(ch[0] - 12), type: 'sine', t, dur: dur * 8, vol: 0.16, attack: 0.02, dest: bus });
    }
    if (s === 8) this.tone({ freq: midi(ch[0] - 12 + (bar % 2 ? 7 : 0)), type: 'sine', t, dur: dur * 6, vol: 0.12, attack: 0.02, dest: bus });
    // 拨弦琶音
    const pattern = [0, 2, 3, 4, 1, 3, 2, 4];
    if (s % 2 === 0) {
      const idx = pattern[(s / 2) % pattern.length];
      const oct = s >= 8 && bar % 2 ? 24 : 12;
      const n = ch[idx] + oct;
      this.tone({ freq: midi(n), type: 'sine', t, dur: dur * 3.5, vol: 0.07 * (night > 0.5 ? 0.8 : 1), dest: bus });
      this.tone({ freq: midi(n) * 2.001, type: 'sine', t, dur: dur * 1.5, vol: 0.012, dest: bus });
    }
    if (night > 0.6) return; // 夜晚只保留氛围
    // 轻鼓
    if (s === 0 || s === 10) {
      this.tone({ freq: 120, glide: 42, t, dur: 0.22, vol: 0.3, dest: bus });
    }
    if (s === 4 || s === 12) this.snare(t, 0.07);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.035 : 0.018);
  }

  snare(t, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random(), 0.2);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random(), 0.06);
  }
}
