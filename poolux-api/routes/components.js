import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTemplates, getVisibleTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate,
  toggleTemplateHidden,
} from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const router = Router()

// ── 预览图上传 ──
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(__dirname, '..', 'uploads')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'bin'
    cb(null, `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } })

// GET /api/templates — 公开，仅返回未隐藏的模板
router.get('/', (_req, res) => { res.json(getVisibleTemplates()) })

// GET /api/templates/all — 管理端，返回全部（含隐藏）
router.get('/all', authMiddleware, (_req, res) => { res.json(getTemplates()) })

// PATCH /api/templates/:id/toggle-hidden — 管理端，切换隐藏状态
router.patch('/:id/toggle-hidden', authMiddleware, (req, res) => {
  const result = toggleTemplateHidden(req.params.id)
  if (result === null) return res.status(404).json({ error: '模板不存在' })
  res.json({ ok: true, hidden: result })
})

// GET /api/templates/:id
router.get('/:id', (req, res) => {
  const t = getTemplateById(req.params.id)
  if (!t) return res.status(404).json({ error: '模板不存在' })
  res.json(t)
})

// POST /api/templates — 鉴权
router.post('/', authMiddleware, (req, res) => {
  try {
    const result = createTemplate(req.body)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// PUT /api/templates/:id
router.put('/:id', authMiddleware, (req, res) => {
  try {
    updateTemplate(req.params.id, req.body)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// DELETE /api/templates/:id
router.delete('/:id', authMiddleware, (req, res) => {
  deleteTemplate(req.params.id)
  res.json({ ok: true })
})

async function handleTemplateImageUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!IMAGE_MIMES.includes(req.file.mimetype)) {
    try { unlinkSync(req.file.path) } catch {}
    return res.status(400).json({ error: '仅支持 JPG、PNG、GIF 或 WebP 图片' })
  }
  try {
    const webpName = req.file.filename.replace(/\.\w+$/, '.webp')
    const webpPath = join(req.file.destination, webpName)
    await sharp(req.file.path).webp({ quality: 90 }).toFile(webpPath)
    try { unlinkSync(req.file.path) } catch {}
    res.json({ ok: true, path: `/api/uploads/${webpName}` })
  } catch {
    res.json({ ok: true, path: `/api/uploads/${req.file.filename}` })
  }
}

// POST /api/templates/upload-image — 上传模板图片图层资源
router.post('/upload-image', authMiddleware, upload.single('file'), handleTemplateImageUpload)

// POST /api/templates/upload-preview — 上传预览图
router.post('/upload-preview', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  try {
    const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
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