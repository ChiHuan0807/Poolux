import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getUsedDevices, renameDevice } from '../db.js'

const router = Router()

// GET /api/devices — 管理端：列出「相册表盘模板」支持的机型名，以及各自被哪些模板引用
// （资源标签、相册分类不参与统计，它们是独立维护的）
router.get('/', authMiddleware, (_req, res) => {
  res.json(getUsedDevices())
})

// POST /api/devices/rename — 管理端：把某个机型名在全部相册表盘模板里统一改掉
// body: { from: '小米手环 10', to: '小米手环 11' }
// 只改模板，不碰资源标签与相册分类。
router.post('/rename', authMiddleware, (req, res) => {
  try {
    const from = String(req.body?.from ?? '').trim()
    const to = String(req.body?.to ?? '').trim()
    if (!from) throw new Error('请选择要修改的设备名称')
    if (!to) throw new Error('请输入新的设备名称')
    if (to.length > 60) throw new Error('设备名称过长（最多 60 字）')
    res.json(renameDevice(from, to))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router
