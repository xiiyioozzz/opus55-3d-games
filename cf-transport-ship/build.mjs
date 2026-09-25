// 构建：esbuild 打包 -> 内联到单个 HTML
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !dev,
  sourcemap: false,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = res.outputFiles[0].text;
const tpl = fs.readFileSync('src/index.html', 'utf8');
const css = fs.readFileSync('src/style.css', 'utf8');
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script>/g, '<\\/script>'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
