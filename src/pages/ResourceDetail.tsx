import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { WalineComments } from '@/components/WalineComments'
import { ArrowLeft, Download, ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Resource } from '@/pages/Resources'

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>()
  const [resource, setResource] = useState<Resource | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [bannerIdx, setBannerIdx] = useState(0)
  const [fadeOpacity, setFadeOpacity] = useState(1)
  const transitioning = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const scheduleTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current = timers.current.filter(x => x !== t)
      fn()
    }, ms)
    timers.current.push(t)
    return t
  }

  const goBanner = useCallback((next: number, banners: string[]) => {
    if (transitioning.current || next === bannerIdx) return
    transitioning.current = true
    setFadeOpacity(0)
    scheduleTimeout(() => {
      setBannerIdx(next)
      setFadeOpacity(1)
      scheduleTimeout(() => { transitioning.current = false }, 350)
    }, 300)
  }, [bannerIdx])

  useEffect(() => {
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [])

  useEffect(() => {
    if (!id) return
    const ac = new AbortController()
    setBannerIdx(0)
    setFadeOpacity(1)
    transitioning.current = false
    setLoading(true)
    apiFetch(`/api/resources/${id}`, { signal: ac.signal })
      .then((data: Resource) => setResource(data))
      .catch(() => setResource(null))
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [id])

  if (loading) {
    return (
      <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <Navbar />
        <main className="flex-1 relative z-10 flex items-center justify-center">
          <p style={{ color: 'var(--text-muted)' }}>加载中...</p>
        </main>
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <Navbar />
        <main className="flex-1 relative z-10 flex items-center justify-center">
          <p style={{ color: 'var(--text-muted)' }}>资源不存在</p>
        </main>
      </div>
    )
  }

  const deviceOptions = resource.device_options ?? resource.deviceOptions ?? []

  const currentDevice = deviceOptions.find(d => d.id === selectedDevice) ?? deviceOptions[0]

  const isSafeUrl = (url: string) => /^https?:\/\//i.test(url)

  const handleDownload = () => {
    if (!currentDevice) return
    const url = currentDevice.downloadUrl
    const ext = url.split('.').pop()?.split('?')[0] || 'bin'
    const safeName = `${currentDevice.label}-${resource.name}.${ext}`
    fetch(url).then(r => r.blob()).then(blob => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = safeName
      a.click()
      URL.revokeObjectURL(a.href)
    }).catch(() => {})
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />

      <main className="flex-1 relative z-10 overflow-auto no-scrollbar">
        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
          {/* 返回 */}
          <Link to="/resources" className="inline-flex items-center gap-2 mb-6 text-sm" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
            <ArrowLeft className="w-4 h-4" />
            返回
          </Link>

          {/* 资源信息 */}
          <div className="flex items-start gap-4 mb-6">
            <div
              className="flex-shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-tertiary)' }}
            >
              <img src={resource.icon} alt={resource.name} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl lg:text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {resource.name}
              </h1>
              {resource.author && (
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  {resource.author}
                </p>
              )}
            </div>
          </div>

          {/* 描述 */}
          {resource.description && (
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
              {resource.description}
            </p>
          )}

          {/* 操作区域：下载 + 购买 */}
          {deviceOptions.length > 0 && (
            <div className="flex items-center gap-3 mb-8 flex-wrap">
              {/* 设备选择下拉 */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    minWidth: '180px',
                  }}
                >
                  <span className="flex-1 text-left truncate">{currentDevice?.label ?? '选择设备'}</span>
                  <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </button>
                {dropdownOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 w-full rounded-xl overflow-hidden z-50"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-elevated)' }}
                  >
                    {deviceOptions.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => { setSelectedDevice(opt.id); setDropdownOpen(false) }}
                        className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                        style={{
                          color: opt.id === selectedDevice ? 'var(--accent)' : 'var(--text-primary)',
                          background: opt.id === selectedDevice ? 'var(--accent-bg)' : 'transparent',
                        }}
                        onMouseEnter={(e) => { if (opt.id !== selectedDevice) e.currentTarget.style.background = 'var(--bg-tertiary)' }}
                        onMouseLeave={(e) => { if (opt.id !== selectedDevice) e.currentTarget.style.background = 'transparent' }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 下载按钮 */}
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-elevated)' }}
              >
                <Download className="w-4 h-4" />
                下载
              </button>

              {/* 前往购买（下载按钮右侧） */}
              {resource.paid && resource.purchase_link && isSafeUrl(resource.purchase_link) && (
                <a
                  href={resource.purchase_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-elevated)', textDecoration: 'none' }}
                >
                  <ExternalLink className="w-4 h-4" />
                  前往购买
                </a>
              )}
            </div>
          )}

          {/* Banner 图片（轮播 + fade 动画） */}
          {(() => {
            const banners: string[] = resource.banners?.length ? resource.banners
              : resource.banner ? [resource.banner] : []
            if (banners.length === 0) return null
            return (
              <div className="rounded-xl overflow-hidden relative" style={{ background: 'var(--bg-tertiary)' }}>
                <img
                  src={banners[bannerIdx]} alt={resource.name} className="w-full"
                  loading="lazy"
                  style={{ transition: 'opacity 0.3s ease', opacity: fadeOpacity }}
                />
                {banners.length > 1 && (
                  <>
                    <button
                      onClick={() => goBanner((bannerIdx - 1 + banners.length) % banners.length, banners)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-opacity"
                      style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => goBanner((bannerIdx + 1) % banners.length, banners)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center transition-opacity"
                      style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {banners.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => goBanner(i, banners)}
                          className="w-2 h-2 rounded-full transition-all"
                          style={{
                            background: i === bannerIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                            transform: i === bannerIdx ? 'scale(1.2)' : 'scale(1)',
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* 设备要求 */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>设备要求</h2>
            <ul className="space-y-2">
              {resource.devices.map(d => (
                <li key={d} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  {d}
                </li>
              ))}
            </ul>
          </div>

          {/* 评论 */}
          <div className="mt-8">
            <WalineComments />
          </div>
        </div>
      </main>
    </div>
  )
}