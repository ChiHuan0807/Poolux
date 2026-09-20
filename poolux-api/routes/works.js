import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getWorksImages, createWorksImage, deleteWorksImage, reorderWorksImages,
} from '../db.js'
import { UPLOADS_DIR, uploadFilePath } from '../paths.js'
import { IMAGE_EXTS, hasAllowedExt, safeUploadName, webpTargetName } from '../upload-files.js'
import { normalizeAssetUrl } from '../safe-url.js'

function deleteFile(urlOrPath) {
  const abs = uploadFilePath(urlOrPath)
  if (!abs) return
  try { if (existsSync(abs)) unlinkSync(abs) } catch { /* ignore */ }
}

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  // 文件名完全由服务端生成，客户端提供的 originalname 只用于判断扩展名
  filename: (_req, file, cb) => cb(null, safeUploadName('works-', file.originalname, IMAGE_EXTS, '.webp')),
})
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, IMAGE_EXTS)) {
      return cb(new Error('仅支持图片文件（JPG/PNG/GIF/WebP/BMP/TIFF/AVIF）'))
    }
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(new Error('文件类型不是图片'))
    }
    cb(null, true)
  },
})

// GET /api/works — 公开
router.get('/', (_req, res) => {
  res.json(getWorksImages())
})

// POST /api/works — 鉴权，创建
// image_url 会被前台直接渲染成 <img src>，限定为站内路径或 http(s)
router.post('/', authMiddleware, (req, res) => {
  try {
    const imageUrl = normalizeAssetUrl(req.body?.image_url, { label: '图片地址', required: true })
    const sortOrder = Number(req.body?.sort_order)
    const result = createWorksImage({ image_url: imageUrl, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 })
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

// POST /api/works/upload — 鉴权，上传图片（统一转 webp）
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  const webpName = webpTargetName(req.file.filename)
  const webpPath = join(req.file.destination, webpName)
  try {
    await sharp(req.file.path).rotate().webp({ quality: 82 }).toFile(webpPath)
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    res.json({ ok: true, path: `/api/uploads/${webpName}` })
  } catch (err) {
    // 转换失败不能把原始文件原样返回：伪装成图片的 SVG/HTML 会以原扩展名被访问
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    console.error('[works/upload] 转 webp 失败：', err)
    res.status(400).json({ error: `图片解析失败，请确认文件是有效的图片（${err?.message || '未知原因'}）` })
  }
})

export default router