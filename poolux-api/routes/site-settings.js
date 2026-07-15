import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getSiteSettings, updateSiteSetting } from '../db.js'

const router = Router()

// GET — 公开
router.get('/', (_req, res) => {
  res.json(getSiteSettings())
})

// PUT — 鉴权，批量更新
router.put('/', authMiddleware, (req, res) => {
  try {
    const settings = req.body
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: '无效的设置数据' })
    }
    // 只允许写入已知字段，避免脏 key；兼容旧字段名 hero_slogan
    const allowed = new Set(['slogan', 'intro_line1', 'intro_line2', 'copyright', 'contact_href'])
    Object.entries(settings).forEach(([key, value]) => {
      const normalizedKey = key === 'hero_slogan' ? 'slogan' : key
      if (!allowed.has(normalizedKey)) return
      updateSiteSetting(normalizedKey, String(value ?? ''))
    })
    res.json({ ok: true, settings: getSiteSettings() })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

export default router