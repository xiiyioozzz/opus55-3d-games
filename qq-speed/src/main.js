import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAYOUTS } from './layouts.js';
import { MAPS, MODES } from './maps.js';
import { Track } from './track.js';
import { buildSky, buildClouds, buildGround, buildWater, buildMountains, Batch, makeNoise } from './world.js';
import { buildProps, isFree } from './props.js';
import { buildCar, CAR_SKINS } from './carModel.js';
import { PlayerCar, TUNE, NO_INPUT } from './vehicle.js';
import { AICar, AI_NAMES } from './ai.js';
import { Particles, SkidMarks } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { ItemSystem } from './items.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, mulberry32, formatTime, smoothstep } from './util.js';
import { setMaxAniso } from './textures.js';

const $ = (id) => document.getElementById(id);
const STORE = 'feiche3d.v1';
const DIFFS = [
  { id: 0, name: '新手', skill: [0.55, 0.75], rubber: [0.88, 1.03] },
  { id: 1, name: '熟练', skill: [0.85, 1.05], rubber: [0.93, 1.06] },
  { id: 2, name: '车神', skill: [1.2, 1.38], rubber: [0.97, 1.1] },
];
const QUALITY = [
  { id: 'low', name: '流畅' },
  { id: 'mid', name: '均衡' },
  { id: 'high', name: '极致' },
];
const LAPS = [1, 2, 3, 5];
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const DT = 1 / 120;

// ---------- 地形基准函数 ----------
function baseFor(id, noise, track, oases) {
  const { cx, cz } = track.bounds;
  if (id === 'city')
    return (x, z) => {
      const r = Math.abs(z);
      const river = r < 44 ? -6 : r < 64 ? lerp(-6, 0, smoothstep(44, 64, r)) : 0;
      return river + Math.max(0, Math.hypot(x - cx, z - cz) - 950) * 0.12;
    };
  if (id === 'aegean')
    return (x, z) => {
      const land = Math.pow(clamp((z + 195) / 420, 0, 1), 0.8) * 16 + noise.fbm(x * 0.008, z * 0.008) * 5 + Math.max(0, Math.hypot(x - cx, z - cz) - 900) * 0.1;
      return lerp(land, -14, smoothstep(-200, -262, z));
    };
  if (id === 'egypt')
    return (x, z) => {
      let h = 2 + noise.fbm(x * 0.0045, z * 0.0045, 4) * 18 + Math.max(0, Math.hypot(x - cx, z - cz) - 900) * 0.1;
      for (const [ox, oz, r] of oases) {
        const d = Math.hypot(x - ox, z - oz);
        if (d < r + 25) h = lerp(-2.6, h, smoothstep(r - 6, r + 25, d));
      }
      return h;
    };
  return (x, z) => 3 + noise.fbm(x * 0.004, z * 0.004, 4) * 26 + Math.max(0, Math.hypot(x - cx, z - cz) - 650) * 0.18;
}

function tintFor(id, noise) {
  return (x, z, h, col) => {
    const n = noise(x * 0.02, z * 0.02);
    if (id === 'city') {
      if (h < -0.8) col.setRGB(1.25, 1.1, 0.8);
      else col.setRGB(0.88 + n * 0.2, 0.97 + n * 0.08, 0.86);
    } else if (id === 'aegean') {
      if (h < -0.5) col.setRGB(1.35, 1.25, 1.0);
      else { const r = clamp(0.5 + n * 1.2, 0, 1); col.setRGB(lerp(0.85, 1.2, r), lerp(1.0, 1.05, r), lerp(0.75, 1.0, r)); }
    } else if (id === 'egypt') {
      if (h < -1) col.setRGB(0.6, 0.85, 0.45);
      else col.setRGB(1 + n * 0.1, 0.97 + n * 0.08, 0.92);
    } else col.setRGB(0.92 + n * 0.06, 0.96 + n * 0.04, 1.0);
  };
}

const MOUNTAINS = {
  city: { color: 0x6f95b8, r0: 1600, r1: 500, h0: 140, h1: 200 },
  aegean: { color: 0x9c9a74, r0: 1500, r1: 500, h0: 140, h1: 220 },
  egypt: { color: 0xd9ae72, r0: 1500, r1: 600, h0: 50, h1: 90, count: 40 },
  snow: { color: 0x6f8fb8, cap: 0xf2f7ff, r0: 1400, r1: 500, h0: 240, h1: 300 },
};

class Game {
  constructor() {
    this.settings = Object.assign({ map: 'city', mode: 'speed', skin: 0, laps: 2, diff: 1, quality: IS_TOUCH ? 'mid' : 'high', song: 0 }, this.load());
    if (!LAPS.includes(this.settings.laps)) this.settings.laps = 3;
    this.canvas = $('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAniso(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.3, 9000);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;

    this.audio = new GameAudio();
    this.input = new Input();
    this.hud = new HUD();
    this.fx = this.makeFx();
    this.scene.add(this.fx.smoke.points, this.fx.glow.points, this.fx.skids.mesh);
    this.state = 'menu';
    this.time = 0;
    this.camMode = 0;
    this.shake = 0;
    this.camPos = new THREE.Vector3(0, 50, 0);
    this.camLook = new THREE.Vector3();
    this.camYaw = 0;
    this.fovK = 68;
    this.acc = 0;
    this.racers = [];
    this.input.onKey = (code) => this.onKey(code);
    if (IS_TOUCH) {
      document.body.classList.add('touch');
      this.input.bindTouch($('touch'));
    }
    this.setupQuality();
    this.buildMenu();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const unlock = () => {
      this.audio.init();
      if (!this.audio.playing) this.audio.startMusic();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Ctrl+W 在浏览器里是关闭标签页：比赛中拦一道确认，避免双喷时误触
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'race' || this.state === 'countdown' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.loadMap(this.settings.map).then(() => {
      this.startDemo();
      this.last = performance.now();
      requestAnimationFrame(() => this.loop());
    });
  }

  load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* 忽略 */ } }

  setupQuality() {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'mid' ? Math.min(dpr, 1.5) : 1);
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.sun) {
      this.sun.castShadow = q !== 'low';
      const ms = q === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== ms) {
        this.sun.shadow.mapSize.set(ms, ms);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer = null;
      this.bloom = null;
    }
    if (q === 'low') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    const ph = h * this.renderer.getPixelRatio();
    this.fx.smoke.setScale(ph);
    this.fx.glow.setScale(ph);
  }

  // ---------- 菜单 ----------
  buildMenu() {
    const S = this.settings;
    const mapsEl = $('maps');
    mapsEl.innerHTML = MAPS.map((m) => `<div class="map" data-id="${m.id}"><div class="nm">${m.name}</div><div class="en">${m.en}</div><div class="tg">${m.tag}</div></div>`).join('');
    const opts = (el, list, key, label, sub) => {
      el.innerHTML = list.map((it, i) => `<div class="opt" data-i="${i}">${label(it)}${sub ? `<small>${sub(it)}</small>` : ''}</div>`).join('');
    };
    opts($('modes'), MODES, 'mode', (m) => m.name, (m) => m.desc);
    opts($('laps'), LAPS, 'laps', (l) => `${l} 圈`);
    opts($('diff'), DIFFS, 'diff', (d) => d.name);
    opts($('quality'), QUALITY, 'quality', (q) => q.name);
    $('skins').innerHTML = CAR_SKINS.map((s, i) => `<div class="skin" data-i="${i}" title="${s.name}" style="background:linear-gradient(135deg,#${s.body.toString(16).padStart(6, '0')} 55%,#${s.accent.toString(16).padStart(6, '0')} 56%)"></div>`).join('');
    const refresh = () => {
      mapsEl.querySelectorAll('.map').forEach((e) => e.classList.toggle('sel', e.dataset.id === S.map));
      $('modes').querySelectorAll('.opt').forEach((e) => e.classList.toggle('sel', MODES[e.dataset.i].id === S.mode));
      $('laps').querySelectorAll('.opt').forEach((e) => e.classList.toggle('sel', LAPS[e.dataset.i] === S.laps));
      $('diff').querySelectorAll('.opt').forEach((e) => e.classList.toggle('sel', +e.dataset.i === S.diff));
      $('quality').querySelectorAll('.opt').forEach((e) => e.classList.toggle('sel', QUALITY[e.dataset.i].id === S.quality));
      $('skins').querySelectorAll('.skin').forEach((e) => e.classList.toggle('sel', +e.dataset.i === S.skin));
      $('skinname').textContent = CAR_SKINS[S.skin].name;
      this.save();
    };
    mapsEl.addEventListener('click', (e) => {
      const m = e.target.closest('.map');
      if (!m || m.dataset.id === S.map || this.loading) return;
      S.map = m.dataset.id;
      refresh();
      this.audio.play('click');
      this.loadMap(S.map).then(() => this.startDemo());
    });
    const bind = (id, fn) => $(id).addEventListener('click', (e) => {
      const o = e.target.closest('.opt,.skin');
      if (!o) return;
      fn(+o.dataset.i);
      refresh();
      this.audio.play('click');
    });
    bind('modes', (i) => (S.mode = MODES[i].id));
    bind('laps', (i) => (S.laps = LAPS[i]));
    bind('diff', (i) => (S.diff = i));
    bind('quality', (i) => { S.quality = QUALITY[i].id; this.setupQuality(); });
    bind('skins', (i) => { S.skin = i; if (this.state === 'menu') this.startDemo(); });
    $('start').addEventListener('click', () => this.startRace());
    $('resume').addEventListener('click', () => this.togglePause());
    $('restart').addEventListener('click', () => { $('pause').classList.add('hidden'); this.startRace(); });
    $('quit').addEventListener('click', () => this.toMenu());
    $('again').addEventListener('click', () => this.startRace());
    $('back').addEventListener('click', () => this.toMenu());
    refresh();
  }

  toMenu() {
    ['pause', 'result'].forEach((i) => $(i).classList.add('hidden'));
    $('menu').classList.remove('hidden');
    $('touch').classList.add('hidden');
    this.hud.show(false);
    this.hud.countdown('');
    this.startDemo();
  }

  onKey(code) {
    if (code === 'Escape' || code === 'KeyP') {
      if (this.state === 'race' || this.state === 'countdown' || this.state === 'paused') this.togglePause();
    } else if (code === 'KeyC') this.camMode = (this.camMode + 1) % 3;
    else if (code === 'KeyH') this.hud.toggleKeys();
    else if (code === 'KeyM') this.hud.song(this.audio.toggleMusic() ? '音乐：开' : '音乐：关');
    else if (code === 'PageUp' || code === 'PageDown') {
      this.settings.song = (this.settings.song ?? 0) + (code === 'PageUp' ? -1 : 1);
      this.hud.song(this.audio.setSong(this.settings.song));
    } else if (code === 'Enter' && this.state === 'menu' && !$('menu').classList.contains('hidden')) this.startRace();
  }

  togglePause() {
    if (this.state === 'paused') {
      this.state = this.pausedFrom;
      $('pause').classList.add('hidden');
      this.last = performance.now();
    } else {
      this.pausedFrom = this.state;
      this.state = 'paused';
      $('pause').classList.remove('hidden');
      this.audio.silence();
    }
  }

  // ---------- 关卡 ----------
  async loadMap(id) {
    this.loading = true;
    $('loading').classList.remove('hidden');
    $('loadtxt').textContent = `正在生成赛道：${MAPS.find((m) => m.id === id).name}…`;
    await new Promise((r) => setTimeout(r, 30));
    if (this.level) this.disposeLevel();
    const map = MAPS.find((m) => m.id === id);
    this.map = map;
    const root = new THREE.Group();
    const rnd = mulberry32(id.length * 997 + 13);
    const track = new Track(LAYOUTS[map.layout], { isBridge: map.isBridge });
    const noise = makeNoise(id.charCodeAt(0) * 31 + 7);
    let oases = [];
    if (id === 'egypt') oases = [[-110, -60, 22], [200, -330, 24], [-120, 320, 20], [140, 200, 18], [-300, 60, 24]].filter(([x, z, r]) => isFree(track, x, z, r + 14));
    const flatR = track.halfW + (map.track.shoulder ? map.track.shoulder.width + 2.5 : 3.5);
    const ground = buildGround(track, { base: baseFor(id, noise, track, oases), flatR, texture: map.ground, colorAt: tintFor(id, noise), repeat: id === 'snow' ? 30 : 22 });
    root.add(ground.mesh);
    root.add(track.build(map.track, ground.heightAt));

    // 天空、雾、光
    const { sky, sunDir } = buildSky(map.sky);
    this.skyMesh = sky;
    root.add(sky);
    root.add(buildClouds(rnd, { x: track.bounds.cx, z: track.bounds.cz }, 30));
    this.scene.fog = new THREE.Fog(map.fog[0], map.fog[1], map.fog[2]);
    this.scene.background = new THREE.Color(map.sky.horizon);
    const hemi = new THREE.HemisphereLight(map.hemi[0], map.hemi[1], map.hemi[2] * 0.62);
    root.add(hemi);
    const sun = new THREE.DirectionalLight(map.sky.sunColor, map.sky.sunI * 0.82);
    sun.castShadow = this.settings.quality !== 'low';
    const ms = this.settings.quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    root.add(sun, sun.target);
    this.sun = sun;
    this.sunDir = sunDir;
    if (map.water) {
      const water = buildWater(map.water, sunDir, map.sky.horizon, { x: track.bounds.cx, z: track.bounds.cz }, map.water.local ? 60 : 7000);
      if (map.water.local) {
        this.waters = oases.map(([x, z, r]) => {
          const w = water.clone();
          w.material = water.material;
          w.scale.setScalar((r + 12) / 30);
          w.position.set(x, map.water.y, z);
          root.add(w);
          return w;
        });
      } else {
        root.add(water);
        this.waters = [water];
      }
    } else this.waters = [];
    root.add(buildMountains(rnd, { x: track.bounds.cx, z: track.bounds.cz }, MOUNTAINS[id]));

    const ctx = { track, batch: new Batch(), rnd, groundAt: ground.heightAt, parent: root, updaters: [], quality: this.settings.quality, oases };
    this.gate = buildProps(id, ctx);
    ctx.batch.build(root);
    this.updaters = ctx.updaters;
    this.scene.add(root);
    this.level = root;
    this.track = track;
    this.groundAt = ground.heightAt;
    this.hud.setupMinimap(track);
    this.fx.skids.clear();
    this.audio.setSong(map.bgm);
    this.settings.song = map.bgm;
    try { this.renderer.compile(this.scene, this.camera); } catch { /* 忽略 */ }
    $('loading').classList.add('hidden');
    this.loading = false;
  }

  disposeLevel() {
    this.clearRacers();
    if (this.items) { this.items.dispose(); this.items = null; }
    this.level.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.level);
    this.level = null;
  }

  clearRacers() {
    for (const r of this.racers) {
      this.scene.remove(r.model);
      r.model.traverse((o) => {
        if (o.material && !o.isSprite) o.material.dispose();
      });
    }
    this.racers = [];
    this.player = null;
  }

  makeRacers(withPlayer) {
    this.clearRacers();
    const S = this.settings;
    const rnd = mulberry32((Date.now() & 0xffff) + 7);
    const diff = DIFFS[S.diff];
    const skins = CAR_SKINS.map((s, i) => i).filter((i) => i !== S.skin);
    for (let i = skins.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [skins[i], skins[j]] = [skins[j], skins[i]]; }
    const names = [...AI_NAMES];
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    const total = 6;
    const playerSlot = withPlayer ? 3 : -1;
    let ai = 0;
    for (let k = 0; k < total; k++) {
      const d = -14 - Math.floor(k / 2) * 11;
      const lat = (k % 2 ? 1 : -1) * 5.5;
      let r;
      if (k === playerSlot) {
        const model = buildCar(CAR_SKINS[S.skin], { isPlayer: true });
        r = new PlayerCar(this.track, model, '我');
        r.reset(d, lat);
      } else {
        const skin = CAR_SKINS[withPlayer ? skins[ai % skins.length] : (k + S.skin) % CAR_SKINS.length];
        const model = buildCar(skin, { name: names[ai % names.length] });
        const skill = lerp(diff.skill[0], diff.skill[1], withPlayer ? rnd() : 0.8 + rnd() * 0.2);
        r = new AICar(this.track, model, names[ai % names.length], skill, rnd);
        r.reset(d, lat);
        ai++;
      }
      r.slot = k;
      r.lapTimes = [];
      r.items = [];
      r.itemTimer = 2 + rnd() * 2;
      r.finished = false;
      r.finishTime = 0;
      r.stats = { drift: 0, small: 0, perfect: 0, double: 0, nitro: 0, crash: 0, top: 0, land: 0 };
      if (r.isPlayer) {
        r.lapsDone = -1;
        r.owed = true;
        r.half = false;
        r.lastD = r.d;
        this.player = r;
      }
      this.scene.add(r.model);
      this.racers.push(r);
    }
    for (const r of this.racers) this.updateProgress(r, true);
    this.standings = [...this.racers];
  }

  startDemo() {
    if (!this.track) return;
    this.state = 'menu';
    this.makeRacers(false);
    this.raceTime = 0;
    this.demoTarget = 0;
    this.demoT = 0;
    if (this.items) { this.items.dispose(); this.items = null; }
  }

  startRace() {
    if (this.loading) return;
    this.audio.init();
    ['menu', 'pause', 'result'].forEach((i) => $(i).classList.add('hidden'));
    this.itemMode = this.settings.mode === 'item';
    this.makeRacers(true);
    if (this.items) this.items.dispose();
    this.items = this.itemMode ? new ItemSystem(this.scene, this.track, this, mulberry32(Date.now() & 0xffff)) : null;
    this.hud.setItemMode(this.itemMode);
    this.hud.show(true);
    $('touch').classList.toggle('hidden', !IS_TOUCH);
    this.fx.skids.clear();
    this.state = 'countdown';
    this.cdT = 0;
    this.cdShown = -1;
    this.raceTime = 0;
    this.firstFinish = -1;
    this.startBoostReady = false;
    this.startTried = false;
    this.resultShown = false;
    this.camYaw = this.player.h;
    this.snapCamera();
    this.audio.setSong(this.settings.song ?? this.map.bgm);
    this.audio.startMusic();
    this.gate?.set(0);
    this.last = performance.now();
    $('keys').classList.remove('hidden');
    clearTimeout(this.keysT);
    this.keysT = setTimeout(() => $('keys').classList.add('hidden'), 18000);
  }

  // ---------- 主循环 ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const inp = this.input.frame();
    if (this.state !== 'paused') this.step(dt, inp);
    this.render(dt);
  }

  step(dt, inp) {
    const st = this.state;
    const racing = st === 'race';
    if (st === 'countdown') {
      this.cdT += dt;
      const n = Math.floor(this.cdT);
      if (n !== this.cdShown && n <= 3) {
        this.cdShown = n;
        this.hud.countdown(n < 3 ? String(3 - n) : 'GO!');
        this.gate?.set(n < 3 ? n + 1 : 4);
        this.audio.play(n < 3 ? 'count' : 'go');
      }
      if (inp.upPressed && !this.startTried) {
        this.startTried = true;
        if (this.cdT > 2.72) this.startBoostReady = true;
      }
      if (this.cdT >= 3) {
        this.state = 'race';
        this.raceTime = 0;
        for (const r of this.racers) if (r.isPlayer) r.lapStart = 0; else r.lapStart = 0;
        if (this.startBoostReady) this.applyStartBoost();
        setTimeout(() => this.hud.countdown(''), 700);
      }
    }
    if (st === 'finish') this.raceTime += dt;
    if (st === 'race') {
      this.raceTime += dt;
      if (inp.upPressed && !this.startTried && this.raceTime < 0.28) { this.startTried = true; this.applyStartBoost(); }
      if (inp.upPressed) this.startTried = true;
    }
    if (st === 'menu') this.raceTime += dt;

    const P = this.player;
    // 玩家输入：完赛后自动驾驶
    let pin = inp;
    if (P) {
      if (P.finished || this.resultShown) pin = this.autopilot(P);
      else if (IS_TOUCH && racing) { this.input.touch.up = true; }
      if (IS_TOUCH && !racing) this.input.touch.up = false;
      if (inp.resetPressed && racing && !P.finished) this.resetPlayer();
      if (this.itemMode && racing && !P.finished) {
        if (inp.nitroPressed) this.items.use(P);
        if (inp.swapPressed) this.items.swap(P);
      }
    }
    const active = st === 'race' || st === 'finish';
    const aiActive = st === 'race' || st === 'menu' || st === 'finish';
    // 固定步长
    this.acc += dt;
    let first = true;
    const noEdge = { ...pin, upPressed: false, wPressed: false, nitroPressed: false };
    while (this.acc >= DT) {
      this.acc -= DT;
      if (P) P.update(DT, first ? pin : noEdge, active, this.itemMode);
      first = false;
      for (const r of this.racers) if (!r.isPlayer) r.update(DT, aiActive, this.raceTime, this.rubber(r));
      this.collide();
    }
    for (const r of this.racers) {
      r.syncModel(dt);
      this.updateProgress(r);
    }
    this.standings = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    if (this.items && (racing || st === 'finish')) {
      this.items.update(dt, this.racers, this.standings);
      for (const r of this.racers) if (!r.isPlayer && !r.finished) this.items.aiThink(r, dt, this.standings);
    }
    if (P) this.handleEvents(P);
    this.emitEffects(dt);
    this.fx.smoke.update(dt);
    this.fx.glow.update(dt);
    this.fx.skids.update();
    for (const u of this.updaters) u(dt, this.time, this.camera.position);
    for (const w of this.waters) w.material.uniforms.uTime.value = this.time;
    if (this.track.boostPads) for (const bp of this.track.boostPads) bp.mat.map.offset.y = -this.time * 1.2;

    if (P && (racing || st === 'finish' || st === 'countdown')) this.updateRaceHUD(dt);
    if (st === 'race' || st === 'finish') this.checkRaceEnd(dt);

    // 声音
    if (P && st !== 'menu') {
      this.audio.setEngine(Math.min(1.2, Math.abs(P.s) / TUNE.vmaxNitro), st === 'countdown' ? (this.input.has('ArrowUp') ? 1 : 0) : P.throttle, P.boosting, P.drifting && !P.airborne, true);
    } else this.audio.silence();
  }

  rubber(r) {
    if (!this.player || this.state === 'menu') return 1;
    const diff = DIFFS[this.settings.diff];
    const gap = r.progress - this.player.progress;
    if (gap > 0) return Math.max(diff.rubber[0], 1 - gap * 0.00045);
    return Math.min(diff.rubber[1], 1 - gap * 0.0004);
  }

  applyStartBoost() {
    const P = this.player;
    P.startBoost = 1.4;
    P.s = Math.max(P.s, 16);
    this.hud.message('起步加速!', '#ffd23a');
    this.audio.play('small');
  }

  resetPlayer() {
    const P = this.player;
    const s = this.track.sample(P.d, {});
    const keepLap = { lapsDone: P.lapsDone, owed: P.owed, half: P.half, lastD: P.d, gauge: P.gauge, nitroCount: P.nitroCount };
    P.reset(P.d, clamp(P.lat, -4, 4));
    Object.assign(P, keepLap);
    P.h = P.m = s.hd;
    P.s = 12;
    this.hud.message('复位', '#ffffff', true);
  }

  autopilot(r) {
    const s = this.track.sample(r.d + 18, {});
    const want = Math.atan2(s.x - r.x, s.z - r.z);
    const e = wrapAngle(want - r.h);
    return { ...NO_INPUT, up: Math.abs(r.s) < 38, left: e > 0.04, right: e < -0.04 };
  }

  // ---------- 进度 / 圈数 ----------
  updateProgress(r, init = false) {
    const L = this.track.length;
    if (r.isPlayer) {
      const d = r.d;
      if (!init) {
        if (r.lastD > 0.75 * L && d < 0.25 * L) {
          if (r.owed) { r.lapsDone++; r.owed = false; }
          else if (r.half) { r.lapsDone++; r.half = false; this.onLap(r); }
        } else if (r.lastD < 0.25 * L && d > 0.75 * L) {
          r.lapsDone--;
          r.owed = true;
        }
        if (d > 0.4 * L && d < 0.6 * L) r.half = true;
      }
      r.lastD = d;
      r.progress = r.lapsDone * L + d;
    } else {
      const laps = Math.floor(r.dist / L);
      if (!init && r.lapsDone !== undefined && laps > r.lapsDone && laps >= 1) { r.lapsDone = laps; this.onLap(r); }
      r.lapsDone = laps;
      r.progress = r.dist;
    }
  }

  onLap(r) {
    if (this.state !== 'race' && this.state !== 'finish') return;
    const t = this.raceTime - (r.lapStart || 0);
    r.lapStart = this.raceTime;
    r.lapTimes.push(t);
    const laps = this.settings.laps;
    if (r.lapsDone >= laps && !r.finished) {
      r.finished = true;
      r.finishTime = this.raceTime;
      if (this.firstFinish < 0) this.firstFinish = this.raceTime;
      if (r.isPlayer) {
        this.hud.message('完成比赛!', '#ffd23a');
        this.audio.play('finish');
        this.state = 'finish';
        this.finishT = 0;
      }
      return;
    }
    if (r.isPlayer) {
      const best = Math.min(...r.lapTimes);
      this.audio.play('lap');
      this.hud.message(`第 ${r.lapsDone} 圈 ${formatTime(t)}${t <= best && r.lapTimes.length > 1 ? ' 最佳!' : ''}`, '#6dff9e', true);
      if (r.lapsDone === laps - 1) setTimeout(() => this.hud.message('最后一圈!', '#ff5fa8'), 900);
    }
  }

  checkRaceEnd(dt) {
    const P = this.player;
    if (this.resultShown) return;
    if (this.state === 'finish') {
      this.finishT += dt;
      const allDone = this.racers.every((r) => r.finished);
      if (this.finishT > 4 && (allDone || this.raceTime - this.firstFinish > 10 || this.finishT > 12)) this.showResults();
      return;
    }
    if (this.firstFinish >= 0 && !P.finished) {
      const left = 10 - (this.raceTime - this.firstFinish);
      this.hud.finalCount(`有车手已冲线！剩余 ${Math.max(0, Math.ceil(left))} 秒`);
      if (left <= 0) this.showResults();
    }
  }

  showResults() {
    this.resultShown = true;
    this.state = 'finish';
    this.hud.finalCount('');
    const L = this.track.length;
    const order = [...this.standings];
    const P = this.player;
    const place = order.indexOf(P) + 1;
    const title = !P.finished ? '未完成比赛' : place === 1 ? '冠军！' : `第 ${place} 名`;
    $('resTitle').textContent = title;
    $('resTitle').classList.toggle('win', P.finished && place === 1);
    const st = P.stats;
    $('resStats').innerHTML = [
      ['漂移', st.drift], ['小喷', st.small], ['完美小喷', st.perfect], ['双喷', st.double], ['氮气', st.nitro], ['最高时速', Math.round(st.top) + ''], ['碰撞', st.crash],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b>${k}</div>`).join('');
    $('resBody').innerHTML = order.map((r, i) => {
      const best = r.lapTimes.length ? Math.min(...r.lapTimes) : 0;
      const total = r.finished ? formatTime(r.finishTime) : `未完成 (${Math.floor(Math.max(0, Math.min(99, (r.progress / L) * 100 / this.settings.laps)))}%)`;
      return `<tr class="${r.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${r.name}</td><td>${total}</td><td>${formatTime(best)}</td></tr>`;
    }).join('');
    setTimeout(() => {
      $('result').classList.remove('hidden');
      $('touch').classList.add('hidden');
    }, 400);
  }

  racerAhead(r) {
    const i = this.standings.indexOf(r);
    return i > 0 ? this.standings[i - 1] : null;
  }

  // ---------- 碰撞 ----------
  collide() {
    const rs = this.racers;
    const R = 3.1;
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R || Math.abs(a.y - b.y) > 2.5) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        const over = R - d;
        this.pushRacer(a, -nx * over * 0.5, -nz * over * 0.5);
        this.pushRacer(b, nx * over * 0.5, nz * over * 0.5);
        // 速度交换（简化）
        const va = this.vel(a), vb = this.vel(b);
        const rel = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * nz;
        if (rel < 0) {
          const imp = -rel * 0.5;
          this.kick(a, -nx * imp, -nz * imp);
          this.kick(b, nx * imp, nz * imp);
          if ((a.isPlayer || b.isPlayer) && imp > 3) {
            this.audio.play('crash', imp);
            this.shake = Math.max(this.shake, 0.3);
            this.fx.sparks((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.6, (a.z + b.z) / 2, 10);
          }
        }
      }
  }

  vel(r) {
    if (r.isPlayer) return [Math.sin(r.m) * r.s, Math.cos(r.m) * r.s];
    const s = this.track.sample(r.dist, {});
    return [s.tx * r.s + s.rx * r.latV, s.tz * r.s + s.rz * r.latV];
  }

  pushRacer(r, px, pz) {
    if (r.isPlayer) { r.x += px; r.z += pz; return; }
    const s = this.track.sample(r.dist, {});
    r.lat += px * s.rx + pz * s.rz;
    r.pushD += px * s.tx + pz * s.tz;
  }

  kick(r, vx, vz) {
    if (r.isPlayer) {
      const cx = Math.sin(r.m) * r.s + vx, cz = Math.cos(r.m) * r.s + vz;
      const ns = Math.hypot(cx, cz);
      if (r.s >= 0 && ns > 0.5) { r.s = ns; r.m = Math.atan2(cx, cz); }
      return;
    }
    const s = this.track.sample(r.dist, {});
    r.s = Math.max(0, r.s + vx * s.tx + vz * s.tz);
    r.latV += vx * s.rx + vz * s.rz;
  }

  hitRacer(r, kind) {
    if (r.shield > 0) {
      r.shield = 0;
      this.sfx('shield', r);
      if (r.isPlayer) this.hud.message('天使护体!', '#ffe28a', true);
      return;
    }
    r.spin = kind === 'missile' ? 1.3 : 1.0;
    r.s *= 0.35;
    if (kind === 'missile') { r.airborne = true; r.vy = 8; }
    if (r.isPlayer) {
      r.endDrift(false);
      this.hud.message(kind === 'missile' ? '被导弹击中!' : '踩到香蕉皮!', '#ff4b4b');
      this.hud.flash();
      this.shake = 0.8;
    }
    this.sfx(kind === 'missile' ? 'boom' : 'banana', r);
  }

  sfx(name, r) {
    const P = this.player;
    if (!P) return;
    const d = Math.hypot(r.x - P.x, r.z - P.z);
    if (d < 120) this.audio.play(name);
  }

  onItemGet(it) {
    this.audio.play('item');
  }

  onMissileLock() {
    this.missileWarn = 1.6;
    this.audio.play('wrong');
  }

  // ---------- 玩家事件 → 提示/音效/特效 ----------
  handleEvents(P) {
    const st = P.stats;
    st.top = Math.max(st.top, P.speedKmh);
    for (const e of P.events) {
      switch (e.type) {
        case 'driftStart': st.drift++; break;
        case 'smallBoost':
          st.small++;
          if (e.data.perfect) st.perfect++;
          this.hud.message(e.data.perfect ? '完美小喷!' : '小喷!', '#ff9a1f');
          this.audio.play('small');
          this.fx.boostBurst(P, 0xffa040);
          break;
        case 'landBoost':
          st.small++;
          this.hud.message('落地喷!', '#ff9a1f');
          this.audio.play('small');
          this.fx.boostBurst(P, 0xffa040);
          break;
        case 'double':
          st.double++;
          setTimeout(() => this.hud.message('双喷!!', '#ff5fa8'), 120);
          this.audio.play('double');
          break;
        case 'nitro':
          st.nitro++;
          this.hud.message('氮气加速!', '#27c7ff');
          this.audio.play('nitro');
          this.fx.boostBurst(P, 0x39a8ff);
          this.shake = Math.max(this.shake, 0.25);
          break;
        case 'gaugeFull':
          this.hud.message('集气完成 +1 N₂O', '#7af0ff', true);
          this.audio.play('gauge');
          break;
        case 'crash':
          st.crash++;
          this.audio.play('crash', e.data.power);
          this.shake = Math.max(this.shake, Math.min(0.9, e.data.power * 0.05));
          this.fx.sparks(e.data.x, P.y + 0.6, e.data.z, 18);
          break;
        case 'scrape':
          if (Math.random() < 0.3) this.fx.sparks(e.data.x, P.y + 0.5, e.data.z, 2);
          if (Math.random() < 0.08) this.audio.play('scrape');
          break;
        case 'land':
          if (e.data.air > 0.25) {
            this.audio.play('land');
            this.shake = Math.max(this.shake, 0.3);
            this.fx.dust(P.x, P.y, P.z);
          }
          break;
        case 'pad':
          this.hud.message('加速带!', '#27c7ff', true);
          this.audio.play('pad');
          break;
      }
    }
    P.events.length = 0;
  }

  updateRaceHUD(dt) {
    const P = this.player;
    const laps = this.settings.laps;
    const standings = this.standings.map((r) => ({
      name: r.name,
      me: r.isPlayer,
      fin: r.finished,
      color: '#' + r.model.userData.skin.body.toString(16).padStart(6, '0'),
    }));
    const lapNow = clamp(P.lapsDone + 1, 1, laps);
    this.hud.update({
      lap: `${lapNow}/${laps}`,
      time: P.finished ? P.finishTime : this.state === 'countdown' ? 0 : this.raceTime,
      best: P.lapTimes.length ? Math.min(...P.lapTimes) : 0,
      kmh: P.speedKmh,
      rank: this.standings.indexOf(P) + 1,
      total: this.racers.length,
      gauge: P.gauge,
      nitro: P.nitroCount,
      standings,
      items: this.itemMode ? P.items : null,
      nitroOn: P.nitroTime > 0,
      smallOn: P.smallBoost > 0 || P.startBoost > 0 || P.padTime > 0,
    });
    this.hud.drawSpeedo(P.speedKmh, P.nitroTime > 0);
    this.hud.drawMinimap(this.racers, P);
    let warn = null;
    if (P.wrongWay > 1.2 && this.state === 'race') warn = '⚠ 方向错误！';
    if (this.missileWarn > 0) { this.missileWarn -= dt; warn = '⚠ 导弹锁定！'; }
    this.hud.warn(warn);
  }

  // ---------- 特效 ----------
  makeFx() {
    const smoke = new Particles(IS_TOUCH ? 900 : 1800, false);
    const glow = new Particles(IS_TOUCH ? 900 : 1800, true);
    const skids = new SkidMarks(2600);
    const R = Math.random;
    return {
      smoke, glow, skids,
      sparks(x, y, z, n) {
        for (let i = 0; i < n; i++) glow.emit(x, y, z, (R() - 0.5) * 16, R() * 7, (R() - 0.5) * 16, 0.4 + R() * 0.4, 0.5, 0.1, 1, 0.75 + R() * 0.25, 0.3, 1, 18, 1);
      },
      dust(x, y, z) {
        for (let i = 0; i < 24; i++) smoke.emit(x + (R() - 0.5) * 3, y + 0.3, z + (R() - 0.5) * 3, (R() - 0.5) * 8, R() * 2, (R() - 0.5) * 8, 1 + R(), 2, 6, 0.85, 0.8, 0.72, 0.5, -0.5, 1.5);
      },
      burst(x, y, z, color) {
        const c = new THREE.Color(color);
        for (let i = 0; i < 26; i++) glow.emit(x, y, z, (R() - 0.5) * 14, (R() - 0.2) * 10, (R() - 0.5) * 14, 0.5 + R() * 0.3, 1.2, 0.2, c.r, c.g, c.b, 1, 6, 2);
      },
      explode(x, y, z) {
        for (let i = 0; i < 40; i++) glow.emit(x, y, z, (R() - 0.5) * 22, R() * 14, (R() - 0.5) * 22, 0.5 + R() * 0.5, 3, 0.5, 1, 0.5 + R() * 0.4, 0.15, 1, 10, 2);
        for (let i = 0; i < 20; i++) smoke.emit(x, y, z, (R() - 0.5) * 8, R() * 6, (R() - 0.5) * 8, 1.2 + R(), 3, 9, 0.3, 0.3, 0.32, 0.6, -1, 1.5);
      },
      trail(x, y, z) {
        glow.emit(x, y, z, (R() - 0.5), (R() - 0.5), (R() - 0.5), 0.25, 1.2, 0.2, 1, 0.6, 0.2, 1);
        smoke.emit(x, y, z, (R() - 0.5), R(), (R() - 0.5), 0.8, 0.8, 3, 0.85, 0.85, 0.88, 0.4);
      },
      boostBurst(r, color) {
        const c = new THREE.Color(color);
        const bx = r.x - Math.sin(r.h) * 2.5, bz = r.z - Math.cos(r.h) * 2.5;
        for (let i = 0; i < 30; i++) glow.emit(bx, r.y + 0.6, bz, (R() - 0.5) * 10 - Math.sin(r.h) * 10, R() * 4, (R() - 0.5) * 10 - Math.cos(r.h) * 10, 0.35 + R() * 0.3, 1.6, 0.2, c.r, c.g, c.b, 1, 0, 3);
      },
    };
  }

  emitEffects(dt) {
    const fx = this.fx;
    const R = Math.random;
    const cam = this.camera.position;
    for (const r of this.racers) {
      const far = (r.x - cam.x) ** 2 + (r.z - cam.z) ** 2 > 250 * 250;
      const h = r.h;
      const fxv = Math.sin(h), fzv = Math.cos(h);
      const lx = Math.cos(h), lz = -Math.sin(h);
      const sp = Math.abs(r.s);
      const drifting = r.drifting && !r.airborne && sp > 10;
      for (let w = 0; w < 2; w++) {
        const sx = w ? 0.93 : -0.93;
        const wx = r.x + lx * sx - fxv * 1.38, wz = r.z + lz * sx - fzv * 1.38;
        const key = (r.isPlayer ? 'p' : r.slot) + '-' + w;
        if (drifting) {
          fx.skids.add(key, wx, r.y, wz, lx, lz, 0.2, r.isPlayer ? 1 : 0.7);
          if (!far) {
            const rate = (r.isPlayer ? 55 : 22) * dt;
            for (let k = 0; k < rate + (R() < rate % 1 ? 1 : 0); k++)
              fx.smoke.emit(wx + (R() - 0.5) * 0.6, r.y + 0.25, wz + (R() - 0.5) * 0.6, (R() - 0.5) * 2 - fxv * sp * 0.08, 0.8 + R() * 1.2, (R() - 0.5) * 2 - fzv * sp * 0.08, 0.8 + R() * 0.7, 1.3, 5 + R() * 2, 0.95, 0.95, 0.97, r.isPlayer ? 0.42 : 0.3, -0.6, 1.2);
            if (r.isPlayer && R() < 0.5) {
              const c = r.gauge >= 1 || r.nitroCount >= 2 ? [1, 0.85, 0.3] : [0.5, 0.85, 1];
              fx.glow.emit(wx, r.y + 0.2, wz, (R() - 0.5) * 3, R() * 3, (R() - 0.5) * 3, 0.25, 0.5, 0.1, c[0], c[1], c[2], 1, 8, 1);
            }
          }
        } else fx.skids.cut(key);
      }
      const nitro = r.nitroTime > 0;
      const small = r.isPlayer && (r.smallBoost > 0 || r.padTime > 0 || r.startBoost > 0);
      if ((nitro || small) && !far) {
        for (const sx of [-0.42, 0.42]) {
          const ex = r.x + lx * sx - fxv * 2.6, ez = r.z + lz * sx - fzv * 2.6;
          const n = nitro ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const c = nitro ? (R() < 0.5 ? [0.3, 0.7, 1] : [0.85, 0.95, 1]) : [1, 0.6, 0.2];
            fx.glow.emit(ex, r.y + 0.45, ez, -fxv * 6 + (R() - 0.5) * 2, R() * 1.5, -fzv * 6 + (R() - 0.5) * 2, 0.18 + R() * 0.1, nitro ? 1.3 : 0.9, 0.2, c[0], c[1], c[2], 1);
          }
        }
      }
      if (r.isPlayer && r.magnet > 0 && r.magnetTarget && !far) {
        const t = r.magnetTarget;
        for (let k = 0; k < 3; k++) {
          const f = R();
          fx.glow.emit(lerp(r.x, t.x, f), lerp(r.y, t.y, f) + 1, lerp(r.z, t.z, f), 0, 0, 0, 0.12, 0.8, 0.3, 0.8, 0.4, 1, 1);
        }
      }
    }
  }

  // ---------- 相机 ----------
  snapCamera() {
    const P = this.player;
    this.camYaw = P.h;
    this.camPos.set(P.x - Math.sin(P.h) * 9, P.y + 3.4, P.z - Math.cos(P.h) * 9);
    this.camLook.set(P.x, P.y + 1, P.z);
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (cam.userData.fixed) return;
    const st = this.state;
    let target = this.player;
    if (st === 'menu') {
      this.demoT += dt;
      if (this.demoT > 9) { this.demoT = 0; this.demoTarget = (this.demoTarget + 1) % this.racers.length; this.demoCut = true; }
      target = this.racers[this.demoTarget];
    }
    if (!target) return;
    const tx = target.x, ty = target.y, tz = target.z;
    if (st === 'menu' || (st === 'finish' && this.resultShown)) {
      const a = this.time * 0.25 + this.demoTarget;
      const want = new THREE.Vector3(tx + Math.sin(a) * 11, ty + 3.2 + Math.sin(this.time * 0.4) * 1.2, tz + Math.cos(a) * 11);
      if (this.demoCut) { this.camPos.copy(want); this.demoCut = false; }
      this.camPos.lerp(want, 1 - Math.exp(-3 * dt));
      this.camLook.set(tx, ty + 1, tz);
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      cam.fov = damp(cam.fov, 55, 3, dt);
      cam.updateProjectionMatrix();
      return;
    }
    const P = target;
    const modes = [
      { dist: 8.2, h: 3.0, look: 5, lookH: 1.3 },
      { dist: 12.5, h: 4.6, look: 6, lookH: 1.5 },
      { dist: 5.2, h: 1.9, look: 8, lookH: 1.1 },
    ];
    const m = modes[this.camMode];
    // 漂移时相机跟随速度方向，能看到车身侧滑
    const yawT = P.s >= 0 ? P.m + wrapAngle(P.h - P.m) * 0.35 : P.h;
    this.camYaw = dampAngle(this.camYaw, yawT, P.drifting ? 4.5 : 7, dt);
    const boostPull = P.nitroTime > 0 ? 1.6 : P.smallBoost > 0 ? 0.8 : 0;
    const dist = m.dist + Math.abs(P.s) * 0.018 + boostPull;
    const want = new THREE.Vector3(P.x - Math.sin(this.camYaw) * dist, P.y + m.h, P.z - Math.cos(this.camYaw) * dist);
    // 相机不钻地
    const gy = this.groundAt(want.x, want.z) + 1.0;
    if (want.y < gy) want.y = gy;
    if (P.airborne) want.y = Math.max(want.y, P.y + m.h);
    this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
    this.camPos.y = damp(this.camPos.y, want.y, 8, dt);
    const look = new THREE.Vector3(P.x + Math.sin(this.camYaw) * m.look, P.y + m.lookH, P.z + Math.cos(this.camYaw) * m.look);
    this.camLook.lerp(look, 1 - Math.exp(-18 * dt));
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      const k = this.shake * this.shake;
      cam.position.x += (Math.random() - 0.5) * k * 1.2;
      cam.position.y += (Math.random() - 0.5) * k * 1.0;
      cam.position.z += (Math.random() - 0.5) * k * 1.2;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
    if (P.nitroTime > 0) {
      cam.position.x += (Math.random() - 0.5) * 0.06;
      cam.position.y += (Math.random() - 0.5) * 0.06;
    }
    cam.lookAt(this.camLook);
    const fovT = 66 + Math.abs(P.s) * 0.12 + (P.nitroTime > 0 ? 9 : 0) + (P.smallBoost > 0 ? 4 : 0);
    cam.fov = damp(cam.fov, fovT, 4, dt);
    cam.updateProjectionMatrix();
  }

  render(dt) {
    if (!this.track) return;
    this.updateCamera(dt);
    const cp = this.camera.position;
    if (this.skyMesh) this.skyMesh.position.copy(cp);
    if (this.sun) {
      const f = this.player && this.state !== 'menu' ? this.player : this.racers[this.demoTarget] || { x: cp.x, y: cp.y, z: cp.z };
      // 阴影相机跟随，按纹素对齐减少抖动
      const snap = 150 / this.sun.shadow.mapSize.x;
      const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
      this.sun.target.position.set(fx, f.y, fz);
      this.sun.position.set(fx + this.sunDir.x * 220, f.y + this.sunDir.y * 220, fz + this.sunDir.z * 220);
    }
    const P = this.player;
    if (P && (this.state === 'race' || this.state === 'finish')) {
      const k = clamp((Math.abs(P.s) - 42) / 30, 0, 1) * 0.6 + (P.nitroTime > 0 ? 0.6 : 0) + (P.smallBoost > 0 ? 0.25 : 0);
      this.hud.speedLines(dt, k, P.nitroTime > 0 ? '#bfe9ff' : '#ffffff');
    } else if (this.hud.lines.length) this.hud.clearFx();
    if (this.bloom) this.bloom.strength = (this.settings.quality === 'high' ? 0.75 : 0.6) + (P && P.nitroTime > 0 ? 0.3 : 0);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new Game();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:sans-serif">无法初始化 WebGL：${e.message}</div>`;
    throw e;
  }
});
