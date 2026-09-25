import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, smoothstep, lerp, mulberry32, loft, DynamicTube, v3, paint, normalizeForMerge, TAU } from './util.js';
import {
  makeDetailTexture,
  makeRoadTextures,
  makeSignTexture,
  makeSpriteTexture,
  makeStripeTexture,
} from './textures.js';
import { waveHeight, SEA_LEVEL } from './ocean.js';

export const CHUNK = 72;
const NCHUNK = 7;
const perlin = new ImprovedNoise();

function fbm2(x, z, oct, seed = 0) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * perlin.noise(x * f, z * f, seed + i * 7.31);
    a *= 0.5;
    f *= 2.03;
  }
  return s;
}

// 地形高度：z>0 山丘，z<0 沙滩渐入海
export function terrainHeight(x, z) {
  if (z >= 0) {
    const t = smoothstep(3.8, 28, z);
    const big = 2.5 + 17 * smoothstep(16, 115, z);
    const n = fbm2(x * 0.013, z * 0.013, 4, 1.3);
    const small = fbm2(x * 0.085, z * 0.085, 2, 5.1);
    return -0.06 + t * Math.max(0, big * (0.62 + 1.1 * n) + small * 1.3);
  }
  const s = -z;
  const u = smoothstep(3.2, 30, s);
  const dunes = fbm2(x * 0.07, z * 0.07, 2, 9.7) * 0.5 * smoothstep(3.6, 6.5, s) * (1 - smoothstep(9, 13.5, s));
  return -0.08 - u * 3.9 + dunes;
}

function terrainNormal(x, z, out) {
  const e = 0.6;
  const hx = terrainHeight(x - e, z) - terrainHeight(x + e, z);
  const hz = terrainHeight(x, z - e) - terrainHeight(x, z + e);
  return out.set(hx, 2 * e, hz).normalize();
}

const C = (h) => new THREE.Color(h);
const COL = {
  grassA: C('#5d8a34'),
  grassB: C('#93b453'),
  grassDry: C('#b8b064'),
  rock: C('#8c867c'),
  dirt: C('#9a8866'),
  sand: C('#ead7a6'),
  sandWet: C('#b89f74'),
  sandDeep: C('#7d6c52'),
  gravel: C('#8f877a'),
};

function terrainColor(x, z, h, n, out) {
  if (z >= 0) {
    const v = fbm2(x * 0.05, z * 0.05, 3, 3.3) + 0.5;
    out.copy(COL.grassA).lerp(COL.grassB, clamp(v, 0, 1));
    out.lerp(COL.grassDry, smoothstep(9, 22, h) * 0.55);
    out.lerp(COL.dirt, 1 - smoothstep(3.6, 6.5, z));
    out.lerp(COL.rock, smoothstep(0.86, 0.7, n.y));
  } else {
    const s = -z;
    out.copy(COL.gravel).lerp(COL.sand, smoothstep(3.2, 4.2, s));
    out.lerp(COL.sandWet, smoothstep(-1.1, -1.55, h));
    out.lerp(COL.sandDeep, smoothstep(-1.7, -2.6, h));
    const g = fbm2(x * 0.3, z * 0.3, 2, 2.2) * 0.12;
    out.offsetHSL(0, 0, g);
  }
  return out;
}

// 非均匀的 z 采样：近路密，远处疏
function terrainZs() {
  const zs = [];
  for (let z = -34; z < -16; z += 2) zs.push(z);
  for (let z = -16; z < -3.4; z += 0.7) zs.push(z);
  zs.push(-3.3, -2.9, 2.9, 3.4, 3.8);
  for (let z = 4.6; z < 22; z += 1.2) zs.push(z);
  for (let z = 22; z < 60; z += 2.4) zs.push(z);
  for (let z = 60; z <= 136; z += 4) zs.push(z);
  return zs;
}

function buildTerrainGeometry() {
  const xs = [];
  for (let x = 0; x <= CHUNK; x += 2) xs.push(x);
  const zs = terrainZs();
  const n = xs.length * zs.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const idx = [];
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + nx;
      // z 递增：保证正面朝上
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  g.setIndex(idx);
  g.userData = { xs, zs };
  return g;
}

const _n = new THREE.Vector3();
const _c = new THREE.Color();
// 先算高度网格（含左右各一列外扩），法线用邻格中心差分，避免重复采样噪声
function fillTerrain(g, x0) {
  const { xs, zs } = g.userData;
  const nx = xs.length;
  const nz = zs.length;
  const W = nx + 2;
  const H = g.userData.hbuf || (g.userData.hbuf = new Float32Array(W * nz));
  const step = xs[1] - xs[0];
  for (let j = 0; j < nz; j++) {
    for (let i = -1; i <= nx; i++) H[j * W + i + 1] = terrainHeight(x0 + i * step, zs[j]);
  }
  const P = g.attributes.position.array;
  const N = g.attributes.normal.array;
  const Cc = g.attributes.color.array;
  const U = g.attributes.uv.array;
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(nz - 1, j + 1);
    const dz = zs[j1] - zs[j0];
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      const wx = x0 + x;
      const h = H[j * W + i + 1];
      const dhx = (H[j * W + i + 2] - H[j * W + i]) / (2 * step);
      const dhz = (H[j1 * W + i + 1] - H[j0 * W + i + 1]) / dz;
      _n.set(-dhx, 1, -dhz).normalize();
      terrainColor(wx, z, h, _n, _c);
      P[k * 3] = x;
      P[k * 3 + 1] = h;
      P[k * 3 + 2] = z;
      N[k * 3] = _n.x;
      N[k * 3 + 1] = _n.y;
      N[k * 3 + 2] = _n.z;
      Cc[k * 3] = _c.r;
      Cc[k * 3 + 1] = _c.g;
      Cc[k * 3 + 2] = _c.b;
      U[k * 2] = wx / 9;
      U[k * 2 + 1] = z / 9;
      k++;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeBoundingSphere();
}

// ---------------- 植被与道具几何 ----------------
function jitter(geo, amt, seed) {
  const r = mulberry32(seed);
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) {
      d = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt];
      map.set(key, d);
    }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function roundTreeGeometry() {
  const trunk = paint(normalizeForMerge(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 7).translate(0, 0.9, 0)), '#6e4a2e');
  const parts = [trunk];
  const blobs = [
    [0, 2.35, 0, 1.25],
    [0.62, 2.0, 0.3, 0.85],
    [-0.5, 2.1, -0.35, 0.9],
    [0.1, 2.95, 0.1, 0.8],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    const b = jitter(new THREE.IcosahedronGeometry(r, 1), r * 0.22, 11 + i);
    b.translate(x, y, z);
    parts.push(paint(normalizeForMerge(b), i % 2 ? '#4f7f2c' : '#5f9134'));
  });
  return mergeGeometries(parts);
}

function pineGeometry() {
  const parts = [paint(normalizeForMerge(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 6).translate(0, 0.6, 0)), '#5a3b24')];
  const layers = [
    [1.0, 1.35, 1.7],
    [1.75, 1.05, 1.5],
    [2.45, 0.75, 1.3],
    [3.05, 0.45, 1.0],
  ];
  layers.forEach(([y, r, h], i) => {
    const c = jitter(new THREE.ConeGeometry(r, h, 8, 1), 0.08, 30 + i);
    c.translate(0, y + h / 2, 0);
    parts.push(paint(normalizeForMerge(c), i % 2 ? '#2f5d34' : '#386b3a'));
  });
  return mergeGeometries(parts);
}

function palmGeometry() {
  const parts = [];
  // 弯曲树干
  const tube = new DynamicTube(18, 8, (t) => lerp(0.2, 0.12, t) * (1 + 0.12 * Math.max(0, Math.sin(t * 60))));
  const top = v3(1.1, 5.6, 0.2);
  tube.update([v3(0, 0, 0), v3(0.15, 1.8, 0), v3(0.55, 3.8, 0.1), top]);
  const tg = tube.geometry.clone();
  parts.push(paint(normalizeForMerge(tg), '#8a6a45'));
  // 树冠叶片
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const ang = (i / fronds) * TAU + (i % 2) * 0.2;
    const len = 2.3 + (i % 3) * 0.35;
    const lift = i % 2 ? 0.55 : 0.25;
    const leaf = loft({
      segs: 14,
      ring: 4,
      center: (t) => v3(t * len, Math.sin(t * Math.PI * 0.75) * lift - t * t * 1.35, 0),
      section: (t, a) => {
        const w = Math.sin(Math.PI * Math.pow(t, 0.7)) * 0.38 + 0.02;
        const s = a * 2 - 1;
        return [-Math.abs(s) * w * 0.35 + 0.01, s * w];
      },
    });
    leaf.rotateY(ang);
    leaf.translate(top.x, top.y, top.z);
    parts.push(paint(normalizeForMerge(leaf), i % 2 ? '#3f7d2e' : '#4f9136'));
  }
  for (let i = 0; i < 4; i++) {
    const s = new THREE.SphereGeometry(0.14, 8, 6);
    const a = (i / 4) * TAU;
    s.translate(top.x + Math.cos(a) * 0.18, top.y - 0.18, top.z + Math.sin(a) * 0.18);
    parts.push(paint(normalizeForMerge(s), '#5b3d1f'));
  }
  return mergeGeometries(parts);
}

function rockGeometry() {
  const g = jitter(new THREE.DodecahedronGeometry(0.8, 1), 0.35, 77);
  g.scale(1.2, 0.7, 1);
  return paint(normalizeForMerge(g), '#9a938a');
}

function umbrellaGeometry() {
  const parts = [];
  parts.push(paint(normalizeForMerge(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6).translate(0, 1.1, 0)), '#dddddd'));
  const cone = new THREE.ConeGeometry(1.25, 0.45, 12, 1, true).toNonIndexed();
  cone.translate(0, 2.2, 0);
  // 每个扇区交替条纹
  const pos = cone.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const a = C('#ffffff');
  const b = C('#e0413b');
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const sector = Math.floor(((Math.atan2(cz, cx) + Math.PI) / TAU) * 12);
    const c = sector % 2 ? a : b;
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
  cone.computeVertexNormals();
  parts.push(normalizeForMerge(cone));
  const towel = new THREE.BoxGeometry(1.8, 0.02, 0.9).translate(0.4, 0.02, 1.0);
  parts.push(paint(normalizeForMerge(towel), '#f5f0e0'));
  return mergeGeometries(parts);
}

// 共享的静态结构：护栏、人行道、路灯（每个分块相同）
function guardrailGeometry() {
  const parts = [];
  for (let x = 0; x < CHUNK; x += 2.4) {
    parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(0.08, 0.8, 0.08).translate(x + 1.2, 0.4, -3.05)), '#f0f0ec'));
  }
  parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(CHUNK, 0.07, 0.04).translate(CHUNK / 2, 0.74, -3.0)), '#d9dcdf'));
  parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(CHUNK, 0.05, 0.04).translate(CHUNK / 2, 0.42, -3.0)), '#d9dcdf'));
  // 路缘石
  parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(CHUNK, 0.1, 0.25).translate(CHUNK / 2, 0.02, -2.82)), '#bdb8ae'));
  parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(CHUNK, 0.16, 1.0).translate(CHUNK / 2, 0.06, 3.3)), '#c9c3b8'));
  parts.push(paint(normalizeForMerge(new THREE.BoxGeometry(CHUNK, 0.18, 0.12).translate(CHUNK / 2, 0.07, 2.82)), '#e6e1d6'));
  return mergeGeometries(parts);
}

const LAMP_X = [12, 48];
function lampGeometry() {
  const parts = [];
  for (const x of LAMP_X) {
    parts.push(normalizeForMerge(new THREE.CylinderGeometry(0.06, 0.1, 5.2, 10).translate(x, 2.66, 3.45)));
    const arm = new DynamicTube(12, 6, () => 0.045);
    arm.update([v3(x, 5.1, 3.45), v3(x, 5.55, 3.2), v3(x, 5.6, 2.55), v3(x, 5.45, 2.0)]);
    parts.push(normalizeForMerge(arm.geometry.clone()));
    parts.push(normalizeForMerge(new THREE.CylinderGeometry(0.12, 0.26, 0.2, 12).translate(x, 5.36, 1.95)));
    parts.push(normalizeForMerge(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10).translate(x, 0.17, 3.45)));
  }
  return paint(mergeGeometries(parts), '#3a4046');
}

function bulbGeometry() {
  const parts = [];
  for (const x of LAMP_X) {
    const s = new THREE.SphereGeometry(0.17, 16, 8, 0, TAU, Math.PI / 2, Math.PI / 2);
    s.scale(1, 0.5, 1).translate(x, 5.27, 1.95);
    parts.push(normalizeForMerge(s));
  }
  return mergeGeometries(parts);
}

function poolGeometry() {
  const parts = [];
  for (const x of LAMP_X) {
    const c = new THREE.CircleGeometry(3.4, 32);
    c.rotateX(-Math.PI / 2);
    c.scale(1.25, 1, 1);
    c.translate(x, 0.03, 1.3);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

function signGeometry() {
  const post = paint(normalizeForMerge(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8).translate(0, 1.15, 0)), '#9aa0a6');
  return post;
}

// ---------------- 世界 ----------------
export function createWorld(scene, opts) {
  const group = new THREE.Group();
  scene.add(group);
  const time = { value: 0 };

  const detail = makeDetailTexture(256, 0.8, 1.0, 3);
  detail.repeat.set(1, 1);
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.95,
    metalness: 0,
  });

  const road = makeRoadTextures();
  road.map.repeat.set(CHUNK / 24, 1);
  road.bump.repeat.set(CHUNK / 24, 1);
  const roadMat = new THREE.MeshStandardMaterial({
    map: road.map,
    bumpMap: road.bump,
    bumpScale: 1.2,
    roughness: 0.82,
    metalness: 0.02,
  });
  const roadGeo = new THREE.PlaneGeometry(CHUNK, 5.64);
  roadGeo.rotateX(-Math.PI / 2);
  roadGeo.translate(CHUNK / 2, 0.005, 0);

  const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffc27a'), emissiveIntensity: 0 });
  const sprite = makeSpriteTexture();
  const poolMat = new THREE.MeshBasicMaterial({
    map: sprite,
    color: new THREE.Color('#ffb467'),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // 风吹摇摆（实例化植被）
  const addSway = (mat, amount, start) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float sw = pow(max(position.y - ${start.toFixed(1)}, 0.0), 1.4);
            transformed.x += sin(uTime * 1.3 + ip.x * 0.31 + ip.z * 0.17) * sw * ${amount.toFixed(3)};
            transformed.z += cos(uTime * 1.1 + ip.x * 0.23) * sw * ${(amount * 0.6).toFixed(3)};
          #endif`,
        );
    };
  };
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  addSway(treeMat, 0.018, 1.4);
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  addSway(palmMat, 0.03, 3.0);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const umbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });

  const G = {
    round: roundTreeGeometry(),
    pine: pineGeometry(),
    palm: palmGeometry(),
    rock: rockGeometry(),
    umb: umbrellaGeometry(),
    guard: guardrailGeometry(),
    lamp: lampGeometry(),
    bulb: bulbGeometry(),
    pool: poolGeometry(),
    signPost: signGeometry(),
  };
  const signMats = ['crossing', 'speed', 'fish'].map(
    (k) => new THREE.MeshStandardMaterial({ map: makeSignTexture(k), transparent: true, alphaTest: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
  );
  const signPlate = new THREE.PlaneGeometry(1.1, 1.1);
  signPlate.rotateY(-Math.PI / 2);

  const density = opts.density ?? 1;
  const MAX = { round: Math.round(34 * density), pine: Math.round(26 * density), palm: 6, rock: 8, umb: 2 };

  const chunks = [];
  for (let i = 0; i < NCHUNK; i++) {
    const cg = new THREE.Group();
    const tGeo = buildTerrainGeometry();
    const terrain = new THREE.Mesh(tGeo, terrainMat);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    const guard = new THREE.Mesh(G.guard, staticMat);
    guard.castShadow = true;
    guard.receiveShadow = true;
    const lamps = new THREE.Mesh(G.lamp, lampMat);
    lamps.castShadow = true;
    const bulbs = new THREE.Mesh(G.bulb, bulbMat);
    const pools = new THREE.Mesh(G.pool, poolMat);
    pools.renderOrder = 2;
    cg.add(terrain, roadMesh, guard, lamps, bulbs, pools);
    const inst = {};
    const mk = (key, mat, cast = true) => {
      const m = new THREE.InstancedMesh(G[key], mat, MAX[key]);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX[key] * 3), 3);
      cg.add(m);
      inst[key] = m;
    };
    mk('round', treeMat);
    mk('pine', treeMat);
    mk('palm', palmMat);
    mk('rock', rockMat);
    mk('umb', umbMat);
    const sign = new THREE.Group();
    const post = new THREE.Mesh(G.signPost, staticMat);
    post.castShadow = true;
    const plate = new THREE.Mesh(signPlate, signMats[0]);
    plate.position.set(-0.03, 2.05, 0);
    plate.castShadow = true;
    sign.add(post, plate);
    sign.position.set(30, 0.14, 3.55);
    cg.add(sign);
    group.add(cg);
    chunks.push({ index: -99, group: cg, terrain, inst, sign, plate });
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _e = new THREE.Euler();
  const tint = new THREE.Color();

  function rebuild(ch, index) {
    ch.index = index;
    const x0 = index * CHUNK;
    fillTerrain(ch.terrain.geometry, x0);
    const rnd = mulberry32(index * 9973 + 17);
    const place = (key, n, zmin, zmax, sMin, sMax, test) => {
      const m = ch.inst[key];
      let c = 0;
      for (let tries = 0; tries < n * 4 && c < n; tries++) {
        const x = rnd() * CHUNK;
        const z = lerp(zmin, zmax, Math.pow(rnd(), key === 'round' || key === 'pine' ? 1.6 : 1));
        const wx = x0 + x;
        const h = terrainHeight(wx, z);
        terrainNormal(wx, z, _n);
        if (test && !test(x, z, h, _n)) continue;
        const s = lerp(sMin, sMax, rnd());
        _e.set(0, rnd() * TAU, 0);
        _q.setFromEuler(_e);
        _s.set(s, s * lerp(0.85, 1.2, rnd()), s);
        _p.set(x, h - 0.05, z);
        _m.compose(_p, _q, _s);
        m.setMatrixAt(c, _m);
        tint.setHSL(lerp(-0.03, 0.05, rnd()), lerp(0.0, 0.25, rnd()), lerp(0.85, 1.1, rnd()));
        m.setColorAt(c, tint);
        c++;
      }
      m.count = c;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    };
    const flatEnough = (x, z, h, n) => n.y > 0.8;
    place('round', MAX.round, 7, 125, 0.8, 1.6, (x, z, h, n) => flatEnough(x, z, h, n) && perlin.noise((x0 + x) * 0.03, z * 0.03, 4.2) > -0.15);
    place('pine', MAX.pine, 16, 130, 0.9, 1.7, (x, z, h, n) => n.y > 0.75 && h > 4);
    place('palm', MAX.palm, -5.2, -11.5, 0.8, 1.1, (x) => Math.abs(x - 30) > 2);
    place('rock', MAX.rock, -30, 60, 0.3, 1.1, (x, z) => Math.abs(z) > 4.5 && (z < -12 || z > 5));
    place('umb', rnd() < 0.7 ? 2 : 0, -7, -11, 0.9, 1.05);
    // 棕榈统一朝海倾斜
    const pm = ch.inst.palm;
    for (let i = 0; i < pm.count; i++) {
      pm.getMatrixAt(i, _m);
      _m.decompose(_p, _q, _s);
      const lean = (rnd() - 0.5) * 0.3;
      _e.set(0, Math.PI / 2 + 0.3 + lean, 0.0);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      pm.setMatrixAt(i, _m);
    }
    pm.instanceMatrix.needsUpdate = true;
    // 遮阳伞颜色更饱和
    const um = ch.inst.umb;
    for (let i = 0; i < um.count; i++) {
      tint.setHSL(rnd(), 0.7, 0.62);
      um.setColorAt(i, tint);
    }
    if (um.instanceColor) um.instanceColor.needsUpdate = true;

    const showSign = index % 2 === 1;
    ch.sign.visible = showSign;
    if (showSign) ch.plate.material = signMats[Math.abs(Math.floor(index / 2)) % signMats.length];
  }

  // ---------- 灯塔小岛 ----------
  const lighthouse = new THREE.Group();
  {
    const island = jitter(new THREE.ConeGeometry(16, 7, 14, 3), 1.6, 5);
    island.translate(0, 1.2, 0);
    const isl = new THREE.Mesh(island, new THREE.MeshStandardMaterial({ color: '#6f6a5f', roughness: 1, flatShading: true }));
    isl.receiveShadow = true;
    const grass = new THREE.Mesh(
      jitter(new THREE.SphereGeometry(7, 12, 6, 0, TAU, 0, Math.PI / 2.4), 0.8, 8).scale(1, 0.35, 1).translate(0, 4.2, 0),
      new THREE.MeshStandardMaterial({ color: '#6f8f3a', roughness: 1, flatShading: true }),
    );
    const stripes = makeStripeTexture(['#f4f1ea', '#c9302c'], 6);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.7, 13, 24, 1),
      new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }),
    );
    tower.position.y = 11;
    tower.castShadow = true;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.25, 24), new THREE.MeshStandardMaterial({ color: '#2b2f33' }));
    gallery.position.y = 17.6;
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 1.6, 16),
      new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0.4, roughness: 0.2 }),
    );
    lantern.position.y = 18.5;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 16), new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.5 }));
    cap.position.y = 20;
    // 夜间旋转光束（加法混合的锥体）
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uNight: { value: 0 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = uv.y; vec4 wp = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `uniform float uNight; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = pow(vY, 2.6) * edge * uNight * 0.32; gl_FragColor = vec4(vec3(1.0,0.86,0.55)*a, a); }`,
    });
    const beamGeo = new THREE.ConeGeometry(5, 90, 24, 1, true);
    beamGeo.translate(0, -45, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const beam = new THREE.Group();
    const b1 = new THREE.Mesh(beamGeo, beamMat);
    const b2 = new THREE.Mesh(beamGeo, beamMat);
    b2.rotation.y = Math.PI;
    beam.add(b1, b2);
    beam.position.y = 18.5;
    lighthouse.add(isl, grass, tower, gallery, lantern, cap, beam);
    lighthouse.userData = { beam, lantern, beamMat };
    lighthouse.position.set(0, SEA_LEVEL - 0.5, -118);
    scene.add(lighthouse);
  }

  // ---------- 帆船 ----------
  const boats = [];
  {
    const hullGeo = loft({
      segs: 16,
      ring: 12,
      center: (t) => v3((t - 0.5) * 6, 0, 0),
      section: (t, a) => {
        const th = a * TAU;
        const w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.6) * 1.1 + 0.02;
        const c = Math.cos(th);
        return [c > 0 ? c * 0.5 : c * 0.9, Math.sin(th) * w];
      },
      color: (t, a, c) => c.set(Math.cos(a * TAU) > 0.2 ? '#f4f4f0' : '#1f4f7a'),
    });
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 7);
    sailShape.quadraticCurveTo(1.6, 3.5, 3.4, 0.2);
    sailShape.closePath();
    const sailGeo = new THREE.ShapeGeometry(sailShape, 8);
    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0);
    jibShape.lineTo(0, 6.2);
    jibShape.lineTo(-2.4, 0.2);
    jibShape.closePath();
    const jibGeo = new THREE.ShapeGeometry(jibShape);
    const colors = ['#ffffff', '#ffd166', '#ef476f', '#ffffff', '#8ecae6'];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 8, 6), new THREE.MeshStandardMaterial({ color: '#dcdcdc' }));
      mast.position.set(0.3, 4.2, 0);
      const sailMat = new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide, roughness: 0.8 });
      const sail = new THREE.Mesh(sailGeo, sailMat);
      sail.position.set(0.3, 0.9, 0);
      sail.rotation.y = Math.PI;
      const jib = new THREE.Mesh(jibGeo, new THREE.MeshStandardMaterial({ color: '#f7f7f2', side: THREE.DoubleSide }));
      jib.position.set(0.5, 0.9, 0);
      jib.rotation.y = Math.PI;
      b.add(hull, mast, sail, jib);
      const s = 0.9 + i * 0.12;
      b.scale.setScalar(s);
      b.userData = { ax: 60 + i * 170, z: -42 - i * 34, period: 900, phase: i * 1.3, drift: 0.6 + i * 0.25 };
      scene.add(b);
      boats.push(b);
    }
  }

  // ---------- 飞鸟：海鸥与鹈鹕编队（实例化） ----------
  function birdSet(count, { body, wing, wingMat, bodyMat, shoulder }) {
    const bodies = new THREE.InstancedMesh(body, bodyMat, count);
    const wl = new THREE.InstancedMesh(wing, wingMat, count);
    const wr = new THREE.InstancedMesh(wing, wingMat, count);
    for (const m of [bodies, wl, wr]) {
      m.frustumCulled = false;
      m.castShadow = false;
      scene.add(m);
    }
    return { bodies, wl, wr, count, shoulder };
  }
  const gullBody = mergeGeometries([
    paint(normalizeForMerge(new THREE.SphereGeometry(1, 12, 8).scale(0.24, 0.075, 0.08)), '#fbfbfb'),
    paint(normalizeForMerge(new THREE.SphereGeometry(0.06, 10, 8).translate(0.22, 0.03, 0)), '#ffffff'),
    paint(normalizeForMerge(new THREE.ConeGeometry(0.018, 0.08, 6).rotateZ(-Math.PI / 2).translate(0.3, 0.025, 0)), '#f2c230'),
    paint(normalizeForMerge(new THREE.ConeGeometry(0.06, 0.16, 6).rotateZ(Math.PI / 2).translate(-0.28, 0.0, 0).scale(1, 0.4, 1)), '#e8e8e8'),
  ]);
  const wingGeo = (len, chord, tipColor, baseColor, tipFrac) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, chord * 0.2);
    sh.quadraticCurveTo(len * 0.5, chord * 0.35, len, -chord * 0.05);
    sh.lineTo(len * 0.8, -chord * 0.45);
    sh.quadraticCurveTo(len * 0.4, -chord * 0.9, 0, -chord * 0.8);
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 6);
    g.rotateX(-Math.PI / 2); // 形状 Y -> -Z
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const tc = C(tipColor);
    const bc = C(baseColor);
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) / len;
      const c = t > tipFrac ? tc : bc;
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // 翼展沿 +Z（右翼）
    g.rotateY(-Math.PI / 2);
    return g;
  };
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  const birdBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const gulls = birdSet(9, { body: gullBody, wing: wingGeo(0.55, 0.16, '#222222', '#b9c0c7', 0.72), wingMat, bodyMat: birdBodyMat, shoulder: 0.02 });
  gulls.params = [];
  for (let i = 0; i < gulls.count; i++) {
    gulls.params.push({ cx: (i - 4) * 7, cy: 7 + (i % 3) * 2.5, cz: -12 - (i % 4) * 7, rx: 9 + i, rz: 4 + (i % 3) * 2, w: 0.12 + i * 0.013, ph: i * 1.7, flap: 5.5 + (i % 3), s: 0.9 + (i % 3) * 0.15 });
  }
  const pelBody = mergeGeometries([
    paint(normalizeForMerge(new THREE.SphereGeometry(1, 14, 10).scale(0.5, 0.16, 0.17)), '#f6f3ec'),
    paint(normalizeForMerge(new THREE.SphereGeometry(0.11, 10, 8).translate(0.44, 0.06, 0)), '#f6f3ec'),
    paint(normalizeForMerge(new THREE.ConeGeometry(0.045, 0.55, 8).rotateZ(-Math.PI / 2).scale(1, 1, 0.7).translate(0.8, 0.02, 0)), '#f2b24a'),
    paint(normalizeForMerge(new THREE.SphereGeometry(0.05, 8, 6).scale(4, 1, 1).translate(0.72, -0.05, 0)), '#f6c85f'),
  ]);
  const pelFlock = birdSet(3, { body: pelBody, wing: wingGeo(1.3, 0.38, '#161616', '#f4f1ea', 0.55), wingMat, bodyMat: birdBodyMat, shoulder: 0.0 });

  const _bm = new THREE.Matrix4();
  const _wm = new THREE.Matrix4();
  const _lm = new THREE.Matrix4();
  const _bq = new THREE.Quaternion();
  const _wq = new THREE.Quaternion();
  const _bs = new THREE.Vector3();
  const _bp = new THREE.Vector3();
  const _be = new THREE.Euler();
  function setBird(set, i, pos, yaw, bank, flap, scale) {
    _be.set(bank, yaw, 0, 'YXZ');
    _bq.setFromEuler(_be);
    _bs.setScalar(scale);
    _bm.compose(pos, _bq, _bs);
    set.bodies.setMatrixAt(i, _bm);
    // 右翼（+Z）绕 X 轴拍打，左翼镜像
    _wq.setFromAxisAngle(_axisX, -flap);
    _lm.compose(_bp.set(0.02, 0.03, 0.05), _wq, _one);
    _wm.multiplyMatrices(_bm, _lm);
    set.wr.setMatrixAt(i, _wm);
    _wq.setFromAxisAngle(_axisX, Math.PI + flap);
    _lm.compose(_bp.set(0.02, 0.03, -0.05), _wq, _one);
    _wm.multiplyMatrices(_bm, _lm);
    set.wl.setMatrixAt(i, _wm);
  }
  const _axisX = new THREE.Vector3(1, 0, 0);
  const _one = new THREE.Vector3(1, 1, 1);
  const _gp = new THREE.Vector3();

  // ---------- 萤火虫（夜间） ----------
  const FF = 160;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3);
  const ffSeed = new Float32Array(FF);
  const rr = mulberry32(5);
  for (let i = 0; i < FF; i++) {
    ffPos[i * 3] = rr() * 200 - 60;
    ffPos[i * 3 + 1] = 0.4 + rr() * 2.6;
    ffPos[i * 3 + 2] = 4.5 + rr() * 22;
    ffSeed[i] = rr() * 100;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
  const ffMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: time, uNight: { value: 0 }, uOffset: { value: 0 }, uScale: { value: 400 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform float uOffset; uniform float uScale; varying float vA;
      void main(){ vec3 p = position; p.x = mod(p.x - uOffset + 60.0, 200.0) - 60.0;
        p.x += sin(uTime*0.7 + aSeed)*0.6; p.y += sin(uTime*0.9 + aSeed*1.3)*0.35; p.z += cos(uTime*0.6 + aSeed*0.7)*0.6;
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        vA = pow(0.5 + 0.5*sin(uTime*2.2 + aSeed*3.0), 3.0);
        gl_PointSize = 0.12 * uScale / -mv.z; }`,
    fragmentShader: `uniform float uNight; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.75,1.0,0.35)*2.5, a*vA*uNight); }`,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  function update(distance, dt, t, env) {
    time.value = t;
    // 分块回收
    const base = Math.floor(distance / CHUNK) - 3;
    for (let k = 0; k < NCHUNK; k++) {
      const want = base + k;
      const slot = ((want % NCHUNK) + NCHUNK) % NCHUNK;
      const ch = chunks[slot];
      if (ch.index !== want) rebuild(ch, want);
      ch.group.position.x = want * CHUNK - distance;
    }
    const night = env.night;
    bulbMat.emissiveIntensity = lerp(0.0, 6.0, smoothstep(0.15, 0.6, night));
    poolMat.opacity = smoothstep(0.2, 0.7, night) * 0.5;

    // 灯塔
    const lp = 1600;
    lighthouse.position.x = ((((330 - distance + 420) % lp) + lp) % lp) - 420;
    const ud = lighthouse.userData;
    ud.beam.rotation.y = t * 0.9;
    ud.beamMat.uniforms.uNight.value = smoothstep(0.2, 0.8, night);
    ud.lantern.material.emissiveIntensity = lerp(0.4, 8, smoothstep(0.2, 0.7, night));

    // 帆船随波起伏
    for (const b of boats) {
      const u = b.userData;
      const ax = u.ax + t * u.drift;
      b.position.x = ((((ax - distance + 300) % u.period) + u.period) % u.period) - 300;
      const wx = b.position.x + distance;
      const h = waveHeight(wx, u.z, t, env.waveAmp);
      const hF = waveHeight(wx + 2.5, u.z, t, env.waveAmp);
      const hS = waveHeight(wx, u.z + 1.2, t, env.waveAmp);
      b.position.y = h + 0.15;
      b.position.z = u.z;
      b.rotation.z = Math.atan2(hF - h, 2.5) * 0.8;
      b.rotation.x = -Math.atan2(hS - h, 1.2) * 0.8 + Math.sin(t * 0.8 + u.phase) * 0.04;
    }

    // 海鸥：绕着骑手附近的海面盘旋
    for (let i = 0; i < gulls.count; i++) {
      const p = gulls.params[i];
      const a = t * p.w + p.ph;
      _gp.set(p.cx + Math.sin(a) * p.rx + 6, p.cy + Math.sin(a * 2.3) * 1.2, p.cz + Math.cos(a) * p.rz);
      const vx = Math.cos(a) * p.rx;
      const vz = -Math.sin(a) * p.rz;
      const yaw = Math.atan2(-vz, vx);
      const glide = Math.sin(t * 0.5 + p.ph) > 0.2;
      const flap = glide ? 0.12 + Math.sin(t * 1.5 + i) * 0.05 : Math.sin(t * p.flap + p.ph) * 0.6;
      setBird(gulls, i, _gp, yaw, -Math.sin(a) * 0.35, flap, p.s);
    }
    for (const m of [gulls.bodies, gulls.wl, gulls.wr]) m.instanceMatrix.needsUpdate = true;

    // 鹈鹕 V 字编队，缓慢掠过海面
    const fx = ((t * 3.2) % 560) - 260;
    for (let i = 0; i < 3; i++) {
      const off = i === 0 ? 0 : 2.6;
      const side = i === 1 ? -1 : 1;
      _gp.set(fx - off, 5.5 + Math.sin(t * 0.6 + i) * 0.35 + (i ? 0.4 : 0), -22 + (i ? side * 2.4 : 0));
      const flap = Math.sin(t * 2.4 - i * 0.6) * 0.38 * (Math.sin(t * 0.25) > -0.3 ? 1 : 0.15);
      setBird(pelFlock, i, _gp, 0, Math.sin(t * 0.4 + i) * 0.06, flap, 1.0);
    }
    for (const m of [pelFlock.bodies, pelFlock.wl, pelFlock.wr]) m.instanceMatrix.needsUpdate = true;

    ffMat.uniforms.uNight.value = smoothstep(0.35, 0.9, night);
    ffMat.uniforms.uOffset.value = distance % 200;
  }

  function lampPositions(distance, out) {
    // 返回离骑手最近的两盏路灯的位置（用于夜间动态点光源）
    const period = 36;
    const base = Math.floor((distance - 12) / period) * period + 12;
    out[0].set(base - distance, 5.2, 1.95);
    out[1].set(base + period - distance, 5.2, 1.95);
    return out;
  }

  return { group, update, lampPositions, ffMat, terrainHeight, chunks };
}
