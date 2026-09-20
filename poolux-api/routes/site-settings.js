import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getSiteSettings, updateSiteSetting } from '../db.js'
import { normalizeExternalUrl } from '../safe-url.js'

const router = Router()

/**
 * 入站提醒字段的类型收敛。非提醒字段原样返回。
 * 返回 null 表示该字段不写入（空值走默认值即可）。
 */
function coerceNoticeValue(key, value) {
  switch (key) {
    case 'notice_enabled':
      return value === '1' ? '1' : '0'
    case 'notice_auto_close_seconds': {
      const n = Math.round(Number(value))
      if (!Number.isFinite(n) || n < 0) return '0'
      // 上限 1 小时：再长也没有「自动关闭」的意义，还会让弹窗看起来卡住
      return String(Math.min(3600, n))
    }
    case 'notice_expire_at': {
      const v = value.trim()
      if (!v) return ''
      // 只接受 datetime-local 的 'YYYY-MM-DDTHH:mm'（东八区本地时间），
      // 多余的部分（秒、时区后缀）一并规范化掉，方便前端统一按 +08:00 解析。
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
      if (!m) throw new Error('自动关闭时间格式不正确，应为 YYYY-MM-DDTHH:mm')
      const [, y, mo, d, h, mi] = m
      const stamp = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`).getTime()
      if (!Number.isFinite(stamp)) throw new Error('自动关闭时间不是有效日期')
      return `${y}-${mo}-${d}T${h}:${mi}`
    }
    default:
      return value
  }
}

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
    const limits = new Map([
      ['slogan', 500],
      ['intro_line1', 1000],
      ['intro_line2', 1000],
      ['copyright', 500],
      ['contact_href', 2000],
      // 入站提醒
      ['notice_enabled', 1],
      ['notice_content', 4000],
      ['notice_first_content', 4000],
      ['notice_button_text', 40],
      ['notice_auto_close_seconds', 6],
      ['notice_expire_at', 20],
    ])
    Object.entries(settings).forEach(([key, value]) => {
      const normalizedKey = key === 'hero_slogan' ? 'slogan' : key
      const limit = limits.get(normalizedKey)
      if (limit == null) return
      const normalizedValue = String(value ?? '')
      if (normalizedValue.length > limit) {
        throw new Error(`${normalizedKey} 超过最大长度 ${limit}`)
      }
      // 入站提醒的几个字段要按类型收敛：开关只能是 0/1、倒计时只能是非负整数、
      // 截止时间只能是「东八区本地时间」格式，否则前端解析出 Invalid Date 会让提醒永远不弹或一直弹。
      const coerced = coerceNoticeValue(normalizedKey, normalizedValue)
      if (coerced == null) return
      // contact_href 会被官网首页渲染成 <a href>：写入 javascript: 等协议等于存储型 XSS，
      // 这里和其它外链字段保持同一套协议白名单（允许 / # 开头的站内相对链接）。
      if (normalizedKey === 'contact_href') {
        updateSiteSetting(normalizedKey, normalizeExternalUrl(normalizedValue, {
          label: '联系我们链接',
          maxLength: limit,
        }))
        return
      }
      updateSiteSetting(normalizedKey, coerced)
    })
    res.json({ ok: true, settings: getSiteSettings() })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

export default router