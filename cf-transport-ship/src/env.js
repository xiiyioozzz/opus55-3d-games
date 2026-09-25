// 天空 / 云 / 海洋 / 光照
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SEA_Y } from './map.js';

export const PRESETS = {
  day: {
    elev: 40, azim: 128, turbidity: 3.0, rayleigh: 1.8, mie: 0.0022, mieG: 0.76,
    sunColor: 0xfff0dc, sunInt: 3.6, hemiSky: 0xcfe2f4, hemiGround: 0x4a5560, hemiInt: 0.15, envInt: 0.5,
    exposure: 0.6, fog: 0xa9c2d6, fogDensity: 0.0011,
    deep: 0x03263f, shallow: 0x0f6a78, skyZen: 0x3f78b8, skyHor: 0xbcd3e4, cloudLit: 0xffffff, cloudShade: 0x8d9aa8, cloudCover: 0.47,
  },
  dusk: {
    elev: 6.5, azim: 160, turbidity: 9, rayleigh: 2.6, mie: 0.006, mieG: 0.86,
    sunColor: 0xffa55a, sunInt: 3.0, hemiSky: 0xf0b890, hemiGround: 0x2a2a38, hemiInt: 0.15, envInt: 0.5,
    exposure: 0.7, fog: 0xd49a78, fogDensity: 0.0013,
    deep: 0x0a1c2c, shallow: 0x2a4a58, skyZen: 0x3a4f78, skyHor: 0xf2a070, cloudLit: 0xffc08a, cloudShade: 0x5a4a58, cloudCover: 0.5,
  },
};

const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm4(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=.5;} return s; }
float fbm6(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=.5;} return s; }
`;

// ---------------- 海洋 ----------------
const WAVES = [
  // dirX, dirZ, steepness, wavelength
  [1.0, 0.25, 0.10, 58], [0.9, 0.55, 0.09, 33], [0.75, -0.45, 0.08, 19],
  [0.25, 1.0, 0.07, 11], [-0.5, 0.8, 0.05, 6.5], [0.95, -0.1, 0.05, 4.2],
];

function makeOcean(preset) {
  // 极坐标网格：中心密、远处疏
  const rings = 110, segs = 160, pos = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const rad = r === 0 ? 0 : 6 * Math.pow(1.058, r) - 5;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * segs + s, b = r * segs + (s + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const wv = WAVES.map(([x, z, st, wl]) => { const l = Math.hypot(x, z); return new THREE.Vector4(x / l, z / l, st, wl); });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uShip: { value: 0 }, uWaves: { value: wv },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(preset.deep) }, uShallow: { value: new THREE.Color(preset.shallow) },
      uZen: { value: new THREE.Color(preset.skyZen) }, uHor: { value: new THREE.Color(preset.skyHor) },
      uFog: { value: new THREE.Color(preset.fog) }, uFogDensity: { value: preset.fogDensity },
      uCam: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uShip; uniform vec4 uWaves[6];
      varying vec3 vW; varying vec3 vN; varying float vH;
      void main(){
        vec3 p = (modelMatrix * vec4(position,1.0)).xyz;
        vec2 xz = p.xz + vec2(uShip, 0.0);
        float dist = length(p.xz);
        float fade = smoothstep(1400.0, 250.0, dist);
        vec3 disp = vec3(0.0); vec3 T = vec3(1,0,0), B = vec3(0,0,1);
        for(int i=0;i<6;i++){
          vec4 w = uWaves[i];
          float k = 6.2831853 / w.w; float c = sqrt(9.8 / k); vec2 d = w.xy;
          float st = w.z * fade;
          float f = k * (dot(d, xz) - c * uTime);
          float a = st / k;
          float sf = sin(f), cf = cos(f);
          disp += vec3(d.x * a * cf, a * sf, d.y * a * cf);
          T += vec3(-d.x*d.x*st*sf, d.x*st*cf, -d.x*d.y*st*sf);
          B += vec3(-d.x*d.y*st*sf, d.y*st*cf, -d.y*d.y*st*sf);
        }
        // 船体附近压低波浪，避免穿过甲板
        float hullD = max(abs(p.z) - 12.5, 0.0) + max(-66.0 - p.x, 0.0) + max(p.x - 80.0, 0.0);
        float calm = smoothstep(0.0, 18.0, hullD) * 0.75 + 0.25;
        disp *= calm;
        p += disp;
        vH = disp.y;
        vN = normalize(cross(B, T));
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uShip, uFogDensity;
      uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uZen, uHor, uFog, uCam;
      varying vec3 vW; varying vec3 vN; varying float vH;
      ${NOISE_GLSL}
      vec2 ripple(vec2 p, float t){
        // 叠加若干短波的解析导数
        vec2 g = vec2(0.0);
        const int N = 8;
        for(int i=0;i<N;i++){
          float fi = float(i);
          float ang = fi * 2.399 + 0.3;
          vec2 d = vec2(cos(ang), sin(ang));
          float fr = 0.9 + fi * 0.55; float amp = 0.08 / (1.0 + fi * 0.6);
          float ph = dot(d, p) * fr + t * (1.2 + fi * 0.37);
          g += d * cos(ph) * fr * amp;
        }
        return g;
      }
      void main(){
        vec3 V = normalize(uCam - vW);
        float dist = length(uCam - vW);
        vec2 p = vW.xz + vec2(uShip, 0.0);
        vec2 g = ripple(p * 1.3, uTime) * smoothstep(400.0, 30.0, dist);
        vec3 N = normalize(vN + vec3(-g.x, 0.0, -g.y) * 0.9);
        float nv = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(uHor, uZen, pow(clamp(R.y, 0.0, 1.0), 0.45));
        // 反射中的云
        vec2 cuv = R.xz / max(R.y, 0.05) * 0.6 + vec2(uTime * 0.01, 0.0);
        float cl = smoothstep(0.5, 0.8, fbm4(cuv));
        sky = mix(sky, uHor * 1.15 + 0.1, cl * 0.5 * smoothstep(0.02, 0.2, R.y));
        float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 60.0 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.6;
        // 水体颜色 + 次表面散射
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * clamp(vH * 0.6 + 0.3, 0.0, 1.0);
        vec3 body = mix(uDeep, uShallow, clamp(vH * 0.35 + 0.25, 0.0, 1.0) * 0.6 + sss * 0.5);
        body *= (0.55 + 0.45 * max(uSunDir.y, 0.1));
        vec3 col = mix(body, sky, F) + uSunColor * spec;
        // 泡沫：船体边缘、船头破浪、尾迹
        float ax = abs(vW.z);
        float bowT = clamp((vW.x - 58.0) / 28.0, 0.0, 1.0);
        float hullW = vW.x > 58.0 ? 12.25 * cos(bowT * 1.5707) : 12.25;
        float dh = ax - hullW;
        float n1 = fbm4(p * 0.35 + vec2(0.0, uTime * 0.3));
        float n2 = fbm4(p * 1.4 - vec2(uTime * 0.5, 0.0));
        float hullFoam = smoothstep(2.2, 0.0, dh) * step(-66.0, vW.x) * step(vW.x, 88.0) * (0.35 + 0.65 * smoothstep(-40.0, 60.0, vW.x));
        float bowFoam = smoothstep(45.0, 75.0, vW.x) * smoothstep(7.0, 0.0, dh - (86.0 - vW.x) * 0.1);
        float behind = -66.0 - vW.x;
        float wakeW = 9.0 + behind * 0.18;
        float wake = step(0.0, behind) * smoothstep(wakeW, wakeW * 0.1, ax) * exp(-behind / 300.0);
        // 开尔文尾波 V 线
        float kel = -vW.x + 60.0; float kz = ax - 12.0 - kel * 0.354;
        float kelvin = step(0.0, kel) * exp(-abs(kz) * 0.9) * exp(-kel / 200.0) * 0.35;
        float foam = clamp(hullFoam * 0.8 + bowFoam + wake * 0.9 + kelvin, 0.0, 1.5);
        foam *= smoothstep(0.45, 0.85, n1 * 0.6 + n2 * 0.55 + foam * 0.2);
        float crest = smoothstep(0.9, 1.6, vH) * smoothstep(0.55, 0.8, n2) * 0.5;
        foam = clamp(foam + crest, 0.0, 1.0);
        vec3 foamCol = vec3(0.92, 0.95, 0.97) * (0.6 + 0.4 * max(uSunDir.y, 0.2)) * (uSunColor * 0.4 + 0.6);
        col = mix(col, foamCol, foam * 0.9);
        // 雾（与场景一致）
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFog, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.y = SEA_Y;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// ---------------- 云层 ----------------
function makeClouds(preset) {
  const g = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  g.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3() }, uLit: { value: new THREE.Color(preset.cloudLit) },
      uShade: { value: new THREE.Color(preset.cloudShade) }, uCover: { value: preset.cloudCover }, uFog: { value: new THREE.Color(preset.fog) },
      uShip: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uCover, uShip; uniform vec3 uSunDir, uLit, uShade, uFog;
      varying vec3 vW;
      ${NOISE_GLSL}
      void main(){
        vec2 p = (vW.xz + vec2(uShip * 0.2 + uTime * 6.0, uTime * 2.0)) / 2600.0;
        float n = fbm6(p);
        float d = smoothstep(uCover, uCover + 0.28, n);
        float n2 = fbm4(p * 1.8 + vec2(3.1, 1.7) + uSunDir.xz * 0.05);
        float lit = clamp(0.55 + (n - n2) * 1.6, 0.0, 1.0);
        vec3 col = mix(uShade, uLit, lit);
        float distXZ = length(vW.xz - cameraPosition.xz);
        float fade = smoothstep(26000.0, 6000.0, distXZ);
        col = mix(uFog, col, smoothstep(24000.0, 4000.0, distXZ));
        gl_FragColor = vec4(col, d * fade * 0.95);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.y = 1800;
  m.frustumCulled = false;
  m.renderOrder = -2;
  return m;
}

export class Environment {
  constructor(renderer, scene, quality) {
    this.renderer = renderer; this.scene = scene;
    this.preset = PRESETS.day;
    this.sky = new Sky(); this.sky.scale.setScalar(40000);
    this.sky.material.depthWrite = false;
    this.sky.renderOrder = -3;
    scene.add(this.sky);
    this.clouds = makeClouds(this.preset); scene.add(this.clouds);
    this.ocean = makeOcean(this.preset); scene.add(this.ocean);
    this.sunDir = new THREE.Vector3();
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sm = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target.position.set(-6, 0, 0);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(this.preset.fog, this.preset.fogDensity);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.shipDist = 0;
    this.shipSpeed = 6.5;
    this.apply('day');
  }
  apply(name) {
    const P = this.preset = PRESETS[name] || PRESETS.day;
    const phi = THREE.MathUtils.degToRad(90 - P.elev), theta = THREE.MathUtils.degToRad(P.azim);
    // 方位角从 +X 起逆时针到 +Z
    this.sunDir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).normalize();
    const u = this.sky.material.uniforms;
    u.turbidity.value = P.turbidity; u.rayleigh.value = P.rayleigh;
    u.mieCoefficient.value = P.mie; u.mieDirectionalG.value = P.mieG;
    u.sunPosition.value.copy(this.sunDir);
    this.sun.color.set(P.sunColor); this.sun.intensity = P.sunInt;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 120);
    // 阴影相机包住整艘可见船体
    const cam = this.sun.shadow.camera;
    const lightM = new THREE.Matrix4().lookAt(this.sun.position, this.sun.target.position, new THREE.Vector3(0, 1, 0));
    const inv = lightM.clone().invert();
    const box = new THREE.Box3();
    const pts = [];
    for (const x of [-58, 40]) for (const y of [-1, 26]) for (const z of [-15, 15]) pts.push(new THREE.Vector3(x, y, z));
    const lp = new THREE.Vector3();
    for (const p of pts) { lp.copy(p).sub(this.sun.position).applyMatrix4(inv); box.expandByPoint(lp); }
    cam.left = box.min.x; cam.right = box.max.x; cam.bottom = box.min.y; cam.top = box.max.y;
    cam.near = 1; cam.far = -box.min.z + 10;
    cam.updateProjectionMatrix();
    this.hemi.color.set(P.hemiSky); this.hemi.groundColor.set(P.hemiGround); this.hemi.intensity = P.hemiInt;
    this.scene.fog.color.set(P.fog); this.scene.fog.density = P.fogDensity;
    const ou = this.ocean.material.uniforms;
    ou.uSunDir.value.copy(this.sunDir); ou.uSunColor.value.set(P.sunColor).multiplyScalar(P.sunInt / 3);
    ou.uDeep.value.set(P.deep); ou.uShallow.value.set(P.shallow);
    ou.uZen.value.set(P.skyZen); ou.uHor.value.set(P.skyHor); ou.uFog.value.set(P.fog); ou.uFogDensity.value = P.fogDensity;
    const cu = this.clouds.material.uniforms;
    cu.uSunDir.value.copy(this.sunDir); cu.uLit.value.set(P.cloudLit); cu.uShade.value.set(P.cloudShade);
    cu.uCover.value = P.cloudCover; cu.uFog.value.set(P.fog);
    this.renderer.toneMappingExposure = P.exposure;
    this.buildEnvMap();
  }
  buildEnvMap() {
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(40000);
    const u2 = sky2.material.uniforms, u = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u2[k].value = u[k].value;
    u2.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    // 海面近似：深色大圆盘，使环境光下半球偏暗
    const disk = new THREE.Mesh(new THREE.CircleGeometry(30000, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.preset.deep).multiplyScalar(2.2) }));
    disk.rotation.x = -Math.PI / 2; disk.position.y = -50;
    envScene.add(disk);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 1, 60000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.preset.envInt;
    for (const s of this.extraScenes || []) s.environment = this.envRT.texture;
    sky2.material.dispose(); disk.geometry.dispose(); disk.material.dispose();
  }
  update(dt, t, camPos) {
    this.shipDist += dt * this.shipSpeed;
    const ou = this.ocean.material.uniforms;
    ou.uTime.value = t; ou.uShip.value = this.shipDist; ou.uCam.value.copy(camPos);
    this.ocean.position.x = 0; this.ocean.position.z = 0;
    const cu = this.clouds.material.uniforms;
    cu.uTime.value = t; cu.uShip.value = this.shipDist;
  }
}
