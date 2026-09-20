import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTemplates, getVisibleTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate,
  toggleTemplateHidden,
} from '../db.js'
import { UPLOADS_DIR, uploadFilePath } from '../paths.js'
import { IMAGE_EXTS, hasAllowedExt, safeUploadName, webpTargetName } from '../upload-files.js'
import { assertTemplateSvgSafe, sanitizeTemplateRow } from '../svg-safety.js'
import { normalizeAssetUrl } from '../safe-url.js'

const router = Router()

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// ── 图片上传 ──
// 文件名一律由服务端生成（白名单扩展名 + 随机名），并且先过扩展名/MIME 白名单，
// 避免恶意构造的 originalname 决定落盘路径或扩展名。
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, safeUploadName('tpl-', file.originalname, IMAGE_EXTS, '.webp')),
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, IMAGE_EXTS)) {
      return cb(new Error('仅支持 JPG、PNG、GIF、WebP 等图片格式'))
    }
    if (!IMAGE_MIMES.includes(String(file.mimetype || ''))) {
      return cb(new Error('文件类型不是图片'))
    }
    cb(null, true)
  },
})

const LOGO_SIZE = 512
/** 模板库封面（LOGO）文件名：tpl-logo-*.webp，公开接口只放行此前缀 */
const LOGO_NAME_RE = /^tpl-logo-[\w-]+\.webp$/i

function removeFile(path) {
  try { if (path && existsSync(path)) unlinkSync(path) } catch { /* ignore */ }
}

/**
 * 模板图层入参规范化。
 * - image_url 会被前端渲染成 <img src>（也会被 APK 打包流程下载），限定为站内路径或 http(s)
 * - admin_preview_url 是管理端本地临时预览（data: URL），不允许落库
 */
function normalizeTemplateLayers(data) {
  const cleanLayer = (layer) => {
    if (!layer || typeof layer !== 'object') return layer
    const { admin_preview_url: _localPreview, ...rest } = layer
    return {
      ...rest,
      image_url: normalizeAssetUrl(rest.image_url, { label: `图层「${rest.name || '未命名'}」图片`, allowAnyRelative: true }),
    }
  }
  const cleanLayers = (layers) => (Array.isArray(layers) ? layers.map(cleanLayer) : [])
  return {
    ...data,
    layers: cleanLayers(data?.layers),
    devices: Array.isArray(data?.devices)
      ? data.devices.map((device) => (
        device && typeof device === 'object' ? { ...device, layers: cleanLayers(device.layers) } : device
      ))
      : [],
  }
}

/**
 * 模板库封面校验。
 * 取消「保存时自动合成预览图」之后，封面完全由管理员上传的 1:1 图决定，
 * 所以这里只允许引用服务端生成的 tpl-logo-*.webp（兼容旧的 tpl-preview-*.webp）。
 */
function validateTemplateCover(raw) {
  const data = normalizeTemplateLayers(raw)
  const name = String(data?.name || '').trim()
  if (!name) throw new Error('请填写模板名称')
  if (name.length > 120) throw new Error('模板名称过长（最多 120 字）')
  data.name = name

  // 模糊度上限：用户端滑杆的最大峰值，缺省 50px；非数字/超范围一律夹回合法区间
  const blurMax = Math.round(Number(data?.blur_max))
  data.blur_max = Number.isFinite(blurMax) && blurMax > 0
    ? Math.min(200, Math.max(1, blurMax))
    : 50

  const previewImage = String(data?.preview_image || '').trim()
  const fileName = previewImage.match(/^\/api\/uploads\/(tpl-logo-[\w-]+\.webp|tpl-preview-[\w-]+\.webp)$/i)?.[1]
  if (!previewImage || !fileName) {
    throw new Error('请先上传 1:1 的模板库 LOGO 封面')
  }
  if (!existsSync(uploadFilePath(fileName))) {
    throw new Error('模板库封面文件不存在，请重新上传')
  }
  // SVG 图层会以原始标记注入前端 DOM，写入前必须确认没有脚本/事件属性
  assertTemplateSvgSafe(data)
  return data
}

// GET /api/templates — 公开，仅返回未隐藏的模板
router.get('/', (_req, res) => { res.json(getVisibleTemplates()) })

// GET /api/templates/all — 管理端，返回全部（含隐藏）
router.get('/all', authMiddleware, (_req, res) => {
  res.json(getTemplates().map(sanitizeTemplateRow))
})

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
  res.json(sanitizeTemplateRow(t))
})

// POST /api/templates — 鉴权
router.post('/', authMiddleware, (req, res) => {
  try {
    const payload = validateTemplateCover(req.body)
    const result = createTemplate(payload)
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// PUT /api/templates/:id
router.put('/:id', authMiddleware, (req, res) => {
  try {
    if (!getTemplateById(req.params.id)) return res.status(404).json({ error: '模板不存在' })
    const payload = validateTemplateCover(req.body)
    updateTemplate(req.params.id, payload)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// DELETE /api/templates/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const t = getTemplateById(req.params.id)
  if (t) removeFile(uploadFilePath(String(t.preview_image || '')))
  deleteTemplate(req.params.id)
  res.json({ ok: true })
})

// POST /api/templates/upload-image — 上传模板图片图层资源
router.post('/upload-image', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  try {
    const webpName = webpTargetName(req.file.filename)
    const webpPath = join(req.file.destination, webpName)
    await sharp(req.file.path).webp({ quality: 90 }).toFile(webpPath)
    removeFile(req.file.path)
    res.json({ ok: true, path: `/api/uploads/${webpName}` })
  } catch (err) {
    // 转换失败必须删掉落盘文件并报错：否则伪装成图片的 SVG/HTML 会以原扩展名被访问
    removeFile(req.file.path)
    console.error('[templates/upload-image] 转 webp 失败：', err)
    res.status(400).json({ error: `图片解析失败，请确认文件是有效的图片（${err?.message || '未知原因'}）` })
  }
})

// POST /api/templates/upload-logo — 上传模板库 LOGO 封面（1:1 正方形，无圆角）
// 统一裁成 1:1 并转 webp，保证模板库卡片拿到的永远是正方形图源。
router.post('/upload-logo', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  const logoName = webpTargetName(req.file.filename.replace(/^tpl-/, 'tpl-logo-'))
  const logoPath = join(req.file.destination, logoName)
  try {
    await sharp(req.file.path)
      .rotate()
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 90 })
      .toFile(logoPath)
    removeFile(req.file.path)
    if (!LOGO_NAME_RE.test(logoName)) {
      removeFile(logoPath)
      return res.status(500).json({ error: '封面文件名生成失败' })
    }
    res.json({ ok: true, path: `/api/uploads/${logoName}` })
  } catch (err) {
    removeFile(req.file.path)
    removeFile(logoPath)
    console.error('[templates/upload-logo] 转 webp 失败：', err)
    res.status(400).json({ error: `封面图解析失败，请确认上传的是有效图片（${err?.message || '未知原因'}）` })
  }
})

export default router
