<h1 align="center">3D Web Games</h1>

<p align="center">
  <b>三个可玩的 3D 网页游戏 —— Three.js 实时渲染，单文件 HTML</b>
  <br />
  模型、纹理、动画、音效全部由代码程序化生成，不引用任何图片、音频或第三方素材。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Three.js-r186-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js r186" />
  <img src="https://img.shields.io/badge/esbuild-%E2%89%A50.28-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black" alt="esbuild" />
  <a href="https://pages.cloudflare.com/"><img src="https://img.shields.io/badge/部署-Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages" /></a>
</p>

<p align="center">
  <a href="#三个游戏">三个游戏</a> ·
  <a href="#在线体验">在线体验</a> ·
  <a href="#本地构建">本地构建</a> ·
  <a href="#部署">部署</a> ·
  <a href="#仓库结构">仓库结构</a>
</p>

---

## 三个游戏

| 游戏 | 类型 | 源码目录 | 模块数 | 构建产物 | 路由 |
| --- | --- | --- | --- | --- | --- |
| 🚲 鹈鹕骑单车 | 海岸公路休闲骑行 | `pelican-bike/` | 11 个 JS 模块 | ~800 KB | `/pelican/` |
| 🔫 运输船 | FPS 团队枪战 | `cf-transport-ship/` | 18 个 JS 模块 + HTML/CSS | ~840 KB | `/transport-ship/` |
| 🏎️ 飞车 3D | 竞速漂移 | `qq-speed/` | 15 个 JS 模块 + HTML | ~700 KB | `/qq-speed/` |

三个游戏全部是单文件 HTML（esbuild 打包内联），无运行时外部依赖。

### 🚲 鹈鹕骑单车

戴头盔墨镜、脖子系红围巾的鹈鹕在海岸公路上骑车抓鱼。围巾是布料物理模拟，昼夜循环从黄昏到星空月夜，海面有波浪与岸边碎浪。

`W`/`S` 加减速、`A`/`D` 变道抓鱼、`空格` 跳跃、`T` 展翅抬前轮；14 个成就、5 种镜头（含电影运镜和鹈鹕视角）、浏览器实时合成的音效音乐（节奏跟随踏频）、触屏按钮与按帧率自适应画质。不操作时它会自动驾驶去追鱼。

### 🔫 运输船

长条形甲板、两端船舱出生点、中部 V 形斜放集装箱、两侧单向管道的经典对称地图。完整的 FPS 玩法：枪械弹道与后坐力、bots AI 对战、命中反馈与击杀播报、程序化合成的枪声与音效、触屏支持。

### 🏎️ 飞车 3D

`Shift` 漂移、`Ctrl` 氮气、小喷与双喷、复位键。内置四张赛道：十一城（城市夜景 11 处弯 + 发卡弯）、情迷爱琴海（爬坡连续弯）、法老金字塔（直道末端跳台）、雪地大冒险（8 字形立交）。

## 在线体验

| 游戏 | 地址 |
| --- | --- |
| 导航页 | <https://games.xdullboy.com/> |
| 鹈鹕骑单车 | <https://games.xdullboy.com/pelican/> |
| 运输船 | <https://games.xdullboy.com/transport-ship/> |
| 飞车 3D | <https://games.xdullboy.com/qq-speed/> |

首次加载需要下载 700–850 KB 并编译着色器，进入后请稍等几秒。三个游戏都带触屏控制，但操作手感以键鼠为准。

## 本地构建

三个工程结构相同：`src/` 源码经 esbuild 打包内联进单个 HTML。

```bash
# 一次构建全部三个游戏，汇总到 dist/
node build-site.mjs
```

产物结构：

```
dist/
├── index.html              # 导航页
├── pelican/index.html
├── transport-ship/index.html
└── qq-speed/index.html
```

也可以单独构建某一个游戏：

```bash
cd pelican-bike   # 或 cf-transport-ship / qq-speed
npm install
node build.mjs    # 产物输出到 dist/index.html，浏览器直接打开即可玩
```

## 部署

部署到 Cloudflare Pages（静态资源请求免费且不计入 Workers 每日请求配额）：

```bash
node build-site.mjs
npx wrangler deploy
```

## 仓库结构

```
├── pelican-bike/          # 鹈鹕骑单车
│   ├── src/               # 11 个模块：pelican / bicycle / ocean / fish / sky / effects / audio ...
│   ├── index.template.html# 页面模板（构建时注入 og:image 与打包后的 JS）
│   ├── build.mjs          # esbuild 构建脚本
│   └── package.json
├── cf-transport-ship/     # 运输船
│   ├── src/               # 18 个模块：map / guns / weapons / bots / player / physics / viewmodel ...
│   ├── build.mjs
│   └── package.json
├── qq-speed/              # 飞车 3D
│   ├── src/               # 15 个模块：vehicle / track / layouts / ai / maps / items ...
│   ├── build.mjs
│   └── package.json
├── wrangler.jsonc         # Cloudflare 部署配置（整站）
├── site/index.html        # 导航页源文件
├── build-site.mjs         # 构建三个游戏并汇总到 dist/
└── tools/smoke.mjs        # 无头浏览器冒烟测试
```

仓库只保存源码；`node_modules/`、`dist/` 构建产物不入库。

## 说明

- 三个游戏的源码由 Claude Opus 5.5 在 Claude Code 中生成
- 游戏为技术演示用途的同人作品，与《穿越火线》《QQ 飞车》原厂无关
