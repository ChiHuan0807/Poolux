/**
 * 相册表盘编辑器的共享逻辑：图层类型定义、CSS 解析、预览与导出共用的几何/滤镜计算、旧数据迁移。
 * 移动端新版编辑器（WatchFaceEditorPro）与旧版编辑器（TemplateEditor）共用这一份实现，
 * 保证同一份模板在两处渲染、导出以及存量旧数据迁移后的结果完全一致。
 */
import { useCallback, useEffect, useState, type CSSProperties, type SetStateAction } from 'react'
import { apiFetch, API_BASE } from '@/lib/api'
import { IS_OFFLINE, offlineAsset } from '@/lib/offline'
import {
  cssLengthToPx,
  normalizeFontFaceStyle,
  parseCssDeclarations,
  resolveCssTranslation,
  resolveTextStyle,
  stripTranslateTransform,
} from '@/lib/templateTextStyle'

/* ── 类型 ── */
export interface Layer {
  name: string
  css_code: string
  type: 'color' | 'image' | 'svg' | 'shape' | 'text'
  color_mode?: 'fixed' | 'picker'
  color?: string
  picker_default?: 'dark' | 'light'
  text_stroke_type?: 'outset' | 'center' | 'inset'
  text_stroke_size?: number
  text_stroke_color_mode?: 'fixed' | 'picker'
  text_stroke_color?: string
  text_stroke_picker_default?: 'dark' | 'light'
  allow_user_upload?: boolean
  image_url?: string
  /** 图片图层的「SVG 形状遮罩」（管理端上传的 SVG 源码）：用户上传的图片只显示在这个 SVG 画出来的形状里。 */
  mask_svg?: string
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
  flip_horizontal?: boolean
  flip_vertical?: boolean
  adjustments?: { rotation?: number; scale?: number; blur?: number; contrast?: number; brightness?: number }
  group_id?: string
}

export interface DeviceConfig {
  name: string
  width: number
  height: number
  corner_radius: number
  background?: string
  layers: Layer[]
}

export interface Template {
  id: number
  name: string
  devices: DeviceConfig[]
  preview_image: string
  /** 「效果-图片效果-模糊度」滑杆的上限（px），由管理端在模板里设定；未设置时按 DEFAULT_BLUR_MAX。 */
  blur_max?: number
  created_at: string
  updated_at: string
}

export interface LayerState {
  imageUrl?: string
  naturalWidth?: number
  naturalHeight?: number
  position: { x: number; y: number }
  scale: number
  rotation: number
}

/** 拖拽模式。
 *  'pinch-rotate'：旧版编辑器的双指手势（缩放 + 旋转）。
 *  'pinch'：移动端 Pro 界面的双指手势（只移动 + 缩放）。那一套里单指留给
 *  「点一下图片放大到整屏」，所以没有单指拖动；旋转也不再从手势进入。 */
export type DragMode = 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate-tl' | 'rotate-tr' | 'rotate-bl' | 'rotate-br' | 'pinch-rotate' | 'pinch'

/** 双指旋转松手时，角度距 90° 整数倍在 15° 以内则自动吸附 */
export function snapRotation(deg: number): number {
  const nearest = Math.round(deg / 90) * 90
  return Math.abs(deg - nearest) < 5 ? nearest : deg
}

/* ── 常量 ── */
export const PAD = 20
export const HANDLE_R = 7
export const ROT_HANDLE_R = 6
export const ROT_HANDLE_OFFSET = 36
export const EXPORT_SCALE = 2

/* ── CSS 解析 ── */
export function toReactKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function fitSvgToContainer(html: string): string {
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
export function applySvgColor(html: string, color: string | undefined): string {
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

export function parseCssBlock(raw: string): Record<string, string> {
  return parseCssDeclarations(raw)
}

/** 绕过浏览器 CSSOM，直接从原始 CSS 字符串拆分属性。
 *  用于兜底 CSSOM 在不同浏览器中解析
 *  background/border 缩写行为不一致导致渐变/边框丢失的问题。 */
export function getRawCssProps(raw: string): Record<string, string> {
  const props: Record<string, string> = {}
  if (!raw) return props
  const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^{]*\{|\}[^}]*$/g, '').trim()
  for (const decl of cleaned.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (prop && value) props[prop] = value
  }
  return props
}

/** 解析图层在设备坐标系中的最终视觉矩形。结构化宽高和 x/y 是 CSS 缺失时的回退。 */
export function resolveLayerRect(
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

export function getLayerCss(layer: Layer): Record<string, string> {
  return {
    ...parseCssBlock(layer.css_code || ''),
    ...parseCssBlock(layer.css_position_code || ''),
  }
}

/**
 * SVG 源码自带渲染尺寸：width/height 属性 → viewBox（按宽高比适配进设备画布）→ 兜底 100×100。
 * 与管理端预览（TemplateCreator.parseSvgDimensions）同一套规则 —— SVG 图层的方框用哪一套，
 * 预览、导出、管理端就必须都用哪一套，否则同一份模板在三个地方大小都不一样。
 */
export function resolveSvgIntrinsicSize(svgCode: string, deviceW: number, deviceH: number): { w: number; h: number } {
  const source = svgCode || ''
  const parseDim = (value: string | undefined, reference: number): number => {
    if (!value) return 0
    if (value.trim().endsWith('%')) return reference * (Number.parseFloat(value) || 0) / 100
    return Number.parseFloat(value) || 0
  }
  const attr = (name: string) => source.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
  const declaredW = parseDim(attr('width'), deviceW)
  const declaredH = parseDim(attr('height'), deviceH)
  if (declaredW > 0 && declaredH > 0) return { w: declaredW, h: declaredH }
  // 只声明了一边时按正方形处理，避免另一轴掉进兜底尺寸造成拉伸
  if (declaredW > 0) return { w: declaredW, h: declaredW }
  if (declaredH > 0) return { w: declaredH, h: declaredH }

  const viewBox = attr('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      if (Math.abs(parts[2] - deviceW) < 1 && Math.abs(parts[3] - deviceH) < 1) return { w: deviceW, h: deviceH }
      const aspect = parts[2] / parts[3]
      return { w: Math.min(deviceW, deviceH * aspect), h: Math.min(deviceH, deviceW / aspect) }
    }
  }

  return { w: 100, h: 100 }
}

/**
 * 图层「内容」在设备坐标系里的矩形，也就是这张图层真正占住的那块地方。
 *
 * 和 resolveLayerRect 的区别只在 svg 类型：svg 图层在 CSS 没写宽高时，应该按 SVG 文件自己
 * 声明的尺寸（width/height/viewBox）算，而不是回落到 100×100。用错尺寸的后果是预览里 SVG 被
 * 拉伸、背景模糊铺在一块跟图形对不上的方框上。
 */
export function resolveLayerContentRect(
  layer: Pick<Layer, 'type' | 'x' | 'y' | 'css_width' | 'css_height' | 'css_code'>,
  css: Record<string, string>,
  deviceW: number,
  deviceH: number,
): { left: number; top: number; w: number; h: number } {
  const rect = resolveLayerRect(layer, css, deviceW, deviceH)
  if (layer.type !== 'svg') return rect
  const intrinsic = resolveSvgIntrinsicSize(layer.css_code || '', deviceW, deviceH)
  const w = cssLengthToPx(css.width, deviceW) ?? layer.css_width ?? intrinsic.w
  const h = cssLengthToPx(css.height, deviceH) ?? layer.css_height ?? intrinsic.h
  if (w === rect.w && h === rect.h) return rect
  // left/top 可能按 right/bottom 反推、也可能带 calc/百分比位移，换尺寸后要重算一次
  return resolveLayerRect({ ...layer, css_width: w, css_height: h }, css, deviceW, deviceH)
}

export function composeLayerFlipTransform(layer: Pick<Layer, 'flip_horizontal' | 'flip_vertical'>, transform?: string): string | undefined {
  const baseTransform = stripTranslateTransform(transform)
  return [
    baseTransform && baseTransform !== 'none' ? baseTransform : '',
    layer.flip_horizontal ? 'scaleX(-1)' : '',
    layer.flip_vertical ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ') || undefined
}

export function resolveLayerPreviewTransform(layer: Layer, css: Record<string, string>): string | undefined {
  return composeLayerFlipTransform(layer, css.transform)
}

export function getLayerBoxStyle(layer: Layer, css: Record<string, string>, deviceW: number, deviceH: number): CSSProperties {
  const rect = resolveLayerContentRect(layer, css, deviceW, deviceH)
  const style = cssToProps(css) as Record<string, unknown>
  // 背景模糊一律交给「同级的毛玻璃 overlay」（预览）和导出侧的软件模糊处理。
  // 留在 wrapper 上会有两个问题：wrapper 常带 clip-path / opacity，自己就成了 Backdrop Root，
  // 模糊源里空无一物；而且 canvas 导出根本复现不了这条 CSS，预览与导出必然对不上。
  delete style.backdropFilter
  delete style.WebkitBackdropFilter
  delete style['backdrop-filter']
  delete style['-webkit-backdrop-filter']
  for (const property of [
    'right', 'bottom', 'inset', 'insetBlock', 'insetInline',
    'insetBlockStart', 'insetBlockEnd', 'insetInlineStart', 'insetInlineEnd',
  ]) delete style[property]
  return {
    // 结构化层级作为默认值；CSS 中显式 z-index 仍可覆盖，行为与管理端预览一致。
    zIndex: layer.z_index ?? 0,
    ...style,
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    transform: resolveLayerPreviewTransform(layer, css),
    transformOrigin: 'center center',
  } as CSSProperties
}

/** CSSOM 可能将 border-radius 展开为四个 longhand，统一还原为 CSS 顺序 tl tr br bl。 */
export function resolveBorderRadius(css: Record<string, string>): string | undefined {
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
export function parseBorderRadius(val: string | undefined): number[] | null {
  if (!val) return null
  const parts = val.trim().split(/\s+/).map(s => parseFloat(s) || 0)
  if (parts.length === 0) return null
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]]
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]]
  return [parts[0], parts[1], parts[2], parts[3]]
}

export function parseObjectPosition(value: string | undefined): { x: number; y: number } {
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

export function resolveUserImageFit(objectFit: string | undefined): string {
  const fit = objectFit?.trim().toLowerCase()
  return !fit || fit === 'fill' ? 'contain' : fit
}

export function getRoundedClipPath(borderRadius: string | undefined): string | undefined {
  return borderRadius ? `inset(0 round ${borderRadius})` : undefined
}

export function resolveImageDrawRect(
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

/** 用户在编辑器里可调的图片滤镜（移动端「效果-图片效果」抽屉）。旧模板没有这组数据，全部按中性值处理。 */
export interface UserImageFx {
  /** 模糊，单位 px，叠加在模板自带模糊之上 */
  blur?: number
  /** 对比度百分比，100 为中性 */
  contrast?: number
  /** 饱和度百分比，100 为中性 */
  saturation?: number
}

/** 「效果-图片效果」里模糊度滑杆的默认上限（px）。模板没写 blur_max 时用它。 */
export const DEFAULT_BLUR_MAX = 50
/** 模糊度上限的合法区间：太低滑杆没有可调空间，太高在手机上又卡，管理端超出的值会被夹回来。 */
export const BLUR_MAX_RANGE = { min: 1, max: 200 } as const

/** 读取模板的模糊度上限：任何缺失/非法值都回落到默认 50。 */
export function resolveBlurMax(template?: { blur_max?: number } | null): number {
  const raw = Number(template?.blur_max)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BLUR_MAX
  return Math.round(Math.min(BLUR_MAX_RANGE.max, Math.max(BLUR_MAX_RANGE.min, raw)))
}

export interface ResolvedImageFx {
  blurPx: number
  contrast: number
  brightness: number
  saturation: number
}

/** 从 CSS filter 字符串里累加 blur() 的像素值；模板作者常用它做磨砂背景。 */
export function parseCssFilterBlur(filter: string | undefined): number {
  if (!filter || filter.trim().toLowerCase() === 'none') return 0
  let total = 0
  for (const match of filter.matchAll(/blur\(\s*([+-]?[\d.]+)(?:px)?\s*\)/gi)) {
    const value = Number.parseFloat(match[1])
    if (Number.isFinite(value) && value > 0) total += value
  }
  return total
}

/** 图层 CSS 里自己声明的背景模糊：`backdrop-filter: blur(Npx)`。
 *  设计稿导出的 CSS、以及手写 CSS 的模板大量用这种写法表达毛玻璃，而不是管理端的「特殊效果」字段。 */
export function resolveCssBackdropBlur(css: Record<string, string>): number {
  return parseCssFilterBlur(
    css['backdrop-filter'] || css['-webkit-backdrop-filter'] || css.backdropFilter || css.WebkitBackdropFilter,
  )
}

/**
 * 背景模糊（毛玻璃）的模糊半径，单位 px。
 *
 * 数据来源有两个，都必须认：管理端「特殊效果」里的 blur_type='backdrop'，以及图层 CSS 里的
 * `backdrop-filter: blur(Npx)`。只认前者时，模板只要把毛玻璃写在 CSS 里（很常见），
 * 预览会因为浏览器直接执行 CSS 而有模糊、导出却没有 —— 也就是「模糊只作用在预览上」。
 * 预览、导出、管理端预览三处都走这里，结果才不会各说各话。
 */
export function resolveBackdropBlurPx(
  layer: Pick<Layer, 'effects'>,
  css: Record<string, string>,
): number {
  const fx = layer.effects
  if (fx?.blur_type === 'backdrop') return Math.max(0, Number(fx.blur_value) || 0)
  return resolveCssBackdropBlur(css)
}

/** SVG 作为图片资源（data URI / CSS mask）加载时必须带 xmlns，
 *  否则浏览器直接判定解码失败：导出的 SVG 图层会整块消失，只剩背景模糊的方框。 */
export function ensureSvgNamespace(svgCode: string): string {
  if (!svgCode) return svgCode
  return svgCode.replace(/<svg\b([^>]*)>/i, (match, attrs: string) =>
    /\sxmlns\s*=/i.test(attrs) ? match : `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>`)
}

/** SVG 源码 → data URI。base64 编码避免 #、% 等字符在 URL 里被截断。 */
export function svgToDataUri(svgCode: string): string | undefined {
  const code = ensureSvgNamespace((svgCode || '').trim())
  if (!/^<svg[\s>]/i.test(code)) return undefined
  try {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(code)))}`
  } catch {
    return undefined
  }
}

/**
 * 只保留 SVG 的「形状」，把画稿自己的不透明度抹掉。
 *
 * 遮罩需要的是图形轮廓，不是画稿的透明度：设计稿导出的 SVG 大量用
 * `fill="white" fill-opacity="0.24"` 这种半透明填充画毛玻璃底板，
 * 直接拿原图当遮罩时遮罩的 alpha 也只有 0.24 —— 模糊结果同样只剩 24% 不透明，
 * 底下没糊的原图透上来，看起来就是「SVG 图层的背景模糊完全没渲染」。
 * 同理，`<g filter="...">` 里的投影（dilation + blur）会把遮罩糊出一圈半透明边，
 * 形状本身才是遮罩该有的样子。所以这里统一插一段样式，把绘制内容的透明度压回 1、
 * 去掉只做装饰的滤镜；fill-rule（evenodd 的镂空）、geometry 全都原样保留。
 *
 * 透明度有两个来源，只压 fill-opacity 是不够的：
 *   1) 呈现属性 / 样式：`fill-opacity`、`stroke-opacity`、`opacity`；
 *   2) 颜色本身带 alpha：`fill="rgba(255,255,255,0.24)"`、`fill="#fff3"`、`stop-color="hsla(...,0.3)"`。
 * 第 2 种在浏览器里同样只给 24% 的遮罩 —— 实测就是这样：图形图层的毛玻璃清清楚楚
 * （裁的是圆角矩形，与透明度无关），同一页里的 SVG 图层却像没糊一样。
 * 所以颜色里的 alpha 必须一起抹掉；只有「全透明」（alpha=0）保持透明，
 * 因为那代表「这块不画东西」（渐变淡出的写法），抹掉反而会糊到没有内容的区域。
 * 渐变自己的 stop-opacity 不动：那是作者在表达「淡出」，保留它更接近画稿意图。
 */
export function forceSvgShapeAlpha(svgCode: string): string {
  const code = (svgCode || '').trim()
  if (!/^<svg[\s>]/i.test(code)) return svgCode

  const opaque = code
    // rgba(255, 255, 255, 0.24) → rgb(255, 255, 255)；alpha 为 0（全透明）时原样保留
    .replace(/\b(rgba|hsla)\(([^()]*)\)/gi, (match, name: string, args: string) => {
      const parts = splitTopLevelCssArgs(args)
      if (parts.length < 4) return match
      const alpha = parseAlpha(parts[3])
      if (alpha !== null && alpha <= 0) return match
      return `${name.toLowerCase() === 'rgba' ? 'rgb' : 'hsl'}(${parts.slice(0, 3).join(', ')})`
    })
    // #RRGGBBAA → #RRGGBB（AA 为 00 的全透明同样保留）
    .replace(/#([0-9a-f]{6})([0-9a-f]{2})\b/gi, (match, rgb: string, alpha: string) =>
      alpha.toLowerCase() === '00' ? match : `#${rgb}`)

  // 用 id 提高优先级：SVG 内部的 `<style>` 常写成 `.cls-1{opacity:.3}`，
  // 单靠 `svg *` 这类选择器会被类选择器的优先级压过去。id 只加在遮罩副本上，不影响图层本身的渲染。
  const withId = opaque.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) =>
    `<svg id="poolux-shape-mask"${attrs.replace(/\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')}>`)
  const style = '<style>#poolux-shape-mask,#poolux-shape-mask *{fill-opacity:1!important;stroke-opacity:1!important;opacity:1!important;filter:none!important;}</style>'
  return /<\/svg>\s*$/i.test(withId) ? withId.replace(/<\/svg>\s*$/i, `${style}</svg>`) : `${withId}${style}`
}

/** CSS 颜色函数的 alpha 分量：无法解析时返回 null（按「不透明」处理）。 */
function parseAlpha(token: string): number | null {
  const value = token.trim().replace('%', '')
  const num = Number.parseFloat(value)
  if (!Number.isFinite(num)) return null
  return token.trim().endsWith('%') ? num / 100 : num
}

/** SVG 形状遮罩的 data URI：预览的 mask-image 与导出的软件遮罩共用同一份，两边才不会走样。 */
export function svgShapeMaskDataUri(svgCode: string): string | undefined {
  return svgToDataUri(forceSvgShapeAlpha(svgCode))
}

/**
 * 用 SVG 自身当遮罩，让背景模糊只落在 SVG 真正画出来的形状上。
 * 没有它的话，模糊会铺满图层方框：圆形/图标图层会凭空多出一块矩形毛玻璃。
 */
export function svgMaskImageUrl(svgCode: string): string | undefined {
  const uri = svgShapeMaskDataUri(svgCode)
  return uri ? `url("${uri}")` : undefined
}

/**
 * 图片图层的「SVG 形状遮罩」样式：管理端上传的 SVG 决定用户图片可见的范围。
 *
 * 尺寸固定铺满图层方框（mask-size: 100% 100%），与 SVG 图层做背景模糊遮罩时同一口径 ——
 * SVG 的 viewBox 正好映射到图层方框上，用户端预览、管理端预览、导出三处才会裁出同一个形状。
 * 遮罩用的是「形状」副本（forceSvgShapeAlpha：忽略画稿自己的半透明填充），镂空（evenodd）原样保留。
 */
export function svgMaskStyle(svgCode: string | undefined): CSSProperties | undefined {
  const url = svgCode ? svgMaskImageUrl(svgCode) : undefined
  if (!url) return undefined
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  }
}

/**
 * 把「模板自带 adjustments / effects / CSS filter」与「用户新调的滤镜」合成一组数值。
 * 预览（CSS filter）与导出（软件像素处理）都走这里，避免两边各算一套导致所见非所得。
 */
export function resolveImageFx(
  layer: Layer,
  userFx?: UserImageFx,
  cssFilter?: string,
  exportScale = 1,
): ResolvedImageFx {
  const adjustments = layer.adjustments
  // 模板自带模糊沿用旧版取最大值的语义，保证存量模板渲染结果不变；用户追加的模糊是叠加。
  const templateBlur = Math.max(
    adjustments?.blur || 0,
    layer.effects?.blur_type === 'gaussian' ? layer.effects.blur_value : 0,
  )
  return {
    blurPx: (templateBlur + parseCssFilterBlur(cssFilter) + Math.max(0, userFx?.blur ?? 0)) * exportScale,
    contrast: (adjustments?.contrast ?? 100) * (Math.max(0, userFx?.contrast ?? 100) / 100),
    // 亮度已从管理端模板创建里下线，但存量模板仍可能带值，这里继续参与渲染。
    brightness: adjustments?.brightness ?? 100,
    saturation: Math.max(0, userFx?.saturation ?? 100),
  }
}

export function isNeutralImageFx(fx: ResolvedImageFx): boolean {
  return fx.blurPx < 0.05
    && Math.abs(fx.contrast - 100) < 0.05
    && Math.abs(fx.brightness - 100) < 0.05
    && Math.abs(fx.saturation - 100) < 0.05
}

const roundFx = (value: number) => Number(value.toFixed(3))

/** 生成预览用的 CSS filter；中性时返回 undefined，避免无谓的合成层。 */
export function buildImageFilterCss(fx: ResolvedImageFx): string | undefined {
  if (isNeutralImageFx(fx)) return undefined
  const parts: string[] = []
  if (fx.blurPx >= 0.05) parts.push(`blur(${roundFx(fx.blurPx)}px)`)
  if (Math.abs(fx.contrast - 100) >= 0.05) parts.push(`contrast(${roundFx(fx.contrast)}%)`)
  if (Math.abs(fx.brightness - 100) >= 0.05) parts.push(`brightness(${roundFx(fx.brightness)}%)`)
  if (Math.abs(fx.saturation - 100) >= 0.05) parts.push(`saturate(${roundFx(fx.saturation)}%)`)
  return parts.join(' ') || undefined
}

export function resolveImageFilter(layer: Layer, exportScale = 1): string | undefined {
  return buildImageFilterCss(resolveImageFx(layer, undefined, undefined, exportScale))
}

/** 导出侧：把图层的 CSS filter 与用户在编辑器里新调的滤镜一并算进去，保证导出与预览所见一致。 */
export function resolveImageFilterForExport(
  layer: Layer,
  cssFilter: string | undefined,
  exportScale = 1,
  userFx?: UserImageFx,
): string | undefined {
  return buildImageFilterCss(resolveImageFx(layer, userFx, cssFilter, exportScale))
}

/**
 * 预览里图片内容最终生效的 CSS filter：模板自带 adjustments/effects + CSS 里的 filter + 用户新调。
 * 导出侧用 resolveImageFx 取同一组数值，两者不会漂移。
 */
export function resolveLayerImageFilterCss(
  layer: Layer,
  css: Record<string, string>,
  userFx?: UserImageFx,
): string | undefined {
  const cssFilter = css['filter'] || css['-webkit-filter']
  return buildImageFilterCss(resolveImageFx(layer, userFx, cssFilter, 1))
}

/** 三次方框卷积逼近高斯：给出每次卷积的半径，使合成核的标准差等于 sigma。
 *  单次方框卷积的频响是 sinc，高对比内容（条纹、硬边）会残留方角与竖条；
 *  连续三次之后与真高斯的偏差 < 3%，观感才和预览里的 blur() / backdrop-filter 对得上。 */
function gaussianBoxRadii(sigma: number, passes = 3): number[] {
  const idealWidth = Math.sqrt((12 * sigma * sigma) / passes + 1)
  let lower = Math.floor(idealWidth)
  // 窗口宽度必须是奇数，半径才是整数
  if (lower % 2 === 0) lower -= 1
  if (lower < 1) lower = 1
  const upper = lower + 2
  const idealCount = (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4)
  const count = Math.round(idealCount)
  const radii: number[] = []
  for (let i = 0; i < passes; i++) radii.push(((i < count ? lower : upper) - 1) / 2)
  return radii
}

/** 半径 radius 的滑动窗口方框卷积：先水平 src→dst，再垂直 dst→src，结果落回 src。
 *  滑动求和与半径无关（每像素固定几次加减），所以半径多大都不会变慢，也就不必再给半径设上限。
 *  中间结果走 Float32Array：旧实现存在 Uint8ClampedArray 里，每趟都要凑整，
 *  大半径下会把缓慢变化的部分压成一块块同色的"台阶"。 */
function boxBlurFloat(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number): void {
  const windowSize = radius * 2 + 1
  const lastX = width - 1
  const lastY = height - 1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0
      for (let x = -radius; x <= radius; x++) {
        sum += src[row + (x < 0 ? 0 : x > lastX ? lastX : x) * 4 + channel]
      }
      for (let x = 0; x < width; x++) {
        dst[row + x * 4 + channel] = sum / windowSize
        const leaving = x - radius
        const entering = x + radius + 1
        sum += src[row + (entering > lastX ? lastX : entering) * 4 + channel]
          - src[row + (leaving < 0 ? 0 : leaving) * 4 + channel]
      }
    }
  }
  const stride = width * 4
  for (let x = 0; x < width; x++) {
    const column = x * 4
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) {
        sum += dst[(y < 0 ? 0 : y > lastY ? lastY : y) * stride + column + channel]
      }
      for (let y = 0; y < height; y++) {
        src[y * stride + column + channel] = sum / windowSize
        const leaving = y - radius
        const entering = y + radius + 1
        sum += dst[(entering > lastY ? lastY : entering) * stride + column + channel]
          - dst[(leaving < 0 ? 0 : leaving) * stride + column + channel]
      }
    }
  }
}

/** 位图缩小时一次画完会在细节上起锯齿：`imageSmoothingQuality='high'` 与
 *  `createImageBitmap` 的 `resizeQuality:'high'` 都是单次重采样，缩小倍数一大就漏采样，
 *  细纹理（织物、噪点、条纹）会留下摩尔纹而不是变成均匀的灰。
 *  实测 2000×2000 缩到 424×424（4.7 倍）：细条纹带的横向标准差 默认(low)=42.6、high=20.6、
 *  createImageBitmap=19.4、逐级折半=0（正确的面积平均）。 */
function isVectorSource(source: CanvasImageSource): boolean {
  if (typeof HTMLImageElement === 'undefined' || !(source instanceof HTMLImageElement)) return false
  return /^data:image\/svg\+xml|\.svg(\?|#|$)/i.test(source.currentSrc || source.src || '')
}

/**
 * 大倍数缩小时先把源逐级折半，再交回给调用方做最后一步绘制。
 *
 * 每一级最多缩一半（等效面积平均），所以细纹理会被真正平均掉，而不是留下锯齿和摩尔纹。
 * 缩小不到 2 倍、或源本来就是矢量（SVG 直接栅格化到目标尺寸最清晰）时原样返回，
 * 不做多余的中间画布。目标尺寸传最终落像素的尺寸（已含导出倍率、用户缩放）。
 */
export function shrinkToHalfLimit(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CanvasImageSource {
  if (typeof document === 'undefined') return source
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(targetWidth > 0) || !(targetHeight > 0)) return source
  if (isVectorSource(source)) return source
  const limitWidth = targetWidth * 2
  const limitHeight = targetHeight * 2
  let current = source
  let width = sourceWidth
  let height = sourceHeight
  while (width > limitWidth && height > limitHeight && width > 1 && height > 1) {
    const halfWidth = Math.max(1, Math.round(width / 2))
    const halfHeight = Math.max(1, Math.round(height / 2))
    const step = document.createElement('canvas')
    step.width = halfWidth
    step.height = halfHeight
    const ctx = step.getContext('2d')
    if (!ctx) return current
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, halfWidth, halfHeight)
    current = step
    width = halfWidth
    height = halfHeight
  }
  return current
}

/** 高斯模糊（软件实现）。
 *  blurPx 与 CSS 的 blur(<length>) 同义：长度就是高斯的标准差，单位是画布像素
 *  （调用方负责乘导出倍率），所以导出的虚实与预览的 filter / backdrop-filter 一致。
 *  Android WebView 的 CanvasRenderingContext2D.filter 会静默失效，
 *  预览（backdrop-filter）与导出的模糊都靠这段软件实现对齐。 */
export function blurImageData(pixels: ImageData, blurPx: number): void {
  const { width, height } = pixels
  // 亚像素级模糊（< 0.4px）肉眼不可见，直接跳过，省掉两次缓冲分配
  if (!(blurPx >= 0.4) || width < 1 || height < 1) return
  // 标准差超过画布尺寸时结果已经是一整块纯色，夹住只是为了避免空转超大窗口
  const sigma = Math.min(blurPx, Math.max(width, height))
  const radii = gaussianBoxRadii(sigma).filter(radius => radius > 0)
  if (!radii.length) return

  const length = width * height * 4
  const source = pixels.data
  const current = new Float32Array(length)
  const scratch = new Float32Array(length)
  // 预乘 alpha：与 CSS filter 的语义一致，透明区域不会把颜色晕到边缘
  for (let i = 0; i < length; i += 4) {
    const alpha = source[i + 3] / 255
    current[i] = source[i] * alpha
    current[i + 1] = source[i + 1] * alpha
    current[i + 2] = source[i + 2] * alpha
    current[i + 3] = source[i + 3]
  }
  for (const radius of radii) boxBlurFloat(current, scratch, width, height, radius)
  for (let i = 0; i < length; i += 4) {
    const alpha = current[i + 3]
    // 反预乘；alpha 为 0 时颜色本身没有意义，保持 0，避免 0/0 产生 NaN
    const gain = alpha > 0.5 ? 255 / alpha : 0
    source[i] = current[i] * gain
    source[i + 1] = current[i + 1] * gain
    source[i + 2] = current[i + 2] * gain
    source[i + 3] = alpha
  }
}

/** 画布降采样近似高斯（不读像素的兜底）。
 *
 *  一次「按 D 倍缩小 + 开平滑放大回去」的等效标准差约等于 D/2，所以倍率按 2σ 取；
 *  中间再插一级尺寸放大，避免一次放得太大留下明显的棱角。
 *  整条路只用 drawImage：跨域内容污染画布、WebView 拒绝 getImageData、内存不足，
 *  甚至 putImageData 静默失效的设备上都能糊，代价是不再是严格的三次方框高斯。 */
function drawDownscaleBlur(
  target: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  width: number,
  height: number,
  blurPx: number,
): void {
  const shrink = Math.max(2, Math.round(blurPx * 2))
  const midFactor = Math.max(1, Math.round(Math.sqrt(shrink)))
  const midWidth = Math.max(1, Math.round(width / midFactor))
  const midHeight = Math.max(1, Math.round(height / midFactor))
  const tinyWidth = Math.max(1, Math.round(width / shrink))
  const tinyHeight = Math.max(1, Math.round(height / shrink))
  const tiny = document.createElement('canvas')
  tiny.width = tinyWidth
  tiny.height = tinyHeight
  const mid = document.createElement('canvas')
  mid.width = midWidth
  mid.height = midHeight
  const tinyCtx = tiny.getContext('2d')
  const midCtx = mid.getContext('2d')
  if (!tinyCtx || !midCtx) return
  for (const target2d of [tinyCtx, midCtx]) {
    target2d.imageSmoothingEnabled = true
    target2d.imageSmoothingQuality = 'high'
  }
  // 先缩到极小（drawImage 缩放本身就是一次盒平均），再两级平滑放大回去
  tinyCtx.drawImage(source, sx, sy, sw, sh, 0, 0, tinyWidth, tinyHeight)
  midCtx.drawImage(tiny, 0, 0, tinyWidth, tinyHeight, 0, 0, midWidth, midHeight)
  // 最后才清空目标画布：source 与 target 常常是同一块画布（原地模糊）
  target.imageSmoothingEnabled = true
  target.imageSmoothingQuality = 'high'
  target.clearRect(0, 0, width, height)
  target.drawImage(mid, 0, 0, midWidth, midHeight, 0, 0, width, height)
}

/** putImageData 是否真的写进了画布。
 *  部分 Android WebView 上 putImageData 会静默失效（画布还是原样），
 *  此时「软件像素处理」整条路都不可信，必须换降采样近似 ——
 *  否则导出结果和「这个图层没有滤镜」一模一样。
 *  抽查三行像素，代价可忽略；内容本来就均匀时抽查必然通过，也不会误判。
 *
 *  半透明像素不能当判据：画布内部按预乘 alpha 存储，alpha=1 的像素往返一次
 *  颜色误差就有 30+（[34,34,34,1] 读回来是 [0,0,0,1]），拿它比对会把「写成功」
 *  误判成「写失败」。而带圆角的机型画布边缘全是这种抗锯齿像素，取样框一旦外扩到
 *  画布边界就必然踩中 —— 于是精确高斯被丢掉、退回粗糙的降采样近似，导出看着并没糊。
 *  所以只在不透明的像素上比对颜色，alpha 通道则一律比对（写失败时它必然对不上）。
 *
 *  分条写回时要只验证刚写进去的那几行，所以带 offsetY/rows 参数。 */
function rowsWrittenBack(ctx: CanvasRenderingContext2D, expected: ImageData, offsetY: number, rows: number): boolean {
  const { width, data } = expected
  if (width < 1 || rows < 1) return true
  try {
    for (const ratio of [0.25, 0.5, 0.75]) {
      const local = Math.min(rows - 1, Math.floor(rows * ratio))
      const y = offsetY + local
      const row = ctx.getImageData(0, y, width, 1).data
      const offset = y * width * 4
      for (let i = 0; i < row.length; i += 4) {
        const alpha = data[offset + i + 3]
        // 允许 1 的误差：不同实现 putImageData 的舍入方向可能不同
        if (Math.abs(row[i + 3] - alpha) > 1) return false
        if (alpha !== 0 && alpha !== 255) continue
        for (let channel = 0; channel < 3; channel++) {
          if (Math.abs(row[i + channel] - data[offset + i + channel]) > 1) return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

/** 分条写回的行数：够小就能绕开「大画布 putImageData 静默失效」的内存阈值，
 *  又不至于把 putImageData 调用次数抬到离谱（1080 行也才 17 次）。 */
const WRITE_BACK_STRIP_ROWS = 64

/** 读回校验用的缩小采样边长：几十个像素的 getImageData 在任何机型上都不会触碰内存阈值。 */
const READBACK_PROXY_MAX = 32
/** 读回平均值与缩小采样平均值允许的偏差。同一块画面求平均，重采样差异只有个位数量级。 */
const READBACK_TOLERANCE = 24
/** 读回来的像素本身完全均匀时（纯色区域），两边的平均值必须几乎一致，容差收紧。 */
const READBACK_UNIFORM_TOLERANCE = 8

/** 读回来的像素是否可信。
 *
 *  部分 Android WebView 在内存吃紧时 getImageData 不抛错、直接返回一片全透明的像素
 *  （有些实现返回纯黑）：这份「空白」写回画布也会「成功」，验证还通过 —— 于是模糊
 *  出来的结果是空白。接着把空白按原坐标画回去（source-over）等于什么都没画，
 *  导出里那一层就只剩 8% 白底，看着「根本没糊」。这种失败按取样区域大小触发，
 *  所以只有画布最大的机型（REDMI Watch 这档）会遇到，小画布机型表现正常。
 *
 *  光看像素本身分辨不出「读回失败」和「这块画面本来就是透明」，所以另找一份独立证据：
 *  把这块画面缩小到几十像素再 getImageData 一次。小区域读回不受内存阈值影响，
 *  拿到的是这块画面的真实平均值；两者对不上就说明第一次读回不可信。
 *  偏差判断同时覆盖「读回全透明」和「读回纯黑」两种表现。 */
function readbackIsTrustworthy(canvas: HTMLCanvasElement, pixels: ImageData): boolean {
  const { width, height, data } = pixels
  if (width < 1 || height < 1) return true
  let red = 0, green = 0, blue = 0, alpha = 0, opaque = false, uniform = true
  const first = data.length >= 4 ? [data[0], data[1], data[2], data[3]] : [0, 0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    red += data[i]; green += data[i + 1]; blue += data[i + 2]; alpha += data[i + 3]
    if (data[i + 3] !== 0) opaque = true
    if (uniform && (data[i] !== first[0] || data[i + 1] !== first[1]
      || data[i + 2] !== first[2] || data[i + 3] !== first[3])) uniform = false
  }
  // 整块全透明：不透明画布上出现这种读回只可能是失败；真是透明区域时，
  // 退回降采样近似的结果同样透明，不会有任何观感差别。
  if (!opaque) return false
  const shrink = Math.min(1, READBACK_PROXY_MAX / Math.max(width, height))
  const proxyWidth = Math.max(1, Math.round(width * shrink))
  const proxyHeight = Math.max(1, Math.round(height * shrink))
  const proxy = document.createElement('canvas')
  proxy.width = proxyWidth
  proxy.height = proxyHeight
  const proxyCtx = proxy.getContext('2d', { willReadFrequently: true }) || proxy.getContext('2d')
  if (!proxyCtx) return true
  try {
    proxyCtx.imageSmoothingEnabled = true
    proxyCtx.imageSmoothingQuality = 'high'
    proxyCtx.drawImage(canvas, 0, 0, width, height, 0, 0, proxyWidth, proxyHeight)
    const sample = proxyCtx.getImageData(0, 0, proxyWidth, proxyHeight).data
    let proxyRed = 0, proxyGreen = 0, proxyBlue = 0, proxyAlpha = 0
    for (let i = 0; i < sample.length; i += 4) {
      proxyRed += sample[i]; proxyGreen += sample[i + 1]; proxyBlue += sample[i + 2]; proxyAlpha += sample[i + 3]
    }
    const count = width * height
    const proxyCount = proxyWidth * proxyHeight
    const tolerance = uniform ? READBACK_UNIFORM_TOLERANCE : READBACK_TOLERANCE
    return Math.abs(red / count - proxyRed / proxyCount) <= tolerance
      && Math.abs(green / count - proxyGreen / proxyCount) <= tolerance
      && Math.abs(blue / count - proxyBlue / proxyCount) <= tolerance
      && Math.abs(alpha / count - proxyAlpha / proxyCount) <= tolerance
  } catch {
    // 连小区域都读不回来：给不出反证，就按读回成功处理（writePixelsBack 还会再验一次）
    return true
  }
}

/** 把一屏像素写回画布。
 *  依次尝试三条路：整块 putImageData → 分条 putImageData → 临时画布 + drawImage。
 *  返回 false 表示这个环境写不进这些像素，调用方应改用降采样近似。
 *
 *  **任何一条路都必须先确认像素真写进去了，才允许碰目标画布。**
 *  旧实现是「清空目标 → 1:1 贴回来 → 验证」，一旦这个环境压根写不进像素
 *  （Android WebView 的 putImageData 在画布较大、内存吃紧时会静默失效），
 *  目标画布已经被清空：接着的降采样兜底只能糊一块空白，背景模糊整块消失 ——
 *  导出结果里那一层就只剩半透明白底（看着"并没糊"），而同一台机器上画布较小的机型
 *  区域没到内存阈值、写回成功，于是表现为"只有 REDMI Watch 这种大画布机型不糊"。
 *  先验证再提交之后，写回失败时目标画布仍是模糊前的画面，降采样兜底一定有东西可糊。
 *
 *  分条写回是为了让「写不回大画布」的机型也拿到精确的高斯结果：条小到能写进去，
 *  而且 putImageData 的 dirty rect 只改那几行，写不进去也不会破坏别处。 */
function writePixelsBack(ctx: CanvasRenderingContext2D, pixels: ImageData, width: number, height: number): boolean {
  try {
    ctx.putImageData(pixels, 0, 0)
    if (rowsWrittenBack(ctx, pixels, 0, height)) return true
  } catch {
    // putImageData 直接抛错（部分实现的内存限制）：下面换分条 / drawImage 再试
  }
  if (height > WRITE_BACK_STRIP_ROWS) {
    let written = true
    for (let y = 0; y < height && written; y += WRITE_BACK_STRIP_ROWS) {
      const rows = Math.min(WRITE_BACK_STRIP_ROWS, height - y)
      try {
        ctx.putImageData(pixels, 0, 0, 0, y, width, rows)
      } catch {
        written = false
        break
      }
      written = rowsWrittenBack(ctx, pixels, y, rows)
    }
    if (written) return true
  }
  try {
    const source = document.createElement('canvas')
    source.width = width
    source.height = height
    const sourceCtx = source.getContext('2d')
    if (!sourceCtx) return false
    sourceCtx.putImageData(pixels, 0, 0)
    // 临时画布也写不进（同一台机器同一套实现）→ 直接放弃，别动目标画布
    if (!rowsWrittenBack(sourceCtx, pixels, 0, height)) return false
    ctx.save()
    // 1:1 贴回来，关掉平滑避免任何重采样
    ctx.imageSmoothingEnabled = false
    // copy：连同 alpha 一起覆盖，避免目标区域残留上一次的像素
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(source, 0, 0, width, height)
    ctx.restore()
  } catch {
    return false
  }
  return rowsWrittenBack(ctx, pixels, 0, height)
}

/** 不读像素的降采样近似模糊（原地）：读回 / 写回任何一环不可信时的共同兜底。 */
function downscaleBlurInPlace(canvas: HTMLCanvasElement, blurPx: number): void {
  if (typeof document === 'undefined' || !(blurPx >= 0.4)) return
  const width = canvas.width
  const height = canvas.height
  if (width < 1 || height < 1) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  drawDownscaleBlur(ctx, canvas, 0, 0, width, height, width, height, blurPx)
}

/** 对整块画布做高斯模糊（原地）。
 *  先用软件高斯保证与预览里的 blur() / backdrop-filter 完全对齐；
 *  读不到像素或写不回像素时退回降采样近似：模糊糙一点可以接受，整块消失不行。 */
export function blurCanvasInPlace(canvas: HTMLCanvasElement, blurPx: number): void {
  if (typeof document === 'undefined' || !(blurPx >= 0.4)) return
  const width = canvas.width
  const height = canvas.height
  if (width < 1 || height < 1) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  let exact = false
  try {
    const pixels = ctx.getImageData(0, 0, width, height)
    if (readbackIsTrustworthy(canvas, pixels)) {
      blurImageData(pixels, blurPx)
      exact = writePixelsBack(ctx, pixels, width, height)
      if (!exact) console.warn('[blur] putImageData 在本次环境未生效，改用降采样近似模糊')
    } else {
      console.warn('[blur] getImageData 读回的像素与画面不符（WebView 静默读回失败），改用降采样近似模糊')
    }
  } catch (error) {
    console.warn('[blur] 读不到画布像素（跨域污染 / WebView 限制），改用降采样近似模糊:', error)
  }
  if (exact) return
  downscaleBlurInPlace(canvas, blurPx)
}

/** 取回主画布上的一块区域并做高斯模糊，返回可直接按原坐标画回去的 canvas。
 *  导出侧「背景模糊（毛玻璃）」用它：读像素失败也不会让模糊整块消失。 */
export function createBlurredRegion(
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  blurPx: number,
  /** 采样底色。背景模糊要糊的是「元素背后已经画好的画面」，而画布圆角外是透明的：
   *  不先铺一层底色的话，模糊会把圆角的透明度一起平均进来（半径越大越明显），
   *  回填时那几层就只剩半透明，下面没糊的画面直接透上来 —— 表现为「导出没有模糊」。 */
  baseColor?: string,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const width = Math.max(1, Math.round(sw))
  const height = Math.max(1, Math.round(sh))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // 下面必然要读一次像素，提前声明可以让浏览器把画布放在 CPU 内存里
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d')
  if (!ctx) return null
  try {
    if (baseColor) {
      ctx.fillStyle = baseColor
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(source, sx, sy, width, height, 0, 0, width, height)
  } catch {
    return null
  }
  blurCanvasInPlace(canvas, blurPx)
  return canvas
}

/* ── 导出的软件滤镜（Android） ──
 *
 * Android WebView 的 CanvasRenderingContext2D.filter 会静默失效，图片滤镜只能在像素上自己做。
 * 做像素处理要有一块离屏画布，这块画布的分辨率直接决定导出图的清晰度，所以：
 *
 *   1) 只处理「真正画得出来」的那块区域。用户在编辑器里放大图片（捏合/滚轮，scale > 1）后，
 *      整张图的落点可能是导出画布的好几倍大，绝大部分都被画布裁掉了；按整框光栅化既浪费内存，
 *      分辨率也摊薄了。
 *   2) 离屏画布的分辨率与导出画布 1:1。早先的实现把图片按「图层方框」大小摊进离屏画布，再由外层
 *      transform 放大到最终尺寸 —— 放大倍数 > 1 时等于把一张小图放大画上去，于是只要调了
 *      对比度 / 饱和度 / 模糊（这些都会走这条软件像素处理的路），导出就比「没调滤镜」时更糊。 */

/** 软件滤镜离屏画布的像素预算（对比度 / 饱和度这类只动 ImageData，4 字节/像素）。 */
const SOFTWARE_FILTER_MAX_PX = 3_000_000
/** 需要软件模糊时的像素预算：三次方框高斯要两份 Float32 缓冲（32 字节/像素），
 *  比单纯的颜色调整贵得多，手机上不收紧就会在「大机型 + 高倍放大」时 OOM。
 *  模糊本身就看不出细节，牺牲一点分辨率换内存是值得的。 */
const SOFTWARE_FILTER_MAX_PX_WITH_BLUR = 1_200_000

/** 图片源自己的像素尺寸：HTMLImageElement 必须用 naturalWidth / naturalHeight。 */
function imageSourceSize(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as {
    naturalWidth?: number; naturalHeight?: number
    videoWidth?: number; videoHeight?: number
    width?: number; height?: number
  }
  return {
    width: Number(candidate.naturalWidth) || Number(candidate.videoWidth) || Number(candidate.width) || 0,
    height: Number(candidate.naturalHeight) || Number(candidate.videoHeight) || Number(candidate.height) || 0,
  }
}

/** 软件滤镜真正要处理的那块区域（方框坐标系），以及方框单位 → 画布像素的比例。
 *
 *  目标上下文可能已经被摆过位置：外层有 translate / rotate / scale，SVG 形状遮罩用的离屏画布
 *  还多一层 translate(-regionX, -regionY)。与其在调用方重复推导这些变换，不如拿当前矩阵的逆
 *  把「画布矩形」反算回方框坐标系，再与方框求交集 —— 落在画布之外的像素根本不会被看到。
 *  矩阵是旋转 + 等比缩放 + 镜像的复合（没有斜切），所以 |行列式| 开方就是缩放倍数。 */
function softwareFilterWindow(
  target: CanvasRenderingContext2D,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; w: number; h: number; unit: number } | null {
  const halfWidth = boxWidth / 2
  const halfHeight = boxHeight / 2
  const full = { x: -halfWidth, y: -halfHeight, w: boxWidth, h: boxHeight }
  // 退化方框（宽或高为 0）什么都画不出来，交给调用方按原样画
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null

  let matrix: DOMMatrix | null = null
  try { matrix = target.getTransform() } catch { matrix = null }
  // 拿不到矩阵（极老的 WebView）：退回「整框 + 1:1」，效果不差于旧实现
  if (!matrix) return { ...full, unit: 1 }

  const det = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return { ...full, unit: 1 }

  const unit = Math.sqrt(Math.abs(det))
  if (!Number.isFinite(unit) || unit <= 0) return { ...full, unit: 1 }

  const inverse = {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
  }
  const translateX = -(inverse.a * matrix.e + inverse.c * matrix.f)
  const translateY = -(inverse.b * matrix.e + inverse.d * matrix.f)
  const canvas = target.canvas
  const corners: [number, number][] = [
    [0, 0],
    [canvas.width, 0],
    [canvas.width, canvas.height],
    [0, canvas.height],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [px, py] of corners) {
    const x = inverse.a * px + inverse.c * py + translateX
    const y = inverse.b * px + inverse.d * py + translateY
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const x = Math.max(-halfWidth, minX)
  const y = Math.max(-halfHeight, minY)
  const right = Math.min(halfWidth, maxX)
  const bottom = Math.min(halfHeight, maxY)
  // 整层都在画布外：没有像素需要处理，交给调用方（它画的也是看不见的东西）
  if (!(right > x) || !(bottom > y)) return null
  return { x, y, w: right - x, h: bottom - y, unit }
}

/**
 * Android 的软件滤镜：对图层图片做模糊 / 对比度 / 亮度 / 饱和度，并直接画到目标上下文。
 *
 * 返回 true 表示已经画完（调用方不要再画）；返回 false 表示这次不需要软件处理
 * （滤镜是中性值，或者环境不支持），调用方照常直接把图片画上去。
 *
 *   image        —— 要画的图片，整张图铺满 boxWidth×boxHeight 的方框（与调用方的 drawImage 一致）
 *   target       —— 已经处于「方框坐标系」的上下文
 *   boxWidth/Height —— 方框尺寸（方框单位）
 *   exportScale  —— 方框单位相对设备像素的倍数（导出倍率，通常 2）
 *
 * 模糊半径按与预览相同的语义取：预览是先对元素做 CSS filter、再被 transform 放大，
 * 所以用户在编辑器里放大图片时，模糊半径在画布上也要跟着放大（半径 = 值 × exportScale × 缩放倍数）。
 */
export function drawSoftwareFilteredImage(
  target: CanvasRenderingContext2D,
  image: CanvasImageSource,
  boxWidth: number,
  boxHeight: number,
  layer: Layer,
  exportScale: number,
  userFx?: UserImageFx,
  cssFilter?: string,
): boolean {
  if (typeof document === 'undefined') return false
  const window = softwareFilterWindow(target, boxWidth, boxHeight)
  if (!window) return false

  // 方框单位 → 画布像素：矩阵已经把「用户捏合倍数 / 模板 adjustments.scale」包含在内
  const blurScale = exportScale * window.unit
  const fx = resolveImageFx(layer, userFx, cssFilter, blurScale)
  const { blurPx: blurValue, contrast, brightness, saturation } = fx
  if (isNeutralImageFx(fx)) return false

  const sourceSize = imageSourceSize(image)
  if (!(sourceSize.width > 0) || !(sourceSize.height > 0)) return false

  // 与画布 1:1 的目标尺寸，再按预算收紧（超预算时只能退一点分辨率，换取不 OOM）
  const wantedWidth = Math.max(1, window.w * window.unit)
  const wantedHeight = Math.max(1, window.h * window.unit)
  const budget = blurValue >= 0.4 ? SOFTWARE_FILTER_MAX_PX_WITH_BLUR : SOFTWARE_FILTER_MAX_PX
  const shrink = Math.min(1, Math.sqrt(budget / (wantedWidth * wantedHeight)))
  const width = Math.max(1, Math.round(wantedWidth * shrink))
  const height = Math.max(1, Math.round(wantedHeight * shrink))
  // 预算里的分辨率同样要反映到模糊半径上，缩放后的模糊才和预览一致
  const blurRadius = blurValue * shrink

  // 只取源图里对应这块可见区域的部分：方框坐标 → 源图像素
  const sourceX = ((window.x + boxWidth / 2) / boxWidth) * sourceSize.width
  const sourceY = ((window.y + boxHeight / 2) / boxHeight) * sourceSize.height
  const sourceWidth = (window.w / boxWidth) * sourceSize.width
  const sourceHeight = (window.h / boxHeight) * sourceSize.height
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return false

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d')
  if (!ctx) return false
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  try {
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  } catch {
    return false
  }

  const paint = () => {
    target.imageSmoothingEnabled = true
    target.imageSmoothingQuality = 'high'
    target.drawImage(canvas, window.x, window.y, window.w, window.h)
  }

  let pixels: ImageData | null = null
  try {
    pixels = ctx.getImageData(0, 0, width, height)
  } catch {
    pixels = null
  }

  if (!pixels || !readbackIsTrustworthy(canvas, pixels)) {
    // 读不到像素（画布被跨域内容污染 / WebView 限制 / 内存不足），
    // 或读回来的是一片空白（WebView 静默读回失败，写回画布会把图层整层抹掉）：
    // 对比度、亮度、饱和度只能放弃，但模糊必须留下 —— 以前这里直接返回原图，
    // 导出的图层看起来和「没调过滤镜」一模一样。降采样近似不读像素，任何设备都能糊。
    if (pixels) console.warn('[blur] getImageData 读回的像素与画面不符（WebView 静默读回失败），图层滤镜退回降采样近似模糊')
    if (blurRadius > 0) downscaleBlurInPlace(canvas, blurRadius)
    paint()
    return true
  }

  // 三次方框卷积逼近高斯（sigma 与 CSS blur 一致），避免 Android Canvas filter 的兼容性问题。
  if (blurRadius > 0) blurImageData(pixels, blurRadius)

  if (contrast !== 100 || brightness !== 100) {
    const contrastFactor = contrast / 100
    const brightnessFactor = brightness / 100
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        pixels.data[i + channel] = Math.max(0, Math.min(255,
          ((pixels.data[i + channel] - 128) * contrastFactor + 128) * brightnessFactor,
        ))
      }
    }
  }

  // 饱和度：按 CSS filter saturate() 的亮度权重向灰度插值，与浏览器结果对齐。
  if (saturation !== 100) {
    const saturationFactor = saturation / 100
    for (let i = 0; i < pixels.data.length; i += 4) {
      const red = pixels.data[i]
      const green = pixels.data[i + 1]
      const blue = pixels.data[i + 2]
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      pixels.data[i] = Math.max(0, Math.min(255, luminance + (red - luminance) * saturationFactor))
      pixels.data[i + 1] = Math.max(0, Math.min(255, luminance + (green - luminance) * saturationFactor))
      pixels.data[i + 2] = Math.max(0, Math.min(255, luminance + (blue - luminance) * saturationFactor))
    }
  }
  if (!writePixelsBack(ctx, pixels, width, height)) {
    // putImageData 和 drawImage 两条路都写不回画布（部分 WebView 合成异常）：像素处理这条路整条不可信。
    // 重画原图丢掉半写入的结果，再用降采样近似把模糊保住；颜色调整只能放弃。
    console.warn('[blur] putImageData 在本次环境未生效，图层滤镜退回降采样近似模糊')
    ctx.clearRect(0, 0, width, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
    if (blurRadius > 0) blurCanvasInPlace(canvas, blurRadius)
  }
  paint()
  return true
}

export interface ParsedBoxShadow {
  inset: boolean
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: string
}

export function parseBoxShadow(value: string | undefined): ParsedBoxShadow | null {
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
export function parseClipPathToPoints(val: string, w: number, h: number): number[][] | null {
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
export function pointsToSvgAttr(pts: number[][]): string {
  return pts.map(p => `${p[0]},${p[1]}`).join(' ')
}

/** 在 canvas 上绘制 clip-path 多边形并填充 */
export function fillClipPath(ctx: CanvasRenderingContext2D, pts: number[][]) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
}

/** 检查 CSS 中是否含有 clip-path（含 -webkit- 前缀） */
export function getClipPath(css: Record<string, string>): string | null {
  return css['-webkit-clip-path'] || css['clip-path'] || null
}

export function cssToProps(css: Record<string, string>): CSSProperties {
  const style: Record<string, any> = {}
  for (const [key, val] of Object.entries(css)) {
    if (key === 'display' || key === 'position' || key === 'float' || key === 'clear') continue
    style[toReactKey(key)] = val
  }
  style.position = 'absolute'
  return style as CSSProperties
}

/** 仅在 CSS 函数最外层拆分参数，避免 rgba()/calc() 内部逗号破坏渐变色标。 */
export function splitTopLevelCssArgs(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

export function parseGradientStop(value: string): { color: string; offset?: number } {
  let depth = 0
  let quote = ''
  let splitAt = -1
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (/\s/.test(char) && depth === 0) splitAt = index
  }

  if (splitAt >= 0) {
    const offsetText = value.slice(splitAt).trim()
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(offsetText)) {
      return {
        color: value.slice(0, splitAt).trim(),
        offset: Math.min(1, Math.max(0, Number.parseFloat(offsetText) / 100)),
      }
    }
  }
  return { color: value.trim() }
}

export function resolveGradientOffsets(stops: { color: string; offset?: number }[]) {
  const resolved = stops.map(stop => ({ ...stop }))
  if (resolved.length === 0) return resolved as { color: string; offset: number }[]
  resolved[0].offset ??= 0
  resolved[resolved.length - 1].offset ??= 1

  let anchor = 0
  while (anchor < resolved.length - 1) {
    let next = anchor + 1
    while (next < resolved.length && resolved[next].offset == null) next++
    const startOffset = resolved[anchor].offset ?? 0
    const endOffset = resolved[next]?.offset ?? startOffset
    const distance = next - anchor
    for (let index = anchor + 1; index < next; index++) {
      resolved[index].offset = startOffset + (endOffset - startOffset) * ((index - anchor) / distance)
    }
    anchor = next
  }
  return resolved as { color: string; offset: number }[]
}

export function gradientAngleToDegrees(value: string): number | null {
  const normalized = value.trim().toLowerCase()
  const numeric = Number.parseFloat(normalized)
  if (normalized.endsWith('deg') && Number.isFinite(numeric)) return numeric
  if (normalized.endsWith('turn') && Number.isFinite(numeric)) return numeric * 360
  if (normalized.endsWith('rad') && Number.isFinite(numeric)) return numeric * 180 / Math.PI
  const directions: Record<string, number> = {
    'to top': 0,
    'to top right': 45,
    'to right top': 45,
    'to right': 90,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom': 180,
    'to bottom left': 225,
    'to left bottom': 225,
    'to left': 270,
    'to top left': 315,
    'to left top': 315,
  }
  return directions[normalized] ?? null
}

export function recolorLinearGradient(value: string, color: string): string | null {
  const gradientMatch = value.trim().match(/^linear-gradient\(([\s\S]*)\)$/i)
  const colorMatch = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!gradientMatch || !colorMatch) return null

  const hex = colorMatch[1].length === 3
    ? colorMatch[1].split('').map(char => char + char).join('')
    : colorMatch[1]
  const [red, green, blue] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const args = splitTopLevelCssArgs(gradientMatch[1])
  if (args.length < 2) return null

  const hasDirection = gradientAngleToDegrees(args[0]) != null
  const stopArgs = hasDirection ? args.slice(1) : args
  const recoloredStops = stopArgs.map(stopArg => {
    const stop = parseGradientStop(stopArg)
    const normalizedColor = stop.color.trim().toLowerCase()
    let alpha = normalizedColor === 'transparent' ? 0 : 1
    const rgbaMatch = normalizedColor.match(/^rgba?\(\s*[+-]?[\d.]+(?:%?)\s*[, ]\s*[+-]?[\d.]+(?:%?)\s*[, ]\s*[+-]?[\d.]+(?:%?)(?:\s*[,/]\s*([+-]?[\d.]+%?))?\s*\)$/i)
    if (rgbaMatch?.[1]) {
      alpha = rgbaMatch[1].endsWith('%')
        ? Number.parseFloat(rgbaMatch[1]) / 100
        : Number.parseFloat(rgbaMatch[1])
    } else {
      const hexAlphaMatch = normalizedColor.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i)
      if (hexAlphaMatch) alpha = Number.parseInt(hexAlphaMatch[1], 16) / 255
    }
    const offset = stop.offset == null ? '' : ` ${Number((stop.offset * 100).toFixed(4))}%`
    return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, alpha))})${offset}`
  })

  return `linear-gradient(${hasDirection ? `${args[0]}, ` : ''}${recoloredStops.join(', ')})`
}

export function isVisibleCssPaint(value: string | undefined): boolean {
  const paint = value?.trim().toLowerCase()
  if (!paint || paint === 'none' || paint === 'transparent' || paint === 'rgba(0, 0, 0, 0)' || paint === 'rgba(0,0,0,0)') return false
  const rgba = paint.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+%?)\s*\)$/)
  if (rgba) {
    const alpha = rgba[1].endsWith('%') ? Number.parseFloat(rgba[1]) / 100 : Number.parseFloat(rgba[1])
    if (Number.isFinite(alpha) && alpha <= 0) return false
  }
  return true
}

export function resolveBoxPaintPolicy(layer: Layer, css: Record<string, string>) {
  const rawProps = { ...getRawCssProps(layer.css_code || ''), ...getRawCssProps(layer.css_position_code || '') }
  const background = rawProps['background-image']
    || rawProps.background
    || rawProps['background-color']
    || css['background-image']
    || css.background
    || css['background-color']
    || css.backgroundColor
    || ''
  const borderWidth = Number.parseFloat(
    rawProps['border-width']
    || rawProps['border-top-width']
    || css.borderWidth
    || css.borderTopWidth
    || css['border-top-width']
    || '',
  )
  const hasBorder = Boolean(
    (rawProps.border && rawProps.border !== 'none')
    || (Number.isFinite(borderWidth) && borderWidth > 0),
  )
  return { rawProps, background, hasFill: isVisibleCssPaint(background), hasBorder }
}

export function applyPickedColorToBoxStyle(
  style: CSSProperties,
  gradient: string,
  color: string | undefined,
  policy: { hasFill: boolean; hasBorder: boolean },
) {
  if (!color) return
  const recoloredGradient = policy.hasFill && gradient.includes('gradient(')
    ? recolorLinearGradient(gradient, color)
    : null
  if (recoloredGradient) {
    style.background = recoloredGradient
    style.backgroundImage = recoloredGradient
    return
  }
  if (policy.hasFill) style.backgroundColor = color
  else if (policy.hasBorder) style.borderColor = color
}

export function createCanvasLinearGradient(
  ctx: CanvasRenderingContext2D,
  value: string,
  box: { left: number; top: number; width: number; height: number },
): CanvasGradient | null {
  const match = value.trim().match(/^linear-gradient\(([\s\S]*)\)$/i)
  if (!match) return null
  const args = splitTopLevelCssArgs(match[1])
  if (args.length < 2) return null

  const parsedAngle = gradientAngleToDegrees(args[0])
  const angle = parsedAngle ?? 180
  const stopArgs = parsedAngle == null ? args : args.slice(1)
  const stops = resolveGradientOffsets(stopArgs.map(parseGradientStop))
  if (stops.length < 2 || stops.some(stop => !stop.color)) return null

  const angleRad = (angle - 90) * Math.PI / 180
  const centerX = box.left + box.width / 2
  const centerY = box.top + box.height / 2
  const halfProjection = (Math.abs(box.width * Math.cos(angleRad)) + Math.abs(box.height * Math.sin(angleRad))) / 2
  const x1 = centerX - Math.cos(angleRad) * halfProjection
  const y1 = centerY - Math.sin(angleRad) * halfProjection
  const x2 = centerX + Math.cos(angleRad) * halfProjection
  const y2 = centerY + Math.sin(angleRad) * halfProjection
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2)

  try {
    stops.forEach(stop => gradient.addColorStop(stop.offset, stop.color))
    return gradient
  } catch {
    return null
  }
}

/** 能承载「用户上传图片」的图层类型（与服务端 allow_user_upload 的语义一致）。 */
export function isUserImageLayer(layer: Pick<Layer, 'type' | 'allow_user_upload'>): boolean {
  return (layer.type === 'image' || layer.type === 'svg' || layer.type === 'shape') && Boolean(layer.allow_user_upload)
}

/**
 * 同组（共用一张用户上传图）图层的操作入口。
 *
 * 管理端把「多图层同图」的图层写成同一个 group_id：这些图层显示同一张用户图片、一起位移，
 * 但各自可以有独立的形状/滤镜。用户端只让组内最上面那层接受拖动与上传点击，
 * 其余成员把指针操作转交给它 —— 否则用户会选中被压在下层、根本看不见的那张图。
 *
 * 返回 Map<图层下标, 组内最顶层下标>；未成组（或组里只有一张可上传图）的图层不会出现在表里。
 */
export function resolveGroupAnchors(layers: Layer[]): Map<number, number> {
  const topByGroup = new Map<string, { idx: number; z: number }>()
  layers.forEach((layer, idx) => {
    const groupId = layer.group_id?.trim()
    if (!groupId || !isUserImageLayer(layer)) return
    const z = layer.z_index ?? 0
    const current = topByGroup.get(groupId)
    // z 相同时取下标更大的那个：渲染按 z_index 排序，同 z 时后者画在上面
    if (!current || z >= current.z) topByGroup.set(groupId, { idx, z })
  })
  const anchors = new Map<number, number>()
  layers.forEach((layer, idx) => {
    const groupId = layer.group_id?.trim()
    if (!groupId || !isUserImageLayer(layer)) return
    const top = topByGroup.get(groupId)
    if (top) anchors.set(idx, top.idx)
  })
  return anchors
}

export function migrateLayer(l: any, i: number): Layer {
  const toBoolean = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true'
  const migrated = {
    ...l,
    show_on_client: l.show_on_client ?? true,
    flip_horizontal: toBoolean(l.flip_horizontal),
    flip_vertical: toBoolean(l.flip_vertical),
  }
  if (l.css_shape && !l.css_code) {
    return { ...migrated, css_code: `clip-path: ${l.css_shape}`, type: l.type || 'color', z_index: l.z_index ?? i, css_shape: undefined }
  }
  return { ...migrated, css_code: l.css_code || '', type: l.type || 'color', z_index: l.z_index ?? i }
}

/** 服务端数组按“最上层 → 最下层”保存；加载时重建层级以修复旧数据中的重复 z_index。 */
export function migrateLayers(layers: any[]): Layer[] {
  return layers.map((layer, index) => ({
    ...migrateLayer(layer, index),
    z_index: layers.length - 1 - index,
  }))
}

export function migrateTemplate(t: any): Template {
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
        layers: migrateLayers(oldLayers),
      })),
    }
  }
  return {
    ...t,
    preview_image: t.preview_image || '',
    devices: t.devices.map((d: any) => ({
      ...d,
      width: d.width || 212, height: d.height || 520, corner_radius: d.corner_radius || 48, background: d.background || '#FFFFFF',
      layers: Array.isArray(d.layers) ? migrateLayers(d.layers) : [],
    })),
  }
}

export function useDeviceRecordState<T>(deviceIdx: number) {
  const [recordsByDevice, setRecordsByDevice] = useState<Record<number, Record<number, T>>>({})
  const current = recordsByDevice[deviceIdx] || {}
  const setCurrent = useCallback((update: SetStateAction<Record<number, T>>) => {
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

/* ── 文字对齐 ── */

export type HorizontalTextAlign = 'left' | 'center' | 'right'
export type VerticalTextAlign = 'top' | 'middle' | 'bottom'

/** 用户在编辑器里手动指定的文字对齐；只在会话内生效，不写回模板数据。 */
export interface TextAlignOverride {
  h?: HorizontalTextAlign
  v?: VerticalTextAlign
}

/**
 * resolveTextStyle 会优先采用 CSS 里解析出的对齐方式，因此用户手选的对齐必须在其之上覆盖。
 * 当原本没有显式宽度、却要居中/右对齐时，退回整块画布宽度，否则对齐没有参照物。
 */
export function resolveTextStyleWithOverride(
  layer: Layer,
  deviceWidth: number,
  deviceHeight: number,
  override?: TextAlignOverride,
): ReturnType<typeof resolveTextStyle> {
  const base = resolveTextStyle(layer, deviceWidth, deviceHeight)
  if (!override || (!override.h && !override.v)) return base
  const textAlign = override.h ?? base.textAlign
  const verticalAlign = override.v ?? base.verticalAlign
  if (textAlign === base.textAlign && verticalAlign === base.verticalAlign) return base

  let { width, left, visualLeft } = base
  if ((textAlign === 'center' || textAlign === 'right') && width == null) {
    width = deviceWidth
    visualLeft -= left
    left = 0
  }
  return { ...base, textAlign, verticalAlign, width, left, visualLeft }
}

/* ── 字体加载 ── */

/**
 * 把模板文字用到的字体逐个注册到浏览器（FontFace API）。
 * 导出前必须等这里完成，否则 Canvas 会退回默认字体，导出与预览不一致。
 */
export function useTemplateFonts(template: Template | null) {
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
}

/* ── 设备判定 ── */

/**
 * 新版移动端编辑器（手机版式 + 桌面版式）现在覆盖全部机型：
 * 只要模板里有设备就走新版界面，不再按「是否手环 Pro」区分。
 * isProBandDevice 保留给「手环 Pro 画布」这类与界面无关的判定使用。
 */
export function isProBandDevice(device: Pick<DeviceConfig, 'name' | 'width' | 'height'> | undefined): boolean {
  if (!device) return false
  if (/pro/i.test(device.name)) return true
  return device.width === 336 && device.height === 480
}

export function shouldUseProEditor(template: Template | null): boolean {
  return Boolean(template && template.devices.length > 0)
}

/** 手环 Pro 画布尺寸，作为新版编辑器的默认尺寸兜底。 */
export const PRO_BAND_SIZE = { width: 336, height: 480, cornerRadius: 48 } as const

