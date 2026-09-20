import type { CSSProperties } from 'react'

export interface TextStyleLayer {
  css_code?: string
  css_position_code?: string
  x?: number
  y?: number
  css_width?: number
  css_height?: number
  font_size?: number
  font_family?: string
  font_weight?: string
  text_color?: string
  text_align?: string
  text_vertical_align?: string
  line_height?: number
  letter_spacing?: number
  /** 手动描边配置（优先于 CSS 中解析出的描边） */
  text_stroke_type?: 'outset' | 'center' | 'inset'
  text_stroke_size?: number
  text_stroke_color_mode?: 'fixed' | 'picker'
  text_stroke_color?: string
  text_stroke_picker_default?: 'dark' | 'light'
}

export interface ResolvedTextStyle {
  css: Record<string, string>
  explicitStyle: CSSProperties
  left: number
  top: number
  visualLeft: number
  visualTop: number
  width?: number
  height?: number
  fontSize: number
  fontFamily?: string
  fontWeight: string
  fontStyle: string
  lineHeightPx: number
  letterSpacingPx: number
  color: string
  textStrokeType: 'outset' | 'center' | 'inset'
  textStrokeWidth: number
  textStrokeColor?: string
  textAlign: CSSProperties['textAlign']
  verticalAlign: 'top' | 'middle' | 'bottom'
}

/** 支持声明片段与“选择器 { ... }”两种设计软件导出格式。 */
export function getCssDeclarationText(raw: string): string {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const open = css.indexOf('{')
  const close = css.lastIndexOf('}')
  return open >= 0 && close > open ? css.slice(open + 1, close) : css
}

/** 使用 CSSOM 解析声明，避免引号、url() 或渐变中的分号破坏属性。 */
export function parseCssDeclarations(raw: string): Record<string, string> {
  if (!raw || /^\s*</.test(raw)) return {}
  const declarations = getCssDeclarationText(raw)
  if (!declarations) return {}

  const parsed: Record<string, string> = {}
  if (typeof document === 'undefined') {
    for (const declaration of declarations.split(';')) {
      const separator = declaration.indexOf(':')
      if (separator < 0) continue
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration.slice(separator + 1).trim()
      if (property && value) parsed[property] = value
    }
    return parsed
  }

  const style = document.createElement('div').style
  style.cssText = declarations
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    parsed[property] = style.getPropertyValue(property).trim()
  }
  return parsed
}

function toReactStyleKey(property: string): string {
  if (property.startsWith('--')) return property
  return property
    .replace(/^-webkit-/, 'Webkit-')
    .replace(/^-moz-/, 'Moz-')
    .replace(/^-ms-/, 'ms-')
    .replace(/-([a-z])/g, (_, character: string) => character.toUpperCase())
    .replace('-', '')
}

export function cssDeclarationsToReactStyle(css: Record<string, string>): CSSProperties {
  const parsed: Record<string, string | number> = {}
  const numericProperties = new Set(['opacity', 'zIndex', 'flex', 'order', 'fontWeight'])
  for (const [property, value] of Object.entries(css)) {
    const key = toReactStyleKey(property)
    const numericValue = Number(value)
    parsed[key] = numericProperties.has(key) && Number.isFinite(numericValue) ? numericValue : value
  }
  return parsed as CSSProperties
}

export function normalizeFontFaceStyle(style: string | undefined): FontFaceDescriptors['style'] {
  const normalized = (style || '').trim().toLowerCase()
  if (normalized.includes('italic')) return 'italic'
  if (normalized.includes('oblique')) return 'oblique'
  return 'normal'
}

export function cssLengthToPx(value: string | undefined, reference: number): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  const numeric = Number.parseFloat(normalized)
  if (!Number.isFinite(numeric)) return undefined
  if (normalized.endsWith('%')) return reference * numeric / 100
  return numeric
}

function firstFontFamily(value: string | undefined): string | undefined {
  const family = value?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  return family || undefined
}

function normalizeTextAlign(value: string | undefined): CSSProperties['textAlign'] | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'left' || normalized === 'center' || normalized === 'right' || normalized === 'start' || normalized === 'end') {
    return normalized
  }
  return undefined
}

function inferHorizontalAlign(css: Record<string, string>): CSSProperties['textAlign'] | undefined {
  const direct = normalizeTextAlign(css['text-align'])
  if (direct) return direct
  const centering = [css['justify-content'], css['justify-items'], css['place-content'], css['place-items']]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/\bcenter\b/.test(centering)) return 'center'
  if (/\b(?:flex-end|end)\b/.test(centering)) return 'right'
  return undefined
}

function inferVerticalAlign(css: Record<string, string>, fallback: string | undefined): 'top' | 'middle' | 'bottom' {
  const direct = css['vertical-align']?.trim().toLowerCase()
  if (direct === 'middle' || direct === 'center') return 'middle'
  if (direct === 'bottom') return 'bottom'
  if (direct === 'top') return 'top'

  const alignment = [css['align-items'], css['align-content'], css['place-items'], css['place-content']]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/\bcenter\b/.test(alignment)) return 'middle'
  if (/\b(?:flex-end|end)\b/.test(alignment)) return 'bottom'
  return fallback === 'middle' || fallback === 'bottom' ? fallback : 'top'
}

function resolveLineHeightPx(value: string | undefined, fontSize: number, fallback: number | undefined): number {
  if (!value || value === 'normal') return fontSize * (fallback ?? 1.2)
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return fontSize * (fallback ?? 1.2)
  if (value.trim().endsWith('%')) return fontSize * numeric / 100
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return fontSize * numeric
  return numeric
}

export function resolveCssTranslation(transform: string | undefined, width: number, height: number): { x: number; y: number } {
  if (!transform || transform === 'none') return { x: 0, y: 0 }
  let x = 0
  let y = 0
  const toPx = (value: string | undefined, reference: number) => cssLengthToPx(value, reference) ?? 0

  for (const match of transform.matchAll(/translate(?:3d)?\(\s*([^,\s)]+)(?:\s*,\s*|\s+)([^,\s)]+)/gi)) {
    x += toPx(match[1], width)
    y += toPx(match[2], height)
  }
  for (const match of transform.matchAll(/translateX\(\s*([^)]+)\)/gi)) x += toPx(match[1], width)
  for (const match of transform.matchAll(/translateY\(\s*([^)]+)\)/gi)) y += toPx(match[1], height)
  return { x, y }
}

export function stripTranslateTransform(transform: string | undefined): string {
  if (!transform) return 'none'
  const stripped = transform
    .replace(/translate(?:3d)?\([^)]*\)/gi, '')
    .replace(/translate[XY]\([^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || 'none'
}

/** 从 CSS transform 字符串中提取累计旋转角度（deg）。 */
export function resolveCssRotation(transform: string | undefined): number {
  if (!transform || transform === 'none') return 0
  let deg = 0
  for (const m of transform.matchAll(/rotate\(\s*([-\d.]+)\s*deg\s*\)/gi)) {
    deg += Number.parseFloat(m[1]) || 0
  }
  for (const m of transform.matchAll(/rotate\(\s*([-\d.]+)\s*rad\s*\)/gi)) {
    deg += (Number.parseFloat(m[1]) || 0) * (180 / Math.PI)
  }
  return deg
}

export function resolveTextStyle(layer: TextStyleLayer, deviceWidth: number, deviceHeight: number): ResolvedTextStyle {
  const css = {
    ...parseCssDeclarations(layer.css_code || ''),
    ...parseCssDeclarations(layer.css_position_code || ''),
  }
  const explicitStyle = cssDeclarationsToReactStyle(css)
  const fontSize = cssLengthToPx(css['font-size'], layer.font_size ?? 24) ?? layer.font_size ?? 24
  const textAlign = inferHorizontalAlign(css) || normalizeTextAlign(layer.text_align) || 'left'
  const verticalAlign = inferVerticalAlign(css, layer.text_vertical_align)

  const explicitWidth = cssLengthToPx(css.width, deviceWidth)
  const explicitHeight = cssLengthToPx(css.height, deviceHeight)
  const shouldUseCanvasWidth = textAlign === 'center'
    && explicitWidth == null
    && layer.css_width == null
    && css.left == null
    && css.right == null
  const width = explicitWidth ?? layer.css_width ?? (shouldUseCanvasWidth ? deviceWidth : undefined)
  const height = explicitHeight ?? layer.css_height

  let left = cssLengthToPx(css.left, deviceWidth)
  if (left == null && css.right != null && width != null) {
    left = deviceWidth - (cssLengthToPx(css.right, deviceWidth) ?? 0) - width
  }
  if (left == null) left = shouldUseCanvasWidth ? 0 : layer.x ?? 0

  let top = cssLengthToPx(css.top, deviceHeight)
  if (top == null && css.bottom != null && height != null) {
    top = deviceHeight - (cssLengthToPx(css.bottom, deviceHeight) ?? 0) - height
  }
  if (top == null) top = layer.y ?? 0

  const translation = resolveCssTranslation(css.transform, width ?? 0, height ?? 0)
  const fontFamily = firstFontFamily(css['font-family']) || layer.font_family || undefined
  const fontWeight = css['font-weight'] || layer.font_weight || '400'
  const fontStyle = css['font-style'] || 'normal'
  const lineHeightPx = resolveLineHeightPx(css['line-height'], fontSize, layer.line_height)
  const letterSpacingPx = cssLengthToPx(css['letter-spacing'], fontSize) ?? layer.letter_spacing ?? 0
  const cssStrokeWidth = cssLengthToPx(css['-webkit-text-stroke-width'] || css['text-stroke-width'], fontSize)
    ?? cssLengthToPx(css['-webkit-text-stroke'] || css['text-stroke'], fontSize)
    ?? 0
  const cssStrokeColor = css['-webkit-text-stroke-color'] || css['text-stroke-color']
    || css['-webkit-text-stroke']?.trim().split(/\s+/).find(value => CSS.supports('color', value))
    || css['text-stroke']?.trim().split(/\s+/).find(value => CSS.supports('color', value))
  // 手动描边配置优先于 CSS；未配置颜色时兜底为黑色
  const hasManualStroke = layer.text_stroke_size != null
  const textStrokeWidth = hasManualStroke ? layer.text_stroke_size! : cssStrokeWidth
  const textStrokeColor = layer.text_stroke_color || cssStrokeColor || (textStrokeWidth > 0 ? '#000000' : undefined)
  const textStrokeType = layer.text_stroke_type ?? 'center'

  return {
    css,
    explicitStyle,
    left,
    top,
    visualLeft: left + translation.x,
    visualTop: top + translation.y,
    width,
    height,
    fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    lineHeightPx,
    letterSpacingPx,
    color: css.color || layer.text_color || '#FFFFFF',
    textStrokeType,
    textStrokeWidth,
    textStrokeColor,
    textAlign,
    verticalAlign,
  }
}

/** DOM 预览使用的描边线宽：居中描边按设定值，外/内描边翻倍以补偿 fill 覆盖的一半。 */
export function textStrokeLineWidth(style: Pick<ResolvedTextStyle, 'textStrokeType' | 'textStrokeWidth'>): number {
  return style.textStrokeType === 'center' ? style.textStrokeWidth : style.textStrokeWidth * 2
}