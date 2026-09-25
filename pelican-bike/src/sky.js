import * as THREE from 'three';
import { clamp, smoothstep, lerp } from './util.js';

// 天空与海面共用的 uniforms（颜色均为线性空间）
export const SKY = {
  uSunDir: { value: new THREE.Vector3(0.5, 0.3, -0.8).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.5, 0.5, 0.7).normalize() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
  uSunGlow: { value: 1 },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
  uCloudCover: { value: 0.45 },
  uCloudTint: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
};

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform float uNight;
uniform float uTime;

vec3 skyBase(vec3 dir) {
  float y = dir.y;
  float h = pow(1.0 - clamp(y, 0.0, 1.0), 3.5);
  vec3 col = mix(uZenith, uHorizon, h);
  if (y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.3, y));
  float sd = max(dot(dir, uSunDir), 0.0);
  float glow = pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55 + pow(sd, 400.0) * 1.2;
  col += uSunColor * glow * uSunGlow * (0.45 + 0.55 * h);
  float md = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.35, 0.45, 0.7) * (pow(md, 24.0) * 0.05 + pow(md, 300.0) * 0.2) * uNight;
  return col;
}
`;

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

export const NOISE_CHUNK = NOISE_GLSL;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFrag = /* glsl */ `
${SKY_GLSL}
${NOISE_GLSL}
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform vec3 uCloudTint;
uniform vec3 uCloudShade;
uniform float uDetail;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);

  // 星空 + 银河
  if (uNight > 0.01 && dir.y > -0.05) {
    vec3 p = dir * 320.0;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h > 0.9955) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 7.1), hash13(cell + 3.7)) - 0.5) * 0.7;
      float d = length(p - c);
      float star = smoothstep(0.42, 0.0, d);
      float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 7.0) + h * 91.0);
      vec3 sc = mix(vec3(1.0, 0.82, 0.7), vec3(0.75, 0.85, 1.0), hash13(cell + 5.0));
      col += sc * star * tw * uNight * 3.0 * smoothstep(-0.02, 0.2, dir.y);
    }
    vec3 axis = normalize(vec3(0.3, 0.55, 0.78));
    float band = exp(-pow(dot(dir, axis) * 5.0, 2.0));
    float mw = fbm(dir.xz * 9.0 + dir.y * 4.0);
    col += vec3(0.28, 0.3, 0.45) * band * mw * mw * 0.35 * uNight * smoothstep(0.0, 0.3, dir.y);
  }

  // 太阳圆盘
  float sd = dot(dir, uSunDir);
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 18.0 * (1.0 - uNight);

  // 月亮（带简单月相明暗）
  float md = dot(dir, uMoonDir);
  float moon = smoothstep(0.99925, 0.99945, md);
  if (moon > 0.0) {
    vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, uMoonDir);
    vec2 mp = vec2(dot(dir, t1), dot(dir, t2)) / 0.033;
    float lit = smoothstep(-0.25, 0.35, mp.x + 0.35);
    float craters = 0.82 + 0.18 * vnoise(mp * 6.0);
    col = mix(col, vec3(1.0, 0.97, 0.9) * 2.4 * craters * mix(0.12, 1.0, lit), moon * smoothstep(0.0, 0.5, uNight));
  }

  // 程序化云层
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.1) * 0.55 + uCloudOffset;
    float n = fbm(uv * 0.9);
    float n2 = fbm(uv * 2.3 + 4.0);
    float d = n * 0.75 + n2 * 0.35;
    float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, d);
    float lightN = fbm(uv * 0.9 - uSunDir.xz * 0.12);
    float lit = clamp(0.55 + (n - lightN) * 3.0, 0.0, 1.0);
    float sunSide = pow(max(dot(dir, uSunDir), 0.0), 3.0);
    vec3 cc = mix(uCloudShade, uCloudTint, lit) + uSunColor * sunSide * 0.5 * (1.0 - uNight);
    float horizonFade = smoothstep(0.0, 0.14, dir.y);
    col = mix(col, cc, cover * horizonFade * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  const uniforms = { ...SKY, uDetail: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(400, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  // 用于 PMREM 生成环境光照的副本
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  return { mesh, envMesh, material: mat };
}

// ------- 一天之中的光照色板（按太阳高度角插值） -------
const hex = (h) => new THREE.Color(h);
const KEYS = [
  { e: -24, zen: '#02030a', hor: '#070a18', gnd: '#030409', sun: '#000000', li: 0.0, hs: '#1f2c58', hg: '#07070c', hi: 0.42, fog: '#080c1a', exp: 1.5, ct: '#161b2c', cs: '#070912', bloom: 0.95 },
  { e: -9, zen: '#081028', hor: '#23264a', gnd: '#0b0c16', sun: '#ff5a3a', li: 0.0, hs: '#2a3564', hg: '#0c0c14', hi: 0.45, fog: '#161a33', exp: 1.4, ct: '#2d2a48', cs: '#0f1024', bloom: 0.85 },
  { e: -2, zen: '#1c2a5e', hor: '#d0694a', gnd: '#2b1d20', sun: '#ff5b2a', li: 0.25, hs: '#50507a', hg: '#2b1c1c', hi: 0.45, fog: '#6a4a5a', exp: 1.18, ct: '#f07a5a', cs: '#3a2a4a', bloom: 0.7 },
  { e: 3, zen: '#2f4f9a', hor: '#ff9658', gnd: '#5a3a2c', sun: '#ff8a3c', li: 1.3, hs: '#8a86b0', hg: '#4a3326', hi: 0.55, fog: '#d58a6a', exp: 1.0, ct: '#ffb487', cs: '#6a5070', bloom: 0.55 },
  { e: 10, zen: '#3a6fc0', hor: '#ffc896', gnd: '#6e5a48', sun: '#ffc27e', li: 2.3, hs: '#a9c2e6', hg: '#6b5a40', hi: 0.65, fog: '#e8c2a2', exp: 0.95, ct: '#fff0dc', cs: '#9aa2b8', bloom: 0.42 },
  { e: 28, zen: '#2f76d2', hor: '#b9dbf4', gnd: '#7a7058', sun: '#fff0d6', li: 3.0, hs: '#b8d8ff', hg: '#6f6448', hi: 0.8, fog: '#bcd6ea', exp: 0.9, ct: '#ffffff', cs: '#b4c2d6', bloom: 0.32 },
  { e: 75, zen: '#256bd4', hor: '#c6e3fb', gnd: '#7c7460', sun: '#ffffff', li: 3.3, hs: '#c0dcff', hg: '#6f6448', hi: 0.85, fog: '#c4dcf0', exp: 0.88, ct: '#ffffff', cs: '#bcc8da', bloom: 0.3 },
].map((k) => ({
  ...k,
  zen: hex(k.zen),
  hor: hex(k.hor),
  gnd: hex(k.gnd),
  sun: hex(k.sun),
  hs: hex(k.hs),
  hg: hex(k.hg),
  fog: hex(k.fog),
  ct: hex(k.ct),
  cs: hex(k.cs),
}));

const COLOR_KEYS = ['zen', 'hor', 'gnd', 'sun', 'hs', 'hg', 'fog', 'ct', 'cs'];
const NUM_KEYS = ['li', 'hi', 'exp', 'bloom'];

export function samplePalette(elevDeg, out) {
  let i = 0;
  while (i < KEYS.length - 2 && elevDeg > KEYS[i + 1].e) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = clamp((elevDeg - a.e) / (b.e - a.e), 0, 1);
  for (const k of COLOR_KEYS) {
    if (!out[k]) out[k] = new THREE.Color();
    out[k].copy(a[k]).lerp(b[k], t);
  }
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

// 时刻 -> 太阳方向；6 点东升（身后山侧），18 点西落（前方海上）
export function sunDirection(hour, out) {
  const dayT = (hour - 6) / 12; // 0..1 白天
  const nightT = ((hour - 18 + 24) % 24) / 12; // 0..1 夜晚
  const e = hour >= 6 && hour <= 18
    ? Math.sin(dayT * Math.PI) * (66 * Math.PI / 180)
    : -Math.sin(nightT * Math.PI) * 0.9;
  const az = (120 - dayT * 180) * Math.PI / 180;
  out.set(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
  return out;
}

export function moonDirection(hour, out) {
  // 夜间月亮从海面方向升起，午夜最高
  const nt = (((hour - 18 + 24) % 24)) / 12; // 0..1 夜晚
  const e = Math.sin(clamp(nt, 0, 1) * Math.PI) * 0.95 - 0.12;
  const az = (-110 + nt * 150) * Math.PI / 180;
  out.set(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)).normalize();
  return out;
}

export const nightFactor = (elevDeg) => smoothstep(-1.5, -11, elevDeg);
