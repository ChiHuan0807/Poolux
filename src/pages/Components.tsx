import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch, apiUploadTo, API_BASE } from '@/lib/api'
import { Plus, Trash2, Save, ChevronLeft, Upload, Layers, Image, Palette, Settings, Code, Clipboard, GripVertical, Eye, EyeOff } from 'lucide-react'

/* ── 类型 ── */
interface Layer {
  name: string
  css_code: string
  type: 'color' | 'image'
  color_mode?: 'fixed' | 'picker'
  color?: string
  picker_default?: 'dark' | 'light'
  allow_user_upload?: boolean
  image_url?: string
  z_index?: number
}

interface DeviceConfig {
  name: string
  width: number
  height: number
  corner_radius: number
  background?: string
  layers: Layer[]
}

interface Template {
  id: number
  name: string
  devices: DeviceConfig[]
  preview_image: string
  hidden: boolean
  created_at: string
  updated_at: string
}

/* ── 设备预设尺寸 ── */
const DEVICE_PRESETS: Record<string, { width: number; height: number; corner_radius: number }> = {
  '小米手环 10':  { width: 212, height: 520, corner_radius: 108 },
  '小米手环 Pro': { width: 336, height: 480, corner_radius: 48 },
  'REDMI Watch 6': { width: 432, height: 514, corner_radius: 106 },
}
const ALL_DEVICE_NAMES = Object.keys(DEVICE_PRESETS)

const FONT = '"MiSans", -apple-system, BlinkMacSystemFont, sans-serif'

/* ═══════════════════════════════════════════════════════════
   CSS 解析
   ═══════════════════════════════════════════════════════════ */

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

function detectType(css: Record<string, string>): 'color' | 'image' {
  const bg = css['background'] || css['background-image'] || ''
  return bg.includes('url(') ? 'image' : 'color'
}

function extractImageUrl(css: Record<string, string>): string | undefined {
  const bg = css['background'] || css['background-image'] || ''
  const urlMatch = bg.match(/url\(["']?([^"')]+)["']?\)/)
  return urlMatch ? urlMatch[1] : undefined
}

function extractColorFromCss(css: Record<string, string>): string | undefined {
  const bg = css['background'] || css['background-color'] || ''
  // hex
  const hex = bg.match(/#([0-9a-fA-F]{3,8})\b/)
  if (hex) return '#' + hex[1].slice(0, 6)
  // rgb/rgba
  const rgba = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgba) {
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${toHex(+rgba[1])}${toHex(+rgba[2])}${toHex(+rgba[3])}`
  }
  // named colors
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', gray: '#808080', grey: '#808080' }
  const name = bg.trim().toLowerCase()
  if (named[name]) return named[name]
  return undefined
}

function splitLayersFromCss(raw: string): string[] {
  return raw.split(/\n\s*\n/).map(s => s.trim()).filter(b => b.length > 0 && /:/.test(b))
}

/* ── 形状预设 ── */
type ShapePreset = 'none' | 'circle' | 'rounded-sm' | 'rounded-md' | 'rounded-lg'
const SHAPE_PRESETS: { key: ShapePreset; label: string; css: string }[] = [
  { key: 'none',       label: '无',       css: '' },
  { key: 'circle',     label: '圆形',     css: 'border-radius: 50%;' },
  { key: 'rounded-sm', label: '小圆角',   css: 'border-radius: 8px;' },
  { key: 'rounded-md', label: '中圆角',   css: 'border-radius: 16px;' },
  { key: 'rounded-lg', label: '大圆角',   css: 'border-radius: 24px;' },
]

/** 从 CSS 字符串中检测当前形状 */
function detectShapePreset(cssStr: string): ShapePreset {
  const css = parseCssBlock(cssStr)
  const br = css['border-radius']
  if (!br) return 'none'
  if (br === '50%') return 'circle'
  if (br === '8px') return 'rounded-sm'
  if (br === '16px') return 'rounded-md'
  if (br === '24px') return 'rounded-lg'
  return 'none'
}

/** 将形状预设应用到 CSS 字符串（替换已有的 border-radius） */
function applyShapePreset(cssStr: string, shape: ShapePreset): string {
  let cleaned = cssStr.replace(/border-radius\s*:\s*[^;\n]+;?\s*\n?/gi, '').trimEnd()
  const preset = SHAPE_PRESETS.find(s => s.key === shape)
  if (shape !== 'none' && preset?.css) {
    cleaned = cleaned ? cleaned + '\n' + preset.css : preset.css
  }
  return cleaned
}

/* ═══════════════════════════════════════════════════════════
   数据迁移
   ═══════════════════════════════════════════════════════════ */

function migrateLayer(l: any, i: number): Layer {
  if (l.css_shape && !l.css_code) {
    return { ...l, css_code: `clip-path: ${l.css_shape}`, type: l.type || 'color', z_index: l.z_index ?? i, css_shape: undefined }
  }
  return { ...l, css_code: l.css_code || '', type: l.type || 'color', z_index: l.z_index ?? i }
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
        width: DEVICE_PRESETS[name]?.width || 212,
        height: DEVICE_PRESETS[name]?.height || 520,
        corner_radius: DEVICE_PRESETS[name]?.corner_radius || 48,
        background: '#FFFFFF',
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
      background: d.background || '#FFFFFF',
      layers: Array.isArray(d.layers) ? d.layers.map((l: any, i: number) => migrateLayer(l, i)) : [],
    })),
  }
}

function createEmptyDevice(name: string): DeviceConfig {
  const p = DEVICE_PRESETS[name]
  return { name, width: p?.width || 212, height: p?.height || 520, corner_radius: p?.corner_radius || 48, background: '#FFFFFF', layers: [] }
}

const EMPTY_TEMPLATE: Template = { id: 0, name: '', devices: [], preview_image: '', hidden: false, created_at: '', updated_at: '' }

/* ═══════════════════════════════════════════════════════════
   预览组件
   ═══════════════════════════════════════════════════════════ */

function RenderLayer({ layer }: { layer: Layer }) {
  const css = useMemo(() => parseCssBlock(layer.css_code || ''), [layer.css_code])

  if (layer.type === 'image' && layer.image_url) {
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

  const style = useMemo(() => {
    const s = cssToProps(css)
    // 颜色图层：用 layer.color 作为背景兜底
    if (layer.type === 'color' && layer.color && !css['background'] && !css['background-color'] && !css['border']) {
      s.backgroundColor = layer.color
    }
    return s
  }, [css, layer.type, layer.color])
  return <div style={style} />
}

function DeviceViewport({ device, maxH = 340 }: { device: DeviceConfig; maxH?: number }) {
  const { width, height, corner_radius, layers, background } = device
  const scale = Math.min(1, maxH / height)
  const displayW = Math.round(width * scale)
  const displayH = Math.round(height * scale)
  const sorted = useMemo(() => [...layers].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)), [layers])

  return (
    <div style={{
      position: 'relative',
      width: displayW,
      height: displayH,
      borderRadius: Math.round(corner_radius * scale),
      overflow: 'hidden',
      background: background || '#FFFFFF',
      flexShrink: 0,
      border: '2px solid rgba(255,255,255,0.12)',
    }}>
      <div style={{
        width,
        height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {sorted.map((layer, i) => <RenderLayer key={i} layer={layer} />)}
        {layers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px]" style={{ color: '#555', fontFamily: FONT }}>空设备</div>
        )}
      </div>
    </div>
  )
}

function TemplateThumbnail({ template, size = 48 }: { template: Template; size?: number }) {
  const d = template.devices[0]
  if (!d) return <div className="rounded-xl" style={{ width: size, height: size, background: '#1a1a2e' }} />
  const scale = Math.min(size / d.width, size / d.height)
  const sorted = [...d.layers].sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))

  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: Math.round(d.width * scale),
        height: Math.round(d.height * scale),
        borderRadius: Math.round(d.corner_radius * scale),
        overflow: 'hidden',
        background: d.background || '#FFFFFF',
        position: 'relative',
      }}>
        {sorted.map((layer, i) => (
          <div key={i} style={{
            width: d.width,
            height: d.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <RenderLayer layer={layer} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   管理面板
   ═══════════════════════════════════════════════════════════ */

export function ComponentAdmin() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [activeDeviceIdx, setActiveDeviceIdx] = useState(0)
  const [editingLayerIdx, setEditingLayerIdx] = useState<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // 粘贴表单状态（常驻）
  const [pasteCss, setPasteCss] = useState('')
  const [pasteName, setPasteName] = useState('')
  const [pasteType, setPasteType] = useState<'color' | 'image'>('color')
  const [pasteColorMode, setPasteColorMode] = useState<'fixed' | 'picker'>('fixed')
  const [pasteColor, setPasteColor] = useState('#00aaff')
  const [pastePickerDefault, setPastePickerDefault] = useState<'dark' | 'light'>('dark')
  const [pasteAllowUpload, setPasteAllowUpload] = useState(false)

  const load = useCallback(async () => {
    try {
      const raw = await apiFetch('/api/templates/all')
      setTemplates(Array.isArray(raw) ? raw.map(migrateTemplate) : [])
    } catch { /* */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  /* CRUD */
  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) {
        await apiFetch(`/api/templates/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      } else {
        const r = await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify(editing) })
        setEditing({ ...editing, id: r.id })
      }
      await load()
      setEditing(null)
      setMsg('保存成功')
    } catch (e: any) { setMsg(e.message) }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该模板？')) return
    try { await apiFetch(`/api/templates/${id}`, { method: 'DELETE' }); await load(); if (editing?.id === id) setEditing(null) }
    catch (e: any) { setMsg(e.message) }
  }

  const handleToggleHidden = async (id: number) => {
    try {
      const r = await apiFetch(`/api/templates/${id}/toggle-hidden`, { method: 'PATCH' })
      setMsg(r.hidden ? '已隐藏，用户端不再显示' : '已恢复显示')
      await load()
    } catch (e: any) { setMsg(e.message) }
  }

  /* 设备操作 */
  const addDevice = (name: string) => {
    if (!editing) return
    if (editing.devices.some(d => d.name === name)) return
    setEditing({ ...editing, devices: [...editing.devices, createEmptyDevice(name)] })
    setActiveDeviceIdx(editing.devices.length)
  }

  const removeDevice = (idx: number) => {
    if (!editing) return
    const devices = editing.devices.filter((_, i) => i !== idx)
    setEditing({ ...editing, devices })
    if (activeDeviceIdx >= devices.length) setActiveDeviceIdx(Math.max(0, devices.length - 1))
  }

  const updateDevice = (idx: number, patch: Partial<DeviceConfig>) => {
    if (!editing) return
    setEditing({ ...editing, devices: editing.devices.map((d, i) => i === idx ? { ...d, ...patch } : d) })
  }

  const activeDevice = editing?.devices[activeDeviceIdx] || null

  /* 图层操作 */
  const updateLayer = (layerIdx: number, patch: Partial<Layer>) => {
    if (!activeDevice) return
    updateDevice(activeDeviceIdx, { layers: activeDevice.layers.map((l, i) => i === layerIdx ? { ...l, ...patch } : l) })
  }

  const removeLayer = (layerIdx: number) => {
    if (!activeDevice) return
    updateDevice(activeDeviceIdx, { layers: activeDevice.layers.filter((_, i) => i !== layerIdx) })
    if (editingLayerIdx === layerIdx) setEditingLayerIdx(null)
  }

  const moveLayer = (layerIdx: number, dir: -1 | 1) => {
    if (!activeDevice) return
    const layers = [...activeDevice.layers]
    const target = layerIdx + dir
    if (target < 0 || target >= layers.length) return
    ;[layers[layerIdx], layers[target]] = [layers[target], layers[layerIdx]]
    layers.forEach((l, i) => l.z_index = i)
    updateDevice(activeDeviceIdx, { layers })
  }

  /** 拖拽排序：将 fromIdx 的图层移动到 toIdx 位置 */
  const reorderLayer = (fromIdx: number, toIdx: number) => {
    if (!activeDevice) return
    if (fromIdx === toIdx) return
    const layers = [...activeDevice.layers]
    const [moved] = layers.splice(fromIdx, 1)
    layers.splice(toIdx, 0, moved)
    layers.forEach((l, i) => l.z_index = i)
    updateDevice(activeDeviceIdx, { layers })
  }

  /** 添加图层：从粘贴表单构建，排在最前面（新图层在上方） */
  const handleAddLayer = () => {
    if (!activeDevice) return
    if (!pasteCss.trim()) { setMsg('请先粘贴 CSS 代码'); return }

    const css = parseCssBlock(pasteCss)
    const autoType = detectType(css)
    const finalType = pasteType

    // 计算 z_index：新图层在最上方
    const maxZ = activeDevice.layers.reduce((m, l) => Math.max(m, l.z_index ?? 0), 0)

    const layer: Layer = {
      name: pasteName.trim() || `图层 ${activeDevice.layers.length + 1}`,
      css_code: pasteCss.trim(),
      type: finalType,
      z_index: maxZ + 1,
    }

    if (finalType === 'image') {
      layer.image_url = extractImageUrl(css)
      layer.allow_user_upload = pasteAllowUpload
    } else {
      layer.color_mode = pasteColorMode
      layer.picker_default = pastePickerDefault
      if (pasteColorMode === 'fixed') {
        layer.color = pasteColor
      }
    }

    // 新图层排在前面（unshift），但 z_index 确保渲染顺序
    updateDevice(activeDeviceIdx, { layers: [layer, ...activeDevice.layers] })

    // 重置表单
    setPasteCss('')
    setPasteName('')
    setMsg(`已添加「${layer.name}」`)
  }

  /* ── 列表视图 ── */
  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)', fontFamily: FONT }}>加载中...</div>

  if (!editing) {
    return (
      <div className="space-y-4" style={{ fontFamily: FONT }}>
        {msg && (
          <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
            background: msg.includes('成功') || msg.includes('添加') ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
            color: msg.includes('成功') || msg.includes('添加') ? 'var(--success)' : 'var(--danger)',
          }}>{msg}</div>
        )}
        <button onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
          className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-xs font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)' }}>
          <Plus className="w-4 h-4" /> 新建模板
        </button>
        <div className="flex gap-6 flex-col lg:flex-row">
          <div className="lg:w-80 flex-shrink-0 space-y-2 max-h-[60vh] overflow-auto no-scrollbar">
            {templates.map(t => (
              <div key={t.id}
                className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left cursor-pointer"
                style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}
                onClick={() => setEditing({ ...t })}>
                <TemplateThumbnail template={t} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: t.hidden ? 'var(--text-muted)' : 'var(--text-primary)' }}>{t.name || '未命名'} {t.hidden && <span className="text-[10px]" style={{ color: 'var(--danger)' }}>（已隐藏）</span>}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t.devices.length ? t.devices.map(d => d.name).join('、') : '未适配'} · {t.devices.reduce((s, d) => s + d.layers.length, 0)} 图层
                  </p>
                </div>
                <button onClick={e => { e.stopPropagation(); handleToggleHidden(t.id) }} className="p-1.5 rounded-lg" style={{ color: t.hidden ? 'var(--text-muted)' : 'var(--accent)' }} title={t.hidden ? '恢复显示' : '隐藏'}>
                  {t.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button onClick={e => { e.stopPropagation(); handleDelete(t.id) }} className="p-1.5 rounded-lg" style={{ color: 'var(--danger)' }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {templates.length === 0 && (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无模板</p>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <Layers className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>选择左侧模板进行编辑</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── 编辑视图 ── */
  const availableDevices = ALL_DEVICE_NAMES.filter(n => !editing.devices.some(d => d.name === n))
  const parsedPasteCss = pasteCss.trim() ? parseCssBlock(pasteCss) : null
  const detectedType = parsedPasteCss ? detectType(parsedPasteCss) : pasteType

  return (
    <div className="space-y-4" style={{ fontFamily: FONT }}>
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msg.includes('成功') || msg.includes('添加') ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
          color: msg.includes('成功') || msg.includes('添加') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => setEditing(null)} className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <ChevronLeft className="w-4 h-4" /> 返回列表
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
          {saving ? '保存中...' : <><Save className="w-4 h-4" /> 保存</>}
        </button>
      </div>

      <div className="flex gap-5 flex-col xl:flex-row">
        {/* ── 左侧面板 ── */}
        <div className="xl:w-72 flex-shrink-0 space-y-4">
          {/* 模板名称 */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>模板名称</label>
            <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="如：「Canopy UI」表盘"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>

          {/* 设备管理 */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>适配设备</label>
            <div className="space-y-1.5">
              {editing.devices.map((device, idx) => (
                <div key={device.name}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs cursor-pointer transition-all"
                  style={{
                    background: idx === activeDeviceIdx ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                    border: `1px solid ${idx === activeDeviceIdx ? 'var(--accent)' : 'var(--border-color)'}`,
                    color: idx === activeDeviceIdx ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                  onClick={() => setActiveDeviceIdx(idx)}>
                  <span className="flex-1 font-medium">{device.name}</span>
                  <span className="text-[10px] opacity-60">{device.width}x{device.height}</span>
                  <button onClick={e => { e.stopPropagation(); removeDevice(idx) }} className="p-0.5 rounded" style={{ color: 'var(--danger)' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            {availableDevices.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableDevices.map(name => (
                  <button key={name} onClick={() => addDevice(name)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                    style={{ border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                    <Plus className="w-3 h-3" /> {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 设备参数 */}
          {activeDevice && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <label className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                <Settings className="w-3 h-3" /> 设备参数
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([['width', '宽', 'px'], ['height', '高', 'px'], ['corner_radius', '圆角', 'px']] as const).map(([key, label, unit]) => (
                  <div key={key}>
                    <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
                    <div className="flex items-center">
                      <input type="number" min={10} value={activeDevice[key]}
                        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateDevice(activeDeviceIdx, { [key]: v }) }}
                        className="w-full px-2 py-1.5 rounded-lg text-xs outline-none text-center"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', MozAppearance: 'textfield' }} />
                      <span className="text-[10px] ml-0.5" style={{ color: 'var(--text-muted)' }}>{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ 粘贴 CSS 添加图层（常驻） ═══ */}
          {activeDevice && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                <Clipboard className="w-3 h-3" /> 粘贴 CSS 添加图层
              </label>

              {/* 图层名称 */}
              <div>
                <label className="block text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>图层名称</label>
                <input value={pasteName} onChange={e => setPasteName(e.target.value)}
                  placeholder={`图层 ${activeDevice.layers.length + 1}`}
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
              </div>

              {/* CSS 代码 */}
              <div>
                <label className="block text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>CSS 代码</label>
                <textarea value={pasteCss} onChange={e => {
                  const val = e.target.value
                  setPasteCss(val)
                  // 自动从 CSS 提取颜色
                  const parsed = parseCssBlock(val)
                  const c = extractColorFromCss(parsed)
                  if (c) setPasteColor(c)
                  // 自动检测图层类型
                  const t = detectType(parsed)
                  setPasteType(t)
                }}
                  rows={6}
                  placeholder="粘贴 CSS 代码..."
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono outline-none resize-y"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', minHeight: 100 }} />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>粘贴 CSS 后点击下方按钮快速添加形状</p>
                {/* 形状快捷按钮 */}
                <div className="flex gap-1.5 mt-2">
                  {SHAPE_PRESETS.map(sp => {
                    const cur = detectShapePreset(pasteCss)
                    return (
                      <button key={sp.key} onClick={() => setPasteCss(applyShapePreset(pasteCss, sp.key))}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
                        style={{
                          background: cur === sp.key ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                          color: cur === sp.key ? 'var(--accent)' : 'var(--text-secondary)',
                          border: `1px solid ${cur === sp.key ? 'var(--accent)' : 'var(--border-color)'}`,
                        }}>
                        {sp.label}
                      </button>
                    )
                  })}
                </div>
                {parsedPasteCss && Object.keys(parsedPasteCss).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.keys(parsedPasteCss).slice(0, 5).map(k => (
                      <span key={k} className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{k}</span>
                    ))}
                    {Object.keys(parsedPasteCss).length > 5 && (
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>+{Object.keys(parsedPasteCss).length - 5}</span>
                    )}
                  </div>
                )}
              </div>

              {/* 图层类型选择 */}
              <div>
                <label className="block text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>图层类型</label>
                <div className="flex gap-2">
                  {([['color', '颜色图层', Palette], ['image', '图片图层', Image]] as const).map(([t, label, Icon]) => (
                    <button key={t} onClick={() => setPasteType(t as 'color' | 'image')}
                      className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-medium transition-all"
                      style={{
                        background: pasteType === t ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                        color: pasteType === t ? 'var(--accent)' : 'var(--text-secondary)',
                        border: `1px solid ${pasteType === t ? 'var(--accent)' : 'var(--border-color)'}`,
                      }}>
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 颜色图层子选项 */}
              {pasteType === 'color' && (
                <div className="space-y-2">
                  <label className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>颜色模式</label>
                  <div className="flex gap-2">
                    <button onClick={() => setPasteColorMode('fixed')}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                      style={{
                        background: pasteColorMode === 'fixed' ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                        color: pasteColorMode === 'fixed' ? 'var(--accent)' : 'var(--text-secondary)',
                        border: `1px solid ${pasteColorMode === 'fixed' ? 'var(--accent)' : 'var(--border-color)'}`,
                      }}>固定颜色</button>
                    <button onClick={() => setPasteColorMode('picker')}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all"
                      style={{
                        background: pasteColorMode === 'picker' ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                        color: pasteColorMode === 'picker' ? 'var(--accent)' : 'var(--text-secondary)',
                        border: `1px solid ${pasteColorMode === 'picker' ? 'var(--accent)' : 'var(--border-color)'}`,
                      }}>自动取色</button>
                  </div>
                  {pasteColorMode === 'fixed' && (
                    <div className="flex items-center gap-2">
                      <input type="color" value={pasteColor} onChange={e => setPasteColor(e.target.value)}
                        className="w-8 h-8 rounded-lg cursor-pointer border-0" />
                      <input value={pasteColor} onChange={e => setPasteColor(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono outline-none"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
                    </div>
                  )}
                  {pasteColorMode === 'picker' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(0,170,255,0.08)', border: '1px dashed rgba(0,170,255,0.3)' }}>
                      <div className="w-3 h-3 rounded-full" style={{ background: 'var(--accent)' }} />
                      <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>自动取色</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>用户在前端选择颜色</span>
                      <div className="flex gap-1 ml-auto">
                        {(['dark', 'light'] as const).map(d => (
                          <button key={d} onClick={() => setPastePickerDefault(d)}
                            className="px-2 py-0.5 rounded text-[9px] font-medium transition-all"
                            style={{
                              background: pastePickerDefault === d ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                              color: pastePickerDefault === d ? 'var(--accent)' : 'var(--text-muted)',
                              border: `1px solid ${pastePickerDefault === d ? 'var(--accent)' : 'transparent'}`,
                            }}>{d === 'dark' ? '默认深' : '默认浅'}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 图片图层子选项 */}
              {pasteType === 'image' && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={pasteAllowUpload}
                      onChange={e => setPasteAllowUpload(e.target.checked)}
                      className="rounded" />
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>允许用户在前端上传替换图片</span>
                  </label>
                  {extractImageUrl(parsedPasteCss || {}) && (
                    <div className="text-[10px] px-2 py-1 rounded-lg truncate" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      检测到图片: {extractImageUrl(parsedPasteCss || {})?.slice(0, 50)}...
                    </div>
                  )}
                </div>
              )}

              {/* 添加按钮 */}
              <button onClick={handleAddLayer}
                disabled={!pasteCss.trim()}
                className="w-full py-2.5 rounded-xl text-xs font-medium text-white transition-all flex items-center justify-center gap-1.5"
                style={{
                  background: pasteCss.trim() ? 'var(--gradient-accent)' : 'var(--bg-tertiary)',
                  opacity: pasteCss.trim() ? 1 : 0.5,
                }}>
                <Plus className="w-3.5 h-3.5" /> 添加到最上层
              </button>
            </div>
          )}
        </div>

        {/* ── 右侧：预览 + 图层列表 ── */}
        <div className="flex-1 space-y-4 min-w-0">
          {activeDevice && (
            <div className="rounded-2xl p-5 flex flex-col items-center gap-3" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                实时预览 — {activeDevice.name} ({activeDevice.width}x{activeDevice.height})
              </p>
              <DeviceViewport device={activeDevice} maxH={320} />
            </div>
          )}

          {!activeDevice ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <Layers className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先添加设备</p>
            </div>
          ) : activeDevice.layers.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <Layers className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无图层，使用左侧粘贴 CSS 添加</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...activeDevice.layers]
                .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
                .map((layer, displayIdx) => {
                  const realIdx = activeDevice.layers.indexOf(layer)
                  const parsed = parseCssBlock(layer.css_code || '')
                  const propCount = Object.keys(parsed).length
                  const isEditing = editingLayerIdx === realIdx
                  const isAutoColor = layer.type === 'color' && layer.color_mode === 'picker'
                  return (
                    <div key={realIdx} className="rounded-2xl p-4 space-y-3" style={{
                      background: 'var(--bg-secondary)',
                      boxShadow: dragOverIdx === realIdx && dragIdx !== realIdx ? '0 0 0 2px var(--accent)' : 'var(--shadow-card)',
                      borderLeft: isAutoColor ? '3px solid var(--accent)' : undefined,
                      opacity: dragIdx === realIdx ? 0.5 : 1,
                      transition: 'opacity 0.15s, box-shadow 0.15s',
                    }}
                      draggable
                      onDragStart={() => setDragIdx(realIdx)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(realIdx) }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                      onDrop={() => { if (dragIdx !== null && dragIdx !== realIdx) reorderLayer(dragIdx, realIdx); setDragIdx(null); setDragOverIdx(null) }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{
                            background: layer.type === 'image' ? 'rgba(100,200,100,0.15)' : isAutoColor ? 'rgba(0,170,255,0.2)' : 'rgba(0,170,255,0.15)',
                            color: layer.type === 'image' ? '#64c864' : isAutoColor ? '#00ccff' : '#00aaff',
                          }}>
                            {layer.type === 'image' ? '图片' : isAutoColor ? '自动取色' : '固定色'}
                          </span>
                          <input value={layer.name} onChange={e => updateLayer(realIdx, { name: e.target.value })}
                            className="text-sm font-medium bg-transparent outline-none w-28"
                            style={{ color: 'var(--text-primary)' }} />
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{propCount} 属性</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="p-1 cursor-grab active:cursor-grabbing" style={{ color: 'var(--text-muted)' }}>
                            <GripVertical className="w-3.5 h-3.5" />
                          </span>
                          <button onClick={() => removeLayer(realIdx)} className="p-1.5 rounded-lg" style={{ color: 'var(--danger)' }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* 自动取色标注 */}
                      {isAutoColor && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.15)' }}>
                          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
                          <span className="text-[10px]" style={{ color: 'var(--accent)' }}>自动取色</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>用户可在前端选择深色或浅色</span>
                        </div>
                      )}

                      {/* CSS 代码编辑 */}
                      <div className="space-y-1.5">
                        <button onClick={() => setEditingLayerIdx(isEditing ? null : realIdx)}
                          className="flex items-center gap-1.5 text-xs font-medium transition-all"
                          style={{ color: isEditing ? 'var(--accent)' : 'var(--text-muted)' }}>
                          <Code className="w-3 h-3" />
                          {isEditing ? '收起 CSS' : '查看/编辑 CSS'}
                        </button>
                        {isEditing && (
                          <>
                            <textarea value={layer.css_code} onChange={e => updateLayer(realIdx, { css_code: e.target.value })}
                              rows={8}
                              className="w-full px-3 py-2 rounded-xl text-xs font-mono outline-none resize-y"
                              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', minHeight: 100 }} />
                            {/* 形状快捷按钮 */}
                            <div className="flex gap-1.5 mt-1">
                              {SHAPE_PRESETS.map(sp => {
                                const cur = detectShapePreset(layer.css_code || '')
                                return (
                                  <button key={sp.key} onClick={() => updateLayer(realIdx, { css_code: applyShapePreset(layer.css_code || '', sp.key) })}
                                    className="px-2 py-0.5 rounded-md text-[9px] font-medium transition-all"
                                    style={{
                                      background: cur === sp.key ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                                      color: cur === sp.key ? 'var(--accent)' : 'var(--text-secondary)',
                                      border: `1px solid ${cur === sp.key ? 'var(--accent)' : 'var(--border-color)'}`,
                                    }}>
                                    {sp.label}
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                        {!isEditing && propCount > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {Object.keys(parsed).slice(0, 6).map(k => (
                              <span key={k} className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{k}</span>
                            ))}
                            {propCount > 6 && <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>+{propCount - 6}</span>}
                          </div>
                        )}
                      </div>

                      {/* 图片层额外设置 */}
                      {layer.type === 'image' && (
                        <div className="flex items-center gap-3">
                          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>图片：</label>
                          <label className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium cursor-pointer"
                            style={{ border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
                            <Upload className="w-3 h-3" /> 上传替换
                            <input type="file" className="hidden" accept="image/*" onChange={async e => {
                              const file = e.target.files?.[0]; if (!file) return
                              try {
                                const r = await apiUploadTo('/api/gallery/upload', file)
                                updateLayer(realIdx, { image_url: `${API_BASE}${r.path}` })
                              } catch (err: any) { setMsg(err.message) }
                              e.target.value = ''
                            }} />
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={!!layer.allow_user_upload}
                              onChange={e => updateLayer(realIdx, { allow_user_upload: e.target.checked })}
                              className="rounded" />
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>允许用户替换</span>
                          </label>
                        </div>
                      )}

                      {/* 颜色层额外设置 */}
                      {layer.type === 'color' && (
                        <div className="flex items-center gap-3">
                          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>模式：</label>
                          {(['fixed', 'picker'] as const).map(mode => (
                            <button key={mode} onClick={() => updateLayer(realIdx, { color_mode: mode })}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
                              style={{
                                background: layer.color_mode === mode ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                                color: layer.color_mode === mode ? 'var(--accent)' : 'var(--text-secondary)',
                                border: `1px solid ${layer.color_mode === mode ? 'var(--accent)' : 'var(--border-color)'}`,
                              }}>{mode === 'fixed' ? '固定色' : '自动取色'}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}