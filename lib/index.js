/**
 * dsh-effort-mosaic — 宿主半边（空逻辑）
 *
 * 全部功能在客户端半边（`lib/client.js`）。宿主条目只负责让 Loader 扫到这个包，
 * 从而把客户端 bundle 编进启动图；这里不注册服务、不读文件、不打日志。
 *
 * @module dsh-effort-mosaic
 */

/**
 * 宿主插件体。Loader 会传入 cordis 上下文；本插件不使用任何宿主能力。
 */
export function apply() {}
