/**
 * 生成 README 的两张宣传图。用的是 lib/client.js 导出的**真实 CSS**、真实调色板、
 * 真实散射公式，所以图和真机是同一套观感；改了视觉参数就重跑一次。
 *
 *   node tools/make-promo.mjs            # 在仓库根目录执行，输出 .workbuddy/tmp/{hero,shapes}.html
 *   # 再用浏览器无头截图（Edge / Chrome 都可以）：
 *   msedge --headless=new --force-device-scale-factor=1.5 --window-size=1200,630 \
 *          --screenshot=docs/hero.png  file:///<abs>/.workbuddy/tmp/hero.html
 *   msedge --headless=new --force-device-scale-factor=2   --window-size=1200,172 \
 *          --screenshot=docs/shapes.png file:///<abs>/.workbuddy/tmp/shapes.html
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";

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
await import(pathToFileURL("./lib/client.js").href);
const I = captured.factory((n) => (n === "react" ? ReactStub
  : n === "react-dom" ? { createPortal: (x) => x } : (() => { throw new Error(n); })())).__internals;

const CSS = I.CSS;
const pal = I.paletteOf("#4A84FF");
const ACCENT = "74,132,255";

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
  ].join(";");
  return '<div class="stage-vars" style="' + vars + '"><div class="dem-track" style="width:' + o.width + 'px">'
    + '<div class="dem-fill" style="width:' + fillW.toFixed(2) + 'px"></div>'
    + '<div class="dem-mosaic-clip"><div class="dem-mosaic" style="width:' + fillW.toFixed(2) + 'px">'
    + cellsHtml(fillW, { scatter: o.scatter })
    + "</div></div>"
    + '<div class="dem-knob" style="left:' + cx.toFixed(2) + 'px"></div>'
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
.hero-stage{position:absolute;left:64px;right:64px;top:268px}
.glowbar{position:absolute;left:40px;right:40px;top:-26px;height:120px;pointer-events:none;
  background:radial-gradient(60% 100% at 50% 50%,rgba(74,132,255,.22),rgba(74,132,255,0) 72%);filter:blur(6px)}
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
  <p class="tag">把模型菜单里的「推理等级」换成一条像素马赛克粒子滑轨</p>
  <div class="chips"><span class="chip">马赛克粒子</span><span class="chip">临界阻尼吸附</span><span class="chip">四套越界动画</span><span class="chip">五形滑块</span></div>
</div>
<div class="hero-stage"><div class="glowbar"></div>${track({ width: 1072, pct: 1, size: 34, scatter: true, amount: 3.1 })}
  <div class="scale"><span>Off</span><span>Low</span><span>High</span><span>Max</span></div>
  <div class="mini">
    ${track({ width: 300, pct: 0, size: 30 })}
    ${track({ width: 300, pct: 0.5, size: 30 })}
    ${track({ width: 300, pct: 1, size: 30, scatter: true, amount: 1.6 })}
  </div>
  <div class="mini-cap"><span>0% 静止墙</span><span>50% 轨内漂移</span><span>100% 越界扩散</span></div>
</div>
<div class="foot"><span class="dot"></span><span>github.com/xiaobaga281/dsh-effort-mosaic</span></div>
<div class="badge"><b>4 档 · 5 形 · 4 动效</b><span>零依赖 · 无构建 · MIT</span></div>
</body></html>`;

/* ────────────────────────────── 五种滑块 ────────────────────────────── */
const shapeDefs = [
  ["circle", "圆", 30],
  ["ring", "环", 30],
  ["rounded", "方形", 30],
  ["pill", "胶囊", 28],
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
.row{position:absolute;left:56px;right:56px;top:88px;display:flex;gap:22px}
.cell{flex:1;text-align:center}
.cell .dem-track{margin:0 auto}
.cap{margin-top:14px;font-size:11.5px;color:#8494ac;letter-spacing:.08em}
</style></head><body>
<div class="bg"></div>
<div class="head"><b>五种滑块</b><span>三档尺寸 · 四种填充 · 强调色可换</span></div>
<div class="row">
${shapeDefs.map(([shape, name, size]) => {
  const w = 196;
  return '<div class="cell">' + track({ width: w, pct: 0.62, shape, size }) 
    + '<div class="cap">' + name + '</div></div>';
}).join("")}
</div>
</body></html>`;

const OUT = ".workbuddy/tmp";
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/hero.html", hero);
fs.writeFileSync(OUT + "/shapes.html", shapes);
console.log("written", OUT + "/hero.html", "and", OUT + "/shapes.html");
console.log("next: screenshot 1200x630 @1.5x -> docs/hero.png, 1200x172 @2x -> docs/shapes.png");
