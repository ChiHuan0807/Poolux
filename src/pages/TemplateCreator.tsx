import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { apiFetch, apiUploadTo, API_BASE } from '@/lib/api'
import { cssLengthToPx, normalizeFontFaceStyle, parseCssDeclarations, resolveCssTranslation, resolveTextStyle, stripTranslateTransform } from '@/lib/templateTextStyle'
import {
  Trash2, GripVertical, Save, Image, Shapes, Group,
  ChevronDown, ChevronRight, Monitor, X, Type, Upload,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════
   类型
   ══════════════════════════════════════════════════════════ */

interface DeviceConfig {
  name: string; width: number; height: number; borderRadius: number; background?: string
}

interface ImageAdjustments {
  rotation: number; scale: number; blur: number; contrast: number; brightness: number
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = { rotation: 0, scale: 1, blur: 0, contrast: 100, brightness: 100 }

/** 所有图层通用特殊效果 */
interface LayerEffects {
  opacity: number            // 0-100
  blur_type: 'none' | 'gaussian' | 'backdrop'
  blur_value: number         // 0-1000 px
}
const DEFAULT_EFFECTS: LayerEffects = { opacity: 100, blur_type: 'none', blur_value: 0 }

interface TemplateLayer {
  id: string; name: string; type: 'image' | 'svg' | 'shape' | 'text'
  css_code: string; z_index: number; x: number; y: number
  allow_user_upload?: boolean; image_url?: string; adjustments?: ImageAdjustments
  show_on_client?: boolean  // 是否将管理端配置的图片上传服务器并展示给用户
  admin_preview_url?: string  // 仅存在于管理端内存，不写入模板数据
  css_width?: number; css_height?: number  // 图层结构化宽高（覆盖样式代码中的宽高）
  css_position_code?: string  // CSS 定位代码原文（用于 textarea 回显）
  effects?: LayerEffects
  group_id?: string   // 成组 ID
  visible_in_export?: boolean  // 导出时是否显示
  color_mode?: 'fixed' | 'picker'; color?: string; picker_default?: 'dark' | 'light'
  // text layer
  text_content?: string; font_family?: string; font_weight?: string
  font_size?: number; line_height?: number; letter_spacing?: number
  text_color?: string; text_align?: string  // 'left' | 'center' | 'right'
  text_vertical_align?: string  // 'top' | 'middle' | 'bottom'
}

interface FontRecord {
  id: number; filename: string; original_name: string; family_name: string
  style: string; weight: number; is_variable: boolean; url: string
}

interface DeviceWithLayers extends DeviceConfig { layers: TemplateLayer[] }

const DEVICE_PRESETS: DeviceConfig[] = [
  { name: '小米手环 Pro', width: 336, height: 480, borderRadius: 48 },
  { name: '小米手环 10', width: 212, height: 520, borderRadius: 108 },
  { name: 'REDMI Watch', width: 432, height: 514, borderRadius: 108 },
]

const ADJ_SPECS: { key: keyof ImageAdjustments; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'rotation', label: '旋转角度', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'scale', label: '放大倍数', min: 0.1, max: 5, step: 0.1, unit: 'x' },
  { key: 'blur', label: '模糊', min: 0, max: 50, step: 1, unit: 'px' },
  { key: 'contrast', label: '对比度', min: 0, max: 200, step: 1, unit: '%' },
  { key: 'brightness', label: '亮度', min: 0, max: 200, step: 1, unit: '%' },
]

/* ══════════════════════════════════════════════════════════
   工具
   ══════════════════════════════════════════════════════════ */

let _idCounter = 0
const nextId = () => `l_${Date.now()}_${_idCounter++}`

function getAdjDefault(key: keyof ImageAdjustments) {
  if (key === 'rotation') return 0; if (key === 'scale') return 1; if (key === 'blur') return 0; return 100
}

/** 只调整根 SVG 的显示尺寸；嵌套 SVG、image、filter 等子元素的 width/height 必须保留。 */
function forceSvgFill(html: string): string {
  return html.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const withoutRootSize = attrs.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    const styleMatch = withoutRootSize.match(/\sstyle\s*=\s*(["'])(.*?)\1/i)
    if (styleMatch) {
      const mergedStyle = `${styleMatch[2].replace(/;?\s*$/, ';')}width:100%;height:100%;pointer-events:none`
      return `<svg${withoutRootSize.replace(styleMatch[0], ` style="${mergedStyle}"`)}>`
    }
    return `<svg${withoutRootSize} style="width:100%;height:100%;pointer-events:none">`
  })
}

/** 从完整文件中提取根 SVG，避免非贪婪正则在嵌套 <svg> 处提前截断。 */
function extractSvgRoot(source: string): string {
  try {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = doc.documentElement
    if (root.tagName.toLowerCase() === 'svg' && !doc.querySelector('parsererror')) {
      return new XMLSerializer().serializeToString(root)
    }
  } catch { /* 回退到原始文本 */ }
  return source.trim()
}

/** 支持声明片段与「选择器 { ... }」两种设计软件 CSS 导出格式。 */
function getCssDeclarationText(raw: string): string {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const open = css.indexOf('{')
  const close = css.lastIndexOf('}')
  return open >= 0 && close > open ? css.slice(open + 1, close) : css
}

function toReactStyleKey(property: string): string {
  if (property.startsWith('--')) return property
  return property
    .replace(/^-webkit-/, 'Webkit-')
    .replace(/^-moz-/, 'Moz-')
    .replace(/^-ms-/, 'ms-')
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace('-', '')
}

/** 交给浏览器 CSSOM 解析，避免 url()、渐变或引号中的分号破坏声明。 */
function parseInlineCss(raw: string): React.CSSProperties {
  if (/^\s*</.test(raw)) return {}
  const declarations = getCssDeclarationText(raw)
  if (!declarations) return {}

  const parsed: Record<string, string | number> = {}
  const numericProperties = new Set(['opacity', 'zIndex', 'flex', 'order', 'fontWeight'])
  const style = document.createElement('div').style
  style.cssText = declarations

  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    const key = toReactStyleKey(property)
    const value = style.getPropertyValue(property).trim()
    const numericValue = Number(value)
    parsed[key] = numericProperties.has(key) && Number.isFinite(numericValue) ? numericValue : value
  }

  return parsed as React.CSSProperties
}

const HORIZONTAL_POSITION_KEYS = ['right', 'inset', 'insetInline', 'insetInlineStart', 'insetInlineEnd'] as const
const VERTICAL_POSITION_KEYS = ['bottom', 'inset', 'insetBlock', 'insetBlockStart', 'insetBlockEnd'] as const

/**
 * Admin 预览的唯一样式合并入口。
 * css_position_code 后合并以覆盖 css_code；结构化字段只在 CSS 未声明对应属性时回退。
 */
function resolveLayerPreviewStyle(layer: TemplateLayer, fallback: React.CSSProperties = {}): React.CSSProperties {
  const explicitStyle = {
    ...parseInlineCss(layer.css_code || ''),
    ...parseInlineCss(layer.css_position_code || ''),
  }
  const resolvedFallback: React.CSSProperties = {
    position: 'absolute',
    left: layer.x,
    top: layer.y,
    zIndex: layer.z_index,
    ...fallback,
  }
  const explicitRecord = explicitStyle as Record<string, unknown>

  if (HORIZONTAL_POSITION_KEYS.some(key => explicitRecord[key] != null)) delete resolvedFallback.left
  if (VERTICAL_POSITION_KEYS.some(key => explicitRecord[key] != null)) delete resolvedFallback.top

  return { ...resolvedFallback, ...explicitStyle }
}

/** 从 SVG 标签中提取实际渲染尺寸（用于居中计算和 wrapper 尺寸） */
function parseSvgDimensions(svg: string, deviceW: number, deviceH: number): { w: number; h: number } {
  // 1. 尝试提取 width/height 属性
  const wMatch = svg.match(/width="([^"]+)"/i)
  const hMatch = svg.match(/height="([^"]+)"/i)
  const parseDim = (val: string | undefined, ref: number): number => {
    if (!val) return 0
    if (val.endsWith('%')) return ref * parseFloat(val) / 100
    return parseFloat(val) || 0
  }
  const aw = parseDim(wMatch?.[1], deviceW)
  const ah = parseDim(hMatch?.[1], deviceH)
  if (aw > 0 && ah > 0) return { w: aw, h: ah }
  if (aw > 0) return { w: aw, h: aw }  // width-only → 正方形
  if (ah > 0) return { w: ah, h: ah }

  // 2. 尝试 viewBox
  const vb = svg.match(/viewBox="([^"]+)"/i)
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      // viewBox 与设备尺寸匹配 → 直接用设备尺寸
      if (Math.abs(parts[2] - deviceW) < 1 && Math.abs(parts[3] - deviceH) < 1) {
        return { w: deviceW, h: deviceH }
      }
      // 用 viewBox 宽高比，限制在设备尺寸内
      const aspect = parts[2] / parts[3]
      if (aspect >= 1) return { w: Math.min(deviceW, deviceH * aspect), h: Math.min(deviceH, deviceW / aspect) }
      return { w: Math.min(deviceW, deviceH * aspect), h: Math.min(deviceH, deviceW / aspect) }
    }
  }

  // 3. 默认 100×100
  return { w: 100, h: 100 }
}

/** 从 CSS 字符串中提取 left/top/width/height（px 值，用于对齐计算） */
function parseCssRect(css: string, deviceW: number, deviceH: number): { w: number; h: number; x: number; y: number } {
  let w = 100, h = 100, x = 0, y = 0
  css.split(';').forEach(d => {
    const i = d.indexOf(':'); if (i < 0) return
    const k = d.slice(0, i).trim().toLowerCase()
    const v = d.slice(i + 1).trim()
    if (!k || !v) return
    if (k === 'width') w = v.endsWith('%') ? deviceW * parseFloat(v) / 100 : parseFloat(v) || 100
    if (k === 'height') h = v.endsWith('%') ? deviceH * parseFloat(v) / 100 : parseFloat(v) || 100
    if (k === 'left') x = v.endsWith('%') ? deviceW * parseFloat(v) / 100 : parseFloat(v) || 0
    if (k === 'top') y = v.endsWith('%') ? deviceH * parseFloat(v) / 100 : parseFloat(v) || 0
  })
  return { w, h, x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y }
}

/** 从 CSS 字符串中提取 left/top 像素值，用于粘贴 CSS 后自动同步 x/y */
function extractCssPosition(css: string, deviceW: number, deviceH: number): { x?: number; y?: number; w?: number; h?: number } {
  const declarations = parseCssDeclarations(css)
  return {
    x: cssLengthToPx(declarations.left, deviceW),
    y: cssLengthToPx(declarations.top, deviceH),
    w: cssLengthToPx(declarations.width, deviceW),
    h: cssLengthToPx(declarations.height, deviceH),
  }
}

function getLayerVisualRect(layer: TemplateLayer, deviceW: number, deviceH: number): { x: number; y: number; w: number; h: number } {
  if (layer.type === 'text') {
    const textStyle = resolveTextStyle(layer, deviceW, deviceH)
    return {
      x: textStyle.visualLeft,
      y: textStyle.visualTop,
      w: textStyle.width ?? 100,
      h: textStyle.height ?? textStyle.lineHeightPx,
    }
  }

  const css = {
    ...parseCssDeclarations(layer.css_code || ''),
    ...parseCssDeclarations(layer.css_position_code || ''),
  }
  let w = cssLengthToPx(css.width, deviceW) ?? layer.css_width
  let h = cssLengthToPx(css.height, deviceH) ?? layer.css_height
  if ((w == null || h == null) && layer.type === 'svg') {
    const dimensions = parseSvgDimensions(layer.css_code || '', deviceW, deviceH)
    w ??= dimensions.w
    h ??= dimensions.h
  }
  w ??= 100
  h ??= 100

  let x = cssLengthToPx(css.left, deviceW)
  if (x == null && css.right != null) x = deviceW - (cssLengthToPx(css.right, deviceW) ?? 0) - w
  x ??= layer.x
  let y = cssLengthToPx(css.top, deviceH)
  if (y == null && css.bottom != null) y = deviceH - (cssLengthToPx(css.bottom, deviceH) ?? 0) - h
  y ??= layer.y
  const translation = resolveCssTranslation(css.transform, w, h)
  return { x: x + translation.x, y: y + translation.y, w, h }
}

function serializeCssDeclarations(css: Record<string, string>): string {
  return Object.entries(css).map(([property, value]) => `${property}: ${value};`).join('\n')
}

/** 拖拽后将视觉坐标固化为 left/top，移除会继续覆盖坐标的定位约束。 */
function writeDraggedPosition(layer: TemplateLayer, x: number, y: number): Pick<TemplateLayer, 'x' | 'y' | 'css_position_code'> {
  const positionCss = parseCssDeclarations(layer.css_position_code || '')
  const styleCss = parseCssDeclarations(layer.css_code || '')
  const merged = { ...styleCss, ...positionCss }
  const cleanedTransform = stripTranslateTransform(merged.transform)

  for (const property of [
    'right', 'bottom', 'inset', 'inset-block', 'inset-inline', 'inset-block-start', 'inset-block-end',
    'inset-inline-start', 'inset-inline-end',
  ]) {
    if (merged[property] != null) positionCss[property] = 'auto'
  }
  positionCss.left = `${Math.round(x)}px`
  positionCss.top = `${Math.round(y)}px`
  if (merged.transform && cleanedTransform !== merged.transform) positionCss.transform = cleanedTransform

  return {
    x: Math.round(x),
    y: Math.round(y),
    css_position_code: serializeCssDeclarations(positionCss),
  }
}

/** 从 CSS 字符串中提取第一个颜色值（用于 SVG/Shape 图层默认颜色） */
function extractCssColor(css: string): string | null {
  // 按优先级匹配：background-color, background, color, fill, stroke
  const props = ['background-color', 'background', 'color', 'fill', 'stroke']
  for (const prop of props) {
    const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i')
    const m = css.match(re)
    if (m) {
      const val = m[1].trim()
      // 跳过 currentColor、transparent、url()、linear-gradient 等
      if (/currentcolor|transparent|url\(|gradient|inherit|initial|unset/i.test(val)) continue
      // 提取 hex/rgb/rgba/hsl/named color
      const colorMatch = val.match(/(#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\)|hsla?\\([^)]+\\))/)
      if (colorMatch) return colorMatch[0]
    }
  }
  return null
}

/** 从 SVG 内容中提取 fill / stroke 颜色（跳过 none / currentColor / url(#...)） */
function extractSvgColor(svg: string): string | null {
  // 匹配 fill="..." 或 stroke="..."（属性形式）
  const attrRe = /(?:fill|stroke)\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(svg)) !== null) {
    const val = m[1].trim()
    if (/^(none|currentColor|url\s*\(|transparent)$/i.test(val)) continue
    if (/^#[0-9a-fA-F]{3,8}$/.test(val) || /^rgba?\s*\(/.test(val) || /^hsla?\s*\(/.test(val)) return val
  }
  // 匹配内联 style 中的 fill:... 或 stroke:...
  const styleRe = /style\s*=\s*"([^"]*)"/gi
  while ((m = styleRe.exec(svg)) !== null) {
    const style = m[1]
    const colorMatch = style.match(/(?:fill|stroke)\s*:\s*([^;]+)/i)
    if (colorMatch) {
      const val = colorMatch[1].trim()
      if (/^(none|currentColor|url\s*\(|transparent)$/i.test(val)) continue
      const hex = val.match(/(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))/)
      if (hex) return hex[0]
    }
  }
  return null
}

/* ══════════════════════════════════════════════════════════
   可拖拽数值输入 (ScrubInput)
   ══════════════════════════════════════════════════════════ */

function ScrubInput({
  value, min, max, step, unit, onChange,
}: {
  value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void
}) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startVal = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    startX.current = e.clientX
    startVal.current = value
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }, [value])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - startX.current
    const steps = dx / 2
    const raw = startVal.current + steps * step
    const clamped = Math.min(max, Math.max(min, Math.round(raw / step) * step))
    onChange(clamped)
  }, [min, max, step, onChange])

  const onPointerUp = useCallback(() => { dragging.current = false }, [])

  return (
    <input type="number" min={min} max={max} step={step} value={value}
      onChange={e => { const v = +e.target.value; if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v))) }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      className="w-16 px-2 py-1 rounded-lg text-xs text-right outline-none font-mono cursor-ew-resize"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
  )
}

/* ══════════════════════════════════════════════════════════
   对齐操作（Figma 风格）
   ══════════════════════════════════════════════════════════ */

type AlignOp = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'center'

/** 对齐按钮 SVG 图标 */
const ALIGN_ICONS: Record<AlignOp, JSX.Element> = {
  'left': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="7" height="3" rx="0.5" fill="currentColor"/><rect x="1" y="8" width="10" height="3" rx="0.5" fill="currentColor"/></svg>,
  'center-h': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3.5" y="3" width="7" height="3" rx="0.5" fill="currentColor"/><rect x="2" y="8" width="10" height="3" rx="0.5" fill="currentColor"/></svg>,
  'right': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="6" y="3" width="7" height="3" rx="0.5" fill="currentColor"/><rect x="3" y="8" width="10" height="3" rx="0.5" fill="currentColor"/></svg>,
  'top': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="1" width="3" height="7" rx="0.5" fill="currentColor"/><rect x="8" y="1" width="3" height="10" rx="0.5" fill="currentColor"/></svg>,
  'center-v': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="3.5" width="3" height="7" rx="0.5" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/></svg>,
  'bottom': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="6" width="3" height="7" rx="0.5" fill="currentColor"/><rect x="8" y="3" width="3" height="10" rx="0.5" fill="currentColor"/></svg>,
  'center': <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="6" height="6" rx="1" fill="currentColor"/></svg>,
}

const ALIGN_LABELS: Record<AlignOp, string> = {
  'left': '左对齐', 'center-h': '水平居中', 'right': '右对齐',
  'top': '顶对齐', 'center-v': '垂直居中', 'bottom': '底对齐',
  'center': '水平+垂直居中',
}

/* ══════════════════════════════════════════════════════════
   主组件
   ══════════════════════════════════════════════════════════ */

export function TemplateCreator({ onSaved, editTemplate }: { onSaved?: () => void; editTemplate?: any }) {
  // 编辑模式：从 editTemplate 还原设备数据
  const restoreFromEdit = () => {
    if (!editTemplate?.devices) return []
    return editTemplate.devices.map((d: any) => ({
      name: d.name || '', width: d.width || 336, height: d.height || 480, borderRadius: d.corner_radius ?? 48,
      layers: Array.isArray(d.layers) ? d.layers.map((l: any, i: number) => ({
        id: `l_${Date.now()}_${i}`, // 重新生成 ID
        name: l.name || '图层',
        type: l.type || 'color',
        css_code: l.css_code || '',
        z_index: l.z_index ?? i,
        x: l.x ?? 0,
        y: l.y ?? 0,
        css_width: l.css_width != null && Number.isFinite(Number(l.css_width)) ? Number(l.css_width) : undefined,
        css_height: l.css_height != null && Number.isFinite(Number(l.css_height)) ? Number(l.css_height) : undefined,
        css_position_code: l.css_position_code || '',
        allow_user_upload: l.allow_user_upload ?? false,
        image_url: l.image_url || '',
        show_on_client: l.show_on_client ?? true,
        admin_preview_url: '',
        adjustments: l.adjustments ? { ...DEFAULT_ADJUSTMENTS, ...l.adjustments } : undefined,
        effects: l.effects ? { ...DEFAULT_EFFECTS, ...l.effects } : { ...DEFAULT_EFFECTS },
        group_id: l.group_id,
        visible_in_export: l.visible_in_export ?? true,
        color_mode: l.color_mode,
        color: l.color,
        picker_default: l.picker_default,
        text_content: l.text_content,
        font_family: l.font_family,
        font_weight: l.font_weight,
        font_size: l.font_size,
        line_height: l.line_height,
        letter_spacing: l.letter_spacing,
        text_color: l.text_color,
        text_align: l.text_align,
        text_vertical_align: l.text_vertical_align,
      })) : [],
    }))
  }

  const [devices, setDevices] = useState<DeviceWithLayers[]>(restoreFromEdit)
  const [selDev, setSelDev] = useState(0)
  const [showCustom, setShowCustom] = useState(false)
  const [customDev, setCustomDev] = useState<DeviceConfig>({ name: '', width: 300, height: 400, borderRadius: 0 })
  const [tplName, setTplName] = useState(editTemplate?.name || '')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const saveInFlightRef = useRef(false)
  // 创建成功后立即记录服务端 ID；同步引用避免下一次渲染前再次点击仍读取旧值。
  const persistedTemplateIdRef = useRef<number | null>(editTemplate?.id ?? null)

  // 字体
  const [fontList, setFontList] = useState<FontRecord[]>([])
  const [fontPreviewVersion, setFontPreviewVersion] = useState(0)
  const loadedFontKeysRef = useRef<Set<string>>(new Set())
  const fontFileRef = useRef<HTMLInputElement>(null)
  const [fontLoading, setFontLoading] = useState(false)

  // 加载字体列表
  useEffect(() => {
    apiFetch('/api/fonts').then(setFontList).catch(() => {})
  }, [])

  // 字体属于整个预览画布的渲染依赖，由父级统一加载；加载完成后重绘所有文字图层。
  useEffect(() => {
    let cancelled = false
    const usedFamilies = new Set(
      devices.flatMap(device => device.layers.flatMap(layer => {
        if (layer.type !== 'text') return []
        const family = resolveTextStyle(layer, device.width, device.height).fontFamily
        return family ? [family] : []
      }))
    )
    const loads = fontList.flatMap(font => {
      if (!font.url) return []
      const family = font.family_name || font.original_name
      const key = `${family}|${font.url}|${font.style}|${font.weight}|${font.is_variable}`
      if (!family || !usedFamilies.has(family) || loadedFontKeysRef.current.has(key)) return []

      loadedFontKeysRef.current.add(key)
      const source = /^https?:\/\//i.test(font.url) ? font.url : `${API_BASE}${font.url}`
      const descriptors: FontFaceDescriptors = {
        style: normalizeFontFaceStyle(font.style),
        weight: font.is_variable ? '100 900' : String(font.weight || 400),
      }
      const load = new FontFace(family, `url("${source}")`, descriptors)
        .load()
        .then(loaded => {
          document.fonts.add(loaded)
          return true
        })
        .catch(() => {
          loadedFontKeysRef.current.delete(key)
          return false
        })
      return [load]
    })

    if (loads.length > 0) {
      Promise.all(loads).then(results => {
        if (!cancelled && results.some(Boolean)) setFontPreviewVersion(v => v + 1)
      })
    }
    return () => { cancelled = true }
  }, [fontList, devices])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedIdsRef = useRef<Set<string>>(new Set())

  // 预览区拖拽状态 — 使用 ref 避免依赖变更导致事件监听器重建（修复粘滞光标 bug）
  interface DragEntry { id: string; origX: number; origY: number }
  const canvasDragRef = useRef<{ entries: DragEntry[]; startX: number; startY: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [snapGuides, setSnapGuides] = useState<{ type: 'h' | 'v'; pos: number; label: string }[]>([])
  const viewportRef = useRef<HTMLDivElement>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(400)

  // 预览卡片只提供可用宽度；高度由设备视口决定，避免内容高度反向影响缩放。
  useEffect(() => {
    const el = previewContainerRef.current; if (!el) return
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width && width > 0) setContainerWidth(width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const device = devices[selDev]
  const layers: TemplateLayer[] = device?.layers ?? []
  // ref 必须在 layers 之后声明，否则 useRef(layers) 会触发 const TDZ 错误
  const layersRef = useRef<TemplateLayer[]>(layers)
  layersRef.current = layers
  selectedIdsRef.current = selectedIds

  const setDeviceLayers = useCallback((fn: (prev: TemplateLayer[]) => TemplateLayer[]) => {
    setDevices(prev => prev.map((d, i) => i === selDev ? { ...d, layers: fn(d.layers) } : d))
  }, [selDev])

  /* ── Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 ── */
  const devicesRef = useRef<DeviceWithLayers[]>([])
  devicesRef.current = devices
  const undoStackRef = useRef<string[]>([])
  const redoStackRef = useRef<string[]>([])
  const lastUndoRef = useRef('')

  // devices 变更时推入 undo 栈（防抖 500ms，跳过拖拽期间的频繁更新）
  useEffect(() => {
    const serialized = JSON.stringify(devices)
    if (serialized === lastUndoRef.current) return
    const timer = setTimeout(() => {
      if (lastUndoRef.current) {
        undoStackRef.current.push(lastUndoRef.current)
        if (undoStackRef.current.length > 60) undoStackRef.current.shift()
        redoStackRef.current = [] // 新操作清空重做栈
      }
      lastUndoRef.current = serialized
    }, 500)
    return () => clearTimeout(timer)
  }, [devices])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return
      // Ctrl+Z → 撤销
      if (e.key === 'z' && !e.shiftKey) {
        if (undoStackRef.current.length === 0) return
        e.preventDefault()
        redoStackRef.current.push(JSON.stringify(devicesRef.current))
        const prev = undoStackRef.current.pop()!
        lastUndoRef.current = prev
        setDevices(JSON.parse(prev))
      }
      // Ctrl+Shift+Z → 重做
      if (e.key === 'z' && e.shiftKey) {
        if (redoStackRef.current.length === 0) return
        e.preventDefault()
        undoStackRef.current.push(JSON.stringify(devicesRef.current))
        const next = redoStackRef.current.pop()!
        lastUndoRef.current = next
        setDevices(JSON.parse(next))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // 稳定 — 全部用 ref

  /* ── 多选 ── */
  const handleLayerSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedIds(new Set([id]))
    }
  }, [])

  const handleCanvasSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedIds(new Set([id]))
    }
    setExpandedId(id)
  }, [])

  /* ── 对齐操作 ── */
  const handleAlign = useCallback((op: AlignOp) => {
    if (!device || selectedIds.size === 0) return
    const selLayers = layers.filter(l => selectedIds.has(l.id))
    if (selLayers.length === 0) return

    // 从 DOM 实际测量图层渲染尺寸
    const viewportEl = viewportRef.current
    const ps = (viewportEl && device) ? viewportEl.clientWidth / device.width : 1
    const bounds = selLayers.map(layer => {
      const visualRect = getLayerVisualRect(layer, device.width, device.height)
      let w = visualRect.w
      let h = visualRect.h
      const wrapper = viewportEl?.querySelector(`[data-layer-id="${layer.id}"]`) as HTMLElement | undefined
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect()
        w = rect.width / ps
        h = rect.height / ps
      }
      return { layer, x: visualRect.x, y: visualRect.y, w, h }
    })

    // 单选 → 对齐画布；多选 → 对齐选中图层组的包围盒
    const minX = selLayers.length > 1 ? Math.min(...bounds.map(b => b.x)) : 0
    const maxX = selLayers.length > 1 ? Math.max(...bounds.map(b => b.x + b.w)) : device.width
    const minY = selLayers.length > 1 ? Math.min(...bounds.map(b => b.y)) : 0
    const maxY = selLayers.length > 1 ? Math.max(...bounds.map(b => b.y + b.h)) : device.height
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2

    const patches: Partial<TemplateLayer>[] = []

    for (const b of bounds) {
      switch (op) {
        case 'left': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, minX, b.y) }); break
        case 'right': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, maxX - b.w, b.y) }); break
        case 'center-h': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, Math.round(midX - b.w / 2), b.y) }); break
        case 'top': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, b.x, minY) }); break
        case 'bottom': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, b.x, maxY - b.h) }); break
        case 'center-v': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, b.x, Math.round(midY - b.h / 2)) }); break
        case 'center': patches.push({ id: b.layer.id, ...writeDraggedPosition(b.layer, Math.round(midX - b.w / 2), Math.round(midY - b.h / 2)) }); break
      }
    }

    setDeviceLayers(prev => prev.map(l => {
      const patch = patches.find(p => p.id === l.id)
      return patch ? { ...l, ...patch } : l
    }))
  }, [selectedIds, layers, device, setDeviceLayers])

  /* ── 设备操作 ── */
  const addPreset = (p: DeviceConfig) => {
    if (devices.find(d => d.name === p.name)) { setMsg('该设备已添加'); return }
    setDevices(prev => [...prev, { ...p, layers: [] }]); setMsg('')
  }
  const addCustom = () => {
    if (!customDev.name.trim()) { setMsg('请输入设备名称'); return }
    if (devices.find(d => d.name === customDev.name)) { setMsg('设备名称重复'); return }
    setDevices(prev => [...prev, { ...customDev, layers: [] }])
    setCustomDev({ name: '', width: 300, height: 400, borderRadius: 0 }); setShowCustom(false); setMsg('')
  }
  const removeDevice = (idx: number) => {
    setDevices(prev => prev.filter((_, i) => i !== idx))
    if (selDev >= idx && selDev > 0) setSelDev(s => Math.min(s - 1, devices.length - 2))
    else if (idx === 0 && devices.length <= 1) setSelDev(0)
  }

  /* ── 图层操作 ── */
  const addLayer = (type: TemplateLayer['type']) => {
    const defaultCss = type === 'svg'
      ? '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#8884FF"/></svg>'
      : type === 'shape'
      ? 'width: 100px; height: 100px; background: #8884FF; border-radius: 12px;'
      : type === 'text'
      ? '' // text layers don't use css_code
      : 'width: 100%; height: 100%;'
    // SVG 图层：自动从 SVG 内容提取 fill/stroke 颜色作为默认
    // 图形图层：自动从 CSS 代码提取 background-color 作为默认
    const defaultColor = type === 'svg'
      ? extractSvgColor(defaultCss)
      : type !== 'image' ? (extractCssColor(defaultCss) || undefined) : undefined
    const nl: TemplateLayer = {
      id: nextId(), type, name: type === 'image' ? '图片图层' : type === 'svg' ? 'SVG图层' : type === 'text' ? '文字图层' : '图形图层',
      css_code: defaultCss,
      z_index: layers.length, x: 0, y: 0,
      ...(type === 'image' ? { allow_user_upload: true, show_on_client: true, adjustments: { ...DEFAULT_ADJUSTMENTS }, image_url: '' }
        : type === 'text' ? { text_content: '双击编辑文字', font_family: '', font_weight: '400', font_size: 24, line_height: 1.4, letter_spacing: 0, text_color: '#FFFFFF', text_vertical_align: undefined }
        : { color_mode: 'fixed' as const, color: defaultColor }),
      effects: { ...DEFAULT_EFFECTS },
    }
    setDeviceLayers(prev => [nl, ...prev]); setExpandedId(nl.id)
  }
  const updateLayer = (id: string, patch: Partial<TemplateLayer>) =>
    setDeviceLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  const removeLayer = (id: string) => {
    setDeviceLayers(prev => prev.filter(l => l.id !== id))
    if (expandedId === id) setExpandedId(null)
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  /* ── 字体上传 ── */
  const handleFontUpload = async (file: File, isVariable: boolean) => {
    setFontLoading(true)
    try {
      const fd = new FormData()
      fd.append('font', file)
      fd.append('is_variable', String(isVariable))
      const res = await apiFetch('/api/fonts/upload', { method: 'POST', body: fd })
      // 刷新字体列表
      const fonts = await apiFetch('/api/fonts')
      setFontList(fonts)
      setMsg('字体上传成功')
      return res
    } catch (err: any) {
      setMsg(err.message || '字体上传失败')
      throw err
    } finally {
      setFontLoading(false)
    }
  }

  /* ── Delete 键删除选中图层 + 成组快捷键 ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'
      const isMod = e.ctrlKey || e.metaKey

      // Ctrl+G → 成组
      if (isMod && e.key === 'g' && !e.shiftKey && selectedIds.size > 1 && !isInput) {
        e.preventDefault()
        const gid = `g_${Date.now()}`
        setDeviceLayers(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, group_id: gid } : l))
        return
      }
      // Ctrl+Shift+G → 解组
      if (isMod && e.key === 'g' && e.shiftKey && selectedIds.size > 0 && !isInput) {
        e.preventDefault()
        setDeviceLayers(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, group_id: undefined } : l))
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && !isInput) {
        e.preventDefault()
        setDeviceLayers(prev => prev.filter(l => !selectedIds.has(l.id)))
        setSelectedIds(new Set())
        if (expandedId && selectedIds.has(expandedId)) setExpandedId(null)
      }

      // 方向键微调选中图层位置（1px，Shift+方向键 10px）
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const
      if (arrowKeys.includes(e.key as typeof arrowKeys[number]) && selectedIds.size > 0 && !isInput && !isMod) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        setDeviceLayers(prev => prev.map(l => {
          if (!selectedIds.has(l.id)) return l
          const nx = l.x + dx
          const ny = l.y + dy
          return { ...l, ...writeDraggedPosition(l, nx, ny) }
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, expandedId, setDeviceLayers])

  /* ── 列表拖拽排序 ── */
  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault(); if (dragIdx === null || dragIdx === idx) return
    setDeviceLayers(prev => {
      const r = [...prev]; const [m] = r.splice(dragIdx, 1); r.splice(idx, 0, m)
      // index 0 = 列表最上面 = 最高层（z_index 最大）
      return r.map((l, i) => ({ ...l, z_index: r.length - 1 - i }))
    }); setDragIdx(idx)
  }
  const handleDragEnd = () => setDragIdx(null)

  /* ── 预览区图层拖拽 + 自动吸附（Figma 风格：多层参考线 + 图层间吸附 + 中心十字线） ── */
  const SNAP_THRESHOLD = 12 // 设备坐标像素，磁吸范围

  const startCanvasDrag = (layerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const curLayers = layersRef.current
    const l = curLayers.find(l => l.id === layerId); if (!l) return
    const sel = selectedIdsRef.current
    // 拖拽图层在多选中 → 移动整个组（用 ref 确保读到最新 selection）
    if (sel.size > 1 && sel.has(layerId)) {
      const entries: DragEntry[] = []
      for (const id of sel) {
        const sl = curLayers.find(l => l.id === id)
        if (sl) {
          const rect = getLayerVisualRect(sl, device!.width, device!.height)
          entries.push({ id: sl.id, origX: rect.x, origY: rect.y })
        }
      }
      canvasDragRef.current = { entries, startX: e.clientX, startY: e.clientY }
    } else {
      const rect = getLayerVisualRect(l, device!.width, device!.height)
      canvasDragRef.current = { entries: [{ id: layerId, origX: rect.x, origY: rect.y }], startX: e.clientX, startY: e.clientY }
    }
    setIsDragging(true)
    if (!sel.has(layerId)) {
      if (e.shiftKey) {
        setSelectedIds(prev => { const next = new Set(prev); next.add(layerId); return next })
      } else {
        setSelectedIds(new Set([layerId]))
      }
    }
  }

  useEffect(() => {
    if (!isDragging || !device) return
    const SNAP_DIST = SNAP_THRESHOLD

    const onMove = (e: PointerEvent | MouseEvent) => {
      const drag = canvasDragRef.current
      if (!drag) return
      const currentLayers = layersRef.current
      const ps = previewScaleRef.current
      const dx = (e.clientX - drag.startX) / ps
      const dy = (e.clientY - drag.startY) / ps

      // 使用第一个图层的尺寸做吸附参考（SVG 图层用 parseSvgDimensions）
      const firstId = drag.entries[0].id
      const refLayer = currentLayers.find(l => l.id === firstId)
      const refRect = refLayer ? getLayerVisualRect(refLayer, device.width, device.height) : { x: 0, y: 0, w: 100, h: 100 }
      const dragW = refRect.w
      const dragH = refRect.h

      const firstOrig = drag.entries[0]
      let nx = firstOrig.origX + dx
      let ny = firstOrig.origY + dy

      // 构建吸附目标（其他图层 + 画布边线）
      const otherLayers = currentLayers.filter(l => !drag.entries.some(e => e.id === l.id))
      const vTargets: { pos: number; label: string; isCenter: boolean }[] = [
        { pos: 0, label: 'canvas-left', isCenter: false },
        { pos: device.width / 2, label: '画布垂直中线', isCenter: true },
        { pos: device.width, label: 'canvas-right', isCenter: false },
      ]
      const hTargets: { pos: number; label: string; isCenter: boolean }[] = [
        { pos: 0, label: 'canvas-top', isCenter: false },
        { pos: device.height / 2, label: '画布水平中线', isCenter: true },
        { pos: device.height, label: 'canvas-bottom', isCenter: false },
      ]
      for (const ol of otherLayers) {
        const otherRect = getLayerVisualRect(ol, device.width, device.height)
        vTargets.push({ pos: otherRect.x, label: '图层左边缘', isCenter: false })
        vTargets.push({ pos: otherRect.x + otherRect.w / 2, label: '图层垂直中线', isCenter: true })
        vTargets.push({ pos: otherRect.x + otherRect.w, label: '图层右边缘', isCenter: false })
        hTargets.push({ pos: otherRect.y, label: '图层上边缘', isCenter: false })
        hTargets.push({ pos: otherRect.y + otherRect.h / 2, label: '图层水平中线', isCenter: true })
        hTargets.push({ pos: otherRect.y + otherRect.h, label: '图层下边缘', isCenter: false })
      }

      const guides: { type: 'h' | 'v'; pos: number; label: string }[] = []
      let closestVDist = Infinity, closestVSnap: number | null = null, closestVGuide: typeof vTargets[0] | null = null

      for (const t of vTargets) {
        for (const sp of [{ snap: t.pos }, { snap: t.pos - dragW / 2 }, { snap: t.pos - dragW }]) {
          const dist = Math.abs(nx - sp.snap)
          if (dist < SNAP_DIST / ps && dist < closestVDist) { closestVDist = dist; closestVSnap = sp.snap; closestVGuide = t }
        }
      }
      if (closestVSnap !== null && closestVGuide) { nx = closestVSnap; guides.push({ type: 'v', pos: closestVGuide.pos, label: closestVGuide.label }) }

      let closestHDist = Infinity, closestHSnap: number | null = null, closestHGuide: typeof hTargets[0] | null = null
      for (const t of hTargets) {
        for (const sp of [{ snap: t.pos }, { snap: t.pos - dragH / 2 }, { snap: t.pos - dragH }]) {
          const dist = Math.abs(ny - sp.snap)
          if (dist < SNAP_DIST / ps && dist < closestHDist) { closestHDist = dist; closestHSnap = sp.snap; closestHGuide = t }
        }
      }
      if (closestHSnap !== null && closestHGuide) { ny = closestHSnap; guides.push({ type: 'h', pos: closestHGuide.pos, label: closestHGuide.label }) }

      setSnapGuides(guides)

      // 移动所有选中图层
      const deltaX = nx - firstOrig.origX
      const deltaY = ny - firstOrig.origY
      setDeviceLayers(prev => prev.map(l => {
        const entry = drag.entries.find(e => e.id === l.id)
        return entry ? { ...l, ...writeDraggedPosition(l, entry.origX + deltaX, entry.origY + deltaY) } : l
      }))
    }

    const onUp = () => { canvasDragRef.current = null; setIsDragging(false); setSnapGuides([]) }
    const onVisibility = () => { if (document.hidden) { canvasDragRef.current = null; setIsDragging(false); setSnapGuides([]) } }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isDragging, device, setDeviceLayers])

  /* ── 保存 ── */
  const handleSave = async () => {
    if (saveInFlightRef.current) return
    if (!tplName.trim()) { setMsg('请输入模板名称'); return }
    if (devices.length === 0) { setMsg('请至少添加一个设备'); return }
    if (devices.every(d => d.layers.length === 0)) { setMsg('每个设备至少需要一个图层'); return }
    saveInFlightRef.current = true
    setSaving(true)
    try {
      const payload = {
        name: tplName.trim(),
        devices: devices.map(d => ({
          name: d.name, width: d.width, height: d.height, corner_radius: d.borderRadius, background: d.background || '#111',
          layers: d.layers.map(({ id, admin_preview_url: _adminPreviewUrl, ...rest }) => ({
            ...rest,
            visible_in_export: rest.visible_in_export ?? true,
          })),
        })),
      }
      const templateId = persistedTemplateIdRef.current
      if (templateId != null) {
        await apiFetch(`/api/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(payload) })
        setMsg('模板更新成功')
      } else {
        const result = await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify(payload) })
        if (result?.id != null) persistedTemplateIdRef.current = Number(result.id)
        setMsg('模板创建成功，后续保存将更新当前模板')
      }
      onSaved?.()
    } catch (err: any) { setMsg(err.message || '保存失败') }
    finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  /* ── 预览缩放 — 只由舞台可用宽度决定，设备画布始终在舞台内双轴居中 ── */
  const previewScale = useMemo(() => {
    if (!device) return 1
    const availableWidth = Math.max(0, containerWidth - 32)
    return Math.min(availableWidth / device.width, 1)
  }, [device, containerWidth])
  const previewWidth = device ? device.width * previewScale : 0
  const previewHeight = device ? device.height * previewScale : 0

  // ref 同步 — 拖拽闭包需要读取最新 previewScale，不能闭包捕获 state
  const previewScaleRef = useRef(1)
  previewScaleRef.current = previewScale

  /* ── 图层预览渲染 ── */
  const renderLayerPreview = (layer: TemplateLayer) => {
    const isSelected = selectedIds.has(layer.id)
    // 图片图层的调整滤镜
    const filterParts: string[] = []
    if (layer.type === 'image' && layer.adjustments) {
      const a = layer.adjustments
      if (a.blur > 0) filterParts.push(`blur(${a.blur}px)`)
      if (a.contrast !== 100) filterParts.push(`contrast(${a.contrast}%)`)
      if (a.brightness !== 100) filterParts.push(`brightness(${a.brightness}%)`)
    }
    const filter = filterParts.length > 0 ? filterParts.join(' ') : undefined
    const color = layer.type !== 'image' ? (layer.color_mode === 'fixed' ? layer.color : '#8884FF') : undefined

    // 通用特殊效果
    const fx = layer.effects
    const fxOpacity = fx && fx.opacity < 100 ? fx.opacity / 100 : undefined
    const fxFilterParts: string[] = []
    if (fx && fx.blur_type !== 'none' && fx.blur_value > 0 && fx.blur_type === 'gaussian') {
      fxFilterParts.push(`blur(${fx.blur_value}px)`)
    }
    const fxFilter = fxFilterParts.length > 0 ? fxFilterParts.join(' ') : undefined
    // 合并所有效果到 style
    const mergeFilter = [filter, fxFilter].filter(Boolean).join(' ') || undefined

    // 背景模糊：用内部 overlay div 实现，backdrop-filter 模糊图层下方内容
    // overlay 半透明背景确保 blur 效果可见（类似毛玻璃）
    const backdropBlur = fx && fx.blur_type === 'backdrop' && fx.blur_value > 0 ? fx.blur_value : 0

    // 选中边框样式
    const selBorder = isSelected ? { outline: '2px solid var(--accent)', outlineOffset: '1px' } : {}

    if (layer.type === 'svg') {
      const intrinsicDims = parseSvgDimensions(layer.css_code || '', device!.width, device!.height)
      const svgDims = { w: layer.css_width ?? intrinsicDims.w, h: layer.css_height ?? intrinsicDims.h }
      // SVG 的 mask-image：用 SVG 自身作为遮罩，使背景模糊仅作用于可见形状
      const svgMaskUri = layer.css_code
        ? `url('data:image/svg+xml,${encodeURIComponent(layer.css_code)}')`
        : undefined
      const layerStyle = resolveLayerPreviewStyle(layer, {
        width: svgDims.w,
        height: svgDims.h,
        overflow: 'hidden',
        color,
        filter: mergeFilter,
        opacity: fxOpacity,
      })
      return (
        <div key={layer.id} data-layer-id={layer.id}
          style={{ ...layerStyle, cursor: 'grab', ...selBorder }}
          onMouseDown={(e) => { handleCanvasSelect(layer.id, e); startCanvasDrag(layer.id, e) }}>
          {/* 背景模糊 overlay — 使用 mask-image 裁剪到 SVG 可见形状 */}
          {backdropBlur > 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`,
              background: 'rgba(255,255,255,0.08)',
              pointerEvents: 'none', zIndex: 0,
              ...(svgMaskUri ? { maskImage: svgMaskUri, WebkitMaskImage: svgMaskUri } : {}),
            }} />
          )}
          <div style={{ position: 'relative', zIndex: 1, pointerEvents: 'none', width: '100%', height: '100%' }}
            dangerouslySetInnerHTML={{ __html: forceSvgFill(layer.css_code || '') }} />
        </div>
      )
    }
    if (layer.type === 'shape') {
      const layerStyle = resolveLayerPreviewStyle(layer, {
        width: layer.css_width,
        height: layer.css_height,
        color,
        filter: mergeFilter,
        opacity: fxOpacity,
      })
      return (
        <div key={layer.id} data-layer-id={layer.id}
          style={{ ...layerStyle, cursor: 'grab', ...selBorder }}
          onMouseDown={(e) => { handleCanvasSelect(layer.id, e); startCanvasDrag(layer.id, e) }}>
          {/* 背景模糊 overlay */}
          {backdropBlur > 0 && (
            <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
          )}
        </div>
      )
    }
    if (layer.type === 'text') {
      const textStyle = resolveTextStyle(layer, device!.width, device!.height)
      const vAlignMap: Record<string, React.CSSProperties['justifyContent']> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }
      const layerStyle = resolveLayerPreviewStyle(layer, {
        width: textStyle.width,
        height: textStyle.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: vAlignMap[textStyle.verticalAlign],
        fontFamily: textStyle.fontFamily,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        fontSize: textStyle.fontSize,
        lineHeight: `${textStyle.lineHeightPx}px`,
        letterSpacing: textStyle.letterSpacingPx,
        color: textStyle.color,
        filter: mergeFilter,
        opacity: fxOpacity,
        textAlign: textStyle.textAlign,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      })
      return (
        <div key={`${layer.id}-${fontPreviewVersion}`} data-layer-id={layer.id}
          style={{ ...layerStyle, cursor: 'grab', ...selBorder }}
          onMouseDown={(e) => { handleCanvasSelect(layer.id, e); startCanvasDrag(layer.id, e) }}>
          {backdropBlur > 0 && (
            <div style={{ position: 'absolute', inset: '-4px', backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
          )}
          <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none', width: '100%' }}>
            {layer.text_content || ''}
          </span>
        </div>
      )
    }
    // image layer — 模板框只负责几何和裁剪，调整参数只作用于图片内容。
    const adjustmentTransform = layer.adjustments ? `rotate(${layer.adjustments.rotation}deg) scale(${layer.adjustments.scale})` : undefined
    const layerStyle = resolveLayerPreviewStyle(layer, {
      width: layer.css_width,
      height: layer.css_height,
      overflow: 'hidden',
      opacity: fxOpacity,
    })
    const { boxShadow, objectFit, objectPosition, ...imageLayerStyle } = layerStyle
    return (
      <div key={layer.id} data-layer-id={layer.id}
        style={{ ...imageLayerStyle, cursor: 'grab', ...selBorder }}
        onMouseDown={(e) => { handleCanvasSelect(layer.id, e); startCanvasDrag(layer.id, e) }}>
      {/* 背景模糊 overlay */}
      {backdropBlur > 0 && (
        <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 1, borderRadius: 'inherit' }} />
      )}
      {(layer.admin_preview_url || layer.image_url) ? (
        <img src={layer.admin_preview_url || layer.image_url} alt="" draggable={false}
          style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%', objectFit: objectFit || 'fill', objectPosition, pointerEvents: 'none', transform: adjustmentTransform, filter: mergeFilter }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', pointerEvents: 'none' }}>
          <Image className="w-10 h-10 opacity-30" />
        </div>
      )}
      {/* box-shadow overlay — 置于图片之上确保 inset/normal shadow 都可见 */}
      {boxShadow && (
        <div style={{ position: 'absolute', inset: 0, boxShadow, pointerEvents: 'none', borderRadius: imageLayerStyle.borderRadius != null ? imageLayerStyle.borderRadius : 'inherit', zIndex: 3 }} />
      )}
    </div>
    )
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium"
          style={{ background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)', color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)' }}>
          {msg}
        </div>
      )}

      {/* ═══ 顶部 ═══ */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>模板名称 *</label>
            <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="如：相册表盘 V1"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all self-end"
            style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
            <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存模板'}
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>设备 *</label>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {DEVICE_PRESETS.map(p => {
              const added = !!devices.find(d => d.name === p.name)
              return <button key={p.name} onClick={() => addPreset(p)} disabled={added}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: added ? 'var(--accent-bg)' : 'var(--bg-tertiary)', color: added ? 'var(--accent)' : 'var(--text-secondary)', opacity: added ? 0.5 : 1, cursor: added ? 'default' : 'pointer' }}>
                {p.name} ({p.width}×{p.height})</button>
            })}
            <button onClick={() => setShowCustom(!showCustom)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>+ 自定义</button>
          </div>
          {showCustom && (
            <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
              <input value={customDev.name} onChange={e => setCustomDev(p => ({ ...p, name: e.target.value }))} placeholder="设备名称"
                className="px-3 py-1.5 rounded-lg text-xs outline-none w-32" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <input type="number" value={customDev.width} onChange={e => setCustomDev(p => ({ ...p, width: +e.target.value }))}
                className="px-3 py-1.5 rounded-lg text-xs outline-none w-20" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>×</span>
              <input type="number" value={customDev.height} onChange={e => setCustomDev(p => ({ ...p, height: +e.target.value }))}
                className="px-3 py-1.5 rounded-lg text-xs outline-none w-20" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>圆角</span>
              <input type="number" value={customDev.borderRadius} onChange={e => setCustomDev(p => ({ ...p, borderRadius: +e.target.value }))}
                className="px-3 py-1.5 rounded-lg text-xs outline-none w-20" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              <button onClick={addCustom} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--gradient-accent)' }}>添加</button>
              <button onClick={() => setShowCustom(false)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
            </div>
          )}
          {devices.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {devices.map((d, i) => (
                <div key={i} onClick={() => { setSelDev(i); setExpandedId(null); setSelectedIds(new Set()) }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all"
                  style={{ background: selDev === i ? 'var(--accent-bg)' : 'var(--bg-tertiary)', color: selDev === i ? 'var(--accent)' : 'var(--text-secondary)', border: `1.5px solid ${selDev === i ? 'var(--accent)' : 'transparent'}`, fontWeight: selDev === i ? 600 : 400 }}>
                  <Monitor className="w-3.5 h-3.5" /> {d.name} ({d.width}×{d.height} · {d.layers.length}层)
                  <button onClick={e => { e.stopPropagation(); removeDevice(i) }} className="ml-1 p-0.5 rounded-full hover:bg-white/10"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ 工作区 ═══ */}
      <div className="flex gap-4 flex-col lg:flex-row">
        {/* 左侧预览 */}
        <div className="lg:w-1/2 flex-shrink-0">
          <div className="rounded-2xl p-4 sticky top-4" ref={previewContainerRef}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()) }}
            style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <label className="block text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>预览</label>
            {device ? (
              <div data-preview-stage className="relative flex items-center justify-center w-full"
                style={{ minHeight: previewHeight + 32 }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()) }}>
                <div ref={viewportRef} data-preview-viewport tabIndex={0}
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()) }}
                  style={{ width: previewWidth, height: previewHeight, borderRadius: device.borderRadius * previewScale, overflow: 'hidden', position: 'relative', background: '#111', outline: 'none', flex: '0 0 auto' }}>
                  {/* 描边覆盖在设备视口上，不参与视口尺寸和居中计算。 */}
                  <div style={{ position: 'absolute', inset: 0, border: '2px solid var(--frame-border)', borderRadius: 'inherit', pointerEvents: 'none', zIndex: 101 }} />
                  {/* 设备坐标系容器：实际 device.width × device.height，transform 缩放到屏幕 */}
                  <div onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedIds(new Set()) }}
                    style={{ width: device.width, height: device.height, transform: `scale(${previewScale})`, transformOrigin: 'top left', position: 'relative', overflow: 'hidden' }}>
                    {[...layers].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0)).map(l => renderLayerPreview(l))}
                    {layers.length === 0 && <div className="absolute inset-0 flex items-center justify-center"><p className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无图层</p></div>}
                  </div>
                  {/* Figma 风格吸附参考线 — 渲染在外层（屏幕坐标系） */}
                  {snapGuides.map((g, i) => {
                    const isCenter = g.label.includes('中线')
                    const color = isCenter ? 'rgba(255,90,130,0.85)' : 'rgba(0,150,255,0.55)'
                    const lineW = isCenter ? 1.5 : 1
                    return g.type === 'v'
                      ? <div key={`v${i}`} style={{ position: 'absolute', left: g.pos * previewScale - lineW / 2, top: 0, width: lineW, height: '100%', background: color, pointerEvents: 'none', zIndex: 100 }} />
                      : <div key={`h${i}`} style={{ position: 'absolute', top: g.pos * previewScale - lineW / 2, left: 0, height: lineW, width: '100%', background: color, pointerEvents: 'none', zIndex: 100 }} />
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-16"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先选择设备</p></div>
            )}
            <p className="text-center text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              {device ? `${device.width}×${device.height}px · 圆角 ${device.borderRadius}px · ${layers.length} 个图层${selectedIds.size > 0 ? ` · 已选 ${selectedIds.size} 个` : ''}` : ''}
            </p>
          </div>
        </div>

        {/* 右侧图层编辑 */}
        <div className="lg:w-1/2 flex-shrink-0 space-y-3">
          {!device ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先添加设备</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {(['image', 'svg', 'shape', 'text'] as const).map(t => (
                  <button key={t} onClick={() => addLayer(t)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                    {t === 'image' ? <Image className="w-3.5 h-3.5" /> : t === 'text' ? <Type className="w-3.5 h-3.5" /> : <Shapes className="w-3.5 h-3.5" />}
                    {t === 'image' ? '图片图层' : t === 'svg' ? 'SVG图层' : t === 'text' ? '文字图层' : '图形图层'}
                  </button>
                ))}

                {/* 对齐工具栏 — 始终可见 */}
                <div className="flex items-center gap-0.5 ml-2 pl-2" style={{ borderLeft: '1.5px solid var(--border-color)' }}>
                  {(['left', 'center-h', 'right'] as AlignOp[]).map(op => (
                    <button key={op} onClick={() => handleAlign(op)} disabled={selectedIds.size < 1}
                      className="p-1.5 rounded-md transition-all"
                      title={ALIGN_LABELS[op]}
                      style={{ color: selectedIds.size < 1 ? 'var(--text-muted)' : 'var(--text-secondary)', background: 'transparent', opacity: selectedIds.size < 1 ? 0.35 : 1, cursor: selectedIds.size < 1 ? 'default' : 'pointer' }}>
                      {ALIGN_ICONS[op]}
                    </button>
                  ))}
                  <span className="w-px h-5 mx-1" style={{ background: 'var(--border-color)' }} />
                  {(['top', 'center-v', 'bottom'] as AlignOp[]).map(op => (
                    <button key={op} onClick={() => handleAlign(op)} disabled={selectedIds.size < 1}
                      className="p-1.5 rounded-md transition-all"
                      title={ALIGN_LABELS[op]}
                      style={{ color: selectedIds.size < 1 ? 'var(--text-muted)' : 'var(--text-secondary)', background: 'transparent', opacity: selectedIds.size < 1 ? 0.35 : 1, cursor: selectedIds.size < 1 ? 'default' : 'pointer' }}>
                      {ALIGN_ICONS[op]}
                    </button>
                  ))}
                  <span className="w-px h-5 mx-1" style={{ background: 'var(--border-color)' }} />
                  <button onClick={() => handleAlign('center')} disabled={selectedIds.size < 1}
                    className="p-1.5 rounded-md transition-all"
                    title={ALIGN_LABELS['center']}
                    style={{ color: selectedIds.size < 1 ? 'var(--text-muted)' : 'var(--accent)', background: 'transparent', opacity: selectedIds.size < 1 ? 0.35 : 1, cursor: selectedIds.size < 1 ? 'default' : 'pointer' }}>
                    {ALIGN_ICONS['center']}
                  </button>
                  <span className="w-px h-5 mx-1" style={{ background: 'var(--border-color)' }} />
                  <button onClick={() => {
                    const gid = `g_${Date.now()}`
                    setDeviceLayers(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, group_id: gid } : l))
                  }} disabled={selectedIds.size < 2}
                    className="p-1.5 rounded-md transition-all"
                    title="成组 (Ctrl+G)"
                    style={{ color: selectedIds.size < 2 ? 'var(--text-muted)' : 'var(--accent)', background: 'transparent', opacity: selectedIds.size < 2 ? 0.35 : 1, cursor: selectedIds.size < 2 ? 'default' : 'pointer' }}>
                    <Group className="w-3.5 h-3.5" />
                  </button>
                  {layers.some(l => selectedIds.has(l.id) && l.group_id) && (
                    <button onClick={() => {
                      setDeviceLayers(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, group_id: undefined } : l))
                    }}
                      className="p-1.5 rounded-md transition-all"
                      title="解组 (Ctrl+Shift+G)"
                      style={{ color: 'var(--danger)', background: 'transparent' }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())}
                      className="p-1.5 rounded-md transition-all ml-1" title="取消选择"
                      style={{ color: 'var(--text-muted)' }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {layers.length === 0 ? (
                <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无图层，点击上方按钮添加</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {layers.map((layer, idx) => (
                    <LayerCard key={layer.id} layer={layer} idx={idx} dragIdx={dragIdx}
                      expanded={expandedId === layer.id}
                      selected={selectedIds.has(layer.id)}
                      onToggle={() => setExpandedId(expandedId === layer.id ? null : layer.id)}
                      onSelect={(e) => handleLayerSelect(layer.id, e)}
                      onUpdate={p => updateLayer(layer.id, p)}
                      onDelete={() => removeLayer(layer.id)}
                      onDragStart={() => { handleDragStart(idx); setExpandedId(null) }}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      fontList={fontList} onFontUpload={handleFontUpload} fontLoading={fontLoading}
                      deviceW={device!.width} deviceH={device!.height} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   特效面板 — 透明度 + 模糊（所有图层类型共用）
   ══════════════════════════════════════════════════════════ */

function EffectsPanel({ layer, onUpdate }: { layer: TemplateLayer; onUpdate: (p: Partial<TemplateLayer>) => void }) {
  const fx = layer.effects || { ...DEFAULT_EFFECTS }
  const setFx = (patch: Partial<LayerEffects>) => onUpdate({ effects: { ...fx, ...patch } })

  return (
    <div className="space-y-2.5">
      <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>特殊效果</label>
      {/* 透明度 */}
      <div className="flex items-center gap-2">
        <span className="text-xs w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>透明度</span>
        <input type="range" min={0} max={100} step={1} value={fx.opacity}
          onChange={e => setFx({ opacity: +e.target.value })}
          className="flex-1" style={{ accentColor: 'var(--accent)' }}
          onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} />
        <ScrubInput value={fx.opacity} min={0} max={100} step={1} unit="%"
          onChange={v => setFx({ opacity: v })} />
      </div>
      {/* 模糊类型 */}
      <div className="flex items-center gap-2">
        <span className="text-xs w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>模糊类型</span>
        <div className="flex items-center gap-1.5 flex-1">
          {(['none', 'gaussian', 'backdrop'] as const).map(bt => (
            <button key={bt} onClick={() => setFx({ blur_type: bt })}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
              style={{
                background: fx.blur_type === bt ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                color: fx.blur_type === bt ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1.5px solid ${fx.blur_type === bt ? 'var(--accent)' : 'transparent'}`,
              }}>
              {bt === 'none' ? '无' : bt === 'gaussian' ? '高斯模糊' : '背景模糊'}
            </button>
          ))}
        </div>
      </div>
      {/* 模糊值 */}
      {fx.blur_type !== 'none' && (
        <div className="flex items-center gap-2">
          <span className="text-xs w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>模糊强度</span>
          <input type="range" min={0} max={1000} step={1} value={fx.blur_value}
            onChange={e => setFx({ blur_value: +e.target.value })}
            className="flex-1" style={{ accentColor: 'var(--accent)' }}
            onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} />
          <ScrubInput value={fx.blur_value} min={0} max={1000} step={1} unit="px"
            onChange={v => setFx({ blur_value: v })} />
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   LayerCard - 支持 Shift+多选，选中高亮
   ══════════════════════════════════════════════════════════ */

function LayerCard({
  layer, idx, dragIdx, expanded, selected, onToggle, onSelect, onUpdate, onDelete,
  onDragStart, onDragOver, onDragEnd,
  deviceW, deviceH,
  fontList, onFontUpload, fontLoading,
}: {
  layer: TemplateLayer; idx: number; dragIdx: number | null; expanded: boolean; selected: boolean
  onToggle: () => void; onSelect: (e: React.MouseEvent) => void; onUpdate: (p: Partial<TemplateLayer>) => void; onDelete: () => void
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDragEnd: () => void
  deviceW: number; deviceH: number
  fontList: FontRecord[]; onFontUpload: (file: File, isVariable: boolean) => Promise<any>; fontLoading: boolean
}) {
  const [editingName, setEditingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  const groupBadge = layer.group_id
    ? <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>组</span>
    : null

  return (
    <div className="rounded-2xl transition-all" style={{
      background: selected ? 'var(--accent-bg)' : dragIdx === idx ? 'var(--accent-bg)' : 'var(--bg-secondary)',
      boxShadow: selected ? '0 0 0 1.5px var(--accent)' : dragIdx === idx ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
      opacity: dragIdx === idx ? 0.6 : 1,
    }}>
      {/* 头部 - 可拖拽 */}
      <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        className="flex items-center gap-3 p-3 cursor-pointer select-none"
        style={{ cursor: dragIdx === idx ? 'grabbing' : 'grab' }}
        onClick={(e) => { onSelect(e); if (!e.shiftKey) onToggle() }}>
        <div className="flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: 'var(--text-muted)' }}>
          <GripVertical className="w-4 h-4" />
        </div>
        {layer.type === 'image' ? <Image className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
          : layer.type === 'text' ? <Type className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
          : <Shapes className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input ref={nameInputRef} value={layer.name}
              onChange={e => onUpdate({ name: e.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } e.stopPropagation() }}
              onClick={e => e.stopPropagation()}
              className="text-sm font-medium w-full px-1 py-0 rounded outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          ) : (
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}
              onDoubleClick={e => { e.stopPropagation(); setEditingName(true) }}>
              {layer.name}{groupBadge}
            </p>
          )}
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {layer.type === 'image' ? '图片图层' : layer.type === 'svg' ? 'SVG图层' : layer.type === 'text' ? '文字图层' : '图形图层'}
            {` · (${layer.x}, ${layer.y})`}
          </p>
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--danger)' }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={e => { e.stopPropagation(); onToggle() }}>
          {expanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
        </button>
      </div>

      {/* 配置面板 - 带折叠动画 */}
      <div style={{
        maxHeight: expanded ? '5000px' : '0px',
        overflow: 'hidden',
        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
        opacity: expanded ? 1 : 0,
      }}>
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--border-color)' }}>
          <div className="pt-3">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>图层名称</label>
            <input value={layer.name} onChange={e => onUpdate({ name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>
          {/* 导出时是否显示 */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>导出时显示</label>
            <button onClick={() => onUpdate({ visible_in_export: !(layer.visible_in_export ?? true) })}
              className="w-10 h-5 rounded-full transition-all relative" style={{ background: (layer.visible_in_export ?? true) ? 'var(--accent)' : 'var(--border-color)' }}>
              <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow-sm" style={{ left: (layer.visible_in_export ?? true) ? '22px' : '2px' }} />
            </button>
          </div>
          {layer.type === 'image' && <ImageLayerConfig layer={layer} onUpdate={onUpdate} deviceW={deviceW} deviceH={deviceH} />}
          {layer.type === 'svg' && <SvgShapeConfig layer={layer} onUpdate={onUpdate} deviceW={deviceW} deviceH={deviceH} />}
          {layer.type === 'shape' && <SvgShapeConfig layer={layer} onUpdate={onUpdate} deviceW={deviceW} deviceH={deviceH} />}
          {layer.type === 'text' && <TextLayerConfig layer={layer} onUpdate={onUpdate} fontList={fontList} onFontUpload={onFontUpload} fontLoading={fontLoading} deviceW={deviceW} deviceH={deviceH} />}
          {/* 所有图层通用特效 */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            <EffectsPanel layer={layer} onUpdate={onUpdate} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   图片图层配置 — CSS 粘贴自动提取 left/top → x/y
   ══════════════════════════════════════════════════════════ */

function ImageLayerConfig({ layer, onUpdate, deviceW, deviceH }: { layer: TemplateLayer; onUpdate: (p: Partial<TemplateLayer>) => void; deviceW: number; deviceH: number }) {
  const [uploading, setUploading] = useState(false)
  const handleCssChange = (css: string) => {
    const pos = extractCssPosition(css, deviceW, deviceH)
    const patch: Partial<TemplateLayer> = { css_code: css }
    if (pos.x !== undefined) patch.x = pos.x
    if (pos.y !== undefined) patch.y = pos.y
    if (pos.w !== undefined) patch.css_width = pos.w
    if (pos.h !== undefined) patch.css_height = pos.h
    onUpdate(patch)
  }
  const setDimension = (property: 'width' | 'height', value: number) => {
    const positionCss = parseCssDeclarations(layer.css_position_code || '')
    positionCss[property] = `${value}px`
    onUpdate({
      [property === 'width' ? 'css_width' : 'css_height']: value,
      css_position_code: serializeCssDeclarations(positionCss),
    })
  }
  const setPosition = (property: 'x' | 'y', value: number) => {
    const positionCss = parseCssDeclarations(layer.css_position_code || '')
    positionCss[property === 'x' ? 'left' : 'top'] = `${Math.round(value)}px`
    onUpdate({
      [property]: value,
      css_position_code: serializeCssDeclarations(positionCss),
    })
  }
  const selectImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (layer.show_on_client === false) {
        const reader = new FileReader()
        reader.onload = () => onUpdate({ admin_preview_url: reader.result as string })
        reader.readAsDataURL(file)
        return
      }
      setUploading(true)
      try {
        const result = await apiUploadTo('/api/templates/upload-image', file)
        // 仅存相对路径，避免 dev 环境的 localhost 绝对地址写入模板数据
        onUpdate({ image_url: result.path, admin_preview_url: '' })
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '图片上传失败')
      } finally {
        setUploading(false)
      }
    }
    input.click()
  }
  const previewUrl = layer.admin_preview_url || layer.image_url
  const resolvedRect = getLayerVisualRect(layer, deviceW, deviceH)

  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          CSS 样式代码 <span style={{ color: 'var(--text-muted)' }}>（显式 CSS 优先，结构化参数仅作回退）</span>
        </label>
        <textarea value={layer.css_code} onChange={e => handleCssChange(e.target.value)} rows={4}
          placeholder={'width: 100%;\nheight: 100%;'}
          className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono resize-y" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>X 坐标</label>
          <ScrubInput value={layer.x} min={-9999} max={9999} step={1} unit="px"
            onChange={v => setPosition('x', v)} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Y 坐标</label>
          <ScrubInput value={layer.y} min={-9999} max={9999} step={1} unit="px"
            onChange={v => setPosition('y', v)} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>图片宽度</label>
          <ScrubInput value={Math.round(resolvedRect.w)} min={1} max={9999} step={1} unit="px"
            onChange={v => setDimension('width', v)} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>图片高度</label>
          <ScrubInput value={Math.round(resolvedRect.h)} min={1} max={9999} step={1} unit="px"
            onChange={v => setDimension('height', v)} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>上传服务器并在用户端展示</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            关闭时图片仅用于管理端校对，不参与用户预览和导出
          </p>
        </div>
        <button onClick={() => onUpdate({ show_on_client: layer.show_on_client === false })}
          className="w-10 h-5 rounded-full transition-all relative flex-shrink-0"
          style={{ background: layer.show_on_client !== false ? 'var(--accent)' : 'var(--border-color)' }}>
          <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow-sm"
            style={{ left: layer.show_on_client !== false ? '22px' : '2px' }} />
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          {layer.show_on_client !== false ? '服务器图片' : '管理端本地预览图片'}
        </label>
        <div className="flex items-center gap-2">
          {previewUrl ? (
            <div className="flex items-center gap-2 flex-1">
              <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                <img src={previewUrl} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {layer.admin_preview_url ? '仅本次管理端会话可见' : layer.image_url?.split('/').pop()}
                </p>
                <button onClick={() => onUpdate({ image_url: '', admin_preview_url: '' })}
                  className="text-[10px] mt-0.5" style={{ color: 'var(--danger)' }}>清除</button>
              </div>
              <button onClick={selectImage} disabled={uploading}
                className="px-2 py-1 rounded text-[10px] font-medium flex-shrink-0"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? '上传中' : '更换'}
              </button>
            </div>
          ) : (
            <button onClick={selectImage} disabled={uploading}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium transition-colors w-full"
              style={{ border: '2px dashed var(--border-color)', color: 'var(--text-secondary)', opacity: uploading ? 0.6 : 1 }}>
              <Upload className="w-4 h-4" /> {uploading ? '上传中...' : '点击选择图片'}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>允许用户上传图片</label>
        <button onClick={() => onUpdate({ allow_user_upload: !layer.allow_user_upload })}
          className="w-10 h-5 rounded-full transition-all relative" style={{ background: layer.allow_user_upload ? 'var(--accent)' : 'var(--border-color)' }}>
          <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow-sm" style={{ left: layer.allow_user_upload ? '22px' : '2px' }} />
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>图片参数调整</label>
        <div className="space-y-2.5">
          {ADJ_SPECS.map(s => {
            const v = layer.adjustments?.[s.key] ?? getAdjDefault(s.key)
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span className="text-xs w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={v}
                  onChange={e => onUpdate({ adjustments: { ...(layer.adjustments || DEFAULT_ADJUSTMENTS), [s.key]: +e.target.value } })}
                  className="flex-1" style={{ accentColor: 'var(--accent)' }}
                  onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} />
                <ScrubInput value={v} min={s.min} max={s.max} step={s.step} unit={s.unit}
                  onChange={v => onUpdate({ adjustments: { ...(layer.adjustments || DEFAULT_ADJUSTMENTS), [s.key]: v } })} />
                <span className="text-xs w-6 text-left" style={{ color: 'var(--text-muted)' }}>{s.unit}</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   SVG / 图形图层配置（共用，含 x/y 可拖拽输入 + 颜色模式）
   ══════════════════════════════════════════════════════════ */

function SvgShapeConfig({ layer, onUpdate, deviceW, deviceH }: { layer: TemplateLayer; onUpdate: (p: Partial<TemplateLayer>) => void; deviceW: number; deviceH: number }) {
  const isSvg = layer.type === 'svg'
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  /* ── SVG 文件上传 ── */
  const handleSvgUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const svgCode = extractSvgRoot(text)
      // 自动提取 SVG 中的 fill/stroke 颜色作为默认颜色
      const color = extractSvgColor(svgCode)
      // 保存 SVG 原始尺寸，供导出时使用（forceSvgFill 会剥离 width/height 属性）
      const dims = parseSvgDimensions(svgCode, deviceW, deviceH)
      onUpdate({ css_code: svgCode, color, css_width: dims.w, css_height: dims.h })
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.name.endsWith('.svg')) handleSvgUpload(f)
  }

  /* ── CSS 定位粘贴 → 自动同步 x/y ── */
  const handleCssPositionChange = (css: string) => {
    const pos = extractCssPosition(css, deviceW, deviceH)
    const patch: Partial<TemplateLayer> = { name: layer.name, css_code: layer.css_code, css_position_code: css }
    if (pos.x !== undefined) patch.x = pos.x
    if (pos.y !== undefined) patch.y = pos.y
    if (pos.w !== undefined) patch.css_width = Math.round(pos.w)
    if (pos.h !== undefined) patch.css_height = Math.round(pos.h)
    onUpdate(patch)
  }

  const svgName = layer.css_code ? (layer.css_code.match(/<svg[^>]*>/i)?.[0]?.slice(0, 60) || '已上传 SVG') : ''

  return (
    <>
      {isSvg ? (
        /* ══ SVG 图层：纯上传 ══ */
        <>
          <input ref={fileRef} type="file" accept=".svg" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleSvgUpload(f); e.target.value = '' }} />
          <div
            onClick={() => !layer.css_code && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 cursor-pointer transition-all"
            style={{
              background: dragOver ? 'var(--accent-bg)' : layer.css_code ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
              border: `2px dashed ${dragOver ? 'var(--accent)' : layer.css_code ? 'var(--border-color)' : 'var(--text-muted)'}`,
              minHeight: layer.css_code ? 60 : 80,
            }}>
            {layer.css_code ? (
              <div className="flex items-center gap-2 w-full">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span className="text-xs font-medium truncate flex-1" style={{ color: 'var(--text-primary)' }}>{svgName}</span>
                <button onClick={e => { e.stopPropagation(); fileRef.current?.click() }}
                  className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>替换</button>
                <button onClick={e => { e.stopPropagation(); onUpdate({ css_code: '' }) }}
                  className="px-2 py-0.5 rounded text-xs" style={{ color: 'var(--danger)' }}>清除</button>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>点击选择或拖拽 SVG 文件</span>
              </>
            )}
          </div>
        </>
      ) : (
        /* ══ 图形图层：CSS 代码 ══ */
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>CSS 图形代码</label>
          <textarea value={layer.css_code} onChange={e => {
            const css = e.target.value
            const color = extractCssColor(css)
            const pos = extractCssPosition(css, deviceW, deviceH)
            const patch: Partial<TemplateLayer> = { css_code: css, color }
            if (pos.x !== undefined) patch.x = pos.x
            if (pos.y !== undefined) patch.y = pos.y
            if (pos.w !== undefined) patch.css_width = pos.w
            if (pos.h !== undefined) patch.css_height = pos.h
            onUpdate(patch)
          }}
            rows={4}
            placeholder="width: 80px;\nheight: 80px;\nbackground: currentColor;\nborder-radius: 50%;"
            className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono resize-y"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </div>
      )}

      {/* ══ CSS 定位代码（所有类型通用） ══ */}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
          CSS 定位代码 <span style={{ color: 'var(--text-muted)' }}>（与样式代码合并，此处同名属性优先）</span>
        </label>
        <textarea
          rows={3}
          value={layer.css_position_code || ''}
          placeholder="left: 100px;\ntop: 50px;\nwidth: 200px;\nheight: 200px;"
          onChange={e => handleCssPositionChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono resize-y"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
      </div>

      {/* ══ x / y 坐标 ══ */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>X 坐标 ← 拖拽修改</label>
          <ScrubInput value={layer.x} min={-9999} max={9999} step={1} unit="px"
            onChange={v => onUpdate({ x: v })} />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Y 坐标 ← 拖拽修改</label>
          <ScrubInput value={layer.y} min={-9999} max={9999} step={1} unit="px"
            onChange={v => onUpdate({ y: v })} />
        </div>
      </div>

      {/* ══ 颜色模式（SVG / Shape 通用） ══ */}
      <div>
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>颜色模式</label>
        <div className="flex items-center gap-2 mb-3">
          {(['fixed', 'picker'] as const).map(m => (
            <button key={m} onClick={() => onUpdate({ color_mode: m })} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: layer.color_mode === m ? 'var(--accent-bg)' : 'var(--bg-tertiary)', color: layer.color_mode === m ? 'var(--accent)' : 'var(--text-secondary)', border: `1.5px solid ${layer.color_mode === m ? 'var(--accent)' : 'transparent'}` }}>
              {m === 'fixed' ? '固定颜色' : '跟随取色'}
            </button>
          ))}
        </div>
        {layer.color_mode === 'fixed' && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>颜色</span>
              <input type="color" value={layer.color || '#8884FF'} onChange={e => onUpdate({ color: e.target.value })} className="w-8 h-8 rounded-lg cursor-pointer border-0" />
              <input value={layer.color || ''} onChange={e => onUpdate({ color: e.target.value || undefined })}
                placeholder="留空使用原始SVG颜色"
                className="px-3 py-1.5 rounded-lg text-xs outline-none flex-1" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>留空则使用 SVG 文件的原始颜色</p>
          </div>
        )}
        {layer.color_mode === 'picker' && (
          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>默认取色偏好</label>
            <div className="flex items-center gap-2">
              {(['dark', 'light'] as const).map(p => (
                <button key={p} onClick={() => onUpdate({ picker_default: p })} className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{ background: layer.picker_default === p ? 'var(--accent-bg)' : 'var(--bg-tertiary)', color: layer.picker_default === p ? 'var(--accent)' : 'var(--text-secondary)', border: `1.5px solid ${layer.picker_default === p ? 'var(--accent)' : 'transparent'}` }}>
                  {p === 'dark' ? '深色' : '浅色'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   文字图层配置
   ══════════════════════════════════════════════════════════ */

const WEIGHT_PRESETS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

function TextLayerConfig({
  layer, onUpdate, fontList, onFontUpload, fontLoading, deviceW, deviceH,
}: {
  layer: TemplateLayer; onUpdate: (p: Partial<TemplateLayer>) => void
  fontList: FontRecord[]; onFontUpload: (file: File, isVariable: boolean) => Promise<any>
  fontLoading: boolean; deviceW: number; deviceH: number
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedFont = fontList.find(f => f.family_name === layer.font_family)
  const isVarFont = selectedFont?.is_variable ?? false

  const handleFileUpload = async (file: File) => {
    try {
      const res = await onFontUpload(file, false)
      if (res?.family_name) {
        onUpdate({ font_family: res.family_name, font_weight: String(res.weight || 400) })
      }
    } catch {}
  }

  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>文字内容</label>
        <textarea value={layer.text_content || ''} onChange={e => onUpdate({ text_content: e.target.value })} rows={3}
          placeholder="输入默认文字内容..."
          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
      </div>

      {/* CSS 粘贴识别参数 */}
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>粘贴 CSS 识别参数</label>
        <textarea
          rows={2}
          className="w-full rounded-lg p-2 text-xs font-mono"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', resize: 'vertical' }}
          placeholder={'font-size: 16px;\ncolor: #FFFFFF;\ntext-align: center;\nfont-family: "PingFang SC";'}
          onChange={(e) => {
            const css = e.target.value
            const cssLower = parseCssDeclarations(css)
            const updates: Partial<TemplateLayer> = { css_code: css }
            const position = extractCssPosition(css, deviceW, deviceH)
            if (position.x !== undefined) updates.x = position.x
            if (position.y !== undefined) updates.y = position.y
            if (position.w !== undefined) updates.css_width = position.w
            if (position.h !== undefined) updates.css_height = position.h
            const validAlign = new Set(['left', 'center', 'right'])
            const validVerticalAlign = new Set(['top', 'middle', 'bottom'])
            const finiteNumber = (value: string | undefined): number | undefined => {
              if (!value) return undefined
              const parsed = Number.parseFloat(value)
              return Number.isFinite(parsed) ? parsed : undefined
            }

            if (validAlign.has(cssLower['text-align'])) updates.text_align = cssLower['text-align']
            else if (/\bcenter\b/i.test([cssLower['justify-content'], cssLower['justify-items'], cssLower['place-content'], cssLower['place-items']].filter(Boolean).join(' '))) updates.text_align = 'center'

            if (validVerticalAlign.has(cssLower['vertical-align'])) updates.text_vertical_align = cssLower['vertical-align']
            else if (/\bcenter\b/i.test([cssLower['align-items'], cssLower['align-content'], cssLower['place-content'], cssLower['place-items']].filter(Boolean).join(' '))) updates.text_vertical_align = 'middle'

            const fontSize = finiteNumber(cssLower['font-size'])
            if (fontSize !== undefined && fontSize > 0 && fontSize <= 500) updates.font_size = fontSize
            const letterSpacing = finiteNumber(cssLower['letter-spacing'])
            if (letterSpacing !== undefined && letterSpacing >= -10 && letterSpacing <= 50) updates.letter_spacing = letterSpacing
            const lineHeight = finiteNumber(cssLower['line-height'])
            if (lineHeight !== undefined && lineHeight > 0) {
              const isUnitless = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cssLower['line-height'])
              if (isUnitless && lineHeight >= 0.5 && lineHeight <= 5) updates.line_height = lineHeight
            }

            const fontWeight = finiteNumber(cssLower['font-weight'])
            if (fontWeight !== undefined && fontWeight >= 100 && fontWeight <= 900) {
              updates.font_weight = String(Math.round(fontWeight))
            }
            if (cssLower.color && CSS.supports('color', cssLower.color)) updates.text_color = cssLower.color

            const family = cssLower['font-family']?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
            if (family) updates.font_family = family
            onUpdate(updates)
          }}
        />
      </div>

      {/* 文字对齐 */}
      {(() => {
        const align = layer.text_align || 'left'
        const alignOptions = [
          { v: 'left', label: '左对齐' },
          { v: 'center', label: '居中' },
          { v: 'right', label: '右对齐' },
        ]
        return (
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>文字对齐</label>
            <div className="flex gap-1.5">
              {alignOptions.map(opt => (
                <button key={opt.v}
                  onClick={() => onUpdate({ text_align: opt.v })}
                  className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150"
                  style={{
                    background: align === opt.v ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: align === opt.v ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${align === opt.v ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* 垂直对齐 */}
      {(() => {
        const vAlign = layer.text_vertical_align || 'top'
        const vAlignOptions = [
          { v: 'top', label: '居上' },
          { v: 'middle', label: '垂直居中' },
          { v: 'bottom', label: '居下' },
        ]
        return (
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>垂直对齐</label>
            <div className="flex gap-1.5">
              {vAlignOptions.map(opt => (
                <button key={opt.v}
                  onClick={() => onUpdate({ text_vertical_align: opt.v })}
                  className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150"
                  style={{
                    background: vAlign === opt.v ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: vAlign === opt.v ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${vAlign === opt.v ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          </div>
        )
      })()}

      <div>
        <div className="flex gap-2">
          <select value={layer.font_family || ''} onChange={e => onUpdate({ font_family: e.target.value })}
            className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
            <option value="">选择字体...</option>
            {fontList.map(f => (
              <option key={f.id} value={f.family_name}>
                {f.family_name || f.original_name} {f.is_variable ? '(可变)' : `(${f.weight})`}
              </option>
            ))}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={fontLoading}
            className="px-3 py-2 rounded-lg text-xs font-medium flex-shrink-0 transition-all"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="inline mr-1">
              <path d="M7 10V2M4 5l3-3 3 3M2 10v2h10v-2" />
            </svg>
            {fontLoading ? '上传中...' : '上传字体'}
          </button>
          <input ref={fileRef} type="file" accept=".ttf,.otf,.woff2" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            字重 {isVarFont ? '(可变字体)' : ''}
          </label>
          {isVarFont ? (
            <div className="flex items-center gap-2">
              <input type="range" min={100} max={900} step={1}
                value={parseInt(layer.font_weight || '400')}
                onChange={e => onUpdate({ font_weight: String(e.target.value) })}
                className="flex-1" style={{ accentColor: 'var(--accent)' }} />
              <span className="text-xs w-10 text-right" style={{ color: 'var(--text-muted)' }}>{layer.font_weight || '400'}</span>
            </div>
          ) : (
            <select value={layer.font_weight || '400'} onChange={e => onUpdate({ font_weight: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-xs outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              {WEIGHT_PRESETS.map(w => (
                <option key={w} value={String(w)}>{w} — {w === 100 ? 'Thin' : w === 200 ? 'ExtraLight' : w === 300 ? 'Light' : w === 400 ? 'Regular' : w === 500 ? 'Medium' : w === 600 ? 'SemiBold' : w === 700 ? 'Bold' : w === 800 ? 'ExtraBold' : 'Black'}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>字号 (px)</label>
          <ScrubInput value={layer.font_size ?? 24} min={1} max={500} step={1} unit="px"
            onChange={v => onUpdate({ font_size: v })} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>行高</label>
          <ScrubInput value={layer.line_height ?? 1.4} min={0.5} max={5} step={0.1} unit=""
            onChange={v => onUpdate({ line_height: v })} />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>字间距 (px)</label>
          <ScrubInput value={layer.letter_spacing ?? 0} min={-10} max={50} step={0.5} unit="px"
            onChange={v => onUpdate({ letter_spacing: v })} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>X 坐标</label>
          <ScrubInput value={layer.x} min={-9999} max={9999} step={1} unit="px"
            onChange={v => onUpdate({ x: v })} />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Y 坐标</label>
          <ScrubInput value={layer.y} min={-9999} max={9999} step={1} unit="px"
            onChange={v => onUpdate({ y: v })} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>文字颜色</label>
        <div className="flex items-center gap-2">
          <input type="color" value={layer.text_color || '#FFFFFF'} onChange={e => onUpdate({ text_color: e.target.value })}
            className="w-8 h-8 rounded-lg cursor-pointer border-0" />
          <input value={layer.text_color || '#FFFFFF'} onChange={e => onUpdate({ text_color: e.target.value })}
            className="px-3 py-1.5 rounded-lg text-xs outline-none flex-1"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </div>
      </div>
    </>
  )
}