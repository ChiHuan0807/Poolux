import { Router } from 'express'
import { getFriendLinks, createFriendLink, updateFriendLink, deleteFriendLink, reorderFriendLinks } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

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
    const { name, url, description, sort_order } = req.body
    if (!name || !url) return res.status(400).json({ error: '名称和链接为必填' })
    const result = createFriendLink({ name, url, description, sort_order })
    res.json({ id: result.lastInsertRowid, ...req.body })
  } catch (err) {
    res.status(500).json({ error: '添加失败' })
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
    const { name, url, description, sort_order } = req.body
    if (!name || !url) return res.status(400).json({ error: '名称和链接为必填' })
    updateFriendLink(req.params.id, { name, url, description, sort_order })
    res.json({ ok: true, ...req.body })
  } catch (err) {
    res.status(500).json({ error: '更新失败' })
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