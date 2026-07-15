import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface UnderConstructionModalProps {
  isOpen: boolean
  onClose: () => void
}

export function UnderConstructionModal({ isOpen, onClose }: UnderConstructionModalProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimated, setIsAnimated] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      document.body.style.overflow = 'hidden'
      const timer = setTimeout(() => setIsAnimated(true), 50)
      return () => clearTimeout(timer)
    } else {
      setIsAnimated(false)
      const timer = setTimeout(() => {
        setIsVisible(false)
        document.body.style.overflow = ''
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  if (!isVisible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
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
          onClick={onClose}
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
            正在施工中~
          </h3>
          <p
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            该功能正在开发中，敬请期待！
          </p>
          <button
            onClick={onClose}
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