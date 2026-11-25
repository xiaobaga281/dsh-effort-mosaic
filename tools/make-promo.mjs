/**
 * 生成 README 的四张宣传图。用的是 lib/client.js 导出的**真实 CSS**、真实调色板、
 * 真实散射公式和 1.2.6 的端点形变量，所以图和真机是同一套观感；改了视觉参数就重跑一次。
 *
 *   node tools/make-promo.mjs            # 输出系统临时目录 dsh-effort-mosaic-promo/{hero,drag,shapes,neon}.html
 *   # 再用浏览器无头截图（Edge / Chrome 都可以）：
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/hero.png  file:///<temp>/dsh-effort-mosaic-promo/hero.html
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/drag.png  file:///<temp>/dsh-effort-mosaic-promo/drag.html
 *   msedge --headless=new --force-device-scale-factor=2   --window-size=1200,172 \
 *          --screenshot=docs/shapes.png file:///<temp>/dsh-effort-mosaic-promo/shapes.html
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,430 \
 *          --screenshot=docs/neon.png  file:///<temp>/dsh-effort-mosaic-promo/neon.html
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

/** 一条轨道：几何与真机同源（fillW = knobR + travel·pct，滑块中心在 left）。 */
function track(opts) {
  const o = Object.assign({ width: 860, pct: 1, shape: "circle", size: 30, scatter: false, knobs: true }, opts);
  const knobW = I.knobWidthOf({ knobShape: o.shape, knobSize: o.size });
  const radius = I.knobRadiusOf({ knobShape: o.shape, knobSize: o.size });
  const border = o.shape === "ring"
    ? "3px solid " + pal.accent
    : "1px solid " + pal.stops[0];
  const fillSurface = I.knobSurfaceOf({ knobShape: o.shape, knobFill: o.knobFill || "white" }, pal);
  const travel = o.width - knobW + 2;
  const cx = knobW / 2 - 1 + travel * o.pct;
  const fillW = cx + knobW / 2;
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
    "--dem-knob-radius:" + radius,
    "--dem-knob-border:" + border,
    "--dem-knob-fill:" + fillSurface,
    "--dem-fill-h:30px",
    "--dem-band-inset:0px",
    "--dem-fill-tail-radius:" + (knobW / 2 - I.knobBorderWidthOf({ knobShape: o.shape })) + "px",
    "--dem-fill-tail-x:" + cx.toFixed(2) + "px",
    "--dem-slot-bg:rgba(255,255,255,.10)",
    "--dem-rail-origin-x:" + fillW.toFixed(2) + "px",
    "--dem-rail-base-origin:" + fillW.toFixed(2) + "px",
  ].concat(deformVars(o, fillW)).join(";");
  return '<div class="stage-vars" style="' + vars + '"><div class="dem-track"' + dragAttr + burstAttr + ' style="width:' + o.width + 'px">'
    + '<div class="dem-fill" style="width:' + fillW.toFixed(2) + 'px"></div>'
    + '<div class="dem-mosaic-clip"><div class="dem-mosaic" style="width:' + fillW.toFixed(2) + 'px">'
    + cellsHtml(fillW, { scatter: o.scatter })
    + "</div></div>"
    + '<div class="dem-knob" style="left:' + cx.toFixed(2) + 'px"></div>'
    + "</div></div>";
}

/** 霓虹的漂流白点：数量、变量名与真机 `CODEX_DUST` 一致。 */
function neonDustHtml() {
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += '<i style="--y:' + (18 + 64 * rnd(i, 23)).toFixed(1)
      + '%;--o:' + (0.4 + 0.6 * rnd(i, 11)).toFixed(2)
      + ';--s:' + (0.7 + 0.35 * rnd(i, 12)).toFixed(2)
      + ';--dur:' + (1.6 * (0.8 + 1.2 * rnd(i, 7))).toFixed(2)
      + 's;--delay:' + (-1.6 * rnd(i, 5)).toFixed(2) + 's"></i>';
  }
  return out;
}

/** 霓虹轨道：真实 CSS + 真实蓝紫渐变；最高档静态展开成擦除完成态。 */
function neonTrack(opts) {
  const o = Object.assign({ width: 1072, pct: 1, size: 34 }, opts);
  const knobW = I.knobWidthOf({ knobShape: "circle", knobSize: o.size });
  const travel = Math.max(0, o.width - knobW);
  const cx = knobW / 2 + travel * o.pct;
  const fillW = cx + knobW / 2;
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
    "--dem-knob-radius:" + I.knobRadiusOf({ knobShape: "circle", knobSize: o.size }),
    "--dem-knob-fill:" + I.knobSurfaceOf({ knobShape: "circle", knobFill: "white" }, pal),
    "--dem-fill-h:30px",
    "--dem-band-inset:0px",
    "--dem-fill-tail-x:" + cx.toFixed(2) + "px",
    "--dem-fill-tail-radius:" + (knobW / 2 - 1) + "px",
    "--dem-slot-bg:rgba(255,255,255,.10)",
    "--dem-rail-origin-x:" + fillW.toFixed(2) + "px",
    "--dem-rail-base-origin:" + fillW.toFixed(2) + "px",
  ].concat(deformVars(o, fillW)).join(";");
  return '<div class="stage-vars" style="' + vars + '">'
    + '<div class="dem-track" data-rail="codex" data-max="' + max
    + '" data-measured="1" data-burst="0" data-burst-style="scan"' + dragAttr + ' style="width:' + o.width + 'px">'
    + '<div class="dem-fill" style="width:' + fillW.toFixed(2) + 'px">'
    + '<div class="dem-codex"><div class="dem-codex-grad"></div><div class="dem-codex-glow"></div>'
    + '<div class="dem-codex-wipe" data-run="static"></div>'
    + '<div class="dem-codex-dust">' + neonDustHtml() + "</div></div></div>"
    + '<div class="dem-knob" style="--dem-knob-x:' + cx.toFixed(2) + 'px"></div>'
    + "</div></div>";
}

/* 5×5 的马赛克角标：中心实、外圈虚，和轨道同一套色 */
let markHtml = "";
for (let y = 0; y < 5; y += 1) {
  for (let x = 0; x < 5; x += 1) {
    const d = Math.max(Math.abs(x - 2), Math.abs(y - 2));
    const a = [0.92, 0.62, 0.26][d] || 0.1;
    markHtml += '<i style="opacity:' + a + '"></i>';
  }
}

/* ────────────────────────────── 主视觉 ────────────────────────────── */
const hero = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${CSS}</style>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:1200px;height:630px;overflow:hidden;background:#080b11;color:#e9eefb;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.bg{position:absolute;inset:0;
  background:
    radial-gradient(760px 380px at 76% 34%, rgba(74,132,255,.30), rgba(74,132,255,0) 68%),
    radial-gradient(520px 300px at 18% 88%, rgba(74,132,255,.12), rgba(74,132,255,0) 70%),
    linear-gradient(180deg,#0a0e15 0%,#080b11 60%,#070a0f 100%)}
.grid{position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:40px 40px;
  -webkit-mask-image:radial-gradient(700px 420px at 50% 42%,#000 0%,transparent 78%);
  mask-image:radial-gradient(700px 420px at 50% 42%,#000 0%,transparent 78%)}
.wrap{position:absolute;inset:0;padding:54px 64px}
.kicker{font-size:11.5px;letter-spacing:.22em;color:#7b8aa4;font-weight:600}
h1{margin:14px 0 0;font-size:46px;line-height:1.05;letter-spacing:-.015em;font-weight:680;
  background:linear-gradient(92deg,#ffffff 8%,#cddcff 62%,#8fb4ff 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.tag{margin:14px 0 0;font-size:15.5px;color:#9aa8bf;letter-spacing:.01em}
.chips{display:flex;gap:8px;margin-top:22px}
.chip{font-size:11.5px;color:#b9c9e6;padding:5px 11px;border-radius:999px;
  border:1px solid rgba(120,160,255,.22);background:rgba(74,132,255,.10)}
.hero-stage{position:absolute;left:72px;right:72px;top:252px}
.hero-stage .stage-vars{display:flex;justify-content:center}
.glowbar{position:absolute;left:40px;right:40px;top:-26px;height:120px;pointer-events:none;
  background:radial-gradient(60% 100% at 50% 50%,rgba(74,132,255,.22),rgba(74,132,255,0) 72%);filter:blur(6px)}
.pull-note{position:absolute;right:0;top:-22px;display:flex;align-items:center;gap:7px;
  font-size:11px;color:#9fb6ff;letter-spacing:.08em;z-index:2}
.pull-note i{width:5px;height:5px;border-radius:50%;background:#6fa0ff;box-shadow:0 0 10px 2px rgba(74,132,255,.7)}
.mini{display:flex;gap:60px;margin-top:52px}
.mini .stage-vars{flex:1;display:flex;justify-content:center}
.mini-cap{display:flex;gap:60px;margin-top:14px;font-size:11px;color:#6d7c94;letter-spacing:.05em}
.mini-cap span{flex:1;text-align:center}
.hero-stage .dem-track{zoom:1}
.scale{display:flex;justify-content:space-between;margin:16px 0 0 2px;padding:0 6px;
  font-size:11px;color:#6d7c94;letter-spacing:.06em}
.foot{position:absolute;left:64px;bottom:44px;display:flex;align-items:center;gap:14px;
  font-size:12px;color:#6f7e97}
.dot{width:5px;height:5px;border-radius:50%;background:#4a84ff;box-shadow:0 0 10px 2px rgba(74,132,255,.8)}
.mark{position:absolute;right:64px;top:56px;display:grid;grid-template-columns:repeat(5,13px);
  grid-auto-rows:13px;gap:5px;transform:rotate(-6deg)}
.mark i{background:#6fa0ff;border-radius:2px;box-shadow:0 0 12px rgba(74,132,255,.55)}
.badge{position:absolute;right:64px;bottom:40px;text-align:right}
.badge b{display:block;font-size:26px;color:#dfe9ff;font-weight:650;letter-spacing:-.01em}
.badge span{font-size:11.5px;color:#71809a}
</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="mark">${markHtml}</div>
<div class="wrap">
  <div class="kicker">DEEPSEEK HARNESS · PLUGIN</div>
  <h1>dsh-effort-mosaic</h1>
  <p class="tag">把模型菜单里的「推理等级」换成一条滑轨：马赛克粒子 / 霓虹 / Q 弹拖拽</p>
  <div class="chips"><span class="chip">Q 弹拖拽</span><span class="chip">马赛克粒子</span><span class="chip">霓虹擦除</span><span class="chip">五形滑块</span></div>
</div>
<div class="hero-stage"><div class="glowbar"></div><div class="pull-note"><i></i>拉到端点：轨道 / 色带 / 粒子一起 Q 弹形变</div>${track({ width: 1000, pct: 1, size: 34, scatter: true, amount: 3.1, deform: { knobSx: 1.38, knobSy: 0.88, railSx: 1.08, railSy: 1.04, railSkewX: 2.2 } })}
  <div class="scale"><span>Off</span><span>Low</span><span>High</span><span>Max</span></div>
  <div class="mini">
    ${track({ width: 300, pct: 0, size: 30 })}
    ${track({ width: 300, pct: 0.5, size: 30 })}
    ${track({ width: 300, pct: 1, size: 30, scatter: true, amount: 1.6 })}
  </div>
  <div class="mini-cap"><span>0% 静止墙</span><span>50% 轨内漂移</span><span>100% 越界扩散</span></div>
</div>
<div class="foot"><span class="dot"></span><span>github.com/xiaobaga281/dsh-effort-mosaic</span></div>
<div class="badge"><b>Q 弹拖拽 · 双风格 · 5 形</b><span>零依赖 · 无构建 · MIT</span></div>
</body></html>`;

/* ────────────────────────────── 霓虹主视觉 ────────────────────────────── */
const neon = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${CSS}</style>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:1200px;height:430px;overflow:hidden;background:#080b11;color:#e9eefb;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.bg{position:absolute;inset:0;
  background:
    radial-gradient(760px 360px at 74% 42%, rgba(88,73,255,.34), rgba(88,73,255,0) 68%),
    radial-gradient(520px 280px at 20% 92%, rgba(74,132,255,.16), rgba(74,132,255,0) 72%),
    linear-gradient(180deg,#0a0e18 0%,#080b11 64%,#070a10 100%)}
.grid{position:absolute;inset:0;opacity:.45;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:40px 40px;
  -webkit-mask-image:radial-gradient(720px 330px at 50% 46%,#000 0%,transparent 78%);
  mask-image:radial-gradient(720px 330px at 50% 46%,#000 0%,transparent 78%)}
.wrap{position:absolute;left:64px;top:38px;right:64px}
.kicker{font-size:11.5px;letter-spacing:.22em;color:#7b8aa4;font-weight:600}
h1{margin:10px 0 0;font-size:40px;line-height:1.05;letter-spacing:-.02em;font-weight:680;
  background:linear-gradient(92deg,#ffffff 8%,#d6d2ff 54%,#9d8cff 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.tag{margin:10px 0 0;font-size:15px;color:#a0aac2;letter-spacing:.01em}
.chips{display:flex;gap:8px;margin-top:16px}
.chip{font-size:11.5px;color:#c4c9ee;padding:5px 11px;border-radius:999px;
  border:1px solid rgba(150,140,255,.28);background:rgba(110,90,255,.12)}
.stage{position:absolute;left:64px;right:64px;top:196px}
.stage .stage-vars{display:block}
.stage .dem-track{margin:0 auto}
.scale{display:flex;justify-content:space-between;margin:14px 2px 0;padding:0 6px;
  font-size:11px;color:#7b819b;letter-spacing:.07em}
.caption{display:flex;justify-content:space-between;margin:14px 4px 0;font-size:11px;color:#727f99}
.caption b{color:#b7a9ff;font-weight:600}
.neon-glow{position:absolute;left:28px;right:28px;top:-28px;height:110px;pointer-events:none;
  background:radial-gradient(60% 100% at 50% 50%,rgba(113,92,255,.20),rgba(113,92,255,0) 72%);filter:blur(7px)}
.foot{position:absolute;left:64px;bottom:26px;display:flex;align-items:center;gap:14px;
  font-size:12px;color:#727f99}
.dot{width:5px;height:5px;border-radius:50%;background:#8d7bff;box-shadow:0 0 10px 2px rgba(125,102,255,.8)}
.badge{position:absolute;right:64px;bottom:24px;text-align:right}
.badge b{display:block;font-size:24px;color:#dedaff;font-weight:650;letter-spacing:-.01em}
.badge span{font-size:11.5px;color:#7d7f9a}
</style></head><body>
<div class="bg"></div><div class="grid"></div>
<div class="wrap">
  <div class="kicker">DEEPSEEK HARNESS · PLUGIN</div>
  <h1>霓虹轨道</h1>
  <p class="tag">平涂强调色轨道；最高档擦出蓝 → 紫渐变，拉到端点时轨道和旋钮同样 Q 弹形变。</p>
  <div class="chips"><span class="chip">蓝紫擦除</span><span class="chip">Q 弹拖拽</span><span class="chip">14 颗漂流白点</span><span class="chip">4 套点亮动画</span></div>
</div>
<div class="stage"><div class="neon-glow"></div>${neonTrack({ width: 1000, pct: 1, size: 34, deform: { knobSx: 1.3, knobSy: 0.9, railSx: 1.05, railSy: 1.03, railSkewX: 1.6 } })}
  <div class="scale"><span>Off</span><span>Low</span><span>High</span><span>Max</span></div>
  <div class="caption"><span>低档：平涂强调色</span><b>最高档：蓝 → 紫擦除渐变</b><span>拖动 / 点击都跟手 · 松手弹簧回弹</span></div>
</div>
<div class="foot"><span class="dot"></span><span>github.com/xiaobaga281/dsh-effort-mosaic</span></div>
<div class="badge"><b>霓虹 · MAX</b><span>零依赖 · 无构建 · MIT</span></div>
</body></html>`;

/* ────────────────────────────── Q 弹拖拽 ────────────────────────────── */
const drag = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${CSS}</style>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:1200px;height:630px;overflow:hidden;background:#080b11;color:#e9eefb;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.bg{position:absolute;inset:0;
  background:
    radial-gradient(780px 380px at 72% 28%, rgba(46,105,255,.25), rgba(46,105,255,0) 70%),
    radial-gradient(520px 300px at 16% 96%, rgba(74,132,255,.12), rgba(74,132,255,0) 72%),
    linear-gradient(180deg,#090e18 0%,#080b11 62%,#070a10 100%)}
.grid{position:absolute;inset:0;opacity:.42;
  background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
  background-size:40px 40px;
  -webkit-mask-image:radial-gradient(760px 420px at 50% 38%,#000 0%,transparent 82%);
  mask-image:radial-gradient(760px 420px at 50% 38%,#000 0%,transparent 82%)}
.qghost{position:absolute;right:52px;top:18px;font-size:230px;line-height:1;font-weight:780;
  color:rgba(108,150,255,.055);letter-spacing:-.06em;pointer-events:none}
.wrap{position:absolute;left:72px;top:42px;right:72px}
.kicker{font-size:11.5px;letter-spacing:.22em;color:#7b8aa4;font-weight:600}
h1{margin:10px 0 0;font-size:58px;line-height:1.03;letter-spacing:-.035em;font-weight:700;
  color:#f2f6ff}
h1 em{font-style:normal;color:#7ea7ff}
.tag{width:860px;margin:12px 0 0;font-size:15px;line-height:1.65;color:#a3b1c9}
.chips{display:flex;gap:8px;margin-top:15px}
.chip{font-size:11.5px;color:#c7d5f4;padding:5px 11px;border-radius:999px;
  border:1px solid rgba(110,160,255,.28);background:rgba(74,132,255,.10)}
.chip.hot{color:#cfe0ff;border-color:rgba(122,174,255,.52);background:rgba(74,132,255,.20)}
.stage{position:absolute;left:72px;right:72px;top:248px}
.stage .stage-vars{display:flex;justify-content:center}
.glow{position:absolute;left:28px;right:28px;top:-26px;height:116px;pointer-events:none;
  background:radial-gradient(58% 100% at 50% 50%,rgba(74,132,255,.24),rgba(74,132,255,0) 72%);filter:blur(7px)}
.pull-note{position:absolute;right:0;top:-24px;display:flex;align-items:center;gap:7px;
  font-size:11px;color:#9fb6ff;letter-spacing:.08em}
.pull-note i{width:5px;height:5px;border-radius:50%;background:#6fa0ff;box-shadow:0 0 10px 2px rgba(74,132,255,.7)}
.scale{display:flex;justify-content:space-between;margin:13px 2px 0;padding:0 6px;
  font-size:11px;color:#7b819b;letter-spacing:.07em}
.caption{display:flex;justify-content:space-between;margin:13px 4px 0;font-size:11.5px;color:#8392ab}
.caption b{color:#a9c0ff;font-weight:600}
.steps{position:absolute;left:72px;right:72px;top:414px;display:flex;gap:54px}
.step{flex:1;min-width:0}
.step .dem-track{margin:0 auto}
.step .cap{margin-top:13px;font-size:11px;color:#8b9ab2;letter-spacing:.06em}
.step .cap b{color:#d7e3ff;font-weight:600}
.step .state{margin-top:4px;font-size:10.5px;color:#5e6d84;letter-spacing:.04em}
.tech{position:absolute;left:72px;bottom:68px;display:flex;gap:12px}
.tech span{font-size:10.5px;color:#8192ad;padding:5px 9px;border:1px solid rgba(120,150,210,.18);
  border-radius:6px;background:rgba(255,255,255,.025)}
.tech b{color:#b8c9ea;font-weight:600}
.foot{position:absolute;left:72px;bottom:26px;display:flex;align-items:center;gap:14px;
  font-size:12px;color:#727f99}
.dot{width:5px;height:5px;border-radius:50%;background:#6fa0ff;box-shadow:0 0 10px 2px rgba(74,132,255,.8)}
.badge{position:absolute;right:72px;bottom:24px;text-align:right}
.badge b{display:block;font-size:23px;color:#e2ebff;font-weight:650;letter-spacing:-.01em}
.badge span{font-size:11.5px;color:#7d89a0}
</style></head><body>
<div class="bg"></div><div class="grid"></div><div class="qghost">Q</div>
<div class="wrap">
  <div class="kicker">DEEPSEEK HARNESS · PLUGIN / 1.2.6</div>
  <h1>Q 弹<em>拖拽</em></h1>
  <p class="tag">拉出端点不再硬停：滑块只做轴向拉伸，轨道玻璃、色带和粒子围绕同一条右缘一起形变；松手后用二阶欠阻尼弹簧收回。</p>
  <div class="chips"><span class="chip hot">轴向 scaleX / scaleY</span><span class="chip">轨道同源形变</span><span class="chip">无 skew 剪切</span><span class="chip">五形滑块</span></div>
</div>
<div class="stage"><div class="glow"></div><div class="pull-note"><i></i>外拉端点 · 同一条右缘锚点</div>${track({ width: 1000, pct: 1, size: 34, scatter: true, amount: 3.1, deform: { knobSx: 1.45, knobSy: 0.86, railSx: 1.08, railSy: 1.035, railSkewX: 2.4 } })}
  <div class="scale"><span>Off</span><span>Low</span><span>High</span><span>Max</span></div>
  <div class="caption"><span>未拉出：圆头与轨道等宽</span><b>外拉时：滑块变宽、轨道向左伸展</b><span>松手：约 0.23s 收敛</span></div>
</div>
<div class="steps">
  <div class="step">${track({ width: 300, pct: 0.62, size: 28 })}
    <div class="cap"><b>未越界</b> · 原形</div><div class="state">未越过端点，轨道不形变</div></div>
  <div class="step">${track({ width: 300, pct: 1, size: 28, deform: { knobSx: 1.28, knobSy: 0.92, railSx: 1.04, railSy: 1.02, railSkewX: 1.1 } })}
    <div class="cap"><b>外拉</b> · 轴向伸展</div><div class="state">滑块 / 玻璃 / 色带同步</div></div>
  <div class="step">${track({ width: 300, pct: 1, size: 28, burst: true, deform: { knobSx: 1.04, knobSy: 0.99, railSx: 1.006, railSy: 1.006, railSkewX: 0 } })}
    <div class="cap"><b>松手</b> · 回弹</div><div class="state">二阶欠阻尼弹簧 ω=28 · ζ=0.68</div></div>
</div>
<div class="tech"><span><b>1.2.6</b> 拖拽物理</span><span>轴向拉伸，不做斜切</span><span>形变锚点跟滑块右缘</span><span>落位回弹不反弹过界</span></div>
<div class="foot"><span class="dot"></span><span>github.com/xiaobaga281/dsh-effort-mosaic</span></div>
<div class="badge"><b>Q 弹拖拽 · 1.2.6</b><span>零依赖 · 无构建 · MIT</span></div>
</body></html>`;

/* ────────────────────────────── 五种滑块 ────────────────────────────── */
const shapeDefs = [
  ["circle", "圆", 30],
  ["ring", "环", 30],
  ["rounded", "方形", 30],
  ["pill", "胶囊", 30],
  ["blade", "细棒", 30],
];
const shapes = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${CSS}</style>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:1200px;height:172px;overflow:hidden;background:#080b11;color:#e9eefb;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.bg{position:absolute;inset:0;background:
  radial-gradient(680px 260px at 50% 108%, rgba(74,132,255,.18), rgba(74,132,255,0) 70%),
  linear-gradient(180deg,#0a0e15,#080b11)}
.head{position:absolute;left:56px;top:34px}
.head b{font-size:15px;font-weight:640;color:#dfe9ff}
.head span{margin-left:10px;font-size:12px;color:#71809a}
.qtag{display:inline-flex;margin-left:12px;padding:4px 9px;border:1px solid rgba(110,160,255,.3);
  border-radius:999px;background:rgba(74,132,255,.10);font-size:10px;color:#9fb6ff;letter-spacing:.06em}
.row{position:absolute;left:56px;right:56px;top:88px;display:flex;gap:22px}
.cell{flex:1;text-align:center}
.cell .dem-track{margin:0 auto}
.cap{margin-top:14px;font-size:11.5px;color:#8494ac;letter-spacing:.08em}
</style></head><body>
<div class="bg"></div>
<div class="head"><b>五种滑块</b><span>两档尺寸 · 四种填充 · 强调色可换 · 同一套 Q 弹形变</span><span class="qtag">Q 弹拖拽</span></div>
<div class="row">
${shapeDefs.map(([shape, name, size]) => {
  const w = 196;
  return '<div class="cell">' + track({ width: w, pct: 0.62, shape, size }) 
    + '<div class="cap">' + name + '</div></div>';
}).join("")}
</div>
</body></html>`;

const OUT = path.join(os.tmpdir(), "dsh-effort-mosaic-promo");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/hero.html", hero);
fs.writeFileSync(OUT + "/drag.html", drag);
fs.writeFileSync(OUT + "/shapes.html", shapes);
fs.writeFileSync(OUT + "/neon.html", neon);
console.log("written", OUT + "/hero.html", OUT + "/drag.html", OUT + "/shapes.html", "and", OUT + "/neon.html");
console.log("next: screenshot 1200x630 @1.5x -> docs/hero.png + docs/drag.png, 1200x172 @2x -> docs/shapes.png, 1200x430 @1.5x -> docs/neon.png");
