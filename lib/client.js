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
    /* 改名过渡期用过的包名：那期间安装的用户，profile link 键仍是它。
       配置面板按两个键各注册一份，避免详情页配置板块消失。 */
    var LEGACY_PACKAGE_ID = "dsh-effortmosaic";
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

    /* ── 粒子墙参数：逐项照抄设计稿 思考强度轨道.html ────────────────── */
    /** 行数。设计稿是 30px 轨道 / CELL 5 = 6 行，6 行严丝合缝铺满轨道。 */
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
    /** 判定"点击"还是"拖动"的横向阈值（px）：小于它抬起就算点击。 */
    var TAP_SLOP = 5;
    /**
     * 实心滑块收口向左让出的安全距离（px）。
     *
     * 填充/粒子的竖切原本切在滑块圆心。静止时白色旋钮能盖住，但拖动形变时
     * 旋钮会 scale + skew，右上 / 右下角比填充的竖切口更早收进去，填充的
     * 顶边 / 底边就会在旋钮右侧露出两小截蓝线。把切口往左退 8px，切口永远
     * 藏在旋钮本体下面；空心环需要环心透色，不能退，保持圆心。
     */
    var TAIL_CUT_GUARD = 8;
    /* 点击 / 键盘换档的视觉落位时间：对话界面保持原来的 300ms；
       预览卡原来为了早一点改字压到 240ms，但 240ms 落在 `.dem-knob` 的
       `.3s` 过渡中段，字符先跳、滑块还在走，看起来像"点完又弹一下"。
       预览单独回到 300ms，等滑块真正收口再切字；对话轨道不读这个值。 */
    var CLICK_LAND_MS = 300;
    var PREVIEW_LAND_MS = 300;
    /** 视觉提交后再让出至少两帧，确保文字 / 描边已经 paint，再进宿主桥。 */
    var SILENT_COMMIT_GUARD_MS = 34;
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
    /** 强调色由设置项决定，取色一律走 `paletteOf()` 从当前强调色混白派生，
     *  因此这里不保存任何写死的色阶常量。 */

    /* ── 宿主写入窗口 ────────────────────────────────────────────────── */
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
    /**
     * 轨道风格 —— 两套并存的视觉，不是同一套改参数：
     *   mosaic  像素马赛克粒子墙（本插件原有），**独有**粒子越界能力
     *   霓虹   霓虹：平涂蓝轨道 + 最高档蓝→紫擦除渐变 + 滑块脚下烟花 + 漂流白点
     * 越界相关设置只对 mosaic 有意义，霓虹下面板里直接不出现。
     */
    var RAIL_STYLES = ["mosaic", "codex"];
    var BURST_STYLES = ["ripple", "scan", "shatter", "pulse"];
    /** 越界的触发范围：关 / 仅最高档 / 全档位。 */
    var SCATTER_MODES = ["off", "top", "all"];
    /** 越界动画：飞沫 / 飘散 / 坠落 / 潮汐。
     *  四套的包络一样（右 1/5 不动、越左越散），差在"飞出去之后怎么动"。 */
    var SCATTER_STYLES = ["spray", "drift", "fall", "tide"];

    var DEFAULT_SETTINGS = {
      /** 轨道风格：mosaic 马赛克粒子墙（默认，含粒子越界）/ 霓虹 霓虹（无越界）。 */
      railStyle: "mosaic",
      /** 拖拽形变：开 = 端点外拉 / 中段纵向拖动时有弹性形变；关 = 轨道和滑块始终保持原尺寸。 */
      dragMotion: true,
      /** 液态玻璃材质：开 = 背景折射 / 上缘镜面 / 底缘厚度；关 = 扁平轨道。 */
      glassMaterial: true,
      /** 滑轨强调色：填充渐变最右端、粒子最深处、点亮光晕，三处同源。 */
      accent: "#4A84FF",
      /** 最高档字符颜色。"accent" = 跟着强调色走；"custom" = 用 tintColor。 */
      tintMode: "accent",
      tintColor: "#4A84FF",
      /** 滑块形状：circle 实心圆 / ring 空心环 / rounded 圆角方 / pill 胶囊 / blade 细棒。 */
      knobShape: "circle",
      /** 滑块直径（px）：30 / 34。30 = 轨道高，是设计稿原值；34 是"珠子比管子大"。
          下限即轨道高，旧配置里更小的尺寸会被夹回 30。 */
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

    /** 霓虹原版粒子用的伪随机：同一个 index 永远得到同一个值，重渲染不会跳。 */
    function codexRand(a, t) {
      var r = 43758.5453 * Math.sin((a + 1) * 12.9898 + 78.233 * t);
      return r - Math.floor(r);
    }

    /* 霓虹的粒子与火星都是**静态**参数（同一个 index 永远同一个值）。
       这两组节点在模块加载时建一次就够：以前每次渲染重建 32 个节点 + 32 个 style
       对象，拖动时每个 pointermove 都重建一遍，那就是卡顿的来源。 */
    var CODEX_DUST = (function () {
      var out = [];
      for (var i = 0; i < 14; i += 1) {
        out.push(React.createElement("i", {
          key: "d" + i,
          style: {
            "--y": (18 + 64 * codexRand(i, 23)).toFixed(1) + "%",
            "--o": (0.4 + 0.6 * codexRand(i, 11)).toFixed(2),
            "--s": (0.7 + 0.35 * codexRand(i, 12)).toFixed(2),
            "--dur": (1.6 * (0.8 + 1.2 * codexRand(i, 7))).toFixed(2) + "s",
            "--delay": (-1.6 * codexRand(i, 5)).toFixed(2) + "s",
          },
        }));
      }
      return out;
    })();

    var CODEX_SPARKS = (function () {
      var out = [];
      for (var i = 0; i < 18; i += 1) {
        out.push(React.createElement("i", {
          key: "f" + i,
          style: {
            "--a": (i / 18 * 360 - 90 + (codexRand(i, 31) - 0.5) * 12).toFixed(1) + "deg",
            "--r": (16 + 22 * codexRand(i, 17)).toFixed(0) + "px",
            "--fd": (0.75 + 0.35 * codexRand(i, 19)).toFixed(2) + "s",
            "--d": (codexRand(i, 23) * 0.06).toFixed(3) + "s",
            "--sz": (2.8 + codexRand(i, 29) * 2.4).toFixed(1) + "px",
          },
        }));
      }
      return out;
    })();

    /** 旧名保留：面板预览与真轨道共用同一份缓存。 */
    function codexDustNodes() {
      return CODEX_DUST;
    }

    /* 霓虹最高档的蓝→紫渐变色标：逐点采样自原版渲染。 */
    var NEON_STOPS = [
      [0, "#2546D0"], [7, "#414EDB"], [13, "#6C63EE"], [19, "#9A95FA"],
      [26, "#8C77FF"], [33, "#A384FF"], [41, "#AD83FF"], [49, "#B37DFF"],
      [57, "#A66DFC"], [64, "#9C64FF"], [70, "#8A57F2"], [76, "#7F50EC"],
      [84, "#7549E9"], [92, "#6D45E5"], [100, "#6842E2"],
    ];

    /**
     * 让最高档的彩色轨道跟着「滑轨强调色」走。
     * 默认色 #4A84FF 下用原始采样值；换色后给每个色标加上同一个 RGB 偏移，
     * 于是蓝色主题得到蓝紫、红色主题得到红紫……梯度关系保持不变。
     */
    function neonGradientOf(accentHex) {
      var base = hexToRgb(DEFAULT_SETTINGS.accent);
      var cur = hexToRgb(accentHex) || base;
      var dr = cur[0] - base[0], dg = cur[1] - base[1], db = cur[2] - base[2];
      var parts = [];
      for (var i = 0; i < NEON_STOPS.length; i += 1) {
        var rgb = hexToRgb(NEON_STOPS[i][1]);
        parts.push(rgbToHex([
          Math.round(clampNum(rgb[0] + dr, 0, 255, rgb[0])),
          Math.round(clampNum(rgb[1] + dg, 0, 255, rgb[1])),
          Math.round(clampNum(rgb[2] + db, 0, 255, rgb[2])),
        ]) + " " + NEON_STOPS[i][0] + "%");
      }
      return "linear-gradient(90deg," + parts.join(",") + ")";
    }

    /**
     * 霓虹点亮强度和速度真正生效的地方。
     * 之前这两项只喂给了马赛克粒子引擎（burstPower）和外层光晕，霓虹自己的
     * 四套 filter 动画写死时长/峰值，所以面板上拖了也没反应。
     * 强度 1.0 → 原设计值；速度 1.0 → 原时长，越大越快。
     */
    function neonBurstVarsOf(snap) {
      var i = clampNum(snap.burstIntensity, 0.4, 1.8, DEFAULT_SETTINGS.burstIntensity);
      var sp = clampNum(snap.burstSpeed, 0.6, 1.4, DEFAULT_SETTINGS.burstSpeed);
      return {
        ripple: (1 + 0.10 * i).toFixed(3),
        scan: (1 + 0.12 * i).toFixed(3),
        shatter: (1 + 0.14 * i).toFixed(3),
        pulse: (1 + 0.10 * i).toFixed(3),
        durRipple: (0.9 / sp).toFixed(3) + "s",
        durScan: (1 / sp).toFixed(3) + "s",
        durShatter: (0.8 / sp).toFixed(3) + "s",
        durPulse: (2.4 / sp).toFixed(3) + "s",
      };
    }

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
      out.railStyle = RAIL_STYLES.indexOf(src.railStyle) === -1 ? "mosaic" : src.railStyle;
      /* 旧存档没有这两个键：默认开启，升级后手感 / 材质不变；只有显式 false 才关闭。 */
      out.dragMotion = src.dragMotion === false ? false : true;
      out.glassMaterial = src.glassMaterial === false ? false : true;
      out.accent = hexToRgb(src.accent) ? rgbToHex(hexToRgb(src.accent)) : DEFAULT_SETTINGS.accent;
      out.tintMode = src.tintMode === "custom" ? "custom" : "accent";
      out.tintColor = hexToRgb(src.tintColor) ? rgbToHex(hexToRgb(src.tintColor)) : DEFAULT_SETTINGS.tintColor;
      out.knobShape = SHAPES.indexOf(src.knobShape) === -1 ? "circle" : src.knobShape;
      /* 只保留 30 / 34；旧配置里小于轨道高的尺寸统一夹回 30。 */
      out.knobSize = Math.round(clampNum(src.knobSize, 30, 34, DEFAULT_SETTINGS.knobSize));
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
      /* 「方」的圆角必须跟着尺寸长：固定 7px 时，30 还算圆润，34 就明显变方了。
         取直径的 0.34 —— 视觉上始终是"圆角方形"，不会越调越大越像正方形。 */
      if (snap.knobShape === "rounded") return Math.round(snap.knobSize * 0.34) + "px";
      return "999px";
    }

    /**
     * 填充 / 粒子墙的右端圆角。
     *
     * 必须取**滑块外缘的半径**，不能取内缘（外缘减描边）：
     * 填充在最高档会铺到滑块右缘，若填充的圆角比滑块小 1px，滑块的
     * 右上 / 右下圆角外侧就会露出两个 1px 的橙色直角——就是"色轨直角"。
     * 实心形状取外半径后填充只会更圆，不会顶出滑块；空心环仍取内半径，
     * 否则填充会盖住环的 3px 实心壁。
     */
    function fillTailRadiusOf(snap) {
      var knobW = knobWidthOf(snap);
      var outer = Math.min(knobW, snap.knobSize) / 2;
      if (snap.knobShape === "rounded") outer = Math.round(snap.knobSize * 0.34);
      if (snap.knobShape === "ring") outer -= knobBorderWidthOf(snap);
      return Math.max(0, outer);
    }

    /**
     * 轨道**可见带**的高度（填充层 / 粒子层 / 轨道凹槽都用它）。
     *
     * 取"轨道高"和"滑块高"的较小值：滑块比轨道大（34px）时保持 30px，
     * 那是"珠子比管子大"，管子不该跟着撑大；等于轨道高时三者齐平。
     * 目前只有 30 / 34 两档，这个值恒为 30 —— 保留通用写法是为了让
     * 填充与粒子层永远不越过凹槽轮廓。
     */
    function bandHeightOf(snap) {
      return Math.min(TRACK_HEIGHT, snap.knobSize);
    }

    /**
     * 四种质感的背景。都用一层竖向渐变 + 一层内高光把"球"撑起来 ——
     * 纯平涂的圆片在深色卡片上就是一颗塑料贴纸，没有体积感。
     */
    /**
     * 旋钮环壁颜色。
     *
     * 白瓷（white）必须是**中性**的：它只是白球边缘的一圈收口，不该跟着强调色走。
     * 以前取 `pal.stops[0]`，默认蓝强调色下是浅蓝、看不出问题；换成红/橙强调色，
     * 这圈就变成浅橙红，贴着白球边缘，看起来就像轨道颜色从滑块边缘渗出来。
     * 染色 / 强调色珠 / 磨砂的环壁仍按各自色阶走 —— 那是刻意的同色质感。
     */
    function knobRingOf(snap, pal) {
      if (snap.knobShape === "ring") {
        return snap.knobFill === "accent" ? pal.accent
          : snap.knobFill === "tinted" ? pal.stops[2]
            : snap.knobFill === "frosted" ? "#cbd2dd"
              : "#ffffff";
      }
      if (snap.knobFill === "accent") return pal.stops[3];
      if (snap.knobFill === "tinted") return pal.stops[2];
      if (snap.knobFill === "frosted") return "#c3cad6";
      return "#dde3ec";
    }

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
        /* 霓虹填充用 `calc(100% - inset)` 反推竖切位置。只有细棒退到左缘，
           圆 / 环 / 圆角方 / 胶囊都切圆心 —— 填充必须铺到滑块下方。
           实心形状再额外退 TAIL_CUT_GUARD，避免形变时旋钮角上露出填充边。 */
        var tailInset = settings.knobShape === "blade" ? knobW + TAIL_CUT_GUARD
          : settings.knobShape === "ring" ? knobW / 2
            : knobW / 2 + TAIL_CUT_GUARD;
        root.style.setProperty("--dem-knob-tail-inset", tailInset + "px");
        root.style.setProperty("--dem-knob-radius", knobRadiusOf(settings));
        /* 凹槽、填充、粒子层统一用同一条可见带高度（min(轨道高, 滑块高)）。
           当前只有 30 / 34 两档，带高恒为 30px，三者与凹槽轮廓严格重合。 */
        var bandH = bandHeightOf(settings);
        root.style.setProperty("--dem-fill-h", bandH + "px");
        root.style.setProperty("--dem-band-inset", ((TRACK_HEIGHT - bandH) / 2) + "px");
        /* 填充右端圆角 = 滑块外缘半径：最高档填充铺到滑块右缘时，
           圆角比滑块小 1px 就会从右上 / 右下露出直角。环取内半径，
           否则填充会盖住 3px 实心壁。 */
        var tailRadius = fillTailRadiusOf(settings);
        root.style.setProperty("--dem-fill-tail-radius", Math.max(0, tailRadius) + "px");
        root.style.setProperty("--dem-neon-gradient", neonGradientOf(settings.accent));
        var nb = neonBurstVarsOf(settings);
        root.style.setProperty("--dem-neon-peak-ripple", nb.ripple);
        root.style.setProperty("--dem-neon-peak-scan", nb.scan);
        root.style.setProperty("--dem-neon-peak-shatter", nb.shatter);
        root.style.setProperty("--dem-neon-peak-pulse", nb.pulse);
        root.style.setProperty("--dem-neon-dur-ripple", nb.durRipple);
        root.style.setProperty("--dem-neon-dur-scan", nb.durScan);
        root.style.setProperty("--dem-neon-dur-shatter", nb.durShatter);
        root.style.setProperty("--dem-neon-dur-pulse", nb.durPulse);
        root.style.setProperty("--dem-knob-fill", knobSurfaceOf(settings, pal));
        root.style.setProperty("--dem-knob-sheen", knobSheenOf(settings));
        /* 环壁颜色跟着质感走：白瓷=中性环、染色=浅蓝环、强调色=蓝环、磨砂=灰环。
           环心是透的，所以"看起来是环"全靠这圈壁。 */
        var edgeWidth = knobBorderWidthOf(settings) + "px solid ";
        var ringWidth = knobBorderWidthOf(settings) + "px";
        var ringColor = knobRingOf(settings, pal);
        root.style.setProperty("--dem-knob-border", edgeWidth + ringColor);
        /* 真正画环壁的是这两个：宽度 + 颜色，交给 inset 阴影 */
        root.style.setProperty("--dem-knob-ring-w", ringWidth);
        root.style.setProperty("--dem-knob-ring", ringColor);
        /* 外圈护栏用同一个中性色：白瓷就是 #dde3ec，染色 / 强调色珠跟自己的环色。 */
        root.style.setProperty("--dem-knob-guard", ringColor);
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
     * 收口遮罩：把「填充层 / 粒子层」的右端裁到滑块边缘，而不是一个固定半圆。
     *
     * 实心滑块（圆 / 圆角方 / 胶囊 / 细棒）只需要一条竖切：切在**滑块圆心**。
     * 圆心左侧的填充会铺到滑块下面，但被不透明的滑块本体盖住；圆心右侧一律不画。
     * 这样圆角方钮的左下 / 左上圆角不会再把填充露出来 —— 那圈红边就是这么来的。
     *
     * 空心环（ring）例外：环心是透的，填充必须从环孔里透出来，所以在竖切之外
     * 再加一个圆盘，只保留环内壁半径以内的填充。
     */
    var SOLID_TAIL_MASK =
      "linear-gradient(90deg,#000 0 calc(var(--dem-fill-tail-x,100%) - .5px),"
      + "rgba(0,0,0,0) calc(var(--dem-fill-tail-x,100%) + .5px))";
    var RING_TAIL_MASK = SOLID_TAIL_MASK + ","
      + "radial-gradient(circle at var(--dem-fill-tail-x,100%) 50%,"
      + "#000 calc(var(--dem-fill-tail-radius,15px) - 1px),rgba(0,0,0,0) var(--dem-fill-tail-radius,15px))";

    /**
     * 左端收口：和 TAIL_MASK 同一套写法 —— 一条竖切（端帽圆心右侧全留）+ 一个圆盘（端帽内），
     * 两层并集 = 轨道左半圆 + 竖切以右的整条带子。
     *
     * 为什么必须有：越界模式要放开纵向裁切（方块要能飞出轨道上下边），
     * 于是 `.dem-mosaic-clip` 不能再靠 `border-radius + overflow:hidden` 裁端帽。
     * 少了这层，贴着左端的方块就从半圆帽的直角区域探出去 —— 滑块在最左端时
     * 轨道左侧/上下边缘会出现几颗"长在外面"的粒子。
     *
     * 它挂在 `.dem-mosaic`（内层）而不是裁切层：两层遮罩相乘，
     * 于是左端按圆盘裁、右端按 TAIL_MASK 的滑块内缘裁，中间仍然上下自由。
     * 半径取带高的一半，与填充圆角、轨道端帽是同一条曲线。
     */
    var HEAD_CUT = "calc(var(--dem-fill-h," + TRACK_HEIGHT + "px) / 2)";
    var HEAD_MASK =
      "linear-gradient(90deg,rgba(0,0,0,0) 0 calc(" + HEAD_CUT + " - .5px),"
      + "#000 calc(" + HEAD_CUT + " + .5px)),"
      + "radial-gradient(circle at " + HEAD_CUT + " 50%,"
      + "#000 calc(" + HEAD_CUT + " - 1px),rgba(0,0,0,0) " + HEAD_CUT + ")";

    var CSS = [
      /* 注入进官方那一行的容器：折行到第二行并铺满整行。
         背景**必须透明** —— 这一块的底色归 DSH 官方菜单卡片
         （`--dsw-alias-card-fill`：浅色近白 / 深色 neutral-850）。
         插件若在这里自己画白底，深色主题下就会露出一条白块。 */
      ".dem-inline{box-sizing:border-box;flex-basis:100%;width:100%;min-width:0;background:transparent;"
        + "clip-path:inset(-12px 0 -12px 0)}",
      ".dem-track{--dem-slot-bg:var(--dsw-alias-border-l1,color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 8%,transparent));"
        + "position:relative;box-sizing:border-box;height:" + TRACK_HEIGHT + "px;margin:2px " + TRACK_INSET + "px 0;"
        + "border-radius:999px;"
        /* 轨道本体的底色 / 玻璃全部放到 `::before`，这样端点形变时**整条轨道**
           （包括空槽）一起被拉长/压扁；元素本身只留透明底和指针命中区。
           原来底色留在元素上，形变只发生在伪元素，上下拉时就会看到一条不动的深色底。 */
        + "background:transparent;"
        + "padding:var(--dem-band-inset,0px) 0;background-clip:content-box;"
        + "cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;overflow:visible;"
        + "transition:box-shadow .5s ease}",
      /* 玻璃壳：负责整条轨道材质和拖动形变，不参与布局。
         形变锚点由 `--dem-rail-origin-x` 指定（和色带右缘是同一个点），
         所以拖动时玻璃与色带从同一个右缘向左一起伸展/回弹，滑块圆心和轨道右缘都不漂。 */
      ".dem-track::before{content:'';position:absolute;inset:var(--dem-band-inset,0px) 0;border-radius:inherit;"
        + "pointer-events:none;z-index:0;"
        /* 苹果式液态玻璃：透镜感来自“折射/厚度”，不是一圈均匀白边。
           底色只借环境色和一点冷调；高光集中在上缘和左端受光处，底缘用暗面收厚度。 */
        + "background:"
        + "radial-gradient(120% 200% at 100% 50%,rgba(var(--dem-accent-rgb,74,132,255),.10) 0%,"
        + "rgba(var(--dem-accent-rgb,74,132,255),0) 56%),"
        + "linear-gradient(180deg,rgba(255,255,255,.035) 0%,rgba(255,255,255,.008) 24%,"
        + "rgba(8,14,26,.02) 70%,rgba(255,255,255,.018) 100%),"
        + "color-mix(in srgb,var(--dem-slot-bg) 52%,transparent);"
        /* 上缘只留一根发丝级受光线；底缘不要硬线，只用一小段很软的内收，
           再加外部落影。1px 暗边会在深色轨道上直接显成一条黑线。 */
        + "box-shadow:inset 0 1px 0 rgba(255,255,255,.12),"
        + "inset 0 -5px 9px -7px rgba(8,14,26,.10),"
        + "0 6px 16px rgba(8,14,26,.14),0 1px 3px rgba(8,14,26,.08);"
        + "backdrop-filter:blur(22px) saturate(1.65) brightness(1.02);"
        + "-webkit-backdrop-filter:blur(22px) saturate(1.65) brightness(1.02);"
        + "transform-origin:var(--dem-rail-origin-x,var(--dem-rail-base-origin,50%)) 50%;"
        + "transform:translateZ(0) scaleX(var(--dem-rail-sx,1)) scaleY(var(--dem-rail-sy,1))"
        + " skewX(var(--dem-rail-skew,0deg)) skewY(var(--dem-rail-skew-y,0deg));"
        + "will-change:transform;"
        + "transition:box-shadow .42s ease}",
      ".dem-track[data-dragging='1']::before{transition:box-shadow .2s ease}",
      /* 液态玻璃罩：压在色带和粒子上方、旋钮下方。
         只给左上受光处一枚很小的镜面弧；底边不再描 1px 暗线，
         否则玻璃下沿会变成一条硬黑边。 */
      ".dem-track::after{content:'';position:absolute;inset:var(--dem-band-inset,0px) 0;border-radius:inherit;"
        + "pointer-events:none;z-index:2;"
        + "background:"
        + "radial-gradient(26% 165% at 10% -52%,rgba(255,255,255,.14) 0%,"
        + "rgba(255,255,255,.035) 42%,rgba(255,255,255,0) 72%),"
        + "linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 1px,"
        + "rgba(255,255,255,0) 3px);"
        + "box-shadow:inset 0 0.5px 0 rgba(255,255,255,.16);"
        + "opacity:1;"
        + "transform:translateZ(0) scaleX(var(--dem-rail-sx,1)) scaleY(var(--dem-rail-sy,1))"
        + " skewX(var(--dem-rail-skew,0deg)) skewY(var(--dem-rail-skew-y,0deg));"
        + "transform-origin:var(--dem-rail-origin-x,var(--dem-rail-base-origin,50%)) 50%;"
        + "will-change:transform}",
      /* 玻璃材质关闭：去掉折射、镜面、厚度与染色，只留一块扁平轨道。
         只清掉静态材质；最高档的 accent 描边挂在本伪元素上，后面
         `data-burst='1'` 规则会重新写 box-shadow，不会被一起关掉。 */
      ".dem-track[data-glass='0']::before{background:"
        + "color-mix(in srgb,var(--dem-slot-bg) 58%,var(--dsw-alias-card-fill,#141922));"
        + "box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1,rgba(255,255,255,.10)),"
        + "0 1px 2px rgba(8,14,26,.10);"
        + "backdrop-filter:none;-webkit-backdrop-filter:none}",
      ".dem-track[data-glass='0']::after{background:none;box-shadow:none}",
      ".dem-track[data-glass='0'] .dem-fill::after{display:none}",
      ".dem-track:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4a84ff);outline-offset:2px}",
      /* 色带/粒子统一形变的外壳：只裁横向，纵向放行。
         色带围绕右缘缩放时左端会向外扩；左侧按轨道宽留 10%（最大形变 7%），
         不管菜单多宽都不会先被裁掉。右侧贴住滑块，不额外裁掉收口。 */
      ".dem-fill-clip{position:absolute;left:0;top:var(--dem-band-inset,0px);width:100%;height:var(--dem-fill-h," + TRACK_HEIGHT + "px);"
        + "pointer-events:none;z-index:1;clip-path:inset(-18px 0 -18px -10%)}",
      /* 填充层：粒子墙的彩色底，右端随旋钮一起长。
         设计稿是「渐变 + 两层细密像素格纹」——格纹不能省，少了那两层底纹整条
         轨道会变成一块光滑渐变，跟设计稿的像素质地完全不是一回事。
         五个色标全部由强调色混白派生（`syncThemeVars` 写入），括号里是设计稿原值兜底。 */
      /* 右端不再是"固定半圆"：交给 TAIL_MASK 按滑块内缘裁（见上面的说明）。
         这里仍保留右端圆角，只是半径跟着滑块走 —— 遮罩没生效时（变量缺失）也能少露一截。 */
      ".dem-fill{position:absolute;left:0;top:50%;height:var(--dem-fill-h,30px);"
        /* 填充的收口按**自身宽度**反推，不依赖 track 上由 rAF 写入的像素值：
           首帧 / 重渲染 / 粒子墙还没跑起来时也不会退化成 100% 露出右缘色线。
           inset 已含实心滑块的 TAIL_CUT_GUARD，切在滑块圆心左侧 8px；
           环的 inset 是半径，仍从环心透色。track 上的同名变量只给粒子裁切层用。 */
        + "--dem-fill-tail-x:calc(100% - var(--dem-knob-tail-inset,15px));"
        + "transform:translateY(-50%) translateZ(0) scaleX(var(--dem-rail-sx,1)) scaleY(var(--dem-rail-sy,1))"
        + " skewX(var(--dem-rail-skew,0deg)) skewY(var(--dem-rail-skew-y,0deg));"
        + "transform-origin:var(--dem-rail-origin-x,var(--dem-rail-base-origin,100%)) 50%;"
        + "border-radius:calc(var(--dem-fill-h,30px) / 2) var(--dem-fill-tail-radius,15px)"
        + " var(--dem-fill-tail-radius,15px) calc(var(--dem-fill-h,30px) / 2);"
        + "overflow:hidden;pointer-events:none;"
        /* 宽度也带一条过渡：外部写回档位（换模型代、设置面板改形状）时填充和滑块一起走。
           拖动 / 吸附期间这条会被下面两条规则关掉，那两段是逐帧写死的。 */
        + "transition:width .3s cubic-bezier(.22,1,.36,1);"
        + "-webkit-mask-image:" + SOLID_TAIL_MASK + ";"
        + "mask-image:" + SOLID_TAIL_MASK + ";"
        + "background:"
        + "repeating-linear-gradient(90deg,rgba(255,255,255,.20) 0 .6px,transparent .6px 5px),"
        + "repeating-linear-gradient(180deg,rgba(20,50,110,.13) 0 .6px,transparent .6px 5px),"
        + "linear-gradient(90deg,var(--dem-c1,#e2ecfe) 0%,var(--dem-c2,#c4d8fd) 26%,var(--dem-c3,#a0bcfb) 58%,var(--dem-c4,#7097f9) 86%,var(--dem-accent,#4a84ff) 100%)}",
      /* 色带只保留 1px 级别的玻璃边缘：上沿冷光、下沿反光、内圈薄阴影。
         不再叠大面积白色径向高光，避免把液态玻璃做成“磨砂白塑料”。 */
      ".dem-fill::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;"
        + "background:linear-gradient(180deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.01) 2px,"
        + "rgba(255,255,255,0) 5px,rgba(255,255,255,0) 100%),"
        + "linear-gradient(105deg,rgba(190,225,255,0) 34%,rgba(190,225,255,.08) 46%,rgba(190,225,255,0) 57%);"
        + "box-shadow:inset 0 0.5px 0 rgba(255,255,255,.24),"
        + "inset 0 -6px 10px -8px rgba(8,20,48,.35);"
        + "opacity:.72}",
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
      ".dem-mosaic{position:absolute;left:0;top:0;height:var(--dem-fill-h," + TRACK_HEIGHT + "px);width:0;"
        + "overflow:visible;pointer-events:none;"
        + "transform:translateZ(0) scaleX(var(--dem-rail-sx,1)) scaleY(var(--dem-rail-sy,1))"
        + " skewX(var(--dem-rail-skew,0deg)) skewY(var(--dem-rail-skew-y,0deg));"
        + "transform-origin:var(--dem-rail-origin-x,var(--dem-rail-base-origin,100%)) 50%;"
        /* 左端帽按圆盘裁（见 HEAD_MASK），右端由外层裁切层的 TAIL_MASK 兜住。
           高度取 `--dem-fill-h`（= 可见带高）而不是写死 30：旋钮比轨道小时带子会变矮，
           粒子层若还是 30px 就会比凹槽顶边高出一截，外轮廓出现阶梯缺口。 */
        + "-webkit-mask-clip:no-clip;mask-clip:no-clip;"
        + "-webkit-mask-image:" + HEAD_MASK + ";mask-image:" + HEAD_MASK + ";"
        /* 右边界再由粒子层**自己**裁一刀：它的宽度就是填充宽度（= 滑块右缘），
           clip-path 相对自身，不依赖 track 上由 rAF 写入的 `--dem-fill-tail-x`。
           预览首帧、粒子墙尚未 syncTail 时也不会漏出方块；上下仍放行越界，只收右。 */
        + "clip-path:inset(calc(-1 * var(--dem-scatter-clip,0px))"
        + " var(--dem-knob-tail-inset,15px)"
        + " calc(-1 * var(--dem-scatter-clip,0px)) 0)}",
      /* 裁切层（外形 + 右端）：
         粒子层自己是个矩形，`inset()` 只有轴对齐四条边，不会跟着轨道收圆。
         这一层恒等于**可见带**，负责两件事：
           1. 挂 TAIL_MASK —— 方块与填充共用同一条收口曲线，右边界止于滑块内缘；
           2. 越界关闭时 `clip-path` 由 JS 每帧收成 `inset(0)`。
         **这里必须是 `overflow:visible`**：最高档的"越界"就是方块要飞出轨道上下边，
         设成 hidden 会把整套飞出动画裁掉（试过一版，fly 全没了）。
         上边界"齐不齐"由粒子层的盒子决定 —— 它的 `top/height` 已经和可见带对齐，
         越界关掉时方块根本不动，轮廓自然是一条直线；越界打开时锯齿是设计本身。 */
      ".dem-mosaic-clip{position:absolute;left:0;top:var(--dem-band-inset,0px);width:100%;height:var(--dem-fill-h," + TRACK_HEIGHT + "px);"
        + "pointer-events:none;overflow:visible;z-index:1;"
        /* 横向只允许形变向左侧扩展 10% 轨道宽；右侧保持收口，
           纵向额外放 8px 给拖动 scaleY 的伸展，越界动画本身仍由 `.dem-mosaic`
           自己的 clip-path 决定。 */
        + "clip-path:inset(calc(-1 * var(--dem-scatter-clip,0px) - 8px) 0 calc(-1 * var(--dem-scatter-clip,0px) - 8px) -10%);"
        /* `mask-clip:no-clip` 是关键：默认 border-box 会把越界（飞出轨道）的方块裁掉。
           设成 no-clip 之后，遮罩仍然按滑块弧线收口，但不再限制绘制范围。 */
        + "-webkit-mask-clip:no-clip;mask-clip:no-clip;"
        + "-webkit-mask-image:" + SOLID_TAIL_MASK + ";"
        + "mask-image:" + SOLID_TAIL_MASK + "}",
      /* 空心环额外加圆盘收口；实心形状只用竖切。
         这里必须直接挂在元素上：若在 documentElement 上预先展开
         `--dem-tail-mask`，其中的 var(--dem-fill-tail-x) 会在根节点
         按默认 100% 冻结，填充/粒子层就永远裁不到右端。 */
      ".dem-track[data-knob-shape='ring'] .dem-fill,"
        + ".dem-track[data-knob-shape='ring'] .dem-mosaic-clip{"
        + "-webkit-mask-image:" + RING_TAIL_MASK + ";mask-image:" + RING_TAIL_MASK + "}",
      /* 单格：颜色由 JS 直接写（设计稿色阶），不参与任何主题混合。
         transform-origin 钉在左上角 —— 开启"越界扩散"后方块会被放大，
         如果按中心缩放，位置基准会跟着漂，整片粒子会缓慢错位。 */
      ".dem-cell{position:absolute;left:0;top:0;transform-origin:0 0;border-radius:0;will-change:transform,opacity}",
      /* 刻度 */
      /* 刻度：严格用设计稿原值 —— 圆点 #64789C、竖条 #92A4C2（蓝灰），不跟主题。
         之前为了深色卡上更显眼提到填充哈希里的蓝，属于擅自偏离，已改回。 */
      ".dem-mark{position:absolute;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;"
        + "background:#64789C;z-index:3;"
        + "pointer-events:none}",
      ".dem-mark--bar{width:3px;height:12px;margin:-6px 0 0 -1.5px;border-radius:1px;"
        + "background:#92A4C2}",
      /* 旋钮：默认直径 = 轨道高度，纯白（设计稿里就是白圆钮），不跟主题走。
         设计稿还给了 1px #DFEAFD 描边 + 一层柔和投影，少了它圆钮会显得发飘。
         投影用中性深色而不是原来的蓝灰：霓虹轨道是整条蓝底，蓝灰影会沿着
         圆边染出一圈"轨道色渗出"的假象。尺寸 / 形状 / 填充 / 描边都提到 CSS 变量。 */
      ".dem-knob{position:absolute;top:50%;left:var(--dem-knob-x,0px);width:var(--dem-knob-w,30px);height:var(--dem-knob-size,30px);"
        + "margin:calc(var(--dem-knob-size,30px) * -0.5) 0 0 calc(var(--dem-knob-r,15px) * -1);box-sizing:border-box;z-index:4;"
        /* 位置也用 left，不用 translate：填充宽度走的是 width，两者必须同一条布局/绘制路径，
           否则旋钮在合成层先动、填充还在主线程重排，视觉上就是"色轨追不上滑块"。 */
        /* 环壁交给 inset 阴影：border 是边框绘制器单独栅格化的，压在渐变填充上会留一道
           1px 浅缝（圆边抗锯齿不连续）；inset 阴影与背景同层，圆边才干净。 */
        + "border:0;border-radius:var(--dem-knob-radius,999px);"
        + "background:var(--dem-knob-fill,#ffffff);"
        + "box-shadow:inset 0 0 0 var(--dem-knob-ring-w,1px) var(--dem-knob-ring,#dfeafd),"
        + "var(--dem-knob-sheen,inset 0 1px 1px rgba(255,255,255,.95)),"
        /* 外圈只留 1px 中性护栏，吸收白钮抗锯齿与填充的混色。
           不再叠第二圈 2px 浅灰：那圈在深色预览卡上会显成一圈浅色环，
           看起来像滑块外面套了光圈。 */
        + "0 0 0 1px var(--dem-knob-guard,#dde3ec),"
        + "0 2px 8px rgba(8,14,26,.18),0 1px 2px rgba(8,14,26,.10);"
        /* 拖动形变只改 transform，不动 left / margin。
           transform-origin 固定在圆心，所以无论横向拉长还是纵向压扁，滑块中心锚点都不变。 */
        + "transform-origin:50% 50%;"
        + "transform:translateZ(0) scaleX(var(--dem-knob-sx,1)) scaleY(var(--dem-knob-sy,1))"
        + " skewX(var(--dem-knob-skew,0deg)) skewY(var(--dem-knob-skew-y,0deg));"
        + "will-change:transform;"
        + "pointer-events:none;"
        /* 非拖动/非吸附时（比如模型代切换、外部写回档位）才走这条 CSS 过渡。
           吸附本身由 rAF 逐帧驱动，见 `beginSettle`；那段会临时把这条关掉。 */
        + "transition:left .3s cubic-bezier(.22,1,.36,1),box-shadow .3s ease}",
      /* 拖动时旋钮与填充都关掉缓动，否则手感会黏。 */
      /* 首次量宽的那一帧：width 还是 0，旋钮/填充先落在最左端；紧随其后的测量修正
         不能被当成换档过渡播出来。等这一帧画完（data-measured 翻 1）才恢复缓动。 */
      ".dem-track[data-measured='0'] .dem-knob,.dem-track[data-measured='0'] .dem-fill{transition:none}",
      /* 目录快照还没给出真实档位时，整条轨道先不显示。否则会先画在 0 档，
         等快照回来再滑到正确档位 —— 就是"每次打开浮层从最左端起步"的另一半根因。 */
      ".dem-track[data-ready='0']{opacity:0;pointer-events:none}",
      ".dem-track[data-dragging='1'] .dem-knob,.dem-track[data-dragging='1'] .dem-fill{transition:none}",
      /* 吸附阶段位置由 `beginSettle` 的 rAF 逐帧写，再叠一层 CSS transition 就是双重缓动，
         滑块和填充的插值曲线不同会互相追不上 —— 这一段两边都直接跟数值走。 */
      ".dem-track[data-snapping='1'] .dem-knob,.dem-track[data-snapping='1'] .dem-fill{transition:none}",
      /* 最高档的光晕走伪元素：box-shadow 要留给轨道本体做外发光，两者共用会互相覆盖。
         进入保持快（点亮要跟手），退出单独走一条更长的 ease-in-out：
         光晕先厚一点、再慢慢散掉，不能和进入共用 .18s 直接归零。 */
      ".dem-knob::after{content:'';position:absolute;inset:-4px;border-radius:inherit;"
        + "box-shadow:0 0 22px 7px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-burst-alpha,.5));opacity:0;pointer-events:none;"
        + "transition:opacity 1.05s cubic-bezier(.37,0,.22,1)}",
      ".dem-track[data-burst='1'] .dem-knob::after{opacity:1;transition:opacity .16s ease-out}",
      /* 吸附落位的那一下缩放脉冲不再走 CSS 动画：它要发生在**吸附结束**的时刻，
         而 CSS 只能从类名变化时开始播，改档速度稍快就会和上一轮撞在一起。
         现在由 `popKnob()` 在曲线收敛后用 WAAPI 播（scale 1 → 1.014 → 1，260ms），
         每次落位都是独立的一下，不会叠。 */
      /* 能量光：从旋钮向左铺开（Ultracode burst）。固定用强调色系，两种主题下都"亮"。 */
      /* 轨道为了粒子越界必须 overflow:visible；扫描线的亮带却不能越界，
         单独套一层圆角裁切壳，只裁光带，不碰粒子。 */
      ".dem-flush-clip{position:absolute;inset:var(--dem-band-inset,0px) 0;"
        + "border-radius:999px;overflow:hidden;pointer-events:none;z-index:1}",
      ".dem-flush{position:absolute;inset:0;border-radius:999px;pointer-events:none;opacity:0;"
        + "background:radial-gradient(115% 170% at 100% 50%,rgba(255,255,255,.94) 0%,"
        + "rgba(var(--dem-accent-rgb,74,132,255),.34) 26%,rgba(var(--dem-accent-rgb,74,132,255),0) 64%)}",
      /* 点亮：描边和光晕必须挂在**会跟随形变的玻璃罩**上。
         以前写在外层 .dem-track 上，轨道 scale 时描边还停在原矩形，
         端点纵向拉伸就会看到“光框没跟着轨道”。 */
      ".dem-track[data-burst='1']::after{box-shadow:"
        + "0 0 0 1px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-glow-alpha,.45)),"
        + "0 0 20px 2px rgba(var(--dem-accent-rgb,74,132,255),var(--dem-glow-alpha,.45))}",
      /* ── 样式一：ripple 能量波（设计稿原版）—— 光从旋钮向左铺开 + 填充亮度脉冲 ── */
      ".dem-track[data-burst='1'][data-burst-style='ripple'] .dem-flush{transform-origin:100% 50%;"
        + "animation:demFlush .8s cubic-bezier(.22,1,.36,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='ripple'] .dem-fill{animation:demGlow .75s ease-out}",
      "@keyframes demFlush{0%{opacity:0;transform:scaleX(.035)}16%{opacity:.6}64%{opacity:.3}100%{opacity:0;transform:scaleX(1)}}",
      "@keyframes demGlow{0%{filter:brightness(1) saturate(1)}26%{filter:brightness(1.25) saturate(1.12)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式二：scan 扫描线 —— 一条亮带掠过整条轨道，露出的粒子被瞬时提亮 ── */
      ".dem-track[data-burst='1'][data-burst-style='scan'] .dem-flush{clip-path:inset(0 round 999px);"
        + "background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.95) 7%,"
        + "rgba(255,255,255,.45) 20%,transparent 42%);"
        + "transform-origin:100% 50%;animation:demScan .95s cubic-bezier(.2,.75,.25,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='scan'] .dem-fill{animation:demScanGlow .95s ease-out}",
      "@keyframes demScan{0%{opacity:0;transform:translateX(64%) scaleX(.42)}10%{opacity:1}"
        + "70%{opacity:.55}100%{opacity:0;transform:translateX(-82%) scaleX(.42)}}",
      "@keyframes demScanGlow{0%{filter:brightness(1)}34%{filter:brightness(1.18) saturate(1.08)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式三：shatter 爆散 —— 过曝一下再回弹，没有光的铺开，靠粒子自己甩出去 ── */
      ".dem-track[data-burst='1'][data-burst-style='shatter'] .dem-fill{animation:demShatter .6s ease-out}",
      "@keyframes demShatter{0%{filter:brightness(1) saturate(1)}14%{filter:brightness(1.45) saturate(1.25)}"
        + "46%{filter:brightness(.96) saturate(.95)}100%{filter:brightness(1) saturate(1)}}",
      /* ── 样式四：pulse 呼吸 —— 光从滑块（右端）向左漫开，两次起伏，慢，不能喘 ── */
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-flush{"
        + "background:radial-gradient(125% 100% at 100% 50%,rgba(255,255,255,.88) 0%,"
        + "rgba(255,255,255,.38) 40%,transparent 80%);"
        + "transform-origin:100% 50%;animation:demPulseSweep 2.4s cubic-bezier(.4,0,.3,1) forwards}",
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-fill{animation:demPulse 2.4s ease-in-out}",
      ".dem-track[data-burst='1'][data-burst-style='pulse'] .dem-knob::after{animation:demPulseHalo 2.4s ease-in-out}",
      "@keyframes demPulseSweep{0%{opacity:0;transform:scaleX(.05)}22%{opacity:.6;transform:scaleX(.56)}"
        + "46%{opacity:.28;transform:scaleX(.84)}68%{opacity:.55;transform:scaleX(1)}"
        + "100%{opacity:0;transform:scaleX(1)}}",
      "@keyframes demPulse{0%{filter:brightness(1)}20%{filter:brightness(1.18)}38%{filter:brightness(1.01)}"
        + "60%{filter:brightness(1.12)}100%{filter:brightness(1)}}",
      "@keyframes demPulseHalo{0%{opacity:.15;transform:scale(.97)}22%{opacity:.6;transform:scale(1.03)}"
        + "38%{opacity:.22;transform:scale(.99)}68%{opacity:.5;transform:scale(1.02)}100%{opacity:.15;transform:scale(1)}}",
      /* ── 轨道风格 霓虹：霓虹桌面版 ─────────────────────────────
         平涂强调色轨道；最高档换成蓝→紫的整条填充，
         再用一块「同色蓝盖板」向左移，把紫色由右向左擦出来（软边，没有硬接缝），
         同时在滑块脚下炸一圈火星，另有 14 颗白点由右向左漂过。
         **这一套没有粒子越界** —— 越界是 mosaic 风格独有的能力。 */
      /* 霓虹填充也必须套收口遮罩：之前为了平涂蓝底把 mask 关掉，填充一直铺到
         滑块外缘，白色圆钮的抗锯齿边会和蓝底混出一条彩边；最高档还会多出 1px
         轨道外溢。这里用填充自身宽度反推圆心，CSS 过渡期间也能跟着滑块走。 */
      ".dem-track[data-rail='codex'] .dem-fill{"
        + "--dem-fill-tail-x:calc(100% - var(--dem-knob-tail-inset,var(--dem-knob-r,15px)));"
        + "border-radius:999px;background:var(--dem-accent,#4a84ff)}",
      ".dem-track[data-rail='codex'] .dem-fill-fade{display:none}",
      ".dem-track[data-rail='codex'] .dem-mosaic-clip{display:none}",
      /* 霓虹的点亮：四套同名样式，但都轻一档 —— 紫渐变的亮度天花板比浅蓝低得多，
         mosaic 那组 1.55 倍的峰值放上来会直接烧成白块。这里最高 1.2，且不加饱和。 */
      "@keyframes demCodexRipple{0%{filter:brightness(1)}"
        + "30%{filter:brightness(var(--dem-neon-peak-ripple,1.1))}100%{filter:brightness(1)}}",
      "@keyframes demCodexScan{0%{filter:brightness(1)}"
        + "45%{filter:brightness(var(--dem-neon-peak-scan,1.12))}100%{filter:brightness(1)}}",
      "@keyframes demCodexShatter{0%{filter:brightness(1)}"
        + "14%{filter:brightness(var(--dem-neon-peak-shatter,1.14))}"
        + "48%{filter:brightness(.98)}100%{filter:brightness(1)}}",
      "@keyframes demCodexPulse{0%{filter:brightness(1)}20%{filter:brightness(var(--dem-neon-peak-pulse,1.1))}38%{filter:brightness(1.01)}"
        + "60%{filter:brightness(calc(1 + (var(--dem-neon-peak-pulse,1.1) - 1) * .8))}"
        + "100%{filter:brightness(1)}}",
      ".dem-track[data-rail='codex'][data-burst='1'][data-burst-style='ripple'] .dem-fill{"
        + "animation:demCodexRipple var(--dem-neon-dur-ripple,.9s) cubic-bezier(.33,.06,.36,1)}",
      ".dem-track[data-rail='codex'][data-burst='1'][data-burst-style='scan'] .dem-fill{"
        + "animation:demCodexScan var(--dem-neon-dur-scan,1s) cubic-bezier(.33,.06,.36,1)}",
      ".dem-track[data-rail='codex'][data-burst='1'][data-burst-style='shatter'] .dem-fill{"
        + "animation:demCodexShatter var(--dem-neon-dur-shatter,.8s) ease-out}",
      ".dem-track[data-rail='codex'][data-burst='1'][data-burst-style='pulse'] .dem-fill{"
        + "animation:demCodexPulse var(--dem-neon-dur-pulse,2.4s) ease-in-out}",
      ".dem-track[data-rail='codex'] .dem-codex{position:absolute;inset:0;border-radius:inherit;overflow:hidden;"
        + "pointer-events:none;opacity:0;transition:opacity .46s cubic-bezier(.4,0,.2,1) .16s}",
      ".dem-track[data-rail='codex'][data-max='1'] .dem-codex{opacity:1;"
        + "transition:opacity .34s cubic-bezier(.3,.1,.3,1) .06s}",
      ".dem-track[data-rail='codex'] .dem-codex-grad{position:absolute;inset:0;"
        + "background:var(--dem-neon-gradient,"
        + "linear-gradient(90deg,#2546D0 0%,#414EDB 7%,#6C63EE 13%,#9A95FA 19%,"
        + "#8C77FF 26%,#A384FF 33%,#AD83FF 41%,#B37DFF 49%,#A66DFC 57%,#9C64FF 64%,"
        + "#8A57F2 70%,#7F50EC 76%,#7549E9 84%,#6D45E5 92%,#6842E2 100%))}",
      ".dem-track[data-rail='codex'] .dem-codex-glow{position:absolute;inset:-30% -8%;pointer-events:none;opacity:.7;"
        + "background:radial-gradient(34% 110% at 26% 50%,"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 18%,transparent),transparent 70%),"
        + "radial-gradient(28% 100% at 58% 50%,"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 20%,white),transparent 72%),"
        + "radial-gradient(32% 110% at 86% 50%,"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 22%,transparent),transparent 72%);"
        + "}",
      ".dem-track[data-rail='codex'] .dem-codex-wipe{position:absolute;top:0;bottom:0;left:0;right:-96px;"
        + "pointer-events:none;transform:translateX(-100%);"
        + "background:linear-gradient(90deg,"
        + "var(--dem-accent,#4a84ff) 0 calc(100% - 96px),"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 84%,transparent) calc(100% - 70px),"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 56%,transparent) calc(100% - 46px),"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 26%,transparent) calc(100% - 22px),"
        + "rgba(0,0,0,0) 100%)}",
      /* 进：蓝色盖板向左退场，紫色由右向左漫出来（.86s，前段更慢） */
      ".dem-track[data-rail='codex'] .dem-codex-wipe[data-run='1']{animation:demCodexWipeIn .98s cubic-bezier(.36,.04,.3,1) .05s both}",
      /* 出：同一块盖板原路擦回来，蓝色从左盖回去 —— 比"整层淡出"柔和得多 */
      ".dem-track[data-rail='codex'] .dem-codex-wipe[data-run='0']{animation:demCodexWipeOut .7s cubic-bezier(.4,0,.28,1) both}",
      ".dem-track[data-rail='codex'] .dem-codex-wipe[data-run='static']{animation:none;transform:translateX(-100%)}",
      /* 进入最高档、还没点火：蓝色盖板先停在满覆盖位置，别让紫色渐变层先露整条。
         等 fireBurst 把 data-run 切到 1，盖板再从 0 向左退，刚好只擦一次。 */
      ".dem-track[data-rail='codex'] .dem-codex-wipe[data-run='hold']{animation:none;transform:translateX(0)}",
      "@keyframes demCodexWipeIn{from{transform:translateX(0)}to{transform:translateX(-100%)}}",
      "@keyframes demCodexWipeOut{from{transform:translateX(-100%)}to{transform:translateX(0)}}",
      ".dem-track[data-rail='codex'] .dem-codex-dust{position:absolute;inset:0;overflow:hidden;pointer-events:none;"
        + "-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);"
        + "mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}",
      /* 每颗粒子是一个「和轨道等宽的空壳」，圆点挂在它的 right:0 外侧；
         动画只改 transform，走合成层，不再触发布局 —— 这就是之前卡顿的根源。 */
      ".dem-track[data-rail='codex'] .dem-codex-dust i{position:absolute;inset:0;display:block;will-change:transform;"
        + "animation:demCodexDust var(--dur,2s) linear var(--delay,0s) infinite;"
        + "animation-play-state:paused}",
      ".dem-track[data-rail='codex'] .dem-codex-dust i::before{content:'';position:absolute;left:100%;top:var(--y,50%);"
        + "width:3px;height:3px;border-radius:50%;background:#fff;opacity:var(--o,.8);"
        + "transform:translate(-50%,-50%) scale(var(--s,1))}",
      ".dem-track[data-rail='codex'][data-max='1'] .dem-codex-dust i{animation-play-state:running}",
      "@keyframes demCodexDust{from{transform:translateX(0)}to{transform:translateX(-103%)}}",
      ".dem-track[data-rail='codex'] .dem-codex-fw{position:absolute;inset:0;pointer-events:none;z-index:4}",
      ".dem-track[data-rail='codex'] .dem-codex-fw i{position:absolute;top:50%;left:var(--bx,100%);width:var(--sz,3px);"
        + "height:var(--sz,3px);border-radius:50%;opacity:0;"
        + "background:radial-gradient(circle,rgba(255,255,255,.95),"
        + "color-mix(in srgb,var(--dem-accent,#4a84ff) 62%,white));"
        + "box-shadow:0 0 6px color-mix(in srgb,var(--dem-accent,#4a84ff) 68%,transparent)}",
      ".dem-track[data-rail='codex'] .dem-codex-fw[data-go='1'] i{animation:demCodexFw var(--fd,.9s) cubic-bezier(.16,.84,.44,1) var(--d,0s) both}",
      "@keyframes demCodexFw{0%{opacity:0;transform:translate(-50%,-50%) rotate(var(--a)) translateX(0) scale(.4)}"
        + "8%{opacity:1;transform:translate(-50%,-50%) rotate(var(--a)) translateX(2px) scale(1)}"
        + "70%{opacity:.85}100%{opacity:0;transform:translate(-50%,-50%) rotate(var(--a)) translateX(var(--r,22px)) scale(.25)}}",
      ".dem-hint{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      /* ── 插件详情页里的自定义版式面板 ────────────────────────────────
         详情页的宿主不一定带齐 DSH 令牌；不能拿浅色页去赌深色 fallback。
         这里把面板用到的别名令牌**局部锁定成固定浅色值**，只作用于
         `.dem-cfg` 内部，对话轨道和菜单面板完全不受影响。
         这样浅色 / 深色主题、不同机器、不同缩放下的配色都一致。 */
      ".dem-cfg{"
        + "--dsw-alias-label-primary:#172033;"
        + "--dsw-alias-label-secondary:#667085;"
        + "--dsw-alias-card-fill:#ffffff;"
        + "--dsw-alias-bg-base:#ffffff;"
        + "--dsw-alias-border-l1:#dfe6f0;"
        + "--dsw-alias-interactive-bg-hover:#f1f5fa;"
        + "--dsw-focus-ring-color:#4a84ff;"
        + "--dsw-focus-ring-width:2px;"
        + "color-scheme:light;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;"
        + "padding:14px 12px 12px;border:1px solid #e4eaf3;border-radius:14px;"
        + "background:#ffffff;box-shadow:0 1px 2px rgba(16,24,40,.04);"
        + "font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}",
      ".dem-cfg-head{display:flex;flex-direction:column;gap:3px}",
      ".dem-cfg-title{font-size:14px;font-weight:600;letter-spacing:.01em}",
      ".dem-cfg-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:28px}",
      ".dem-cfg-label{flex:0 0 76px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);"
        + "white-space:nowrap}",
      /* 详情页的开关：轨道形变 / 玻璃材质。做成实体拨片而不是“开 / 关”文字，
         状态一眼可见，键盘也能直接用空格切换。 */
      ".dem-cfg-switch{position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;"
        + "background:var(--dsw-alias-border-l1,rgba(255,255,255,.16));cursor:pointer;"
        + "transition:background .18s ease,box-shadow .18s ease}",
      ".dem-cfg-switch::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;"
        + "border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(8,14,26,.28);"
        + "transition:transform .18s cubic-bezier(.32,.72,.36,1)}",
      ".dem-cfg-switch[data-on='1']{background:var(--dem-accent,#4a84ff);"
        + "box-shadow:0 0 0 1px color-mix(in srgb,var(--dem-accent,#4a84ff) 58%,transparent)}",
      ".dem-cfg-switch[data-on='1']::after{transform:translateX(16px)}",
      ".dem-cfg-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4a84ff);"
        + "outline-offset:2px}",
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
      ".dem-cfg-opt[data-on='1']{background:#ffffff;"
        + "color:#1d4ed8;font-weight:600;"
        + "box-shadow:0 0 0 1px #c3d7f6,0 1px 2px rgba(15,25,50,.06)}",
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
        + "background:linear-gradient(180deg,#f8fbff 0%,#edf3fb 100%);"
        + "border:1px solid #d9e4f2;box-shadow:inset 0 1px 0 #ffffff}",
      /* 环心那层乳白玻璃要用 backdrop-filter 虚化底下粒子，否则环里还是能看见方块在动。 */
      ".dem-knob[data-knob-shape='ring']"
        + "{backdrop-filter:blur(4px) saturate(1.15);-webkit-backdrop-filter:blur(4px) saturate(1.15)}",
      /* 详情页预览：直接放一条真轨道，不再另画一套静态示意。
         卡片本身当取景框，越界粒子 / 端点形变都被圆角收在这里。 */
      ".dem-cfg-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}",
      ".dem-cfg-preview-kicker{font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;"
        + "color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-preview-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-preview-stage{position:relative;min-height:38px;padding:4px 0 2px}",
      ".dem-cfg-preview-stage .dem-track{--dem-slot-bg:#c8d7e9;width:100%;margin:0;cursor:grab}",
      ".dem-cfg-preview-stage .dem-track:active{cursor:grabbing}",
      ".dem-cfg-preview-caption{display:flex;align-items:baseline;gap:8px;min-height:20px;margin-top:10px}",
      ".dem-cfg-preview-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-preview-value{font-size:13px;line-height:18px;font-weight:600;"
        + "font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#6b7280)}",
      ".dem-cfg-preview-value[data-hot='1']{font-weight:700}",
      ".dem-cfg-preview-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
      ".dem-cfg-preview-tag{padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));"
        + "font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}",
      ".dem-cfg-preview-tag[data-on='0']{opacity:.55}",
      ".dem-cfg-preview-tag[data-on='1']{color:var(--dsw-alias-label-primary,#0f1115);"
        + "border-color:color-mix(in srgb,var(--dem-accent,#4a84ff) 34%,var(--dsw-alias-border-l1,rgba(0,0,0,.08)));"
        + "background:color-mix(in srgb,var(--dem-accent,#4a84ff) 8%,transparent)}",
      ".dem-cfg-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}",
      ".dem-cfg-play{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));"
        + "background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));"
        + "color:var(--dsw-alias-label-primary,#e6e8ee);font-size:12px;line-height:18px;"
        + "padding:4px 16px;border-radius:8px;cursor:pointer;"
        + "transition:background .16s ease,border-color .16s ease}",
      ".dem-cfg-play:hover{border-color:var(--dem-accent,#4a84ff);"
        + "background:color-mix(in srgb,var(--dem-accent,#4a84ff) 16%,transparent)}",
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

    /** 官方菜单行里那段当前档位名（`推理等级 … Max`）是打开浮层时最早可用的
        事实源：目录快照偶尔晚一拍，但这一行已经是真实值。用它给轨道一个正确
        的初始落点，避免 `liveIndex=-1` 时先回退到 0 档。 */
    function rowEffortIndex(row, levels) {
      if (!row || typeof document === "undefined" || typeof document.createTreeWalker !== "function") return -1;
      var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.nodeValue || "").trim();
        if (!text) continue;
        for (var i = 0; i < levels.length; i += 1) {
          if (levels[i] && levels[i].name === text) return i;
        }
      }
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
     * `escAmt` 是全局强度（进最高档 0→1、退档 1→0，指数逼近），
     * 这里按它离旋钮的远近错峰 —— 越靠左（sc 越大）起势越晚，
     * 于是进档是一道从滑块向左推的波，退档反过来，不会整片同时跳。
     */
    function scatterLocal(escAmt, sc) {
      /* 先线性夹取，再 smoothstep：线性版在 local 刚离开 0、刚触到 1 的两个点上
         斜率是断的（位移看着像"卡"一下才开始/停下）。smoothstep 两端导数为 0，
         起势和落位都是渐入渐出。错峰量 0.34，波前更清楚。 */
      var t = Math.max(0, Math.min(1, (escAmt - sc * 0.34) / 0.66));
      return t * t * (3 - 2 * t);
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
     *
     * `omega` 可缺省：拖动松手吸附用 22（跟住指尖的势头）；点击 / 键盘换档
     * 不跑这条曲线，直接走 `.dem-knob / .dem-fill` 的 CSS 过渡。
     */
    function settleAt(from, to, v0, t, omega) {
      var w = isFinite(omega) && omega > 0 ? omega : SETTLE_OMEGA;
      var A = from - to;
      var critical = w * Math.abs(A);
      var speed = isFinite(v0) ? v0 : 0;
      if ((to > from && speed < 0) || (to < from && speed > 0)) speed = 0;
      speed = Math.max(-critical, Math.min(critical, speed));
      var B = speed + w * A;
      return to + (A + B * t) * Math.exp(-w * t);
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
     *
     * `softEdge` 只给详情页预览卡：边缘格子保留到滑块内缘再裁，正式轨道不传。 */
    function createWall(host, width, lvRef, fillWidthRef, burstPowerRef, tailSync, topRef, softEdge) {
      var cols = Math.max(4, Math.floor(width / CELL));
      var cells = [];
      /* 越界强度：进最高档时 0 → 1、退档时 1 → 0（见 tick 里的过渡曲线）。 */
      /* 越界强度（0..1）。**它本身就是状态**，每帧朝目标指数逼近：
         起步快（第一帧就动）、尾巴软（越接近目标越慢），中途反向也不会跳 ——
         因为不存在"另一条曲线"，只有同一个值在追两个目标之一。 */
      var escAmt = 0;
      /* 全局时间（秒）：drift / tide 这两套动画的相位靠它，不是每格各自的相位。 */
      var waveT = Math.random() * 4;
      var rafId = null;
      var lastTs = 0;
      var alive = true;
      var warnedNonFinite = false;

      /* ── 冷启动 ──────────────────────────────────────────────
         打开菜单/详情页时这面墙是新建的。三件事要在**第一帧 paint 之前**就位：
           1. 强度落在一个"半散"的起点（0.25）：贴着滑块的那几格先散开，最左侧那批
              还压在网格上，于是开场是一道向左推开的波，不是一张静态的半散图；
           2. 相位随机，冷启动不会每次都从同一帧画面开始；
           3. 下面会在建完格子后**同步跑一帧**，保证首帧画出来就是散开的样子
              （否则要先等一次 rAF，中间那一帧是"全在网格上 + 被 30px 盒子裁掉"的）。 */
      var scatterOnAtMount = settings.scatterMode === "all"
        || (settings.scatterMode === "top" && (!topRef || topRef.current === true));
      if (scatterOnAtMount) {
        /* 从 0.25 起势：贴着滑块的几格先散开，最左侧还压在网格上，
           开场是一道向左推开的波，而不是一张静态的半散图。 */
        escAmt = 0.25;
      }

      /* 建墙前先清空 host：上一次的墙如果没被 destroy（React 复用节点、面板重挂），
         残留的 <i> 会被这次的新格子盖住/交错，看起来就是"轨道上多出一颗不动的粒子"。 */
      while (host.firstChild) host.removeChild(host.firstChild);

      /* 纵向格子按可见带高切分，而不是固定 30/6：带子会随旋钮尺寸变矮，
         6 行 × 5px 会多出 1~2px，越界打开（overflow:visible）时就露在凹槽外。
         另外，带子等于整条轨道（旋钮 ≥ 30、inset = 0）时上下各让 1px，
         避免方块正好贴在凹槽外沿、抗锯齿溢出去；三种旋钮尺寸因此表现一致。 */
      var bandH = bandHeightOf(settings);
      var edgePad = bandH >= TRACK_HEIGHT ? 1 : 0;
      var cellH = (bandH - edgePad * 2) / ROWS;
      /* 网格整体下移 edgePad，而不是改粒子层的盒子 ——
         盒子必须继续等于可见带（左端帽的圆盘遮罩半径按它算），能动的只有格子。 */
      for (var gy = 0; gy < ROWS; gy += 1) {
        for (var gx = 0; gx < cols; gx += 1) {
          var el = document.createElement("i");
          el.className = "dem-cell";
          /* 与设计稿一致：整格 5px 严丝合缝铺满网格，不做缩格留缝。 */
          el.style.width = CELL.toFixed(2) + "px";
          el.style.height = cellH.toFixed(2) + "px";
          el.style.opacity = "0";
          cells.push({
            el: el,
            gx: gx * CELL,
            gy: edgePad + gy * cellH,
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
          /* 只写粒子容器宽度。填充宽度由 React 提交的 `width` / `writeTargetPct`
             负责，并走它自己的 `.3s` CSS 过渡；这里若也每帧改 fill.style.width，
             每一帧都会把过渡目标重设到滑块当前（尚未走完）的位置，填充就会
             一直追在滑块后面 —— 霓虹没有这层 rAF，所以只有粒子轨会显得不跟手。 */
          host.style.width = w.toFixed(2) + "px";
          /* 收口圆心/半径也每帧写：滑块有 .82s 缓动，遮罩必须跟着**真实渲染位置**走，
             否则缓动途中填充还按目标位置裁，就会露出一截"追不上滑块"的轨道。
             预览卡现在也挂真实轨道，tailSync 同样要跑；只有没有滑块几何的纯展示场景才跳过。 */
          if (tailSync) tailSync();
          /* 越界只在**最高思考档位**出现：它是"开满"的那一下，低档位不该有方块飞出去。
             `topRef` 由组件传进来（shownIndex === 最高档）；传空时才当作"一直在最高档"，
             方便纯展示场景直接看到一个循环。 */
          var scatterMode = settings.scatterMode;
          var scattered = scatterMode === "all"
            || (scatterMode === "top" && (!topRef || topRef.current === true));
          /* 进/退最高档的过渡，两条要求同时满足：
               · 及时 —— 切换的那一下必须马上看见动静（近滑块的一侧立刻起势）；
               · 从容 —— 整片铺开要花近一秒，尾巴慢慢落位，不是"啪"地全出去。
             做法：把 `escAmt` 当成一个阻尼值，每帧朝 0 或 1 **指数逼近**：
               escAmt += (target − escAmt) · (1 − e^(−dt/τ))
             指数逼近的三个好处正好对上这三条要求：
               · 及时 —— 第一帧就走掉目标差的 7%，切档立刻有动静；
               · 从容 —— 尾巴按 e 衰减，最后 10% 走得很慢，不会"啪"地停住；
               · 连续 —— 中途反向（快速连切档位）时同一个值换目标继续追，
                 不存在两条曲线接缝，也就没有跳变。
             退档的时间常数更小（0.17s < 0.24s）：收回要干脆，铺开可以从容。
             再落到每一格按离滑块的远近错峰（见 `scatterLocal`）。 */
          var escTarget = scattered ? 1 : 0;
          var escTau = scattered ? 0.24 : 0.17;
          var escStep = 1 - Math.exp(-Math.min(50, dt) / 1000 / escTau);
          escAmt += (escTarget - escAmt) * escStep;
          if (Math.abs(escTarget - escAmt) < 0.002) escAmt = escTarget;
          /* 裁剪每帧由状态直接写死；横向右边界与填充共用同一个
             `--dem-knob-tail-inset`，避免 JS 这层把色带的收口重新放开。
             判据用 `escAmt` 而不是 `scattered`：退档时那 0.6s 还在往回飞，
             盒子得先开着，否则收回去的半路会被 30px 的盒子齐着切掉。
             **必须排在 `escAmt` 更新之后**：冷启动那一帧强度已经是 0.25 了，
             放到前面就会出现"首帧被裁、第二帧才张开"的闪一下。 */
          var openBox = escAmt > 0.01;
          host.style.overflow = openBox ? "visible" : "hidden";
          /* 粒子层宽度 = 填充宽度 = 滑块右缘；右侧 inset 用和填充完全相同的
             `--dem-knob-tail-inset`，两层共用一条收口线，滑块与色轨才是一体。
             纵向按 openBox 放行/收拢，越界动画仍能飞出上下边。 */
          host.style.clipPath = openBox
            ? "inset(-420px var(--dem-knob-tail-inset,15px) -420px 0px)"
            : "inset(0px var(--dem-knob-tail-inset,15px) 0px 0px)";
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

            /* 超出当前填充宽度 → 整格隐藏，旋钮右边因此是干净的空凹槽。
               预览卡用 softEdge：只要格子的左缘还在填充内就保留，右缘交给
               TAIL_MASK 按滑块内缘连续裁切。否则每跨过 5px 整格才重新出现，
               换到 Medium 的 300ms 里右边缘会一格格地空/满跳，看起来就是
               "粒子轨有切、霓虹没有"。对话轨道不传 softEdge，行为保持原样。 */
            if (w < CELL || c.gx > (softEdge ? w : w - CELL)) {
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

            /* 上下边界不再在这里夹：越界方块的纵向溢出由外层裁切层的胶囊轮廓收口
               （见 .dem-mosaic-clip 的 overflow:hidden + border-radius），
               这里硬夹反而会让方块堆在上下边缘形成一圈硬边。 */

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
            if (x < 0) op = ex > 0 ? op * Math.max(0, 1 + x / 2) : 0;

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
                console.warn("[" + PACKAGE_ID + "] 粒子位移出现非有限值", {
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
      /* 首帧量宽之前 width=0，旋钮会被算到最左端（left≈14px）；useLayout 量到真实
         宽度后改成真实档位，而 `.dem-knob` 的 `transition:left .3s` 会把这次
         **测量修正**当成一次正常换档播放出来 —— 每次打开菜单都从最左划到档位。
         这里用 data-ready 先隐藏轨道，等真实档位和宽度都到位后再显形；显形后的
         第一帧仍用 data-measured=0 关过渡，下一帧才恢复动画。 */
      var _measured = React.useState(false);
      var measured = _measured[0];
      var setMeasured = _measured[1];
      /* 首帧的“档位已就绪”闸门：目录快照可能比轨道挂载晚一拍，这时 index 只能
         回退到 0。先隐藏整条轨道，等真实档位到位后一次性显示在正确位置；
         可见后的第一帧仍关过渡，下一帧才恢复，避免 0 → 档位被当成换档动画播。 */
      var _introDone = React.useState(false);
      var introDone = _introDone[0];
      var setIntroDone = _introDone[1];

      var _burst = React.useState(false);
      var burst = _burst[0];
      var setBurst = _burst[1];

      /* 霓虹风格的动效序号：每点亮一次 +1，用它当 key 让擦除和烟花重新挂载重播。 */
      var _codexSeq = React.useState(0);
      var codexSeq = _codexSeq[0];
      var setCodexSeq = _codexSeq[1];

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
      var landMs = typeof props.landMs === "number" && props.landMs >= 0
        ? props.landMs
        : CLICK_LAND_MS;
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

      /* width 是 layout effect 里写进去的：它和首次挂载在同一次提交里落地，
         但 effect 要等这一帧 paint 完才跑 —— 正好把"测量修正"那一帧隔开。 */
      React.useEffect(function () {
        if (width > 0 && !measured) setMeasured(true);
      }, [width, measured]);

      /* indexReady 由 ConnectedTrack 传入：目录里已经有真实档位（或用户刚点了一档）
         才允许轨道显形。显形后等一帧再开 CSS 过渡，这样第一帧的落位不会动。 */
      var indexReady = props.indexReady !== false;
      var ready = measured && indexReady;
      React.useEffect(function () {
        if (!ready || introDone) return undefined;
        var raf = window.requestAnimationFrame(function () { setIntroDone(true); });
        return function () {
          if (raf) window.cancelAnimationFrame(raf);
        };
      }, [ready, introDone]);

      /* 填充右端要盖到**滑块右缘**，不是滑块中心：填充只画到中心时，空心环
         会把填充的直角截面完整透出来，看着就是轨道从滑块中间接上了。 */
      /* 墙宽**不再按 pct 推**，而是每帧读滑块的真实渲染位置（right - 轨道 left）。
         滑块有 .82s 缓动，墙体是逐帧直读的；按 pct 推的话墙会先跳到目标宽度，
         滑块还在半路 —— 截屏看到的就是"轨道超出滑块"。读 DOM 就永远贴着它。 */
      var knobRef = React.useRef(null);
      /* ── 端点形变 ─────────────────────────────────────────────────────
         只写 CSS 变量，不碰 left / width / 填充几何：
           · 滑块 transform-origin 固定在圆心 → 拉长/压扁时中心锚点不动；
           · 轨道玻璃壳、色带、粒子层都吃同一组 `--dem-rail-*`，围绕滑块
             右缘/圆心做同一方向的拉伸，轨道和色轨不会再各动各的；
           · 横向只有滑块越过 0 / 1 端点继续外拉才触发；中段横向拖动完全静止；
             纵向则由按下点位移触发，中段上下拖也能拉伸。
         形变值由 rAF 平滑追目标；松手或回到中段后回弹到 1。 */
      function deformNeutral() {
        return {
          knobSx: 1, knobSy: 1, knobSkewX: 0, knobSkewY: 0,
          railSx: 1, railSy: 1, railSkewX: 0, railSkewY: 0,
          edge: 0,
        };
      }
      var deformRef = React.useRef({
        current: deformNeutral(),
        target: deformNeutral(),
        raf: null,
        active: false,
      });
      function deformCopy(s) {
        return {
          knobSx: s.knobSx, knobSy: s.knobSy, knobSkewX: s.knobSkewX, knobSkewY: s.knobSkewY,
          railSx: s.railSx, railSy: s.railSy, railSkewX: s.railSkewX, railSkewY: s.railSkewY,
          edge: s.edge,
        };
      }
      function writeDeform(s) {
        var track = trackRef.current;
        if (!track || !track.style || typeof track.style.setProperty !== "function") return;
        track.style.setProperty("--dem-knob-sx", s.knobSx.toFixed(4));
        track.style.setProperty("--dem-knob-sy", s.knobSy.toFixed(4));
        track.style.setProperty("--dem-knob-skew", s.knobSkewX.toFixed(3) + "deg");
        track.style.setProperty("--dem-knob-skew-y", s.knobSkewY.toFixed(3) + "deg");
        /* 轨道玻璃壳、填充、粒子共用同一组值，而且锚点都落在色带右缘；
           所以色轨的轮廓会跟着玻璃壳一起走，不会只让空槽变形。 */
        track.style.setProperty("--dem-rail-sx", s.railSx.toFixed(4));
        track.style.setProperty("--dem-rail-sy", s.railSy.toFixed(4));
        track.style.setProperty("--dem-rail-skew", s.railSkewX.toFixed(3) + "deg");
        track.style.setProperty("--dem-rail-skew-y", s.railSkewY.toFixed(3) + "deg");
        /* 端点形变锚在**滑块这一侧的轨道端点**：
           左端锚轨道左缘，右端锚滑块右缘；玻璃和色带都从这里向轨道内侧伸展，
           这样轨道不会越过滑块，色带也不会和玻璃脱开。 */
        if (!s.edge) {
          track.style.removeProperty("--dem-rail-origin-x");
        } else {
          track.style.setProperty(
            "--dem-rail-origin-x",
            s.edge < 0 ? "0px" : "var(--dem-rail-base-origin)"
          );
        }
      }
      function stepDeform() {
        var d = deformRef.current;
        var t = d.target;
        var c = d.current;
        var ease = d.active ? 0.34 : 0.18;
        c.knobSx += (t.knobSx - c.knobSx) * ease;
        c.knobSy += (t.knobSy - c.knobSy) * ease;
        c.knobSkewX += (t.knobSkewX - c.knobSkewX) * ease;
        c.knobSkewY += (t.knobSkewY - c.knobSkewY) * ease;
        c.railSx += (t.railSx - c.railSx) * ease;
        c.railSy += (t.railSy - c.railSy) * ease;
        c.railSkewX += (t.railSkewX - c.railSkewX) * ease;
        c.railSkewY += (t.railSkewY - c.railSkewY) * ease;
        var delta = Math.max(
          Math.abs(t.knobSx - c.knobSx), Math.abs(t.knobSy - c.knobSy),
          Math.abs(t.knobSkewX - c.knobSkewX), Math.abs(t.knobSkewY - c.knobSkewY),
          Math.abs(t.railSx - c.railSx), Math.abs(t.railSy - c.railSy),
          Math.abs(t.railSkewX - c.railSkewX), Math.abs(t.railSkewY - c.railSkewY),
        );
        if (delta < 0.001) {
          d.current = deformCopy(t);
          writeDeform(d.current);
          d.raf = null;
          return;
        }
        writeDeform(c);
        d.raf = window.requestAnimationFrame(stepDeform);
      }
      function kickDeform() {
        var d = deformRef.current;
        if (d.raf === null) d.raf = window.requestAnimationFrame(stepDeform);
      }
      /* `energy` 来自横向越过端点的拉出量，或中段纵向拖动的位移；
         横向中段不会平白起浪。最低 0.08 是为了刚开拉时只有很轻的拉伸。 */
      function deformTo(energy, axisX, edgeSide, signX, signY) {
        /* 详情页关掉「拖拽动效」时，只保留滑块的跟手位移，不再产生任何形变。 */
        if (!settings.dragMotion) return;
        var d = deformRef.current;
        var e = clampNum(energy, 0.08, 1, 0.08);
        var ax = clamp01(axisX);
        var ay = 1 - ax;
        var sx = signX < 0 ? -1 : 1;
        var sy = signY < 0 ? -1 : 1;
        var edge = edgeSide < 0 ? -1 : edgeSide > 0 ? 1 : 0;
        var railSx = 1 + 0.035 * e * ax - 0.02 * e * ay;
        d.active = true;
        /* 锚点跟着这一侧走：左端 0，右端色带右缘；玻璃和色带共用。
           中段纯上下拉没有横向端点，edge=0，继续用默认右缘锚点。 */
        d.current.edge = edge;
        d.target = {
          /* 滑块：顺拖动方向拉长、横向压扁；上下拖时反过来，能一眼看出被抓住。 */
          knobSx: 1 + 0.32 * e * ax - 0.14 * e * ay,
          knobSy: 1 + 0.32 * e * ay - 0.14 * e * ax,
          knobSkewX: -sx * 7.0 * e * ax,
          knobSkewY: -sy * 7.0 * e * ay,
          /* 轨道 / 色带 / 粒子：幅度收一档，避免整条 272px 轨道甩出胶囊。
             长条轨道不做 skewY —— 那条变换会把整条 900px 的带子斜成一条坡，
             看起来像轨道断了；纵向只做 scaleY，横向保留很轻的 skewX。 */
          railSx: railSx,
          railSy: 1 + 0.22 * e * ay - 0.05 * e * ax,
          railSkewX: -sx * 1.2 * e * ax,
          railSkewY: 0,
          edge: edge,
        };
        kickDeform();
      }
      function deformRelax() {
        var d = deformRef.current;
        d.active = false;
        d.target = deformNeutral();
        kickDeform();
      }
      /* 回到中段/松手后如果上一帧还在形变，回到中性；已经完全静止就什么都不做。 */
      function deformRelaxIfActive() {
        var d = deformRef.current;
        if (!d.active && d.raf === null) return;
        deformRelax();
      }
      function cancelDeform() {
        var d = deformRef.current;
        if (d.raf !== null) {
          window.cancelAnimationFrame(d.raf);
          d.raf = null;
        }
        d.active = false;
      }
      /* 新一次按下前先把形变拍回中性，随后再量轨道矩形：
         否则量到的是上一次回弹中的变形尺寸，端点拉出量会自己追自己、抖成波浪。 */
      function deformReset() {
        var d = deformRef.current;
        if (d.raf !== null) {
          window.cancelAnimationFrame(d.raf);
          d.raf = null;
        }
        d.active = false;
        d.current = deformNeutral();
        d.target = deformNeutral();
        writeDeform(d.current);
      }
      /* 面板里把「拖拽动效」关掉时，如果手还停在轨道上，立刻回到原尺寸，
         不等下一次 pointermove —— 否则残留的拉伸会一直挂到松手。 */
      React.useEffect(function () {
        if (!liveSettings.dragMotion) deformReset();
      }, [liveSettings.dragMotion]);
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
        /* 拖动形变只改 transform，不能把这层缩放/斜切算进填充几何：
           getBoundingClientRect 的宽高包含 scale/skew，直接拿它会让色轨跟着
           滑块一起被拉长，右侧还会露出一截。这里用未变形的 offsetWidth/Height
           还原布局尺寸；transform-origin 是 50% 50%，所以形变后的 rect 中心
           仍然等于未形变的圆心，可以直接拿它取 cx。 */
        var layoutW = knob.offsetWidth || kr.width;
        var layoutH = knob.offsetHeight || kr.height;
        var cx = kr.left + kr.width / 2 - tr.left;
        var left = cx - layoutW / 2;
        var right = left + layoutW;
        /* 圆角矩形的收口半径要跟着**滑块自己的圆角**走，不能一律取 min(w,h)/2：
           方钮圆角只有 10px，收口却按 14px 画，四个角就会从滑块边上鼓出来一小块。 */
        var shapeR = settings.knobShape === "rounded"
          ? Math.round(settings.knobSize * 0.34)
          : Math.min(layoutW, layoutH) / 2;
        /* 细棒这类**比带高还窄**的滑块：竖切要退到滑块左缘，
           否则填充会以 30px 的高度直着一刀切在棒子中线上，棒子两侧露出一截方角。
           圆角方 / 胶囊仍切在圆心 —— 它们靠外圈中性护栏盖住圆角处的那一角，
           填充必须铺到滑块下方，不能断在滑块左边，否则看起来就是色轨追不上滑块。 */
        var cut = layoutW + 0.5 < tr.height ? layoutW / 2 : 0;
        return {
          right: Math.max(0, right - bw),
          cx: cx,
          cut: cut,
          r: Math.max(0, shapeR - bw),
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
        /* 霓虹的收口圆心由填充自身宽度反推（CSS `calc(100% - 半径)`），
           不读 track 上的这两个变量；每帧照写只会让样式失效重算一次，纯白给。 */
        if (liveSettings.railStyle === "codex") return;
        var track = trackRef.current;
        var g = knobGeomOf();
        if (!track || !g || !track.style || typeof track.style.setProperty !== "function") return;
        /* 圆心吸附到**设备像素**：遮罩边缘落在半个物理像素上时，相邻两帧会在
           1px 之间来回跳，看起来就是边缘在"爬"（蚂蚁线）。吸附后位置稳定。 */
        var dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        /* 实心滑块把切口再往左退 8px：拖动 skew/scale 时，切口会先被
           旋钮本体盖住，右侧不会露出填充的顶边 / 底边。空心环仍切圆心。 */
        var guard = liveSettings.knobShape === "ring" ? 0 : TAIL_CUT_GUARD;
        var cutX = Math.max(0, g.cx - (g.cut || 0) - guard);
        var cx = (Math.round(cutX * dpr) / dpr).toFixed(2) + "px";
        var r = (Math.round(fillTailRadiusOf(liveSettings) * 2) / 2).toFixed(2) + "px";
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
      /* 预览专用：边缘格子不做整格淘汰，交给 TAIL_MASK 连续裁切。
         正式轨道不传，仍走原来的整格边界。 */
      var softParticleEdge = !!props.softParticleEdge;

      /* 是否在**最高档**：越界动画只在这一档出现。用 ref 传进引擎，
         档位一变引擎下一帧就能读到，不用重建墙。 */
      var atTopRef = React.useRef(false);
      atTopRef.current = count > 1 && shownIndex >= topIndex;

      useLayout(function () {
        var host = mosaicRef.current;
        if (!host || width <= 0 || liveSettings.railStyle === "codex") return undefined;
        /* 建墙前先同步一次：首帧就要是"收在滑块内"的样子，不能等第一帧 rAF。 */
        syncTail();
        var wall = createWall(
          host, width, lvRef, fillWidthOf, burstPowerRef, syncTail, atTopRef, softParticleEdge,
        );
        wallRef.current = wall;
        return function () {
          wall.destroy();
          if (wallRef.current === wall) wallRef.current = null;
        };
      }, [width, count, liveSettings.railStyle, softParticleEdge]);

      /* 点亮动作：先清再下一帧开，保证同名动画能重播（设计稿也是 remove + void offsetWidth
         + add 这一套）。burstArmed 负责去重 —— "进入最高档"这件事会被拖拽和档位回读重复
         触发，没有这个标记就只能亮第一次。 */
      var burstTimerRef = React.useRef(null);
      /* 首次打开就在最高档：盖板保持 static（整条紫渐变静态可见），不要播擦除。
         后续从低档切上来时，落位后先 hold 住蓝盖板，等 fireBurst 再开始擦除。 */
      var burstArmedRef = React.useRef(count > 1 && index >= count - 1);
      /* 点击换档走 CSS 过渡，落位时间由这条定时器兜底（过渡被系统打断也能点亮）。 */
      var landTimerRef = React.useRef(null);
      /* 视觉落位通知（改官方字符 / 写乐观档位），和点亮定时器分开：
         点亮是装饰，字符是事实；两者不能互相顶掉。 */
      var landNotifyTimerRef = React.useRef(null);
      /* 卸载时清点亮定时器（否则它会在组件消失后再 setState 一次）。
         **必须留在声明 burstTimerRef 的这个组件里。** 曾把这几行写进
         ConnectedTrack 的卸载清理，那边没有这个变量 → React 卸载轨道时抛
         ReferenceError → 提交阶段出错把整棵子树卸掉，症状就是"关一次浮窗，
         再打开滑轨永久消失"。 */
      React.useEffect(function () {
        return function () {
          if (burstTimerRef.current !== null) {
            window.clearTimeout(burstTimerRef.current);
            burstTimerRef.current = null;
          }
          if (landTimerRef.current !== null) {
            window.clearTimeout(landTimerRef.current);
            landTimerRef.current = null;
          }
          if (landNotifyTimerRef.current !== null) {
            window.clearTimeout(landNotifyTimerRef.current);
            landNotifyTimerRef.current = null;
          }
          cancelDeform();
        };
      }, []);
      /**
       * 点亮等落位。切到最高档时，滑块要滑 0.24–0.34s 才真的到端点；
       * 以前在"松手/点击"那一刻就爆，动画先跑完、滑块才到 —— 看着像动画和滑块无关。
       * 现在只打一个标记，由 `beginSettle` 在**曲线收敛那一帧**播（见 `armBurstOnLand`）。
       */
      var burstPendingRef = React.useRef(false);
      var mountedRef = React.useRef(false);
      function armBurstOnLand() {
        burstPendingRef.current = true;
      }
      function fireBurst() {
        /* 霓虹的最高档：除了自己的「擦除 + 烟花」，也要能播点亮样式，
           只是它作用在紫渐变上，用的是下面那组更轻的 霓虹专属关键帧。 */
        if (settings.railStyle === "codex") {
          setCodexSeq(function (v) { return v + 1; });
          setCodexGo(true);
        }
        if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
        setBurst(false);
        window.requestAnimationFrame(function () {
          setBurst(true);
          /* 霓虹的时长受「点亮速度」控制，定时器要跟着变，否则快/慢档会被拦腰截断。
             马赛克维持原来的 2.6s / 0.9s。 */
          var holdMs = settings.burstStyle === "pulse" ? 2600 : 900;
          if (settings.railStyle === "codex") {
            var nb = neonBurstVarsOf(settings);
            var key = "dur" + settings.burstStyle.charAt(0).toUpperCase() + settings.burstStyle.slice(1);
            holdMs = Math.round(parseFloat(nb[key] || nb.durRipple) * 1000) + 160;
          }
          burstTimerRef.current = window.setTimeout(
            function () { setBurst(false); },
            holdMs,
          );
        });
        burstPowerRef.current = settings.burstStyle === "shatter"
          ? settings.burstIntensity * 1.9
          : settings.burstIntensity;
      }

      /* ── 详情页预览的演示钩子（正式轨道不传这两个 prop，行为完全不变）──
         burstNonce：点"播放"或切点亮样式时，在预览里重放一次当前点亮动画。
         demoNonce：开启 / 重播拖拽动效时，让预览自己拉一下端点、再上下拉伸，
         用户不用真的按住也能看见"形变开 / 关"的差别。 */
      var previewBurstNonce = props.burstNonce || 0;
      var previewDemoNonce = props.demoNonce || 0;
      React.useEffect(function () {
        if (!previewBurstNonce) return;
        fireBurst();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [previewBurstNonce]);
      React.useEffect(function () {
        if (!previewDemoNonce || !settings.dragMotion || settleReduceMotion()) return undefined;
        var timers = [];
        function at(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
        deformReset();
        at(16, function () { deformTo(0.92, 1, 1, 1, 0); });
        at(230, function () { deformTo(0.88, 0, 0, 0, 1); });
        at(620, function () { deformRelax(); });
        return function () {
          for (var i = 0; i < timers.length; i += 1) window.clearTimeout(timers[i]);
          deformReset();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [previewDemoNonce]);

      /** 落位那一帧兑现"等落位再点亮"的标记（由 beginSettle 的收尾分支调用）。 */
      function flushPendingBurst() {
        if (!burstPendingRef.current) return;
        burstPendingRef.current = false;
        burstArmedRef.current = true;
        fireBurst();
      }

      /** 点击换档是 CSS 过渡（.3s），没有 rAF 收尾；用同名时长兜底点亮。 */
      function scheduleBurstOnLand() {
        if (landTimerRef.current !== null) window.clearTimeout(landTimerRef.current);
        landTimerRef.current = window.setTimeout(function () {
          landTimerRef.current = null;
          if (!mountedRef.current || !atTopRef.current) return;
          flushPendingBurst();
        }, 330);
      }

      /* ══════════════════════ 无感引擎：视觉落位通知 ══════════════════════
         滑块到位的同一帧，先把官方挡位字符切成目标档位；宿主的同步桥
         `access.select` 再交给 ConnectedTrack 排到渲染空闲后执行。
         鼠标拖拽的落位由 `beginSettle` 的收敛帧触发，点击 / 键盘由
         `CLICK_LAND_MS` 定时器触发 —— 两条路径共用 `notifyLand()`。 */
      function notifyLand(targetIndex) {
        var now = latestRef.current;
        if (!now || !now.onLand) return;
        try { now.onLand(targetIndex); } catch (err) { /* 视觉提交失败不影响滑动 */ }
      }
      function cancelLandNotify() {
        if (landNotifyTimerRef.current !== null) {
          window.clearTimeout(landNotifyTimerRef.current);
          landNotifyTimerRef.current = null;
        }
      }
      /** 已经在目标上 / 减弱动画：落位和 onPick 同一调用栈，推到下一个 task 再通知，
          保证 ConnectedTrack 已经把 pending levelId 记下来。 */
      function notifyLandSoon(targetIndex) {
        cancelLandNotify();
        landNotifyTimerRef.current = window.setTimeout(function () {
          landNotifyTimerRef.current = null;
          if (!mountedRef.current) return;
          notifyLand(targetIndex);
        }, 0);
      }
      function scheduleLandNotify(targetIndex) {
        cancelLandNotify();
        if (settleReduceMotion()) {
          notifyLandSoon(targetIndex);
          return;
        }
        landNotifyTimerRef.current = window.setTimeout(function () {
          landNotifyTimerRef.current = null;
          if (!mountedRef.current) return;
          notifyLand(targetIndex);
        }, landMs);
      }

      /* 进入最高档就点亮一次。关键是**滑块真的到了端点才爆** ——
         拖动途中指针已到 0.97 以上时滑块也在端头，那一下可以立刻触发；
         但"点击/松手后还要滑一段"的情况必须等落位，否则动画会走在滑块前面。 */
      React.useEffect(function () {
        if (count < 2) return;
        var firstPaint = !mountedRef.current;
        mountedRef.current = true;
        if (shownIndex === topIndex) {
          /* 打开时本来就是最高档，不凭空闪一下，但要置位，离开再回来才爆。 */
          if (firstPaint) { burstArmedRef.current = true; return; }
          /* 正在滑过去（或已排队等落位）：交给 beginSettle 的收尾那一帧。 */
          if (settleRef.current !== null || burstPendingRef.current) return;
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
       * `omega` 缺省 22（拖动松手吸附）；点击 / 键盘换档走 `landByCss`，不经过这里。
       * `fromOverride` = 松手瞬间的指针位置：它比 React 已渲染的 `shownPct` 新，
       * 用它当起点才不会在松手后又往右补一小段。
       * 同一批 state 里先把 settlePct 设成起点，避免"松手那帧先跳到目标、下一帧再回来"。
       */
      function beginSettle(to, v0, omega, fromOverride) {
        if (!isFinite(to)) return;
        cancelLandNotify();
        var from = isFinite(fromOverride) ? fromOverride : shownPctRef.current;
        if (!isFinite(from)) from = to;
        cancelSettle();
        var track = trackRef.current;
        function mark(on) {
          setSnapping(on);
          if (track && track.setAttribute) track.setAttribute("data-snapping", on ? "1" : "0");
        }
        /* 已经在目标上（松手位置正好落在档位）：位置不动，但要给一次接触反馈，
           否则"点了没反应"—— 这正好也是用户最容易误判的地方。
           这一帧仍保持 data-snapping=1，等最终 `left` 提交后再放开过渡；
           否则上一次渲染的旧位置会被 `.3s` 过渡慢慢追到档位，看起来就是
           "已经到档了、松手后又往右补一段"。 */
        var reduceMotion = settleReduceMotion();
        if (reduceMotion || Math.abs(to - from) < 0.0006) {
          /* 这一帧必须显式把 data-snapping 挂上：否则上一次渲染的旧位置
             会带着 `.3s` 过渡追到档位，看起来就是"已经到档了、松手后又往右补一段"。 */
          if (!reduceMotion) mark(true);
          setSettlePct(null);
          if (!reduceMotion) popKnob();
          flushPendingBurst();
          notifyLandSoon(indexOfPct(to, count));
          if (reduceMotion) mark(false);
          else window.requestAnimationFrame(function () { mark(false); });
          return;
        }
        var t0 = (typeof performance !== "undefined" && performance.now)
          ? performance.now() : Date.now();
        setSettlePct(from);
        mark(true);
        /* 直接同步写 DOM：React 的 state 要等下一次 render 才落到属性上，而第一帧 rAF
           可能比那次 render 更早。属性晚一步，第一帧的 `left` 就会走 CSS 过渡，
           滑块先"软一下"再被逐帧覆盖 —— 正是要消掉的那种顿。 */
        var s = { raf: null, from: from, to: to, v0: v0, omega: omega, t0: t0, notified: false };
        settleRef.current = s;
        /* 收尾时间跟着角频率走：ω 越小尾越长，用固定的 0.42s 硬截会在长轨道上
           剩几个像素没走完就"啪"地贴上目标。9.5/ω ≈ 9.5 个时间常数，残余 < 0.05%。 */
        var maxT = Math.min(0.62, 9.5 / (isFinite(s.omega) && s.omega > 0 ? s.omega : SETTLE_OMEGA));

        function step(now) {
          if (settleRef.current !== s) return;          /* 被新的吸附顶掉 */
          var t = Math.max(0, (now - s.t0) / 1000);
          var x = settleAt(s.from, s.to, s.v0, t, s.omega);
          /* 走到目标 1% 以内就算"视觉上到位"：临界阻尼的尾巴很长（ω=18 要 0.53s 才
             数学收敛，但 0.37s 时偏差已经不到 2px）。点亮在这里兑现，
             既不会抢在滑块前面，也不会让人干等那截看不见的尾巴。 */
          var tol = Math.max(0.0015, Math.abs(s.from - s.to) * 0.01);
          if (!s.notified && Math.abs(x - s.to) <= tol) {
            s.notified = true;
            notifyLand(indexOfPct(s.to, count));
          }
          if (burstPendingRef.current) {
            /* 两种轨道共用同一条手感：点亮在"行程 1%"处兑现，滑块随后走完
               临界阻尼的尾巴。霓虹不再有自己的提前收工分支 —— 以后调手感
               只改这一处，粒子轨和霓虹轨一起变。 */
            if (Math.abs(x - s.to) <= tol) flushPendingBurst();
          }
          if (t >= maxT || (t >= 0.09 && Math.abs(x - s.to) < 0.0004)) {
            settleRef.current = null;
            setSettlePct(null);
            popKnob();
            if (!s.notified) {
              s.notified = true;
              notifyLand(indexOfPct(s.to, count));
            }
            /* 兜底：极端情况下没触发 1% 判定（比如行程极小），收尾时也兑现。 */
            flushPendingBurst();
            /* 先让最终位置在 data-snapping=1 下提交，下一帧再恢复 CSS 过渡：
               否则残余的亚像素会被 `.3s` 过渡重新播一遍。 */
            window.requestAnimationFrame(function () { mark(false); });
            return;
          }
          setSettlePct(x);
          s.raf = window.requestAnimationFrame(step);
        }
        s.raf = window.requestAnimationFrame(step);
      }

      /**
       * 点击 / 键盘换档：不再跑弹簧曲线，直接让 `.dem-knob` / `.dem-fill` 的
       * CSS `left / width .3s` 从**当前 DOM 位置**滑到最近档位。
       * 目的就一条：用户点哪一档，滑块平滑过去；没有 rAF 收尾、没有末段补量，
       * 也不会在档位前"顿一下"。拖动松手仍走 `beginSettle`，保留指尖初速。
       *
       * 但只 `setLocalIndex` 会等 React 下一次提交才改 DOM —— 点击的第一帧
       * 还在旧位置，视觉上就是"点了没动/慢半拍"。所以先把目标像素同步写到
       * 旋钮和填充上，CSS 过渡在 pointerup 这一事件里就开始走，React 提交的值
       * 与它相同，不会把过渡重启。
       */
      function writeTargetPct(targetPct) {
        if (!isFinite(targetPct) || width <= 0) return;
        var knobW = knobWidthOf(settings);
        var travelPx = Math.max(0, width - knobW);
        var fillPx = knobW + travelPx * targetPct;
        var knobPx = knobW / 2 + travelPx * targetPct;
        var knob = knobRef.current;
        var fill = fillRef.current;
        if (knob && knob.style && knob.style.setProperty) {
          knob.style.setProperty("--dem-knob-x", knobPx.toFixed(3) + "px");
        }
        if (fill && fill.style) fill.style.width = fillPx.toFixed(3) + "px";
      }

      function landByCss(target) {
        cancelSettle();
        cancelLandNotify();
        setSettlePct(null);
        setSnapping(false);
        var track = trackRef.current;
        if (track && track.setAttribute) track.setAttribute("data-snapping", "0");
        setDragPct(null);
        setDragging(false);
        writeTargetPct(pctOfIndex(target, count));
        setLocalIndex(target);
        if (target === topIndex && count > 1 && !burstArmedRef.current) {
          burstPendingRef.current = true;
          scheduleBurstOnLand();
        } else if (target !== topIndex) {
          burstPendingRef.current = false;
          if (landTimerRef.current !== null) {
            window.clearTimeout(landTimerRef.current);
            landTimerRef.current = null;
          }
        }
        /* 视觉落位与 .3s CSS 过渡对齐；字符和轨道同一帧切换。 */
        scheduleLandNotify(target);
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
        cancelPendingPick: props.onCancelPick,
        fireBurst: fireBurst,
        armBurstOnLand: armBurstOnLand,
        landByCss: landByCss,
        onLand: props.onLand,
        cancelLandNotify: cancelLandNotify,
        dropPendingBurst: function () {
          burstPendingRef.current = false;
          if (landTimerRef.current !== null) {
            window.clearTimeout(landTimerRef.current);
            landTimerRef.current = null;
          }
        },
        burstArmed: burstArmedRef,
        beginSettle: beginSettle,
        cancelSettle: cancelSettle,
        lastMove: lastMoveRef,
        deformTo: deformTo,
        deformRelax: deformRelax,
        deformRelaxIfActive: deformRelaxIfActive,
        deformReset: deformReset,
      };

      React.useEffect(function () {
        var track = trackRef.current;
        if (!track) return undefined;

        /**
         * 指针 → 轨道百分比。端点严格内切：pct=0 时滑块左缘贴 0，
         * pct=1 时右缘贴轨道宽，不再用之前的 +2 / −1 让端点各出界 1px。
         */
        function pctAt(clientX, baseRect) {
          var rect = baseRect || track.getBoundingClientRect();
          var knob = knobWidthOf(settings);
          var radius = knob / 2;
          var span = rect.width - knob;
          if (!(span > 0)) return 0;
          return clamp01((clientX - rect.left - radius) / span);
        }

        /**
         * 端点外的“拉出量”（px）。只有滑块已经被拽到 0 / 1 之后继续往外拉，
         * 才有资格让轨道做**横向**形变；中段横向移动都返回 0。
         * 纵向由调用方按按下点位移另行计算，这里只负责端点外的纵向越界。
         */
        function edgePullOf(clientX, clientY, baseRect) {
          var rect = baseRect || track.getBoundingClientRect();
          var knob = knobWidthOf(settings);
          var radius = knob / 2;
          var span = Math.max(1, rect.width - knob);
          var raw = (clientX - rect.left - radius) / span;
          var overLeft = raw < 0 ? -raw * span : 0;
          var overRight = raw > 1 ? (raw - 1) * span : 0;
          var atEdge = raw <= 0.0001 || raw >= 0.9999;
          var overTop = atEdge ? Math.max(0, rect.top - clientY) : 0;
          var overBottom = atEdge ? Math.max(0, clientY - rect.bottom) : 0;
          var x = overLeft + overRight;
          var y = overTop + overBottom;
          return {
            x: x,
            y: y,
            left: overLeft,
            right: overRight,
            top: overTop,
            bottom: overBottom,
          };
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
           滑块离端头还有一整格的空档就开始播动画了）。
           也不能用 0.97：272px 行程上 3% 还有 8px，烟花会先炸、滑块再往右追，
           看起来就是"已经到档位了还在动"。这里只认磁吸后的精确端头。 */
        function checkTop(pct) {
          var now = latestRef.current;
          if (!now || now.count < 2) return;
          if (pct >= 0.9995) {
            if (!now.burstArmed.current) {
              now.burstArmed.current = true;
              now.fireBurst();
            }
          } else if (now.burstArmed.current) {
            now.burstArmed.current = false;
          }
        }

        /* 一次按压的现场：起点、按下时的滑块位置、是否已越过拖动阈值。
           按下**不移动滑块** —— "先跳到指针、再滑回来"就是回弹感的来源。 */
        var press = null;

        function onPointerDown(event) {
          if (event.button !== undefined && event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          /* preventDefault 连默认的聚焦一起挡了，键盘操作要自己补回来。 */
          try { track.focus({ preventScroll: true }); } catch (err) { track.focus(); }
          try { track.setPointerCapture(event.pointerId); } catch (err) { /* 捕获失败也能拖 */ }
          var now = latestRef.current;
          /* 上一次吸附还在跑就被按住了：停掉 rAF，但**保留** settlePct ——
             滑块停在当前视觉位置，不当场跳回目标档，下一次滑动从这里接着走。
             同时丢掉"等落位点亮"的标记：这一轮已经被打断，不该在别处补放。 */
          if (now) { now.cancelSettle(); now.dropPendingBurst(); if (now.cancelPendingPick) now.cancelPendingPick(); now.deformReset(); now.cancelLandNotify(); }
          /* 这次按压的基准矩形必须在中性形变下量，之后端点外拉不再重新量，
             玻璃壳被 scale 时不会反过来把“拉出量”改小、造成自己抖自己。 */
          press = {
            x: event.clientX,
            y: event.clientY,
            from: shownPctRef.current,
            moved: false,
            rect: track.getBoundingClientRect(),
          };
        }

        function onPointerMove(event) {
          if (!press) return;
          event.stopPropagation();
          var pct = pctAt(event.clientX, press.rect);
          var now = latestRef.current;
          if (!press.moved) {
            /* 阈值按**平面距离**算，不只看横向：上下拖同样能越过 5px 起拖；
               横向值仍只由 clientX 决定。 */
            var fromDownX = event.clientX - press.x;
            var fromDownY = event.clientY - press.y;
            if (Math.sqrt(fromDownX * fromDownX + fromDownY * fromDownY) < TAP_SLOP) return;
            /* 越过阈值才算拖动：从这一刻起滑块跟手，这之前一像素都不动。 */
            press.moved = true;
            setDragging(true);
          }
          setDragPct(pct);
          sample(pct, event.timeStamp);
          checkTop(pct);
          /* 横向形变只由**端点外的拉出量**触发；中段横向移动 pull=0，
             轨道/色带/滑块保持静止，不会“只要横着滑就晃”。
             纵向另有按下点位移（vIntent），中段上下拖也能拉高/压扁。 */
          if (now && now.deformTo) {
            var pull = edgePullOf(event.clientX, event.clientY, press.rect);
            /* 中段纯上下拖也要有物理反馈：以按下点为基准，纵向位移超过 8px
               且明显大于横向位移才计入，避免横向正常滑档时被手指抖动带出形变。 */
            var vTravel = Math.abs(event.clientY - press.y);
            var hTravel = Math.abs(event.clientX - press.x);
            var vIntent = vTravel > 2 && vTravel > hTravel * 0.8 ? vTravel - 2 : 0;
            var totalY = Math.max(pull.y, vIntent);
            var total = pull.x + totalY;
            if (total > 0.5) {
              var axisX = pull.x / total;
              var energy = Math.min(1, total / 30);
              var side = pct >= 0.9995 ? 1 : pct <= 0.0005 ? -1 : (pull.right > pull.left ? 1 : -1);
              var edge = axisX > 0.15 ? side : 0;
              var dirY = event.clientY - press.y < 0 ? -1 : 1;
              now.deformTo(
                Math.max(0.08, energy),
                axisX,
                edge,
                side,
                dirY
              );
            } else if (now.deformRelaxIfActive) {
              now.deformRelaxIfActive();
            }
          }
        }

        function onPointerUp(event) {
          if (!press) return;
          event.stopPropagation();
          var held = press;
          press = null;
          try { track.releasePointerCapture(event.pointerId); } catch (err) { /* 已释放 */ }

          var now = latestRef.current;
          if (!now) { setDragging(false); setDragPct(null); deformRelax(); return; }
          now.deformRelax();
          var pct = pctAt(event.clientX, held.rect);

          if (!held.moved) {
            /* ── 点击 ────────────────────────────────────────────────
               只做一件事：判定离指针最近的档位，滑块从当前位置用 CSS 过渡平滑滑过去。
               不走弹簧曲线，所以没有末段收尾、也不会在档位前顿一下。 */
            var tapTo = indexOfPct(pct, now.count);
            now.landByCss(tapTo);
            now.onPick(tapTo);
            return;
          }

          var target = indexOfPct(pct, now.count);
          var speed = pointerSpeed(pct, event.timeStamp);

          /* 顺序有讲究：**先**起吸附（它同步把 settlePct 设成松手位置），再清拖动态、
             再落档位。这样即使 React 不做批量更新，中间任意一帧读到的都是"当前位置"，
             不会出现"先跳到目标档、下一帧又跳回来"的一帧闪烁。
             起点显式用松手瞬间的指针位置：`shownPctRef` 可能还停在上一帧，
             拿它当起点会在松手后又往右补一小段。 */
          now.beginSettle(pctOfIndex(target, now.count), speed, undefined, pct);
          setDragging(false);
          setDragPct(null);
          setLocalIndex(target);
          /* 松手位置已经在端头（磁吸后的精确 1）→ 滑块本来就在那儿，立刻点亮。 */
          checkTop(pct);
          /* 否则吸附过去还要走一段：只排队，等 beginSettle 收敛那一帧再爆。 */
          if (target === now.topIndex && !now.burstArmed.current) now.armBurstOnLand();

          now.onPick(target);
        }

        function onPointerCancel(event) {
          if (!press) return;
          event.stopPropagation();
          var held = press;
          press = null;
          var now = latestRef.current;
          var pct = held.moved ? pctAt(event.clientX, held.rect) : held.from;
          setDragging(false);
          setDragPct(null);
          deformRelax();
          if (now) now.cancelLandNotify();
          /* 被系统打断（来电、切窗口）也要落位，不能把滑块丢在半路。 */
          if (now) {
            now.beginSettle(
              pctOfIndex(indexOfPct(pct, now.count), now.count),
              0,
              undefined,
              held.moved ? pct : undefined
            );
          }
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
          /* 键盘换档和点击走同一条 CSS 过渡：离散操作不需要指尖初速，
             平滑移到最近档位即可。 */
          now.landByCss(next);
          now.onPick(next);
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
         现在两个值同源：填充右端 = 滑块圆心 + 内缘半径，端点严格内切。 */
      var travelPx = Math.max(0, width - knobW);
      var fillPx = knobW + travelPx * shownPct;
      var knobPx = (knobW / 2) + travelPx * shownPct;
      var geom = fillPx.toFixed(3) + "px";
      var knobPos = knobPx.toFixed(3) + "px";

      /* ── 风格分支 ────────────────────────────────────────────────
         mosaic：原来的马赛克墙（越界只属于它）
         霓虹：平涂轨道 + 最高档擦除渐变 + 烟花 + 漂流白点           */
      var isCodex = liveSettings.railStyle === "codex";
      var atTopNow = count > 1 && shownIndex >= topIndex;
      /* 索引已经是最高档，但滑块可能还在吸附/拖动途中 —— 必须区分，
         否则烟花和变色会抢在滑块到位之前开演。 */
      var landedTop = atTopNow && settlePct === null && dragPct === null;

      /* 霓虹的入场只播一次：真的"从别处切到最高档"才置 true，
         直接打开菜单时本来就是最高档，不该再扫一遍。 */
      var _codexGo = React.useState(false);
      var codexGo = _codexGo[0];
      var setCodexGo = _codexGo[1];
      React.useEffect(function () {
        if (!landedTop && codexGo) setCodexGo(false);
      });

      var codexLayers = null;
      if (isCodex) {
        codexLayers = React.createElement(
          "div",
          { className: "dem-codex", "aria-hidden": "true" },
          React.createElement("div", { className: "dem-codex-grad" }),
          React.createElement("div", { className: "dem-codex-glow" }),
          /* key 换一次 = 重新挂载 = 擦除动画从头播一遍 */
          React.createElement("div", {
            key: "wipe" + codexSeq,
            className: "dem-codex-wipe",
            "data-run": codexGo ? "1" : landedTop ? (burstArmedRef.current ? "static" : "hold") : "0",
          }),
          React.createElement("div", { className: "dem-codex-dust" }, codexDustNodes()),
        );
      }

      var marks = [];
      for (var i = 0; i < count; i += 1) {
        var mPct = pctOfIndex(i, count);
        var mPx = (knobW / 2) + travelPx * mPct;
        marks.push(React.createElement("i", {
          key: "m" + i,
          /* 设计稿是 `i === 1 ? 'bar' : 'dot'`：第 2 个刻度是 12px 高的竖条，
             其余都是 4px 圆点。全画成圆点就和设计稿对不上了。 */
          className: i === 1 ? "dem-mark dem-mark--bar" : "dem-mark",
          style: { left: mPx.toFixed(3) + "px" },
        }));
      }

      /* 首帧兜底：效果还没跑起来时遮罩也要裁在滑块内（之后每帧由 rAF 覆写）。
         不声明这两项、只靠 rAF，挂载后的第一帧会露出"整条轨道冲过滑块"的样子。
         预览卡例外：它的 `--dem-fill-tail-x` 完全交给 syncTail 每帧读真实滑块；
         React 渲染时若写成目标档位，点击那一下遮罩会先跳到目标、下一帧才被
         rAF 拉回，马赛克粒子右缘会闪一帧。霓虹的 `.dem-fill` 用自身宽度算收口，
         不吃轨道上这条变量，所以只有粒子轨能看见这个闪。 */
      var trackStyle = {
        "--dem-fill-tail-radius": fillTailRadiusOf(liveSettings) + "px",
        /* 锚点默认落在色带右缘；端点形变时由引擎按方向改写：
           左端锚轨道左缘、右端锚这里。玻璃和色带共用同一个变量。 */
        "--dem-rail-base-origin": geom,
      };
      if (!softParticleEdge) {
        /* 首帧也按实心滑块的收口让位，避免挂载第一帧就露出右缘色线。 */
        var initialGuard = liveSettings.knobShape === "ring" ? 0 : TAIL_CUT_GUARD;
        var initialCut = Math.max(0, knobPx - (liveSettings.knobShape === "blade" ? knobW / 2 : 0) - initialGuard);
        trackStyle["--dem-fill-tail-x"] = initialCut.toFixed(3) + "px";
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
            tabIndex: ready ? 0 : -1,
            "aria-label": "推理等级",
            "aria-valuemin": 0,
            "aria-valuemax": topIndex,
            "aria-valuenow": shownIndex,
            "aria-valuetext": levels[shownIndex] ? levels[shownIndex].name : "",
            "data-rail": liveSettings.railStyle,
            "data-glass": liveSettings.glassMaterial ? "1" : "0",
            "data-knob-shape": liveSettings.knobShape,
            "data-ready": ready ? "1" : "0",
            "data-max": landedTop ? "1" : "0",
            "data-burst": burst ? "1" : "0",
            "data-burst-style": liveSettings.burstStyle,
            "data-dragging": dragging ? "1" : "0",
            "data-snapping": snapping ? "1" : "0",
            "data-measured": measured && introDone ? "1" : "0",
            /* 遮罩变量统一由上面的 trackStyle 给出；预览卡不写 tail-x，
               留给 syncTail 按真实滑块位置每帧写。 */
            style: trackStyle,
          },
          React.createElement(
            "div",
            { className: "dem-fill-clip", "aria-hidden": "true" },
            React.createElement("div", { ref: fillRef, className: "dem-fill", style: { width: geom } },
              React.createElement("div", { className: "dem-fill-fade", "aria-hidden": "true" }),
              codexLayers,
            ),
          ),
          React.createElement("div", { className: "dem-mosaic-clip", "aria-hidden": "true" },
            React.createElement("div", {
              ref: mosaicRef,
              className: "dem-mosaic",
              "aria-hidden": "true",
              /* 不在这里裁右边界：右侧空凹槽由引擎逐格 `opacity = 0` 实现（设计稿的做法），
                 clip-path 会把上下溢出也一起切掉。 */
            })),
          React.createElement("div", { className: "dem-flush-clip", "aria-hidden": "true" },
            React.createElement("div", { className: "dem-flush" }),
          ),
          marks,
          isCodex ? React.createElement("div", {
            key: "fw" + codexSeq,
            className: "dem-codex-fw",
            "aria-hidden": "true",
            "data-go": codexGo ? "1" : "0",
            style: { "--bx": knobPos },
          }, CODEX_SPARKS) : null,
          React.createElement("div", {
            className: "dem-knob",
            ref: knobRef,
            "data-knob-shape": liveSettings.knobShape,
            style: { "--dem-knob-x": knobPos },
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
    function tintEffortText(root, snapshot, indexOverride) {
      if (!root || typeof document.createTreeWalker !== "function") return;
      var levels = levelsOf(snapshot);
      if (levels.length === 0) return;
      var liveIndex = typeof indexOverride === "number"
        && indexOverride >= 0 && indexOverride < levels.length
        ? indexOverride
        : indexOfLevel(levels, effectiveEffortId(snapshot));
      var hot = liveIndex === levels.length - 1;
      /* 档位名来自模型目录，内容不可控；用无原型表，避免名字恰好是
         "__proto__" / "constructor" 时污染原型、把无关文字也染色。 */
      var byName = Object.create(null);
      for (var i = 0; i < levels.length; i += 1) {
        if (levels[i] && typeof levels[i].name === "string" && levels[i].name) byName[levels[i].name] = 1;
      }
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.nodeValue || "").trim();
        if (!text || !byName[text]) continue;
        if (textInsideEditor(node, root)) continue;
        var host = node.parentElement;
        if (!host) continue;
        if (hot) host.style.setProperty("color", tintColorOf(), "important");
        else if (host.style.getPropertyValue("color")) host.style.removeProperty("color");
      }
    }

    /**
     * 无感引擎的"视觉提交"：在滑块视觉落位的那一帧，直接把官方档位字符
     * 改成目标档位，不等宿主 snapshot 回写。只改文本节点本身，不动 React
     * 树、不触发面板重渲染，所以它不会把落位动画的第一帧堵住。
     *
     * 这是乐观写入：宿主若拒绝，`draft` 清空后的 effect 会用 liveIndex
     * 把文字和最高档颜色一起退回真实档位。
     */
    function paintEffortText(root, levels, index, chipOnly) {
      if (!root || !levels || !levels.length || typeof document.createTreeWalker !== "function") return;
      if (index === null || index === undefined || index < 0 || index >= levels.length) return;
      var target = levels[index];
      if (!target || typeof target.name !== "string" || !target.name) return;
      var byName = Object.create(null);
      for (var i = 0; i < levels.length; i += 1) {
        if (levels[i] && typeof levels[i].name === "string" && levels[i].name) byName[levels[i].name] = 1;
      }
      var hot = index === levels.length - 1;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var raw = node.nodeValue || "";
        var text = raw.trim();
        if (!text || !byName[text]) continue;
        if (textInsideEditor(node, root)) continue;
        if (chipOnly && !textHasChipContext(node, root, byName)) continue;
        if (text !== target.name) {
          /* 保留官方文本节点前后的空白，避免把行高 / 间距写坏。 */
          var lead = raw.slice(0, raw.indexOf(text));
          var tail = raw.slice(raw.indexOf(text) + text.length);
          node.nodeValue = lead + target.name + tail;
        }
        var host = node.parentElement;
        if (!host || !host.style) continue;
        if (hot) {
          var tint = tintColorOf();
          if (host.style.getPropertyValue("color") !== tint
            || host.style.getPropertyPriority("color") !== "important") {
            host.style.setProperty("color", tint, "important");
          }
        } else if (host.style.getPropertyValue("color")) {
          host.style.removeProperty("color");
        }
      }
    }

    /** 文本节点是否落在输入框 / 可编辑区里：乐观改字绝不动用户正在写的内容。 */
    function textInsideEditor(node, root) {
      var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
      while (el && el !== root) {
        var tag = String(el.tagName || "").toUpperCase();
        if (tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable === true) return true;
        if (typeof el.getAttribute === "function") {
          var editable = el.getAttribute("contenteditable");
          if (editable === "" || editable === "true" || editable === "plaintext-only") return true;
          if (el.getAttribute("role") === "textbox") return true;
        }
        el = el.parentElement;
      }
      return false;
    }

    /** 胶囊里的档位名要带模型前缀，且处在按钮类控件里；避免把用户正文 / 独立按钮的
        “Max” 当成官方胶囊改掉。菜单行不启用这条，它本身就是精确的档位值节点。 */
    function textHasChipContext(node, root, byName) {
      var el = node.parentElement;
      while (el && el !== root) {
        var whole = (el.textContent || "").replace(/\s+/g, " ").trim();
        var endsWithLevel = false;
        for (var name in byName) {
          /* 胶囊末尾常带展开箭头（`DeepSeek-V4.1-Flash · x0.12 Max ^`），
             不能要求整段文本正好以档位名结尾；只要求档位名前面有模型前缀，
             后面只剩空白或箭头符号。 */
          var at = whole.lastIndexOf(name);
          if (at > 0) {
            var tail = whole.slice(at + name.length);
            if (/^[\s\u00a0\u200b^⌃⌄▲▼▴▾›»>…·•]*$/.test(tail)) { endsWithLevel = true; break; }
          }
        }
        if (endsWithLevel) {
          var control = typeof el.closest === "function"
            ? el.closest("button, [role='button'], a")
            : null;
          if (control && (control === root || (root.contains && root.contains(control)))) return true;
        }
        el = el.parentElement;
      }
      return false;
    }

    /** 行 + 输入框胶囊两处都可能显示档位名，一起乐观提交。 */
    function paintEffortEverywhere(entry, levels, index) {
      if (!entry) return;
      paintEffortText(entry.row, levels, index);
      paintEffortText(entry.card, levels, index, true);
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
      container.setAttribute("data-effort-bridge", "1");
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

    /** 桥是否真的还在：行没变不算，容器必须仍然挂在这一行上。 */
    function bridgeAlive(entry, row) {
      return !!entry && entry.row === row && !!entry.container
        && entry.container.isConnected === true && entry.container.parentNode === row;
    }

    /**
     * 把轨道容器的可见区域裁到宿主浮层（菜单面板）以内。
     * 形变/粒子可以飞出轨道，但不能飞出整块浮层；用 clip-path 的负 inset
     * 把裁剪框反向扩到浮层边界，容器自身仍在原来的流式位置。
     */
    function clipContainerToLayer(container, row) {
      if (!container || !row || typeof container.getBoundingClientRect !== "function") {
        return function () {};
      }
      var layer = row.closest ? row.closest('[role="menu"], [data-radix-popper-content-wrapper]') : null;
      if (!layer) layer = row.parentElement;
      if (!layer) return function () {};

      var raf = null;
      function sync() {
        raf = null;
        if (!container.isConnected || !layer.isConnected) return;
        var cr = container.getBoundingClientRect();
        var lr = layer.getBoundingClientRect();
        if (!(cr.width > 0) || !(lr.width > 0)) return;
        /* 浮层在容器外侧时这四个值是负数，clip-path 的 inset 负值等于向外扩；
           正好把裁剪框撑到浮层边缘。 */
        var top = lr.top - cr.top;
        var right = cr.right - lr.right;
        var bottom = cr.bottom - lr.bottom;
        var left = lr.left - cr.left;
        container.style.clipPath = "inset("
          + top.toFixed(2) + "px " + right.toFixed(2) + "px "
          + bottom.toFixed(2) + "px " + left.toFixed(2) + "px)";
      }
      function schedule() {
        if (raf === null) raf = window.requestAnimationFrame(sync);
      }

      schedule();
      /* 浮层开合/改宽高时重新量；滚动只改相对屏幕的位置，相对裁剪框不变。 */
      var ro = null;
      if (typeof window.ResizeObserver === "function") {
        ro = new window.ResizeObserver(schedule);
        ro.observe(layer);
        ro.observe(container);
        ro.observe(row);
      }
      window.addEventListener("resize", schedule);
      var settleTimer = window.setTimeout(schedule, 260);
      return function () {
        if (raf !== null) window.cancelAnimationFrame(raf);
        if (settleTimer !== null) window.clearTimeout(settleTimer);
        window.removeEventListener("resize", schedule);
        if (ro) { try { ro.disconnect(); } catch (err) { /* 旧宿主无 */ } }
        if (container.style) container.style.clipPath = "";
      };
    }

    /** 菜单关闭时没有展开的 popup 属正常状态：旧行还在就保留挂载，别拆桥。 */
    function shouldKeepMount(entry, row) {
      return !row && !!entry && !!entry.row && entry.row.isConnected === true;
    }

    function scanOnce() {
      composers.forEach(function (entry, card) {
        try {
          /* 卡片瞬断时只拆容器、不删 entry：真正的卸载由 SlotComponent cleanup 负责。
             以前这里直接 delete，官方把卡片摘下再挂回来时 entry 不会重建 → 轨道永久消失。 */
          if (!card.isConnected) { teardownEntry(entry); return; }
          /* 不能依赖 aria-expanded="true"：选完档菜单关闭时它是 false，
             重新打开时官方可能换掉按钮/菜单节点，MutationObserver 也可能漏掉。
             遍历 card 下所有 popup 触发器（不管展开与否），认准菜单里真有推理等级行的。 */
          var seats = card.querySelectorAll('button[aria-haspopup="menu"]');
          var row = null;
          for (var si = 0; si < seats.length && !row; si += 1) {
            var menuId = seats[si].getAttribute("aria-controls");
            var candidate = menuId ? document.getElementById(menuId) : null;
            var found = findEffortRow(candidate);
            if (found && found.isConnected) row = found;
          }
          if (!row) {
            /* 菜单关闭时没有展开的 popup 是**正常状态**，不是该拆桥的信号。
               以前这里直接 teardown：选完档位菜单一关就把轨道摘掉；
               再打开时如果 composer 节点被官方换过、订阅没重建，轨道就永久没了。
               只要旧行还在 DOM 里就保留挂载，下次打开同一行直接复用。 */
            if (shouldKeepMount(entry, row)) return;
            teardownEntry(entry);
            return;
          }
          /* 当前模型没有声明 reasoning.efforts（或目录正在重建）时，空档位会让
             ConnectedTrack 返回 null：行被我们接管了却什么都不画，看起来就是"轨道消失"。
             这种情况直接不接管，官方行原样显示；等档位回来再挂。 */
          if (levelsOf(entry.access.getSnapshot()).length === 0) { teardownEntry(entry); return; }
          /* 关键：行节点没变 ≠ 我们的容器还在。
             官方那一行是 React 管理的，选完档后它重绘子节点时会把命令式插入的
             .dem-inline 直接删掉。以前这里只看 entry.row === row 就 return，
             于是轨道被删了永远不补 —— 正是"切一次后再点，轨道没了"的根因。 */
          if (bridgeAlive(entry, row)) return;
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

      /* 容器裁到宿主浮层：形变/粒子只能在菜单面板里出现，不能顶到面板外。 */
      React.useEffect(function () {
        return clipContainerToLayer(entry.container, entry.row);
      }, [entry, entry.container, entry.row]);

      /* 档位一变（含拖动落档后宿主回写）就把菜单行右侧那个值重染一遍：
         最高档蓝、其它档恢复官方中性色。 */
      React.useEffect(function () {
        tintEffortText(entry.row, state);
      }, [state, entry]);

      /* 档位从有到无（换到不支持推理的模型、目录重建、会话切换）时，
         组件会返回 null；若不拆桥，官方行被我们改过的样式留着、轨道却没了。 */
      React.useEffect(function () {
        if (levels.length === 0) teardownEntry(entry);
      }, [levels.length, entry]);

      var _draft = React.useState(null);
      var draft = _draft[0];
      var setDraft = _draft[1];
      /* 给 SlotComponent 的胶囊观察器读：等待宿主回写的窗口里，
         颜色必须跟 draft 目标走，不能读尚未更新的 snapshot。 */
      entry.displayIndexRef.current = draft !== null ? draft : (liveIndex >= 0 ? liveIndex : null);

      var _hint = React.useState(null);
      var hint = _hint[0];
      var setHint = _hint[1];

      var pendingRef = React.useRef({ levelId: null, timer: null, inFlight: false, seq: 0, landed: false, effortless: false });
      var deadlineRef = React.useRef(null);
      var flushTimerRef = React.useRef(null);
      var flushIdleRef = React.useRef(null);
      var labelGuardRef = React.useRef(null);

      function cancelPendingPick() {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (flushIdleRef.current !== null) {
          if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(flushIdleRef.current);
          flushIdleRef.current = null;
        }
      }

      /* 宿主真的写进去了 → 丢掉乐观草稿 */
      React.useEffect(function () {
        if (draft === null) return;
        if (liveIndex === draft) setDraft(null);
      }, [liveIndex, draft]);

      /* 乐观字符的"事实同步"：视觉落位那一刻先改字（onLand 里同步做一次，
         这里负责在组件提交后 / 回滚时再校准）。draft 清空 = 宿主已经接上
         真实档位，或写入失败要回滚，都用 liveIndex 重画。 */
      React.useEffect(function () {
        var shown = draft !== null ? draft : liveIndex;
        paintEffortEverywhere(entry, levels, shown);
      }, [draft, liveIndex, levels, entry]);

      /* 官方行 / 输入胶囊可能在等待宿主回写的窗口里被 React 重渲染回旧字符；
         在 draft 未落库前守住目标文字，MutationObserver 的回调在 paint 前跑，
         所以画面不会闪回旧档位。paint 是幂等的，不会自激。 */
      React.useEffect(function () {
        if (draft === null) return undefined;
        if (typeof MutationObserver !== "function") return undefined;
        var target = draft;
        var roots = [];
        if (entry.row) roots.push(entry.row);
        if (entry.card && entry.card !== entry.row) {
          var cardInsideRow = typeof entry.row.contains === "function" && entry.row.contains(entry.card);
          var rowInsideCard = typeof entry.card.contains === "function" && entry.card.contains(entry.row);
          if (cardInsideRow) {
            /* 输入胶囊在官方行内部：只守外层，避免同一段文字被两个观察器重画。 */
          } else if (rowInsideCard) {
            roots = [entry.card];
          } else {
            roots.push(entry.card);
          }
        }
        if (roots.length === 0) return undefined;
        var guards = roots.map(function (root) {
          var guard = new MutationObserver(function (records) {
            /* 卡片里还包含输入框：用户每敲一个字也会触发 characterData。
               只在变更不是来自编辑器时才重画，避免打字时整棵卡片被反复扫。 */
            var relevant = false;
            for (var ri = 0; ri < records.length; ri += 1) {
              if (!textInsideEditor(records[ri].target, root)) { relevant = true; break; }
            }
            if (!relevant) return;
            paintEffortEverywhere(entry, levels, target);
          });
          try {
            guard.observe(root, {
              subtree: true, childList: true, characterData: true,
            });
          } catch (err) {
            return null;
          }
          return guard;
        }).filter(Boolean);
        labelGuardRef.current = guards;
        return function () {
          for (var i = 0; i < guards.length; i += 1) {
            try { guards[i].disconnect(); } catch (err) { /* 旧宿主无 */ }
          }
          if (labelGuardRef.current === guards) labelGuardRef.current = null;
        };
      }, [draft, levels, entry]);

      React.useEffect(function () {
        return function () {
          var pending = pendingRef.current;
          if (pending.timer !== null) window.clearTimeout(pending.timer);
          if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
          /* 浮窗可能在视觉落位 / 空闲写库之前就关掉：卸载时把还没落库的那一档
             立刻写掉，否则用户点完就关，档位会丢。 */
          if (pending.levelId !== null || flushTimerRef.current !== null || flushIdleRef.current !== null) {
            if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
            if (flushIdleRef.current !== null && typeof window.cancelIdleCallback === "function") {
              window.cancelIdleCallback(flushIdleRef.current);
            }
            flushTimerRef.current = null;
            flushIdleRef.current = null;
            pending.landed = true; /* 已关闭：不再等视觉落位，立刻补写 */
            flush();
          }
          if (labelGuardRef.current) {
            var guards = labelGuardRef.current;
            for (var gi = 0; gi < guards.length; gi += 1) {
              try { guards[gi].disconnect(); } catch (err) { /* 旧宿主无 */ }
            }
            labelGuardRef.current = null;
          }
          /* 点亮定时器归 EffortTrack 自己清：它声明在那个组件里，
             在这里引用会抛 ReferenceError（详见 EffortTrack 的清理）。 */
        };
      }, []);

      function flush() {
        var pending = pendingRef.current;
        if (pending.timer !== null) { window.clearTimeout(pending.timer); pending.timer = null; }
        var levelId = pending.levelId;
        if (levelId === null) return;
        /* 视觉还没落位：先别进宿主桥，否则会堵住滑轨还在走的动画。
           卸载补写会显式把 landed 置 true。 */
        if (!pending.landed) return;
        /* 上一笔还没回来：把目标留在 pending，等 Promise 收尾后由 `.then` 再 flush，
           不能先清空——那会把用户在等待期间选的最后一档直接吞掉。 */
        if (pending.inFlight) return;
        var seq = pending.seq;
        pending.levelId = null;

        var snapshot = access.getSnapshot();
        var current = snapshot && snapshot.current;
        if (!current || typeof current.provider !== "string" || typeof current.model !== "string") {
          setDraft(null);
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
        if (result === null) {
          setDraft(null);
          setHint("模型目录不可用");
          return;
        }

        pending.inFlight = true;
        setHint(null);
        if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
        deadlineRef.current = window.setTimeout(function () {
          pending.inFlight = false;
          deadlineRef.current = null;
          if (pending.seq === seq) {
            setDraft(null);
            setHint("写入超时，已回滚");
          }
        }, COMMIT_DEADLINE_MS);

        Promise.resolve(result).then(
          function (outcome) {
            pending.inFlight = false;
            if (deadlineRef.current !== null) { window.clearTimeout(deadlineRef.current); deadlineRef.current = null; }
            /* 这一笔已经被用户更新的一次选择顶掉：不拿旧结果回滚新字符，
               直接把最后一档再写一遍。 */
            if (pending.seq !== seq) {
              if (pending.levelId !== null) flush();
              return;
            }
            if (outcome && outcome.ok === false) {
              /* ── 宿主为什么拒 ──────────────────────────────────────────
                 宿主 dsh-schedule 的 resolveCallWithInfo() 只有一种情况会拒档位：
                   · 模型没有 reasoning 能力，却带了 reasoningEffort
                   · 或该 id 不在这个模型**适配器**声明的 efforts 里
                 两种都抛 UNSUPPORTED_REASONING_EFFORT，消息形如
                   provider "x" model "y" does not support reasoning effort "off"
                 也就是说：目录里能列出的档位，适配器不一定认。
                 碰到这一条不再干等失败——退回"只切模型、不指定档位"再写一次，
                 档位由模型自己的 defaultEffort 决定，会话至少不会卡在旧模型上。 */
              var failureText = String(
                (outcome.error && (outcome.error.message || outcome.error.code)) || "",
              );
              var effortRejected = /does not support reasoning effort/i.test(failureText)
                || /UNSUPPORTED_REASONING_EFFORT/.test(failureText);
              if (effortRejected && !pending.effortless) {
                pending.effortless = true;
                pending.inFlight = true; /* 兜底写也是一笔宿主写，别让新档位插进来抢 */
                var plain = null;
                try {
                  plain = access.select({ provider: current.provider, model: current.model });
                } catch (err2) {
                  plain = Promise.reject(err2);
                }
                if (plain === null) {
                  pending.inFlight = false;
                  if (pending.seq === seq) {
                    pending.effortless = false;
                    setDraft(null);
                    setHint(failureText || "这一档没有写入成功");
                  } else if (pending.levelId !== null) {
                    flush();
                  }
                  return;
                }
                Promise.resolve(plain).then(
                  function (again) {
                    pending.inFlight = false;
                    pending.effortless = false;
                    if (pending.seq !== seq) {
                      if (pending.levelId !== null) flush();
                      return;
                    }
                    if (again && again.ok === false) {
                      setDraft(null);
                      setHint(failureText || "这一档没有写入成功");
                      return;
                    }
                    setDraft(null);
                    setHint("该模型不支持这个档位，已按默认档位切换");
                  },
                  function (err2) {
                    pending.inFlight = false;
                    pending.effortless = false;
                    if (pending.seq !== seq) {
                      if (pending.levelId !== null) flush();
                      return;
                    }
                    setDraft(null);
                    setHint(String(err2 && err2.message ? err2.message : err2));
                  },
                );
                return;
              }
              pending.effortless = false;
              setDraft(null);
              setHint(failureText || "这一档没有写入成功");
            }
          },
          function (err) {
            pending.inFlight = false;
            if (deadlineRef.current !== null) { window.clearTimeout(deadlineRef.current); deadlineRef.current = null; }
            if (pending.seq !== seq) return; /* 新选择已经顶掉旧结果，交给末尾的 flush */
            setDraft(null);
            setHint(String(err && err.message ? err.message : err));
          },
        ).then(function () {
          if (pendingRef.current.levelId !== null) flush();
        });
      }

      /**
       * 无感引擎的宿主提交段：视觉落位 + 文字改完后，先让出两帧保证 paint，
       * 再等渲染线程空闲才执行 `access.select`。同步桥仍会阻塞，但它已经
       * 不在滑轨动画 / 文字切换的关键帧上，用户看不到掉帧或文字滞后。
       */
      function scheduleSilentCommit() {
        if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
        if (flushIdleRef.current !== null && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(flushIdleRef.current);
          flushIdleRef.current = null;
        }
        flushTimerRef.current = window.setTimeout(function () {
          flushTimerRef.current = null;
          var commit = function () {
            flushIdleRef.current = null;
            flush();
          };
          if (typeof window.requestIdleCallback === "function") {
            flushIdleRef.current = window.requestIdleCallback(commit, { timeout: 900 });
          } else {
            commit();
          }
        }, SILENT_COMMIT_GUARD_MS);
      }

      /**
       * 视觉落位：滑块到目标的那一帧，官方行 / 输入胶囊的档位字符
       * 和最高档染色一起切到目标，然后再把宿主写入排进空闲窗口。
       */
      function onLand(index) {
        if (levels.length === 0) return;
        var level = levels[Math.max(0, Math.min(levels.length - 1, index))];
        if (!level) return;
        var pending = pendingRef.current;
        if (pending.levelId !== level.id) return; /* 已被更新的一次选择顶掉 */
        pending.landed = true;
        entry.displayIndexRef.current = index;
        paintEffortEverywhere(entry, levels, index);
        setDraft(index);
        scheduleSilentCommit();
      }

      function onPick(index) {
        if (levels.length === 0) return;
        var level = levels[Math.max(0, Math.min(levels.length - 1, index))];
        if (!level) return;
        /* 新选择顶掉上一次未落库的窗口：只保留最后一次目标。
           这里不 setDraft、不写宿主；等轨道真的滑到位再统一做视觉提交。 */
        cancelPendingPick();
        pendingRef.current.levelId = level.id;
        pendingRef.current.seq += 1;
        pendingRef.current.landed = false;
        pendingRef.current.effortless = false;
      }

      if (levels.length === 0) return null;

      /* 目录快照未就绪时，先读官方行里的当前档位名；它通常比快照更早可用。
         两者都没有才隐藏轨道，等快照回来，绝不先画在 0 档。 */
      var rowIndex = rowEffortIndex(entry.row, levels);
      var seedIndex = liveIndex >= 0 ? liveIndex : rowIndex;
      var indexReady = draft !== null || seedIndex >= 0;
      var displayIndex = draft !== null ? draft : (seedIndex >= 0 ? seedIndex : 0);

      return React.createElement(EffortTrack, {
        levels: levels,
        index: displayIndex,
        indexReady: indexReady,
        onPick: onPick,
        onLand: onLand,
        onCancelPick: cancelPendingPick,
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
      /* 宿主偶尔会把 sessionId 短暂传空（选完档、会话重绑定时）。
         如果直接用 null 当依赖，effect 会清理掉桥并且不再重建 —— 轨道就永久没了。
         这里记住最后一个有效值：短暂空值不会拆桥。 */
      var sessionRef = React.useRef(null);
      if (typeof props.sessionId === "string" && props.sessionId.length > 0) {
        sessionRef.current = props.sessionId;
      }
      var sessionId = sessionRef.current;

      React.useEffect(function () {
        var el = anchorRef.current;
        if (!el || ctx === undefined || sessionId === null) return undefined;
        var card = typeof el.closest === "function" ? el.closest("[data-composer-card]") : null;
        if (!card) return undefined;
        var entry = {
          sessionId: sessionId,
          access: createAccess(ctx, sessionId),
          card: card,
          row: null,
          container: null,
          prevStyle: null,
          setContainer: setContainer,
          /* 当前应染蓝的档位索引；由 ConnectedTrack 在每次渲染 / 落位时更新。 */
          displayIndexRef: { current: null },
        };
        entryRef.current = entry;
        composers.set(card, entry);
        startBridge();
        scheduleScan();
        var selfHealTimer = window.setInterval(scheduleScan, 350);

        /* 官方胶囊把档位显示成灰白（`DeepSeek-V4.1-Flash Max` 里的 Max），深色卡上
           读不出"当前强度"。这里只给**档位名那一段文本**上品牌蓝：靠 TextWalker
           精确匹配 access 里声明的档位名，模型名和其它文字一律不动。
           节流 160ms，观察根就是本组件所属的 composer 卡片，不是整个 body。 */
        var tintTimer = null;
        var tintQueued = false;
        function paintEffortName() {
          tintQueued = false;
          /* 输入框胶囊里的档位名（`DeepSeek-V4.1-Flash Max` 的 Max）走同一套规则：
             只有当前生效档位是最高档才染蓝，其它档恢复官方中性色。
             等待宿主回写的窗口里读 displayIndexRef，不能读尚未更新的 snapshot，
             否则会把刚落位的蓝先擦回灰。 */
          var snap = entry.access.getSnapshot();
          var idx = entry.displayIndexRef.current;
          tintEffortText(card, snap, typeof idx === "number" ? idx : undefined);
        }
        function queueTint(records) {
          if (records && records.length) {
            /* 输入框里每敲一个字也会触发 characterData：这些变更不重染，
               否则整张 composer 卡会被反复扫描。 */
            var relevant = false;
            for (var ri = 0; ri < records.length; ri += 1) {
              if (!textInsideEditor(records[ri].target, card)) { relevant = true; break; }
            }
            if (!relevant) return;
          }
          if (tintTimer !== null) {
            window.clearTimeout(tintTimer);
            tintTimer = null;
          }
          /* 先同步重染，赶在浏览器下一帧绘制前；再用 160ms 做一次兜底，
             防宿主二段提交又把样式冲掉。 */
          paintEffortName();
          tintQueued = true;
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
          if (selfHealTimer !== null) window.clearInterval(selfHealTimer);
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
      { value: 30, label: "30" },
      { value: 34, label: "34" },
    ];
    var KNOB_FILL_OPTIONS = [
      { value: "white", label: "白瓷" },
      { value: "tinted", label: "染色" },
      { value: "accent", label: "强调色" },
      { value: "frosted", label: "磨砂" },
    ];

    /* 详情页预览用一条真正可拖的三档轨道，而不是静态示意图：
       用户改任何一个外观项，都能在这一小块里立刻看见。 */
    var PREVIEW_LEVELS = [
      { id: "preview-off", name: "Off" },
      { id: "preview-medium", name: "Medium" },
      { id: "preview-max", name: "Max" },
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

    /** 详情页的实体开关：`role="switch"` + 空格 / 回车都可切。 */
    function switchControl(key, checked, onChange, label) {
      return React.createElement("button", {
        key: key,
        type: "button",
        role: "switch",
        "aria-checked": checked ? "true" : "false",
        "aria-label": label || key,
        className: "dem-cfg-switch",
        "data-on": checked ? "1" : "0",
        onClick: function () { onChange(!checked); },
      });
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
        + " · " + burstName + " " + current.burstIntensity.toFixed(1) + "×"
        + (current.dragMotion ? "" : " · 动效关")
        + (current.glassMaterial ? "" : " · 玻璃关");
    }

    /**
     * 挂在 `plugins.bundle.config` 上，key = 包名。
     * `view: "summary"` 是插件卡片上那一行摘要，`view: "page"` 是详情页里的表单。
     */
    function ConfigSection(props) {
      var view = props && props.view === "summary" ? "summary" : "page";
      var current = React.useSyncExternalStore(subscribeSettings, getSettings, getSettings);
      /* 详情页预览是一条真正可拖的三档轨道：
         位置状态放在这里，拖动 / 点击后能继续停在用户选的那一档；
         另外两个 nonce 只负责“重播”——切样式 / 点播放 / 开形变时演示一遍。 */
      var previewIndexPair = React.useState(PREVIEW_LEVELS.length - 1);
      var previewIndex = previewIndexPair[0];
      var setPreviewIndex = previewIndexPair[1];
      var previewBurstPair = React.useState(0);
      var previewBurstNonce = previewBurstPair[0];
      var setPreviewBurstNonce = previewBurstPair[1];
      var previewDemoPair = React.useState(0);
      var previewDemoNonce = previewDemoPair[0];
      var setPreviewDemoNonce = previewDemoPair[1];
      /* 预览专属的“当前目标”记录：只用于丢弃迟到的落位回调。
         对话轨道不读它，也不受它影响。 */
      var previewTargetRef = React.useRef(null);

      if (view === "summary") return React.createElement(React.Fragment, null, summaryLine(current));

      /* 只重放点亮；"播放"按钮额外重放一次形变。切轨道 / 切点亮样式时
         不强行拉轨道，避免用户只改颜色就被形变打扰。 */
      var firePreview = function () { setPreviewBurstNonce(function (v) { return v + 1; }); };
      var playPreview = function () {
        firePreview();
        if (current.dragMotion) setPreviewDemoNonce(function (v) { return v + 1; });
      };

      var tintRgb = current.tintMode === "custom" ? current.tintColor : current.accent;

      var isCodexStyle = current.railStyle === "codex";

      var rows = [
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "rail" },
          React.createElement("div", { className: "dem-cfg-label" }, "轨道风格"),
          segment("rail-seg", [
            { value: "mosaic", label: "马赛克" },
            { value: "codex", label: "霓虹" },
          ], current.railStyle, function (style) {
            updateSettings({ railStyle: style });
            firePreview();
          }),
          React.createElement("span", { className: "dem-cfg-value" },
            isCodexStyle ? "粒子越界不可用" : "含粒子越界"),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "motion" },
          React.createElement("div", { className: "dem-cfg-label" }, "拖拽动效"),
          switchControl("motion-switch", current.dragMotion, function (on) {
            updateSettings({ dragMotion: on });
            /* 开启的瞬间先自己拉一下，不然静态预览里看不出开关到底改了什么。 */
            if (on) setPreviewDemoNonce(function (v) { return v + 1; });
          }, "拖拽动效"),
          React.createElement("span", { className: "dem-cfg-value" },
            current.dragMotion ? "弹性形变" : "已关闭"),
        ),
        React.createElement(
          "div",
          { className: "dem-cfg-row", key: "glass" },
          React.createElement("div", { className: "dem-cfg-label" }, "玻璃材质"),
          switchControl("glass-switch", current.glassMaterial, function (on) {
            updateSettings({ glassMaterial: on });
          }, "玻璃材质"),
          React.createElement("span", { className: "dem-cfg-value" },
            current.glassMaterial ? "液态玻璃" : "扁平轨道"),
        ),
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
        isCodexStyle ? null : React.createElement(
          "div",
          { className: "dem-cfg-row", key: "scatter" },
          React.createElement("div", { className: "dem-cfg-label" }, "粒子越界"),
          segment("scatter-seg", [
            { value: "off", label: "关" },
            { value: "top", label: "最高档" },
            { value: "all", label: "全档位" },
          ], current.scatterMode, function (mode) {
            updateSettings({ scatterMode: mode });
            /* 越界模式只在对应档位可见：选「全档位」把预览放到 Medium，选
               「最高档」放回 Max，让用户当场看见这次改动的差别，而不是只读标签。 */
            if (mode === "all") setPreviewIndex(PREVIEW_LEVELS.length - 2);
            if (mode === "top") setPreviewIndex(PREVIEW_LEVELS.length - 1);
          }),
          React.createElement("span", { className: "dem-cfg-value" },
            current.scatterMode === "off" ? "轨内" : current.scatterMode === "top" ? "仅 Max" : "常开"),
        ),
        /* 越界动画：四套完整动效，不是同一套改参数。 */
        !isCodexStyle && current.scatterMode !== "off" ? React.createElement(
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
        !isCodexStyle && current.scatterMode !== "off" ? React.createElement(
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

      var previewLevel = PREVIEW_LEVELS[Math.max(0, Math.min(PREVIEW_LEVELS.length - 1, previewIndex))];
      var previewHot = previewIndex >= PREVIEW_LEVELS.length - 1;
      var previewBurstName = current.burstStyle === "scan" ? "扫描线"
        : current.burstStyle === "shatter" ? "爆散"
          : current.burstStyle === "pulse" ? "呼吸" : "能量波";
      var previewScatterName = current.scatterStyle === "drift" ? "飘散"
        : current.scatterStyle === "fall" ? "坠落"
          : current.scatterStyle === "tide" ? "潮汐" : "飞沫";
      var previewScatterLabel = isCodexStyle ? "粒子 · 霓虹无越界"
        : current.scatterMode === "off" ? "越界 · 轨内"
          : (current.scatterMode === "top" ? "越界 · 仅 Max" : "越界 · 全档位")
            + " / " + previewScatterName + " " + current.scatterAmount.toFixed(1) + "×";

      var previewTags = [
        React.createElement("span", {
          className: "dem-cfg-preview-tag",
          key: "motion",
          "data-on": current.dragMotion ? "1" : "0",
        }, current.dragMotion ? "形变 · 开" : "形变 · 关"),
        React.createElement("span", {
          className: "dem-cfg-preview-tag",
          key: "glass",
          "data-on": current.glassMaterial ? "1" : "0",
        }, current.glassMaterial ? "玻璃 · 液态" : "玻璃 · 扁平"),
        React.createElement("span", {
          className: "dem-cfg-preview-tag",
          key: "scatter",
          "data-on": !isCodexStyle && current.scatterMode !== "off" ? "1" : "0",
        }, previewScatterLabel),
        React.createElement("span", {
          className: "dem-cfg-preview-tag",
          key: "burst",
          "data-on": "1",
        }, "点亮 · " + previewBurstName + " " + current.burstIntensity.toFixed(1)
          + "× / 速 " + current.burstSpeed.toFixed(1) + "×"),
        React.createElement("span", {
          className: "dem-cfg-preview-tag",
          key: "tint",
          "data-on": "1",
        }, current.tintMode === "custom" ? "字符 · 自定义" : "字符 · 跟强调色"),
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
            { className: "dem-cfg-preview-head" },
            React.createElement("span", { className: "dem-cfg-preview-kicker" }, "实时预览"),
            React.createElement("span", { className: "dem-cfg-preview-hint" }, "可拖动 · 改完即时生效"),
          ),
          /* 预览不是静态截图：直接挂一条真正的三档轨道。拖动 / 点击它，
             形变、玻璃、越界、点亮、强调色、滑块几何全部走正式轨道同一套代码。 */
          React.createElement(
            "div",
            { className: "dem-cfg-preview-stage" },
            React.createElement(EffortTrack, {
              levels: PREVIEW_LEVELS,
              index: previewIndex,
              indexReady: true,
              /* 只记录目标，不改字；字仍然等落位再切。 */
              onPick: function (next) { previewTargetRef.current = next; },
              onLand: function (next) {
                if (previewTargetRef.current !== null && next !== previewTargetRef.current) return;
                setPreviewIndex(next);
              },
              onCancelPick: function () {},
              hint: null,
              landMs: PREVIEW_LAND_MS,
              /* 预览粒子轨的边缘按滑块内缘连续裁切；不传这条的正式轨道不变。 */
              softParticleEdge: true,
              demoNonce: previewDemoNonce,
              burstNonce: previewBurstNonce,
            }),
          ),
          React.createElement(
            "div",
            { className: "dem-cfg-preview-caption" },
            React.createElement("span", { className: "dem-cfg-preview-label" }, "推理等级"),
            React.createElement("span", {
              className: "dem-cfg-preview-value",
              "data-hot": previewHot ? "1" : "0",
              style: previewHot ? { color: tintColorOf(current) } : null,
            }, previewLevel ? previewLevel.name : ""),
          ),
          React.createElement("div", { className: "dem-cfg-preview-tags" }, previewTags),
          React.createElement(
            "div",
            { className: "dem-cfg-preview-bar" },
            React.createElement("span", { className: "dem-cfg-note" }, "拖动试形变 / 越界 · 播放一次点亮"),
            React.createElement("button", {
              type: "button",
              className: "dem-cfg-play",
              onClick: playPreview,
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
        try { console.error("[" + PACKAGE_ID + "] 插槽注册失败，控件不会出现：", err); } catch (e) { /* 忽略 */ }
      }
      /* 插件详情页里的自定义版式面板。
         `plugins.bundle.config` 是**按 npm 包名**索引的（宿主原话：以组合包的包名为键）。
         包名与仓库名已统一为 `dsh-effort-mosaic`，但改名过渡期发过 `dsh-effortmosaic`，
         那批用户的 profile link 键仍是旧名。两个键各注册一份：
         宿主只渲染与当前组合包键匹配的那一份，不会出现两个面板。 */
      var CONFIG_KEYS = [PACKAGE_ID];
      if (PACKAGE_ID !== LEGACY_PACKAGE_ID) CONFIG_KEYS.push(LEGACY_PACKAGE_ID);
      CONFIG_KEYS.forEach(function (configKey) {
        try {
          ctx.slots.inject("plugins.bundle.config", function () {
            return ctx.slots.register(
              { name: "plugins.bundle.config", key: configKey },
              function ConfigSlot(props) {
                return React.createElement(ConfigSection, Object.assign({}, props));
              },
            );
          });
        } catch (err) {
          try {
            console.error("[" + PACKAGE_ID + "] 版式面板注册失败（key=" + configKey + "）：", err);
          } catch (e) { /* 忽略 */ }
        }
      });
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    /* 离线测试接缝：纯函数。只在测试进程显式打开 __DEM_TEST_HOOK__ 时挂出，
       正式 bundle 里不出现这张表 —— 生产环境没有测试接口，也少一段导出。 */
    if (typeof globalThis === "object" && globalThis.__DEM_TEST_HOOK__ === true) {
      exports.__internals = {
        levelsOf: levelsOf,
        effectiveEffortId: effectiveEffortId,
        pctOfIndex: pctOfIndex,
        indexOfPct: indexOfPct,
        ampOf: ampOf,
        cellColor: cellColor,
        findEffortRow: findEffortRow,
        shouldKeepMount: shouldKeepMount,
        bridgeAlive: bridgeAlive,
        CSS: CSS,
        CELL: CELL,
        /* 自定义版式（配色派生 + 存取），离线可断言。 */
        neonGradientOf: neonGradientOf,
        neonBurstVarsOf: neonBurstVarsOf,
        normalizeSettings: normalizeSettings,
        paletteOf: paletteOf,
        scatterPose: scatterPose,
        scatterLocal: scatterLocal,
        SCATTER_STYLES: SCATTER_STYLES,
        SCATTER_DEAD: SCATTER_DEAD,
        settleAt: settleAt,
        SETTLE_OMEGA: SETTLE_OMEGA,
        TAP_SLOP: TAP_SLOP,
        knobWidthOf: knobWidthOf,
        knobRadiusOf: knobRadiusOf,
        fillTailRadiusOf: fillTailRadiusOf,
        knobBorderWidthOf: knobBorderWidthOf,
        bandHeightOf: bandHeightOf,
        knobSurfaceOf: knobSurfaceOf,
        knobSheenOf: knobSheenOf,
        knobRingOf: knobRingOf,
        SHAPES: SHAPES,
        FILLS: FILLS,
        BURST_STYLES: BURST_STYLES,
        getSettings: getSettings,
        updateSettings: updateSettings,
        resetSettings: resetSettings,
        tintColorOf: tintColorOf,
        paintEffortText: paintEffortText,
      };
    }

    return module.exports;
  },
});
