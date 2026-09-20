import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getGalleryImages, createGalleryImage, updateGalleryImage, deleteGalleryImage,
} from '../db.js'
import { UPLOADS_DIR, uploadFilePath } from '../paths.js'
import { IMAGE_EXTS, hasAllowedExt, safeUploadName, webpTargetName } from '../upload-files.js'
import { normalizeAssetUrl } from '../safe-url.js'

function deleteFile(urlOrPath) {
  const abs = uploadFilePath(urlOrPath)
  if (!abs) return
  try { if (existsSync(abs)) unlinkSync(abs) } catch { /* ignore */ }
}

const MAX_NAME_LENGTH = 80

function trimField(value, limit) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > limit) throw new Error(`字段过长（最多 ${limit} 字）`)
  return text
}

/** 相册记录的文本字段 + 排序号 */
function normalizeGalleryMeta(body) {
  const sortOrder = Number(body?.sort_order)
  return {
    watch_face_name: trimField(body?.watch_face_name, MAX_NAME_LENGTH),
    watch_face_model: trimField(body?.watch_face_model, MAX_NAME_LENGTH),
    character_name: trimField(body?.character_name, MAX_NAME_LENGTH),
    device: trimField(body?.device, MAX_NAME_LENGTH),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  }
}

/**
 * 新增相册记录时的完整校验。
 * image_url 会被前端渲染成 <img src>，相册页还会渲染成 `<a href download>`，
 * 所以必须限定为站内路径或 http(s) 链接（否则 `javascript:` 就是点击即执行的 XSS）。
 */
function normalizeGalleryInput(body) {
  return {
    image_url: normalizeAssetUrl(body?.image_url, { label: '图片地址', required: true }),
    ...normalizeGalleryMeta(body),
  }
}

const router = Router()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  // 文件名完全由服务端生成，不采用 originalname 里的任何路径片段
  filename: (_req, file, cb) => cb(null, safeUploadName('', file.originalname, IMAGE_EXTS, '.webp')),
})
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  // 只接受图片扩展名；SVG/HTML 会被浏览器当成文档执行，直接拒收
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, IMAGE_EXTS)) {
      return cb(new Error('仅支持 JPG、PNG、GIF、WebP、BMP、TIFF、AVIF 图片'))
    }
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(new Error('文件类型不是图片'))
    }
    cb(null, true)
  },
})

// GET /api/gallery — 公开
router.get('/', (_req, res) => {
  res.json(getGalleryImages())
})

// POST /api/gallery — 鉴权，创建记录（不含图片上传）
router.post('/', authMiddleware, (req, res) => {
  try {
    const result = createGalleryImage(normalizeGalleryInput(req.body))
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /api/gallery/:id — 鉴权，更新元数据
// image_url 对应已上传的文件，只在创建时写入，更新接口不接受改写
router.put('/:id', authMiddleware, (req, res) => {
  try {
    updateGalleryImage(req.params.id, normalizeGalleryMeta(req.body))
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// DELETE /api/gallery/delete-file — 鉴权，删除单文件
// 必须注册在 '/:id' 之前，否则会被 '/:id' 抢先匹配，这个接口永远不生效
router.delete('/delete-file', authMiddleware, (req, res) => {
  const fileUrl = req.query.url
  if (!fileUrl) return res.status(400).json({ error: '缺少 url 参数' })
  // uploadFilePath 已经保证只在 uploads/ 目录内删除，越界路径会返回 null
  deleteFile(decodeURIComponent(String(fileUrl)))
  res.json({ ok: true })
})

// DELETE /api/gallery/:id — 鉴权，删除记录及文件
router.delete('/:id', authMiddleware, (req, res) => {
  const images = getGalleryImages()
  const target = images.find(i => i.id === Number(req.params.id))
  if (target) deleteFile(target.image_url)
  deleteGalleryImage(req.params.id)
  res.json({ ok: true })
})

// POST /api/gallery/upload — 鉴权，上传图片（统一转 webp）
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  const webpName = webpTargetName(req.file.filename)
  const webpPath = join(req.file.destination, webpName)
  try {
    await sharp(req.file.path).rotate().webp({ quality: 82 }).toFile(webpPath)
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    res.json({ ok: true, path: `/api/uploads/${webpName}` })
  } catch (err) {
    // 转换失败必须删除原始文件并报错：以前会把原文件直接返回，
    // 于是伪装成图片的 SVG/HTML 就能以原扩展名被访问，形成存储型 XSS。
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    console.error('[gallery/upload] 转 webp 失败：', err)
    res.status(400).json({ error: `图片解析失败，请确认文件是有效的图片（${err?.message || '未知原因'}）` })
  }
})

export default router
