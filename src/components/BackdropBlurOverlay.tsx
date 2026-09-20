import type { CSSProperties } from 'react'

/**
 * 背景模糊层（毛玻璃）—— 用户端预览、管理端预览共用同一份实现。
 *
 * 它必须是图层 wrapper 的「兄弟节点」，不能嵌在 wrapper 里面：
 * backdrop-filter 的模糊对象是「最近的 Backdrop Root 中、本元素下方已经画好的内容」，
 * 而带 clip-path / opacity<1 / filter 的元素自己就是一个 Backdrop Root —— 嵌在那种 wrapper 里时，
 * 模糊源里空空如也，效果直接消失（实测 Chrome：只留下一层半透明白）。
 * 图层 wrapper 恰恰常带这几样（圆角裁剪用 clip-path、用户调了透明度、模板 CSS 里有 filter），
 * 所以「部分图层的背景模糊渲染不出来」。放到 wrapper 外面，Backdrop Root 回到设备画布，
 * 下方所有图层都在模糊范围里。
 *
 * 位置/尺寸/裁剪/变换全部沿用图层 wrapper 自己的那份，视觉范围因此完全对齐。
 */
/**
 * 毛玻璃 overlay 的圆角。
 *
 * 不能直接读 `box.borderRadius`：模板 CSS 几乎都写 `border-radius: 31px`，
 * 而浏览器的 CSSOM 会把它展开成四个 longhand（border-top-left-radius …），
 * `cssToProps` 转出来的是 `borderTopLeftRadius` 这一组，压根没有 `borderRadius` 这个键。
 * 只认简写的话，图层自己的内容按四个 longhand 渲染成了圆角矩形，
 * 毛玻璃却铺满整个图层方框 —— 也就是「代码里是圆角矩形，预览里糊了一整块方形」。
 */
export function overlayBorderRadius(box: CSSProperties): string | undefined {
  if (typeof box.borderRadius === 'string' && box.borderRadius) return box.borderRadius
  const corners = [box.borderTopLeftRadius, box.borderTopRightRadius, box.borderBottomRightRadius, box.borderBottomLeftRadius]
  if (corners.every(value => value == null || value === '')) return undefined
  return corners.map(value => (value == null || value === '' ? '0' : String(value))).join(' ')
}

/** clip-path 可能来自 `clip-path` 或 `-webkit-clip-path`，后者被 cssToProps 转成 `WebkitClipPath`。 */
export function overlayClipPath(box: CSSProperties): string | undefined {
  const clip = box.clipPath ?? (box as Record<string, unknown>).WebkitClipPath
  return typeof clip === 'string' && clip && clip !== 'none' ? clip : undefined
}

/**
 * 用圆角再生成一份 clip-path: inset(0 round …)。
 *
 * 不能只靠 overlay 自己的 border-radius 去裁 backdrop-filter：border-radius 会不会裁到模糊结果，
 * 各浏览器/WebView 版本并不一致（旧内核里模糊会溢出圆角，铺满整个图层方框 ——
 * 「代码里是圆角矩形，预览里糊了一整块方形」就是这么来的），而 clip-path 一定会裁掉模糊结果。
 * 图层自己写了 clip-path 时以它为准；只在没有 clip-path 时才用圆角生成。
 */
export function roundedInsetClipPath(box: CSSProperties): string | undefined {
  const radius = overlayBorderRadius(box)
  return radius ? `inset(0 round ${radius})` : undefined
}

export function backdropOverlayStyle(box: CSSProperties): CSSProperties {
  const borderRadius = overlayBorderRadius(box)
  // 图层自己的 clip-path 优先（多边形等），否则把圆角转成 clip-path 兜底
  const clipPath = overlayClipPath(box) ?? roundedInsetClipPath(box)
  return {
    position: 'absolute',
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    zIndex: box.zIndex,
    transform: box.transform,
    transformOrigin: 'center center',
    borderRadius,
    clipPath,
    WebkitClipPath: clipPath,
  }
}

export function BackdropBlurOverlay({ box, blurPx, supported, maskUrl }: {
  box: CSSProperties
  blurPx: number
  supported: boolean
  /** svg 图层专用：用 SVG 自身当遮罩，模糊只落在图形真正画出来的形状上 */
  maskUrl?: string
}) {
  const overlayStyle = backdropOverlayStyle(box)
  return (
    <div
      aria-hidden="true"
      style={{
        ...overlayStyle,
        // Android/HyperOS 必须完全省略 backdrop-filter；仅改变背景色仍会触发黑色 GPU 纹理。
        ...(supported ? { backdropFilter: `blur(${blurPx}px)`, WebkitBackdropFilter: `blur(${blurPx}px)` } : {}),
        // mask 同时作用于 backdrop-filter 的结果和这层背景色，与管理端预览、导出侧的口径一致
        ...(maskUrl ? {
          maskImage: maskUrl,
          WebkitMaskImage: maskUrl,
          maskSize: '100% 100%',
          WebkitMaskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        } : {}),
        background: supported ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.22)',
        pointerEvents: 'none',
      }}
    />
  )
}
