import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { apiFetch, API_BASE } from '@/lib/api'
import { IS_OFFLINE, offlineAsset } from '@/lib/offline'
import { savePngBlob } from '@/lib/saveImage'
import { cssLengthToPx, normalizeFontFaceStyle, parseCssDeclarations, resolveCssTranslation, resolveTextStyle, stripTranslateTransform } from '@/lib/templateTextStyle'
import { snapToEdges } from '@/lib/snapToEdges'
import { ArrowLeft, X, RotateCcw, Download, Palette, Trash2 } from 'lucide-react'

/* ── 类型 ── */
interface Layer {
  name: string
  css_code: string
  type: 'color' | 'image' | 'svg' | 'shape' | 'text'
  color_mode?: 'fixed' | 'picker'
  color?: string
  picker_default?: 'dark' | 'light'
  allow_user_upload?: boolean
  image_url?: string
  show_on_client?: boolean
  z_index?: number
  x?: number
  y?: number
  css_width?: number
  css_height?: number
  css_position_code?: string
  font_size?: number
  font_family?: string
  font_weight?: string
  line_height?: number
  letter_spacing?: number
  text_color?: string
  text_content?: string
  text_align?: string
  text_vertical_align?: string
  effects?: { opacity: number; blur_type: 'none' | 'gaussian' | 'backdrop'; blur_value: number }
  visible_in_export?: boolean
  adjustments?: { rotation?: number; scale?: number; blur?: number; contrast?: number; brightness?: number }
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
  created_at: string
  updated_at: string
}

interface LayerState {
  imageUrl?: string
  naturalWidth?: number
  naturalHeight?: number
  position: { x: number; y: number }
  scale: number
  rotation: number
}

type DragMode = 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate-tl' | 'rotate-tr' | 'rotate-bl' | 'rotate-br' | 'pinch-rotate'

/** 双指旋转松手时，角度距 90° 整数倍在 15° 以内则自动吸附 */
function snapRotation(deg: number): number {
  const nearest = Math.round(deg / 90) * 90
  return Math.abs(deg - nearest) < 5 ? nearest : deg
}

/* ── 常量 ── */
const PAD = 20
const HANDLE_R = 7
const ROT_HANDLE_R = 6
const ROT_HANDLE_OFFSET = 36
const EXPORT_SCALE = 2

/* ── CSS 解析 ── */
function toReactKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function fitSvgToContainer(html: string): string {
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

/** picker 模式必须覆盖 SVG 内的显式 fill/stroke，否则只设置外层 color 不会产生视觉变化。 */
function applySvgColor(html: string, color: string | undefined): string {
  if (!color) return html
  try {
    const doc = new DOMParser().parseFromString(html, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return html
    const root = doc.documentElement
    root.setAttribute('fill', color)
    root.setAttribute('color', color)
    const elements = [root, ...Array.from(root.querySelectorAll('*'))]
    elements.forEach(element => {
      for (const property of ['fill', 'stroke'] as const) {
        const value = element.getAttribute(property)
        if (value && !/^(none|transparent)$/i.test(value) && !/^url\s*\(/i.test(value)) {
          element.setAttribute(property, color)
        }
        const inlineValue = (element as SVGElement).style?.getPropertyValue(property)
        if (inlineValue && !/^(none|transparent)$/i.test(inlineValue) && !/^url\s*\(/i.test(inlineValue)) {
          ;(element as SVGElement).style.setProperty(property, color)
        }
      }
    })
    return new XMLSerializer().serializeToString(root)
  } catch {
    return html
  }
}

function parseCssBlock(raw: string): Record<string, string> {
  return parseCssDeclarations(raw)
}

/** 解析图层在设备坐标系中的最终视觉矩形。结构化宽高和 x/y 是 CSS 缺失时的回退。 */
function resolveLayerRect(
  layer: Pick<Layer, 'type' | 'x' | 'y' | 'css_width' | 'css_height'>,
  css: Record<string, string>,
  deviceW: number,
  deviceH: number,
): { left: number; top: number; w: number; h: number } {
  const defaultSize = layer.type === 'shape' || layer.type === 'svg' ? 100 : undefined
  const w = cssLengthToPx(css.width, deviceW) ?? layer.css_width ?? defaultSize ?? deviceW
  const h = cssLengthToPx(css.height, deviceH) ?? layer.css_height ?? defaultSize ?? deviceH

  let left = cssLengthToPx(css.left, deviceW)
  if (left == null && css.right != null) left = deviceW - (cssLengthToPx(css.right, deviceW) ?? 0) - w
  left ??= layer.x ?? 0

  let top = cssLengthToPx(css.top, deviceH)
  if (top == null && css.bottom != null) top = deviceH - (cssLengthToPx(css.bottom, deviceH) ?? 0) - h
  top ??= layer.y ?? 0

  const translation = resolveCssTranslation(css.transform, w, h)
  return { left: left + translation.x, top: top + translation.y, w, h }
}

function getLayerCss(layer: Layer): Record<string, string> {
  return {
    ...parseCssBlock(layer.css_code || ''),
    ...parseCssBlock(layer.css_position_code || ''),
  }
}

function getLayerBoxStyle(layer: Layer, css: Record<string, string>, deviceW: number, deviceH: number): React.CSSProperties {
  const rect = resolveLayerRect(layer, css, deviceW, deviceH)
  const style = cssToProps(css) as Record<string, unknown>
  for (const property of [
    'right', 'bottom', 'inset', 'insetBlock', 'insetInline',
    'insetBlockStart', 'insetBlockEnd', 'insetInlineStart', 'insetInlineEnd',
  ]) delete style[property]
  return {
    ...style,
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    transform: stripTranslateTransform(css.transform),
  } as React.CSSProperties
}

/** CSSOM 可能将 border-radius 展开为四个 longhand，统一还原为 CSS 顺序 tl tr br bl。 */
function resolveBorderRadius(css: Record<string, string>): string | undefined {
  const shorthand = css['border-radius'] || css.borderRadius
  if (shorthand) return shorthand

  const topLeft = css['border-top-left-radius'] || css.borderTopLeftRadius
  const topRight = css['border-top-right-radius'] || css.borderTopRightRadius
  const bottomRight = css['border-bottom-right-radius'] || css.borderBottomRightRadius
  const bottomLeft = css['border-bottom-left-radius'] || css.borderBottomLeftRadius
  if (!topLeft && !topRight && !bottomRight && !bottomLeft) return undefined

  return `${topLeft || '0'} ${topRight || '0'} ${bottomRight || '0'} ${bottomLeft || '0'}`
}

/** 解析 border-radius → [tl, tr, br, bl]（px） */
function parseBorderRadius(val: string | undefined): number[] | null {
  if (!val) return null
  const parts = val.trim().split(/\s+/).map(s => parseFloat(s) || 0)
  if (parts.length === 0) return null
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  return [parts[0], parts[1], parts[2], parts[3]]
}

function parseObjectPosition(value: string | undefined): { x: number; y: number } {
  const tokens = (value || '50% 50%').trim().toLowerCase().split(/\s+/)
  const keywordToPercent = (token: string, axis: 'x' | 'y') => {
    if (token === 'center') return 0.5
    if ((axis === 'x' && token === 'left') || (axis === 'y' && token === 'top')) return 0
    if ((axis === 'x' && token === 'right') || (axis === 'y' && token === 'bottom')) return 1
    if (token.endsWith('%')) {
      const percent = Number.parseFloat(token)
      return Number.isFinite(percent) ? percent / 100 : 0.5
    }
    return 0.5
  }

  const first = tokens[0] || '50%'
  const second = tokens[1]
  if (!second && (first === 'top' || first === 'bottom')) return { x: 0.5, y: keywordToPercent(first, 'y') }
  return { x: keywordToPercent(first, 'x'), y: keywordToPercent(second || '50%', 'y') }
}

function resolveUserImageFit(objectFit: string | undefined): string {
  const fit = objectFit?.trim().toLowerCase()
  return !fit || fit === 'fill' ? 'contain' : fit
}

function getRoundedClipPath(borderRadius: string | undefined): string | undefined {
  return borderRadius ? `inset(0 round ${borderRadius})` : undefined
}

function resolveImageDrawRect(
  imageWidth: number,
  imageHeight: number,
  box: { left: number; top: number; width: number; height: number },
  objectFit: string | undefined,
  objectPosition: string | undefined,
) {
  const fit = (objectFit || 'fill').trim().toLowerCase()
  const containScale = Math.min(box.width / imageWidth, box.height / imageHeight)
  const scale = fit === 'contain'
    ? containScale
    : fit === 'cover'
      ? Math.max(box.width / imageWidth, box.height / imageHeight)
      : fit === 'scale-down'
        ? Math.min(1, containScale)
        : 1
  const width = fit === 'fill' ? box.width : fit === 'none' ? imageWidth : imageWidth * scale
  const height = fit === 'fill' ? box.height : fit === 'none' ? imageHeight : imageHeight * scale
  const position = parseObjectPosition(objectPosition)
  return {
    left: box.left + (box.width - width) * position.x,
    top: box.top + (box.height - height) * position.y,
    width,
    height,
  }
}

function resolveImageFilter(layer: Layer, exportScale = 1): string | undefined {
  const filters: string[] = []
  const adjustments = layer.adjustments
  if (adjustments?.blur && adjustments.blur > 0) filters.push(`blur(${adjustments.blur * exportScale}px)`)
  if (adjustments?.contrast != null && adjustments.contrast !== 100) filters.push(`contrast(${adjustments.contrast}%)`)
  if (adjustments?.brightness != null && adjustments.brightness !== 100) filters.push(`brightness(${adjustments.brightness}%)`)
  if (layer.effects?.blur_type === 'gaussian' && layer.effects.blur_value > 0) {
    filters.push(`blur(${layer.effects.blur_value * exportScale}px)`)
  }
  return filters.join(' ') || undefined
}

interface ParsedBoxShadow {
  inset: boolean
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: string
}

function parseBoxShadow(value: string | undefined): ParsedBoxShadow | null {
  if (!value || value.trim().toLowerCase() === 'none') return null
  const colorMatch = value.match(/(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))/)
  const color = colorMatch?.[0] || 'rgba(0,0,0,0.3)'
  const numericPart = value
    .replace(/\binset\b/i, '')
    .replace(color, '')
  const nums = numericPart.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || []
  return {
    inset: /\binset\b/i.test(value),
    offsetX: nums[0] || 0,
    offsetY: nums[1] || 0,
    blur: Math.max(0, nums[2] || 0),
    spread: nums[3] || 0,
    color,
  }
}

/* ── clip-path 解析 → 多边形顶点 ── */
/** 将 CSS clip-path 值解析为多边形点数组 [[x,y], ...]（设备坐标系） */
function parseClipPathToPoints(val: string, w: number, h: number): number[][] | null {
  const s = val.trim()
  // polygon(...)
  const pm = s.match(/polygon\(([\s\S]+)\)/)
  if (pm) {
    return pm[1].split(',').map(seg => {
      const parts = seg.trim().split(/\s+/)
      const xP = parts[0], yP = parts[1] || '0'
      const x = xP.endsWith('%') ? parseFloat(xP) / 100 * w : parseFloat(xP)
      const y = yP.endsWith('%') ? parseFloat(yP) / 100 * h : parseFloat(yP)
      return [x, y]
    })
  }
  // circle(r at cx cy)
  const cm = s.match(/circle\(([\s\S]+)\)/)
  if (cm) {
    const [rPart, centerPart] = cm[1].split(/\s+at\s+/)
    const r = rPart.endsWith('%') ? parseFloat(rPart) / 100 * Math.min(w, h) : parseFloat(rPart)
    const cp = (centerPart || '50% 50%').trim().split(/\s+/)
    const cx = cp[0].endsWith('%') ? parseFloat(cp[0]) / 100 * w : parseFloat(cp[0])
    const cy = (cp[1] || '50%').endsWith('%') ? parseFloat(cp[1] || '50%') / 100 * h : parseFloat(cp[1] || '50%')
    const pts: number[][] = []
    const N = 48
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    return pts
  }
  // ellipse(rx ry at cx cy)
  const em = s.match(/ellipse\(([\s\S]+)\)/)
  if (em) {
    const [rPart, centerPart] = em[1].split(/\s+at\s+/)
    const rp = rPart.trim().split(/\s+/)
    const rx = rp[0].endsWith('%') ? parseFloat(rp[0]) / 100 * w : parseFloat(rp[0])
    const ry = (rp[1] || rp[0]).endsWith('%') ? parseFloat(rp[1] || rp[0]) / 100 * h : parseFloat(rp[1] || rp[0])
    const cp = (centerPart || '50% 50%').trim().split(/\s+/)
    const cx = cp[0].endsWith('%') ? parseFloat(cp[0]) / 100 * w : parseFloat(cp[0])
    const cy = (cp[1] || '50%').endsWith('%') ? parseFloat(cp[1] || '50%') / 100 * h : parseFloat(cp[1] || '50%')
    const pts: number[][] = []
    const N = 48
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
    }
    return pts
  }
  // inset(t r b l round ...)
  const im = s.match(/inset\(([\s\S]+)\)/)
  if (im) {
    const full = im[1]
    const roundIdx = full.toLowerCase().indexOf('round')
    const dimStr = roundIdx >= 0 ? full.slice(0, roundIdx) : full
    const dims = dimStr.trim().split(/\s+/)
    const t = dims[0].endsWith('%') ? parseFloat(dims[0]) / 100 * h : parseFloat(dims[0])
    const r = (dims[1] || dims[0]).endsWith('%') ? parseFloat(dims[1] || dims[0]) / 100 * w : parseFloat(dims[1] || dims[0])
    const b = (dims[2] || dims[0]).endsWith('%') ? parseFloat(dims[2] || dims[0]) / 100 * h : parseFloat(dims[2] || dims[0])
    const l = (dims[3] || dims[1] || dims[0]).endsWith('%') ? parseFloat(dims[3] || dims[1] || dims[0]) / 100 * w : parseFloat(dims[3] || dims[1] || dims[0])
    // 解析 round 后的 border-radius
    let br = 0
    if (roundIdx >= 0) {
      const radiiStr = full.slice(roundIdx + 5).trim()
      br = parseFloat(radiiStr) || 0
    }
    if (br > 0) {
      // 带圆角的 inset → 圆角矩形顶点
      const pts: number[][] = []
      const lx = l, rx2 = w - r, ty = t, by = h - b
      const iw = rx2 - lx, ih = by - ty
      const cr = Math.min(br, iw / 2, ih / 2)
      const step = 6
      // top-left
      for (let i = step; i >= 0; i--) {
        const a = Math.PI + (Math.PI / 2) * (i / step)
        pts.push([lx + cr + cr * Math.cos(a), ty + cr + cr * Math.sin(a)])
      }
      // top-right
      for (let i = 0; i <= step; i++) {
        const a = -Math.PI / 2 + (Math.PI / 2) * (i / step)
        pts.push([rx2 - cr + cr * Math.cos(a), ty + cr + cr * Math.sin(a)])
      }
      // bottom-right
      for (let i = 0; i <= step; i++) {
        const a = 0 + (Math.PI / 2) * (i / step)
        pts.push([rx2 - cr + cr * Math.cos(a), by - cr + cr * Math.sin(a)])
      }
      // bottom-left
      for (let i = 0; i <= step; i++) {
        const a = Math.PI / 2 + (Math.PI / 2) * (i / step)
        pts.push([lx + cr + cr * Math.cos(a), by - cr + cr * Math.sin(a)])
      }
      return pts
    }
    return [[l, t], [w - r, t], [w - r, h - b], [l, h - b]]
  }
  return null
}

/** 将多边形点数组转为 SVG polygon points 属性 */
function pointsToSvgAttr(pts: number[][]): string {
  return pts.map(p => `${p[0]},${p[1]}`).join(' ')
}

/** 在 canvas 上绘制 clip-path 多边形并填充 */
function fillClipPath(ctx: CanvasRenderingContext2D, pts: number[][]) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
}

/** 检查 CSS 中是否含有 clip-path（含 -webkit- 前缀） */
function getClipPath(css: Record<string, string>): string | null {
  return css['-webkit-clip-path'] || css['clip-path'] || null
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
        name, width: 212, height: 520, corner_radius: 48, background: '#FFFFFF',
        layers: oldLayers.map((l, i) => migrateLayer(l, i)),
      })),
    }
  }
  return {
    ...t,
    preview_image: t.preview_image || '',
    devices: t.devices.map((d: any) => ({
      ...d,
      width: d.width || 212, height: d.height || 520, corner_radius: d.corner_radius || 48, background: d.background || '#FFFFFF',
      layers: Array.isArray(d.layers) ? d.layers.map((l: any, i: number) => migrateLayer(l, i)) : [],
    })),
  }
}

function useDeviceRecordState<T>(deviceIdx: number) {
  const [recordsByDevice, setRecordsByDevice] = useState<Record<number, Record<number, T>>>({})
  const current = recordsByDevice[deviceIdx] || {}
  const setCurrent = useCallback((update: React.SetStateAction<Record<number, T>>) => {
    setRecordsByDevice(prev => {
      const existing = prev[deviceIdx] || {}
      const next = typeof update === 'function'
        ? (update as (value: Record<number, T>) => Record<number, T>)(existing)
        : update
      return { ...prev, [deviceIdx]: next }
    })
  }, [deviceIdx])
  return [current, setCurrent] as const
}

/* ── 颜色提取 ── */
function extractColors(img: HTMLImageElement, count = 10): string[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  canvas.width = 128; canvas.height = 128
  ctx.drawImage(img, 0, 0, 128, 128)
  const data = ctx.getImageData(0, 0, 128, 128).data
  const step = 24
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.round(data[i] / step) * step
    const g = Math.round(data[i + 1] / step) * step
    const b = Math.round(data[i + 2] / step) * step
    const key = `${r},${g},${b}`
    const entry = buckets.get(key)
    if (entry) entry.count++
    else buckets.set(key, { r, g, b, count: 1 })
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  const diff = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
    Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
  const picked: typeof sorted = []
  for (const c of sorted) {
    if (picked.every(p => diff(p, c) >= 60)) picked.push(c)
    if (picked.length >= count) break
  }
  const toHex = (n: number) => Math.min(255, n).toString(16).padStart(2, '0')
  return picked.map(c => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`)
}

function colorLuminance(color: string): number {
  const hex = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0
  const [r, g, b] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

/* ═══════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════ */

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const [template, setTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDeviceIdx, setSelectedDeviceIdx] = useState(0)

  // 每个设备独立保存可上传图层及文字/取色状态，避免同一数组索引在设备间串用。
  const [layerStates, setLayerStates] = useDeviceRecordState<LayerState>(selectedDeviceIdx)
  // ref 始终指向最新 layerStates，避免拖拽/触摸处理器闭包捕获旧值
  const layerStatesRef = useRef(layerStates)
  layerStatesRef.current = layerStates
  // 自动取色图层的颜色选择
  const [pickerColors, setPickerColors] = useDeviceRecordState<string[]>(selectedDeviceIdx)
  const [pickedColor, setPickedColor] = useDeviceRecordState<string>(selectedDeviceIdx)

  const [dragMode, setDragMode] = useState<DragMode | null>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragStartState, setDragStartState] = useState({ x: 0, y: 0, scale: 1, rotation: 0 })
  const [activeLayerIdx, setActiveLayerIdx] = useState<number | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [msg, setMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  // 文字编辑
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null)
  const [editedTexts, setEditedTexts] = useDeviceRecordState<string>(selectedDeviceIdx)

  useEffect(() => {
    setActiveLayerIdx(null)
    setEditingTextIdx(null)
    setDragMode(null)
  }, [selectedDeviceIdx])

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const [wrapSize, setWrapSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth - 80 : 300, h: typeof window !== 'undefined' ? window.innerHeight - 260 : 400 })
  const [winSize, setWinSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 375, h: typeof window !== 'undefined' ? window.innerHeight : 667 })

  // 加载模板（离线：读打包进 APK 的 template.json）
  useEffect(() => {
    setLoading(true)
    const load = async () => {
      if (IS_OFFLINE) {
        const res = await fetch(offlineAsset('template.json'))
        if (!res.ok) throw new Error('离线模板数据缺失')
        const data = await res.json()
        setTemplate(migrateTemplate(data))
        return
      }
      if (!id) throw new Error('缺少模板 ID')
      const data = await apiFetch(`/api/templates/${id}`)
      setTemplate(migrateTemplate(data))
    }
    load()
      .then(() => setLoading(false))
      .catch((e: any) => { setError(e.message || '加载失败'); setLoading(false) })
  }, [id])

  // 加载文字图层所用字体到浏览器（FontFace API）
  useEffect(() => {
    if (!template) return
    const families = new Set<string>()
    for (const dev of template.devices) {
      for (const layer of dev.layers) {
        if (layer.type === 'text') {
          const family = resolveTextStyle(layer, dev.width, dev.height).fontFamily
          if (family) families.add(family)
        }
      }
    }
    if (families.size === 0) return

    const loadFonts = async (fonts: any[]) => {
      const loads: Promise<FontFace>[] = []
      for (const f of fonts) {
        const name = f.family_name || f.original_name
        if (!families.has(name)) continue
        const rawUrl = f.url || (f.filename ? offlineAsset(`assets/${f.filename}`) : '')
        if (!rawUrl) continue
        const source = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('./') || rawUrl.startsWith('data:')
          ? rawUrl
          : `${API_BASE}${rawUrl}`
        const ff = new FontFace(name, `url("${source}")`, {
          style: normalizeFontFaceStyle(f.style),
          weight: f.is_variable ? '100 900' : String(f.weight || 400),
        })
        loads.push(
          ff.load().then(font => {
            document.fonts.add(font)
            return font
          }).catch((err) => {
            console.error(`[font] 加载失败: ${name} (${source})`, err)
            throw err
          })
        )
      }
      if (loads.length > 0) {
        await Promise.allSettled(loads)
        await document.fonts.ready
      }
    }

    if (IS_OFFLINE) {
      fetch(offlineAsset('fonts.json'))
        .then((r) => (r.ok ? r.json() : []))
        .then(loadFonts)
        .catch(() => {})
      return
    }

    apiFetch('/api/fonts').then(loadFonts).catch(() => {})
  }, [template])

  // 窗口尺寸
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 预览区域测量
  useEffect(() => {
    const el = previewWrapRef.current
    if (!el) return
    const measure = () => {
      const cs = getComputedStyle(el)
      const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padH = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      setWrapSize({ w: Math.floor(el.clientWidth - padW), h: Math.floor(el.clientHeight - padH) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const device = template?.devices[selectedDeviceIdx]
  const sortedLayers = useMemo(() => {
    if (!device) return []
    return device.layers
      .map((layer, realIdx) => ({ layer, realIdx }))
      .sort((a, b) => (a.layer.z_index ?? a.realIdx) - (b.layer.z_index ?? b.realIdx))
  }, [device])

  const interactiveLayers = useMemo(() => {
    if (!device) return []
    return device.layers
      .map((l, i) => ({ layer: l, realIdx: i }))
      .filter(({ layer }) => (layer.type === 'image' || layer.type === 'svg' || layer.type === 'shape') && layer.allow_user_upload)
  }, [device])

  const pickerColorLayers = useMemo(() => {
    if (!device) return []
    return device.layers
      .map((layer, realIdx) => ({ layer, realIdx }))
      .filter(({ layer }) => layer.color_mode === 'picker' && layer.type !== 'image' && layer.type !== 'text')
  }, [device])

  const textLayers = useMemo(() => {
    if (!device) return []
    return device.layers
      .map((layer, realIdx) => ({ layer, realIdx }))
      .filter(({ layer }) => layer.type === 'text')
  }, [device])

  // 预览缩放
  const isMobile = winSize.w < 1024
  const rawAvailW = isMobile ? Math.max(160, winSize.w - 72) : Math.max(200, (winSize.w - 136) * 2 / 3)
  const rawAvailH = isMobile ? Math.max(200, winSize.h - 220) : Math.max(200, winSize.h - 200)
  const maxAvailW = wrapSize.w > 0 ? Math.min(rawAvailW, wrapSize.w - PAD * 2) : rawAvailW
  const maxAvailH = wrapSize.h > 0 ? Math.min(rawAvailH, wrapSize.h - PAD * 2) : rawAvailH
  const previewScale = device ? Math.min(maxAvailW / device.width, maxAvailH / device.height, 1) : 1
  const previewWidth = device ? device.width * previewScale : 0
  const previewHeight = device ? device.height * previewScale : 0
  const cornerRadius = device ? device.corner_radius * previewScale : 0
  const containerWidth = previewWidth + PAD * 2
  const containerHeight = previewHeight + PAD * 2
  const vpLeft = (containerWidth - previewWidth) / 2
  const vpTop = (containerHeight - previewHeight) / 2

  /* ── 计算图片在模板框内的初始显示尺寸（设备坐标系，预览与导出共用） ── */
  const getImageDisplay = useCallback((layerIdx: number): { dw: number; dh: number; frameW: number; frameH: number; baseX: number; baseY: number } | null => {
    const state = layerStates[layerIdx]
    if (!state?.imageUrl || !state.naturalWidth || !state.naturalHeight || !device) return null
    const layer = device.layers[layerIdx]
    const css = getLayerCss(layer)
    const rect = resolveLayerRect(layer, css, device.width, device.height)
    const drawRect = resolveImageDrawRect(
      state.naturalWidth,
      state.naturalHeight,
      { left: 0, top: 0, width: rect.w, height: rect.h },
      resolveUserImageFit(css['object-fit']),
      css['object-position'],
    )
    return {
      dw: drawRect.width,
      dh: drawRect.height,
      frameW: rect.w,
      frameH: rect.h,
      baseX: drawRect.left + drawRect.width / 2 - rect.w / 2,
      baseY: drawRect.top + drawRect.height / 2 - rect.h / 2,
    }
  }, [layerStates, device])

  const getImageTransformCenter = useCallback((layerIdx: number, position: { x: number; y: number }) => {
    if (!device) return { x: vpLeft + previewWidth / 2, y: vpTop + previewHeight / 2 }
    const layer = device.layers[layerIdx]
    const css = getLayerCss(layer)
    const rect = resolveLayerRect(layer, css, device.width, device.height)
    const display = getImageDisplay(layerIdx)
    return {
      x: vpLeft + (rect.left + rect.w / 2 + (display?.baseX ?? 0) + position.x) * previewScale,
      y: vpTop + (rect.top + rect.h / 2 + (display?.baseY ?? 0) + position.y) * previewScale,
    }
  }, [device, getImageDisplay, vpLeft, vpTop, previewWidth, previewHeight, previewScale])

  /* ── 文件上传 ── */
  const handleFileUpload = useCallback((layerIdx: number, file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    // 同一张用户图片生成一组色板；所有标记为 picker 的视觉图层都可从该色板选色。
    const img = new Image()
    img.onload = () => {
      const adjustments = device?.layers[layerIdx]?.adjustments
      setLayerStates(prev => ({
        ...prev,
        [layerIdx]: {
          imageUrl: url,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          position: { x: 0, y: 0 },
          scale: adjustments?.scale ?? 1,
          rotation: adjustments?.rotation ?? 0,
        },
      }))
      const colors = extractColors(img)
      if (colors.length > 0) {
        setPickerColors(prev => ({
          ...prev,
          ...Object.fromEntries(pickerColorLayers.map(({ realIdx }) => [realIdx, colors])),
        }))
        setPickedColor(prev => ({
          ...prev,
          ...Object.fromEntries(pickerColorLayers.map(({ layer, realIdx }) => {
            const sortedByLuminance = [...colors].sort((a, b) => colorLuminance(a) - colorLuminance(b))
            const preferred = layer.picker_default === 'light'
              ? sortedByLuminance[sortedByLuminance.length - 1]
              : sortedByLuminance[0]
            return [realIdx, preferred]
          })),
        }))
      }
    }
    img.src = url
    setActiveLayerIdx(layerIdx)
  }, [pickerColorLayers, device])

  /* ── 拖拽/缩放/旋转 ── */
  const handleMouseDown = useCallback((layerIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    setDragMode('move')
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
  }, [])

  const handleTouchStart = useCallback((layerIdx: number, e: React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      setDragMode('pinch-rotate')
      setDragStart({
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
        _pinchDist: Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2),
        _pinchAngle: Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
      } as any)
    } else {
      setDragMode('move')
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
    }
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
  }, [])

  const handleScaleMouseDown = useCallback((layerIdx: number, mode: DragMode, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    setDragMode(mode)
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
  }, [])

  const handleScaleTouchStart = useCallback((layerIdx: number, mode: DragMode, e: React.TouchEvent) => {
    e.stopPropagation()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    setDragMode(mode)
    setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
  }, [])

  // 全局 mouse drag
  useEffect(() => {
    if (!dragMode || activeLayerIdx === null) return
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      if (dragMode === 'move') {
        const display = getImageDisplay(activeLayerIdx)
        const layer = device?.layers[activeLayerIdx]
        const raw = { x: dragStartState.x + dx / previewScale, y: dragStartState.y + dy / previewScale }
        const snapped = display && layer
          ? snapToEdges(raw.x + display.baseX, raw.y + display.baseY, display.dw, display.dh, dragStartState.scale, display.frameW, display.frameH)
          : raw
        setLayerStates(prev => ({
          ...prev,
          [activeLayerIdx]: {
            ...prev[activeLayerIdx],
            position: display ? { x: snapped.x - display.baseX, y: snapped.y - display.baseY } : snapped,
          },
        }))
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const startDist = Math.sqrt((dragStart.x - rect.left - center.x) ** 2 + (dragStart.y - rect.top - center.y) ** 2)
        const curDist = Math.sqrt((e.clientX - rect.left - center.x) ** 2 + (e.clientY - rect.top - center.y) ** 2)
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          setLayerStates(prev => ({ ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], scale: newScale } }))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const startAngle = Math.atan2(dragStart.y - rect.top - center.y, dragStart.x - rect.left - center.x)
        const curAngle = Math.atan2(e.clientY - rect.top - center.y, e.clientX - rect.left - center.x)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        setLayerStates(prev => ({ ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], rotation: newRot } }))
      }
    }
    const onMouseUp = () => setDragMode(null)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [dragMode, dragStart, dragStartState, activeLayerIdx, previewScale, device, getImageDisplay, getImageTransformCenter])

  // 全局 touch drag
  useEffect(() => {
    if (!dragMode || activeLayerIdx === null) return
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (dragMode === 'pinch-rotate' && e.touches.length >= 2) {
        const t0 = e.touches[0], t1 = e.touches[1]
        const curDist = Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2)
        const curAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX)
        const startDist = (dragStart as any)._pinchDist || 1
        const startAngle = (dragStart as any)._pinchAngle || 0
        const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        const cx = (t0.clientX + t1.clientX) / 2
        const cy = (t0.clientY + t1.clientY) / 2
        setLayerStates(prev => ({
          ...prev,
          [activeLayerIdx]: {
            ...prev[activeLayerIdx],
            scale: newScale,
            rotation: newRot,
            position: { x: dragStartState.x + (cx - dragStart.x) / previewScale, y: dragStartState.y + (cy - dragStart.y) / previewScale },
          },
        }))
        return
      }
      const touch = e.touches[0]
      const dx = touch.clientX - dragStart.x
      const dy = touch.clientY - dragStart.y
      if (dragMode === 'move') {
        const display = getImageDisplay(activeLayerIdx)
        const layer = device?.layers[activeLayerIdx]
        const raw = { x: dragStartState.x + dx / previewScale, y: dragStartState.y + dy / previewScale }
        const snapped = display && layer
          ? snapToEdges(raw.x + display.baseX, raw.y + display.baseY, display.dw, display.dh, dragStartState.scale, display.frameW, display.frameH)
          : raw
        setLayerStates(prev => ({
          ...prev,
          [activeLayerIdx]: {
            ...prev[activeLayerIdx],
            position: display ? { x: snapped.x - display.baseX, y: snapped.y - display.baseY } : snapped,
          },
        }))
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const startDist = Math.sqrt((dragStart.x - rect.left - center.x) ** 2 + (dragStart.y - rect.top - center.y) ** 2)
        const curDist = Math.sqrt((touch.clientX - rect.left - center.x) ** 2 + (touch.clientY - rect.top - center.y) ** 2)
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          setLayerStates(prev => ({ ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], scale: newScale } }))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const startAngle = Math.atan2(dragStart.y - rect.top - center.y, dragStart.x - rect.left - center.x)
        const curAngle = Math.atan2(touch.clientY - rect.top - center.y, touch.clientX - rect.left - center.x)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        setLayerStates(prev => ({ ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], rotation: newRot } }))
      }
    }
    const onTouchEnd = () => {
      if (dragMode === 'pinch-rotate' && activeLayerIdx !== null) {
        setLayerStates(prev => {
          const s = prev[activeLayerIdx]
          if (!s) return prev
          const snapped = snapRotation(s.rotation)
          return snapped === s.rotation ? prev : { ...prev, [activeLayerIdx]: { ...s, rotation: snapped } }
        })
      }
      setDragMode(null)
    }
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => { window.removeEventListener('touchmove', onTouchMove); window.removeEventListener('touchend', onTouchEnd) }
  }, [dragMode, dragStart, dragStartState, activeLayerIdx, previewScale, device, getImageDisplay, getImageTransformCenter])

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el || activeLayerIdx === null) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.08 : 0.08
      setLayerStates(prev => {
        const s = prev[activeLayerIdx]
        if (!s) return prev
        return { ...prev, [activeLayerIdx]: { ...s, scale: Math.max(0.1, Math.min(5, s.scale + delta)) } }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [activeLayerIdx])

  const resetTransform = useCallback((layerIdx: number) => {
    const adjustments = device?.layers[layerIdx]?.adjustments
    setLayerStates(prev => ({
      ...prev,
      [layerIdx]: {
        ...prev[layerIdx],
        position: { x: 0, y: 0 },
        scale: adjustments?.scale ?? 1,
        rotation: adjustments?.rotation ?? 0,
      },
    }))
  }, [device])

  const clearImage = useCallback((layerIdx: number) => {
    const state = layerStates[layerIdx]
    if (state?.imageUrl) URL.revokeObjectURL(state.imageUrl)
    setLayerStates(prev => {
      const next = { ...prev }
      delete next[layerIdx]
      return next
    })
    const hasOtherUploadedImage = interactiveLayers.some(({ realIdx }) => realIdx !== layerIdx && layerStates[realIdx]?.imageUrl)
    if (!hasOtherUploadedImage) {
      setPickerColors({})
      setPickedColor({})
    }
    if (activeLayerIdx === layerIdx) setActiveLayerIdx(null)
  }, [layerStates, activeLayerIdx, interactiveLayers])

  /* ── 导出 ── */
  const handleExport = useCallback(async () => {
    if (!device || exporting) return
    const hasAnyImage = interactiveLayers.some(({ realIdx }) => layerStates[realIdx]?.imageUrl)
    if (!hasAnyImage) { setMsg('请先上传至少一张图片'); return }

    setExporting(true)
    setMsg('正在导出…')
    try {
    console.log('[Export] 设备:', device.width, '×', device.height, ' scale=', previewScale, ' exportScale=', EXPORT_SCALE)
    console.log('[Export] 交互图层:', interactiveLayers.map(({realIdx}) => ({ realIdx, hasImg: !!layerStates[realIdx]?.imageUrl })))

    // document.fonts.ready 只表示当前队列完成；逐图层 load 才能保证 Canvas 命中具体字重。
    await document.fonts.ready
    await Promise.all(sortedLayers.flatMap(({ layer }) => {
      if (layer.type !== 'text') return []
      const style = resolveTextStyle(layer, device.width, device.height)
      if (!style.fontFamily) return []
      const family = style.fontFamily.includes(' ') ? `"${style.fontFamily}"` : style.fontFamily
      const shorthand = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${family}`
      return [document.fonts.load(shorthand, layer.text_content || '')]
    }))

    const canvas = document.createElement('canvas')
    const exportW = device.width * EXPORT_SCALE
    const exportH = device.height * EXPORT_SCALE
    canvas.width = exportW
    canvas.height = exportH
    const ctx = canvas.getContext('2d')!
    const scale = exportW / device.width

    const r = Math.min(device.corner_radius * scale, exportW / 2, exportH / 2)
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.lineTo(exportW - r, 0)
    ctx.arcTo(exportW, 0, exportW, r, r)
    ctx.lineTo(exportW, exportH - r)
    ctx.arcTo(exportW, exportH, exportW - r, exportH, r)
    ctx.lineTo(r, exportH)
    ctx.arcTo(0, exportH, 0, exportH - r, r)
    ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
    ctx.closePath(); ctx.clip()

    ctx.fillStyle = device.background || '#FFFFFF'
    ctx.fillRect(0, 0, exportW, exportH)

    const loadImage = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image()
        // blob: URL 不应设置 crossOrigin，否则部分浏览器会报安全错误
        // 仅对非同源的远程 URL 设置 crossOrigin，避免同源图片被污染 canvas
        if (!src.startsWith('blob:') && !src.startsWith('/') && !src.startsWith(window.location.origin)) {
          img.crossOrigin = 'anonymous'
        }
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`图片加载失败: ${src.slice(0, 50)}`))
        img.src = src
      })

    for (const { layer, realIdx } of sortedLayers) {
      const css = {
        ...parseCssBlock(layer.css_code || ''),
        ...parseCssBlock(layer.css_position_code || ''),
      }
      const fx = layer.effects
      const layerAlpha = fx && fx.opacity < 100 ? fx.opacity / 100 : parseFloat(css['opacity'] || '1')
      const skipByVisible = layer.visible_in_export === false
        || (layer.type === 'image' && layer.show_on_client === false && !layerStates[realIdx]?.imageUrl)

      if (skipByVisible) continue

      // ── 通用：解析矩形位置（CSS left/top/width/height，缺失时回退到 x/y 和 device 尺寸） ──
      const rect = resolveLayerRect(layer, css, device.width, device.height)
      const left = rect.left * scale
      const top = rect.top * scale
      const w = rect.w * scale
      const h = rect.h * scale

      const borderRadiusPx = parseBorderRadius(resolveBorderRadius(css))
      const boxShadow = css['box-shadow'] || css['boxShadow']

      /* ── 绘制圆角矩形路径的 helper ── */
      const traceRoundRect = (lx: number, ly: number, rw: number, rh: number, br: number[]) => {
        // CSS 规范：当 border-radius 超过元素尺寸的一半时，浏览器会按比例缩小。
        // Canvas arcTo 不会自动 clamp，超限会导致 lineTo 目标点反向、路径自交叉（椭圆/胶囊形）。
        const maxR = Math.min(rw, rh) / 2
        let [tl, tr, br2, bl] = br.map(v => Math.min(v, maxR)) as [number, number, number, number]
        ctx.moveTo(lx + tl, ly)
        ctx.lineTo(lx + rw - tr, ly)
        ctx.arcTo(lx + rw, ly, lx + rw, ly + tr, tr)
        ctx.lineTo(lx + rw, ly + rh - br2)
        ctx.arcTo(lx + rw, ly + rh, lx + rw - br2, ly + rh, br2)
        ctx.lineTo(lx + bl, ly + rh)
        ctx.arcTo(lx, ly + rh, lx, ly + rh - bl, bl)
        ctx.lineTo(lx, ly + tl)
        ctx.arcTo(lx, ly, lx + tl, ly, tl)
        ctx.closePath()
      }
      const roundRect = (lx: number, ly: number, rw: number, rh: number, br: number[]) => {
        ctx.beginPath()
        traceRoundRect(lx, ly, rw, rh, br)
      }

      /* ── 图片图层裁剪：与预览保持一致 — 只用 border-radius，彻底忽略 CSS clip-path ── */
      const applyImageClip = (lx: number, ly: number, rw: number, rh: number) => {
        if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          roundRect(lx, ly, rw, rh, br)
        } else {
          ctx.beginPath()
          ctx.rect(lx, ly, rw, rh)
        }
      }

      const parsedShadow = parseBoxShadow(boxShadow)
      const applyBoxShadow = () => {
        if (!parsedShadow || parsedShadow.inset) return
        ctx.shadowOffsetX = parsedShadow.offsetX * scale
        ctx.shadowOffsetY = parsedShadow.offsetY * scale
        ctx.shadowBlur = parsedShadow.blur * scale
        ctx.shadowColor = parsedShadow.color
      }
      const clearBoxShadow = () => {
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
      }
      const drawInsetShadow = () => {
        if (!parsedShadow?.inset) return
        const padding = Math.max(16 * scale, (parsedShadow.blur + Math.abs(parsedShadow.spread)) * 4 * scale)
        ctx.save()
        if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          roundRect(left, top, w, h, br)
        } else {
          ctx.beginPath()
          ctx.rect(left, top, w, h)
        }
        ctx.clip()

        // 用“外部大矩形减去图层内孔”产生向内投影；只画阴影，不画任何描边本体。
        ctx.beginPath()
        ctx.rect(left - padding, top - padding, w + padding * 2, h + padding * 2)
        if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          traceRoundRect(
            left - parsedShadow.offsetX * scale,
            top - parsedShadow.offsetY * scale,
            w,
            h,
            br,
          )
        } else {
          ctx.rect(
            left - parsedShadow.offsetX * scale,
            top - parsedShadow.offsetY * scale,
            w,
            h,
          )
        }
        ctx.fillStyle = parsedShadow.color
        ctx.shadowOffsetX = parsedShadow.offsetX * scale
        ctx.shadowOffsetY = parsedShadow.offsetY * scale
        ctx.shadowBlur = parsedShadow.blur * scale
        ctx.shadowColor = parsedShadow.color
        ctx.fill('evenodd')
        ctx.restore()
        clearBoxShadow()
      }

      const uploadedState = layerStates[realIdx]
      if (uploadedState?.imageUrl) {
        try {
          const uploadedImage = await loadImage(uploadedState.imageUrl)
          ctx.globalAlpha = layerAlpha

          if (parsedShadow && !parsedShadow.inset) {
            ctx.save()
            applyBoxShadow()
            applyImageClip(left, top, w, h)
            ctx.fillStyle = '#000'
            ctx.fill()
            ctx.restore()
            clearBoxShadow()
          }

          ctx.save()
          applyImageClip(left, top, w, h)
          ctx.clip()
          const drawRect = resolveImageDrawRect(
            uploadedImage.naturalWidth,
            uploadedImage.naturalHeight,
            { left: 0, top: 0, width: w, height: h },
            resolveUserImageFit(css['object-fit']),
            css['object-position'],
          )
          const imageCenterX = drawRect.left + drawRect.width / 2
          const imageCenterY = drawRect.top + drawRect.height / 2
          ctx.translate(left + imageCenterX + uploadedState.position.x * scale, top + imageCenterY + uploadedState.position.y * scale)
          ctx.rotate(uploadedState.rotation * Math.PI / 180)
          ctx.scale(uploadedState.scale, uploadedState.scale)
          ctx.filter = resolveImageFilter(layer, scale) || 'none'
          ctx.drawImage(uploadedImage, -drawRect.width / 2, -drawRect.height / 2, drawRect.width, drawRect.height)
          ctx.filter = 'none'
          ctx.restore()
          drawInsetShadow()
        } catch (error) {
          console.error('[TemplateEditor] 用户上传图片导出失败:', uploadedState.imageUrl, error)
        }
        ctx.globalAlpha = 1
        continue
      }

      // ═══════════════════════════════════════════
      //  color / shape 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'color' || layer.type === 'shape') {
        let fillColor = css['background-color'] || css['background'] || layer.color || '#000'
        if (layer.color_mode === 'picker' && pickedColor[realIdx]) fillColor = pickedColor[realIdx]
        ctx.globalAlpha = layerAlpha
        applyBoxShadow()

        const cpVal = getClipPath(css)
        if (cpVal) {
          const clipPts = parseClipPathToPoints(cpVal, rect.w, rect.h)
          if (clipPts) {
            ctx.save()
            ctx.translate(left, top)
            ctx.fillStyle = fillColor
            fillClipPath(ctx, clipPts.map(p => [p[0] * scale, p[1] * scale]))
            ctx.restore()
          }
        } else if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          ctx.fillStyle = fillColor
          roundRect(left, top, w, h, br)
          ctx.fill()
        } else {
          ctx.fillStyle = fillColor
          ctx.fillRect(left, top, w, h)
        }

        clearBoxShadow()
        drawInsetShadow()
        ctx.globalAlpha = 1
        continue
      }

      // ═══════════════════════════════════════════
      //  text 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'text') {
        const text = (editedTexts[realIdx] ?? layer.text_content) || ''
        if (!text) continue
        const textStyle = resolveTextStyle(layer, device.width, device.height)
        const fs = textStyle.fontSize * scale
        const lineHeight = textStyle.lineHeightPx * scale
        const boxLeft = textStyle.visualLeft * scale
        const boxTop = textStyle.visualTop * scale
        const boxWidth = (textStyle.width ?? 0) * scale
        const boxHeight = (textStyle.height ?? textStyle.lineHeightPx) * scale
        const lines = text.split('\n')
        const textBlockHeight = lines.length * lineHeight
        ctx.globalAlpha = layerAlpha
        ctx.fillStyle = textStyle.color
        const fontFamily = textStyle.fontFamily?.includes(' ') ? `"${textStyle.fontFamily}"` : textStyle.fontFamily || 'sans-serif'
        ctx.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${fs}px ${fontFamily}`
        ctx.textAlign = (textStyle.textAlign || 'left') as CanvasTextAlign
        ctx.textBaseline = 'alphabetic'
        ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${textStyle.letterSpacingPx * scale}px`

        let tx = boxLeft
        if (ctx.textAlign === 'center') tx = boxLeft + boxWidth / 2
        else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') tx = boxLeft + boxWidth

        let ty = boxTop
        if (textStyle.verticalAlign === 'middle') ty += (boxHeight - textBlockHeight) / 2
        else if (textStyle.verticalAlign === 'bottom') ty += boxHeight - textBlockHeight

        // Canvas 的 top 基线不是 CSS 行盒顶部；按字体实际 ascent/descent 放回行盒中央。
        const metrics = ctx.measureText(text || 'M')
        const glyphHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
        const baselineOffset = (lineHeight - glyphHeight) / 2 + metrics.actualBoundingBoxAscent
        applyBoxShadow()
        lines.forEach((line, lineIndex) => ctx.fillText(line, tx, ty + lineIndex * lineHeight + baselineOffset))
        clearBoxShadow()
        drawInsetShadow()
        ctx.globalAlpha = 1
        continue
      }

      // ═══════════════════════════════════════════
      //  svg 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'svg') {
        const svgCode = layer.css_code || ''
        if (!svgCode) continue
        try {
          // 保留 SVG 内部每个路径、渐变、遮罩和嵌套 SVG；固定颜色只作用于 currentColor。
          let finalSvg = svgCode
          const resolvedSvgColor = layer.color_mode === 'picker' ? pickedColor[realIdx] : layer.color
          if (resolvedSvgColor && layer.color_mode === 'picker') {
            finalSvg = applySvgColor(finalSvg, resolvedSvgColor)
          } else if (resolvedSvgColor && layer.color_mode === 'fixed') {
            finalSvg = finalSvg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
              const styleMatch = attrs.match(/\sstyle\s*=\s*(["'])(.*?)\1/i)
              if (styleMatch) {
                const mergedStyle = `${styleMatch[2].replace(/;?\s*$/, ';')}color:${resolvedSvgColor}`
                return `<svg${attrs.replace(styleMatch[0], ` style="${mergedStyle}"`)}>`
              }
              return `<svg${attrs} style="color:${resolvedSvgColor}">`
            })
          }
          // SVG 数据 URI: 使用 base64 编码避免 encodeURIComponent 破坏 #/% 等特殊字符
          const svgDataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(finalSvg)))
          const svgImg = await loadImage(svgDataUri)
          // 确定 SVG 绘制尺寸：优先使用存储的 css_width/css_height（管理端上传时保存），
          // 其次用 CSS 解析，最后用 SVG viewBox 自然尺寸
          let drawW = w
          let drawH = h
          if (!css['width'] && !css['height']) {
            // 优先使用从管理端保存的尺寸
            if (layer.css_width != null && layer.css_height != null) {
              drawW = layer.css_width * scale
              drawH = layer.css_height * scale
            } else {
              const svgTagMatch = svgCode.match(/<svg[^>]*>/i)
              if (svgTagMatch) {
                const wm = svgTagMatch[0].match(/width="([^"]+)"/i)
                const hm = svgTagMatch[0].match(/height="([^"]+)"/i)
                const vbm = svgTagMatch[0].match(/viewBox="([^"]+)"/i)
                let vbW = 0, vbH = 0
                if (vbm) {
                  const parts = vbm[1].trim().split(/[\s,]+/).map(Number)
                  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { vbW = parts[2]; vbH = parts[3] }
                }
                const parsedW = parseFloat(wm?.[1] || '') || vbW || 0
                const parsedH = parseFloat(hm?.[1] || '') || vbH || 0
                if (parsedW > 0) drawW = parsedW * scale
                if (parsedH > 0) drawH = parsedH * scale
              }
            }
          }
          ctx.globalAlpha = layerAlpha
          applyBoxShadow()
          ctx.drawImage(svgImg, left, top, drawW, drawH)
          clearBoxShadow()
          drawInsetShadow()
          ctx.globalAlpha = 1
        } catch (e) { console.error('[TemplateEditor] SVG 导出失败:', e) }
        continue
      }

      // ═══════════════════════════════════════════
      //  image 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'image') {
        const imgUrl = layer.image_url
        if (!imgUrl) continue
        console.log(`[export] image "${layer.name}":`, { borderRadiusPx, clipPath: getClipPath(css), shorthand: css['border-radius'], tl: css['border-top-left-radius'], tr: css['border-top-right-radius'], br: css['border-bottom-right-radius'], bl: css['border-bottom-left-radius'] })

        try {
          const img = await loadImage(imgUrl)
          ctx.globalAlpha = layerAlpha
          applyBoxShadow()
          ctx.save()
          applyImageClip(left, top, w, h)
          ctx.clip()
          const drawRect = resolveImageDrawRect(
            img.naturalWidth,
            img.naturalHeight,
            { left, top, width: w, height: h },
            css['object-fit'],
            css['object-position'],
          )
          const imageCenterX = drawRect.left + drawRect.width / 2
          const imageCenterY = drawRect.top + drawRect.height / 2
          ctx.translate(imageCenterX, imageCenterY)
          ctx.rotate((layer.adjustments?.rotation ?? 0) * Math.PI / 180)
          ctx.scale(layer.adjustments?.scale ?? 1, layer.adjustments?.scale ?? 1)
          ctx.filter = resolveImageFilter(layer, scale) || 'none'
          ctx.drawImage(img, -drawRect.width / 2, -drawRect.height / 2, drawRect.width, drawRect.height)
          ctx.filter = 'none'
          ctx.restore()
          clearBoxShadow()
          drawInsetShadow()
        } catch (e) { console.error('[TemplateEditor] 静态图片导出失败:', imgUrl, e) }
        ctx.globalAlpha = 1
      }
    }

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png')
      })
      if (!blob) {
        setMsg('导出失败：无法生成图片')
        return
      }
      const result = await savePngBlob(
        blob,
        `template-${template?.name || 'export'}.png`,
      )
      setMsg(result.message)
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err)
      setMsg(text || '保存失败')
      console.error('[TemplateEditor] 导出保存失败', err)
    } finally {
      setExporting(false)
    }
  }, [device, exporting, sortedLayers, layerStates, pickedColor, editedTexts, interactiveLayers, template, previewScale])

  const curCursor = dragMode
    ? (dragMode === 'move' ? 'grabbing' : dragMode.startsWith('rotate') ? 'crosshair' : 'nwse-resize')
    : 'default'
  const scaleCursor = (mode: DragMode) =>
    mode === 'scale-tl' || mode === 'scale-br' ? 'nwse-resize' : 'nesw-resize'

  /* ── 加载状态 ── */
  if (loading) return (
    <div className={`h-dvh flex flex-col overflow-hidden${IS_OFFLINE ? ' safe-area-pad' : ''}`} style={{ background: 'var(--bg-primary)' }}>
      {!IS_OFFLINE && <Navbar />}
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>
    </div>
  )

  if (error || !template) return (
    <div className={`h-dvh flex flex-col overflow-hidden${IS_OFFLINE ? ' safe-area-pad' : ''}`} style={{ background: 'var(--bg-primary)' }}>
      {!IS_OFFLINE && <Navbar />}
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
        <div className="text-center">
          <p className="mb-4">{error || '模板不存在'}</p>
          {!IS_OFFLINE && (
            <Link to="/tools/watch-face" className="text-sm" style={{ color: 'var(--accent)' }}>返回列表</Link>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`h-dvh flex flex-col overflow-hidden${IS_OFFLINE ? ' safe-area-pad' : ''}`} style={{ background: 'var(--bg-primary)' }}>
      {!IS_OFFLINE && <Navbar />}

      <main className="flex-1 relative z-10 overflow-auto lg:overflow-hidden">
        <div className="min-h-full lg:h-full px-4 lg:px-6 py-4 lg:py-5">
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-5 lg:h-full">

            {/* 左侧 - 预览编辑区 */}
            <div className="lg:col-span-2 flex flex-col rounded-lg lg:h-full lg:max-h-none lg:min-h-0 lg:overflow-hidden" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
              {device ? (
                <>
                  <div className="flex items-center gap-3 px-4 lg:px-5 pt-4 lg:pt-5 pb-2 flex-shrink-0">
                    {!IS_OFFLINE ? (
                      <Link to="/tools/watch-face" className="p-2 rounded-md transition-all duration-200" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                        <ArrowLeft className="w-4 h-4" style={{ color: 'var(--text-primary)' }} />
                      </Link>
                    ) : (
                      <div className="w-2" />
                    )}
                    <h3 className="text-sm lg:text-base font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
                      预览 - {device.name}
                    </h3>
                    {activeLayerIdx !== null && layerStates[activeLayerIdx] && (
                      <>
                        <button onClick={() => resetTransform(activeLayerIdx)} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button onClick={() => { clearImage(activeLayerIdx); setActiveLayerIdx(null); }} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--danger)' }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>

                  <div ref={previewWrapRef} className="flex-1 flex items-center justify-center p-4 lg:p-6 min-h-0">
                    <div
                      className="relative mx-auto"
                      style={{ width: containerWidth, height: containerHeight, cursor: curCursor }}
                    >
                      {/* 深色描边 */}
                      <div className="absolute pointer-events-none" style={{
                        left: vpLeft - 3, top: vpTop - 3,
                        width: previewWidth + 6, height: previewHeight + 6,
                        borderRadius: cornerRadius + 3,
                        border: '2px solid var(--frame-border)',
                        zIndex: 20,
                      }} />

                      <div
                        ref={containerRef}
                        className="absolute"
                        style={{ left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 21 }}
                        onClick={(e) => {
                          // 点击交互图层时不触发取消选中或打开文件选择（避免与拖拽冲突）
                          if ((e.target as HTMLElement).closest('[data-interactive]')) return
                          if (activeLayerIdx !== null) {
                            setActiveLayerIdx(null)
                          } else {
                            const firstEmpty = interactiveLayers.find(({ realIdx }) => !layerStates[realIdx]?.imageUrl)
                            if (firstEmpty) fileInputRefs.current[firstEmpty.realIdx]?.click()
                          }
                        }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setIsDragOver(false)
                          const file = e.dataTransfer.files?.[0]
                          if (file && file.type.startsWith('image/')) {
                            const target = interactiveLayers.find(({ realIdx }) => !layerStates[realIdx]?.imageUrl)
                            if (target) handleFileUpload(target.realIdx, file)
                          }
                        }}
                      >
                        {interactiveLayers.map(({ realIdx }) => (
                          <input key={realIdx} ref={el => { fileInputRefs.current[realIdx] = el }}
                            type="file" accept="image/*" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(realIdx, f); e.target.value = '' }} />
                        ))}
                        {interactiveLayers.some(({ realIdx }) => layerStates[realIdx]?.imageUrl) ? (
                          <>
                            <div className="absolute" style={{ left: vpLeft, top: vpTop, width: previewWidth, height: previewHeight, borderRadius: cornerRadius }}>
                              <div className="absolute inset-0" style={{ background: device.background || '#FFFFFF', borderRadius: cornerRadius, overflow: 'hidden' }} />
                              <div style={{ width: device.width, height: device.height, transform: `scale(${previewScale})`, transformOrigin: 'top left', position: 'relative', overflow: 'hidden', borderRadius: cornerRadius / previewScale }}>
                                {sortedLayers.map(({ layer, realIdx }, sortIdx) => {
                                  const isInteractive = (layer.type === 'image' || layer.type === 'svg' || layer.type === 'shape')
                                    && layer.allow_user_upload
                                  const state = layerStates[realIdx]
                                  const css = getLayerCss(layer)
                                  // 背景模糊效果
                                  const fx = layer.effects
                                  const backdropBlur = fx && fx.blur_type === 'backdrop' && fx.blur_value > 0 ? fx.blur_value : 0
                                  const fxOpacity = fx && fx.opacity < 100 ? fx.opacity / 100 : undefined
                                  if (!isInteractive) {
                                    // ── 非交互图层：SVG / Shape / Color / Static Image ──
                                    if (layer.type === 'svg') {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      const svgColor = layer.color_mode === 'picker' ? pickedColor[realIdx] : layer.color
                                      const svgBoxShadow = css['box-shadow'] || css['boxShadow']
                                      const renderedSvg = fitSvgToContainer(
                                        layer.color_mode === 'picker' ? applySvgColor(layer.css_code || '', svgColor) : layer.css_code || '',
                                      )
                                      return (
                                        <div key={sortIdx} style={{ ...style, overflow: 'hidden', color: svgColor, opacity: fxOpacity, boxShadow: svgBoxShadow, pointerEvents: 'none' }}>
                                          {backdropBlur > 0 && (
                                            <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
                                          )}
                                          <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: renderedSvg }} />
                                        </div>
                                      )
                                    }
                                    if (layer.type === 'shape') {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      if (layer.color) style.backgroundColor = layer.color
                                      if (layer.color_mode === 'picker' && pickedColor[realIdx]) style.backgroundColor = pickedColor[realIdx]
                                      return (
                                        <div key={sortIdx} style={{ ...style, opacity: fxOpacity, pointerEvents: 'none' }}>
                                          {backdropBlur > 0 && (
                                            <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
                                          )}
                                        </div>
                                      )
                                    }
                                    if (layer.type === 'text') {
                                      const displayText = editedTexts[realIdx] ?? layer.text_content ?? ''
                                      const textStyle = resolveTextStyle(layer, device.width, device.height)
                                      const justifyContent = textStyle.verticalAlign === 'middle' ? 'center' : textStyle.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'
                                      const textBoxStyle: React.CSSProperties = {
                                        ...textStyle.explicitStyle,
                                        position: 'absolute',
                                        left: textStyle.left,
                                        top: textStyle.top,
                                        width: textStyle.width,
                                        height: textStyle.height,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent,
                                        fontSize: textStyle.fontSize,
                                        fontFamily: textStyle.fontFamily,
                                        fontWeight: textStyle.fontWeight,
                                        fontStyle: textStyle.fontStyle,
                                        lineHeight: `${textStyle.lineHeightPx}px`,
                                        letterSpacing: textStyle.letterSpacingPx,
                                        color: textStyle.color,
                                        textAlign: textStyle.textAlign,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        opacity: fxOpacity,
                                        cursor: 'text',
                                        zIndex: 50,
                                      }
                                      return (
                                        <div key={sortIdx} style={textBoxStyle}
                                          onClick={(e) => { e.stopPropagation(); setEditingTextIdx(realIdx); setEditedTexts(prev => ({ ...prev, [realIdx]: prev[realIdx] ?? layer.text_content ?? '' })) }}>
                                          {backdropBlur > 0 && (
                                            <div style={{ position: 'absolute', inset: '-4px', backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0 }} />
                                          )}
                                          <span style={{ position: 'relative', zIndex: 1, width: '100%', pointerEvents: 'none', outline: editingTextIdx === realIdx ? '1px solid var(--accent)' : undefined, outlineOffset: 2 }}>
                                            {displayText || <span style={{ opacity: 0.4 }}>点击后在设备下方编辑文字</span>}
                                          </span>
                                        </div>
                                      )
                                    }
                                    if (layer.type === 'color') {
                                      const cpVal = getClipPath(css)
                                      if (cpVal) {
                                        const rect = resolveLayerRect(layer, css, device.width, device.height)
                                        const clipPts = parseClipPathToPoints(cpVal, rect.w, rect.h)
                                        if (clipPts) {
                                          let fillColor = css['background-color'] || css['background'] || layer.color || '#000'
                                          if (layer.color_mode === 'picker' && pickedColor[realIdx]) fillColor = pickedColor[realIdx]
                                          return <svg key={sortIdx} style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.w, height: rect.h, overflow: 'visible', opacity: fxOpacity, pointerEvents: 'none' }}><polygon points={pointsToSvgAttr(clipPts)} fill={fillColor} /></svg>
                                        }
                                      }
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      if (layer.color_mode === 'picker' && pickedColor[realIdx]) style.backgroundColor = pickedColor[realIdx]
                                      else if (layer.color && !css['background'] && !css['background-color']) style.backgroundColor = layer.color
                                      return (
                                        <div key={sortIdx} style={{ ...style, opacity: fxOpacity, pointerEvents: 'none' }}>
                                          {backdropBlur > 0 && (
                                            <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
                                          )}
                                        </div>
                                      )
                                    }
                                    if (layer.type === 'image' && layer.show_on_client === false) return null
                                    if (layer.type === 'image' && layer.image_url) {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      const imageFit = typeof style.objectFit === 'string' ? style.objectFit : 'fill'
                                      const imagePosition = typeof style.objectPosition === 'string' ? style.objectPosition : '50% 50%'
                                      return (
                                        <div key={sortIdx} style={{ ...style, opacity: fxOpacity, overflow: 'hidden', pointerEvents: 'none' }}>
                                          {backdropBlur > 0 && (
                                            <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 1, borderRadius: 'inherit' }} />
                                          )}
                                          <img src={layer.image_url} alt="" draggable={false} style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: imageFit,
                                            objectPosition: imagePosition,
                                            pointerEvents: 'none',
                                            maxWidth: 'none',
                                            display: 'block',
                                            position: 'relative',
                                            zIndex: 2,
                                            transform: `rotate(${layer.adjustments?.rotation ?? 0}deg) scale(${layer.adjustments?.scale ?? 1})`,
                                            filter: resolveImageFilter(layer),
                                          }} />
                                        </div>
                                      )
                                    }
                                    return null
                                  }
                                  const rect = resolveLayerRect(layer, css, device.width, device.height)
                                  const cssW = rect.w
                                  const cssH = rect.h
                                  const cssLeft = rect.left
                                  const cssTop = rect.top
                                  // 从 CSS 提取边框圆角和阴影
                                  const cssBorderRadius = resolveBorderRadius(css)
                                  const cssBoxShadow = css['box-shadow'] || css['boxShadow']
                                  const isInsetBoxShadow = /\binset\b/i.test(cssBoxShadow || '')
                                  const layerOpacity = parseFloat(css['opacity'] || '1')

                                  const displayRect = state?.naturalWidth && state.naturalHeight
                                    ? resolveImageDrawRect(
                                        state.naturalWidth,
                                        state.naturalHeight,
                                        { left: 0, top: 0, width: cssW, height: cssH },
                                        resolveUserImageFit(css['object-fit']),
                                        css['object-position'],
                                      )
                                    : { left: 0, top: 0, width: cssW, height: cssH }

                                  return (
                                    <div key={sortIdx} data-interactive="true"
                                      style={{ position: 'absolute', left: cssLeft, top: cssTop, width: cssW, height: cssH, transform: stripTranslateTransform(css.transform), opacity: (state?.imageUrl || (layer.show_on_client !== false && layer.image_url)) ? layerOpacity : 0, cursor: state?.imageUrl ? (dragMode === 'move' ? 'grabbing' : 'grab') : 'pointer', pointerEvents: 'auto', borderRadius: cssBorderRadius, clipPath: getRoundedClipPath(cssBorderRadius), WebkitClipPath: getRoundedClipPath(cssBorderRadius), boxShadow: isInsetBoxShadow ? undefined : cssBoxShadow, touchAction: 'none', overflow: 'hidden' }}
                                      onMouseDown={(e) => { if (state?.imageUrl) { setActiveLayerIdx(realIdx); handleMouseDown(realIdx, e) } }}
                                      onTouchStart={(e) => { if (state?.imageUrl) { setActiveLayerIdx(realIdx); handleTouchStart(realIdx, e) } }}
                                      onClick={(e) => { e.stopPropagation(); if (!state?.imageUrl) fileInputRefs.current[realIdx]?.click() }}>
                                      <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit', position: 'relative' }}>
                                      {/* 背景模糊 overlay */}
                                      {backdropBlur > 0 && (
                                        <div style={{ position: 'absolute', inset: 0, backdropFilter: `blur(${backdropBlur}px)`, WebkitBackdropFilter: `blur(${backdropBlur}px)`, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 0, borderRadius: 'inherit' }} />
                                      )}
                                      {state?.imageUrl ? (
                                        <div style={{
                                          width: displayRect.width,
                                          height: displayRect.height,
                                          position: 'absolute',
                                          left: displayRect.left,
                                          top: displayRect.top,
                                          pointerEvents: 'none',
                                          transform: `translate(${state.position.x}px, ${state.position.y}px) rotate(${state.rotation}deg) scale(${state.scale})`,
                                          transformOrigin: 'center center',
                                          zIndex: 1,
                                        }}>
                                          <img src={state.imageUrl} alt="" draggable={false} style={{
                                            width: '100%',
                                            height: '100%',
                                            maxWidth: 'none',
                                            display: 'block',
                                            pointerEvents: 'none',
                                            filter: resolveImageFilter(layer),
                                          }} />
                                        </div>
                                      ) : layer.show_on_client !== false && layer.image_url ? (
                                        <img src={layer.image_url} alt="" draggable={false} style={{
                                          width: '100%',
                                          height: '100%',
                                          maxWidth: 'none',
                                          objectFit: (css['object-fit'] || 'fill') as React.CSSProperties['objectFit'],
                                          objectPosition: css['object-position'] || '50% 50%',
                                          pointerEvents: 'none',
                                          position: 'relative',
                                          zIndex: 1,
                                          transform: `rotate(${layer.adjustments?.rotation ?? 0}deg) scale(${layer.adjustments?.scale ?? 1})`,
                                          filter: resolveImageFilter(layer),
                                        }} />
                                      ) : null}
                                      {isInsetBoxShadow && (
                                        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: cssBoxShadow, pointerEvents: 'none', zIndex: 2 }} />
                                      )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>

                            {/* 缩放/旋转手柄 — 始终显示在有图片的交互图层上（与 WatchFaceEdit 一致） */}
                            {(() => {
                              const idx = activeLayerIdx ?? interactiveLayers.find(({realIdx}) => layerStates[realIdx]?.imageUrl)?.realIdx
                              if (idx == null) return null
                              const st = layerStates[idx]
                              if (!st?.imageUrl) return null
                              const al = device.layers[idx]
                              const acss = getLayerCss(al)
                              const arect = resolveLayerRect(al, acss, device.width, device.height)
                              const acssLeft = arect.left
                              const acssTop = arect.top
                              const acssW = arect.w
                              const acssH = arect.h
                              const imageDisplay = getImageDisplay(idx)
                              const imgW = imageDisplay?.dw ?? acssW
                              const imgH = imageDisplay?.dh ?? acssH
                              // 设备坐标系中心：包含 object-position 的初始偏移和用户偏移。
                              const cx = acssW / 2 + (imageDisplay?.baseX ?? 0) + st.position.x
                              const cy = acssH / 2 + (imageDisplay?.baseY ?? 0) + st.position.y
                              const hw = imgW / 2 * st.scale
                              const hh = imgH / 2 * st.scale
                              const rad = (st.rotation * Math.PI) / 180
                              const cosA = Math.cos(rad), sinA = Math.sin(rad)
                              const toPreview = (dx: number, dy: number) => ({
                                x: vpLeft + (acssLeft + dx) * previewScale,
                                y: vpTop + (acssTop + dy) * previewScale,
                              })
                              return (['tl', 'tr', 'bl', 'br'] as const).map(corner => {
                                let dx: number, dy: number
                                if (corner === 'tl') { dx = -hw; dy = -hh }
                                else if (corner === 'tr') { dx = hw; dy = -hh }
                                else if (corner === 'bl') { dx = -hw; dy = hh }
                                else { dx = hw; dy = hh }
                                const devPx = cx + dx * cosA - dy * sinA
                                const devPy = cy + dx * sinA + dy * cosA
                                const p1 = toPreview(devPx, devPy)
                                const mode = `scale-${corner}` as DragMode, rotMode = `rotate-${corner}` as DragMode
                                const centerP = toPreview(cx, cy)
                                const rdx = p1.x - centerP.x
                                const rdy = p1.y - centerP.y
                                const rlen = Math.sqrt(rdx * rdx + rdy * rdy) || 1
                                const rpx = p1.x + (rdx / rlen) * ROT_HANDLE_OFFSET
                                const rpy = p1.y + (rdy / rlen) * ROT_HANDLE_OFFSET
                                return (
                                  <div key={corner} style={{ position: 'absolute', zIndex: 25 }} data-interactive="true">
                                    <svg className="hidden md:block absolute pointer-events-none" style={{ left: Math.min(p1.x, rpx) - 2, top: Math.min(p1.y, rpy) - 2, width: Math.abs(rpx - p1.x) + 4, height: Math.abs(rpy - p1.y) + 4, overflow: 'visible' }}>
                                      <line x1={p1.x - Math.min(p1.x, rpx) + 2} y1={p1.y - Math.min(p1.y, rpy) + 2} x2={rpx - Math.min(p1.x, rpx) + 2} y2={rpy - Math.min(p1.y, rpy) + 2} stroke="rgba(72,120,144,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
                                    </svg>
                                    <div className="absolute" style={{ left: p1.x - HANDLE_R, top: p1.y - HANDLE_R, width: HANDLE_R * 2, height: HANDLE_R * 2, borderRadius: '50%', background: 'var(--accent)', border: '2.5px solid white', cursor: scaleCursor(mode), boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                                      onMouseDown={(e) => handleScaleMouseDown(idx, mode, e)} onTouchStart={(e) => handleScaleTouchStart(idx, mode, e)} />
                                    <div className="hidden md:block absolute" style={{ left: rpx - ROT_HANDLE_R, top: rpy - ROT_HANDLE_R, width: ROT_HANDLE_R * 2, height: ROT_HANDLE_R * 2, borderRadius: '50%', cursor: 'crosshair' }}
                                      onMouseDown={(e) => handleScaleMouseDown(idx, rotMode, e)} onTouchStart={(e) => handleScaleTouchStart(idx, rotMode, e)} />
                                    <svg className="hidden md:block absolute pointer-events-none" width="22" height="22" style={{ left: rpx - 11, top: rpy - 11 }} viewBox="0 0 24 24" fill="none">
                                      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" fill="var(--accent)" />
                                    </svg>
                                  </div>
                                )
                              })
                            })()}
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center cursor-pointer">
                            <p className="text-sm md:text-base transition-colors duration-200" style={{ color: isDragOver ? 'var(--accent)' : 'var(--text-muted)' }}>
                              点击此处上传图片
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 底部状态栏 */}
                  <div className="p-2 md:p-4 z-10 flex-shrink-0" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
                      <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                        <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>缩放：</span>
                        <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{activeLayerIdx !== null && layerStates[activeLayerIdx] ? (layerStates[activeLayerIdx].scale * 100).toFixed(0) : '100'}%</span>
                      </div>
                      <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                        <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>旋转：</span>
                        <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{activeLayerIdx !== null && layerStates[activeLayerIdx] ? layerStates[activeLayerIdx].rotation.toFixed(1) : '0.0'}°</span>
                      </div>
                      {activeLayerIdx !== null && layerStates[activeLayerIdx] && (
                        <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                          <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>偏移：</span>
                          <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{layerStates[activeLayerIdx].position.x.toFixed(0)}, {layerStates[activeLayerIdx].position.y.toFixed(0)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center min-h-[50vh] lg:min-h-[60vh]">
                  <p className="text-sm lg:text-base" style={{ color: 'var(--text-muted)' }}>请先选择设备</p>
                </div>
              )}
            </div>

            {/* 右侧 */}
            <div className="lg:col-span-1 lg:overflow-auto no-scrollbar lg:min-h-0 lg:flex-none">
              <div className="space-y-3 lg:space-y-4">
                <div className="rounded-xl p-4 lg:p-5" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
                  <h3 className="text-base lg:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>「{template.name}」</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{device ? `${device.width}×${device.height}px` : ''}</p>
                </div>

                {template.devices.length > 1 && (
                  <div className="rounded-xl p-4 lg:p-5" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
                    <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>目标设备</label>
                    <div className="grid grid-cols-2 gap-1.5 lg:gap-2">
                      {template.devices.map((d, i) => (
                        <button key={i} onClick={() => setSelectedDeviceIdx(i)}
                          className="py-1.5 lg:py-2 px-1.5 lg:px-3 rounded-lg transition-all duration-200 text-center"
                          style={{
                            border: `1.5px solid ${selectedDeviceIdx === i ? 'var(--accent)' : 'var(--border-color)'}`,
                            background: selectedDeviceIdx === i ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                            color: selectedDeviceIdx === i ? 'var(--accent)' : 'var(--text-secondary)',
                            fontWeight: selectedDeviceIdx === i ? 600 : 400,
                          }}>
                          <div className="text-[10px] lg:text-sm leading-tight">{d.name}</div>
                          <div className="text-[9px] lg:text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{d.width}×{d.height}px</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {textLayers.length > 0 && (
                  <div className="rounded-xl p-4 lg:p-5" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
                    <h3 className="text-sm lg:text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>文字内容</h3>
                    <div className="space-y-3">
                      {textLayers.map(({ layer, realIdx }) => (
                        <label key={realIdx} className="block">
                          <span className="block text-[11px] mb-1.5" style={{ color: editingTextIdx === realIdx ? 'var(--accent)' : 'var(--text-secondary)' }}>
                            {layer.name || `文字图层 ${realIdx + 1}`}
                          </span>
                          <textarea
                            value={editedTexts[realIdx] ?? layer.text_content ?? ''}
                            onFocus={() => setEditingTextIdx(realIdx)}
                            onBlur={() => setEditingTextIdx(null)}
                            onChange={e => setEditedTexts(prev => ({ ...prev, [realIdx]: e.target.value }))}
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                            style={{
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-primary)',
                              border: `1px solid ${editingTextIdx === realIdx ? 'var(--accent)' : 'var(--border-color)'}`,
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {device && pickerColorLayers.some(({ realIdx }) => pickerColors[realIdx]?.length > 0) && (
                  <div className="rounded-xl p-4 lg:p-5" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
                    <h3 className="text-sm lg:text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>主题颜色</h3>
                    {pickerColorLayers.filter(({ realIdx }) => pickerColors[realIdx]?.length > 0).map(({ realIdx }) => (
                      <div key={realIdx} className="mb-2 last:mb-0">
                        <div className="text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>图层 {realIdx + 1}</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(pickerColors[realIdx] || []).map(color => (
                            <button key={color} onClick={() => setPickedColor(prev => ({ ...prev, [realIdx]: color }))}
                              className="w-7 h-7 rounded-full transition-all duration-200 flex-shrink-0"
                              style={{
                                background: color,
                                border: `2.5px solid ${pickedColor[realIdx] === color ? 'var(--accent)' : 'var(--border-color)'}`,
                                transform: pickedColor[realIdx] === color ? 'scale(1.15)' : 'scale(1)',
                              }} title={color} />
                          ))}
                          <label className="w-7 h-7 rounded-full cursor-pointer flex-shrink-0 flex items-center justify-center"
                            style={{ background: pickedColor[realIdx] || '#fff', border: '2.5px solid var(--border-color)' }}>
                            <input type="color" value={pickedColor[realIdx] || '#ffffff'}
                              onChange={(e) => setPickedColor(prev => ({ ...prev, [realIdx]: e.target.value }))}
                              className="sr-only" />
                            <Palette className="w-3 h-3" style={{ color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {interactiveLayers.some(({ realIdx }) => layerStates[realIdx]?.imageUrl) && (
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="w-full py-2.5 lg:py-3 px-4 font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm lg:text-base text-white disabled:opacity-60"
                    style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-elevated)' }}
                  >
                    <Download className="w-4 h-4" />
                    {exporting ? '导出中…' : '导出图片'}
                  </button>
                )}

                {msg && (
                  <div className="text-xs text-center py-1" style={{ color: 'var(--accent)' }}>{msg}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}