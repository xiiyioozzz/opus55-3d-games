import * as THREE from 'three';
import { SKY, SKY_GLSL, NOISE_CHUNK } from './sky.js';

export const SEA_LEVEL = -1.6;
export const SHORE_Z = -14.6;

// 与着色器一致的波浪参数：方向、陡度、波长、速度倍率
export const WAVES = [
  [0.18, 1.0, 0.2, 21.0, 1.0],
  [-0.45, 1.0, 0.17, 12.5, 1.0],
  [0.75, 0.62, 0.13, 7.0, 1.0],
  [-0.9, 0.45, 0.1, 4.2, 1.0],
  [0.3, 1.0, 0.07, 2.6, 1.0],
];

const oceanVert = /* glsl */ `
uniform float uTime;
uniform float uOffset;
uniform float uAmp;
uniform float uPhase[${WAVES.length}];
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vWP;

const float SHORE = ${SHORE_Z.toFixed(2)};
// 相位 = k·(d.x·行驶距离) - k·c·t 在 JS 中以双精度取模后传入，避免长距离后浮点跳变
vec3 gerstner(vec2 p, vec2 dir, float steep, float wl, float phase, float amp, inout vec3 tangent, inout vec3 binormal) {
  float k = 6.28318 / wl;
  vec2 d = normalize(dir);
  float f = k * dot(d, p) + phase;
  float st = steep * amp;
  float a = st / k;
  float sf = sin(f);
  float cf = cos(f);
  tangent += vec3(-d.x * d.x * st * sf, d.x * st * cf, -d.x * d.y * st * sf);
  binormal += vec3(-d.x * d.y * st * sf, d.y * st * cf, -d.y * d.y * st * sf);
  return vec3(d.x * a * cf, a * sf, d.y * a * cf);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = vec2(wp.x, wp.z);
  float off = smoothstep(SHORE + 1.0, SHORE - 30.0, wp.z);
  float amp = uAmp * mix(0.35, 1.0, off);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  ${WAVES.map((w, i) => `disp += gerstner(p, vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)}), ${w[2].toFixed(3)}, ${w[3].toFixed(3)}, uPhase[${i}], amp, tangent, binormal);`).join('\n  ')}
  wp.xyz += disp;
  vNormal = normalize(cross(binormal, tangent));
  vWorld = wp.xyz;
  vHeight = disp.y / max(uAmp, 0.05);
  vWP = vec2(wp.x + uOffset, wp.z);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const oceanFrag = /* glsl */ `
${SKY_GLSL}
${NOISE_CHUNK}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogDensity;
uniform float uDayLight;
uniform float uOffset;
uniform vec3 uLampColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vWP;
const float SHORE = ${SHORE_Z.toFixed(2)};

void main() {
  vec3 N = normalize(vNormal);
  float dist = length(vWorld - cameraPosition);
  // 细节法线：两层滚动噪声的有限差分
  vec2 q = vWP * 0.55;
  float e = 0.35;
  vec2 f1 = vec2(0.35, 0.6) * uTime;
  vec2 f2 = vec2(-0.5, 0.25) * uTime;
  float h0 = vnoise(q + f1) + 0.5 * vnoise(q * 2.7 + f2);
  float hx = vnoise(q + vec2(e, 0.0) + f1) + 0.5 * vnoise((q + vec2(e, 0.0)) * 2.7 + f2);
  float hz = vnoise(q + vec2(0.0, e) + f1) + 0.5 * vnoise((q + vec2(0.0, e)) * 2.7 + f2);
  float detail = 0.55 * (1.0 - smoothstep(20.0, 160.0, dist));
  N = normalize(N + vec3(h0 - hx, 0.0, h0 - hz) * detail);

  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  R = normalize(R);
  vec3 refl = skyBase(R);

  float depthF = smoothstep(SHORE - 2.0, SHORE - 45.0, vWorld.z);
  vec3 water = mix(uShallow, uDeep, depthF) * (0.12 + 0.88 * uDayLight);
  // 浪尖透光
  float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * clamp(vHeight + 0.3, 0.0, 1.5);
  water += uShallow * uSunColor * sss * 0.35 * (1.0 - uNight);

  vec3 col = mix(water, refl, fres);
  float rs = max(dot(R, uSunDir), 0.0);
  col += uSunColor * (pow(rs, 420.0) * 30.0 + pow(rs, 60.0) * 0.7) * (1.0 - uNight) * step(-0.05, uSunDir.y);
  float rm = max(dot(R, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (pow(rm, 250.0) * 2.2 + pow(rm, 30.0) * 0.06) * uNight;

  // 浪尖白沫 + 岸边碎浪
  float fn = vnoise(vWP * 1.3 + uTime * 0.4) * 0.6 + vnoise(vWP * 4.0 - uTime * 0.3) * 0.4;
  float crest = smoothstep(0.62, 1.05, vHeight + fn * 0.35) * smoothstep(-8.0, -40.0, vWorld.z);
  float shoreLine = SHORE + 0.9 * sin(vWP.x * 0.045) + 0.5 * sin(vWP.x * 0.13 + 1.7);
  float surge = sin(uTime * 0.7 + vWP.x * 0.021) * 1.3;
  float sd = vWorld.z - (shoreLine + surge * 0.5);
  float shoreFoam = smoothstep(-5.5, 0.5, sd) * (0.55 + 0.45 * fn);
  shoreFoam *= smoothstep(0.35, 0.55, fn + smoothstep(-2.5, 0.8, sd) * 0.5);
  float foam = clamp(max(crest * 0.75, shoreFoam), 0.0, 1.0);
  vec3 foamCol = mix(vec3(0.06, 0.08, 0.12), vec3(0.95, 0.97, 1.0), uDayLight) * (0.6 + 0.4 * uSunGlow);
  col = mix(col, foamCol, foam * 0.85);

  // 路灯倒影（夜间暖色光带）
  float lampRow = pow(max(0.0, 1.0 - abs(fract((vWP.x - 12.0) / 36.0 + 0.5) - 0.5) * 7.0), 2.0);
  col += uLampColor * lampRow * smoothstep(-40.0, -14.0, vWorld.z) * uNight * 0.25 * (0.5 + 0.5 * fn);

  // 大气雾 -> 与天空地平线颜色融合
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  vec3 fd = vWorld - cameraPosition;
  vec3 fogCol = skyBase(normalize(vec3(fd.x, max(fd.y * 0.02, 0.0) + 0.004, fd.z)));
  col = mix(col, fogCol, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOcean() {
  const uniforms = {
    ...SKY,
    uOffset: { value: 0 },
    uAmp: { value: 1 },
    uPhase: { value: new Float32Array(WAVES.length) },
    uDeep: { value: new THREE.Color('#0b3a5a') },
    uShallow: { value: new THREE.Color('#1fa3a8') },
    uFogDensity: { value: 0.0042 },
    uDayLight: { value: 1 },
    uLampColor: { value: new THREE.Color('#ffb46a') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
  });
  // 近处密、远处疏的网格
  const xs = [];
  for (let x = -260; x <= 420; x += x > -60 && x < 120 ? 1.2 : 4) xs.push(x);
  const zs = [];
  for (let z = -8; z >= -520; z -= z > -70 ? 0.9 : z > -160 ? 2.5 : 8) zs.push(z);
  const pos = [];
  const idx = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) pos.push(xs[i], 0, zs[j]);
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + nx;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  return { mesh, uniforms };
}

// 每帧在 JS 中以双精度计算各波相位（distance 为行驶距离，t 为时间）
export function wavePhases(distance, t, out) {
  WAVES.forEach((w, i) => {
    const k = (2 * Math.PI) / w[3];
    const c = Math.sqrt(9.8 / k) * w[4];
    const dx = w[0] / Math.hypot(w[0], w[1]);
    const ph = (k * dx * distance - k * c * t) % (2 * Math.PI);
    out[i] = ph;
  });
  return out;
}

// CPU 版本波高（船只、跃出的鱼使用），x 为绝对世界坐标
export function waveHeight(x, z, t, amp = 1) {
  const off = Math.min(1, Math.max(0, (SHORE_Z + 1 - z) / 31));
  const a0 = amp * (0.35 + 0.65 * off * off * (3 - 2 * off));
  let y = 0;
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w[3];
    const c = Math.sqrt(9.8 / k) * w[4];
    const l = Math.hypot(w[0], w[1]);
    const dx = w[0] / l;
    const dz = w[1] / l;
    const f = k * (dx * x + dz * z - c * t);
    y += ((w[2] * a0) / k) * Math.sin(f);
  }
  return SEA_LEVEL + y;
}
