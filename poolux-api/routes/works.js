import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getWorksImages, createWorksImage, deleteWorksImage, reorderWorksImages,
} from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(__dirname, '..', 'uploads')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'bin'
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']

// GET /api/works — 公开
router.get('/', (_req, res) => {
  res.json(getWorksImages())
})

// POST /api/works — 鉴权，创建
router.post('/', authMiddleware, (req, res) => {
  try {
    const result = createWorksImage(req.body)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /api/works/reorder — 鉴权，排序
router.put('/reorder', authMiddleware, (req, res) => {
  try {
    reorderWorksImages(req.body.ids)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// DELETE /api/works/:id — 鉴权，删除
router.delete('/:id', authMiddleware, (req, res) => {
  const images = getWorksImages()
  const target = images.find(i => i.id === Number(req.params.id))
  if (target) deleteFile(target.image_url)
  deleteWorksImage(req.params.id)
  res.json({ ok: true })
})

// POST /api/works/upload — 鉴权，上传图片
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  try {
    if (IMAGE_MIMES.includes(req.file.mimetype)) {
      const webpName = req.file.filename.replace(/\.\w+$/, '.webp')
      const webpPath = join(req.file.destination, webpName)
      await sharp(req.file.path).webp({ quality: 82 }).toFile(webpPath)
      try { unlinkSync(req.file.path) } catch {}
      res.json({ ok: true, path: `/api/uploads/${webpName}` })
    } else {
      res.json({ ok: true, path: `/api/uploads/${req.file.filename}` })
    }
  } catch {
    res.json({ ok: true, path: `/api/uploads/${req.file.filename}` })
  }
})

export default router