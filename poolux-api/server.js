import './load-env.js'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readdirSync, statSync } from 'fs'
import authRouter from './routes/auth.js'
import resourcesRouter from './routes/resources.js'
import galleryRouter from './routes/gallery.js'
import worksRouter from './routes/works.js'
import friendsRouter from './routes/friends.js'
import componentsRouter from './routes/components.js'
import fontsRouter from './routes/fonts.js'
import teamMembersRouter from './routes/team-members.js'
import siteSettingsRouter from './routes/site-settings.js'
import apkBuildsRouter from './routes/apk-builds.js'
import { getGalleryImages } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3001

// 中间件
const ALLOWED_ORIGINS = [
  process.env.CORS_ORIGIN || 'http://localhost:5173',
  'https://poolux.top',
  'http://poolux.top',
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, false)
    }
  },
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// ── 上传文件服务：explicit route + res.sendFile ──
const UPLOADS_DIR = join(__dirname, 'uploads')

function serveUpload(req, res) {
  // req.params[0] 匹配通配符 /* 的完整子路径，例如 "fonts/xxx.ttf" 或 "file.png"
  const subPath = req.params[0]
  const filePath = join(UPLOADS_DIR, subPath)
  if (!existsSync(filePath)) {
    console.error(`[uploads] 文件不存在: ${filePath}`)
    return res.status(404).json({ error: '文件不存在' })
  }
  const ext = (subPath.split('.').pop() || '').toLowerCase()
  const MIME = {
    webp:'image/webp', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
    gif:'image/gif', svg:'image/svg+xml',
    ttf:'font/ttf', otf:'font/otf', woff2:'font/woff2',
  }
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(filePath)
}

// 使用通配符 * 支持子目录路径（例如 /api/uploads/fonts/xxx.ttf）
app.get('/api/uploads/*', serveUpload)
app.get('/uploads/*', serveUpload)

// 诊断端点：列出 uploads 目录中的文件
app.get('/api/debug/uploads', (_req, res) => {
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

// 诊断端点：检查 gallery 记录与磁盘文件匹配情况
app.get('/api/debug/gallery', (_req, res) => {
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
app.post('/api/debug/fix-paths', async (_req, res) => {
  try {
    const Database = (await import('better-sqlite3')).default
    const ldb = new Database(join(__dirname, 'data.db'))
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
app.use('/api/apk-builds', apkBuildsRouter)

// 健康检查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`[poolux-api] 运行在 http://localhost:${PORT}`)
})