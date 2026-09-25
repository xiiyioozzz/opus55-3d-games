// 对局主控
import * as THREE from 'three';
import { Renderer } from './render.js';
import { buildTextures } from './textures.js';
import { buildMap } from './map.js';
import { Environment } from './env.js';
import { World, NavGrid } from './physics.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { WEAPONS, jitterDir } from './weapons.js';
import { buildGunMerged } from './guns.js';
import { Player } from './player.js';
import { Bot, BOT_NAMES } from './bots.js';
import { TouchControls } from './touch.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'ULTRA KILL', 'RAMPAGE', 'UNSTOPPABLE', 'GODLIKE'];
const MULTI_CN = ['', '', '双杀', '三杀', '四杀', '五杀', '六杀！', '无人能挡', '超神'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

export class Game {
  constructor() {
    this.time = 0; this.frame = 0;
    this.playing = false; this.paused = false; this.locked = false;
    this.actors = []; this.nades = []; this.timers = []; this.tags = [];
    this.score = { BL: 0, GR: 0 };
    this.audio = audio;
    this.qs = new URLSearchParams(location.search);
  }
  async init() {
    this.hud = new HUD(this);
    this.opts = this.hud.opts;
    if (this.qs.get('q')) this.opts.quality = this.qs.get('q');
    this.hud.show('loading');
    this.hud.loading(0.05, '初始化渲染器');
    await nextFrame();
    this.renderer = new Renderer(document.getElementById('c'), this.opts.quality);
    this.renderer.camera.fov = this.opts.fov;
    this.hud.loading(0.12, '生成集装箱 / 甲板 / 船体纹理');
    await nextFrame(); await nextFrame();
    this.T = buildTextures(this.opts.quality);
    this.hud.loading(0.55, '搭建运输船');
    await nextFrame();
    this.world = new World();
    this.map = buildMap(this.renderer.scene, this.T, this.world);
    this.hud.loading(0.68, '天空与海洋');
    await nextFrame();
    this.env = new Environment(this.renderer.renderer, this.renderer.scene, this.opts.quality);
    this.env.extraScenes = [this.renderer.vmScene];
    this.env.apply(this.opts.tod);
    this.fx = new Effects(this.renderer.scene, this.T, this.renderer.camera);
    this.fx.initAmbient(this.map.funnelTop);
    this.vm = new ViewModel(this.renderer.vmScene, this.T, this.opts.team);
    this.hud.loading(0.8, '计算寻路网格');
    await nextFrame();
    this.nav = new NavGrid(this.world, -36.2, -12.1, 36.2, 12.1, 0.5, 0.42);
    this.hud.buildRadar(this.world);
    this.hud.loading(0.88, '武器图标 / 预编译着色器');
    await nextFrame();
    this.hud.setIcons(this.makeIcons());
    this.lampLights();
    this.renderer.camera.position.set(-20, 12, 30); this.renderer.camera.lookAt(0, 2, 0);
    try { this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera); } catch (e) { /* 忽略 */ }
    this.hud.loading(1, '完成');
    await nextFrame();
    this.hud.show('menu');
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.touch = new TouchControls(this);
    this.touchMode = this.touch.enabled;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    if (this.qs.has('autostart')) setTimeout(() => this.startMatch(), 300);
    window.__game = this;
  }
  lampLights() {
    // 管道内的少量真实点光源
    for (const p of this.map.lampSpots.slice(0, this.opts.quality === 'low' ? 0 : 4)) {
      const l = new THREE.PointLight(0xffd9a0, 5, 9, 1.8);
      l.position.copy(p);
      this.renderer.scene.add(l);
    }
  }
  makeIcons() {
    const r = this.renderer.renderer;
    const W = 256, H = 96;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const scene = new THREE.Scene();
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const out = {};
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const buf = new Uint8Array(W * H * 4);
    for (const id of Object.keys(WEAPONS)) {
      const m = buildGunMerged(id);
      scene.add(m);
      const box = new THREE.Box3().setFromObject(m);
      const cz = (box.min.z + box.max.z) / 2, cy = (box.min.y + box.max.y) / 2;
      const hw = (box.max.z - box.min.z) / 2 * 1.08, hh = (box.max.y - box.min.y) / 2 * 1.08;
      const ext = Math.max(hw, hh * W / H);
      cam.left = -ext; cam.right = ext; cam.top = ext * H / W; cam.bottom = -ext * H / W;
      cam.position.set(2, cy, cz); cam.lookAt(0, cy, cz); cam.updateProjectionMatrix();
      r.setRenderTarget(rt); r.clear(); r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
        img.data[d] = img.data[d + 1] = img.data[d + 2] = 245; img.data[d + 3] = buf[s + 3] > 10 ? 235 : 0;
      }
      ctx.putImageData(img, 0, 0);
      out[id] = c.toDataURL();
      scene.remove(m);
    }
    r.setRenderTarget(null); r.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    return out;
  }

  // ================= 流程 =================
  startMatch() {
    const o = this.opts;
    audio.init(); audio.setVolumes({ master: o.vol }); audio.startAmbient(); audio.playUI('start');
    for (const a of this.actors) this.renderer.scene.remove(a.soldier.root);
    for (const t of this.tags) this.renderer.scene.remove(t.sprite);
    for (const n of this.nades) this.renderer.scene.remove(n.mesh);
    this.actors = []; this.nades = []; this.tags = []; this.timers = [];
    this.score = { BL: 0, GR: 0 };
    this.goal = o.goal; this.timeLeft = 600;
    this.env.apply(o.tod);
    const my = o.team, other = my === 'BL' ? 'GR' : 'BL';
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    this.player = new Player(this, { id: id++, name: '我', team: my });
    this.player.primary = o.primary;
    this.player.bind(document.getElementById('c'));
    this.actors.push(this.player);
    const N = o.size;
    const prim = (team, i) => {
      if (i === 1 && N >= 4) return 'awm';
      if (i === 3 && N >= 6) return 'mp5';
      if (i === 5) return team === 'BL' ? 'm4a1' : 'ak47';
      return team === 'BL' ? 'ak47' : 'm4a1';
    };
    for (const team of [my, other]) {
      const count = team === my ? N - 1 : N;
      for (let i = 0; i < count; i++) {
        const b = new Bot(this, { id: id++, name: names.pop() || 'Bot' + id, team, diff: o.diff });
        b.primary = prim(team, team === my ? i + 1 : i);
        this.actors.push(b);
        if (team === my) this.addTag(b);
      }
    }
    for (const a of this.actors) this.spawnActor(a, true);
    this.vm.setTeam(my); this.vm.equip(this.player.weapon.id, 0.6);
    this.hud.slots(this.player.inv, 0);
    this.playing = true; this.paused = false; this.ended = false;
    this.hud.show(null);
    this.lock();
    setTimeout(() => audio.announce('Go go go!'), 400);
    this.hud.toast(`团队竞技 · 率先达到 <b style="color:#f5b321">${this.goal}</b> 击杀的队伍获胜`, 3.5);
  }
  addTag(b) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const x = c.getContext('2d');
    x.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(b.name, 128, 24);
    x.fillStyle = b.team === 'BL' ? '#ff9b70' : '#8cc8ff'; x.fillText(b.name, 128, 24);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
    s.scale.set(1.3, 0.244, 1); s.renderOrder = 20;
    this.renderer.scene.add(s);
    this.tags.push({ sprite: s, actor: b });
  }
  spawnActor(a, first) {
    const pts = this.map.spawns[a.team];
    let best = null, bestScore = -1e9;
    for (const p of pts) {
      let sc = Math.random() * 3;
      for (const o of this.actors) {
        if (!o.alive || o === a) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (d < 1.2) sc -= 100;
        if (o.team !== a.team) sc += Math.min(d, 40) * 0.1;
      }
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    a.spawn(best);
    if (a instanceof Bot) a.onSpawn();
    if (a.isPlayer) {
      a.deathCam = null;
      this.vm.equip(a.weapon.id, first ? 0.6 : 0.5);
      this.vm.setVisible(true);
      this.hud.slots(a.inv, a.slot);
      audio.setLowHealth(false);
    }
  }
  lock() {
    if (this.touchMode || this.qs.has('nolock')) { this.locked = true; return; }
    const c = document.getElementById('c');
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (e) { /* 忽略 */ } });
    } catch (e) { try { c.requestPointerLock(); } catch (e2) { /* 忽略 */ } }
  }
  onLockChange() {
    this.locked = document.pointerLockElement === document.getElementById('c');
    document.body.classList.toggle('lk', this.locked);
    if (this.locked) {
      if (this.paused) this.resume(true);
    } else if (this.playing && !this.ended && !this.inLoadout && !this.qs.has('nolock')) {
      this.pause();
    }
  }
  pause() {
    this.paused = true; this.hud.show('pause');
    this.hud.scoreboard(false);
  }
  resume(fromLock) {
    this.paused = false; this.hud.show(null);
    if (!fromLock) this.lock();
  }
  quitToMenu() {
    this.playing = false; this.paused = false; this.ended = true;
    audio.stopAmbient(); audio.setLowHealth(false);
    for (const a of this.actors) this.renderer.scene.remove(a.soldier.root);
    for (const t of this.tags) this.renderer.scene.remove(t.sprite);
    this.actors = []; this.tags = [];
    this.player = null;
    this.vm.setVisible(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show('menu');
  }
  toggleLoadout() {
    if (!this.playing) return;
    if (this.inLoadout) { this.closeLoadout(); return; }
    this.inLoadout = true; this.hud.show('loadout');
    for (const x of document.querySelectorAll('#loadCards .card')) x.classList.toggle('on', x.dataset.w === (this.player.nextPrimary || this.player.primary));
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeLoadout() {
    this.inLoadout = false; this.hud.show(null); this.lock();
  }
  chooseLoadout(id) {
    const p = this.player;
    p.nextPrimary = id; this.opts.primary = id; this.hud.saveOpts();
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) {
      p.primary = id; p.inv[0] = new (p.inv[0].constructor)(id); p.inv[0].patternSeed = Math.random() * 6;
      p.slot = 0; p.readyAt = this.time + WEAPONS[id].draw; p.soldier.setWeapon(id);
      this.vm.equip(id, WEAPONS[id].draw); this.hud.slots(p.inv, 0);
      this.hud.toast(`已更换为 ${WEAPONS[id].name}`, 1.5);
    } else this.hud.toast(`复活后使用 ${WEAPONS[id].name}`, 1.5);
    audio.playUI('buy');
  }
  onOption(k, v) {
    if (k === 'vol') audio.setVolumes({ master: v });
    if (k === 'fov' && this.renderer) { this.renderer.camera.fov = v; this.renderer.camera.updateProjectionMatrix(); }
    if (k === 'tod' && this.env) this.env.apply(v);
    if (k === 'quality') { this.hud.saveOpts(); location.reload(); }
    if (k === 'team' && this.vm) this.vm.setTeam(v);
  }
  endMatch() {
    this.ended = true; this.playing = false;
    const my = this.player.team, other = my === 'BL' ? 'GR' : 'BL';
    const win = this.score[my] === this.score[other] ? null : this.score[my] > this.score[other];
    this.hud.endScreen(win, this.score, this.actors, this.player.id);
    audio.playUI('roundEnd'); audio.setLowHealth(false);
    audio.announce(win ? 'Mission accomplished' : win === null ? 'Draw' : 'Mission failed');
    if (document.pointerLockElement) document.exitPointerLock();
    this.vm.setVisible(false);
  }

  // ================= 战斗 =================
  fireWeapon(a, ws, spread) {
    const d = ws.def;
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    jitterDir(dir, spread, Math.random);
    let muzzle;
    if (a.isPlayer) {
      const cam = this.renderer.camera;
      const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      muzzle = cam.position.clone().addScaledVector(dir, 0.9).addScaledVector(right, 0.14).addScaledVector(up, -0.1);
      this.vm.fire();
      this.fx.light(cam.position.clone().addScaledVector(dir, 1.2), d.type === 'sniper' ? 10 : 5, 0.06);
      audio.playShot(d.sound, null);
      if (Math.random() < 0.5) audio.playShellDrop(null);
    } else {
      muzzle = a.soldier.muzzleWorld(new THREE.Vector3());
      this.fx.muzzle(muzzle, dir, d.type === 'sniper' ? 1.6 : d.type === 'smg' ? 0.8 : 1);
      a.soldier.kick();
      audio.playShot(d.sound, muzzle);
    }
    a.radarT = 1.6;
    // 让附近的机器人听到
    for (const b of this.actors) if (b !== a && b.hear && b.team !== a.team && b.pos.distanceTo(a.pos) < 45) b.hear(a.pos, true);
    const end = this.traceBullet(a, eye, dir, d);
    if (!a.isPlayer || Math.random() < 0.35 || d.type === 'sniper') this.fx.tracer(muzzle, end);
    // 子弹掠过玩家
    const p = this.player;
    if (p && p.alive && a !== p && a.team !== p.team) {
      const hp = p.eye(_v);
      const t = _d.copy(hp).sub(eye).dot(dir);
      if (t > 2 && t < eye.distanceTo(end)) {
        const closest = eye.clone().addScaledVector(dir, t);
        if (closest.distanceTo(hp) < 1.3) audio.playBulletWhiz(closest);
      }
    }
  }
  traceBullet(shooter, o, dir, d) {
    const range = d.range;
    const hits = this.world.raycastAll(o.x, o.y, o.z, dir.x, dir.y, dir.z, range);
    let power = d.pen, mul = 1, wall = false, from = 0;
    this.frame++;
    for (let i = 0; i <= hits.length; i++) {
      const h = hits[i];
      const lim = h ? h.t : range;
      // 角色命中
      let best = null, bestT = lim, part = null;
      for (const a of this.actors) {
        if (!a.alive || a === shooter || a.team === shooter.team) continue;
        const r = a.soldier.hitTest(o, dir, bestT, this.frame);
        if (r && r.t > from - 0.01 && r.t < bestT) { best = a; bestT = r.t; part = r.part; }
      }
      if (best) {
        const pt = o.clone().addScaledVector(dir, bestT);
        const dist = bestT;
        const partMul = part === 'head' ? d.headMul : part === 'arm' || part === 'leg' ? d.limbMul : 1;
        const dmg = d.dmg * mul * Math.pow(d.falloff, dist / 10) * partMul;
        this.fx.impact(pt, _v.copy(dir).negate(), 'flesh', dir);
        if (part === 'head') this.fx.impact(pt, _v.copy(dir).negate(), 'flesh', dir);
        audio.playImpact(pt, 'flesh');
        this.damage(best, shooter, dmg, part, d.id, dir, wall);
        return pt;
      }
      if (!h) break;
      const pt = o.clone().addScaledVector(dir, h.t);
      const n = new THREE.Vector3(h.nx, h.ny, h.nz);
      const mat = h.collider.mat;
      this.fx.impact(pt, n, mat, dir);
      if (pt.distanceTo(this.renderer.camera.position) < 40) audio.playImpact(pt, mat === 'wood' ? 'wood' : 'metal');
      if (h.collider.bullet === 'pen') {
        const thick = h.exit - h.t;
        const cost = thick * (mat === 'wood' ? 1.0 : 1.9);
        if (power > cost) {
          power -= cost; mul *= 0.6; wall = true; from = h.exit;
          const ep = o.clone().addScaledVector(dir, h.exit);
          this.fx.impact(ep, dir.clone(), mat, dir);
          continue;
        }
      } else if (Math.random() < 0.08 && mat === 'metal') audio.playRicochet(pt);
      return pt;
    }
    return o.clone().addScaledVector(dir, range);
  }
  melee(a, heavy) {
    const d = WEAPONS.knife;
    const range = heavy ? d.rangeHeavy : d.rangeLight;
    const eye = a.eye(new THREE.Vector3());
    const base = a.forward(new THREE.Vector3());
    if (a.isPlayer) this.vm.melee(heavy);
    this.frame++;
    let hit = null;
    for (const off of [0, 0.12, -0.12, 0.24, -0.24]) {
      const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
      for (const b of this.actors) {
        if (!b.alive || b === a || b.team === a.team) continue;
        const r = b.soldier.hitTest(eye, dir, range, this.frame);
        if (r && (!hit || r.t < hit.t)) hit = { a: b, t: r.t, part: r.part, dir };
      }
      if (hit) break;
    }
    const delay = heavy ? 0.33 : 0.1;
    this.timers.push({
      t: this.time + delay, fn: () => {
        if (!a.alive) return;
        if (hit && hit.a.alive) {
          const vf = hit.a.forward(new THREE.Vector3()); vf.y = 0; vf.normalize();
          const back = vf.dot(_v.copy(hit.dir).setY(0).normalize()) > 0.5;
          let dmg = heavy ? d.dmgHeavy : d.dmgLight;
          if (back) dmg *= heavy ? 2 : 1.6;
          if (hit.part === 'head') dmg *= 1.3;
          const pt = eye.clone().addScaledVector(hit.dir, hit.t);
          this.fx.impact(pt, hit.dir.clone().negate(), 'flesh', hit.dir);
          audio.playKnife(heavy ? 'heavy' : 'light', 'flesh', a.isPlayer ? null : eye);
          this.damage(hit.a, a, dmg, hit.part, 'knife', hit.dir, false, true);
        } else {
          const w = this.world.raycast(eye.x, eye.y, eye.z, base.x, base.y, base.z, range, 'bullet');
          if (w) {
            const pt = eye.clone().addScaledVector(base, w.t);
            this.fx.impact(pt, new THREE.Vector3(w.nx, w.ny, w.nz), w.collider.mat, base);
            audio.playKnife(heavy ? 'heavy' : 'light', 'wall', a.isPlayer ? null : eye);
          } else audio.playKnife(heavy ? 'heavy' : 'light', 'miss', a.isPlayer ? null : eye);
        }
      },
    });
  }
  throwGrenade(a) {
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    const pos = eye.clone().addScaledVector(dir, 0.5).addScaledVector(right, 0.12);
    const vel = dir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 2.8, 0)).addScaledVector(a.vel, 0.6);
    const mesh = buildGunMerged('he'); mesh.scale.setScalar(1.3);
    mesh.position.copy(pos); this.renderer.scene.add(mesh);
    this.nades.push({ mesh, pos, vel, fuse: WEAPONS.he.fuse, owner: a, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) });
    audio.playGrenadeThrow();
    if (a.isPlayer) audio.announce('Fire in the hole!');
    for (const b of this.actors) if (b.hear && b.team !== a.team && b.pos.distanceTo(pos) < 20) b.hear(pos, false);
  }
  updateNades(dt) {
    const W = this.world;
    this.nades = this.nades.filter((n) => {
      n.fuse -= dt;
      const steps = 3, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        n.vel.y -= 14 * h;
        const sp = n.vel.length();
        if (sp < 1e-4) continue;
        const d = n.vel.clone().divideScalar(sp);
        const L = sp * h + 0.07;
        const hit = W.raycast(n.pos.x, n.pos.y, n.pos.z, d.x, d.y, d.z, L, 'move');
        if (hit) {
          const nn = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
          n.pos.addScaledVector(d, Math.max(0, hit.t - 0.07));
          const vn = n.vel.dot(nn);
          n.vel.addScaledVector(nn, -1.45 * vn).multiplyScalar(0.55);
          if (Math.abs(vn) > 2) audio.playGrenadeBounce(n.pos.clone());
          if (nn.y > 0.7 && Math.abs(n.vel.y) < 1.2) { n.vel.y = 0; n.vel.x *= 0.8; n.vel.z *= 0.8; }
          n.spin.multiplyScalar(0.6);
        } else n.pos.addScaledVector(n.vel, h);
      }
      n.mesh.position.copy(n.pos);
      n.mesh.rotation.x += n.spin.x * dt; n.mesh.rotation.y += n.spin.y * dt;
      if (n.fuse <= 0) { this.explode(n.pos.clone(), n.owner); this.renderer.scene.remove(n.mesh); return false; }
      return true;
    });
  }
  explode(p, owner) {
    const d = WEAPONS.he;
    this.fx.explosion(p);
    audio.playExplosion(p);
    const camD = this.renderer.camera.position.distanceTo(p);
    this.fx.shake = Math.max(this.fx.shake, Math.max(0, 1.4 - camD / 18));
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.team === owner.team && a !== owner) continue;
      const c = a.soldier.chestWorld(new THREE.Vector3());
      const dist = c.distanceTo(p);
      if (dist > d.radius) continue;
      const dir = c.clone().sub(p); const L = dir.length(); dir.divideScalar(L || 1);
      const blocked = this.world.raycast(p.x, p.y + 0.2, p.z, dir.x, dir.y, dir.z, Math.max(0, L - 0.3), 'bullet');
      let dmg = d.dmg * Math.pow(1 - dist / d.radius, 1.1);
      if (blocked) dmg *= 0.2;
      if (dmg > 1) this.damage(a, owner, dmg, 'chest', 'he', dir, false);
    }
    for (const b of this.actors) if (b.hear && b.pos.distanceTo(p) < 40) b.hear(p, true);
  }
  damage(v, att, amt, part, wid, dir, wall, melee) {
    if (!v.alive || v.protectT > 0) return;
    if (att && att !== v && att.team === v.team) return;
    const def = WEAPONS[wid];
    let hpD = amt;
    if (v.armor > 0 && part !== 'leg') {
      const ap = def?.armorPen ?? 0.75;
      hpD = amt * ap;
      v.armor = Math.max(0, v.armor - amt * (1 - ap) * 1.4);
    }
    v.hp -= hpD;
    v.lastAttacker = att; v.lastHurt = this.time;
    const killed = v.hp <= 0;
    if (att && att !== v) att.stats.hits++;
    if (v.isPlayer) {
      if (att && att !== v) this.hud.damageFrom(Math.atan2(-(att.pos.x - v.pos.x), -(att.pos.z - v.pos.z)));
      v.aimPunch += Math.min(0.05, hpD * 0.0012);
      audio.playHurt(Math.min(100, hpD));
      this.dmgFlash = Math.min(1.2, (this.dmgFlash || 0) + hpD / 45);
      if (v.hp <= 30 && !killed) audio.setLowHealth(true);
    } else if (v.onDamaged) v.onDamaged(att);
    if (att && att.isPlayer && att !== v) {
      this.hud.hitmarker(part === 'head', killed);
      audio.playHitmarker(part === 'head');
    }
    if (killed) this.kill(v, att, wid, part === 'head' && !melee, wall, dir);
  }
  kill(v, att, wid, hs, wall, dir) {
    v.alive = false; v.hp = 0; v.deadT = 0; v.respawnT = 4.0; v.stats.d++;
    v.scoped = 0;
    v.soldier.die(dir.x, dir.z, hs);
    audio.playDeath(v.soldier.chestWorld(new THREE.Vector3()));
    const p = this.player;
    if (att && att !== v) {
      att.stats.k++; if (hs) att.stats.hs++;
      this.score[att.team]++;
      att.multi = this.time - att.lastKillT < 5 ? att.multi + 1 : 1;
      att.lastKillT = this.time; att.streak++;
    }
    this.hud.killFeed(att && att !== v ? att : null, v, wid, hs, wall, att === p || v === p);
    if (att === p && v !== p) {
      const m = Math.min(att.multi, 8);
      let text, sub = `击杀 ${v.name}`;
      if (m >= 2) { text = MULTI[m]; sub = MULTI_CN[m] + ' · ' + sub; setTimeout(() => audio.announce(MULTI[m].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) + '!'), 150); }
      else if (hs) { text = 'HEADSHOT'; sub = '爆头 · ' + sub; setTimeout(() => audio.announce('Headshot!'), 150); }
      else if (wid === 'knife') { text = 'KNIFE KILL'; sub = '刀杀 · ' + sub; }
      else if (wid === 'he') { text = 'GRENADE KILL'; sub = '手雷击杀 · ' + sub; }
      else if (wall) { text = 'WALLBANG'; sub = '穿墙击杀 · ' + sub; }
      else { text = 'KILL'; }
      this.hud.badge(text, sub, hs);
      audio.playKillConfirm(hs);
    }
    if (v === p) {
      p.startDeathCam(att);
      this.vm.setVisible(false);
      audio.setLowHealth(false);
      const wn = WEAPONS[wid]?.name || wid;
      this.killedBy = att && att !== v ? `被 <span style="color:${att.team === 'BL' ? '#ff9b70' : '#8cc8ff'}">${att.name}</span> 用 ${wn}${hs ? ' <span style="color:#ff5040">爆头</span>' : ''}击杀` : '你阵亡了';
    }
    this.fx.bloodSplat(v.pos);
    if (this.score.BL >= this.goal || this.score.GR >= this.goal) setTimeout(() => { if (this.playing) this.endMatch(); }, 1200);
  }

  // ================= 事件音效 =================
  onJump(a) { audio.playJump(a.isPlayer ? null : a.pos.clone()); }
  onLand(a, sp) { audio.playLand(a.isPlayer ? null : a.pos.clone(), a.ground?.surface || 'metal', Math.min(1, sp / 10)); }
  onFootstep(a) {
    if (!a.isPlayer && a.pos.distanceTo(this.renderer.camera.position) > 30) return;
    audio.playFootstep(a.isPlayer ? null : a.pos.clone(), a.ground?.surface || 'metal', { run: true, crouch: a.crouch });
    if (!a.walk) for (const b of this.actors) if (b.hear && b.team !== a.team && b.pos.distanceTo(a.pos) < 12) b.hear(a.pos, false);
  }
  onSwitch(a) {
    if (!a.isPlayer) return;
    this.vm.equip(a.weapon.id, a.weapon.def.draw);
    audio.playWeaponSwitch(a.weapon.id);
    this.hud.slots(a.inv, a.slot);
  }
  onReloadStart(a, empty) {
    if (!a.isPlayer) return;
    const d = a.weapon.def, t = this.time, id = d.id;
    this.vm.reload(d.reload, empty);
    this.timers.push({ t: t + d.reload * 0.2, fn: () => audio.playReload(id, 'magout') });
    this.timers.push({ t: t + d.reload * 0.6, fn: () => audio.playReload(id, 'magin') });
    if (empty) this.timers.push({ t: t + d.reload * 0.82, fn: () => audio.playReload(id, id === 'awm' ? 'bolt' : 'boltback') });
    if (empty) this.timers.push({ t: t + d.reload * 0.88, fn: () => audio.playReload(id, 'boltforward') });
  }
  onReloadDone() { }
  onScope(a) { if (a.isPlayer) audio.playScope(a.scoped > 0); }
  onDryFire(a) { if (a.isPlayer) audio.playDryFire(); }
  onGrenadeStart(a) { if (a.isPlayer) { this.vm.throwNade(); audio.playGrenadePin(); } }

  // ================= 主循环 =================
  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    const R = this.renderer, cam = R.camera;
    this.realTime = (this.realTime || 0) + dt;
    const active = this.playing && !this.paused;
    if (active) this.simulate(dt);
    else if (!this.playing) {
      // 菜单：环绕运输船
      const t = this.realTime * 0.045;
      cam.position.set(Math.cos(t) * 46 - 6, 13 + Math.sin(t * 2.1) * 3, Math.sin(t) * 34);
      cam.lookAt(-4, 1.5, 0);
      cam.fov = 60; cam.updateProjectionMatrix();
    }
    this.renderFrame(dt);
  }
  // 调试：无渲染快进
  fastForward(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds && this.playing; t += step) this.simulate(step);
    return { score: this.score, time: this.time.toFixed(1), kills: this.actors.map((a) => a.name + ':' + a.stats.k + '/' + a.stats.d).join(' ') };
  }
  simulate(dt) {
    const cam = this.renderer.camera;
    {
      this.time += dt;
      this.timeLeft -= dt;
      for (let i = this.timers.length - 1; i >= 0; i--) if (this.time >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
      this.player.update(dt);
      for (const a of this.actors) {
        if (a.isPlayer) continue;
        a.update(dt);
      }
      for (const a of this.actors) {
        a.radarT = Math.max(0, a.radarT - dt);
        if (a.alive) {
          a.protectT = Math.max(0, a.protectT - dt);
          const s = a.soldier;
          s.root.position.copy(a.pos);
          s.root.rotation.y = a.yaw;
          const fwd = (a.vel.x * -Math.sin(a.yaw) + a.vel.z * -Math.cos(a.yaw)) / Math.max(0.01, a.speed || 0);
          s.update(dt, { speed: a.speed || 0, fwd, crouch: a.crouch, pitch: a.pitch + a.punchP, onGround: a.onGround, reloading: a.weapon?.reloading });
          // 出生保护闪烁
          if (!a.isPlayer) s.mesh.visible = !(a.protectT > 0 && Math.sin(this.time * 30) > 0.3);
        } else {
          a.deadT += dt;
          a.soldier.update(dt, {});
          a.respawnT -= dt;
          if (a.respawnT <= 0 && !this.ended) this.spawnActor(a);
        }
      }
      this.updateNades(dt);
      if (this.timeLeft <= 0 && !this.ended) this.endMatch();
      // 队友名字
      for (const t of this.tags) {
        const a = t.actor;
        t.sprite.visible = a.alive && a.pos.distanceTo(cam.position) < 45;
        if (t.sprite.visible) { a.soldier.headWorld(t.sprite.position); t.sprite.position.y += 0.42; }
      }
    }
  }
  renderFrame(dt) {
    const R = this.renderer, cam = R.camera;
    // 第一人称武器
    if (this.player && this.playing) {
      const p = this.player;
      if (this.frame % 6 === 0 || !this.lightK) this.updateLightProbe();
      this.frame++;
      const sunCam = this.env.sunDir.clone().applyQuaternion(cam.quaternion.clone().invert());
      this.vm.setVisible(p.alive && !(p.scoped && p.weapon.def.type === 'sniper'));
      this.vm.update(dt, { speed: p.speed || 0, onGround: p.onGround, crouch: p.crouch, lookDX: p.lookDX, lookDY: p.lookDY, sunDirCam: sunCam, light: this.lightK, indoor: this.indoorK > 0.5 });
      R.vmScene.environmentIntensity = 0.75 * (0.35 + 0.65 * (1 - this.indoorK));
    }
    this.fx.update(dt, this.realTime, cam, this.env.shipSpeed);
    this.env.update(dt, this.realTime, cam.position);
    this.map.update(dt, this.realTime);
    // 帧率统计与画质建议
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 1) {
      this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0;
      const lbl = document.querySelector('#radarWrap .lbl');
      if (lbl) lbl.textContent = `运输船 · ${this.fps} FPS`;
      if (this.playing && !this.paused && this.time > 8 && !this.fpsHinted && this.fps < 32 && this.opts.quality !== 'low') {
        this.fpsHinted = true;
        this.hud.toast('帧率较低：可按 Esc 在主菜单把画质调到「均衡」或「流畅」', 5);
      }
    }
    // 音频监听者
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion), up = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, fwd, up);
    audio.update(dt);
    // HUD
    if (this.player && (this.playing || this.ended)) this.updateHUD(dt);
    // 屏幕特效
    const fxu = R.fx.uniforms;
    this.dmgFlash = Math.max(0, (this.dmgFlash || 0) - dt * 1.6);
    fxu.uTime.value = this.realTime;
    fxu.uDamage.value = this.dmgFlash;
    const p = this.player;
    fxu.uLowHP.value = p && p.alive && this.playing ? Math.max(0, (35 - p.hp) / 35) : 0;
    fxu.uDeath.value = p && !p.alive && this.playing ? Math.min(1, p.deadT * 2) : 0;
    fxu.uProtect.value = p && p.alive && this.playing ? Math.min(1, p.protectT) : 0;
    fxu.uVignette.value = p && p.scoped ? 0 : 0.3;
    R.render();
  }
  updateLightProbe() {
    const p = this.player, e = p.eye(_v), s = this.env.sunDir;
    const sunBlocked = !!this.world.raycast(e.x, e.y, e.z, s.x, s.y, s.z, 80, 'sight');
    const roof = !!this.world.raycast(e.x, e.y, e.z, 0, 1, 0, 5, 'sight');
    const tl = sunBlocked ? 0.22 : 1, ti = roof ? 1 : 0;
    this.lightK = this.lightK === undefined ? tl : this.lightK + (tl - this.lightK) * 0.35;
    this.indoorK = this.indoorK === undefined ? ti : this.indoorK + (ti - this.indoorK) * 0.35;
  }
  updateHUD(dt) {
    const p = this.player, cam = this.renderer.camera, w = p.weapon;
    let spreadPx = 0;
    if (w && w.def.spread) {
      const sp = Math.min(0.12, w.spreadAcc + w.def.spread.base * 2 + (p.speed > 0.6 ? w.def.spread.move * Math.min(1, p.speed / 5.7) : 0) + (p.onGround ? 0 : w.def.spread.air * 0.5)) * (p.crouch ? 0.7 : 1);
      spreadPx = Math.tan(sp) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * window.innerHeight / 2;
    }
    // 准星下的角色名
    let aimName = '', aimTeam = '';
    if (p.alive && this.frame % 4 === 0) {
      const o = cam.position, d = _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const wh = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 80, 'sight');
      const lim = wh ? wh.t : 80;
      let best = null, bt = lim;
      this.frame++;
      for (const a of this.actors) {
        if (a === p || !a.alive) continue;
        const r = a.soldier.hitTest(o, d, bt, this.frame);
        if (r) { best = a; bt = r.t; }
      }
      this.aimTarget = best;
    }
    if (this.aimTarget && this.aimTarget.alive) { aimName = this.aimTarget.name; aimTeam = this.aimTarget.team; }
    this.hud.update(dt, {
      score: this.score, timeLeft: this.timeLeft, goal: this.goal, myTeam: p.team,
      hp: p.hp, armor: p.armor, alive: p.alive, weapon: w, scoped: p.scoped && w.def.type === 'sniper', spreadPx,
      yaw: p.yaw, respawnIn: p.respawnT, killedBy: this.killedBy, protect: p.protectT, aimName, aimTeam,
    });
    this.hud.drawRadar(p, this.actors, this.time);
    const tab = p.keys.has('Tab') && this.playing && !this.paused;
    if (tab !== this.boardShown || (tab && this.frame % 20 === 0)) { this.boardShown = tab; this.hud.scoreboard(tab, this.actors, p.id, this.score); }
  }
}
