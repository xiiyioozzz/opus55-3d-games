// 构建三个游戏并汇总到 dist/ 供 Cloudflare Pages 部署
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECTS = [
  { dir: 'pelican-bike', route: 'pelican' },
  { dir: 'cf-transport-ship', route: 'transport-ship' },
  { dir: 'qq-speed', route: 'qq-speed' },
];

const root = import.meta.dirname;
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const { dir, route } of PROJECTS) {
  const cwd = path.join(root, dir);
  if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
    console.log(`\n[${dir}] npm install`);
    execSync('npm install --no-audit --no-fund', { cwd, stdio: 'inherit' });
  }
  console.log(`\n[${dir}] node build.mjs`);
  execSync('node build.mjs', { cwd, stdio: 'inherit' });

  const src = path.join(cwd, 'dist', 'index.html');
  if (!fs.existsSync(src)) throw new Error(`${dir}: dist/index.html 未生成`);
  const dest = path.join(out, route);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(src, path.join(dest, 'index.html'));
  console.log(`[${dir}] -> dist/${route}/index.html`);
}

fs.copyFileSync(path.join(root, 'site', 'index.html'), path.join(out, 'index.html'));
console.log('\nsite/index.html -> dist/index.html');

const list = (dir, prefix = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) list(p, `${prefix}${e.name}/`);
    else console.log(`  ${prefix}${e.name}  ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
  }
};
console.log('\ndist/:');
list(out);
