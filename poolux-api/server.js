import './load-env.js'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import authRouter from './routes/auth.js'
import resourcesRouter from './routes/resources.js'
import galleryRouter from './routes/gallery.js'
import worksRouter from './routes/works.js'
import friendsRouter from './routes/friends.js'
import componentsRouter from './routes/components.js'
import fontsRouter from './routes/fonts.js'
import teamMembersRouter from './routes/team-members.js'
import siteSettingsRouter from './routes/site-settings.js'
import devicesRouter from './routes/devices.js'
import termsRouter from './routes/terms.js'
import apkBuildsRouter from './routes/apk-builds.js'
import { getGalleryImages } from './db.js'
import { DB_FILE, DATA_DIR, UPLOADS_DIR, safeJoinWithin } from './paths.js'
import { authMiddleware } from './middleware/auth.js'
import { spawn } from 'child_process'

const app = express()
const PORT = process.env.PORT || 3001

// ── 构建标识 ──
// 打包时由 scripts/package-api.mjs 写入 build-info.json，随代码一起上传。
// 目的：线上出问题时，先打开 /api/health 就能确认「服务器上跑的到底是哪一版」，
// 避免出现「代码改了但没上传/没重启」却当成 bug 继续排查的情况。
// 本地直接跑源码（没有这个文件）时显示 dev。
function readBuildInfo() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const data = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8'))
    return {
      id: String(data?.id || 'unknown'),
      features: Array.isArray(data?.features) ? data.features.map(String) : [],
    }
  } catch {
    return { id: 'dev', features: [] }
  }
}

const BUILD = readBuildInfo()

// ── 基础加固 ──
// 不暴露 Express 版本号（版本指纹会帮攻击者挑现成漏洞）
app.disable('x-powered-by')
// 部署在宝塔/Nginx 反代之后：只信任一层代理，req.ip 才会是真实客户端 IP
app.set('trust proxy', 1)

// ────────────────────────────────────────────────
// 跨域策略
// ────────────────────────────────────────────────
// 旧实现是「无条件反射任何 Origin + credentials:true」，等于允许任意网站带着
// 管理员 Cookie 调接口并读取响应。现在改成白名单：
//   1. 同源（Origin 的 host 等于本次请求的 Host）——生产环境走 Nginx 反代就是这种情况
//   2. CORS_ORIGIN 里显式列出的来源（英文逗号分隔）
//   3. PUBLIC_BASE_URL / SITE_URL 对应的来源
//   4. 开发模式下本机 localhost / 127.0.0.1
const ENV_ORIGINS = [
  ...(process.env.CORS_ORIGIN || '').split(','),
  process.env.PUBLIC_BASE_URL || '',
  process.env.SITE_URL || '',
].map((value) => {
  const raw = String(value || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  try { return new URL(raw).origin } catch { return raw }
}).filter(Boolean)

const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const ALLOW_LOCALHOST = process.env.NODE_ENV !== 'production'

function isAllowedOrigin(req, origin) {
  if (!origin) return false
  let originHost = ''
  try { originHost = new URL(origin).host } catch { return false }
  // 同源：浏览器会带上 Origin，这里按 host 直接放行
  if (originHost && originHost === req.headers.host) return true
  if (ENV_ORIGINS.includes(origin)) return true
  if (ALLOW_LOCALHOST && DEV_ORIGIN_RE.test(origin)) return true
  return false
}

// 允许跨域携带凭证时，必须显式列出来源，不能用通配符
app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(req, origin) ? origin : false),
    credentials: true,
    maxAge: 600,
  })(req, res, next)
})

// ── 通用安全响应头 ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // 接口与上传文件都不需要被任何页面嵌套
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  next()
})

// 条款正文上限 10 万字符，1MB 足够且能挡住超大 body 打内存
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// ────────────────────────────────────────────────
// 上传文件服务
// ────────────────────────────────────────────────
// UPLOADS_DIR 由 paths.js 解析（可用 POOLUX_UPLOADS_DIR 指到网站目录之外）
const MIME = {
  webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2',
}

function serveUpload(req, res) {
  // req.params[0] 匹配通配符 /* 的完整子路径，例如 "fonts/xxx.ttf" 或 "file.png"
  const subPath = req.params[0]
  // 关键：必须做「目录内」校验。直接 join(UPLOADS_DIR, subPath) 时，
  // /api/uploads/..%2F..%2Fdata.db 会把数据库整个读出去（已实测可复现）。
  const filePath = safeJoinWithin(UPLOADS_DIR, subPath)
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ error: '文件不存在' })
  }
  const ext = (subPath.split('.').pop() || '').toLowerCase()
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  // 上传内容一律禁止被当成文档执行：SVG 里只要带 <script> 就是稳定的存储型 XSS，
  // sandbox 会让浏览器在「作为文档打开」时禁用脚本，同时不影响 <img> 渲染。
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  // 跨域加载（预览图 canvas 合成、真机/局域网访问）需要反射可信请求源
  const reqOrigin = req.headers.origin
  if (isAllowedOrigin(req, reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin)
    res.setHeader('Vary', 'Origin')
  }
  res.sendFile(filePath)
}

// 使用通配符 * 支持子目录路径（例如 /api/uploads/fonts/xxx.ttf）
app.get('/api/uploads/*', serveUpload)
app.get('/uploads/*', serveUpload)

// ── 诊断端点 ──
// 这些接口会暴露服务器绝对路径和上传文件清单，并且 fix-paths 会直接改数据库，
// 因此统一要求登录后才能访问。
app.get('/api/debug/uploads', authMiddleware, (_req, res) => {
  try {
    const files = readdirSync(UPLOADS_DIR).map(f => ({
      name: f,
      size: statSync(join(UPLOADS_DIR, f)).size,
    }))
    res.json({ dir: UPLOADS_DIR, count: files.length, files })
  } catch (err) {
    res.json({ dir: UPLOADS_DIR, error: err.message })
  }
})

app.get('/api/debug/gallery', authMiddleware, (_req, res) => {
  try {
    const images = getGalleryImages()
    const files = readdirSync(UPLOADS_DIR)
    const result = images.map(img => {
      const url = img.image_url || ''
      let fn = ''
      if (url.includes('/api/uploads/')) fn = url.split('/api/uploads/')[1]
      else if (url.includes('/uploads/')) fn = url.split('/uploads/')[1]
      return { id: img.id, image_url: img.image_url, filename: fn, exists: files.includes(fn), device: img.device }
    })
    res.json({ gallery: result, uploads: files })
  } catch (err) { res.json({ error: err.message }) }
})

// 修复端点：将数据库中旧的 /uploads/ 路径批量改为 /api/uploads/
app.post('/api/debug/fix-paths', authMiddleware, async (_req, res) => {
  try {
    const Database = (await import('better-sqlite3')).default
    const ldb = new Database(DB_FILE)
    const tables = ['gallery_images', 'works_images', 'resources']
    let total = 0
    for (const table of tables) {
      for (const col of ['image_url', 'banner']) {
        try {
          const r = ldb.prepare(`UPDATE ${table} SET ${col} = REPLACE(${col}, '/uploads/', '/api/uploads/') WHERE ${col} LIKE '%/uploads/%' AND ${col} NOT LIKE '%/api/uploads/%'`).run()
          total += r.changes
        } catch { /* column may not exist */ }
      }
    }
    ldb.close()
    res.json({ ok: true, fixed: total })
  } catch (err) { res.json({ error: err.message }) }
})

// 一键备份端点：把数据目录（数据库 + 上传文件 + 打包任务）打包下载。
// 覆盖上传代码之前先点一下这里，出问题可以直接解压还原。
app.get('/api/backup', authMiddleware, (req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="poolux-backup-${stamp}.tar.gz"`)

  // 从数据目录打包；跳过 node_modules（默认数据目录在代码目录内时避免备份体积过大）
  const tar = spawn('tar', ['-czf', '-', '-C', DATA_DIR, '--exclude=node_modules', '.'])
  tar.stdout.pipe(res)
  tar.stderr.on('data', (d) => console.error('[backup]', d.toString().trim()))
  tar.on('error', (err) => {
    console.error('[backup] 无法启动 tar:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ error: `备份失败：服务器上没有 tar 命令（${err.message}）` })
    } else {
      res.end()
    }
  })
  tar.on('close', (code) => {
    if (code !== 0) console.error(`[backup] tar 退出码 ${code}，备份可能不完整`)
  })
})

// API 路由
app.use('/api/auth', authRouter)
app.use('/api/resources', resourcesRouter)
app.use('/api/gallery', galleryRouter)
app.use('/api/works', worksRouter)
app.use('/api/templates', componentsRouter)
app.use('/api/friends', friendsRouter)
app.use('/api/fonts', fontsRouter)
app.use('/api/team-members', teamMembersRouter)
app.use('/api/site-settings', siteSettingsRouter)
app.use('/api/devices', devicesRouter)
app.use('/api/terms', termsRouter)
app.use('/api/apk-builds', apkBuildsRouter)

// 健康检查：build / features 来自 build-info.json，用于确认线上部署的是哪一版代码
app.get('/api/health', (_req, res) => res.json({ ok: true, build: BUILD.id, features: BUILD.features }))

// 未匹配的 /api 路径统一返回 JSON，避免前端把 HTML 当成接口响应
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }))

// 兜底错误处理：上传超限、限流之外的异常都收敛成 JSON，且不把堆栈泄露给客户端
app.use((err, _req, res, _next) => {
  const status = Number(err?.status || err?.statusCode) || 500
  const isClientError = status >= 400 && status < 500
  if (!isClientError) console.error('[poolux-api] 未处理异常:', err)
  if (res.headersSent) return res.end()
  const message = err?.code === 'LIMIT_FILE_SIZE'
    ? '文件超过大小限制'
    : (isClientError && err?.message ? err.message : '服务器内部错误')
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message })
})

app.listen(PORT, () => {
  console.log(`[poolux-api] 运行在 http://localhost:${PORT}`)
  console.log(
    `[poolux-api] 构建版本: ${BUILD.id}` +
    (BUILD.features.length > 0 ? `（含修复：${BUILD.features.join('、')}）` : ''),
  )
  console.log(`[poolux-api] 跨域白名单: ${ENV_ORIGINS.join(', ') || '（仅同源' + (ALLOW_LOCALHOST ? ' + 本机 localhost' : '') + '）'}`)
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const ghRepo = process.env.GITHUB_REPO
  if (!ghToken || !ghRepo) {
    console.warn(
      '[poolux-api] APK 打包未就绪：请在 poolux-api/.env 配置 GITHUB_TOKEN 与 GITHUB_REPO（参考 .env.example），然后重启本服务',
    )
  }
})
