// 键位：尽量还原 QQ飞车端游默认键位
// ↑↓←→ 驾驶 · Shift 漂移 · Ctrl 氮气/道具 · ↑(出弯点按) 或 W 小喷 · Alt 道具换位 · R 复位
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'AltLeft', 'AltRight', 'PageUp', 'PageDown', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyW', 'KeyR']);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.touch = { up: false, down: false, left: false, right: false, shift: false };
    this.touchPressed = new Set();
    this.onKey = null; // 非驾驶类按键回调（暂停、视角等）
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyR')) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (this.onKey) this.onKey(e.code, e);
      }
      this.down.add(e.code);
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  has(...codes) { return codes.some((c) => this.down.has(c)); }
  was(...codes) { return codes.some((c) => this.pressed.has(c) || this.touchPressed.has(c)); }

  // 每帧生成一次驾驶输入（边沿触发量只在本帧有效）
  frame() {
    const t = this.touch;
    const inp = {
      up: this.has('ArrowUp') || t.up,
      down: this.has('ArrowDown') || t.down,
      left: this.has('ArrowLeft') || t.left,
      right: this.has('ArrowRight') || t.right,
      shift: this.has('ShiftLeft', 'ShiftRight') || t.shift,
      upPressed: this.was('ArrowUp', 'TouchBoost'),
      wPressed: this.was('KeyW'),
      nitroPressed: this.was('ControlLeft', 'ControlRight', 'Space', 'TouchNitro'),
      swapPressed: this.was('AltLeft', 'AltRight', 'TouchSwap'),
      resetPressed: this.was('KeyR'),
    };
    this.pressed.clear();
    this.touchPressed.clear();
    return inp;
  }

  // 触屏按钮
  bindTouch(root) {
    const btn = (sel, key, edge) => {
      const el = root.querySelector(sel);
      if (!el) return;
      const on = (e) => {
        e.preventDefault();
        el.classList.add('on');
        if (key) this.touch[key] = true;
        if (edge) this.touchPressed.add(edge);
      };
      const off = (e) => {
        e.preventDefault();
        el.classList.remove('on');
        if (key) this.touch[key] = false;
      };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
    };
    btn('#t-left', 'left');
    btn('#t-right', 'right');
    btn('#t-drift', 'shift');
    btn('#t-brake', 'down');
    btn('#t-nitro', null, 'TouchNitro');
    btn('#t-boost', null, 'TouchBoost');
    btn('#t-swap', null, 'TouchSwap');
  }
}
