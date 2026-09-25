import * as THREE from 'three';
import { clamp, lerp, mulberry32, TAU } from './util.js';

// ---------- 通用点粒子 ----------
export class Particles {
  constructor(scene, max, { additive = false, sizeScale = 1, opacity = 1 } = {}) {
    this.opacity = opacity;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.ground = new Uint8Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 * sizeScale } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: this.uniforms,
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = aSize*uScale/max(-mv.z, 0.1); vColor = aColor; vAlpha = aAlpha; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.05, d)*vAlpha; if (a < 0.003) discard; gl_FragColor = vec4(vColor, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(p, v, color, size, life, { drag = 0.5, grav = 0, ground = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.ground[i] = ground;
  }

  update(dt, scroll) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt - (this.ground[i] ? scroll : 0);
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = clamp(f * 1.6, 0, 1) * clamp((1 - f) * 8, 0, 1) * this.opacity;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }
}

// ---------- 彩纸（实例化小纸片） ----------
export class Confetti {
  constructor(scene, count = 220) {
    this.count = count;
    const geo = new THREE.PlaneGeometry(0.05, 0.028);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ffffff', '#ff8fab'].map((c) => new THREE.Color(c));
    const r = mulberry32(3);
    this.p = [];
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, palette[i % palette.length]);
      this.p.push({ pos: new THREE.Vector3(0, -100, 0), vel: new THREE.Vector3(), rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), spin: new THREE.Vector3(r() * 12 - 6, r() * 12 - 6, r() * 12 - 6), life: 0 });
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this.active = false;
  }

  burst(center) {
    const r = Math.random;
    for (const p of this.p) {
      p.pos.set(center.x + (r() - 0.5) * 0.6, center.y + r() * 0.4, center.z + (r() - 0.5) * 0.6);
      const a = r() * TAU;
      const sp = 1.5 + r() * 3.5;
      p.vel.set(Math.cos(a) * sp * 0.6, 3 + r() * 4.5, Math.sin(a) * sp * 0.6);
      p.life = 3 + r() * 2;
    }
    this.active = true;
  }

  update(dt, scroll) {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      if (p.life > 0) {
        p.life -= dt;
        alive++;
        p.vel.y -= 5.5 * dt;
        p.vel.multiplyScalar(Math.exp(-1.6 * dt));
        p.vel.x += Math.sin(p.life * 5 + i) * 0.6 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x -= scroll * 0.35;
        if (p.pos.y < 0.01) {
          p.pos.y = 0.01;
          p.vel.set(0, 0, 0);
        } else {
          p.rot.x += p.spin.x * dt;
          p.rot.y += p.spin.y * dt;
          p.rot.z += p.spin.z * dt;
        }
      } else p.pos.y = -100;
      this._q.setFromEuler(p.rot);
      this._s.setScalar(p.life > 0 ? Math.min(1, p.life) : 0);
      this._m.compose(p.pos, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.active = false;
  }
}

// ---------- 速度线（挂在相机上） ----------
export class SpeedLines {
  constructor(camera, count = 70) {
    this.count = count;
    const pos = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    camera.add(this.lines);
    this.seeds = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r = 0.9 + Math.random() * 2.4;
      this.seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.65, z: -Math.random() * 14 - 1 });
    }
  }

  update(dt, speed, intensity) {
    const k = clamp((speed - 9) / 5, 0, 1) * intensity;
    this.mat.opacity = k * 0.35;
    this.lines.visible = k > 0.01;
    if (!this.lines.visible) return;
    const pos = this.lines.geometry.attributes.position.array;
    const len = 0.4 + speed * 0.08;
    for (let i = 0; i < this.count; i++) {
      const s = this.seeds[i];
      s.z += speed * 2.2 * dt;
      if (s.z > 0.5) s.z = -15;
      pos.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- Verlet 布料：红色围巾 ----------
export class Scarf {
  constructor(scene, segments = 16, width = 0.075, segLen = 0.045) {
    this.n = segments;
    this.segLen = segLen;
    this.width = width;
    const cnt = segments * 2;
    this.p = new Float32Array(cnt * 3);
    this.prev = new Float32Array(cnt * 3);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(cnt * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    const col = new Float32Array(cnt * 3);
    const red = new THREE.Color('#d7263d');
    const white = new THREE.Color('#fff4e6');
    for (let i = 0; i < segments; i++) {
      const stripe = i > segments - 5 && i % 2 === 0;
      const c = stripe ? white : red;
      for (let k = 0; k < 2; k++) col.set([c.r, c.g, c.b], (i * 2 + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.init = false;
    this._c = new THREE.Vector3();
  }

  reset(a, b) {
    for (let i = 0; i < this.n; i++) {
      for (let k = 0; k < 2; k++) {
        const src = k ? b : a;
        const j = (i * 2 + k) * 3;
        this.p[j] = src.x - i * this.segLen;
        this.p[j + 1] = src.y;
        this.p[j + 2] = src.z;
      }
    }
    this.prev.set(this.p);
    this.init = true;
  }

  // a/b：围巾根部两端（世界坐标）；wind：相对空气速度；collider：身体球
  update(dt, a, b, wind, t, collider) {
    // 模拟若因异常输入发散，直接重置
    if (this.init && !Number.isFinite(this.p[this.p.length - 1] + this.p[this.p.length - 2])) this.init = false;
    if (!this.init) this.reset(a, b);
    const P = this.p;
    const Q = this.prev;
    const steps = 2;
    const h = Math.min(dt, 1 / 30) / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.n; i++) {
        for (let k = 0; k < 2; k++) {
          const j = (i * 2 + k) * 3;
          if (i === 0) continue;
          const vx = P[j] - Q[j];
          const vy = P[j + 1] - Q[j + 1];
          const vz = P[j + 2] - Q[j + 2];
          Q[j] = P[j];
          Q[j + 1] = P[j + 1];
          Q[j + 2] = P[j + 2];
          const f = i / this.n;
          const flutter = Math.sin(t * 17 + i * 0.9 + k * 0.4) * (0.6 + f * 2.2);
          const ax = (wind.x - vx / h) * 2.2;
          const ay = -9.8 * 0.55 + (wind.y - vy / h) * 1.2 + flutter * 1.4 * Math.min(1, Math.abs(wind.x) / 6);
          const az = (wind.z - vz / h) * 2.2 + Math.cos(t * 13 + i * 0.7) * flutter * 0.8;
          P[j] += vx * 0.985 + ax * h * h;
          P[j + 1] += vy * 0.985 + ay * h * h;
          P[j + 2] += vz * 0.985 + az * h * h;
        }
      }
      // 固定根部
      for (let k = 0; k < 2; k++) {
        const src = k ? b : a;
        P[k * 3] = src.x;
        P[k * 3 + 1] = src.y;
        P[k * 3 + 2] = src.z;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < this.n - 1; i++) {
          for (let k = 0; k < 2; k++) this.constrain(i * 2 + k, (i + 1) * 2 + k, this.segLen, i === 0);
          this.constrain((i + 1) * 2, (i + 1) * 2 + 1, this.width, false);
          this.constrain(i * 2, (i + 1) * 2 + 1, Math.hypot(this.segLen, this.width), i === 0);
          this.constrain(i * 2 + 1, (i + 1) * 2, Math.hypot(this.segLen, this.width), i === 0);
        }
        if (collider) {
          for (let i = 1; i < this.n; i++) {
            for (let k = 0; k < 2; k++) {
              const j = (i * 2 + k) * 3;
              this._c.set(P[j] - collider.center.x, P[j + 1] - collider.center.y, P[j + 2] - collider.center.z);
              const d = this._c.length();
              if (d < collider.radius) {
                this._c.multiplyScalar(collider.radius / (d || 1));
                P[j] = collider.center.x + this._c.x;
                P[j + 1] = collider.center.y + this._c.y;
                P[j + 2] = collider.center.z + this._c.z;
              }
            }
          }
        }
      }
    }
    this.posAttr.array.set(P);
    this.posAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    const nrm = this.mesh.geometry.attributes.normal.array;
    for (let i = 0; i < nrm.length; i += 3) {
      if (!(nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2] > 1e-8)) {
        nrm[i] = 0;
        nrm[i + 1] = 1;
        nrm[i + 2] = 0;
      }
    }
  }

  constrain(i, j, rest, pinI) {
    const P = this.p;
    const a = i * 3;
    const b = j * 3;
    const dx = P[b] - P[a];
    const dy = P[b + 1] - P[a + 1];
    const dz = P[b + 2] - P[a + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = (d - rest) / d;
    if (pinI) {
      P[b] -= dx * diff;
      P[b + 1] -= dy * diff;
      P[b + 2] -= dz * diff;
    } else {
      const h = diff * 0.5;
      P[a] += dx * h;
      P[a + 1] += dy * h;
      P[a + 2] += dz * h;
      P[b] -= dx * h;
      P[b + 1] -= dy * h;
      P[b + 2] -= dz * h;
    }
  }
}

export function lerpColor(a, b, t, out) {
  return out.copy(a).lerp(b, t);
}
export { lerp };
