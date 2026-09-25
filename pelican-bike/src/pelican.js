import * as THREE from 'three';
import { DynamicTube, loft, v3, TAU, placeBetween, unitCylinder, solveTwoBone, clamp, lerp, damp, smoothstep } from './util.js';
import { makeFeatherTexture } from './textures.js';

const BODY_POS = v3(-0.13, 0.965, 0);
const BODY_PITCH = 0.35;
const THIGH = 0.36;
const SHIN = 0.37;
const HUMERUS = 0.22;
const FOREARM = 0.23;
const BEAK_L = 0.4;

function materials() {
  const feather = makeFeatherTexture();
  feather.repeat.set(9, 5);
  const whiteBase = {
    color: '#f6f3ec',
    roughness: 0.9,
    sheen: 1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff'),
    bumpMap: feather,
    bumpScale: 0.45,
  };
  return {
    body: new THREE.MeshPhysicalMaterial({ ...whiteBase, color: '#ffffff', vertexColors: true }),
    white: new THREE.MeshPhysicalMaterial(whiteBase),
    panel: new THREE.MeshStandardMaterial({ color: '#f3f0e8', roughness: 0.85, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: '#19181b', roughness: 0.7, side: THREE.DoubleSide }),
    beak: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    pouch: new THREE.MeshPhysicalMaterial({
      color: '#f5b857',
      roughness: 0.45,
      sheen: 0.8,
      sheenColor: new THREE.Color('#ffd7a3'),
      clearcoat: 0.3,
      side: THREE.DoubleSide,
      emissive: new THREE.Color('#5a2200'),
      emissiveIntensity: 0.15,
    }),
    skin: new THREE.MeshStandardMaterial({ color: '#f6c49b', roughness: 0.55 }),
    eye: new THREE.MeshPhysicalMaterial({ color: '#1a0c08', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12 }),
    iris: new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.3 }),
    leg: new THREE.MeshPhysicalMaterial({ color: '#f38a2a', roughness: 0.45, clearcoat: 0.3 }),
    helmet: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.14 }),
    vent: new THREE.MeshStandardMaterial({ color: '#202225', roughness: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#0b1016', metalness: 0.9, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.12 }),
    frame: new THREE.MeshPhysicalMaterial({ color: '#ff3d6e', roughness: 0.25, clearcoat: 1 }),
    scarfKnot: new THREE.MeshStandardMaterial({ color: '#d7263d', roughness: 0.7 }),
  };
}

// 身体：变形球体 + 胸口淡黄
function bodyGeometry() {
  const g = new THREE.SphereGeometry(1, 56, 36);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const white = new THREE.Color('#fbfaf6');
  const cream = new THREE.Color('#f6e2a6');
  const grey = new THREE.Color('#e4e1da');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const taper = x < 0 ? 1 - 0.5 * Math.pow(-x, 1.7) : 1 - 0.14 * x * x;
    let X = x * 0.4;
    let Y = y * 0.215 * taper * (y < 0 ? 0.92 : 1);
    const Z = z * 0.2 * taper;
    if (x < -0.35) Y += (-x - 0.35) * 0.06;
    if (x > 0.2 && y > 0) X += y * 0.05 * (x - 0.2);
    p.setXYZ(i, X, Y, Z);
    c.copy(white);
    c.lerp(cream, smoothstep(0.35, 0.85, x) * smoothstep(-0.6, 0.1, y) * 0.8);
    c.lerp(grey, smoothstep(0.2, 0.9, y) * smoothstep(0.2, -0.6, x) * 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function featherShape(len, width) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(len * 0.12, width * 0.55, len * 0.5, width * 0.5);
  s.quadraticCurveTo(len * 0.92, width * 0.42, len, 0);
  s.quadraticCurveTo(len * 0.9, -width * 0.42, len * 0.5, -width * 0.5);
  s.quadraticCurveTo(len * 0.12, -width * 0.55, 0, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(Math.PI / 2); // 形状 Y -> +Z（翼面内）
  return g;
}

function panelGeometry(len, depth, scallops) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.01);
  s.lineTo(len, -0.01);
  const n = scallops;
  for (let i = 0; i <= n; i++) {
    const x = len - (i / n) * len;
    const d = depth * (0.75 + 0.25 * Math.sin((i / n) * Math.PI));
    s.quadraticCurveTo(x + len / n / 2, d * 1.08, x, d * 0.9);
  }
  s.lineTo(0, -0.01);
  const g = new THREE.ShapeGeometry(s, 4);
  g.rotateX(Math.PI / 2);
  return g;
}

function footGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.02, 0.012);
  s.quadraticCurveTo(0.04, 0.03, 0.1, 0.05);
  s.quadraticCurveTo(0.09, 0.028, 0.105, 0.022);
  s.quadraticCurveTo(0.11, 0.01, 0.125, 0.0);
  s.quadraticCurveTo(0.11, -0.01, 0.105, -0.022);
  s.quadraticCurveTo(0.09, -0.028, 0.1, -0.05);
  s.quadraticCurveTo(0.04, -0.03, -0.02, -0.012);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // 平放，脚趾朝 +X
  return g;
}

function upperBeak() {
  const base = new THREE.Color('#f3a37f');
  const mid = new THREE.Color('#f7c25c');
  const tip = new THREE.Color('#ef8e3a');
  const nail = new THREE.Color('#cf3f2c');
  return loft({
    segs: 36,
    ring: 20,
    center: (t) => v3(t * BEAK_L, -0.006 * t - 0.012 * t * t * t, 0),
    section: (t, a) => {
      const th = a * TAU;
      const close = Math.sqrt(Math.max(0, 1 - Math.pow(t, 10)));
      const w = (0.034 * (1 - 0.55 * t) + 0.007) * close;
      const h = (0.017 * (1 - 0.5 * t) + 0.004) * close;
      const c = Math.cos(th);
      const ridge = c > 0.9 ? 1.18 : 1;
      return [c > 0 ? c * h * ridge : c * h * 0.3, Math.sin(th) * w];
    },
    color: (t, a, c) => {
      c.copy(base).lerp(mid, smoothstep(0.0, 0.35, t)).lerp(tip, smoothstep(0.5, 0.95, t));
      if (t > 0.94) c.copy(nail);
      if (Math.cos(a * TAU) > 0.85) c.offsetHSL(0, 0, 0.06);
    },
  });
}

function lowerBeak() {
  const c0 = new THREE.Color('#f2b25a');
  const c1 = new THREE.Color('#e98c3a');
  return loft({
    segs: 30,
    ring: 14,
    center: (t) => v3(t * BEAK_L * 0.97, -0.018 - 0.008 * t - 0.012 * t * t * t, 0),
    section: (t, a) => {
      const th = a * TAU;
      const close = Math.sqrt(Math.max(0, 1 - Math.pow(t, 10)));
      const w = (0.032 * (1 - 0.55 * t) + 0.006) * close;
      const h = 0.007 * close + 0.001;
      return [Math.cos(th) * h, Math.sin(th) * w];
    },
    color: (t, a, c) => c.copy(c0).lerp(c1, t),
  });
}

function pouchGeometry(bulge) {
  return loft({
    segs: 30,
    ring: 18,
    center: (t) => v3(t * BEAK_L * 0.95, -0.02 - 0.008 * t - 0.012 * t * t * t, 0),
    section: (t, a) => {
      const phi = a * Math.PI;
      const close = Math.sqrt(Math.max(0, 1 - Math.pow(t, 8)));
      const bell = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 1.25);
      const d = (0.07 * bell + 0.004) * close * (1 + bulge * 1.4 * Math.pow(bell, 2));
      const w = (0.031 * (1 - 0.5 * t) + 0.004) * close * (1 + bulge * 0.9 * bell);
      return [-Math.sin(phi) * d, Math.cos(phi) * w];
    },
  });
}

function helmetGeometry() {
  const g = new THREE.SphereGeometry(0.084, 32, 14, 0, TAU, 0, Math.PI * 0.5);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const coral = new THREE.Color('#ff5a4e');
  const white = new THREE.Color('#fdfdfd');
  const teal = new THREE.Color('#1ab0a8');
  const dark = new THREE.Color('#2a2c30');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const y = p.getY(i);
    const x = p.getX(i);
    let c = coral;
    if (Math.abs(z) < 0.012) c = white;
    else if (Math.abs(Math.abs(z) - 0.042) < 0.008 && y > 0.02) c = teal;
    if (y > 0.05 && Math.abs(x) < 0.045 && (Math.abs(Math.abs(z) - 0.024) < 0.005)) c = dark;
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.scale(1.32, 0.86, 1.08);
  return g;
}

export function createPelican() {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'pelican';
  const hitMeshes = [];
  const reg = (m, cast = true) => {
    m.castShadow = cast;
    m.receiveShadow = true;
    hitMeshes.push(m);
    return m;
  };

  // ---------- 身体 ----------
  const body = new THREE.Group();
  body.position.copy(BODY_POS);
  body.rotation.z = BODY_PITCH;
  root.add(body);
  const bodyMesh = reg(new THREE.Mesh(bodyGeometry(), M.body));
  body.add(bodyMesh);
  const anchor = (x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    body.add(o);
    return o;
  };
  const A = {
    hipL: anchor(-0.05, -0.125, -0.09),
    hipR: anchor(-0.05, -0.125, 0.09),
    shL: anchor(0.14, 0.085, -0.17),
    shR: anchor(0.14, 0.085, 0.17),
    neck: anchor(0.3, 0.1, 0),
  };
  // 尾羽
  const tail = new THREE.Group();
  tail.position.set(-0.37, 0.035, 0);
  body.add(tail);
  const tailFeather = featherShape(0.17, 0.06);
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(tailFeather, M.panel);
    f.rotation.set(0, Math.PI + (i - 3) * 0.16, 0.25);
    f.position.y = Math.abs(i - 3) * -0.003;
    f.castShadow = true;
    tail.add(f);
  }

  // ---------- 脖子（每帧重建） ----------
  const neck = new DynamicTube(28, 18, (t) => {
    const r = lerp(0.085, 0.05, smoothstep(0.0, 0.45, t));
    return r + 0.004 * Math.sin(t * Math.PI) + (t > 0.85 ? (t - 0.85) * 0.05 : 0);
  });
  const neckMesh = reg(new THREE.Mesh(neck.geometry, M.white));
  neckMesh.frustumCulled = false;
  root.add(neckMesh);
  const knot = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.022, 10, 24), M.scarfKnot);
  knot.castShadow = true;
  root.add(knot);

  // ---------- 头 ----------
  const head = new THREE.Group();
  root.add(head);
  const skull = reg(new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 20), M.white));
  skull.scale.set(1.3, 1.0, 0.9);
  const forehead = reg(new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), M.white));
  forehead.scale.set(1.45, 0.85, 0.85);
  forehead.position.set(0.05, -0.006, 0);
  const throat = reg(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), M.white));
  throat.position.set(0.02, -0.045, 0);
  head.add(skull, forehead, throat);
  // 冠羽
  for (let i = 0; i < 5; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 6), M.white);
    cone.position.set(-0.085, 0.02 + i * 0.006, (i - 2) * 0.012);
    cone.rotation.z = Math.PI / 2 + 0.5 + (i % 2) * 0.2;
    cone.castShadow = true;
    head.add(cone);
  }
  const eyes = [];
  const lids = [];
  for (const s of [-1, 1]) {
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), M.skin);
    patch.scale.set(1.25, 0.8, 0.45);
    patch.position.set(0.048, 0.004, s * 0.05);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0128, 16, 12), M.eye);
    eye.position.set(0.05, 0.008, s * 0.06);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), M.iris);
    iris.position.set(0.054, 0.009, s * 0.0715);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), M.eye);
    pupil.position.set(0.0555, 0.009, s * 0.0752);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0145, 16, 12), M.skin);
    lid.position.copy(eye.position);
    lid.scale.setScalar(0.001);
    head.add(patch, eye, iris, pupil, lid);
    eyes.push(eye);
    lids.push(lid);
  }
  // 头盔
  const helmet = new THREE.Group();
  const shell = new THREE.Mesh(helmetGeometry(), M.helmet);
  shell.castShadow = true;
  helmet.add(shell);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 6, -0.9, 1.8, Math.PI * 0.48, 0.12), M.helmet);
  visor.scale.set(1.32, 0.86, 1.08);
  visor.rotation.y = Math.PI / 2;
  helmet.add(visor);
  helmet.position.set(-0.012, 0.03, 0);
  helmet.rotation.z = -0.12;
  head.add(helmet);
  // 墨镜
  const glasses = new THREE.Group();
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.005, 24), M.lens);
    lens.rotation.x = Math.PI / 2;
    lens.rotation.y = s * 0.35;
    lens.position.set(0.058, 0.01, s * 0.079);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 24), M.frame);
    rim.position.copy(lens.position);
    rim.rotation.y = s * 0.35;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.004), M.frame);
    arm.position.set(0.005, 0.02, s * 0.074);
    arm.rotation.y = -s * 0.06;
    glasses.add(lens, rim, arm);
  }
  const bridgeCurve = new THREE.CatmullRomCurve3([v3(0.064, 0.022, -0.068), v3(0.085, 0.04, 0), v3(0.064, 0.022, 0.068)]);
  glasses.add(new THREE.Mesh(new THREE.TubeGeometry(bridgeCurve, 16, 0.003, 6), M.frame));
  head.add(glasses);

  // 嘴与喉囊
  const beak = new THREE.Group();
  beak.position.set(0.078, -0.016, 0);
  beak.rotation.z = -0.3;
  head.add(beak);
  const upper = reg(new THREE.Mesh(upperBeak(), M.beak));
  const upperPivot = new THREE.Group();
  upperPivot.add(upper);
  beak.add(upperPivot);
  const jaw = new THREE.Group();
  beak.add(jaw);
  const lower = reg(new THREE.Mesh(lowerBeak(), M.beak));
  const pouchGeo = pouchGeometry(0);
  const bulged = pouchGeometry(1);
  pouchGeo.morphAttributes.position = [bulged.attributes.position];
  const pouch = reg(new THREE.Mesh(pouchGeo, M.pouch));
  pouch.morphTargetInfluences = [0];
  jaw.add(lower, pouch);
  // 嘴尖锚点（用于判定吃鱼）
  const beakTip = new THREE.Object3D();
  beakTip.position.set(BEAK_L * 0.8, -0.03, 0);
  beak.add(beakTip);
  const mouth = new THREE.Object3D();
  mouth.position.set(BEAK_L * 0.35, -0.04, 0);
  beak.add(mouth);

  // ---------- 腿 ----------
  const leg = (s) => {
    const thigh = reg(new THREE.Mesh(unitCylinder(0.064, 0.042, 14), M.white));
    const knee = reg(new THREE.Mesh(new THREE.SphereGeometry(0.043, 14, 10), M.white));
    const shin = reg(new THREE.Mesh(unitCylinder(0.024, 0.019, 10), M.leg));
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), M.leg);
    const foot = new THREE.Mesh(footGeometry(), M.leg);
    foot.castShadow = true;
    ankle.castShadow = true;
    root.add(thigh, knee, shin, ankle, foot);
    return { thigh, knee, shin, ankle, foot, s };
  };
  const legs = [leg(-1), leg(1)];

  // ---------- 翅膀 ----------
  const tertial = panelGeometry(HUMERUS, 0.14, 4);
  const covert = panelGeometry(FOREARM, 0.085, 5);
  const secondary = panelGeometry(FOREARM, 0.165, 7);
  const primaryGeos = [0.2, 0.24, 0.27, 0.28, 0.27, 0.24].map((l) => featherShape(l, 0.05));
  const wing = (s) => {
    const sh = new THREE.Group();
    const el = new THREE.Group();
    const wr = new THREE.Group();
    const hum = reg(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), M.white));
    hum.scale.set(HUMERUS / 2 + 0.025, 0.036, 0.07);
    hum.position.set(HUMERUS / 2, 0, 0.018);
    const tp = new THREE.Mesh(tertial, M.panel);
    tp.position.y = -0.004;
    sh.add(hum, tp);
    const fa = reg(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), M.white));
    fa.scale.set(FOREARM / 2 + 0.02, 0.03, 0.058);
    fa.position.set(FOREARM / 2, 0, 0.014);
    const cv = new THREE.Mesh(covert, M.panel);
    cv.position.y = 0.002;
    const sc = new THREE.Mesh(secondary, M.black);
    sc.position.y = -0.004;
    el.add(fa, cv, sc);
    const hand = reg(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), M.white));
    hand.scale.set(0.05, 0.03, 0.038);
    hand.position.x = 0.02;
    wr.add(hand);
    const prim = primaryGeos.map((g, i) => {
      const f = new THREE.Mesh(g, M.black);
      f.position.set(0.01, -0.003 - i * 0.0015, 0.004 * i);
      f.castShadow = true;
      wr.add(f);
      return f;
    });
    for (const o of [sh, el, wr]) {
      o.traverse((c) => {
        if (c.isMesh) c.castShadow = true;
      });
      root.add(o);
    }
    return { sh, el, wr, prim, s };
  };
  const wings = [wing(-1), wing(1)];

  // ---------- 动画状态 ----------
  const st = {
    jaw: 0,
    jawTarget: 0,
    bulge: 0,
    blink: 0,
    nextBlink: 1.5,
    blinkT: -1,
    honkT: -1,
    gulpT: -1,
    yaw: 0,
    pitch: 0,
    spread: 0,
    headBob: 0,
  };

  const V = {
    hip: new THREE.Vector3(),
    knee: new THREE.Vector3(),
    ank: new THREE.Vector3(),
    tgt: new THREE.Vector3(),
    sh: new THREE.Vector3(),
    el: new THREE.Vector3(),
    wr: new THREE.Vector3(),
    elS: new THREE.Vector3(),
    wrS: new THREE.Vector3(),
    pole: new THREE.Vector3(),
    tmp: new THREE.Vector3(),
    trail: new THREE.Vector3(),
    headPos: new THREE.Vector3(),
    neckBase: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  };
  const neckPts = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)];
  const _bx = new THREE.Vector3();
  const _by = new THREE.Vector3();
  const _bz = new THREE.Vector3();
  const _mb = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _ax = new THREE.Vector3(1, 0, 0);

  const local = (anchorObj, out) => out.copy(anchorObj.position).applyMatrix4(body.matrix);

  // 以骨骼方向与后缘方向建立关节坐标系
  function orientJoint(obj, from, to, trailHint) {
    _bx.subVectors(to, from).normalize();
    _bz.copy(trailHint).addScaledVector(_bx, -trailHint.dot(_bx));
    if (_bz.lengthSq() < 1e-6) _bz.set(0, -1, 0);
    _bz.normalize();
    _by.crossVectors(_bz, _bx);
    _mb.makeBasis(_bx, _by, _bz);
    obj.position.copy(from);
    obj.quaternion.setFromRotationMatrix(_mb);
  }

  function honk() {
    st.honkT = 0;
  }
  function gulp() {
    st.gulpT = 0;
  }

  function update(dt, ctx) {
    const { t, crankAngle, pedal, airborne, trick, look, grips, pedals, accel } = ctx;
    // 身体随踩踏起伏、左右摆
    const bob = -Math.abs(Math.sin(crankAngle)) * 0.012 * pedal;
    body.position.set(BODY_POS.x, BODY_POS.y + bob + airborne * 0.025 + trick * 0.03, BODY_POS.z);
    body.rotation.set(Math.sin(crankAngle) * 0.035 * pedal, 0, BODY_PITCH + trick * 0.14 - clamp(accel, -3, 3) * 0.012);
    body.updateMatrix();
    tail.rotation.y = Math.sin(crankAngle) * 0.09 * pedal + Math.sin(t * 2) * 0.03;
    tail.rotation.z = trick * 0.25;

    // ----- 腿 IK -----
    for (const L of legs) {
      local(L.s < 0 ? A.hipL : A.hipR, V.hip);
      const p = L.s < 0 ? pedals.L : pedals.R;
      V.tgt.set(p.x - 0.04, p.y + 0.046, p.z * 0.92);
      V.pole.set(1, 0.15, L.s * 0.32);
      solveTwoBone(V.hip, V.tgt, THIGH, SHIN, V.pole, V.knee, V.ank);
      placeBetween(L.thigh, V.hip, V.knee);
      L.knee.position.copy(V.knee);
      placeBetween(L.shin, V.knee, V.ank);
      L.ankle.position.copy(V.ank);
      L.foot.position.set(V.ank.x - 0.012, V.ank.y - 0.04, V.ank.z);
      L.foot.rotation.set(0, 0, -0.08 + Math.sin(-crankAngle + (L.s > 0 ? 0 : Math.PI) + 0.6) * 0.12);
    }

    // ----- 翅膀：握把 <-> 展翅 -----
    st.spread = damp(st.spread, trick, 5, dt);
    const k = smoothstep(0, 1, st.spread);
    const flap = Math.sin(t * 8.5) * 0.55 * airborne + Math.sin(t * 2.6) * 0.32 * k + k * 0.08;
    for (const W of wings) {
      const s = W.s;
      local(s < 0 ? A.shL : A.shR, V.sh);
      const grip = s < 0 ? grips.L : grips.R;
      V.pole.set(-0.25, 0.75, s * 0.85);
      solveTwoBone(V.sh, grip, HUMERUS, FOREARM, V.pole, V.el, V.wr);
      // 展翅姿态（绕肩部 x 轴拍打）
      V.elS.set(0.0, 0.06, s * HUMERUS * 0.98);
      V.wrS.set(0.02, 0.1, s * (HUMERUS * 0.98 + FOREARM * 0.99));
      _q.setFromAxisAngle(_ax, -s * flap);
      V.elS.applyQuaternion(_q).add(V.sh);
      V.wrS.applyQuaternion(_q).add(V.sh);
      V.el.lerp(V.elS, k);
      V.wr.lerp(V.wrS, k);
      V.trail.set(-1, lerp(-0.7, 0.0, k), 0);
      orientJoint(W.sh, V.sh, V.el, V.trail);
      orientJoint(W.el, V.el, V.wr, V.trail);
      // 手部方向：握把时沿前臂，展开时向外延伸
      V.tmp.subVectors(V.wr, V.el).normalize().multiplyScalar(0.1).add(V.wr);
      orientJoint(W.wr, V.wr, V.tmp, V.trail);
      W.prim.forEach((f, i) => {
        const folded = Math.PI - 0.12 - i * 0.05;
        const spread = i * 0.2 - 0.1;
        f.rotation.y = -lerp(folded, spread, k);
        f.scale.setScalar(1 + k * 0.45);
      });
    }

    // ----- 头部：看向目标，身体起伏时头部稳定 -----
    local(A.neck, V.neckBase);
    st.headBob = damp(st.headBob, bob * 0.25, 10, dt);
    V.headPos.set(V.neckBase.x + 0.092, V.neckBase.y + 0.355 - bob * 0.75 + st.headBob, 0);
    let yawT = 0;
    let pitchT = -0.05;
    if (look) {
      V.dir.subVectors(look, V.headPos);
      yawT = Math.atan2(-V.dir.z, V.dir.x);
      pitchT = Math.atan2(V.dir.y, Math.hypot(V.dir.x, V.dir.z));
      if (V.dir.x < -0.2) yawT = clamp(yawT, -1.2, 1.2);
    }
    yawT = clamp(yawT, -1.05, 1.05);
    pitchT = clamp(pitchT, -0.55, 0.5);
    // 大叫：仰头张嘴
    let honkK = 0;
    if (st.honkT >= 0) {
      st.honkT += dt;
      honkK = Math.sin(Math.min(1, st.honkT / 0.9) * Math.PI);
      if (st.honkT > 0.9) st.honkT = -1;
    }
    let gulpK = 0;
    if (st.gulpT >= 0) {
      st.gulpT += dt;
      gulpK = st.gulpT < 0.18 ? st.gulpT / 0.18 : Math.max(0, 1 - (st.gulpT - 0.18) / 0.25);
      if (st.gulpT < 0.3) st.bulge = Math.max(st.bulge, st.gulpT / 0.3);
      if (st.gulpT > 1.2) st.gulpT = -1;
    }
    pitchT += honkK * 0.55 + gulpK * 0.35 + trick * 0.15;
    st.yaw = damp(st.yaw, yawT, 5, dt);
    st.pitch = damp(st.pitch, pitchT, 6, dt);
    V.headPos.x -= honkK * 0.02;
    V.headPos.y += honkK * 0.03;
    head.position.copy(V.headPos);
    head.rotation.set(Math.sin(t * 1.3) * 0.03, st.yaw, st.pitch, 'YZX');
    head.updateMatrix();

    st.jawTarget = Math.max(honkK * 0.55, gulpK * 0.7, ctx.mouthOpen || 0);
    st.jaw = damp(st.jaw, st.jawTarget, 20, dt);
    jaw.rotation.z = -st.jaw;
    upperPivot.rotation.z = st.jaw * 0.12;
    st.bulge = Math.max(0, st.bulge - dt * 0.45);
    pouch.morphTargetInfluences[0] = clamp(st.bulge + Math.sin(t * 20) * 0.08 * st.bulge + honkK * 0.25, 0, 1.3);

    // 眨眼
    st.nextBlink -= dt;
    if (st.nextBlink <= 0 && st.blinkT < 0) {
      st.blinkT = 0;
      st.nextBlink = 2 + Math.random() * 4;
    }
    let blink = 0;
    if (st.blinkT >= 0) {
      st.blinkT += dt;
      blink = Math.sin(Math.min(1, st.blinkT / 0.16) * Math.PI);
      if (st.blinkT > 0.16) st.blinkT = -1;
    }
    for (const l of lids) l.scale.setScalar(Math.max(0.001, blink > 0.05 ? blink : 0.001));

    // 脖子 S 形曲线
    neckPts[0].copy(V.neckBase).add(V.tmp.set(-0.03, -0.03, 0));
    neckPts[1].copy(V.neckBase).add(V.tmp.set(0.035, 0.07, 0));
    neckPts[2].copy(V.neckBase).lerp(V.headPos, 0.45).add(V.tmp.set(0.035, 0, 0));
    neckPts[3].set(-0.075, -0.1, 0).applyMatrix4(head.matrix).lerp(V.tmp.copy(V.headPos).add(_by.set(-0.075, -0.1, 0)), 0.4);
    neckPts[4].set(-0.03, -0.03, 0).applyMatrix4(head.matrix);
    neck.update(neckPts);
    // 围巾结位于脖子根部
    const ki = Math.round(neck.tub * 0.2);
    knot.position.copy(neck._P[ki]);
    knot.quaternion.setFromUnitVectors(_bz.set(0, 0, 1), neck._T[ki]);

    helmet.visible = ctx.helmet;
    glasses.visible = ctx.glasses;
  }

  return {
    root,
    body,
    head,
    beakTip,
    mouth,
    knot,
    hitMeshes,
    update,
    honk,
    gulp,
    materials: M,
    state: st,
  };
}
