import { cpSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const BACKUP_DIR = join(ROOT, 'backup', 'source')
const MAX_BACKUPS = 20

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = join(BACKUP_DIR, ts)

const targets = [
  'src',
  'poolux-api',
  'public',
  'scripts',
  '.github',
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

console.log(`[backup] → ${dest}`)

mkdirSync(dest, { recursive: true })

for (const t of targets) {
  const src = join(ROOT, t)
  cpSync(src, join(dest, t), { recursive: true, errorOnExist: false })
}

// 清理旧备份，只保留最近 MAX_BACKUPS 个
try {
  const dirs = readdirSync(BACKUP_DIR)
    .map(d => ({ name: d, time: statSync(join(BACKUP_DIR, d)).mtimeMs }))
    .sort((a, b) => a.time - b.time)

  while (dirs.length > MAX_BACKUPS) {
    const old = dirs.shift()
    rmSync(join(BACKUP_DIR, old.name), { recursive: true, force: true })
    console.log(`[backup] removed ${old.name}`)
  }
} catch {}

console.log('[backup] done')