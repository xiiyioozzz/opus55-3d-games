// 碰撞世界：所有静态碰撞体都是绕 Y 轴旋转的 OBB
// 约定：three.js rotation.y = yaw，local->world: (x,z) -> (c*x + s*z, -s*x + c*z)

export class Collider {
  constructor(o) {
    this.x = o.x; this.y = o.y; this.z = o.z; // 中心
    this.hx = o.sx / 2; this.hy = o.sy / 2; this.hz = o.sz / 2;
    this.yaw = o.yaw || 0;
    this.c = Math.cos(this.yaw); this.s = Math.sin(this.yaw);
    this.mat = o.mat || 'metal';            // 命中材质：metal | wood | mesh | concrete
    this.solid = o.solid !== false;         // 是否阻挡移动
    this.bullet = o.bullet || 'block';      // block | pass | pen(可穿透)
    this.sight = o.sight !== false;         // 是否阻挡视线
    this.surface = o.surface || (this.mat === 'wood' ? 'wood' : 'metal'); // 脚步声
    this.top = this.y + this.hy; this.bottom = this.y - this.hy;
    const ex = Math.abs(this.c) * this.hx + Math.abs(this.s) * this.hz;
    const ez = Math.abs(this.s) * this.hx + Math.abs(this.c) * this.hz;
    this.minX = this.x - ex; this.maxX = this.x + ex;
    this.minZ = this.z - ez; this.maxZ = this.z + ez;
    this.stamp = 0;
    this.tag = o.tag || '';
  }
  // 世界 -> 局部（XZ）
  toLocal(wx, wz) {
    const dx = wx - this.x, dz = wz - this.z;
    return [this.c * dx - this.s * dz, this.s * dx + this.c * dz];
  }
  toWorldDir(lx, lz) { return [this.c * lx + this.s * lz, -this.s * lx + this.c * lz]; }
}

const CELL = 4;

export class World {
  constructor() {
    this.colliders = [];
    this.grid = new Map();
    this.stamp = 1;
    this._cand = [];
  }
  add(o) {
    const c = o instanceof Collider ? o : new Collider(o);
    this.colliders.push(c);
    return c;
  }
  build() {
    this.grid.clear();
    for (const c of this.colliders) {
      const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
      const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 1000 + z;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(c);
      }
    }
  }
  query(minX, minZ, maxX, maxZ) {
    const out = this._cand; out.length = 0;
    const st = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(x * 1000 + z);
      if (!arr) continue;
      for (const c of arr) {
        if (c.stamp === st) continue;
        c.stamp = st;
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        out.push(c);
      }
    }
    return out;
  }

  // 射线 vs 单个 OBB，返回 t 与局部法线
  static rayOBB(c, ox, oy, oz, dx, dy, dz, maxT, res) {
    const rx = ox - c.x, rz = oz - c.z;
    const lox = c.c * rx - c.s * rz, loz = c.s * rx + c.c * rz, loy = oy - c.y;
    const ldx = c.c * dx - c.s * dz, ldz = c.s * dx + c.c * dz, ldy = dy;
    let tmin = 0, tmax = maxT, axis = -1, sign = 0;
    // X
    if (Math.abs(ldx) < 1e-9) { if (lox < -c.hx || lox > c.hx) return false; }
    else {
      let t1 = (-c.hx - lox) / ldx, t2 = (c.hx - lox) / ldx, sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(ldy) < 1e-9) { if (loy < -c.hy || loy > c.hy) return false; }
    else {
      let t1 = (-c.hy - loy) / ldy, t2 = (c.hy - loy) / ldy, sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (Math.abs(ldz) < 1e-9) { if (loz < -c.hz || loz > c.hz) return false; }
    else {
      let t1 = (-c.hz - loz) / ldz, t2 = (c.hz - loz) / ldz, sg = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = sg; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (axis < 0) { // 起点在盒内
      res.t = 0; res.exit = tmax; res.nx = -dx; res.ny = -dy; res.nz = -dz; return true;
    }
    res.t = tmin; res.exit = tmax;
    let lnx = 0, lny = 0, lnz = 0;
    if (axis === 0) lnx = sign; else if (axis === 1) lny = sign; else lnz = sign;
    res.nx = c.c * lnx + c.s * lnz; res.ny = lny; res.nz = -c.s * lnx + c.c * lnz;
    return true;
  }

  // 射线检测。filter: 'move' | 'bullet' | 'sight'
  // 返回最近命中 {t, nx,ny,nz, collider, exit}
  raycast(ox, oy, oz, dx, dy, dz, maxT, mode = 'bullet', out = {}) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const cands = this.query(Math.min(ox, ex) - 0.1, Math.min(oz, ez) - 0.1, Math.max(ox, ex) + 0.1, Math.max(oz, ez) + 0.1);
    let best = maxT, hit = null;
    const r = this._r || (this._r = {});
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (mode === 'bullet' && c.bullet === 'pass') continue;
      if (mode === 'sight' && !c.sight) continue;
      if (mode === 'move' && !c.solid) continue;
      if (World.rayOBB(c, ox, oy, oz, dx, dy, dz, best, r) && r.t < best) {
        best = r.t; hit = c;
        out.nx = r.nx; out.ny = r.ny; out.nz = r.nz; out.exit = r.exit;
      }
    }
    if (!hit) return null;
    out.t = best; out.collider = hit;
    return out;
  }

  // 返回沿射线所有命中（按 t 排序），用于穿透
  raycastAll(ox, oy, oz, dx, dy, dz, maxT) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const cands = this.query(Math.min(ox, ex) - 0.1, Math.min(oz, ez) - 0.1, Math.max(ox, ex) + 0.1, Math.max(oz, ez) + 0.1);
    const hits = [];
    const r = {};
    for (const c of cands) {
      if (c.bullet === 'pass') continue;
      if (World.rayOBB(c, ox, oy, oz, dx, dy, dz, maxT, r)) hits.push({ t: r.t, exit: r.exit, nx: r.nx, ny: r.ny, nz: r.nz, collider: c });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  // 圆（XZ）与 OBB 的最近点关系
  static circleOBB(c, px, pz, r, out) {
    const [lx, lz] = c.toLocal(px, pz);
    const qx = Math.max(-c.hx, Math.min(c.hx, lx));
    const qz = Math.max(-c.hz, Math.min(c.hz, lz));
    const dx = lx - qx, dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      const [wx, wz] = c.toWorldDir(dx / d, dz / d);
      out.nx = wx; out.nz = wz; out.pen = r - d;
    } else {
      const px2 = c.hx - Math.abs(lx), pz2 = c.hz - Math.abs(lz);
      let lnx = 0, lnz = 0, pen;
      if (px2 < pz2) { lnx = lx >= 0 ? 1 : -1; pen = px2 + r; } else { lnz = lz >= 0 ? 1 : -1; pen = pz2 + r; }
      const [wx, wz] = c.toWorldDir(lnx, lnz);
      out.nx = wx; out.nz = wz; out.pen = pen;
    }
    return true;
  }

  // 判断胶囊空间是否被占用（用于站起/上台阶检查）
  blocked(px, py, pz, r, h) {
    const cands = this.query(px - r, pz - r, px + r, pz + r);
    const o = {};
    for (const c of cands) {
      if (!c.solid) continue;
      if (c.top <= py + 0.001 || c.bottom >= py + h - 0.001) continue;
      if (World.circleOBB(c, px, pz, r, o)) return true;
    }
    return false;
  }

  // 脚下最高支撑面（top <= maxY），返回 {y, collider}
  support(px, pz, r, maxY) {
    const cands = this.query(px - r, pz - r, px + r, pz + r);
    let best = -Infinity, bc = null;
    const o = {};
    for (const c of cands) {
      if (!c.solid) continue;
      if (c.top > maxY || c.top <= best) continue;
      if (World.circleOBB(c, px, pz, r, o)) { best = c.top; bc = c; }
    }
    return bc ? { y: best, collider: bc } : null;
  }

  // 角色移动：ent {pos:{x,y,z}(脚底), vel, radius, height, onGround, stepHeight}
  move(ent, dt) {
    const vx = ent.vel.x, vy = ent.vel.y, vz = ent.vel.z;
    const dist = Math.hypot(vx, vy, vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.12));
    const h = dt / n;
    const o = {};
    const r = ent.radius;
    let landed = false, landSpeed = 0;
    for (let s = 0; s < n; s++) {
      const p = ent.pos;
      // 水平
      p.x += ent.vel.x * h; p.z += ent.vel.z * h;
      for (let it = 0; it < 3; it++) {
        const cands = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
        let any = false;
        for (const c of cands) {
          if (!c.solid) continue;
          const head = p.y + ent.height;
          if (c.top <= p.y + 0.001 || c.bottom >= head - 0.001) continue;
          if (!World.circleOBB(c, p.x, p.z, r, o)) continue;
          // 上台阶
          const rise = c.top - p.y;
          if (ent.onGround && rise > 0 && rise <= ent.stepHeight && !this.blocked(p.x, c.top, p.z, r * 0.95, ent.height)) {
            p.y = c.top; ent.stepped = (ent.stepped || 0) + rise; any = true; continue;
          }
          p.x += o.nx * (o.pen + 0.0005); p.z += o.nz * (o.pen + 0.0005);
          const vn = ent.vel.x * o.nx + ent.vel.z * o.nz;
          if (vn < 0) { ent.vel.x -= o.nx * vn; ent.vel.z -= o.nz * vn; }
          any = true;
        }
        if (!any) break;
      }
      // 垂直
      const prevY = p.y;
      p.y += ent.vel.y * h;
      if (ent.vel.y <= 0) {
        const probeUp = ent.onGround ? ent.stepHeight : 0.001;
        const sup = this.support(p.x, p.z, r * 0.92, prevY + 0.001);
        const snap = ent.onGround && ent.vel.y <= 0.01 ? Math.max(0.3, -ent.vel.y * h) : 0;
        if (sup && p.y <= sup.y + snap) {
          if (!ent.onGround) { landed = true; landSpeed = -ent.vel.y; }
          p.y = sup.y; ent.vel.y = 0; ent.onGround = true; ent.ground = sup.collider;
        } else {
          ent.onGround = false; ent.ground = null;
        }
        void probeUp;
      } else {
        ent.onGround = false; ent.ground = null;
        // 顶头
        const cands = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
        for (const c of cands) {
          if (!c.solid) continue;
          const headPrev = prevY + ent.height, head = p.y + ent.height;
          if (c.bottom >= headPrev - 0.01 && c.bottom < head && World.circleOBB(c, p.x, p.z, r * 0.9, o)) {
            p.y = c.bottom - ent.height - 0.001; ent.vel.y = 0;
          }
        }
      }
    }
    ent.landed = landed; ent.landSpeed = landSpeed;
  }
}

// ============== 寻路网格（地面层） ==============
export class NavGrid {
  constructor(world, x0, z0, x1, z1, cell, agentR) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.w = Math.ceil((x1 - x0) / cell); this.h = Math.ceil((z1 - z0) / cell);
    this.block = new Uint8Array(this.w * this.h);
    this.cost = new Float32Array(this.w * this.h);
    const o = {};
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
      const cands = world.query(cx - agentR - 0.3, cz - agentR - 0.3, cx + agentR + 0.3, cz + agentR + 0.3);
      let b = 0, near = 0;
      for (const c of cands) {
        if (!c.solid) continue;
        if (c.bottom > 1.7 || c.top < 0.36) continue;
        if (World.circleOBB(c, cx, cz, agentR, o)) { b = 1; break; }
        if (World.circleOBB(c, cx, cz, agentR + 0.45, o)) near = 1;
      }
      this.block[j * this.w + i] = b;
      this.cost[j * this.w + i] = near ? 1.6 : 1;
    }
    // 屋顶检查：头顶过低（< 2m）的格子也不可走
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      if (this.block[j * this.w + i]) continue;
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
      if (world.blocked(cx, 0.4, cz, agentR * 0.8, 1.4)) this.block[j * this.w + i] = 1;
    }
    this.open = new Int32Array(this.w * this.h);
    this.g = new Float32Array(this.w * this.h);
    this.f = new Float32Array(this.w * this.h);
    this.parent = new Int32Array(this.w * this.h);
    this.seen = new Uint32Array(this.w * this.h);
    this.closed = new Uint32Array(this.w * this.h);
    this.gen = 1;
  }
  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  center(k) { return [this.x0 + ((k % this.w) + 0.5) * this.cell, this.z0 + (((k / this.w) | 0) + 0.5) * this.cell]; }
  walkable(k) { return k >= 0 && !this.block[k]; }
  nearestFree(k) {
    if (this.walkable(k)) return k;
    const i0 = k % this.w, j0 = (k / this.w) | 0;
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const kk = j * this.w + i; if (!this.block[kk]) return kk;
    }
    return -1;
  }
  // 网格视线（Bresenham 采样）
  lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const k = this.idx(ax + (bx - ax) * t, az + (bz - az) * t);
      if (k < 0 || this.block[k]) return false;
    }
    return true;
  }
  findPath(ax, az, bx, bz) {
    let s = this.idx(ax, az), e = this.idx(bx, bz);
    if (s < 0 || e < 0) return null;
    s = this.nearestFree(s); e = this.nearestFree(e);
    if (s < 0 || e < 0) return null;
    const gen = ++this.gen;
    const W = this.w;
    const heap = []; // 二叉堆存 idx
    const g = this.g, f = this.f;
    const push = (k) => {
      heap.push(k); let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const ex = e % W, ez = (e / W) | 0;
    const hfn = (k) => { const dx = Math.abs(k % W - ex), dz = Math.abs(((k / W) | 0) - ez); return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)); };
    g[s] = 0; f[s] = hfn(s); this.seen[s] = gen; this.parent[s] = -1; push(s);
    let found = false, iter = 0;
    while (heap.length && iter++ < 20000) {
      const k = pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === e) { found = true; break; }
      const ki = k % W, kj = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ki + di, nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (this.block[nk] || this.closed[nk] === gen) continue;
        if (di && dj && (this.block[kj * W + ni] || this.block[nj * W + ki])) continue;
        const ng = g[k] + (di && dj ? 1.4142 : 1) * this.cost[nk];
        if (this.seen[nk] !== gen || ng < g[nk]) {
          this.seen[nk] = gen; g[nk] = ng; f[nk] = ng + hfn(nk); this.parent[nk] = k; push(nk);
        }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = e; k !== -1; k = this.parent[k]) raw.push(this.center(k));
    raw.reverse();
    raw[raw.length - 1] = [bx, bz];
    // 拉直
    const out = [raw[0]];
    let a = 0;
    while (a < raw.length - 1) {
      let b = raw.length - 1;
      while (b > a + 1 && !this.lineFree(raw[a][0], raw[a][1], raw[b][0], raw[b][1])) b--;
      out.push(raw[b]); a = b;
    }
    return out;
  }
  randomFree(rnd, x0, z0, x1, z1) {
    for (let t = 0; t < 60; t++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      const k = this.idx(x, z);
      if (this.walkable(k)) return [x, z];
    }
    return null;
  }
}
