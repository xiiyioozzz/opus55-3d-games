import * as THREE from 'three';
import { softDotTexture, textTexture } from './textures.js';

export const CAR_SKINS = [
  { id: 'red', name: '烈焰战神', body: 0xe0262b, accent: 0xffc93a, glow: 0xff5a1f, rim: 0xd9d9d9 },
  { id: 'blue', name: '冰蓝幻影', body: 0x1f6ff2, accent: 0x6ff3ff, glow: 0x27c7ff, rim: 0xe6f2ff },
  { id: 'purple', name: '紫电魅影', body: 0x7b3df0, accent: 0xff6fd8, glow: 0xc26bff, rim: 0xf0e0ff },
  { id: 'yellow', name: '黄金闪电', body: 0xffc21a, accent: 0x1b1b1b, glow: 0xffe066, rim: 0x2b2b2b },
  { id: 'white', name: '白鲸号', body: 0xf3f5f8, accent: 0x2a7bff, glow: 0x5ab0ff, rim: 0x9aa7b8 },
  { id: 'pink', name: '粉红甜心', body: 0xff7eb6, accent: 0xffffff, glow: 0xff9ed0, rim: 0xffffff },
  { id: 'green', name: '翡翠之星', body: 0x19b86a, accent: 0xe8ff5a, glow: 0x6dff9e, rim: 0xe8ffe8 },
  { id: 'black', name: '暗夜猎手', body: 0x1b1d22, accent: 0xff2d55, glow: 0xff2d55, rim: 0x707782 },
];

function profileShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

// 侧面轮廓挤出：shape 的 x = 车身纵向（+ 为车头），挤出方向 = 车宽
function extrudeSide(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 4,
    curveSegments: 16,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

let sharedGeo = null;
function geos() {
  if (sharedGeo) return sharedGeo;
  // 车身：低趴跑车，带轮拱
  const body = new THREE.Shape();
  body.moveTo(-2.18, 0.34);
  body.lineTo(-1.92, 0.3);
  body.absarc(-1.38, 0.3, 0.54, Math.PI, 0, true);
  body.lineTo(0.84, 0.3);
  body.absarc(1.38, 0.3, 0.54, Math.PI, 0, true);
  body.lineTo(2.12, 0.3);
  body.quadraticCurveTo(2.34, 0.34, 2.3, 0.5);
  body.lineTo(2.12, 0.66);
  body.quadraticCurveTo(1.5, 0.78, 0.72, 0.86);
  body.lineTo(-0.2, 0.92);
  body.lineTo(-1.6, 0.96);
  body.quadraticCurveTo(-2.1, 0.98, -2.24, 0.86);
  body.lineTo(-2.26, 0.5);
  body.closePath();
  const bodyGeo = extrudeSide(body, 2.0, 0.14);

  const cabin = profileShape([
    [0.78, 0.84], [0.05, 1.3], [-0.95, 1.32], [-1.62, 0.96], [-1.2, 0.9], [0.4, 0.84],
  ]);
  const cabinGeo = extrudeSide(cabin, 1.46, 0.12);

  // 侧裙
  const skirt = profileShape([[-1.9, 0.3], [0.84, 0.3], [0.84, 0.42], [-1.9, 0.42]]);
  const skirtGeo = extrudeSide(skirt, 2.08, 0.03);

  const tire = new THREE.CylinderGeometry(0.47, 0.47, 0.4, 24);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.31, 0.31, 0.42, 16);
  rim.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.44, 0.07, 0.5);
  sharedGeo = { bodyGeo, cabinGeo, skirtGeo, tire, rim, spoke };
  return sharedGeo;
}

export function buildCar(skin, { name = null, isPlayer = false } = {}) {
  const G = geos();
  const car = new THREE.Group();
  const root = new THREE.Group(); // 车身（用于侧倾/俯仰/漂移甩尾）
  car.add(root);

  const paint = new THREE.MeshPhysicalMaterial({
    color: skin.body, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const accent = new THREE.MeshStandardMaterial({ color: skin.accent, metalness: 0.5, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1220, metalness: 0.9, roughness: 0.06, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7 });
  const tireM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const rimM = new THREE.MeshStandardMaterial({ color: skin.rim, metalness: 0.9, roughness: 0.25 });
  const headM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 3.5 });
  const tailM = new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 4 });
  const neonM = new THREE.MeshStandardMaterial({ color: skin.glow, emissive: skin.glow, emissiveIntensity: 3.5 });

  const body = new THREE.Mesh(G.bodyGeo, paint);
  body.castShadow = true;
  root.add(body);
  const cabin = new THREE.Mesh(G.cabinGeo, glass);
  cabin.castShadow = true;
  root.add(cabin);
  const skirt = new THREE.Mesh(G.skirtGeo, accent);
  root.add(skirt);

  // 车顶赛车条纹
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 1.5), accent);
  stripe.position.set(0, 0.84, 1.45);
  stripe.rotation.x = 0.1;
  root.add(stripe);

  // 尾翼
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 0.46), accent);
  wing.position.set(0, 1.36, -1.95);
  wing.rotation.x = -0.12;
  wing.castShadow = true;
  root.add(wing);
  for (const sx of [-0.62, 0.62]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.18), dark);
    post.position.set(sx, 1.12, -1.95);
    root.add(post);
  }
  for (const sx of [-1.06, 1.06]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.6), paint);
    plate.position.set(sx, 1.32, -1.97);
    root.add(plate);
  }

  // 车灯
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), headM);
    hl.position.set(sx, 0.64, 2.3);
    hl.rotation.x = -0.5;
    root.add(hl);
  }
  // 贯穿式尾灯 + 两侧灯组
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.08), tailM);
  tl.position.set(0, 0.78, -2.39);
  root.add(tl);
  for (const sx of [-0.72, 0.72]) {
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), tailM);
    t2.position.set(sx, 0.74, -2.39);
    root.add(t2);
  }
  // 后扩散器
  const diff = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.3), dark);
  diff.position.set(0, 0.36, -2.3);
  root.add(diff);
  // 前格栅
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.1), dark);
  grille.position.set(0, 0.42, 2.4);
  root.add(grille);
  // 侧面霓虹灯条
  for (const sx of [-1.05, 1.05]) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 2.2), neonM);
    n.position.set(sx, 0.46, -0.5);
    root.add(n);
  }
  // 排气管
  const exhausts = [];
  for (const sx of [-0.42, 0.42]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 12), rimM);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx, 0.4, -2.42);
    root.add(ex);
    exhausts.push(new THREE.Vector3(sx, 0.4, -2.56));
  }

  // 底盘光
  const glowMat = new THREE.MeshBasicMaterial({
    color: skin.glow, map: softDotTexture(), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const under = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.6), glowMat);
  under.rotation.x = -Math.PI / 2;
  under.position.y = 0.06;
  car.add(under);

  // 车轮
  const wheels = [];
  const wheelPos = [[-0.93, 1.38], [0.93, 1.38], [-0.93, -1.38], [0.93, -1.38]];
  for (const [x, z] of wheelPos) {
    const steer = new THREE.Group();
    steer.position.set(x, 0.47, z);
    const spin = new THREE.Group();
    steer.add(spin);
    const t = new THREE.Mesh(G.tire, tireM);
    t.castShadow = true;
    spin.add(t);
    const r = new THREE.Mesh(G.rim, rimM);
    spin.add(r);
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(G.spoke, rimM);
      sp.rotation.x = (k * Math.PI) / 3;
      sp.scale.set(1, 1, 1.1);
      spin.add(sp);
    }
    car.add(steer);
    wheels.push({ steer, spin, front: z > 0, x, z });
  }

  // 氮气尾焰（两个锥体，加色混合）
  const flameMatOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3aa0ff).multiplyScalar(2.2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flameMatInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flames = [];
  for (const e of exhausts) {
    const fg = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.6, 12, 1, true), flameMatOuter);
    outer.rotation.x = -Math.PI / 2;
    outer.position.z = -0.8;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 10, 1, true), flameMatInner);
    inner.rotation.x = -Math.PI / 2;
    inner.position.z = -0.45;
    fg.add(outer, inner);
    fg.position.copy(e);
    fg.visible = false;
    root.add(fg);
    flames.push(fg);
  }

  // 名字标签
  let tag = null;
  if (name) {
    const tex = textTexture(name, { w: 512, h: 96, fg: '#ffffff', font: 'bold 56px "PingFang SC","Microsoft YaHei",sans-serif', stroke: 'rgba(0,0,0,0.75)' });
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    tag.scale.set(4.2, 0.8, 1);
    tag.position.set(0, 2.5, 0);
    car.add(tag);
  }

  // 护盾（道具：天使）
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(2.9, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  shield.scale.set(1, 0.6, 1.25);
  shield.position.y = 0.8;
  shield.visible = false;
  car.add(shield);

  car.userData = { root, wheels, flames, exhausts, flameMatOuter, under, glowMat, tag, shield, skin, isPlayer, tailM };
  return car;
}
