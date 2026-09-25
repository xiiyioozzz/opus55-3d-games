import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, makeNoise2D } from './util.js';
import { groundTexture, cloudTexture } from './textures.js';

// ---------- 合批：同材质 + 同地块的静态物件合并成一个网格 ----------
const prepCache = new WeakMap();
function prep(geo) {
  let g = prepCache.get(geo);
  if (g) return g;
  g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  prepCache.set(geo, g);
  return g;
}

export class Batch {
  constructor(tile = 260) {
    this.tile = tile;
    this.groups = new Map();
  }
  add(geo, mat, matrix, shadow = true) {
    const g = prep(geo).clone();
    g.applyMatrix4(matrix);
    const e = matrix.elements;
    const key = `${mat.uuid}|${Math.floor(e[12] / this.tile)}|${Math.floor(e[14] / this.tile)}|${shadow ? 1 : 0}`;
    let grp = this.groups.get(key);
    if (!grp) this.groups.set(key, (grp = { mat, geos: [], shadow }));
    grp.geos.push(g);
  }
  build(parent) {
    for (const grp of this.groups.values()) {
      const merged = mergeGeometries(grp.geos, false);
      grp.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, grp.mat);
      mesh.castShadow = grp.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
export function M(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ---------- 天空 ----------
export function buildSky(cfg) {
  const sunDir = new THREE.Vector3(...cfg.sun).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(cfg.top) },
      horizon: { value: new THREE.Color(cfg.horizon) },
      bottom: { value: new THREE.Color(cfg.bottom) },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color(cfg.sunColor) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h,0.0,1.0), 0.4));
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return { sky, sunDir };
}

export function buildClouds(rnd, center, count = 26) {
  const grp = new THREE.Group();
  const tex = cloudTexture();
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 900 + rnd() * 1500;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true, opacity: 0.8 + rnd() * 0.2, depthWrite: false }));
    const s = 220 + rnd() * 380;
    sp.scale.set(s, s * 0.45, 1);
    sp.position.set(center.x + Math.cos(a) * r, 180 + rnd() * 380, center.z + Math.sin(a) * r);
    grp.add(sp);
  }
  return grp;
}

// ---------- 地形：基础地形 + 按赛道削填 ----------
export function buildGround(track, cfg) {
  const { base, size = 3200, seg = 320, flatR, texture, colorAt, repeat = 26 } = cfg;
  const cx = track.bounds.cx, cz = track.bounds.cz;
  const n = seg + 1;
  const cell = size / seg;
  const x0 = cx - size / 2, z0 = cz - size / 2;
  const H = new Float32Array(n * n);
  const lo = new Float32Array(n * n).fill(-1e9);
  const hi = new Float32Array(n * n).fill(1e9);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = base(x0 + i * cell, z0 + j * cell);
  const R = flatR + cell + 48;
  const slope = 0.55;
  const flat = flatR + cell * 0.7;
  for (let k = 0; k < track.N; k++) {
    const px = track.px[k], pz = track.pz[k], ty = track.py[k] - 0.6;
    const fill = !track.bridge[k];
    const i0 = Math.max(0, Math.floor((px - R - x0) / cell)), i1 = Math.min(seg, Math.ceil((px + R - x0) / cell));
    const j0 = Math.max(0, Math.floor((pz - R - z0) / cell)), j1 = Math.min(seg, Math.ceil((pz + R - z0) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i * cell - px, dz = z0 + j * cell - pz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > R) continue;
        const kk = Math.max(0, dist - flat) * slope;
        const id = j * n + i;
        if (ty + kk < hi[id]) hi[id] = ty + kk;
        if (fill && ty - kk * 1.2 > lo[id]) lo[id] = ty - kk * 1.2;
      }
  }
  for (let id = 0; id < n * n; id++) {
    let h = H[id];
    if (h > hi[id]) h = hi[id];
    if (h < lo[id]) h = Math.min(lo[id], hi[id]);
    H[id] = h;
  }
  const heightAt = (x, z) => {
    const fx = clamp((x - x0) / cell, 0, seg - 0.001), fz = clamp((z - z0) / cell, 0, seg - 0.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  };
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v) + cx, z = pos.getZ(v) + cz;
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
    const h = H[clamp(j, 0, seg) * n + clamp(i, 0, seg)];
    pos.setXYZ(v, x, h, z);
    col.set(0xffffff);
    if (colorAt) colorAt(x, z, h, col);
    colors[v * 3] = col.r;
    colors[v * 3 + 1] = col.g;
    colors[v * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const tex = groundTexture(texture).clone();
  tex.needsUpdate = true;
  tex.repeat.set(size / repeat, size / repeat);
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, heightAt };
}

// ---------- 水面 ----------
export function buildWater(cfg, sunDir, skyCol, center, size = 6000) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(cfg.color) },
        uDeep: { value: new THREE.Color(cfg.deep) },
        uSky: { value: new THREE.Color(skyCol) },
        uSun: { value: sunDir.clone() },
      },
    ]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; varying vec3 vW;
      #include <fog_pars_fragment>
      float wv(vec2 p, vec2 d, float f, float s){ return sin(dot(p, d) * f + uTime * s); }
      void main(){
        vec2 p = vW.xz;
        float e = 0.8;
        vec2 g = vec2(0.0);
        g += vec2(0.8,0.6) * cos(dot(p, vec2(0.8,0.6))*0.09 + uTime*1.3) * 0.09;
        g += vec2(-0.5,0.85) * cos(dot(p, vec2(-0.5,0.85))*0.17 + uTime*1.9) * 0.06;
        g += vec2(0.3,-0.95) * cos(dot(p, vec2(0.3,-0.95))*0.41 + uTime*2.7) * 0.035;
        g += vec2(0.95,0.3) * cos(dot(p, vec2(0.95,0.3))*0.83 + uTime*3.4) * 0.02;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 c = mix(uColor, uDeep, 0.35 + 0.3 * sin(p.x*0.01)*sin(p.y*0.013));
        c = mix(c, uSky, clamp(fres * 0.9 + 0.08, 0.0, 1.0));
        vec3 r = reflect(-v, n);
        float sp = pow(max(dot(r, normalize(uSun)), 0.0), 180.0);
        c += vec3(1.0, 0.97, 0.9) * sp * 2.5;
        float sparkle = pow(max(dot(r, normalize(uSun)), 0.0), 30.0) * step(0.93, fract(sin(dot(floor(p*0.6), vec2(12.9898,78.233)))*43758.5453 + uTime*0.2));
        c += sparkle * 0.6;
        gl_FragColor = vec4(c, 0.93);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    fog: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, cfg.y, center.z);
  mesh.renderOrder = 0;
  return mesh;
}

// ---------- 远景山脉：两圈连续的天际线山环 ----------
export function buildMountains(rnd, center, cfg) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const base = new THREE.Color(cfg.color);
  const cap = cfg.cap ? new THREE.Color(cfg.cap) : null;
  const noise = makeNoise2D(Math.floor(rnd() * 1000));
  const layers = [
    { R: cfg.r0 + cfg.r1 * 0.9, h: (cfg.h0 + cfg.h1) * 1.25, k: 0.85 },
    { R: cfg.r0, h: cfg.h0 + cfg.h1 * 0.5, k: 1 },
  ];
  const M = 360, V = 7;
  for (const L of layers) {
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let i = 0; i <= M; i++) {
      const a = (i / M) * Math.PI * 2;
      const nx = Math.cos(a) * 3, nz = Math.sin(a) * 3;
      const top = L.h * (0.35 + 0.65 * Math.max(0, 0.5 + noise.fbm(nx + L.R * 0.001, nz, 5) * 1.3));
      for (let j = 0; j <= V; j++) {
        const t = j / V;
        const y = -40 + (top + 40) * Math.pow(t, 0.9);
        const r = L.R + (1 - t) * top * 1.4;
        pos.push(center.x + Math.cos(a) * r, y + (cfg.y || 0), center.z + Math.sin(a) * r);
        c.copy(base).multiplyScalar(0.62 + 0.38 * t).multiplyScalar(L.k);
        if (cap && t > 0.62 && top > L.h * 0.45) c.copy(cap);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < M; i++)
      for (let j = 0; j < V; j++) {
        const a = i * (V + 1) + j, b = a + V + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.material.side = THREE.DoubleSide;
    grp.add(m);
  }
  return grp;
}

export function makeNoise(seed) { return makeNoise2D(seed); }
export { smoothstep };
