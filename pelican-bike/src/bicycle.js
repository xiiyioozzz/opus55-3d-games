import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cylBetween, v3, TAU, loft } from './util.js';
import { makeDecalTexture, makeWickerTexture } from './textures.js';
import { fishGeometry } from './fish.js';

export const WHEEL_R = 0.3;
export const GEARS = [
  [44, 28],
  [44, 22],
  [44, 18],
  [44, 15],
  [44, 12],
];

const P = {
  rearHub: v3(-0.46, WHEEL_R, 0),
  frontHub: v3(0.48, WHEEL_R, 0),
  bb: v3(-0.06, 0.25, 0),
  seat: v3(-0.2, 0.64, 0),
  saddle: v3(-0.235, 0.705, 0),
  headTop: v3(0.32, 0.72, 0),
  headBot: v3(0.36, 0.57, 0),
};
export const BIKE_POINTS = P;
const CRANK = 0.15;
const RING_R = 0.1;
const COG_R = 0.042;

function mats() {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: '#138a8a',
      metalness: 0.35,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    }),
    chrome: new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 1, roughness: 0.24 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1c1d1f', metalness: 0.2, roughness: 0.85 }),
    tire: new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.92 }),
    tan: new THREE.MeshStandardMaterial({ color: '#c79a64', roughness: 0.8 }),
    leather: new THREE.MeshPhysicalMaterial({ color: '#6e3f22', roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4 }),
    cream: new THREE.MeshPhysicalMaterial({ color: '#efe6cf', roughness: 0.35, clearcoat: 0.8, metalness: 0.1 }),
    reflector: new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: new THREE.Color('#ff6a00'), emissiveIntensity: 0.25, roughness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: new THREE.Color('#fff1c4'), emissiveIntensity: 0.3, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: new THREE.Color('#ff1010'), emissiveIntensity: 0.4, roughness: 0.3 }),
  };
}

function wheel(m) {
  const g = new THREE.Group();
  const R = WHEEL_R;
  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.018, 0.018, 12, 72), m.tire);
  // 奶油色胎壁
  const wall = new THREE.Mesh(new THREE.TorusGeometry(R - 0.03, 0.0125, 8, 72), m.tan);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.04, 0.007, 8, 72), m.chrome);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 14).rotateX(Math.PI / 2), m.chrome);
  const flange = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16).rotateX(Math.PI / 2);
  const f1 = new THREE.Mesh(flange, m.chrome);
  f1.position.z = 0.034;
  const f2 = f1.clone();
  f2.position.z = -0.034;
  // 切向交叉编辐条，合并为一个网格
  const spokes = [];
  const N = 28;
  const up = v3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1;
    const lace = (Math.floor(i / 2) % 2 ? 1 : -1) * 0.42;
    const ar = (i / N) * TAU;
    const ah = ar + lace;
    const a = v3(Math.cos(ah) * 0.024, Math.sin(ah) * 0.024, side * 0.034);
    const b = v3(Math.cos(ar) * (R - 0.045), Math.sin(ar) * (R - 0.045), side * 0.004);
    const len = a.distanceTo(b);
    const cg = new THREE.CylinderGeometry(0.0014, 0.0014, len, 4, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize());
    const mtx = new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, v3(1, 1, 1));
    cg.applyMatrix4(mtx);
    spokes.push(cg);
  }
  const spokeMesh = new THREE.Mesh(mergeGeometries(spokes), m.chrome);
  const blurMat = new THREE.MeshBasicMaterial({
    color: '#c9ced4',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const blur = new THREE.Mesh(new THREE.RingGeometry(0.03, R - 0.045, 48, 1), blurMat);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), m.chrome);
  valve.position.set(0, R - 0.055, 0);
  const refl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.006), m.reflector);
  refl.position.set(0, -(R * 0.62), 0.012);
  refl.rotation.z = Math.PI / 2;
  const rot = new THREE.Group();
  rot.add(tire, wall, rim, hub, f1, f2, spokeMesh, blur, valve, refl);
  for (const o of [tire, wall, rim, hub, spokeMesh]) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
  g.add(rot);
  return { group: g, rot, blurMat };
}

function gear(teeth, r, m) {
  const parts = [];
  parts.push(new THREE.TorusGeometry(r - 0.004, 0.005, 6, 48));
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    const b = new THREE.BoxGeometry(0.008, 0.009, 0.004);
    b.rotateZ(a);
    b.translate(Math.cos(a) * (r + 0.002), Math.sin(a) * (r + 0.002), 0);
    parts.push(b.toNonIndexed());
  }
  const merged = mergeGeometries(parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    g.deleteAttribute('uv');
    return g;
  }));
  return new THREE.Mesh(merged, m.chrome);
}

// 链条路径：大盘前侧圆弧 -> 下链 -> 飞轮后侧圆弧 -> 上链，顺时针即前进方向
function chainPath() {
  const c1 = new THREE.Vector2(P.bb.x, P.bb.y);
  const c2 = new THREE.Vector2(P.rearHub.x, P.rearHub.y);
  const r1 = RING_R + 0.004;
  const r2 = COG_R + 0.004;
  const d = c1.distanceTo(c2);
  const th = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const be = Math.acos((r1 - r2) / d);
  const topA = th - be;
  const botA = th + be;
  const pts = [];
  const arc = (c, r, a0, a1, n) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r));
    }
  };
  const line = (a, b, n) => {
    for (let i = 0; i < n; i++) pts.push(a.clone().lerp(b, i / n));
  };
  const p1Top = new THREE.Vector2(c1.x + Math.cos(topA) * r1, c1.y + Math.sin(topA) * r1);
  const p1Bot = new THREE.Vector2(c1.x + Math.cos(botA) * r1, c1.y + Math.sin(botA) * r1);
  const p2Top = new THREE.Vector2(c2.x + Math.cos(topA) * r2, c2.y + Math.sin(topA) * r2);
  const p2Bot = new THREE.Vector2(c2.x + Math.cos(botA) * r2, c2.y + Math.sin(botA) * r2);
  let a0 = topA;
  let a1 = botA - TAU;
  arc(c1, r1, a0, a1, 60);
  line(p1Bot, p2Bot, 40);
  arc(c2, r2, botA, topA, 24);
  line(p2Top, p1Top, 40);
  // 累计弧长
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) cum.push(cum[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
  return { pts, cum, length: cum[cum.length - 1] };
}

function sampleChain(path, s, outP) {
  const L = path.length;
  s = ((s % L) + L) % L;
  const { cum, pts } = path;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo % pts.length];
  const b = pts[(lo + 1) % pts.length];
  const t = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
  outP.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Math.atan2(b.y - a.y, b.x - a.x));
  return outP;
}

export function createBicycle() {
  const m = mats();
  const group = new THREE.Group();
  group.name = 'bicycle';
  const add = (o) => {
    group.add(o);
    return o;
  };

  // ---- 车架 ----
  const axis = P.headTop.clone().sub(P.headBot).normalize();
  const ht0 = P.headTop.clone().addScaledVector(axis, 0.025);
  const ht1 = P.headBot.clone().addScaledVector(axis, -0.02);
  add(cylBetween(ht1, ht0, 0.021, 0.021, m.paint));
  add(cylBetween(P.seat, P.headTop.clone().addScaledVector(axis, -0.02), 0.016, 0.016, m.paint));
  add(cylBetween(P.bb, P.headBot.clone().addScaledVector(axis, 0.03), 0.02, 0.019, m.paint));
  add(cylBetween(P.bb, P.seat.clone().addScaledVector(v3(0.35, -1, 0).normalize(), -0.03), 0.018, 0.017, m.paint));
  for (const s of [-1, 1]) {
    add(cylBetween(P.bb.clone().setZ(s * 0.02), P.rearHub.clone().setZ(s * 0.05), 0.011, 0.008, m.paint));
    add(cylBetween(P.seat.clone().add(v3(0.0, -0.02, s * 0.015)), P.rearHub.clone().setZ(s * 0.05), 0.009, 0.007, m.paint));
    const drop = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.006), m.chrome);
    drop.position.copy(P.rearHub).setZ(s * 0.052);
    add(drop);
  }
  // 镀铬接头
  for (const p of [P.seat, ht0, ht1, P.headTop.clone().addScaledVector(axis, -0.02)]) {
    const lug = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), m.chrome);
    lug.position.copy(p);
    add(lug);
  }
  const bbShell = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.085, 16).rotateX(Math.PI / 2), m.chrome);
  bbShell.position.copy(P.bb);
  add(bbShell);

  // 下管贴花
  const decal = makeDecalTexture('PELICANO');
  const decalMat = new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 });
  const dtDir = P.headBot.clone().sub(P.bb);
  const dtAng = Math.atan2(dtDir.y, dtDir.x);
  const mid = P.bb.clone().lerp(P.headBot, 0.5);
  const dplane = new THREE.PlaneGeometry(0.3, 0.036);
  const dr = new THREE.Mesh(dplane, decalMat);
  dr.position.copy(mid).setZ(0.0205);
  dr.rotation.set(0, 0, dtAng);
  const dl = new THREE.Mesh(dplane, decalMat);
  dl.position.copy(mid).setZ(-0.0205);
  dl.rotation.set(0, Math.PI, -dtAng);
  add(dr);
  add(dl);

  // ---- 座椅（皮革 + 弹簧） ----
  const seatpost = add(cylBetween(P.seat, P.saddle.clone().add(v3(0.005, -0.02, 0)), 0.012, 0.012, m.chrome));
  seatpost.castShadow = true;
  const saddleGeo = new THREE.SphereGeometry(1, 32, 16);
  {
    const p = saddleGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const nose = x > 0 ? 1 - 0.68 * Math.pow(x, 1.3) : 1 + 0.08 * x;
      p.setXYZ(i, x * 0.13, y * (y > 0 ? 0.03 : 0.012), z * 0.085 * nose);
    }
    saddleGeo.computeVertexNormals();
  }
  const saddle = new THREE.Mesh(saddleGeo, m.leather);
  saddle.position.copy(P.saddle).add(v3(0.01, 0.018, 0));
  saddle.castShadow = true;
  add(saddle);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const a = t * TAU * 5;
      pts.push(v3(Math.cos(a) * 0.012, -t * 0.045, Math.sin(a) * 0.012));
    }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.0025, 5), m.chrome);
    spring.position.copy(P.saddle).add(v3(-0.08, 0.005, s * 0.045));
    add(spring);
  }
  // 尾灯
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.03), m.tail);
  tail.position.copy(P.seat).add(v3(-0.025, 0.0, 0));
  add(tail);

  // ---- 挡泥板 ----
  const fender = (a0, len) => {
    const g = new THREE.CylinderGeometry(WHEEL_R + 0.022, WHEEL_R + 0.022, 0.055, 40, 1, true, a0, len);
    g.rotateX(Math.PI / 2);
    const f = new THREE.Mesh(g, m.cream);
    f.material.side = THREE.DoubleSide;
    f.castShadow = true;
    return f;
  };
  const rearFender = fender(Math.PI * 0.72, Math.PI * 0.92);
  rearFender.position.copy(P.rearHub);
  add(rearFender);

  // ---- 后轮 + 飞轮 ----
  const rear = wheel(m);
  rear.group.position.copy(P.rearHub);
  add(rear.group);
  const cog = gear(18, COG_R, m);
  cog.position.copy(P.rearHub).setZ(0.058);
  add(cog);
  const derailleur = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.012), m.dark);
  derailleur.position.copy(P.rearHub).add(v3(0.005, -0.07, 0.06));
  derailleur.rotation.z = 0.3;
  add(derailleur);

  // ---- 牙盘与曲柄 ----
  const crank = new THREE.Group();
  crank.position.copy(P.bb);
  add(crank);
  const ring = gear(44, RING_R, m);
  ring.position.z = 0.065;
  crank.add(ring);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(RING_R * 0.95, 0.012, 0.006), m.chrome);
    arm.position.set(Math.cos(a) * RING_R * 0.47, Math.sin(a) * RING_R * 0.47, 0.066);
    arm.rotation.z = a;
    crank.add(arm);
  }
  const armGeo = new THREE.BoxGeometry(CRANK, 0.022, 0.012);
  armGeo.translate(CRANK / 2, 0, 0);
  const armR = new THREE.Mesh(armGeo, m.chrome);
  armR.position.z = 0.078;
  const armL = new THREE.Mesh(armGeo, m.chrome);
  armL.position.z = -0.078;
  armL.rotation.z = Math.PI;
  armR.castShadow = armL.castShadow = true;
  crank.add(armR, armL);

  const pedalGeo = new THREE.BoxGeometry(0.085, 0.016, 0.075);
  const makePedal = (s) => {
    const pg = new THREE.Group();
    const body = new THREE.Mesh(pedalGeo, m.dark);
    body.castShadow = true;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.018, 0.04), m.reflector);
    r1.position.set(0.045, 0, 0);
    const r2 = r1.clone();
    r2.position.x = -0.045;
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6).rotateX(Math.PI / 2), m.chrome);
    spindle.position.z = -s * 0.045;
    pg.add(body, r1, r2, spindle);
    add(pg);
    return pg;
  };
  const pedalR = makePedal(1);
  const pedalL = makePedal(-1);

  // ---- 链条（实例化链节）----
  const path = chainPath();
  const LINK = 0.0127;
  const nLinks = Math.floor(path.length / LINK);
  const linkGeo = new THREE.BoxGeometry(LINK * 1.05, 0.0065, 0.009);
  const chain = new THREE.InstancedMesh(linkGeo, m.dark, nLinks);
  chain.castShadow = true;
  chain.frustumCulled = false;
  add(chain);
  const chainZ = 0.062;
  const _cp = new THREE.Vector3();
  const _cm = new THREE.Matrix4();
  const _cq = new THREE.Quaternion();
  const _zAxis = v3(0, 0, 1);
  const _one = v3(1, 1, 1);
  const _pos = new THREE.Vector3();

  // ---- 转向组件（绕头管轴旋转）----
  const steer = new THREE.Group();
  steer.position.copy(P.headBot);
  add(steer);
  const local = (p) => p.clone().sub(P.headBot);
  // 前叉
  for (const s of [-1, 1]) {
    const pts = [
      local(P.headBot.clone().addScaledVector(axis, -0.02)).setZ(s * 0.03),
      local(P.headBot.clone().addScaledVector(axis, -0.14)).setZ(s * 0.05),
      local(P.frontHub.clone().add(v3(-0.03, 0.06, 0))).setZ(s * 0.052),
      local(P.frontHub).setZ(s * 0.052),
    ];
    const blade = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.011, 8), m.paint);
    blade.castShadow = true;
    steer.add(blade);
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.12), m.chrome);
  crown.position.copy(local(P.headBot.clone().addScaledVector(axis, -0.03)));
  crown.rotation.z = Math.atan2(axis.y, axis.x) - Math.PI / 2;
  steer.add(crown);
  // 前轮
  const front = wheel(m);
  front.group.position.copy(local(P.frontHub));
  steer.add(front.group);
  const frontFender = fender(Math.PI * 0.5, Math.PI * 0.72);
  frontFender.position.copy(local(P.frontHub));
  steer.add(frontFender);
  // 把立 + 车把
  const stemBase = P.headTop.clone().addScaledVector(axis, 0.02);
  const stemTop = P.headTop.clone().addScaledVector(axis, 0.1);
  const barC = stemTop.clone().add(v3(0.04, 0.012, 0));
  steer.add(cylBetween(local(stemBase), local(stemTop), 0.012, 0.012, m.chrome));
  steer.add(cylBetween(local(stemTop), local(barC), 0.011, 0.011, m.chrome));
  const barPts = [
    v3(0.19, 0.866, -0.255),
    v3(0.26, 0.866, -0.232),
    v3(0.315, 0.848, -0.13),
    v3(barC.x, barC.y, 0),
    v3(0.315, 0.848, 0.13),
    v3(0.26, 0.866, 0.232),
    v3(0.19, 0.866, 0.255),
  ].map(local);
  const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts, false, 'centripetal'), 64, 0.0105, 8), m.chrome);
  bar.castShadow = true;
  steer.add(bar);
  const grips = {};
  for (const s of [-1, 1]) {
    const g = cylBetween(local(v3(0.255, 0.866, s * 0.234)), local(v3(0.185, 0.866, s * 0.256)), 0.016, 0.017, m.leather);
    steer.add(g);
    const anchor = new THREE.Object3D();
    anchor.position.copy(local(v3(0.222, 0.868, s * 0.245)));
    steer.add(anchor);
    grips[s > 0 ? 'R' : 'L'] = anchor;
  }
  // 车铃（可点击）
  const bell = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 10, 0, TAU, 0, Math.PI / 2), m.chrome);
  dome.name = 'bell';
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.008), m.chrome);
  lever.position.set(-0.02, 0.004, 0.012);
  bell.add(dome, lever);
  bell.position.copy(local(v3(0.318, 0.862, -0.085)));
  steer.add(bell);
  // 车前灯
  const lamp = new THREE.Group();
  const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.055, 18).rotateZ(Math.PI / 2), m.chrome);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 18).rotateY(Math.PI / 2), m.lens);
  lens.position.x = 0.028;
  lamp.add(lampBody, lens);
  lamp.position.copy(local(v3(0.695, 0.745, 0)));
  steer.add(lamp);
  const headlight = new THREE.SpotLight('#fff1d0', 0, 28, 0.5, 0.55, 1.4);
  headlight.position.copy(lamp.position).add(v3(0.03, 0, 0));
  const hlTarget = new THREE.Object3D();
  hlTarget.position.copy(headlight.position).add(v3(5, -0.9, 0));
  steer.add(headlight, hlTarget);
  headlight.target = hlTarget;
  // 藤编车篮 + 鱼
  const basket = new THREE.Group();
  const wicker = makeWickerTexture();
  wicker.repeat.set(6, 1.2);
  const bmat = new THREE.MeshStandardMaterial({ map: wicker, roughness: 0.9, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.125, 0.15, 24, 1, true), bmat);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.125, 24).rotateX(-Math.PI / 2), bmat);
  bottom.position.y = -0.075;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 32).rotateX(Math.PI / 2), m.tan);
  rim.position.y = 0.075;
  basket.add(shell, bottom, rim);
  shell.castShadow = true;
  const fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3 });
  const fg = fishGeometry();
  const fishA = new THREE.Mesh(fg, fishMat);
  fishA.position.set(0.0, 0.07, 0.03);
  fishA.rotation.set(0.2, 0.4, 1.25);
  fishA.scale.setScalar(0.85);
  const fishB = new THREE.Mesh(fg, fishMat);
  fishB.position.set(-0.03, 0.06, -0.04);
  fishB.rotation.set(-0.3, -0.5, 1.1);
  fishB.scale.setScalar(0.75);
  basket.add(fishA, fishB);
  basket.position.copy(local(v3(0.53, 0.78, 0)));
  steer.add(basket);
  const rack = cylBetween(local(v3(0.44, 0.66, 0)), local(v3(0.5, 0.71, 0)), 0.006, 0.006, m.chrome);
  steer.add(rack);

  // ---- 每帧更新 ----
  const state = { wheelAngle: 0, crankAngle: 0, chainTravel: 0 };
  function update({ wheelAngle, crankAngle, steerAngle, speed, night }) {
    state.wheelAngle = wheelAngle;
    state.crankAngle = crankAngle;
    rear.rot.rotation.z = -wheelAngle;
    front.rot.rotation.z = -wheelAngle;
    crank.rotation.z = -crankAngle;
    // 链条行程 = 大盘转过的弧长
    const travel = crankAngle * RING_R;
    cog.rotation.z = -travel / COG_R;
    for (let i = 0; i < nLinks; i++) {
      sampleChain(path, i * (path.length / nLinks) + travel, _cp);
      _pos.set(_cp.x, _cp.y, chainZ);
      _cq.setFromAxisAngle(_zAxis, _cp.z);
      _cm.compose(_pos, _cq, _one);
      chain.setMatrixAt(i, _cm);
    }
    chain.instanceMatrix.needsUpdate = true;
    // 脚踏保持水平
    pedalR.position.set(P.bb.x + Math.cos(-crankAngle) * CRANK, P.bb.y + Math.sin(-crankAngle) * CRANK, 0.125);
    pedalL.position.set(P.bb.x - Math.cos(-crankAngle) * CRANK, P.bb.y - Math.sin(-crankAngle) * CRANK, -0.125);
    steer.quaternion.setFromAxisAngle(axis, steerAngle);
    // 辐条运动模糊
    const blurO = Math.min(0.42, Math.max(0, (speed - 2.5) * 0.05));
    rear.blurMat.opacity = front.blurMat.opacity = blurO;
    // 灯光
    const n = night;
    headlight.intensity = n * 9;
    m.lens.emissiveIntensity = 0.3 + n * 7;
    m.tail.emissiveIntensity = 0.4 + n * 5 + (Math.sin(performance.now() * 0.008) > 0.3 ? n * 3 : 0);
    m.reflector.emissiveIntensity = 0.25 + n * 0.8;
  }

  return {
    group,
    update,
    anchors: { gripL: grips.L, gripR: grips.R, pedalL, pedalR, bell: dome, basket },
    headlight,
    materials: m,
    state,
    steerMatrix: () => steer.matrix,
  };
}

export { CRANK, RING_R };
