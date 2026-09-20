import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember, reorderTeamMembers,
} from '../db.js'
import { UPLOADS_DIR } from '../paths.js'
import { IMAGE_EXTS, hasAllowedExt, safeUploadName, webpTargetName } from '../upload-files.js'
import { normalizeExternalUrl, normalizeAssetUrl } from '../safe-url.js'

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, safeUploadName('team-', file.originalname, IMAGE_EXTS, '.webp')),
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, IMAGE_EXTS)) {
      return cb(new Error('仅支持图片文件（JPG/PNG/GIF/WebP 等）'))
    }
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(new Error('文件类型不是图片'))
    }
    cb(null, true)
  },
})

const MAX_NAME_LENGTH = 60
const MAX_ROLE_LENGTH = 40
const MAX_ROLES = 10

/** 团队成员成员的字段校验：名称/角色长度 + 主页链接协议白名单（挡住 javascript: 外链 XSS） */
function normalizeMemberInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) throw new Error('成员名称不能为空')
  if (name.length > MAX_NAME_LENGTH) throw new Error(`成员名称过长（最多 ${MAX_NAME_LENGTH} 字）`)
  const rawRoles = Array.isArray(body?.roles) ? body.roles : []
  if (rawRoles.length > MAX_ROLES) throw new Error(`角色最多 ${MAX_ROLES} 个`)
  const roles = rawRoles.map((role) => {
    const value = String(role ?? '').trim()
    if (value.length > MAX_ROLE_LENGTH) throw new Error(`单个角色名过长（最多 ${MAX_ROLE_LENGTH} 字）`)
    return value
  }).filter(Boolean)
  // 头像会渲染成 <img src>，主页链接会渲染成 <a href>：两者都必须过协议白名单
  const avatar = normalizeAssetUrl(body?.avatar, { label: '头像地址' })
  const href = normalizeExternalUrl(body?.href, { label: '主页链接', allowRelative: false, maxLength: 2000 })
  const sortOrder = Number(body?.sort_order)
  return {
    ...body,
    name,
    roles,
    avatar,
    href,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  }
}

const router = Router()

// GET — 公开
router.get('/', (_req, res) => {
  res.json(getTeamMembers())
})

// POST — 鉴权，创建
router.post('/', authMiddleware, (req, res) => {
  try {
    const result = createTeamMember(normalizeMemberInput(req.body))
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
    updateTeamMember(req.params.id, normalizeMemberInput(req.body))
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

// POST /upload — 鉴权，头像上传（裁成 1:1 再转 webp）
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' })
  const webpName = webpTargetName(req.file.filename)
  const webpPath = join(req.file.destination, webpName)
  try {
    await sharp(req.file.path).rotate().resize(200, 200, { fit: 'cover' }).webp({ quality: 82 }).toFile(webpPath)
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    res.json({ ok: true, path: `/api/uploads/${webpName}` })
  } catch (err) {
    try { unlinkSync(req.file.path) } catch { /* ignore */ }
    console.error('[team-members/upload] 转 webp 失败：', err)
    res.status(400).json({ error: `头像解析失败，请确认文件是有效的图片（${err?.message || '未知原因'}）` })
  }
})

export default router