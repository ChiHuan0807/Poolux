// 运行数据（SQLite 数据库 / 上传文件 / APK 打包任务）的路径解析。
//
// 目的：把「代码」与「数据」分开，整目录覆盖上传代码时不会误删服务端数据。
// 默认与旧版完全一致（数据就放在 poolux-api/ 目录内），不加任何环境变量就是原行为。
//
// 部署到服务器后，在 poolux-api/.env 里配置（示例见 .env.example）：
//   POOLUX_DATA_DIR    数据根目录，例如 /www/poolux-data（建议放在网站目录之外）
//   POOLUX_DB_FILE     数据库文件路径（默认 <POOLUX_DATA_DIR>/data.db）
//   POOLUX_UPLOADS_DIR 上传目录（默认 <POOLUX_DATA_DIR>/uploads）
//   POOLUX_JOBS_DIR    APK 打包任务目录（默认 <POOLUX_DATA_DIR>/apk-jobs）
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolvePath(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return fallback
  return isAbsolute(v) ? v : resolve(__dirname, v)
}

// 旧版把数据放在 poolux-api/ 目录里（LEGACY_DIR），用于首次切换数据目录时搬运旧数据
const LEGACY_DIR = __dirname

export const DATA_DIR = resolvePath(process.env.POOLUX_DATA_DIR, LEGACY_DIR)
export const DB_FILE = resolvePath(process.env.POOLUX_DB_FILE, join(DATA_DIR, 'data.db'))
export const UPLOADS_DIR = resolvePath(process.env.POOLUX_UPLOADS_DIR, join(DATA_DIR, 'uploads'))
export const JOBS_DIR = resolvePath(process.env.POOLUX_JOBS_DIR, join(DATA_DIR, 'apk-jobs'))
export const FONTS_DIR = join(UPLOADS_DIR, 'fonts')

// 逐文件递归复制。
// 注意：不要用 fs.cpSync({recursive:true})，在 Windows + Node 24 上会直接崩溃（0xC0000409）。
function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true })
  let count = 0
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDirRecursive(s, d)
    } else if (entry.isFile()) {
      copyFileSync(s, d)
      count += 1
    }
    // 符号链接等其他类型跳过，避免复制出环
  }
  return count
}

// ── 首次切换到站外数据目录：把旧位置的数据搬过去，避免"配好环境变量后数据变空" ──
const usingDefaultDbFile = DB_FILE === join(DATA_DIR, 'data.db')

if (DATA_DIR !== LEGACY_DIR) {
  const legacyDb = join(LEGACY_DIR, 'data.db')
  const legacyUploads = join(LEGACY_DIR, 'uploads')
  const log = (msg) => console.log(`[paths] ${msg}`)

  // 目标库不存在但旧库存在 → 自动搬运，而不是新建一个空库
  if (usingDefaultDbFile && !existsSync(DB_FILE) && existsSync(legacyDb)) {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      for (const suffix of ['', '-wal', '-shm']) {
        const src = legacyDb + suffix
        if (existsSync(src)) copyFileSync(src, DB_FILE + suffix)
      }
      log(`已把数据库从旧目录复制到 ${DB_FILE}`)
    } catch (err) {
      console.error(
        `[paths] 复制数据库失败：${err.message}\n` +
        `[paths] 为避免用空库启动（会看起来像数据全丢），已停止运行。\n` +
        `[paths] 请手动把 ${legacyDb}（含 -wal / -shm）复制到 ${DB_FILE} 后重启。`,
      )
      process.exit(1)
    }
  }

  if (!existsSync(UPLOADS_DIR) && existsSync(legacyUploads)) {
    try {
      const n = copyDirRecursive(legacyUploads, UPLOADS_DIR)
      log(`已把 ${n} 个上传文件从旧目录复制到 ${UPLOADS_DIR}`)
    } catch (err) {
      console.error(
        `[paths] 复制上传文件失败：${err.message}\n` +
        `[paths] 继续启动，但图片/字体会缺失。请手动把 ${legacyUploads} 复制到 ${UPLOADS_DIR}。`,
      )
    }
  }

  // 目标库仍然不存在，而旧库还在 → 大概率是环境变量配错，直接停下来而不是静默建空库
  if (usingDefaultDbFile && !existsSync(DB_FILE) && existsSync(legacyDb)) {
    console.error(
      `[paths] 数据目录设置为 ${DATA_DIR}，但 ${DB_FILE} 不存在，旧数据库仍在 ${legacyDb}。\n` +
      '[paths] 为避免用空库启动（会看起来像数据全丢），已停止运行。请检查 POOLUX_DATA_DIR。',
    )
    process.exit(1)
  }
}

for (const dir of [DATA_DIR, UPLOADS_DIR, FONTS_DIR, JOBS_DIR]) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* 权限问题留给后续报错 */ }
}

/**
 * 把「相对路径」安全地拼到 base 目录下。
 * 任何逃出 base 的路径（`..`、绝对路径、Windows 盘符、UNC）一律返回 null，
 * 避免 `join(root, '../../etc/passwd')` 这类路径穿越读到/删掉目录外的文件。
 */
export function safeJoinWithin(base, rel) {
  const raw = String(rel ?? '')
  if (!raw) return null
  // 绝对路径（含 Windows 盘符 C:\ 与 UNC \\server）直接拒绝
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\')) return null
  const baseAbs = resolve(base)
  const target = resolve(baseAbs, raw)
  const inside = relative(baseAbs, target)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null
  // 二次确认（防御 resolve 之外的边界情况）
  if (target !== baseAbs && !target.startsWith(baseAbs + sep)) return null
  return target
}

/**
 * 从完整 URL 或相对路径中提取 uploads/ 之后的相对路径。
 * 例如 "https://x/api/uploads/fonts/a.ttf"、"uploads/a.png"、"api/uploads/a.png" → "a.png"
 * 也接受不含 uploads/ 前缀的纯文件名/子路径（如库里存的 "tpl-logo-x.webp"）→ 原样返回，
 * 但外站 URL 不做这个兜底，避免把别人的路径当成自己的文件。
 */
export function extractUploadRel(urlOrPath) {
  if (!urlOrPath) return null
  let pathname = String(urlOrPath)
  let remote = false
  try {
    if (/^https?:\/\//i.test(pathname)) {
      remote = true
      pathname = new URL(pathname).pathname
    }
  } catch {
    return null
  }
  // URL 解码后再做包含性校验，避免 %2e%2e%2f 绕过 `..` 检查
  try { pathname = decodeURIComponent(pathname) } catch { /* 保留原文，交给 safeJoinWithin 判定 */ }
  pathname = pathname.split('?')[0].split('#')[0].replace(/^\/+/, '').replace(/^api\//i, '')
  const marker = 'uploads/'
  const idx = pathname.lastIndexOf(marker)
  // 不带 uploads/ 前缀时按 uploads 相对路径兜底（越界/绝对路径由 safeJoinWithin 拦掉）
  const rel = idx === -1 ? (remote ? '' : pathname) : pathname.slice(idx + marker.length)
  return rel || null
}

/** 上传子路径 → 磁盘绝对路径；越界（`..`/绝对路径/盘符/UNC）时返回 null */
export function uploadFilePath(urlOrPath) {
  const rel = extractUploadRel(urlOrPath)
  if (!rel) return null
  return safeJoinWithin(UPLOADS_DIR, rel)
}

console.log(`[paths] 数据目录: ${DATA_DIR}`)
