import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { getUserById } from '../db.js'

// ── JWT 密钥 ──
// 以前这里有一个硬编码的兜底密钥（'poolux-studio-secret-key-2026'）。
// 源码一旦泄露，任何人都能离线签出合法 token 直接冒充管理员，所以必须去掉。
// 现在的策略：
//   * 配了足够长的 JWT_SECRET → 用它
//   * 没配或太短 → 启动时随机生成一个（进程内有效），并打印醒目告警
// 随机密钥的副作用是重启后所有人需要重新登录，这是可接受的。
const MIN_SECRET_LENGTH = 32
const configuredSecret = (process.env.JWT_SECRET || '').trim()

export const JWT_SECRET = configuredSecret.length >= MIN_SECRET_LENGTH
  ? configuredSecret
  : crypto.randomBytes(48).toString('hex')

if (configuredSecret.length === 0) {
  console.warn(
    '[auth] 未配置 JWT_SECRET，已随机生成临时密钥（重启后所有登录失效）。\n' +
    '[auth] 请在 poolux-api/.env 中设置 JWT_SECRET（至少 32 位随机字符串）后重启。',
  )
} else if (configuredSecret.length < MIN_SECRET_LENGTH) {
  console.warn(
    `[auth] JWT_SECRET 长度只有 ${configuredSecret.length}，强度不足，已改用随机临时密钥。\n` +
    `[auth] 请在 poolux-api/.env 中改为至少 ${MIN_SECRET_LENGTH} 位的随机字符串（可用 "openssl rand -hex 32" 生成）。`,
  )
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' },
  )
}

export function authMiddleware(req, res, next) {
  const token = req.cookies?.token
    || (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : '')
  if (!token) return res.status(401).json({ error: '未登录' })
  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return res.status(401).json({ error: '登录已过期' })
  }
  // 以数据库为准：账号被删除/改名后旧 token 立即失效，且能拿到最新的 default_author
  const user = getUserById(payload.id)
  if (!user) return res.status(401).json({ error: '登录已过期' })
  // 改过密码之后，之前签发的 token（可能已经在别处泄露）一律作废
  const issuedAt = Number(payload.iat || 0)
  if (Number(user.password_changed_at || 0) > issuedAt) {
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }
  req.user = { id: user.id, username: user.username, default_author: user.default_author || '' }
  next()
}
