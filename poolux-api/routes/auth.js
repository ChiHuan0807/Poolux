import { Router } from 'express'
import { verifyPassword, changePassword, changeUsername, updateDefaultAuthor } from '../db.js'
import { signToken, authMiddleware } from '../middleware/auth.js'

const router = Router()

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' })
  }
  const user = verifyPassword(username, password)
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  const token = signToken(user)
  res.cookie('token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  })
  res.json({ ok: true, token, username: user.username, defaultAuthor: user.default_author || '' })
})

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('token')
  res.json({ ok: true })
})

// GET /api/auth/check
router.get('/check', authMiddleware, (req, res) => {
  res.json({ ok: true, username: req.user.username, defaultAuthor: req.user.default_author || '' })
})

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请输入旧密码和新密码' })
  }
  const user = verifyPassword(req.user.username, oldPassword)
  if (!user) {
    return res.status(401).json({ error: '旧密码错误' })
  }
  changePassword(user.id, newPassword)
  res.json({ ok: true })
})

// POST /api/auth/change-username
router.post('/change-username', authMiddleware, (req, res) => {
  const { newUsername } = req.body
  if (!newUsername || !newUsername.trim()) {
    return res.status(400).json({ error: '用户名不能为空' })
  }
  try {
    changeUsername(req.user.id, newUsername.trim())
    res.json({ ok: true, username: newUsername.trim() })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: '该用户名已被占用' })
    }
    res.status(500).json({ error: '修改失败' })
  }
})

// POST /api/auth/change-default-author
router.post('/change-default-author', authMiddleware, (req, res) => {
  const { defaultAuthor } = req.body
  if (defaultAuthor === undefined || defaultAuthor === null) {
    return res.status(400).json({ error: '参数缺失' })
  }
  updateDefaultAuthor(req.user.id, defaultAuthor.trim())
  res.json({ ok: true, defaultAuthor: defaultAuthor.trim() })
})

export default router