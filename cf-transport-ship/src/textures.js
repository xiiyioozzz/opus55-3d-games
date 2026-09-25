// 程序化纹理：全部由 Canvas 生成，零外部资源
import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 可平铺的 fBm 值噪声，返回 0..1
export function fbm(w, h, fx, fy, octaves, seed, persistence = 0.5) {
  const out = new Float32Array(w * h);
  const rnd = mulberry32(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gx = fx << o, gy = fy << o;
    const lat = new Float32Array(gx * gy);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const sxs = gx / w, sys = gy / h;
    for (let y = 0; y < h; y++) {
      const fyy = y * sys, y0 = fyy | 0, ty = fyy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % gy) * gx, r1 = ((y0 + 1) % gy) * gx;
      for (let x = 0; x < w; x++) {
        const fxx = x * sxs, x0 = fxx | 0, tx = fxx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % gx, c1 = (x0 + 1) % gx;
        const a = lat[r0 + c0], b = lat[r0 + c1], c = lat[r1 + c0], d = lat[r1 + c1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[y * w + x] += amp * (top + (bot - top) * sy);
      }
    }
    total += amp; amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// 高度图 -> 法线贴图（OpenGL 约定，适配 flipY 的 CanvasTexture）
export function normalFromHeight(hgt, w, h, strength) {
  const c = mkCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yr = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hgt[yr + xp] - hgt[yr + xm]) * strength;
      const dy = (hgt[yp + x] - hgt[ym + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (yr + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(vals, w, h, map) {
  const c = mkCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, map(vals[i], i) * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// 在像素层叠加噪声颜色
function paintNoise(ctx, w, h, noise, fn) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const r = fn(noise[i], d[i * 4], d[i * 4 + 1], d[i * 4 + 2], i);
    d[i * 4] = r[0]; d[i * 4 + 1] = r[1]; d[i * 4 + 2] = r[2];
  }
  ctx.putImageData(img, 0, 0);
}

function rustStreaks(ctx, w, h, rnd, count, fromY, len, alpha, color = '110,55,25') {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, wd = 2 + rnd() * 10, L = len * (0.3 + rnd());
    const y0 = fromY + (rnd() - 0.5) * 8;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + L);
    const a = alpha * (0.3 + rnd() * 0.7);
    g.addColorStop(0, `rgba(${color},${a})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, wd, L);
  }
}

function blobs(ctx, rnd, w, h, count, rMin, rMax, color, aMin, aMax) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h, r = rMin + rnd() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = aMin + rnd() * (aMax - aMin);
    g.addColorStop(0, `rgba(${color},${a})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// 做旧文字：用噪声擦除部分像素
function weatheredText(ctx, text, x, y, font, color, rnd, erode = 0.25, align = 'center') {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const c = mkCanvas(w, h), cx = c.getContext('2d', { willReadFrequently: true });
  cx.font = font; cx.fillStyle = color; cx.textAlign = align; cx.textBaseline = 'middle';
  cx.fillText(text, x, y);
  cx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900 * erode; i++) {
    cx.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.7})`;
    const s = 1 + rnd() * 5;
    cx.fillRect(rnd() * w, rnd() * h, s * (1 + rnd() * 3), s);
  }
  ctx.drawImage(c, 0, 0);
}

// ============== 甲板 ==============
function deckTextures() {
  const S = 1024; // 4m x 4m
  const rnd = mulberry32(11);
  const n1 = fbm(S, S, 4, 4, 5, 101);
  const n2 = fbm(S, S, 16, 16, 3, 102);
  const n3 = fbm(S, S, 8, 8, 4, 103);
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(66,72,72)'; ctx.fillRect(0, 0, S, S);
  paintNoise(ctx, S, S, n1, (v, r, g, b, i) => {
    const k = 0.82 + v * 0.36 + (n2[i] - 0.5) * 0.08;
    return [r * k, g * k, b * k];
  });
  // 磨损的浅色人行轨迹（沿 X 方向）
  for (let i = 0; i < 260; i++) {
    const y = rnd() * S, x = rnd() * S, L = 40 + rnd() * 260;
    ctx.fillStyle = `rgba(160,165,160,${0.03 + rnd() * 0.06})`;
    ctx.fillRect(x, y, L, 1 + rnd() * 2);
  }
  // 锈斑与油污
  const rustMask = fbm(S, S, 6, 6, 5, 104);
  paintNoise(ctx, S, S, rustMask, (v, r, g, b, i) => {
    const t = Math.max(0, (v - 0.66) * 4) * (0.5 + n2[i] * 0.6);
    const tt = Math.min(0.7, t);
    return [r + (92 - r) * tt, g + (58 - g) * tt, b + (40 - b) * tt];
  });
  blobs(ctx, rnd, S, S, 18, 20, 80, '20,20,18', 0.08, 0.25);
  // 钢板焊缝（每 2m）
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hgt[i] = n3[i] * 0.25 + n2[i] * 0.08;
  const seam = (x0, y0, x1, y1) => {
    ctx.strokeStyle = 'rgba(30,32,33,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(140,140,135,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + 2); ctx.lineTo(x1 + 2, y1 + 2); ctx.stroke();
  };
  for (const p of [0, 512]) { seam(p + 1, 0, p + 1, S); seam(0, p + 1, S, p + 1); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.min(Math.abs(x % 512 - 1), 512 - Math.abs(x % 512 - 1));
    const dy = Math.min(Math.abs(y % 512 - 1), 512 - Math.abs(y % 512 - 1));
    const dd = Math.min(dx, dy);
    if (dd < 4) hgt[y * S + x] += dd < 2 ? 0.9 : 0.5; // 焊缝凸起
  }
  // 防滑点（稀疏）
  for (let i = 0; i < 4000; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
    hgt[y * S + x] += 0.6;
  }
  // 螺栓
  for (let px = 0; px < 2; px++) for (let py = 0; py < 2; py++) {
    for (let k = 0; k < 4; k++) {
      const bx = px * 512 + 24 + (k % 2) * 464, by = py * 512 + 24 + ((k / 2) | 0) * 464;
      ctx.fillStyle = 'rgba(40,40,40,0.8)'; ctx.beginPath(); ctx.arc(bx, by, 5, 0, 7); ctx.fill();
      for (let yy = -6; yy <= 6; yy++) for (let xx = -6; xx <= 6; xx++) {
        const r = Math.hypot(xx, yy);
        if (r < 6) hgt[(by + yy) * S + bx + xx] += (6 - r) * 0.25;
      }
    }
  }
  const nrm = normalFromHeight(hgt, S, S, 2.2);
  const rough = grayCanvas(n1, S, S, (v, i) => 0.62 + v * 0.3 - Math.max(0, rustMask[i] - 0.62) * -0.5);
  return { map: tex(c), normalMap: tex(nrm, { srgb: false }), roughnessMap: tex(rough, { srgb: false }) };
}

// ============== 集装箱 ==============
export const CONTAINER_COLORS = [
  { name: 'blue', rgb: [38, 72, 118], text: 'GLOBAL RISK', tc: '#e8e8e2' },
  { name: 'red', rgb: [132, 40, 32], text: 'LENSVELD', tc: '#efeae0' },
  { name: 'green', rgb: [52, 92, 60], text: 'TRANSLINE', tc: '#e8e8e0' },
  { name: 'rust', rgb: [128, 70, 42], text: 'ORIENT CARGO', tc: '#f0e6d8' },
  { name: 'gray', rgb: [112, 118, 120], text: 'NORDSEE', tc: '#1d2a44' },
  { name: 'teal', rgb: [36, 102, 104], text: 'OCEAN STAR', tc: '#f2f2ea' },
  { name: 'orange', rgb: [184, 96, 36], text: 'KESTREL LINE', tc: '#fdf6ea' },
  { name: 'cream', rgb: [176, 164, 132], text: 'BLACK LIST', tc: '#2a2a2a' },
];

function corrugationHeight(W, H, ribs, railFrac, postFrac) {
  const hgt = new Float32Array(W * H);
  const n = fbm(W, H, 8, 4, 3, 77);
  const railT = H * railFrac, postW = W * postFrac;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v;
      if (y < railT || y > H - railT) v = 0.55; // 上下横梁
      else if (x < postW || x > W - postW) v = 0.8; // 角柱
      else {
        const t = ((x - postW) / (W - 2 * postW)) * ribs;
        const f = t - Math.floor(t);
        // 梯形瓦楞
        v = f < 0.15 ? f / 0.15 : f < 0.45 ? 1 : f < 0.6 ? 1 - (f - 0.45) / 0.15 : 0;
        v = v * 0.6 + 0.1;
        // 瓦楞在横梁处的过渡
        const e = Math.min(y - railT, H - railT - y);
        if (e < 6) v = v * (e / 6) + 0.55 * (1 - e / 6);
      }
      hgt[y * W + x] = v + (n[y * W + x] - 0.5) * 0.06;
    }
  }
  return hgt;
}

function containerSide(color, W, H, ribs, seed, hgt) {
  const rnd = mulberry32(seed);
  const c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  const [r, g, b] = color.rgb;
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, W, H);
  const n = fbm(W, H, 6, 3, 5, seed + 5);
  paintNoise(ctx, W, H, n, (v, rr, gg, bb, i) => {
    const hv = hgt[i];
    const k = (0.8 + v * 0.35) * (0.78 + hv * 0.3);
    return [rr * k, gg * k, bb * k];
  });
  // 大字 logo
  const fs = Math.round(H * 0.26);
  weatheredText(ctx, color.text, W / 2, H * 0.5, `900 ${fs}px "Arial Black", Impact, sans-serif`, color.tc, rnd, 0.35);
  // 箱号
  const code = ['GRSU', 'LNVU', 'TRLU', 'OCSU', 'KSTU', 'BLKU', 'NDSU'][seed % 7] + ' ' + (100000 + ((rnd() * 899999) | 0)) + ' ' + ((rnd() * 9) | 0);
  weatheredText(ctx, code, W - W * 0.05, H * 0.16, `bold ${Math.round(H * 0.06)}px Arial, sans-serif`, color.tc, rnd, 0.2, 'right');
  weatheredText(ctx, rnd() > 0.5 ? '22G1' : '45G1', W - W * 0.05, H * 0.25, `bold ${Math.round(H * 0.05)}px Arial, sans-serif`, color.tc, rnd, 0.2, 'right');
  // 锈迹从上梁流下 + 底部锈蚀
  rustStreaks(ctx, W, H, rnd, 60, H * 0.07, H * 0.5, 0.35);
  rustStreaks(ctx, W, H, rnd, 25, H * 0.5, H * 0.35, 0.25);
  ctx.fillStyle = 'rgba(70,40,20,0.35)';
  ctx.fillRect(0, H * 0.92, W, H * 0.08);
  blobs(ctx, rnd, W, H, 30, 4, 30, '95,50,25', 0.2, 0.55);
  // 底部污渍
  const gd = ctx.createLinearGradient(0, H * 0.7, 0, H);
  gd.addColorStop(0, 'rgba(30,25,20,0)'); gd.addColorStop(1, 'rgba(30,25,20,0.45)');
  ctx.fillStyle = gd; ctx.fillRect(0, H * 0.7, W, H * 0.3);
  // 刮痕露出金属
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(170,165,155,${0.15 + rnd() * 0.3})`;
    ctx.lineWidth = 1;
    const x = rnd() * W, y = rnd() * H;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 12); ctx.stroke();
  }
  return c;
}

function containerDoor(color, seed) {
  const W = 512, H = 544;
  const rnd = mulberry32(seed);
  const c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  const [r, g, b] = color.rgb;
  const hgt = new Float32Array(W * H);
  const n = fbm(W, H, 4, 4, 4, seed);
  const postW = 26, railT = 30;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0.3;
    if (x < postW || x > W - postW || y < railT || y > H - railT) v = 0.8;
    else {
      const dx = x < W / 2 ? x - postW : x - W / 2;
      const t = (dx / (W / 2 - postW)) * 5, f = t - Math.floor(t);
      v = 0.25 + (f < 0.2 ? f / 0.2 : f < 0.5 ? 1 : f < 0.7 ? 1 - (f - 0.5) / 0.2 : 0) * 0.35;
      if (Math.abs(x - W / 2) < 3) v = 0.05; // 门缝
    }
    hgt[y * W + x] = v + (n[y * W + x] - 0.5) * 0.05;
  }
  // 四根锁杆
  const rods = [W * 0.14, W * 0.36, W * 0.64, W * 0.86];
  for (const rx of rods) for (let y = railT - 10; y < H - railT + 10; y++) for (let x = rx - 7; x < rx + 7; x++) {
    const d = Math.abs(x - rx);
    hgt[y * W + (x | 0)] = 1.2 - d * 0.06;
  }
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, W, H);
  paintNoise(ctx, W, H, n, (v, rr, gg, bb, i) => {
    const k = (0.8 + v * 0.35) * (0.75 + hgt[i] * 0.3);
    return [rr * k, gg * k, bb * k];
  });
  // 锁杆颜色 & 把手
  for (const rx of rods) {
    ctx.fillStyle = 'rgba(40,40,40,0.35)'; ctx.fillRect(rx - 7, railT - 10, 14, H - 2 * railT + 20);
    ctx.fillStyle = 'rgba(30,30,30,0.7)'; ctx.fillRect(rx - 4, H * 0.55, 30 * (rx < W / 2 ? 1 : -1), 8);
    for (const yy of [railT + 30, H * 0.3, H * 0.75, H - railT - 30]) {
      ctx.fillStyle = 'rgba(30,30,30,0.6)'; ctx.fillRect(rx - 11, yy, 22, 12);
    }
  }
  weatheredText(ctx, color.text, W * 0.25, H * 0.2, `900 ${34}px "Arial Black", Impact, sans-serif`, color.tc, rnd, 0.3);
  ctx.fillStyle = 'rgba(210,205,190,0.8)'; ctx.fillRect(W * 0.58, H * 0.14, 90, 60); // CSC 铭牌
  ctx.fillStyle = 'rgba(50,50,50,0.8)';
  for (let i = 0; i < 5; i++) ctx.fillRect(W * 0.58 + 8, H * 0.14 + 8 + i * 10, 60 + rnd() * 14, 4);
  rustStreaks(ctx, W, H, rnd, 30, railT, H * 0.5, 0.35);
  blobs(ctx, rnd, W, H, 14, 5, 22, '95,50,25', 0.2, 0.5);
  return { map: c, hgt, W, H };
}

function containerRoof(W, H, seed) {
  const rnd = mulberry32(seed);
  const n = fbm(W, H, 8, 2, 5, seed);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = (x / W) * 28, f = t - Math.floor(t);
    let v = Math.sin(f * Math.PI) * 0.3;
    if (y < 10 || y > H - 10) v = 0.7;
    hgt[y * W + x] = v + n[y * W + x] * 0.1;
  }
  const c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(200,200,200)'; ctx.fillRect(0, 0, W, H);
  paintNoise(ctx, W, H, n, (v, rr, gg, bb, i) => {
    const k = 0.7 + v * 0.35;
    return [rr * k, gg * k, bb * k];
  });
  blobs(ctx, rnd, W, H, 40, 10, 60, '120,70,35', 0.15, 0.5);
  blobs(ctx, rnd, W, H, 20, 20, 80, '40,40,40', 0.1, 0.3);
  return { map: c, hgt };
}

// ============== 木箱 / 军用铁箱 ==============
function woodCrate(seed, variant) {
  const S = 512, rnd = mulberry32(seed);
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const grain = fbm(S, S, 2, 32, 4, seed);
  const n = fbm(S, S, 8, 8, 4, seed + 1);
  const hgt = new Float32Array(S * S);
  const base = variant === 1 ? [150, 112, 70] : [178, 140, 88];
  const frame = 58, planks = 6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const inFrame = x < frame || x > S - frame || y < frame || y > S - frame;
    let hv = inFrame ? 0.9 : 0.5;
    // 木板缝
    if (!inFrame) { const py = ((y - frame) / (S - 2 * frame)) * planks; if (py - Math.floor(py) < 0.03) hv = 0.1; }
    if (inFrame) { if (Math.abs(x - frame) < 2 || Math.abs(x - (S - frame)) < 2 || Math.abs(y - frame) < 2 || Math.abs(y - (S - frame)) < 2) hv = 0.2; }
    hgt[i] = hv + grain[i] * 0.1;
  }
  // 斜撑
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const inX = x > frame && x < S - frame && y > frame && y < S - frame;
    if (inX && Math.abs((x - frame) - (y - frame)) < 34 && variant !== 1) hgt[i] = 0.85 + grain[i] * 0.1;
    const gr = grain[i];
    const k = (0.72 + gr * 0.45) * (0.8 + n[i] * 0.3) * (0.55 + hgt[i] * 0.5);
    d[i * 4] = base[0] * k; d[i * 4 + 1] = base[1] * k; d[i * 4 + 2] = base[2] * k; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 钉子
  ctx.fillStyle = 'rgba(40,35,30,0.9)';
  for (let k = 0; k < 16; k++) {
    const t = k / 4 | 0, s = k % 4;
    const pos = [[frame / 2, frame + s * (S - 2 * frame) / 3], [S - frame / 2, frame + s * (S - 2 * frame) / 3], [frame + s * (S - 2 * frame) / 3, frame / 2], [frame + s * (S - 2 * frame) / 3, S - frame / 2]][t];
    ctx.beginPath(); ctx.arc(pos[0], pos[1], 3, 0, 7); ctx.fill();
  }
  const labels = ['FRAGILE', 'CF-07', 'HANDLE WITH CARE', 'NO.36', '易碎物品', 'LAGOS'];
  weatheredText(ctx, labels[seed % labels.length], S / 2, S / 2 + (variant === 1 ? 0 : 60), `bold ${labels[seed % labels.length].length > 8 ? 34 : 54}px "Arial Black", Impact, sans-serif`, 'rgba(25,25,25,0.8)', rnd, 0.5);
  if (seed % 2 === 0) { // 向上箭头
    ctx.fillStyle = 'rgba(25,25,25,0.7)';
    for (const ax of [S / 2 - 40, S / 2 + 40]) {
      ctx.beginPath(); ctx.moveTo(ax, S * 0.28); ctx.lineTo(ax - 18, S * 0.36); ctx.lineTo(ax + 18, S * 0.36); ctx.fill();
      ctx.fillRect(ax - 6, S * 0.36, 12, 34);
    }
  }
  blobs(ctx, rnd, S, S, 12, 10, 50, '60,40,25', 0.1, 0.35);
  return { map: c, hgt };
}

function metalCrate(seed) {
  const S = 512, rnd = mulberry32(seed);
  const n = fbm(S, S, 8, 8, 5, seed);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const e = Math.min(x, y, S - x, S - y);
    let v = e < 24 ? 0.9 : e < 30 ? 0.4 : 0.55;
    const ry = (y / S) * 4; if (Math.abs(ry - Math.round(ry)) < 0.02 && e > 30) v = 0.75;
    hgt[y * S + x] = v + n[y * S + x] * 0.05;
  }
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(72,80,54)'; ctx.fillRect(0, 0, S, S);
  paintNoise(ctx, S, S, n, (v, r, g, b, i) => { const k = (0.8 + v * 0.3) * (0.7 + hgt[i] * 0.4); return [r * k, g * k, b * k]; });
  ctx.fillStyle = 'rgba(30,30,30,0.8)';
  for (const x of [S * 0.25, S * 0.75]) { ctx.fillRect(x - 22, 32, 44, 26); ctx.fillRect(x - 22, S - 58, 44, 26); }
  weatheredText(ctx, ['AMMO 7.62', 'CARTRIDGES', 'EXPLOSIVE', 'CF ARMORY'][seed % 4], S / 2, S * 0.45, 'bold 48px "Arial Black", Impact, sans-serif', 'rgba(230,200,60,0.85)', rnd, 0.4);
  weatheredText(ctx, 'LOT ' + ((rnd() * 9000 + 1000) | 0), S / 2, S * 0.6, 'bold 26px Arial, sans-serif', 'rgba(230,220,180,0.7)', rnd, 0.3);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(150,150,140,${0.2 + rnd() * 0.3})`;
    const x = rnd() * S, y = rnd() * S;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 10); ctx.stroke();
  }
  return { map: c, hgt };
}

// ============== 船体 / 舱壁 / 上层建筑 ==============
function hullTexture() {
  const W = 1024, H = 1024; // 16m 宽，v 映射高度 (-12..+1.5)
  const rnd = mulberry32(55);
  const n = fbm(W, H, 8, 8, 5, 56);
  const c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  const yToPx = (y) => H - ((y + 12) / 13.5) * H;
  const wl = yToPx(-7.3);
  // 上部深灰黑，水线以下红色防污漆，中间黑色水线带
  ctx.fillStyle = 'rgb(38,42,48)'; ctx.fillRect(0, 0, W, wl);
  ctx.fillStyle = 'rgb(24,24,26)'; ctx.fillRect(0, wl, W, yToPx(-8.2) - wl);
  ctx.fillStyle = 'rgb(118,34,30)'; ctx.fillRect(0, yToPx(-8.2), W, H);
  paintNoise(ctx, W, H, n, (v, r, g, b) => { const k = 0.75 + v * 0.45; return [r * k, g * k, b * k]; });
  // 焊缝
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hgt[i] = n[i] * 0.1;
  ctx.strokeStyle = 'rgba(15,15,18,0.6)'; ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); for (let y = 0; y < H; y++) { hgt[y * W + x] += 0.6; hgt[y * W + x + 1] += 0.4; } }
  for (const yy of [-2, -5, -10]) { const py = yToPx(yy) | 0; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); for (let x = 0; x < W; x++) hgt[py * W + x] += 0.6; }
  // 锈流
  rustStreaks(ctx, W, H, rnd, 70, yToPx(1.2), H * 0.35, 0.45, '120,58,28');
  rustStreaks(ctx, W, H, rnd, 20, yToPx(-3), H * 0.2, 0.3, '120,58,28');
  // 排水口
  for (let i = 0; i < 3; i++) {
    const x = 100 + i * 330 + rnd() * 40, y = yToPx(-0.6);
    ctx.fillStyle = 'rgb(12,12,12)'; ctx.beginPath(); ctx.ellipse(x, y, 10, 6, 0, 0, 7); ctx.fill();
    rustStreaks(ctx, W, H, () => 0.5 + (rnd() - 0.5) * 0.02, 1, y, H * 0.3, 0.6, '130,62,30');
  }
  // 水线附近的污渍
  const g = ctx.createLinearGradient(0, wl - 40, 0, wl + 20);
  g.addColorStop(0, 'rgba(60,70,60,0)'); g.addColorStop(1, 'rgba(60,70,60,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, wl - 40, W, 60);
  return { map: tex(c), normalMap: tex(normalFromHeight(hgt, W, H, 3), { srgb: false }) };
}

function paintedSteel(seed, rgb, opts = {}) {
  const S = 512, rnd = mulberry32(seed); // 3m x 3m
  const n = fbm(S, S, 4, 4, 5, seed);
  const n2 = fbm(S, S, 16, 16, 3, seed + 1);
  const hgt = new Float32Array(S * S);
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; ctx.fillRect(0, 0, S, S);
  paintNoise(ctx, S, S, n, (v, r, g, b, i) => { const k = 0.82 + v * 0.28 + (n2[i] - 0.5) * 0.06; return [r * k, g * k, b * k]; });
  // 加强筋（竖向）
  if (opts.stiffeners !== false) {
    for (let x = 0; x < S; x += 128) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 6, 0, 4, S);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, 0, 6, S);
      for (let y = 0; y < S; y++) for (let k = 0; k < 8; k++) hgt[y * S + x + k] = 0.8;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0, 255, S, 2);
    for (let x = 0; x < S; x++) hgt[255 * S + x] = 0.6;
  }
  for (let i = 0; i < S * S; i++) hgt[i] += n2[i] * 0.05;
  rustStreaks(ctx, S, S, rnd, opts.rust ?? 30, 0, S * 0.6, 0.3);
  blobs(ctx, rnd, S, S, 16, 4, 20, '110,60,30', 0.2, 0.5);
  const gd = ctx.createLinearGradient(0, S * 0.75, 0, S);
  gd.addColorStop(0, 'rgba(40,35,30,0)'); gd.addColorStop(1, 'rgba(40,35,30,0.4)');
  ctx.fillStyle = gd; ctx.fillRect(0, S * 0.75, S, S * 0.25);
  return { map: tex(c), normalMap: tex(normalFromHeight(hgt, S, S, 2.5), { srgb: false }) };
}

function superWall() {
  // 一个 4m x 3m 的单元：白色钢板 + 一扇窗
  const W = 512, H = 384, rnd = mulberry32(77);
  const n = fbm(W, H, 4, 3, 5, 78);
  const c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(214,216,212)'; ctx.fillRect(0, 0, W, H);
  paintNoise(ctx, W, H, n, (v, r, g, b) => { const k = 0.85 + v * 0.2; return [r * k, g * k, b * k]; });
  const wx = 150, wy = 90, ww = 212, wh = 150;
  // 窗框
  ctx.fillStyle = 'rgb(160,164,160)'; ctx.fillRect(wx - 10, wy - 10, ww + 20, wh + 20);
  const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
  g.addColorStop(0, 'rgb(120,150,175)'); g.addColorStop(0.45, 'rgb(40,58,72)'); g.addColorStop(1, 'rgb(22,28,34)');
  ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(wx + 20, wy); ctx.lineTo(wx + 80, wy); ctx.lineTo(wx + 20, wy + wh); ctx.lineTo(wx, wy + wh); ctx.fill();
  ctx.fillStyle = 'rgb(150,154,150)'; ctx.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  rustStreaks(ctx, W, H, rnd, 10, wy + wh + 10, 110, 0.35);
  rustStreaks(ctx, W, H, rnd, 10, 0, 60, 0.2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, H - 6, W, 6);
  const em = mkCanvas(W, H), ex = em.getContext('2d', { willReadFrequently: true });
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  if (true) { ex.fillStyle = 'rgba(255,220,160,0.10)'; ex.fillRect(wx, wy + wh * 0.5, ww, wh * 0.5); }
  return { map: tex(c), emissiveMap: tex(em) };
}

// ============== 网格 / 格栅 ==============
function meshFence() {
  const S = 256, cells = 8; // 1m -> 8 格（12.5cm 焊接网）
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(225,228,222,1)'; ctx.lineWidth = 3.2;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * S;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  const t = tex(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grating() {
  const S = 256; // 0.5m
  const c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(70,74,74)'; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) ctx.fillRect(x * 16 + 3, y * 64 + 4, 11, 56);
  ctx.globalCompositeOperation = 'source-over';
  return tex(c);
}

// ============== 贴花 / 粒子 ==============
function bulletHole(kind) {
  const S = 64, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(kind === 'wood' ? 3 : 4);
  if (kind === 'wood') {
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = `rgba(210,170,110,${0.5 + rnd() * 0.4})`; ctx.lineWidth = 1 + rnd() * 2;
      const a = rnd() * 6.28; ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * (10 + rnd() * 16), 32 + Math.sin(a) * (10 + rnd() * 16)); ctx.stroke();
    }
  } else {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 20);
    g.addColorStop(0, 'rgba(200,200,195,0.9)'); g.addColorStop(0.4, 'rgba(120,120,115,0.5)'); g.addColorStop(1, 'rgba(60,60,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(32, 32, 20, 0, 7); ctx.fill();
  }
  const g2 = ctx.createRadialGradient(32, 32, 0, 32, 32, 8);
  g2.addColorStop(0, 'rgba(5,5,5,1)'); g2.addColorStop(0.7, 'rgba(15,15,15,0.95)'); g2.addColorStop(1, 'rgba(20,20,20,0)');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(32, 32, 8, 0, 7); ctx.fill();
  return tex(c, { repeat: false });
}

function scorch() {
  const S = 256, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const n = fbm(S, S, 8, 8, 4, 91);
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const a = Math.max(0, 1 - r * (0.8 + n[y * S + x] * 0.6)) ** 1.3;
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 10; d[i + 3] = a * 235;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

function blood() {
  const S = 128, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(5);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.28, r = rnd() * 40, s = 3 + rnd() * 12 * (1 - r / 50);
    ctx.fillStyle = `rgba(${100 + rnd() * 40},8,8,${0.7 + rnd() * 0.3})`;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s, 0, 7); ctx.fill();
  }
  return tex(c, { repeat: false });
}

function muzzleFlash(seed, petals) {
  const S = 256, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(seed);
  ctx.translate(S / 2, S / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let p = 0; p < petals; p++) {
    const a = (p / petals) * Math.PI * 2 + rnd() * 0.4, L = S * (0.28 + rnd() * 0.2), wd = S * 0.05;
    ctx.save(); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, L, 0);
    g.addColorStop(0, 'rgba(255,240,200,0.95)'); g.addColorStop(0.4, 'rgba(255,170,60,0.7)'); g.addColorStop(1, 'rgba(255,90,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -wd); ctx.quadraticCurveTo(L * 0.5, -wd * 0.8, L, 0); ctx.quadraticCurveTo(L * 0.5, wd * 0.8, 0, wd); ctx.fill();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.35, 'rgba(255,200,110,0.8)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, S * 0.22, 0, 7); ctx.fill();
  return tex(c, { repeat: false });
}

function muzzleSide() {
  const W = 256, H = 64, c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,190,90,0.85)'); g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, H / 2 - 14); ctx.quadraticCurveTo(W * 0.4, 2, W, H / 2); ctx.quadraticCurveTo(W * 0.4, H - 2, 0, H / 2 + 14); ctx.fill();
  return tex(c, { repeat: false });
}

function softPuff() {
  const S = 128, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const n = fbm(S, S, 4, 4, 4, 33);
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const a = Math.max(0, 1 - r) ** 1.5 * (0.5 + n[y * S + x] * 0.8);
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

function glow() {
  const S = 64, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { repeat: false });
}

function sparkTex() {
  const W = 16, H = 64, c = mkCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,220,0)'); g.addColorStop(0.2, 'rgba(255,240,180,1)'); g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g; ctx.fillRect(W / 2 - 2, 0, 4, H);
  return tex(c, { repeat: false });
}

// ============== 标识牌图集 ==============
function signAtlas() {
  const S = 1024, c = mkCanvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(123);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  // 0: 黄黑警示条 (0,0,512,128)
  for (let i = -4; i < 40; i++) {
    ctx.fillStyle = i % 2 ? '#1a1a1a' : '#e0b21c';
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 32, 0); ctx.lineTo(i * 32 + 32 - 128, 128); ctx.lineTo(i * 32 - 128, 128); ctx.fill();
  }
  // 1: 禁止烟火 (512,0,256,256)
  const sign = (x, y, w, h, bg, fg, lines, icon) => {
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => { ctx.font = l[1]; ctx.fillText(l[0], x + w / 2, y + l[2]); });
    if (icon) icon(x, y, w, h);
  };
  sign(512, 0, 256, 256, '#f2f2ec', '#c0201c', [['禁止烟火', 'bold 40px sans-serif', 200], ['NO SMOKING', 'bold 22px Arial', 236]], (x, y) => {
    ctx.strokeStyle = '#c0201c'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(x + 128, y + 95, 70, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 78, y + 45); ctx.lineTo(x + 178, y + 145); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.fillRect(x + 90, y + 88, 70, 14);
  });
  // 2: DANGER (768,0,256,256)
  sign(768, 0, 256, 256, '#e0b21c', '#111', [['DANGER', 'bold 50px "Arial Black"', 70], ['危险', 'bold 64px sans-serif', 150], ['高压 · 禁止攀爬', 'bold 24px sans-serif', 220]]);
  // 3: 舱号 (0,128,512,128)
  ctx.fillStyle = '#d9dad4'; ctx.fillRect(0, 128, 512, 128);
  ctx.fillStyle = '#1b2a4a'; ctx.font = 'bold 76px "Arial Black", Impact'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HOLD No.3', 256, 192);
  // 4: 救生圈标识 / 集合点 (0,256,256,256)
  sign(0, 256, 256, 256, '#1f8a3a', '#fff', [['集合点', 'bold 50px sans-serif', 190], ['MUSTER STATION', 'bold 20px Arial', 230]], (x, y) => {
    ctx.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + 70 + i * 38, y + 90, 16, 0, 7); ctx.fill(); }
  });
  // 5: 消防 (256,256,256,256)
  sign(256, 256, 256, 256, '#c0201c', '#fff', [['消防栓', 'bold 56px sans-serif', 170], ['FIRE HYDRANT', 'bold 22px Arial', 225]], (x, y) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 108, y + 40, 40, 70); ctx.fillRect(x + 90, y + 60, 76, 18);
  });
  // 6: 船名 (0,512,1024,160)
  ctx.fillStyle = '#e9ebe6'; ctx.fillRect(0, 512, 1024, 160);
  ctx.fillStyle = '#12213f'; ctx.font = 'bold 110px "Arial Black", Impact'; ctx.fillText('KESTREL  STAR', 512, 594);
  // 7: 集装箱喷漆 GR / BL 大字 (0,672,512,176)
  ctx.fillStyle = '#20252b'; ctx.fillRect(0, 672, 512, 176);
  ctx.fillStyle = '#d23b2e'; ctx.font = 'bold 120px "Arial Black", Impact'; ctx.fillText('BL', 256, 762);
  ctx.fillStyle = '#20252b'; ctx.fillRect(512, 672, 512, 176);
  ctx.fillStyle = '#3a8ee0'; ctx.fillText('GR', 768, 762);
  // 8: 甲板箭头 (512,256,256,256)
  ctx.fillStyle = '#000'; ctx.fillRect(512, 256, 512, 256);
  ctx.fillStyle = 'rgba(235,235,225,0.9)';
  ctx.beginPath(); ctx.moveTo(640, 280); ctx.lineTo(720, 380); ctx.lineTo(670, 380); ctx.lineTo(670, 490); ctx.lineTo(610, 490); ctx.lineTo(610, 380); ctx.lineTo(560, 380); ctx.fill();
  ctx.fillStyle = 'rgba(224,178,28,0.95)'; ctx.fillRect(800, 256, 60, 256); ctx.fillRect(900, 256, 60, 256);
  // 做旧
  const n = fbm(S, S, 16, 16, 3, 124);
  paintNoise(ctx, S, S, n, (v, r, g, b) => { const k = 0.8 + v * 0.3; return [r * k, g * k, b * k]; });
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(90,60,40,${rnd() * 0.3})`; ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 8, 2 + rnd() * 20); }
  return tex(c, { repeat: false });
}

export const SIGN_UV = {
  hazard: [0, 0, 512, 128], nosmoke: [512, 0, 256, 256], danger: [768, 0, 256, 256],
  hold: [0, 128, 512, 128], muster: [0, 256, 256, 256], hydrant: [256, 256, 256, 256],
  shipname: [0, 512, 1024, 160], bl: [0, 672, 512, 176], gr: [512, 672, 512, 176],
  arrow: [512, 256, 256, 256], yline: [800, 256, 160, 256],
};

// ============== 汇总 ==============
export function buildTextures(quality = 'high') {
  const T = {};
  T.deck = deckTextures();

  // 集装箱（侧面法线在同长度间共享）
  const h20 = corrugationHeight(1024, 448, 22, 0.07, 0.03);
  const h40 = corrugationHeight(2048, 448, 44, 0.07, 0.015);
  const n20 = tex(normalFromHeight(h20, 1024, 448, 3.2), { srgb: false });
  const n40 = tex(normalFromHeight(h40, 2048, 448, 3.2), { srgb: false });
  const roof = containerRoof(1024, 256, 900);
  const roofN = tex(normalFromHeight(roof.hgt, 1024, 256, 2), { srgb: false });
  const roofMap = tex(roof.map);
  T.containers = CONTAINER_COLORS.map((col, i) => {
    const s20 = containerSide(col, 1024, 448, 22, 200 + i, h20);
    const s40 = containerSide(col, 2048, 448, 44, 300 + i, h40);
    const door = containerDoor(col, 400 + i);
    return {
      color: col,
      side20: tex(s20), side40: tex(s40), n20, n40,
      door: tex(door.map), doorN: tex(normalFromHeight(door.hgt, door.W, door.H, 3), { srgb: false }),
      roof: roofMap, roofN,
    };
  });
  // 木箱与铁箱
  T.crates = [];
  for (let i = 0; i < 4; i++) {
    const w = woodCrate(500 + i, i % 2);
    T.crates.push({ map: tex(w.map), normalMap: tex(normalFromHeight(w.hgt, 512, 512, 3), { srgb: false }), kind: 'wood' });
  }
  for (let i = 0; i < 2; i++) {
    const m = metalCrate(600 + i);
    T.crates.push({ map: tex(m.map), normalMap: tex(normalFromHeight(m.hgt, 512, 512, 3), { srgb: false }), kind: 'metal' });
  }
  T.hull = hullTexture();
  T.bulkhead = paintedSteel(700, [168, 172, 170]);
  T.darkSteel = paintedSteel(701, [70, 76, 80], { rust: 40 });
  T.yellowSteel = paintedSteel(702, [214, 170, 38], { stiffeners: false, rust: 20 });
  T.redSteel = paintedSteel(703, [150, 44, 36], { stiffeners: false, rust: 20 });
  T.greenSteel = paintedSteel(704, [70, 96, 78], { rust: 25 });
  T.superWall = superWall();
  T.fence = meshFence();
  T.grating = grating();
  T.holeMetal = bulletHole('metal');
  T.holeWood = bulletHole('wood');
  T.scorch = scorch();
  T.blood = blood();
  T.flash = [muzzleFlash(1, 5), muzzleFlash(2, 6), muzzleFlash(3, 4)];
  T.flashSide = muzzleSide();
  T.puff = softPuff();
  T.glow = glow();
  T.spark = sparkTex();
  T.signs = signAtlas();
  return T;
}
