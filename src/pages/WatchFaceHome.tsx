import { useCallback, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { apiFetch, API_BASE } from '@/lib/api'

/* ── 类型 ── */
interface Layer {
  name: string
  css_code: string
  type: 'color' | 'image' | 'svg' | 'shape' | 'text'
  color_mode?: 'fixed' | 'picker'
  color?: string
  image_url?: string
  show_on_client?: boolean
  css_position_code?: string
  z_index?: number
}

interface DeviceConfig {
  name: string
  width: number
  height: number
  corner_radius: number
  layers: Layer[]
}

interface Template {
  id: number
  name: string
  devices: DeviceConfig[]
  preview_image: string
  created_at: string
  updated_at: string
}

/* ── CSS 解析（复用 Components.tsx 逻辑） ── */
function toReactKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function parseCssBlock(raw: string): Record<string, string> {
  let css = raw.trim()
  const m = css.match(/\{([\s\S]*)\}/)
  if (m) css = m[1]
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const result: Record<string, string> = {}
  for (const seg of css.split(';')) {
    const s = seg.trim()
    const i = s.indexOf(':')
    if (i < 0) continue
    const key = s.slice(0, i).trim().toLowerCase()
    const val = s.slice(i + 1).trim()
    if (key && val) result[key] = val
  }
  return result
}

function cssToProps(css: Record<string, string>): React.CSSProperties {
  const style: Record<string, any> = {}
  for (const [key, val] of Object.entries(css)) {
    if (key === 'display' || key === 'position' || key === 'float' || key === 'clear') continue
    style[toReactKey(key)] = val
  }
  style.position = 'absolute'
  return style as React.CSSProperties
}

function migrateLayer(l: any, i: number): Layer {
  const migrated = { ...l, show_on_client: l.show_on_client ?? true }
  if (l.css_shape && !l.css_code) {
    return { ...migrated, css_code: `clip-path: ${l.css_shape}`, type: l.type || 'color', z_index: l.z_index ?? i, css_shape: undefined }
  }
  return { ...migrated, css_code: l.css_code || '', type: l.type || 'color', z_index: l.z_index ?? i }
}

function migrateTemplate(t: any): Template {
  if (!t.devices || !Array.isArray(t.devices) || t.devices.length === 0) {
    return { ...t, devices: [], preview_image: t.preview_image || '' }
  }
  if (typeof t.devices[0] === 'string') {
    const oldLayers: Layer[] = Array.isArray(t.layers) ? t.layers : []
    return {
      ...t,
      preview_image: t.preview_image || '',
      devices: (t.devices as string[]).map((name: string) => ({
        name,
        width: 212, height: 520, corner_radius: 48,
        layers: oldLayers.map((l, i) => migrateLayer(l, i)),
      })),
    }
  }
  return {
    ...t,
    preview_image: t.preview_image || '',
    devices: t.devices.map((d: any) => ({
      ...d,
      width: d.width || 212,
      height: d.height || 520,
      corner_radius: d.corner_radius || 48,
      layers: Array.isArray(d.layers) ? d.layers.map((l: any, i: number) => migrateLayer(l, i)) : [],
    })),
  }
}

/* ── 缩略图渲染 ── */
function RenderLayer({ layer }: { layer: Layer }) {
  if (layer.type === 'image' && layer.show_on_client === false) return null
  if (layer.type === 'image' && layer.image_url) {
    const css = {
      ...parseCssBlock(layer.css_code || ''),
      ...parseCssBlock(layer.css_position_code || ''),
    }
    const w = css['width'] || '100%'
    const h = css['height'] || '100%'
    const containerStyle: React.CSSProperties = {
      position: 'absolute',
      left: css['left'] || '0',
      top: css['top'] || '0',
      width: w,
      height: h,
      opacity: css['opacity'] || '1',
      transform: css['transform'] || undefined,
      filter: css['filter'] || undefined,
      overflow: 'hidden',
    }
    return <img src={layer.image_url} alt="" draggable={false} style={{ ...containerStyle, objectFit: 'cover', pointerEvents: 'none' }} />
  }
  const css = parseCssBlock(layer.css_code || '')
  const style = cssToProps(css)
  return <div style={style} />
}

function TemplateThumbnail({ template, size = 80 }: { template: Template; size?: number }) {
  const d = template.devices[0]
  if (!d) return <div className="rounded-xl" style={{ width: size, height: size * 1.4, background: '#1a1a2e' }} />
  const scale = Math.min(size / d.width, (size * 1.4) / d.height)
  const displayW = Math.round(d.width * scale)
  const displayH = Math.round(d.height * scale)
  const sorted = [...d.layers].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0))

  return (
    <div style={{
      width: displayW,
      height: displayH,
      borderRadius: Math.round(d.corner_radius * scale),
      overflow: 'hidden',
      background: '#111',
      position: 'relative',
      border: '1px solid rgba(255,255,255,0.1)',
      flexShrink: 0,
    }}>
      <div style={{
        width: d.width,
        height: d.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {sorted.map((layer, i) => <RenderLayer key={i} layer={layer} />)}
      </div>
    </div>
  )
}

/* ── 主页面 ── */
const BUILTIN_CARDS = [
  { label: '「Canopy UI」', sub: '相册表盘', path: '/tools/watch-face/edit' },
  { label: '「时语」', sub: '相册表盘', path: '/tools/watch-face/edit-shiyu' },
]

export function WatchFaceHome() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])

  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/templates', { signal: ac.signal })
      .then((data: any[]) => setTemplates(data.map(migrateTemplate)))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const handleCardClick = useCallback((path: string) => {
    navigate(path)
  }, [navigate])

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />

      <main className="flex-1 relative z-10 overflow-auto no-scrollbar">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 lg:py-16">
          <div className="text-center mb-10 lg:mb-14">
            <h1 className="section-title">相册表盘编辑</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8 }}>定制您的专属表盘</p>
          </div>

          {/* 全部模板（内置 + 管理端创建） */}
          <div className="flex justify-center gap-4 flex-wrap">
            {BUILTIN_CARDS.map(card => (
              <div
                key={card.path}
                className="p-6 lg:p-8 rounded-xl transition-all flex flex-col items-center justify-center cursor-pointer"
                style={{
                  background: 'var(--bg-secondary)',
                  boxShadow: 'var(--shadow-card)',
                  minHeight: '160px',
                  width: '260px',
                }}
                onClick={() => handleCardClick(card.path)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                }}
              >
                <h3 className="text-lg font-semibold text-center" style={{ color: 'var(--text-primary)' }}>{card.label}</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{card.sub}</p>
              </div>
            ))}
            {templates.map(tpl => (
              <div
                key={tpl.id}
                className="p-4 lg:p-5 rounded-xl transition-all flex flex-col items-center justify-center cursor-pointer"
                style={{
                  background: 'var(--bg-secondary)',
                  boxShadow: 'var(--shadow-card)',
                  minHeight: '160px',
                  width: '260px',
                }}
                onClick={() => handleCardClick(`/tools/watch-face/edit-template/${tpl.id}`)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                }}
              >
                <h3 className="text-sm lg:text-base font-semibold text-center" style={{ color: 'var(--text-primary)' }}>「{tpl.name}」</h3>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}