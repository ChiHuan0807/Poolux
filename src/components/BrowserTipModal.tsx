import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const STORAGE_KEY = 'poolux_browser_tip_dismissed'

export function BrowserTipModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [isAnimated, setIsAnimated] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY)
    if (dismissed) return
    const timer = setTimeout(() => {
      setIsOpen(true)
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsAnimated(true))
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    setIsAnimated(false)
    setTimeout(() => {
      setIsOpen(false)
      document.body.style.overflow = ''
      localStorage.setItem(STORAGE_KEY, '1')
      // 入站提醒在等这个弹窗让位，关掉后通知它一声
      window.dispatchEvent(new Event('poolux:browser-tip-closed'))
    }, 200)
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
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
        className="relative rounded-xl p-6 max-w-sm w-full"
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
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center">
          <h3
            className="text-base font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            浏览器建议
          </h3>
          <p
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            为确保使用体验，建议使用 Edge、Via 或者 Chrome 浏览器
          </p>
          <button
            onClick={handleClose}
            className="mt-5 px-6 py-2 rounded-md text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--accent)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--accent-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--accent)'
            }}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}