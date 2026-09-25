import * as THREE from 'three';
import { mulberry32 } from './util.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// 可平铺的多倍频值噪声
function tileNoise(size, octaves, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = 4 << o;
    const grid = new Float32Array(g * g);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * g;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * g;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[(y0 % g) * g + (x0 % g)];
        const b = grid[(y0 % g) * g + ((x0 + 1) % g)];
        const c = grid[((y0 + 1) % g) * g + (x0 % g)];
        const d = grid[((y0 + 1) % g) * g + ((x0 + 1) % g)];
        out[y * size + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function makeDetailTexture(size = 256, lo = 0.78, hi = 1.0, seed = 7) {
  const [c, ctx] = makeCanvas(size, size);
  const n = tileNoise(size, 6, seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = Math.round((lo + (hi - lo) * n[i]) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// 路面：24m x 5.4m 一个周期，含边线、虚线中线、自行车道标识
export function makeRoadTextures() {
  const W = 2048;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const [b, bctx] = makeCanvas(W, H);
  const rnd = mulberry32(42);
  ctx.fillStyle = '#44464b';
  ctx.fillRect(0, 0, W, H);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, W, H);
  // 沥青颗粒
  for (let i = 0; i < 90000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const s = rnd() * 2.2 + 0.6;
    const g = Math.floor(40 + rnd() * 70);
    ctx.fillStyle = `rgb(${g},${g + 1},${g + 4})`;
    ctx.fillRect(x, y, s, s);
    const bg = Math.floor(90 + rnd() * 120);
    bctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    bctx.fillRect(x, y, s, s);
  }
  // 修补块
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(20,20,24,${0.12 + rnd() * 0.12})`;
    const x = rnd() * W;
    const y = rnd() * H;
    ctx.fillRect(x, y, 60 + rnd() * 160, 30 + rnd() * 90);
  }
  // 车辙暗带
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.3, 'rgba(0,0,0,0.10)');
  grd.addColorStop(0.36, 'rgba(0,0,0,0)');
  grd.addColorStop(0.64, 'rgba(0,0,0,0)');
  grd.addColorStop(0.7, 'rgba(0,0,0,0.10)');
  grd.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // 以米为单位绘制
  const sx = W / 24;
  const sy = H / 5.4;
  const paintLine = (x, y, w, h, color = '#ecebe2') => {
    ctx.fillStyle = color;
    ctx.fillRect(x * sx, y * sy, w * sx, h * sy);
    bctx.fillStyle = '#c8c8c8';
    bctx.fillRect(x * sx, y * sy, w * sx, h * sy);
  };
  paintLine(0, 0.18, 24, 0.12);
  paintLine(0, 5.1, 24, 0.12);
  for (let x = 0; x < 24; x += 6) paintLine(x, 2.64, 3, 0.12, '#f2c94c');

  // 右侧车道自行车标识 + 箭头（图标"上方"朝向前进方向 +x）
  ctx.save();
  ctx.translate(12 * sx, 4.0 * sy);
  ctx.rotate(Math.PI / 2);
  ctx.scale(sy, sx);
  ctx.strokeStyle = 'rgba(236,235,226,0.92)';
  ctx.fillStyle = 'rgba(236,235,226,0.92)';
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wr = 0.42;
  ctx.beginPath();
  ctx.arc(-0.62, 0.35, wr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0.62, 0.35, wr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.62, 0.35);
  ctx.lineTo(-0.1, 0.35);
  ctx.lineTo(0.35, -0.2);
  ctx.lineTo(-0.3, -0.2);
  ctx.closePath();
  ctx.moveTo(-0.1, 0.35);
  ctx.lineTo(-0.36, -0.42);
  ctx.moveTo(0.62, 0.35);
  ctx.lineTo(0.42, -0.5);
  ctx.lineTo(0.6, -0.55);
  ctx.moveTo(-0.5, -0.45);
  ctx.lineTo(-0.2, -0.45);
  ctx.stroke();
  // 鹈鹕头像简笔
  ctx.beginPath();
  ctx.arc(-0.05, -1.0, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.08, -1.05);
  ctx.lineTo(0.75, -0.85);
  ctx.lineTo(0.1, -0.9);
  ctx.closePath();
  ctx.fill();
  // 前进箭头
  ctx.beginPath();
  ctx.moveTo(0, -2.9);
  ctx.lineTo(0.45, -2.3);
  ctx.lineTo(0.16, -2.3);
  ctx.lineTo(0.16, -1.6);
  ctx.lineTo(-0.16, -1.6);
  ctx.lineTo(-0.16, -2.3);
  ctx.lineTo(-0.45, -2.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const map = toTexture(c, { aniso: 16 });
  const bump = toTexture(b, { srgb: false, aniso: 16 });
  return { map, bump };
}

// 羽毛鳞片凹凸
export function makeFeatherTexture() {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const rows = 16;
  const cols = 12;
  const rw = S / cols;
  const rh = S / rows;
  for (let r = rows + 1; r >= -1; r--) {
    for (let k = -1; k <= cols; k++) {
      const x = k * rw + (r % 2 ? rw / 2 : 0);
      const y = r * rh;
      const g = ctx.createRadialGradient(x, y - rh * 0.4, rh * 0.1, x, y - rh * 0.4, rw * 0.75);
      g.addColorStop(0, '#d8d8d8');
      g.addColorStop(0.75, '#9a9a9a');
      g.addColorStop(1, '#505050');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y - rh * 0.2, rw * 0.62, rh * 1.05, 0, 0, Math.PI);
      ctx.fill();
      // 羽轴
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y - rh * 0.2);
      ctx.lineTo(x, y + rh * 0.75);
      ctx.stroke();
    }
  }
  return toTexture(c, { srgb: false });
}

// 藤编篮
export function makeWickerTexture() {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#6b4424';
  ctx.fillRect(0, 0, S, S);
  const n = 8;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const horiz = (x + y) % 2 === 0;
      const g = horiz
        ? ctx.createLinearGradient(0, y * cell, 0, (y + 1) * cell)
        : ctx.createLinearGradient(x * cell, 0, (x + 1) * cell, 0);
      g.addColorStop(0, '#7a4f2a');
      g.addColorStop(0.5, '#d9a766');
      g.addColorStop(1, '#6e4524');
      ctx.fillStyle = g;
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
    }
  }
  return toTexture(c);
}

export function makeSpriteTexture() {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

// 车架贴花
export function makeDecalTexture(text) {
  const [c, ctx] = makeCanvas(1024, 128);
  ctx.clearRect(0, 0, 1024, 128);
  ctx.font = 'italic 900 92px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#1b1b1b';
  ctx.strokeText(text, 512, 68);
  const g = ctx.createLinearGradient(0, 20, 0, 110);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(1, '#f2a93b');
  ctx.fillStyle = g;
  ctx.fillText(text, 512, 68);
  return toTexture(c, { repeat: false });
}

function drawPelicanGlyph(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#161616';
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  // 轮子
  ctx.beginPath();
  ctx.arc(-0.62, 0.62, 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0.62, 0.62, 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.62, 0.62);
  ctx.lineTo(-0.05, 0.62);
  ctx.lineTo(0.4, 0.15);
  ctx.lineTo(-0.3, 0.15);
  ctx.closePath();
  ctx.moveTo(0.62, 0.62);
  ctx.lineTo(0.42, -0.05);
  ctx.stroke();
  // 身体
  ctx.beginPath();
  ctx.ellipse(-0.25, -0.12, 0.42, 0.26, -0.35, 0, Math.PI * 2);
  ctx.fill();
  // 脖子+头
  ctx.beginPath();
  ctx.moveTo(0.02, -0.25);
  ctx.quadraticCurveTo(0.2, -0.55, 0.05, -0.78);
  ctx.lineWidth = 0.14;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0.1, -0.84, 0.12, 0, Math.PI * 2);
  ctx.fill();
  // 大嘴
  ctx.beginPath();
  ctx.moveTo(0.18, -0.9);
  ctx.lineTo(0.9, -0.74);
  ctx.quadraticCurveTo(0.5, -0.5, 0.18, -0.74);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 路牌：黄色菱形警示牌
export function makeSignTexture(kind) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  if (kind === 'crossing') {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#161616';
    ctx.fillRect(-172, -172, 344, 344);
    ctx.fillStyle = '#f7c531';
    ctx.fillRect(-160, -160, 320, 320);
    ctx.restore();
    drawPelicanGlyph(ctx, S / 2, S / 2 - 6, 118);
  } else if (kind === 'speed') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 230, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 42;
    ctx.strokeStyle = '#d7263d';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 200, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = '900 190px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('45', S / 2, S / 2 - 18);
    ctx.font = '700 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('鹈鹕限速', S / 2, S / 2 + 110);
  } else {
    // 蓝色指示牌：前方有鱼
    ctx.fillStyle = '#0f5fa8';
    roundRect(ctx, 20, 110, S - 40, S - 220, 34);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    roundRect(ctx, 36, 126, S - 72, S - 252, 24);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 76px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('前方有鱼', S / 2, S / 2 - 40);
    ctx.font = '700 44px "Arial", sans-serif';
    ctx.fillText('FISH AHEAD  ➜', S / 2, S / 2 + 56);
  }
  return toTexture(c, { repeat: false });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 灯塔条纹 / 遮阳伞条纹
export function makeStripeTexture(colors, n = 8, vertical = false) {
  const [c, ctx] = makeCanvas(256, 256);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    if (vertical) ctx.fillRect((i * 256) / n, 0, 256 / n + 1, 256);
    else ctx.fillRect(0, (i * 256) / n, 256, 256 / n + 1);
  }
  return toTexture(c);
}
