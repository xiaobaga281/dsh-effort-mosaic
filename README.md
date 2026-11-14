# dsh-effort-mosaic

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/xiaobaga281/dsh-effort-mosaic@main/docs/hero.png" alt="一条像素马赛克粒子滑轨：右端是静止的墙，向左逐渐散开" width="100%">
</p>

<p align="center">
  <a href="https://github.com/xiaobaga281/dsh-effort-mosaic/releases/latest"><img src="https://img.shields.io/github/v/release/xiaobaga281/dsh-effort-mosaic?color=4a84ff&label=release" alt="release"></a>
  <a href="https://github.com/xiaobaga281/dsh-effort-mosaic/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xiaobaga281/dsh-effort-mosaic?color=4a84ff" alt="license"></a>
  <img src="https://img.shields.io/badge/platform-DSH%20Desktop-4a84ff" alt="platform">
  <img src="https://img.shields.io/badge/dependencies-0-4a84ff" alt="zero dependencies">
</p>

<p align="center">接管 DSH 模型菜单里的「推理等级」那一行，换成一条<b>像素马赛克粒子滑轨</b>。</p>

右侧贴着滑块的那一段是严丝合缝的静止墙；越往左，方块越早脱离网格，向左漂、上下散、逐渐淡出；档位越高跑得越快，到最高档点亮一次。

- **看得见强度** —— 一条连续轨道比 Off / Low / High / Max 四个字直观
- **手感连续** —— 拖动跟手不跳档；松手按临界阻尼收口；点击只判最近档位，不先跳到指针
- **最高档有代价感** —— 默认只有开满时粒子才飞出轨道，四套越界动画
- **可调到底** —— 5 种滑块 × 3 档尺寸 × 4 种填充，颜色与幅度都能改

档位表不写死：跟随当前模型在 `reasoning.efforts` 里声明的档位；模型没声明就不接管这一行（fail-open）。最高档时，输入框胶囊里的档位名会染成品牌蓝。

## 安装

```sh
dsh plugin --profile web add dsh-effortmosaic
```

桌面端：设置 → 插件 → 添加插件，填 `dsh-effortmosaic`，或仓库地址 `https://github.com/xiaobaga281/dsh-effort-mosaic`。

也可以从 GitHub 装（无构建步骤，内容与 npm 一致）：

```sh
dsh plugin --profile web add "github:xiaobaga281/dsh-effort-mosaic"
```

> 包名是 `dsh-effortmosaic`，仓库名是 `dsh-effort-mosaic` —— 只差一个连字符（历史原因，两者是同一个插件）。带两个连字符的 npm 包名已被占用且不可用，**别填它**。

**卸载**：`dsh plugin --profile web remove dsh-effortmosaic`；桌面端在插件页里卸载。

**要求**：DSH Desktop `0.2.1-rc.3` 及以上，Node `>= 22`（仅测试用）。零运行时依赖、无构建步骤；改过 `lib/client.js` 需**整进程重启**才生效。

## 交互

| 操作 | 行为 |
|---|---|
| 按住拖动 | 连续跟手（横向超过 5px 才算拖动，之前滑块一像素不动） |
| 松手 | 吸附到最近档位，约 0.25s，初速接住指尖的势头 |
| 点击轨道 | 判定离指针最近的档位，从当前位置柔和滑过去（约 0.34s，不经过指针） |
| `←` `→` `↑` `↓` / `Home` `End` | 相邻档位 / 首尾档，同样走吸附动画 |

拖动只改本地显示位置，松手那一下才写回官方设置（120ms 节流，失败自动回滚）。切到最高档时，点亮动画等滑块滑到位再播。

## 视觉

一条 30px 高的胶囊凹槽，自下而上叠四层：填充渐变 → 6 行 × 5px 粒子 → 刻度 → 滑块。填充、粒子、凹槽共用同一条轮廓：右端按滑块内缘收口，带高跟随滑块（`min(30, 滑块高)`），缩到 28px 也不会在接缝处露出蓝边。

粒子按离滑块的距离决定散开程度：右侧 2% 是严格贴网格的墙，往左 `amp` 增大、漂移与抖动随之变大，最左端几乎全部脱离。颜色取自同一条渐变色阶 × 明度系数（0.80–1.06），砖缝从浅蓝到纯蓝都看得清。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/xiaobaga281/dsh-effort-mosaic@main/docs/shapes.png" alt="五种滑块：圆 / 环 / 方形 / 胶囊 / 细棒" width="100%">
</p>

**四种点亮动画**（最高档触发）：能量波 / 扫描线 / 爆散 / 呼吸，都带一次粒子瞬时提速。
**四套越界动画**（默认仅最高档）：飞沫 / 飘散 / 坠落 / 潮汐 —— 右 1/5 是死区，越往左逃逸比例越高、飞得越远。

## 自定义版式

插件详情页里有一块面板，改任何一项即时生效（顶部缩略轨道会跟着变，旁边可「播放」一遍点亮）。

| 项 | 取值 | 默认 |
|---|---|---|
| 滑轨强调色 | 6 个预设 + 任意 hex | `#4A84FF` |
| 最高档字符 | 跟随强调色 / 自定义 | 跟随强调色 |
| 滑块形状 | 圆 / 环 / 方 / 胶囊 / 细棒 | 圆 |
| 滑块大小 | 28 / 30 / 34 px | 30 |
| 滑块填充 | 白瓷 / 染色 / 强调色 / 磨砂 | 白瓷 |
| 点亮样式 | 能量波 / 扫描线 / 爆散 / 呼吸 | 能量波 |
| 点亮强度 | 0.4 – 1.8× | 1.0× |
| 点亮速度 | 0.6 – 1.4× | 1.0× |
| 粒子越界 | 关 / 仅最高档 / 全档位 | 仅最高档 |
| 越界动画 | 飞沫 / 飘散 / 坠落 / 潮汐 | 飞沫 |
| 越界幅度 | 0.4 – 2.4× | 1.6× |

整套配色由强调色派生（填充渐变、粒子、光晕同源），不会出现"轨道变了、粒子还是旧蓝"。设置留在 `localStorage` 的 `dsh-effort-mosaic:settings:v1`，面板底部可一键恢复默认。

## 实现要点

改动前值得知道的几条约束（都是踩过坑的地方）：

1. **右端收口不能用 `clip-path`** —— 它只有轴对齐四条边，半圆端帽会露方角。用 `TAIL_MASK` + `mask-clip: no-clip`；否则 mask 默认的 `border-box` 会把飞出轨道的方块整片裁掉。
2. **吸附是临界阻尼闭式解**：拖动松手 ω=22（带指针初速），点击落档 ω=18（初速 0）。收尾时间取 `9.5/ω`，写死上限会在末尾剩几个像素硬跳。
3. **点亮等落位**：`shownIndex` 是乐观档位，松手瞬间就变；动画必须由 `beginSettle` 在滑块进入目标 1% 时才播，否则光先铺完、滑块才到。
4. **墙区的格子首帧也要写 `transform`**（`c.placed`），否则天生就在墙区的那几列永久停在轨道 `(0,0)`，看着像"多了一颗不动的蓝方块"。
5. **写 DOM 前对 `x / y / scale / op` 做有限性兜底**：任何一个 `NaN` 都会让浏览器丢弃整条 `transform`。
6. **越界强度是阻尼值**，每帧朝目标指数逼近（进 τ=0.24s / 退 τ=0.17s）；换成"线性进度 + 缓动"会在退档末尾先呆住再急收。

## 开发

```sh
node test/smoke.mjs        # 131 项离线断言（桩件里真跑 bundle）
node tools/make-promo.mjs  # 重新生成 docs/ 下两张宣传图（真实 CSS 渲染）
```

```
lib/client.js        全部实现（CJS closure bundle，无构建步骤）
lib/index.js         宿主侧：零逻辑，只做产物审计
cordis.patch.yml     host 图里插入这一行（`- insert: - id: effort-mosaic`）
docs/*.png           README 宣传图
tools/make-promo.mjs 宣传图生成器
test/smoke.mjs       冒烟测试，不进 npm 包
```

## 兼容性

同一个「推理等级」行只能有一个接管者。本插件会替换该行的内容，请勿与其他同类滑轨插件同时启用。

## 许可

MIT
