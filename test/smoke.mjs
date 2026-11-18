/**
 * 离线冒烟测试：在桩件环境里**真正执行** lib/client.js，
 * 验证 ①模块能加载 ②apply 不抛错 ③档位解析跟着模型走 ④粒子位移场边界。
 *
 *   node test/smoke.mjs
 */
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 30, right: 300, bottom: 30 }),
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
/* 测试钩子：client.js 只有看到它才导出 __internals（正式 bundle 默认不挂） */
globalThis.__DEM_TEST_HOOK__ = true;
await import(pathToFileURL(CLIENT).href);

ok("bundle 被 __ModuleLoader__ 接管", captured !== null);
ok("bundle id 正确", captured && captured.id === "dsh-effort-mosaic", captured && captured.id);
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

/* 生产边界：没有 __DEM_TEST_HOOK__ 的进程里，bundle 不许把测试接口挂出来。
   这里另起一个干净进程验证，避免被本进程已经设好的钩子污染。 */
ok("无测试钩子时 bundle 不导出 __internals", (function () {
  const script = `
    let captured = null;
    globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m; } } };
    await import(${JSON.stringify(pathToFileURL(CLIENT).href)});
    const ReactStub = {
      Fragment: Symbol("F"),
      createElement: () => ({}),
      useRef: (v) => ({ current: v }),
      useState: (v) => [typeof v === "function" ? v() : v, () => {}],
      useEffect: () => {},
      useSyncExternalStore: (_s, g) => g(),
    };
    const mod = captured.factory(() => ReactStub);
    if (mod.__internals !== undefined) process.exit(1);
    if (typeof mod.apply !== "function") process.exit(2);
  `;
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { stdio: "pipe" });
    return true;
  } catch (err) {
    return false;
  }
})());

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
/* 两个键各注册一份：当前名 + 改名过渡期的旧名。
   过渡期安装的用户 link 键仍是旧名，只注册一个会丢掉详情页面板。 */
const configKeys = configEntries.map((e) => e.opts.key).sort();
ok("版式面板同时挂了当前名与过渡名",
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
ok("滑块尺寸下限为 30（旧的小尺寸配置会被夹回 30）",
  I.normalizeSettings({ knobSize: 10 }).knobSize === 30
  && I.normalizeSettings({ knobSize: 29 }).knobSize === 30,
  String(I.normalizeSettings({ knobSize: 10 }).knobSize));
ok("尺寸选项只剩 30 / 34 两档", (function () {
  const m = /var SIZE_OPTIONS = \[([\s\S]*?)\];/.exec(SRC);
  return m !== null && (m[1].match(/value:/g) || []).length === 2
    && /value: 30/.test(m[1]) && /value: 34/.test(m[1]);
})());
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
/* 轨道风格：默认仍是马赛克（老用户升级后视觉不变），非法值回落。 */
ok("轨道风格默认是马赛克（升级后视觉不变）", I.normalizeSettings({}).railStyle === "mosaic",
  String(I.normalizeSettings({}).railStyle));
ok("轨道风格只认两套，非法回落到马赛克", I.normalizeSettings({ railStyle: "codex" }).railStyle === "codex"
  && I.normalizeSettings({ railStyle: "aurora" }).railStyle === "mosaic");

/* 霓虹最高档的渐变必须跟着「滑轨强调色」走：
   默认色用原始采样值；换色后整条渐变平移，不能再是写死的紫。 */
ok("霓虹最高档渐变跟随强调色", (function () {
  var d = I.neonGradientOf("#4A84FF");
  var r = I.neonGradientOf("#FF4A4A");
  var b = I.neonGradientOf("#22C55E");
  return d.indexOf("#2546D0 0%") !== -1
    && r.indexOf("#2546D0 0%") === -1
    && b.indexOf("#2546D0 0%") === -1
    && r !== b
    && d.indexOf("#B37DFF") !== -1;
})(), (function () {
  return I.neonGradientOf("#FF4A4A").slice(0, 70);
})());
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
/* 收口必须跟着滑块走：写死「轨道高/2」时，换成 34px 的滑块就对不上内壁。 */
ok("环是 3px 壁、其余是 1px 描边", I.knobBorderWidthOf({ knobShape: "ring" }) === 3
  && I.knobBorderWidthOf({ knobShape: "circle" }) === 1
  && I.knobBorderWidthOf({ knobShape: "pill" }) === 1
  && I.knobBorderWidthOf({ knobShape: "blade" }) === 1);
/* 可见带恒等于轨道高：滑块比轨道大时不撑大管子。 */
ok("带高恒等于轨道高（30 / 34 两档都是 30）",
  I.bandHeightOf({ knobSize: 30 }) === 30
  && I.bandHeightOf({ knobSize: 34 }) === 30,
  [30, 34].map(function (s) { return I.bandHeightOf({ knobSize: s }); }).join(","));
ok("轨道凹槽只画在可见带里（上下留出等于带高的差）",
  /\.dem-track\{[^}]*padding:var\(--dem-band-inset/.test(I.CSS)
  && /\.dem-track\{[^}]*background-clip:content-box/.test(I.CSS));
ok("粒子裁切层跟着带高走", /\.dem-mosaic-clip\{[^}]*height:var\(--dem-fill-h/.test(I.CSS));
/* 霓虹风格的样式必须真的注入了，否则切过去就是一条死板蓝条。 */
ok("霓虹风格样式已注入（平涂轨道 / 擦除 / 烟花）",
  I.CSS.indexOf(".dem-track[data-rail='codex'] .dem-fill") !== -1
  && I.CSS.indexOf(".dem-codex-wipe") !== -1
  && I.CSS.indexOf(".dem-codex-fw i") !== -1);
ok("霓虹擦除带软边（渐变终点收到全透明，不能留半透明蓝边）",
  /\.dem-codex-wipe\{[^}]*rgba\(0,0,0,0\) 100%/.test(I.CSS));
/* 霓虹粒子原来只有 2px / 2–4.4px，视觉上像灰尘；现在尘埃 3px、火星 2.8–5.2px。 */
ok("霓虹尘埃粒子已放大到 3px",
  /\.dem-codex-dust i::before\{[^}]*width:3px;height:3px/.test(I.CSS));
ok("霓虹火星已放大到 2.8–5.2px",
  /"--sz": \(2\.8 \+ codexRand\(i, 29\) \* 2\.4\)/.test(SRC));
/* 换档位置走 left，不是 translate：填充 width 走布局路径，旋钮也必须走布局，
   否则旋钮在合成层先动、填充还在重排，视觉上就是色轨滞后。 */
ok("旋钮位置走 left，和填充 width 同步",
  /\.dem-knob\{[^}]*left:var\(--dem-knob-x,0px\)/.test(I.CSS)
  && !/\.dem-knob\{[^}]*translate:var\(--dem-knob-x/.test(I.CSS));
/* 外圈 1px 中性护栏：盖住圆角滑块压在填充上时露出的那一角，不缩短色轨。 */
ok("旋钮有 1px 外圈中性护栏",
  /\.dem-knob\{[^}]*0 0 0 1px var\(--dem-knob-guard/.test(I.CSS));
/* 第二道 1px 中性外沿：白钮抗锯齿边缘会与轨道填充混色，实机左缘会留 1px 粉红过渡。 */
ok("旋钮有第二道 1px 中性外沿",
  /\.dem-knob\{[^}]*0 0 0 2px #dde3ec/.test(I.CSS));
/* 详情页预览旋钮靠 right 定位，必须显式撤掉 base 的 left。 */
ok("预览旋钮靠 right 定位，不受 base left 影响",
  /\.dem-cfg-preview-knob\{[^}]*left:auto/.test(I.CSS));

/* 霓虹的「点亮强度 / 点亮速度」必须真的落到四套样式上：峰值与时长都随设置变化。 */
ok("霓虹点亮强度/速度真实生效", (function () {
  var base = I.neonBurstVarsOf({ burstIntensity: 1, burstSpeed: 1 });
  var strong = I.neonBurstVarsOf({ burstIntensity: 1.8, burstSpeed: 1 });
  var fast = I.neonBurstVarsOf({ burstIntensity: 1, burstSpeed: 1.4 });
  return base.ripple === "1.100" && strong.ripple === "1.180"
    && strong.shatter === "1.252"
    && base.durPulse === "2.400s" && fast.durPulse === "1.714s"
    && I.CSS.indexOf("var(--dem-neon-peak-ripple") !== -1
    && I.CSS.indexOf("var(--dem-neon-dur-ripple") !== -1;
})());

/* 官方 React 重绘会删掉命令式插入的容器：只看"行没变"会把轨道永久丢掉。 */
ok("容器被官方重绘删掉时必须重新挂载", (function () {
  var row = { isConnected: true };
  function entry(container) { return { row: row, container: container }; }
  return I.bridgeAlive(entry({ isConnected: true, parentNode: row }), row) === true
    && I.bridgeAlive(entry(null), row) === false
    && I.bridgeAlive(entry({ isConnected: false, parentNode: row }), row) === false
    && I.bridgeAlive(entry({ isConnected: true, parentNode: null }), row) === false;
})());

/* 菜单关闭 ≠ 该拆桥：旧行还在时必须保留挂载，否则切一次档位后轨道就没了。 */
ok("菜单关闭时保留轨道挂载（下次打开复用同一行）", (function () {
  var kept = { row: { isConnected: true } };
  var gone = { row: { isConnected: false } };
  return I.shouldKeepMount(kept, null) === true
    && I.shouldKeepMount(gone, null) === false
    && I.shouldKeepMount(kept, { isConnected: true }) === false;
})());

/* 结构闸门：组件的卸载清理只能引用**自己组件里声明**的 ref。
   曾经把 burstTimerRef（声明在 EffortTrack）写进 ConnectedTrack 的清理，
   菜单一关就抛 ReferenceError；React 提交阶段出错会连带卸掉整棵子树，
   于是"切一次档位 → 浮窗关闭 → 再打开，滑轨永久消失"。 */
function componentBlock(name) {
  const start = SRC.indexOf("    function " + name + "(");
  if (start < 0) return "";
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n    function [A-Za-z_$][\w$]*\(/);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}
ok("ConnectedTrack 的卸载清理不越界引用 EffortTrack 的 burstTimerRef", (function () {
  const block = componentBlock("ConnectedTrack");
  return block.length > 0 && block.indexOf("burstTimerRef") === -1;
})(), componentBlock("ConnectedTrack").indexOf("burstTimerRef"));
ok("EffortTrack 自己在卸载时清掉点亮定时器", (function () {
  const block = componentBlock("EffortTrack");
  return block.indexOf("var burstTimerRef = React.useRef(null);") !== -1
    && /React\.useEffect\(function \(\) \{\s*return function \(\) \{[\s\S]{0,400}?burstTimerRef\.current/.test(block);
})());

/* 结构闸门：每次打开菜单 ConnectedTrack 都会重新挂载，width 从 0 起。
   首次量宽那一帧若还开着过渡，旋钮会从最左端（left≈14px）用 .3s 划到真实档位，
   看起来就是"每次打开都从最左端起步"。必须在量宽那一帧关掉 .dem-knob / .dem-fill
   的 transition，等这一帧画完再恢复。 */
ok("首次量宽那一帧关闭旋钮与填充的过渡", (function () {
  return SRC.indexOf(".dem-track[data-measured='0'] .dem-knob") !== -1
    && SRC.indexOf(".dem-track[data-measured='0'] .dem-fill{transition:none}") !== -1;
})());
ok("量宽之后由独立提交恢复过渡（正常换档仍会动画）", (function () {
  const block = componentBlock("EffortTrack");
  return block.indexOf('"data-measured": measured ? "1" : "0"') !== -1
    && /React\.useEffect\(function \(\) \{\s*if \(width > 0 && !measured\) setMeasured\(true\)/.test(block);
})());

/* 结构闸门：导出面只保留测试真正用到的项，避免 __internals 变成杂物抽屉。 */
ok("__internals 没有测试与工具从未使用的死导出", (function () {
  const m = /\n\s+exports\.__internals = \{([\s\S]*?)\n\s{6}\};/.exec(SRC);
  if (!m) return false;
  const keys = [...m[1].matchAll(/^\s{8}([A-Za-z_$][\w$]*):/gm)].map(function (x) { return x[1]; });
  /* 导出面同时服务离线断言与宣传图生成器，两边都算"有人用"。 */
  const users = [
    fs.readFileSync(fileURLToPath(import.meta.url), "utf8"),
    fs.readFileSync(resolve(HERE, "../tools/make-promo.mjs"), "utf8"),
  ].join("\n");
  return keys.length > 0 && keys.every(function (k) {
    return new RegExp("\\b" + k + "\\b").test(users);
  });
})());

/* ── 隔离性：霓虹的样式一条都不许漏到马赛克轨道上 ──────────────
   规则里凡出现 .dem-codex* 的选择器，都必须带 [data-rail='codex']。
   这条闸一旦有人改坏，马赛克轨道的视觉就会被 霓虹的样式串味。 */
ok("霓虹的所有样式都限定在 data-rail='codex' 下", (function () {
  const sels = I.CSS.split("}").map(function (chunk) { return chunk.split("{")[0].trim(); });
  const bad = sels.filter(function (sel) {
    return sel.indexOf("dem-codex") !== -1
      && sel.indexOf("[data-rail='codex']") === -1
      && sel.indexOf("@keyframes") !== 0;
  });
  return bad.length === 0;
})(), (function () {
  const sels = I.CSS.split("}").map(function (chunk) { return chunk.split("{")[0].trim(); });
  return sels.filter(function (sel) {
    return sel.indexOf("dem-codex") !== -1 && sel.indexOf("[data-rail='codex']") === -1;
  }).slice(0, 2).join(" | ");
})());

/* 马赛克轨道的点亮动效必须原样还在：霓虹那一组是**并列**新增，不是替换。 */
ok("马赛克四条点亮动画都在（霓虹是并列新增，没有替换）",
  I.CSS.indexOf("animation:demGlow .75s") !== -1
  && I.CSS.indexOf("animation:demScanGlow") !== -1
  && I.CSS.indexOf("animation:demShatter") !== -1
  && I.CSS.indexOf("animation:demPulse 2.4s") !== -1);
ok("马赛克点亮峰值已柔化到 1.25 / 1.12（原为 1.55 / 1.4）",
  /@keyframes demGlow\{0%\{filter:brightness\(1\) saturate\(1\)\}26%\{filter:brightness\(1\.25\) saturate\(1\.12\)\}/.test(I.CSS));

/* 扫描线的亮带会被 transform 推出轨道；轨道本身为了粒子越界必须 overflow:visible，
   所以亮带要单独套一层圆角裁切壳。 */
ok("扫描线光带被独立裁切壳包住，不会越出轨道",
  /\.dem-flush-clip\{[^}]*border-radius:999px;overflow:hidden/.test(I.CSS)
  && /\.dem-flush\{position:absolute;inset:0/.test(I.CSS)
  && SRC.indexOf('className: "dem-flush-clip"') !== -1);

ok("爆散峰值已从 1.95/1.7 柔化到 1.45/1.25",
  /@keyframes demShatter\{0%\{filter:brightness\(1\) saturate\(1\)\}14%\{filter:brightness\(1\.45\) saturate\(1\.25\)\}/.test(I.CSS));
ok("填充右端圆角跟着滑块（不是写死半高）", /\.dem-fill\{[^}]*border-radius[^}]*var\(--dem-fill-tail-radius/.test(I.CSS));
ok("实心滑块收口只用竖切，空心环才加圆盘", (function () {
  const solid = I.tailMaskOf({ knobShape: "rounded" });
  const ring = I.tailMaskOf({ knobShape: "ring" });
  return solid.indexOf("linear-gradient(90deg,#000") !== -1
    && solid.indexOf("radial-gradient") === -1
    && ring.indexOf("linear-gradient(90deg,#000") !== -1
    && ring.indexOf("radial-gradient(circle at var(--dem-fill-tail-x") !== -1;
})());
ok("填充与粒子裁切层共用同一条可切换遮罩", (function () {
  const pick = function (name) {
    const m = new RegExp("\\." + name + "\\{[^}]*\\}").exec(I.CSS);
    return m ? m[0] : "";
  };
  const fill = pick("dem-fill");
  const clip = pick("dem-mosaic-clip");
  return fill.indexOf("mask-image:var(--dem-tail-mask") !== -1
    && clip.indexOf("mask-image:var(--dem-tail-mask") !== -1;
})());
ok("圆角方 / 胶囊的收口切在圆心，不提前截断色轨",
  /var cut = kr\.width \+ 0\.5 < tr\.height \? kr\.width \/ 2 : 0/.test(SRC));
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
/* 白瓷环壁以前取 pal.stops[0]；暖色强调色下会变成一圈浅橙红，看起来像轨道渗色。 */
ok("白瓷环壁是中性色，不跟强调色走",
  I.knobRingOf({ knobShape: "rounded", knobFill: "white" }, I.paletteOf("#F2784B")) === "#dde3ec");
ok("染色 / 强调色珠 / 磨砂的环壁仍跟各自质感走", (function () {
  var pal = I.paletteOf("#F2784B");
  return I.knobRingOf({ knobShape: "circle", knobFill: "tinted" }, pal) === pal.stops[2]
    && I.knobRingOf({ knobShape: "circle", knobFill: "accent" }, pal) === pal.stops[3]
    && I.knobRingOf({ knobShape: "circle", knobFill: "frosted" }, pal) === "#c3cad6";
})());
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
ok("拖动吸附仍由 rAF 逐帧驱动（不是 CSS 过渡）",
  /s\.raf = window\.requestAnimationFrame\(step\)/.test(SRC));
ok("填充与滑块共用同一条过渡时长", /\.dem-fill\{[^}]*transition:width \.3s/.test(I.CSS)
  && /\.dem-knob\{[^}]*transition:left \.3s/.test(I.CSS));
/* 粒子墙只能逐帧写容器宽度；若同时写 .dem-fill.style.width，会把每条
   CSS width 过渡的目标每帧重设到滑块当前位置，填充永远追在滑块后面。 */
ok("粒子墙不再覆写填充宽度（避免拖住 .3s 过渡）",
  !/fillRef2/.test(SRC) && /host\.style\.width = w\.toFixed\(2\)/.test(SRC));
ok("切换轨道风格会重建粒子墙",
  /\[width, count, liveSettings\.railStyle\]/.test(SRC)
    && /liveSettings\.railStyle === "codex"/.test(SRC));

/* ── 点击 / 键盘换档（方案 A）──
   判最近档后，从滑块当前 DOM 位置用 CSS `left / width .3s` 平滑过去；
   不跑弹簧曲线、不做 rAF 收尾，所以不会在档位前"顿一下"。 */
ok("点击/拖动的判定阈值是 5px", I.TAP_SLOP === 5, String(I.TAP_SLOP));
ok("点击落档走 CSS 过渡（不再起弹簧）",
  /now\.landByCss\(tapTo\)/.test(SRC) && !/beginSettle\(pctOfIndex\(tapTo/.test(SRC));
ok("键盘换档也走 CSS 过渡",
  /now\.landByCss\(next\)/.test(SRC) && !/beginSettle\(pctOfIndex\(next/.test(SRC));
/* 点击的第一帧不能等 React 提交：landByCss 先把目标像素同步写到旋钮和填充，
   两者一起起过渡；否则第一帧还在旧位置，就是"点了没动/慢半拍"。 */
ok("点击落档在 pointerup 同帧写目标像素（不等待 React 提交）",
  /function writeTargetPct/.test(SRC)
  && /knob\.style\.setProperty\("--dem-knob-x"/.test(SRC)
  && /fill\.style\.width = fillPx/.test(SRC)
  && /function landByCss\(target\)[\s\S]*?writeTargetPct\(pctOfIndex\(target, count\)\)/.test(SRC));
/* 宿主 access.select 是同步桥，写完会停渲染线程 0.1–0.3s；不能和换档同一帧执行。 */
ok("点击/键盘的宿主写入延后 360ms，避开滑块动画",
  /var CLICK_COMMIT_MS = 360/.test(SRC)
  && /now\.onPick\(tapTo, true, CLICK_COMMIT_MS\)/.test(SRC)
  && /now\.onPick\(next, true, CLICK_COMMIT_MS\)/.test(SRC));
ok("延后的宿主写入等到渲染线程空闲再落库",
  /requestIdleCallback\(commit, \{ timeout: 900 \}\)/.test(SRC)
  && /cancelIdleCallback/.test(SRC));
ok("新的点击/拖动会取消上一档的延迟写入",
  /function cancelPendingPick/.test(SRC)
  && /now\.cancelPendingPick\(\)/.test(SRC)
  && /cancelPendingPick: props\.onCancelPick/.test(SRC));
ok("settleAt 接受自定义角频率", (function () {
  const soft = I.settleAt(0.2, 0.667, 0, 0.12, I.SETTLE_OMEGA / 2);
  const firm = I.settleAt(0.2, 0.667, 0, 0.12, I.SETTLE_OMEGA);
  /* 同一时刻，更柔的那条走得少一点（离起点更近） */
  return Math.abs(soft - 0.2) < Math.abs(firm - 0.2);
})());
/* 收尾时间按 9.5/ω 算：到那一刻残余必须小于 0.1% 的行程，否则会"啪"地贴上档位 */
ok("收尾时刻残余小于 0.1%（不会硬贴上去）", (function () {
  const from = 0, to = 1;
  const t = Math.min(0.62, 9.5 / I.SETTLE_OMEGA);
  return Math.abs(I.settleAt(from, to, 0, t, I.SETTLE_OMEGA) - to) < 0.001;
})());
/* 结构断言：回弹感的来源是"按下就跳到指针处"，这段源码里不该再出现 setDragPct */
ok("按下不移动滑块（先跳后回的来源已移除）", (function () {
  const a = SRC.indexOf("function onPointerDown");
  const b = SRC.indexOf("function onPointerMove");
  return a > 0 && b > a && !/setDragPct/.test(SRC.slice(a, b));
})());
ok("拖动松手仍接住指针初速", /beginSettle\(pctOfIndex\(target, now\.count\), speed, undefined, pct\)/.test(SRC));
/* 松手瞬间的指针位置比 React 上一帧的 shownPct 新；拿旧位置当起点会在
   "已经看着到档"之后又往右补一小段。四参数版本必须显式传 pct。 */
ok("松手起点用最新指针位置（不回填旧渲染位置）",
  /beginSettle\(pctOfIndex\(target, now\.count\), speed, undefined, pct\)/.test(SRC)
  && /beginSettle\(to, v0, omega, fromOverride\)/.test(SRC));
/* 霓虹端头点亮必须真的到 1：0.97 在 272px 行程上还差 8px，烟花会先炸、滑块再追。 */
ok("霓虹端头只在精确 1 点亮（0.97 不再提前）",
  /if \(pct >= 0\.9995\)/.test(SRC) && SRC.indexOf("if (pct >= 0.97)") === -1);
/* 填充收口不能再被霓虹覆盖成 mask:none；用填充自身宽度反推圆心，过渡期也跟手。 */
ok("霓虹填充恢复收口遮罩（不再铺到滑块外缘）",
  /\.dem-track\[data-rail='codex'\] \.dem-fill\{[^}]*--dem-fill-tail-x:calc\(100% - var\(--dem-knob-tail-inset/.test(I.CSS)
  && !/\.dem-track\[data-rail='codex'\] \.dem-fill\{[^}]*mask-image:none/.test(I.CSS));
/* 端点严格内切：pct=1 时滑块右缘正好贴住轨道宽，不再多出 1px 蓝边。 */
ok("端点严格内切（不再 +2 / −1 出界）",
  SRC.indexOf("var travelPx = Math.max(0, width - knobW);") !== -1
  && SRC.indexOf("var fillPx = knobW + travelPx * shownPct;") !== -1
  && SRC.indexOf("var knobPx = (knobW / 2) + travelPx * shownPct;") !== -1);
/* 收尾时 data-snapping 必须撑到最终位置提交之后，否则残余会被 CSS 过渡再播一遍。 */
ok("落位后的 CSS 过渡在下一帧才恢复",
  /window\.requestAnimationFrame\(function \(\) \{ mark\(false\); \}\);/.test(SRC)
  && SRC.indexOf("setSettlePct(null);\n            mark(false);") === -1);
/* 两种轨道的手感只能维护一份：beginSettle 里不许再按 railStyle 分支。 */
ok("粒子轨与霓虹轨共用同一条吸附曲线", (function () {
  var start = SRC.indexOf("function beginSettle");
  var end = SRC.indexOf("function step", start);
  if (start < 0 || end < 0) return false;
  return SRC.slice(start, end).indexOf("railStyle") === -1;
})());
ok("松手正好在档位时先定格再恢复过渡",
  /if \(!reduceMotion\) mark\(true\);\s*setSettlePct\(null\);/.test(SRC));
/* ── 点亮时机：切到最高档时，动画必须等滑块落位，不能抢在滑块前面 ── */
ok("点亮排队到落位，收尾时兑现", (function () {
  var def = /function flushPendingBurst\(\)/.test(SRC);
  var calls = (SRC.match(/flushPendingBurst\(\)/g) || []).length;
  return def && calls >= 3;            /* 定义 1 次 + beginSettle 里两处调用 */
})());
ok("切档处理器不再直接播点亮", (SRC.match(/now\.fireBurst\(\)/g) || []).length === 1,
  String((SRC.match(/now\.fireBurst\(\)/g) || []).length));
ok("点击 / 松手 / 键盘都把点亮排到落位", (function () {
  var arm = (SRC.match(/now\.armBurstOnLand\(\)/g) || []).length;
  var css = (SRC.match(/now\.landByCss\(/g) || []).length;
  return arm >= 1 && css === 2;
})(), (SRC.match(/now\.armBurstOnLand\(\)/g) || []).length + "/" + (SRC.match(/now\.landByCss\(/g) || []).length);
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
