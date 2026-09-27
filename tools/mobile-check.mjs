// 手机视口下检查浮动链接按钮是否与其他 UI 重叠
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
await new Promise((r) => server.listen(8797, r));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const ROUTES = [
  { route: '/pelican/', float: '.tools', other: ['.brand', '.cams'] },
  { route: '/transport-ship/', float: '#clinks', other: ['#hud', '.topbar', '#crosshair'] },
  { route: '/qq-speed/', float: '#clinks', other: ['.logo', '.sub', '#menu .mlinks'] },
];

const overlaps = (a, b) =>
  a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

for (const { route, float, other } of ROUTES) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:8797${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(6000);

  const fb = await page.locator(float).first().boundingBox().catch(() => null);
  const vis = await page.locator(float).first().isVisible().catch(() => false);
  console.log(`\n${route}  (iPhone 13, 390x664)`);
  console.log(`  ${float}: visible=${vis} box=${fb ? `${Math.round(fb.x)},${Math.round(fb.y)} ${Math.round(fb.width)}x${Math.round(fb.height)}` : 'none'}`);

  for (const sel of other) {
    const ob = await page.locator(sel).first().boundingBox().catch(() => null);
    if (!ob) { console.log(`  vs ${sel}: (absent)`); continue; }
    const hit = overlaps(fb, ob);
    console.log(`  vs ${sel}: ${hit ? '*** OVERLAP ***' : 'ok'}  (${Math.round(ob.x)},${Math.round(ob.y)} ${Math.round(ob.width)}x${Math.round(ob.height)})`);
  }

  // count duplicate github/x links visible at once
  const dup = await page.evaluate(() => {
    const as = [...document.querySelectorAll('a[href]')].filter((a) => /github\.com|x\.com/.test(a.href));
    const visible = as.filter((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== 'hidden' && getComputedStyle(a).display !== 'none';
    });
    return { total: as.length, visible: visible.length };
  });
  console.log(`  github/x links: ${dup.total} in DOM, ${dup.visible} visible simultaneously`);

  await page.screenshot({ path: `/tmp/mob${route.replace(/\//g, '_')}.png` });
  await ctx.close();
}

await browser.close();
server.close();
