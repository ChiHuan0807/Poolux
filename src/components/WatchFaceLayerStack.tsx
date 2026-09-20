import { Fragment, useMemo, type CSSProperties, type MouseEvent, type TouchEvent } from 'react'
import { textStrokeLineWidth } from '@/lib/templateTextStyle'
import { BackdropBlurOverlay } from '@/components/BackdropBlurOverlay'
import {
  applyPickedColorToBoxStyle,
  applySvgColor,
  composeLayerFlipTransform,
  cssToProps,
  fitSvgToContainer,
  getClipPath,
  getLayerBoxStyle,
  getLayerCss,
  getRoundedClipPath,
  getRawCssProps,
  parseClipPathToPoints,
  pointsToSvgAttr,
  resolveBorderRadius,
  resolveBoxPaintPolicy,
  resolveLayerImageFilterCss,
  resolveLayerRect,
  resolveTextStyleWithOverride,
  resolveUserImageFit,
  resolveImageDrawRect,
  resolveLayerPreviewTransform,
  resolveGroupAnchors,
  resolveBackdropBlurPx,
  svgMaskImageUrl,
  svgMaskStyle,
  type DeviceConfig,
  type DragMode,
  type Layer,
  type LayerState,
  type TextAlignOverride,
  type UserImageFx,
} from '@/lib/watchFaceKit'

export interface WatchFaceLayerStackProps {
  device: DeviceConfig
  /** 已按 z_index 排好序的图层（底层在前） */
  sortedLayers: { layer: Layer; realIdx: number }[]
  previewScale: number
  layerStates: Record<number, LayerState>
  pickedColor: Record<number, string>
  editedTexts: Record<number, string>
  /** 用户在「效果-图片效果」里新调的滤镜，按图层下标存放 */
  imageFx?: Record<number, UserImageFx>
  /** 用户在「效果-文字编辑」里手选的对齐方式，按图层下标存放 */
  textAlignOverrides?: Record<number, TextAlignOverride>
  backdropFilterOk: boolean
  dragMode: DragMode | null
  activeLayerIdx: number | null
  onActivateLayer: (realIdx: number) => void
  onLayerMouseDown: (realIdx: number, e: MouseEvent) => void
  onLayerTouchStart: (realIdx: number, e: TouchEvent) => void
  onRequestUpload: (realIdx: number) => void
  onSelectText: (realIdx: number) => void
}

/**
 * 背景模糊层（毛玻璃）与导出、管理端预览共用同一份实现：
 * 必须是图层 wrapper 的兄弟节点，且裁剪范围要与图层内容完全一致。
 * 见 `@/components/BackdropBlurOverlay`。
 */

/**
 * 设备坐标系下的图层栈渲染。旧版编辑器与新版移动端编辑器共用，
 * 保证同一份模板（含历史存量数据）在两种界面里看到的画面完全一致。
 */
export function WatchFaceLayerStack({
  device,
  sortedLayers,
  previewScale,
  layerStates,
  pickedColor,
  editedTexts,
  imageFx,
  textAlignOverrides,
  backdropFilterOk,
  dragMode,
  activeLayerIdx,
  onActivateLayer,
  onLayerMouseDown,
  onLayerTouchStart,
  onRequestUpload,
  onSelectText,
}: WatchFaceLayerStackProps) {
  /** 同组图层 → 组内最顶层（唯一操作入口）的下标；未成组的图层不在表里 */
  const groupAnchors = useMemo(() => resolveGroupAnchors(device.layers), [device.layers])
  return (
                              <div style={{ width: device.width, height: device.height, transform: `scale(${previewScale})`, transformOrigin: 'top left', position: 'relative', willChange: 'transform' }}>
                                {sortedLayers.map(({ layer, realIdx }, sortIdx) => {
                                  const isInteractive = (layer.type === 'image' || layer.type === 'svg' || layer.type === 'shape')
                                    && layer.allow_user_upload
                                  const state = layerStates[realIdx]
                                  const css = getLayerCss(layer)
                                  // 背景模糊效果（文字图层同样支持：管理端的「特殊效果」是所有图层通用的）
                                  const fx = layer.effects
                                  // 管理端「特殊效果」与图层 CSS 里的 backdrop-filter 都要认，
                                  // 否则「毛玻璃写在 CSS 里」的模板会出现预览有、导出没有
                                  const backdropBlur = resolveBackdropBlurPx(layer, css)
                                  const fxOpacity = fx && fx.opacity < 100 ? fx.opacity / 100 : undefined
                                  if (!isInteractive) {
                                    // ── 非交互图层：SVG / Shape / Color / Static Image ──
                                    if (layer.type === 'svg') {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      const svgColor = layer.color_mode === 'picker' ? pickedColor[realIdx] : layer.color
                                      const svgBoxShadow = css['box-shadow'] || css['boxShadow']
                                      const svgSource = layer.color_mode === 'picker'
                                        ? applySvgColor(layer.css_code || '', svgColor)
                                        : layer.css_code || ''
                                      const renderedSvg = fitSvgToContainer(svgSource)
                                      return (
                                        <Fragment key={sortIdx}>
                                          {backdropBlur > 0 && (
                                            <BackdropBlurOverlay
                                              box={style}
                                              blurPx={backdropBlur}
                                              supported={backdropFilterOk}
                                              maskUrl={svgMaskImageUrl(svgSource)}
                                            />
                                          )}
                                          <div style={{ ...style, overflow: 'hidden', color: svgColor, ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}), boxShadow: svgBoxShadow, pointerEvents: 'none', transform: resolveLayerPreviewTransform(layer, css), transformOrigin: 'center center' }}>
                                            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: renderedSvg }} />
                                          </div>
                                        </Fragment>
                                      )
                                    }
                                    if (layer.type === 'shape') {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      // 原始 CSS 兜底：绕过 CSSOM 浏览器差异，确保渐变和边框一定出现
                                      const paintPolicy = resolveBoxPaintPolicy(layer, css)
                                      const rawShapeProps = paintPolicy.rawProps
                                      const rawGradient = rawShapeProps['background'] || rawShapeProps['background-image'] || ''
                                      if (rawGradient && rawGradient !== 'none' && /gradient\(/.test(rawGradient) && !(style as any).backgroundImage && !(style as any).background) {
                                        (style as any).backgroundImage = rawGradient
                                      }
                                      const rawBorderVal = rawShapeProps['border'] || ''
                                      if (rawBorderVal && rawBorderVal !== 'none' && !style.border && !style.borderTopWidth) {
                                        style.border = rawBorderVal
                                      }
                                      if (layer.color_mode === 'picker') {
                                        const gradient = String(style.backgroundImage || style.background || rawGradient || css['background-image'] || css.background || '')
                                        applyPickedColorToBoxStyle(style, gradient, pickedColor[realIdx], paintPolicy)
                                      } else if (layer.color && !paintPolicy.hasFill && paintPolicy.hasBorder && CSS.supports('color', layer.color)) {
                                        style.borderColor = layer.color
                                      }
                                      return (
                                        <Fragment key={sortIdx}>
                                          {backdropBlur > 0 && <BackdropBlurOverlay box={style} blurPx={backdropBlur} supported={backdropFilterOk} />}
                                          <div style={{ ...style, ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}), pointerEvents: 'none', transform: resolveLayerPreviewTransform(layer, css), transformOrigin: 'center center' }} />
                                        </Fragment>
                                      )
                                    }
                                    if (layer.type === 'text') {
                                      const displayText = editedTexts[realIdx] ?? layer.text_content ?? ''
                                      const textStyle = resolveTextStyleWithOverride(layer, device.width, device.height, textAlignOverrides?.[realIdx])
                                      const justifyContent = textStyle.verticalAlign === 'middle' ? 'center' : textStyle.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'
                                      const textBoxStyle: React.CSSProperties = {
                                        ...textStyle.explicitStyle,
                                        // 背景模糊交给 overlay 层（导出侧同样只在那里实现）
                                        backdropFilter: undefined,
                                        WebkitBackdropFilter: undefined,
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
                                        color: layer.color_mode === 'picker' && pickedColor[realIdx] ? pickedColor[realIdx] : textStyle.color,
                                        WebkitTextStrokeWidth: textStyle.textStrokeWidth > 0 ? `${textStrokeLineWidth(textStyle)}px` : undefined,
                                        WebkitTextStrokeColor: layer.text_stroke_color_mode === 'picker' && pickedColor[realIdx] ? pickedColor[realIdx] : textStyle.textStrokeColor,
                                        paintOrder: textStyle.textStrokeType === 'outset' ? 'stroke fill' : textStyle.textStrokeType === 'inset' ? 'fill stroke' : undefined,
                                        textAlign: textStyle.textAlign,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        transform: composeLayerFlipTransform(
                                          layer,
                                          String(textStyle.explicitStyle.transform || ''),
                                        ),
                                        ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}),
                                        cursor: 'text',
                                        zIndex: 50,
                                      }
                                      return (
                                        <Fragment key={sortIdx}>
                                          {/* 背景模糊的作用范围必须和导出那侧算的一致：
                                              宽高缺失时回落到行高，导出的文字框也是这么兜底的 */}
                                          {backdropBlur > 0 && typeof textStyle.width === 'number' && (
                                            <BackdropBlurOverlay
                                              box={{ ...textBoxStyle, width: textStyle.width, height: textStyle.height ?? textStyle.lineHeightPx }}
                                              blurPx={backdropBlur}
                                              supported={backdropFilterOk}
                                            />
                                          )}
                                          <div style={textBoxStyle}
                                            onClick={(e) => { e.stopPropagation(); onSelectText(realIdx) }}>
                                            <span style={{ position: 'relative', zIndex: 1, width: '100%', pointerEvents: 'none', outline: activeLayerIdx === realIdx ? '1px solid var(--accent)' : undefined, outlineOffset: 2 }}>
                                              {displayText || <span style={{ opacity: 0.4 }}>点击后在设备下方编辑文字</span>}
                                            </span>
                                          </div>
                                        </Fragment>
                                      )
                                    }
                                    if (layer.type === 'color') {
                                      const cpVal = getClipPath(css)
                                      if (cpVal) {
                                        const rect = resolveLayerRect(layer, css, device.width, device.height)
                                        const clipPts = parseClipPathToPoints(cpVal, rect.w, rect.h)
                                        if (clipPts) {
                                          const boxStyle2 = cssToProps(css) as Record<string, unknown>
                                          const bgColor2 = (boxStyle2.backgroundColor as string) || ''
                                          const rawProps2 = { ...getRawCssProps(layer.css_code || ''), ...getRawCssProps(layer.css_position_code || '') }
                                          const rawBg2 = rawProps2['background'] || rawProps2['background-image'] || ''
                                          const bgImage2 = (boxStyle2.backgroundImage as string) || (boxStyle2.background as string) || rawBg2 || css['background-image'] || ''
                                          const isGradient2 = bgImage2 !== 'none' && /gradient\(/.test(bgImage2)

                                          let fillColor: string
                                          if (isGradient2) {
                                            fillColor = bgImage2
                                          } else if (bgColor2 && bgColor2 !== 'rgba(0, 0, 0, 0)') {
                                            fillColor = bgColor2
                                          } else if (layer.color && !css['background'] && !css['background-color'] && !css.backgroundColor) {
                                            fillColor = layer.color
                                          } else {
                                            fillColor = '#000'
                                          }

                                          if (layer.color_mode === 'picker' && pickedColor[realIdx] && !fillColor.includes('gradient(')) fillColor = pickedColor[realIdx]
                                          const clipFlipTransform = [layer.flip_horizontal ? 'scaleX(-1)' : '', layer.flip_vertical ? 'scaleY(-1)' : ''].filter(Boolean).join(' ') || undefined
                                          return (
                                            <Fragment key={sortIdx}>
                                              {backdropBlur > 0 && (
                                                <BackdropBlurOverlay
                                                  box={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h, zIndex: layer.z_index ?? 0, clipPath: cpVal, transform: clipFlipTransform }}
                                                  blurPx={backdropBlur}
                                                  supported={backdropFilterOk}
                                                />
                                              )}
                                              <svg style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.w, height: rect.h, overflow: 'visible', transform: clipFlipTransform, ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}), pointerEvents: 'none' }}><polygon points={pointsToSvgAttr(clipPts)} fill={fillColor} /></svg>
                                            </Fragment>
                                          )
                                        }
                                      }
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      // 原始 CSS 兜底渐变和边框
                                      const colorPaintPolicy = resolveBoxPaintPolicy(layer, css)
                                      const rawColorProps = colorPaintPolicy.rawProps
                                      const rawGrad = rawColorProps['background'] || rawColorProps['background-image'] || ''
                                      if (rawGrad && rawGrad !== 'none' && /gradient\(/.test(rawGrad) && !(style as any).backgroundImage && !(style as any).background) {
                                        (style as any).backgroundImage = rawGrad
                                      }
                                      const rawBdr = rawColorProps['border'] || ''
                                      if (rawBdr && rawBdr !== 'none' && !style.border && !style.borderTopWidth) {
                                        style.border = rawBdr
                                      }
                                      if (layer.color_mode === 'picker') {
                                        const gradient = String(style.backgroundImage || style.background || rawGrad || css['background-image'] || css.background || '')
                                        applyPickedColorToBoxStyle(style, gradient, pickedColor[realIdx], colorPaintPolicy)
                                      } else if (layer.color && !colorPaintPolicy.hasFill && colorPaintPolicy.hasBorder && CSS.supports('color', layer.color)) {
                                        style.borderColor = layer.color
                                      }
                                      return (
                                        <Fragment key={sortIdx}>
                                          {backdropBlur > 0 && <BackdropBlurOverlay box={style} blurPx={backdropBlur} supported={backdropFilterOk} />}
                                          <div style={{ ...style, ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}), pointerEvents: 'none', transform: resolveLayerPreviewTransform(layer, css), transformOrigin: 'center center' }} />
                                        </Fragment>
                                      )
                                    }
                                    if (layer.type === 'image' && layer.show_on_client === false) return null
                                    if (layer.type === 'image' && layer.image_url) {
                                      const style = getLayerBoxStyle(layer, css, device.width, device.height)
                                      const imageFit = typeof style.objectFit === 'string' ? style.objectFit : 'fill'
                                      const imagePosition = typeof style.objectPosition === 'string' ? style.objectPosition : '50% 50%'
                                      // 图片自身的 CSS filter 统一挪到内容层，导出时才能用同一套数值复现。
                                      const imageFilterCss = resolveLayerImageFilterCss(layer, css, imageFx?.[realIdx])
                                      // 管理端给图片图层配了 SVG 形状遮罩时，静态图片同样只显示在形状范围内
                                      const imageMaskStyle = svgMaskStyle(layer.mask_svg)
                                      delete style.filter
                                      delete style.WebkitFilter
                                      return (
                                        <Fragment key={sortIdx}>
                                          {backdropBlur > 0 && <BackdropBlurOverlay box={style} blurPx={backdropBlur} supported={backdropFilterOk} maskUrl={svgMaskImageUrl(layer.mask_svg || '')} />}
                                          <div style={{ ...style, ...(fxOpacity !== undefined ? { opacity: fxOpacity } : {}), overflow: 'hidden', pointerEvents: 'none' }}>
                                            {/* 遮罩加在内层：图片自己的 rotate/scale 不会带着形状一起动，形状始终贴着图层方框 */}
                                            <div style={{ width: '100%', height: '100%', ...imageMaskStyle }}>
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
                                              filter: imageFilterCss,
                                              WebkitFilter: imageFilterCss,
                                              willChange: 'transform, filter',
                                              backfaceVisibility: 'hidden',
                                            }} />
                                            </div>
                                          </div>
                                        </Fragment>
                                      )
                                    }
                                    return null
                                  }
                                  const rect = resolveLayerRect(layer, css, device.width, device.height)
                                  const cssW = rect.w
                                  const cssH = rect.h
                                  // 从 CSS 提取边框圆角和阴影
                                  const cssBorderRadius = resolveBorderRadius(css)
                                  const cssBoxShadow = css['box-shadow'] || css['boxShadow']
                                  const isInsetBoxShadow = /\binset\b/i.test(cssBoxShadow || '')
                                  const layerOpacity = parseFloat(css['opacity'] || '1')
                                  const interactiveStyle = getLayerBoxStyle(layer, css, device.width, device.height)
                                  if (layer.type === 'shape') {
                                    const interactivePaintPolicy = resolveBoxPaintPolicy(layer, css)
                                    const rawShapeProps = interactivePaintPolicy.rawProps
                                    const rawGradient = rawShapeProps['background'] || rawShapeProps['background-image'] || ''
                                    if (rawGradient && rawGradient !== 'none' && /gradient\(/.test(rawGradient) && !interactiveStyle.backgroundImage && !interactiveStyle.background) {
                                      interactiveStyle.backgroundImage = rawGradient
                                    }
                                    const rawBorder = rawShapeProps.border || ''
                                    if (rawBorder && rawBorder !== 'none' && !interactiveStyle.border && !interactiveStyle.borderTopWidth) {
                                      interactiveStyle.border = rawBorder
                                    }
                                    const gradient = String(
                                      interactiveStyle.backgroundImage || interactiveStyle.background || rawGradient || css['background-image'] || css.background || '',
                                    )
                                    if (layer.color_mode === 'picker') {
                                      applyPickedColorToBoxStyle(interactiveStyle, gradient, pickedColor[realIdx], interactivePaintPolicy)
                                    } else if (layer.color && !interactivePaintPolicy.hasFill && interactivePaintPolicy.hasBorder && CSS.supports('color', layer.color)) {
                                      interactiveStyle.borderColor = layer.color
                                    }
                                  }
                                  const hasVisualContent = Boolean(
                                    state?.imageUrl
                                    || (layer.show_on_client !== false && layer.image_url)
                                    || layer.type === 'shape',
                                  )

                                  const displayRect = state?.naturalWidth && state.naturalHeight
                                    ? resolveImageDrawRect(
                                        state.naturalWidth,
                                        state.naturalHeight,
                                        { left: 0, top: 0, width: cssW, height: cssH },
                                        resolveUserImageFit(css['object-fit']),
                                        css['object-position'],
                                      )
                                    : { left: 0, top: 0, width: cssW, height: cssH }

                                  const interactiveImageFilterCss = resolveLayerImageFilterCss(layer, css, imageFx?.[realIdx])
                                  delete interactiveStyle.filter
                                  delete interactiveStyle.WebkitFilter
                                  // 管理端配了 SVG 形状遮罩时，用户上传的图片只显示在形状范围内。
                                  // 遮罩加在内层内容盒上：形状贴着图层方框，用户拖动/缩放图片时形状不会跟着动。
                                  const interactiveMaskSvg = (layer.mask_svg || '').trim()
                                  const interactiveMaskStyle = svgMaskStyle(interactiveMaskSvg)
                                  // 同组（共用一张用户图）图层只有最上面那层能被操作：
                                  // 其余成员把指针事件转交给它，自己只跟着显示同一张图。
                                  const interactionIdx = groupAnchors.get(realIdx) ?? realIdx
                                  const interactiveRadius = cssBorderRadius
                                  const interactiveClip = getRoundedClipPath(interactiveRadius)
                                  const interactiveTransform = resolveLayerPreviewTransform(layer, css)
                                  return (
                                    <Fragment key={sortIdx}>
                                      {backdropBlur > 0 && (
                                        <BackdropBlurOverlay
                                          box={{
                                            left: interactiveStyle.left,
                                            top: interactiveStyle.top,
                                            width: interactiveStyle.width,
                                            height: interactiveStyle.height,
                                            zIndex: layer.z_index ?? 0,
                                            transform: interactiveTransform,
                                            borderRadius: interactiveRadius,
                                            clipPath: interactiveClip,
                                            WebkitClipPath: interactiveClip,
                                          }}
                                          blurPx={backdropBlur}
                                          supported={backdropFilterOk}
                                          maskUrl={svgMaskImageUrl(interactiveMaskSvg)}
                                        />
                                      )}
                                    <div data-interactive="true"
                                      style={{ ...interactiveStyle, zIndex: layer.z_index ?? 0, opacity: hasVisualContent ? layerOpacity : 0, cursor: state?.imageUrl ? (dragMode === 'move' ? 'grabbing' : 'grab') : 'pointer', pointerEvents: hasVisualContent ? 'auto' : 'none', borderRadius: interactiveRadius, clipPath: interactiveClip, WebkitClipPath: interactiveClip, boxShadow: isInsetBoxShadow ? undefined : cssBoxShadow, touchAction: 'none', overflow: 'hidden', willChange: 'transform', transform: interactiveTransform, transformOrigin: 'center center' }}
                                      onMouseDown={(e) => { if (state?.imageUrl) { onActivateLayer(interactionIdx); onLayerMouseDown(interactionIdx, e) } }}
                                      onTouchStart={(e) => { if (state?.imageUrl) { onActivateLayer(interactionIdx); onLayerTouchStart(interactionIdx, e) } }}
                                      onClick={(e) => { e.stopPropagation(); if (!state?.imageUrl) onRequestUpload(interactionIdx) }}>
                                      <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit', position: 'relative', ...interactiveMaskStyle }}>
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
                                          filter: interactiveImageFilterCss,
                                          WebkitFilter: interactiveImageFilterCss,
                                          willChange: 'transform, filter',
                                          backfaceVisibility: 'hidden',
                                        }}>
                                          <img src={state.imageUrl} alt="" draggable={false} style={{
                                            width: '100%',
                                            height: '100%',
                                            maxWidth: 'none',
                                            display: 'block',
                                            pointerEvents: 'none',
                                          }} />
                                        </div>
                                      ) : layer.show_on_client !== false && layer.image_url ? (
                                        <img src={layer.image_url} alt="" draggable={false} style={{
                                          width: '100%',
                                          height: '100%',
                                          maxWidth: 'none',
                                          objectFit: (css['object-fit'] || 'fill') as CSSProperties['objectFit'],
                                          objectPosition: css['object-position'] || '50% 50%',
                                          pointerEvents: 'none',
                                          position: 'relative',
                                          zIndex: 1,
                                          transform: `rotate(${layer.adjustments?.rotation ?? 0}deg) scale(${layer.adjustments?.scale ?? 1})`,
                                          filter: interactiveImageFilterCss,
                                          WebkitFilter: interactiveImageFilterCss,
                                          willChange: 'transform, filter',
                                          backfaceVisibility: 'hidden',
                                        }} />
                                      ) : null}
                                      {isInsetBoxShadow && (
                                        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: cssBoxShadow, pointerEvents: 'none', zIndex: 2 }} />
                                      )}
                                      </div>
                                    </div>
                                    </Fragment>
                                  )
                                })}
                              </div>
  )
}
