/**
 * 程序化合成音效模块（运输船 FPS）
 * 只使用 Web Audio API（+ 可选 speechSynthesis），无外部音频文件、无依赖。
 * 位置一律为普通对象 {x,y,z}（米，Y 轴向上）。
 *
 * 信号路由：
 *   world(游戏世界音) → muffle(受伤/震荡低通) → sfx ┐
 *   ui(界面/命中反馈/心跳)             → sfx ┤
 *   ambient(环境音床)                         ├→ premix → compressor → master → 软限幅 → destination
 *   voice(播报徽章音)                         │
 *   sfxSend/ambSend → convolver(程序生成 IR) ─┘
 */

const TAU = Math.PI * 2;
const MAX_VOICES = 48; // 全局同时发声上限
const LOOKAHEAD = 0.01; // 调度提前量：保证 1~3ms 瞬态不被渲染量子吞掉
const NOISE_SEC = 5; // 噪声 buffer 时长
const IR_SEC = 1.8; // 混响脉冲响应时长

const rand = (a, b) => a + Math.random() * (b - a);
const jit = (p = 0.05) => 1 + (Math.random() * 2 - 1) * p;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// 武器枪声参数（频率 Hz / 时长 s / 增益）
// crack: 瞬态爆裂  body: 主体低通噪声(截止频率下扫)  mid: 中频带通噪声
// punch: 低频冲击下扫  tail: 褐噪隆隆尾音  mech: 本地枪机咔嗒  echo: 集装箱回声
// ---------------------------------------------------------------------------
const GUNS = {
  ak47: {
    gain: 1.0, drive: 2.6, wet: 0.16,
    crack: { hp: 2200, dur: 0.0025, g: 0.55 },
    body: { f0: 4200, f1: 650, dur: 0.16, g: 0.9 },
    mid: { f: 1000, q: 1.1, dur: 0.09, g: 0.5 },
    punch: { f0: 150, f1: 42, sw: 0.07, dur: 0.17, g: 0.8 },
    tail: { f: 900, dur: 0.55, g: 0.28 },
    mech: { f: 2800, g: 0.09, delay: 0.045 },
    echo: [[0.16, 0.12]],
  },
  m4a1: {
    gain: 1.2, drive: 2.2, wet: 0.15,
    crack: { hp: 3200, dur: 0.002, g: 0.6 },
    body: { f0: 6500, f1: 1100, dur: 0.12, g: 0.85 },
    mid: { f: 1900, q: 1.3, dur: 0.07, g: 0.5 },
    punch: { f0: 175, f1: 52, sw: 0.05, dur: 0.12, g: 0.65 },
    tail: { f: 1300, dur: 0.42, g: 0.24 },
    mech: { f: 3400, g: 0.09, delay: 0.038 },
    echo: [[0.15, 0.09]],
  },
  awm: {
    gain: 0.85, drive: 3.0, wet: 0.28,
    crack: { hp: 1800, dur: 0.003, g: 0.7 },
    body: { f0: 3800, f1: 420, dur: 0.3, g: 1.0 },
    mid: { f: 780, q: 0.9, dur: 0.16, g: 0.6 },
    punch: { f0: 135, f1: 32, sw: 0.13, dur: 0.4, g: 1.0 },
    sub: { f0: 70, f1: 28, dur: 0.5, g: 0.5 },
    tail: { f: 700, dur: 1.4, g: 0.45 },
    mech: { f: 2200, g: 0.06, delay: 0.06 },
    echo: [[0.19, 0.3], [0.44, 0.18], [0.82, 0.09]],
  },
  mp5: {
    gain: 1.5, drive: 1.9, wet: 0.12,
    crack: { hp: 3800, dur: 0.0015, g: 0.45 },
    body: { f0: 3600, f1: 850, dur: 0.075, g: 0.8 },
    mid: { f: 850, q: 1.0, dur: 0.05, g: 0.55 },
    punch: { f0: 185, f1: 68, sw: 0.035, dur: 0.08, g: 0.5 },
    tail: { f: 1100, dur: 0.25, g: 0.16 },
    mech: { f: 3800, g: 0.08, delay: 0.03 },
    echo: null,
  },
  deagle: {
    gain: 1.05, drive: 2.9, wet: 0.2,
    crack: { hp: 2600, dur: 0.003, g: 0.7 },
    body: { f0: 5500, f1: 600, dur: 0.2, g: 1.0 },
    mid: { f: 1200, q: 1.0, dur: 0.11, g: 0.65 },
    punch: { f0: 165, f1: 40, sw: 0.06, dur: 0.21, g: 0.95 },
    tail: { f: 1000, dur: 0.7, g: 0.35 },
    mech: { f: 2500, g: 0.11, delay: 0.028 },
    echo: [[0.17, 0.16], [0.4, 0.07]],
  },
};

// 换弹/切枪的"重量感"：数值越小音高越低越沉
const WEIGHT = { ak47: 0.85, m4a1: 1, awm: 0.8, mp5: 1.12, deagle: 1.05, knife: 1.2, grenade: 1.1 };

// ---------------------------------------------------------------------------
// 预生成缓存（按采样率）：白/粉/褐噪声 + 混响 IR
// ---------------------------------------------------------------------------
const BANKS = new Map();

function makeNoise(ctx, kind) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * NOISE_SEC);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      // Paul Kellet 粉噪滤波
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    } else d[i] = w;
  }
  // 去直流与线性漂移，使循环播放首尾衔接无爆点
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  const drift = d[n - 1] - d[0];
  let e = 0;
  for (let i = 0; i < n; i++) {
    d[i] -= mean + drift * (i / (n - 1) - 0.5);
    e += d[i] * d[i];
  }
  // 统一归一到 RMS 0.3，使各类噪声的 g 参数可比
  const k = 0.3 / Math.sqrt(e / n || 1);
  for (let i = 0; i < n; i++) d[i] *= k;
  return buf;
}

// 程序生成脉冲响应：开阔海面（尾巴短、高频衰减快）+ 集装箱墙面的离散早期反射
function makeIR(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * IR_SEC);
  const buf = ctx.createBuffer(2, len, sr);
  const taps = [
    [0.0065, 0.62], [0.011, 0.5], [0.0175, 0.46], [0.024, 0.4], [0.031, 0.36], [0.039, 0.3],
    [0.047, 0.3], [0.058, 0.25], [0.071, 0.22], [0.086, 0.18], [0.104, 0.15], [0.127, 0.12],
    [0.155, 0.1], [0.19, 0.08], [0.24, 0.06], [0.31, 0.04],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0, a = 0, comp = 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if ((i & 63) === 0) {
        // 随时间降低截止频率：尾巴越来越暗
        const fc = 1100 + 9000 * Math.exp(-t / 0.28);
        a = Math.exp((-TAU * fc) / sr);
        comp = Math.sqrt((1 + a) / (1 - a));
      }
      lp = (1 - a) * (Math.random() * 2 - 1) + a * lp;
      const env = Math.exp(-t / 0.24) * (t < 0.015 ? (t / 0.015) ** 2 : 1); // RT60≈1.65s
      d[i] = lp * comp * env * 0.35;
    }
    for (const [tt, g] of taps) {
      const at = Math.max(0, Math.floor((tt + (ch ? rand(0.0004, 0.0025) : rand(0, 0.0012))) * sr));
      const sgn = Math.random() < 0.5 ? -1 : 1;
      // 每个反射是约 0.5ms 的短促衰减脉冲，而非单采样点
      for (let k = 0; k < 24 && at + k < len; k++) d[at + k] += sgn * g * Math.exp(-k / 5) * (k % 2 ? -0.35 : 1);
    }
  }
  return buf;
}

function getBank(ctx) {
  let b = BANKS.get(ctx.sampleRate);
  if (!b) {
    b = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown'), ir: makeIR(ctx) };
    BANKS.set(ctx.sampleRate, b);
  }
  return b;
}

// 末级软限幅曲线：|x|≤0.7 线性，之上 tanh 软饱和，最大输出 0.98（前级 ×0.5，覆盖 ±2 输入）
function softClipCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2, ax = Math.abs(x);
    c[i] = Math.sign(x) * (ax <= 0.7 ? ax : 0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28));
  }
  return c;
}

// 枪声/爆炸饱和曲线：y = tanh(3u)，前级增益 amount/3
function tanhCurve() {
  const n = 1025, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 3);
  return c;
}

// ===========================================================================
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.voices = []; // 活动 voice（受上限约束）
    this.maxVoices = MAX_VOICES;
    this._vol = { master: 0.8, sfx: 0.9, ambient: 0.5, voice: 0.9 };
    this._L = { x: 0, y: 0, z: 0 };
    this._amb = null;
    this._hbOn = false;
    this._hbNext = 0;
    this._hbGain = null;
    this._timer = 0;
    this._offline = false;
    this._warned = new Set();
    this._sv = null; // 缓存的播报语音
    this._speechInit = false;
  }

  get ready() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  /** 在用户手势中调用。可选传入外部 context（如 OfflineAudioContext，用于测试/离线渲染）。 */
  init(context) {
    let created = null;
    try {
      if (this.ctx) {
        this._resume();
        return this.ready;
      }
      const G = globalThis;
      let ctx = context || null;
      if (!ctx) {
        const AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) return false;
        try {
          ctx = new AC({ latencyHint: 'interactive' });
        } catch (e) {
          ctx = new AC();
        }
        created = ctx;
      }
      this.ctx = ctx;
      this._offline = !!G.OfflineAudioContext && ctx instanceof G.OfflineAudioContext;
      this._build();
      this._resume();
      if (!this._offline && typeof setInterval === 'function') {
        // 兜底调度：即使游戏暂停调用 update()，心跳/环境事件仍能继续
        this._timer = setInterval(() => this._tick(), 100);
      }
      if (!this._offline) this._initSpeech();
      return true;
    } catch (e) {
      this._warn('init', e);
      this.ctx = null;
      if (created) try { created.close(); } catch (_) { /* 忽略 */ }
      return false;
    }
  }

  setVolumes(v) {
    try {
      if (!v || typeof v !== 'object') return;
      for (const k of ['master', 'sfx', 'ambient', 'voice']) {
        if (typeof v[k] === 'number' && Number.isFinite(v[k])) this._vol[k] = clamp(v[k], 0, 1);
      }
      if (this._ok()) this._applyVolumes(false);
    } catch (e) {
      this._warn('setVolumes', e);
    }
  }

  setListener(pos, forward, up) {
    try {
      if (pos && typeof pos === 'object') {
        const L = this._L;
        this._L = { x: num(pos.x, L.x), y: num(pos.y, L.y), z: num(pos.z, L.z) };
      }
      if (!this._ok()) return;
      const li = this.ctx.listener, p = this._L;
      let f = null, u = { x: 0, y: 1, z: 0 };
      if (forward && typeof forward === 'object') {
        const fx = num(forward.x, 0), fy = num(forward.y, 0), fz = num(forward.z, 0);
        const fl = Math.hypot(fx, fy, fz);
        if (fl > 1e-6) f = { x: fx / fl, y: fy / fl, z: fz / fl };
      }
      if (up && typeof up === 'object') {
        const ux = num(up.x, 0), uy = num(up.y, 1), uz = num(up.z, 0);
        const ul = Math.hypot(ux, uy, uz);
        if (ul > 1e-6) u = { x: ux / ul, y: uy / ul, z: uz / ul };
      }
      if (li.positionX) {
        li.positionX.value = p.x;
        li.positionY.value = p.y;
        li.positionZ.value = p.z;
        if (f) {
          li.forwardX.value = f.x;
          li.forwardY.value = f.y;
          li.forwardZ.value = f.z;
          li.upX.value = u.x;
          li.upY.value = u.y;
          li.upZ.value = u.z;
        }
      } else {
        if (li.setPosition) li.setPosition(p.x, p.y, p.z);
        if (f && li.setOrientation) li.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
      }
    } catch (e) {
      this._warn('setListener', e);
    }
  }

  // -------------------------------------------------------------------------
  // 枪声
  // -------------------------------------------------------------------------
  playShot(weaponId, pos, opts) {
    if (!this._ok()) return;
    try {
      const o = opts || {};
      if (weaponId === 'knife') return this.playKnife('light', 'miss', pos);
      if (weaponId === 'grenade') return this._throwWhoosh(this._pos(pos));
      const P = GUNS[weaponId] || GUNS.m4a1;
      const p = this._pos(pos);
      const local = !p;
      const sup = !!o.suppressed;
      const d = local ? 0 : Math.max(0, num(o.distance, this._dist(p)));
      const far = clamp(d / 80, 0, 1); // 0=近 1=远
      const r = jit(0.05), k = jit(0.05); // 音高/时长随机化
      const v = this._voice(p, {
        g: P.gain * jit(0.06) * (local ? 1.8 : 1.25) * (sup ? 0.5 : 1),
        ref: sup ? 2.5 : 5, roll: sup ? 1.3 : 0.6, max: 400, dist: d,
        wet: local ? P.wet * (sup ? 0.5 : 1) : P.wet * 1.2 * (sup ? 0.5 : 1),
      });
      const t = this._now();
      const drv = this._drive(v, P.drive * (sup ? 0.55 : 1), 0.7);
      const U = P.punch;

      if (!sup) {
        const C = P.crack, B = P.body, M = P.mid, T = P.tail;
        // (a) 极短高频瞬态爆裂
        this._nz(v, t, { n: 'white', a: 0.0002, dur: C.dur * k, g: C.g * (local ? 1 : 1 - 0.6 * far), flt: [{ t: 'highpass', f: C.hp * r, q: 0 }] });
        // (b) 主体：低通噪声（截止频率快速下扫）+ 中频带通
        this._nz(v, t, { n: 'pink', a: 0.0006, dur: B.dur * k, g: B.g, flt: [{ t: 'lowpass', f: B.f0 * r, f1: B.f1 * r, sw: B.dur * k * 0.6, q: 1 }], to: drv });
        this._nz(v, t, { n: 'white', a: 0.0004, dur: M.dur * k, g: M.g, flt: [{ t: 'bandpass', f: M.f * r, q: M.q }], to: drv });
        // (c) 低频冲击：正弦快速下扫
        this._tn(v, t, { f: U.f0 * r, f1: U.f1 * r, sw: U.sw * k, a: 0.0015, dur: U.dur * k, g: U.g, to: drv });
        if (P.sub) this._tn(v, t, { w: 'triangle', f: P.sub.f0 * r, f1: P.sub.f1 * r, sw: P.sub.dur * 0.5, a: 0.003, dur: P.sub.dur * k, g: P.sub.g, to: drv });
        // 尾音隆隆（远处更长更响）
        this._nz(v, t + 0.006, { n: 'brown', a: 0.015, dur: T.dur * k * (1 + 0.6 * far), g: T.g * (1 + 0.5 * far), flt: [{ t: 'lowpass', f: T.f * r, f1: T.f * 0.45 * r, sw: T.dur, q: 0 }] });
        // 集装箱/海面回声
        const echoes = P.echo ? P.echo.slice() : [];
        if (!local && d > 30) echoes.push([0.08 + d / 600, 0.1 + 0.15 * far]);
        for (const [dt, eg] of echoes) {
          this._nz(v, t + dt * jit(0.08), { n: 'pink', a: 0.008, dur: 0.22 * k, g: eg, flt: [{ t: 'lowpass', f: 1500 * r, q: 0 }, { t: 'highpass', f: 160, q: 0 }] });
        }
      } else {
        // 消音："噗"+ 气流嘶，几乎没有爆裂
        this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.004, g: 0.12, flt: [{ t: 'bandpass', f: 3200 * r, q: 1.2 }] });
        this._nz(v, t, { n: 'pink', a: 0.0008, dur: 0.07 * k, g: 0.9, flt: [{ t: 'lowpass', f: 2400 * r, f1: 450 * r, sw: 0.05, q: 1 }], to: drv });
        this._nz(v, t, { n: 'white', a: 0.0005, dur: 0.035 * k, g: 0.4, flt: [{ t: 'bandpass', f: 700 * r, q: 1.4 }], to: drv });
        this._tn(v, t, { f: U.f0 * 0.8 * r, f1: U.f1 * r, sw: 0.04, a: 0.001, dur: U.dur * 0.45 * k, g: U.g * 0.4, to: drv });
        this._nz(v, t, { n: 'white', a: 0.001, dur: 0.045 * k, g: 0.12, flt: [{ t: 'highpass', f: 5500 * r, q: 0 }] });
        this._nz(v, t + 0.004, { n: 'brown', a: 0.01, dur: 0.12, g: 0.06, flt: [{ t: 'lowpass', f: 700, q: 0 }] });
      }
      // (d) 本地枪机金属咔嗒
      if (local) this._mech(v, t + P.mech.delay * jit(0.12), P.mech.f * r, P.mech.g * (sup ? 1.3 : 1));
      this._done(v);
    } catch (e) {
      this._warn('playShot', e);
    }
  }

  playReload(weaponId, stage) {
    if (!this._ok()) return;
    try {
      if (stage === 'draw') return this.playWeaponSwitch(weaponId);
      const fm = (WEIGHT[weaponId] || 1) * jit(0.04);
      const v = this._voice(null, { g: 0.42, wet: 0.06 });
      const t = this._now();
      switch (stage) {
        case 'magout': {
          this._click(v, t, 3000 * fm, 0.45); // 弹匣卡榫
          this._metal(v, t, 2500 * fm, 0.08, [[1, 1, 0.04], [1.6, 0.5, 0.03]]);
          this._nz(v, t + 0.02, { n: 'white', a: 0.015, dur: 0.08, g: 0.16, flt: [{ t: 'bandpass', f: 1400 * fm, f1: 2600 * fm, sw: 0.09, q: 1.6 }] });
          this._tn(v, t + 0.11, { f: 190 * fm, f1: 110, a: 0.002, dur: 0.06, g: 0.2 });
          this._click(v, t + 0.11, 1600 * fm, 0.25, 1.5, 0.02);
          break;
        }
        case 'magin': {
          this._nz(v, t, { n: 'white', a: 0.02, dur: 0.07, g: 0.14, flt: [{ t: 'bandpass', f: 1200 * fm, f1: 2000 * fm, sw: 0.08, q: 1.5 }] });
          const tc = t + 0.09;
          this._click(v, tc, 1900 * fm, 0.6, 1.2, 0.03);
          this._tn(v, tc, { f: 230 * fm, f1: 120, a: 0.0015, dur: 0.05, g: 0.35 });
          this._metal(v, tc, 2100 * fm, 0.12, [[1, 1, 0.07], [1.47, 0.6, 0.05], [2.3, 0.35, 0.03]]);
          this._click(v, tc + 0.012, 3600 * fm, 0.3); // 锁定
          break;
        }
        case 'bolt': {
          // 拉机柄 → 释放撞回
          this._click(v, t, 2600 * fm, 0.35);
          this._nz(v, t + 0.01, { n: 'white', a: 0.01, dur: 0.07, g: 0.18, flt: [{ t: 'bandpass', f: 1500 * fm, f1: 3000 * fm, sw: 0.07, q: 2 }] });
          this._click(v, t + 0.085, 2200 * fm, 0.3);
          const tr = t + 0.2 * jit(0.08);
          this._nz(v, tr, { n: 'white', a: 0.004, dur: 0.035, g: 0.15, flt: [{ t: 'bandpass', f: 3000 * fm, f1: 1600 * fm, sw: 0.03, q: 2 }] });
          this._click(v, tr + 0.03, 2000 * fm, 0.7, 1.2, 0.03);
          this._tn(v, tr + 0.03, { f: 170 * fm, f1: 95, a: 0.0015, dur: 0.06, g: 0.35 });
          this._metal(v, tr + 0.03, 2600 * fm, 0.12, [[1, 1, 0.08], [1.53, 0.6, 0.06], [2.41, 0.35, 0.04]]);
          break;
        }
        case 'boltback': {
          this._click(v, t, 2400 * fm, 0.4); // 抬起
          this._tn(v, t, { f: 300 * fm, f1: 200, a: 0.001, dur: 0.03, g: 0.15 });
          this._nz(v, t + 0.045, { n: 'white', a: 0.02, dur: 0.12, g: 0.2, flt: [{ t: 'bandpass', f: 1000 * fm, f1: 2400 * fm, sw: 0.14, q: 1.8 }] });
          this._click(v, t + 0.18, 1800 * fm, 0.45, 1.5, 0.02);
          this._metal(v, t + 0.18, 1900 * fm, 0.08, [[1, 1, 0.08], [2.2, 0.5, 0.05]]);
          break;
        }
        case 'boltforward': {
          this._nz(v, t, { n: 'white', a: 0.015, dur: 0.1, g: 0.2, flt: [{ t: 'bandpass', f: 2400 * fm, f1: 1100 * fm, sw: 0.11, q: 1.8 }] });
          this._click(v, t + 0.11, 1700 * fm, 0.6, 1.3, 0.03);
          this._tn(v, t + 0.11, { f: 200 * fm, f1: 110, a: 0.0015, dur: 0.05, g: 0.3 });
          this._metal(v, t + 0.11, 2300 * fm, 0.1, [[1, 1, 0.07], [1.6, 0.5, 0.05]]);
          this._click(v, t + 0.19, 2900 * fm, 0.4); // 压下锁定
          break;
        }
        default:
          this._click(v, t, 2500 * fm, 0.4);
      }
      this._done(v);
    } catch (e) {
      this._warn('playReload', e);
    }
  }

  playDryFire() {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { g: 0.45, wet: 0.04 });
      const t = this._now();
      this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.006, g: 0.6, flt: [{ t: 'highpass', f: 4000, q: 0 }] });
      this._metal(v, t, 3100 * jit(0.03), 0.18, [[1, 1, 0.03], [1.73, 0.6, 0.02]]);
      this._tn(v, t, { f: 900, f1: 600, a: 0.0005, dur: 0.015, g: 0.2 });
      this._done(v);
    } catch (e) {
      this._warn('playDryFire', e);
    }
  }

  // -------------------------------------------------------------------------
  // 移动
  // -------------------------------------------------------------------------
  playFootstep(pos, surface, opts) {
    if (!this._ok()) return;
    try {
      const o = opts || {};
      const run = !!o.run, crouch = !!o.crouch;
      const p = this._pos(pos), local = !p;
      const lvl = (crouch ? 0.32 : run ? 1 : 0.6) * jit(0.12);
      const v = this._voice(p, { g: (local ? 0.45 : 1.8) * lvl, ref: 2.5, roll: 1.25, max: 60, wet: local ? 0.04 : 0.1 });
      const t = this._now(), r = jit(0.06), br = crouch ? 0.45 : 1;
      this._surf(v, t, surface, 1, r, 0, br); // 脚跟
      const gap = crouch ? 0.09 : run ? 0.045 : 0.07;
      this._surf(v, t + gap * jit(0.15), surface, 0.45, r * 1.06, 0, br * 0.8); // 前脚掌
      if (run) this._nz(v, t, { n: 'white', a: 0.02, dur: 0.08, g: 0.06, flt: [{ t: 'bandpass', f: 2200 * r, q: 0.8 }] }); // 衣物/装备
      this._done(v);
    } catch (e) {
      this._warn('playFootstep', e);
    }
  }

  playLand(pos, surface, strength) {
    if (!this._ok()) return;
    try {
      const s = clamp(num(strength, 0.5), 0, 1);
      const p = this._pos(pos), local = !p;
      const v = this._voice(p, { g: (local ? 0.5 : 1.6) * (0.45 + 0.65 * s), ref: 3, roll: 1.2, max: 70, wet: 0.08 });
      const t = this._now(), r = jit(0.06);
      this._tn(v, t, { f: 95 * r, f1: 45, sw: 0.1, a: 0.002, dur: 0.1 + 0.12 * s, g: 0.55 + 0.3 * s }); // 身体下坠闷响
      this._surf(v, t, surface, 0.9, r, s, 1);
      this._surf(v, t + 0.03 * jit(0.2), surface, 0.5, r * 1.05, s * 0.5, 0.8);
      this._nz(v, t + 0.01, { n: 'white', a: 0.01, dur: 0.1, g: 0.08 + 0.08 * s, flt: [{ t: 'bandpass', f: 2200, q: 0.8 }] });
      if (s > 0.4) this._metal(v, t + rand(0.03, 0.09), rand(2200, 3400), 0.04 * s, [[1, 1, 0.06], [1.9, 0.5, 0.04]]);
      this._done(v);
    } catch (e) {
      this._warn('playLand', e);
    }
  }

  playJump(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos), local = !p;
      const v = this._voice(p, { g: local ? 0.4 : 0.8, ref: 2.5, roll: 1.25, max: 50, wet: 0.05 });
      const t = this._now(), r = jit(0.06);
      this._nz(v, t, { n: 'pink', a: 0.004, dur: 0.06, g: 0.35, flt: [{ t: 'bandpass', f: 900 * r, q: 1 }] }); // 蹬地
      this._tn(v, t, { f: 120 * r, f1: 80, a: 0.002, dur: 0.05, g: 0.25 });
      this._nz(v, t + 0.01, { n: 'white', a: 0.03, dur: 0.12, g: 0.1, flt: [{ t: 'bandpass', f: 2400 * r, q: 0.8 }] }); // 衣物
      this._metal(v, t + rand(0.03, 0.08), rand(2600, 3600), 0.035, [[1, 1, 0.05], [1.7, 0.5, 0.03]]); // 装备轻响
      this._done(v);
    } catch (e) {
      this._warn('playJump', e);
    }
  }

  // -------------------------------------------------------------------------
  // 弹着/反馈
  // -------------------------------------------------------------------------
  playImpact(pos, material) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos);
      const v = this._voice(p, { g: 1.8, ref: 3, roll: 1.2, max: 90, wet: 0.1 });
      const t = this._now(), r = jit(0.06);
      switch (material) {
        case 'metal':
          this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.003, g: 0.6, flt: [{ t: 'highpass', f: 3000 * r, q: 0 }] });
          this._nz(v, t, { n: 'pink', a: 0.0005, dur: 0.025, g: 0.35, flt: [{ t: 'bandpass', f: 900 * r, q: 1 }] });
          this._metal(v, t, rand(1700, 3000), 0.16, [[1, 1, 0.14], [1.47, 0.8, 0.1], [2.09, 0.6, 0.08], [2.93, 0.4, 0.05], [4.1, 0.25, 0.035]]);
          this._nz(v, t + 0.004, { n: 'white', a: 0.002, dur: 0.07, g: 0.1, flt: [{ t: 'highpass', f: 6000, q: 0 }] }); // 火花
          break;
        case 'wood':
          this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.004, g: 0.35, flt: [{ t: 'highpass', f: 2000 * r, q: 0 }] });
          this._nz(v, t, { n: 'pink', a: 0.0008, dur: 0.06, g: 0.7, flt: [{ t: 'bandpass', f: 700 * r, q: 1.2 }] });
          this._tn(v, t, { f: 190 * r, f1: 110, a: 0.001, dur: 0.05, g: 0.35 });
          for (let i = 0; i < 3; i++) this._click(v, t + rand(0.005, 0.04), rand(2500, 4500), 0.12, 3, 0.008); // 木屑
          break;
        case 'flesh':
          this._nz(v, t, { n: 'pink', a: 0.001, dur: 0.07, g: 0.8, flt: [{ t: 'lowpass', f: 700 * r, f1: 250, sw: 0.06, q: 0 }] });
          this._tn(v, t, { f: 120 * r, f1: 55, a: 0.001, dur: 0.08, g: 0.5 });
          this._nz(v, t + 0.003, { n: 'white', a: 0.004, dur: 0.04, g: 0.25, flt: [{ t: 'bandpass', f: 1400 * r, q: 2 }] });
          break;
        case 'mesh': {
          // 铁丝网：一串快速、衰减的细碎金属颤响
          this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.01, g: 0.35, flt: [{ t: 'highpass', f: 2000, q: 0 }] });
          let tt = t, g = 0.12;
          const n = 6 + ((Math.random() * 4) | 0);
          for (let i = 0; i < n; i++) {
            this._metal(v, tt, rand(2500, 5200), g, [[1, 1, 0.05], [1.8, 0.5, 0.04]]);
            tt += rand(0.008, 0.03);
            g *= 0.8;
          }
          this._nz(v, t, { n: 'white', a: 0.005, dur: 0.15, g: 0.08, flt: [{ t: 'bandpass', f: 900, q: 1 }] });
          break;
        }
        default: // concrete
          this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.004, g: 0.6, flt: [{ t: 'highpass', f: 1800 * r, q: 0 }] });
          this._nz(v, t, { n: 'pink', a: 0.0006, dur: 0.05, g: 0.5, flt: [{ t: 'bandpass', f: 1300 * r, q: 0.9 }] });
          this._tn(v, t, { f: 160 * r, f1: 90, a: 0.001, dur: 0.04, g: 0.25 });
          for (let i = 0, n = 4 + ((Math.random() * 3) | 0); i < n; i++) {
            this._click(v, t + rand(0.02, 0.2), rand(2000, 5000), 0.08, 3, 0.006); // 碎屑
          }
      }
      this._done(v);
    } catch (e) {
      this._warn('playImpact', e);
    }
  }

  playRicochet(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos);
      const v = this._voice(p, { g: 1.2, ref: 3, roll: 1, max: 100, wet: 0.15 });
      const t = this._now(), f = rand(2600, 4200), d = rand(0.25, 0.5);
      this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.004, g: 0.45, flt: [{ t: 'highpass', f: 3500, q: 0 }] });
      // 频率下滑 + 轻微 FM 颤动的"啾——"
      this._tn(v, t + 0.004, { f, f1: f * rand(0.35, 0.55), sw: d, a: 0.004, hold: d * 0.1, dur: d * 0.9, g: 0.3, fm: [rand(45, 90), f * 0.025] });
      this._tn(v, t + 0.004, { w: 'triangle', f: f * 1.5, f1: f * 0.7, sw: d * 0.8, a: 0.003, dur: d * 0.6, g: 0.06 });
      this._nz(v, t + 0.004, { n: 'white', a: 0.01, dur: d * 0.8, g: 0.06, flt: [{ t: 'bandpass', f, f1: f * 0.45, sw: d, q: 6 }] });
      this._done(v);
    } catch (e) {
      this._warn('playRicochet', e);
    }
  }

  playBulletWhiz(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos);
      const v = this._voice(p, { g: 1.8, ref: 1.5, roll: 1, max: 40, wet: 0.04 });
      const t = this._now(), d = rand(0.12, 0.2);
      this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.002, g: 0.35, flt: [{ t: 'highpass', f: 4000, q: 0 }] }); // 超音速"啪"
      this._nz(v, t, { n: 'white', a: d * 0.35, dur: d * 0.65, g: 0.45, flt: [{ t: 'bandpass', f: 5200, f1: 900, sw: d, q: 2.5 }] });
      this._tn(v, t, { f: 2000, f1: 600, sw: d, a: d * 0.3, dur: d * 0.7, g: 0.07 });
      this._done(v);
    } catch (e) {
      this._warn('playBulletWhiz', e);
    }
  }

  playHitmarker(headshot) {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { bus: 'ui', g: 1.5, wet: 0 });
      const t = this._now();
      if (headshot) {
        // 穿越火线式清脆金属"叮"：金属板非谐波泛音 + 轻微拍频
        const f = 2450 * jit(0.015);
        this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.004, g: 0.35, flt: [{ t: 'highpass', f: 5000, q: 0 }] });
        this._metal(v, t, f, 0.3, [[1, 1, 0.5], [1.004, 0.5, 0.45], [2.76, 0.45, 0.28], [5.4, 0.22, 0.14]]);
        this._click(v, t, 2200, 0.25, 1.5, 0.012);
      } else {
        this._click(v, t, 2400 * jit(0.03), 1.0, 1.5, 0.016);
        this._tn(v, t, { f: 1500, f1: 1100, sw: 0.03, a: 0.0005, dur: 0.03, g: 0.4 });
        this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.003, g: 0.35, flt: [{ t: 'highpass', f: 6000, q: 0 }] });
      }
      this._done(v);
    } catch (e) {
      this._warn('playHitmarker', e);
    }
  }

  playKillConfirm(headshot) {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { bus: 'ui', g: 0.7, wet: 0.06 });
      const t = this._now();
      this._tn(v, t, { f: 150, f1: 60, sw: 0.08, a: 0.002, dur: 0.12, g: 0.45 });
      this._click(v, t, 1800, 0.35, 1.2, 0.015);
      this._tn(v, t, { w: 'triangle', f: 1318.5, a: 0.003, dur: 0.16, g: 0.22 });
      this._tn(v, t + 0.07, { w: 'triangle', f: 1975.5, a: 0.003, hold: 0.03, dur: 0.26, g: 0.22 });
      if (headshot) this._metal(v, t + 0.12, 2637, 0.2, [[1, 1, 0.55], [1.005, 0.5, 0.5], [2.76, 0.4, 0.3], [5.4, 0.18, 0.15]]);
      this._done(v);
    } catch (e) {
      this._warn('playKillConfirm', e);
    }
  }

  playHurt(amount) {
    if (!this._ok()) return;
    try {
      const a = clamp(num(amount, 20) / 100, 0.03, 1);
      const v = this._voice(null, { bus: 'ui', g: 0.35 + 0.5 * a, wet: 0.03 });
      const t = this._now(), r = jit(0.05);
      this._nz(v, t, { n: 'pink', a: 0.002, dur: 0.15, g: 0.7, flt: [{ t: 'lowpass', f: 400 * r, f1: 150, sw: 0.12, q: 0 }] });
      this._tn(v, t, { f: 85 * r, f1: 42, sw: 0.12, a: 0.002, dur: 0.18, g: 0.6 });
      this._nz(v, t, { n: 'white', a: 0.001, dur: 0.03, g: 0.25, flt: [{ t: 'bandpass', f: 1100 * r, q: 1.2 }] });
      this._done(v);
      if (a >= 0.12) this._ring(a * 0.8, 0.6 + 1.4 * a); // 轻微耳鸣
      if (a >= 0.25) this._muffle(0.35 + 0.5 * a, 0.5 + a); // 世界音短暂发闷
    } catch (e) {
      this._warn('playHurt', e);
    }
  }

  playDeath(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos), local = !p;
      const v = this._voice(p, { g: local ? 0.7 : 1, ref: 3, roll: 1.1, max: 80, wet: 0.12 });
      const t = this._now(), r = jit(0.06);
      this._grunt(v, t, 150 * r, 90 * r, 0.24, 0.16); // 短促闷哼
      const tf = t + rand(0.28, 0.4); // 倒地
      this._tn(v, tf, { f: 80 * r, f1: 40, sw: 0.12, a: 0.003, dur: 0.24, g: 0.7 });
      this._nz(v, tf, { n: 'pink', a: 0.002, dur: 0.18, g: 0.55, flt: [{ t: 'lowpass', f: 450 * r, q: 0 }] });
      this._nz(v, tf, { n: 'white', a: 0.001, dur: 0.035, g: 0.2, flt: [{ t: 'bandpass', f: 1500 * r, q: 1.2 }] });
      const tg = tf + rand(0.08, 0.15); // 枪械/装备磕甲板
      this._tn(v, tg, { f: 110 * r, f1: 70, a: 0.002, dur: 0.07, g: 0.35 });
      this._metal(v, tg + 0.01, rand(1400, 2200), 0.1, [[1, 1, 0.09], [2.3, 0.6, 0.06], [3.7, 0.3, 0.04]]);
      this._metal(v, tg + rand(0.08, 0.16), rand(2400, 3400), 0.05, [[1, 1, 0.05], [1.8, 0.5, 0.03]]);
      this._done(v);
    } catch (e) {
      this._warn('playDeath', e);
    }
  }

  playKnife(kind, result, pos) {
    if (!this._ok()) return;
    try {
      const heavy = kind === 'heavy';
      const p = this._pos(pos), local = !p;
      const v = this._voice(p, { g: local ? 0.6 : 0.9, ref: 2, roll: 1.2, max: 50, wet: 0.08 });
      const t = this._now(), r = jit(0.06);
      const a = heavy ? 0.11 : 0.06, dur = heavy ? 0.26 : 0.15;
      this._whoosh(v, t, { a, dur, g: heavy ? 0.55 : 0.45, f0: 450 * r, fp: (heavy ? 2200 : 3000) * r, f1: 800 * r, q: 1.4 });
      this._whoosh(v, t, { n: 'white', a: a * 0.9, dur: dur * 0.7, g: 0.12, f0: 2500 * r, fp: 6000 * r, f1: 3000 * r, q: 2.5 }); // 刃口啸声
      const th = t + a * (heavy ? 1.1 : 0.9);
      const hv = heavy ? 1.3 : 1;
      if (result === 'flesh') {
        this._nz(v, th, { n: 'pink', a: 0.002, dur: 0.08, g: 0.7 * hv, flt: [{ t: 'lowpass', f: 800 * r, f1: 250, sw: 0.07, q: 0 }] });
        this._tn(v, th, { f: 130 * r, f1: 60, a: 0.002, dur: 0.09, g: 0.5 * hv });
        this._nz(v, th + 0.004, { n: 'white', a: 0.005, dur: 0.05, g: 0.25, flt: [{ t: 'bandpass', f: 1600 * r, q: 3 }] });
      } else if (result === 'wall') {
        this._nz(v, th, { n: 'white', a: 0.0002, dur: 0.004, g: 0.5 * hv, flt: [{ t: 'highpass', f: 2500, q: 0 }] });
        this._metal(v, th, rand(1300, 1800), 0.2 * hv, [[1, 1, 0.25], [2.41, 0.7, 0.18], [3.87, 0.5, 0.12], [5.3, 0.3, 0.08]]);
        this._nz(v, th + 0.003, { n: 'white', a: 0.003, dur: 0.06, g: 0.15, flt: [{ t: 'bandpass', f: 3500, q: 2 }] }); // 刮擦
      }
      this._done(v);
    } catch (e) {
      this._warn('playKnife', e);
    }
  }

  // -------------------------------------------------------------------------
  // 手雷
  // -------------------------------------------------------------------------
  playGrenadePin() {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { g: 0.55, wet: 0.05 });
      const t = this._now();
      this._click(v, t, 4200, 0.3);
      this._metal(v, t, rand(3400, 3900), 0.1, [[1, 1, 0.09], [1.62, 0.6, 0.06], [2.5, 0.3, 0.04]]);
      this._nz(v, t + 0.015, { n: 'white', a: 0.01, dur: 0.05, g: 0.1, flt: [{ t: 'bandpass', f: 4500, q: 3 }] });
      this._metal(v, t + 0.08, rand(2300, 2700), 0.08, [[1, 1, 0.12], [2.1, 0.5, 0.07]]); // 拉环晃动
      this._metal(v, t + 0.13, rand(2500, 2900), 0.04, [[1, 1, 0.08]]);
      this._done(v);
    } catch (e) {
      this._warn('playGrenadePin', e);
    }
  }

  playGrenadeThrow() {
    if (!this._ok()) return;
    try {
      this._throwWhoosh(null);
    } catch (e) {
      this._warn('playGrenadeThrow', e);
    }
  }

  playGrenadeBounce(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos);
      const v = this._voice(p, { g: 0.8, ref: 3, roll: 1.1, max: 80, wet: 0.12 });
      const t = this._now(), f = rand(750, 1050);
      this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.004, g: 0.4, flt: [{ t: 'highpass', f: 2500, q: 0 }] });
      this._tn(v, t, { f: 210, f1: 120, a: 0.001, dur: 0.05, g: 0.35 });
      this._metal(v, t, f, 0.22, [[1, 1, 0.16], [2.14, 0.7, 0.11], [3.63, 0.45, 0.07], [5.1, 0.25, 0.05]]);
      this._nz(v, t, { n: 'pink', a: 0.001, dur: 0.05, g: 0.3, flt: [{ t: 'bandpass', f: 1200, q: 1 }] });
      this._done(v);
    } catch (e) {
      this._warn('playGrenadeBounce', e);
    }
  }

  playExplosion(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos), d = p ? this._dist(p) : 0;
      const v = this._voice(p, { g: 1.25, ref: 10, roll: 0.8, max: 500, wet: 0.55, wd: 60, air: 0.6 });
      const t = this._now(), r = jit(0.05), k = jit(0.05);
      const drv = this._drive(v, 2.2, 0.75);
      // 爆裂瞬态
      this._nz(v, t, { n: 'white', a: 0.0004, dur: 0.012, g: 0.7, flt: [{ t: 'highpass', f: 1500 * r, q: 0 }] });
      // 强低频冲击
      this._tn(v, t, { f: 95 * r, f1: 28, sw: 0.45 * k, a: 0.003, dur: 0.8 * k, g: 1.0, to: drv });
      this._tn(v, t, { w: 'triangle', f: 62 * r, f1: 30, sw: 0.3, a: 0.004, dur: 0.55, g: 0.45, to: drv });
      // 噪声爆裂主体
      this._nz(v, t, { n: 'pink', a: 0.002, dur: 0.95 * k, g: 1.0, flt: [{ t: 'lowpass', f: 5200 * r, f1: 260, sw: 0.7, q: 0 }], to: drv });
      this._nz(v, t, { n: 'white', a: 0.001, dur: 0.35 * k, g: 0.45, flt: [{ t: 'bandpass', f: 950 * r, q: 0.8 }], to: drv });
      // 长尾隆隆
      this._nz(v, t + 0.02, { n: 'brown', a: 0.06, dur: 2.6 * k, g: 0.55, flt: [{ t: 'lowpass', f: 240, f1: 80, sw: 2.2, q: 0 }] });
      // 集装箱回声
      for (const [dt, eg] of [[0.21, 0.22], [0.47, 0.13], [0.9, 0.06]]) {
        this._nz(v, t + dt * jit(0.1), { n: 'pink', a: 0.01, dur: 0.35, g: eg, flt: [{ t: 'lowpass', f: 1100, q: 0 }, { t: 'highpass', f: 120, q: 0 }] });
      }
      // 碎片：金属碎屑/杂物散落甲板
      const n = 16 + ((Math.random() * 8) | 0);
      for (let i = 0; i < n; i++) {
        const dt = 0.08 + 1.6 * Math.pow(Math.random(), 1.7);
        const gg = 0.12 * (1 - dt / 2) * rand(0.4, 1);
        if (Math.random() < 0.55) this._metal(v, t + dt, rand(1600, 5200), gg, [[1, 1, rand(0.03, 0.08)], [1.71, 0.5, 0.03]]);
        else this._click(v, t + dt, rand(1200, 6000), gg * 1.5, 3, rand(0.008, 0.03));
      }
      this._done(v);
      if (p && d < 12) {
        // 近距离震荡：世界音发闷 + 耳鸣
        const s = 1 - d / 12;
        this._muffle(0.5 + 0.5 * s, 1 + 2 * s);
        this._ring(0.3 + 0.7 * s, 1.5 + 2 * s);
      }
    } catch (e) {
      this._warn('playExplosion', e);
    }
  }

  // -------------------------------------------------------------------------
  // 武器操作
  // -------------------------------------------------------------------------
  playWeaponSwitch(weaponId) {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { g: 0.42, wet: 0.05 });
      const t = this._now(), fm = (WEIGHT[weaponId] || 1) * jit(0.04);
      this._nz(v, t, { n: 'pink', a: 0.03, dur: 0.12, g: 0.18, flt: [{ t: 'bandpass', f: 1600, q: 0.7 }] }); // 衣物/背带摩擦
      switch (weaponId) {
        case 'knife': // 拔刀"锵"
          this._nz(v, t + 0.03, { n: 'white', a: 0.06, dur: 0.14, g: 0.18, flt: [{ t: 'bandpass', f: 2800, f1: 7500, sw: 0.18, q: 4 }] });
          this._metal(v, t + 0.17, rand(4800, 5600), 0.07, [[1, 1, 0.35], [1.43, 0.6, 0.25], [2.2, 0.3, 0.15]]);
          break;
        case 'grenade':
          this._metal(v, t + 0.06, 3000, 0.08, [[1, 1, 0.06], [1.6, 0.5, 0.04]]);
          this._tn(v, t + 0.06, { f: 220, f1: 140, a: 0.002, dur: 0.04, g: 0.15 });
          break;
        case 'awm':
          this._tn(v, t + 0.07, { f: 150, f1: 90, a: 0.002, dur: 0.08, g: 0.35 });
          this._click(v, t + 0.07, 1700, 0.45, 1.3, 0.025);
          this._metal(v, t + 0.07, 1600, 0.09, [[1, 1, 0.09], [2.2, 0.5, 0.06]]);
          this._click(v, t + 0.2, 2600, 0.3);
          break;
        case 'deagle':
          this._click(v, t + 0.05, 2600, 0.45, 2, 0.015);
          this._metal(v, t + 0.05, 2400, 0.1, [[1, 1, 0.06], [1.55, 0.5, 0.04]]);
          this._click(v, t + 0.13, 3400, 0.3);
          break;
        default:
          this._click(v, t + 0.05, 2200 * fm, 0.45, 2, 0.012);
          this._tn(v, t + 0.05, { f: 180 * fm, f1: 110, a: 0.002, dur: 0.045, g: 0.2 });
          this._click(v, t + 0.14, 3000 * fm, 0.35);
          this._metal(v, t + 0.14, 2600 * fm, 0.07, [[1, 1, 0.06], [1.5, 0.5, 0.04]]);
      }
      this._done(v);
    } catch (e) {
      this._warn('playWeaponSwitch', e);
    }
  }

  playScope(zoomIn) {
    if (!this._ok()) return;
    try {
      const up = zoomIn !== false;
      const v = this._voice(null, { g: 0.45, wet: 0 });
      const t = this._now();
      this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.006, g: 0.4, flt: [{ t: 'highpass', f: 3500, q: 0 }] });
      this._nz(v, t + 0.005, { n: 'white', a: 0.012, dur: 0.08, g: 0.12, flt: [{ t: 'bandpass', f: up ? 1200 : 3400, f1: up ? 3400 : 1200, sw: 0.09, q: 3 }] });
      this._metal(v, t + (up ? 0.07 : 0.04), up ? 4600 : 3800, 0.04, [[1, 1, 0.05], [1.6, 0.5, 0.03]]);
      this._tn(v, t, { f: up ? 180 : 140, f1: up ? 120 : 90, a: 0.002, dur: 0.05, g: 0.12 });
      this._done(v);
    } catch (e) {
      this._warn('playScope', e);
    }
  }

  playShellDrop(pos) {
    if (!this._ok()) return;
    try {
      const p = this._pos(pos), local = !p;
      const v = this._voice(p, { g: local ? 0.28 : 0.6, ref: 1.5, roll: 1.4, max: 30, wet: 0.06 });
      let t = this._now() + rand(0.3, 0.6); // 自带随机延迟
      const f = rand(3300, 4600), n = 2 + ((Math.random() * 3) | 0);
      let gap = rand(0.07, 0.11), amp = 1;
      for (let i = 0; i < n; i++) {
        // 弹跳：间隔与幅度逐次递减
        this._nz(v, t, { n: 'white', a: 0.0002, dur: 0.003, g: 0.3 * amp, flt: [{ t: 'highpass', f: 5000, q: 0 }] });
        this._metal(v, t, f * jit(0.02), 0.35 * amp, [[1, 1, 0.1 * amp + 0.03], [1.58, 0.6, 0.07], [2.43, 0.35, 0.05], [3.66, 0.2, 0.03]]);
        t += gap;
        gap *= rand(0.55, 0.7);
        amp *= rand(0.45, 0.6);
      }
      this._nz(v, t, { n: 'white', a: 0.02, dur: 0.12, g: 0.03, flt: [{ t: 'bandpass', f: 5200, q: 4 }] }); // 滚动
      this._done(v);
    } catch (e) {
      this._warn('playShellDrop', e);
    }
  }

  // -------------------------------------------------------------------------
  // UI / 播报
  // -------------------------------------------------------------------------
  playUI(kind) {
    if (!this._ok()) return;
    try {
      const v = this._voice(null, { bus: 'ui', g: 1.1, wet: kind === 'roundEnd' || kind === 'start' ? 0.12 : 0 });
      const t = this._now();
      switch (kind) {
        case 'hover':
          this._tn(v, t, { f: 2300, a: 0.002, dur: 0.03, g: 0.12 });
          break;
        case 'buy':
          this._nz(v, t, { n: 'white', a: 0.0005, dur: 0.01, g: 0.25, flt: [{ t: 'highpass', f: 3000, q: 0 }] });
          this._tn(v, t, { w: 'triangle', f: 1046.5, a: 0.003, dur: 0.09, g: 0.3 });
          this._tn(v, t + 0.07, { w: 'triangle', f: 1568, a: 0.003, dur: 0.22, g: 0.3 });
          this._metal(v, t + 0.07, 3136, 0.06, [[1, 1, 0.2], [2.7, 0.4, 0.1]]);
          break;
        case 'start': {
          const notes = [523.25, 659.25, 783.99, 1046.5];
          notes.forEach((f, i) => {
            const last = i === notes.length - 1;
            this._tn(v, t + i * 0.075, { w: 'sawtooth', f, a: 0.005, hold: last ? 0.15 : 0.03, dur: last ? 0.5 : 0.14, g: 0.12, flt: [{ t: 'lowpass', f: 1500, f1: 4500, sw: 0.3, q: 2 }] });
            this._tn(v, t + i * 0.075, { w: 'square', f: f * 0.5, a: 0.005, hold: last ? 0.15 : 0.03, dur: last ? 0.5 : 0.14, g: 0.04, flt: [{ t: 'lowpass', f: 1800, q: 0 }] });
          });
          this._tn(v, t, { f: 110, f1: 55, a: 0.003, dur: 0.2, g: 0.35 });
          break;
        }
        case 'countdown':
          this._tn(v, t, { w: 'square', f: 880, a: 0.002, hold: 0.06, dur: 0.1, g: 0.12, flt: [{ t: 'lowpass', f: 3000, q: 0 }] });
          this._tn(v, t, { f: 1760, a: 0.002, hold: 0.04, dur: 0.08, g: 0.06 });
          break;
        case 'roundEnd': {
          for (const f of [659.25, 783.99, 987.77]) this._tn(v, t, { w: 'triangle', f, a: 0.004, dur: 0.25, g: 0.12 });
          for (const f of [523.25, 659.25, 783.99, 1046.5]) {
            this._tn(v, t + 0.22, { w: 'triangle', f, a: 0.006, hold: 0.35, dur: 0.9, g: 0.12 });
            this._tn(v, t + 0.22, { w: 'sawtooth', f: f * 0.5, a: 0.01, hold: 0.3, dur: 0.8, g: 0.03, flt: [{ t: 'lowpass', f: 1400, q: 0 }] });
          }
          break;
        }
        default: // click
          this._tn(v, t, { f: 1500, f1: 1000, sw: 0.03, a: 0.001, dur: 0.035, g: 0.45 });
          this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.004, g: 0.3, flt: [{ t: 'highpass', f: 4000, q: 0 }] });
      }
      this._done(v);
    } catch (e) {
      this._warn('playUI', e);
    }
  }

  announce(text) {
    if (!this._ok()) return;
    try {
      const s = String(text == null ? '' : text).trim();
      this._badge(s); // 播报前的合成"徽章音"
      if (!s || this._offline) return;
      if (typeof setTimeout === 'function') setTimeout(() => this._speak(s), 130);
      else this._speak(s);
    } catch (e) {
      this._warn('announce', e);
    }
  }

  // -------------------------------------------------------------------------
  // 循环结构：心跳 / 环境音
  // -------------------------------------------------------------------------
  setLowHealth(on) {
    if (!this._ok()) return;
    try {
      on = !!on;
      const c = this.ctx, now = c.currentTime;
      if (!this._hbGain) {
        this._hbGain = c.createGain();
        this._hbGain.gain.value = 0;
        this._hbGain.connect(this._sfx);
      }
      if (on === this._hbOn) return;
      this._hbOn = on;
      const g = this._hbGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      if (on) {
        g.linearRampToValueAtTime(1, now + 0.3);
        if (this._hbNext < now + 0.02) this._hbNext = now + 0.05;
        this._tick();
      } else {
        g.linearRampToValueAtTime(0, now + 0.9); // 淡出，已排程的心跳随之消失
      }
    } catch (e) {
      this._warn('setLowHealth', e);
    }
  }

  startAmbient() {
    if (!this._ok()) return;
    try {
      const c = this.ctx, now = c.currentTime;
      const cur = this._amb;
      if (cur) {
        if (cur.stopping) {
          // 正在淡出时再次开启：取消销毁并淡回
          cur.stopping = false;
          clearTimeout(cur.timer);
          const g = cur.out.gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(1, now + 1.5);
        }
        return;
      }
      const a = { srcs: [], nodes: [], stopping: false, timer: 0 };
      const node = (n) => (a.nodes.push(n), n);
      const gain = (val) => {
        const g = node(c.createGain());
        g.gain.value = val;
        return g;
      };
      const biq = (type, f, q) => {
        const b = node(c.createBiquadFilter());
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        return b;
      };
      const pan = (x) => {
        if (!c.createStereoPanner) return gain(1);
        const p = node(c.createStereoPanner());
        p.pan.value = x;
        return p;
      };
      const loop = (kind, rate = 1) => {
        const s = c.createBufferSource();
        s.buffer = this._bank[kind];
        s.loop = true;
        s.playbackRate.value = rate;
        s.start(now, Math.random() * (s.buffer.duration - 0.1));
        a.srcs.push(s);
        return s;
      };
      const osc = (type, f) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.start(now);
        a.srcs.push(o);
        return o;
      };
      const lfo = (f, depth, param) => {
        const o = osc('sine', f);
        o.frequency.value = f;
        const g = gain(depth);
        o.connect(g);
        g.connect(param);
        return o;
      };

      const out = gain(0);
      out.connect(this._ambBus);
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(1, now + 3);
      a.out = out;

      // 海浪：褐噪声 + 慢速 LFO 起伏（左右两层，速率不同）
      for (const side of [-0.65, 0.65]) {
        const s = loop('brown', rand(0.85, 1.15));
        const lp = biq('lowpass', rand(550, 750), 0);
        const g = gain(0.1);
        lfo(rand(0.055, 0.1), 0.065, g.gain);
        lfo(rand(0.04, 0.08), 300, lp.frequency);
        const p = pan(side);
        s.connect(lp);
        lp.connect(g);
        g.connect(p);
        p.connect(out);
      }
      // 浪花泡沫嘶声
      {
        const s = loop('pink');
        const bp = biq('bandpass', 1300, 0.6);
        const g = gain(0.03);
        lfo(0.083, 0.025, g.gain);
        s.connect(bp);
        bp.connect(g);
        g.connect(out);
      }
      // 海风：带通噪声，阵风由 _tick 调度
      {
        const s = loop('pink', 0.9);
        const bp = biq('bandpass', 520, 1.1);
        const g = gain(0.06);
        lfo(0.047, 110, bp.frequency);
        lfo(0.031, 0.02, g.gain);
        const p = pan(0);
        if (p.pan) lfo(0.023, 0.5, p.pan);
        s.connect(bp);
        bp.connect(g);
        g.connect(p);
        p.connect(out);
        a.windG = g;
        a.windBP = bp;
        a.windBase = 0.06;
        a.windF = 520;
      }
      // 柴油主机：40~60Hz 基频及谐波，缓慢抖动 + 燃烧节拍调幅
      {
        const f0 = rand(46, 52);
        const eng = gain(0.05);
        const lp = biq('lowpass', 260, 0);
        eng.connect(lp);
        lp.connect(out);
        const j1 = osc('sine', 0.17), j2 = osc('sine', 0.43);
        for (const [type, h, amp] of [['sine', 1, 0.55], ['sine', 2.003, 0.35], ['triangle', 3, 0.16], ['sine', 4.01, 0.08], ['sawtooth', 0.5, 0.1]]) {
          const o = osc(type, f0 * h);
          const jg1 = gain(0.35 * h), jg2 = gain(0.2 * h);
          j1.connect(jg1);
          jg1.connect(o.frequency);
          j2.connect(jg2);
          jg2.connect(o.frequency);
          const g = gain(amp);
          o.connect(g);
          g.connect(eng);
        }
        lfo(f0 / 4.5, 0.012, eng.gain); // 约 11Hz 燃烧节拍
        const s = loop('brown', 0.7); // 船体低频隆隆
        const rl = biq('lowpass', 90, 0);
        const rg = gain(0.5);
        s.connect(rl);
        rl.connect(rg);
        rg.connect(eng);
      }
      // 随机事件时间表
      a.nGust = now + rand(3, 8);
      a.nGull = now + rand(3, 9);
      a.nCreak = now + rand(6, 15);
      a.nSplash = now + rand(2, 6);
      a.nHorn = now + rand(30, 70);
      this._amb = a;
    } catch (e) {
      this._warn('startAmbient', e);
    }
  }

  stopAmbient() {
    if (!this._ok()) return;
    try {
      const a = this._amb;
      if (!a || a.stopping) return;
      a.stopping = true;
      const now = this.ctx.currentTime, g = a.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 1.5); // 淡出
      const kill = () => {
        if (!a.stopping) return;
        for (const s of a.srcs) {
          try { s.stop(); } catch (_) { /* 已停止 */ }
          try { s.disconnect(); } catch (_) { /* 忽略 */ }
        }
        for (const n of a.nodes) try { n.disconnect(); } catch (_) { /* 忽略 */ }
        a.srcs.length = 0;
        a.nodes.length = 0;
        if (this._amb === a) this._amb = null;
      };
      if (typeof setTimeout === 'function') a.timer = setTimeout(kill, 1700);
      else kill();
    } catch (e) {
      this._warn('stopAmbient', e);
    }
  }

  update(dt) {
    if (!this._ok()) return;
    this._tick();
  }

  // =========================================================================
  // 内部实现
  // =========================================================================
  _ok() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  _now() {
    return this.ctx.currentTime + LOOKAHEAD;
  }

  _warn(where, e) {
    if (this._warned.has(where)) return;
    this._warned.add(where);
    try { console.warn('[audio] ' + where + ' 失败:', e); } catch (_) { /* 忽略 */ }
  }

  _resume() {
    const c = this.ctx;
    if (!c || this._offline) return;
    if ((c.state === 'suspended' || c.state === 'interrupted') && c.resume) {
      try {
        const pr = c.resume();
        if (pr && pr.catch) pr.catch(() => {});
      } catch (_) { /* 忽略 */ }
    }
  }

  _build() {
    const c = this.ctx;
    this._bank = getBank(c);
    this._tanh = tanhCurve();
    // 末级：软限幅（保证输出 < 1.0）
    const clipIn = c.createGain();
    clipIn.gain.value = 0.5;
    const clip = c.createWaveShaper();
    clip.curve = softClipCurve();
    clipIn.connect(clip);
    clip.connect(c.destination);
    const master = c.createGain();
    master.connect(clipIn);
    // 压缩器：防爆音
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    comp.connect(master);
    const premix = c.createGain();
    premix.connect(comp);
    // 子总线
    const sfx = c.createGain();
    sfx.connect(premix);
    const muf = c.createBiquadFilter();
    muf.type = 'lowpass';
    muf.frequency.value = this._fq(20000);
    muf.Q.value = -3;
    muf.connect(sfx);
    const world = c.createGain();
    world.connect(muf);
    const amb = c.createGain();
    amb.connect(premix);
    const voice = c.createGain();
    voice.connect(premix);
    // 卷积混响（发送量已在发送端按总线音量缩放）
    const conv = c.createConvolver();
    conv.normalize = true;
    conv.buffer = this._bank.ir;
    const revIn = c.createGain();
    const revOut = c.createGain();
    revOut.gain.value = 0.6;
    revIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(premix);
    const sfxSend = c.createGain();
    sfxSend.connect(revIn);
    const ambSend = c.createGain();
    ambSend.connect(revIn);

    Object.assign(this, {
      _clipIn: clipIn, _clip: clip, _master: master, _comp: comp, _premix: premix,
      _sfx: sfx, _muf: muf, _world: world, _ambBus: amb, _voiceBus: voice,
      _conv: conv, _revIn: revIn, _revOut: revOut, _sfxSend: sfxSend, _ambSend: ambSend,
    });
    this._applyVolumes(true);
  }

  _applyVolumes(immediate) {
    const v = this._vol, t = this.ctx.currentTime;
    const set = (node, val) => {
      if (!node) return;
      if (immediate) node.gain.value = val;
      else {
        node.gain.cancelScheduledValues(t);
        node.gain.setTargetAtTime(val, t, 0.03);
      }
    };
    set(this._master, v.master);
    set(this._sfx, v.sfx);
    set(this._sfxSend, v.sfx);
    set(this._ambBus, v.ambient);
    set(this._ambSend, v.ambient);
    set(this._voiceBus, v.voice);
  }

  _fq(f) {
    return clamp(f, 10, this.ctx.sampleRate * 0.49);
  }

  _pos(p) {
    if (!p || typeof p !== 'object') return null;
    const L = this._L;
    return { x: num(p.x, L.x), y: num(p.y, L.y), z: num(p.z, L.z) };
  }

  _dist(p) {
    const L = this._L;
    return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
  }

  // 距离 → 空气吸收低通截止频率（保留足够中高频以便 HRTF 判向）
  _airCut(d, air = 1) {
    return this._fq(clamp(20000 / (1 + (d * air) / 14), 1600, 20000));
  }

  /**
   * 创建一个 voice：layers 接入 v.input。
   * pos=null：非空间化直连总线；否则 lowpass(距离) → HRTF Panner → 总线。
   * o: {g, bus:'world'|'ui'|'ambient'|'voice', dest, ref, roll, max, wet, wd, hrtf, air, dist, pool}
   */
  _voice(pos, o) {
    const c = this.ctx;
    const pool = o.pool !== false;
    const dist = pos ? num(o.dist, this._dist(pos)) : 0;
    if (pool) this._reserve(dist);
    const v = { t0: c.currentTime, end: 0, dist, src: [], nodes: [], pending: 0, dead: false };
    const input = c.createGain();
    input.gain.value = num(o.g, 1);
    v.input = input;
    v.nodes.push(input);
    const bus = o.dest || (o.bus === 'ambient' ? this._ambBus : o.bus === 'voice' ? this._voiceBus : o.bus === 'ui' ? this._sfx : this._world);
    const send = o.bus === 'ambient' ? this._ambSend : this._sfxSend;
    let tap = input;
    if (pos) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = this._airCut(dist, o.air);
      lp.Q.value = 0;
      const pn = c.createPanner();
      pn.panningModel = o.hrtf === false ? 'equalpower' : 'HRTF';
      pn.distanceModel = 'inverse';
      pn.refDistance = num(o.ref, 2);
      pn.rolloffFactor = num(o.roll, 1);
      pn.maxDistance = num(o.max, 200);
      if (pn.positionX) {
        pn.positionX.value = pos.x;
        pn.positionY.value = pos.y;
        pn.positionZ.value = pos.z;
      } else pn.setPosition(pos.x, pos.y, pos.z);
      input.connect(lp);
      lp.connect(pn);
      pn.connect(bus);
      v.nodes.push(lp, pn);
      tap = lp;
    } else input.connect(bus);
    // 混响发送：取自 panner 之前（不受距离衰减），故距离越远湿/干比越大
    let wet = num(o.wet, 0.12);
    if (pos) wet /= 1 + dist / num(o.wd, 40);
    if (wet > 0.001 && send) {
      const sg = c.createGain();
      sg.gain.value = wet;
      tap.connect(sg);
      sg.connect(send);
      v.nodes.push(sg);
    }
    if (pool) this.voices.push(v);
    return v;
  }

  // 超出上限时：优先丢弃比新声音更远的最远 voice，否则丢弃最旧的
  _reserve(d) {
    const vs = this.voices;
    while (vs.length >= this.maxVoices) {
      let fi = -1, far = -1;
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].dist > far) {
          far = vs[i].dist;
          fi = i;
        }
      }
      this._kill(far > d ? vs[fi] : vs[0]);
    }
  }

  _kill(v) {
    const now = this.ctx.currentTime;
    try {
      const g = v.input.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.02);
    } catch (_) { /* 忽略 */ }
    for (const s of v.src) {
      try { s.stop(now + 0.03); } catch (_) { /* 忽略 */ }
    }
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (!v.src.length) this._free(v);
  }

  _track(v, s, end) {
    v.pending++;
    v.src.push(s);
    if (end > v.end) v.end = end;
    s.onended = () => {
      try { s.disconnect(); } catch (_) { /* 忽略 */ }
      if (--v.pending <= 0) this._free(v);
    };
  }

  _done(v) {
    if (v.pending <= 0) this._free(v);
  }

  // 断开 voice 全部节点，便于 GC
  _free(v) {
    if (v.dead) return;
    v.dead = true;
    for (const n of v.nodes) try { n.disconnect(); } catch (_) { /* 忽略 */ }
    v.nodes.length = 0;
    v.src.length = 0;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  // 包络：线性起音 → (保持) → 指数衰减到 -60dB
  _env(p, t, a, d, peak, hold) {
    peak = Math.max(peak, 1e-5);
    a = Math.max(a, 0.0002);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    let e = t + a;
    if (hold > 0) {
      e += hold;
      p.setValueAtTime(peak, e);
    }
    e += Math.max(d, 0.002);
    p.exponentialRampToValueAtTime(peak * 1e-3, e);
    p.linearRampToValueAtTime(0, e + 0.004);
    return e + 0.004;
  }

  // 滤波器：{t:type, f, q, f1, sw, path:[[dt,f],...]}
  _flt(v, sp, t) {
    const b = this.ctx.createBiquadFilter();
    b.type = sp.t;
    const fr = b.frequency;
    fr.setValueAtTime(this._fq(sp.f), t);
    if (sp.path) for (const [dt, f] of sp.path) fr.exponentialRampToValueAtTime(this._fq(f), t + dt);
    else if (sp.f1) fr.exponentialRampToValueAtTime(this._fq(sp.f1), t + (sp.sw || 0.1));
    if (sp.q != null) b.Q.value = sp.q;
    v.nodes.push(b);
    return b;
  }

  // 噪声层：复用预生成 buffer，随机 offset
  _nz(v, t, o) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this._bank[o.n || 'white'];
    const rate = o.rate || 1;
    if (rate !== 1) s.playbackRate.value = rate;
    let last = s;
    if (o.flt) for (const sp of o.flt) {
      const b = this._flt(v, sp, t);
      last.connect(b);
      last = b;
    }
    const g = c.createGain();
    const end = this._env(g.gain, t, num(o.a, 0.001), o.dur, num(o.g, 1), o.hold || 0);
    last.connect(g);
    g.connect(o.to || v.input);
    v.nodes.push(g);
    const len = end - t + 0.015;
    const bd = s.buffer.duration;
    if (len * rate > bd - 0.02) s.loop = true;
    const off = Math.random() * Math.max(0, bd - len * rate - 0.02);
    s.start(t, off);
    s.stop(t + len);
    this._track(v, s, t + len);
    return g;
  }

  // 振荡器层：{w, f, f1, sw, path, det, fm:[rate, depth], flt, a, dur, hold, g, to}
  _tn(v, t, o) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = o.w || 'sine';
    const fr = osc.frequency;
    fr.setValueAtTime(this._fq(o.f), t);
    if (o.path) for (const [dt, f] of o.path) fr.exponentialRampToValueAtTime(this._fq(f), t + dt);
    else if (o.f1) fr.exponentialRampToValueAtTime(this._fq(o.f1), t + (o.sw || o.dur));
    if (o.det) osc.detune.value = o.det;
    let last = osc;
    if (o.flt) for (const sp of o.flt) {
      const b = this._flt(v, sp, t);
      last.connect(b);
      last = b;
    }
    const g = c.createGain();
    const end = this._env(g.gain, t, num(o.a, 0.002), o.dur, num(o.g, 1), o.hold || 0) + 0.01;
    last.connect(g);
    g.connect(o.to || v.input);
    v.nodes.push(g);
    osc.start(t);
    osc.stop(end);
    this._track(v, osc, end);
    if (o.fm) {
      const m = c.createOscillator();
      m.frequency.value = o.fm[0];
      const mg = c.createGain();
      mg.gain.value = o.fm[1];
      m.connect(mg);
      mg.connect(fr);
      v.nodes.push(mg);
      m.start(t);
      m.stop(end);
      this._track(v, m, end);
    }
    return g;
  }

  // 金属非谐波泛音组：parts = [[频率比, 相对幅度, 衰减时长], ...]
  _metal(v, t, f, g, parts, to) {
    for (const [ratio, amp, dec] of parts) this._tn(v, t, { f: f * ratio, a: 0.0006, dur: dec, g: g * amp, to });
  }

  _click(v, t, f, g, q = 2.5, dur = 0.01) {
    this._nz(v, t, { n: 'white', a: 0.0003, dur, g, flt: [{ t: 'bandpass', f, q }] });
  }

  _whoosh(v, t, o) {
    this._nz(v, t, { n: o.n || 'pink', a: o.a, dur: o.dur, g: o.g, flt: [{ t: 'bandpass', f: o.f0, q: o.q || 1.5, path: [[o.a, o.fp], [o.a + o.dur, o.f1]] }] });
  }

  // 枪声饱和级：前级 amount/3 → tanh → 后级增益
  _drive(v, amt, post) {
    const c = this.ctx;
    const pre = c.createGain();
    pre.gain.value = amt / 3;
    const ws = c.createWaveShaper();
    ws.curve = this._tanh;
    const pg = c.createGain();
    pg.gain.value = post;
    pre.connect(ws);
    ws.connect(pg);
    pg.connect(v.input);
    v.nodes.push(pre, ws, pg);
    return pre;
  }

  // 本地枪机金属咔嗒（两下：击发 + 复位）
  _mech(v, t, f, g) {
    this._nz(v, t, { n: 'white', a: 0.0003, dur: 0.01, g: g * 1.4, flt: [{ t: 'bandpass', f: f * 1.25, q: 2.5 }] });
    this._metal(v, t, f, g, [[1, 1, 0.045], [1.53, 0.6, 0.032], [2.41, 0.35, 0.022]]);
    this._nz(v, t + 0.03 * jit(0.15), { n: 'white', a: 0.0003, dur: 0.008, g: g * 0.9, flt: [{ t: 'bandpass', f: f * 0.85, q: 3 }] });
  }

  // 地面材质撞击。g: 电平, r: 音高系数, heavy: 0..1 落地力度, br: 亮度（蹲走更闷）
  _surf(v, t, s, g, r, heavy, br) {
    const hd = 1 + heavy * 1.5;
    switch (s) {
      case 'container': // 集装箱顶：空洞的共鸣轰响
        this._tn(v, t, { f: 74 * r, f1: 62 * r, dur: 0.26 * hd, a: 0.004, g: 0.55 * g });
        this._tn(v, t, { f: 121 * r, f1: 110 * r, dur: 0.18 * hd, a: 0.003, g: 0.32 * g });
        this._tn(v, t, { w: 'triangle', f: 173 * r, dur: 0.12 * hd, a: 0.002, g: 0.14 * g });
        this._nz(v, t, { n: 'pink', a: 0.002, dur: 0.12 * hd, g: 0.55 * g, flt: [{ t: 'bandpass', f: 380 * r, q: 1.6 }] });
        this._nz(v, t, { n: 'white', a: 0.0008, dur: 0.03, g: 0.22 * g * br, flt: [{ t: 'bandpass', f: 1900 * r, q: 1.2 }] });
        this._metal(v, t, 690 * r, 0.05 * g * br, [[1, 1, 0.18 * hd], [2.2, 0.6, 0.12]]);
        break;
      case 'wood':
        this._tn(v, t, { f: 160 * r, f1: 95 * r, dur: 0.05 * hd, a: 0.002, g: 0.4 * g });
        this._nz(v, t, { n: 'pink', a: 0.0015, dur: 0.055 * hd, g: 0.55 * g, flt: [{ t: 'lowpass', f: 1100 * r * (0.6 + 0.4 * br), q: 0 }] });
        this._nz(v, t, { n: 'white', a: 0.0006, dur: 0.014, g: 0.12 * g * br, flt: [{ t: 'bandpass', f: 2600 * r, q: 2 }] });
        if (Math.random() < 0.15) {
          // 偶发木板吱呀
          this._tn(v, t + 0.02, { w: 'sawtooth', f: rand(28, 40), a: 0.02, dur: 0.12, g: 0.1 * g, flt: [{ t: 'bandpass', f: rand(600, 900), q: 8 }] });
        }
        break;
      case 'grate': { // 钢格栅：薄金属 + 细碎颤响
        this._tn(v, t, { f: 135 * r, f1: 85 * r, dur: 0.045 * hd, a: 0.002, g: 0.3 * g });
        this._nz(v, t, { n: 'white', a: 0.0008, dur: 0.03 * hd, g: 0.35 * g * br, flt: [{ t: 'bandpass', f: 2600 * r, q: 1 }] });
        let tt = t;
        const n = 3 + ((Math.random() * 2) | 0) + Math.round(heavy * 3);
        for (let i = 0; i < n; i++) {
          tt += rand(0.007, 0.02);
          this._click(v, tt, rand(3000, 5600), 0.2 * g * br * Math.pow(0.72, i), 5, 0.012);
        }
        this._metal(v, t, 910 * r, 0.05 * g * br, [[1, 1, 0.08 * hd], [2.6, 0.5, 0.05]]);
        break;
      }
      default: // metal 钢甲板
        this._tn(v, t, { f: 115 * r, f1: 70 * r, dur: 0.055 * hd, a: 0.002, g: 0.5 * g });
        this._nz(v, t, { n: 'pink', a: 0.001, dur: 0.045 * hd, g: 0.45 * g, flt: [{ t: 'bandpass', f: 1500 * r * (0.7 + 0.3 * br), q: 1.2 }] });
        this._nz(v, t, { n: 'white', a: 0.0005, dur: 0.012, g: 0.15 * g * br, flt: [{ t: 'highpass', f: 3500, q: 0 }] });
        this._metal(v, t, 530 * r, 0.1 * g * br, [[1, 1, 0.13 * hd], [2.31, 0.7, 0.09 * hd], [3.93, 0.45, 0.06]]);
    }
  }

  // 短促闷哼：锯齿波 + 共振峰带通
  _grunt(v, t, f0, f1, dur, g) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = c.createGain();
    const end = this._env(env.gain, t, 0.02, dur * 0.8, 1, dur * 0.2) + 0.01;
    o.connect(env);
    v.nodes.push(env);
    for (const [f, q, a] of [[620, 6, 1], [1050, 8, 0.6], [2500, 10, 0.25]]) {
      const b = c.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f;
      b.Q.value = q;
      const gg = c.createGain();
      gg.gain.value = a * g * 2;
      env.connect(b);
      b.connect(gg);
      gg.connect(v.input);
      v.nodes.push(b, gg);
    }
    o.start(t);
    o.stop(end);
    this._track(v, o, end);
    this._nz(v, t, { n: 'white', a: 0.02, dur, g: g * 0.15, flt: [{ t: 'bandpass', f: 1200, q: 1 }] });
  }

  _throwWhoosh(p) {
    const v = this._voice(p, { g: p ? 0.8 : 0.55, ref: 2, roll: 1.2, max: 40, wet: 0.05 });
    const t = this._now();
    this._nz(v, t, { n: 'white', a: 0.03, dur: 0.12, g: 0.1, flt: [{ t: 'bandpass', f: 2200, q: 0.8 }] }); // 衣物
    this._whoosh(v, t + 0.04, { a: 0.1, dur: 0.22, g: 0.45, f0: 350, fp: 1700, f1: 500, q: 1.3 });
    this._metal(v, t + 0.12, rand(4000, 4600), 0.05, [[1, 1, 0.1], [1.5, 0.4, 0.06]]); // 保险片弹飞
    this._done(v);
  }

  // 耳鸣（走 ui 总线，不被 muffle 影响）
  _ring(level, dur) {
    const v = this._voice(null, { bus: 'ui', g: 1, wet: 0, pool: false });
    const t = this._now(), f = rand(3700, 4300), g = 0.012 + 0.035 * level;
    this._tn(v, t, { f, a: 0.05, hold: dur * 0.25, dur: dur * 0.75, g });
    this._tn(v, t, { f: f * 1.006, a: 0.08, hold: dur * 0.2, dur: dur * 0.7, g: g * 0.5 });
    this._done(v);
  }

  // 世界音短暂发闷（受伤/爆炸震荡）
  _muffle(depth, dur) {
    const f = this._muf.frequency, now = this.ctx.currentTime, top = this._fq(20000);
    const lo = clamp(top * Math.pow(0.05, clamp(depth, 0, 1)), 600, top);
    f.cancelScheduledValues(now);
    f.setValueAtTime(clamp(f.value, 10, top), now);
    f.exponentialRampToValueAtTime(lo, now + 0.04);
    f.setTargetAtTime(top, now + 0.04 + dur * 0.3, Math.max(0.05, dur * 0.3));
  }

  // 播报前的徽章音：短促上扬的合成器和弦（连杀越高音越高）
  _badge(text) {
    const s = text.toLowerCase();
    const lvl = /multi|ultra|mega|monster/.test(s) ? 3 : /triple/.test(s) ? 2 : /double|headshot/.test(s) ? 1 : 0;
    const v = this._voice(null, { bus: 'voice', g: 1.1, wet: 0.12 });
    const t = this._now(), base = 392 * Math.pow(2, (lvl * 2) / 12);
    for (const [h, det] of [[1, -6], [1.26, 5], [1.5, -3], [2, 4]]) {
      const f = base * h;
      this._tn(v, t, { w: 'sawtooth', f: f * 0.84, path: [[0.09, f]], det, a: 0.008, hold: 0.05, dur: 0.24, g: 0.07, flt: [{ t: 'lowpass', f: 900, f1: 6000, sw: 0.12, q: 3 }] });
    }
    this._tn(v, t, { f: 110, f1: 70, a: 0.002, dur: 0.12, g: 0.25 });
    this._tn(v, t + 0.06, { f: base * 8, a: 0.002, dur: 0.18, g: 0.04 });
    this._done(v);
  }

  _initSpeech() {
    const ss = globalThis.speechSynthesis;
    if (!ss || this._speechInit) return;
    this._speechInit = true;
    try {
      const reset = () => { this._sv = null; };
      if (ss.addEventListener) ss.addEventListener('voiceschanged', reset);
      else ss.onvoiceschanged = reset;
      ss.getVoices();
    } catch (_) { /* 忽略 */ }
  }

  // 优先英文男声
  _pickVoice() {
    const ss = globalThis.speechSynthesis;
    if (!ss || !ss.getVoices) return null;
    if (this._sv) return this._sv;
    const en = (ss.getVoices() || []).filter((x) => /^en([-_]|$)/i.test(x.lang || ''));
    if (!en.length) return null;
    const male = /\bmale\b|david|daniel|alex|fred|george|james|mark|guy|ryan|thomas|arthur|oliver|aaron|rishi|eddy|reed|ralph|bruce|christopher|eric|roger|steffan|brian|matthew|joey|justin/i;
    const female = /female|zira|samantha|victoria|karen|moira|tessa|fiona|susan|hazel|serena|kate|veena|allison|ava|joanna|salli|kendra|kimberly|ivy|jenny|aria|libby|sonia|natasha|emma|amy|google us english$/i;
    let best = null, bs = -1e9;
    for (const x of en) {
      const n = x.name || '';
      let s = 0;
      if (female.test(n)) s -= 3;
      else if (male.test(n)) s += 3;
      if (/^en[-_](us|gb)/i.test(x.lang)) s += 1;
      if (x.localService) s += 0.5;
      if (s > bs) {
        bs = s;
        best = x;
      }
    }
    this._sv = best;
    return best;
  }

  _speak(text) {
    try {
      const G = globalThis, ss = G.speechSynthesis, U = G.SpeechSynthesisUtterance;
      if (!ss || !U) return; // 不可用时静默
      const u = new U(text);
      u.lang = 'en-US';
      u.rate = 1.05;
      u.pitch = 0.8;
      u.volume = clamp(this._vol.master * this._vol.voice, 0, 1);
      const vo = this._pickVoice();
      if (vo) {
        u.voice = vo;
        u.lang = vo.lang;
      }
      if (ss.speaking || ss.pending) ss.cancel(); // 连杀播报不排队
      ss.speak(u);
    } catch (_) { /* 静默 */ }
  }

  // 调度器：心跳 / 环境随机事件 / 兜底回收。由 update() 与内部定时器共同驱动（时间判定幂等）
  _tick() {
    if (!this._ok()) return;
    try {
      const now = this.ctx.currentTime;
      for (let i = this.voices.length - 1; i >= 0; i--) {
        const v = this.voices[i];
        if (v && v.end && now > v.end + 3) this._free(v);
      }
      if (this._hbOn) {
        if (this._hbNext < now) this._hbNext = now + 0.02;
        while (this._hbNext < now + 0.3) {
          this._beat(this._hbNext);
          this._hbNext += 0.68 * jit(0.02);
        }
      }
      const a = this._amb;
      if (a && !a.stopping) {
        if (now >= a.nGust) { this._gust(a, now); a.nGust = now + rand(5, 14); }
        if (now >= a.nGull) { this._gulls(); a.nGull = now + rand(7, 22); }
        if (now >= a.nCreak) { this._creak(); a.nCreak = now + rand(9, 26); }
        if (now >= a.nSplash) { this._splash(); a.nSplash = now + rand(3, 9); }
        if (now >= a.nHorn) { this._horn(); a.nHorn = now + rand(80, 180); }
      }
    } catch (e) {
      this._warn('update', e);
    }
  }

  // 一次心跳 "咚-哒"
  _beat(t) {
    const v = this._voice(null, { dest: this._hbGain, pool: false, wet: 0, g: 0.36 });
    this._tn(v, t, { w: 'triangle', f: 64, f1: 44, sw: 0.08, a: 0.01, dur: 0.14, g: 0.9, flt: [{ t: 'lowpass', f: 260, q: 0 }] });
    this._nz(v, t, { n: 'brown', a: 0.008, dur: 0.09, g: 0.35, flt: [{ t: 'lowpass', f: 140, q: 0 }] });
    const t2 = t + 0.27;
    this._tn(v, t2, { w: 'triangle', f: 56, f1: 40, sw: 0.09, a: 0.012, dur: 0.16, g: 0.7, flt: [{ t: 'lowpass', f: 240, q: 0 }] });
    this._nz(v, t2, { n: 'brown', a: 0.01, dur: 0.1, g: 0.25, flt: [{ t: 'lowpass', f: 120, q: 0 }] });
    this._done(v);
  }

  // 环境事件：随机点（相对听者）
  _around(dMin, dMax, yMin, yMax) {
    const L = this._L, ang = rand(0, TAU), d = rand(dMin, dMax);
    return { x: L.x + Math.cos(ang) * d, y: L.y + rand(yMin, yMax), z: L.z + Math.sin(ang) * d };
  }

  // 阵风：风噪增益与带通中心频率一起上扬再回落，偶尔伴随集装箱缝隙的呼哨
  _gust(a, now) {
    const up = rand(0.8, 2.2), hold = rand(0.4, 2), down = rand(1.5, 3.5);
    const pairs = [[a.windG.gain, a.windBase * rand(1.8, 3.2), a.windBase], [a.windBP.frequency, a.windF * rand(1.5, 2.4), a.windF]];
    for (const [p, hi, lo] of pairs) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(hi, now, up / 3);
      p.setTargetAtTime(lo, now + up + hold, down / 3);
    }
    if (Math.random() < 0.5) {
      const v = this._voice(null, { bus: 'ambient', g: 0.5, wet: 0.1 });
      const f = rand(900, 1700);
      this._nz(v, now + 0.01, { n: 'pink', a: up, hold, dur: down, g: 0.05, flt: [{ t: 'bandpass', f, q: 14, path: [[up, f * 1.15], [up + hold + down, f * 0.9]] }] });
      this._done(v);
    }
  }

  // 海鸥：锯齿波频率上滑后下滑 + FM 颤音 + 共振峰带通
  _gulls() {
    const v = this._voice(this._around(20, 60, 8, 25), { bus: 'ambient', g: rand(1.6, 2.6), ref: 15, roll: 1, max: 400, wet: 0.3, wd: 1e9, hrtf: false, air: 0.4 });
    let t = this._now();
    const n = 1 + ((Math.random() * 4) | 0), base = rand(1350, 1900);
    for (let i = 0; i < n; i++) {
      const d = rand(0.18, 0.38), f = base * jit(0.04) * (i === n - 1 && n > 2 ? 0.85 : 1);
      this._tn(v, t, { w: 'sawtooth', f: f * 0.75, path: [[d * 0.2, f * 1.2], [d, f * 0.62]], fm: [rand(26, 42), f * 0.05], a: 0.025, hold: d * 0.35, dur: d * 0.65, g: 0.22, flt: [{ t: 'bandpass', f: 2100, q: 1.6 }, { t: 'highpass', f: 900, q: 0 }] });
      this._nz(v, t, { n: 'white', a: 0.03, hold: d * 0.3, dur: d * 0.6, g: 0.035, flt: [{ t: 'bandpass', f: 2800, q: 2.5 }] });
      t += d + rand(0.1, 0.3);
    }
    this._done(v);
  }

  // 金属结构吱嘎：粘滑摩擦脉冲串激励高 Q 共振
  _creak() {
    const c = this.ctx;
    const v = this._voice(this._around(5, 22, -3, 4), { bus: 'ambient', g: rand(0.8, 1.3), ref: 5, roll: 1, max: 120, wet: 0.35, hrtf: false });
    const t = this._now(), dur = rand(0.7, 2.0);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    let f = rand(14, 30);
    o.frequency.setValueAtTime(f, t);
    for (let i = 1; i <= 6; i++) {
      f = clamp(f * rand(0.75, 1.35), 8, 55);
      o.frequency.linearRampToValueAtTime(f, t + (dur * i) / 6);
    }
    const env = c.createGain();
    const eg = env.gain;
    eg.setValueAtTime(0, t);
    eg.linearRampToValueAtTime(0.5, t + dur * 0.2);
    eg.linearRampToValueAtTime(0.35, t + dur * 0.55);
    eg.linearRampToValueAtTime(0.5, t + dur * 0.75);
    eg.linearRampToValueAtTime(0, t + dur);
    o.connect(env);
    v.nodes.push(env);
    for (const [fr, q, amp] of [[rand(320, 450), 22, 1], [rand(800, 1000), 28, 0.7], [rand(1500, 1900), 30, 0.4], [rand(2600, 3100), 30, 0.2]]) {
      const b = c.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.setValueAtTime(fr, t);
      b.frequency.linearRampToValueAtTime(fr * rand(0.93, 1.07), t + dur);
      b.Q.value = q;
      const g = c.createGain();
      g.gain.value = amp * 3;
      env.connect(b);
      b.connect(g);
      g.connect(v.input);
      v.nodes.push(b, g);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    this._track(v, o, t + dur + 0.05);
    this._done(v);
  }

  // 浪拍船舷
  _splash() {
    const v = this._voice(this._around(6, 20, -5, -3), { bus: 'ambient', g: rand(0.35, 0.7), ref: 5, roll: 1, max: 100, wet: 0.2, hrtf: false });
    const t = this._now(), a = rand(0.25, 0.6), dur = rand(0.8, 1.8);
    this._nz(v, t, { n: 'pink', a, dur, g: 0.6, flt: [{ t: 'bandpass', f: 900, q: 0.7, path: [[a, 1300], [a + dur, 380]] }] });
    this._nz(v, t + a * 0.8, { n: 'white', a: 0.1, dur: dur * 0.7, g: 0.08, flt: [{ t: 'highpass', f: 2500, q: 0 }] });
    this._nz(v, t, { n: 'brown', a: a * 1.2, dur, g: 0.4, flt: [{ t: 'lowpass', f: 250, q: 0 }] });
    this._done(v);
  }

  // 远处汽笛：失谐锯齿 + 五度 + 八度，低通，长混响
  _horn() {
    const v = this._voice(this._around(250, 420, 10, 20), { bus: 'ambient', g: 0.22, ref: 150, roll: 1, max: 3000, wet: 0.7, wd: 1e9, hrtf: false, air: 0.2 });
    const f = rand(78, 98), t0 = this._now();
    const n = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 4.2, hold = i === 0 ? rand(1.8, 3) : rand(1, 1.6);
      for (const [h, amp, det] of [[1, 0.5, -4], [1, 0.4, 5], [1.5, 0.3, 0], [2, 0.18, 3]]) {
        this._tn(v, t, { w: 'sawtooth', f: f * h * 0.97, path: [[0.35, f * h]], det, a: 0.35, hold, dur: 1.3, g: amp, flt: [{ t: 'lowpass', f: 650, q: 1 }] });
      }
    }
    this._done(v);
  }
}

export const audio = new AudioSystem();
