/**
 * 生成 README 的四张宣传图。用的是 lib/client.js 导出的**真实 CSS**、真实调色板、
 * 真实散射公式和当前版本的端点形变量；图里的轨道就是插件运行时的同一套几何，
 * 不是另画一张示意图。
 *
 *   node tools/make-promo.mjs
 *   # 再用浏览器无头截图（Edge / Chrome 都可以）：
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/hero-hud.png  file:///<temp>/dsh-effort-mosaic-promo/hero.html
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/drag-hud.png  file:///<temp>/dsh-effort-mosaic-promo/drag.html
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/neon-hud.png  file:///<temp>/dsh-effort-mosaic-promo/neon.html
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/shapes-hud.png file:///<temp>/dsh-effort-mosaic-promo/shapes.html
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fakeEl = () => ({
  style: {}, dataset: {}, children: [], firstChild: null, isConnected: true, textContent: "",
  appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; return c; },
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  setAttribute() {}, getAttribute: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 30, right: 300, bottom: 30 }),
  closest: () => null,
});
const ReactStub = {
  Fragment: Symbol("F"), createElement: () => null,
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {}, useSyncExternalStore: (_s, g) => g(),
};
let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (m) => { captured = m; } },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, matchMedia: () => ({ matches: false }),
};
globalThis.document = {
  createElement: fakeEl, querySelector: () => null, querySelectorAll: () => [],
  head: fakeEl(), body: fakeEl(), addEventListener() {},
};
globalThis.__DEM_TEST_HOOK__ = true;
await import(pathToFileURL("./lib/client.js").href);
const I = captured.factory((n) => (n === "react" ? ReactStub
  : n === "react-dom" ? { createPortal: (x) => x } : (() => { throw new Error(n); })())).__internals;

const CSS = I.CSS;
const pal = I.paletteOf("#4A84FF");
const ACCENT = "74,132,255";

/** 端点形变的 CSS 变量；和 `writeDeform()` 同名同值，静态图直接落最终帧。 */
function deformVars(o, fillW) {
  const d = o.deform;
  if (!d) return [];
  return [
    "--dem-knob-sx:" + (d.knobSx ?? 1),
    "--dem-knob-sy:" + (d.knobSy ?? 1),
    "--dem-rail-sx:" + (d.railSx ?? 1),
    "--dem-rail-sy:" + (d.railSy ?? 1),
    "--dem-rail-skew:" + (d.railSkewX ?? 0) + "deg",
    "--dem-rail-skew-y:" + (d.railSkewY ?? 0) + "deg",
    /* 色带 / 粒子层和旋钮共用这份垂直高度：横向拉伸时滑块会被压扁，
       这里取两者较小值，色带不会从滑块上下露出来。 */
    "--dem-fill-sy:" + Math.min(d.knobSy ?? 1, d.railSy ?? 1).toFixed(4),
    "--dem-rail-origin-x:" + fillW.toFixed(2) + "px",
    "--dem-rail-base-origin:" + fillW.toFixed(2) + "px",
  ];
}

/* 稳定伪随机：同一格每次生成的抖动量一致，图可复现 */
function rnd(a, b) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** 一格一格的马赛克；scatter=true 时按真实 scatterPose 把方块甩出去。 */
function cellsHtml(fillW, opts) {
  const o = opts || {};
  const amount = o.amount || 1.6;
  const cols = Math.ceil(fillW / 5);
  let out = "";
  for (let gy = 0; gy < 6; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const gx0 = gx * 5;
      const gy0 = gy * 5;
      if (gx0 > fillW - 1) continue;
      const esc = rnd(gx + 1, gy + 3);
      const dir = rnd(gx + 9, gy + 11) < 0.5 ? -1 : 1;
      const jit = 0.45 + rnd(gx + 5, gy + 7) * 0.55;
      let x = gx0;
      let y = gy0;
      let op = 1;
      let scale = 1;
      if (o.scatter) {
        const dEdge = 1 - gx0 / fillW;
        const sc = dEdge <= 0.2 ? 0 : Math.pow((dEdge - 0.2) / 0.8, 1.1);
        if (sc > 0 && esc < 0.03 + 0.72 * sc) {
          const life = rnd(gx + 13, gy + 17);
          const pose = I.scatterPose("spray", sc, life, { gx: gx0, gy: gy0, dir, jit, esc }, amount, 0);
          y = gy0 + pose.dy;
          /* 与真机一致：spray 的纵向位移夹回 30px 带内，否则最上/最下一行会被推出
             胶囊轮廓，轨道上边界出现阶梯缺口。 */
          const cellSpan = 5 * pose.scale;
          y = Math.min(Math.max(y, 0), 30 - cellSpan);
          scale = pose.scale;
          op = 0.74 + 0.26 * pose.opMul;
          x = gx0 - (esc - 0.5) * 12 * sc;
        }
      }
      /* 与真机同一条左端渐隐：x / 0.18w，避免出现一条发白的硬边 */
      op *= Math.min(1, Math.max(0, x) / (0.18 * fillW));
      if (x < 0) op *= Math.max(0, 1 + x / 2);
      const size = (5 * scale).toFixed(2);
      out += '<i class="dem-cell" style="width:' + size + "px;height:" + size
        + "px;opacity:" + op.toFixed(2)
        + ";transform:translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0);background:"
        + I.cellColor(gx0, fillW) + '"></i>';
    }
  }
  return out;
}

/** 一条轨道：几何与真机同源（圆 / 超椭圆到圆心竖切，其余铺到滑块右缘）。 */
function track(opts) {
  const o = Object.assign({ width: 860, pct: 1, shape: "circle", size: 30, scatter: false }, opts);
  const knobW = I.knobWidthOf({ knobShape: o.shape, knobSize: o.size });
  const radius = I.knobRadiusOf({ knobShape: o.shape, knobSize: o.size });
  const border = "1px solid " + pal.stops[0];
  const fillSurface = I.knobSurfaceOf({ knobShape: o.shape, knobFill: o.knobFill || "white" }, pal);
  const corner = o.shape === "circle" ? Math.round(o.size * 0.5)
    : o.shape === "rounded" ? Math.round(o.size * 0.06) : null;
  const solidRound = o.shape === "circle" || o.shape === "disc";
  const tailRadius = solidRound ? 0 : corner === null ? Math.min(knobW, o.size) / 2 : corner;
  const travel = o.width - knobW + 2;
  const cx = knobW / 2 - 1 + travel * o.pct;
  const fillW = solidRound ? cx : cx + knobW / 2;
  /* 粒子墙仍铺到滑块右缘；死区按整条色轨计算，静止墙不会被填充缩短放大。 */
  const mosaicW = cx + knobW / 2;
  /* 和真机 syncTail 同一条收口：细棒贴左缘并向滑块内让 1px；其余实心形状
     切在圆心左侧 8px，让切口藏在旋钮本体下面。 */
  const cutX = o.shape === "blade" ? Math.max(0, cx - knobW / 2 + 1)
    : Math.max(0, cx - 8);
  const tailInset = o.shape === "blade" ? knobW - 1 : knobW / 2 + 8;
  const dragAttr = o.deform ? ' data-dragging="1" data-measured="1"' : '';
  const burstAttr = o.burst ? ' data-burst="1" data-burst-style="scan"' : '';
  const vars = [
    "--dem-accent:" + pal.accent,
    "--dem-c1:" + pal.stops[0], "--dem-c2:" + pal.stops[1],
    "--dem-c3:" + pal.stops[2], "--dem-c4:" + pal.stops[3],
    "--dem-accent-rgb:" + ACCENT,
    "--dem-knob-size:" + o.size + "px",
    "--dem-knob-w:" + knobW + "px",
    "--dem-knob-r:" + (knobW / 2) + "px",
    "--dem-knob-x:" + cx.toFixed(2) + "px",
    "--dem-knob-radius:" + radius,
    "--dem-knob-border:" + border,
    "--dem-knob-fill:" + fillSurface,
    "--dem-fill-h:30px",
    "--dem-band-inset:0px",
    "--dem-fill-tail-radius:" + tailRadius + "px",
    "--dem-track-radius:" + I.trackRadiusOf({ knobShape: o.shape || "circle", knobSize: o.size }),
    "--dem-fill-tail-x:" + cutX.toFixed(2) + "px",
    "--dem-knob-tail-inset:" + tailInset.toFixed(2) + "px",
    "--dem-slot-bg:rgba(255,255,255,.10)",
    "--dem-rail-origin-x:" + mosaicW.toFixed(2) + "px",
    "--dem-rail-base-origin:" + mosaicW.toFixed(2) + "px",
  ].concat(deformVars(o, mosaicW)).join(";");
  return '<div class="stage-vars" style="' + vars + '"><div class="dem-track" data-rail="mosaic" data-knob-shape="' + o.shape + '"' + dragAttr + burstAttr + ' style="width:' + o.width + 'px;--dem-track-radius:' + I.trackRadiusOf({ knobShape: o.shape, knobSize: o.size }) + '">'
    + '<div class="dem-fill" style="width:' + fillW.toFixed(2) + 'px"></div>'
    + '<div class="dem-mosaic-clip"><div class="dem-mosaic" style="width:' + mosaicW.toFixed(2) + 'px">'
    + cellsHtml(mosaicW, { scatter: o.scatter })
    + "</div></div>"
    + '<div class="dem-knob" style="left:' + cx.toFixed(2) + 'px"></div>'
    + "</div></div>";
}

/** 霓虹的漂流白点：数量、变量名与真机 `CODEX_DUST` 一致。 */
function neonDustHtml() {
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += '<i style="--y:' + (18 + 64 * rnd(i, 23)).toFixed(1)
      + "%;--o:" + (0.4 + 0.6 * rnd(i, 11)).toFixed(2)
      + ";--s:" + (0.7 + 0.35 * rnd(i, 12)).toFixed(2)
      + ";--dur:" + (1.6 * (0.8 + 1.2 * rnd(i, 7))).toFixed(2)
      + "s;--delay:" + (-1.6 * rnd(i, 5)).toFixed(2) + 's"></i>';
  }
  return out;
}

/** 霓虹轨道：真实 CSS + 真实蓝紫渐变；最高档静态展开成擦除完成态。 */
function neonTrack(opts) {
  const o = Object.assign({ width: 1072, pct: 1, size: 34, dust: true }, opts);
  const knobW = I.knobWidthOf({ knobShape: "circle", knobSize: o.size });
  const travel = Math.max(0, o.width - knobW);
  const cx = knobW / 2 + travel * o.pct;
  const fillW = cx;
  const max = o.pct >= 1 ? "1" : "0";
  const dragAttr = o.deform ? ' data-dragging="1" data-measured="1"' : '';
  const vars = [
    "--dem-accent:" + pal.accent,
    "--dem-accent-rgb:" + ACCENT,
    "--dem-c1:" + pal.stops[0], "--dem-c2:" + pal.stops[1],
    "--dem-c3:" + pal.stops[2], "--dem-c4:" + pal.stops[3],
    "--dem-neon-gradient:" + I.neonGradientOf("#4A84FF"),
    "--dem-knob-size:" + o.size + "px",
    "--dem-knob-w:" + knobW + "px",
    "--dem-knob-r:" + (knobW / 2) + "px",
    "--dem-knob-x:" + cx.toFixed(2) + "px",
    "--dem-knob-radius:" + I.knobRadiusOf({ knobShape: "circle", knobSize: o.size }),
    "--dem-knob-fill:" + I.knobSurfaceOf({ knobShape: "circle", knobFill: "white" }, pal),
    "--dem-fill-h:30px",
    "--dem-band-inset:0px",
    "--dem-fill-tail-x:" + cx.toFixed(2) + "px",
    "--dem-fill-tail-radius:0",
    "--dem-track-radius:" + I.trackRadiusOf({ knobShape: "circle", knobSize: o.size }),
    "--dem-knob-tail-inset:" + (knobW / 2 + 8) + "px",
    "--dem-slot-bg:rgba(255,255,255,.10)",
    "--dem-rail-origin-x:" + fillW.toFixed(2) + "px",
    "--dem-rail-base-origin:" + fillW.toFixed(2) + "px",
  ].concat(deformVars(o, fillW)).join(";");
  return '<div class="stage-vars" style="' + vars + '">'
    + '<div class="dem-track" data-rail="codex" data-knob-shape="circle" data-max="' + max
    + '" data-measured="1" data-burst="0" data-burst-style="scan"' + dragAttr + ' style="width:' + o.width + 'px;--dem-track-radius:' + I.trackRadiusOf({ knobShape: "circle", knobSize: o.size }) + '">'
    + '<div class="dem-fill" style="width:' + fillW.toFixed(2) + 'px">'
    + '<div class="dem-codex"><div class="dem-codex-grad"></div><div class="dem-codex-glow"></div>'
    + '<div class="dem-codex-wipe" data-run="static"></div>'
    + (o.dust === false ? "" : '<div class="dem-codex-dust">' + neonDustHtml() + "</div>")
    + '</div></div>'
    + '<div class="dem-knob" style="--dem-knob-x:' + cx.toFixed(2) + 'px"></div>'
    + "</div></div>";
}

const shapeDefs = [
  ["circle", "默认", "超椭圆 · 15px"],
  ["disc", "圆形", "正圆 · 999px"],
  ["rounded", "方", "6% 圆角 · 2px"],
  ["pill", "胶囊", "短边一半 · 15px"],
  ["blade", "细棒", "6.3px"],
];

let logoHtml = "";
for (let i = 0; i < 9; i += 1) logoHtml += '<i style="opacity:' + (i === 4 ? 1 : 0.42) + '"></i>';
let motifHtml = "";
for (let i = 0; i < 16; i += 1) motifHtml += '<i style="opacity:' + (0.18 + 0.28 * rnd(i, 7)).toFixed(2) + '"></i>';

const COMMON = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#06080d}
body{width:1200px;height:630px;overflow:hidden;color:#eef3ff;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.promo{position:relative;width:1200px;height:630px;overflow:hidden;
  background:
    radial-gradient(760px 420px at 78% 22%, rgba(74,132,255,.17), rgba(74,132,255,0) 68%),
    radial-gradient(520px 300px at 10% 96%, rgba(74,132,255,.075), rgba(74,132,255,0) 72%),
    linear-gradient(180deg,#0a0f18 0%,#06080d 58%,#05070c 100%)}
.grid{position:absolute;inset:0;opacity:.42;pointer-events:none;
  background-image:linear-gradient(rgba(150,177,255,.045) 1px,transparent 1px),
    linear-gradient(90deg,rgba(150,177,255,.045) 1px,transparent 1px);
  background-size:48px 48px;
  -webkit-mask-image:radial-gradient(700px 420px at 48% 42%,#000 0%,transparent 82%);
  mask-image:radial-gradient(700px 420px at 48% 42%,#000 0%,transparent 82%)}
.rule{position:absolute;left:56px;right:56px;top:82px;height:1px;background:rgba(154,178,255,.16)}
.hd{position:absolute;left:56px;right:56px;top:34px;display:flex;align-items:center;justify-content:space-between;height:24px}
.brand{display:flex;align-items:center;gap:11px;font-size:13px;letter-spacing:.02em;color:#d8e4ff;font-weight:600}
.logo{display:grid;grid-template-columns:repeat(3,5px);grid-auto-rows:5px;gap:3px}
.logo i{display:block;background:#6f9dff;border-radius:1px;box-shadow:0 0 7px rgba(74,132,255,.4)}
.ver{font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9px;letter-spacing:.04em;color:#6e7e99;
  border:1px solid rgba(130,160,220,.18);padding:2px 6px;border-radius:4px}
.hd-right{display:flex;align-items:center;gap:9px;font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;
  font-size:9.5px;letter-spacing:.15em;color:#7183a1;text-transform:uppercase}
.series{color:#b6c8ea}
.hd-dot{width:4px;height:4px;border-radius:50%;background:#4a84ff;box-shadow:0 0 9px 1px rgba(74,132,255,.6)}
.kicker{position:absolute;left:56px;top:104px;font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;
  font-size:10px;letter-spacing:.19em;color:#7c91b4;text-transform:uppercase}
h1{margin:0;font-size:54px;line-height:1.02;letter-spacing:-.035em;font-weight:700;color:#f1f5ff}
h1 em{font-style:normal;color:#7da6ff}
.sub{position:absolute;left:56px;font-size:16px;line-height:1.55;color:#99aac2;letter-spacing:.01em}
.chips{position:absolute;left:56px;display:flex;gap:8px;align-items:center}
.chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:6px;
  border:1px solid rgba(126,162,238,.22);background:rgba(74,132,255,.075);
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9.5px;letter-spacing:.04em;color:#b7c9e8}
.chip.hot{border-color:rgba(140,175,255,.42);background:rgba(74,132,255,.14);color:#dfeaff}
.stage{position:absolute;left:80px;right:80px}
.stage .stage-vars{display:flex;justify-content:center}
.stage-note{position:absolute;right:0;top:-25px;display:flex;align-items:center;gap:7px;
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9px;letter-spacing:.08em;color:#8facdf}
.stage-note i{width:5px;height:5px;border-radius:50%;background:#6f9dff;box-shadow:0 0 10px 2px rgba(74,132,255,.55)}
.glow{position:absolute;left:20px;right:20px;top:-30px;height:120px;pointer-events:none;filter:blur(8px);
  background:radial-gradient(58% 100% at 50% 52%,rgba(74,132,255,.20),rgba(74,132,255,0) 72%)}
.glow.violet{background:radial-gradient(58% 100% at 50% 52%,rgba(119,94,255,.20),rgba(119,94,255,0) 72%)}
.scale{display:flex;justify-content:space-between;margin:13px 2px 0;padding:0 4px;
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9.5px;letter-spacing:.13em;color:#667896}
.scale b{color:#b9cdf1;font-weight:500}
.card{position:absolute;top:344px;height:200px;padding:17px 18px;border:1px solid rgba(140,172,255,.14);
  border-radius:13px;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.014));
  overflow:hidden}
.card-title{display:flex;justify-content:space-between;align-items:center;
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9px;letter-spacing:.13em;color:#7187aa;text-transform:uppercase}
.card-title b{font-size:10px;color:#c7d8f7;letter-spacing:.06em;font-weight:500}
.card .stage-vars{display:flex;justify-content:center}
.card-meta{position:absolute;left:18px;right:18px;bottom:38px;display:flex;justify-content:space-between;
  padding-top:7px;border-top:1px solid rgba(130,160,220,.13);
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:8px;letter-spacing:.04em;color:#5f7392}
.card-meta b{color:#93a8c9;font-weight:500}
.card-caption{position:absolute;left:18px;right:18px;bottom:15px;font-size:9.5px;color:#7589a8;
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;letter-spacing:.02em}
.card-caption b{color:#bbcfee;font-weight:500}
.foot{position:absolute;left:56px;bottom:24px;display:flex;align-items:center;gap:11px;
  font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;font-size:9px;letter-spacing:.06em;color:#667793}
.foot .live{width:4px;height:4px;border-radius:50%;background:#4a84ff;box-shadow:0 0 8px 1px rgba(74,132,255,.7)}
.foot .sep{color:#33415a}
.foot-right{position:absolute;right:56px;bottom:24px;font-family:"SFMono-Regular",Consolas,"Cascadia Mono",monospace;
  font-size:9px;letter-spacing:.04em;color:#667793}
.motif{position:absolute;right:38px;top:102px;display:grid;grid-template-columns:repeat(4,10px);grid-auto-rows:10px;
  gap:5px;opacity:.52;transform:rotate(-7deg);pointer-events:none}
.motif i{display:block;background:#6d9cff;border-radius:2px}
`;

function head(index, label) {
  return '<div class="hd"><div class="brand"><span class="logo">' + logoHtml + '</span><span>dsh-effort-mosaic</span><span class="ver">1.2.8</span></div>'
    + '<div class="hd-right"><span class="series">' + index + ' / 04</span><span class="hd-dot"></span><span>' + label + '</span></div></div>'
    + '<div class="rule"></div>';
}
function foot() {
  return '<div class="foot"><span class="live"></span><span>DEEPSEEK HARNESS</span><span class="sep">/</span><span>github.com/xiaobaga281/dsh-effort-mosaic</span></div>'
    + '<div class="foot-right">零依赖 · 无构建 · MIT</div>';
}
function doc(o) {
  return '<!doctype html><html lang="zh-CN" data-canvas-width="' + o.w + '" data-canvas-height="' + o.h + '" style="width:' + o.w + 'px;height:' + o.h + 'px">'
    + '<head><meta charset="utf-8"><style>' + CSS + '</style><style>' + COMMON + '</style><style>' + o.css + '</style></head>'
    + '<body style="width:' + o.w + 'px;height:' + o.h + 'px"><main class="promo" data-canvas-root style="width:' + o.w + 'px;height:' + o.h + 'px">'
    + o.body + '</main></body></html>';
}

/* ────────────────────────────── 01 · 主视觉 ────────────────────────────── */
const hero = doc({
  w: 1200, h: 630,
  css: `
    .hero-h1{position:absolute;left:56px;top:119px}
    .hero-sub{top:185px;width:760px}
    .hero-chips{top:222px}
    .hero-stage{top:266px}
    .hero-left{left:56px;width:516px}
    .hero-right{left:628px;width:516px}
    .hero-neon{width:456px;margin:10px auto 0}
    .hero-shapes{display:flex;justify-content:space-between;margin:10px auto 0;width:472px}
    .hero-shape{width:80px;text-align:center}
    .hero-shape .stage-vars{display:block}
    .hero-shape .dem-track{margin:0 auto}
    .hero-shape span{display:block;margin-top:8px;font-family:"SFMono-Regular",Consolas,monospace;font-size:8px;color:#7489aa;letter-spacing:.04em}
    .hero-scale{margin-top:13px}
  `,
  body: head("01", "OVERVIEW")
    + '<div class="motif">' + motifHtml + '</div>'
    + '<div class="kicker">REASONING EFFORT / 推理等级</div>'
    + '<h1 class="hero-h1">推理等级，<em>看得见</em></h1>'
    + '<p class="sub hero-sub">把模型菜单里的 Off / Low / High / Max，换成一条可拖、可弹、可读的滑轨。</p>'
    + '<div class="chips hero-chips"><span class="chip hot">马赛克粒子</span><span class="chip">霓虹擦除</span><span class="chip">Q 弹拖拽</span><span class="chip">五种滑块</span></div>'
    + '<div class="stage hero-stage"><div class="glow"></div><div class="stage-note"><i></i>MAX / 粒子越界点亮</div>'
    + track({ width: 1040, pct: 1, size: 34, shape: "disc", scatter: true, amount: 3.1 })
    + '<div class="scale hero-scale"><span>Off</span><span>Low</span><span>High</span><b>Max</b></div></div>'
    + '<div class="card hero-left"><div class="card-title"><b>NEON / 最高档</b><span>02</span></div><div class="hero-neon">'
    + neonTrack({ width: 456, pct: 1, size: 30 }) + '</div><div class="card-meta"><span>平涂 → 擦除</span><b>96px soft edge</b></div><div class="card-caption"><b>蓝 → 紫擦除</b> · 14 颗漂流白点</div></div>'
    + '<div class="card hero-right"><div class="card-title"><b>SHAPES / 五种滑块</b><span>05</span></div><div class="hero-shapes">'
    + shapeDefs.map(([s, n]) => '<div class="hero-shape">' + track({ width: 80, pct: 0.68, shape: s, size: 30 }) + '<span>' + n + '</span></div>').join("")
    + '</div><div class="card-meta"><span>轨道半径随形</span><b>30 / 34 px</b></div><div class="card-caption"><b>2 档尺寸</b> · 4 种填充 · 强调色可换</div></div>'
    + foot(),
});

/* ────────────────────────────── 02 · 拖拽 ────────────────────────────── */
const drag = doc({
  w: 1200, h: 630,
  css: `
    .drag-h1{position:absolute;left:56px;top:118px}
    .drag-sub{top:184px;width:800px}
    .drag-chips{top:222px}
    .drag-stage{top:258px}
    .drag-main{width:1040px;margin:0 auto}
    .drag-scale{margin-top:13px}
    .drag-row{position:absolute;left:80px;right:80px;top:356px;display:flex;gap:16px}
    .drag-cell{position:relative;flex:1;height:170px;border:1px solid rgba(140,172,255,.13);border-radius:12px;
      background:linear-gradient(145deg,rgba(255,255,255,.04),rgba(255,255,255,.012));padding:14px 16px}
    .drag-cell .stage-vars{display:flex;justify-content:center}
    .drag-cell .dem-track{margin:0 auto}
    .drag-cell-title{display:flex;justify-content:space-between;font-family:"SFMono-Regular",Consolas,monospace;
      font-size:9px;letter-spacing:.12em;color:#7489aa;text-transform:uppercase}
    .drag-cell-title b{color:#c1d3f1;font-weight:500;letter-spacing:.04em}
    .drag-cell .mini{width:280px;margin:10px auto 0}
    .drag-cell .cap{margin-top:9px;font-size:9px;color:#8298b8;font-family:"SFMono-Regular",Consolas,monospace;letter-spacing:.04em}
    .drag-cell .state{margin-top:4px;font-size:8.5px;color:#5f718c;font-family:"SFMono-Regular",Consolas,monospace;letter-spacing:.03em}
    .drag-cell .cell-meta{position:absolute;left:16px;right:16px;bottom:12px;display:flex;justify-content:space-between;
      padding-top:6px;border-top:1px solid rgba(130,160,220,.12);
      font-family:"SFMono-Regular",Consolas,monospace;font-size:8px;color:#5d708d;letter-spacing:.03em}
    .drag-cell .cell-meta b{color:#94a9cb;font-weight:500}
  `,
  body: head("02", "Q-ELASTIC")
    + '<div class="kicker">ENDPOINT DEFORM / 端点形变</div>'
    + '<h1 class="drag-h1">拉一下，<em>回弹</em></h1>'
    + '<p class="sub drag-sub">不是硬停：滑块只做轴向拉伸，轨道、色带、粒子共用同一条右缘。</p>'
    + '<div class="chips drag-chips"><span class="chip hot">轴向 scale</span><span class="chip">同源右缘</span><span class="chip">欠阻尼回弹</span><span class="chip">不斜切滑块</span></div>'
    + '<div class="stage drag-stage"><div class="glow"></div><div class="stage-note"><i></i>外拉端点 · 右缘锚定</div>'
    + '<div class="drag-main">'
    + track({ width: 1040, pct: 1, size: 34, shape: "disc", scatter: true, amount: 3.0, deform: { knobSx: 1.38, knobSy: 1.02, railSx: 1.05, railSy: 0.985, railSkewX: 2.0 } })
    + '</div><div class="scale drag-scale"><span>Off</span><span>Low</span><span>High</span><b>Max + pull</b></div></div>'
    + '<div class="drag-row">'
    + '<div class="drag-cell"><div class="drag-cell-title"><b>01 / 静止</b><span>REST</span></div><div class="mini">'
    + track({ width: 280, pct: 0.65, size: 30, shape: "disc" })
    + '</div><div class="cap">轨道保持原形</div><div class="state">未越过端点，不触发形变</div><div class="cell-meta"><span>scaleX 1.00</span><b>scaleY 1.00</b></div></div>'
    + '<div class="drag-cell"><div class="drag-cell-title"><b>02 / 外拉</b><span>STRETCH</span></div><div class="mini">'
    + track({ width: 280, pct: 1, size: 30, shape: "disc", scatter: true, amount: 2.4, deform: { knobSx: 1.3, knobSy: 1.01, railSx: 1.04, railSy: 0.99, railSkewX: 1.4 } })
    + '</div><div class="cap">滑块 / 色带 / 轨道同步</div><div class="state">轴向拉伸，不做斜切</div><div class="cell-meta"><span>scaleX 1.30</span><b>色带 ≤ 滑块</b></div></div>'
    + '<div class="drag-cell"><div class="drag-cell-title"><b>03 / 回弹</b><span>RELEASE</span></div><div class="mini">'
    + track({ width: 280, pct: 0.92, size: 30, shape: "disc", scatter: true, amount: 2.4, deform: { knobSx: 1.06, knobSy: 1.0, railSx: 1.015, railSy: 0.995, railSkewX: 0.5 } })
    + '</div><div class="cap">欠阻尼弹簧收口</div><div class="state">ω 18 · ζ 0.55 · 轻微过冲</div><div class="cell-meta"><span>ω 18 / ζ 0.55</span><b>≈ 0.4s</b></div></div>'
    + '</div>'
    + foot(),
});

/* ────────────────────────────── 03 · 霓虹 ────────────────────────────── */
const neon = doc({
  w: 1200, h: 630,
  css: `
    .neon-h1{position:absolute;left:56px;top:118px}
    .neon-sub{top:185px;width:800px}
    .neon-chips{top:222px}
    .neon-stage{top:278px}
    .neon-main{width:1040px;margin:0 auto}
    .neon-scale{margin-top:13px}
    .neon-card{top:356px;height:190px}
    .neon-left{left:56px;width:516px}
    .neon-right{left:628px;width:516px}
    .neon-mini{width:456px;margin:10px auto 0}
    .gradient-bar{height:30px;margin:14px 0 0;border-radius:7px;
      background:linear-gradient(90deg,#2546D0 0%,#4A84FF 28%,#B37DFF 64%,#724CE9 100%);
      box-shadow:0 0 22px rgba(100,90,255,.16),inset 0 0 0 1px rgba(255,255,255,.10)}
    .gradient-labels{display:flex;justify-content:space-between;margin-top:9px;
      font-family:"SFMono-Regular",Consolas,monospace;font-size:8px;color:#7f8eaa;letter-spacing:.04em}
    .gradient-labels b{color:#c0b9ff;font-weight:500}
    .neon-card-caption{position:absolute;left:18px;right:18px;bottom:15px;font-size:9.5px;color:#8794b1;
      font-family:"SFMono-Regular",Consolas,monospace;letter-spacing:.03em}
    .neon-card-caption b{color:#c0b7ff;font-weight:500}
  `,
  body: head("03", "NEON")
    + '<div class="kicker" style="color:#9a8fce">CODEX GRADIENT / 霓虹轨道</div>'
    + '<h1 class="neon-h1">到 Max，<em style="color:#b9a7ff">擦出光</em></h1>'
    + '<p class="sub neon-sub">平涂轨道在最高档擦出蓝 → 紫渐变；14 颗白点由右向左漂过。</p>'
    + '<div class="chips neon-chips"><span class="chip hot" style="border-color:rgba(160,140,255,.4);background:rgba(110,90,255,.13);color:#ddd4ff">蓝紫擦除</span><span class="chip">14 颗漂流白点</span><span class="chip">4 套点亮动画</span><span class="chip">Q 弹拖拽</span></div>'
    + '<div class="stage neon-stage"><div class="glow violet"></div><div class="stage-note" style="color:#a696df"><i style="background:#9a83ff;box-shadow:0 0 10px 2px rgba(125,102,255,.55)"></i>MAX / 擦除完成</div>'
    + '<div class="neon-main">' + neonTrack({ width: 1040, pct: 1, size: 34 }) + '</div>'
    + '<div class="scale neon-scale"><span>Off</span><span>Low</span><span>High</span><b>Max</b></div></div>'
    + '<div class="card neon-card neon-left"><div class="card-title"><b>LOW / 平涂</b><span>BASE</span></div><div class="neon-mini">'
    + neonTrack({ width: 456, pct: 0.28, size: 30, dust: false }) + '</div>'
    + '<div class="card-meta"><span>强调色平涂</span><b>未到最高档</b></div>'
    + '<div class="neon-card-caption"><b>#4A84FF</b> · 轨道保持青蓝</div></div>'
    + '<div class="card neon-card neon-right"><div class="card-title"><b>GRADIENT / 擦除</b><span>MAX</span></div><div class="gradient-bar"></div>'
    + '<div class="gradient-labels"><span>#2546D0</span><b>#B37DFF</b><span>#724CE9</span></div>'
    + '<div class="card-meta"><span>逐点采样</span><b>蓝盖板 ← 退场</b></div>'
    + '<div class="neon-card-caption"><b>96px soft edge</b> · 向左推进</div></div>'
    + foot(),
});

/* ────────────────────────────── 04 · 滑块形状 ────────────────────────────── */
const shapes = doc({
  w: 1200, h: 630,
  css: `
    .shape-h1{position:absolute;left:56px;top:118px}
    .shape-sub{top:186px;width:920px}
    .shape-chips{top:222px}
    .shape-row{position:absolute;left:56px;right:80px;top:270px;display:flex;gap:16px}
    .shape-card{width:200px;height:230px;border:1px solid rgba(140,172,255,.13);border-radius:13px;
      background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.012));position:relative;overflow:hidden}
    .shape-card::after{content:"";position:absolute;left:18px;right:18px;bottom:0;height:1px;
      background:linear-gradient(90deg,transparent,rgba(126,162,238,.22),transparent)}
    .shape-index{position:absolute;left:16px;top:15px;font-family:"SFMono-Regular",Consolas,monospace;
      font-size:8px;letter-spacing:.1em;color:#5f7392}
    .shape-name{position:absolute;left:16px;top:34px;font-size:18px;font-weight:600;color:#e4edff;letter-spacing:-.02em}
    .shape-track{position:absolute;left:16px;right:16px;top:82px;display:flex;justify-content:center}
    .shape-track .stage-vars{display:block}
    .shape-track .dem-track{margin:0 auto}
    .shape-spec{position:absolute;left:16px;right:16px;top:138px;font-family:"SFMono-Regular",Consolas,monospace;
      font-size:9px;line-height:1.6;color:#8296b5;letter-spacing:.02em}
    .shape-spec b{color:#b7caeb;font-weight:500}
    .shape-note{position:absolute;left:16px;right:16px;top:174px;font-family:"SFMono-Regular",Consolas,monospace;
      font-size:8px;color:#5f7392;letter-spacing:.03em}
    .shape-bottom{position:absolute;left:56px;right:56px;top:530px;display:flex;justify-content:space-between;
      font-family:"SFMono-Regular",Consolas,monospace;font-size:9px;color:#667793;letter-spacing:.04em}
    .shape-bottom b{color:#a9c3ee;font-weight:500}
  `,
  body: head("04", "SHAPES")
    + '<div class="kicker">SURFACE OPTIONS / 外观选项</div>'
    + '<h1 class="shape-h1">同一轨道，<em>五种手感</em></h1>'
    + '<p class="sub shape-sub">轨道圆角按滑块形状走：正圆满胶囊，默认超椭圆，方 2px，细棒 6.3px。</p>'
    + '<div class="chips shape-chips"><span class="chip hot">5 种形状</span><span class="chip">2 档尺寸</span><span class="chip">4 种填充</span><span class="chip">同一套 Q 弹</span></div>'
    + '<div class="shape-row">'
    + shapeDefs.map(([shape, name, spec], i) => '<div class="shape-card">'
      + '<div class="shape-index">0' + (i + 1) + ' / 05</div>'
      + '<div class="shape-name">' + name + '</div>'
      + '<div class="shape-track">' + track({ width: 160, pct: 0.72, shape, size: 30 }) + '</div>'
      + '<div class="shape-spec"><b>' + spec.split(" · ")[0] + '</b><br>' + (spec.split(" · ")[1] || "") + '</div>'
      + '<div class="shape-note">轨道半径随滑块</div></div>').join("")
    + '</div>'
    + '<div class="shape-bottom"><span><b>30 / 34 px</b> 两档尺寸</span><span><b>白瓷 / 染色 / 强调色 / 磨砂</b> 四种填充</span><span><b>任意 hex</b> 强调色</span></div>'
    + foot(),
});

const OUT = path.join(os.tmpdir(), "dsh-effort-mosaic-promo");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/hero.html", hero);
fs.writeFileSync(OUT + "/drag.html", drag);
fs.writeFileSync(OUT + "/shapes.html", shapes);
fs.writeFileSync(OUT + "/neon.html", neon);
console.log("written", OUT + "/hero.html", OUT + "/drag.html", OUT + "/shapes.html", "and", OUT + "/neon.html");
console.log("next: screenshot each 1200x630 @1.5x -> docs/hero-hud.png, docs/drag-hud.png, docs/neon-hud.png, docs/shapes-hud.png");
