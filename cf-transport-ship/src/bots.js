// 机器人 AI
import * as THREE from 'three';
import { Actor } from './actor.js';

export const DIFF = {
  easy: { react: [0.55, 0.9], aimErr: 0.075, turn: 3.2, track: 2.2, headP: 0.07, ctrl: 1.0, comp: 0.55, strafe: 0.35, see: 50, fov: 1.6, bunny: 0 },
  normal: { react: [0.38, 0.62], aimErr: 0.058, turn: 5.2, track: 3.2, headP: 0.12, ctrl: 0.85, comp: 0.8, strafe: 0.65, see: 62, fov: 1.85, bunny: 0.05 },
  hard: { react: [0.2, 0.34], aimErr: 0.032, turn: 8.5, track: 5.5, headP: 0.3, ctrl: 0.6, comp: 0.9, strafe: 0.85, see: 75, fov: 2.05, bunny: 0.12 },
  hell: { react: [0.12, 0.2], aimErr: 0.02, turn: 13, track: 8.5, headP: 0.5, ctrl: 0.42, comp: 0.95, strafe: 1, see: 95, fov: 2.3, bunny: 0.2 },
};

export const BOT_NAMES = [
  '丶夜猫子', 'CF灬战神', '狙神小白', '枪王之王', '火麒麟丶', '无敌小旋风', '天使の翼', '爆头专业户', '穿越者丨龙', '雷神M4',
  '灬冷血杀手', '沙鹰一哥', '老六本六', '我是菜鸟', '运输船之王', 'Sniper丶K', '二楼架枪', '管道守门员', '一枪一个', '闪电侠丶',
  '黑名单丶影', '保卫者老王', '夜袭者', '零度丶', '狂暴战神', '别打我头', '满血复活', '疾风步',
];

// 各阵营的架点（潜伏者坐标，保卫者取反）
const HOLDS = [[-20.5, -7.2, 0.2], [-24.6, 5.8, -0.15], [-16.4, 1.3, 0.1], [-9.8, -6.8, 0.25], [-26.2, -6.5, 0.05]];
const LANES = [-6.8, -0.4, 6.8];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class Bot extends Actor {
  constructor(game, o) {
    super(game, o);
    this.diff = DIFF[o.diff] || DIFF.normal;
    this.recoilControl = this.diff.ctrl;
    this.path = null; this.pi = 0; this.goal = null;
    this.target = null; this.visible = false; this.lastSeen = null; this.lastSeenT = -99; this.reactUntil = 0;
    this.errY = 0; this.errP = 0; this.aimHead = false;
    this.strafeDir = 1; this.strafeT = 0; this.burst = 0; this.burstPauseUntil = 0;
    this.thinkT = Math.random() * 0.2; this.stuckT = 0; this.stuckN = 0; this.lastCheck = new THREE.Vector3();
    this.role = 'rush'; this.holdT = 0; this.crouchUntil = 0; this.nadeT = 20 + Math.random() * 20;
    this.heard = null; this.heardT = -99;
    this.fireHeld = false;
    this.wantJump = false;
    this.side = this.team === 'BL' ? 1 : -1; // 潜伏者坐标系转换
  }
  onSpawn() {
    this.path = null; this.goal = null; this.target = null; this.visible = false; this.lastSeen = null;
    const r = Math.random();
    this.role = this.primary === 'awm' ? 'hold' : r < 0.25 ? 'flank' : 'rush';
    this.lane = LANES[(Math.random() * 3) | 0];
    this.stage = 0;
    this.pickGoal();
  }
  L(x, z) { return [x * this.side, z * this.side]; } // 己方坐标 -> 世界
  pickGoal() {
    const g = this.game, nav = g.nav, rnd = Math.random;
    let gx, gz;
    if (this.role === 'hold') {
      const h = HOLDS[(rnd() * HOLDS.length) | 0];
      [gx, gz] = this.L(h[0], h[1]);
      this.holdYaw = this.side > 0 ? -Math.PI / 2 + h[2] : Math.PI / 2 + h[2];
    } else if (this.role === 'flank' && this.stage < 3) {
      const pts = [[-31.5, 10.5], [-8, 10.6], [8.0, 7.8]];
      [gx, gz] = this.L(...pts[this.stage]);
    } else if (this.stage < 1) {
      [gx, gz] = this.L(4 + rnd() * 18, this.lane + (rnd() - 0.5) * 2);
    } else {
      const p = nav.randomFree(rnd, -26, -8.8, 26, 8.8);
      [gx, gz] = p || this.L(10, 0);
    }
    this.goal = [gx, gz];
    this.path = nav.findPath(this.pos.x, this.pos.z, gx, gz);
    this.pi = 1;
  }
  hear(pos, loud) {
    if (!this.alive || this.visible) return;
    this.heard = pos.clone(); this.heardT = this.game.time; this.heardLoud = loud;
  }
  onDamaged(att) {
    if (!att || !this.alive) return;
    if (!this.visible || this.target !== att) {
      this.lastSeen = att.pos.clone(); this.lastSeenT = this.game.time;
      if (!this.visible) {
        this.target = att;
        // 朝攻击者方向扭头（带误差）
        const dx = att.pos.x - this.pos.x, dz = att.pos.z - this.pos.z;
        this.lookYaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.5;
      }
    }
  }
  canSee(t) {
    const g = this.game;
    const e = this.eye(_v);
    const dist = e.distanceTo(t.pos);
    if (dist > this.diff.see) return false;
    // 视野角
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const ang = Math.abs(wrapPi(Math.atan2(-dx, -dz) - this.yaw));
    if (ang > this.diff.fov / 2 && dist > 6) return false;
    for (const pt of [t.soldier.headWorld(_v2), t.soldier.chestWorld(_v3)]) {
      const d = pt.clone().sub(e); const L = d.length(); d.divideScalar(L);
      if (!g.world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, L - 0.1, 'sight')) return true;
    }
    return false;
  }
  think() {
    const g = this.game, now = g.time;
    // 感知
    let best = null, bestD = 1e9;
    for (const a of g.actors) {
      if (!a.alive || a.team === this.team) continue;
      const d = a.pos.distanceTo(this.pos);
      if (d > bestD) continue;
      if (this.canSee(a)) { best = a; bestD = d; }
    }
    if (best) {
      if (!this.visible || this.target !== best) {
        const [r0, r1] = this.diff.react;
        const surprise = this.target === best && now - this.lastSeenT < 1.5 ? 0.4 : 1;
        this.reactUntil = now + (r0 + Math.random() * (r1 - r0)) * surprise;
        const k = this.diff.aimErr * (0.8 + bestD / 28);
        const a = Math.random() * Math.PI * 2;
        this.errY = Math.cos(a) * k * 1.3; this.errP = Math.sin(a) * k * 0.8 - k * 0.1;
        this.aimHead = Math.random() < this.diff.headP;
        this.burst = 0;
      }
      this.target = best; this.visible = true; this.lastSeen = best.pos.clone(); this.lastSeenT = now;
      this.path = null;
    } else {
      this.visible = false;
      if (this.target && (!this.target.alive || now - this.lastSeenT > 5)) this.target = null;
    }
    // 移动决策
    if (!this.visible) {
      if (this.lastSeen && now - this.lastSeenT < 5 && this.role !== 'hold') {
        if (!this.path || this.huntFor !== this.lastSeenT) {
          this.path = g.nav.findPath(this.pos.x, this.pos.z, this.lastSeen.x, this.lastSeen.z); this.pi = 1; this.huntFor = this.lastSeenT;
        }
      } else if (this.heard && now - this.heardT < 3 && this.role !== 'hold' && Math.random() < 0.5) {
        this.path = g.nav.findPath(this.pos.x, this.pos.z, this.heard.x, this.heard.z); this.pi = 1;
        this.lookYaw = Math.atan2(-(this.heard.x - this.pos.x), -(this.heard.z - this.pos.z));
        this.heard = null;
      } else if (!this.path || this.pi >= this.path.length) {
        if (this.role === 'hold' && this.goal && this.pos.distanceTo(_v.set(this.goal[0], this.pos.y, this.goal[1])) < 1.2) {
          this.holdT += 0.15;
          if (this.holdT > 25 + Math.random() * 20) { this.holdT = 0; this.pickGoal(); }
        } else { this.stage++; this.pickGoal(); }
      }
      // 换弹
      const w = this.weapon;
      if (w.def.mag > 1 && w.mag < w.def.mag * 0.5 && w.canReload() && now - this.lastSeenT > 1.2) this.startReload();
      // 手雷
      this.nadeT -= 0.15;
      if (this.nadeT <= 0 && this.lastSeen && now - this.lastSeenT < 3 && this.inv[3].mag > 0) {
        const d = this.lastSeen.distanceTo(this.pos);
        if (d > 7 && d < 24 && Math.random() < 0.35) { this.nadePlan = this.lastSeen.clone(); this.nadeT = 25 + Math.random() * 25; }
      }
    } else {
      // 狙击：开镜
      const w = this.weapon;
      if (w.def.type === 'sniper' && !this.scoped && bestD > 7 && now >= w.boltUntil) this.wantScope = true;
      if (Math.random() < 0.12 * this.diff.strafe) this.crouchUntil = now + 0.6 + Math.random() * 1.2;
    }
    // 卡住检测
    this.stuckT += 0.15;
    if (this.stuckT > 1.0) {
      const moved = this.lastCheck.distanceTo(this.pos);
      if (this.path && this.pi < this.path.length && moved < 0.35 && !this.visible) {
        this.stuckN++; this.wantJump = true;
        if (this.stuckN > 2) { this.stuckN = 0; this.stage++; this.pickGoal(); }
      } else this.stuckN = 0;
      this.lastCheck.copy(this.pos); this.stuckT = 0;
    }
  }
  update(dt) {
    const g = this.game, now = g.time;
    if (!this.alive) return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.13 + Math.random() * 0.06; this.think(); }
    const D = this.diff;
    let wishX = 0, wishZ = 0, fire = false, firePressed = false, alt = false, crouch = now < this.crouchUntil, walk = false;
    let sw = null;
    // 手雷投掷流程
    if (this.nadePlan) {
      if (this.slot !== 3) sw = 3;
      else if (now >= this.readyAt && !this.pendingThrow) {
        const d = this.nadePlan.distanceTo(this.pos);
        this.lookYaw = Math.atan2(-(this.nadePlan.x - this.pos.x), -(this.nadePlan.z - this.pos.z));
        this.lookPitch = 0.25 + d * 0.012;
        firePressed = true; this.nadePlan = null;
      }
    } else if (this.slot === 3 && this.inv[3].mag <= 0 && !this.pendingThrow && !this.autoSwitchAt) sw = 0;
    // 瞄准
    let dYaw = this.yaw, dPitch = this.pitch;
    const tgt = this.target;
    if (tgt && tgt.alive && this.visible) {
      const e = this.eye(_v);
      const p = this.aimHead ? tgt.soldier.headWorld(_v2) : tgt.soldier.chestWorld(_v2);
      p.addScaledVector(tgt.vel, 0.08);
      const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, hd = Math.hypot(dx, dz);
      const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, hd);
      const k = Math.exp(-D.track * dt);
      this.errY *= k; this.errP *= k;
      const wob = 0.004 * (1 + tgt.speed / 4);
      dYaw = trueYaw + this.errY + Math.sin(now * 3.1 + this.id) * wob;
      dPitch = truePitch + this.errP + Math.cos(now * 2.7 + this.id) * wob * 0.6 - this.punchP * D.comp;
      this.lookYaw = undefined; this.lookPitch = undefined;
      // 开火判断
      const aimErr = Math.hypot(wrapPi(this.yaw - trueYaw), this.pitch - truePitch);
      const tol = Math.atan2(0.32, hd) * 1.4 + 0.01;
      const w = this.weapon, d = w.def;
      if (now >= this.reactUntil && aimErr < tol && now >= this.readyAt && !this.nadePlan) {
        if (d.type === 'sniper') { if (this.scoped && this.scopeReady && aimErr < tol * 0.6) firePressed = true; }
        else if (d.type === 'pistol') { firePressed = Math.random() < dt * 5; }
        else if (now >= this.burstPauseUntil) {
          fire = true;
          if (hd > 14) {
            this.burst++;
            if (this.burst > 3 + Math.random() * 4) { this.burst = 0; this.burstPauseUntil = now + 0.18 + Math.random() * 0.3 * (hd / 30); }
          }
        }
      }
      if (this.wantScope) { alt = true; this.wantScope = false; }
      // 横移
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.25 + Math.random() * 0.7; this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.2) this.strafeDir = 0; }
      const moveK = d.type === 'sniper' ? 0 : D.strafe;
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      wishX = rx * this.strafeDir * moveK; wishZ = rz * this.strafeDir * moveK;
      if (hd > 22 && d.type !== 'sniper' && this.role !== 'hold') { wishX += -Math.sin(this.yaw) * 0.5; wishZ += -Math.cos(this.yaw) * 0.5; }
      if (Math.random() < D.bunny * dt && this.onGround && d.type !== 'sniper') this.wantJump = true;
    } else {
      if (this.scoped && !this.visible && now - this.lastSeenT > 2) alt = true; // 收镜
      // 沿路径行走
      if (this.path && this.pi < this.path.length) {
        const wp = this.path[this.pi];
        const dx = wp[0] - this.pos.x, dz = wp[1] - this.pos.z, dd = Math.hypot(dx, dz);
        if (dd < 0.55) this.pi++;
        else { wishX = dx / dd; wishZ = dz / dd; }
        if (this.lookYaw === undefined || now - this.heardT > 1.5) dYaw = Math.atan2(-dx, -dz);
        dPitch = 0;
        walk = this.role === 'flank' && this.stage === 1;
      } else if (this.role === 'hold' && this.holdYaw !== undefined) {
        dYaw = this.holdYaw + Math.sin(now * 0.4 + this.id) * 0.35; dPitch = -0.02;
        crouch = crouch || Math.sin(now * 0.3 + this.id) > 0.3;
      }
      if (this.lookYaw !== undefined) { dYaw = this.lookYaw; if (this.lookPitch !== undefined) dPitch = this.lookPitch; }
    }
    // 队友分离
    for (const a of g.actors) {
      if (a === this || !a.alive) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.2 && d2 > 1e-4) { const d = Math.sqrt(d2); wishX += dx / d * 0.6; wishZ += dz / d * 0.6; }
    }
    // 转向（限速）
    const turn = D.turn * dt * (this.visible ? 1 : 0.7);
    const ey = wrapPi(dYaw - this.yaw);
    this.yaw = wrapPi(this.yaw + THREE.MathUtils.clamp(ey, -turn, turn));
    this.pitch += THREE.MathUtils.clamp(dPitch - this.pitch, -turn * 0.6, turn * 0.6);
    // 移动 & 武器
    this.move(dt, wishX, wishZ, this.wantJump, crouch, walk);
    this.wantJump = false;
    const w = this.weapon;
    this.weaponUpdate(dt, { fire, firePressed: firePressed || (fire && !this.fireHeld), alt, altPressed: alt, reload: false, sw });
    this.fireHeld = fire;
    void w;
  }
}
