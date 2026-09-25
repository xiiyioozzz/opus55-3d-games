import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { createSky, SKY, samplePalette, sunDirection, moonDirection, nightFactor } from './sky.js';
import { createOcean, waveHeight, wavePhases, SEA_LEVEL } from './ocean.js';
import { createWorld, terrainHeight } from './world.js';
import { createBicycle, WHEEL_R, GEARS, BIKE_POINTS } from './bicycle.js';
import { createPelican } from './pelican.js';
import { fishGeometry } from './fish.js';
import { Particles, Confetti, SpeedLines, Scarf } from './effects.js';
import { AudioEngine } from './audio.js';
import { clamp, lerp, damp, smoothstep, TAU, mulberry32 } from './util.js';
import { makeSpriteTexture } from './textures.js';

const Q = new URLSearchParams(location.search);
const qp = (k, d) => (Q.has(k) ? Q.get(k) : d);
const isTouch = matchMedia('(pointer: coarse)').matches;
const $ = (s) => document.querySelector(s);

// ---------------- 画质 ----------------
const DPR = window.devicePixelRatio || 1;
const QUALITY = {
  low: { name: '流畅', pr: Math.min(DPR, 1) * 0.8, shadow: 1024, bloom: false, msaa: 0, density: 0.5 },
  medium: { name: '均衡', pr: Math.min(DPR, 1.25), shadow: 2048, bloom: true, msaa: 2, density: 0.8 },
  high: { name: '精美', pr: Math.min(DPR, 1.75), shadow: 2048, bloom: true, msaa: 4, density: 1 },
  ultra: { name: '极致', pr: Math.min(DPR, 2.25), shadow: 4096, bloom: true, msaa: 4, density: 1.25 },
};
let qualityKey = qp('q', isTouch ? 'medium' : 'high');
if (!QUALITY[qualityKey]) qualityKey = 'high';
let quality = QUALITY[qualityKey];

// ---------------- 渲染器 ----------------
const canvasHost = $('#app');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
} catch (e) {
  $('#fallback').hidden = false;
  throw e;
}
renderer.setPixelRatio(quality.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.0052);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 900);
scene.add(camera);
const orbitCam = camera.clone();

// ---------------- 天空 / 环境光 ----------------
const sky = createSky();
scene.add(sky.mesh);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.envMesh);
let envRT = null;
let envHour = -99;
function refreshEnv() {
  const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
}

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(quality.shadow, quality.shadow);
{
  const s = 7.5;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
}
scene.add(sun, sun.target);
const lampLights = [new THREE.PointLight('#ffc27a', 0, 14, 1.6), new THREE.PointLight('#ffc27a', 0, 14, 1.6)];
lampLights.forEach((l) => scene.add(l));
const lampPos = [new THREE.Vector3(), new THREE.Vector3()];
// 夜间跟随相机的柔和补光，保证主角可读
const fillLight = new THREE.PointLight('#b9c8ff', 0, 10, 1.2);
fillLight.position.set(0.6, 0.8, 0.5);
camera.add(fillLight);

// ---------------- 世界 ----------------
const ocean = createOcean();
scene.add(ocean.mesh);
const world = createWorld(scene, { density: quality.density });

// ---------------- 骑手 ----------------
const rider = new THREE.Group();
rider.rotation.order = 'YXZ';
const wheelieRoot = new THREE.Group();
wheelieRoot.position.set(BIKE_POINTS.rearHub.x, 0, 0);
rider.add(wheelieRoot);
const content = new THREE.Group();
content.position.set(-BIKE_POINTS.rearHub.x, 0, 0);
wheelieRoot.add(content);
const bike = createBicycle();
const pelican = createPelican();
content.add(bike.group, pelican.root);
scene.add(rider);

// ---------------- 特效 ----------------
const sprite = makeSpriteTexture();
const dust = new Particles(scene, 420, { additive: false, opacity: 0.35 });
const sparkles = new Particles(scene, 360, { additive: true });
const splash = new Particles(scene, 360, { additive: false });
const confetti = new Confetti(scene);
const speedLines = new SpeedLines(camera);
const scarf = new Scarf(scene);

// 可收集的鱼
const fishGeo = fishGeometry();
const fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.25, emissive: new THREE.Color('#1f6b8f'), emissiveIntensity: 0.45, side: THREE.DoubleSide });
const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf3f', metalness: 1, roughness: 0.18, emissive: new THREE.Color('#ff9500'), emissiveIntensity: 0.9, side: THREE.DoubleSide });
const fishes = [];
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(fishGeo, fishMat);
  m.scale.setScalar(1.35);
  m.castShadow = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: '#7fe3ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.9);
  m.add(halo);
  m.visible = false;
  scene.add(m);
  fishes.push({ mesh: m, halo, active: false, x: 0, y: 0, z: 0, golden: false, phase: 0, caught: -1 });
}
// 跃出海面的鱼
const jumpers = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(fishGeo, fishMat);
  m.scale.setScalar(1.8);
  m.visible = false;
  scene.add(m);
  jumpers.push({ mesh: m, t: -1, x: 0, z: 0, dur: 1.2, h: 1.5, dir: 1 });
}

// 调试：?nantest=1 在画面中放一个输出 NaN/Inf 的小方块，用于验证后期清理
if (qp('nantest', '0') === '1') {
  const bad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.06),
    new THREE.ShaderMaterial({
      uniforms: { uZero: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uZero; void main(){ float n = uZero / uZero; float i = 1.0 / uZero; gl_FragColor = vec4(n, i, n, 1.0); }',
    }),
  );
  bad.position.set(0.3, 1.3, 0.6);
  scene.add(bad);
}

// ---------------- 后期 ----------------
// 泛光前清理 NaN/Inf：一个坏像素会被 Bloom 的多级模糊扩散成大块黑色矩形。
// 用位运算判断（不依赖 isnan，避免被驱动的快速数学优化掉），并把 HDR 值限制在安全范围内
const sanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float fixf(float x) {
      uint b = floatBitsToUint(x);
      if ((b & 0x7f800000u) == 0x7f800000u) return ((b & 0x007fffffu) == 0u && (b & 0x80000000u) == 0u) ? 48.0 : 0.0;
      return clamp(x, 0.0, 48.0);
    }
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(fixf(c.r), fixf(c.g), fixf(c.b), 1.0); }`,
};
const colorGrade = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uAberration: { value: 0 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uWarm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette; uniform float uAberration; uniform float uGrain; uniform float uTime; uniform float uWarm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * uAberration * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, smoothstep(0.85, 0.2, r), uVignette);
      col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), uWarm);
      col *= 1.0 + (h(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain * 2.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
let composer;
let bloom;
let gradePass;
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
  if (composer) {
    composer.passes.forEach((p) => p.dispose?.());
    composer.dispose();
  }
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  if (qp('nosanitize', '0') !== '1') composer.addPass(new ShaderPass(sanitizeShader));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.55, 0.92);
  bloom.enabled = quality.bloom && settings.bloom;
  composer.addPass(bloom);
  gradePass = new ShaderPass(colorGrade);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());
}

// ---------------- 设置 / 状态 ----------------
const settings = {
  cruise: +qp('speed', 7.5),
  autopilot: true,
  autoGear: true,
  hour: +qp('time', 17.35),
  dayRate: +qp('dayrate', 0.025),
  timeFlow: qp('freeze', '0') !== '1',
  bloom: true,
  bloomBoost: 1,
  exposure: 1,
  waveAmp: 1,
  cloud: 0.42,
  fog: 1,
  helmet: true,
  glasses: qp('glasses', 'auto'),
  scarf: true,
  lookMouse: true,
  volume: 0.8,
  music: true,
  musicVolume: 0.55,
  quality: qualityKey,
  showFps: qp('fps', '0') === '1',
};
buildComposer();

const S = {
  speed: settings.cruise * 0.6,
  distance: 0,
  lane: 0.9,
  laneV: 0,
  laneTarget: 0.9,
  prevLaneV: 0,
  latAcc: 0,
  lean: 0,
  steer: 0,
  crank: 0,
  wheel: 0,
  gear: 2,
  y: 0,
  vy: 0,
  airborne: false,
  trick: 0,
  trickT: 0,
  wheelie: 0,
  accel: 0,
  pedaling: true,
  cadence: 0,
  fish: 0,
  golden: 0,
  jumps: 0,
  tricks: 0,
  bells: 0,
  honks: 0,
  lastSteer: -99,
  lastGearManual: -99,
  lastPointer: -99,
  nextFishAt: 30,
  started: false,
  paused: false,
  t: 0,
  time: 0,
};
const keys = {};
const achieved = new Set();

// ---------------- 音频 ----------------
const audio = new AudioEngine();

// ---------------- 相机 ----------------
const controls = new OrbitControls(orbitCam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.1;
controls.maxDistance = 28;
controls.maxPolarAngle = Math.PI * 0.495;
controls.enablePan = false;
controls.autoRotateSpeed = 0.55;
controls.addEventListener('start', () => {
  S.lastOrbitInput = S.time;
  controls.autoRotate = false;
});
const focus = new THREE.Vector3();
const prevFocus = new THREE.Vector3();
const CAMS = [
  { id: 'orbit', label: '自由环绕' },
  { id: 'chase', label: '追随' },
  { id: 'side', label: '侧面跟拍' },
  { id: 'cine', label: '电影运镜' },
  { id: 'pov', label: '鹈鹕视角' },
];
let camMode = qp('cam', 'cine');
if (!CAMS.find((c) => c.id === camMode)) camMode = 'orbit';
const blend = { t: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 42 };
const camTmp = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 };
const camOff = new THREE.Vector3();
let cinePov = false;
const _m4 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const cine = { shot: 0, t: 0 };
const SHOTS = [
  { d: 6.5, f: (u) => [[lerp(-2.6, 1.4, u), -0.5, 2.0], [0.25, -0.1, 0], 38] },
  { d: 6, f: (u) => [[7.5 - u * 1.2, -0.05, -1.1 + u * 0.5], [0.05, 0.35, 0], 17] },
  { d: 5, f: (u) => [[-0.2 + u * 0.3, -0.5, 0.95], [-0.3, -0.55, 0.05], 34] },
  { d: 7, f: (u) => [[-4.5 + u * 2.5, 1.4 + u * 5, 5 - u * 1.8], [0.3, -0.2, 0], 40] },
  { d: 6, f: (u) => [[2.2 - u * 3, 0.1, -3.4], [0, 0.25, 0], 30] },
  { d: 5, f: () => 'pov' },
  { d: 6.5, f: (u) => [[Math.cos(u * 1.6 + 0.4) * 3.2, 2.6, Math.sin(u * 1.6 + 0.4) * 3.2], [0.2, 0.1, 0], 36] },
  { d: 5.5, f: (u) => [[1.6, 1.6 - u * 0.4, 0.35], [-0.2, 0.35, 0], 55] },
];

function setCamMode(id, quick = false) {
  if (id === camMode && !quick) return;
  camMode = id;
  blend.t = quick ? 1 : 0;
  blend.pos.copy(camera.position);
  blend.quat.copy(camera.quaternion);
  blend.fov = camera.fov;
  if (id === 'orbit') {
    orbitCam.position.copy(camera.position);
    const d = orbitCam.position.distanceTo(focus);
    if (d > 14 || d < 1.2 || orbitCam.position.y < 0.3) orbitCam.position.copy(focus).add(new THREE.Vector3(2.3, 0.45, 3.7));
    controls.target.copy(focus);
    orbitCam.fov = 42;
    orbitCam.updateProjectionMatrix();
    controls.update();
    S.lastOrbitInput = S.time;
  }
  if (id === 'cine') {
    cine.t = 0;
  }
  document.body.classList.toggle('cinematic', id === 'cine');
  document.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === id));
  const label = CAMS.find((c) => c.id === id)?.label;
  const lbl = $('#camLabel');
  if (lbl) lbl.textContent = label;
}

function povPose(out) {
  const h = pelican.head;
  h.updateWorldMatrix(true, false);
  out.pos.set(0.07, 0.05, 0).applyMatrix4(h.matrixWorld);
  out.look.set(1.2, -0.12, 0).applyMatrix4(h.matrixWorld);
  out.fov = 68;
}

function cameraUpdate(dt) {
  // 焦点：骑手车身中部
  prevFocus.copy(focus);
  focus.set(rider.position.x + 0.05, rider.position.y + 0.92, rider.position.z);
  let fixedPose = true;
  if (camMode === 'orbit') {
    orbitCam.position.add(camTmp.pos.subVectors(focus, prevFocus));
    controls.target.add(camTmp.pos);
    controls.autoRotate = S.time - (S.lastOrbitInput ?? 0) > 7;
    controls.update(dt);
    orbitCam.position.y = Math.max(orbitCam.position.y, groundAt(orbitCam.position) + 0.2);
    camTmp.pos.copy(orbitCam.position);
    camTmp.fov = orbitCam.fov;
    fixedPose = false;
  } else if (camMode === 'chase') {
    camTmp.pos.copy(focus).add(camOff.set(-3.5, 0.7, 1.2 - S.lane * 0.15));
    camTmp.look.copy(focus).add(camOff.set(1.6, 0.05, 0));
    camTmp.fov = 46;
  } else if (camMode === 'side') {
    camTmp.pos.copy(focus).add(camOff.set(0.35 + Math.sin(S.time * 0.2) * 0.5, -0.1, 3.3));
    camTmp.look.copy(focus).add(camOff.set(0.1, -0.05, 0));
    camTmp.fov = 36;
  } else if (camMode === 'pov') {
    povPose(camTmp);
  } else if (camMode === 'cine') {
    cine.t += dt;
    const shot = SHOTS[cine.shot % SHOTS.length];
    if (cine.t > shot.d) {
      cine.t = 0;
      cine.shot = (cine.shot + 1) % SHOTS.length;
      flashCut();
    }
    const cur = SHOTS[cine.shot % SHOTS.length];
    const res = cur.f(cine.t / cur.d);
    cinePov = res === 'pov';
    if (cinePov) povPose(camTmp);
    else {
      const [p, l, f] = res;
      camTmp.pos.set(focus.x + p[0], focus.y + p[1], focus.z + p[2]);
      camTmp.look.set(focus.x + l[0], focus.y + l[1], focus.z + l[2]);
      camTmp.fov = f;
    }
  }
  // 平滑追随 & 防止钻地
  if (fixedPose) {
    if (camMode === 'chase' || camMode === 'side') {
      camera.userData.smooth = camera.userData.smooth || camTmp.pos.clone();
      camera.userData.smooth.x = damp(camera.userData.smooth.x, camTmp.pos.x, 6, dt);
      camera.userData.smooth.y = damp(camera.userData.smooth.y, camTmp.pos.y, 4, dt);
      camera.userData.smooth.z = damp(camera.userData.smooth.z, camTmp.pos.z, 3, dt);
      camTmp.pos.copy(camera.userData.smooth);
    } else camera.userData.smooth = null;
    if (camMode !== 'pov' && !(camMode === 'cine' && cinePov)) camTmp.pos.y = Math.max(camTmp.pos.y, groundAt(camTmp.pos) + 0.12);
    _m4.lookAt(camTmp.pos, camTmp.look, camera.up);
    _qa.setFromRotationMatrix(_m4);
  } else {
    _qa.copy(orbitCam.quaternion);
  }
  if (blend.t < 1) {
    blend.t = Math.min(1, blend.t + dt / 1.3);
    const e = smoothstep(0, 1, blend.t);
    camera.position.copy(blend.pos).lerp(camTmp.pos, e);
    camera.quaternion.copy(blend.quat).slerp(_qa, e);
    camera.fov = lerp(blend.fov, camTmp.fov, e);
  } else {
    camera.position.copy(camTmp.pos);
    camera.quaternion.copy(_qa);
    camera.fov = camTmp.fov;
  }
  camera.updateProjectionMatrix();
}

function groundAt(p) {
  const wx = p.x + S.distance;
  if (Math.abs(p.z) < 2.9) return 0.02;
  if (p.z < SHORE_GUARD) return Math.max(SEA_LEVEL + 0.4, terrainHeight(wx, p.z));
  return terrainHeight(wx, p.z);
}
const SHORE_GUARD = -13;

let flashTimer = 0;
function flashCut() {
  const el = $('#cut');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('go'), 400);
}

// ---------------- 光照与时间 ----------------
const pal = {};
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const env = { night: 0, waveAmp: 1 };
function updateLighting(dt) {
  if (settings.timeFlow && S.started && !S.paused) settings.hour = (settings.hour + dt * settings.dayRate) % 24;
  const hour = settings.hour;
  sunDirection(hour, sunDir);
  moonDirection(hour, moonDir);
  const elev = (Math.asin(clamp(sunDir.y, -1, 1)) * 180) / Math.PI;
  samplePalette(elev, pal);
  const night = nightFactor(elev);
  env.night = night;
  env.waveAmp = settings.waveAmp;
  SKY.uSunDir.value.copy(sunDir);
  SKY.uMoonDir.value.copy(moonDir);
  SKY.uZenith.value.copy(pal.zen);
  SKY.uHorizon.value.copy(pal.hor);
  SKY.uGround.value.copy(pal.gnd);
  SKY.uSunColor.value.copy(pal.sun);
  SKY.uSunGlow.value = 1 - night * 0.9;
  SKY.uNight.value = night;
  SKY.uTime.value = S.t;
  SKY.uCloudCover.value = settings.cloud;
  SKY.uCloudTint.value.copy(pal.ct);
  SKY.uCloudShade.value.copy(pal.cs);
  SKY.uCloudOffset.value.set(S.distance * 0.0009 + S.t * 0.004, S.t * 0.0015);

  // 太阳 / 月光二选一
  const useMoon = elev < -4;
  const lightDir = useMoon ? moonDir : sunDir;
  sun.position.copy(rider.position).addScaledVector(lightDir, 40);
  sun.target.position.copy(rider.position);
  if (useMoon) {
    sun.color.set('#9fb6ff');
    sun.intensity = 0.8 * smoothstep(-4, -12, elev) * clamp(moonDir.y * 3, 0, 1);
  } else {
    sun.color.copy(pal.sun);
    sun.intensity = pal.li;
  }
  hemi.color.copy(pal.hs);
  hemi.groundColor.copy(pal.hg);
  hemi.intensity = pal.hi;
  scene.fog.color.copy(pal.fog);
  scene.fog.density = 0.0052 * settings.fog;
  ocean.uniforms.uFogDensity.value = 0.0036 * settings.fog;
  ocean.uniforms.uDayLight.value = clamp(pal.li / 3 + pal.hi * 0.25, 0.08, 1);
  ocean.uniforms.uOffset.value = S.distance % 36000;
  wavePhases(S.distance, S.t, ocean.uniforms.uPhase.value);
  ocean.uniforms.uAmp.value = settings.waveAmp;
  renderer.toneMappingExposure = pal.exp * settings.exposure;
  scene.environmentIntensity = lerp(1.0, 0.22, night);
  if (bloom) {
    bloom.strength = pal.bloom * settings.bloomBoost * lerp(1, 0.7, night);
    bloom.threshold = lerp(1.05, 0.88, night);
  }
  fillLight.intensity = night * 2.2;
  gradePass.uniforms.uWarm.value = smoothstep(25, 3, elev) * (1 - night) * 0.8;
  // 环境贴图节流刷新
  if (Math.abs(hour - envHour) > 0.18 || envHour < 0) {
    envHour = hour;
    refreshEnv();
  }
  // 路灯点光源
  world.lampPositions(S.distance, lampPos);
  lampLights.forEach((l, i) => {
    l.position.copy(lampPos[i]);
    l.intensity = smoothstep(0.25, 0.75, night) * 18;
  });
  return { elev, night };
}

// ---------------- 骑行物理 ----------------
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const mouthW = new THREE.Vector3();
const gripL = new THREE.Vector3();
const gripR = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const pointer = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const rnd = mulberry32(2024);

function updateRide(dt) {
  const up = keys.up;
  const down = keys.down;
  let acc;
  if (S.airborne) acc = -0.15;
  else if (down) acc = -6;
  else if (up) acc = 2.4;
  else acc = (settings.cruise - S.speed) * 0.7;
  if (S.trickT > 0) acc = Math.min(acc, 0.2);
  S.accel = damp(S.accel, acc, 6, dt);
  S.speed = clamp(S.speed + acc * dt, 0, 15.5);
  S.pedaling = !S.airborne && !down && S.speed > 0.25 && acc > -0.4;
  S.distance += S.speed * dt;
  S.wheel += (S.speed / WHEEL_R) * dt;

  // 自动变速：让踏频保持在 ~85 rpm
  const wheelRpm = (S.speed / WHEEL_R) * 60 / TAU;
  if (settings.autoGear && S.time - S.lastGearManual > 8) {
    let best = S.gear;
    let bestErr = 1e9;
    GEARS.forEach(([r, c], i) => {
      const cad = wheelRpm / (r / c);
      const err = Math.abs(cad - 86);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    });
    const curCad = wheelRpm / (GEARS[S.gear][0] / GEARS[S.gear][1]);
    if (best !== S.gear && (curCad > 102 || curCad < 68)) {
      S.gear += Math.sign(best - S.gear);
      audio.enabled && audio.click(audio.ctx.currentTime, 0.18);
    }
  }
  const ratio = GEARS[S.gear][0] / GEARS[S.gear][1];
  const crankW = S.pedaling ? S.speed / WHEEL_R / ratio : 0;
  S.crank += crankW * dt;
  S.cadence = (crankW * 60) / TAU;

  // 变道 / 自动驾驶
  const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (steerIn) {
    S.lastSteer = S.time;
    S.laneTarget = clamp(S.laneTarget + steerIn * 2.4 * dt, -2.15, 2.15);
  } else if (settings.autopilot && S.time - S.lastSteer > 4) {
    const next = nextFish(40);
    const want = next ? next.z : 0.9 + Math.sin(S.time * 0.23) * 0.7;
    S.laneTarget = damp(S.laneTarget, want, next ? 2.2 : 0.8, dt);
  }
  const k = 10;
  S.laneV += ((S.laneTarget - S.lane) * k - S.laneV * 2 * Math.sqrt(k)) * dt;
  S.lane += S.laneV * dt;
  S.latAcc = damp(S.latAcc, (S.laneV - S.prevLaneV) / Math.max(dt, 1e-3), 8, dt);
  S.prevLaneV = S.laneV;
  const wobble = Math.sin(S.time * 1.7) * 0.02 * clamp(1.5 - S.speed * 0.2, 0.2, 1.5);
  S.lean = damp(S.lean, clamp(Math.atan(S.latAcc / 9.8) * 1.4, -0.4, 0.4) + wobble * 0.5, 7, dt);
  const steerT = S.trickT > 0 ? 0 : -clamp(S.latAcc * 0.05 + S.laneV * 0.12 / Math.max(1, S.speed * 0.3), -0.35, 0.35) + wobble;
  S.steer = damp(S.steer, steerT, 10, dt);

  // 跳跃
  if (S.airborne) {
    S.vy -= 13 * dt;
    S.y += S.vy * dt;
    if (S.y <= 0) {
      S.y = 0;
      S.airborne = false;
      audio.thump();
      burstDust(24);
    }
  }
  // 特技：放手 + 抬前轮
  if (S.trickT > 0) S.trickT -= dt;
  S.trick = damp(S.trick, S.trickT > 0 ? 1 : 0, 4, dt);
  const wheelieT = S.trick * 0.3 + (S.airborne ? S.vy * 0.025 : 0);
  S.wheelie = damp(S.wheelie, wheelieT, 6, dt);

  rider.position.set(0, S.y, S.lane);
  rider.rotation.set(S.lean, -Math.atan2(S.laneV, Math.max(S.speed, 1.5)), 0);
  wheelieRoot.rotation.z = S.wheelie;

  bike.update({ wheelAngle: S.wheel, crankAngle: S.crank, steerAngle: S.steer, speed: S.speed, night: env.night });
  rider.updateMatrixWorld(true);
}

function jump() {
  if (S.airborne || !S.started) return;
  S.airborne = true;
  S.vy = 3.6;
  S.jumps++;
  audio.whoosh();
  unlock('jump');
}
function trick() {
  if (S.trickT > 0 || !S.started) return;
  S.trickT = 3.4;
  S.tricks++;
  pelican.honk();
  audio.honk();
  setTimeout(() => confetti.burst(tmpV.set(0.2, 1.8, S.lane)), 600);
  unlock('trick');
  if (S.tricks >= 3) unlock('trick3');
}
function ringBell() {
  audio.bell();
  S.bells++;
  if (S.bells >= 10) unlock('bell10');
  const b = bike.anchors.bell;
  b.scale.setScalar(1.25);
  setTimeout(() => b.scale.setScalar(1), 120);
}
function honk() {
  pelican.honk();
  audio.honk();
  S.honks++;
  unlock('honk');
}

// ---------------- 收集鱼 ----------------
const LANES = [-1.8, -0.6, 0.6, 1.8];
function nextFish(range) {
  let best = null;
  for (const f of fishes) {
    if (!f.active || f.caught >= 0) continue;
    const rel = f.x - S.distance;
    if (rel > 0.2 && rel < range && (!best || rel < best.x - S.distance)) best = f;
  }
  return best;
}
function spawnFish(ahead = 85) {
  const f = fishes.find((x) => !x.active);
  if (!f) return;
  f.active = true;
  f.caught = -1;
  f.x = S.distance + ahead;
  f.z = LANES[Math.floor(rnd() * LANES.length)];
  f.y = 1.3 + rnd() * 0.25;
  f.golden = rnd() < 0.12;
  f.phase = rnd() * TAU;
  f.mesh.material = f.golden ? goldMat : fishMat;
  f.halo.material.color.set(f.golden ? '#ffd257' : '#7fe3ff');
  f.mesh.visible = true;
  f.mesh.scale.setScalar(1.35);
}
const gold = new THREE.Color('#ffd257');
const cyan = new THREE.Color('#9fefff');
const white = new THREE.Color('#ffffff');
function updateFishes(dt) {
  if (S.distance > S.nextFishAt) {
    spawnFish(S.nextFishAt === 30 ? 32 : 85);
    S.nextFishAt = S.distance + 16 + rnd() * 18;
  }
  pelican.mouth.getWorldPosition(mouthW);
  for (const f of fishes) {
    if (!f.active) continue;
    const rel = f.x - S.distance;
    if (f.caught >= 0) {
      f.caught += dt;
      const u = Math.min(1, f.caught / 0.16);
      f.mesh.position.lerp(mouthW, u);
      f.mesh.scale.setScalar(1.35 * (1 - u * 0.9));
      if (u >= 1) {
        f.active = false;
        f.mesh.visible = false;
      }
      continue;
    }
    f.mesh.position.set(rel, f.y + Math.sin(S.t * 3 + f.phase) * 0.08, f.z);
    f.mesh.rotation.set(Math.sin(S.t * 9 + f.phase) * 0.15, Math.PI + Math.sin(S.t * 1.5 + f.phase) * 0.6, 0);
    f.halo.material.opacity = 0.45 + Math.sin(S.t * 5 + f.phase) * 0.15;
    if (rel < -12) {
      f.active = false;
      f.mesh.visible = false;
      continue;
    }
    const dx = f.mesh.position.x - mouthW.x;
    const dz = f.mesh.position.z - mouthW.z;
    const dy = f.mesh.position.y - mouthW.y;
    if (Math.abs(dx) < 0.45 + S.speed * dt && Math.abs(dz) < 0.52 && Math.abs(dy) < 0.6) {
      f.caught = 0;
      S.fish += f.golden ? 5 : 1;
      if (f.golden) S.golden++;
      pelican.gulp();
      audio.gulp(f.golden);
      for (let i = 0; i < (f.golden ? 70 : 36); i++) {
        tmpV2.set(rnd() - 0.5, rnd() * 0.9 - 0.2, rnd() - 0.5).normalize().multiplyScalar(0.8 + rnd() * 1.6);
        sparkles.emit(mouthW, tmpV2, rnd() < 0.5 ? (f.golden ? gold : cyan) : white, 0.035 + rnd() * 0.03, 0.6 + rnd() * 0.6, { drag: 3 });
      }
      popScore(f.golden ? '+5 金鱼!' : '+1', f.golden);
      unlock('fish1');
      if (f.golden) unlock('golden');
      if (S.fish >= 10) unlock('fish10');
      if (S.fish >= 50) unlock('fish50');
    }
  }
}

// 跃出海面的鱼（点击海面或随机）
function launchJumper(x, z) {
  const j = jumpers.find((q) => q.t < 0);
  if (!j) return;
  j.t = 0;
  j.x = x + S.distance;
  j.z = z;
  j.dur = 1.0 + rnd() * 0.5;
  j.h = 1.2 + rnd() * 1.3;
  j.dir = rnd() < 0.5 ? 1 : -1;
  j.mesh.visible = true;
  splashAt(x, z, 26);
  audio.splash();
}
function splashAt(x, z, n) {
  const y = waveHeight(x + S.distance, z, S.t, settings.waveAmp);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const sp = 0.5 + rnd() * 1.5;
    tmpV.set(x, y + 0.05, z);
    tmpV2.set(Math.cos(a) * sp, 2 + rnd() * 2.5, Math.sin(a) * sp);
    splash.emit(tmpV, tmpV2, white, 0.06 + rnd() * 0.06, 0.8 + rnd() * 0.5, { drag: 0.6, grav: 9.8, ground: 1 });
  }
}
function updateJumpers(dt) {
  for (const j of jumpers) {
    if (j.t < 0) continue;
    j.t += dt;
    const u = j.t / j.dur;
    const x = j.x - S.distance + (u - 0.5) * 1.6 * j.dir;
    const base = waveHeight(j.x, j.z, S.t, settings.waveAmp);
    const y = base + Math.sin(u * Math.PI) * j.h - 0.2;
    j.mesh.position.set(x, y, j.z);
    j.mesh.rotation.set(0, j.dir > 0 ? 0 : Math.PI, (0.5 - u) * 2.4);
    if (u >= 1) {
      j.t = -1;
      j.mesh.visible = false;
      splashAt(x, j.z, 18);
      audio.splash();
    }
  }
}

function burstDust(n) {
  const c = new THREE.Color('#cdbb9a');
  for (let i = 0; i < n; i++) {
    tmpV.set(BIKE_POINTS.rearHub.x + (rnd() - 0.5) * 0.3, 0.03, S.lane + (rnd() - 0.5) * 0.25);
    tmpV2.set((rnd() - 0.5) * 1.5, rnd() * 0.9, (rnd() - 0.5) * 1.5);
    dust.emit(tmpV, tmpV2, c, 0.12 + rnd() * 0.12, 0.8 + rnd() * 0.6, { drag: 1.5, grav: -0.1, ground: 1 });
  }
}
const dustCol = new THREE.Color('#b9ab92');
let dustAcc = 0;
function emitDust(dt) {
  if (S.airborne || S.speed < 3.5) return;
  dustAcc += dt * S.speed * 1.4;
  while (dustAcc > 1) {
    dustAcc -= 1;
    tmpV.set(BIKE_POINTS.rearHub.x - 0.05 - rnd() * 0.1, 0.02, S.lane + (rnd() - 0.5) * 0.08);
    tmpV2.set(-0.3 - rnd() * 0.6, 0.15 + rnd() * 0.35, (rnd() - 0.5) * 0.4);
    dust.emit(tmpV, tmpV2, dustCol, 0.03 + rnd() * 0.04, 0.5 + rnd() * 0.4, { drag: 1.2, grav: -0.05, ground: 1 });
  }
}

// ---------------- 鹈鹕看向 ----------------
let glanceT = 0;
let glanceKind = 0;
function computeLook(dt) {
  const next = nextFish(28);
  if (next) {
    lookTarget.copy(next.mesh.position);
  } else if (settings.lookMouse && S.time - S.lastPointer < 2.5 && camMode !== 'pov') {
    raycaster.setFromCamera(pointer, camera);
    const d = camera.position.distanceTo(focus);
    lookTarget.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, d);
  } else {
    glanceT -= dt;
    if (glanceT <= 0) {
      glanceKind = (glanceKind + 1) % 4;
      glanceT = glanceKind === 0 ? 3.5 : 2.2;
    }
    if (glanceKind === 1 && camMode !== 'pov') lookTarget.copy(camera.position);
    else if (glanceKind === 3) lookTarget.set(rider.position.x + 2, 1.2, -8);
    else lookTarget.set(rider.position.x + 6, 1.15, rider.position.z);
  }
  return pelican.root.worldToLocal(lookTarget);
}

// ---------------- 成就 / 提示 ----------------
const ACH = {
  fish1: ['🐟', '第一条鱼', '张嘴就是干饭'],
  golden: ['🌟', '金色传说', '吞下了一条金鱼 (+5)'],
  fish10: ['🎣', '十鱼到手', '喉囊开始沉甸甸了'],
  fish50: ['🏆', '海岸渔王', '累计 50 条鱼'],
  jump: ['🦘', '起飞！', '第一次跳跃'],
  trick: ['🪽', '放手特技', '展翅 + 抬前轮'],
  trick3: ['🎪', '杂技鹈鹕', '完成 3 次特技'],
  speed30: ['💨', '时速 30', '风在耳边呼啸'],
  speed45: ['⚡', '疾风鹈鹕', '时速突破 45 km/h'],
  km1: ['🛣️', '骑行 1 公里', '海岸线才刚开始'],
  km5: ['🗺️', '骑行 5 公里', '真正的长途鹈鹕'],
  night: ['🌙', '夜骑', '星光与路灯作伴'],
  bell10: ['🔔', '铃铃铃', '按铃 10 次，路人已让开'],
  honk: ['📢', '嘎——！', '鹈鹕的呐喊'],
};
function unlock(id) {
  if (achieved.has(id) || !S.started) return;
  achieved.add(id);
  const [emo, title, sub] = ACH[id];
  toast(emo, title, sub);
  $('#achCount').textContent = `${achieved.size}/${Object.keys(ACH).length}`;
  if (['golden', 'fish10', 'speed45', 'km1', 'trick3', 'fish50', 'km5'].includes(id)) confetti.burst(tmpV.set(0.3, 1.9, S.lane));
}
function toast(emo, title, sub) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="emo">${emo}</span><div><b>${title}</b><small>${sub}</small></div>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 500);
  }, 3200);
}
function popScore(text, golden) {
  const el = $('#fishCount');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  const p = document.createElement('div');
  p.className = 'pop' + (golden ? ' gold' : '');
  p.textContent = text;
  // 定位到鹈鹕嘴部的屏幕坐标
  tmpV.copy(mouthW).project(camera);
  p.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
  p.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1100);
}

// ---------------- HUD ----------------
const hud = {
  speed: $('#speedVal'),
  arc: $('#speedArc'),
  cad: $('#cadVal'),
  gear: $('#gearVal'),
  dist: $('#distVal'),
  clock: $('#clockVal'),
  fish: $('#fishCount'),
  fps: $('#fps'),
  timeSlider: $('#timeSlider'),
  sunIcon: $('#sunIcon'),
};
const ARC_LEN = 2 * Math.PI * 52 * 0.75;
let hudAcc = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let fpsVal = 60;
let lastFrameT = performance.now();
function updateHud(dt, info) {
  const now = performance.now();
  const realDt = Math.min(0.25, (now - lastFrameT) / 1000);
  lastFrameT = now;
  if (!S.paused) {
    fpsAcc += realDt;
    fpsFrames++;
  }
  if (fpsAcc > 0.5) {
    fpsVal = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
    adaptQuality(fpsVal);
  }
  hudAcc += dt;
  if (hudAcc < 0.1) return;
  hudAcc = 0;
  const kmh = S.speed * 3.6;
  hud.speed.textContent = kmh.toFixed(0);
  hud.arc.style.strokeDashoffset = `${ARC_LEN * (1 - clamp(kmh / 55, 0, 1))}`;
  hud.cad.textContent = S.cadence.toFixed(0);
  hud.gear.textContent = `${S.gear + 1}/${GEARS.length}`;
  hud.dist.textContent = (S.distance / 1000).toFixed(2);
  const h = Math.floor(settings.hour);
  const m = Math.floor((settings.hour - h) * 60);
  hud.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  hud.fish.textContent = S.fish;
  if (document.activeElement !== hud.timeSlider) hud.timeSlider.value = settings.hour;
  hud.sunIcon.textContent = info.night > 0.5 ? '🌙' : info.elev < 8 ? '🌅' : '☀️';
  hud.fps.textContent = `${fpsVal.toFixed(0)} FPS · ${quality.name} · ${renderer.getPixelRatio().toFixed(2)}x`;
  hud.fps.hidden = !settings.showFps;
  if (kmh >= 30) unlock('speed30');
  if (kmh >= 45) unlock('speed45');
  if (S.distance >= 1000) unlock('km1');
  if (S.distance >= 5000) unlock('km5');
  if (info.night > 0.8 && S.started && S.time > 5) unlock('night');
}

// 自适应分辨率：按真实时间测帧率；以观测到的刷新上限为基准（兼容 30fps 锁帧），记住失败过的像素比上限
let lowStreak = 0;
let highStreak = 0;
let refreshCap = 0;
let prCeiling = Infinity;
function adaptQuality(fps) {
  if (!S.started || document.hidden || S.paused) return;
  refreshCap = Math.max(refreshCap * 0.995, fps);
  const pr = renderer.getPixelRatio();
  const lowT = Math.min(40, refreshCap * 0.72);
  if (fps < lowT) lowStreak++;
  else lowStreak = 0;
  if (fps > refreshCap * 0.93) highStreak++;
  else highStreak = 0;
  if (lowStreak >= 4 && pr > 0.6) {
    prCeiling = pr - 0.01;
    setPixelRatio(Math.max(0.6, pr - 0.2));
    lowStreak = 0;
    highStreak = 0;
  } else if (highStreak >= 16 && pr < Math.min(quality.pr, prCeiling) - 0.01) {
    setPixelRatio(Math.min(quality.pr, prCeiling, pr + 0.1));
    highStreak = 0;
  }
}
function setPixelRatio(pr) {
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
}
function applyQuality(key) {
  prCeiling = Infinity;
  qualityKey = key;
  quality = QUALITY[key];
  renderer.setPixelRatio(quality.pr);
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  buildComposer();
}

// ---------------- 输入 ----------------
const KEYMAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLAnchorElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = KEYMAP[e.code];
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      jump();
      break;
    case 'KeyB':
      ringBell();
      break;
    case 'KeyT':
      trick();
      break;
    case 'KeyH':
      honk();
      break;
    case 'KeyC': {
      const i = CAMS.findIndex((c) => c.id === camMode);
      setCamMode(CAMS[(i + 1) % CAMS.length].id);
      break;
    }
    case 'KeyN':
      settings.hour = (settings.hour + 3) % 24;
      break;
    case 'KeyQ':
      S.gear = Math.max(0, S.gear - 1);
      S.lastGearManual = S.time;
      break;
    case 'KeyE':
      S.gear = Math.min(GEARS.length - 1, S.gear + 1);
      S.lastGearManual = S.time;
      break;
    case 'KeyM':
      toggleMusic();
      break;
    case 'KeyK':
      wantShot = true;
      break;
    case 'KeyF':
      toggleFullscreen();
      break;
    case 'KeyU':
      document.body.classList.toggle('hide-ui');
      break;
    case 'KeyP':
      S.paused = !S.paused;
      audio.mute(S.paused);
      toast(S.paused ? '⏸' : '▶️', S.paused ? '已暂停' : '继续骑行', '按 P 切换');
      break;
    default:
      break;
  }
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  // macOS 按住 Cmd 时不会发送其它键的 keyup
  if (e.key === 'Meta') for (const key of Object.keys(keys)) keys[key] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
});

const down = { x: 0, y: 0, t: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  down.x = e.clientX;
  down.y = e.clientY;
  down.t = performance.now();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  S.lastPointer = S.time;
  // 在其它镜头下拖拽，自动切到自由环绕
  if (e.buttons && camMode !== 'orbit' && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) setCamMode('orbit');
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 450) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitBell = raycaster.intersectObject(bike.anchors.bell, true);
  if (hitBell.length) return ringBell();
  const hitBird = raycaster.intersectObjects(pelican.hitMeshes, false);
  if (hitBird.length) return honk();
  const hitBike = raycaster.intersectObject(bike.group, true);
  if (hitBike.length) return ringBell();
  const hitSea = raycaster.intersectObject(ocean.mesh, false);
  if (hitSea.length) {
    const p = hitSea[0].point;
    if (p.z < -12) launchJumper(p.x, p.z);
  }
});

// 触屏按钮
document.querySelectorAll('[data-key]').forEach((b) => {
  const k = b.dataset.key;
  const on = (e) => {
    e.preventDefault();
    keys[k] = true;
    b.classList.add('on');
  };
  const off = () => {
    keys[k] = false;
    b.classList.remove('on');
  };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});
const ACTIONS = {
  jump,
  trick,
  bell: ringBell,
  honk,
  shot: () => (wantShot = true),
  music: () => toggleMusic(),
  full: () => toggleFullscreen(),
  gui: () => toggleGui(),
  help: () => $('#help').classList.toggle('show'),
  share: () => shareView(),
  night: () => (settings.hour = (settings.hour + 3) % 24),
  flow: () => {
    settings.timeFlow = !settings.timeFlow;
    $('[data-act="flow"]').classList.toggle('on', settings.timeFlow);
  },
};
document.querySelectorAll('[data-act]').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    ACTIONS[b.dataset.act]?.();
  });
});
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamMode(b.dataset.cam)));
hud.timeSlider.addEventListener('input', () => {
  settings.hour = +hud.timeSlider.value;
});
hud.timeSlider.addEventListener('change', () => hud.timeSlider.blur());

function ensureAudio() {
  if (!audio.ctx) {
    audio.start();
    audio.setVolume(settings.volume);
    audio.setMusic(settings.music);
    audio.setMusicVolume(settings.musicVolume);
  }
}
addEventListener('pointerdown', () => {
  const st = audio.ctx?.state;
  if (st && st !== 'running' && st !== 'closed' && !document.hidden && !S.paused) audio.ctx.resume();
});
function toggleMusic() {
  settings.music = !settings.music;
  // 静音进入后再打开音乐：此时有用户手势，可以启动音频
  if (settings.music && !audio.ctx) {
    audio.start();
    audio.setVolume(settings.volume);
  }
  audio.setMusic(settings.music);
  audio.setMusicVolume(settings.musicVolume);
  $('[data-act="music"]').classList.toggle('off', !settings.music);
}
document.addEventListener('visibilitychange', () => audio.mute(document.hidden || S.paused));
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
function shareView() {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('time', settings.hour.toFixed(2));
  u.searchParams.set('cam', camMode);
  navigator.clipboard?.writeText(u.toString()).then(
    () => toast('🔗', '已复制分享链接', '打开即回到当前时刻与镜头'),
    () => toast('🔗', '分享链接', u.toString()),
  );
}

// ---------------- 截图 ----------------
let wantShot = false;
function takeShot() {
  renderer.domElement.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `pelican-ride-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('📸', '截图已保存', '分享你的鹈鹕骑行瞬间');
  });
}

// ---------------- GUI ----------------
const gui = new GUI({ title: '⚙️ 参数面板', container: $('#guiHost') });
gui.hide();
const f1 = gui.addFolder('骑行');
f1.add(settings, 'cruise', 0, 14, 0.5).name('巡航速度 m/s');
f1.add(settings, 'autopilot').name('自动驾驶（追鱼）');
f1.add(settings, 'autoGear').name('自动变速');
const f2 = gui.addFolder('时间与天气');
f2.add(settings, 'hour', 0, 24, 0.01).name('时刻').listen();
f2.add(settings, 'timeFlow').name('时间流动').listen();
f2.add(settings, 'dayRate', 0, 0.5, 0.005).name('流速 (时/秒)');
f2.add(settings, 'cloud', 0, 0.9, 0.01).name('云量');
f2.add(settings, 'waveAmp', 0, 2.2, 0.05).name('浪高');
f2.add(settings, 'fog', 0.6, 3, 0.05).name('雾浓度');
const f3 = gui.addFolder('画面');
f3.add(settings, 'quality', { 流畅: 'low', 均衡: 'medium', 精美: 'high', 极致: 'ultra' }).name('画质').onChange(applyQuality);
f3.add(settings, 'bloom').name('泛光').onChange((v) => (bloom.enabled = v && quality.bloom));
f3.add(settings, 'bloomBoost', 0, 3, 0.05).name('泛光强度');
f3.add(settings, 'exposure', 0.4, 2, 0.01).name('曝光');
f3.add(settings, 'showFps').name('显示帧率');
const f4 = gui.addFolder('鹈鹕');
f4.add(settings, 'helmet').name('头盔');
f4.add(settings, 'glasses', { 自动: 'auto', 戴上: 'on', 摘下: 'off' }).name('墨镜');
f4.add(settings, 'scarf').name('围巾').onChange((v) => (scarf.mesh.visible = v));
f4.add(settings, 'lookMouse').name('目光跟随鼠标');
const f5 = gui.addFolder('声音');
f5.add(settings, 'volume', 0, 1, 0.01).name('主音量').onChange((v) => {
  ensureAudio();
  audio.setVolume(v);
});
f5.add(settings, 'music').name('生成式音乐').listen().onChange((v) => {
  ensureAudio();
  audio.setMusic(v);
  $('[data-act="music"]').classList.toggle('off', !v);
});
f5.add(settings, 'musicVolume', 0, 1, 0.01).name('音乐音量').onChange((v) => {
  ensureAudio();
  audio.setMusicVolume(v);
});
for (const f of [f2, f3, f4, f5]) f.close();
function toggleGui() {
  if (gui._hidden) {
    gui.show();
    gui.open();
  } else gui.hide();
  $('[data-act="gui"]').classList.toggle('on', !gui._hidden);
}

// ---------------- 开场 ----------------
function start(withSound) {
  if (S.started) return;
  S.started = true;
  document.body.classList.add('started');
  if (withSound) {
    audio.start();
    audio.setVolume(settings.volume);
    audio.setMusicVolume(settings.musicVolume);
  }
  setCamMode(Q.has('cam') ? camMode : 'orbit');
  setTimeout(() => toast('🐦', '出发！', isTouch ? '点屏幕按钮加速、变道、跳跃' : 'W/S 加减速 · A/D 变道 · 空格跳 · T 特技'), 900);
}
$('#startBtn').addEventListener('click', () => start(true));
$('#startMute').addEventListener('click', () => {
  settings.music = false;
  $('[data-act="music"]').classList.add('off');
  start(false);
});
if (qp('autostart', '0') === '1') start(false);
setCamMode(camMode, true);

// ---------------- 主循环 ----------------
const timer = new THREE.Timer();
timer.connect(document);
const windV = new THREE.Vector3();
const scarfA = new THREE.Vector3();
const scarfB = new THREE.Vector3();
const bodyW = new THREE.Vector3();
const collider = { center: bodyW, radius: 0.25 };
let info = { elev: 10, night: 0 };
const fixedDt = qp('dt', '');
const bufSize = new THREE.Vector2();

function frame(ts) {
  timer.update(ts);
  let dt = Math.min(timer.getDelta(), 1 / 20);
  if (fixedDt) dt = +fixedDt;
  if (S.paused) dt = 0;
  S.t += dt;
  S.time += dt;

  updateRide(dt);
  info = updateLighting(dt);
  world.update(S.distance, dt, S.t, env);

  // 骑手 IK 与动画
  bike.group.updateMatrixWorld(true);
  const steerM = bike.steerMatrix();
  gripL.copy(bike.anchors.gripL.position).applyMatrix4(steerM);
  gripR.copy(bike.anchors.gripR.position).applyMatrix4(steerM);
  const glasses = settings.glasses === 'auto' ? info.night < 0.3 : settings.glasses === 'on';
  pelican.update(dt, {
    t: S.t,
    crankAngle: S.crank,
    pedal: S.pedaling ? 1 : 0.3,
    airborne: S.airborne ? 1 : 0,
    trick: S.trick,
    accel: S.accel,
    look: computeLook(dt),
    grips: { L: gripL, R: gripR },
    pedals: { L: bike.anchors.pedalL.position, R: bike.anchors.pedalR.position },
    helmet: settings.helmet,
    glasses,
  });
  pelican.root.updateMatrixWorld(true);

  // 围巾：根部取脖子结的后侧
  if (settings.scarf) {
    const kp = pelican.knot.position;
    scarfA.set(kp.x - 0.07, kp.y + 0.025, 0.01);
    scarfB.set(kp.x - 0.07, kp.y - 0.04, -0.01);
    pelican.root.localToWorld(scarfA);
    pelican.root.localToWorld(scarfB);
    pelican.body.getWorldPosition(bodyW);
    windV.set(-S.speed + Math.sin(S.t * 0.7) * 0.8, S.airborne ? -S.vy * 0.6 : 0.3, -S.laneV * 0.8 + Math.sin(S.t * 0.4) * 0.6);
    if (dt > 0) scarf.update(dt, scarfA, scarfB, windV, S.t, collider);
  }
  pelican.knot.visible = settings.scarf;

  updateFishes(dt);
  updateJumpers(dt);
  emitDust(dt);
  if (S.started && rnd() < dt * 0.12) launchJumper(8 + rnd() * 30, -20 - rnd() * 25);
  const scroll = S.speed * dt;
  dust.update(dt, scroll);
  sparkles.update(dt, 0);
  splash.update(dt, scroll);
  confetti.update(dt, scroll);
  speedLines.update(dt, S.speed, camMode === 'pov' || camMode === 'chase' ? 1 : 0.6);

  cameraUpdate(dt);
  sky.mesh.position.copy(camera.position);
  renderer.getDrawingBufferSize(bufSize);
  const scale = bufSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
  dust.uniforms.uScale.value = scale;
  sparkles.uniforms.uScale.value = scale;
  splash.uniforms.uScale.value = scale;
  world.ffMat.uniforms.uScale.value = scale;

  gradePass.uniforms.uTime.value = S.t;
  gradePass.uniforms.uAberration.value = clamp((S.speed - 9) / 6, 0, 1) * 0.012 + (S.airborne ? 0.004 : 0);

  audio.update({ speed: S.speed, pedaling: S.pedaling, night: info.night, cadence: S.cadence, airborne: S.airborne });
  updateHud(dt, info);

  composer.render();
  if (wantShot) {
    wantShot = false;
    takeShot();
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  orbitCam.aspect = camera.aspect;
  camera.updateProjectionMatrix();
  orbitCam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
});

// 首帧前预热一次，避免开场卡顿
world.update(0, 0, 0, env);
refreshEnv();
requestAnimationFrame(frame);
$('#loading')?.remove();
document.body.classList.add('ready');

// 调试接口（自动化测试截图使用）
window.__pelican = {
  pelican,
  bike,
  view(dx, dy, dz, fov = 35, lx = 0, ly = 0, lz = 0) {
    setCamMode('orbit', true);
    controls.autoRotate = false;
    S.lastOrbitInput = 1e9;
    orbitCam.position.set(focus.x + dx, focus.y + dy, focus.z + dz);
    controls.target.set(focus.x + lx, focus.y + ly, focus.z + lz);
    orbitCam.fov = fov;
    orbitCam.updateProjectionMatrix();
    controls.update();
  },
  S,
  settings,
  setCamMode,
  jump,
  trick,
  honk,
  ringBell,
  spawnFish,
  launchJumper,
  cine,
  renderer,
  get fps() {
    return fpsVal;
  },
};
