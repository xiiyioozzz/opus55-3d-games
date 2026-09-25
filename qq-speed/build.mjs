import * as esbuild from 'esbuild';
import fs from 'fs';

const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: process.argv.includes('--dev') ? false : true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8').replace('<!--APP_SCRIPT-->', () => `<script>${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
