import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'poolux-api')
const DEST = join(ROOT, 'dist', 'poolux-api')

// 清理旧目录
if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true })
mkdirSync(DEST, { recursive: true })

// 排除项
const exclude = new Set(['node_modules', 'data.db', 'uploads', 'apk-jobs', 'package-lock.json'])

// 递归复制，跳过排除项
function copyDir(src, dest) {
  const files = readdirSync(src)
  for (const f of files) {
    if (exclude.has(f)) continue
    const srcPath = join(src, f)
    const destPath = join(dest, f)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDir(srcPath, destPath)
    } else {
      try {
        cpSync(srcPath, destPath)
      } catch (err) {
        // Windows 上 cpSync 可能因隐藏文件属性失败，跳过
        console.warn(`[copy-api] 跳过 ${f}: ${err.message}`)
      }
    }
  }
}

copyDir(SRC, DEST)
console.log('[copy-api] poolux-api → dist/poolux-api')