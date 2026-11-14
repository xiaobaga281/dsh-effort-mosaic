/**
 * 离线冒烟测试：在桩件环境里**真正执行** lib/client.js，
 * 验证 ①模块能加载 ②apply 不抛错 ③档位解析跟着模型走 ④粒子位移场边界。
 *
 *   node test/smoke.mjs
 */
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, "../lib/client.js");
const SRC = fs.readFileSync(CLIENT, "utf8");

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass += 1; return; }
  fails.push(name + (extra === undefined ? "" : ` → ${extra}`));
}

/* ── 极简 React 桩件 ── */
const Fragment = Symbol("Fragment");
const ReactStub = {
  Fragment,
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_sub, get) => get(),
};
const ReactDomStub = { createPortal: (node) => node };

/* ── 极简 DOM 桩件 ── */
function fakeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    style: {},
    dataset: {},
    className: "",
    children: [],
    parentNode: null,
    isConnected: true,
    firstChild: null,
    textContent: "",
    appendChild(child) {
      el.children.push(child);
      child.parentNode = el;
      el.firstChild = el.children[0];
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      el.firstChild = el.children[0] || null;
      child.parentNode = null;
      return child;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 28, right: 300, bottom: 28 }),
    closest: () => null,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  };
  return el;
}

let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (mod) => { captured = mod; } },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = {
  hidden: true,
  documentElement: fakeEl("html"),
  head: fakeEl("head"),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => fakeEl(tag),
  getElementById: () => null,
  addEventListener: () => {},
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.Event = class {
  constructor(name) { this.type = name; }
};

/* ── 执行 bundle ── */
await import(pathToFileURL(CLIENT).href);

ok("bundle 被 __ModuleLoader__ 接管", captured !== null);
ok("bundle id 正确", captured && captured.id === "dsh-effortmosaic", captured && captured.id);
ok("factory 是函数", captured && typeof captured.factory === "function");

const mod = captured.factory((name) => {
  if (name === "react") return ReactStub;
  if (name === "react-dom") return ReactDomStub;
  throw new Error("unexpected require: " + name);
});

ok("导出 apply", typeof mod.apply === "function");
ok("导出 inject", Array.isArray(mod.inject), mod.inject && mod.inject.join(","));
ok("inject 声明了 modelDirectories", mod.inject.includes("modelDirectories"));
ok("inject 声明了 remote.session", mod.inject.includes("remote.session"));
ok("导出 __internals", mod.__internals && typeof mod.__internals === "object");

/* ── apply 不抛错 ── */
let entries = [];
try {
  mod.apply({
    slots: {
      inject: (_name, cb) => cb(),
      register: (opts, Comp) => { entries.push({ opts, Comp }); return () => {}; },
    },
  });
  ok("apply 不抛错", true);
} catch (err) {
  ok("apply 不抛错", false, String(err));
}
const registered = entries.find((e) => e.opts.name === "conversation.input.right") || null;
ok("注册到了 conversation.input.right", registered !== null);
ok("entry id 正确", registered !== null && registered.opts.id === "effort-mosaic-anchor");
ok("组件是函数", registered !== null && typeof registered.Comp === "function");
const configEntries = entries.filter((e) => e.opts.name === "plugins.bundle.config");
ok("注册了插件详情页的版式面板", configEntries.length > 0);
/* 两个键各注册一份：发行名（package.json name）+ 安装名（profile 里 link 的旧键）。
   宿主按组合包的包名取键，只按发行名注册的话，link 还是老名字的用户会看不到面板。 */
const configKeys = configEntries.map((e) => e.opts.key).sort();
ok("版式面板同时挂了发行名与旧安装名",
  configKeys.join(",") === "dsh-effort-mosaic,dsh-effortmosaic", configKeys.join(","));

/* ── 档位解析：跟着模型走 ── */
const I = mod.__internals;
const state5 = {
  current: { provider: "deepseek", model: "deepseek-v4-flash", reasoningEffort: "high" },
  groups: [{
    id: "deepseek",
    models: [{
      id: "deepseek-v4-flash",
      reasoning: {
        defaultEffort: "medium",
        efforts: [
          { id: "off", name: "Off" },
          { id: "low", name: "Low" },
          { id: "medium", name: "Medium" },
          { id: "high", name: "High" },
          { id: "max", name: "Max" },
        ],
      },
    }],
  }],
  status: "ready",
};
ok("5 档模型解析出 5 档", I.levelsOf(state5).length === 5, I.levelsOf(state5).length);
ok("档位名按目录顺序", I.levelsOf(state5).map((l) => l.id).join(",") === "off,low,medium,high,max");
ok("生效档位取显式设置", I.effectiveEffortId(state5) === "high", I.effectiveEffortId(state5));

const state2 = {
  current: { provider: "openai", model: "gpt-5" },
  groups: [{ id: "openai", models: [{ id: "gpt-5", reasoning: { efforts: [{ id: "low" }, { id: "high" }] } }] }],
  status: "ready",
};
ok("2 档模型解析出 2 档", I.levelsOf(state2).length === 2);
ok("没显式设置时回落到 defaultEffort", I.effectiveEffortId(state2) === null);

const state0 = {
  current: { provider: "x", model: "y" },
  groups: [{ id: "x", models: [{ id: "y" }] }],
};
ok("不支持推理的模型 → 0 档", I.levelsOf(state0).length === 0);
ok("目录未就绪 → 0 档", I.levelsOf({ current: null, groups: [] }).length === 0);

/* ── 几何 ── */
ok("4 档：第 0 档在 0", I.pctOfIndex(0, 4) === 0);
ok("4 档：第 3 档在 1", I.pctOfIndex(3, 4) === 1);
ok("4 档：第 1 档在 1/3", Math.abs(I.pctOfIndex(1, 4) - 1 / 3) < 1e-9);
ok("单档直接拉满", I.pctOfIndex(0, 1) === 1);
ok("0 档不甩到最右", I.pctOfIndex(0, 0) === 0);
ok("pct→index 吸附", I.indexOfPct(0.9, 4) === 3);
ok("pct→index 下界", I.indexOfPct(-1, 4) === 0);
ok("pct→index 上界", I.indexOfPct(2, 4) === 3);

/* ── 位移场 ── */
const cols = 53;
ok("最左格振幅满值", Math.abs(I.ampOf(0, cols) - 1) < 1e-9, I.ampOf(0, cols));
ok("最右格振幅为 0", I.ampOf(cols, cols) === 0);
ok("静止区边界压在右侧 2%（出区即有可见位移）",
  I.ampOf(Math.floor(cols * 0.99), cols) === 0 && I.ampOf(Math.floor(cols * 0.85), cols) > 0.05,
  `0.99→${I.ampOf(Math.floor(cols * 0.99), cols)} 0.85→${I.ampOf(Math.floor(cols * 0.85), cols)}`);
ok("振幅单调递减", I.ampOf(5, cols) > I.ampOf(20, cols) && I.ampOf(20, cols) > I.ampOf(40, cols));

/* ── 越界保护（与引擎同一条公式，对齐设计稿）── */
/* 不变量：任何时刻，凡是 x < 0 的格子，opacity 必为 0（肉眼不可见）。
   注意 drift 的分母是**填充宽度 w**，且先按 `gx + CELL*3` 封顶、再乘 life。 */
function engineFrame(amp, gxPx, gyPx, life, w) {
  let drift = amp * w * 0.35;
  if (drift > gxPx + I.CELL * 3) drift = gxPx + I.CELL * 3;
  const x = gxPx - drift * life;
  const y = gyPx + 0.8 * amp * 32 * life * life;
  const fadeAmt = Math.min(1, amp * 4.5);
  let op = 1 - fadeAmt * Math.pow(life, 2.4);
  if (life < 0.09) op *= life / 0.09;
  if (x < 0) op = 0;
  return { x, y, op };
}
let safe = true;
let worstX = 0;
for (let gx = 0; gx < cols; gx += 1) {
  const amp = I.ampOf(gx, cols);
  for (let s = 0; s <= 200; s += 1) {
    const life = s / 200;
    const f = engineFrame(amp, gx * I.CELL, 2 * I.CELL, life, 300);
    if (f.x < 0 && f.op > 0) { safe = false; worstX = f.x; }
    if (f.x >= 0 && f.op > 0 && f.x < -0.001) { safe = false; }
  }
}
ok("x<0 的格子必定不可见（不会露在轨道左边）", safe, worstX);

/* 静止格：amp<=0 时永远贴网格（不漂移）。 */
let stillExact = true;
for (let gx = 0; gx < cols; gx += 1) {
  const amp = I.ampOf(gx, cols);
  if (amp !== 0) continue;
  for (let s = 0; s <= 20; s += 1) {
    const f = engineFrame(amp, gx * I.CELL, 2 * I.CELL, s / 20, 300);
    if (Math.abs(f.x - gx * I.CELL) > 1e-9) stillExact = false;
    if (Math.abs(f.y - 2 * I.CELL) > 1e-9) stillExact = false;
  }
}
ok("静止格按网格绝对定位、完全不动", stillExact);

/* ── 配色：滑轨本身按设计稿固定，只有背景板跟主题 ── */
function parseRgb(s) {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(String(s));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/* 设计稿的取色是 Math.random()，单次不可断言，改用多次采样取均值。 */
function sampleColor(x, w, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const c = parseRgb(I.cellColor(x, w));
    if (c) out.push(c);
  }
  return out;
}
function meanColor(list) {
  const sum = [0, 0, 0];
  list.forEach(function (c) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; });
  return list.length ? sum.map(function (v) { return v / list.length; }) : [0, 0, 0];
}
const L = meanColor(sampleColor(0, cols, 200));
const R = meanColor(sampleColor(cols - 1, cols, 200));
ok("单格颜色是 rgb 字符串", sampleColor(0, cols, 5).length === 5);
ok("左端比右端浅（设计稿色阶）", L[0] > R[0] + 30 && L[1] > R[1] + 20,
  `${L.map(Math.round).join(",")} vs ${R.map(Math.round).join(",")}`);
/* 砖块现在按"底色 × 0.80–1.06"压暗，右端不会再顶到纯 255 —— 判"仍是饱和蓝"，
   而不是"等于设计稿那个 RGB"。 */
ok("右端仍是饱和蓝", R[2] > 210 && R[2] - R[0] > 120, R.map(Math.round).join(","));
ok("砖块整体比底色暗一档（乘性明度差，不是同色抖动）", (function () {
  const pal = I.paletteOf("#4A84FF");
  const base = pal.left[0];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 400; i += 1) {
    const c = parseRgb(I.cellColor(0, 200));
    if (!c || (c[0] === 241 && c[1] === 247 && c[2] === 255)) continue;
    sum += c[0];
    n += 1;
  }
  const mean = sum / Math.max(1, n);
  return n > 200 && mean < base * 0.97 && mean > base * 0.86;
})(), I.cellColor(0, 200));
const highlight = sampleColor(10, cols, 400).filter(function (c) {
  return c[0] === 241 && c[1] === 247 && c[2] === 255;
}).length;
ok("约 6% 的格子取 #F1F5FF 高光", highlight > 8 && highlight < 45, `400 次采样命中 ${highlight} 次`);
/* 旋钮默认仍是纯白（设计稿），只是改成 CSS 变量 + 字面兜底：改设置才变色。 */
ok("旋钮默认是白底（设计稿），不跟主题", I.CSS.indexOf("var(--dem-knob-fill,#ffffff)") !== -1);
ok("粒子不再写主题混合变量", I.CSS.indexOf("--dem-bg") === -1);
ok("填充用设计稿渐变", I.CSS.indexOf("#e2ecfe") !== -1 && I.CSS.indexOf("#4a84ff") !== -1);
ok("背景板仍交给 DSH（容器透明）", I.CSS.indexOf("background:transparent") !== -1);
ok("点亮不做整层平移抖动（和粒子逐帧 transform 打架、会掉帧）", I.CSS.indexOf("demGlitch") === -1);
ok("详情页版式面板的样式已内联", I.CSS.indexOf(".dem-cfg-row") !== -1 && I.CSS.indexOf(".dem-cfg-preview-track") !== -1);

/* ── 自定义版式：分色派生与设置存取 ── */
const P = I.paletteOf("#4A84FF");
ok("默认强调色 → 设计稿五段色阶原值", P.stops.join(",") === "#E2ECFE,#C4D8FD,#A0BCFB,#7097F9,#4A84FF", P.stops.join(","));
ok("默认强调色 → 粒子左端仍是设计稿浅蓝", P.left.join(",") === "226,236,254", P.left.join(","));
ok("默认强调色 → 高光仍是 #F1F7FF", P.highlight.join(",") === "241,247,255", P.highlight.join(","));
const P2 = I.paletteOf("#F2784B");
ok("换强调色后色阶跟着变", P2.stops[4] === "#F2784B", P2.stops.join(","));
ok("换强调色后左端整体变浅", P2.left[0] > P2.rgb[0] && P2.left[1] > P2.rgb[1] && P2.left[2] > P2.rgb[2],
  `${P2.left.map(Math.round).join(",")} vs ${P2.rgb.join(",")}`);
ok("非法色值回落到默认", I.paletteOf("nope").accent === "#4A84FF");
ok("设置项越界会被夹回", I.normalizeSettings({ knobSize: 999, burstIntensity: -5, burstSpeed: 99 }).knobSize === 34
  && I.normalizeSettings({ burstIntensity: -5 }).burstIntensity === 0.4
  && I.normalizeSettings({ burstSpeed: 99 }).burstSpeed === 1.4);
ok("最小滑块不会小于 28（否则轨道上下会留出明显的边）",
  I.normalizeSettings({ knobSize: 10 }).knobSize === 28,
  String(I.normalizeSettings({ knobSize: 10 }).knobSize));
ok("非法形状回落到实心圆", I.normalizeSettings({ knobShape: "hexagon" }).knobShape === "circle");
ok("五种形状都收得下", I.SHAPES.join(",") === "circle,ring,rounded,pill,blade", I.SHAPES.join(","));
ok("四种质感互不相同", (function () {
  var pal = I.paletteOf("#4A84FF");
  var s = I.FILLS.map(function (f) {
    return I.knobSurfaceOf({ knobShape: "circle", knobFill: f }, pal);
  });
  return new Set(s).size === 4;
})());
ok("染色比白瓷更蓝", (function () {
  var pal = I.paletteOf("#4A84FF");
  var white = I.knobSurfaceOf({ knobShape: "circle", knobFill: "white" }, pal);
  var tinted = I.knobSurfaceOf({ knobShape: "circle", knobFill: "tinted" }, pal);
  return white.indexOf("#ffffff") !== -1 && tinted.indexOf(pal.stops[2]) !== -1;
})());
ok("四种点亮样式都收得下", I.BURST_STYLES.join(",") === "ripple,scan,shatter,pulse", I.BURST_STYLES.join(","));
/* 越界：默认只在最高档出现，用户可改成全档位；旧存档里的布尔 scatterOut 不再参与。 */
ok("粒子越界默认只在最高档出现", I.normalizeSettings({}).scatterMode === "top");
ok("越界模式只认三态，非法回落到默认", I.normalizeSettings({ scatterMode: "sometimes" }).scatterMode === "top"
  && I.normalizeSettings({ scatterMode: "all" }).scatterMode === "all"
  && I.normalizeSettings({ scatterMode: "off" }).scatterMode === "off");
ok("四种越界动画都内置", I.SCATTER_STYLES.join(",") === "spray,drift,fall,tide", I.SCATTER_STYLES.join(","));
ok("右侧 1/5 是死区（sc=0 时一格都不飞）", I.SCATTER_DEAD === 0.2
  && (function () {
    const p = I.scatterPose("spray", 0, 0.5, { gx: 10, gy: 15, dir: 1, jit: 1 }, 1.6, 0);
    return p.dy === 0 && p.scale === 1;
  })());
ok("越界位移随 sc 单调变大", (function () {
  const cell = { gx: 10, gy: 15, dir: 1, jit: 1 };
  const a = Math.abs(I.scatterPose("spray", 0.35, 0.5, cell, 1.6, 0).dy);
  const b = Math.abs(I.scatterPose("spray", 0.9, 0.5, cell, 1.6, 0).dy);
  return a > 0 && b > a;
})());
ok("飞沫会缩小，飘散不缩小", (function () {
  const cell = { gx: 10, gy: 15, dir: 1, jit: 1 };
  return I.scatterPose("spray", 1, 1, cell, 1.6, 0).scale < 0.7
    && I.scatterPose("drift", 1, 1, cell, 1.6, 0).scale === 1;
})());
ok("坠落往下多于往上", (function () {
  const down = Math.abs(I.scatterPose("fall", 1, 1, { gx: 10, gy: 0, dir: 1, jit: 1, esc: 0.5 }, 1.6, 0).dy);
  const up = Math.abs(I.scatterPose("fall", 1, 1, { gx: 10, gy: 0, dir: 1, jit: 1, esc: 0.02 }, 1.6, 0).dy);
  return down > up * 1.8;
})());
ok("幅度会乘进位移里", (function () {
  const cell = { gx: 10, gy: 15, dir: 1, jit: 1 };
  const a = Math.abs(I.scatterPose("spray", 1, 1, cell, 0.6, 0).dy);
  const b = Math.abs(I.scatterPose("spray", 1, 1, cell, 2.0, 0).dy);
  return b > a * 2.5;
})());
/* NaN 兜底：幅度非法时不能算出 NaN（否则 translate3d 整条作废、格子僵在原点） */
ok("越界幅度非法时位移仍是有限数", (function () {
  const cell = { gx: 10, gy: 15, dir: 1, jit: 1, esc: 0.3 };
  const p = I.scatterPose("spray", 1, 1, cell, NaN, 0);
  return isFinite(p.dy) && isFinite(p.scale) && isFinite(p.opMul);
})());
ok("四套动画在极端输入下都不返回 NaN", (function () {
  const cell = { gx: 10, gy: 15, dir: 1, jit: 1, esc: 0.3 };
  return I.SCATTER_STYLES.every(function (style) {
    const p = I.scatterPose(style, 1, 0.5, cell, undefined, 0);
    return isFinite(p.dy) && isFinite(p.scale) && isFinite(p.opMul);
  });
})());
/* 次高 → 最高档的衔接：全局进度 0→1 时，越靠左起势越晚（一道从滑块推出去的波） */
ok("过渡起点：进度 0 时整片都不飞", I.scatterLocal(0, 0) === 0 && I.scatterLocal(0, 1) === 0);
ok("过渡终点：进度 1 时整片都到位", I.scatterLocal(1, 0) === 1 && I.scatterLocal(1, 1) === 1);
/* 线性夹取在起点/终点各有一个斜率折点，位移看起来像"卡"一下才开始。smoothstep 两端导数为 0。 */
ok("错峰曲线两端导数为 0（起势与落位都是渐入渐出）", (function () {
  const e = 1e-4;
  const head = I.scatterLocal(e, 0) / e;
  const tail = (1 - I.scatterLocal(1 - e, 0)) / e;
  return head < 0.05 && tail < 0.05;
})());
ok("过渡中途：靠滑块的一侧先动（波从右往左推）",
  I.scatterLocal(0.5, 0) > I.scatterLocal(0.5, 0.5)
  && I.scatterLocal(0.5, 0.5) > I.scatterLocal(0.5, 1),
  [0, 0.5, 1].map(function (sc) { return I.scatterLocal(0.5, sc).toFixed(2); }).join(","));
ok("单格进度随全局进度单调不减", (function () {
  let prev = -1;
  for (let i = 0; i <= 10; i += 1) {
    const v = I.scatterLocal(i / 10, 0.6);
    if (v < prev) return false;
    prev = v;
  }
  return true;
})());
ok("粒子层允许溢出轨道上下边界", I.CSS.indexOf(".dem-mosaic{") !== -1
  && /\.dem-mosaic\{[^}]*overflow:visible/.test(I.CSS));
/* 裁切层必须放行纵向溢出：最高档的"越界"就是方块飞出轨道上下边，
   设成 hidden 会把整套飞出动画裁掉。上边界齐不齐由粒子层的盒子（top/height 对齐可见带）保证。 */
ok("裁切层放行纵向溢出（越界动画靠它）", /\.dem-mosaic-clip\{[^}]*overflow:visible/.test(I.CSS));
ok("粒子层盒子与可见带同高（上边界不齐的根因）",
  /\.dem-mosaic\{[^}]*top:0;height:var\(--dem-fill-h/.test(I.CSS));
/* 左端帽必须单独裁：越界模式下不再靠 border-radius 收圆，缺了这层方块会从端帽探出去。 */
ok("左端帽挂了圆盘遮罩（越界时也不会从端帽探出）",
  /\.dem-mosaic\{[^}]*radial-gradient\(circle at calc\(var\(--dem-fill-h/.test(I.CSS));
ok("进/退越界不再切 overflow 状态（避免衔接处硬切）", !/data-scatter='1'\]/.test(I.CSS));
/* 收口必须跟着滑块走：写死「轨道高/2」时，滑块调到 28px 就会有一圈填充露在滑块外面。 */
ok("环是 3px 壁、其余是 1px 描边", I.knobBorderWidthOf({ knobShape: "ring" }) === 3
  && I.knobBorderWidthOf({ knobShape: "circle" }) === 1
  && I.knobBorderWidthOf({ knobShape: "pill" }) === 1
  && I.knobBorderWidthOf({ knobShape: "blade" }) === 1);
/* 滑块比轨道小时，带高必须跟着缩 —— 否则填充/粒子比滑块上下各宽 1px，接缝露出蓝边。 */
ok("带高跟着滑块缩（28 → 28，30 → 30，34 → 30）",
  I.bandHeightOf({ knobSize: 28 }) === 28
  && I.bandHeightOf({ knobSize: 30 }) === 30
  && I.bandHeightOf({ knobSize: 34 }) === 30,
  [28, 30, 34].map(function (s) { return I.bandHeightOf({ knobSize: s }); }).join(","));
ok("轨道凹槽只画在可见带里（上下留出等于带高的差）",
  /\.dem-track\{[^}]*padding:var\(--dem-band-inset/.test(I.CSS)
  && /\.dem-track\{[^}]*background-clip:content-box/.test(I.CSS));
ok("粒子裁切层跟着带高走", /\.dem-mosaic-clip\{[^}]*height:var\(--dem-fill-h/.test(I.CSS));
ok("填充右端圆角跟着滑块（不是写死半高）", /\.dem-fill\{[^}]*border-radius[^}]*var\(--dem-fill-tail-radius/.test(I.CSS));
ok("收口遮罩 = 竖切 + 圆盘两层（并集）", (function () {
  const rule = /\.dem-fill\{[^}]*\}/.exec(I.CSS);
  if (!rule) return false;
  const text = rule[0];
  return text.indexOf("linear-gradient(90deg,#000 0 var(--dem-fill-tail-x") !== -1
    && text.indexOf("radial-gradient(circle at var(--dem-fill-tail-x") !== -1
    && text.indexOf("mask-image") !== -1;
})(), /\.dem-fill\{[^}]*\}/.exec(I.CSS));
ok("粒子层与填充层共用同一条收口遮罩", (function () {
  const pick = function (name) {
    const m = new RegExp("\\." + name + "\\{[^}]*\\}").exec(I.CSS);
    return m ? m[0] : "";
  };
  const fill = pick("dem-fill");
  const clip = pick("dem-mosaic-clip");
  return fill.indexOf("mask-image") !== -1 && clip.indexOf("mask-image") !== -1
    && fill.indexOf("var(--dem-fill-tail-x") !== -1 && clip.indexOf("var(--dem-fill-tail-x") !== -1;
})());
ok("圆心/半径两个变量每层都要写（webkit + 标准）", I.CSS.split("var(--dem-fill-tail-x").length - 1 >= 4);
ok("方块缩放基准钉在左上角", /\.dem-cell\{[^}]*transform-origin:0 0/.test(I.CSS));
ok("非法点亮样式回落到能量波", I.normalizeSettings({ burstStyle: "starwars" }).burstStyle === "ripple");
ok("四种样式各有独立动画规则", ["ripple", "scan", "shatter", "pulse"].every(function (s) {
  return I.CSS.indexOf("[data-burst-style='" + s + "']") !== -1;
}), I.CSS.indexOf("[data-burst-style='scan']"));
ok("扫描线有自己的关键帧", I.CSS.indexOf("@keyframes demScan{") !== -1);
ok("爆散有自己的关键帧", I.CSS.indexOf("@keyframes demShatter{") !== -1);
ok("呼吸有自己的关键帧", I.CSS.indexOf("@keyframes demPulse{") !== -1);
ok("圆形的行程宽度等于直径", I.knobWidthOf({ knobShape: "circle", knobSize: 30 }) === 30);
ok("胶囊横向拉长", I.knobWidthOf({ knobShape: "pill", knobSize: 30 }) > 40, I.knobWidthOf({ knobShape: "pill", knobSize: 30 }));
ok("细棒收窄", I.knobWidthOf({ knobShape: "blade", knobSize: 30 }) < 16, I.knobWidthOf({ knobShape: "blade", knobSize: 30 }));
ok("环心是透空的一层薄白，不是实心", (function () {
  var s = I.knobSurfaceOf({ knobShape: "ring", knobFill: "white" }, I.paletteOf("#4A84FF"));
  return s.indexOf("rgba(255,255,255") === 0 && s.indexOf("linear-gradient") === -1;
})(), I.knobSurfaceOf({ knobShape: "ring", knobFill: "white" }, I.paletteOf("#4A84FF")));
ok("环的内光比白瓷更弱", (function () {
  var ring = I.knobSheenOf({ knobShape: "ring", knobFill: "white" });
  var white = I.knobSheenOf({ knobShape: "circle", knobFill: "white" });
  return ring.length < white.length;
})());
ok("白瓷是竖向渐变而不是纯平涂", I.knobSurfaceOf({ knobShape: "circle", knobFill: "white" }, I.paletteOf("#4A84FF")).indexOf("linear-gradient") !== -1);
ok("强调色珠带自己的色阶", I.knobSurfaceOf({ knobShape: "circle", knobFill: "accent" }, I.paletteOf("#4A84FF")).indexOf("#4a84ff".toUpperCase()) !== -1
  || I.knobSurfaceOf({ knobShape: "circle", knobFill: "accent" }, I.paletteOf("#4A84FF")).indexOf("#4A84FF") !== -1);
ok("最高档字符默认跟随强调色", I.tintColorOf({ accent: "#4A84FF", tintMode: "accent" }) === "#4A84FF");
ok("最高档字符可独立指定", I.tintColorOf({ tintMode: "custom", tintColor: "#E8B33C" }) === "#E8B33C");
ok("改设置立即写回快照", (() => {
  I.updateSettings({ knobSize: 30, burstSpeed: 1.2 });
  const v = I.getSettings();
  const okv = v.knobSize === 30 && Math.abs(v.burstSpeed - 1.2) < 1e-9;
  I.resetSettings();
  return okv;
})());
ok("恢复默认后回到设计稿强调色", (() => {
  I.updateSettings({ accent: "#F2784B" });
  const back = I.resetSettings();
  return back.accent === "#4A84FF" && back.knobShape === "circle" && back.knobSize === 30;
})());

/* ── findEffortRow 的两种认法 ── */
const rowEl = fakeEl("button");
const menuTwo = {
  querySelectorAll: () => [fakeEl("button"), rowEl],
};
ok("两个 menuitem 时取第 2 个", I.findEffortRow(menuTwo) === rowEl);
const zhRow = fakeEl("button");
zhRow.textContent = "推理等级 High";
const menuOne = { querySelectorAll: () => [zhRow] };
ok("按中文文案认出", I.findEffortRow(menuOne) === zhRow);
ok("空菜单返回 null", I.findEffortRow(null) === null);

/* ── 松手吸附曲线（settleAt）──
   要求：起点等于松手位置、终点落在档位、朝目标的初速不会冲过头、
   背离目标的初速会被"接住"再回来、接近终点时速度已经收住（不是硬刹）。 */
ok("吸附曲线起点就是松手位置", Math.abs(I.settleAt(0.3, 0.333, 0, 0) - 0.3) < 1e-9);
ok("吸附曲线落在目标档", Math.abs(I.settleAt(0.3, 0.333, 0, 0.42) - 0.333) < 1e-3);
ok("已经在档位上就不动", [0, 0.1, 0.42].every(
  (t) => Math.abs(I.settleAt(0.333, 0.333, 3, t) - 0.333) < 1e-9));
ok("朝目标的初速不会冲过档位", (function () {
  for (const v of [0, 0.2, 1, 6, 50]) {
    let prev = 0.3;
    for (let t = 0; t <= 0.5; t += 0.005) {
      const x = I.settleAt(0.3, 0.333, v, t);
      if (x < prev - 1e-9 || x > 0.333 + 1e-9) return false;
      prev = x;
    }
  }
  return true;
})());
ok("背离目标的初速会被接住再回到档位", (function () {
  let min = 1;
  for (let t = 0; t <= 0.5; t += 0.005) min = Math.min(min, I.settleAt(0.3, 0.333, -6, t));
  return min > 0.28 && Math.abs(I.settleAt(0.3, 0.333, -6, 0.42) - 0.333) < 1e-3;
})());
ok("起步速度等于松手速度（起点不会顿一下）", (function () {
  const e = 1e-4;
  const v = (I.settleAt(0.3, 0.6, 2.5, e) - I.settleAt(0.3, 0.6, 2.5, 0)) / e;
  return Math.abs(v - 2.5) < 0.2;
})());
ok("接近终点时速度已经收住（不是硬刹）", (function () {
  const e = 1e-3;
  let peak = 0;
  for (let t = 0; t <= 0.5; t += 0.005) {
    peak = Math.max(peak, Math.abs(
      I.settleAt(0.3, 0.333, 0, t + e) - I.settleAt(0.3, 0.333, 0, t)) / e);
  }
  const vNear = Math.abs(
    I.settleAt(0.3, 0.333, 0, 0.25 + e) - I.settleAt(0.3, 0.333, 0, 0.25)) / e;
  return peak > 0.1 && vNear < peak * 0.25;
})());
ok("吸附不再依赖 CSS 动画（改由 rAF 逐帧驱动）", !/demKnobPop/.test(I.CSS));
ok("填充与滑块共用同一条过渡时长", /\.dem-fill\{[^}]*transition:width \.3s/.test(I.CSS)
  && /\.dem-knob\{[^}]*transition:left \.3s/.test(I.CSS));

/* ── 点击落档（方案 B）──
   点击不再"先跳到指针再滑回来"：判最近档后，从滑块当前位置用一条更柔的
   临界阻尼曲线滑过去（TAP_OMEGA），起手 0 速度、全程不过冲。 */
ok("点击用的角频率比松手吸附更柔", I.TAP_OMEGA > 0 && I.TAP_OMEGA < I.SETTLE_OMEGA,
  String(I.TAP_OMEGA));
ok("点击/拖动的判定阈值是 5px", I.TAP_SLOP === 5, String(I.TAP_SLOP));
ok("settleAt 接受自定义角频率", (function () {
  const soft = I.settleAt(0.2, 0.667, 0, 0.12, I.TAP_OMEGA);
  const firm = I.settleAt(0.2, 0.667, 0, 0.12, I.SETTLE_OMEGA);
  /* 同一时刻，更柔的那条走得少一点（离起点更近） */
  return Math.abs(soft - 0.2) < Math.abs(firm - 0.2);
})());
ok("点击曲线从当前位置起步（不经过指针）", Math.abs(I.settleAt(0.333, 0.667, 0, 0, I.TAP_OMEGA) - 0.333) < 1e-9);
ok("点击曲线不过冲、单调靠近目标", (function () {
  const from = 0.334;
  const to = 0.667;
  let prev = from;
  for (let t = 0; t <= 0.46; t += 0.004) {
    const x = I.settleAt(from, to, 0, t, I.TAP_OMEGA);
    if (x < prev - 1e-9 || x > to + 1e-9) return false;
    prev = x;
  }
  return true;
})());
ok("点击曲线 340ms 内走完九成五", (function () {
  const x = I.settleAt(0.334, 0.667, 0, 0.34, I.TAP_OMEGA);
  return (x - 0.334) / (0.667 - 0.334) > 0.95;
})(), I.settleAt(0.334, 0.667, 0, 0.34, I.TAP_OMEGA).toFixed(4));
ok("点击曲线起手速度为 0（不会先窜出去）", (function () {
  const e = 1e-4;
  const v = (I.settleAt(0.334, 0.667, 0, e, I.TAP_OMEGA) - 0.334) / e;
  return v < 0.2;
})());
/* 收尾时间按 9.5/ω 算：到那一刻残余必须小于 0.1% 的行程，否则会"啪"地贴上档位 */
ok("收尾时刻残余小于 0.1%（不会硬贴上去）", (function () {
  const from = 0, to = 1;
  return [I.TAP_OMEGA, I.SETTLE_OMEGA].every(function (w) {
    const t = Math.min(0.62, 9.5 / w);
    return Math.abs(I.settleAt(from, to, 0, t, w) - to) < 0.001;
  });
})());
/* 结构断言：回弹感的来源是"按下就跳到指针处"，这段源码里不该再出现 setDragPct */
ok("按下不移动滑块（先跳后回的来源已移除）", (function () {
  const a = SRC.indexOf("function onPointerDown");
  const b = SRC.indexOf("function onPointerMove");
  return a > 0 && b > a && !/setDragPct/.test(SRC.slice(a, b));
})());
ok("点击落档以 TAP_OMEGA 起吸附", /beginSettle\(pctOfIndex\(tapTo[^)]*\),\s*0,\s*TAP_OMEGA\)/.test(SRC));
ok("拖动松手仍接住指针初速", /beginSettle\(pctOfIndex\(target, now\.count\), speed\)/.test(SRC));
/* ── 点亮时机：切到最高档时，动画必须等滑块落位，不能抢在滑块前面 ── */
ok("点亮排队到落位，收尾时兑现", (function () {
  var def = /function flushPendingBurst\(\)/.test(SRC);
  var calls = (SRC.match(/flushPendingBurst\(\)/g) || []).length;
  return def && calls >= 3;            /* 定义 1 次 + beginSettle 里两处调用 */
})());
ok("切档处理器不再直接播点亮", (SRC.match(/now\.fireBurst\(\)/g) || []).length === 1,
  String((SRC.match(/now\.fireBurst\(\)/g) || []).length));
ok("点击 / 松手 / 键盘三条路径都只是排队", (SRC.match(/now\.armBurstOnLand\(\)/g) || []).length === 3,
  String((SRC.match(/now\.armBurstOnLand\(\)/g) || []).length));
ok("落位前 shownIndex 副作用让位给吸附", /settleRef\.current !== null \|\| burstPendingRef\.current/.test(SRC));
ok("重新按住会丢弃未兑现的点亮", /dropPendingBurst/.test(SRC));

/* ── 报告 ── */
if (fails.length === 0) {
  console.log(`OK  ${pass} 项全部通过`);
  process.exit(0);
}
console.log(`FAIL  ${fails.length} 项未通过（通过 ${pass} 项）`);
for (const f of fails) console.log("  - " + f);
process.exit(1);
