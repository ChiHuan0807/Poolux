// APK 版本保留策略：每个模板只留最近若干个「已就绪」的版本，更早的连同磁盘产物一起删掉。
//
// 为什么单独成一个模块：删除是会真删文件和数据库记录的破坏性操作，
// 放在这里可以直接被测试脚本单独引入验证（见 poolux-api/tmp-apk-prune-test.mjs 的用法），
// 不必为了测它去起一整套 HTTP 服务。
import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { deleteApkBuild, getApkBuildsByTemplate } from './db.js'
import { JOBS_DIR, safeJoinWithin } from './paths.js'

/** 每个模板保留几个「已就绪」的 APK 版本，想多留几版改这里 */
export const APK_KEEP_VERSIONS = 2

/** 还没跑完的任务状态：这些一律不清理 */
export const APK_IN_FLIGHT = new Set(['queued', 'preparing', 'building'])

/**
 * 递归删除目录。
 *
 * 不用 fs.rmSync({recursive:true})：Windows + Node 24 上它会「不报错但也不删除」，
 * 静默失败会让旧 APK 一直堆在磁盘上（与 scripts/lib-copy.mjs 里记录的是同一个缺陷）。
 * 返回删除的文件数。
 */
export function removeTreeSync(dir) {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      count += removeTreeSync(p)
    } else {
      try { unlinkSync(p); count += 1 } catch { /* 单个文件删不掉不影响整体 */ }
    }
  }
  try { rmdirSync(dir) } catch { /* 目录被占用时留待下次清理 */ }
  return count
}

/**
 * 清理同一模板下的历史打包任务。
 *
 * 保留：最近 APK_KEEP_VERSIONS 个「已就绪」版本，以及所有进行中的任务；
 * 其余（更早的成功版本、历史失败记录）连同 apk-jobs/<id>/ 目录一起删除。
 *
 * 只在构建成功时调用：万一新版本编译失败，旧版本不会被提前删掉，用户始终有包可下。
 * 返回被清理的任务 id（截断为前 6 位，仅用于日志）。
 */
export function pruneTemplateApkVersions(templateId, { keepVersions = APK_KEEP_VERSIONS } = {}) {
  const builds = getApkBuildsByTemplate(templateId) // 新的在前
  const keep = new Set()

  let keptReady = 0
  for (const b of builds) {
    if (APK_IN_FLIGHT.has(b.status)) { keep.add(b.id); continue }
    if (b.status === 'ready' && keptReady < keepVersions) {
      keep.add(b.id)
      keptReady += 1
    }
  }

  const removed = []
  for (const b of builds) {
    if (keep.has(b.id)) continue
    // 任务 id 来自 URL / 数据库，一律做「目录内」校验，避免越界删除
    const dir = safeJoinWithin(JOBS_DIR, b.id)
    if (dir) removeTreeSync(dir)
    deleteApkBuild(b.id)
    removed.push(`${b.id.slice(0, 6)}(${b.status})`)
  }
  return removed
}
