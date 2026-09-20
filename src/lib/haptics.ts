/**
 * 轻震动反馈。
 *
 * 运行环境分两类：
 *  - 浏览器 / Android WebView：走标准的 Vibration API（Chrome、Android WebView 都实现了）。
 *  - 桌面浏览器 / iOS Safari：没有该 API，静默跳过，调用方不需要自己判断平台。
 *
 * 震动本身很短，再加一层冷却时间，避免快速滑动时每次 move 都触发、连成一串嗡嗡声。
 */

let lastAt = 0

function vibrate(pattern: number): void {
  if (typeof navigator === 'undefined') return
  const fn = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate
  if (typeof fn !== 'function') return
  try {
    fn.call(navigator, pattern)
  } catch {
    /* 不支持或权限被拒时忽略：震动只是锦上添花，不能影响交互 */
  }
}

/** 轻微「哒」一下：切换标签、点按钮等。 */
export function hapticTick(): void {
  const now = Date.now()
  if (now - lastAt < 45) return
  lastAt = now
  vibrate(6)
}

/** 稍强一点的确认反馈：滑杆推到两端、拖拽越过阈值等。 */
export function hapticEdge(): void {
  const now = Date.now()
  if (now - lastAt < 70) return
  lastAt = now
  vibrate(14)
}
