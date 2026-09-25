// 第一人称武器与手臂
import * as THREE from 'three';
import { buildGun, gunMaterials } from './guns.js';

const HIP = {
  ak47: { p: [0.165, -0.175, -0.55], r: [0.045, 0.165, 0.02] },
  m4a1: { p: [0.16, -0.18, -0.54], r: [0.045, 0.165, 0.02] },
  awm: { p: [0.17, -0.185, -0.6], r: [0.04, 0.15, 0.02] },
  mp5: { p: [0.155, -0.165, -0.5], r: [0.05, 0.17, 0.02] },
  deagle: { p: [0.085, -0.115, -0.4], r: [0.05, 0.1, 0] },
  knife: { p: [0.17, -0.15, -0.34], r: [0.35, -0.25, 0.55] },
  he: { p: [0.13, -0.12, -0.3], r: [0.1, -0.2, 0.2] },
};
const KICK = { ak47: [0.04, 0.07], m4a1: [0.032, 0.05], awm: [0.09, 0.2], mp5: [0.024, 0.035], deagle: [0.05, 0.22] };

const ease = (t) => t * t * (3 - 2 * t);
const seg = (f, a, b) => Math.min(1, Math.max(0, (f - a) / (b - a)));

export class ViewModel {
  constructor(scene, T, team) {
    this.scene = scene;
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.holder = new THREE.Group();
    this.rig.add(this.holder);
    this.guns = {};
    this.cur = null; this.id = null;
    // 灯光（方向每帧同步到相机空间）
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.position.set(0.5, 1, 0.3);
    scene.add(this.sun);
    this.fill = new THREE.HemisphereLight(0xcfe2f4, 0x40464c, 0.35);
    scene.add(this.fill);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 1.5, 2);
    scene.add(this.muzzleLight);
    // 手臂
    const m = gunMaterials();
    this.gloveMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.62, metalness: 0.05, normalMap: m.black.normalMap, normalScale: new THREE.Vector2(0.5, 0.5) });
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.9, metalness: 0, normalMap: m.black.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) });
    this.cuffMat = new THREE.MeshStandardMaterial({ color: 0xb01c1c, roughness: 0.8 });
    this.arms = {};
    for (const s of ['R', 'L']) {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.037, 0.3, 4, 12), this.sleeveMat);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 12), this.cuffMat);
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.045), this.gloveMat);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.07), this.gloveMat);
      fingers.position.set(0, -0.035, -0.03);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.04, 3, 6), this.gloveMat);
      thumb.position.set(s === 'R' ? -0.035 : 0.035, 0.01, -0.03); thumb.rotation.x = -1.1;
      hand.add(palm, fingers, thumb);
      g.add(fore, cuff, hand);
      cuff.visible = false;
      this.rig.add(g);
      this.arms[s] = { g, fore, cuff, hand };
    }
    this.elbow = { R: new THREE.Vector3(0.5, -0.44, -0.3), L: new THREE.Vector3(-0.04, -0.5, -0.5) };
    // 枪口火焰
    const fm = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffd9a0 });
    this.flashTex = T.flash;
    this.flash = new THREE.Group();
    this.flashFront = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm(T.flash[0]));
    this.flashSide1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), fm(T.flashSide));
    this.flashSide2 = this.flashSide1.clone();
    this.flashSide1.rotation.y = Math.PI / 2; this.flashSide1.position.z = -0.1;
    this.flashSide2.rotation.set(0, Math.PI / 2, Math.PI / 2); this.flashSide2.position.z = -0.1;
    this.flashSide1.geometry = this.flashSide1.geometry.clone().rotateZ(Math.PI);
    this.flash.add(this.flashFront, this.flashSide1, this.flashSide2);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    // 弹壳
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.035, 8); shellGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(shellGeo, m.brass);
      s.visible = false; this.rig.add(s);
      this.shells.push({ mesh: s, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
    }
    this.shellIdx = 0;
    // 状态
    this.t = 0;
    this.kick = 0; this.kickV = 0; this.kickRot = 0; this.kickRotV = 0;
    this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2();
    this.bobT = 0; this.bobK = 0;
    this.land = 0;
    this.drawT = 1; this.drawDur = 0.5;
    this.anim = null; // {type, t, dur, empty, heavy}
    this.flashT = 0;
    this.setTeam(team);
    this.visible = true;
  }
  setTeam(team) {
    this.team = team;
    this.sleeveMat.color.set(team === 'GR' ? 0x3b4757 : 0x222326);
    this.cuffMat.color.set(team === 'GR' ? 0x1f62c8 : 0xa81818);
  }
  equip(id, drawTime) {
    if (!this.guns[id]) {
      const g = buildGun(id);
      g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.guns[id] = g;
    }
    if (this.cur) this.holder.remove(this.cur);
    this.cur = this.guns[id]; this.id = id;
    this.holder.add(this.cur);
    this.cur.visible = true;
    this.parts = {};
    this.cur.traverse((o) => { if (o.name) this.parts[o.name] = o; });
    this.partRest = {};
    for (const k of ['mag', 'bolt', 'slide', 'pin', 'lever']) if (this.parts[k]) this.partRest[k] = { p: this.parts[k].position.clone(), r: this.parts[k].rotation.clone() };
    const mz = this.parts.muzzle;
    if (mz) { mz.add(this.flash); }
    this.drawT = 0; this.drawDur = drawTime || 0.5;
    this.anim = null;
    this.kick = this.kickV = this.kickRot = this.kickRotV = 0;
  }
  fire() {
    const k = KICK[this.id] || [0.03, 0.05];
    this.kickV += k[0] * 38; this.kickRotV += k[1] * 38;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flashFront.material.map = this.flashTex[(Math.random() * 3) | 0];
    this.flashFront.rotation.z = Math.random() * Math.PI;
    const sc = this.id === 'awm' ? 1.6 : this.id === 'deagle' ? 1.2 : this.id === 'mp5' ? 0.8 : 1;
    this.flash.scale.setScalar(sc * (0.8 + Math.random() * 0.45));
    if (this.id !== 'awm') this.ejectShell();
    else this.anim = { type: 'bolt', t: 0, dur: 1.3 };
    if (this.id === 'deagle' && this.parts.slide) this.slideT = 0.09;
  }
  ejectShell() {
    const an = this.parts.eject;
    if (!an) return;
    const s = this.shells[this.shellIdx++ % this.shells.length];
    an.getWorldPosition(s.mesh.position);
    s.mesh.visible = true; s.life = 0.9;
    s.v.set(0.9 + Math.random() * 0.6, 0.9 + Math.random() * 0.5, 0.25 + Math.random() * 0.3);
    s.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    s.mesh.rotation.set(0, Math.random(), 0);
  }
  reload(dur, empty) { this.anim = { type: 'reload', t: 0, dur, empty }; }
  melee(heavy) { this.anim = { type: heavy ? 'stab' : 'slash', t: 0, dur: heavy ? 0.85 : 0.38, dir: Math.random() > 0.5 ? 1 : -1 }; }
  throwNade() { this.anim = { type: 'throw', t: 0, dur: 0.75 }; }
  inspect() { if (!this.anim) this.anim = { type: 'inspect', t: 0, dur: 2.6 }; }
  cancelAnim() { if (this.anim && this.anim.type !== 'bolt') this.anim = null; this.resetParts(); }
  resetParts() {
    for (const k in this.partRest) { this.parts[k].position.copy(this.partRest[k].p); this.parts[k].rotation.copy(this.partRest[k].r); this.parts[k].visible = true; }
  }
  setVisible(v) { this.rig.visible = v; }

  // st: {speed, onGround, crouch, lookDX, lookDY, sunDirCam (Vector3), light (0..1), indoor}
  update(dt, st) {
    this.t += dt;
    if (!this.cur) return;
    const id = this.id;
    const hip = HIP[id] || HIP.ak47;
    // 弹簧：后坐
    const k1 = 260, d1 = 26;
    this.kickV += (-k1 * this.kick - d1 * this.kickV) * dt; this.kick += this.kickV * dt;
    this.kickRotV += (-k1 * this.kickRot - d1 * this.kickRotV) * dt; this.kickRot += this.kickRotV * dt;
    // 鼠标惯性摆动
    const tx = THREE.MathUtils.clamp(-st.lookDX * 0.00055, -0.05, 0.05), ty = THREE.MathUtils.clamp(st.lookDY * 0.00055, -0.04, 0.04);
    this.sway.x += (tx - this.sway.x) * Math.min(1, dt * 9);
    this.sway.y += (ty - this.sway.y) * Math.min(1, dt * 9);
    // 行走晃动
    const moving = st.onGround && st.speed > 0.5;
    this.bobK += ((moving ? Math.min(1, st.speed / 6) : 0) - this.bobK) * Math.min(1, dt * 6);
    this.bobT += dt * (5 + st.speed * 1.2) * (moving ? 1 : 0.3);
    const bx = Math.sin(this.bobT) * 0.011 * this.bobK, by = -Math.abs(Math.cos(this.bobT)) * 0.009 * this.bobK;
    const breathe = Math.sin(this.t * 1.6) * 0.0018;
    this.land *= Math.exp(-dt * 8);
    // 拔枪
    this.drawT = Math.min(1, this.drawT + dt / this.drawDur);
    const dr = 1 - ease(this.drawT);
    let px = hip.p[0] + bx + this.sway.x, py = hip.p[1] + by + breathe + this.sway.y - dr * 0.22 - this.land * 0.03 - (st.crouch ? 0.006 : 0);
    let pz = hip.p[2] + this.kick;
    let rx = hip.r[0] + this.kickRot - dr * 0.9 + this.sway.y * 1.5, ry = hip.r[1] + this.sway.x * 2, rz = hip.r[2] + (st.crouch ? -0.03 : 0) + bx * 2;
    // 特殊动作
    const P = this.parts, R = this.partRest;
    let handL = null; // 左手目标（相机空间）
    let handROverride = null;
    if (this.slideT > 0 && P.slide) { this.slideT -= dt; P.slide.position.z = R.slide.p.z + Math.max(0, this.slideT) * 0.5; }
    const a = this.anim;
    if (a) {
      a.t += dt;
      const f = Math.min(1, a.t / a.dur);
      if (a.type === 'reload') {
        const tilt = ease(seg(f, 0, 0.15)) * (1 - ease(seg(f, 0.85, 1)));
        rz += tilt * 0.45; rx += tilt * 0.18; py -= tilt * 0.03; px -= tilt * 0.02;
        if (P.mag) {
          const out = ease(seg(f, 0.15, 0.3)), gone = seg(f, 0.3, 0.42), back = ease(seg(f, 0.42, 0.62)), seat = seg(f, 0.62, 0.7);
          const mp = R.mag.p;
          if (f < 0.3) { P.mag.position.set(mp.x, mp.y - out * 0.12, mp.z + out * 0.02); P.mag.visible = true; }
          else if (f < 0.42) { P.mag.position.set(mp.x, mp.y - 0.12 - gone * 0.4, mp.z); P.mag.visible = gone < 0.95; }
          else { P.mag.visible = true; P.mag.position.set(mp.x, mp.y - (1 - back) * 0.3 - (1 - seat) * 0.015, mp.z + (1 - back) * 0.05); }
          const mw = new THREE.Vector3(); P.mag.getWorldPosition(mw); mw.y -= 0.06;
          if (f > 0.12 && f < 0.72) handL = mw;
          if (f > 0.62 && f < 0.7) { this.kickRot -= dt * 0.8; }
        }
        if (a.empty && P.bolt && f > 0.74 && f < 0.92) {
          const bf = seg(f, 0.74, 0.92), pull = Math.sin(bf * Math.PI);
          P.bolt.position.z = R.bolt.p.z + pull * 0.07;
          const bw = new THREE.Vector3(); P.bolt.getWorldPosition(bw);
          if (id === 'ak47' || id === 'awm') handROverride = null; else handL = bw;
          if (id === 'ak47') handL = bw;
          rz -= pull * 0.1;
        } else if (P.bolt && R.bolt) P.bolt.position.z = R.bolt.p.z;
        if (id === 'deagle' && P.slide && a.empty && f > 0.8 && f < 0.9) P.slide.position.z = R.slide.p.z + 0.03;
      } else if (a.type === 'bolt' && P.bolt) {
        const f2 = seg(f, 0.15, 0.85);
        const up = ease(seg(f2, 0, 0.2)) * (1 - ease(seg(f2, 0.8, 1)));
        const backK = ease(seg(f2, 0.2, 0.45)) * (1 - ease(seg(f2, 0.55, 0.8)));
        P.bolt.rotation.z = up * 1.2; P.bolt.position.z = R.bolt.p.z + backK * 0.09;
        rz += Math.sin(f2 * Math.PI) * 0.18; rx += Math.sin(f2 * Math.PI) * 0.06; py -= Math.sin(f2 * Math.PI) * 0.015;
        const bw = new THREE.Vector3(); P.bolt.children[1]?.getWorldPosition(bw);
        if (f2 > 0 && f2 < 1) handROverride = bw;
        if (backK > 0.5 && !a.ejected) { a.ejected = true; this.ejectShell(); }
      } else if (a.type === 'slash') {
        const s = Math.sin(f * Math.PI), dir = a.dir;
        ry += dir * (f - 0.5) * -2.2; rz += dir * s * -0.6; px += dir * (0.5 - f) * 0.12; pz -= s * 0.08; rx += s * 0.3;
      } else if (a.type === 'stab') {
        const wind = ease(seg(f, 0, 0.35)), thrust = ease(seg(f, 0.35, 0.55)), ret = ease(seg(f, 0.65, 1));
        pz += wind * 0.08 - thrust * 0.22 + ret * 0.14; rx += wind * -0.4 + thrust * 0.9 - ret * 0.5; py += wind * 0.05 - thrust * 0.04;
      } else if (a.type === 'throw') {
        const pin = seg(f, 0, 0.3), wind = ease(seg(f, 0.3, 0.55)), thr = ease(seg(f, 0.55, 0.8));
        if (P.pin) { P.pin.visible = pin < 0.6; }
        if (pin < 1) handL = this.cur.localToWorld(new THREE.Vector3(0.03, 0.06, 0));
        py += wind * 0.08 - thr * 0.12; pz += wind * 0.1 - thr * 0.3; rx += wind * 0.8 - thr * 1.6;
        if (f > 0.72) this.cur.visible = false;
      } else if (a.type === 'inspect') {
        const s1 = ease(seg(f, 0, 0.25)) * (1 - ease(seg(f, 0.8, 1)));
        const s2 = ease(seg(f, 0.4, 0.6)) * (1 - ease(seg(f, 0.8, 1)));
        ry += s1 * 0.9 - s2 * 1.1; rz += s1 * 0.5; px -= s1 * 0.08; py += s1 * 0.04; rx += s2 * 0.3;
      }
      if (f >= 1) { this.anim = null; this.resetParts(); if (a.type === 'throw') this.cur.visible = false; }
    }
    this.holder.position.set(px, py, pz);
    this.holder.rotation.set(rx, ry, rz);
    this.holder.updateMatrixWorld(true);
    // 手臂 IK（简化：前臂从固定肘点指向手）
    const gp = P.grip ? P.grip.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(px, py, pz);
    const fp = P.fore ? P.fore.getWorldPosition(new THREE.Vector3()) : null;
    this.placeArm('R', handROverride || gp, true);
    if (id === 'knife') this.arms.L.g.visible = false;
    else { this.arms.L.g.visible = true; this.placeArm('L', handL || fp || gp, false); }
    // 枪口火焰
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
      this.flash.getWorldPosition(this.muzzleLight.position);
      this.muzzleLight.intensity = this.flashT > 0 ? 3 : 0;
    }
    // 弹壳
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.w.x * dt; s.mesh.rotation.y += s.w.y * dt;
      if (s.life <= 0) s.mesh.visible = false;
    }
    // 光照
    if (st.sunDirCam) this.sun.position.copy(st.sunDirCam);
    this.sun.intensity = 2.6 * (st.light ?? 1);
    this.fill.intensity = 0.35 * (st.indoor ? 0.5 : 1);
  }
  placeArm(s, handPos, right) {
    const A = this.arms[s];
    const E = this.elbow[s].clone();
    const hp = (HIP[this.id] || HIP.ak47).p;
    E.x += (this.holder.position.x - hp[0]) * 0.6; E.y += (this.holder.position.y - hp[1]) * 0.6; E.z += (this.holder.position.z - hp[2]) * 0.5;
    if (this.id === 'deagle' && s === 'L') E.set(0.0, -0.46, -0.3);
    const dir = handPos.clone().sub(E);
    const L = dir.length(); dir.normalize();
    const back = handPos.clone().addScaledVector(dir, -0.05);
    const mid = E.clone().add(back).multiplyScalar(0.5);
    A.fore.position.copy(mid);
    A.fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    A.fore.scale.set(1, Math.max(0.2, (L - 0.05) / 0.39), 1);
    A.cuff.position.copy(handPos).addScaledVector(dir, -0.075);
    A.cuff.quaternion.copy(A.fore.quaternion);
    A.hand.position.copy(handPos);
    // 手掌朝向：沿前臂方向，右手握把稍向前倾
    A.hand.quaternion.copy(this.holder.quaternion);
    if (right) A.hand.rotateX(-0.35); else A.hand.rotateX(0.3);
  }
}
