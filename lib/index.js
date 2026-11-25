/**
 * dsh-effort-mosaic — 宿主半边（版式设置的跨上下文通道）
 *
 * 客户端（`lib/client.js`）负责绘制与交互；这里只加一条很小的 HTTP 路由：
 *
 *   GET  /effort-mosaic/settings   → 当前这份版式设置（JSON）
 *   POST /effort-mosaic/settings   → 合并一份补丁（JSON），返回合并后的整份
 *
 * 为什么需要它：对话里的轨道和「插件详情页」里的配置面板不是同一个运行时上下文，
 * 它们连 localStorage 都不共享 —— 面板里改成「圆形」只会落在面板自己那份存储里，
 * 轨道读到的永远是空，于是永远按默认形状画。两边都唯一能共同访问的是宿主进程，
 * 所以设置以宿主内存 + 这条路由作为共同事实：面板 POST，轨道 GET。
 *
 * 落盘到插件目录旁的 `.settings.json`，重启后第一帧就能读到上次那份；
 * 持久化仍只碰这一份小文件，不写用户的全局配置。
 *
 * @module dsh-effort-mosaic
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 版式设置的字段白名单 —— 与 `lib/client.js` 的 `HOST_FIELDS` 保持一致。 */
const FIELDS = [
  "railStyle", "dragMotion", "glassMaterial", "accent", "tintMode", "tintColor",
  "knobShape", "knobSize", "knobFill", "burstIntensity", "burstSpeed", "burstStyle",
  "scatterMode", "scatterAmount", "scatterStyle",
];

/** 路由路径。 */
const SETTINGS_PATH = "/effort-mosaic/settings";

/**
 * 落盘位置：跟插件包放在一起的 `.settings.json`（单一小文件，不进用户的配置文件）。
 * 这样重启之后宿主一开始就能给出上次那份设置，不必等某个上下文来"喂"它。
 */
const SETTINGS_FILE = fileURLToPath(new URL("./.settings.json", import.meta.url));

/** 宿主内存里的那份设置（null = 还没有人写过）。 */
let shared = load();

function load() {
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function save(value) {
  const text = JSON.stringify(value);
  /* 先写临时文件再 rename：进程在写的中途退出时，不会留下半截 JSON。
     Windows 上 rename 覆盖目标可能被占用，失败就退回直接写。 */
  try {
    const temporary = SETTINGS_FILE + ".tmp";
    writeFileSync(temporary, text);
    renameSync(temporary, SETTINGS_FILE);
  } catch {
    try { writeFileSync(SETTINGS_FILE, text); } catch { /* 没权限：内存态继续生效 */ }
  }
}

/** 只保留白名单字段。 */
function pick(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const key of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

/**
 * 读完请求体（限制大小，避免一条坏请求把宿主拖住）。
 * 超限时立刻丢掉后续数据并返回 null，调用方据此回 413；
 * 不把半截请求体当成合法 JSON 继续解析。
 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    let tooLarge = false;
    let done = false;
    const chunks = [];
    function finish(value) {
      if (done) return;
      done = true;
      resolve(value);
    }
    req.on("data", (chunk) => {
      if (tooLarge || done) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => finish(null));
    req.on("aborted", () => finish(null));
  });
}

function sendJson(res, status, value) {
  try {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(value));
  } catch {
    /* 连接已断：忽略 */
  }
}

/**
 * 插件体：注册那条路由。
 *
 * @param ctx - cordis 上下文。
 */
export function apply(ctx) {
  try {
    if (!ctx || typeof ctx.inject !== "function") return;
    ctx.inject(["webServer"], (child) => {
      child.effect(() => child.webServer.register({
        kind: "exact",
        path: SETTINGS_PATH,
        handler: async (req, res) => {
          if (req.method === "GET") {
            sendJson(res, 200, shared || {});
            return;
          }
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("allow", "GET, POST");
            res.end();
            return;
          }
          const raw = await readBody(req);
          if (raw === null) {
            sendJson(res, 413, { error: "request body too large" });
            return;
          }
          let parsed = null;
          try {
            parsed = JSON.parse(raw || "{}");
          } catch {
            sendJson(res, 400, { error: "invalid json" });
            return;
          }
          const patch = pick(parsed);
          shared = Object.assign({}, shared || {}, patch);
          save(shared);
          sendJson(res, 200, shared);
        },
      }));
    });
  } catch {
    /* 没有 webServer 的组合：客户端退回 localStorage，插件照常工作 */
  }
}
