import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { apiFetch } from '@/lib/api'

/** 关过一次之后就不再弹「首次进入」的那份文案，但提醒本身每次进入都会展示。 */
const SEEN_KEY = 'poolux_entry_notice_seen'
/** BrowserTipModal 的「已关闭」标记：两个弹窗都在首访出现，需要错开，不能叠在一起。 */
const BROWSER_TIP_KEY = 'poolux_browser_tip_dismissed'
const BROWSER_TIP_EVENT = 'poolux:browser-tip-closed'

const SHOW_DELAY_MS = 600
/** 兜底的等待上限：浏览器建议弹窗万一一直不关，提醒也不能无限期不显示。 */
const MAX_TIP_WAIT_MS = 60_000

/** 东八区本地时间字符串（'YYYY-MM-DDTHH:mm'）→ 毫秒时间戳；非法时返回 null。 */
function parseUtc8Time(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const stamp = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`).getTime()
  return Number.isFinite(stamp) ? stamp : null
}

/**
 * 等浏览器建议弹窗先关掉。
 * 首访时那个弹窗 800ms 后才出现，两个弹窗同时压在屏幕上很难看，所以这里让一步。
 * 未关闭过 → 等；已经关过 → 直接放行。
 */
function waitForBrowserTip(): Promise<void> {
  if (localStorage.getItem(BROWSER_TIP_KEY)) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.removeEventListener(BROWSER_TIP_EVENT, finish)
      clearInterval(poller)
      clearTimeout(fallback)
      resolve()
    }
    const poller = setInterval(() => {
      if (localStorage.getItem(BROWSER_TIP_KEY)) finish()
    }, 400)
    const fallback = setTimeout(finish, MAX_TIP_WAIT_MS)
    window.addEventListener(BROWSER_TIP_EVENT, finish)
  })
}

/**
 * 入站提醒：用户每次进入站点都会弹出，内容和按钮文字由后台「入站提醒」配置。
 * 首次进入（本机没关过提醒）可以显示另一份文案。
 */
export function EntryNoticeModal() {
  const [content, setContent] = useState('')
  const [buttonText, setButtonText] = useState('知道了')
  const [autoCloseSeconds, setAutoCloseSeconds] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isAnimated, setIsAnimated] = useState(false)
  const closedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  /* 拉取后台配置 → 判断该不该展示 → 等浏览器建议弹窗让位后再出现 */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let settings: Record<string, string> = {}
      try {
        settings = await apiFetch('/api/site-settings') as Record<string, string>
      } catch {
        return
      }
      if (cancelled) return

      // 「首次进入」按浏览器判定。这里的关键点是：**不管这次弹不弹，都要记下「来过」**，
      // 否则后台是在站点上线一段时间后才打开提醒时，所有老用户都会被当成第一次进来，
      // 每人都会看到那份欢迎语。
      const isFirstVisit = !localStorage.getItem(SEEN_KEY)
      const markVisited = () => localStorage.setItem(SEEN_KEY, '1')

      if (settings.notice_enabled !== '1') { markVisited(); return }

      // 到了后台设定的截止时间（东八区）就不再出现
      const expireAt = parseUtc8Time(settings.notice_expire_at || '')
      if (expireAt != null && Date.now() >= expireAt) { markVisited(); return }

      const text = (isFirstVisit
        ? (settings.notice_first_content || settings.notice_content)
        : settings.notice_content) || ''
      if (!text.trim()) { markVisited(); return }

      await waitForBrowserTip()
      if (cancelled || closedRef.current) return

      setTimeout(() => {
        if (cancelled || closedRef.current) return
        const seconds = Math.max(0, Math.round(Number(settings.notice_auto_close_seconds) || 0))
        setContent(text)
        setButtonText(settings.notice_button_text?.trim() || '知道了')
        setAutoCloseSeconds(seconds)
        setRemaining(seconds)
        setIsOpen(true)
        document.body.style.overflow = 'hidden'
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setIsAnimated(true))
        })
      }, SHOW_DELAY_MS)
    })()
    return () => { cancelled = true }
  }, [])

  const handleClose = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    setIsAnimated(false)
    setTimeout(() => {
      setIsOpen(false)
      document.body.style.overflow = ''
      // 关掉之后，下次进入看到的就是「非首次」的那份文案
      localStorage.setItem(SEEN_KEY, '1')
    }, 200)
  }, [])

  /* 自动关闭倒计时 */
  useEffect(() => {
    if (!isOpen || autoCloseSeconds <= 0) return
    timerRef.current = window.setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          if (timerRef.current != null) window.clearInterval(timerRef.current)
          handleClose()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [isOpen, autoCloseSeconds, handleClose])

  if (!isOpen) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose()
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          transition: 'opacity 0.2s ease',
          opacity: isAnimated ? 1 : 0,
        }}
      />
      <div
        className="relative rounded-xl p-6 max-w-md w-full"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '0.5px solid rgba(0, 0, 0, 0.08)',
          boxShadow: '0 2px 20px rgba(0, 0, 0, 0.12)',
          transform: isAnimated ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
          opacity: isAnimated ? 1 : 0,
          transition: 'transform 0.2s ease, opacity 0.2s ease',
        }}
      >
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-1 rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center">
          {content.split('\n').map((line, i) => (
            <p
              key={i}
              className={i === 0 ? 'text-sm font-medium' : 'text-xs mt-2'}
              style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'pre-wrap' }}
            >
              {line || '\u00a0'}
            </p>
          ))}
          <button
            onClick={handleClose}
            className="mt-5 px-6 py-2 rounded-md text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--accent)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent)' }}
          >
            {buttonText}{remaining > 0 ? `（${remaining}）` : ''}
          </button>
          {autoCloseSeconds > 0 && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {remaining} 秒后自动关闭
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
