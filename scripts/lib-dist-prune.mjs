// dist/ 清理：Vite 会把整个 public/ 目录原样拷进 dist/，
// 于是 .gitignore 里那些「本机调试用」的探针页面（public/bfcheck.html、public/bftest.html、
// public/tmp-*.png）也跟着进了构建产物，上传到网站根目录后能被公网直接访问。
//
// 这里在 dist/ 生成之后、进 zip 之前把它们删掉；文件本身留在 public/ 继续用于本地调试。
// 以后新增调试页面时，除了写进 .gitignore，也要把文件名加到下面的清单里。
//
// 删除一律走 unlinkSync，不用 fs.rmSync —— 同 lib-copy.mjs 里的说明：
// Windows + Node 24 上 rmSync 会「不报错但也不删除」，静默失败会让调试页照样被打进部署包。
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

/** 只匹配 dist 顶层的文件名：这些调试页都直接放在 public/ 根目录下 */
export const DEBUG_ARTIFACT_PATTERNS = [
  /^bfcheck\.html$/,
  /^bftest\.html$/,
  /^tmp-.*\.png$/,
]

/**
 * 删除 dist 顶层的调试产物，返回被删掉的文件名数组。
 * 只删普通文件、不递归、不碰目录，避免误伤正常产物。
 *
 * 删完会逐个复查：只要还有残留就直接抛错，宁可打包失败，
 * 也不产出「看起来正常、实际带着本机调试页」的部署包。
 */
export function pruneDebugArtifacts(distDir, log = console.log) {
  if (!existsSync(distDir)) return []
  const removed = []
  const failed = []
  for (const name of readdirSync(distDir)) {
    if (!DEBUG_ARTIFACT_PATTERNS.some((re) => re.test(name))) continue
    const full = join(distDir, name)
    if (!statSync(full).isFile()) continue
    try {
      unlinkSync(full)
    } catch { /* 下面复查时统一处理 */ }
    if (existsSync(full)) failed.push(name)
    else removed.push(name)
  }
  if (failed.length > 0) {
    throw new Error(
      `[prune-dist] 从 dist/ 删除调试文件失败：${failed.join('、')}\n` +
      `  这些文件会被打进前端部署包，已中止。请手动删除 ${join(distDir, failed[0])} 后重试。`,
    )
  }
  if (removed.length > 0) {
    log(`[prune-dist] 已从 dist/ 剔除本机调试文件：${removed.join('、')}`)
  }
  return removed
}
