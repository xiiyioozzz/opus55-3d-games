// 横屏 + 开场态检查：摇杆在 intro 期间必须隐藏，开始后 HUD 与摇杆不得重叠
import { chromium } from '/Users/bibiz/Documents/opus5.5demo/pelican-bike/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'dist');
const PORT = 8801;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

function rects(page, sels) {
  return page.evaluate((ss) => {
    const out = {};
    for (const s of ss) {
      const e = document.querySelector(s);
      if (!e) { out[s] = null; continue; }
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      const vis = st.display !== 'none' && st.visibility !== 'hidden' && +st.opacity > 0.05 && r.width > 0;
      out[s] = { vis, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  }, sels);
}
const ov = (a, b) => {
  if (!a?.vis || !b?.vis) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

for (const vp of [{ n: '横屏 750x342', width: 750, height: 342 }, { n: '竖屏 375x667', width: 375, height: 667 }]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1',
  });
  const page = await ctx.newPage();
  console.log(`\n=== ${vp.n} /pelican/ ===`);
  await page.goto(`http://127.0.0.1:${PORT}/pelican/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(3500);

  const pads = ['.touch .left', '.touch .right'];
  let r = await rects(page, [...pads, '#intro', '#startBtn']);
  console.log(`  intro 期间: intro.vis=${r['#intro']?.vis} left.vis=${r['.touch .left']?.vis} right.vis=${r['.touch .right']?.vis}`);
  if (r['#intro']?.vis && (r['.touch .left']?.vis || r['.touch .right']?.vis)) console.log('  ✗ 开场页仍显示摇杆');
  else console.log('  ✓ 开场页未显示摇杆');

  await page.click('#startBtn').catch(() => {});
  // #intro 退场有 opacity 过渡 + delay，等它真正 visibility:hidden 再量
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#intro')).visibility === 'hidden',
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const hud = ['.dash', '.score', '.tools', '.brand', '.cams'];
  r = await rects(page, [...pads, ...hud, '#intro']);
  console.log(`  开始后: intro.vis=${r['#intro']?.vis}`);
  for (const p of pads) {
    const b = r[p];
    console.log(`    ${p}: vis=${b?.vis} ${b ? `${b.x},${b.y} ${b.w}x${b.h}` : ''}`);
  }
  let bad = 0;
  for (const p of pads) for (const h of hud) {
    const a = ov(r[p], r[h]);
    if (a > 0) { console.log(`    ✗ ${p} × ${h} 重叠 ${a}px²`); bad++; }
  }
  for (const h of hud) {
    const b = r[h];
    if (b?.vis && (b.x < 0 || b.y < 0 || b.x + b.w > vp.width || b.y + b.h > vp.height)) {
      console.log(`    ✗ ${h} 出界 ${b.x},${b.y} ${b.w}x${b.h}`); bad++;
    }
  }
  if (!bad) console.log('    ✓ 摇杆与 HUD 无重叠、HUD 未出界');
  await page.screenshot({ path: `/tmp/pelican-${vp.width}x${vp.height}.png` });
  await ctx.close();
}
await browser.close();
server.close();
