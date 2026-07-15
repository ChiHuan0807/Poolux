import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 从完整 URL 或相对路径中提取文件路径，如 uploads/xxx.webp
function extractPath(urlOrPath) {
  if (!urlOrPath) return null
  try {
    if (/^https?:\/\//.test(urlOrPath)) {
      const u = new URL(urlOrPath)
      var pathname = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname
    } else if (urlOrPath.startsWith('/')) {
      var pathname = urlOrPath.slice(1)
    } else {
      var pathname = urlOrPath
    }
    // 统一去掉 /api/uploads/ 前缀为 uploads/
    return pathname.replace(/^api\//, '')
  } catch { return null }
}

function deleteFile(urlOrPath) {
  const rel = extractPath(urlOrPath)
  if (!rel) return
  const abs = join(__dirname, '..', rel)
  try { if (existsSync(abs)) unlinkSync(abs) } catch { /* ignore */ }
}
import {
  getAllResources, getVisibleResources, getResourceById, createResource,
  updateResource, deleteResource, toggleHidden,
} from '../db.js'

const router = Router()

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'bin'
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    cb(null, safeName)
  },
})

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } })

// GET /api/resources — 公开接口，仅显示未隐藏的资源
router.get('/', (_req, res) => {
  res.json(getVisibleResources())
})

// GET /api/resources/all — 管理接口，显示所有资源（含隐藏）
router.get('/all', authMiddleware, (_req, res) => {
  res.json(getAllResources())
})

// GET /api/resources/:id — 公开接口
router.get('/:id', (req, res) => {
  const r = getResourceById(req.params.id)
  if (!r) return res.status(404).json({ error: '资源不存在' })
  res.json(r)
})

// POST /api/resources — 需鉴权
router.post('/', authMiddleware, (req, res) => {
  try {
    createResource(req.body)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /api/resources/:id — 需鉴权
router.put('/:id', authMiddleware, (req, res) => {
  try {
    updateResource(req.params.id, req.body)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PATCH /api/resources/:id/toggle-hidden — 切换隐藏状态
router.patch('/:id/toggle-hidden', authMiddleware, (req, res) => {
  const result = toggleHidden(req.params.id)
  if (result === null) return res.status(404).json({ error: '资源不存在' })
  res.json({ ok: true, hidden: result })
})

// DELETE /api/resources/:id — 需鉴权，同时删除关联上传文件
router.delete('/:id', authMiddleware, (req, res) => {
  const r = getResourceById(req.params.id)
  if (r) {
    // 收集所有需要删除的文件路径
    const files = []
    if (r.icon) files.push(r.icon)
    // banner 现在是数组（由 parseRow 解析）
    if (r.banners && r.banners.length) {
      for (const url of r.banners) files.push(url)
    } else if (r.banner) {
      files.push(r.banner)
    }
    for (const opt of r.device_options) {
      if (opt.downloadUrl) files.push(opt.downloadUrl)
    }
    for (const f of files) {
      deleteFile(f)
    }
  }
  deleteResource(req.params.id)
  res.json({ ok: true })
})

// 图片 MIME 类型
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']

// POST /api/resources/upload — 文件上传，需鉴权
// 图片自动转 webp 压缩；非图片保持原样
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })

  try {
    if (IMAGE_MIMES.includes(req.file.mimetype)) {
      // 图片 → webp
      const webpName = req.file.filename.replace(/\.\w+$/, '.webp')
      const webpPath = join(req.file.destination, webpName)
      await sharp(req.file.path)
        .webp({ quality: 82 })
        .toFile(webpPath)
      // 删除原始文件
      try { unlinkSync(req.file.path) } catch {}
      res.json({ ok: true, filename: webpName, originalname: req.file.originalname, path: `/api/uploads/${webpName}` })
    } else {
      // 非图片（如 .bin）保持原样
      res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname, path: `/api/uploads/${req.file.filename}` })
    }
  } catch (err) {
    // 转换失败时保留原文件
    res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname, path: `/api/uploads/${req.file.filename}` })
  }
})

// DELETE /api/resources/delete-file — 删除单个上传文件（icon/banner等）
router.delete('/delete-file', authMiddleware, (req, res) => {
  const fileUrl = req.query.url
  if (!fileUrl) return res.status(400).json({ error: '缺少 url 参数' })
  deleteFile(decodeURIComponent(fileUrl))
  res.json({ ok: true })
})

export default router