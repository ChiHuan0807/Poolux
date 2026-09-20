import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getAllResources, getVisibleResources, getResourceById, createResource,
  updateResource, deleteResource, toggleHidden,
} from '../db.js'
import { UPLOADS_DIR, uploadFilePath } from '../paths.js'
import { BINARY_EXTS, IMAGE_EXTS, hasAllowedExt, safeUploadName, webpTargetName } from '../upload-files.js'
import { normalizeExternalUrl, normalizeAssetUrl, normalizeAssetUrlList } from '../safe-url.js'

function deleteFile(urlOrPath) {
  const abs = uploadFilePath(urlOrPath)
  if (!abs) return
  try { if (existsSync(abs)) unlinkSync(abs) } catch { /* ignore */ }
}

const router = Router()

// 允许上传的类型：图片（转 webp）+ .bin 等二进制附件（原样保留，仅用于下载）
const ALLOWED_EXTS = [...IMAGE_EXTS, ...BINARY_EXTS]

// 文件名完全由服务端生成：白名单扩展名 + 随机名，客户端提供的 originalname 只用于判断类型
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, safeUploadName('res-', file.originalname, ALLOWED_EXTS, '.bin')),
})

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, ALLOWED_EXTS)) {
      return cb(new Error('不支持的文件类型（仅支持图片与 .bin/.zip/.7z 等附件）'))
    }
    cb(null, true)
  },
})

// 图片 MIME 类型
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/avif']

const MAX_ID_LENGTH = 64
const MAX_NAME_LENGTH = 120
const MAX_AUTHOR_LENGTH = 100
const MAX_URL_LENGTH = 2000

/**
 * 统一的入参校验：长度上限 + 资源 ID 白名单字符，避免超长/畸形数据写库。
 * 图片字段（icon / banner）与下载地址都过协议白名单：
 * 它们最终会渲染成 <img src> 或下载链接，写入 `javascript:` 等于开放存储型 XSS。
 */
function validateResourceInput(body, { requireId }) {
  const id = typeof body?.id === 'string' ? body.id.trim() : String(body?.id ?? '').trim()
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (requireId) {
    if (!id) throw new Error('资源 ID 不能为空')
    if (id.length > MAX_ID_LENGTH) throw new Error(`资源 ID 过长（最多 ${MAX_ID_LENGTH} 字符）`)
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('资源 ID 只能包含字母、数字、点、下划线和短横线')
  }
  if (!name) throw new Error('资源名称不能为空')
  if (name.length > MAX_NAME_LENGTH) throw new Error(`资源名称过长（最多 ${MAX_NAME_LENGTH} 字符）`)
  const author = typeof body?.author === 'string' ? body.author.trim() : ''
  if (author.length > MAX_AUTHOR_LENGTH) throw new Error(`作者名过长（最多 ${MAX_AUTHOR_LENGTH} 字符）`)
  // 购买链接会被渲染成 <a href>，必须做协议白名单（挡住 javascript: 之类）
  const purchaseLink = normalizeExternalUrl(body?.purchase_link, { label: '购买链接', maxLength: MAX_URL_LENGTH })

  const icon = normalizeAssetUrl(body?.icon, { label: '资源图标' })
  // banner 兼容字符串与数组两种写法
  const rawBanners = Array.isArray(body?.banners)
    ? body.banners
    : (typeof body?.banner === 'string' && body.banner ? [body.banner] : [])
  const banners = normalizeAssetUrlList(rawBanners, { label: '资源横幅' })

  // device_options[].downloadUrl 会被前台 fetch 下载，同样限定协议
  const rawOptions = Array.isArray(body?.device_options) ? body.device_options : []
  if (rawOptions.length > 50) throw new Error('设备选项过多（最多 50 个）')
  const deviceOptions = rawOptions.map((opt) => {
    const label = typeof opt?.label === 'string' ? opt.label.trim().slice(0, MAX_NAME_LENGTH) : ''
    const optionId = typeof opt?.id === 'string' ? opt.id.trim().slice(0, MAX_ID_LENGTH) : label
    return {
      ...opt,
      id: optionId,
      label,
      downloadUrl: normalizeAssetUrl(opt?.downloadUrl, { label: '下载地址' }),
    }
  })

  return { ...body, id, name, author, icon, banners, device_options: deviceOptions, purchase_link: purchaseLink }
}

// GET /api/resources — 公开接口，仅显示未隐藏的资源
router.get('/', (_req, res) => {
  res.json(getVisibleResources())
})

// GET /api/resources/all — 管理接口，显示所有资源（含隐藏）
router.get('/all', authMiddleware, (_req, res) => {
  res.json(getAllResources())
})

// GET /api/resources/:id — 公开接口
// 隐藏资源只从列表里过滤是不够的：知道 ID 依然能读到（已下架/待发布的内容会继续公开可见），
// 因此这里对 hidden 记录直接返回 404。管理端读取用的是 /api/resources/all。
router.get('/:id', (req, res) => {
  const r = getResourceById(req.params.id)
  if (!r || r.hidden) return res.status(404).json({ error: '资源不存在' })
  res.json(r)
})

// POST /api/resources — 需鉴权
router.post('/', authMiddleware, (req, res) => {
  try {
    createResource(validateResourceInput(req.body, { requireId: true }))
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// PUT /api/resources/:id — 需鉴权
router.put('/:id', authMiddleware, (req, res) => {
  try {
    if (!getResourceById(req.params.id)) return res.status(404).json({ error: '资源不存在' })
    updateResource(req.params.id, validateResourceInput(req.body, { requireId: false }))
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

// DELETE /api/resources/delete-file — 删除单个上传文件（icon/banner等）
// 必须注册在 '/:id' 之前，否则会被 '/:id' 抢先匹配，这个接口永远不生效
router.delete('/delete-file', authMiddleware, (req, res) => {
  const fileUrl = req.query.url
  if (!fileUrl) return res.status(400).json({ error: '缺少 url 参数' })
  // uploadFilePath 已保证只在 uploads/ 目录内删除，越界路径返回 null
  deleteFile(decodeURIComponent(String(fileUrl)))
  res.json({ ok: true })
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

// POST /api/resources/upload — 文件上传，需鉴权
// 图片一律转 webp；非图片附件按白名单扩展名保留（文件名仍是服务端生成的随机名）
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })

  try {
    if (IMAGE_MIMES.includes(req.file.mimetype)) {
      // 图片 → webp
      const webpName = webpTargetName(req.file.filename)
      const webpPath = join(req.file.destination, webpName)
      await sharp(req.file.path)
        .rotate()
        .webp({ quality: 82 })
        .toFile(webpPath)
      try { unlinkSync(req.file.path) } catch { /* ignore */ }
      res.json({ ok: true, filename: webpName, originalname: req.file.originalname, path: `/api/uploads/${webpName}` })
    } else {
      // 非图片附件（如 .bin）保持原样，文件名已由服务端生成
      res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname, path: `/api/uploads/${req.file.filename}` })
    }
  } catch (err) {
    // 转换失败：删除落盘的原始文件并报错，绝不把未转码的原文件当作图片返回
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    console.error('[resources/upload] 转 webp 失败：', err)
    res.status(400).json({ error: `图片解析失败，请确认文件是有效的图片（${err?.message || '未知原因'}）` })
  }
})

export default router
