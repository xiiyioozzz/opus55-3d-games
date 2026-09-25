import * as THREE from 'three';
import { textTexture } from './textures.js';

const WEIGHTS = {
  lead: { banana: 35, shield: 30, nitro: 20, missile: 10, magnet: 5 },
  mid: { missile: 25, nitro: 25, banana: 20, magnet: 15, shield: 15 },
  back: { missile: 32, nitro: 30, magnet: 25, shield: 10, banana: 3 },
};

function pick(w, rnd) {
  let tot = 0;
  for (const k in w) tot += w[k];
  let r = rnd() * tot;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'nitro';
}

export class ItemSystem {
  constructor(scene, track, game, rnd) {
    this.scene = scene;
    this.track = track;
    this.game = game;
    this.rnd = rnd;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.boxes = [];
    this.missiles = [];
    this.bananas = [];
    // 道具箱：彩色问号方块
    const tex = textTexture('?', { w: 128, h: 128, bg: null, fg: '#ffffff', font: '900 110px Arial Black, Arial', stroke: '#1d4fb0' });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x55c8ff, emissive: 0x1d6ff2, emissiveIntensity: 0.6, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.3 });
    const qMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const hw = track.halfW;
    for (const f of [0.1, 0.35, 0.6, 0.85]) {
      const d = f * track.length;
      const s = track.sample(d, {});
      for (const lat of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const L = lat * hw;
        const g = new THREE.Group();
        const cube = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), boxMat);
        g.add(cube);
        for (const r of [0, Math.PI / 2]) {
          const q = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), qMat);
          q.rotation.y = r;
          g.add(q);
        }
        g.position.set(s.x + s.rx * L, s.y + L * Math.sin(s.bank) + 1.6, s.z + s.rz * L);
        this.group.add(g);
        this.boxes.push({ g, cube, respawn: 0, x: g.position.x, y: g.position.y, z: g.position.z });
      }
    }
    this.missileGeo = (() => {
      const body = new THREE.CylinderGeometry(0.22, 0.22, 1.6, 10);
      body.rotateX(Math.PI / 2);
      return body;
    })();
  }

  reset() {
    for (const b of this.boxes) { b.respawn = 0; b.g.visible = true; }
    for (const m of this.missiles) this.group.remove(m.mesh);
    for (const b of this.bananas) this.group.remove(b.mesh);
    this.missiles = [];
    this.bananas = [];
  }

  dispose() { this.scene.remove(this.group); }

  giveRandom(r, rank, total) {
    if (r.items.length >= 2) return;
    const w = rank === 1 ? WEIGHTS.lead : rank >= total - 1 ? WEIGHTS.back : WEIGHTS.mid;
    const it = pick(w, this.rnd);
    r.items.push(it);
    if (r.isPlayer) this.game.onItemGet(it);
  }

  swap(r) {
    if (r.items.length === 2) r.items.reverse();
  }

  use(r) {
    const it = r.items.shift();
    if (!it) return;
    const g = this.game;
    switch (it) {
      case 'nitro':
        if (r.isPlayer) r.triggerNitro(true);
        else r.nitroTime = 2.6;
        break;
      case 'shield':
        r.shield = 7;
        g.sfx('shield', r);
        break;
      case 'magnet': {
        r.magnet = 3;
        r.magnetTarget = g.racerAhead(r);
        g.sfx('item', r);
        break;
      }
      case 'banana': {
        const m = new THREE.Group();
        const peel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 8, 16, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.5, emissive: 0x332a00 }));
        peel.rotation.x = Math.PI / 2;
        m.add(peel);
        for (let k = 0; k < 3; k++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 6), peel.material);
          leaf.position.set(Math.cos(k * 2.1) * 0.5, 0.1, Math.sin(k * 2.1) * 0.5);
          leaf.rotation.z = Math.PI / 2;
          leaf.rotation.y = k * 2.1;
          m.add(leaf);
        }
        const bx = r.x - Math.sin(r.h) * 3.2, bz = r.z - Math.cos(r.h) * 3.2;
        const p = this.track.project(bx, r.y, bz, r.hint, {});
        m.position.set(bx, p.y + p.lat * Math.sin(p.bank) + 0.25, bz);
        m.scale.setScalar(1.4);
        this.group.add(m);
        this.bananas.push({ mesh: m, owner: r, age: 0 });
        g.sfx('banana', r);
        break;
      }
      case 'missile': {
        const target = g.racerAhead(r);
        const mesh = new THREE.Group();
        const body = new THREE.Mesh(this.missileGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.3 }));
        mesh.add(body);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0xff3030 }));
        nose.rotation.x = Math.PI / 2;
        nose.position.z = 1.05;
        mesh.add(nose);
        mesh.position.set(r.x, r.y + 1.8, r.z);
        this.group.add(mesh);
        const dir = new THREE.Vector3(Math.sin(r.h), 0, Math.cos(r.h));
        this.missiles.push({ mesh, target, owner: r, dir, life: 6, v: Math.max(80, Math.abs(r.s) + 30) });
        g.sfx('missile', r);
        if (target && target.isPlayer) g.onMissileLock();
        break;
      }
    }
  }

  update(dt, racers, standings) {
    const t = performance.now() * 0.001;
    // 道具箱
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        if (b.respawn <= 0) b.g.visible = true;
        continue;
      }
      b.g.rotation.y = t * 1.6;
      b.g.rotation.x = Math.sin(t * 1.3) * 0.25;
      b.g.position.y = b.y + Math.sin(t * 2 + b.x) * 0.2;
      for (const r of racers) {
        const dx = r.x - b.x, dz = r.z - b.z, dy = r.y + 0.8 - b.y;
        if (dx * dx + dz * dz < 6.5 && Math.abs(dy) < 3) {
          b.g.visible = false;
          b.respawn = 2.5;
          const rank = standings.indexOf(r) + 1;
          this.giveRandom(r, rank, racers.length);
          this.game.fx.burst(b.x, b.y, b.z, 0x55c8ff);
          break;
        }
      }
    }
    // 香蕉皮
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const bn = this.bananas[i];
      bn.age += dt;
      bn.mesh.rotation.y += dt;
      let hit = null;
      for (const r of racers) {
        if (r === bn.owner && bn.age < 1.2) continue;
        const dx = r.x - bn.mesh.position.x, dz = r.z - bn.mesh.position.z;
        if (dx * dx + dz * dz < 4.4 && Math.abs(r.y - bn.mesh.position.y) < 2.5) { hit = r; break; }
      }
      if (hit || bn.age > 90) {
        if (hit) this.game.hitRacer(hit, 'banana');
        this.group.remove(bn.mesh);
        this.bananas.splice(i, 1);
      }
    }
    // 导弹：追踪目标
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      const p = m.mesh.position;
      if (m.target && !m.target.finished) {
        const to = new THREE.Vector3(m.target.x - p.x, m.target.y + 0.8 - p.y, m.target.z - p.z);
        const dist = to.length();
        to.normalize();
        m.dir.lerp(to, Math.min(1, dt * 6)).normalize();
        m.v = Math.max(m.v, Math.abs(m.target.s) + 35);
        if (dist < 2.6) {
          this.game.hitRacer(m.target, 'missile');
          this.game.fx.explode(p.x, p.y, p.z);
          this.group.remove(m.mesh);
          this.missiles.splice(i, 1);
          continue;
        }
      }
      p.addScaledVector(m.dir, m.v * dt);
      m.mesh.lookAt(p.x + m.dir.x, p.y + m.dir.y, p.z + m.dir.z);
      this.game.fx.trail(p.x - m.dir.x, p.y - m.dir.y, p.z - m.dir.z);
      if (m.life <= 0) {
        this.game.fx.explode(p.x, p.y, p.z);
        this.group.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }

  // AI 使用道具的简单决策
  aiThink(r, dt, standings) {
    if (!r.items.length) return;
    r.itemTimer -= dt;
    if (r.itemTimer > 0) return;
    r.itemTimer = 1 + this.rnd() * 3;
    const it = r.items[0];
    const ahead = this.game.racerAhead(r);
    const gap = ahead ? ahead.progress - r.progress : 1e9;
    if (it === 'missile' && (!ahead || gap > 350)) { if (r.items.length > 1) this.swap(r); return; }
    if (it === 'magnet' && (!ahead || gap > 150)) return;
    this.use(r);
  }
}
