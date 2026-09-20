import { Router } from 'express'
import { verifyPassword, changePassword, changeUsername, updateDefaultAuthor } from '../db.js'
import { signToken, authMiddleware } from '../middleware/auth.js'
import { rateLimit, resetRateLimit, clientIp } from '../middleware/rate-limit.js'

const router = Router()

const MIN_PASSWORD_LENGTH = 8
const MIN_USERNAME_LENGTH = 2
const MAX_USERNAME_LENGTH = 32

/** 用「IP + 用户名」做限流 key：既挡单账号爆破，也挡同一 IP 换账号扫库 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `login:${clientIp(req)}:${String(req.body?.username || '').slice(0, 64).toLowerCase()}`,
  message: '登录尝试过于频繁，请 15 分钟后再试',
})

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  key: (req) => `login-ip:${clientIp(req)}`,
  message: '登录尝试过于频繁，请稍后再试',
})

/**
 * 登录 Cookie 的属性。
 * - httpOnly：JS 读不到，降低 XSS 窃取风险
 * - sameSite=lax：阻断跨站 POST 携带凭证（CSRF 主要入口）
 * - secure：仅在 HTTPS 请求上打 secure，避免本机 http 调试时 Cookie 失效
 */
function cookieOptions(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const isHttps = req.secure || forwardedProto === 'https'
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
}

// POST /api/auth/login
router.post('/login', loginIpLimiter, loginLimiter, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' })
  }
  const user = verifyPassword(username, password)
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  resetRateLimit(`login:${clientIp(req)}:${username.toLowerCase()}`)
  const token = signToken(user)
  // token 只通过 httpOnly Cookie 下发，不再放进响应体（避免被日志/XSS 顺手读走）
  res.cookie('token', token, cookieOptions(req))
  res.json({ ok: true, username: user.username, defaultAuthor: user.default_author || '' })
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const { maxAge: _maxAge, ...options } = cookieOptions(req)
  res.clearCookie('token', options)
  res.json({ ok: true })
})

// GET /api/auth/check
router.get('/check', authMiddleware, (req, res) => {
  res.json({ ok: true, username: req.user.username, defaultAuthor: req.user.default_author || '' })
})

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, (req, res) => {
  const oldPassword = typeof req.body?.oldPassword === 'string' ? req.body.oldPassword : ''
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请输入旧密码和新密码' })
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `新密码至少需要 ${MIN_PASSWORD_LENGTH} 位` })
  }
  if (newPassword.length > 200) {
    return res.status(400).json({ error: '新密码过长' })
  }
  if (newPassword === oldPassword) {
    return res.status(400).json({ error: '新密码不能与旧密码相同' })
  }
  const user = verifyPassword(req.user.username, oldPassword)
  if (!user) {
    return res.status(401).json({ error: '旧密码错误' })
  }
  changePassword(user.id, newPassword)
  // 改密会让所有旧 token 作废，这里顺手给当前会话换发新 token，避免管理员被自己踢下线
  res.cookie('token', signToken({ id: user.id, username: user.username }), cookieOptions(req))
  res.json({ ok: true })
})

// POST /api/auth/change-username
router.post('/change-username', authMiddleware, (req, res) => {
  const raw = typeof req.body?.newUsername === 'string' ? req.body.newUsername.trim() : ''
  if (!raw) {
    return res.status(400).json({ error: '用户名不能为空' })
  }
  if (raw.length < MIN_USERNAME_LENGTH || raw.length > MAX_USERNAME_LENGTH) {
    return res.status(400).json({ error: `用户名长度需在 ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} 位之间` })
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(raw)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字、下划线、点和短横线' })
  }
  try {
    changeUsername(req.user.id, raw)
    res.json({ ok: true, username: raw })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: '该用户名已被占用' })
    }
    res.status(500).json({ error: '修改失败' })
  }
})

// POST /api/auth/change-default-author
router.post('/change-default-author', authMiddleware, (req, res) => {
  const raw = req.body?.defaultAuthor
  if (raw === undefined || raw === null) {
    return res.status(400).json({ error: '参数缺失' })
  }
  const defaultAuthor = String(raw).trim()
  if (defaultAuthor.length > 100) {
    return res.status(400).json({ error: '作者名过长（最多 100 字）' })
  }
  updateDefaultAuthor(req.user.id, defaultAuthor)
  res.json({ ok: true, defaultAuthor })
})

export default router
