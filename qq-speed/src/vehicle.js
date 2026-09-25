import { clamp, wrapAngle, damp } from './util.js';

// 手感参数（米/秒）。显示时速 = 速度 × 3.6
export const TUNE = {
  vmax: 55, // ~198 km/h
  vmaxNitro: 76, // ~274 km/h
  accel: 24,
  nitroAccel: 40,
  brake: 45,
  reverseMax: 12,
  roll: 2.2,
  turnRate: 1.9,
  grip: 12,
  driftMinSpeed: 13,
  driftYaw: 1.5,
  driftYawAlign: 0.85,
  driftGrip: 2.0,
  driftGripRelease: 5.2,
  maxDriftAngle: 1.15,
  smallWindow: 0.5,
  gaugeRate: 0.36,
  nitroTime: 2.8,
  gravity: 30,
};

export class PlayerCar {
  constructor(track, model, name) {
    this.track = track;
    this.model = model;
    this.name = name;
    this.isPlayer = true;
    this.events = [];
    this.proj = {};
    this.reset(0, 0);
  }

  reset(d, lat) {
    const s = this.track.sample(d, {});
    this.x = s.x + s.rx * lat;
    this.z = s.z + s.rz * lat;
    this.y = s.y + 0.05;
    this.h = s.hd;
    this.m = s.hd;
    this.s = 0;
    this.vy = 0;
    this.vyGround = 0;
    this.airborne = false;
    this.airTime = 0;
    this.steer = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftAngle = 0;
    this.gauge = 0;
    this.nitroCount = 0;
    this.nitroTime = 0;
    this.smallBoost = 0;
    this.smallBoostPower = 0;
    this.smallWindow = 0;
    this.windowKind = '';
    this.padTime = 0;
    this.startBoost = 0;
    this.spin = 0;
    this.shield = 0;
    this.slowTime = 0;
    this.magnet = 0;
    this.magnetTarget = null;
    this.hint = -1;
    this.impact = 0;
    this.wrongWay = 0;
    this.pitchVis = 0;
    this.rollVis = 0;
    this.throttle = 0;
    this.track.project(this.x, this.y, this.z, -1, this.proj);
    this.hint = this.proj.i;
    this.d = this.proj.d;
    this.lat = this.proj.lat;
  }

  emit(type, data) { this.events.push({ type, data }); }

  get speedKmh() { return Math.abs(this.s) * 3.6; }
  get boosting() { return this.nitroTime > 0 || this.smallBoost > 0 || this.padTime > 0 || this.startBoost > 0; }

  triggerNitro(fromItem = false) {
    if (!fromItem) {
      if (this.nitroCount <= 0) return false;
      this.nitroCount--;
    }
    const wasSmall = this.smallBoost > 0.35;
    this.nitroTime = Math.min(4.5, Math.max(0, this.nitroTime) + TUNE.nitroTime);
    this.s = Math.max(this.s, 20) + 4;
    this.emit('nitro', { double: wasSmall });
    if (wasSmall) this.emit('double', {});
    return true;
  }

  endDrift(clean = true) {
    if (!this.drifting) return;
    this.drifting = false;
    if (clean && this.driftTime > 0.22) {
      this.smallWindow = TUNE.smallWindow;
      this.windowKind = 'drift';
    }
    this.emit('driftEnd', { time: this.driftTime });
  }

  update(dt, inp, active, itemMode) {
    const T = TUNE;
    const tr = this.track;
    if (!active) inp = NO_INPUT;
    const spinning = this.spin > 0;
    if (spinning) {
      this.spin -= dt;
      inp = NO_INPUT;
    }

    // 平滑转向
    const steerT = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    this.steer = damp(this.steer, steerT, 12, dt);

    // 各种加速状态
    let vmax = T.vmax, acc = T.accel;
    if (this.nitroTime > 0) { vmax = T.vmaxNitro; acc = T.nitroAccel; this.nitroTime -= dt; }
    if (this.smallBoost > 0) { vmax += this.smallBoostPower; acc += 14; this.smallBoost -= dt; }
    if (this.padTime > 0) { vmax += 12; acc += 20; this.padTime -= dt; }
    if (this.startBoost > 0) { vmax += 10; acc += 26; this.startBoost -= dt; }
    if (this.magnet > 0) { vmax += 10; acc += 12; this.magnet -= dt; }
    vmax = Math.min(vmax, 86);
    if (this.slowTime > 0) { vmax *= 0.55; this.slowTime -= dt; }
    if (this.shield > 0) this.shield -= dt;
    this.vmaxNow = vmax;

    // 小喷 / 落地喷窗口
    if (this.smallWindow > 0) {
      this.smallWindow -= dt;
      if (inp.upPressed || inp.wPressed) {
        const elapsed = (this.windowKind === 'drift' ? T.smallWindow : 0.45) - this.smallWindow;
        const perfect = elapsed < 0.2;
        const dbl = this.nitroTime > 0;
        this.smallBoost = perfect ? 1.0 : 0.75;
        this.smallBoostPower = (perfect ? 11 : 8) + (dbl ? 5 : 0);
        this.s += perfect ? 5.5 : 4;
        if (dbl) this.nitroTime += 0.3;
        this.emit(this.windowKind === 'land' ? 'landBoost' : 'smallBoost', { perfect, double: dbl });
        if (dbl) this.emit('double', {});
        this.smallWindow = 0;
      }
    }
    if (inp.nitroPressed && !itemMode) this.triggerNitro();

    const onGround = !this.airborne;
    // 纵向
    this.throttle = inp.up ? 1 : inp.down ? -1 : 0;
    if (onGround) {
      if (inp.up) {
        if (this.s < 0) this.s += T.brake * dt;
        else if (this.s < vmax) this.s += acc * (1 - Math.pow(this.s / vmax, 2) * 0.85) * dt;
      } else if (inp.down) {
        if (this.s > 0.5) this.s -= T.brake * dt;
        else this.s = Math.max(-T.reverseMax, this.s - 14 * dt);
      } else {
        const dec = (T.roll + Math.abs(this.s) * 0.06) * dt;
        this.s = Math.abs(this.s) <= dec ? 0 : this.s - Math.sign(this.s) * dec;
      }
      if (this.s > vmax) this.s -= (this.s - vmax) * 1.1 * dt;
      // 坡度影响
      this.s -= tr.slope[this.hint] * Math.cos(this.h - tr.hd[this.hint]) * 6 * dt;
    }

    // 进入漂移：Shift + 方向
    if (!this.drifting && inp.shift && steerT !== 0 && this.s > T.driftMinSpeed && onGround && !spinning) {
      this.drifting = true;
      this.driftDir = steerT;
      this.driftTime = 0;
      this.releaseTime = 0;
      this.smallWindow = 0;
      this.h += this.driftDir * 0.07;
      this.emit('driftStart', {});
    }

    if (this.drifting) {
      const align = steerT * this.driftDir;
      const held = inp.shift;
      if (held) this.releaseTime = 0;
      else this.releaseTime += dt;
      const yaw = held ? T.driftYaw + T.driftYawAlign * align : (0.45 + 0.9 * align) * Math.exp(-2.2 * this.releaseTime);
      this.h += this.driftDir * yaw * clamp(this.s / 26, 0.35, 1) * dt * (onGround ? 1 : 0.4);
      const k = held ? T.driftGrip : T.driftGripRelease;
      this.m += wrapAngle(this.h - this.m) * (1 - Math.exp(-k * dt));
      let a = wrapAngle(this.h - this.m);
      if (Math.abs(a) > T.maxDriftAngle) {
        this.m = this.h - Math.sign(a) * T.maxDriftAngle;
        a = Math.sign(a) * T.maxDriftAngle;
      }
      this.driftAngle = a;
      const sa = Math.abs(Math.sin(a));
      if (onGround) this.s -= (2.5 + 11 * sa) * dt;
      if (!itemMode && onGround) {
        this.gauge += dt * T.gaugeRate * (0.3 + sa * 1.7) * clamp(this.s / 35, 0.3, 1.1);
        while (this.gauge >= 1) {
          if (this.nitroCount < 2) {
            this.nitroCount++;
            this.gauge -= 1;
            this.emit('gaugeFull', {});
          } else {
            this.gauge = 1;
            break;
          }
        }
      }
      this.driftTime += dt;
      if ((!held && (Math.abs(a) < 0.1 || (align < 0 && Math.abs(a) < 0.26))) || this.s < 7) this.endDrift(this.s >= 7);
    } else {
      this.driftAngle = damp(this.driftAngle, 0, 10, dt);
      const dir = this.s >= 0 ? 1 : -1;
      const sp = Math.abs(this.s);
      const turn = T.turnRate * clamp(sp / 9, 0, 1) * (1 - 0.55 * clamp(sp / T.vmax, 0, 1.3));
      this.h += this.steer * turn * dt * dir * (onGround ? 1 : 0.35);
      if (this.s >= 0) this.m += wrapAngle(this.h - this.m) * (1 - Math.exp(-T.grip * dt));
      else this.m = this.h;
    }
    if (spinning) this.h += 9 * dt;

    // 位置积分
    const dirSign = this.s >= 0 ? 1 : -1;
    const mv = this.s >= 0 ? this.m : this.h;
    let vx = Math.sin(mv) * Math.abs(this.s) * dirSign;
    let vz = Math.cos(mv) * Math.abs(this.s) * dirSign;
    this.x += vx * dt;
    this.z += vz * dt;

    const p = tr.project(this.x, this.y, this.z, this.hint, this.proj);
    this.hint = p.i;
    this.d = p.d;

    // 护栏碰撞
    const lim = tr.halfW - 1.1;
    this.impact = 0;
    if (Math.abs(p.lat) > lim) {
      const sg = Math.sign(p.lat);
      const nx = p.rx * sg, nz = p.rz * sg;
      const over = Math.abs(p.lat) - lim;
      this.x -= nx * over;
      this.z -= nz * over;
      const vn = vx * nx + vz * nz;
      if (vn > 0) {
        const sp = Math.max(1, Math.hypot(vx, vz));
        const impact = vn / sp;
        vx -= nx * vn * 1.25;
        vz -= nz * vn * 1.25;
        const keep = 1 - 0.45 * impact;
        vx *= keep;
        vz *= keep;
        const ns = Math.hypot(vx, vz);
        if (this.s >= 0) {
          this.s = ns;
          if (ns > 0.5) this.m = Math.atan2(vx, vz);
          // 车头顺着墙摆正
          const th = Math.abs(wrapAngle(this.h - p.hd)) < Math.PI / 2 ? p.hd : p.hd + Math.PI;
          this.h += wrapAngle(th - this.h) * Math.min(1, 0.6 * impact + 0.05);
        } else this.s = -ns;
        this.impact = impact * sp;
        if (impact > 0.3 && this.drifting) this.endDrift(false);
        if (impact * sp > 6) this.emit('crash', { power: impact * sp, x: this.x - nx * 0.9, z: this.z - nz * 0.9 });
        else if (sp > 8) this.emit('scrape', { x: this.x + nx * 1.0, z: this.z + nz * 1.0 });
      }
      p.lat = sg * lim;
    }
    this.lat = p.lat;

    // 垂直：贴地 / 腾空 / 落地
    const groundY = p.y + p.lat * Math.sin(p.bank);
    if (this.airborne) {
      this.vy -= T.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= groundY) {
        this.y = groundY;
        this.airborne = false;
        const hard = this.vy;
        this.vy = 0;
        this.vyGround = 0;
        this.emit('land', { air: this.airTime, v: hard });
        if (this.airTime > 0.3) {
          this.smallWindow = 0.45;
          this.windowKind = 'land';
        }
        this.airTime = 0;
      }
    } else {
      // 沿赛道方向的速度分量；竖直向心加速度超过重力即腾空
      const va = this.s * Math.cos(this.m - p.hd);
      if (va > 18 && va * va * -tr.vcurv[p.i] > T.gravity) {
        this.airborne = true;
        this.airTime = 0;
        this.vy = tr.sslope[p.i] * va;
        this.y = groundY + this.vy * dt;
        if (this.drifting) this.endDrift(false);
      } else {
        this.y = groundY;
      }
    }

    // 逆行检测
    const fwdDot = Math.cos(wrapAngle(this.h - p.hd));
    if (fwdDot < -0.35 && this.s > 4) this.wrongWay += dt;
    else this.wrongWay = Math.max(0, this.wrongWay - dt * 2);

    // 加速带
    if (tr.boostPads)
      for (const bp of tr.boostPads) {
        let dd = this.d - (bp.d - bp.len / 2);
        if (dd < 0) dd += tr.length;
        if (dd < bp.len && Math.abs(this.lat - bp.lat) < bp.halfW + 0.6 && !this.airborne) {
          if (this.padTime < 0.6) {
            this.emit('pad', {});
            this.s = Math.min(this.s + 6, 72);
          }
          this.padTime = 1.1;
        }
      }
  }

  // 同步 3D 模型
  syncModel(dt) {
    const mdl = this.model;
    const u = mdl.userData;
    const tr = this.track;
    const i = this.hint;
    mdl.position.set(this.x, this.y, this.z);
    const rel = this.h - tr.hd[i];
    const slopeAlong = tr.slope[i] * Math.cos(rel);
    const bankAlong = tr.bank[i] * Math.cos(rel);
    const pitchT = this.airborne ? clamp(-this.vy * 0.012, -0.3, 0.3) : -Math.atan(slopeAlong);
    this.pitchVis = damp(this.pitchVis, pitchT, 10, dt);
    this.rollVis = damp(this.rollVis, -bankAlong, 10, dt);
    mdl.rotation.set(this.pitchVis, this.h, this.rollVis, 'YXZ');
    // 车身动态：转向侧倾、加减速俯仰
    const sp = Math.abs(this.s);
    const lean = this.drifting ? this.driftDir * 0.07 : this.steer * 0.045 * clamp(sp / 30, 0, 1);
    const pitchDyn = this.throttle > 0 && sp < 30 ? -0.025 : this.throttle < 0 && this.s > 5 ? 0.04 : 0;
    u.root.rotation.z = damp(u.root.rotation.z, lean, 8, dt);
    u.root.rotation.x = damp(u.root.rotation.x, pitchDyn - (this.nitroTime > 0 ? 0.02 : 0), 6, dt);
    for (const w of u.wheels) {
      w.spin.rotation.x += (this.s * dt) / 0.47;
      if (w.front) w.steer.rotation.y = this.drifting ? -this.driftDir * 0.3 : this.steer * 0.38;
    }
    updateFlames(u, this.nitroTime > 0, this.smallBoost > 0 || this.padTime > 0 || this.startBoost > 0);
    u.shield.visible = this.shield > 0;
  }
}

export function updateFlames(u, nitro, small) {
  const on = nitro || small;
  const t = performance.now() * 0.001;
  for (const f of u.flames) {
    f.visible = on;
    if (on) {
      const k = nitro ? 1 : 0.6;
      const fl = 0.85 + Math.sin(t * 60 + f.position.x * 10) * 0.12 + Math.random() * 0.12;
      f.scale.set(k * fl, k * fl, k * (1.1 + Math.random() * 0.5));
    }
  }
  u.flameMatOuter.color.setHex(nitro ? 0x39a8ff : 0xff8a2a).multiplyScalar(2.2);
}

export const NO_INPUT = { up: false, down: false, left: false, right: false, shift: false, upPressed: false, wPressed: false, nitroPressed: false };
