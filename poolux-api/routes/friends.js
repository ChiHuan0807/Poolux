import { Router } from 'express'
import { getFriendLinks, createFriendLink, updateFriendLink, deleteFriendLink, reorderFriendLinks } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { normalizeExternalUrl } from '../safe-url.js'

const router = Router()

const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 200

/**
 * 友链入参校验。
 * url 必须过协议白名单：前台会把它渲染成 <a href>，写入 javascript: 就等于
 * 给站点加了一个「点击即执行」的存储型 XSS 入口。
 */
function normalizeFriendInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const url = normalizeExternalUrl(body?.url, { label: '链接地址', allowRelative: false, required: true, maxLength: 2000 })
  if (!name) throw new Error('名称和链接为必填')
  if (name.length > MAX_NAME_LENGTH) throw new Error(`名称过长（最多 ${MAX_NAME_LENGTH} 字）`)
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`描述过长（最多 ${MAX_DESCRIPTION_LENGTH} 字）`)
  const sortOrder = Number(body?.sort_order)
  return { name, url, description, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 }
}

// GET /api/friends - 公开获取友链列表
router.get('/', (_req, res) => {
  try {
    const links = getFriendLinks()
    res.json(links)
  } catch (err) {
    res.status(500).json({ error: '获取友链失败' })
  }
})

// POST /api/friends - 添加友链（需登录）
router.post('/', authMiddleware, (req, res) => {
  try {
    const payload = normalizeFriendInput(req.body)
    const result = createFriendLink(payload)
    res.json({ id: result.lastInsertRowid, ...payload })
  } catch (err) {
    res.status(400).json({ error: err.message || '添加失败' })
  }
})

// PUT /api/friends/reorder - 拖动排序（需登录）—— 必须在 /:id 之前
router.put('/reorder', authMiddleware, (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须是数组' })
    reorderFriendLinks(ids)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: '排序失败' })
  }
})

// PUT /api/friends/:id - 编辑友链（需登录）
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const payload = normalizeFriendInput(req.body)
    updateFriendLink(req.params.id, payload)
    res.json({ ok: true, ...payload })
  } catch (err) {
    res.status(400).json({ error: err.message || '更新失败' })
  }
})

// DELETE /api/friends/:id - 删除友链（需登录）
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    deleteFriendLink(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: '删除失败' })
  }
})

export default router