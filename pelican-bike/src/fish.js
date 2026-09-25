import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, v3, TAU, normalizeForMerge, paint } from './util.js';

let cached = null;

// 流线型小鱼：放样鱼身 + 尾鳍 + 背鳍 + 眼睛，头朝 +X
export function fishGeometry() {
  if (cached) return cached;
  const L = 0.3;
  const back = new THREE.Color('#2b6f93');
  const belly = new THREE.Color('#eef4f6');
  const stripe = new THREE.Color('#8fd3e8');
  const body = loft({
    segs: 24,
    ring: 16,
    center: (t) => v3((t - 0.5) * L, Math.sin(t * Math.PI) * 0.004, 0),
    section: (t, a) => {
      const th = a * TAU;
      const s = Math.sin(Math.PI * Math.pow(t, 0.8));
      const h = Math.pow(s, 0.85) * 0.055 + 0.002;
      const w = Math.pow(s, 1.1) * 0.024 + 0.001;
      return [Math.cos(th) * h, Math.sin(th) * w];
    },
    color: (t, a, c) => {
      const up = Math.cos(a * TAU);
      c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(up, -0.2, 0.6));
      if (Math.abs(up) < 0.15 && t > 0.2 && t < 0.85) c.lerp(stripe, 0.6);
    },
  });
  const tail = new THREE.Shape();
  tail.moveTo(0, 0);
  tail.quadraticCurveTo(-0.05, 0.03, -0.085, 0.07);
  tail.quadraticCurveTo(-0.06, 0.0, -0.085, -0.07);
  tail.quadraticCurveTo(-0.05, -0.03, 0, 0);
  const tg = new THREE.ShapeGeometry(tail, 6);
  tg.translate(-L / 2 + 0.01, 0, 0);
  const dorsal = new THREE.Shape();
  dorsal.moveTo(0.04, 0);
  dorsal.quadraticCurveTo(0.0, 0.05, -0.05, 0.035);
  dorsal.lineTo(-0.05, 0);
  dorsal.closePath();
  const dg = new THREE.ShapeGeometry(dorsal, 4);
  dg.translate(0.0, 0.048, 0);
  const eyeL = new THREE.SphereGeometry(0.009, 8, 6).translate(0.1, 0.012, 0.016);
  const eyeR = new THREE.SphereGeometry(0.009, 8, 6).translate(0.1, 0.012, -0.016);
  cached = mergeGeometries([
    normalizeForMerge(body),
    paint(normalizeForMerge(tg), '#3d86ad'),
    paint(normalizeForMerge(dg), '#3d86ad'),
    paint(normalizeForMerge(eyeL), '#0c0c0c'),
    paint(normalizeForMerge(eyeR), '#0c0c0c'),
  ]);
  cached.computeBoundingSphere();
  return cached;
}
