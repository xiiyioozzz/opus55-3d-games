// 触屏控制：左侧虚拟摇杆移动，右侧滑动视角，按钮开火/跳/蹲/换弹/切枪/开镜
export class TouchControls {
  constructor(game) {
    this.g = game;
    this.enabled = matchMedia('(pointer:coarse)').matches || new URLSearchParams(location.search).has('touch');
    if (!this.enabled) return;
    const root = document.getElementById('touch');
    root.classList.remove('hidden');
    const W = () => window.innerWidth, H = () => window.innerHeight;
    const pad = document.createElement('div'); pad.className = 'pad';
    const knob = document.createElement('div'); knob.className = 'pad';
    Object.assign(knob.style, { width: '56px', height: '56px', background: 'rgba(255,255,255,.25)', pointerEvents: 'none' });
    root.append(pad, knob);
    const place = () => {
      Object.assign(pad.style, { left: '28px', bottom: '40px', width: '140px', height: '140px' });
      Object.assign(knob.style, { left: '70px', bottom: '82px' });
    };
    place(); window.addEventListener('resize', place);
    const btn = (label, right, bottom, size, fn, up) => {
      const b = document.createElement('div'); b.className = 'btn'; b.textContent = label;
      Object.assign(b.style, { right: right + 'px', bottom: bottom + 'px', width: size + 'px', height: size + 'px' });
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      if (up) b.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
      root.appendChild(b); return b;
    };
    const P = () => this.g.player;
    btn('开火', 40, 150, 84, () => { const p = P(); if (p) { p.touch.fire = true; p.touch.firePressed = true; } }, () => { const p = P(); if (p) p.touch.fire = false; });
    btn('开火', W() - 250, 250, 64, () => { const p = P(); if (p) { p.touch.fire = true; p.touch.firePressed = true; } }, () => { const p = P(); if (p) p.touch.fire = false; });
    btn('跳', 140, 60, 60, () => { const p = P(); if (p) p.touch.jump = true; });
    btn('蹲', 210, 40, 54, () => { const p = P(); if (p) p.touch.crouch = !p.touch.crouch; });
    btn('R', 40, 250, 50, () => { const p = P(); if (p) p.pressed.add('KeyR'); });
    btn('切', 100, 250, 50, () => { const p = P(); if (p) p.pressed.add('KeyQ'); });
    btn('镜', 40, 60, 60, () => { const p = P(); if (p) { p.mouse.rp = true; } });
    // 摇杆
    let padId = null, cx = 0, cy = 0, lookId = null, lx = 0, ly = 0;
    window.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < W() * 0.4 && padId === null) { padId = t.identifier; const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
        else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      const p = P();
      for (const t of e.changedTouches) {
        if (t.identifier === padId && p) {
          let dx = t.clientX - cx, dy = t.clientY - cy; const L = Math.hypot(dx, dy), m = 60;
          if (L > m) { dx *= m / L; dy *= m / L; }
          knob.style.left = (70 + dx) + 'px'; knob.style.bottom = (82 - dy) + 'px';
          p.touch.mx = dx / m; p.touch.mz = -dy / m;
        } else if (t.identifier === lookId && p) {
          p.touchLook = p.touchLook || { x: 0, y: 0 };
          p.touchLook.x += (t.clientX - lx) * 1.6; p.touchLook.y += (t.clientY - ly) * 1.6;
          lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      const p = P();
      for (const t of e.changedTouches) {
        if (t.identifier === padId) { padId = null; knob.style.left = '70px'; knob.style.bottom = '82px'; if (p) { p.touch.mx = 0; p.touch.mz = 0; } }
        if (t.identifier === lookId) lookId = null;
      }
    };
    window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
  }
}
