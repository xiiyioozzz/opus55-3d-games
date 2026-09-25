// 特效：粒子、贴花、曳光、枪口火焰、爆炸、烟囱排烟、海鸥
import * as THREE from 'three';

class Particles {
  constructor(scene, tex, additive, max) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    // 模拟数据
    this.p = []; // {x,y,z,vx,vy,vz,life,max,s0,s1,r,g,b,a0,a1,grav,drag}
  }
  emit(o) { if (this.p.length < this.max) this.p.push(o); else this.p[(Math.random() * this.max) | 0] = o; }
  update(dt) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vy = q.vy * dr - q.grav * dt; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.floor !== undefined && q.y < q.floor) { q.y = q.floor; q.vy *= -0.3; q.vx *= 0.5; q.vz *= 0.5; }
      const t = q.life / q.max;
      this.pos[n * 3] = q.x; this.pos[n * 3 + 1] = q.y; this.pos[n * 3 + 2] = q.z;
      this.col[n * 4] = q.r; this.col[n * 4 + 1] = q.g; this.col[n * 4 + 2] = q.b;
      this.col[n * 4 + 3] = q.a0 + (q.a1 - q.a0) * t;
      this.size[n] = q.s0 + (q.s1 - q.s0) * t;
      P[n] = q; n++;
    }
    P.length = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

class Decals {
  constructor(scene, tex, max, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0, ...opts });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.max = max; this.i = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
  }
  add(p, n, size) {
    const q = this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2));
    this.m.compose(new THREE.Vector3(p.x + n.x * 0.004, p.y + n.y * 0.004, p.z + n.z * 0.004), q, new THREE.Vector3(size, size, size));
    this.mesh.setMatrixAt(this.i % this.max, this.m);
    this.i++;
    this.mesh.count = Math.min(this.i, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function tracerTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 16);
  g.addColorStop(0, 'rgba(255,220,150,0)'); g.addColorStop(0.5, 'rgba(255,245,210,1)'); g.addColorStop(1, 'rgba(255,220,150,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 16);
  const g2 = x.createLinearGradient(0, 0, 64, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = g2; x.fillRect(0, 0, 64, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Effects {
  constructor(scene, T, camera) {
    this.scene = scene; this.camera = camera; this.T = T;
    this.add = new Particles(scene, T.glow, true, 900);
    this.smoke = new Particles(scene, T.puff, false, 900);
    this.decals = {
      metal: new Decals(scene, T.holeMetal, 160),
      wood: new Decals(scene, T.holeWood, 100),
      blood: new Decals(scene, T.blood, 60),
      scorch: new Decals(scene, T.scorch, 12),
    };
    // 曳光
    this.tracerMax = 48;
    this.tracers = [];
    this.tracerMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tracerTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffe0a0, toneMapped: false }), this.tracerMax);
    this.tracerMesh.frustumCulled = false; this.tracerMesh.count = 0; this.tracerMesh.renderOrder = 6;
    scene.add(this.tracerMesh);
    // 第三人称枪口火焰
    this.flashes = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash[i % 3], blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd8a0, toneMapped: false }));
      s.visible = false; s.renderOrder = 7; scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.flashI = 0;
    // 动态点光源池
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa850, 0, 9, 2);
      scene.add(l); this.lights.push({ l, t: 0, peak: 0, dur: 0.06 });
    }
    this.lightI = 0;
    this.shake = 0;
    this.funnelT = 0;
    this.birds = [];
  }
  light(pos, intensity, dur, color = 0xffa850, dist = 9) {
    const L = this.lights[this.lightI++ % this.lights.length];
    L.l.position.copy(pos); L.l.color.set(color); L.l.distance = dist;
    L.t = dur; L.dur = dur; L.peak = intensity; L.l.intensity = intensity;
  }
  muzzle(pos, dir, big = 1) {
    const F = this.flashes[this.flashI++ % this.flashes.length];
    F.s.position.copy(pos).addScaledVector(dir, 0.06);
    F.s.material.rotation = Math.random() * 6.28;
    F.s.scale.setScalar(0.45 * big * (0.8 + Math.random() * 0.4));
    F.s.visible = true; F.t = 0.05;
    this.light(pos, 6 * big, 0.06);
    // 枪口烟
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 1.5, vy: 0.4, vz: dir.z * 1.5, life: 0, max: 0.7, s0: 0.1, s1: 0.5, r: 0.7, g: 0.7, b: 0.7, a0: 0.18, a1: 0, grav: -0.3, drag: 3 });
  }
  tracer(from, to) {
    const d = to.clone().sub(from); const L = d.length();
    if (L < 2) return;
    d.divideScalar(L);
    this.tracers.push({ from: from.clone(), dir: d, len: L, t: 0 });
    if (this.tracers.length > this.tracerMax) this.tracers.shift();
  }
  impact(p, n, mat, dir) {
    const nx = n.x, ny = n.y, nz = n.z;
    if (mat === 'flesh') {
      for (let i = 0; i < 10; i++) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x * 2 + (Math.random() - 0.5) * 1.5, vy: Math.random() * 1.2, vz: dir.z * 2 + (Math.random() - 0.5) * 1.5, life: 0, max: 0.35 + Math.random() * 0.3, s0: 0.06, s1: 0.28, r: 0.45, g: 0.02, b: 0.02, a0: 0.8, a1: 0, grav: 2, drag: 4 });
      for (let i = 0; i < 6; i++) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x * 3 + (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: dir.z * 3 + (Math.random() - 0.5) * 2, life: 0, max: 0.6, s0: 0.035, s1: 0.03, r: 0.35, g: 0.0, b: 0.0, a0: 1, a1: 0.6, grav: 9, drag: 0.5, floor: 0.01 });
      return;
    }
    if (mat === 'metal') {
      const cnt = 6 + (Math.random() * 6) | 0;
      for (let i = 0; i < cnt; i++) {
        const sp = 3 + Math.random() * 5;
        this.add.emit({ x: p.x, y: p.y, z: p.z, vx: (nx + (Math.random() - 0.5) * 1.4) * sp, vy: (ny + Math.random() * 0.8) * sp, vz: (nz + (Math.random() - 0.5) * 1.4) * sp, life: 0, max: 0.18 + Math.random() * 0.25, s0: 0.035, s1: 0.01, r: 1.6, g: 1.1, b: 0.5, a0: 1, a1: 0.3, grav: 9, drag: 1.5 });
      }
      this.add.emit({ x: p.x + nx * 0.02, y: p.y + ny * 0.02, z: p.z + nz * 0.02, vx: 0, vy: 0, vz: 0, life: 0, max: 0.05, s0: 0.25, s1: 0.1, r: 1.5, g: 1.2, b: 0.7, a0: 1, a1: 0, grav: 0, drag: 0 });
      this.decals.metal.add(p, n, 0.07 + Math.random() * 0.03);
    } else if (mat === 'wood') {
      for (let i = 0; i < 8; i++) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vx: (nx + (Math.random() - 0.5)) * 3, vy: (ny + Math.random()) * 3, vz: (nz + (Math.random() - 0.5)) * 3, life: 0, max: 0.6, s0: 0.03, s1: 0.025, r: 0.55, g: 0.4, b: 0.25, a0: 1, a1: 0.8, grav: 9, drag: 1, floor: 0.01 });
      this.decals.wood.add(p, n, 0.08 + Math.random() * 0.03);
    }
    // 尘烟
    const dust = mat === 'wood' ? [0.62, 0.52, 0.4] : [0.55, 0.55, 0.53];
    for (let i = 0; i < 3; i++) this.smoke.emit({ x: p.x + nx * 0.05, y: p.y + ny * 0.05, z: p.z + nz * 0.05, vx: nx * (0.5 + Math.random()) + (Math.random() - 0.5) * 0.4, vy: ny * 0.8 + 0.3, vz: nz * (0.5 + Math.random()) + (Math.random() - 0.5) * 0.4, life: 0, max: 0.8 + Math.random() * 0.6, s0: 0.12, s1: 0.6, r: dust[0], g: dust[1], b: dust[2], a0: 0.35, a1: 0, grav: -0.2, drag: 2.5 });
  }
  bloodSplat(p) { this.decals.blood.add(p, new THREE.Vector3(0, 1, 0), 0.5 + Math.random() * 0.4); }
  explosion(p) {
    this.light(p, 60, 0.35, 0xff9040, 22);
    this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: 0, vy: 0, vz: 0, life: 0, max: 0.18, s0: 2, s1: 7, r: 2.2, g: 1.6, b: 0.9, a0: 1, a1: 0, grav: 0, drag: 0 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2, sp = 3 + Math.random() * 6;
      this.add.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp, life: 0, max: 0.35 + Math.random() * 0.35, s0: 0.9, s1: 2.2, r: 1.8, g: 0.8, b: 0.25, a0: 0.9, a1: 0, grav: -1, drag: 4 });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, sp = 8 + Math.random() * 14;
      this.add.emit({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp, vy: Math.random() * 10, vz: Math.sin(a) * sp, life: 0, max: 0.4 + Math.random() * 0.5, s0: 0.06, s1: 0.02, r: 1.8, g: 1.2, b: 0.5, a0: 1, a1: 0.4, grav: 12, drag: 1.2, floor: 0.02 });
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 3;
      this.smoke.emit({ x: p.x + Math.cos(a) * 0.5, y: p.y + 0.4 + Math.random(), z: p.z + Math.sin(a) * 0.5, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 2, vz: Math.sin(a) * sp, life: 0, max: 3 + Math.random() * 3, s0: 1.2, s1: 5, r: 0.22, g: 0.21, b: 0.2, a0: 0.75, a1: 0, grav: -0.4, drag: 1.2 });
    }
    this.decals.scorch.add(new THREE.Vector3(p.x, 0.01, p.z), new THREE.Vector3(0, 1, 0), 3.2);
    this.shake = Math.max(this.shake, 1);
  }
  // 烟囱排烟 & 海鸥
  initAmbient(funnelTop) {
    this.funnelTop = funnelTop;
    const birdMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8, side: THREE.DoubleSide });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 3, 6), birdMat); body.rotation.x = Math.PI / 2;
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.1, 0.75, 0.05, 0.05, 0, 0, 0.15, 0.75, 0.05, 0.05, 1.05, 0, 0.12, 0.75, 0.05, 0.05], 3));
      wg.computeVertexNormals();
      const wR = new THREE.Mesh(wg, birdMat), wL = new THREE.Mesh(wg, birdMat); wL.scale.x = -1;
      const tipG = new THREE.BufferGeometry(); tipG.setAttribute('position', new THREE.Float32BufferAttribute([0.75, 0.05, 0.05, 1.05, 0, 0.12, 1.2, 0, 0.18], 3)); tipG.computeVertexNormals();
      const tR = new THREE.Mesh(tipG, tipMat), tL = new THREE.Mesh(tipG, tipMat); tL.scale.x = -1;
      const wrR = new THREE.Group(); wrR.add(wR, tR); const wrL = new THREE.Group(); wrL.add(wL, tL);
      b.add(body, wrR, wrL);
      b.scale.setScalar(1.1);
      this.scene.add(b);
      this.birds.push({ g: b, wR: wrR, wL: wrL, r: 25 + Math.random() * 30, h: 18 + Math.random() * 16, sp: 0.18 + Math.random() * 0.12, ph: Math.random() * 6.28, cx: -10 + Math.random() * 30, flap: Math.random() * 6 });
    }
  }
  update(dt, t, camera, shipSpeed) {
    this.add.update(dt); this.smoke.update(dt);
    const h = window.innerHeight * Math.min(window.devicePixelRatio, 2);
    const sc = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.mat.uniforms.scale.value = sc; this.smoke.mat.uniforms.scale.value = sc;
    // 曳光
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const camPos = camera.position;
    let n = 0;
    const speed = 380;
    this.tracers = this.tracers.filter((tr) => {
      tr.t += dt;
      const head = Math.min(tr.len, tr.t * speed), tail = Math.max(0, head - 7);
      if (tail >= tr.len) return false;
      const mid = pv.copy(tr.from).addScaledVector(tr.dir, (head + tail) / 2);
      const toCam = camPos.clone().sub(mid).normalize();
      const up = new THREE.Vector3().crossVectors(tr.dir, toCam).normalize();
      const nrm = new THREE.Vector3().crossVectors(tr.dir, up);
      const basis = new THREE.Matrix4().makeBasis(tr.dir, up, nrm);
      q.setFromRotationMatrix(basis);
      const dist = mid.distanceTo(camPos);
      sv.set(head - tail, 0.018 + dist * 0.0012, 1);
      m.compose(mid, q, sv);
      if (n < this.tracerMax) this.tracerMesh.setMatrixAt(n++, m);
      return true;
    });
    this.tracerMesh.count = n; this.tracerMesh.instanceMatrix.needsUpdate = true;
    for (const F of this.flashes) if (F.t > 0) { F.t -= dt; if (F.t <= 0) F.s.visible = false; }
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.t / L.dur) * L.peak; } else L.l.intensity = 0; }
    this.shake *= Math.exp(-dt * 5);
    // 烟囱排烟
    if (this.funnelTop) {
      this.funnelT -= dt;
      if (this.funnelT <= 0) {
        this.funnelT = 0.14;
        const f = this.funnelTop;
        const g = 0.18 + Math.random() * 0.1;
        this.smoke.emit({ x: f.x + (Math.random() - 0.5) * 2, y: f.y, z: f.z + (Math.random() - 0.5) * 1.5, vx: -shipSpeed * 0.9 - Math.random(), vy: 2.2 + Math.random(), vz: (Math.random() - 0.5) * 0.8, life: 0, max: 9, s0: 2.2, s1: 11, r: g, g: g, b: g * 1.02, a0: 0.42, a1: 0, grav: -0.05, drag: 0.08 });
      }
    }
    for (const b of this.birds) {
      b.ph += dt * b.sp;
      const x = b.cx + Math.cos(b.ph) * b.r, z = Math.sin(b.ph) * b.r * 0.6, y = b.h + Math.sin(b.ph * 2.3) * 3;
      b.g.position.set(x, y, z);
      b.g.rotation.y = -b.ph + Math.PI;
      b.g.rotation.z = Math.sin(b.ph) * 0.3;
      b.flap += dt * 7;
      const gl = Math.sin(b.ph * 0.7) > 0.3;
      const fa = gl ? 0.08 : Math.sin(b.flap) * 0.6;
      b.wR.rotation.z = fa; b.wL.rotation.z = -fa;
    }
  }
}
