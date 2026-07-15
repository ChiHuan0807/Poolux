import { useRef, useState, useEffect, useMemo } from 'react'
import { Navbar } from '@/components/Navbar'
import { apiFetch } from '@/lib/api'
import { toExternalUrl } from '@/lib/utils'

const FALLBACK_IMAGES = Array.from({ length: 11 }, (_, i) => `/wf${i + 1}.webp`)

const ALL_IMAGES = [
  ...FALLBACK_IMAGES,
  '/ChiHuan.webp', '/ShanTu.webp', '/Fmkli.webp', '/AzumaChiaki.webp',
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ─── 终末地风格：几何装饰 SVG ─── */
function HexGrid() {
  return (
    <svg className="ef-hex-grid" viewBox="0 0 800 600" fill="none" xmlns="http://www.w3.org/2000/svg">
      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 10 }, (_, col) => {
          const x = col * 85 + (row % 2 ? 42 : 0)
          const y = row * 75
          return (
            <polygon
              key={`${row}-${col}`}
              points={`${x},${y - 30} ${x + 26},${y - 15} ${x + 26},${y + 15} ${x},${y + 30} ${x - 26},${y + 15} ${x - 26},${y - 15}`}
              stroke="var(--ef-cyan)"
              strokeWidth="0.5"
              opacity={0.08 + Math.random() * 0.07}
            />
          )
        })
      )}
    </svg>
  )
}

function CornerBrackets({ className = '' }: { className?: string }) {
  return (
    <svg className={`ef-corner-brackets ${className}`} viewBox="0 0 100 100" fill="none">
      <path d="M0 20 L0 0 L20 0" stroke="var(--ef-cyan)" strokeWidth="1.5" opacity="0.6" />
      <path d="M80 0 L100 0 L100 20" stroke="var(--ef-cyan)" strokeWidth="1.5" opacity="0.6" />
      <path d="M100 80 L100 100 L80 100" stroke="var(--ef-cyan)" strokeWidth="1.5" opacity="0.6" />
      <path d="M20 100 L0 100 L0 80" stroke="var(--ef-cyan)" strokeWidth="1.5" opacity="0.6" />
    </svg>
  )
}

function ScanLine() {
  return <div className="ef-scan-line" />
}

/* ─── 终末地风格标签 ─── */
function TechLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`ef-tech-label ${className}`}>
      <span className="ef-tech-label-dot" />
      {children}
    </span>
  )
}

/* ─── 终末地风格分隔线 ─── */
function TechDivider() {
  return (
    <div className="ef-divider">
      <div className="ef-divider-line" />
      <svg className="ef-divider-diamond" viewBox="0 0 12 12" fill="var(--ef-cyan)">
        <polygon points="6,0 12,6 6,12 0,6" />
      </svg>
      <div className="ef-divider-line" />
    </div>
  )
}

export function Landing() {
  const worksRef = useRef<HTMLDivElement>(null)
  const scrollProgressRef = useRef(0)
  const [, forceUpdate] = useState(0)
  const [imagesLoaded, setImagesLoaded] = useState(false)
  const [worksImages, setWorksImages] = useState<string[]>([])
  const [friendLinks, setFriendLinks] = useState<{ name: string; url: string }[]>([])

  // 从 API 加载作品图片
  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/works', { signal: ac.signal }).then((data: any[]) => {
      if (data.length > 0) {
        setWorksImages(data.map((d: any) => d.image_url))
      }
    }).catch(() => {})
    return () => ac.abort()
  }, [])

  // 从 API 加载友链
  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/friends', { signal: ac.signal }).then((data: any[]) => {
      if (data.length > 0) setFriendLinks(data)
    }).catch(() => {})
    return () => ac.abort()
  }, [])

  // 有效作品列表：API 有数据用 API，否则用本地默认
  const effectiveImages = worksImages.length > 0 ? worksImages : FALLBACK_IMAGES

  useEffect(() => {
    let loaded = 0
    const total = ALL_IMAGES.length
    const check = () => { if (++loaded >= total) setImagesLoaded(true) }
    ALL_IMAGES.forEach(src => {
      const img = new Image()
      img.onload = check
      img.onerror = check
      img.src = src
    })
  }, [])

  const columns = useMemo(() => {
    const s = shuffle(effectiveImages)
    return [
      [...s, ...s, ...s],
      [...shuffle(effectiveImages), ...shuffle(effectiveImages), ...shuffle(effectiveImages)],
      [...shuffle(effectiveImages), ...shuffle(effectiveImages), ...shuffle(effectiveImages)],
    ]
  }, [effectiveImages])

  useEffect(() => {
    let rafId: number
    const tick = () => {
      const el = worksRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const viewH = window.innerHeight
        const raw = (viewH - rect.top) / viewH
        const clamped = Math.max(0, Math.min(raw, 2))
        if (Math.abs(clamped - scrollProgressRef.current) > 0.001) {
          scrollProgressRef.current = clamped
          forceUpdate(n => n + 1)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const sp = scrollProgressRef.current

  return (
    <>
      {!imagesLoaded && (
        <div className="ef-loading-mask">
          <div className="ef-loading-spinner" />
          <TechLabel>INITIALIZING</TechLabel>
        </div>
      )}

      <Navbar />

      <div className="ef-landing-root">
        <HexGrid />
        <div className="ef-grid-overlay" />

        <div className="relative z-10">
          {/* ═══ Hero ═══ */}
          <main className="ef-hero">
            <ScanLine />
            <div className="ef-hero-side-line ef-hero-side-line--left" />
            <div className="ef-hero-side-line ef-hero-side-line--right" />

            <div className="ef-hero-coord ef-hero-coord--left">
              <TechLabel>SECTOR 07</TechLabel>
              <span className="ef-hero-coord-num">31.2°N 121.5°E</span>
            </div>
            <div className="ef-hero-coord ef-hero-coord--right">
              <TechLabel>POOLUX.SYS</TechLabel>
              <span className="ef-hero-coord-num">v2.6.0 // ACTIVE</span>
            </div>

            <div className="ef-hero-content">
              <div className="ef-hero-top-bar">
                <TechLabel>OPERATIONAL TERMINAL</TechLabel>
              </div>

              <h1 className="ef-hero-title">
                <span className="ef-hero-title-main">POOLUX</span>
                <span className="ef-hero-title-sub">STUDIO</span>
              </h1>

              <div className="ef-hero-accent-bar">
                <div className="ef-hero-accent-bar-fill" />
              </div>

              <div className="ef-hero-actions">
                <a href="/resources" className="ef-btn-ghost">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  资源下载
                </a>
              </div>
            </div>
          </main>

          {/* ═══ 我们的作品 ═══ */}
          <section ref={worksRef} className="ef-section ef-works-section">
            <div className="ef-section-header">
              <TechDivider />
              <h2 className="ef-section-title">
                <span className="ef-section-title-prefix">&lt;</span>
                我们的作品
                <span className="ef-section-title-suffix">/&gt;</span>
              </h2>
              <TechLabel>ARCHIVE.LOAD</TechLabel>
            </div>

            <div className="ef-works-gallery">
              {columns.map((col, colIdx) => {
                const dir = colIdx === 1 ? 1 : -1
                const offset = dir * sp * 50
                const innerMarginLeft = colIdx === 1 ? '-100vw' : '0px'

                return (
                  <div key={colIdx} style={{ margin: '0 clamp(24px, 6vw, 100px)' }}>
                    <div
                      className="flex"
                      style={{
                        gap: 'clamp(10px, 2vw, 20px)',
                        marginLeft: innerMarginLeft,
                        transform: `translateX(${offset}vw)`,
                        willChange: 'transform',
                      }}
                    >
                      {col.map((src, i) => (
                        <div key={`${colIdx}-${i}`} className="ef-works-item">
                          <img
                            src={src}
                            alt=""
                            className="ef-works-img"
                            draggable={false}
                          />
                          <div className="ef-works-item-border" />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ═══ 团队成员 ═══ */}
          <section className="ef-section ef-team-section">
            <div className="ef-section-header">
              <TechDivider />
              <h2 className="ef-section-title">
                <span className="ef-section-title-prefix">&lt;</span>
                团队成员
                <span className="ef-section-title-suffix">/&gt;</span>
              </h2>
              <TechLabel>CREW.MANIFEST</TechLabel>
            </div>

            <div className="ef-team-grid">
              {[
                { id: '池焕不是迟缓', role: '设计/网站搭建', avatar: '/ChiHuan.webp', href: 'https://space.bilibili.com/674795502?spm_id_from=333.1007.0.0', code: 'CH-001' },
                { id: '山荼_skat', role: '设计', avatar: '/ShanTu.webp', href: 'https://www.bandbbs.cn/members/2567401/', code: 'ST-002' },
                { id: 'Fmkli', role: '技术支持', avatar: '/Fmkli.webp', href: 'https://lli.moe/', code: 'FM-003' },
                { id: 'AzumaChiaki', role: '技术支持', avatar: '/AzumaChiaki.webp', href: 'https://github.com/AzumaChiaki', code: 'AC-004' },
              ].map((member) => (
                <a
                  key={member.id}
                  href={member.href || '#'}
                  target={member.href ? '_blank' : undefined}
                  rel={member.href ? 'noopener noreferrer' : undefined}
                  className="ef-team-card"
                >
                  <CornerBrackets className="ef-team-card-brackets" />
                  <div className="ef-team-card-inner">
                    <div className="ef-team-avatar">
                      {member.avatar ? (
                        <img src={member.avatar} alt={member.id} className="ef-team-avatar-img" />
                      ) : (
                        <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="8" r="4" fill="var(--ef-cyan)" opacity="0.5" />
                          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="var(--ef-cyan)" fillOpacity="0.3" />
                        </svg>
                      )}
                      <div className="ef-team-avatar-ring" />
                    </div>
                    <div className="ef-team-info">
                      <span className="ef-team-code">{member.code}</span>
                      <h3 className="ef-team-name">{member.id}</h3>
                      <p className="ef-team-role">{member.role}</p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>

          {/* ═══ Footer ═══ */}
          <footer className="ef-footer">
            <TechDivider />
            <div className="ef-footer-inner">
              <p className="ef-footer-copy">
                &copy; 2026 POOLUX Studio. All rights reserved.
              </p>
              <div className="ef-footer-links">
                <div className="ef-footer-col">
                  <TechLabel>LINKS</TechLabel>
                  {(friendLinks.length > 0
                    ? friendLinks
                    : [
                        { name: 'Azuma Studio', url: 'https://azumachiaki.com/' },
                        { name: 'EVOA', url: 'https://evoa.top/' },
                        { name: '米坛社区', url: 'https://www.bandbbs.cn/' },
                      ] as { name: string; url: string }[]
                  ).map((link) => (
                    <a key={link.url} href={toExternalUrl(link.url)} target="_blank" rel="noopener noreferrer">{link.name}</a>
                  ))}
                </div>
                <div className="ef-footer-col">
                  <TechLabel>LEGAL</TechLabel>
                  <a href="/terms">用户协议</a>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  )
}