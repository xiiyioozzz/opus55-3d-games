// 武器数据（参考穿越火线手感：步枪首发精准，连射上跳后左右摆动；狙击枪开镜才准）
export const WEAPONS = {
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 0, type: 'rifle', auto: true,
    dmg: 36, headMul: 4.0, limbMul: 0.78, rpm: 600, mag: 30, reserve: 90, reload: 2.45, draw: 0.85,
    speed: 0.93, range: 220, falloff: 0.985, pen: 1.2, armorPen: 0.78,
    spread: { base: 0.0028, move: 0.045, air: 0.16, crouch: 0.6, perShot: 0.0055, max: 0.05, recover: 7 },
    recoil: { up: 0.0105, upMax: 0.11, side: 0.0062, sideStart: 5, recover: 6.5 },
    sound: 'ak47', hudName: 'AK-47',
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 0, type: 'rifle', auto: true,
    dmg: 32, headMul: 4.0, limbMul: 0.8, rpm: 700, mag: 30, reserve: 90, reload: 2.3, draw: 0.8,
    speed: 0.95, range: 220, falloff: 0.985, pen: 1.0, armorPen: 0.72,
    spread: { base: 0.0024, move: 0.04, air: 0.15, crouch: 0.6, perShot: 0.0044, max: 0.042, recover: 8 },
    recoil: { up: 0.0082, upMax: 0.085, side: 0.0048, sideStart: 6, recover: 7 },
    sound: 'm4a1', hudName: 'M4A1',
  },
  awm: {
    id: 'awm', name: 'AWM', slot: 0, type: 'sniper', auto: false,
    dmg: 118, headMul: 2.2, limbMul: 0.82, rpm: 41, mag: 5, reserve: 20, reload: 3.5, draw: 1.1,
    speed: 0.82, range: 400, falloff: 0.998, pen: 2.6, armorPen: 0.95, bolt: 1.35,
    spread: { base: 0.06, scoped: 0.0004, move: 0.09, air: 0.22, crouch: 0.85, perShot: 0, max: 0.2, recover: 3 },
    recoil: { up: 0.035, upMax: 0.035, side: 0.004, sideStart: 0, recover: 4 },
    zoom: [30, 11], sound: 'awm', hudName: 'AWM',
  },
  mp5: {
    id: 'mp5', name: 'MP5', slot: 0, type: 'smg', auto: true,
    dmg: 25, headMul: 3.6, limbMul: 0.85, rpm: 800, mag: 30, reserve: 120, reload: 2.1, draw: 0.6,
    speed: 1.0, range: 120, falloff: 0.97, pen: 0.6, armorPen: 0.6,
    spread: { base: 0.004, move: 0.022, air: 0.12, crouch: 0.7, perShot: 0.0035, max: 0.04, recover: 9 },
    recoil: { up: 0.0058, upMax: 0.06, side: 0.004, sideStart: 5, recover: 8 },
    sound: 'mp5', hudName: 'MP5',
  },
  deagle: {
    id: 'deagle', name: '沙漠之鹰', slot: 1, type: 'pistol', auto: false,
    dmg: 54, headMul: 3.8, limbMul: 0.75, rpm: 260, mag: 7, reserve: 35, reload: 2.0, draw: 0.55,
    speed: 1.0, range: 150, falloff: 0.98, pen: 1.0, armorPen: 0.8,
    spread: { base: 0.004, move: 0.05, air: 0.18, crouch: 0.7, perShot: 0.028, max: 0.07, recover: 5 },
    recoil: { up: 0.03, upMax: 0.09, side: 0.008, sideStart: 1, recover: 5 },
    sound: 'deagle', hudName: 'DESERT EAGLE',
  },
  knife: {
    id: 'knife', name: '军刀', slot: 2, type: 'melee', auto: true,
    dmgLight: 52, dmgHeavy: 100, rangeLight: 1.9, rangeHeavy: 1.6, rateLight: 0.42, rateHeavy: 1.05, draw: 0.4,
    speed: 1.08, sound: 'knife', hudName: 'KNIFE', mag: 0, reserve: 0,
  },
  he: {
    id: 'he', name: '手雷', slot: 3, type: 'grenade', auto: false,
    dmg: 115, radius: 7.5, fuse: 2.6, count: 1, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'HE GRENADE', mag: 1, reserve: 0,
  },
};

export const PRIMARIES = ['ak47', 'm4a1', 'awm', 'mp5'];

export class WeaponState {
  constructor(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.nextFire = 0;
    this.reloadUntil = 0;
    this.shotsFired = 0;   // 本次连射计数
    this.spreadAcc = 0;    // 连射累积扩散
    this.lastShot = -10;
    this.boltUntil = 0;
  }
  get reloading() { return this.reloadUntil > 0; }
  canReload() {
    const d = this.def;
    return d.type !== 'melee' && d.type !== 'grenade' && this.mag < d.mag && this.reserve > 0 && !this.reloading;
  }
  finishReload() {
    const need = this.def.mag - this.mag, take = Math.min(need, this.reserve);
    this.mag += take; this.reserve -= take; this.reloadUntil = 0;
  }
  refill() { this.mag = this.def.mag; this.reserve = this.def.reserve; this.reloadUntil = 0; this.boltUntil = 0; }
}

// 当前散布（弧度，锥半角）
export function currentSpread(ws, st) {
  const s = ws.def.spread;
  if (!s) return 0;
  let v = s.base;
  if (ws.def.type === 'sniper') v = st.scoped && st.scopeReady ? s.scoped : s.base;
  const sp = st.speed || 0; // 水平速度 m/s
  v += s.move * Math.min(1, Math.max(0, (sp - 0.6) / 5.5));
  if (!st.onGround) v += s.air;
  v += ws.spreadAcc;
  if (st.crouch && st.onGround) v *= s.crouch;
  return Math.min(v, s.max + s.base + (st.onGround ? 0 : s.air));
}

// 后坐力：返回本发的 [pitch, yaw] 增量（弧度）
export function recoilKick(ws, rnd) {
  const r = ws.def.recoil;
  const n = ws.shotsFired;
  let up = r.up * (n < 3 ? 1.25 : 1) * (0.85 + rnd() * 0.3);
  let side = 0;
  if (n >= r.sideStart) {
    // 左右摆动（慢周期）+ 随机
    const phase = Math.sin(n * 0.55 + (ws.patternSeed || 0));
    side = r.side * (phase * 1.3 + (rnd() - 0.5) * 0.9);
  } else side = (rnd() - 0.5) * r.side * 0.4;
  return [up, side];
}

// 在锥内随机扰动方向（dir 已归一化，就地修改）
export function jitterDir(dir, spread, rnd) {
  if (spread <= 0) return dir;
  // 构造正交基
  const ax = Math.abs(dir.x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = dir.y * ax[2] - dir.z * ax[1], uy = dir.z * ax[0] - dir.x * ax[2], uz = dir.x * ax[1] - dir.y * ax[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = dir.y * uz - dir.z * uy, vy = dir.z * ux - dir.x * uz, vz = dir.x * uy - dir.y * ux;
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  dir.x += ux * ca + vx * sa; dir.y += uy * ca + vy * sa; dir.z += uz * ca + vz * sa;
  return dir.normalize();
}
