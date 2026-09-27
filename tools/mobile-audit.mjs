// 移动端审计：区分横向溢出(真 bug)与纵向滚动(正常)
import { chromium, devices } from '/Users/bibiz/Documents/opus5.5demo/pelican-bike/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/bibiz/Documents/opus5.5demo/dist';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8795, r));

const AUDIT = `(() => {
  const MIN = 44;
  const vw = innerWidth, vh = innerHeight;
  const sel = 'button,a[href],[role=button],.tbtn,.opt,.map,.skin,.icon-btn';
  const vis = [...document.querySelectorAll(sel)].filter(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05;
  });
  const desc = e => {
    const id = e.id ? '#' + e.id : '';
    const cl = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    const t = (e.textContent || '').trim().replace(/\\s+/g,' ').slice(0,14);
    return (e.tagName.toLowerCase() + id + cl + (t ? '[' + t + ']' : '')).slice(0, 50);
  };
  // 只统计当前可见(未被滚动掉)的元素的重叠，避免拿折叠线外的元素凑数
  const inView = vis.filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
  const small = [], exempt = [], hoff = [], overlap = [];
  // WCAG 2.2 SC 2.5.8 的 Inline 例外：目标位于句子/文本块内的行内链接不受 24/44px 最小尺寸约束
  const isInlineTextLink = (e) => {
    if (e.tagName !== 'A') return false;
    if (getComputedStyle(e).display !== 'inline') return false;
    const p = e.parentElement;
    if (!p) return false;
    // 父元素里除该链接外还有实际文字 → 它嵌在句子中
    return p.textContent.replace(e.textContent, '').trim().length > 0;
  };
  for (const e of vis) {
    const r = e.getBoundingClientRect();
    if (r.width < MIN || r.height < MIN) {
      const rec = { el: desc(e), w: Math.round(r.width), h: Math.round(r.height) };
      (isInlineTextLink(e) ? exempt : small).push(rec);
    }
    if (r.right > vw + 1 || r.left < -1) hoff.push({ el: desc(e), x: Math.round(r.left), r: Math.round(r.right) });
  }
  for (let i = 0; i < inView.length; i++) for (let j = i + 1; j < inView.length; j++) {
    const a = inView[i], b = inView[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 4 && oy > 4) overlap.push({ a: desc(a), b: desc(b), area: Math.round(ox * oy) });
  }
  const de = document.documentElement;
  return { vw, vh, visible: vis.length, small, exempt, hoff, overlap: overlap.slice(0, 10),
    hScroll: Math.max(0, de.scrollWidth - vw), bodyOverflowX: getComputedStyle(document.body).overflowX };
})()`;

const ROUTES = ['/', '/pelican/', '/transport-ship/', '/qq-speed/'];
const VIEWPORTS = [
  { name: 'iPhone SE 375x667', dev: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent } },
  { name: 'iPhone 13 landscape', dev: devices['iPhone 13 landscape'] },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const vp of VIEWPORTS) {
  console.log(`\n${'#'.repeat(60)}\n# ${vp.name}\n${'#'.repeat(60)}`);
  for (const route of ROUTES) {
    const ctx = await browser.newContext({ ...vp.dev });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:8795${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(route === '/' ? 1200 : 6500);
    const r = await page.evaluate(AUDIT);
    console.log(`\n  ${route}  ${r.vw}x${r.vh}  可点 ${r.visible}`);
    if (r.hScroll) console.log(`    [横向溢出] 文档宽出 ${r.hScroll}px (body.overflowX=${r.bodyOverflowX})`);
    if (r.hoff.length) {
      console.log(`    [横向越界] x${r.hoff.length}:`);
      for (const o of r.hoff.slice(0, 5)) console.log(`       ${o.el}  x${o.x}..${o.r}  (视口 ${r.vw})`);
    }
    if (r.overlap.length) {
      console.log(`    [同屏重叠] x${r.overlap.length}:`);
      for (const o of r.overlap.slice(0, 5)) console.log(`       ${o.a} <-> ${o.b}  ${o.area}px²`);
    }
    if (r.small.length) console.log(`    [过小可点区 <44px] x${r.small.length}: ${r.small.slice(0,5).map(s=>`${s.el} ${s.w}x${s.h}`).join(' | ')}`);
    if (r.exempt.length) console.log(`    [行内文字链接 · WCAG 2.5.8 Inline 例外] x${r.exempt.length}: ${r.exempt.slice(0,5).map(s=>`${s.el} ${s.w}x${s.h}`).join(' | ')}`);
    if (!r.hScroll && !r.hoff.length && !r.overlap.length && !r.small.length) console.log('    ok');
    await ctx.close();
  }
}

await browser.close();
server.close();
