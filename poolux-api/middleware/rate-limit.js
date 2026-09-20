// 极简内存限流：够用来挡住登录爆破与匿名接口刷量，不引入额外依赖。
//
// 说明：计数放在进程内存里，重启即清空；多进程部署时每个进程各算各的。
// 对本站这种单进程 Node 服务足够，且不会因为 Redis 不可用而把登录整挂。

const buckets = new Map()

// 定期清理过期桶，避免长时间运行后内存里堆满 key
const SWEEP_INTERVAL_MS = 10 * 60 * 1000
let sweeper = null
function ensureSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }, SWEEP_INTERVAL_MS)
  // 不要因为这个定时器阻塞进程退出
  if (typeof sweeper.unref === 'function') sweeper.unref()
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * 创建一个限流中间件。
 * @param {object} options
 * @param {number} options.windowMs 统计窗口（毫秒）
 * @param {number} options.max 窗口内允许的最大请求数
 * @param {(req) => string} [options.key] 自定义限流 key
 * @param {string} [options.message] 超限时的错误文案
 */
export function rateLimit({ windowMs, max, key, message = '请求过于频繁，请稍后再试' }) {
  ensureSweeper()
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now()
    const bucketKey = key ? key(req) : clientIp(req)
    let bucket = buckets.get(bucketKey)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(bucketKey, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ error: message })
    }
    next()
  }
}

/** 登录成功/失败后手动清空某个 key 的计数（例如成功登录就把失败次数归零） */
export function resetRateLimit(bucketKey) {
  buckets.delete(bucketKey)
}
