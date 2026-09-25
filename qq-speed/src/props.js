import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, M } from './world.js';
import * as TX from './textures.js';
import { clamp } from './util.js';

// ---------- 缓存 ----------
const MATS = new Map();
function mat(key, fn) {
  if (!MATS.has(key)) MATS.set(key, fn());
  return MATS.get(key);
}
const std = (color, o = {}) => mat('std' + color + JSON.stringify(o), () => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
const flat = (color, o = {}) => mat('flat' + color + JSON.stringify(o), () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...o }));
const glow = (color, i = 2) => mat('glow' + color + i, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i }));
const texMat = (key, tex, o = {}) => mat('tex' + key, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, ...o }));

const GEOS = new Map();
function geo(key, fn) {
  if (!GEOS.has(key)) GEOS.set(key, fn());
  return GEOS.get(key);
}

// 距赛道中心线是否足够远
export function isFree(track, x, z, r) { return !track.nearest(x, z, track.halfW + r); }

function crowdTexture() {
  return geo('crowdTex', () => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#3b3f52';
    g.fillRect(0, 0, 512, 256);
    const cols = ['#ff5252', '#ffd740', '#40c4ff', '#69f0ae', '#ffffff', '#ff80ab', '#b388ff', '#ffab40'];
    for (let y = 8; y < 256; y += 21)
      for (let x = 4; x < 512; x += 12) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.fillRect(x + Math.random() * 3, y + 7, 9, 11);
        g.fillStyle = '#f1c7a2';
        g.beginPath();
        g.arc(x + 5 + Math.random() * 2, y + 4, 4, 0, 7);
        g.fill();
        if (Math.random() < 0.15) {
          g.fillStyle = cols[(Math.random() * cols.length) | 0];
          g.fillRect(x + 2, y - 8, 3, 10);
        }
      }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

// ---------- 常用几何 ----------
function treeGeos() {
  return geo('tree', () => {
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
    trunk.translate(0, 1.6, 0);
    const c1 = new THREE.IcosahedronGeometry(2.3, 1);
    c1.translate(0, 4.6, 0);
    const c2 = new THREE.IcosahedronGeometry(1.7, 1);
    c2.translate(0.9, 5.6, 0.4);
    return { trunk, crown: mergeGeometries([c1, c2]) };
  });
}

function palmGeos() {
  return geo('palm', () => {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5, 0.6), new THREE.Vector3(1.0, 9.5, 1.4));
    const trunk = new THREE.TubeGeometry(curve, 10, 0.3, 7, false);
    const fronds = [];
    for (let k = 0; k < 9; k++) {
      const f = new THREE.PlaneGeometry(1.2, 5.2, 1, 6);
      const p = f.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const y = p.getY(v) + 2.6;
        p.setY(v, y);
        p.setZ(v, -Math.pow(y / 5.2, 2) * 2.4);
        p.setX(v, p.getX(v) * (1 - Math.abs(y / 5.2 - 0.45)));
      }
      f.rotateX(-Math.PI / 2 + 0.35);
      f.rotateY((k / 9) * Math.PI * 2);
      f.translate(1.0, 9.5, 1.4);
      fronds.push(f);
    }
    const leaves = mergeGeometries(fronds);
    leaves.computeVertexNormals();
    return { trunk, leaves };
  });
}

function pineGeos() {
  return geo('pine', () => {
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    const greens = [], snows = [];
    const tiers = [[2.8, 3.6, 2.8], [2.2, 3.2, 4.8], [1.5, 2.8, 6.6], [0.9, 2.2, 8.2]];
    for (const [r, h, y] of tiers) {
      const c = new THREE.ConeGeometry(r, h, 8);
      c.translate(0, y, 0);
      greens.push(c);
      const s = new THREE.ConeGeometry(r * 0.72, h * 0.55, 8);
      s.translate(0, y + h * 0.26, 0);
      snows.push(s);
    }
    return { trunk, green: mergeGeometries(greens), snow: mergeGeometries(snows) };
  });
}

function addTree(b, x, y, z, s, rot, leafColor = 0x4caf50) {
  const g = treeGeos();
  b.add(g.trunk, std(0x7a5230), M(x, y, z, rot, s));
  b.add(g.crown, flat(leafColor), M(x, y, z, rot, s));
}
function addPalm(b, x, y, z, s, rot) {
  const g = palmGeos();
  b.add(g.trunk, std(0x9c7a4f, { roughness: 1 }), M(x, y, z, rot, s));
  b.add(g.leaves, mat('palmLeaf', () => new THREE.MeshStandardMaterial({ color: 0x3f9c3a, roughness: 0.8, side: THREE.DoubleSide })), M(x, y, z, rot, s));
}
function addPine(b, x, y, z, s, rot, snowy = true) {
  const g = pineGeos();
  b.add(g.trunk, std(0x6b4a2f), M(x, y, z, rot, s));
  b.add(g.green, flat(0x2f6b45), M(x, y, z, rot, s));
  if (snowy) b.add(g.snow, flat(0xf4f8ff), M(x, y, z, rot, s));
}

function addLamp(b, x, y, z, faceRot) {
  const pole = geo('lampPole', () => { const g = new THREE.CylinderGeometry(0.12, 0.18, 8, 6); g.translate(0, 4, 0); return g; });
  const arm = geo('lampArm', () => { const g = new THREE.BoxGeometry(0.14, 0.14, 2.4); g.translate(0, 7.9, 1.1); return g; });
  const head = geo('lampHead', () => { const g = new THREE.BoxGeometry(0.5, 0.18, 1.0); g.translate(0, 7.8, 2.1); return g; });
  b.add(pole, std(0x5d6470, { metalness: 0.6, roughness: 0.4 }), M(x, y, z, faceRot));
  b.add(arm, std(0x5d6470, { metalness: 0.6, roughness: 0.4 }), M(x, y, z, faceRot));
  b.add(head, glow(0xfff3c4, 3), M(x, y, z, faceRot), false);
}

// 广告牌（面向赛道）
function addBillboard(parent, b, x, y, z, rot, tex, w = 12, h = 6, lift = 6) {
  const post = geo('bbPost', () => { const g = new THREE.BoxGeometry(0.5, 1, 0.5); g.translate(0, 0.5, 0); return g; });
  for (const sx of [-w * 0.32, w * 0.32]) {
    const ox = Math.cos(rot) * sx, oz = -Math.sin(rot) * sx;
    b.add(post, std(0x444a55, { metalness: 0.5 }), M(x + ox, y, z + oz, rot, 1, lift, 1));
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.5, side: THREE.DoubleSide }));
  m.position.set(x, y + lift + h / 2, z);
  m.rotation.y = rot;
  m.castShadow = true;
  parent.add(m);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.3), std(0x2b2f38));
  back.position.copy(m.position);
  back.position.x -= Math.sin(rot) * 0.2;
  back.position.z -= Math.cos(rot) * 0.2;
  back.rotation.y = rot;
  parent.add(back);
}

// 看台
function addGrandstand(parent, b, s, side, len, hw, groundAt, color = 0x2e6fd6, track = null) {
  if (track) {
    // 看台占地内不能有别的赛道段
    const tmp = {};
    let blocked = false;
    for (let k = -len / 2; k <= len / 2 && !blocked; k += 8) {
      const q = track.sample(s.d + k, tmp);
      for (const lat of [hw + 5, hw + 14]) {
        const x = q.x + q.rx * side * lat, z = q.z + q.rz * side * lat;
        track.forEachNear(x, z, hw + 4, (j) => {
          const di = Math.abs(j - q.i);
          if (Math.min(di, track.N - di) > 40) blocked = true;
        });
      }
    }
    if (blocked) return false;
  }
  const grp = new THREE.Group();
  const steps = 7;
  for (let k = 0; k < steps; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 1.6), std(k % 2 ? 0xd9dde6 : 0xc2c8d4));
    step.position.set(0, 0.35 + k * 0.75, k * 1.5);
    grp.add(step);
  }
  const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len - 1, steps * 0.75 + 0.5), new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 1 }));
  crowd.material.map.repeat.set(len / 30, 1);
  crowd.rotation.set(-Math.atan2(steps * 0.75, steps * 1.5), Math.PI, 0, 'YXZ');
  crowd.position.set(0, steps * 0.4 + 0.8, steps * 0.72 - 0.3);
  grp.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.4, steps * 1.6 + 3), std(color, { metalness: 0.3, roughness: 0.4 }));
  roof.position.set(0, steps * 0.75 + 5.2, steps * 0.75);
  roof.rotation.x = -0.08;
  roof.castShadow = true;
  grp.add(roof);
  for (let i = -len / 2 + 2; i <= len / 2 - 2; i += len / 5) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, steps * 0.75 + 5.4, 0.4), std(0x8a93a3));
    col.position.set(i, (steps * 0.75 + 5.4) / 2, steps * 1.6 + 0.5);
    grp.add(col);
  }
  const lat = side * (hw + 4.5);
  const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
  grp.position.set(x, groundAt(x, z), z);
  grp.rotation.y = s.hd + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  parent.add(grp);
}

// 起点门楼（含倒计时灯）
function buildStartGate(parent, track, style) {
  const s = track.sample(0, {});
  const hw = track.halfW + 1.4;
  const grp = new THREE.Group();
  const H = style.h || 11;
  const pillarMat = std(style.pillar, { roughness: 0.5, metalness: style.metal || 0 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(style.pylon ? new THREE.CylinderGeometry(1.2, 2.2, H, 4) : new THREE.BoxGeometry(1.8, H, 1.8), pillarMat);
    if (style.pylon) p.rotation.y = Math.PI / 4;
    p.position.set(side * hw, H / 2, 0);
    grp.add(p);
    if (style.band) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.8, 2.3), std(style.band, { metalness: 0.4, roughness: 0.4 }));
      band.position.set(side * hw, H * 0.7, 0);
      grp.add(band);
    }
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2.4, 2.8, 1.6), std(style.beam, { roughness: 0.5, metalness: style.metal || 0 }));
  beam.position.y = H + 0.6;
  grp.add(beam);
  const bannerTex = TX.textTexture(style.text || 'START', { w: 1024, h: 128, bg: style.bannerBg || '#1d4fb0', fg: '#ffffff', font: 'italic 900 96px "Arial Black", Arial' });
  for (const zz of [0.81, -0.81]) {
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 1, 2.2), new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.35 }));
    bn.position.set(0, H + 0.6, zz);
    if (zz < 0) bn.rotation.y = Math.PI;
    grp.add(bn);
  }
  // 倒计时灯
  const lights = [];
  for (let k = 0; k < 4; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000, emissiveIntensity: 3 }));
    l.position.set((k - 1.5) * 2.2, H - 1.4, 0.9);
    grp.add(l);
    const l2 = l.clone();
    l2.material = l.material;
    l2.position.z = -0.9;
    grp.add(l2);
    lights.push(l);
  }
  if (style.sunDisk) {
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 32), std(0xf2c440, { metalness: 0.8, roughness: 0.25, emissive: 0x6b4a00, emissiveIntensity: 0.4 }));
    disk.rotation.x = Math.PI / 2;
    disk.position.y = H + 4.2;
    grp.add(disk);
    for (const sd of [-1, 1]) {
      const wing = new THREE.Shape();
      wing.moveTo(0, 0);
      wing.quadraticCurveTo(4, 2.2, 9, 1.4);
      wing.lineTo(8.4, 0.4);
      wing.quadraticCurveTo(4, 0.2, 0, -1.2);
      const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.3, bevelEnabled: false });
      const w = new THREE.Mesh(wg, std(0x3a62c9, { metalness: 0.3, roughness: 0.4 }));
      w.scale.set(sd, 1, 1);
      w.position.set(sd * 2, H + 3.8, -0.15);
      grp.add(w);
    }
    // 两侧神像柱头
    for (const sd of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 4), std(0x3a62c9, { metalness: 0.3 }));
      head.position.set(sd * hw, H + 2.2, 0);
      head.rotation.y = Math.PI / 4;
      grp.add(head);
    }
  }
  grp.position.set(s.x, s.y, s.z);
  grp.rotation.y = s.hd;
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  parent.add(grp);
  return {
    set(n) {
      // n: 0 全灭, 1..3 红灯依次亮, 4 绿灯
      lights.forEach((l, k) => {
        const on = n === 4 || k < n;
        l.material.color.setHex(n === 4 ? 0x22ff66 : on ? 0xff2222 : 0x331111);
        l.material.emissive.setHex(n === 4 ? 0x11ff55 : on ? 0xff1111 : 0x000000);
      });
    },
  };
}

// 漂浮吉祥物气球（11城原画里的小橘子气球）
function buildMascotBalloon(color = 0xff9a1f) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 18), std(color, { roughness: 0.35 }));
  head.scale.set(1.15, 1, 1);
  g.add(head);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), std(color, { roughness: 0.35 }));
    ear.position.set(sx * 2.6, 2.4, 0);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), std(0x1b1b1b, { roughness: 0.2 }));
    eye.position.set(sx * 1.1, 0.4, 2.8);
    g.add(eye);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), std(0xff5f7a));
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(sx * 2.0, -0.5, 2.5);
    g.add(cheek);
  }
  const face = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), std(0xfff3e0));
  face.scale.set(1.1, 0.8, 0.5);
  face.position.set(0, -0.6, 1.9);
  g.add(face);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 6, 12, Math.PI), std(0x7a2a1a));
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.6, 3.0);
  g.add(mouth);
  // 垂下的条纹旗
  const ribTex = geo('ribbonTex', () => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 512;
    const x = c.getContext('2d');
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#ff6a6a'; x.fillRect(0, i * 32, 64, 32); }
    x.fillStyle = '#ffd54a';
    x.fillRect(0, 0, 64, 40);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const rib = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 12), new THREE.MeshStandardMaterial({ map: ribTex, side: THREE.DoubleSide }));
  rib.position.y = -9;
  g.add(rib);
  return g;
}

function buildBlimp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 20), std(0x5b6fd6, { roughness: 0.4, metalness: 0.2 }));
  body.scale.set(1, 1, 3.2);
  g.add(body);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(6.05, 32, 20, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), std(0xffffff));
  stripe.scale.set(1, 1, 3.2);
  g.add(stripe);
  const tex = TX.textTexture('SPEED', { w: 512, h: 128, fg: '#ffffff', font: 'italic 900 100px "Arial Black", Arial', stroke: '#1d2d7a' });
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    t.position.set(sx * 6.1, 0.8, 0);
    t.rotation.y = sx * Math.PI / 2;
    g.add(t);
  }
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 6), std(0xe8e8f0));
  gondola.position.set(0, -6.4, 1);
  g.add(gondola);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 3.4), std(0xff6a3d));
    fin.position.set(0, 0, -17);
    fin.rotation.z = (k * Math.PI) / 2;
    fin.translateY(4);
    g.add(fin);
  }
  return g;
}

function buildSailboat(sailColor = 0xffffff) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.6, 7, 8, 1), std(0xffffff));
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1, 1, 0.5);
  g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 5), std(0x777777));
  mast.position.y = 4.5;
  g.add(mast);
  const sail = new THREE.Shape();
  sail.moveTo(0, 0.6);
  sail.lineTo(0, 8.8);
  sail.lineTo(3.4, 0.6);
  const sm = new THREE.Mesh(new THREE.ShapeGeometry(sail), std(sailColor, { side: THREE.DoubleSide }));
  sm.rotation.y = Math.PI / 2;
  sm.position.z = 0.1;
  g.add(sm);
  return g;
}

function buildHotAirBalloon(c1, c2) {
  const g = new THREE.Group();
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? c1 : c2; x.fillRect(i * 32, 0, 32, 64); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const env = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 18), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  env.scale.set(1, 1.15, 1);
  g.add(env);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 1.2, 4, 16, 1, true), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }));
  neck.position.y = -7.5;
  g.add(neck);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), std(0x8b5a2b));
  basket.position.y = -12;
  g.add(basket);
  return g;
}

function buildWindmill() {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 10, 16), std(0xfbfaf6));
  tower.position.y = 5;
  g.add(tower);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3.5, 16), std(0x2f6fc4));
  roof.position.y = 11.7;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.3), std(0x2466b8));
  door.position.set(0, 1.2, 3.5);
  g.add(door);
  const hub = new THREE.Group();
  hub.position.set(0, 10, 3.6);
  for (let k = 0; k < 6; k++) {
    const arm = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8, 0.2), std(0x8b6b4a));
    pole.position.y = 4;
    arm.add(pole);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 6.5), std(0xf2ecdc, { side: THREE.DoubleSide }));
    sail.position.set(0.95, 4.6, 0);
    arm.add(sail);
    arm.rotation.z = (k * Math.PI) / 3;
    hub.add(arm);
  }
  g.add(hub);
  g.userData.hub = hub;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// 白墙蓝顶小屋
function addAegeanHouse(b, x, y, z, w, h, d, rot, rnd) {
  const wallTex = TX.facadeTexture('aegean');
  const m = texMat('aegeanWall', wallTex, { roughness: 0.9 });
  const box = new THREE.BoxGeometry(w, h + 4, d);
  scaleBoxUV(box, w, h + 4, d, 9, 16);
  box.translate(0, (h + 4) / 2 - 4, 0);
  b.add(box, m, M(x, y, z, rot));
  const roof = new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4);
  roof.translate(0, h + 0.25, 0);
  b.add(roof, std(0xf7f6f2), M(x, y, z, rot));
  const r = rnd();
  if (r < 0.2) {
    const dome = geo('dome', () => new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    const ds = Math.min(w, d) * 0.38;
    b.add(dome, std(0x2a64c0, { roughness: 0.35 }), M(x, y + h + 0.5, z, rot, ds));
    const cross = geo('cross', () => { const g = new THREE.BoxGeometry(0.15, 1.2, 0.15); g.translate(0, 0.6, 0); return g; });
    b.add(cross, std(0xf2f2f2), M(x, y + h + 0.5 + ds, z, rot));
  } else if (r < 0.45) {
    // 屋顶小阁楼
    const top = new THREE.BoxGeometry(w * 0.5, h * 0.45, d * 0.5);
    scaleBoxUV(top, w * 0.5, h * 0.45, d * 0.5, 9, 16);
    top.translate(w * 0.2, h + h * 0.225 + 0.5, -d * 0.15);
    b.add(top, m, M(x, y, z, rot));
  } else if (r < 0.6) {
    // 蓝色栏杆露台 + 黄伞
    const um = geo('umb', () => { const g = new THREE.ConeGeometry(1.6, 0.8, 10); g.translate(0, 2.6, 0); return g; });
    b.add(um, std(0xffc93a), M(x + w * 0.2, y + h + 0.5, z, rot));
    const pole = geo('umbPole', () => { const g = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4); g.translate(0, 1.2, 0); return g; });
    b.add(pole, std(0x888888), M(x + w * 0.2, y + h + 0.5, z, rot));
  }
}

function scaleBoxUV(box, w, h, d, tw, th) {
  const uv = box.attributes.uv;
  // 面顺序: +x, -x, +y, -y, +z, -z
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.98); continue; }
      uv.setXY(i, uv.getX(i) * (dims[f][0] / tw), uv.getY(i) * (dims[f][1] / th));
    }
  }
}

function addBuilding(b, x, y, z, w, h, d, rot, kind, roofColor = 0x8f96a3) {
  const box = new THREE.BoxGeometry(w, h + 3, d);
  scaleBoxUV(box, w, h + 3, d, 12, 24);
  box.translate(0, (h + 3) / 2 - 3, 0);
  const tex = TX.facadeTexture(kind);
  b.add(box, texMat('facade' + kind, tex, { roughness: kind === 'glass' ? 0.25 : 0.8, metalness: kind === 'glass' ? 0.4 : 0 }), M(x, y, z, rot));
  const roof = new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6);
  roof.translate(0, h + 0.4, 0);
  b.add(roof, std(roofColor), M(x, y, z, rot));
}

// ---------- 各地图 ----------
export function buildProps(mapId, ctx) {
  const fn = { city: cityProps, aegean: aegeanProps, egypt: egyptProps, snow: snowProps }[mapId];
  return fn(ctx);
}

function alongTrack(track, step, fn, offset = 0) {
  const s = {};
  for (let d = offset; d < track.length; d += step) fn(track.sample(d, s), d);
}

function commonTrackside(ctx, opts) {
  const { track, batch, rnd, groundAt, parent } = ctx;
  const hw = track.halfW;
  if (opts.lamps)
    alongTrack(track, opts.lampStep || 48, (s) => {
      if (track.bridge[s.i] || track.inTunnel(s.d)) return;
      for (const side of [-1, 1]) {
        const lat = side * (hw + 2.2);
        const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
        if (!isFree(track, x, z, 1.5)) continue;
        addLamp(batch, x, Math.min(groundAt(x, z), s.y), z, s.hd + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
      }
    }, 10);
  if (opts.billboards) {
    let k = 0;
    alongTrack(track, opts.bbStep || 170, (s) => {
      const side = k++ % 2 ? 1 : -1;
      const lat = side * (hw + 12);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (!isFree(track, x, z, 8) || track.inTunnel(s.d)) return;
      const t = opts.billboards[k % opts.billboards.length];
      addBillboard(parent, batch, x, groundAt(x, z), z, s.hd + (side > 0 ? Math.PI / 2 + 0.35 : -Math.PI / 2 - 0.35), t);
    }, 60);
  }
  // 急弯外侧箭头牌
  if (opts.chevrons) {
    const tex = TX.chevronTexture(opts.chevronBg, opts.chevronFg);
    const mL = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    let last = -100;
    for (let i = 0; i < track.N; i += 3) {
      const c = track.curv[i];
      if (Math.abs(c) < 0.02 || i - last < 9) continue;
      last = i;
      const side = c > 0 ? 1 : -1; // 左弯外侧在右
      const s = track.sample(i * track.ds, {});
      const lat = side * (hw + 0.9);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), mL);
      sign.position.set(s.x + s.rx * lat, s.y + side * hw * Math.sin(s.bank) + 2.3, s.z + s.rz * lat);
      sign.rotation.y = s.hd + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (c > 0) sign.scale.x = -1;
      parent.add(sign);
      const post = geo('chevPost', () => { const g = new THREE.BoxGeometry(0.15, 2.4, 0.15); g.translate(0, 1.2, 0); return g; });
      batch.add(post, std(0x666666), M(sign.position.x, sign.position.y - 2.3 - 0.9, sign.position.z));
    }
  }
}

// ======================= 11城 =======================
function cityProps(ctx) {
  const { track, batch, rnd, groundAt, parent, updaters } = ctx;
  const hw = track.halfW;
  const B = track.bounds;
  // 楼群
  const kinds = ['glass', 'office', 'modern', 'glass'];
  for (let x = B.minX - 520; x < B.maxX + 520; x += 44)
    for (let z = B.minZ - 480; z < B.maxZ + 560; z += 44) {
      const px = x + (rnd() - 0.5) * 16, pz = z + (rnd() - 0.5) * 16;
      if (Math.abs(pz) < 70) continue; // 河道
      const north = pz > 60;
      if (rnd() > (north ? 0.8 : 0.45)) continue;
      const w = 14 + rnd() * 16, d = 14 + rnd() * 16;
      if (!isFree(track, px, pz, Math.max(w, d) * 0.75 + 12)) continue;
      const cd = Math.hypot(px - 60, pz - 380);
      let h = north ? 26 + rnd() * 60 + Math.max(0, 180 - cd * 0.35) : 12 + rnd() * 28;
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      addBuilding(batch, px, groundAt(px, pz), pz, w, h, d, rnd() < 0.7 ? 0 : rnd() * 0.5, kind, kind === 'glass' ? 0x5f7fa8 : 0x9aa0aa);
      if (h > 70 && rnd() < 0.5) {
        const ant = geo('antenna', () => { const g = new THREE.CylinderGeometry(0.2, 0.4, 14, 5); g.translate(0, 7, 0); return g; });
        batch.add(ant, std(0xd0d4dc, { metalness: 0.7 }), M(px, groundAt(px, pz) + h + 0.8, pz));
      }
    }
  // 地标：球顶大楼（原画右侧）
  {
    const spot = findFree(track, rnd, 150, 470, 60, 40);
    if (spot) {
      const gy = groundAt(spot[0], spot[1]);
      addBuilding(batch, spot[0], gy, spot[1], 36, 58, 30, 0.2, 'modern', 0xb7c3d6);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 20), std(0xd6e2f2, { metalness: 0.7, roughness: 0.2 }));
      ball.position.set(spot[0], gy + 74, spot[1]);
      ball.castShadow = true;
      parent.add(ball);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 10, 16), std(0x9fb3cc, { metalness: 0.5 }));
      neck.position.set(spot[0], gy + 62, spot[1]);
      parent.add(neck);
    }
  }
  // 公园树木
  for (let i = 0; i < 700; i++) {
    const x = B.minX - 300 + rnd() * (B.maxX - B.minX + 600);
    const z = B.minZ - 300 + rnd() * (B.maxZ - B.minZ + 600);
    if (Math.abs(z) < 58) continue;
    if (!isFree(track, x, z, 9)) continue;
    if (z > 60 && rnd() < 0.6) continue;
    addTree(batch, x, groundAt(x, z), z, 0.8 + rnd() * 0.7, rnd() * 6, rnd() < 0.3 ? 0x6fbf4a : 0x3f9e4a);
  }
  // 路边行道树
  alongTrack(track, 26, (s) => {
    if (track.bridge[s.i]) return;
    for (const side of [-1, 1]) {
      const lat = side * (hw + 9.5 + rnd() * 3);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (isFree(track, x, z, 7)) addTree(batch, x, groundAt(x, z), z, 0.9 + rnd() * 0.3, rnd() * 6);
    }
  }, 13);
  commonTrackside(ctx, {
    lamps: true,
    billboards: [
      TX.billboardTexture('SPEED', '极速飞车', '#ff6a00', '#ffc400'),
      TX.billboardTexture('N2O', '氮气加速', '#1565c0', '#27c7ff'),
      TX.billboardTexture('11城', 'CITY RACE', '#7b3df0', '#ff6fd8'),
      TX.billboardTexture('DRIFT', '漂移集气', '#e53935', '#ff8a65'),
    ],
  });
  addGrandstand(parent, batch, track.sample(track.length - 30, {}), -1, 60, hw, groundAt, 0x2e6fd6, track);
  addGrandstand(parent, batch, track.sample(40, {}), -1, 50, hw, groundAt, 0xe53935, track);

  // 塔桥（东侧跨河）
  buildTowerBridge(ctx, track.dAt(205, 0));
  // 西侧拱桥
  buildArchBridge(ctx, track.dAt(-262, 0), 0x2a8cff);

  // 飞艇与吉祥物气球
  const blimp = buildBlimp();
  parent.add(blimp);
  const balloons = [];
  const bcols = [0xff9a1f, 0xff7eb6, 0xffc21a, 0x6ad1ff, 0xff9a1f];
  for (let i = 0; i < 6; i++) {
    const b = buildMascotBalloon(bcols[i % bcols.length]);
    const s = track.sample((i / 6) * track.length + 40, {});
    const side = i % 2 ? 1 : -1;
    b.position.set(s.x + s.rx * side * (hw + 30), s.y + 38 + rnd() * 20, s.z + s.rz * side * (hw + 30));
    b.rotation.y = s.hd + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    b.userData.baseY = b.position.y;
    b.userData.ph = rnd() * 6;
    parent.add(b);
    balloons.push(b);
  }
  // 帆船
  const boats = [];
  for (let i = 0; i < 9; i++) {
    const bt = buildSailboat(i % 3 ? 0xffffff : 0xffd54a);
    const x = B.minX - 200 + rnd() * (B.maxX - B.minX + 400);
    const z = (rnd() - 0.5) * 50;
    if (Math.abs(x - 205) < 50 || Math.abs(x + 262) < 50) continue;
    bt.position.set(x, -1.5, z);
    bt.rotation.y = rnd() * 6;
    bt.userData.v = 2 + rnd() * 3;
    parent.add(bt);
    boats.push(bt);
  }
  updaters.push((dt, t) => {
    const r = 360;
    blimp.position.set(B.cx + Math.cos(t * 0.03) * r, 110, B.cz + Math.sin(t * 0.03) * r);
    blimp.rotation.y = -t * 0.03;
    for (const b of balloons) {
      b.position.y = b.userData.baseY + Math.sin(t * 0.8 + b.userData.ph) * 1.5;
      b.rotation.z = Math.sin(t * 0.6 + b.userData.ph) * 0.06;
    }
    for (const bt of boats) {
      bt.position.y = -1.5 + Math.sin(t * 1.3 + bt.userData.v) * 0.15;
      bt.rotation.z = Math.sin(t * 0.9 + bt.userData.v) * 0.05;
    }
  });
  return buildStartGate(parent, track, { pillar: 0xf2f4f8, beam: 0x1d4fb0, text: 'START · 11城', bannerBg: '#1d4fb0', band: 0xe53935, metal: 0.3 });
}

function findFree(track, rnd, x, z, r, spread, tries = 60) {
  for (let k = 0; k < tries; k++) {
    const px = x + (rnd() - 0.5) * spread * 2, pz = z + (rnd() - 0.5) * spread * 2;
    if (isFree(track, px, pz, r)) return [px, pz];
  }
  return null;
}

function buildTowerBridge(ctx, d) {
  const { track, parent } = ctx;
  const hw = track.halfW;
  const stone = std(0xc9c3dc, { roughness: 0.75 });
  const stoneDark = std(0xa9a2c2, { roughness: 0.8 });
  const roofM = std(0x4d5f96, { roughness: 0.4, metalness: 0.3 });
  const gold = std(0xe6b84a, { metalness: 0.8, roughness: 0.3 });
  const glass = std(0x9fd3ff, { emissive: 0x2a7bd6, emissiveIntensity: 0.5 });
  const grp = new THREE.Group();
  const towers = [];
  for (const off of [-28, 28]) {
    const s = track.sample(d + off, {});
    const tw = new THREE.Group();
    tw.position.set(s.x, s.y, s.z);
    tw.rotation.y = s.hd;
    const baseY = -8 - s.y;
    for (const side of [-1, 1]) {
      const px = side * (hw + 4.2);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(7, 44 - baseY, 9), stone);
      pier.position.set(px, (44 + baseY) / 2, 0);
      tw.add(pier);
      // 哥特窗
      for (let k = 0; k < 4; k++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 1.6), glass);
        win.position.set(px - side * 3.55, 16 + k * 6.5, 0);
        tw.add(win);
      }
      // 角楼尖塔
      for (const cz of [-3.8, 3.8])
        for (const cx of [-2.8, 2.8]) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 8, 10), stoneDark);
          t.position.set(px + cx, 47, cz);
          tw.add(t);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 10), roofM);
          cone.position.set(px + cx, 53.5, cz);
          tw.add(cone);
          const fin = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), gold);
          fin.position.set(px + cx, 56.3, cz);
          tw.add(fin);
        }
      // 圆顶
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), roofM);
      dome.position.set(px, 44, 0);
      tw.add(dome);
    }
    // 桥门上方连接体 + 尖拱
    const gate = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2, 9, 7), stone);
    gate.position.set(0, 17.5, 0);
    tw.add(gate);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(hw + 1, 1.2, 8, 24, Math.PI), stoneDark);
    arch.position.set(0, 11, 0);
    arch.scale.set(1, 0.5, 1);
    tw.add(arch);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.4), new THREE.MeshStandardMaterial({ map: TX.textTexture('SPEEDQQ.COM', { w: 512, h: 96, bg: '#ff6a00', fg: '#fff', font: 'bold 60px Arial' }), emissive: 0x552200 }));
    sign.position.set(0, 17.5, -3.6);
    sign.rotation.y = Math.PI;
    tw.add(sign);
    const sign2 = sign.clone();
    sign2.position.z = 3.6;
    sign2.rotation.y = 0;
    tw.add(sign2);
    tw.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    grp.add(tw);
    towers.push(tw);
  }
  // 高空人行廊桥（两条）+ 桁架
  const s0 = track.sample(d - 28, {}), s1 = track.sample(d + 28, {});
  const len = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  const mid = track.sample(d, {});
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, len), std(0x8fa3c9, { metalness: 0.5, roughness: 0.4 }));
    walk.position.set(mid.x + mid.rx * side * (hw + 4.2), mid.y + 36, mid.z + mid.rz * side * (hw + 4.2));
    walk.rotation.y = Math.atan2(s1.x - s0.x, s1.z - s0.z);
    walk.castShadow = true;
    grp.add(walk);
  }
  // 悬索（从塔顶垂向两岸）
  const cableM = std(0x7f8fb8, { metalness: 0.6 });
  for (const side of [-1, 1]) {
    for (const [dd, dir] of [[d - 28, -1], [d + 28, 1]]) {
      const a = track.sample(dd, {});
      const b = track.sample(dd + dir * 70, {});
      const pa = new THREE.Vector3(a.x + a.rx * side * (hw + 4.2), a.y + 30, a.z + a.rz * side * (hw + 4.2));
      const pb = new THREE.Vector3(b.x + b.rx * side * (hw + 4.2), b.y + 12, b.z + b.rz * side * (hw + 4.2));
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(5, 14 + b.y + 6, 5), stone);
      anchor.position.set(pb.x, pb.y - (14 + b.y + 6) / 2 + 1.5, pb.z);
      anchor.rotation.y = b.hd;
      anchor.castShadow = true;
      grp.add(anchor);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3, 4), roofM);
      cap.position.set(pb.x, pb.y + 3, pb.z);
      cap.rotation.y = b.hd + Math.PI / 4;
      grp.add(cap);
      const pm = pa.clone().lerp(pb, 0.5);
      pm.y -= 4;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pa, pm, pb), 16, 0.5, 6), cableM);
      grp.add(tube);
    }
  }
  parent.add(grp);
}

function buildArchBridge(ctx, d, color) {
  const { track, parent } = ctx;
  const hw = track.halfW;
  const m = std(color, { metalness: 0.5, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const s = track.sample(d - 50 + t * 100, {});
      const lat = side * (hw + 1.2);
      pts.push(new THREE.Vector3(s.x + s.rx * lat, s.y + 1.2 + Math.sin(t * Math.PI) * 20, s.z + s.rz * lat));
      if (k % 3 === 0 && k > 0 && k < 24) {
        const h = Math.sin(t * Math.PI) * 20;
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 5), std(0xdddddd));
        hanger.position.set(s.x + s.rx * lat, s.y + 1.2 + h / 2, s.z + s.rz * lat);
        parent.add(hanger);
      }
    }
    const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.9, 8), m);
    arch.castShadow = true;
    parent.add(arch);
  }
  // 拱顶横梁
  for (const t of [0.35, 0.5, 0.65]) {
    const s = track.sample(d - 50 + t * 100, {});
    const beam = new THREE.Mesh(new THREE.BoxGeometry((hw + 1.2) * 2, 0.8, 0.8), m);
    beam.position.set(s.x, s.y + 1.2 + Math.sin(t * Math.PI) * 20, s.z);
    beam.rotation.y = s.hd;
    parent.add(beam);
  }
}

// ======================= 情迷爱琴海 =======================
function aegeanProps(ctx) {
  const { track, batch, rnd, groundAt, parent, updaters } = ctx;
  const hw = track.halfW;
  const B = track.bounds;
  // 房屋
  let n = 0;
  for (let i = 0; i < 2600 && n < 420; i++) {
    const x = B.minX - 260 + rnd() * (B.maxX - B.minX + 520);
    const z = -150 + rnd() * (B.maxZ + 300);
    const w = 6 + rnd() * 8, d = 6 + rnd() * 8, h = 4 + rnd() * 6;
    if (!isFree(track, x, z, Math.max(w, d) * 0.72 + 5)) continue;
    const gy = Math.min(groundAt(x - w / 2, z - d / 2), groundAt(x + w / 2, z + d / 2), groundAt(x, z));
    const nt = track.nearest(x, z, 80);
    const rot = nt ? track.hd[nt.i] + (rnd() < 0.5 ? 0 : Math.PI / 2) : rnd() * 3;
    addAegeanHouse(batch, x, gy, z, w, h, d, rot, rnd);
    n++;
  }
  // 教堂
  for (let k = 0; k < 4; k++) {
    const spot = findFree(track, rnd, -200 + k * 160, 60 + (k % 2) * 180, 16, 90);
    if (!spot) continue;
    const [x, z] = spot;
    const gy = groundAt(x, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 16), texMat('aegeanWall', TX.facadeTexture('aegean')));
    body.position.set(x, gy + 3.5, z);
    parent.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), std(0x2a64c0, { roughness: 0.3 }));
    dome.position.set(x, gy + 8, z);
    parent.add(dome);
    const bell = new THREE.Mesh(new THREE.BoxGeometry(3.4, 14, 3.4), std(0xfbfaf6));
    bell.position.set(x + 7, gy + 7, z - 6);
    parent.add(bell);
    const bdome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x2a64c0));
    bdome.position.set(x + 7, gy + 14, z - 6);
    parent.add(bdome);
    for (const o of [body, dome, bell, bdome]) { o.castShadow = true; o.receiveShadow = true; }
  }
  // 风车（山脊）
  const mills = [];
  for (let k = 0; k < 6; k++) {
    const spot = findFree(track, rnd, -150 + k * 90, 390 + rnd() * 30, 12, 30);
    if (!spot) continue;
    const w = buildWindmill();
    w.position.set(spot[0], groundAt(spot[0], spot[1]) - 0.5, spot[1]);
    w.rotation.y = Math.PI + (rnd() - 0.5) * 0.6;
    parent.add(w);
    mills.push(w);
  }
  // 柏树与橄榄树
  const cyp = geo('cypress', () => { const g = new THREE.SphereGeometry(1, 8, 6); g.scale(1.1, 4.2, 1.1); g.translate(0, 4.6, 0); return g; });
  for (let i = 0; i < 520; i++) {
    const x = B.minX - 260 + rnd() * (B.maxX - B.minX + 520);
    const z = -160 + rnd() * (B.maxZ + 320);
    if (!isFree(track, x, z, 5)) continue;
    const gy = groundAt(x, z);
    if (rnd() < 0.55) batch.add(cyp, flat(0x2f5a2c), M(x, gy, z, 0, 0.7 + rnd() * 0.6));
    else addTree(batch, x, gy, z, 0.6 + rnd() * 0.4, rnd() * 6, 0x8a9a5b);
  }
  // 三角梅花丛 + 花盆（贴着护栏外侧）
  const bush = geo('bush', () => new THREE.IcosahedronGeometry(1.4, 1));
  const pot = geo('pot', () => { const g = new THREE.CylinderGeometry(0.55, 0.4, 0.9, 10); g.translate(0, 0.45, 0); return g; });
  const potPlant = geo('potPlant', () => { const g = new THREE.IcosahedronGeometry(0.6, 1); g.translate(0, 1.3, 0); return g; });
  alongTrack(track, 14, (s) => {
    if (track.inTunnel(s.d)) return;
    for (const side of [-1, 1]) {
      const lat = side * (hw + 1.9);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (!isFree(track, x, z, 1)) continue;
      const y = s.y + side * hw * Math.sin(s.bank);
      const r = rnd();
      if (r < 0.35) {
        batch.add(bush, flat(r < 0.2 ? 0xff4fa3 : 0xe8458f), M(x, y + 1.3, z, rnd() * 3, 1, 0.9 + rnd() * 0.4, 1));
        batch.add(bush, flat(0x4f8f3a), M(x + s.tx * 1.4, y + 0.9, z + s.tz * 1.4, 0, 0.8));
      } else if (r < 0.6) {
        batch.add(pot, std(0xc0643a), M(x, y, z));
        batch.add(potPlant, flat(rnd() < 0.5 ? 0x5aa843 : 0xff7fbf), M(x, y, z));
      }
    }
  }, 5);
  commonTrackside(ctx, {
    chevrons: true, chevronBg: '#ffd000', chevronFg: '#1a1a1a',
    billboards: [TX.billboardTexture('AEGEAN', '情迷爱琴海', '#1d63c9', '#5ab0ff'), TX.billboardTexture('SPEED', '极速飞车', '#ff8a00', '#ffd54a')],
    bbStep: 260,
  });
  // 海滩遮阳伞
  const umb = geo('beachUmb', () => { const g = new THREE.ConeGeometry(2.2, 1.0, 12); g.translate(0, 3.2, 0); return g; });
  const umbPole = geo('beachPole', () => { const g = new THREE.CylinderGeometry(0.06, 0.06, 3, 5); g.translate(0, 1.5, 0); return g; });
  for (let x = -320; x < 260; x += 16 + rnd() * 10) {
    const z = -198 - rnd() * 8;
    if (!isFree(track, x, z, 3)) continue;
    const gy = groundAt(x, z);
    if (gy < -0.8) continue;
    batch.add(umb, std([0xffc93a, 0xff6a6a, 0x3aa0ff][(rnd() * 3) | 0]), M(x, gy, z));
    batch.add(umbPole, std(0xdddddd), M(x, gy, z));
  }
  // 灯塔 + 礁石
  {
    const x = 360, z = -300;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(22, 1), flat(0x9a8f7c));
    rock.scale.set(1, 0.45, 1);
    rock.position.set(x, -4, z);
    parent.add(rock);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 26, 16), std(0xffffff));
    tower.position.set(x, 18, z);
    parent.add(tower);
    for (let k = 0; k < 3; k++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.9 - k * 0.3, 3.0 - k * 0.3, 2.4, 16), std(0x2a64c0));
      band.position.set(x, 10 + k * 7, z);
      parent.add(band);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 12), glow(0xfff2a8, 2));
    lamp.position.set(x, 32.4, z);
    parent.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.4, 12), std(0x2a64c0));
    cap.position.set(x, 34.9, z);
    parent.add(cap);
  }
  const boats = [];
  for (let i = 0; i < 10; i++) {
    const bt = buildSailboat(i % 2 ? 0xffffff : 0x5ab0ff);
    bt.position.set(-500 + rnd() * 1000, -1, -300 - rnd() * 500);
    bt.rotation.y = rnd() * 6;
    bt.scale.setScalar(1.3);
    bt.userData.p = rnd() * 6;
    parent.add(bt);
    boats.push(bt);
  }
  updaters.push((dt, t) => {
    for (const m of mills) m.userData.hub.rotation.z = t * 0.9;
    for (const b of boats) { b.position.y = -1 + Math.sin(t + b.userData.p) * 0.25; b.rotation.z = Math.sin(t * 0.8 + b.userData.p) * 0.06; }
  });
  addGrandstand(parent, batch, track.sample(track.length - 36, {}), 1, 50, hw, groundAt, 0x2a64c0, track);
  return buildStartGate(parent, track, { pillar: 0xf7f5f0, beam: 0xf7f5f0, text: 'START · AEGEAN', bannerBg: '#2a64c0', band: 0x2a64c0 });
}

// ======================= 法老金字塔 =======================
function egyptProps(ctx) {
  const { track, batch, rnd, groundAt, parent } = ctx;
  const hw = track.halfW;
  const B = track.bounds;
  const pyrTex = geo('pyrTex', () => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#d9b271';
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 16) {
      g.fillStyle = 'rgba(120,80,40,0.35)';
      g.fillRect(0, y, 512, 3);
      for (let x = (y / 16) % 2 ? 0 : 24; x < 512; x += 48) { g.fillStyle = 'rgba(110,70,30,0.25)'; g.fillRect(x, y, 2, 16); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 4);
    return t;
  });
  const pyrMat = new THREE.MeshStandardMaterial({ map: pyrTex, roughness: 0.95, flatShading: true });
  const pyramids = [[-560, 80, 150], [-700, -260, 120], [640, 330, 130], [560, -520, 110], [-420, 560, 90], [120, 720, 140]];
  for (const [x, z, h] of pyramids) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(h * 0.95, h, 4, 1), pyrMat);
    p.position.set(x, groundAt(x, z) + h / 2 - 3, z);
    p.rotation.y = Math.PI / 4 + rnd() * 0.3;
    p.castShadow = true;
    parent.add(p);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.1, h * 0.105, 4), std(0xf2c440, { metalness: 0.8, roughness: 0.3 }));
    cap.position.set(x, p.position.y + h / 2 - h * 0.052, z);
    cap.rotation.y = p.rotation.y;
    parent.add(cap);
  }
  // 内场 SPEED 金字塔
  {
    const spot = findFree(track, rnd, 150, 60, 60, 50) || [150, 60];
    const [x, z] = spot;
    const h = 60;
    const p = new THREE.Mesh(new THREE.ConeGeometry(h * 0.95, h, 4, 1), pyrMat);
    p.position.set(x, groundAt(x, z) + h / 2 - 2, z);
    p.rotation.y = Math.PI / 4;
    p.castShadow = true;
    parent.add(p);
    const t = TX.textTexture('SPEED', { w: 512, h: 128, fg: '#7a4b1c', font: 'bold 110px Georgia, serif' });
    for (let k = 0; k < 4; k++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 1 }));
      const a = (k * Math.PI) / 2;
      const r = h * 0.95 * Math.SQRT1_2 * 0.52 + 0.6;
      pl.position.set(x + Math.sin(a) * r, groundAt(x, z) + h * 0.45, z + Math.cos(a) * r);
      pl.rotation.set(0, a, 0);
      pl.rotateX(-Math.atan2(h * 0.95 * Math.SQRT1_2, h));
      parent.add(pl);
    }
  }
  // 方尖碑沿直道
  const obel = geo('obelisk', () => { const g = new THREE.CylinderGeometry(0.9, 1.5, 16, 4); g.rotateY(Math.PI / 4); g.translate(0, 8, 0); return g; });
  const obelTop = geo('obeliskTop', () => { const g = new THREE.ConeGeometry(1.25, 2, 4); g.rotateY(Math.PI / 4); g.translate(0, 17, 0); return g; });
  alongTrack(track, 36, (s) => {
    if (Math.abs(track.curv[s.i]) > 0.006 || track.inTunnel(s.d)) return;
    for (const side of [-1, 1]) {
      const lat = side * (hw + 4);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (!isFree(track, x, z, 2.5) || rnd() < 0.4) continue;
      const gy = groundAt(x, z);
      batch.add(obel, std(0xd8b476, { roughness: 0.9 }), M(x, gy, z, s.hd));
      batch.add(obelTop, std(0xf2c440, { metalness: 0.8, roughness: 0.3 }), M(x, gy, z, s.hd));
    }
  }, 8);
  // 神殿柱廊
  const colG = geo('col', () => { const g = new THREE.CylinderGeometry(1.4, 1.6, 12, 12); g.translate(0, 6, 0); return g; });
  const capG = geo('colCap', () => { const g = new THREE.CylinderGeometry(2.2, 1.4, 2, 12); g.translate(0, 13, 0); return g; });
  for (const dd of [track.dAt(0, -140), track.dAt(0, -262)]) {
    for (let k = -3; k <= 3; k++) {
      const s = track.sample(dd + k * 9, {});
      for (const side of [-1, 1]) {
        const lat = side * (hw + 6);
        const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
        if (!isFree(track, x, z, 3)) continue;
        const gy = groundAt(x, z);
        batch.add(colG, std(0xe0c08a, { roughness: 0.9 }), M(x, gy, z));
        batch.add(capG, std(0x3a62c9, { roughness: 0.6 }), M(x, gy, z));
      }
    }
  }
  // 有翼狮身像（起点两侧，参考原画）
  const sgate = track.sample(22, {});
  for (const side of [-1, 1]) {
    const lat = side * (hw + 7);
    const x = sgate.x + sgate.rx * lat, z = sgate.z + sgate.rz * lat;
    const sp = buildSphinx();
    sp.position.set(x, groundAt(x, z), z);
    sp.rotation.y = sgate.hd + Math.PI + side * 0.5;
    parent.add(sp);
  }
  // 棕榈与绿洲
  const oases = ctx.oases || [];
  for (const [ox, oz, r] of oases) {
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, rr = r + 4 + rnd() * 14;
      const x = ox + Math.cos(a) * rr, z = oz + Math.sin(a) * rr;
      if (!isFree(track, x, z, 4)) continue;
      addPalm(batch, x, groundAt(x, z), z, 0.9 + rnd() * 0.5, rnd() * 6);
    }
  }
  for (let i = 0; i < 360; i++) {
    const x = B.minX - 300 + rnd() * (B.maxX - B.minX + 600);
    const z = B.minZ - 300 + rnd() * (B.maxZ - B.minZ + 600);
    if (!isFree(track, x, z, 5)) continue;
    if (rnd() < 0.5) continue;
    addPalm(batch, x, groundAt(x, z), z, 0.8 + rnd() * 0.5, rnd() * 6);
  }
  alongTrack(track, 30, (s) => {
    for (const side of [-1, 1]) {
      const lat = side * (hw + 6 + rnd() * 5);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (isFree(track, x, z, 4) && rnd() < 0.45) addPalm(batch, x, groundAt(x, z), z, 0.9 + rnd() * 0.4, rnd() * 6);
    }
  }, 15);
  // 仙人掌/岩石
  const rock = geo('rockE', () => new THREE.IcosahedronGeometry(2, 0));
  for (let i = 0; i < 260; i++) {
    const x = B.minX - 400 + rnd() * (B.maxX - B.minX + 800);
    const z = B.minZ - 400 + rnd() * (B.maxZ - B.minZ + 800);
    if (!isFree(track, x, z, 4)) continue;
    batch.add(rock, flat(0xc79a5c), M(x, groundAt(x, z), z, rnd() * 6, 0.6 + rnd() * 1.8, 0.4 + rnd(), 0.6 + rnd() * 1.5));
  }
  commonTrackside(ctx, {
    chevrons: true, chevronBg: '#5b3f9e', chevronFg: '#f3e3b5',
    billboards: [TX.billboardTexture('PHARAOH', '法老金字塔', '#5b3f9e', '#e8c547'), TX.billboardTexture('SPEED', '沙漠飞跃', '#e0861f', '#ffd54a')],
    bbStep: 240,
  });
  return buildStartGate(parent, track, { pillar: 0xe0c08a, beam: 0xe0c08a, text: 'START · PHARAOH', bannerBg: '#5b3f9e', band: 0x3a62c9, pylon: true, sunDisk: true, h: 12 });
}

function buildSphinx() {
  const g = new THREE.Group();
  const stone = std(0xe2c48a, { roughness: 0.85 });
  const gold = std(0xf2c440, { metalness: 0.7, roughness: 0.3 });
  const blue = std(0x2f4fb0, { roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 10), std(0xcfae72));
  base.position.y = 1;
  g.add(base);
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 7), stone);
  body.position.set(0, 3.5, -0.8);
  g.add(body);
  for (const sx of [-1.2, 1.2]) {
    const paw = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 3.2), stone);
    paw.position.set(sx, 2.5, 3.6);
    g.add(paw);
  }
  const chest = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4, 2.4), stone);
  chest.position.set(0, 5, 2.2);
  g.add(chest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), stone);
  head.position.set(0, 8.2, 2.4);
  g.add(head);
  // 头巾（蓝金条纹）
  const nemes = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 3.6, 4, 1), gold);
  nemes.rotation.y = Math.PI / 4;
  nemes.position.set(0, 8.1, 2.0);
  g.add(nemes);
  for (let k = 0; k < 3; k++) {
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.5 + k * 0.28, 1.6 + k * 0.28, 0.35, 4, 1), blue);
    stripe.rotation.y = Math.PI / 4;
    stripe.position.set(0, 9.4 - k * 1.0, 2.0);
    g.add(stripe);
  }
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2, 0.4), stone);
  face.position.set(0, 8.0, 3.45);
  g.add(face);
  // 翅膀
  for (const sd of [-1, 1]) {
    const w = new THREE.Shape();
    w.moveTo(0, 0);
    w.quadraticCurveTo(2, 6, 1, 10);
    w.lineTo(-1.2, 8.5);
    w.quadraticCurveTo(-1.5, 4, -3, 0);
    const wg = new THREE.ExtrudeGeometry(w, { depth: 0.4, bevelEnabled: false });
    const wing = new THREE.Mesh(wg, gold);
    wing.rotation.y = Math.PI / 2;
    wing.position.set(sd * 2.1, 4, 0.5);
    wing.rotation.z = sd * 0.25;
    g.add(wing);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(1.3);
  return g;
}

// ======================= 雪地大冒险 =======================
function snowProps(ctx) {
  const { track, batch, rnd, groundAt, parent, updaters } = ctx;
  const hw = track.halfW;
  const B = track.bounds;
  for (let i = 0; i < 1500; i++) {
    const x = B.minX - 420 + rnd() * (B.maxX - B.minX + 840);
    const z = B.minZ - 420 + rnd() * (B.maxZ - B.minZ + 840);
    if (!isFree(track, x, z, 6)) continue;
    addPine(batch, x, groundAt(x, z) - 0.3, z, 0.8 + rnd() * 0.9, rnd() * 6, rnd() < 0.85);
  }
  alongTrack(track, 18, (s) => {
    for (const side of [-1, 1]) {
      const lat = side * (hw + 5 + rnd() * 6);
      const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
      if (isFree(track, x, z, 4) && rnd() < 0.6 && !track.bridge[s.i]) addPine(batch, x, groundAt(x, z) - 0.3, z, 0.8 + rnd() * 0.5, rnd() * 6);
    }
  }, 9);
  commonTrackside(ctx, {
    lamps: true, lampStep: 60,
    billboards: [TX.billboardTexture('SPEED', '雪地大冒险', '#1e4fb0', '#39c5ff'), TX.billboardTexture('Victory', '冲刺吧！', '#c62828', '#ff7a59')],
    bbStep: 200,
  });
  addGrandstand(parent, batch, track.sample(track.length - 40, {}), 1, 70, hw, groundAt, 0xc62828, track);
  addGrandstand(parent, batch, track.sample(30, {}), -1, 60, hw, groundAt, 0x1e4fb0, track);
  // 奖杯（原画中央）
  {
    const s = track.sample(70, {});
    const lat = hw + 22;
    const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
    const gy = groundAt(x, z);
    const grp = new THREE.Group();
    const gold = std(0xf2c440, { metalness: 0.9, roughness: 0.2, emissive: 0x3a2800, emissiveIntensity: 0.4 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 4, 24), std(0x2a3b66));
    ped.position.y = 2;
    grp.add(ped);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 5, 16), gold);
    stem.position.y = 6.5;
    grp.add(stem);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(4, 1.2, 6, 24, 1, true), gold);
    cup.position.y = 12;
    cup.material.side = THREE.DoubleSide;
    grp.add(cup);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.35, 8, 16, Math.PI * 1.2), gold);
      h.position.set(sx * 4.2, 12, 0);
      h.rotation.z = sx > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
      grp.add(h);
    }
    const starS = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 1.2 : 2.8, a = (k / 10) * Math.PI * 2 + Math.PI / 2;
      if (k === 0) starS.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starS.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starS, { depth: 0.6, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2 }), gold);
    star.position.y = 19;
    grp.add(star);
    grp.position.set(x, gy, z);
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    parent.add(grp);
    updaters.push((dt, t) => { star.rotation.y = t * 1.2; });
  }
  // 雪人
  for (let k = 0; k < 12; k++) {
    const s = track.sample(rnd() * track.length, {});
    const side = rnd() < 0.5 ? -1 : 1;
    const lat = side * (hw + 5);
    const x = s.x + s.rx * lat, z = s.z + s.rz * lat;
    if (!isFree(track, x, z, 3)) continue;
    const gy = groundAt(x, z);
    const white = std(0xffffff, { roughness: 0.9 });
    const sp = geo('snowball', () => new THREE.SphereGeometry(1, 14, 10));
    batch.add(sp, white, M(x, gy + 1.2, z, 0, 1.4));
    batch.add(sp, white, M(x, gy + 3.2, z, 0, 1.0));
    batch.add(sp, white, M(x, gy + 4.6, z, 0, 0.7));
    const nose = geo('carrot', () => { const g = new THREE.ConeGeometry(0.15, 0.8, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.9); return g; });
    batch.add(nose, std(0xff7a1a), M(x, gy + 4.6, z, s.hd + (side > 0 ? -Math.PI / 2 : Math.PI / 2)));
    const hat = geo('hat', () => { const g = new THREE.CylinderGeometry(0.5, 0.5, 0.8, 10); g.translate(0, 5.6, 0); return g; });
    batch.add(hat, std(0xc62828), M(x, gy, z));
  }
  // 小木屋
  for (let k = 0; k < 16; k++) {
    const spot = findFree(track, rnd, B.cx + (rnd() - 0.5) * 700, B.cz + (rnd() - 0.5) * 700, 16, 20);
    if (!spot) continue;
    const [x, z] = spot;
    const gy = groundAt(x, z);
    const w = 8 + rnd() * 4, d = 7 + rnd() * 3, h = 4 + rnd() * 2;
    const box = new THREE.BoxGeometry(w, h + 2, d);
    scaleBoxUV(box, w, h + 2, d, 6, 12);
    box.translate(0, (h + 2) / 2 - 2, 0);
    const rot = rnd() * 3;
    batch.add(box, texMat('lodge', TX.facadeTexture('lodge')), M(x, gy, z, rot));
    const roof = new THREE.CylinderGeometry(0.01, (Math.max(w, d) / 2) * 1.2, 3.2, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
    roof.translate(0, h + 1.6, 0);
    batch.add(roof, std(0xf4f8ff), M(x, gy, z, rot));
  }
  // 热气球
  const balloons = [];
  const pal = [['#ff5252', '#ffd740'], ['#40c4ff', '#ffffff'], ['#69f0ae', '#ff80ab'], ['#b388ff', '#ffd740'], ['#ff9800', '#ffffff'], ['#e040fb', '#40c4ff']];
  for (let k = 0; k < 7; k++) {
    const b = buildHotAirBalloon(...pal[k % pal.length]);
    const s = track.sample((k / 7) * track.length + 30, {});
    const side = k % 2 ? 1 : -1;
    b.position.set(s.x + s.rx * side * (hw + 45 + rnd() * 60), s.y + 50 + rnd() * 40, s.z + s.rz * side * (hw + 45 + rnd() * 60));
    b.userData.by = b.position.y;
    b.userData.p = rnd() * 6;
    parent.add(b);
    balloons.push(b);
  }
  updaters.push((dt, t) => {
    for (const b of balloons) { b.position.y = b.userData.by + Math.sin(t * 0.5 + b.userData.p) * 3; b.rotation.y = t * 0.1 + b.userData.p; }
  });
  // 雪花
  if (ctx.quality !== 'low') {
    const count = 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (rnd() - 0.5) * 160; pos[i * 3 + 1] = rnd() * 60; pos[i * 3 + 2] = (rnd() - 0.5) * 160; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, map: TX.softDotTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
    pts.frustumCulled = false;
    parent.add(pts);
    updaters.push((dt, t, cam) => {
      const p = g.attributes.position.array;
      for (let i = 0; i < count; i++) {
        p[i * 3 + 1] -= dt * (4 + (i % 7));
        p[i * 3] += Math.sin(t + i) * dt * 0.8;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 60;
      }
      g.attributes.position.needsUpdate = true;
      pts.position.set(cam.x, cam.y - 20, cam.z);
    });
  }
  return buildStartGate(parent, track, { pillar: 0xf4f8ff, beam: 0x1e4fb0, text: 'START · SNOW', bannerBg: '#c62828', band: 0x39c5ff, metal: 0.2 });
}

export { clamp };
