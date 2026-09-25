// 角色基类：移动物理 + 武器状态机（玩家与机器人共用）
import * as THREE from 'three';
import { WEAPONS, WeaponState, currentSpread, recoilKick } from './weapons.js';
import { Soldier } from './character.js';

export const STAND_H = 1.8, CROUCH_H = 1.15, EYE_STAND = 1.62, EYE_CROUCH = 1.05;
const GRAV = 19, JUMP_V = 6.6, RUN = 5.7;

export class Actor {
  constructor(game, { id, name, team, isPlayer = false }) {
    this.game = game; this.id = id; this.name = name; this.team = team; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.radius = 0.36; this.height = STAND_H; this.stepHeight = 0.42;
    this.onGround = false; this.crouch = false; this.eyeH = EYE_STAND;
    this.yaw = 0; this.pitch = 0; this.punchP = 0; this.punchY = 0; this.aimPunch = 0;
    this.hp = 100; this.armor = 100; this.alive = false; this.deadT = 0; this.respawnT = 0; this.protectT = 0;
    this.inv = []; this.slot = 0; this.lastSlot = 1; this.readyAt = 0;
    this.stats = { k: 0, d: 0, hs: 0, shots: 0, hits: 0 };
    this.streak = 0; this.lastKillT = -99; this.multi = 0;
    this.radarT = 0; this.ping = 20 + ((Math.random() * 40) | 0);
    this.primary = 'ak47';
    this.soldier = new Soldier(team);
    game.renderer.scene.add(this.soldier.root);
    this.stepDist = 0; this.scoped = 0; this.scopeReady = false; this.scopeT = 0;
    this.lastHurt = -99; this.lastAttacker = null;
    this.walk = false;
    this.pendingThrow = 0;
  }
  get weapon() { return this.inv[this.slot]; }
  eye(out) { return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
  forward(out) {
    const p = this.pitch + this.punchP, y = this.yaw + this.punchY;
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }
  giveLoadout(primary) {
    this.primary = primary || this.primary;
    this.inv = [new WeaponState(this.primary), new WeaponState('deagle'), new WeaponState('knife'), new WeaponState('he')];
    for (const w of this.inv) w.patternSeed = Math.random() * 6;
    this.slot = 0; this.lastSlot = 1;
    this.readyAt = this.game.time + 0.3;
    this.soldier.setWeapon(this.primary);
  }
  spawn(sp) {
    this.pos.set(sp.x, 0.02, sp.z); this.vel.set(0, 0, 0);
    this.yaw = sp.yaw; this.pitch = 0; this.punchP = this.punchY = 0;
    this.hp = 100; this.armor = 100; this.alive = true; this.deadT = 0;
    this.crouch = false; this.height = STAND_H; this.eyeH = EYE_STAND;
    this.protectT = 3; this.onGround = true;
    this.giveLoadout(this.nextPrimary || this.primary);
    this.soldier.reset();
    this.soldier.root.position.copy(this.pos);
    this.soldier.root.visible = !this.isPlayer;
    this.scoped = 0; this.scopeReady = false;
    this.streak = 0;
  }
  // wish: 世界坐标系下的期望移动方向（长度 0..1）
  move(dt, wishX, wishZ, jump, crouch, walk) {
    const g = this.game;
    const w = this.weapon;
    const spMul = w ? w.def.speed : 1;
    // 下蹲 / 起身
    if (crouch && !this.crouch) {
      this.crouch = true; this.height = CROUCH_H;
      if (!this.onGround) this.pos.y += STAND_H - CROUCH_H - 0.1; // 空中收腿（蹲跳）
    } else if (!crouch && this.crouch) {
      if (this.onGround) {
        if (!g.world.blocked(this.pos.x, this.pos.y + 0.05, this.pos.z, this.radius * 0.95, STAND_H - 0.05)) { this.crouch = false; this.height = STAND_H; }
      } else {
        const drop = STAND_H - CROUCH_H - 0.1;
        if (!g.world.blocked(this.pos.x, this.pos.y - drop, this.pos.z, this.radius * 0.95, STAND_H)) { this.crouch = false; this.height = STAND_H; this.pos.y -= drop; }
      }
    }
    this.eyeH += ((this.crouch ? EYE_CROUCH : EYE_STAND) - this.eyeH) * Math.min(1, dt * 14);
    const max = RUN * spMul * (this.crouch ? 0.42 : walk ? 0.5 : 1) * (this.scoped ? 0.55 : 1);
    const wl = Math.hypot(wishX, wishZ);
    const wx = wl > 0 ? wishX / wl : 0, wz = wl > 0 ? wishZ / wl : 0;
    const wishSpeed = max * Math.min(1, wl);
    const v = this.vel;
    if (this.onGround) {
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0) {
        const drop = Math.max(sp, 1.5) * 9 * dt;
        const ns = Math.max(0, sp - drop) / sp;
        v.x *= ns; v.z *= ns;
      }
      const cur = v.x * wx + v.z * wz, add = wishSpeed - cur;
      if (add > 0) { const acc = Math.min(11 * dt * wishSpeed, add); v.x += acc * wx; v.z += acc * wz; }
      if (jump && this.jumpCD <= 0) {
        v.y = JUMP_V; this.onGround = false; this.jumpCD = 0.35;
        g.onJump(this);
      }
    } else {
      const ws = Math.min(wishSpeed, 1.2);
      const cur = v.x * wx + v.z * wz, add = ws - cur;
      if (add > 0) { const acc = Math.min(12 * dt * ws, add); v.x += acc * wx; v.z += acc * wz; }
    }
    this.jumpCD = (this.jumpCD || 0) - dt;
    v.y -= GRAV * dt;
    const wasGround = this.onGround;
    g.world.move(this, dt);
    // 角色之间的实体碰撞（只推开自己）
    for (const o of g.actors) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz, R = this.radius + o.radius - 0.05;
      if (d2 < R * R && d2 > 1e-6 && Math.abs(this.pos.y - o.pos.y) < 1.6) {
        const d = Math.sqrt(d2), push = (R - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        if (!g.world.blocked(this.pos.x + nx * push, this.pos.y + 0.05, this.pos.z + nz * push, this.radius * 0.9, this.height - 0.1)) {
          this.pos.x += nx * push; this.pos.z += nz * push;
        }
      }
    }
    if (this.landed && this.landSpeed > 3) g.onLand(this, this.landSpeed);
    // 脚步
    const hs = Math.hypot(v.x, v.z);
    this.speed = hs;
    if (this.onGround && hs > 2.6 && !walk && !this.crouch) {
      this.stepDist += hs * dt;
      if (this.stepDist > 2.3) { this.stepDist = 0; g.onFootstep(this); }
    }
    void wasGround;
    // 防卡死：掉出世界
    if (this.pos.y < -3) { this.pos.y = 0.1; this.vel.set(0, 0, 0); }
  }
  // 武器逻辑。inp: {fire, firePressed, alt, altPressed, reload, sw}
  weaponUpdate(dt, inp) {
    const g = this.game, now = g.time;
    // 切枪
    if (inp.sw !== undefined && inp.sw !== null && inp.sw !== this.slot && this.inv[inp.sw]) {
      const tgt = this.inv[inp.sw];
      if (!(tgt.def.type === 'grenade' && tgt.mag <= 0)) {
        this.weapon.reloadUntil = 0;
        this.lastSlot = this.slot; this.slot = inp.sw;
        this.readyAt = now + tgt.def.draw;
        this.scoped = 0; this.scopeReady = false;
        this.soldier.setWeapon(tgt.id);
        g.onSwitch(this);
      }
    }
    const w = this.weapon, d = w.def;
    // 散布恢复
    if (d.spread) {
      if (now - w.lastShot > 60 / d.rpm * 1.2) w.spreadAcc *= Math.exp(-d.spread.recover * dt);
      if (now - w.lastShot > 0.28) w.shotsFired = 0;
    }
    // 后坐恢复
    if (d.recoil && now - w.lastShot > 60 / d.rpm + 0.05) {
      const k = Math.exp(-d.recoil.recover * dt);
      this.punchP *= k; this.punchY *= k;
    }
    this.aimPunch *= Math.exp(-dt * 10);
    // 换弹完成
    if (w.reloading && now >= w.reloadUntil) { w.finishReload(); g.onReloadDone(this); }
    // 狙击镜
    if (d.type === 'sniper') {
      if (inp.altPressed && now >= this.readyAt && !w.reloading && now >= w.boltUntil) {
        this.scoped = (this.scoped + 1) % 3; this.scopeT = now; this.scopeReady = false;
        g.onScope(this);
      }
      if (this.scoped && now - this.scopeT > 0.18) this.scopeReady = true;
      if (this.reScope && now >= w.boltUntil && !w.reloading) { this.scoped = this.reScope; this.reScope = 0; this.scopeT = now; this.scopeReady = false; g.onScope(this); }
    }
    if (now < this.readyAt) return;
    // 换弹
    if (inp.reload && w.canReload()) this.startReload();
    if (w.reloading) return;
    if (d.type === 'melee') {
      if (now >= w.nextFire) {
        if (inp.fire) { w.nextFire = now + d.rateLight; g.melee(this, false); }
        else if (inp.alt) { w.nextFire = now + d.rateHeavy; g.melee(this, true); }
      }
      return;
    }
    if (d.type === 'grenade') {
      if (this.pendingThrow > 0) {
        this.pendingThrow -= dt;
        if (this.pendingThrow <= 0) {
          g.throwGrenade(this);
          w.mag = 0;
          this.readyAt = now + 0.4;
          this.autoSwitchAt = now + 0.45;
        }
        return;
      }
      if (this.autoSwitchAt && now >= this.autoSwitchAt) {
        this.autoSwitchAt = 0;
        const back = this.inv[this.lastSlot] && this.lastSlot !== 3 ? this.lastSlot : 0;
        this.weaponUpdate(0, { sw: back });
        return;
      }
      if (inp.firePressed && w.mag > 0) { this.pendingThrow = 0.52; g.onGrenadeStart(this); }
      return;
    }
    // 枪械
    const trigger = d.auto ? inp.fire : inp.firePressed;
    if (!trigger || now < w.nextFire || now < w.boltUntil) return;
    if (w.mag <= 0) {
      if (inp.firePressed) g.onDryFire(this);
      if (w.canReload()) this.startReload();
      return;
    }
    w.mag--; w.lastShot = now; w.nextFire = now + 60 / d.rpm;
    this.stats.shots++;
    const spread = currentSpread(w, { speed: this.speed || 0, onGround: this.onGround, crouch: this.crouch, scoped: this.scoped > 0, scopeReady: this.scopeReady });
    g.fireWeapon(this, w, spread);
    // 后坐
    const [up, side] = recoilKick(w, Math.random);
    const ctl = this.recoilControl ?? 1;
    this.punchP = Math.min(d.recoil.upMax, this.punchP + up * ctl);
    this.punchY += side * ctl;
    w.shotsFired++;
    if (d.spread) w.spreadAcc = Math.min(d.spread.max, w.spreadAcc + d.spread.perShot);
    this.protectT = 0;
    if (d.type === 'sniper') {
      w.boltUntil = now + d.bolt;
      if (this.scoped) { this.reScope = this.scoped; this.scoped = 0; this.scopeReady = false; }
    }
    if (w.mag === 0 && w.canReload() && !this.isPlayer) this.startReload();
  }
  startReload() {
    const w = this.weapon;
    if (!w.canReload()) return;
    w.reloadUntil = this.game.time + w.def.reload;
    this.scoped = 0; this.scopeReady = false; this.reScope = 0;
    this.game.onReloadStart(this, w.mag === 0);
  }
}
