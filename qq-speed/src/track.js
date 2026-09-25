import * as THREE from 'three';
import { clamp, wrapAngle } from './util.js';
import { roadTexture, wallTexture, curbTexture, checkerTexture, boostPadTexture, tunnelTexture, groundTexture } from './textures.js';

const TEX_LEN = 24; // 路面贴图沿路长度（米）
const WALL_TEX_LEN = 16;

export class Track {
  constructor(layout, cfg = {}) {
    this.halfW = layout.width / 2;
    this.wallH = cfg.wallH ?? 1.25;
    const curve = new THREE.CatmullRomCurve3(
      layout.points.map((p) => new THREE.Vector3(p[0], p[2] || 0, p[1])),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = 6000;
    curve.updateArcLengths();
    const approxLen = curve.getLength();
    const N = Math.round(approxLen / 1.5);
    const pts = curve.getSpacedPoints(N).slice(0, N);
    this.N = N;
    this.px = new Float32Array(N);
    this.py = new Float32Array(N);
    this.pz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x;
      this.py[i] = pts[i].y;
      this.pz[i] = pts[i].z;
    }
    let len = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      len += Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
    }
    this.length = len;
    this.ds = len / N;

    this.hd = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.rx = new Float32Array(N);
    this.rz = new Float32Array(N);
    this.curv = new Float32Array(N);
    this.bank = new Float32Array(N);
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const h = Math.atan2(this.px[b] - this.px[a], this.pz[b] - this.pz[a]);
      this.hd[i] = h;
      this.tx[i] = Math.sin(h);
      this.tz[i] = Math.cos(h);
      this.rx[i] = -Math.cos(h);
      this.rz[i] = Math.sin(h);
      this.slope[i] = (this.py[b] - this.py[a]) / (2 * this.ds);
    }
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) raw[i] = wrapAngle(this.hd[(i + 1) % N] - this.hd[i]) / this.ds;
    const W = 7;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += raw[(i + k + N) % N];
      this.curv[i] = s / (2 * W + 1);
    }
    // 弯道外侧抬高（路面倾角）
    const bk = new Float32Array(N);
    for (let i = 0; i < N; i++) bk[i] = clamp(this.curv[i] * 5.5, -0.13, 0.13);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -12; k <= 12; k++) s += bk[(i + k + N) % N];
      this.bank[i] = s / 25;
    }
    // 竖直曲率（平滑后）：v²·κ > g 时车辆会腾空（跳台）
    const sy = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let a = 0;
      for (let k = -3; k <= 3; k++) a += this.py[(i + k + N) % N];
      sy[i] = a / 7;
    }
    this.vcurv = new Float32Array(N);
    this.sslope = new Float32Array(N);
    const K = 4;
    for (let i = 0; i < N; i++) {
      const s0 = (sy[i] - sy[(i - K + N) % N]) / (K * this.ds);
      const s1 = (sy[(i + K) % N] - sy[i]) / (K * this.ds);
      this.vcurv[i] = (s1 - s0) / (K * this.ds);
      this.sslope[i] = (sy[(i + 1) % N] - sy[(i - 1 + N) % N]) / (2 * this.ds);
    }
    this.bridge = new Uint8Array(N);
    if (cfg.isBridge) for (let i = 0; i < N; i++) this.bridge[i] = cfg.isBridge(this.px[i], this.pz[i], this.py[i]) ? 1 : 0;

    // 空间哈希，用于地形压平 / 摆放物件避让
    this.cell = 16;
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = this._key(Math.floor(this.px[i] / this.cell), Math.floor(this.pz[i] / this.cell));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
    this._tmp = { i: 0, t: 0, d: 0, lat: 0, y: 0, x: 0, z: 0, tx: 0, tz: 0, rx: 0, rz: 0, bank: 0, hd: 0 };
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  // 距离 (x,z) 最近的赛道采样点（maxDist 内），返回 {dist,i} 或 null
  nearest(x, z, maxDist = 60) {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = maxDist * maxDist, bi = -1;
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        const arr = this.grid.get(this._key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.px[i] - x, dz = this.pz[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
    return bi < 0 ? null : { dist: Math.sqrt(best), i: bi };
  }

  // 遍历 maxDist 内所有采样点
  forEachNear(x, z, maxDist, fn) {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const md2 = maxDist * maxDist;
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        const arr = this.grid.get(this._key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.px[i] - x, dz = this.pz[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < md2) fn(i, Math.sqrt(d2));
        }
      }
  }

  // 沿赛道距离 d 处的中心线状态
  sample(d, out = this._tmp) {
    const L = this.length;
    d = ((d % L) + L) % L;
    const f = d / this.ds;
    const i = Math.floor(f) % this.N;
    const j = (i + 1) % this.N;
    const t = f - Math.floor(f);
    out.i = i;
    out.t = t;
    out.d = d;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    const h = this.hd[i] + wrapAngle(this.hd[j] - this.hd[i]) * t;
    out.hd = h;
    out.tx = Math.sin(h);
    out.tz = Math.cos(h);
    out.rx = -out.tz;
    out.rz = out.tx;
    out.bank = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    out.lat = 0;
    return out;
  }

  // 投影世界坐标到赛道；hint 为上次的采样序号（局部搜索），-1 表示全局搜索
  project(x, y, z, hint, out) {
    const N = this.N;
    let bi = 0, best = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = this.px[i] - x, dz = this.pz[i] - z, dy = (this.py[i] - y) * 3;
        const d2 = dx * dx + dz * dz + dy * dy;
        if (d2 < best) { best = d2; bi = i; }
      }
    } else {
      for (let k = -30; k <= 30; k++) {
        const i = (hint + k + N) % N;
        const dx = this.px[i] - x, dz = this.pz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    // 在 bi 前后两段上精确投影
    let i = bi;
    let j = (i + 1) % N;
    let ex = this.px[j] - this.px[i], ez = this.pz[j] - this.pz[i];
    let t = ((x - this.px[i]) * ex + (z - this.pz[i]) * ez) / (ex * ex + ez * ez);
    if (t < 0) {
      i = (bi - 1 + N) % N;
      j = bi;
      ex = this.px[j] - this.px[i];
      ez = this.pz[j] - this.pz[i];
      t = ((x - this.px[i]) * ex + (z - this.pz[i]) * ez) / (ex * ex + ez * ez);
    }
    t = clamp(t, 0, 1);
    const s = this.sample((i + t) * this.ds, out);
    s.lat = (x - s.x) * s.rx + (z - s.z) * s.rz;
    s.surfY = s.y + s.lat * Math.sin(s.bank);
    return s;
  }

  surfaceY(s, lat) { return s.y + lat * Math.sin(s.bank); }

  // 前方一段距离内的最大曲率（带符号：取绝对值最大的那个）
  curvAhead(d, range) {
    const N = this.N;
    const i0 = Math.floor((((d % this.length) + this.length) % this.length) / this.ds);
    const steps = Math.max(1, Math.floor(range / this.ds));
    let m = 0;
    for (let k = 0; k < steps; k += 2) {
      const c = this.curv[(i0 + k) % N];
      if (Math.abs(c) > Math.abs(m)) m = c;
    }
    return m;
  }

  // ---------- 网格构建 ----------
  build(theme, groundFn) {
    const group = new THREE.Group();
    const N = this.N, hw = this.halfW;
    const rows = N + 1;

    // 路面
    {
      const pos = new Float32Array(rows * 2 * 3), uv = new Float32Array(rows * 2 * 2);
      for (let r = 0; r < rows; r++) {
        const i = r % N;
        const sb = Math.sin(this.bank[i]);
        for (let s = 0; s < 2; s++) {
          const lat = s ? hw : -hw;
          const o = (r * 2 + s) * 3;
          pos[o] = this.px[i] + this.rx[i] * lat;
          pos[o + 1] = this.py[i] + lat * sb;
          pos[o + 2] = this.pz[i] + this.rz[i] * lat;
          uv[(r * 2 + s) * 2] = s;
          uv[(r * 2 + s) * 2 + 1] = (r * this.ds) / TEX_LEN;
        }
      }
      const idx = [];
      for (let r = 0; r < N; r++) {
        const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        map: roadTexture(theme.road),
        roughness: theme.roadRough ?? 0.85,
        metalness: theme.roadMetal ?? 0.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = 'road';
      group.add(mesh);
    }

    // 护栏 + 路基（外侧面延伸到路面下方，桥段看起来是实心的）
    {
      const th = 0.6, H = this.wallH, base = 1.6;
      const posW = [], uvW = [], idxW = [];
      const posD = [], idxD = [];
      const push = (arr, x, y, z) => arr.push(x, y, z);
      for (let side = -1; side <= 1; side += 2) {
        const startW = posW.length / 3;
        for (let r = 0; r < rows; r++) {
          const i = r % N;
          const sb = Math.sin(this.bank[i]);
          const latIn = side * hw, latOut = side * (hw + th);
          const yIn = this.py[i] + latIn * sb, yOut = this.py[i] + latOut * sb;
          const v = (side > 0 ? -1 : 1) * (r * this.ds) / WALL_TEX_LEN;
          // 内侧面 (底, 顶)
          push(posW, this.px[i] + this.rx[i] * latIn, yIn - 0.05, this.pz[i] + this.rz[i] * latIn);
          push(posW, this.px[i] + this.rx[i] * latIn, yIn + H, this.pz[i] + this.rz[i] * latIn);
          // 顶面外沿
          push(posW, this.px[i] + this.rx[i] * latOut, yOut + H, this.pz[i] + this.rz[i] * latOut);
          uvW.push(v, 0, v, 1, v, 1);
        }
        for (let r = 0; r < N; r++) {
          const a = startW + r * 3, b = a + 3;
          if (side < 0) {
            idxW.push(a, a + 1, b, b, a + 1, b + 1);
            idxW.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
          } else {
            idxW.push(a, b, a + 1, b, b + 1, a + 1);
            idxW.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
          }
        }
        // 外侧路基面
        const startD = posD.length / 3;
        for (let r = 0; r < rows; r++) {
          const i = r % N;
          const sb = Math.sin(this.bank[i]);
          const latOut = side * (hw + th);
          const yOut = this.py[i] + latOut * sb;
          push(posD, this.px[i] + this.rx[i] * latOut, yOut + H, this.pz[i] + this.rz[i] * latOut);
          push(posD, this.px[i] + this.rx[i] * latOut, this.py[i] - base, this.pz[i] + this.rz[i] * latOut);
        }
        for (let r = 0; r < N; r++) {
          const a = startD + r * 2, b = a + 2;
          if (side > 0) idxD.push(a, a + 1, b, b, a + 1, b + 1);
          else idxD.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      // 路基底面
      const startB = posD.length / 3;
      for (let r = 0; r < rows; r++) {
        const i = r % N;
        const l = -(hw + th), rr = hw + th;
        push(posD, this.px[i] + this.rx[i] * l, this.py[i] - base, this.pz[i] + this.rz[i] * l);
        push(posD, this.px[i] + this.rx[i] * rr, this.py[i] - base, this.pz[i] + this.rz[i] * rr);
      }
      for (let r = 0; r < N; r++) {
        const a = startB + r * 2, b = a + 2;
        idxD.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const gw = new THREE.BufferGeometry();
      gw.setAttribute('position', new THREE.Float32BufferAttribute(posW, 3));
      gw.setAttribute('uv', new THREE.Float32BufferAttribute(uvW, 2));
      gw.setIndex(idxW);
      gw.computeVertexNormals();
      const wm = new THREE.MeshStandardMaterial({ map: wallTexture(theme.wall), roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
      const wall = new THREE.Mesh(gw, wm);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
      const gd = new THREE.BufferGeometry();
      gd.setAttribute('position', new THREE.Float32BufferAttribute(posD, 3));
      gd.setIndex(idxD);
      gd.computeVertexNormals();
      const dm = new THREE.MeshStandardMaterial({ color: theme.deckColor || 0x9a9aa2, roughness: 0.9, side: THREE.DoubleSide });
      const deck = new THREE.Mesh(gd, dm);
      deck.receiveShadow = true;
      deck.castShadow = true;
      group.add(deck);
    }

    // 弯心路肩（红白）
    {
      const pos = [], uv = [], idx = [];
      const cw = 1.3;
      for (let side = -1; side <= 1; side += 2) {
        let run = null;
        const flush = () => {
          if (!run || run.length < 8) { run = null; return; }
          const start = pos.length / 3;
          for (let k = 0; k < run.length; k++) {
            const i = run[k];
            const sb = Math.sin(this.bank[i]);
            const l0 = side * (hw - cw), l1 = side * hw;
            pos.push(this.px[i] + this.rx[i] * l0, this.py[i] + l0 * sb + 0.035, this.pz[i] + this.rz[i] * l0);
            pos.push(this.px[i] + this.rx[i] * l1, this.py[i] + l1 * sb + 0.035, this.pz[i] + this.rz[i] * l1);
            const v = (k * this.ds) / 3.2;
            uv.push(side < 0 ? 1 : 0, v, side < 0 ? 0 : 1, v);
          }
          for (let k = 0; k < run.length - 1; k++) {
            const a = start + k * 2;
            if (side < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
          run = null;
        };
        for (let i = 0; i < N; i++) {
          // 左转 curv>0，弯心在左侧 (side=-1)
          const inner = this.curv[i] * -side > 0.011;
          if (inner) (run ||= []).push(i);
          else flush();
        }
        flush();
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.MeshStandardMaterial({
          map: curbTexture(theme.curbA, theme.curbB),
          roughness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    // 起终点线
    group.add(this.roadDecal(0, 0, hw * 2 - 0.6, 3.2, new THREE.MeshStandardMaterial({
      map: (() => { const t = checkerTexture(theme.checkerA || '#111', theme.checkerB || '#fff', 16, 2).clone(); t.needsUpdate = true; return t; })(),
      roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })));

    // 加速带
    this.boostPads = [];
    if (theme.boostPads) {
      const tex = boostPadTexture(theme.boostColor || '#27c7ff');
      for (const bp of theme.boostPads) {
        const d = bp.at ? this.dAt(bp.at[0], bp.at[1]) : bp.f * this.length;
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.8, 1.8, 1.8),
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          toneMapped: false,
        });
        const m = this.roadDecal(d, bp.lat || 0, 5, 11, mat);
        group.add(m);
        this.boostPads.push({ d, lat: bp.lat || 0, len: 11, halfW: 2.8, mat });
      }
    }

    // 隧道
    if (theme.tunnels)
      for (const tn of theme.tunnels) {
        let d0 = tn.from ? this.dAt(tn.from[0], tn.from[1]) : tn.f0 * this.length;
        let d1 = tn.to ? this.dAt(tn.to[0], tn.to[1]) : tn.f1 * this.length;
        if (d1 < d0) d1 += this.length;
        group.add(this.buildTunnel(d0, d1, theme));
      }

    // 路肩人行道（桥段不铺）
    if (theme.shoulder) group.add(this.buildShoulders(theme.shoulder));
    // 桥墩
    if (groundFn) group.add(this.buildPillars(groundFn, theme));

    this.group = group;
    return group;
  }

  // 贴在路面上的四边形（沿路跟随曲率，按采样细分）
  roadDecal(d, lat, width, length, material) {
    const segs = Math.max(2, Math.ceil(length / 1.5));
    const pos = [], uv = [], idx = [];
    const s = {};
    for (let k = 0; k <= segs; k++) {
      this.sample(d + (k / segs) * length - length / 2, s);
      const sb = Math.sin(s.bank);
      for (let e = 0; e < 2; e++) {
        const l = lat + (e ? width / 2 : -width / 2);
        pos.push(s.x + s.rx * l, s.y + l * sb + 0.05, s.z + s.rz * l);
        uv.push(e, k / segs);
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.material.side = THREE.DoubleSide;
    return m;
  }

  buildTunnel(d0, d1, theme) {
    const grp = new THREE.Group();
    const M = 14;
    const hw = this.halfW + 0.6;
    const hTop = theme.tunnelH || 9.5;
    const segs = Math.ceil((d1 - d0) / 3);
    const posI = [], uvI = [], posO = [], idx = [];
    const s = {};
    for (let k = 0; k <= segs; k++) {
      this.sample(d0 + ((d1 - d0) * k) / segs, s);
      for (let m = 0; m <= M; m++) {
        const a = Math.PI * (m / M);
        const lat = -Math.cos(a) * hw;
        const y = s.y + this.wallH + Math.sin(a) * (hTop - this.wallH);
        posI.push(s.x + s.rx * lat, y, s.z + s.rz * lat);
        uvI.push(m / M * 3, (k * 3) / 8);
        const lo = -Math.cos(a) * (hw + 2.5);
        posO.push(s.x + s.rx * lo, s.y + this.wallH + Math.sin(a) * (hTop + 2.5 - this.wallH) - (m === 0 || m === M ? 1.5 : 0), s.z + s.rz * lo);
      }
    }
    for (let k = 0; k < segs; k++)
      for (let m = 0; m < M; m++) {
        const a = k * (M + 1) + m, b = a + M + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const gi = new THREE.BufferGeometry();
    gi.setAttribute('position', new THREE.Float32BufferAttribute(posI, 3));
    gi.setAttribute('uv', new THREE.Float32BufferAttribute(uvI, 2));
    gi.setIndex(idx);
    gi.computeVertexNormals();
    const tt = tunnelTexture();
    const inner = new THREE.Mesh(gi, new THREE.MeshStandardMaterial({ map: tt, emissiveMap: tt, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8, side: THREE.DoubleSide }));
    inner.castShadow = true;
    grp.add(inner);
    const go = new THREE.BufferGeometry();
    go.setAttribute('position', new THREE.Float32BufferAttribute(posO, 3));
    go.setIndex(idx);
    go.computeVertexNormals();
    const outer = new THREE.Mesh(go, new THREE.MeshStandardMaterial({ color: theme.tunnelOuter ?? 0x8d8478, roughness: 1, side: THREE.DoubleSide }));
    outer.castShadow = true;
    outer.receiveShadow = true;
    grp.add(outer);
    // 洞口门框
    for (const dd of [d0, d1]) {
      this.sample(dd, s);
      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(hw + 1.2, 1.3, 8, 20, Math.PI),
        theme.portalMat || new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }),
      );
      frame.scale.set(1, (hTop - this.wallH + 1.2) / (hw + 1.2), 1);
      frame.position.set(s.x, s.y + this.wallH, s.z);
      frame.rotation.y = s.hd;
      frame.castShadow = true;
      grp.add(frame);
    }
    this.tunnels = this.tunnels || [];
    this.tunnels.push([d0, d1]);
    return grp;
  }

  dAt(x, z) {
    const n = this.nearest(x, z, 400);
    return n ? n.i * this.ds : 0;
  }

  buildShoulders(cfg) {
    const N = this.N, hw = this.halfW + 0.6, w = cfg.width;
    const pos = [], uv = [], idx = [];
    for (let side = -1; side <= 1; side += 2) {
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          const start = pos.length / 3;
          for (let k = 0; k < run.length; k++) {
            const i = run[k] % N;
            const sb = Math.sin(this.bank[i]);
            for (const l of [hw, hw + w]) {
              const lat = side * l;
              pos.push(this.px[i] + this.rx[i] * lat, this.py[i] + side * hw * sb - 0.02 - (l > hw ? 0.15 : 0), this.pz[i] + this.rz[i] * lat);
              uv.push((this.px[i] + this.rx[i] * lat) / 8, (this.pz[i] + this.rz[i] * lat) / 8);
            }
          }
          for (let k = 0; k < run.length - 1; k++) {
            const a = start + k * 2;
            if (side > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        run = [];
      };
      for (let r = 0; r <= N; r++) {
        const i = r % N;
        if (this.bridge[i]) flush();
        else run.push(r);
      }
      flush();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const t = groundTexture(cfg.tex);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }

  buildPillars(groundFn, theme) {
    const N = this.N;
    const mats = [];
    const step = 12;
    for (let i = 0; i < N; i += step) {
      const x = this.px[i], z = this.pz[i], y = this.py[i];
      const gy = groundFn(x, z);
      const top = y - 1.6;
      if (top - gy < 1.2) continue;
      // 立交处下方有另一段赛道时不放
      let blocked = false;
      this.forEachNear(x, z, this.halfW + 6, (j) => {
        const di = Math.abs(j - i);
        if (Math.min(di, N - di) > 40 && this.py[j] < y - 3) blocked = true;
      });
      if (blocked) continue;
      mats.push({ x, z, gy, top, hd: this.hd[i] });
    }
    const grp = new THREE.Group();
    if (!mats.length) return grp;
    const col = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: theme.deckColor || 0xaaaaaa, roughness: 0.9 }), mats.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let k = 0;
    for (const it of mats) {
      const h = it.top - it.gy + 0.5;
      e.set(0, it.hd, 0);
      q.setFromEuler(e);
      p.set(it.x, it.gy + h / 2 - 0.5, it.z);
      sc.set(3.2, h, 3.2);
      col.setMatrixAt(k++, m4.compose(p, q, sc));
      p.set(it.x, it.top - 0.5, it.z);
      sc.set(this.halfW * 1.7, 1.4, 3.6);
      col.setMatrixAt(k++, m4.compose(p, q, sc));
    }
    col.count = k;
    col.castShadow = true;
    col.receiveShadow = true;
    grp.add(col);
    return grp;
  }

  inTunnel(d) {
    if (!this.tunnels) return false;
    for (const [a, b] of this.tunnels) if ((d > a && d < b) || (d + this.length > a && d + this.length < b)) return true;
    return false;
  }
}
