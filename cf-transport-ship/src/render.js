// 渲染管线：世界 -> 第一人称武器层 -> 泛光 -> 屏幕特效 -> 输出
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FXShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLowHP: { value: 0 },
    uFlash: { value: 0 }, uVignette: { value: 0.28 }, uDeath: { value: 0 }, uScope: { value: 0 },
    uProtect: { value: 0 }, uUnderRoof: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLowHP, uFlash, uVignette, uDeath, uScope, uProtect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // 受伤时轻微色差
      float ca = uDamage * 0.004 + uDeath * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float r = length(c * vec2(1.0, 0.8));
      // 暗角
      col *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
      // 受击红边
      float edge = smoothstep(0.25, 0.8, r);
      col = mix(col, vec3(0.55, 0.02, 0.0), edge * clamp(uDamage, 0.0, 1.0) * 0.75);
      // 低血量去饱和 + 脉动
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      float pulse = 0.5 + 0.5 * sin(uTime * 7.0);
      col = mix(col, vec3(g) * vec3(1.08, 0.92, 0.9), uLowHP * 0.55);
      col = mix(col, vec3(0.5, 0.0, 0.0), uLowHP * edge * (0.25 + 0.2 * pulse));
      // 死亡：灰暗
      col = mix(col, vec3(g) * 0.6, uDeath * 0.8);
      // 出生保护：淡蓝边
      col = mix(col, vec3(0.35, 0.6, 1.0), uProtect * edge * 0.18);
      // 闪白
      col += uFlash;
      // 胶片颗粒
      col += (h(uv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, quality) {
    this.quality = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : quality === 'medium' ? 1.15 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.75;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 60000);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 50);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.vmPass);
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.35, 3.2);
      this.composer.addPass(this.bloom);
    }
    this.fx = new ShaderPass(FXShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }
  render() { this.composer.render(); }
}
