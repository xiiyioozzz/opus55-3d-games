// 桌面视口：确认浮动链接在菜单展开时隐藏、进入游戏后恢复
import { chromium } from '/Users/bibiz/Documents/opus5.5demo/pelican-bike/node_modules/playwright-core/index.mjs';
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
await new Promise((r) => server.listen(8796, r));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// qq-speed: menu up -> clinks hidden; race started -> clinks visible
await page.goto('http://127.0.0.1:8796/qq-speed/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(6000);
const menuUp = await page.locator('#clinks').isVisible();
const mlinksUp = await page.locator('#menu .mlinks a').first().isVisible();
console.log(`qq-speed desktop, menu open : #clinks visible=${menuUp}  (.mlinks visible=${mlinksUp})`);

await page.locator('#startBtn, .start, button:has-text("开始比赛")').first().click().catch(async () => {
  await page.keyboard.press('Enter');
});
await page.waitForTimeout(9000);
const racing = await page.locator('#clinks').isVisible();
const menuHidden = await page.locator('#menu').evaluate((e) => e.classList.contains('hidden')).catch(() => null);
console.log(`qq-speed desktop, race start: #clinks visible=${racing}  (#menu.hidden=${menuHidden})`);
await page.screenshot({ path: '/tmp/desk-qq-racing.png' });

// pelican desktop: tools links still present
await page.goto('http://127.0.0.1:8796/pelican/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(6000);
const pTools = await page.locator('.tools a.icon-btn').count();
const pVis = await page.locator('.tools a.icon-btn').first().isVisible();
console.log(`pelican desktop: .tools link buttons=${pTools} visible=${pVis}`);

await browser.close();
server.close();
