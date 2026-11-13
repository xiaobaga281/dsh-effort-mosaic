/**
 * dsh-effort-mosaic — 客户端半边
 *
 * 把 DSH 官方模型菜单里的「推理等级」那一行，换成一条**像素马赛克粒子轨道**：
 *   · 右侧紧贴旋钮的那一段，是严丝合缝、绝对静止的密实马赛克墙
 *   · 越往左，方块越早脱离网格，向左漂移、上下散开、逐渐淡出，可以飞出轨道上下边界
 *   · 任何方块都不会越过轨道左边界
 *   · 档位越高（lv 越大），life 推进越快，最高档像水龙头全开
 *   · 拖到最高档：能量光从旋钮向左铺开 + 像素层故障风微抖（面板点亮的那个瞬间）
 *
 * ── 档位从哪来（这是本插件与"固定档位"版本的根本区别）────────────
 *   读：`ctx.modelDirectories.directoryFor(sessionId)` → `store.getSnapshot()`
 *       → `groups[].models[].reasoning.efforts` = 当前模型**真实声明**的档位表
 *   写：`directory.select({ provider, model, reasoningEffort })`（官方同一个写入口）
 *   订：`store.subscribe()` + `React.useSyncExternalStore`
 *   所以换模型、改模型配置、切会话，档位数量与名字都会实时跟着变。
 *
 * ── 官方锚点（全部是语义属性，不是哈希 class）────────────
 *   席：`button[aria-haspopup="menu"][aria-expanded="true"][aria-controls]`
 *   菜单：`document.getElementById(aria-controls)`
 *   行：菜单里 `button[role="menuitem"]` 的第 2 个（根面板恰好只有「模型 / 推理等级」两行）
 *   归属：从自己的插槽锚点向上找 `[data-composer-card]`，确保只动**自己这个** composer 的菜单
 *   任何一步认不出 → 什么都不做（fail-open），官方菜单保持原样。
 */
window.__ModuleLoader__.load({
  id: "dsh-effort-mosaic",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var ReactDOM = require("react-dom");

    var PACKAGE_ID = "dsh-effort-mosaic";
    var SLOT_NAME = "conversation.input.right";
    var ENTRY_ID = "effort-mosaic-anchor";
    var ENTRY_ORDER = 55;

    /** 官方那一行的中英文案（认不出就按固定顺序取第 2 个 menuitem）。 */
    var EFFORT_ROW_LABELS = ["推理等级", "Effort"];

    /* ── 几何 ────────────────────────────────────────────────────────── */
    /** 轨道高度。旋钮直径与它相同 —— 一个"管子里的球"，圆永远是完整的圆。 */
    var TRACK_HEIGHT = 30;
    /** 轨道右端安全区（px）：滑块在最高档时右缘不能贴死边界，
        描边和外光晕会溢出去被浮窗裁掉。所有"行程"公式里 100% 都换成 calc(100% - 它)。 */
    /**
     * 轨道本体左右各缩这么多（px），而不是让滑块内缩。
     * 滑块内缩会让"滑不到最左/最右端"；轨道内缩则滑块仍然贴着轨道两端，
     * 描边和外光晕溢出的是轨道外的这点余量，不会被外层容器裁掉。
     * 改成 0：轨道左右直接顶到容器边（菜单行两侧的留白由官方那一行给，这里不再额外缩）。
     */
    var TRACK_INSET = 0;
    var KNOB_SIZE = TRACK_HEIGHT;
    var KNOB_RADIUS = KNOB_SIZE / 2;

    /* ── 粒子墙参数：逐项照抄设计稿 思考强度轨道.html ────────────────── */
    /** 行数。设计稿是 30px 轨道 / CELL 5 = 6 行；这里 28px / ROWS 6 同样整除。 */
    var ROWS = 6;
    /** 横向格子边长 = 轨道高度 / 行数，保证 6 行严丝合缝铺满轨道。 */
    var CELL = TRACK_HEIGHT / ROWS;
    /**
     * 位移场指数 `amp = pow((d - D0) / (1 - D0), p)`。
     * 设计稿是 2.2，但那个幂让刚出静止区的方块位移不到 1px，"看起来静止"的一段
     * 会一路撑到轨道右侧 12% 左右，和设定的 2% 对不上。
     * 改成线性（1.0）：一出静止区就立刻有肉眼可见的位移，
     * 视觉静止区收敛到 1.3%–2.4%，与 2% 的设置一致。
     */
    var AMP_POWER = 1.0;
    /**
     * 静止区：`d = 1 - gx/w` 落在这段里就是贴网格的死墙。
     * 取 0.02，不是设计稿的 0.10 —— 0.10 是**几何**上的十分之一，但刚出静止区的格子
     * `amp` 只有零点零几、位移不到一个格子，加上淡入那几帧几乎透明，眼睛看到的静止区
     * 会一路撑到三分之一。压到 0.02、位移系数提到 0.42，"看起来静止"的那段
     * 收敛到轨道右侧的十分之一左右。
     */
    var STILL_ZONE = 0.02;
    /** 设计稿 `if (drift > gx + CELL*3) drift = gx + CELL*3` 的硬封顶，方块不越左边界。 */
    var MAX_DRIFT_CELLS = 3;
    /** 设计稿 `drift = amp * w * 0.35`：漂移量占**填充宽度**的比例。
     *  提到 0.40：静止区边上那几格要一出来就有肉眼可见的位移，否则"墙"的边界
     *  永远比参数里的比例宽一大截。 */
    var DRIFT_SPAN = 0.42;
    /* ── 松手吸附 ──────────────────────────────────────────────────
       滑块从松手位置滑到目标档用一条**临界阻尼**曲线，而不是 CSS 过渡：
       CSS 过渡的初速恒为 0，指针还在动的时候松手会明显"顿"一下；
       而之前 `data-snapping` 又把 transition 关掉，等于瞬移。两者都生硬。
       闭式解 x(t) = to + (A + B·t)·e^(−ωt)，A = from − to、B = v0 + ωA：
       初速 v0 直接接住松手前的指针速度，所以"滑一下松手"是一条顺的延长线。 */
    var SETTLE_OMEGA = 22;      /* 1/s，22 ≈ 0.22s 基本落位，再慢就有拖沓感 */
    /** 反算出"已经到位"的时间上限：超过它就不再逐帧算。 */
    var SETTLE_MAX_T = 0.42;
    /* ── 飞沫越界（「粒子越界 = 开」时生效）─────────────────────────────
       效果 = 一部分方块脱离轨道、向外飞散并缩小淡出，越往左逃得越多。
       这几个数按设计稿 D 版（飞沫）定，改之前先看 README 第 3 条。 */
    /** 右侧死区（占填充宽度的比例）：这一段是严丝合缝的墙，一格都不飞。 */
    var SCATTER_DEAD = 0.20;
    /** 逃逸比例 = FLOOR + GAIN × sc；sc 在死区右端是 0、最左端是 1。 */
    var SCATTER_FLOOR = 0.03;
    var SCATTER_GAIN = 0.72;
    /** 逃逸距离里"年龄"的占比：0.45 = 刚起飞的也在 45% 处，不会挤在轨道边上。 */
    var SCATTER_AGE_MIN = 0.45;
    /** 逃逸距离（单位：轨道高）。真机上再乘面板里的「越界幅度」：
        `1.0×` = 最远处飞出约一个轨道高（30px）。 */
    var SCATTER_REACH = 1.0;
    /** 飞得最远时缩到 0.5 倍：飞沫靠"变小"表达纵深，不靠拉伸。 */
    var SCATTER_SHRINK = 0.5;
    /**
     * 设计稿 `speedBase = 0.0022 + lv * 0.040`（每帧、60fps 基准）。
     * 这里按 dt/16.667 归一，掉帧时速度不变。
     */
    var SPEED_BASE = 0.0022;
    var SPEED_PER_LEVEL = 0.040;
    /** 淡出陡度 `op = 1 - fadeAmt * life^2.4`。 */
    var FADE_POWER = 2.4;
    /** 设计稿 `if (life < 0.09) op *= life/0.09` 的重生淡入。 */
    var FADE_IN_SPAN = 0.09;

    /* ── 主题：所有颜色都锚在 DSH 真实存在的别名令牌上 ──────────────────
     * 下面每个令牌都在 `D:\DSH\resources\app.asar` 里查到了成对定义，
     * 浅色主题 / 深色主题各一套（例如 `--dsw-alias-card-fill` 浅色是
     * `--dsw-static-neutral-50` 近白、深色是 `--dsw-static-neutral-850` 深灰）：
     *   --dsw-alias-bg-base          底色：浅色 bluish-00 白 / 深色 bluish-950 近黑
     *   --dsw-alias-card-fill        卡片填充：浅色 neutral-50 / 深色 neutral-850
     *   --dsw-alias-border-l1        一级描边：浅色 rgba(0,0,0,.04) / 深色 rgba(255,255,255,.06)
     *   --dsw-alias-label-primary    主文字：浅色 bluish-1000 / 深色 bluish-50
     *   --dsw-alias-interactive-bg-hover  悬停：浅色 rgba(38,49,72,.06) / 深色 rgba(255,255,255,.08)
     *
     * **配色边界**：只有「背景板」跟随 DSH，滑轨自身不跟。
     *   · 背景板 —— 包住轨道的那块面板由 DSH 官方画，底色是 `--dsw-alias-card-fill`
     *     （浅色 neutral-50 近白 / 深色 neutral-850 深灰）。插件侧一个不透明底色
     *     都不设，所以深色主题下那块面板自动变深，浅色主题下自动变白。
     *   · 滑轨、粒子、旋钮 —— **固定用设计稿那套蓝白**。跟着主题走就等于换了一套
     *     视觉：深色主题下整条轨道会被压暗、旋钮会变成一个黑洞，那不是设计稿。
     *   · 只有中性的东西（轨道凹槽、刻度点）才吃 `--dsw-alias-*` 令牌。
     * ------------------------------------------------------------------ */
    var ACCENT = "#4a84ff";
    /** 设计稿色阶：左端浅蓝 → 右端纯蓝，与主题无关。
     *  下面三个常量是**默认强调色**下的原始值，保留作文档与兜底；
     *  真正入库的取色走 `palette`（由当前强调色混白派生）。 */
    var C_LEFT = [226, 236, 254];
    var C_RIGHT = [74, 132, 255];
    var C_HIGHLIGHT = [241, 247, 255];

    /* ── 写回节流 ────────────────────────────────────────────────────── */
    var COMMIT_THROTTLE_MS = 120;
    var COMMIT_DEADLINE_MS = 10000;
    var RETRY_DELAYS = [60, 240, 540, 960, 1500, 3000, 3000];

    /* ═════════════════════ 自定义版式（插件详情页里那块配置）═════════════════════
     *
     * 这块面板挂在 `plugins.bundle.config` 上，key 就是包名，所以它只会出现在
     * 「插件 → dsh-effort-mosaic → 详情」这一个页面的描述下方。
     *
     * 默认值 = 设计稿定稿值。**不改任何一项时，渲染结果与设计稿逐像素一致** ——
     * 面板只是把原本写死的几处颜色/几何提成了可调项，而不是换了一套视觉。
     *
     * 存 localStorage：DSH 的 client 跑在固定 origin 下，重开客户端仍然在。
     * 没有 localStorage（离线冒烟测试）时退化成内存态，绝不抛错。
     * ------------------------------------------------------------------ */
    var SETTINGS_KEY = "dsh-effort-mosaic:settings:v1";

    /** 形状与质感的合法取值。放在最前面：`normalizeSettings` 初始化时就要用。 */
    var SHAPES = ["circle", "ring", "rounded", "pill", "blade"];
    var FILLS = ["white", "tinted", "accent", "frosted"];
    /**
     * 最高档点亮样式 —— 这是**整套动效**的选择，不是强度参数：
     *   ripple  能量波：光从旋钮向左铺开 + 整条轨道外发光（设计稿原版）
     *   scan    扫描线：一条亮带从左向右（旋钮方向）扫过，其余压暗
     *   shatter 爆散：粒子瞬间被甩开一次，填充层过曝回弹，没有光晕铺开
     *   pulse   呼吸：整条轨道按两次呼吸节律明暗，旋钮光环跟着收放
     */
    var BURST_STYLES = ["ripple", "scan", "shatter", "pulse"];
    /** 越界的触发范围：关 / 仅最高档 / 全档位。 */
    var SCATTER_MODES = ["off", "top", "all"];
    /** 越界动画：飞沫 / 飘散 / 坠落 / 潮汐。
     *  四套的包络一样（右 1/5 不动、越左越散），差在"飞出去之后怎么动"。 */
    var SCATTER_STYLES = ["spray", "drift", "fall", "tide"];

    var DEFAULT_SETTINGS = {
      /** 滑轨强调色：填充渐变最右端、粒子最深处、点亮光晕，三处同源。 */
      accent: "#4A84FF",
      /** 最高档字符颜色。"accent" = 跟着强调色走；"custom" = 用 tintColor。 */
      tintMode: "accent",
      tintColor: "#4A84FF",
      /** 滑块形状：circle 实心圆 / ring 空心环 / rounded 圆角方 / pill 胶囊 / blade 细棒。 */
      knobShape: "circle",
      /** 滑块直径（px）：28 / 30 / 34。30 = 轨道高，是设计稿原值。
          下限 28：再小轨道上下就留出 2px 以上的边，滑块会显得"悬"在轨道里。 */
      knobSize: 30,
      /** 滑块质感：white 白瓷（设计稿）/ tinted 染色玻璃 / accent 强调色珠 / frosted 磨砂。 */
      knobFill: "white",
      /** 点亮强度倍率：0.4 – 1.8。1 = 设计稿原值。 */
      burstIntensity: 1,
      /** 点亮衰减速度倍率：0.6 – 1.4。1 = 设计稿原值，越大越短促。 */
      burstSpeed: 1,
      /** 最高档点亮样式（整套动效）：ripple / scan / shatter / pulse。 */
      burstStyle: "ripple",
      /** 粒子越界：off 关 / top 仅最高档（默认）/ all 全档位。
       *  只在开的时候有"右侧 1/5 静墙、越往左逃得越多"那套扩散。 */
      scatterMode: "top",
      /** 越界幅度倍率：0.4 – 2.4。1.0× ≈ 一个轨道高（30px）的逃逸距离。 */
      scatterAmount: 1.6,
      /** 越界动画：spray 飞沫 / drift 飘散 / fall 坠落 / tide 潮汐。 */
      scatterStyle: "spray",
    };

    /** CSS 里色阶混白的比例，照抄设计稿那五段渐变推导出来的。 */
    var FILL_STOPS = [0.84, 0.674, 0.475, 0.21, 0];

    /**
     * 设计稿那五段渐变的原值，以及由它反推出来的粒子两端色。
     * **默认强调色下直接返回这一组**：混白公式在个别通道上会差 1–4 个色阶
     * （比如高光该是 241,247,255，按比例混出来是 242,246,255），
     * 而「不改设置时与设计稿一模一样」是硬约束，所以默认走字面值，只有换了
     * 强调色才走派生。 */
    var DESIGNER_STOPS = ["#E2ECFE", "#C4D8FD", "#A0BCFB", "#7097F9", "#4A84FF"];
    var DESIGNER_LEFT = [226, 236, 254];
    var DESIGNER_RIGHT = [74, 132, 255];
    var DESIGNER_HIGHLIGHT = [241, 247, 255];

    function clampNum(v, lo, hi, fallback) {
      var n = typeof v === "number" ? v : parseFloat(v);
      if (!isFinite(n)) return fallback;
      return n < lo ? lo : n > hi ? hi : n;
    }

    function hexToRgb(hex) {
      var s = String(hex || "").trim().replace(/^#/, "");
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }

    function rgbToHex(rgb) {
      var out = "#";
      for (var i = 0; i < 3; i += 1) {
        var v = clampByte(rgb[i]);
        out += (v < 16 ? "0" : "") + v.toString(16);
      }
      return out.toUpperCase();
    }

    /** 把 accent 按比例混白 —— 设计稿那五段渐变全部由主蓝混白得到。 */
    function mixWhite(rgb, amount) {
      return [
        rgb[0] + (255 - rgb[0]) * amount,
        rgb[1] + (255 - rgb[1]) * amount,
        rgb[2] + (255 - rgb[2]) * amount,
      ];
    }

    /**
     * 由强调色派生出整套滑轨配色。默认 accent = #4A84FF 时，
     * 这里算出来的五个色标与设计稿写死的 `#e2ecfe / #c4d8fd / #a0bcfb / #7097f9 / #4a84ff` 一致。
     */
    function paletteOf(accentHex) {
      var rgb = hexToRgb(accentHex) || hexToRgb(DEFAULT_SETTINGS.accent);
      var hex = rgbToHex(rgb);
      if (hex === DEFAULT_SETTINGS.accent) {
        return {
          accent: hex,
          rgb: DESIGNER_RIGHT.slice(),
          stops: DESIGNER_STOPS.slice(),
          left: DESIGNER_LEFT.slice(),
          highlight: DESIGNER_HIGHLIGHT.slice(),
        };
      }
      var stops = [];
      for (var i = 0; i < FILL_STOPS.length; i += 1) {
        stops.push(rgbToHex(mixWhite(rgb, FILL_STOPS[i])));
      }
      return {
        accent: hex,
        rgb: rgb,
        stops: stops,
        left: mixWhite(rgb, FILL_STOPS[0]),
        highlight: mixWhite(rgb, 0.93),
      };
    }

    function normalizeSettings(raw) {
      var src = raw && typeof raw === "object" ? raw : {};
      var out = {};
      out.accent = hexToRgb(src.accent) ? rgbToHex(hexToRgb(src.accent)) : DEFAULT_SETTINGS.accent;
      out.tintMode = src.tintMode === "custom" ? "custom" : "accent";
      out.tintColor = hexToRgb(src.tintColor) ? rgbToHex(hexToRgb(src.tintColor)) : DEFAULT_SETTINGS.tintColor;
      out.knobShape = SHAPES.indexOf(src.knobShape) === -1 ? "circle" : src.knobShape;
      out.knobSize = Math.round(clampNum(src.knobSize, 28, 34, DEFAULT_SETTINGS.knobSize));
      out.knobFill = FILLS.indexOf(src.knobFill) === -1 ? "white" : src.knobFill;
      out.burstIntensity = clampNum(src.burstIntensity, 0.4, 1.8, DEFAULT_SETTINGS.burstIntensity);
      out.burstSpeed = clampNum(src.burstSpeed, 0.6, 1.4, DEFAULT_SETTINGS.burstSpeed);
      out.burstStyle = BURST_STYLES.indexOf(src.burstStyle) === -1 ? "ripple" : src.burstStyle;
      /* 旧存档里是布尔 `scatterOut`：忽略它，统一落到三态（缺省 = 仅最高档）。 */
      out.scatterMode = SCATTER_MODES.indexOf(src.scatterMode) === -1 ? DEFAULT_SETTINGS.scatterMode : src.scatterMode;
      out.scatterAmount = clampNum(src.scatterAmount, 0.4, 2.4, DEFAULT_SETTINGS.scatterAmount);
      out.scatterStyle = SCATTER_STYLES.indexOf(src.scatterStyle) === -1 ? "spray" : src.scatterStyle;
      return out;
    }

    /**
     * 滑块宽度 = 高度 × 该形状的宽高比。
     * 圆 / 环 / 方是 1；胶囊横向拉长；细棒收窄 —— 几何公式一律按**宽度**算，
     * 所以这三种形状下 `(100% - 宽度)` 才是真正可滑动的行程。
     */
    function knobWidthOf(snap) {
      var size = snap.knobSize;
      if (snap.knobShape === "pill") return size * 1.6;
      if (snap.knobShape === "blade") return size * 0.42;
      return size;
    }

    /**
     * 滑块描边宽度：环是 3px 实心壁，其余是 1px 细描边。
     * 「滑块内缘」和「收口半径」都要减它 —— 填充与粒子墙必须止于内缘，
     * 否则会顶到那圈半透明外边上，看起来就是轨道从滑块里穿出去。
     */
    function knobBorderWidthOf(snap) {
      return snap.knobShape === "ring" ? 3 : 1;
    }

    /** 圆角：胶囊和细棒都吃满高度的一半，得到两端半圆的柱体。 */
    function knobRadiusOf(snap) {
      /* 「方」的圆角必须跟着尺寸长：固定 7px 时，28 还算圆润，34 就明显变方了。
         取直径的 0.34 —— 视觉上始终是"圆角方形"，不会越调越大越像正方形。 */
      if (snap.knobShape === "rounded") return Math.round(snap.knobSize * 0.34) + "px";
      return "999px";
    }

    /**
     * 轨道**可见带**的高度（填充层 / 粒子层 / 轨道凹槽都用它）。
     *
     * 取"轨道高"和"滑块高"的较小值：滑块调到 28px 时，如果填充还是 30px，
     * 它就比滑块上下各高 1px —— 接缝处那圈蓝边会从滑块上方/下方露出来，
     * 看起来就是"轨道比滑块宽、没收进滑块里"。让整条带跟着滑块缩到 28px，
     * 填充的上边缘就和滑块顶点齐平，圆滑相切，不可能再露边。
     * 滑块比轨道大（34px）时保持 30px：那是"珠子比管子大"，管子不该跟着撑大。
     */
    function bandHeightOf(snap) {
      return Math.min(TRACK_HEIGHT, snap.knobSize);
    }

    /**
     * 四种质感的背景。都用一层竖向渐变 + 一层内高光把"球"撑起来 ——
     * 纯平涂的圆片在深色卡片上就是一颗塑料贴纸，没有体积感。
     */
    function knobSurfaceOf(snap, pal) {
      /* 环：环心必须透空，否则就是"一颗球描了圈边"，不是环。
         只垫一层 10% 的白，让底下粒子稍微抬亮一点，但仍看得出空心。
         质感改由环壁承担（边框颜色跟着 白瓷/染色/强调色/磨砂 变），
         这样切质感时环也有明显变化。 */
      if (snap.knobShape === "ring") {
        return "rgba(255,255,255,.10)";
      }
      var a = pal.accent;
      if (snap.knobFill === "accent") {
        /* 强调色珠：从浅蓝压到强调色再到深一档，整颗是"实心玻璃珠"，
           和只染了淡淡一层色的 tinted 拉开明度差。 */
        return "linear-gradient(180deg," + pal.stops[1] + " 0%,"
          + a + " 52%,"
          + pal.stops[3] + " 100%)";
      }
      if (snap.knobFill === "tinted") {
        /* 染色：整颗铺满中段蓝，不是只在下缘带一点色。 */
        return "linear-gradient(180deg," + pal.stops[0] + " 0%,"
          + pal.stops[1] + " 40%,"
          + pal.stops[2] + " 100%)";
      }
      if (snap.knobFill === "frosted") {
        /* 磨砂是"哑光灰白"，不是又一颗白球：中灰底 + 很少的蓝调，
           和纯白球放在一起能一眼分出冷暖和明度。 */
        return "linear-gradient(180deg,#f1f3f7 0%,#dfe4ec 52%,#cbd2dd 100%)";
      }
      /* 白瓷：设计稿本来就是纯白，保留略微的下沉渐变让边缘不发飘。 */
      return "linear-gradient(180deg,#ffffff 0%,#ffffff 58%,#f2f6ff 100%)";
    }

    /** 内高光 + 内阴影的强度：白瓷最亮，染色玻璃次之，强调色珠最弱（避免整颗发光）。 */
    function knobSheenOf(snap) {
      /* 环：内壁只留一道极浅的上缘光，强内高光会把空心糊成实心。 */
      if (snap.knobShape === "ring") return "inset 0 1px 2px rgba(255,255,255,.35)";
      if (snap.knobFill === "accent") return "inset 0 1px 1px rgba(255,255,255,.55),inset 0 -2px 4px rgba(12,24,60,.22)";
      /* 磨砂：高光要摊开、要软，锐利的一条亮线会立刻变回玻璃。 */
      if (snap.knobFill === "frosted") return "inset 0 1px 3px rgba(255,255,255,.99),inset 0 -8px 12px rgba(148,166,196,.20)";
      return "inset 0 1px 1px rgba(255,255,255,.95),inset 0 -2px 3px rgba(20,40,90,.10)";
    }

    var settings = normalizeSettings(null);
    /** 当前强调色派生出的整套滑轨配色（粒子色阶用它，每帧都在读）。 */
    var palette = paletteOf(settings.accent);
    /**
     * 配色版本号。方块背景只在"走过一整格"时才重写，所以换强调色后静止墙
     * 会一直保留旧颜色（橙色轨道里躺着一片蓝方块）。tick 里比对版本号，
     * 一换色就把所有格子的底色重刷一遍。
     */
    var paletteVersion = 0;
    var settingsListeners = new Set();

    function readStoredSettings() {
      try {
        if (typeof localStorage === "undefined") return null;
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (err) {
        return null;
      }
    }

    function persistSettings(next) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        /* 隐私模式 / 配额满：内存态继续生效，不打断用户 */
      }
    }

    function notifySettings() {
      var current = [];
      settingsListeners.forEach(function (fn) { current.push(fn); });
      for (var i = 0; i < current.length; i += 1) {
        try { current[i](); } catch (err) { /* 单个订阅者抛错不影响其它 */ }
      }
    }

    /** 改一项或几项：合并 → 规整 → 落盘 → 通知。返回新的整份设置。 */
    function updateSettings(patch) {
      settings = normalizeSettings(Object.assign({}, settings, patch));
      persistSettings(settings);
      syncThemeVars();
      notifySettings();
      return settings;
    }

    function resetSettings() {
      settings = normalizeSettings(null);
      persistSettings(settings);
      syncThemeVars();
      notifySettings();
      return settings;
    }

    /** 面板与轨道共用同一个订阅接口（useSyncExternalStore 要求快照身份稳定）。 */
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return function () { settingsListeners.delete(listener); };
    }

    function getSettings() {
      return settings;
    }

    /** 最高档字符实际用的颜色：accent 模式下跟着强调色一起变。 */
    function tintColorOf(snap) {
      var s = snap || settings;
      return s.tintMode === "custom" ? s.tintColor : s.accent;
    }

    /**
     * 把派生色写到 documentElement 的 CSS 变量上。
     * 轨道 CSS 全部吃这些变量，所以改一次颜色不需要重建任何组件。
     */
    function syncThemeVars() {
      try {
        var pal = paletteOf(settings.accent);
        palette = pal;
        paletteVersion += 1;
        var root = document.documentElement;
        if (!root || !root.style || typeof root.style.setProperty !== "function") return;
        root.style.setProperty("--dem-accent", pal.accent);
        root.style.setProperty("--dem-c1", pal.stops[0]);
        root.style.setProperty("--dem-c2", pal.stops[1]);
        root.style.setProperty("--dem-c3", pal.stops[2]);
        root.style.setProperty("--dem-c4", pal.stops[3]);
        root.style.setProperty("--dem-accent-rgb", pal.rgb.join(","));
        var knobW = knobWidthOf(settings);
        root.style.setProperty("--dem-knob-size", settings.knobSize + "px");
        root.style.setProperty("--dem-knob-w", knobW + "px");
        root.style.setProperty("--dem-knob-r", (knobW / 2) + "px");
        root.style.setProperty("--dem-knob-radius", knobRadiusOf(settings));
        /* 轨道**可见带**的高度 = min(轨道高, 滑块高)。轨道本体（布局/点击热区）仍是 30px，
           但凹槽、填充、粒子层统一缩到这条带里 —— 滑块 28px 时带高也是 28px，
           填充的上边缘与滑块顶点齐平，衔接处不可能再露出一圈蓝边。
           以前固定 30px 时，28px 的滑块上下各有一像素的填充/粒子漏在滑块外面。 */
        var bandH = bandHeightOf(settings);
        root.style.setProperty("--dem-fill-h", bandH + "px");
        root.style.setProperty("--dem-band-inset", ((TRACK_HEIGHT - bandH) / 2) + "px");
        /* 收口半径 = 滑块内缘半径：圆形/环 = 直径/2 - 描边；胶囊/细棒取宽高较小的一半。
           粒子层的遮罩半径也用同一个值，两层共用一条曲线。
           带高已经等于滑块高时，这个半径正好把填充右端收在滑块内壁上（无直边）。 */
        var tailRadius = Math.min(knobW, settings.knobSize) / 2 - knobBorderWidthOf(settings);
        root.style.setProperty("--dem-fill-tail-radius", Math.max(0, tailRadius) + "px");
        root.style.setProperty("--dem-knob-fill", knobSurfaceOf(settings, pal));
        root.style.setProperty("--dem-knob-sheen", knobSheenOf(settings));
        /* 环壁颜色跟着质感走：白瓷=白环、染色=浅蓝环、强调色=蓝环、磨砂=灰环。
           环心是透的，所以"看起来是环"全靠这圈壁。 */
        var edgeWidth = knobBorderWidthOf(settings) + "px solid ";
        root.style.setProperty("--dem-knob-border", edgeWidth + (
          settings.knobShape === "ring"
            ? settings.knobFill === "accent" ? pal.accent
              : settings.knobFill === "tinted" ? pal.stops[2]
                : settings.knobFill === "frosted" ? "#cbd2dd"
                  : "#ffffff"
            : settings.knobFill === "accent" ? pal.stops[3]
              : settings.knobFill === "tinted" ? pal.stops[2]
                : settings.knobFill === "frosted" ? "#c3cad6"
                  : pal.stops[0]
        ));
        root.style.setProperty("--dem-burst-alpha", String(0.5 * settings.burstIntensity));
        root.style.setProperty("--dem-glow-alpha", String(0.45 * settings.burstIntensity));
        /* 越界开关同时也控制粒子层的裁剪范围：关 = 0px（严格裁在轨道内），
           开 = 420px（上下放行）。这样"关"时的溢出是物理上不可见的，
           不再依赖某一处 y 的夹取是否算对。 */
        root.style.setProperty("--dem-scatter-clip", settings.scatterMode === "off" ? "0px" : "420px");
      } catch (err) {
        /* 变量写失败就退回 CSS 里的兜底字面值 */
      }
    }

    /* 初始值从磁盘恢复；拿不到就用默认。 */
    settings = normalizeSettings(readStoredSettings());
    syncThemeVars();

    /* ════════════════════════════ 样式 ════════════════════════════ */

    /**
     * 收口遮罩：把「填充层 / 粒子层」的右端裁成**滑块自己的轮廓**，而不是一个固定半圆。
     *
     * 两层叠加（`mask-image` 多条默认按并集合成）：
     *   1. 竖切 —— 滑块圆心左边一律保留：轨道本体和粒子一直铺到滑块圆心；
     *   2. 圆盘 —— 圆心处只保留滑块**内缘**那个圆内的部分，圆外一律消失。
     * 于是填充/粒子的右边界就是滑块内缘那条曲线：滑块多大，收口就多大。
     * 固定 `border-radius: 15px` 只在滑块正好 30px 时才是同一条曲线 —— 滑块调到 28px 时，
     * 填充是 r15 的圆、滑块是 r14，多出来的那一圈就从滑块上下左右露出来，看着就是
     * "轨道没有收在滑块里、衔接处多了一块"。空心环则正好灌到内壁。
     *
     * 圆心 `--dem-fill-tail-x` 由 rAF 每帧按滑块**真实渲染位置**写入（缓动途中也跟得住，
     * 和粒子墙同一个数据源）；半径 `--dem-fill-tail-radius` 跟着尺寸/形状/描边走。
     * 两个变量都没写上时（例如配置页的静态预览）兜底成 100% + 15px：等于完全不裁。
     */
    var TAIL_MASK =
      "linear-gradient(90deg,#000 0 var(--dem-fill-tail-x,100%),rgba(0,0,0,0) var(--dem-fill-tail-x,100%)),"
      + "radial-gradient(circle at var(--dem-fill-tail-x,100%) 50%,"
      + "#000 calc(var(--dem-fill-tail-radius,15px) - .5px),rgba(0,0,0,0) var(--dem-fill-tail-radius,15px))";

    var CSS = [
      /* 注入进官方那一行的容器：折行到第二行并铺满整行。
         背景**必须透明** —— 这一块的底色归 DSH 官方菜单卡片
         （`--dsw-alias-card-fill`：浅色近白 / 深色 neutral-850）。
         插件若在这里自己画白底，深色主题下就会露出一条白块。 */
      ".dem-inline{box-sizing:border-box;flex-basis:100%;width:100%;min-width:0;background:transparent}",
      ".dem-track{--dem-slot-bg:var(--dsw-alias-border-l1,color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 8%,transparent));"
        + "position:relative;box-sizing:border-box;height:" + TRACK_HEIGHT + "px;margin:2px " + TRACK_INSET + "px 0;"
        + "border-radius:999px;"
        + "background:var(--dem-slot-bg);"
        /* 凹槽只画在**可见带**里：滑块缩到 28px 时上下各留 1px 空白（布局高度仍是 30，
           点击热区不变），凹槽和填充、粒子同高，边缘才对得齐。
           `background-clip` 必须写在 `background` 简写之后 —— 简写会把 clip 重置回 border-box。 */
        + "padding:var(--dem-band-inset,0px) 0;background-clip:content-box;"
        + "cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;overflow:visible;"
        + "transition:box-shadow .5s ease}",
      ".dem-track:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4a84ff);outline-offset:2px}",
      /* 填充层：粒子墙的彩色底，右端随旋钮一起长。
         设计稿是「渐变 + 两层细密像素格纹」——格纹不能省，少了那两层底纹整条
         轨道会变成一块光滑渐变，跟设计稿的像素质地完全不是一回事。
         五个色标全部由强调色混白派生（`syncThemeVars` 写入），括号里是设计稿原值兜底。 */
      /* 右端不再是"固定半圆"：交给 TAIL_MASK 按滑块内缘裁（见上面的说明）。
         这里仍保留右端圆角，只是半径跟着滑块走 —— 遮罩没生效时（变量缺失）也能少露一截。 */
      ".dem-fill{position:absolute;left:0;top:50%;height:var(--dem-fill-h,30px);transform:translateY(-50%);"
        + "border-radius:calc(var(--dem-fill-h,30px) / 2) var(--dem-fill-tail-radius,15px)"
        + " var(--dem-fill-tail-radius,15px) calc(var(--dem-fill-h,30px) / 2);"
        + "overflow:hidden;pointer-events:none;"
        /* 宽度也带一条过渡：外部写回档位（换模型代、设置面板改形状）时填充和滑块一起走。
           拖动 / 吸附期间这条会被下面两条规则关掉，那两段是逐帧写死的。 */
        + "transition:width .3s cubic-bezier(.22,1,.36,1);"
        + "-webkit-mask-image:" + TAIL_MASK + ";mask-image:" + TAIL_MASK + ";"
        + "background:"
        + "repeating-linear-gradient(90deg,rgba(255,255,255,.20) 0 .6px,transparent .6px 5px),"
        + "repeating-linear-gradient(180deg,rgba(20,50,110,.13) 0 .6px,transparent .6px 5px),"
        + "linear-gradient(90deg,var(--dem-c1,#e2ecfe) 0%,var(--dem-c2,#c4d8fd) 26%,var(--dem-c3,#a0bcfb) 58%,var(--dem-c4,#7097f9) 86%,var(--dem-accent,#4a84ff) 100%)}",
      /* 左端融合层：设计稿 `.fill` 带 `mask-image: linear-gradient(90deg,transparent 0%,#000 16%)`，
         最左 1/6 是从轨道底色里"长"出来的，所以设计稿的浅色头一点也不刺眼。
         这里不能照抄那条 mask —— DSH 深色卡上 transparent 会挖出深灰缺口（轨道最左像空了一块）。
         改成一枚覆盖层：从**轨道底色本身**（--dem-slot-bg，与 .dem-track 的 background 同源）
         渐隐到透明，宽度占填充的 16%。浅色主题下等效设计稿的 16% 淡入，
         深色主题下是"深色渐入浅蓝"，既没有硬缺口，也不会一上来就铺满纯白。 */
      ".dem-fill-fade{position:absolute;left:0;top:0;bottom:0;width:16%;pointer-events:none;"
        + "background:linear-gradient(90deg,var(--dem-slot-bg,rgba(150,160,175,.18)) 0%,rgba(0,0,0,0) 100%)}",
      /* 填充层的遮罩只负责右端收口，**不含左端渐隐**：设计稿那条淡出是针对白底卡片调的，
         同样一条放到 DSH 的深色卡片上会变成一条深灰缺口，看着就是"轨道最左边空了一块"。
         所以渐隐只留在粒子层。 */
      /* 粒子层：独立于填充层，允许飞出轨道上下边界；左端渐隐让方块消融。
         宽度由 rAF 每帧写成"滑块真实右缘"，再用 clip-path 只裁左右、放行上下，
         所以粒子可以往上/下飞出轨道，但绝不会有格子跑到滑块右边。 */
      /* 粒子层：独立于填充层，允许飞出轨道上下边界。
         宽度由 rAF 每帧写成"滑块真实右缘"，再用 clip-path 只裁左右、放行上下。
         **这里不能挂 mask 做左端渐隐**：mask 默认 `mask-clip:border-box`，会把
         飞出 30px 轨道的方块一起裁掉 —— 越界就永远看不见。渐隐改成逐格 opacity
         （在 tick 里按 x 算），左端看起来一样是化的。 */
      ".dem-mosaic{position:absolute;left:0;top:calc(var(--dem-band-inset,0px) * -1);height:" + TRACK_HEIGHT + "px;width:0;"
        + "overflow:visible;pointer-events:none;"
        + "clip-path:inset(calc(-1 * var(--dem-scatter-clip,0px)) 0 calc(-1 * var(--dem-scatter-clip,0px)) 0)}",
      /* 圆角裁切层：粒子层自己是个矩形 —— 它上面那条 clip-path 的 inset() 只有轴对齐的
         四条边，两端不会跟着轨道的 `border-radius:999px` 收成半圆。于是左右两个端帽的
         直角区域里，方块照样画在轨道外面（截图里环钮上方/下方、左端拐角那一坨方角蓝块）。
         轨道本体不能直接 `overflow:hidden`：旋钮投影、最高档外发光都会一起被切掉。
         所以单独套一层只包粒子、尺寸恒等于轨道的裁切层，按轨道的圆角裁。
         宽度必须是 100%（轨道宽），**不能**用粒子层的宽度：低档位时粒子层只有 15px 宽，
         按它算圆角会被压缩成半个半圆，左端就会裁得比轨道还多。
         越界扩散模式下圆角和 overflow 一起放掉 —— 那档效果本来就是让方块飞出轨道。
         这一层同时挂 TAIL_MASK：方块和填充共用同一条收口曲线，右边界止于滑块内缘。
         粒子层的宽度本身是"滑块内缘的竖切"，方块又是 5px 一格 —— 只靠宽度裁时，
         贴着滑块的那一列方块会方方正正地探到滑块外面去（滑块缩小后尤其明显）；
         遮罩才是真正按滑块轮廓收的。 */
      ".dem-mosaic-clip{position:absolute;left:0;top:var(--dem-band-inset,0px);width:100%;height:var(--dem-fill-h," + TRACK_HEIGHT + "px);"
        + "pointer-events:none;border-radius:999px;overflow:hidden;"
        /* `mask-clip:no-clip` 是关键：默认 border-box 会把越界（飞出轨道）的方块裁掉。
           设成 no-clip 之后，遮罩仍然按滑块弧线收口，但不再限制绘制范围。 */
        + "-webkit-mask-clip:no-clip;mask-clip:no-clip;"
        + "-webkit-mask-image:" + TAIL_MASK + ";mask-image:" + TAIL_MASK + "}",
      ".dem-track[data-scatter='1'] .dem-mosaic-clip{border-radius:0;overflow:visible}",
      /* 单格：颜色由 JS 直接写（设计稿色阶），不参与任何主题混合。
         transform-origin 钉在左上角 —— 开启"越界扩散"后方块会被放大，
         如果按中心缩放，位置基准会跟着漂，整片粒子会缓慢错位。 */
      ".dem-cell{position:absolute;left:0;top:0;transform-origin:0 0;border-radius:0;will-change:transform,opacity}",
      /* 刻度 */
      /* 刻度：严格用设计稿原值 —— 圆点 #64789C、竖条 #92A4C2（蓝灰），不跟主题。
         之前为了深色卡上更显眼提到填充哈希里的蓝，属于擅自偏离，已改回。 */
      ".dem-mark{position:absolute;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;"
        + "background:#64789C;"
        + "pointer-events:none}",
      ".dem-mark--bar{width:3px;height:12px;margin:-6px 0 0 -1.5px;border-radius:1px;"
        + "background:#92A4C2}",
      /* 旋钮：默认直径 = 轨道高度，纯白（设计稿里就是白圆钮），不跟主题走。
         设计稿还给了 1px #DFEAFD 描边 + 一层偏蓝的柔和投影，少了它圆钮会显得发飘。
         尺寸 / 形状 / 填充 / 描边都提到 CSS 变量，插件详情页的配置面板改的就是它们。 */
      ".dem-knob{position:absolute;top:50%;width:var(--dem-knob-w,30px);height:var(--dem-knob-size,30px);"
        + "margin:calc(var(--dem-knob-size,30px) * -0.5) 0 0 calc(var(--dem-knob-r,15px) * -1);box-sizing:border-box;"
        + "border:var(--dem-knob-border,1px solid #DFEAFD);border-radius:var(--dem-knob-radius,999px);"
        + "background:var(--dem-knob-fill,#ffffff);"
        + "box-shadow:var(--dem-knob-sheen,inset 0 1px 1px rgba(255,255,255,.95)),"
        + "0 2px 8px rgba(34,62,120,.2),0 1px 2px rgba(34,62,120,.08);"
        + "pointer-events:none;"
        /* 非拖动/非吸附时（比如模型代切换、外部写回档位）才走这条 CSS 过渡。
           吸附本身由 rAF 逐帧驱动，见 `beginSettle`；那段会临时把这条关掉。 */
        + "transition:left .3s cubic-bezier(.22,1,.36,1),box-shadow .3s ease}",
      /* 拖动时旋钮与填充都关掉缓动，否则手感会黏。 */
      ".dem-track[data-dragging='1'] .dem-knob,.dem-track[data-dragging='1'] .dem-fill{transition:none}",
      /* 吸附阶段位置由 `beginSettle` 的 rAF 逐帧写，再叠一层 CSS transition 就是双重缓动，
         滑块和填充的插值曲线不同会互相追不上 —— 这一段两边都直接跟数值走。 */
      ".dem-track[data-snapping='1'] .dem-knob,.dem-track[data-snapping='1'] .dem-fill{transition:none}",
      /* 最高档的光晕走伪元素：box-shadow 要留给轨道本体做外发光，两者共用会互相覆盖。 */
      ".dem-knob::after{content:'';position:absolute;inset:-4px;border-radius:inherit;"
        + "box-shadow:0 0 22px 7px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-burst-alpha,.5));opacity:0;pointer-events:none;"
        + "transition:opacity .18s ease}",
      ".dem-track[data-burst='1'] .dem-knob::after{opacity:1}",
      /* 吸附落位的那一下缩放脉冲不再走 CSS 动画：它要发生在**吸附结束**的时刻，
         而 CSS 只能从类名变化时开始播，改档速度稍快就会和上一轮撞在一起。
         现在由 `popKnob()` 在曲线收敛后用 WAAPI 播（scale 1 → 1.014 → 1，260ms），
         每次落位都是独立的一下，不会叠。 */
      /* 能量光：从旋钮向左铺开（Ultracode burst）。固定用强调色系，两种主题下都"亮"。 */
      ".dem-flush{position:absolute;inset:var(--dem-band-inset,0px) 0;border-radius:999px;pointer-events:none;opacity:0;"
        + "background:radial-gradient(115% 170% at 100% 50%,rgba(255,255,255,.94) 0%,"
        + "rgba(var(--dem-accent-rgb,74,132,255),.34) 26%,rgba(var(--dem-accent-rgb,74,132,255),0) 64%)}",
      /* 点亮：整条轨道外发光（四种样式共用，强度由面板里的"点亮强度"控制）。 */
      ".dem-track[data-burst='1']{box-shadow:0 0 0 1px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-glow-alpha,.45)),"
        + "0 0 20px 2px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-glow-alpha,.45))}",
      /* ── 样式一：ripple 能量波（设计稿原版）—— 光从旋钮向左铺开 + 填充亮度脉冲 ── */
      ".dem-track[data-burst='1'][data-burst-style='ripple'] .dem-flush{transform-origin:100% 50%;"
        + "animation:demFlush .8s cubic-bezier(.22,1,.36,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='ripple'] .dem-fill{animation:demGlow .75s ease-out}",
      "@keyframes demFlush{0%{opacity:0;transform:scaleX(.035)}16%{opacity:.95}64%{opacity:.45}100%{opacity:0;transform:scaleX(1)}}",
      "@keyframes demGlow{0%{filter:brightness(1) saturate(1)}26%{filter:brightness(1.55) saturate(1.4)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式二：scan 扫描线 —— 一条亮带掠过整条轨道，露出的粒子被瞬时提亮 ── */
      ".dem-track[data-burst='1'][data-burst-style='scan'] .dem-flush{clip-path:inset(0 round 999px);"
        + "background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.95) 7%,"
        + "rgba(255,255,255,.45) 20%,transparent 42%);"
        + "transform-origin:100% 50%;animation:demScan .95s cubic-bezier(.2,.75,.25,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='scan'] .dem-fill{animation:demScanGlow .95s ease-out}",
      "@keyframes demScan{0%{opacity:0;transform:translateX(64%) scaleX(.42)}10%{opacity:1}"
        + "70%{opacity:.55}100%{opacity:0;transform:translateX(-82%) scaleX(.42)}}",
      "@keyframes demScanGlow{0%{filter:brightness(1)}34%{filter:brightness(1.34) saturate(1.2)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式三：shatter 爆散 —— 过曝一下再回弹，没有光的铺开，靠粒子自己甩出去 ── */
      ".dem-track[data-burst='1'][data-burst-style='shatter'] .dem-fill{animation:demShatter .6s ease-out}",
      "@keyframes demShatter{0%{filter:brightness(1) saturate(1)}14%{filter:brightness(1.95) saturate(1.7)}"
        + "46%{filter:brightness(.92) saturate(.9)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式四：pulse 呼吸 —— 光从滑块（右端）向左漫开，两次起伏，慢，不能喘 ── */
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-flush{"
        + "background:radial-gradient(125% 100% at 100% 50%,rgba(255,255,255,.88) 0%,"
        + "rgba(255,255,255,.38) 40%,transparent 80%);"
        + "transform-origin:100% 50%;animation:demPulseSweep 2.4s cubic-bezier(.4,0,.3,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-fill{animation:demPulse 2.4s ease-in-out}",
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-knob::after{animation:demPulseHalo 2.4s ease-in-out}",
      "@keyframes demPulseSweep{0%{opacity:0;transform:scaleX(.05)}22%{opacity:.88;transform:scaleX(.56)}"
        + "46%{opacity:.4;transform:scaleX(.84)}68%{opacity:.8;transform:scaleX(1)}"
        + "100%{opacity:0;transform:scaleX(1)}}",
      "@keyframes demPulse{0%{filter:brightness(1)}20%{filter:brightness(1.3)}38%{filter:brightness(1.02)}"
        + "60%{filter:brightness(1.2)}100%{filter:brightness(1)}}",
      "@keyframes demPulseHalo{0%{opacity:.2;transform:scale(.96)}22%{opacity:.95;transform:scale(1.05)}"
        + "38%{opacity:.3;transform:scale(.99)}68%{opacity:.75;transform:scale(1.03)}100%{opacity:.2;transform:scale(1)}}",
      ".dem-hint{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      /* ── 插件详情页里的自定义版式面板 ────────────────────────────────
         所有颜色都吃 DSH 令牌，浅色/深色主题自动适配；只有"强调色预览块"
         用插件自己的颜色，那是它唯一该显眼的地方。 */
      ".dem-cfg{display:flex;flex-direction:column;gap:14px;padding:2px 0 4px;"
        + "font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115)}",
      ".dem-cfg-head{display:flex;flex-direction:column;gap:3px}",
      ".dem-cfg-title{font-size:14px;font-weight:600;letter-spacing:.01em}",
      ".dem-cfg-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:28px}",
      ".dem-cfg-label{flex:0 0 76px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);"
        + "white-space:nowrap}",
      ".dem-cfg-swatches{display:flex;align-items:center;gap:8px}",
      ".dem-cfg-swatch{position:relative;width:22px;height:22px;padding:0;border-radius:50%;"
        + "border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));cursor:pointer;"
        + "box-shadow:0 1px 2px rgba(15,25,50,.08);transition:transform .16s ease,box-shadow .16s ease}",
      ".dem-cfg-swatch:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(15,25,50,.16)}",
      ".dem-cfg-swatch[data-on='1']{box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#0b0d12),0 0 0 4px currentColor}",
      ".dem-cfg-hex{width:96px;height:26px;padding:0 8px;box-sizing:border-box;border-radius:7px;"
        + "border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));"
        + "background:var(--dsw-alias-bg-base,transparent);"
        + "color:var(--dsw-alias-label-primary,#0f1115);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;"
        + "outline:none;text-transform:uppercase}",
      ".dem-cfg-hex:focus{border-color:var(--dem-accent,#4a84ff)}",
      ".dem-cfg-seg{display:inline-flex;padding:2px;border-radius:9px;gap:2px;"
        + "background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
      ".dem-cfg-opt{appearance:none;border:0;background:transparent;cursor:pointer;"
        + "padding:3px 10px;border-radius:7px;font-size:12px;line-height:18px;"
        + "color:var(--dsw-alias-label-secondary,#6b7280);transition:background .16s ease,color .16s ease}",
      ".dem-cfg-opt:hover{color:var(--dsw-alias-label-primary,#0f1115)}",
      ".dem-cfg-opt[data-on='1']{background:var(--dsw-alias-card-fill,#1a1d24);"
        + "color:var(--dsw-alias-label-primary,#0f1115);font-weight:600;"
        + "box-shadow:0 1px 2px rgba(10,16,30,.16)}",
      ".dem-cfg-range{appearance:none;width:150px;height:4px;border-radius:2px;outline:none;cursor:pointer;"
        + "background:linear-gradient(90deg,var(--dem-accent,#4a84ff) 0%,"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 30%,transparent) 100%)}",
      ".dem-cfg-range::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;"
        + "background:var(--dem-knob-fill,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));"
        + "box-shadow:0 1px 3px rgba(15,25,50,.24);cursor:grab}",
      ".dem-cfg-value{min-width:44px;font-size:12px;font-variant-numeric:tabular-nums;"
        + "color:var(--dsw-alias-label-secondary,#6b7280)}",
      /* 预览卡片同时当"取景框"：开了越界之后粒子会飞出轨道，这一层把溢出裁在卡片圆角里，
         不然方块会糊到下面的「恢复默认」上。 */
      ".dem-cfg-preview{padding:14px 12px;border-radius:12px;overflow:hidden;"
        + "background:var(--dsw-alias-card-fill,#1a1d24);"
        + "border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}",
      /* 环心那层乳白玻璃要用 backdrop-filter 虚化底下粒子，否则环里还是能看见方块在动。 */
      ".dem-knob[data-knob-shape='ring'],.dem-cfg-preview-knob[data-knob-shape='ring']"
        + "{backdrop-filter:blur(4px) saturate(1.15);-webkit-backdrop-filter:blur(4px) saturate(1.15)}",
      ".dem-cfg-preview-track{position:relative;box-sizing:border-box;height:" + TRACK_HEIGHT + "px;border-radius:999px;overflow:visible;"
        + "cursor:default;background:var(--dsw-alias-border-l1,rgba(255,255,255,.06));isolation:isolate;"
        /* 和真轨道同一套：凹槽只画在可见带里（滑块 28px 时带高也是 28px）。
           `background-clip` 必须跟在 `background` 简写后面。 */
        + "padding:var(--dem-band-inset,0px) 0;background-clip:content-box}",
      /* 预览只演示轨道内部的动效：外发光会画到轨道外面，这里关掉；
         旋钮光晕也收掉，避免它比轨道还大一圈。 */
      ".dem-cfg-preview-track[data-burst='1']{box-shadow:none}",
      ".dem-cfg-preview-track[data-burst='1'] .dem-knob::after{opacity:0}",
      /* 旋钮在预览里是"最高档"位置，贴着右端——不能被圆角裁成半个。 */
      ".dem-cfg-preview-track .dem-knob{overflow:visible}",
      ".dem-cfg-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}",
      ".dem-cfg-play{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));"
        + "background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));"
        + "color:var(--dsw-alias-label-primary,#e6e8ee);font-size:12px;line-height:18px;"
        + "padding:4px 16px;border-radius:8px;cursor:pointer;"
        + "transition:background .16s ease,border-color .16s ease}",
      ".dem-cfg-play:hover{border-color:var(--dem-accent,#4a84ff);"
        + "background:color-mix(in srgb,var(--dem-accent,#4a84ff) 16%,transparent)}",
      /* 预览轨是"最高档"的样子：滑块**右缘贴轨道右端**（不是中心贴右端）——
         和真实轨道 100% 时 `left = 100% - 半径` 的位置完全一致。
         这里锚定的是右边缘，所以只补垂直方向的负半高，不能再给右边距上负值：
         一旦右移半个宽度，滑块就有一半跑到轨道外面，填充右端反而露在滑块外侧。 */
      ".dem-cfg-preview-clip{position:absolute;inset:var(--dem-band-inset,0px) 0;border-radius:999px;overflow:hidden;pointer-events:none}",
      ".dem-cfg-preview-fill{position:absolute;left:0;right:0;top:50%;height:var(--dem-fill-h,30px);transform:translateY(-50%);"
        + "border-radius:calc(var(--dem-fill-h,30px) / 2);overflow:hidden;"
        + "background:"
        + "repeating-linear-gradient(90deg,rgba(255,255,255,.20) 0 .6px,transparent .6px 5px),"
        + "repeating-linear-gradient(180deg,rgba(20,50,110,.13) 0 .6px,transparent .6px 5px),"
        + "linear-gradient(90deg,var(--dem-c1,#e2ecfe) 0%,var(--dem-c2,#c4d8fd) 26%,var(--dem-c3,#a0bcfb) 58%,var(--dem-c4,#7097f9) 86%,var(--dem-accent,#4a84ff) 100%)}",
      ".dem-cfg-preview-knob{position:absolute;top:50%;right:-1px;width:var(--dem-knob-w,30px);height:var(--dem-knob-size,30px);"
        + "margin:calc(var(--dem-knob-size,30px) * -0.5) 0 0 0;box-sizing:border-box;"
        + "border:var(--dem-knob-border,1px solid #DFEAFD);border-radius:var(--dem-knob-radius,999px);"
        + "background:var(--dem-knob-fill,#ffffff);"
        + "box-shadow:var(--dem-knob-sheen,inset 0 1px 1px rgba(255,255,255,.95)),"
        + "0 2px 8px rgba(34,62,120,.2),0 1px 2px rgba(34,62,120,.08)}",
      ".dem-cfg-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;"
        + "padding-top:2px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}",
      ".dem-cfg-reset{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));"
        + "background:transparent;cursor:pointer;padding:5px 12px;border-radius:8px;font-size:12px;"
        + "color:var(--dsw-alias-label-secondary,#6b7280);transition:color .16s ease,border-color .16s ease}",
      ".dem-cfg-reset:hover{color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dem-accent,#4a84ff)}",
      ".dem-cfg-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      "@media (prefers-reduced-motion:reduce){.dem-knob{transition-duration:0s}}",
    ].join("");

    /* ════════════════════════ 纯函数（可离线断言）════════════════════════ */

    var EMPTY_SNAPSHOT = Object.freeze({
      current: null,
      groups: [],
      failures: [],
      status: "idle",
      pending: null,
      error: null,
    });

    /** 在目录快照里找到当前模型条目（groups[].models[]）。 */
    function modelOf(state) {
      var current = state && state.current;
      if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
      var groups = state && Array.isArray(state.groups) ? state.groups : [];
      for (var i = 0; i < groups.length; i += 1) {
        var group = groups[i];
        if (!group || group.id !== current.provider) continue;
        var models = Array.isArray(group.models) ? group.models : [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j] && models[j].id === current.model) return models[j];
        }
      }
      return null;
    }

    /**
     * 当前模型**真实声明**的档位表。这就是"档位跟着模型走"的唯一事实源：
     * 模型没有声明 reasoning.efforts 时返回空数组 —— 此时不注入任何控件。
     */
    function levelsOf(state) {
      var model = modelOf(state);
      var efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
      var out = [];
      for (var i = 0; i < efforts.length; i += 1) {
        var effort = efforts[i];
        if (!effort || typeof effort.id !== "string" || effort.id.length === 0) continue;
        out.push({
          id: effort.id,
          name: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id,
        });
      }
      return out;
    }

    /** 档位表的内容指纹：数量或任何一个 id 变化，都要重建轨道。 */
    function levelsKey(levels) {
      var parts = [];
      for (var i = 0; i < levels.length; i += 1) parts.push(levels[i].id);
      return parts.join("\u0001");
    }

    /** 当前**生效**的档位 id：显式设置优先，否则回落到模型的 defaultEffort。 */
    function effectiveEffortId(state) {
      var current = state && state.current;
      if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) {
        return current.reasoningEffort;
      }
      var model = modelOf(state);
      var fallback = model && model.reasoning && model.reasoning.defaultEffort;
      return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
    }

    function indexOfLevel(levels, id) {
      if (typeof id !== "string") return -1;
      for (var i = 0; i < levels.length; i += 1) if (levels[i].id === id) return i;
      return -1;
    }

    function clamp01(value) {
      if (!(value > 0)) return 0;
      return value > 1 ? 1 : value;
    }

    /** 档位下标 → 轨道百分比。只有一档时**直接拉满**（那一档就是"最大"）。 */
    function pctOfIndex(index, count) {
      if (count <= 0) return 0;
      if (count === 1) return 1;
      var safe = Math.max(0, Math.min(count - 1, index));
      return safe / (count - 1);
    }

    /** 轨道百分比 → 最近档位下标。 */
    function indexOfPct(pct, count) {
      if (count <= 1) return 0;
      return Math.max(0, Math.min(count - 1, Math.round(clamp01(pct) * (count - 1))));
    }

    /** 确定性伪随机（重渲染不跳变，可离线断言）。 */
    function hash01(a, b) {
      var n = a * 374761393 + b * 668265263;
      n = (n ^ (n >> 13)) * 1274126177;
      n = n ^ (n >> 16);
      return ((n >>> 0) % 100000) / 100000;
    }

    /**
     * 一格的基色（设计稿 `colorAt(x, w)` 的等价实现）。
     *
     * 设计稿的 `t` 是 `x / w` —— 分母是**当前填充宽度**，不是整条轨道宽度，
     * 所以同一块轨道在 20% 档和 100% 档下取到的色阶不一样，永远是从填充区左端
     * 浅蓝渐变到旋钮处纯蓝。抖动用 `Math.random()`，所以方块每移动 CELL 就会换一次
     * 明暗，这正是设计稿那种"像素砖在变"的活感。
     */
    function cellColor(x, w) {
      var t = w <= 0 ? 0 : clamp01(x / w);
      var pal = palette;
      if (Math.random() < 0.06) {
        return "rgb(" + clampByte(pal.highlight[0]) + "," + clampByte(pal.highlight[1]) + "," + clampByte(pal.highlight[2]) + ")";
      }
      /* 砖块与底色的关系：**乘性明度差**，不是在底色上加一个绝对抖动。
         旧做法 `n = ±14` 在浅色底（226,236,254）上只有 6% 的差，方块的色和底下填充
         的渐变色几乎一模一样 —— 整条轨道看着就是一条光滑渐变，粒子糊成一片。
         改成乘 0.80–1.06：浅色端差 ~±18、深色端差 ~±12，相对差恒定，
         从浅蓝到纯蓝整段都能看出砖缝，色相不动（只压明度）。 */
      var k = 0.80 + Math.random() * 0.26;
      var r = (pal.left[0] + (pal.rgb[0] - pal.left[0]) * t) * k;
      var g = (pal.left[1] + (pal.rgb[1] - pal.left[1]) * t) * k;
      var b = (pal.left[2] + (pal.rgb[2] - pal.left[2]) * t) * k;
      return "rgb(" + clampByte(r) + "," + clampByte(g) + "," + clampByte(b) + ")";
    }

    function clampByte(v) {
      if (!(v > 0)) return 0;
      return v > 255 ? 255 : Math.round(v);
    }

    /**
     * 某一格在位移场里的振幅：0 = 严丝合缝钉在网格上、绝对静止。
     *
     * 与设计稿一致，`w` 是**填充宽度**：`d = 1 - gx/w`，紧贴旋钮处 d→0。
     * 所以无论档位在哪，墙都贴着旋钮，而不是贴着轨道最右端。
     */
    function ampOf(gx, w) {
      if (w <= 0) return 0;
      var d = 1 - gx / w;
      if (d <= STILL_ZONE) return 0;
      return Math.pow((d - STILL_ZONE) / (1 - STILL_ZONE), AMP_POWER);
    }

    /* ── 越界动画（只在最高思考档位触发）────────────────────────────────
       四套共用同一条包络：右侧 `SCATTER_DEAD` 以内是严丝合缝的墙，越往左逃得越多。
       区别只在"飞出去之后怎么动"：
         spray 飞沫 —— 随机逃逸，缩到一半、按距离变淡（设计稿 D 版，默认）
         drift 飘散 —— 不缩小，被横向的风带着摆，越老越淡
         fall  坠落 —— 向下的多、向上的少，像从轨道边上掉下去
         tide  潮汐 —— 逃逸量随全局时间起伏，一波一波涌出去
       返回 { dy, scale, opMul }：dy 是纵向偏移（px，已含幅度），
       opMul 是乘到原不透明度上的系数。纯函数，离线可断言。 */
    /**
     * 单格的"逃逸进度" 0..1：
     * `escAmt` 是全局进度（进最高档 0→1、退档 1→0，0.7s 线性），
     * 这里按它离旋钮的远近错峰 —— 越靠左（sc 越大）起势越晚，
     * 于是进档是一道从滑块向左推的波，退档反过来，不会整片同时跳。
     */
    function scatterLocal(escAmt, sc) {
      return Math.max(0, Math.min(1, (escAmt - sc * 0.30) / 0.70));
    }

    function scatterPose(style, sc, life, cell, amount, waveT) {
      /* 幅度兜底：`amount` 不是有限数时用默认值 —— 否则 dy = NaN，
         `translate3d` 整条作废，格子会僵在原点（见 tick 里的"有限性兜底"）。 */
      var amt = isFinite(amount) ? amount : DEFAULT_SETTINGS.scatterAmount;
      var reach = TRACK_HEIGHT * SCATTER_REACH * amt;
      if (style === "drift") {
        var ed = sc * (0.35 + 0.65 * life);
        var sway = Math.sin(waveT * 1.7 + cell.gx * 0.08 + cell.gy * 0.35);
        return { dy: cell.dir * cell.jit * reach * ed * (0.82 + 0.3 * sway), scale: 1, opMul: 1 - 0.4 * ed };
      }
      if (style === "fall") {
        /* 像"掉下去"：纵向按 life² 加速（起手慢、越掉越快），且绝大多数朝下，
           朝上的只有三成幅度 —— 否则和飞沫看不出区别。 */
        var ef = sc * (0.20 + 0.80 * life * life);
        /* 用每格固定的 `esc` 而不是每轮重掷的 `dir` 来定方向：
           94% 朝下、6% 朝上，一眼就能和"飞沫"分开。 */
        var bias = cell.esc > 0.06 ? 1 : -0.22;
        return {
          dy: bias * cell.jit * reach * ef * 1.3,
          scale: 1 - 0.35 * Math.min(1, ef),
          opMul: 1 - 0.3 * ef,
        };
      }
      if (style === "tide") {
        var wave = 0.5 + 0.5 * Math.sin(waveT * 1.15 + cell.gx * 0.03);
        var et = sc * (0.25 + 0.75 * wave) * (0.5 + 0.5 * life);
        return {
          dy: cell.dir * cell.jit * reach * et,
          scale: 1 - 0.4 * Math.min(1, et),
          opMul: 1 - 0.15 * et,
        };
      }
      var e = sc * (SCATTER_AGE_MIN + (1 - SCATTER_AGE_MIN) * life);
      return {
        dy: cell.dir * cell.jit * reach * e,
        scale: 1 - SCATTER_SHRINK * Math.min(1, e * 1.3),
        opMul: 1 - 0.3 * e,
      };
    }

    /** paint 之前执行副作用：没有 useLayoutEffect 的环境（或测试桩）退回 useEffect。 */
    var useLayout = React.useLayoutEffect || React.useEffect;

    /**
     * 吸附曲线（纯函数，`t` 单位秒）：从 `from` 滑到 `to`，初速 `v0`（pct/秒）。
     *
     * 临界阻尼的闭式解，不积分、不看帧率 —— 掉帧时同一时刻的位置照样对得上：
     *   x(t) = to + (A + B·t)·e^(−ωt)，A = from − to，B = v0 + ω·A
     *
     * `v0` 的夹取是这段动画的关键：
     *   · 朝目标的分量超过 ω·|A| 就会冲过档位再荡回来 —— 那是弹跳，不是吸附，
     *     所以夹在临界速度以内（超过的部分本来就该由"落位"吃掉，而不是让滑块飞过去）；
     *   · 背离目标的初速保留（指尖甩反了要能"被接住"再回来），同样按临界值封顶。
     */
    function settleAt(from, to, v0, t) {
      var A = from - to;
      var critical = SETTLE_OMEGA * Math.abs(A);
      var speed = isFinite(v0) ? v0 : 0;
      if ((to > from && speed < 0) || (to < from && speed > 0)) speed = 0;
      speed = Math.max(-critical, Math.min(critical, speed));
      var B = speed + SETTLE_OMEGA * A;
      return to + (A + B * t) * Math.exp(-SETTLE_OMEGA * t);
    }

    /* ════════════════════════ 粒子墙引擎 ════════════════════════ */

    /**
     * 在 host 里铺一面 cols × ROWS 的方块墙，并起一个 rAF 循环按位移场驱动它。
     *
     * 这一整段是设计稿 `思考强度轨道.html` 的逐行等价实现，别凭直觉改：
     *   · **分母是填充宽度 `w`，不是轨道总宽。** `d = 1 - gx/w`，墙才永远贴着旋钮；
     *     若换成轨道总宽，墙会赖在轨道最右端，旋钮右边就多出一段不该有的马赛克。
     *   · `gx > w - CELL` 的格子直接 `opacity = 0` —— 旋钮右侧那一段是**空凹槽**。
     *   · `amp <= 0`（离旋钮 10% 以内）严格贴网格、绝对静止，这就是密实墙。
     *   · 其余格子按各自 life 向左漂移 / 纵向散开 / 淡出，**每次循环重掷 dir 和 jit**，
     *     所以散开的形状是活的，而不是一条可预测的死轨迹。
     *   · 颜色跟着当前位置 `x` 重算，越往左越浅，不是在出生地定死。
     */
    function createWall(host, width, lvRef, fillWidthRef, burstPowerRef, fillRef2, tailSync, topRef) {
      var cols = Math.max(4, Math.floor(width / CELL));
      var cells = [];
      /* 越界强度：进最高档时 0 → 1、退档时 1 → 0（见 tick 里的过渡曲线）。 */
      var escAmt = 0;
      /* 线性进度（0..1）：强度 `escAmt` 由它做 ease-out 得到。 */
      var escT = 0;
      /* 全局时间（秒）：drift / tide 这两套动画的相位靠它，不是每格各自的相位。 */
      var waveT = Math.random() * 4;
      var rafId = null;
      var lastTs = 0;
      var alive = true;
      var warnedNonFinite = false;

      /* ── 冷启动 ──────────────────────────────────────────────
         打开菜单/详情页时这面墙是新建的。三件事要在**第一帧 paint 之前**就位：
           1. 强度落在一个"半散"的起点（0.45），不是 0 也不是 1 ——
              第一帧不会是一片规整的墙、也不会"啪"地全飞出去，而是有个落位过程；
           2. 相位随机，冷启动不会每次都从同一帧画面开始；
           3. 下面会在建完格子后**同步跑一帧**，保证首帧画出来就是散开的样子
              （否则要先等一次 rAF，中间那一帧是"全在网格上 + 被 30px 盒子裁掉"的）。 */
      var scatterOnAtMount = settings.scatterMode === "all"
        || (settings.scatterMode === "top" && (!topRef || topRef.current === true));
      if (scatterOnAtMount) {
        escT = 0.45;
        escAmt = escT + 0.6 * escT * (1 - escT);
      }

      /* 建墙前先清空 host：上一次的墙如果没被 destroy（React 复用节点、面板重挂），
         残留的 <i> 会被这次的新格子盖住/交错，看起来就是"轨道上多出一颗不动的粒子"。 */
      while (host.firstChild) host.removeChild(host.firstChild);

      for (var gy = 0; gy < ROWS; gy += 1) {
        for (var gx = 0; gx < cols; gx += 1) {
          var el = document.createElement("i");
          el.className = "dem-cell";
          /* 与设计稿一致：整格 5px 严丝合缝铺满网格，不做缩格留缝。 */
          el.style.width = CELL.toFixed(2) + "px";
          el.style.height = CELL.toFixed(2) + "px";
          el.style.opacity = "0";
          cells.push({
            el: el,
            gx: gx * CELL,
            gy: gy * CELL,
            life: hash01(gx + 1, gy + 3),                     /* 相位错开，不同步起动 */
            jit: 0.45 + hash01(gx + 5, gy + 7) * 0.55,
            dir: hash01(gx + 9, gy + 11) < 0.5 ? -1 : 1,
            /* 每格固定的"逃逸倾向"0..1：越界模式下用它挑出哪一部分方块飞出去，
               剩下的继续贴网格撑着马赛克本体（否则整条轨道会被掏空）。 */
            esc: hash01(gx + 13, gy + 17),
            cx: -999,
            op: -1,
            ver: -1,
            out: false,
            /* 是否已经写过 transform。墙区的格子只在"从动画态回到墙"时才写位置，
               留下的洞是：**天生就在墙区**的格子（贴着滑块那一两列）永远没被定位，
               于是一直画在轨道的 (0,0) 上，带着墙区的纯蓝 —— 就是那颗"静止的蓝色粒子"。 */
            placed: false,
          });
          host.appendChild(el);
        }
      }

      function tick(ts) {
        if (!alive) return;
        var dt = lastTs === 0 ? 16.667 : Math.min(48, ts - lastTs);
        lastTs = ts;
        if (!document.hidden) {
          var w = fillWidthRef();
          if (!isFinite(w) || w < 0) w = 0;
          /* 宽度先写：容器与填充都跟着 w 走。预览没有滑块几何，就直接用它的整宽。 */
          if (fillRef2 && fillRef2.current) {
            fillRef2.current.style.width = w.toFixed(2) + "px";
          }
          host.style.width = w.toFixed(2) + "px";
          /* 收口圆心/半径也每帧写：滑块有 .82s 缓动，遮罩必须跟着**真实渲染位置**走，
             否则缓动途中填充还按目标位置裁，就会露出一截"追不上滑块"的轨道。
             预览没有滑块几何（tailSync 为空），不写，CSS 兜底成"不裁"。 */
          if (tailSync) tailSync();
          /* 越界只在**最高思考档位**出现：它是"开满"的那一下，低档位不该有方块飞出去。
             `topRef` 由组件传进来（shownIndex === 最高档）；预览页没有滑块档位，
             传空就当作"一直在最高档"，方便直接看到一个循环。 */
          var scatterMode = settings.scatterMode;
          var scattered = scatterMode === "all"
            || (scatterMode === "top" && (!topRef || topRef.current === true));
          /* 进/退最高档的过渡，两条要求同时满足：
               · 及时 —— 切换的那一下必须马上看见动静（近滑块的一侧立刻起势）；
               · 从容 —— 整片铺开要花近一秒，尾巴慢慢落位，不是"啪"地全出去。
             做法：线性推进 `escT`（进 0.85s / 退 0.6s），再取 **ease-out** 当强度 ——
             曲线一上来就陡（前 0.1s 已经散出三成），后段变缓（最后 0.3s 才落定）。
             落到每一格时再按离旋钮的远近错峰（见 `scatterLocal`），
             于是进档是"从滑块起势、向左推过去"，退档反向收回。 */
          var escDur = scattered ? 850 : 600;
          escT = Math.max(0, Math.min(1, escT + (scattered ? dt / escDur : -dt / escDur)));
          escAmt = escT + 0.6 * escT * (1 - escT);
          /* 裁剪每帧由状态直接写死（不依赖变量继承 / clip-path 解析）。
             判据用 `escAmt` 而不是 `scattered`：退档时那 0.6s 还在往回飞，
             盒子得先开着，否则收回去的半路会被 30px 的盒子齐着切掉。
             **必须排在 `escAmt` 更新之后**：冷启动那一帧强度已经是 0.45 了，
             放到前面就会出现"首帧被裁、第二帧才张开"的闪一下。 */
          var openBox = escAmt > 0.01;
          host.style.overflow = openBox ? "visible" : "hidden";
          host.style.clipPath = openBox
            ? "inset(-420px 0px -420px 0px)"
            : "inset(0px 0px 0px 0px)";
          waveT += dt / 1000;
          /* 设计稿：speedBase = (0.0022 + lv*0.040) * (1 + burstPower*1.6)，每帧固定增量，
             burstPower 每帧衰减 0.05。**不做 dt 归一** —— 设计稿就是按帧走的，144Hz 屏上
             它比 60Hz 快 2.4 倍；一旦按 dt/16.667 归一，144Hz 只剩 36% 的速度，
             怎么调档位都还是慢。 */
          var power = burstPowerRef ? burstPowerRef.current : 0;
          if (power > 0 && burstPowerRef) {
            /* 衰减快慢 = 面板里的"点亮速度"：1.0× 是设计稿原值（每帧 −0.05）。 */
            burstPowerRef.current = Math.max(0, power - 0.05 * settings.burstSpeed);
          }
          var lv = isFinite(lvRef.current) ? lvRef.current : 0;
          var speedBase = (SPEED_BASE + SPEED_PER_LEVEL * lv) * (1 + power * 1.6 * settings.burstIntensity);
          if (!isFinite(speedBase) || speedBase <= 0) speedBase = SPEED_BASE;
          for (var i = 0; i < cells.length; i += 1) {
            var c = cells[i];

            /* 超出当前填充宽度 → 整格隐藏，旋钮右边因此是干净的空凹槽。 */
            if (w < CELL || c.gx > w - CELL) {
              if (c.op !== 0) { c.op = 0; c.el.style.opacity = "0"; }
              continue;
            }

            var amp = ampOf(c.gx, w);

            if (amp <= 0) {
              /* 墙区：严丝合缝贴在网格上，绝对静止（只在离开漂移态时写一次 DOM）。
                 首次进入墙区也必须写一次位置（`!c.placed`）—— 否则它永远停在 (0,0)。 */
              if (c.op !== 1) { c.op = 1; c.el.style.opacity = "1"; }
              if (c.out || !c.placed) {
                c.out = false;
                c.placed = true;
                c.el.style.transform = "translate3d(" + c.gx.toFixed(2) + "px," + c.gy.toFixed(2) + "px,0)";
              }
              if (c.cx < -90 || c.ver !== paletteVersion) {
                c.cx = c.gx;
                c.ver = paletteVersion;
                c.el.style.background = cellColor(c.gx, w);
              }
              continue;
            }

            c.out = true;
            c.life += speedBase * (0.2 + 0.8 * amp);
            if (c.life >= 1) {
              c.life -= 1;
              c.dir = Math.random() < 0.5 ? -1 : 1;           /* 每次循环重掷，形状才活 */
              c.jit = 0.45 + Math.random() * 0.55;
            }

            /* 水平漂移：飞沫模式**不再额外放大**。扩散由纵向位移 + 缩小表达；
               横向再放大只会把左边的方块全推出轨道，扇面反而变空。 */
            var drift = amp * w * DRIFT_SPAN;
            if (drift > c.gx + CELL * MAX_DRIFT_CELLS) drift = c.gx + CELL * MAX_DRIFT_CELLS;
            var x = c.gx - drift * c.life;

            /* ── 越界（只在最高档）─────────────────────────────────────
               右侧 1/5 是**死区**：那一段必须还是严丝合缝的墙，一格都不飞。
               从 20% 处开始平滑起势，越往左逃逸比例越高；飞出去之后怎么动，
               由面板里的「越界动画」决定（spray / drift / fall / tide）。
               `sc` = 0（死区）→ 1（最左端）；`esc` 是每格固定的随机数，
               用来决定"这一格逃不逃"—— 一部分留下继续撑着马赛克本体。 */
            var y = c.gy;
            var scale = 1;
            var ex = 0;
            var poseMul = 1;
            if (escAmt > 0 && w > 0) {
              var dEdge = 1 - c.gx / w;
              var sc = dEdge <= SCATTER_DEAD
                ? 0
                : Math.pow((dEdge - SCATTER_DEAD) / (1 - SCATTER_DEAD), 1.1);
              if (sc > 0 && c.esc < SCATTER_FLOOR + SCATTER_GAIN * sc) {
                /* 空间错峰：越靠左（sc 越大）越晚起势。进档时是一道从滑块向左推的波，
                   退档时反过来 —— 整片不会同时"啪"地飞出去 / 同时归位。 */
                var local = scatterLocal(escAmt, sc);
                if (local > 0) {
                  var pose = scatterPose(settings.scatterStyle, sc, c.life, c, settings.scatterAmount, waveT);
                  ex = sc * local;
                  y = c.gy + pose.dy * local;
                  scale = 1 - (1 - pose.scale) * local;
                  poseMul = pose.opMul;
                  /* 横向错位几个像素：否则同一列上下会串成一根竖线，不像"散开" */
                  x -= (c.esc - 0.5) * 12 * ex;
                }
              }
            }

            var fadeAmt = Math.min(1, amp * 4.5);
            var op = 1 - fadeAmt * Math.pow(c.life, FADE_POWER);
            if (c.life < FADE_IN_SPAN) op *= c.life / FADE_IN_SPAN;
            /* 左端渐隐改成逐格算（原来是粒子层上的一条 CSS mask）。
               两个原因：① mask 会把飞出轨道的方块一起裁掉，越界就看不见了；
               ② 逃出去的那批不该跟着淡到底 —— 扇面最宽的位置就在最左边。 */
            var edge = w > 0 ? Math.min(1, Math.max(0, x) / (0.18 * w)) : 1;
            op *= ex > 0 ? edge + (1 - edge) * 0.85 : edge;
            if (ex > 0) op *= poseMul;
            /* 越过左端：留下的粒子一律收掉；飞出去的允许压边 10px 再淡出 */
            if (x < 0) op = ex > 0 ? op * Math.max(0, 1 + x / 10) : 0;

            /* ★ 有限性兜底（这个 bug 踩过两次）：只要 x / y / scale / op 里有一个是 NaN，
               `translate3d(NaNpx, …)` 会被浏览器**整条丢弃**，格子就永久停在轨道的 (0,0) 上，
               还带着上一帧的颜色和不透明度 —— 看起来就是"轨道左上角有一颗静止的蓝色粒子"。
               所以写 DOM 之前统一过一遍：非有限值退回网格位置，并把颜色缓存打掉强制重刷。 */
            var badX = !isFinite(x);
            var badY = !isFinite(y);
            if (badX) { x = c.gx; c.cx = -999; }
            if (badY) { y = c.gy; c.cx = -999; }
            if ((badX || badY) && !warnedNonFinite && typeof console !== "undefined") {
              /* 只报一次：真出现就说明还有公式漏了兜底，把现场打出来方便定位。 */
              warnedNonFinite = true;
              try {
                console.warn("[effort-mosaic] 粒子位移出现非有限值", {
                  gx: c.gx, gy: c.gy, w: w, amount: settings.scatterAmount, style: settings.scatterStyle,
                });
              } catch (err) { /* 忽略 */ }
            }
            if (!isFinite(scale) || scale <= 0) scale = 1;
            if (!isFinite(op)) op = 0;

            if (Math.abs(op - c.op) > 0.02) { c.op = op; c.el.style.opacity = op.toFixed(2); }
            if (Math.abs(x - c.cx) > CELL || c.ver !== paletteVersion) {
              c.cx = x;
              c.ver = paletteVersion;
              c.el.style.background = cellColor(x, w);
            }
            c.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)"
              + (scale !== 1 ? " scale(" + scale.toFixed(2) + ")" : "");
          }
        }
        rafId = window.requestAnimationFrame(tick);
      }

      /* 同步跑第一帧：此刻 DOM 刚建好、还没 paint，先把格子摆到该在的位置上 ——
         否则第一帧画出来是"全贴在网格上、又被 30px 的盒子裁着"的样子，
         第二帧才散开，冷启动会闪一下。tick 自己会挂上下一帧，这里不能再排一次。 */
      tick(typeof performance !== "undefined" ? performance.now() : Date.now());

      return {
        destroy: function () {
          alive = false;
          if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
          while (host.firstChild) host.removeChild(host.firstChild);
        },
      };
    }

    /* ════════════════════════ 轨道组件 ════════════════════════ */

    /**
     * 一条滑轨。档位数量、名字全部来自外部传入的 levels —— 本组件不认识任何固定档位。
     */
    function EffortTrack(props) {
      var levels = props.levels;
      var count = levels.length;
      var index = Math.max(0, Math.min(count - 1, props.index));
      /* 订阅版式设置：改"点亮样式"要立刻换到对应动画，不能等下次重渲染。 */
      var liveSettings = typeof subscribeSettings === "function"
        ? React.useSyncExternalStore(subscribeSettings, getSettings, getSettings)
        : settings;
      /* 设计稿的 SPEED_PER_LEVEL 是按 **6 档**（lv 0–5）标定的。DSH 常见只有 4 档，
         直接拿序号当 lv、或者归一化成 0–1，都会让每一档只有设计稿的零头速度
         （0–1 时最高档只有 21%）。所以这里统一换算回 0–5 的尺度。 */
      /* lv（速度系数）的赋值必须排在 shownPct 之后 —— 它直接吃显示位置。
         之前放在前面，读到的是 undefined，被 isFinite 兜成 0，速度就永远是最低档。 */

      var trackRef = React.useRef(null);
      var mosaicRef = React.useRef(null);
      var fillRef = React.useRef(null);
      var wallRef = React.useRef(null);
      var draggingRef = React.useRef(false);

      /* 拖动状态必须走 state：它要驱动 data-dragging → 关掉 knob 的缓动，
         读 ref 不会触发重渲染，手感会一直黏着。 */
      var _drag = React.useState(false);
      var dragging = _drag[0];
      var setDragging = _drag[1];

      /* 拖动中的连续位置（0..1）。设计稿是"连续跟手 + 松手吸附"：拖动时旋钮和填充
         跟着指针连续走，松手才落到档位。每动一下就跳档，手感一定是黏的。 */
      var _pos = React.useState(null);
      var dragPct = _pos[0];
      var setDragPct = _pos[1];

      /* 乐观档位：松手瞬间先把旋钮落到目标档，不等后端回读（写回有 120ms 节流）。 */
      var _localIdx = React.useState(null);
      var localIndex = _localIdx[0];
      var setLocalIndex = _localIdx[1];

      /* 吸附中：`snapping` 只用来在这段动画里关掉 knob / fill 的 CSS 过渡
         （两套曲线同时存在会互相追，滑块和填充错位）。位置本身由 rAF 逐帧算。 */
      var _snap = React.useState(false);
      var snapping = _snap[0];
      var setSnapping = _snap[1];
      /* 吸附途中的连续位置（0..1）。null = 没在吸附，显示位置回落到档位本身。 */
      var _settle = React.useState(null);
      var settlePct = _settle[0];
      var setSettlePct = _settle[1];
      /** 正在跑的吸附：{ raf, from, to, v0, t0 }。同一时刻只允许一条。 */
      var settleRef = React.useRef(null);
      /* 最近一次指针采样（位置 + 时间戳）：松手时用它算初速，让吸附接着指尖的势头。 */
      var lastMoveRef = React.useRef(null);

      /* 拉到最高档时给粒子一次瞬时提速（设计稿 `burstPower`）：值是 1，之后
         每帧衰减 0.05。没有它，最高档就只剩一圈光晕，没有"水龙头全开"的冲劲。 */
      var burstPowerRef = React.useRef(0);

      var _useState = React.useState(0);
      var width = _useState[0];
      var setWidth = _useState[1];

      var _burst = React.useState(false);
      var burst = _burst[0];
      var setBurst = _burst[1];

      var topIndex = count - 1;
      /* 显示用的档位与位置：吸附中跟插值，拖动中跟指针，其余时候跟乐观档位 / 后端档位。 */
      var shownIndex = localIndex !== null ? Math.max(0, Math.min(topIndex, localIndex)) : index;
      var shownPct = dragPct !== null
        ? dragPct
        : settlePct !== null ? settlePct : pctOfIndex(shownIndex, count);
      /* 事件处理器绑在挂载时（[] 依赖），读到的是闭包里的旧 state；
         吸附起点必须读"此刻真实显示的位置"，所以每帧同步一份到 ref。 */
      var shownPctRef = React.useRef(shownPct);
      shownPctRef.current = shownPct;
      /* 设计稿的 `lv` 是 `range.value / 100` —— **0–1 的连续值**，不是档位序号。
         拖动途中它连续变大，松手停在某档，速度因此是随位置平滑变化的。
         这里直接用显示位置，语义和设计稿一致；最高档就是 1。
         注意它必须在这个位置定义：放到前面会读到 undefined，被兜成 0，速度永远最低档。 */
      var lvRef = React.useRef(0);
      lvRef.current = isFinite(shownPct) ? Math.max(0, Math.min(1, shownPct)) : 0;

      /* 后端回读的档位一变，就把显示权交回 props；写回失败回滚时也靠它复位。 */
      var prevPropIndexRef = React.useRef(index);
      React.useEffect(function () {
        if (prevPropIndexRef.current === index) return;
        prevPropIndexRef.current = index;
        setLocalIndex(null);
      }, [index]);

      /* 尺寸变化 → 重建墙面网格（格子边长固定，列数随宽度变）。
         **必须 useLayoutEffect**：useEffect 在 paint 之后跑，菜单打开时会先画出一帧
         "空轨道"（还没铺格子），再"啪"地出现一面墙 —— 冷启动最明显的那个闪。
         放到 paint 之前量、paint 之前建墙，第一帧就是最终画面。 */
      useLayout(function () {
        var track = trackRef.current;
        if (!track) return undefined;
        function measure() {
          var w = track.getBoundingClientRect().width;
          setWidth(function (prev) { return Math.abs(prev - w) < 1 ? prev : w; });
        }
        measure();
        if (typeof ResizeObserver !== "function") return undefined;
        var ro = new ResizeObserver(measure);
        ro.observe(track);
        return function () { ro.disconnect(); };
      }, []);

      /* 填充右端要盖到**滑块右缘**，不是滑块中心：填充只画到中心时，空心环
         会把填充的直角截面完整透出来，看着就是轨道从滑块中间接上了。 */
      /* 墙宽**不再按 pct 推**，而是每帧读滑块的真实渲染位置（right - 轨道 left）。
         滑块有 .82s 缓动，墙体是逐帧直读的；按 pct 推的话墙会先跳到目标宽度，
         滑块还在半路 —— 截屏看到的就是"轨道超出滑块"。读 DOM 就永远贴着它。 */
      var knobRef = React.useRef(null);
      /**
       * 滑块的实时几何（相对轨道左上角）：
       *   right —— 内缘右边界，填充/粒子墙的宽度就取它；
       *   cx    —— 圆心，收口遮罩的竖切位置；
       *   r     —— 内缘半径，收口遮罩的圆盘半径。
       * 三个值同源，所以"填充右端 / 粒子右端 / 遮罩曲线"任何时候都是同一条轮廓，
       * 缓动途中也不会各走各的。
       */
      var knobGeomOf = function () {
        var knob = knobRef.current, track = trackRef.current;
        if (!knob || !track || typeof knob.getBoundingClientRect !== "function") return null;
        var kr = knob.getBoundingClientRect();
        var tr = track.getBoundingClientRect();
        if (!kr || !tr || !kr.width) return null;
        /* 只认滑块的**内缘**：border 那圈（环的壁、圆钮的描边）不算进去。
           外圈半透明的高光/描边一旦算作边界，填充就铺进了那圈"透明外边"。
           描边宽度按形状取常量，不去读 computedStyle —— 每帧一次强制样式解析
           在拖动时是纯损耗，而描边只由 `knobShape` 决定。 */
        var bw = knobBorderWidthOf(settings);
        return {
          right: Math.max(0, kr.right - bw - tr.left),
          cx: kr.left + kr.width / 2 - tr.left,
          r: Math.max(0, Math.min(kr.width, kr.height) / 2 - bw),
        };
      };
      var fillWidthOf = function () {
        var g = knobGeomOf();
        /* 到此为止：填充/墙的右边界就是滑块内缘，不再额外回缩。 */
        return g ? g.right : 0;
      };
      /* 收口遮罩的圆心/半径：写回轨道元素，填充层和粒子裁切层都继承它。
         值没变就不写 —— 这两个变量一变，两层遮罩都要重新栅格化；静止时每帧重写
         等于让整条粒子层 60fps 空转。只在滑块真的动了（拖动 / 缓动）时才写。
         用 ref 存上次写入值：组件重渲染后仍指向同一份缓存，不会重复写一遍。 */
      var tailXRef = React.useRef("");
      var tailRRef = React.useRef("");
      var syncTail = function () {
        var track = trackRef.current;
        var g = knobGeomOf();
        if (!track || !g || !track.style || typeof track.style.setProperty !== "function") return;
        var cx = g.cx.toFixed(2) + "px";
        var r = g.r.toFixed(2) + "px";
        if (cx !== tailXRef.current) {
          tailXRef.current = cx;
          track.style.setProperty("--dem-fill-tail-x", cx);
        }
        if (r !== tailRRef.current) {
          tailRRef.current = r;
          track.style.setProperty("--dem-fill-tail-radius", r);
        }
      };
      /* 墙宽不再预存：每一帧都由 fillWidthOf 直接读滑块的真实右缘。 */
      var knobW = knobWidthOf(settings);

      /* 是否在**最高档**：越界动画只在这一档出现。用 ref 传进引擎，
         档位一变引擎下一帧就能读到，不用重建墙。 */
      var atTopRef = React.useRef(false);
      atTopRef.current = count > 1 && shownIndex >= topIndex;

      useLayout(function () {
        var host = mosaicRef.current;
        if (!host || width <= 0) return undefined;
        /* 建墙前先同步一次：首帧就要是"收在滑块内"的样子，不能等第一帧 rAF。 */
        syncTail();
        var wall = createWall(host, width, lvRef, fillWidthOf, burstPowerRef, fillRef, syncTail, atTopRef);
        wallRef.current = wall;
        return function () {
          wall.destroy();
          if (wallRef.current === wall) wallRef.current = null;
        };
      }, [width, count]);

      /* 点亮动作：先清再下一帧开，保证同名动画能重播（设计稿也是 remove + void offsetWidth
         + add 这一套）。burstArmed 负责去重 —— "进入最高档"这件事会被拖拽和档位回读重复
         触发，没有这个标记就只能亮第一次。 */
      var burstTimerRef = React.useRef(null);
      var burstArmedRef = React.useRef(false);
      var mountedRef = React.useRef(false);
      function fireBurst() {
        if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
        setBurst(false);
        window.requestAnimationFrame(function () {
          setBurst(true);
          /* 呼吸是 2.4s 的完整两拍，其余三套 0.9s 就收尾；按样式给足时长，不能把动画掐断。 */
          burstTimerRef.current = window.setTimeout(
            function () { setBurst(false); },
            settings.burstStyle === "pulse" ? 2600 : 900,
          );
        });
        burstPowerRef.current = settings.burstStyle === "shatter"
          ? settings.burstIntensity * 1.9
          : settings.burstIntensity;
      }

      /* 进入最高档就点亮一次。关键是**在拖到最右的那一刻就爆**，不等松手 ——
         设计稿是原生 range 的 input 事件里判 ultra，拖动途中就触发。 */
      React.useEffect(function () {
        if (count < 2) return;
        var firstPaint = !mountedRef.current;
        mountedRef.current = true;
        if (shownIndex === topIndex) {
          /* 打开时本来就是最高档，不凭空闪一下，但要置位，离开再回来才爆。 */
          if (firstPaint) { burstArmedRef.current = true; return; }
          if (!burstArmedRef.current) { burstArmedRef.current = true; fireBurst(); }
        } else {
          burstArmedRef.current = false;
        }
      }, [shownIndex, count, topIndex]);

      /* ══════════════════════ 吸附（松手 / 键盘换档）══════════════════════
         之前这段是 CSS：`left .82s cubic-bezier(.25,.86,.18,1.02)`，可 `data-snapping`
         又把 transition 关掉了 —— 松手瞬间滑块其实是**瞬移**到档位的，只叠了一个
         0.82s 的缩放脉冲，观感是"啪"一下、然后干等脉冲演完（这就是"生硬、卡顿"）。
         而真正走 CSS 过渡的那条路径（|Δpct| ≤ 0.005 的少数情况）初速恒为 0，
         指针还在动时松手必然顿一下。

         现在：位置由 rAF 按 `settleAt()` 的临界阻尼曲线逐帧写，初速取松手前的指针速度。
         慢速松手 = 稳稳滑过去；甩到档位附近 = 接着势头收住；两种都不会在起点顿。 */

      function settleReduceMotion() {
        try {
          return typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (err) { return false; }
      }

      function cancelSettle() {
        var s = settleRef.current;
        if (s && s.raf !== null) window.cancelAnimationFrame(s.raf);
        settleRef.current = null;
      }

      /** 落位脉冲：停稳那一下给旋钮一点接触感。用 WAAPI 是为了每次都能重播。 */
      function popKnob() {
        var knob = knobRef.current;
        if (!knob || typeof knob.animate !== "function" || settleReduceMotion()) return;
        try {
          knob.animate([
            { transform: "scale(1)" },
            { transform: "scale(1.014)", offset: 0.34 },
            { transform: "scale(1)" },
          ], { duration: 260, easing: "cubic-bezier(.25,.82,.36,1)" });
        } catch (err) { /* 老环境没有 WAAPI：不弹也不影响吸附 */ }
      }

      /**
       * 从当前显示位置滑到 `to`（0..1）。`v0` = 指针速度（pct/秒），可缺省。
       * 同一批 state 里先把 settlePct 设成起点，避免"松手那帧先跳到目标、下一帧再回来"。
       */
      function beginSettle(to, v0) {
        if (!isFinite(to)) return;
        var from = shownPctRef.current;
        if (!isFinite(from)) from = to;
        cancelSettle();
        if (settleReduceMotion() || Math.abs(to - from) < 0.0006) {
          setSettlePct(null);
          setSnapping(false);
          return;
        }
        var t0 = (typeof performance !== "undefined" && performance.now)
          ? performance.now() : Date.now();
        setSettlePct(from);
        setSnapping(true);
        /* 直接同步写 DOM：React 的 state 要等下一次 render 才落到属性上，而第一帧 rAF
           可能比那次 render 更早。属性晚一步，第一帧的 `left` 就会走 CSS 过渡，
           滑块先"软一下"再被逐帧覆盖 —— 正是要消掉的那种顿。 */
        var track = trackRef.current;
        if (track && track.setAttribute) track.setAttribute("data-snapping", "1");
        var s = { raf: null, from: from, to: to, v0: v0, t0: t0 };
        settleRef.current = s;

        function step(now) {
          if (settleRef.current !== s) return;          /* 被新的吸附顶掉 */
          var t = Math.max(0, (now - s.t0) / 1000);
          var x = settleAt(s.from, s.to, s.v0, t);
          if (t >= SETTLE_MAX_T || (t >= 0.09 && Math.abs(x - s.to) < 0.0004)) {
            settleRef.current = null;
            setSettlePct(null);
            setSnapping(false);
            if (track && track.setAttribute) track.setAttribute("data-snapping", "0");
            popKnob();
            return;
          }
          setSettlePct(x);
          s.raf = window.requestAnimationFrame(step);
        }
        s.raf = window.requestAnimationFrame(step);
      }

      /* 卸载时把还在跑的吸附停掉，别让 rAF 往已卸载的组件里 setState。 */
      React.useEffect(function () {
        return function () { cancelSettle(); };
      }, []);

      /**
       * 轨道压在官方 `button[role="menuitem"]` 里面。拖拽产生的 pointerdown / click
       * 只要冒泡到那个按钮，官方就把菜单切进「Off / Low / High / Max」文字子面板 ——
       * 这就是"一拖就跳走"的原因。
       *
       * React 的合成事件帮不上忙：它的监听器挂在更外层的 root 容器上，在轨道上
       * `stopPropagation` 拦不住官方直接绑在按钮上的原生监听器。所以这里整段改用
       * **原生监听器 + 冒泡阶段 stopPropagation**，把事件拦死在轨道这一层。
       */
      var latestRef = React.useRef(null);
      latestRef.current = {
        count: count,
        index: shownIndex,
        topIndex: topIndex,
        onPick: props.onPick,
        setDragPct: setDragPct,
        setLocalIndex: setLocalIndex,
        fireBurst: fireBurst,
        burstArmed: burstArmedRef,
        beginSettle: beginSettle,
        cancelSettle: cancelSettle,
        setSettlePct: setSettlePct,
        lastMove: lastMoveRef,
      };

      React.useEffect(function () {
        var track = trackRef.current;
        if (!track) return undefined;

        function pctAt(clientX) {
          var rect = track.getBoundingClientRect();
          var knob = knobWidthOf(settings);
          var radius = knob / 2;
          /* 与渲染同源：端点允许 1px 出界，所以行程是 width - knob + 2。 */
          var span = rect.width - knob + 2;
          if (span <= 0) return 0;
          return clamp01((clientX - rect.left - radius + 1) / span);
        }

        /* 指针速度（pct/秒）：松手瞬间用它当吸附的初速。
           采样间隔太长（>140ms，指针停过）就当作 0 —— 那种情况本来也没有"势头"。 */
        function pointerSpeed(pct, stamp) {
          var now = latestRef.current;
          var lm = now && now.lastMove ? now.lastMove.current : null;
          if (!lm) return 0;
          var dt = stamp - lm.t;
          if (!(dt > 0) || dt > 140) return 0;
          return (pct - lm.pct) / dt * 1000;
        }

        function sample(pct, stamp) {
          var now = latestRef.current;
          if (now && now.lastMove) now.lastMove.current = { pct: pct, t: stamp };
        }

        /* 拖动途中真的贴到最右端 → 立刻点亮，不等松手。
           不能用"最近档位 == 最高档"来判（4 档时 pct ≥ 0.833 就算 Max，
           滑块离端头还有一整格的空档就开始播动画了）。 */
        function checkTop(pct) {
          var now = latestRef.current;
          if (!now || now.count < 2) return;
          if (pct >= 0.97) {
            if (!now.burstArmed.current) {
              now.burstArmed.current = true;
              now.fireBurst();
            }
          } else if (now.burstArmed.current) {
            now.burstArmed.current = false;
          }
        }

        function onPointerDown(event) {
          if (event.button !== undefined && event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          /* preventDefault 连默认的聚焦一起挡了，键盘操作要自己补回来。 */
          try { track.focus({ preventScroll: true }); } catch (err) { track.focus(); }
          try { track.setPointerCapture(event.pointerId); } catch (err) { /* 捕获失败也能拖 */ }
          var now = latestRef.current;
          /* 上一次吸附还在跑就被抓住了：停掉它，别让 rAF 继续往这里写位置。 */
          if (now) { now.cancelSettle(); now.setSettlePct(null); }
          setSnapping(false);
          draggingRef.current = true;
          setDragging(true);
          /* 按下先跳到指针处，但**不写回**：整段拖动都只是本地连续位置。 */
          var pct = pctAt(event.clientX);
          setDragPct(pct);
          sample(pct, event.timeStamp);
          checkTop(pct);
        }

        function onPointerMove(event) {
          if (!draggingRef.current) return;
          event.stopPropagation();
          var pct = pctAt(event.clientX);
          setDragPct(pct);
          sample(pct, event.timeStamp);
          checkTop(pct);
        }

        function onPointerUp(event) {
          if (!draggingRef.current) return;
          event.stopPropagation();
          draggingRef.current = false;
          try { track.releasePointerCapture(event.pointerId); } catch (err) { /* 已释放 */ }

          var now = latestRef.current;
          var pct = pctAt(event.clientX);
          if (!now) { setDragging(false); setDragPct(null); return; }
          var target = indexOfPct(pct, now.count);
          var speed = pointerSpeed(pct, event.timeStamp);

          /* 顺序有讲究：**先**起吸附（它同步把 settlePct 设成松手位置），再清拖动态、
             再落档位。这样即使 React 不做批量更新，中间任意一帧读到的都是"当前位置"，
             不会出现"先跳到目标档、下一帧又跳回来"的一帧闪烁。 */
          now.beginSettle(pctOfIndex(target, now.count), speed);
          setDragging(false);
          setDragPct(null);
          setLocalIndex(target);
          /* 松手位置正好也到顶（拖动中途没覆盖到）→ 立刻点亮，不等档位回读。 */
          checkTop(pct);
          /* 松手后吸附到的就是最高档（但当时没贴到 0.97）→ 档位落定也要点亮一次，
             否则"停在 Max 却没有动画"。 */
          if (target === now.topIndex && !now.burstArmed.current) {
            now.burstArmed.current = true;
            now.fireBurst();
          }

          now.onPick(target, true);
        }

        function onPointerCancel(event) {
          if (!draggingRef.current) return;
          event.stopPropagation();
          draggingRef.current = false;
          var now = latestRef.current;
          var pct = pctAt(event.clientX);
          setDragging(false);
          setDragPct(null);
          /* 被系统打断（来电、切窗口）也要落位，不能把滑块丢在半路。 */
          if (now) now.beginSettle(pctOfIndex(indexOfPct(pct, now.count), now.count), 0);
        }

        /* 点开官方子面板的触发器，一律在轨道这一层吃掉。 */
        function swallow(event) {
          event.stopPropagation();
        }

        function onKeyDown(event) {
          var now = latestRef.current;
          if (!now) return;
          var step = 0;
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") step = -1;
          else if (event.key === "ArrowRight" || event.key === "ArrowUp") step = 1;
          else if (event.key === "Home") step = -now.index;
          else if (event.key === "End") step = now.topIndex - now.index;
          if (step === 0) return;
          event.preventDefault();
          event.stopPropagation();
          var next = Math.max(0, Math.min(now.topIndex, now.index + step));
          /* 键盘换档走同一条吸附曲线（初速 0：按键是离散的，没有"势头"可接）。
             同样先起吸附再改档位，避免中间帧闪一下目标位置。 */
          now.beginSettle(pctOfIndex(next, now.count), 0);
          now.setLocalIndex(next);
          now.onPick(next, true);
        }

        track.addEventListener("pointerdown", onPointerDown);
        track.addEventListener("pointermove", onPointerMove);
        track.addEventListener("pointerup", onPointerUp);
        track.addEventListener("pointercancel", onPointerCancel);
        track.addEventListener("click", swallow);
        track.addEventListener("mousedown", swallow);
        track.addEventListener("mouseup", swallow);
        track.addEventListener("keydown", onKeyDown);
        return function () {
          track.removeEventListener("pointerdown", onPointerDown);
          track.removeEventListener("pointermove", onPointerMove);
          track.removeEventListener("pointerup", onPointerUp);
          track.removeEventListener("pointercancel", onPointerCancel);
          track.removeEventListener("click", swallow);
          track.removeEventListener("mousedown", swallow);
          track.removeEventListener("mouseup", swallow);
          track.removeEventListener("keydown", onKeyDown);
        };
      }, []);

      /* **宽度与位置全部用 JS 算成像素值**，不再让 CSS 用 calc 二次推导。
         之前 calc 里套了 `100%`（相对轨道 content box）和三个 var，任何一环
         取值不同（border、padding、变量没写上）都会让填充悄悄变宽，
         而滑块的 left 用的是另一条式子 —— 两条式子一错位就是"轨道超出滑块"。
         现在两个值同源：滑块右缘 = 填充右端 + 1px，物理上不可能超。 */
      var travelPx = Math.max(0, width - knobW + 2);
      var fillPx = (knobW - 1) + travelPx * shownPct;
      var knobPx = (knobW / 2 - 1) + travelPx * shownPct;
      var geom = fillPx.toFixed(3) + "px";
      var knobPos = knobPx.toFixed(3) + "px";

      var marks = [];
      for (var i = 0; i < count; i += 1) {
        var mPct = pctOfIndex(i, count);
        var mPx = (knobW / 2 - 1) + travelPx * mPct;
        marks.push(React.createElement("i", {
          key: "m" + i,
          /* 设计稿是 `i === 1 ? 'bar' : 'dot'`：第 2 个刻度是 12px 高的竖条，
             其余都是 4px 圆点。全画成圆点就和设计稿对不上了。 */
          className: i === 1 ? "dem-mark dem-mark--bar" : "dem-mark",
          style: { left: mPx.toFixed(3) + "px" },
        }));
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          {
            ref: trackRef,
            className: "dem-track",
            role: "slider",
            tabIndex: 0,
            "aria-label": "推理等级",
            "aria-valuemin": 0,
            "aria-valuemax": topIndex,
            "aria-valuenow": shownIndex,
            "aria-valuetext": levels[shownIndex] ? levels[shownIndex].name : "",
            "data-burst": burst ? "1" : "0",
            "data-burst-style": liveSettings.burstStyle,
            "data-scatter": liveSettings.scatterMode !== "off" ? "1" : "0",
            "data-dragging": dragging ? "1" : "0",
            "data-snapping": snapping ? "1" : "0",
            /* 首帧兜底：效果还没跑起来时遮罩也要裁在滑块内（之后每帧由 rAF 覆写）。
               不声明这两项、只靠 rAF，挂载后的第一帧会露出"整条轨道冲过滑块"的样子。 */
            style: {
              "--dem-fill-tail-x": knobPos,
              "--dem-fill-tail-radius": (Math.min(knobWidthOf(liveSettings), liveSettings.knobSize) / 2
                - knobBorderWidthOf(liveSettings)) + "px",
            },
          },
          React.createElement("div", { ref: fillRef, className: "dem-fill", style: { width: geom } },
            React.createElement("div", { className: "dem-fill-fade", "aria-hidden": "true" }),
          ),
          React.createElement("div", { className: "dem-mosaic-clip", "aria-hidden": "true" },
            React.createElement("div", {
              ref: mosaicRef,
              className: "dem-mosaic",
              "aria-hidden": "true",
              /* 不在这里裁右边界：右侧空凹槽由引擎逐格 `opacity = 0` 实现（设计稿的做法），
                 clip-path 会把上下溢出也一起切掉。 */
            })),
          React.createElement("div", { className: "dem-flush", "aria-hidden": "true" }),
          marks,
          React.createElement("div", {
            className: "dem-knob",
            ref: knobRef,
            "data-knob-shape": liveSettings.knobShape,
            style: { left: knobPos },
          }),
        ),
        props.hint ? React.createElement("div", { className: "dem-hint", role: "status" }, props.hint) : null,
      );
    }

    /* ═════════════════ 官方目录访问（每会话一个，永不抛错）═════════════════ */

    /**
     * `directoryFor(sessionId)` 在会话作用域/绑定就绪前**按设计抛错**，而且目录实例
     * 可能被重建（换模型代 / 连接重置）。所以每次读写都重新解析，解析失败就退避重试；
     * 订阅只在一次成功解析后建立。
     */
    function createAccess(ctx, sessionId) {
      var listeners = new Set();
      var directory = null;
      var unsubscribe = null;
      var last = EMPTY_SNAPSHOT;
      var retryIndex = 0;
      var retryTimer = null;
      var closed = false;
      var lastLoadAt = 0;

      function notify() {
        var current = [];
        listeners.forEach(function (fn) { current.push(fn); });
        for (var i = 0; i < current.length; i += 1) {
          try { current[i](); } catch (err) { /* 单个订阅者抛错不影响其它 */ }
        }
      }

      function scheduleRetry() {
        if (closed || retryTimer !== null || retryIndex >= RETRY_DELAYS.length) return;
        var delay = RETRY_DELAYS[retryIndex];
        retryIndex += 1;
        retryTimer = window.setTimeout(function () {
          retryTimer = null;
          if (resolve() !== null) { notify(); return; }
          scheduleRetry();
        }, delay);
      }

      function resolve() {
        if (closed) return null;
        var fresh = null;
        try {
          fresh = ctx.modelDirectories.directoryFor(sessionId);
        } catch (err) {
          fresh = null;
        }
        if (!fresh || !fresh.store || typeof fresh.store.getSnapshot !== "function") fresh = null;
        if (fresh === directory) return directory;
        if (unsubscribe !== null) {
          try { unsubscribe(); } catch (err) { /* 退订失败不影响新订阅 */ }
          unsubscribe = null;
        }
        directory = fresh;
        if (directory !== null) {
          retryIndex = 0;
          try {
            unsubscribe = typeof directory.store.subscribe === "function"
              ? directory.store.subscribe(notify)
              : null;
          } catch (err) {
            unsubscribe = null;
          }
          kickLoad();
        }
        return directory;
      }

      function kickLoad() {
        if (closed || directory === null || typeof directory.load !== "function") return;
        var now = Date.now();
        if (now - lastLoadAt < 400) return;
        lastLoadAt = now;
        try {
          Promise.resolve(directory.load()).catch(function () { /* 失败原因由 store 的 error 字段呈现 */ });
        } catch (err) {
          /* load 同步抛：交给 store 状态 */
        }
      }

      /** 同一份快照对象身份必须稳定，否则 useSyncExternalStore 会判定"每帧都变"。 */
      function readStable() {
        if (closed) return EMPTY_SNAPSHOT;
        if (directory === null) {
          resolve();
          if (directory === null) scheduleRetry();
        }
        if (directory !== null) {
          try {
            var value = directory.store.getSnapshot();
            if (value && typeof value === "object") {
              if (last === EMPTY_SNAPSHOT
                || value.current !== last.current
                || value.groups !== last.groups
                || value.status !== last.status
                || value.error !== last.error) {
                last = value;
              }
            }
          } catch (err) {
            /* 保留上一次快照，绝不把渲染打崩 */
          }
        }
        return last;
      }

      return {
        getSnapshot: readStable,
        subscribe: function (listener) {
          if (closed) return function () {};
          listeners.add(listener);
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          return function () { listeners.delete(listener); };
        },
        directory: function () { return directory; },
        select: function (payload) {
          if (directory === null) resolve();
          if (directory === null || typeof directory.select !== "function") return null;
          return directory.select(payload);
        },
        destroy: function () {
          closed = true;
          if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
          if (unsubscribe !== null) { try { unsubscribe(); } catch (err) { /* 忽略 */ } unsubscribe = null; }
          listeners.clear();
          directory = null;
        },
      };
    }

    /* ════════════════════════ 官方菜单桥 ════════════════════════ */

    /** 在菜单里找「推理等级」那一行：根面板恰好两个 menuitem，取第 2 个。 */
    function findEffortRow(menu) {
      if (!menu || typeof menu.querySelectorAll !== "function") return null;
      var items = menu.querySelectorAll('button[role="menuitem"]');
      if (items.length === 2) return items[1];
      for (var i = 0; i < items.length; i += 1) {
        var text = (items[i].textContent || "").trim();
        for (var j = 0; j < EFFORT_ROW_LABELS.length; j += 1) {
          if (text.indexOf(EFFORT_ROW_LABELS[j]) !== -1) return items[i];
        }
      }
      return null;
    }

    var composers = new Map();
    var scanScheduled = false;
    var observer = null;

    function bumpResize() {
      try { window.dispatchEvent(new Event("resize")); } catch (err) { /* 官方自己也会重测 */ }
    }

    function teardownEntry(entry) {
      if (entry.row === null) return;
      try {
        if (entry.container !== null && entry.container.parentNode) {
          entry.container.parentNode.removeChild(entry.container);
        }
      } catch (err) { /* 容器可能已被官方一起销毁 */ }
      try {
        entry.row.style.height = entry.prevStyle.height;
        entry.row.style.flexWrap = entry.prevStyle.flexWrap;
        entry.row.style.paddingBlock = entry.prevStyle.paddingBlock;
        entry.row.style.backgroundColor = entry.prevStyle.backgroundColor;
      } catch (err) { /* 行已不在 */ }
      entry.row = null;
      entry.container = null;
      entry.setContainer(null);
      bumpResize();
    }

    /**
     * 官方菜单行右侧那个档位值（`推理等级 … Max`）、以及输入框胶囊里的档位名，
     * 都由官方渲染成中性色。插件只做一件事：**当前生效档位是最高档时**，
     * 把那段文字染成品牌蓝 —— 蓝色在这里是"拉满"的信号。
     * 靠文本精确匹配 `levels` 里声明的名字，标题、模型名一律不动。
     */
    function tintEffortText(root, snapshot) {
      if (!root || typeof document.createTreeWalker !== "function") return;
      var levels = levelsOf(snapshot);
      if (levels.length === 0) return;
      var liveIndex = indexOfLevel(levels, effectiveEffortId(snapshot));
      var hot = liveIndex === levels.length - 1;
      var byName = {};
      for (var i = 0; i < levels.length; i += 1) {
        if (levels[i] && typeof levels[i].name === "string" && levels[i].name) byName[levels[i].name] = 1;
      }
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.nodeValue || "").trim();
        if (!text || !byName[text]) continue;
        var host = node.parentElement;
        if (!host) continue;
        if (hot) host.style.setProperty("color", tintColorOf(), "important");
        else if (host.style.getPropertyValue("color")) host.style.removeProperty("color");
      }
    }

    function mountEntry(entry, row) {
      var prevStyle = {
        height: row.style.height,
        flexWrap: row.style.flexWrap,
        paddingBlock: row.style.paddingBlock,
        backgroundColor: row.style.backgroundColor,
      };
      var container = document.createElement("div");
      container.className = "dem-inline";
      /* 这一行被就地改造成"标题 + 第二行轨道"。加高后官方菜单会重新测量位置。 */
      row.style.height = "auto";
      row.style.flexWrap = "wrap";
      row.style.paddingBlock = "8px";
      /* 把这一行自己的底色交还给透明：菜单项悬停时会铺一层
         `--dsw-alias-interactive-bg-hover`，行被拉高之后那层高亮会变成
         一条横贯整块面板的亮带（浅色近白、深色近白），看起来就像一张白卡片。
         轨道本身就是整块热区，不需要这层反馈，所以这里静默接管、卸载时原样还原。 */
      row.style.backgroundColor = "transparent";
      row.appendChild(container);
      entry.row = row;
      entry.container = container;
      entry.prevStyle = prevStyle;
      entry.setContainer(container);
      /* 菜单行挂上之后立刻按当前档位染一次（打开时本来就是最高档，也要是蓝的）。 */
      try { tintEffortText(row, entry.access.getSnapshot()); } catch (err) { /* 染色失败不影响轨道 */ }
      bumpResize();
    }

    function scanOnce() {
      composers.forEach(function (entry, card) {
        try {
          if (!card.isConnected) { teardownEntry(entry); composers.delete(card); return; }
          var seat = card.querySelector('button[aria-haspopup="menu"][aria-expanded="true"]');
          if (!seat) { teardownEntry(entry); return; }
          var menuId = seat.getAttribute("aria-controls");
          var menu = menuId ? document.getElementById(menuId) : null;
          var row = findEffortRow(menu);
          if (!row || !row.isConnected) { teardownEntry(entry); return; }
          if (entry.row === row) return;
          teardownEntry(entry);
          mountEntry(entry, row);
        } catch (err) { /* 一个 composer 出错不影响其它 */ }
      });
    }

    function scheduleScan() {
      if (scanScheduled) return;
      scanScheduled = true;
      window.requestAnimationFrame(function () {
        scanScheduled = false;
        scanOnce();
      });
    }

    function startBridge() {
      if (observer !== null) return;
      try {
        observer = new MutationObserver(function () { scheduleScan(); });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-expanded", "aria-controls"],
        });
      } catch (err) {
        observer = null;
      }
      scheduleScan();
    }

    /* ════════════════════════ 接线组件 ════════════════════════ */

    /** 把目录快照、档位表、写回节流、乐观显示攥在一起。 */
    function ConnectedTrack(props) {
      var entry = props.entry;
      var access = entry.access;
      var state = React.useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);

      var levels = levelsOf(state);
      var liveIndex = indexOfLevel(levels, effectiveEffortId(state));

      /* 档位一变（含拖动落档后宿主回写）就把菜单行右侧那个值重染一遍：
         最高档蓝、其它档恢复官方中性色。 */
      React.useEffect(function () {
        tintEffortText(entry.row, state);
      }, [state, entry]);

      var _draft = React.useState(null);
      var draft = _draft[0];
      var setDraft = _draft[1];

      var _hint = React.useState(null);
      var hint = _hint[0];
      var setHint = _hint[1];

      var pendingRef = React.useRef({ levelId: null, timer: null, inFlight: false });
      var deadlineRef = React.useRef(null);

      /* 宿主真的写进去了 → 丢掉乐观草稿 */
      React.useEffect(function () {
        if (draft === null) return;
        if (liveIndex === draft) setDraft(null);
      }, [liveIndex, draft]);

      React.useEffect(function () {
        return function () {
          var pending = pendingRef.current;
          if (pending.timer !== null) window.clearTimeout(pending.timer);
          if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
        };
      }, []);

      function flush() {
        var pending = pendingRef.current;
        if (pending.timer !== null) { window.clearTimeout(pending.timer); pending.timer = null; }
        var levelId = pending.levelId;
        pending.levelId = null;
        if (levelId === null || pending.inFlight) return;

        var snapshot = access.getSnapshot();
        var current = snapshot && snapshot.current;
        if (!current || typeof current.provider !== "string" || typeof current.model !== "string") {
          setHint("模型目录尚未就绪");
          return;
        }
        if (effectiveEffortId(snapshot) === levelId) return;

        var result;
        try {
          result = access.select({ provider: current.provider, model: current.model, reasoningEffort: levelId });
        } catch (err) {
          result = Promise.reject(err);
        }
        if (result === null) { setHint("模型目录不可用"); return; }

        pending.inFlight = true;
        setHint(null);
        if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
        deadlineRef.current = window.setTimeout(function () {
          pending.inFlight = false;
          deadlineRef.current = null;
          setDraft(null);
          setHint("写入超时，已回滚");
        }, COMMIT_DEADLINE_MS);

        Promise.resolve(result).then(
          function (outcome) {
            pending.inFlight = false;
            if (deadlineRef.current !== null) { window.clearTimeout(deadlineRef.current); deadlineRef.current = null; }
            if (outcome && outcome.ok === false) {
              setDraft(null);
              setHint("这一档没有写入成功");
            }
          },
          function (err) {
            pending.inFlight = false;
            if (deadlineRef.current !== null) { window.clearTimeout(deadlineRef.current); deadlineRef.current = null; }
            setDraft(null);
            setHint(String(err && err.message ? err.message : err));
          },
        ).then(function () {
          if (pendingRef.current.levelId !== null) flush();
        });
      }

      function onPick(index, immediate) {
        if (levels.length === 0) return;
        var level = levels[Math.max(0, Math.min(levels.length - 1, index))];
        if (!level) return;
        setDraft(index);
        var pending = pendingRef.current;
        pending.levelId = level.id;
        if (immediate) { flush(); return; }
        if (pending.timer !== null) return;
        pending.timer = window.setTimeout(function () {
          pending.timer = null;
          flush();
        }, COMMIT_THROTTLE_MS);
      }

      if (levels.length === 0) return null;

      var displayIndex = draft !== null ? draft : (liveIndex >= 0 ? liveIndex : 0);

      return React.createElement(EffortTrack, {
        levels: levels,
        index: displayIndex,
        onPick: onPick,
        hint: hint,
      });
    }

    /**
     * 每个会话挂一个**不可见的锚点**：它唯一的职责是拿到插槽给的 `sessionId`，
     * 并向上找到自己所属的 composer 卡片，从而保证只改自己这个菜单。
     */
    function SlotComponent(props) {
      var anchorRef = React.useRef(null);
      var entryRef = React.useRef(null);

      var _container = React.useState(null);
      var container = _container[0];
      var setContainer = _container[1];

      var ctx = props.__ctx;
      var sessionId = typeof props.sessionId === "string" && props.sessionId.length > 0 ? props.sessionId : null;

      React.useEffect(function () {
        var el = anchorRef.current;
        if (!el || ctx === undefined || sessionId === null) return undefined;
        var card = typeof el.closest === "function" ? el.closest("[data-composer-card]") : null;
        if (!card) return undefined;
        var entry = {
          sessionId: sessionId,
          access: createAccess(ctx, sessionId),
          row: null,
          container: null,
          prevStyle: null,
          setContainer: setContainer,
        };
        entryRef.current = entry;
        composers.set(card, entry);
        startBridge();
        scheduleScan();

        /* 官方胶囊把档位显示成灰白（`DeepSeek-V4.1-Flash Max` 里的 Max），深色卡上
           读不出"当前强度"。这里只给**档位名那一段文本**上品牌蓝：靠 TextWalker
           精确匹配 access 里声明的档位名，模型名和其它文字一律不动。
           节流 160ms，观察根就是本组件所属的 composer 卡片，不是整个 body。 */
        var tintTimer = null;
        var tintQueued = false;
        function paintEffortName() {
          tintQueued = false;
          /* 输入框胶囊里的档位名（`DeepSeek-V4.1-Flash Max` 的 Max）走同一套规则：
             只有当前生效档位是最高档才染蓝，其它档恢复官方中性色。 */
          tintEffortText(card, entry.access.getSnapshot());
        }
        function queueTint() {
          if (tintQueued) return;
          tintQueued = true;
          if (tintTimer !== null) window.clearTimeout(tintTimer);
          tintTimer = window.setTimeout(paintEffortName, 160);
        }
        paintEffortName();
        var tintUnsub = null;
        try { tintUnsub = entry.access.subscribe(queueTint); } catch (err) { tintUnsub = null; }
        var tintObserver = null;
        if (typeof MutationObserver === "function") {
          tintObserver = new MutationObserver(queueTint);
          tintObserver.observe(card, { childList: true, subtree: true, characterData: true });
        }

        return function () {
          if (composers.get(card) === entry) composers.delete(card);
          teardownEntry(entry);
          entry.access.destroy();
          entryRef.current = null;
          if (tintTimer !== null) window.clearTimeout(tintTimer);
          if (tintObserver) tintObserver.disconnect();
          if (typeof tintUnsub === "function") tintUnsub();
        };
      }, [ctx, sessionId, setContainer]);

      return React.createElement(
        React.Fragment,
        null,
        React.createElement("span", {
          ref: anchorRef,
          "aria-hidden": "true",
          "data-dem-part": "anchor",
          style: { display: "none" },
        }),
        container !== null && entryRef.current !== null
          ? ReactDOM.createPortal(React.createElement(ConnectedTrack, { entry: entryRef.current }), container)
          : null,
      );
    }

    /* ═══════════════════ 插件详情页里的自定义版式面板 ═══════════════════ */

    /** 色板：第一格是默认强调色，其余是同一明度带上的邻近色，避免挑出脏色。 */
    var ACCENT_PRESETS = ["#4A84FF", "#7C6CFF", "#2BB6A8", "#F2784B", "#E8B33C", "#8B93A5"];

    var SHAPE_OPTIONS = [
      { value: "circle", label: "圆" },
      { value: "ring", label: "环" },
      { value: "rounded", label: "方" },
      { value: "pill", label: "胶囊" },
      { value: "blade", label: "细棒" },
    ];
    var SIZE_OPTIONS = [
      { value: 28, label: "28" },
      { value: 30, label: "30" },
      { value: 34, label: "34" },
    ];
    var KNOB_FILL_OPTIONS = [
      { value: "white", label: "白瓷" },
      { value: "tinted", label: "染色" },
      { value: "accent", label: "强调色" },
      { value: "frosted", label: "磨砂" },
    ];

    function segment(key, options, value, onPick) {
      return React.createElement(
        "div",
        { className: "dem-cfg-seg", key: key },
        options.map(function (opt) {
          return React.createElement(
            "button",
            {
              key: String(opt.value),
              type: "button",
              className: "dem-cfg-opt",
              "data-on": value === opt.value ? "1" : "0",
              onClick: function () { onPick(opt.value); },
            },
            opt.label,
          );
        }),
      );
    }

    function summaryLine(current) {
      var shape = current.knobShape === "ring" ? "空心环"
        : current.knobShape === "rounded" ? "圆角方"
          : current.knobShape === "pill" ? "胶囊"
            : current.knobShape === "blade" ? "细棒" : "实心圆";
      var fill = current.knobFill === "tinted" ? "染色"
        : current.knobFill === "accent" ? "强调色"
          : current.knobFill === "frosted" ? "磨砂" : "白瓷";
      var burstName = current.burstStyle === "scan" ? "扫描线"
        : current.burstStyle === "shatter" ? "爆散"
          : current.burstStyle === "pulse" ? "呼吸" : "能量波";
      return "强调色 " + current.accent + " · " + fill + shape + " " + current.knobSize + "px"
        + " · " + burstName + " " + current.burstIntensity.toFixed(1) + "×";
    }

    /**
     * 挂在 `plugins.bundle.config` 上，key = 包名。
     * `view: "summary"` 是插件卡片上那一行摘要，`view: "page"` 是详情页里的表单。
     */
    function ConfigSection(props) {
      var view = props && props.view === "summary" ? "summary" : "page";
      var current = React.useSyncExternalStore(subscribeSettings, getSettings, getSettings);
      /* 预览轨道的点亮演示：切样式时自动放一遍，也可以点"播放"手动重放。 */
      var burstPair = React.useState(false);
      var previewBurst = burstPair[0];
      var setPreviewBurst = burstPair[1];
      var burstTimer = React.useRef(0);
      /* 预览里跑真粒子：不靠 state 测量，直接读布局宽度建墙。
         用 state 那套会碰上"首次测量值偏小、之后不再更新"，墙铺不满轨道，
         填充宽又被当成 70% 左右，静止区看起来就占掉三分之一。 */
      var previewTrackRef = React.useRef(null);
      var previewMosaicRef = React.useRef(null);

      React.useEffect(function () {
        if (view !== "page") return undefined;
        var host = previewMosaicRef.current;
        var track = previewTrackRef.current;
        if (!host || !track) return undefined;
        var wall = null;
        var built = -1;
        var rebuild = function () {
          var width = track.clientWidth || track.getBoundingClientRect().width;
          /* 面板还没展开时宽度可能只有几像素：这种"墙"没有意义，等下一次 RO 再来。 */
          if (!(width > CELL * 4)) return;
          if (Math.abs(width - built) < 1) return;
          built = width;
          if (wall) wall.destroy();
          wall = createWall(host, width, { current: 1 }, function () {
            return Math.max(0, width + 1);
          }, null);
        };
        rebuild();
        var ro = typeof ResizeObserver === "function" ? new ResizeObserver(rebuild) : null;
        if (ro) ro.observe(track);
        return function () {
          if (ro) ro.disconnect();
          if (wall) wall.destroy();
        };
      }, [view]);

      var firePreview = function () {
        setPreviewBurst(false);
        if (burstTimer.current) clearTimeout(burstTimer.current);
        /* 呼吸是 2.4s 的慢节律，其余三套 1s 内收尾——留一点尾巴再收回才不会被掐断。 */
        var holdMs = current.burstStyle === "pulse" ? 2500 : 1150;
        /* 先清一帧再挂上，同一个动画才能连续重放（否则第二次点不重启动画）。 */
        burstTimer.current = setTimeout(function () {
          setPreviewBurst(true);
          burstTimer.current = setTimeout(function () { setPreviewBurst(false); }, holdMs);
        }, 16);
      };

      if (view === "summary") return React.createElement(React.Fragment, null, summaryLine(current));

      var tintRgb = current.tintMode === "custom" ? current.tintColor : current.accent;

      var rows = [
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "accent" },
          React.createElement("div", { className: "dem-cfg-label" }, "滑轨强调色"),
          React.createElement(
            "div",
            { className: "dem-cfg-swatches" },
            ACCENT_PRESETS.map(function (hex) {
              return React.createElement("button", {
                key: hex,
                type: "button",
                className: "dem-cfg-swatch",
                style: { background: hex, color: hex },
                title: hex,
                "data-on": current.accent.toUpperCase() === hex.toUpperCase() ? "1" : "0",
                onClick: function () { updateSettings({ accent: hex }); },
              });
            }),
            React.createElement("input", {
              className: "dem-cfg-hex",
              value: current.accent,
              spellCheck: false,
              onChange: function (event) {
                var raw = String(event.target.value || "").trim();
                if (hexToRgb(raw)) updateSettings({ accent: raw });
              },
            }),
          ),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "tint" },
          React.createElement("div", { className: "dem-cfg-label" }, "最高档字符"),
          segment("tint-seg", [
            { value: "accent", label: "跟随强调色" },
            { value: "custom", label: "自定义" },
          ], current.tintMode, function (mode) { updateSettings({ tintMode: mode }); }),
          React.createElement("button", {
            type: "button",
            className: "dem-cfg-swatch",
            style: { background: tintRgb, color: tintRgb },
            title: "最高档字符颜色",
            "data-on": current.tintMode === "custom" ? "1" : "0",
            onClick: function () {
              var order = ACCENT_PRESETS.indexOf(current.tintColor.toUpperCase());
              var next = ACCENT_PRESETS[(order + 1) % ACCENT_PRESETS.length];
              updateSettings({ tintMode: "custom", tintColor: next });
            },
          }),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "shape" },
          React.createElement("div", { className: "dem-cfg-label" }, "滑块形状"),
          segment("shape-seg", SHAPE_OPTIONS, current.knobShape, function (shape) { updateSettings({ knobShape: shape }); }),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "size" },
          React.createElement("div", { className: "dem-cfg-label" }, "滑块大小"),
          segment("size-seg", SIZE_OPTIONS, current.knobSize, function (size) { updateSettings({ knobSize: size }); }),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "fill" },
          React.createElement("div", { className: "dem-cfg-label" }, "滑块填充"),
          segment("fill-seg", KNOB_FILL_OPTIONS, current.knobFill, function (fill) { updateSettings({ knobFill: fill }); }),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "style" },
          React.createElement("div", { className: "dem-cfg-label" }, "点亮样式"),
          segment("bstyle-seg", [
            { value: "ripple", label: "能量波" },
            { value: "scan", label: "扫描线" },
            { value: "shatter", label: "爆散" },
            { value: "pulse", label: "呼吸" },
          ], current.burstStyle, function (style) {
            updateSettings({ burstStyle: style });
            firePreview();
          }),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "scatter" },
          React.createElement("div", { className: "dem-cfg-label" }, "粒子越界"),
          segment("scatter-seg", [
            { value: "off", label: "关" },
            { value: "top", label: "最高档" },
            { value: "all", label: "全档位" },
          ], current.scatterMode, function (mode) { updateSettings({ scatterMode: mode }); }),
          React.createElement("span", { className: "dem-cfg-value" },
            current.scatterMode === "off" ? "轨内" : current.scatterMode === "top" ? "仅 Max" : "常开"),
        ),
        /* 越界动画：四套完整动效，不是同一套改参数。 */
        current.scatterMode !== "off" ? React.createElement(
          "div",
          { className: "dem-cfg-row", key: "scatter-style" },
          React.createElement("div", { className: "dem-cfg-label" }, "越界动画"),
          segment("scatter-style-seg", [
            { value: "spray", label: "飞沫" },
            { value: "drift", label: "飘散" },
            { value: "fall", label: "坠落" },
            { value: "tide", label: "潮汐" },
          ], current.scatterStyle, function (style) { updateSettings({ scatterStyle: style }); }),
        ) : null,
        /* 幅度只在开的时候才有意义：1.0× ≈ 一个轨道高（30px）的逃逸距离。
           真机菜单上下只放得下约 20px，0.8× 左右最稳；想看包络可以拉到 2×。 */
        current.scatterMode !== "off" ? React.createElement(
          "div",
          { className: "dem-cfg-row", key: "scatter-amount" },
          React.createElement("div", { className: "dem-cfg-label" }, "越界幅度"),
          React.createElement("input", {
            className: "dem-cfg-range",
            type: "range", min: "0.4", max: "2.4", step: "0.1",
            value: String(current.scatterAmount),
            onChange: function (event) { updateSettings({ scatterAmount: parseFloat(event.target.value) }); },
          }),
          React.createElement("span", { className: "dem-cfg-value" }, current.scatterAmount.toFixed(1) + "×"),
        ) : null,
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "intensity" },
          React.createElement("div", { className: "dem-cfg-label" }, "点亮强度"),
          React.createElement("input", {
            className: "dem-cfg-range",
            type: "range", min: "0.4", max: "1.8", step: "0.1",
            value: String(current.burstIntensity),
            onChange: function (event) { updateSettings({ burstIntensity: parseFloat(event.target.value) }); },
          }),
          React.createElement("span", { className: "dem-cfg-value" }, current.burstIntensity.toFixed(1) + "×"),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "speed" },
          React.createElement("div", { className: "dem-cfg-label" }, "点亮速度"),
          React.createElement("input", {
            className: "dem-cfg-range",
            type: "range", min: "0.6", max: "1.4", step: "0.1",
            value: String(current.burstSpeed),
            onChange: function (event) { updateSettings({ burstSpeed: parseFloat(event.target.value) }); },
          }),
          React.createElement("span", { className: "dem-cfg-value" }, current.burstSpeed.toFixed(1) + "×"),
        ),
      ];

      return React.createElement(
        "div",
        { className: "dem-cfg" },
        React.createElement(
          "div",
          { className: "dem-cfg-head" },
          React.createElement("div", { className: "dem-cfg-title" }, "自定义版式"),
          React.createElement("div", { className: "dem-cfg-desc" }, "只改外观，不动档位。"),
        ),
        rows,
        React.createElement(
          "div",
          { className: "dem-cfg-preview" },
          React.createElement(
            "div",
            {
              className: "dem-track dem-cfg-preview-track",
              ref: previewTrackRef,
              "data-burst": previewBurst ? "1" : "0",
              "data-burst-style": current.burstStyle,
              "data-scatter": current.scatterMode !== "off" ? "1" : "0",
            },
            React.createElement(
              "div",
              { className: "dem-cfg-preview-clip" },
              React.createElement("div", { className: "dem-fill dem-cfg-preview-fill" },
                React.createElement("div", { className: "dem-fill-fade", "aria-hidden": "true" }),
              ),
              React.createElement("div", { className: "dem-flush" }),
            ),
            /* 粒子层放到 clip 外面：预览才能真的看见"越界"，不被圆角容器裁掉。
               默认档仍然套 .dem-mosaic-clip：预览和真轨道必须是同一个轮廓，
               否则预览是圆的、菜单里是方的，等于没对齐设计稿。 */
            React.createElement("div", { className: "dem-mosaic-clip", "aria-hidden": "true" },
              React.createElement("div", { className: "dem-mosaic dem-cfg-preview-mosaic", ref: previewMosaicRef })),
            React.createElement("div", {
              className: "dem-knob dem-cfg-preview-knob",
              "data-knob-shape": current.knobShape,
            }),
          ),
          React.createElement(
            "div",
            { className: "dem-cfg-preview-bar" },
            React.createElement("span", { className: "dem-cfg-note" }, "点亮预览 · 切样式会自动放一遍"),
            React.createElement("button", {
              type: "button",
              className: "dem-cfg-play",
              onClick: firePreview,
            }, "播放"),
          ),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-foot" },
          React.createElement("span", { className: "dem-cfg-note" }, "改完立即生效，无需重启"),
          React.createElement("button", {
            type: "button",
            className: "dem-cfg-reset",
            onClick: function () { resetSettings(); },
          }, "恢复默认"),
        ),
      );
    }

    /* ════════════════════════════ 插件接线 ════════════════════════════ */

    /**
     * `modelDirectories` 是 client-ui-model-selection 的既有注入面；
     * `remote` / `remote.session` 必须一起声明 —— 少了它们，`directoryFor()`
     * 会在"会话作用域/绑定尚未就绪"时长期解析失败，档位列表为空。
     */
    var inject = ["slots", "sessions", "modelDirectories", "remote", "remote.session"];

    function installStyles() {
      try {
        if (document.querySelector('style[data-plugin="' + PACKAGE_ID + '"]')) return;
        var style = document.createElement("style");
        style.dataset.plugin = PACKAGE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
      } catch (err) { /* 样式失败不影响注册 */ }
    }

    function apply(ctx) {
      installStyles();
      try {
        ctx.slots.inject(SLOT_NAME, function () {
          return ctx.slots.register(
            {
              name: SLOT_NAME,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              label: function () { return "Effort mosaic"; },
              inject: function (sessionId) { return { sessionId: sessionId }; },
            },
            function Slot(props) {
              return React.createElement(SlotComponent, Object.assign({}, props, { __ctx: ctx }));
            },
          );
        });
      } catch (err) {
        try { console.error("[effort-mosaic] 插槽注册失败，控件不会出现：", err); } catch (e) { /* 忽略 */ }
      }
      /* 插件详情页里的自定义版式面板。key 就是这个 bundle 的包名，
         所以它只出现在「插件 → dsh-effort-mosaic → 详情」这一个页面。 */
      try {
        ctx.slots.inject("plugins.bundle.config", function () {
          return ctx.slots.register(
            { name: "plugins.bundle.config", key: PACKAGE_ID },
            function ConfigSlot(props) {
              return React.createElement(ConfigSection, Object.assign({}, props));
            },
          );
        });
      } catch (err) {
        try { console.error("[effort-mosaic] 版式面板注册失败：", err); } catch (e) { /* 忽略 */ }
      }
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    /* 离线测试接缝：纯函数。运行时无副作用。 */
    exports.__internals = {
      levelsOf: levelsOf,
      modelOf: modelOf,
      effectiveEffortId: effectiveEffortId,
      indexOfLevel: indexOfLevel,
      pctOfIndex: pctOfIndex,
      indexOfPct: indexOfPct,
      levelsKey: levelsKey,
      ampOf: ampOf,
      cellColor: cellColor,
      findEffortRow: findEffortRow,
      EffortTrack: EffortTrack,
      ConfigSection: ConfigSection,
      CSS: CSS,
      STILL_ZONE: STILL_ZONE,
      ROWS: ROWS,
      CELL: CELL,
      /* 自定义版式（配色派生 + 存取），离线可断言。 */
      DEFAULT_SETTINGS: DEFAULT_SETTINGS,
      normalizeSettings: normalizeSettings,
      paletteOf: paletteOf,
      hexToRgb: hexToRgb,
      mixWhite: mixWhite,
      scatterPose: scatterPose,
      scatterLocal: scatterLocal,
      SCATTER_STYLES: SCATTER_STYLES,
      SCATTER_DEAD: SCATTER_DEAD,
      settleAt: settleAt,
      SETTLE_OMEGA: SETTLE_OMEGA,
      knobWidthOf: knobWidthOf,
      knobBorderWidthOf: knobBorderWidthOf,
      bandHeightOf: bandHeightOf,
      knobRadiusOf: knobRadiusOf,
      knobSurfaceOf: knobSurfaceOf,
      knobSheenOf: knobSheenOf,
      SHAPES: SHAPES,
      FILLS: FILLS,
      BURST_STYLES: BURST_STYLES,
      createWall: createWall,
      getSettings: getSettings,
      updateSettings: updateSettings,
      resetSettings: resetSettings,
      tintColorOf: tintColorOf,
    };

    return module.exports;
  },
});
