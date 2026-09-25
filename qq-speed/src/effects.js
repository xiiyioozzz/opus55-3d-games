import * as THREE from 'three';
import { softDotTexture } from './textures.js';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
varying vec4 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// 通用粒子池
export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: softDotTexture() }, uScale: { value: 400 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  setScale(h) { this.points.material.uniforms.uScale.value = h * 0.9; }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.rgb[i * 3] = r * r; this.rgb[i * 3 + 1] = g * g; this.rgb[i * 3 + 2] = b * b; // 近似 sRGB→线性
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; }
        continue;
      }
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.col[i * 4] = this.rgb[i * 3];
      this.col[i * 4 + 1] = this.rgb[i * 3 + 1];
      this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * (1 - k) * Math.min(1, k * 8 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

// 轮胎印：环形缓冲的带状网格
export class SkidMarks {
  constructor(maxQuads = 2400) {
    this.max = maxQuads;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.alpha = new Float32Array(maxQuads * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const a = q * 4;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0x111111) } }]),
      vertexShader: `attribute float alpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(uColor, vA*0.55);
        #include <colorspace_fragment>
        #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cursor = 0;
    this.last = new Map();
  }

  // key 标识一条轮胎印（如 player-left）
  add(key, x, y, z, rx, rz, w, strength) {
    const prev = this.last.get(key);
    const cur = { x, y: y + 0.06, z, rx, rz };
    if (prev && (x - prev.x) ** 2 + (z - prev.z) ** 2 < 25) {
      const q = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const p = this.pos, o = q * 12;
      p[o] = prev.x - prev.rx * w; p[o + 1] = prev.y; p[o + 2] = prev.z - prev.rz * w;
      p[o + 3] = prev.x + prev.rx * w; p[o + 4] = prev.y; p[o + 5] = prev.z + prev.rz * w;
      p[o + 6] = x - rx * w; p[o + 7] = cur.y; p[o + 8] = z - rz * w;
      p[o + 9] = x + rx * w; p[o + 10] = cur.y; p[o + 11] = z + rz * w;
      const a = q * 4;
      this.alpha[a] = this.alpha[a + 1] = prev.s ?? strength;
      this.alpha[a + 2] = this.alpha[a + 3] = strength;
      this.dirty = true;
    }
    cur.s = strength;
    this.last.set(key, cur);
  }

  cut(key) { this.last.delete(key); }

  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.last.clear();
    this.dirty = true;
    this.update();
  }
}
