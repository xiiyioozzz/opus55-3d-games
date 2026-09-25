// 用无头浏览器加载 dist/ 下四个页面，检查报错与渲染
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
await new Promise((r) => server.listen(8799, r));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;

for (const route of ['/', '/pelican/', '/transport-ship/', '/qq-speed/']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });

  await page.goto(`https://games.xdullboy.com${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(route === '/' ? 1200 : 6000);

  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.href)
      .filter((h) => /github\.com|x\.com/.test(h));
    return {
      title: document.title,
      canvas: c ? `${c.width}x${c.height}` : null,
      bodyLen: document.body.innerText.trim().length,
      links: [...new Set(links)],
    };
  });

  const shot = `/tmp/smoke-${route.replace(/\//g, '_') || 'root'}.png`;
  await page.screenshot({ path: shot });
  const bad = errors.filter((e) => !/favicon|AudioContext|autoplay|user gesture|WebGL-|Automatic fallback/i.test(e));
  if (bad.length) failures++;
  console.log(`\n${route}`);
  console.log(`  title : ${info.title}`);
  console.log(`  canvas: ${info.canvas ?? '(none — landing page)'}`);
  console.log(`  text  : ${info.bodyLen} chars`);
  console.log(`  links : ${info.links.join(', ') || '(none)'}`);
  console.log(`  errors: ${bad.length ? bad.slice(0, 4).join(' | ') : 'none'}`);
  console.log(`  shot  : ${shot}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'ALL PAGES OK' : `${failures} page(s) with errors`}`);
process.exit(failures === 0 ? 0 : 1);
