// 入口
import { Game } from './game.js';

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const el = document.getElementById('loadTxt');
  if (el) el.textContent = '加载失败：' + (e && e.message ? e.message : e) + '（请使用最新版 Chrome / Edge / Safari）';
});
