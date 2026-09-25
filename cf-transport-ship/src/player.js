// 玩家：输入、镜头
import * as THREE from 'three';
import { Actor } from './actor.js';

export class Player extends Actor {
  constructor(game, o) {
    super(game, { ...o, isPlayer: true });
    this.keys = new Set();
    this.mouse = { l: false, r: false, lp: false, rp: false, dx: 0, dy: 0, wheel: 0 };
    this.pressed = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.bobT = 0; this.land = 0; this.shakeT = 0;
    this.camRoll = 0;
    this.deathCam = null;
    this.touch = { mx: 0, mz: 0, fire: false, jump: false, crouch: false };
  }
  // 输入监听只绑定一次，始终路由到当前玩家
  bind(canvas) {
    const g = this.game;
    if (g._inputBound) return;
    g._inputBound = true;
    const P = () => (g.playing ? g.player : null);
    window.addEventListener('keydown', (e) => {
      const p = P(); if (!p) return;
      if (['Tab', 'Space', 'KeyB', 'KeyF', 'KeyQ', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      p.keys.add(e.code); p.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => { const p = g.player; if (p) p.keys.delete(e.code); });
    window.addEventListener('blur', () => { const p = g.player; if (p) { p.keys.clear(); p.mouse.l = p.mouse.r = false; } });
    canvas.addEventListener('mousedown', (e) => {
      const p = P(); if (!p) return;
      if (!g.locked && !g.touchMode) { g.lock(); return; }
      if (e.button === 0) { p.mouse.l = true; p.mouse.lp = true; }
      if (e.button === 2) { p.mouse.r = true; p.mouse.rp = true; }
    });
    window.addEventListener('mouseup', (e) => { const p = g.player; if (!p) return; if (e.button === 0) p.mouse.l = false; if (e.button === 2) p.mouse.r = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      const p = P(); if (!p || !g.locked) return;
      // 过滤浏览器偶发的异常大位移
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      p.mouse.dx += e.movementX; p.mouse.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => { const p = P(); if (p && g.locked) p.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  }
  consumePressed(code) { const p = this.pressed.has(code); this.pressed.delete(code); return p; }
  update(dt) {
    const g = this.game, K = this.keys;
    const sens = g.opts.sens * 0.0022;
    let dx = this.mouse.dx, dy = this.mouse.dy;
    this.mouse.dx = this.mouse.dy = 0;
    if (this.touchLook) { dx += this.touchLook.x; dy += this.touchLook.y; this.touchLook.x = this.touchLook.y = 0; }
    this.lookDX = dx; this.lookDY = dy;
    const fovK = this.scoped ? g.renderer.camera.fov / g.opts.fov : 1;
    if (this.alive) {
      this.yaw -= dx * sens * fovK;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens * fovK, -1.5, 1.5);
      // 移动
      let f = 0, s = 0;
      if (K.has('KeyW') || K.has('ArrowUp')) f += 1;
      if (K.has('KeyS') || K.has('ArrowDown')) f -= 1;
      if (K.has('KeyD') || K.has('ArrowRight')) s += 1;
      if (K.has('KeyA') || K.has('ArrowLeft')) s -= 1;
      f += this.touch.mz; s += this.touch.mx;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const wx = -sy * f + cy * s, wz = -cy * f - sy * s;
      const jump = K.has('Space') || this.touch.jump;
      const crouch = K.has('KeyC') || this.touch.crouch;
      this.walk = K.has('ShiftLeft') || K.has('ShiftRight');
      this.move(dt, wx, wz, jump, crouch, this.walk);
      if (this.touch.jump) this.touch.jump = false;
      // 武器
      let sw = null;
      for (let i = 1; i <= 4; i++) if (this.consumePressed('Digit' + i)) sw = i - 1;
      if (this.consumePressed('KeyQ')) sw = this.lastSlot;
      if (this.mouse.wheel) {
        const dir = this.mouse.wheel > 0 ? 1 : -1; this.mouse.wheel = 0;
        let n = this.slot;
        for (let k = 0; k < 4; k++) { n = (n + dir + 4) % 4; if (this.inv[n] && !(this.inv[n].def.type === 'grenade' && this.inv[n].mag <= 0)) break; }
        sw = n;
      }
      if (sw !== null && this.inv[sw] && this.inv[sw].def.type === 'grenade' && this.inv[sw].mag <= 0) { g.hud.toast('没有手雷了', 1.2); sw = null; }
      const lp = this.mouse.lp || this.touch.firePressed, rp = this.mouse.rp;
      this.mouse.lp = this.mouse.rp = false; this.touch.firePressed = false;
      this.weaponUpdate(dt, { fire: this.mouse.l || this.touch.fire, firePressed: lp, alt: this.mouse.r, altPressed: rp, reload: this.consumePressed('KeyR'), sw });
      if (this.consumePressed('KeyF')) g.vm.inspect();
    } else {
      this.pressed.delete('KeyR'); this.mouse.lp = this.mouse.rp = false;
    }
    if (this.consumePressed('KeyB')) g.toggleLoadout();
    this.pressed.clear();
    this.updateCamera(dt);
  }
  updateCamera(dt) {
    const g = this.game, cam = g.renderer.camera;
    if (!this.alive) {
      // 死亡镜头：抬高并看向击杀者
      const dc = this.deathCam;
      if (dc) {
        dc.t += dt;
        const k = Math.min(1, dc.t * 1.2);
        const e = 1 - (1 - k) * (1 - k);
        cam.position.lerpVectors(dc.from, dc.to, e);
        if (dc.killer && dc.killer.alive) dc.look.lerp(dc.killer.soldier.headWorld(new THREE.Vector3()), Math.min(1, dt * 3));
        cam.lookAt(dc.look);
      }
      cam.fov += (g.opts.fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix();
      return;
    }
    // 晃动
    const sp = this.onGround ? this.speed : 0;
    this.bobT += dt * (sp > 0.5 ? 6 + sp * 0.9 : 0);
    const bobK = Math.min(1, sp / 6) * (this.scoped ? 0.2 : 1);
    const by = Math.abs(Math.sin(this.bobT)) * 0.028 * bobK, bx = Math.cos(this.bobT) * 0.012 * bobK;
    if (this.landed && this.landSpeed > 3) this.land = Math.min(0.14, this.landSpeed * 0.012);
    this.land *= Math.exp(-dt * 7);
    const shake = g.fx.shake * 0.06;
    this.eye(cam.position);
    cam.position.y += by - this.land + (Math.random() - 0.5) * shake;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    cam.position.x += cy * bx + (Math.random() - 0.5) * shake;
    cam.position.z += -sy * bx;
    this.camRoll += ((this.keys.has('KeyA') ? 0.008 : 0) - (this.keys.has('KeyD') ? 0.008 : 0) - this.camRoll) * Math.min(1, dt * 6);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.punchP * 0.75 + this.aimPunch, this.yaw + this.punchY * 0.75, this.camRoll);
    // FOV：狙击镜
    const w = this.weapon;
    let fov = g.opts.fov;
    if (w && w.def.type === 'sniper' && this.scoped) fov = w.def.zoom[this.scoped - 1];
    const fk = this.scoped ? 1 : Math.min(1, dt * 10);
    cam.fov += (fov - cam.fov) * fk;
    cam.updateProjectionMatrix();
  }
  startDeathCam(killer) {
    const cam = this.game.renderer.camera;
    const from = cam.position.clone();
    const head = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const want = new THREE.Vector3(Math.sin(this.yaw) * 2.2, 1.4, Math.cos(this.yaw) * 2.2);
    const L = want.length(); want.divideScalar(L);
    const hit = this.game.world.raycast(head.x, head.y, head.z, want.x, want.y, want.z, L, 'move');
    const to = head.clone().addScaledVector(want, hit ? Math.max(0.2, hit.t - 0.35) : L);
    const look = this.pos.clone().add(new THREE.Vector3(0, 0.4, 0));
    this.deathCam = { t: 0, from, to, look, killer: killer && killer !== this ? killer : null };
    this.soldier.root.visible = true;
  }
}
