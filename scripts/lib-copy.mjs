// 递归复制目录的工具函数。
//
// 为什么不用 fs.cpSync({recursive:true})：
// 在 Windows + Node 24 上，cpSync 覆盖已存在文件会报
//   "Error: , The operation completed successfully."
// 递归复制更是会直接把进程打崩（STATUS_STACK_BUFFER_OVERRUN / 0xC0000409）。
// 逐文件 copyFileSync 已验证在新目标与覆盖两种情况下都稳定。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'fs'
import { join } from 'path'

/** 递归复制目录（默认跳过 EXCLUDE 中的名字）；返回复制的文件数 */
export function copyDirRecursive(src, dest, exclude = new Set()) {
  mkdirSync(dest, { recursive: true })
  let count = 0
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath, exclude)
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath)
      count += 1
    }
  }
  return count
}

/** 复制单个文件；源不存在时返回 false */
export function copyFileSafe(src, dest) {
  if (!existsSync(src)) return false
  copyFileSync(src, dest)
  return true
}

/**
 * 可靠地删除目录树；返回删除的文件数。
 *
 * 为什么不用 fs.rmSync({recursive:true})：
 * 在 Windows + Node 24 上它可能不报错但也不删除（静默失败），
 * 结果就是旧文件残留 —— 对部署包来说意味着旧的 .env / 数据库可能被一起打进去。
 * 自底向上 unlinkSync + rmdirSync 已验证稳定。
 */
export function removeTree(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      n += removeTree(p)
    } else {
      unlinkSync(p)
      n += 1
    }
  }
  rmdirSync(dir)
  return n
}
