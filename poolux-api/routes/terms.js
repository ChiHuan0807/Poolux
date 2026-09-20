import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getTermsSettings, updateTermsSettings } from '../db.js'

const router = Router()

const FIELD_LIMITS = {
  terms_title: 200,
  terms_content: 100000,
  terms_updated_at: 100,
  terms_signature: 200,
}

function normalizeTerms(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('无效的协议数据')
  }

  const terms = {}
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    const value = String(input[key] ?? '')
    if (value.length > limit) throw new Error(`${key} 超过最大长度 ${limit}`)
    terms[key] = value
  }
  if (!terms.terms_title.trim()) throw new Error('协议标题不能为空')
  if (!terms.terms_content.trim()) throw new Error('协议正文不能为空')
  return terms
}

// 公开读取；未初始化时由前端使用内置默认协议。
router.get('/', (_req, res) => {
  res.json(getTermsSettings())
})

// 管理员保存；事务完成后直接回读，前端据此确认已持久化。
router.put('/', authMiddleware, (req, res) => {
  try {
    const requested = normalizeTerms(req.body)
    const saved = updateTermsSettings(requested)
    const persisted = saved.initialized
      && Object.keys(FIELD_LIMITS).every(key => saved.terms[key] === requested[key])
    if (!persisted) return res.status(500).json({ error: '协议写入后校验失败' })
    res.json({ ok: true, persisted: true, ...saved })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router