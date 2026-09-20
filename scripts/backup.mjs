// 本机源码备份：按时间戳打包到 backup/source/<时间>，只保留最近 20 份。
// 注意：不要用 fs.cpSync({recursive:true})，Windows + Node 24 上会让进程崩溃，
// 统一走 scripts/lib-copy.mjs 里的逐文件复制。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { copyDirRecursive, removeTree } from './lib-copy.mjs'

const ROOT = join(import.meta.dirname, '..')
const BACKUP_DIR = join(ROOT, 'backup', 'source')
const MAX_BACKUPS = 20

const DIR_TARGETS = ['src', 'poolux-api', 'public', 'scripts', '.github']
const FILE_TARGETS = [
  'offline.html',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tailwind.config.js',
  'tsconfig.json',
  'postcss.config.js',
  '.env.offline',
  '.env.production',
]

// 备份时跳过体积大且可重新生成的内容
const EXCLUDE = new Set(['node_modules', 'apk-jobs'])

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = join(BACKUP_DIR, ts)

console.log(`[backup] → ${dest}`)
mkdirSync(dest, { recursive: true })

for (const t of DIR_TARGETS) {
  const src = join(ROOT, t)
  if (existsSync(src)) copyDirRecursive(src, join(dest, t), EXCLUDE)
}

for (const t of FILE_TARGETS) {
  const src = join(ROOT, t)
  if (existsSync(src)) copyFileSync(src, join(dest, t))
}

// 清理旧备份，只保留最近 MAX_BACKUPS 个
try {
  const dirs = readdirSync(BACKUP_DIR)
    .map(d => ({ name: d, time: statSync(join(BACKUP_DIR, d)).mtimeMs }))
    .sort((a, b) => a.time - b.time)

  while (dirs.length > MAX_BACKUPS) {
    const old = dirs.shift()
    try {
      removeTree(join(BACKUP_DIR, old.name))
      console.log(`[backup] removed ${old.name}`)
    } catch (err) {
      console.warn(`[backup] 删除失败 ${old.name}: ${err.message}`)
    }
  }
} catch {}

console.log('[backup] done')
