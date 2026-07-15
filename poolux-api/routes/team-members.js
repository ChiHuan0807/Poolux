import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember, reorderTeamMembers,
} from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } })

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const router = Router()

// GET — 公开
router.get('/', (_req, res) => {
  res.json(getTeamMembers())
})

// POST — 鉴权，创建
router.post('/', authMiddleware, (req, res) => {
  try {
    const result = createTeamMember(req.body)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /reorder — 鉴权，排序
router.put('/reorder', authMiddleware, (req, res) => {
  try {
    reorderTeamMembers(req.body.ids)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /:id — 鉴权，更新
router.put('/:id', authMiddleware, (req, res) => {
  try {
    updateTeamMember(req.params.id, req.body)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// DELETE /:id — 鉴权，删除
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    deleteTeamMember(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// POST /upload — 鉴权，头像上传
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  try {
    if (IMAGE_MIMES.includes(req.file.mimetype)) {
      const webpName = req.file.filename.replace(/\.\w+$/, '.webp')
      const webpPath = join(req.file.destination, webpName)
      await sharp(req.file.path).resize(200, 200, { fit: 'cover' }).webp({ quality: 82 }).toFile(webpPath)
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