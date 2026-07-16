/** 离线 APK：POOLUX STUDIO 启动页 */
import { useState, useEffect } from 'react'

const SHOW_MS = 1800

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fade, setFade] = useState(false)

  useEffect(() => {
    const t1 = window.setTimeout(() => setFade(true), SHOW_MS - 400)
    const t2 = window.setTimeout(onDone, SHOW_MS)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [onDone])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9f9f9',
        transition: 'opacity 0.4s ease-out',
        opacity: fade ? 0 : 1,
      }}
    >
      <div style={{ textAlign: 'center', lineHeight: 1.35 }}>
        <div
          style={{
            fontFamily: '"Poolux Rounded", "MiSans Rounded SC", "MiSans Rounded", sans-serif',
            fontWeight: 600,
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: '#3d3d3d',
          }}
        >
          POOLUX
        </div>
        <div
          style={{
            fontFamily: '"Poolux Rounded", "MiSans Rounded SC", "MiSans Rounded", sans-serif',
            fontWeight: 600,
            fontSize: '2rem',
            letterSpacing: '0.08em',
            color: '#3d3d3d',
          }}
        >
          STUDIO
        </div>
      </div>
    </div>
  )
}