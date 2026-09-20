import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { WatchFaceLayerStack } from '@/components/WatchFaceLayerStack'
import { apiFetch, API_BASE } from '@/lib/api'
import { IS_OFFLINE, offlineAsset } from '@/lib/offline'
import { savePngBlob, isNativeApp } from '@/lib/saveImage'
import { cssLengthToPx, normalizeFontFaceStyle, parseCssDeclarations, resolveCssRotation, resolveCssTranslation, resolveTextStyle, stripTranslateTransform, textStrokeLineWidth } from '@/lib/templateTextStyle'
import { extractImageColors, selectPaletteColor } from '@/lib/imagePalette'
import { snapToEdges } from '@/lib/snapToEdges'
import { describeScale, isHeavyUpload, prepareUserImage } from '@/lib/userImage'
import { ArrowLeft, RotateCcw, Download, Palette, Trash2 } from 'lucide-react'
import { RiColorFilterLine, RiDropperLine, RiImageLine } from '@remixicon/react'
import { ProActionButton, ProActionDivider, ProAlignButton, PRO_ACTION_GAP, ProFxSlider, ProSegmented, ProSheet, proStrokeStyle, PRO_ACCENT, PRO_BUTTON_STROKE_COLOR, PRO_INK, PRO_PREVIEW_SHEET_SCALE, PRO_SHEET_DURATION, PRO_SHEET_EASING, PRO_SHEET_GAP, PRO_SHEET_TOP_RESERVE, PRO_TAB_DURATION, PRO_TAB_EASING, type AlignKind } from '@/components/ProEditorControls'
import { DesktopAlignButton, DesktopSlider, ProPanelCard } from '@/components/ProDesktopControls'
import { hapticTick } from '@/lib/haptics'
import {
  EXPORT_SCALE,
  HANDLE_R,
  PAD,
  ROT_HANDLE_OFFSET,
  ROT_HANDLE_R,
  applySvgColor,
  getClipPath,
  getLayerBoxStyle,
  getLayerCss,
  applyPickedColorToBoxStyle,
  composeLayerFlipTransform,
  fitSvgToContainer,
  getRoundedClipPath,
  parseBoxShadow,
  parseBorderRadius,
  parseClipPathToPoints,
  pointsToSvgAttr,
  fillClipPath,
  parseCssBlock,
  getRawCssProps,
  resolveBorderRadius,
  resolveBoxPaintPolicy,
  resolveGroupAnchors,
  resolveImageDrawRect,
  resolveImageFilterForExport,
  resolveLayerPreviewTransform,
  resolveLayerRect,
  resolveLayerContentRect,
  resolveBackdropBlurPx,
  svgShapeMaskDataUri,
  svgToDataUri,
  drawSoftwareFilteredImage,
  createBlurredRegion,
  resolveTextStyleWithOverride,
  resolveUserImageFit,
  shouldUseProEditor,
  shrinkToHalfLimit,
  snapRotation,
  cssToProps,
  createCanvasLinearGradient,
  recolorLinearGradient,
  resolveBlurMax,
  useDeviceRecordState,
  useTemplateFonts,
  migrateTemplate,
  type DragMode,
  type DeviceConfig,
  type HorizontalTextAlign,
  type Layer,
  type LayerState,
  type Template,
  type TextAlignOverride,
  type UserImageFx,
  type VerticalTextAlign,
} from '@/lib/watchFaceKit'

/* ═══════════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════════ */

/** 两种底部抽屉的设计高度（= ProSheet 的 minHeight）。
 *  展开动画的目标高度必须「第一帧就是对的」：先用别的抽屉量到的高度算位移、
 *  等挂载量到真实高度再改回来，预览框和抽屉都会走两段（先冲过头再退回来）。 */
const PRO_SHEET_MIN_HEIGHT: Record<'fx' | 'color', number> = { fx: 357, color: 217 }

/** 新版移动端编辑器的页面底色。与全站一致（index.html 兜底底色、原生状态栏都是白色），
 *  同时会被写到 html/body 上，避免下拉回弹时露出另一层颜色。 */
const PRO_PAGE_BG = '#ffffff'
/** 白色页面上的次级文字（模板名以外的说明文字、未选中的设备名等） */
const PRO_DIM_INK = 'rgba(19, 19, 19, 0.6)'
/** 白色页面上的细描边：预览框外框、设备切换胶囊 */
const PRO_HAIRLINE = 'rgba(0, 0, 0, 0.12)'
/** 移动端「点一下图片」的判定：落点到松手的位移不超过 10px，且按住不超过 600ms 才算点击。
 *  松手时位移超过这个值就只当手势（平移 / 缩放），不再当成点击。 */
const TAP_SLOP = 10
const TAP_HOLD_MS = 600
/** 触摸之后浏览器还会补发一整套 mousedown/mouseup/click（React 给 touchstart 挂的是 passive 监听，
 *  preventDefault 拦不住它）。这段时间内的鼠标事件要当成「同一次触摸」，不能再算一次鼠标点击，
 *  否则手机上点一下：touchend 先放大，紧接着补发的 mouseup 又把它收回去。 */
const TOUCH_MOUSE_GUARD_MS = 700

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
  /** 「同图」组内其他图层的起始状态（位移 / 缩放 / 旋转）。
   *  底层用户点不到，顶层做任何变换时都得按同一增量带着它们走，
   *  否则磨砂背景会和上层图片越差越远，而用户没有任何办法把它们对回去。 */
  const groupDragRef = useRef<{
    gid: string
    members: { realIdx: number; startX: number; startY: number; startScale: number; startRotation: number }[]
  } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [msg, setMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  // backdrop-filter 在 Android/HyperOS WebView 上可能声明支持但输出黑色离屏纹理。
  // 首帧先关闭，确认是非 Android 且 API 支持后再启用，避免一次错误合成污染图层。
  const [backdropFilterOk, setBackdropFilterOk] = useState(false)
  useEffect(() => {
    const isAndroidRuntime = /android/i.test(navigator.userAgent)
    const supportsBackdrop = typeof CSS !== 'undefined' && Boolean(CSS.supports)
      && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'))
    setBackdropFilterOk(!isAndroidRuntime && supportsBackdrop)
  }, [])

  /* ── 整页底色与下拉回弹（只在新版移动端界面上做）──
     页面底色与全站一致是白色，但移动端手指往上拉时页面会回弹，露出来的是 html/body 那一层。
     这里把文档底色也设成同色，再关掉下拉刷新（否则在抽屉顶部往下拖会变成刷新页面）。
     旧版界面走的是主题色，所以只在走 Pro 界面时改，退出时原样还原。 */
  useEffect(() => {
    if (!shouldUseProEditor(template)) return
    const root = document.documentElement
    const body = document.body
    const prev = {
      rootBg: root.style.background,
      bodyBg: body.style.background,
      rootOverscroll: root.style.overscrollBehaviorY,
      bodyOverscroll: body.style.overscrollBehaviorY,
    }
    root.style.background = PRO_PAGE_BG
    body.style.background = PRO_PAGE_BG
    root.style.overscrollBehaviorY = 'none'
    body.style.overscrollBehaviorY = 'none'
    return () => {
      root.style.background = prev.rootBg
      body.style.background = prev.bodyBg
      root.style.overscrollBehaviorY = prev.rootOverscroll
      body.style.overscrollBehaviorY = prev.bodyOverscroll
    }
  }, [template])
  // 文字编辑
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null)
  const [editedTexts, setEditedTexts] = useDeviceRecordState<string>(selectedDeviceIdx)

  /* ── 新版移动端编辑器（手环 Pro 系列）专属状态 ── */
  // 用户在「效果-图片效果」里新调的滤镜；旧模板没有这份数据，全部按中性值处理。
  const [imageFx, setImageFx] = useState<UserImageFx>({})
  // 用户在「效果-文字编辑」里手选的排版；只作用于本次编辑，不写回模板数据。
  const [textAlignOverrides, setTextAlignOverrides] = useDeviceRecordState<TextAlignOverride>(selectedDeviceIdx)
  // 当前展开的底部抽屉：'fx' 效果 / 'color' 取色 / null 收起
  const [activeSheet, setActiveSheet] = useState<'fx' | 'color' | null>(null)
  const [fxTab, setFxTab] = useState<'image' | 'text'>('image')
  // 「签名」标签下正在编辑的文字图层
  const [alignTextIdx, setAlignTextIdx] = useState<number | null>(null)
  // 「排版」是单选：只记录当前高亮的那一个按钮，避免水平和垂直方向同时亮起两块
  const [alignKind, setAlignKind] = useState<AlignKind | null>(null)
  // 底部区域的展开动画：抽屉 / 入口按钮各自的自然高度，以及收起后仍要挂载的抽屉内容
  const [sheetKind, setSheetKind] = useState<'fx' | 'color' | null>(null)
  // 每个抽屉各记一份实测高度，未测到之前先用设计高度兜底（见 PRO_SHEET_MIN_HEIGHT 注释）
  const [sheetHeights, setSheetHeights] = useState({ ...PRO_SHEET_MIN_HEIGHT })
  const [actionBarHeight, setActionBarHeight] = useState(0)
  // 全屏预览：点一下预览框里的图片就把整块放大到屏幕内能放下的最大尺寸，再点一下收回
  const [previewExpanded, setPreviewExpanded] = useState(false)
  /** 放大前预览框在屏幕上的中心。放大后要把它挪到屏幕正中，
   *  所以用 transform-origin 缩放之外还要补一段位移；这个中心只能在「收起状态」量，
   *  量一次存下来，收回去时才能沿原路回到原位。 */
  const [previewOrigin, setPreviewOrigin] = useState<{ x: number; y: number } | null>(null)
  const sheetBoxRef = useRef<HTMLDivElement | null>(null)
  const actionBarRef = useRef<HTMLDivElement | null>(null)
  /** 预览框外层（承载全屏缩放的那一层） */
  const previewBoxRef = useRef<HTMLDivElement | null>(null)
  /** 单指按下时记下的落点，松手时用它判断这次触摸算不算一次「点击」 */
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null)
  /** 鼠标按下时的落点，以及这次按下有没有拖动过：没拖动 = 一次「点击图片」，用来放大 / 收回预览框 */
  const mouseTapRef = useRef<{ x: number; y: number } | null>(null)
  const mouseTapMovedRef = useRef(false)
  /** 最近一次触摸的时间，用来把触摸后补发的那套鼠标事件（见 TOUCH_MOUSE_GUARD_MS）排除在「鼠标点击」之外 */
  const lastTouchAtRef = useRef(0)
  /** 点击已经切换过全屏预览时，抑制紧随其后的 click（否则又会把图层取消选中，白点一下） */
  const suppressPreviewClickRef = useRef(false)

  /* ── 点一下预览框里的图片 → 把预览框放大到铺满屏幕（再点一下收回） ──
     触摸那一路的判定放在 touchend 而不是靠浏览器的 click：单指触摸在 handleTouchStart 里
     preventDefault 过，浏览器不会补发 click；自己判定还能顺手把双指手势排除掉
     （双指落下时 tapRef 被清空）。鼠标那一路见 handleMouseDown 里的落点记录。
     必须放在下面几个 effect 之前：effect 的依赖数组是立即求值的，声明在后面会触发 TDZ 报错。 */
  const togglePreviewExpanded = useCallback(() => {
    if (previewExpanded) { setPreviewExpanded(false); return }
    // 放大前先量一次预览框在屏幕上的中心：放大后要把它挪到屏幕正中，
    // 只有收起状态下量到的才是「原位」，收回去时才能沿原路退回。
    const el = previewBoxRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setPreviewOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    }
    setPreviewExpanded(true)
  }, [previewExpanded])

  /** 抽屉当前要显示的内容：展开时跟着 activeSheet，收起后保留最后一次的种类（收起动画还要靠它）。
   *  默认 'fx'：抽屉始终挂载，第一次展开才有「上一帧位置」可以过渡，否则首帧直接跳到位、看不到动画。
   *  必须放在下面几个 effect 之前：effect 的依赖数组是立即求值的，声明在后面会触发 TDZ 报错。 */
  const sheetKindForLayout = activeSheet ?? sheetKind ?? 'fx'

  /** 新版移动端编辑器目前只覆盖手环 Pro 系列，其余机型继续走旧版界面，存量模板体验不变。
   *  必须放在下面几个 effect 之前：effect 的依赖数组是立即求值的，声明在后面会触发 TDZ 报错。 */
  const isProUi = shouldUseProEditor(template)

  /** 窗口尺寸：移动端 / 桌面端断点用。声明在这里是因为下面的 effect 依赖它算出的 isProDesktop，
   *  依赖数组是立即求值的，声明在后面会触发 TDZ 报错。 */
  const [winSize, setWinSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 375, h: typeof window !== 'undefined' ? window.innerHeight : 667 })
  /** 桌面端走「左侧预览 + 右侧数据栏」那套 Pro 版式；移动端继续用底部抽屉。 */
  const isProDesktop = isProUi && winSize.w >= 1024

  // 抽屉收起后内容不卸载：收起动画期间还要靠它滑动，卸载了就只剩底部瞬间上跳
  useEffect(() => { if (activeSheet) setSheetKind(activeSheet) }, [activeSheet])

  // 底部区域的高度不能写死：抽屉内容随标签、安全区变化，入口按钮的高度也由内容决定。
  // 抽屉高度实测（按抽屉种类分别记录），入口按钮的高度交给 ResizeObserver。
  // 依赖里带 isProDesktop：桌面端不渲染抽屉（ref 为 null），从桌面缩回移动端时
  // 抽屉与入口栏是新挂载的节点，不重新量就会一直用兜底高度。
  useEffect(() => {
    const el = sheetBoxRef.current
    if (!el) return
    const kind = sheetKindForLayout
    const measure = () => {
      const h = Math.round(el.offsetHeight)
      setSheetHeights(prev => (prev[kind] === h ? prev : { ...prev, [kind]: h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheetKindForLayout, isProDesktop])

  useEffect(() => {
    const el = actionBarRef.current
    if (!el) return
    const measure = () => setActionBarHeight(Math.round(el.offsetHeight))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isProUi, isProDesktop])

  useEffect(() => {
    setActiveLayerIdx(null)
    setEditingTextIdx(null)
    setDragMode(null)
    setActiveSheet(null)
    setAlignTextIdx(null)
    setAlignKind(null)
  }, [selectedDeviceIdx])

  // 提示条到点自动消失：否则「图片已开始下载」这类结果会一直挂在底部，遮住抽屉内容。
  useEffect(() => {
    if (!msg) return
    const timer = window.setTimeout(() => setMsg(''), 3000)
    return () => window.clearTimeout(timer)
  }, [msg])

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const [wrapSize, setWrapSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth - 80 : 300, h: typeof window !== 'undefined' ? window.innerHeight - 260 : 400 })

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

  // 加载文字图层所用字体到浏览器（FontFace API），与新版编辑器共用同一实现
  useTemplateFonts(template)

  // 窗口尺寸
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 预览区域测量（新旧两套布局、以及 Pro 的桌面/移动两套版式的预览容器都不同，切换时重新挂观察器）
  useEffect(() => {
    const el = previewWrapRef.current
    if (!el) return
    const measure = () => {
      // 元素已经从文档里摘掉时，getComputedStyle 的 padding 会返回空串，parseFloat 得到 NaN。
      // 这种「过期」的测量（切版式或热更新时 ResizeObserver 的滞后回调）绝不能写进状态：
      // 一旦 wrapSize 变成 NaN，预览整体缩放 previewScale 就是 NaN，
      // 手柄的绝对定位和拖拽的位移换算全跟着废掉（表现为手柄挤在左上角、图片拖不动）。
      if (!el.isConnected) return
      const cs = getComputedStyle(el)
      const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padH = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      if (!Number.isFinite(padW) || !Number.isFinite(padH)) return
      const w = el.clientWidth - padW
      const h = el.clientHeight - padH
      // 折叠或尚未布局时量到 0，不能拿它当可用尺寸（会把预览缩到看不见）
      if (!(w > 0) || !(h > 0)) return
      setWrapSize({ w: Math.floor(w), h: Math.floor(h) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isProUi, isProDesktop, selectedDeviceIdx])

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
      .filter(({ layer }) =>
        (layer.color_mode === 'picker' || layer.text_stroke_color_mode === 'picker') && layer.type !== 'image')
  }, [device])

  const textLayers = useMemo(() => {
    if (!device) return []
    return device.layers
      .map((layer, realIdx) => ({ layer, realIdx }))
      .filter(({ layer }) => layer.type === 'text')
  }, [device])

  /** 已上传图片的交互图层下标：图片效果抽屉里的滤镜作用在这些图层上 */
  const uploadedImageIndexes = useMemo(
    () => interactiveLayers.filter(({ realIdx }) => layerStates[realIdx]?.imageUrl).map(({ realIdx }) => realIdx),
    [interactiveLayers, layerStates],
  )
  /** 预览用：把用户新调的滤镜挂到每个已上传图片的图层上（中性值时 kit 会自动忽略） */
  const imageFxByLayer = useMemo(
    () => Object.fromEntries(uploadedImageIndexes.map(i => [i, imageFx])) as Record<number, UserImageFx>,
    [uploadedImageIndexes, imageFx],
  )

  // 桌面端数据栏里的「签名」是常驻面板，需要一个默认的编辑对象：
  // 只有一个文字图层时面板里没有可点的图层胶囊，不自动选中就没有输入框可用。
  // 移动端不走这条（抽屉是靠点预览里的文字打开的）。
  useEffect(() => {
    if (!isProDesktop) return
    if (alignTextIdx != null && textLayers.some(({ realIdx }) => realIdx === alignTextIdx)) return
    setAlignTextIdx(textLayers[0]?.realIdx ?? null)
  }, [isProDesktop, textLayers, alignTextIdx])

  /* ── 新版布局：预览区与预览缩放 ── */
  const isMobile = winSize.w < 1024
  // 抽屉展开后预览区被压缩，wrapSize 由 ResizeObserver 实时测量，预览自动缩小让位。
  // Pro 版预览容器四周还要留出 PAD 的把手/描边空间，可用尺寸先扣掉这部分：
  // 否则容器会比可用宽度宽，溢出后容器自己贴着左边（表现为「预览框不居中」）。
  const rawAvailW = isProUi
    ? Math.max(120, wrapSize.w - PAD * 2)
    : isMobile ? Math.max(160, winSize.w - 72) : Math.max(200, (winSize.w - 136) * 2 / 3)
  const rawAvailH = isProUi
    ? Math.max(120, wrapSize.h - PAD * 2)
    : isMobile ? Math.max(200, winSize.h - 220) : Math.max(200, winSize.h - 200)
  const maxAvailW = isProUi ? rawAvailW : (wrapSize.w > 0 ? Math.min(rawAvailW, wrapSize.w - PAD * 2) : rawAvailW)
  const maxAvailH = isProUi ? rawAvailH : (wrapSize.h > 0 ? Math.min(rawAvailH, wrapSize.h - PAD * 2) : rawAvailH)
  const previewScaleRaw = device ? Math.min(maxAvailW / device.width, maxAvailH / device.height, 1) : 1
  /** 兜底：可用尺寸若因为未布局/测量异常变成 NaN，也不能让整块预览的几何全变 NaN */
  const previewScale = Number.isFinite(previewScaleRaw) && previewScaleRaw > 0 ? previewScaleRaw : 1
  const previewWidth = device ? device.width * previewScale : 0
  const previewHeight = device ? device.height * previewScale : 0
  const cornerRadius = device ? device.corner_radius * previewScale : 0
  const containerWidth = previewWidth + PAD * 2
  const containerHeight = previewHeight + PAD * 2
  const vpLeft = (containerWidth - previewWidth) / 2
  const vpTop = (containerHeight - previewHeight) / 2

  /* ── 抽屉展开时预览框整块上移并缩小 ──
     位置：设计稿里展开抽屉后预览框落在「抽屉顶边以上的可视区域」里居中，而不是固定贴着抽屉顶边：
     抽屉 357 高时预览框底边离抽屉 27px，抽屉 217 高时离 95px —— 抽屉每矮 2px、间隙就多 1px。
     所以这里按居中算，再兜一个 PRO_SHEET_GAP 的最小间隙，避免抽屉很高时预览框压到抽屉上。
     尺寸：展开时整体缩到 PRO_PREVIEW_SHEET_SCALE，做出 iOS「内容往后退一层」的层次感。
     尺寸和位移一起走 transform 过渡，和抽屉上滑同一时长、同一曲线。 */
  const previewDistFromBottom = actionBarHeight + PAD + (wrapSize.h - previewHeight) / 2
  const sheetHeight = sheetHeights[sheetKindForLayout]
  const previewTopY = winSize.h - previewDistFromBottom - previewHeight
  const sheetTopY = winSize.h - sheetHeight
  /** 展开时的缩放比例（收起恒为 1）。桌面端不做抽屉（activeSheet 恒为 null），
   *  从移动端版式切过来时也不认残留值，免得拖拽换算被这层缩放带偏。 */
  const previewSheetScale = activeSheet && !isProDesktop ? PRO_PREVIEW_SHEET_SCALE : 1
  /** 缩小后的实际高度：位移必须按缩完的尺寸算，否则底边会离抽屉忽远忽近 */
  const scaledPreviewHeight = previewHeight * previewSheetScale
  /** 居中后的预览框顶边；「底边至少离抽屉 PRO_SHEET_GAP」对应的顶边；取更靠上的那个 */
  const previewTargetTopY = Math.min(
    PRO_SHEET_TOP_RESERVE + (sheetTopY - PRO_SHEET_TOP_RESERVE - scaledPreviewHeight) / 2,
    sheetTopY - PRO_SHEET_GAP - scaledPreviewHeight,
  )
  // transform-origin 是中心，所以位移 = 原中心 - 目标中心
  const previewShiftY = activeSheet
    ? Math.max(0, Math.round(previewTopY + previewHeight / 2 - previewTargetTopY - scaledPreviewHeight / 2))
    : 0

  /* ── 全屏预览：点一下图片把预览框放大到铺满屏幕 ──
     放大到「屏幕内放得下的最大尺寸」而不是按高度铺满：
     表盘是竖长比例（宽约为高的 0.7），按高度铺满会把左右两侧裁掉，
     编辑时正好看不到表盘的左右边缘，反而更不好对齐。
     缩放与位移都只走 transform，和抽屉那套动画同一个时长、同一条曲线，
     所以进出都是「从原位长出去、再缩回原位」，而不是闪一下换个尺寸。 */
  const FULLSCREEN_MARGIN = 16
  /** 当前外层已经施加的总缩放（抽屉缩放 × 全屏缩放）：指针位移换算成设备像素时要一起除掉。
   *  桌面端这两层都不存在，恒为 1。 */
  const previewExpandScale = previewExpanded && !isProDesktop && previewWidth > 0
    ? Math.min(
        (winSize.w - FULLSCREEN_MARGIN * 2) / (previewWidth * previewSheetScale),
        (winSize.h - FULLSCREEN_MARGIN * 2) / (previewHeight * previewSheetScale),
      )
    : 1
  const previewRenderScale = previewSheetScale * previewExpandScale
  const previewExpandShiftX = previewExpanded && previewOrigin ? winSize.w / 2 - previewOrigin.x : 0
  const previewExpandShiftY = previewExpanded && previewOrigin ? winSize.h / 2 - previewOrigin.y : 0

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

  /** 同组上传图层共享一个图片状态；未分组时只返回当前图层。 */
  const getSharedUploadLayerIndexes = useCallback((layerIdx: number): number[] => {
    const layer = device?.layers[layerIdx]
    const groupId = layer?.group_id?.trim()
    if (!groupId) return [layerIdx]
    const indexes = interactiveLayers
      .filter(({ layer: candidate }) => candidate.group_id?.trim() === groupId)
      .map(({ realIdx }) => realIdx)
    return indexes.length > 0 ? indexes : [layerIdx]
  }, [device, interactiveLayers])

  /** 记录同组（共用一张用户图）其他图层的起始状态，供整组联动使用。
   *  在拖拽/缩放/旋转开始时调一次；未成组或组里只有自己时，groupDragRef 保持为 null。 */
  const captureGroupMembers = useCallback((layerIdx: number) => {
    groupDragRef.current = null
    const layer = device?.layers[layerIdx]
    const gid = layer?.group_id?.trim()
    if (!layer || !gid) return
    const members = device!.layers
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => i !== layerIdx && l.allow_user_upload && l.group_id?.trim() === gid)
      .map(({ i }) => {
        const s = layerStatesRef.current[i]
        return {
          realIdx: i,
          startX: s?.position.x ?? 0,
          startY: s?.position.y ?? 0,
          startScale: s?.scale ?? 1,
          startRotation: s?.rotation ?? 0,
        }
      })
    if (members.length > 0) groupDragRef.current = { gid, members }
  }, [device])

  /** 把本次手势的增量同步到同组其他图层。增量都是相对「手势开始时的状态」，
   *  所以位移/缩放/旋转可以同时写，没参与这次手势的那几项自然保持原值。 */
  const syncGroupMembers = (
    prev: Record<number, LayerState>,
    delta: { dx?: number; dy?: number; scaleFactor?: number; rotationDelta?: number },
  ): Record<number, LayerState> => {
    const group = groupDragRef.current
    if (!group) return prev
    const { dx = 0, dy = 0, scaleFactor = 1, rotationDelta = 0 } = delta
    const next = { ...prev }
    for (const m of group.members) {
      const s = prev[m.realIdx]
      if (!s) continue
      next[m.realIdx] = {
        ...s,
        position: { x: m.startX + dx, y: m.startY + dy },
        scale: Math.max(0.1, Math.min(5, m.startScale * scaleFactor)),
        rotation: m.startRotation + rotationDelta,
      }
    }
    return next
  }

  /* ── 文件上传（同组图层共享同一张图片） ── */
  /** 每次上传占一个序号：连着选两张时只认最后一次的结果。
   *  大图解码压缩要几百毫秒，先选的那张后返回就会把刚选的盖掉。 */
  const uploadSeqRef = useRef(0)
  /** 大图正在解码/压缩：给用户一个交代，也顺便挡住重复点击的错觉 */
  const [preparingImage, setPreparingImage] = useState(false)

  const handleFileUpload = useCallback((layerIdx: number, file: File) => {
    if (!file.type.startsWith('image/')) return
    // 选中「同图」组里最上面那层：底层不接受操作，把手/滚轮/效果都该落在顶层上，
    // 否则从底层的文件输入上传时会把激活图层停在底层。
    setActiveLayerIdx(resolveGroupAnchors(device?.layers ?? []).get(layerIdx) ?? layerIdx)

    const seq = ++uploadSeqRef.current
    // 小图几十毫秒就处理完，弹一句「正在处理」反而像闪屏；只有大图才提示
    setPreparingImage(isHeavyUpload(file))

    // 交给 userImage 归一化：解码时直接缩到上限内、把 HDR/广色域描述烧进 sRGB 像素再重编码，
    // 免得几亿像素的原图把页面卡死，也免得预览和导出因为色彩描述不一致而发灰。
    prepareUserImage(file)
      .then(prepared => {
        if (seq !== uploadSeqRef.current) {
          URL.revokeObjectURL(prepared.url)
          return
        }
        const url = prepared.url
        const img = prepared.image
        const siblingIdxs = getSharedUploadLayerIndexes(layerIdx)
        const replacedUrls = new Set(
          siblingIdxs
            .map(idx => layerStatesRef.current[idx]?.imageUrl)
            .filter((oldUrl): oldUrl is string => Boolean(oldUrl && oldUrl !== url)),
        )

        setLayerStates(prev => {
          const next = { ...prev }
          for (const idx of siblingIdxs) {
            const adj = device?.layers[idx]?.adjustments
            next[idx] = {
              imageUrl: url,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              position: prev[idx]?.position ?? { x: 0, y: 0 },
              scale: adj?.scale ?? 1,
              rotation: adj?.rotation ?? 0,
            }
          }
          return next
        })
        replacedUrls.forEach(oldUrl => URL.revokeObjectURL(oldUrl))
        const colors = extractImageColors(img)
        if (colors.length > 0) {
          setPickerColors(prev => ({
            ...prev,
            ...Object.fromEntries(pickerColorLayers.map(({ realIdx }) => [realIdx, colors])),
          }))
          const firstPicker = pickerColorLayers[0]
          const preferred = selectPaletteColor(colors,
            (firstPicker?.layer.color_mode === 'picker' && firstPicker.layer.picker_default)
            || (firstPicker?.layer.text_stroke_color_mode === 'picker' && firstPicker.layer.text_stroke_picker_default)
            || 'dark')
          setPickedColor(prev => ({
            ...prev,
            ...Object.fromEntries(pickerColorLayers.map(({ realIdx }) => [realIdx, preferred])),
          }))
        }
        // 压缩过就说一声：用户看到的是「图变糊了一点」，得知道为什么
        if (prepared.resized) setMsg(`图片过大，已压缩：${describeScale(prepared)}`)
      })
      .catch((error: unknown) => {
        if (seq !== uploadSeqRef.current) return
        setMsg(error instanceof Error ? error.message : '图片处理失败，请换一张再试')
      })
      .finally(() => {
        if (seq === uploadSeqRef.current) setPreparingImage(false)
      })
  }, [pickerColorLayers, device, getSharedUploadLayerIndexes])

  /* ── 拖拽/缩放/旋转 ── */
  /** 按下时同步挂一个一次性的 mouseup 给这次拖动收尾。
   *
   *  不能只靠下面 effect 里那对 window 监听：effect 要等 React 提交完才挂上，
   *  按得很快的一次点击（脚本化点击、触控板轻点）会在它挂上之前就松手，
   *  那次 mouseup 就永远收不到，dragMode 一直停在 'move'，
   *  之后不按鼠标移动光标图片也会跟着走。这里在 mousedown 里当场挂上，时序上不可能漏。
   *  正常松手时它会和 effect 里那个监听一起触发，两次 setDragMode(null) 是幂等的。 */
  const armDragEnd = useCallback(() => {
    window.addEventListener('mouseup', () => {
      groupDragRef.current = null
      setDragMode(null)
    }, { once: true })
  }, [])

  const handleMouseDown = useCallback((layerIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    // 刚触摸过：这一整套鼠标事件都是触摸补发出来的（React 给 touchstart 挂的是 passive 监听，
    // preventDefault 拦不住），里面既有 mouseup 也有拖动过程中的 mousemove。
    // 照单全收的话，手机上「点一下」会变成刚放大又立刻收回，单指拖动也会把图片拖走
    // —— Pro 界面只认双指，所以整段丢掉。
    if (isProUi && performance.now() - lastTouchAtRef.current <= TOUCH_MOUSE_GUARD_MS) return
    // Pro 界面（移动端）：记下落点。松手时若指针没挪动过（< TAP_SLOP），这次按下算「点击图片」，
    // 由下面常驻的 mouseup 监听切换全屏预览 —— 拖动调图不会误触发。
    // 桌面端不走这套：预览框不提供全屏放大，点击只是选中图层。
    if (isProUi && !isProDesktop) {
      mouseTapRef.current = { x: e.clientX, y: e.clientY }
      mouseTapMovedRef.current = false
    }
    armDragEnd()
    setDragMode('move')
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
    // 成组联动：记录同组其他交互图层初始状态
    captureGroupMembers(layerIdx)
  }, [isProUi, isProDesktop, armDragEnd, captureGroupMembers])

  const handleTouchStart = useCallback((layerIdx: number, e: React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // 触摸开始了：之后跟来的那套补发鼠标事件都不算「鼠标点击」
    lastTouchAtRef.current = performance.now()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    // Pro 界面（仅移动端版式）单指：
    //  · 预览框没有全屏放大时不动图片，只记下落点，拖动留给双指；
    //  · 全屏放大后允许单指平移 —— 放大时看的是细节，双指反而挡视线、不好对位。
    // 两种情况都保留 tapRef：松手时没挪动过（< TAP_SLOP）仍然算一次「点击」，
    // 由下面那段 touchend 判定放大 / 收回预览框；拖过了就只当平移。
    // 桌面端版式不走这套：它没有「点一下把预览放大到全屏」的玩法，
    // 触摸屏（平板、触控笔记本）上的单指必须和鼠标一样直接拖图，
    // 否则整段触摸都被吞掉，图片在手触设备上根本移不动。
    const proSingleFinger = isProUi && !isProDesktop && e.touches.length < 2
    if (proSingleFinger) {
      tapRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
      if (!previewExpanded) {
        setActiveLayerIdx(layerIdx)
        return
      }
    } else {
      // 双指一落，之前那次单指按下就不该再算作点击
      tapRef.current = null
    }
    if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      // Pro 界面只用双指「移动 + 缩放」；旧版编辑器沿用「缩放 + 旋转」
      setDragMode(isProUi ? 'pinch' : 'pinch-rotate')
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
    // 成组联动：记录同组其他交互图层初始状态
    captureGroupMembers(layerIdx)
  }, [isProUi, isProDesktop, previewExpanded, captureGroupMembers])

  const handleScaleMouseDown = useCallback((layerIdx: number, mode: DragMode, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    armDragEnd()
    setDragMode(mode)
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
    // 成组联动：缩放/旋转手柄同样是整组联动，记录同组其他图层初始状态
    captureGroupMembers(layerIdx)
  }, [armDragEnd, captureGroupMembers])

  const handleScaleTouchStart = useCallback((layerIdx: number, mode: DragMode, e: React.TouchEvent) => {
    e.stopPropagation()
    const state = layerStatesRef.current[layerIdx]
    if (!state) return
    setDragMode(mode)
    setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY })
    setDragStartState({ x: state.position.x, y: state.position.y, scale: state.scale, rotation: state.rotation })
    setActiveLayerIdx(layerIdx)
    captureGroupMembers(layerIdx)
  }, [captureGroupMembers])

  // 全局 mouse drag
  useEffect(() => {
    if (!dragMode || activeLayerIdx === null) return
    const onMouseMove = (e: MouseEvent) => {
      // 没按住任何键还在收到 mousemove，说明这次拖动的 mouseup 丢了（在窗口外松手等）：
      // 就地收尾，不能让图片继续跟着光标走。
      if (e.buttons === 0) { groupDragRef.current = null; setDragMode(null); return }
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      /** 预览框在抽屉展开 / 全屏放大时会整体缩放，指针位移要按「设备→屏幕」的总倍数还原回容器坐标系 */
      const renderScale = previewScale * previewRenderScale
      /** 指针坐标 → 容器坐标系（容器当前被 translate + scale 过，getBoundingClientRect 已含这两层） */
      const toContainer = (rect: DOMRect, cx: number, cy: number) => ({
        x: (cx - rect.left) / previewRenderScale,
        y: (cy - rect.top) / previewRenderScale,
      })
      if (dragMode === 'move') {
        const display = getImageDisplay(activeLayerIdx)
        const layer = device?.layers[activeLayerIdx]
        const raw = { x: dragStartState.x + dx / renderScale, y: dragStartState.y + dy / renderScale }
        const snapped = display && layer
          ? snapToEdges(raw.x + display.baseX, raw.y + display.baseY, display.dw, display.dh, dragStartState.scale, display.frameW, display.frameH)
          : raw
        setLayerStates(prev => {
          const next: Record<number, LayerState> = {
            ...prev,
            [activeLayerIdx]: {
              ...prev[activeLayerIdx],
              position: display ? { x: snapped.x - display.baseX, y: snapped.y - display.baseY } : snapped,
            },
          }
          // 成组联动：把这次位移增量同步给同组其他图层
          return syncGroupMembers(next, { dx: dx / renderScale, dy: dy / renderScale })
        })
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const from = toContainer(rect, dragStart.x, dragStart.y)
        const cur = toContainer(rect, e.clientX, e.clientY)
        const startDist = Math.sqrt((from.x - center.x) ** 2 + (from.y - center.y) ** 2)
        const curDist = Math.sqrt((cur.x - center.x) ** 2 + (cur.y - center.y) ** 2)
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          setLayerStates(prev => syncGroupMembers(
            { ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], scale: newScale } },
            { scaleFactor: newScale / (dragStartState.scale || 1) },
          ))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const from = toContainer(rect, dragStart.x, dragStart.y)
        const cur = toContainer(rect, e.clientX, e.clientY)
        const startAngle = Math.atan2(from.y - center.y, from.x - center.x)
        const curAngle = Math.atan2(cur.y - center.y, cur.x - center.x)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        setLayerStates(prev => syncGroupMembers(
          { ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], rotation: newRot } },
          { rotationDelta: newRot - dragStartState.rotation },
        ))
      }
    }
    const onMouseUp = () => { groupDragRef.current = null; setDragMode(null) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [dragMode, dragStart, dragStartState, activeLayerIdx, previewScale, previewRenderScale, device, getImageDisplay, getImageTransformCenter])

  /* ── 鼠标：松手时判定这次按下算不算一次「点击图片」，是就切换全屏预览 ──
     单独挂一套 window 监听，不并进上面那段依赖 dragMode 的拖动逻辑：
     那段要等 React 渲染完才挂上 mouseup，按得特别快的点击会抢在它前面（脚本化点击更是必然），
     结果就是「点了没反应」。这里常驻监听，只读 ref，所以不挑时序。
     只在移动端版式生效：PC 上的预览框没有「点一下放大到全屏」这套玩法，
     放进来的话点一次图片会把 previewExpanded 置真，指针位移换算全被那层缩放带偏。 */
  useEffect(() => {
    if (!isProUi || isProDesktop) return
    const onMove = (e: MouseEvent) => {
      const tap = mouseTapRef.current
      if (tap && (Math.abs(e.clientX - tap.x) > TAP_SLOP || Math.abs(e.clientY - tap.y) > TAP_SLOP)) {
        mouseTapMovedRef.current = true
      }
    }
    const onUp = () => {
      const tap = mouseTapRef.current
      mouseTapRef.current = null
      // 挪动过就只是拖动调图，不算点击。标记要一并复位，否则下一次点击会被上一次的拖动带偏。
      const moved = mouseTapMovedRef.current
      mouseTapMovedRef.current = false
      if (!tap || moved) return
      // 紧随其后的 click 丢掉：那一下本来会去取消选中图层
      suppressPreviewClickRef.current = true
      // 抽屉开着时，点预览框仍然是「收起抽屉」，和触摸那一路保持一致
      if (activeSheet) { setActiveSheet(null); return }
      togglePreviewExpanded()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isProUi, isProDesktop, activeSheet, togglePreviewExpanded])

  // 全局 touch drag
  useEffect(() => {
    if (!dragMode || activeLayerIdx === null) return
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      /** 预览框在抽屉展开 / 全屏放大时会整体缩放，指针位移要按「设备→屏幕」的总倍数还原回设备坐标系 */
      const renderScale = previewScale * previewRenderScale
      /** 指针坐标 → 容器坐标系（容器当前被 translate + scale 过，getBoundingClientRect 已含这两层） */
      const toContainer = (rect: DOMRect, cx: number, cy: number) => ({
        x: (cx - rect.left) / previewRenderScale,
        y: (cy - rect.top) / previewRenderScale,
      })
      // 双指手势有两种：Pro 界面用 'pinch'（只移动 + 缩放），旧版编辑器用 'pinch-rotate'（再带旋转）。
      // 两者走同一段换算，只有旋转那一项按模式取舍。
      if ((dragMode === 'pinch' || dragMode === 'pinch-rotate') && e.touches.length >= 2) {
        const t0 = e.touches[0], t1 = e.touches[1]
        const curDist = Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2)
        const curAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX)
        const startDist = (dragStart as any)._pinchDist || 1
        const startAngle = (dragStart as any)._pinchAngle || 0
        const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
        const cx = (t0.clientX + t1.clientX) / 2
        const cy = (t0.clientY + t1.clientY) / 2
        // 两指距离之比 = 缩放，两指中点的位移 = 移动（两种手势一次完成，不用分先后）
        const pinchScaleFactor = newScale / (dragStartState.scale || 1)
        const pinchRotationDelta = dragMode === 'pinch-rotate'
          ? (curAngle - startAngle) * (180 / Math.PI)
          : 0
        setLayerStates(prev => syncGroupMembers({
          ...prev,
          [activeLayerIdx]: {
            ...prev[activeLayerIdx],
            scale: newScale,
            // Pro 界面的双指手势不旋转：角度保持进入手势时的值
            rotation: dragStartState.rotation + pinchRotationDelta,
            position: { x: dragStartState.x + (cx - dragStart.x) / renderScale, y: dragStartState.y + (cy - dragStart.y) / renderScale },
          },
        }, {
          dx: (cx - dragStart.x) / renderScale,
          dy: (cy - dragStart.y) / renderScale,
          scaleFactor: pinchScaleFactor,
          rotationDelta: pinchRotationDelta,
        }))
        return
      }
      const touch = e.touches[0]
      const dx = touch.clientX - dragStart.x
      const dy = touch.clientY - dragStart.y
      if (dragMode === 'move') {
        const display = getImageDisplay(activeLayerIdx)
        const layer = device?.layers[activeLayerIdx]
        const raw = { x: dragStartState.x + dx / renderScale, y: dragStartState.y + dy / renderScale }
        const snapped = display && layer
          ? snapToEdges(raw.x + display.baseX, raw.y + display.baseY, display.dw, display.dh, dragStartState.scale, display.frameW, display.frameH)
          : raw
        setLayerStates(prev => {
          const next: Record<number, LayerState> = {
            ...prev,
            [activeLayerIdx]: {
              ...prev[activeLayerIdx],
              position: display ? { x: snapped.x - display.baseX, y: snapped.y - display.baseY } : snapped,
            },
          }
          // 成组联动：把这次位移增量同步给同组其他图层
          return syncGroupMembers(next, { dx: dx / renderScale, dy: dy / renderScale })
        })
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const from = toContainer(rect, dragStart.x, dragStart.y)
        const cur = toContainer(rect, touch.clientX, touch.clientY)
        const startDist = Math.sqrt((from.x - center.x) ** 2 + (from.y - center.y) ** 2)
        const curDist = Math.sqrt((cur.x - center.x) ** 2 + (cur.y - center.y) ** 2)
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          setLayerStates(prev => syncGroupMembers(
            { ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], scale: newScale } },
            { scaleFactor: newScale / (dragStartState.scale || 1) },
          ))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const center = getImageTransformCenter(activeLayerIdx, { x: dragStartState.x, y: dragStartState.y })
        const from = toContainer(rect, dragStart.x, dragStart.y)
        const cur = toContainer(rect, touch.clientX, touch.clientY)
        const startAngle = Math.atan2(from.y - center.y, from.x - center.x)
        const curAngle = Math.atan2(cur.y - center.y, cur.x - center.x)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        setLayerStates(prev => syncGroupMembers(
          { ...prev, [activeLayerIdx]: { ...prev[activeLayerIdx], rotation: newRot } },
          { rotationDelta: newRot - dragStartState.rotation },
        ))
      }
    }
    const onTouchEnd = () => {
      groupDragRef.current = null
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
    // 系统打断（来电、手势返回、手掌误触被系统取消）时不会来 touchend，
    // 漏掉的话 dragMode 会一直停在拖动状态，之后的触摸还会继续带着图片跑。
    window.addEventListener('touchcancel', onTouchEnd)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [dragMode, dragStart, dragStartState, activeLayerIdx, previewScale, previewRenderScale, device, getImageDisplay, getImageTransformCenter])

  // 滚轮缩放：PC 版式取消了角上的手柄，滚轮（及触屏双指）就是缩放图片的方式
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 纯横向的滚轮（触控板两指横滑）不该当成缩放
      const dir = Math.sign(e.deltaY)
      if (dir === 0) return
      // 没选中图层时退回到第一张已上传的图片：取消选中（点空白处）后滚不动会显得像坏了
      const states = layerStatesRef.current
      const fallbackIdx = interactiveLayers.find(({ realIdx }) => states[realIdx]?.imageUrl)?.realIdx
      // 「多图层同图」的组只有最上面那层能被操作：滚轮落在组内其他层时要转交给它，
      // 否则会缩放一张压在下面、用户根本点不中的图（同 resolveGroupAnchors 的约定）
      const groupAnchors = resolveGroupAnchors(device?.layers ?? [])
      const pickedIdx = activeLayerIdx ?? fallbackIdx
      const idx = pickedIdx == null ? undefined : (groupAnchors.get(pickedIdx) ?? pickedIdx)
      if (idx == null || !states[idx]) return
      e.preventDefault()
      // 按比例缩放：小图和大图每一格滚轮的视觉变化一致
      const factor = dir > 0 ? 1 / 1.08 : 1.08
      // 同组图层共用同一张用户图片，缩放必须整组一起动（移动端双指捏合走的就是 syncGroupMembers）。
      // 触到 0.1 / 5 倍的上下限时，按「实际生效的倍数」同步，组内不会越滚越不同步。
      const groupIdxs = getSharedUploadLayerIndexes(idx)
      setLayerStates(prev => {
        const s = prev[idx]
        if (!s) return prev
        const nextScale = Math.max(0.1, Math.min(5, s.scale * factor))
        const applied = s.scale > 0 ? nextScale / s.scale : 1
        const next: Record<number, LayerState> = { ...prev, [idx]: { ...s, scale: nextScale } }
        for (const memberIdx of groupIdxs) {
          if (memberIdx === idx) continue
          const member = prev[memberIdx]
          if (!member) continue
          next[memberIdx] = { ...member, scale: Math.max(0.1, Math.min(5, member.scale * applied)) }
        }
        return next
      })
      setActiveLayerIdx(idx)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // 依赖里必须带版式开关：三套版式各有自己的预览容器，
    // 切换版式（跨断点拉伸窗口、Pro 与旧版互换）会换掉这个 DOM 节点，
    // 依赖不变就不会重挂，滚轮缩放会直接失效。
  }, [activeLayerIdx, interactiveLayers, isProUi, isProDesktop, device, getSharedUploadLayerIndexes])

  /* ── 触摸：松手时判定这次单指触摸算不算一次「点击图片」，是就切换全屏预览 ── */
  useEffect(() => {
    if (!isProUi) return
    const onEnd = (e: TouchEvent) => {
      // 触摸结束这一下要记时间：紧随其后的那套补发鼠标事件（mouseup 等）不能被当成鼠标点击
      lastTouchAtRef.current = performance.now()
      const tap = tapRef.current
      tapRef.current = null
      if (!tap) return
      const touch = e.changedTouches[0]
      if (!touch) return
      if (Math.abs(touch.clientX - tap.x) > TAP_SLOP || Math.abs(touch.clientY - tap.y) > TAP_SLOP) return
      if (Date.now() - tap.t > TAP_HOLD_MS) return
      // 抽屉开着时，点预览框仍然是「收起抽屉」，不是放大预览
      if (activeSheet) { setActiveSheet(null); return }
      togglePreviewExpanded()
    }
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [isProUi, activeSheet, togglePreviewExpanded])

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
    const siblingIdxs = getSharedUploadLayerIndexes(layerIdx)
    const removedUrls = new Set(
      siblingIdxs
        .map(idx => layerStatesRef.current[idx]?.imageUrl)
        .filter((url): url is string => Boolean(url)),
    )
    setLayerStates(prev => {
      const next = { ...prev }
      for (const idx of siblingIdxs) delete next[idx]
      return next
    })
    removedUrls.forEach(url => URL.revokeObjectURL(url))

    const siblingSet = new Set(siblingIdxs)
    const hasOtherUploadedImage = interactiveLayers.some(
      ({ realIdx }) => !siblingSet.has(realIdx) && Boolean(layerStatesRef.current[realIdx]?.imageUrl),
    )
    if (!hasOtherUploadedImage) {
      setPickerColors({})
      setPickedColor({})
    }
    if (activeLayerIdx !== null && siblingSet.has(activeLayerIdx)) setActiveLayerIdx(null)
  }, [activeLayerIdx, interactiveLayers, getSharedUploadLayerIndexes])

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
    await Promise.all(sortedLayers.flatMap(({ layer, realIdx }) => {
      if (layer.type !== 'text') return []
      const style = resolveTextStyleWithOverride(layer, device.width, device.height, textAlignOverrides[realIdx])
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
    // Android WebView 上 canvas ctx.filter 会导致渲染全黑/旋转丢失，直接跳过
    const isAndroid = /android/i.test(navigator.userAgent)

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

    /**
     * 图片图层的「SVG 形状遮罩」（管理端上传的 SVG 源码）：把这一层的绘制先落到一块
     * 「图层方框大小」的离屏 canvas 上，再用 SVG 的可见形状 destination-in 裁掉形状之外的部分，
     * 最后整块贴回主画布。
     *
     * 不能用 clip 直接解决：用户上传的图片会被拖动、缩放，甚至移出图层方框，而形状固定在方框上。
     * 遮罩铺满图层方框（对应预览的 mask-size: 100% 100%），用户端预览、管理端预览与导出才会裁出同一个形状。
     * paint 拿到的是「已按方框偏移」的上下文，里面的坐标仍然可以照主画布写。
     * 传了 shadow 时投影跟着形状走（整块合成图作为一张按形状裁好的图贴回去，阴影由 canvas 生成）。
     */
    const drawWithSvgMask = async (
      maskSvg: string,
      box: { left: number; top: number; w: number; h: number },
      paint: (target: CanvasRenderingContext2D) => void,
      shadow?: { offsetX: number; offsetY: number; blur: number; color: string },
    ) => {
      const maskUri = svgShapeMaskDataUri(maskSvg)
      const regionX = Math.round(box.left)
      const regionY = Math.round(box.top)
      const regionW = Math.max(1, Math.round(box.w))
      const regionH = Math.max(1, Math.round(box.h))
      if (!maskUri) { paint(ctx); return }
      const layerCanvas = document.createElement('canvas')
      layerCanvas.width = regionW
      layerCanvas.height = regionH
      const layerCtx = layerCanvas.getContext('2d')
      if (!layerCtx) { paint(ctx); return }
      layerCtx.translate(-regionX, -regionY)
      paint(layerCtx)
      try {
        const maskImg = await loadImage(maskUri)
        layerCtx.setTransform(1, 0, 0, 1, 0, 0)
        layerCtx.globalAlpha = 1
        layerCtx.globalCompositeOperation = 'destination-in'
        layerCtx.drawImage(maskImg, 0, 0, regionW, regionH)
        layerCtx.globalCompositeOperation = 'source-over'
      } catch (error) {
        // 遮罩加载失败就退回整框绘制：宁可少一层裁剪，也不能让这一层整个消失
        console.warn('[TemplateEditor] SVG 形状遮罩加载失败，退回整框绘制:', error)
      }
      ctx.save()
      ctx.globalAlpha = 1
      if (shadow) {
        ctx.shadowOffsetX = shadow.offsetX
        ctx.shadowOffsetY = shadow.offsetY
        ctx.shadowBlur = shadow.blur
        ctx.shadowColor = shadow.color
      }
      ctx.drawImage(layerCanvas, regionX, regionY)
      ctx.restore()
    }

    for (const { layer, realIdx } of sortedLayers) {
      const css = {
        ...parseCssBlock(layer.css_code || ''),
        ...parseCssBlock(layer.css_position_code || ''),
      }
      // 特殊效果（透明度 / 背景模糊）对所有图层类型都生效，文字图层同样有管理端设置的背景模糊
      const fx = layer.effects
      const layerAlpha = fx && fx.opacity < 100 ? fx.opacity / 100 : parseFloat(css['opacity'] || '1')
      const skipByVisible = layer.visible_in_export === false
        || (layer.type === 'image' && layer.show_on_client === false && !layerStates[realIdx]?.imageUrl)

      if (skipByVisible) continue

      // ── 通用：解析矩形位置（CSS left/top/width/height，缺失时回退到 x/y 和 device 尺寸） ──
      // svg 图层用「内容矩形」：宽高取 SVG 文件自己声明的尺寸，背景模糊才会贴着图形本身，
      // 而不是落在一块 100×100 的兜底方框上。
      const rect = resolveLayerContentRect(layer, css, device.width, device.height)
      const left = rect.left * scale
      const top = rect.top * scale
      const w = rect.w * scale
      const h = rect.h * scale

      const borderRadiusPx = parseBorderRadius(resolveBorderRadius(css))
      const boxShadow = css['box-shadow'] || css['boxShadow']
      const cssRotation = resolveCssRotation(css.transform) // CSS transform 中的旋转角度

      /* ── 绘制圆角矩形路径的 helper ──
         带 SVG 形状遮罩的图层会先画进离屏 canvas，所以这里统一把「目标上下文」当参数传入（默认主画布）。 */
      const traceRoundRect = (lx: number, ly: number, rw: number, rh: number, br: number[], c: CanvasRenderingContext2D = ctx) => {
        // CSS 规范：当 border-radius 超过元素尺寸的一半时，浏览器会按比例缩小。
        // Canvas arcTo 不会自动 clamp，超限会导致 lineTo 目标点反向、路径自交叉（椭圆/胶囊形）。
        const maxR = Math.min(rw, rh) / 2
        let [tl, tr, br2, bl] = br.map(v => Math.min(v, maxR)) as [number, number, number, number]
        c.moveTo(lx + tl, ly)
        c.lineTo(lx + rw - tr, ly)
        c.arcTo(lx + rw, ly, lx + rw, ly + tr, tr)
        c.lineTo(lx + rw, ly + rh - br2)
        c.arcTo(lx + rw, ly + rh, lx + rw - br2, ly + rh, br2)
        c.lineTo(lx + bl, ly + rh)
        c.arcTo(lx, ly + rh, lx, ly + rh - bl, bl)
        c.lineTo(lx, ly + tl)
        c.arcTo(lx, ly, lx + tl, ly, tl)
        c.closePath()
      }
      const roundRect = (lx: number, ly: number, rw: number, rh: number, br: number[], c: CanvasRenderingContext2D = ctx) => {
        c.beginPath()
        traceRoundRect(lx, ly, rw, rh, br, c)
      }

      /* ── 图片图层裁剪：与预览保持一致 — 只用 border-radius，彻底忽略 CSS clip-path ── */
      const applyImageClip = (lx: number, ly: number, rw: number, rh: number, c: CanvasRenderingContext2D = ctx) => {
        if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          roundRect(lx, ly, rw, rh, br, c)
        } else {
          c.beginPath()
          c.rect(lx, ly, rw, rh)
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

      /* ── 背景模糊（毛玻璃）──
         canvas 没有 backdrop-filter：只能把这一层下方的画面取回来做软件模糊，再画图层自己。
         语义和预览里那个兄弟 overlay 完全一致（同样带 8% 白、同样受 SVG 遮罩裁剪），导出才不会与预览走样。
         取样范围只取图层自己的方框：Chrome 的 backdrop-filter 只能拿元素边框盒内的背景当模糊源，
         预览就是这个观感。曾经按 3σ 往外扩取样（想做"真实玻璃"），结果是同一个毛玻璃在预览里
         是「这一小块的平均色」、在导出里是「一大片区域的平均色」——半径越大差得越狠，
         158px 配 62×62 的小圆最夸张（预览近白、导出中灰）。所以这里不外扩，与预览逐像素对齐。
         box 用导出像素；cssW/cssH 是同一块框在设备坐标系下的尺寸，只有解析 clip-path 用得到。
         maskSvg 传 SVG 源码时，模糊只会留在 SVG 真正画出来的形状里（对应预览的 mask-image）。 */
      const applyBackdropBlur = async (
        blurPx: number,
        box: { left: number; top: number; w: number; h: number; cssW: number; cssH: number },
        maskSvg?: string,
      ) => {
        const regionX = Math.round(box.left)
        const regionY = Math.round(box.top)
        const regionW = Math.max(1, Math.round(box.w))
        const regionH = Math.max(1, Math.round(box.h))
        const sigma = blurPx * scale
        // 取样框就是图层方框本身（与预览的 backdrop-filter 同范围），越界时夹回画布：
        // 源矩形一旦越界，drawImage 会自己缩放，取回内容的坐标就错位了
        const sampleX = Math.max(0, regionX)
        const sampleY = Math.max(0, regionY)
        const sampleW = Math.min(canvas.width, regionX + regionW) - sampleX
        const sampleH = Math.min(canvas.height, regionY + regionH) - sampleY
        if (sampleW < 1 || sampleH < 1) return
        // createBlurredRegion 内部自带兜底：读不到像素（跨域污染 / WebView 限制 / 内存不足）
        // 或 putImageData 写不回去时，改用不读像素的降采样近似，绝不让模糊整块消失。
        // 底色用设备背景色：画布圆角外的透明像素一旦参与模糊，就会把模糊结果的 alpha 拉低，
        // 大半径下整块变成半透明，回填时下面没糊的画面透上来 —— 看着就是「没糊」。
        let blurCanvas = createBlurredRegion(canvas, sampleX, sampleY, sampleW, sampleH, sigma, device.background || '#FFFFFF')
        if (!blurCanvas) return

        // SVG 图层：模糊和那 8% 白都只在 SVG 的可见形状里，图层方框的透明部分不会被糊出方块。
        // 遮罩用的是「形状」（不透明度强制为 1），与预览的 mask-image 完全同一份数据。
        const maskUri = maskSvg ? svgShapeMaskDataUri(maskSvg) : undefined
        let whiteWashIncluded = false
        if (maskUri) {
          try {
            const maskImg = await loadImage(maskUri)
            const masked = document.createElement('canvas')
            masked.width = sampleW
            masked.height = sampleH
            const maskCtx = masked.getContext('2d')
            if (maskCtx) {
              maskCtx.drawImage(blurCanvas, 0, 0)
              maskCtx.globalCompositeOperation = 'destination-in'
              maskCtx.drawImage(maskImg, regionX - sampleX, regionY - sampleY, regionW, regionH)
              maskCtx.globalCompositeOperation = 'source-atop'
              maskCtx.fillStyle = 'rgba(255,255,255,0.08)'
              maskCtx.fillRect(0, 0, sampleW, sampleH)
              blurCanvas = masked
              whiteWashIncluded = true
            }
          } catch (error) {
            // SVG 挡不住就退回整框模糊，总比整个模糊消失强
            console.warn('[TemplateEditor] SVG 背景模糊遮罩加载失败，退回整框模糊:', error)
          }
        }

        ctx.save()
        const backdropClipPath = getClipPath(css)
        const backdropPoints = backdropClipPath ? parseClipPathToPoints(backdropClipPath, box.cssW, box.cssH) : null
        if (backdropPoints && backdropPoints.length > 1) {
          ctx.beginPath()
          ctx.moveTo(box.left + backdropPoints[0][0] * scale, box.top + backdropPoints[0][1] * scale)
          for (let i = 1; i < backdropPoints.length; i++) {
            ctx.lineTo(box.left + backdropPoints[i][0] * scale, box.top + backdropPoints[i][1] * scale)
          }
          ctx.closePath()
          ctx.clip()
        } else if (borderRadiusPx) {
          roundRect(box.left, box.top, box.w, box.h, borderRadiusPx.map(v => v * scale) as [number, number, number, number])
          ctx.clip()
        } else {
          ctx.beginPath()
          ctx.rect(box.left, box.top, box.w, box.h)
          ctx.clip()
        }
        ctx.drawImage(blurCanvas, sampleX, sampleY, sampleW, sampleH)
        if (!whiteWashIncluded) {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(box.left, box.top, box.w, box.h)
        }
        ctx.restore()
      }

      // 文字图层的位置/尺寸由排版决定，和 CSS 框不是一回事：背景模糊要糊的是文字框，
      // 跟预览里那个 overlay 用的是同一组数值（宽高缺失时回落到行高）。
      const textStyleForBlur = layer.type === 'text'
        ? resolveTextStyleWithOverride(layer, device.width, device.height, textAlignOverrides[realIdx])
        : null

      // ── CSS transform 旋转：与预览保持一致 ──
      const cssRotationRad = cssRotation * Math.PI / 180
      const hasLayerTransform = layer.type !== 'text' && (cssRotationRad !== 0 || layer.flip_horizontal || layer.flip_vertical)
      // 背景模糊：先把下方画面糊掉（在图层自己的 transform 之前做，模糊区域按未旋转的框取）
      // 模糊半径来自管理端「特殊效果」或图层 CSS 里的 backdrop-filter，两边都认（见 resolveBackdropBlurPx）。
      const backdropBlurPx = resolveBackdropBlurPx(layer, css)
      if (backdropBlurPx > 0) {
        // SVG 图层用自身形状裁剪；图片图层配了 SVG 形状遮罩时，毛玻璃同样只落在形状里
        const svgBlurMask = layer.type === 'svg'
          ? layer.css_code || ''
          : (layer.type === 'image' ? layer.mask_svg : undefined)
        await applyBackdropBlur(backdropBlurPx, textStyleForBlur
          ? {
              left: textStyleForBlur.visualLeft * scale,
              top: textStyleForBlur.visualTop * scale,
              w: (textStyleForBlur.width ?? 0) * scale,
              h: (textStyleForBlur.height ?? textStyleForBlur.lineHeightPx) * scale,
              cssW: textStyleForBlur.width ?? 0,
              cssH: textStyleForBlur.height ?? textStyleForBlur.lineHeightPx,
            }
          : { left, top, w, h, cssW: rect.w, cssH: rect.h }, svgBlurMask)
      }
      if (hasLayerTransform) {        ctx.save()
        const cx = left + w / 2, cy = top + h / 2
        ctx.translate(cx, cy)
        if (cssRotationRad !== 0) ctx.rotate(cssRotationRad)
        ctx.scale(layer.flip_horizontal ? -1 : 1, layer.flip_vertical ? -1 : 1)
        ctx.translate(-cx, -cy)
      }

      const uploadedState = layerStates[realIdx]
      if (uploadedState?.imageUrl) {
        try {
          const uploadedImage = await loadImage(uploadedState.imageUrl)
          // 管理端给这一层配了 SVG 形状遮罩：整层改用离屏合成（见 drawWithSvgMask）
          const uploadedMaskSvg = (layer.mask_svg || '').trim()

          /* 「这一层怎么画」集中成一处：有遮罩时它拿到的是离屏上下文，没有遮罩时就是主画布。 */
          const paintUploaded = (target: CanvasRenderingContext2D) => {
            target.globalAlpha = layerAlpha
            target.save()
            applyImageClip(left, top, w, h, target)
            target.clip()
            const drawRect = resolveImageDrawRect(
              uploadedImage.naturalWidth,
              uploadedImage.naturalHeight,
              { left: 0, top: 0, width: w, height: h },
              resolveUserImageFit(css['object-fit']),
              css['object-position'],
            )
            const imageCenterX = drawRect.left + drawRect.width / 2
            const imageCenterY = drawRect.top + drawRect.height / 2
            target.translate(left + imageCenterX + uploadedState.position.x * scale, top + imageCenterY + uploadedState.position.y * scale)
            target.rotate(uploadedState.rotation * Math.PI / 180)
            target.scale(uploadedState.scale, uploadedState.scale)
            // 图层 CSS 里的 filter（模板作者常用 blur 做磨砂背景）也要一起参与，否则导出与预览不一致。
            const exportCssFilter = css['filter'] || css['-webkit-filter']
            // 用户在「效果-图片效果」里新调的滤镜与模板自带滤镜走同一套数值
            const uploadedUserFx: UserImageFx | undefined = imageFx
            // 用户上传的是手机原图（动辄几千像素），导出时只画到几百像素。
            // 直接一次 drawImage 缩这么多倍会漏采样：细纹理（织物、发丝、纱窗、草地）
            // 会变成摩尔纹和锯齿，导出图上比编辑器预览明显更脏。
            // 先逐级折半到目标的 2 倍以内（每级正好 2:1，等于面积平均），
            // 最后一步缩放倍数 ≤2，配合下面的 quality='high' 就不会丢像素。
            const uploadedSource = shrinkToHalfLimit(
              uploadedImage,
              uploadedImage.naturalWidth,
              uploadedImage.naturalHeight,
              drawRect.width * uploadedState.scale,
              drawRect.height * uploadedState.scale,
            )
            // Android 的 ctx.filter 会静默失效，图片滤镜只能用软件像素处理（见 drawSoftwareFilteredImage）：
            // 它自己按「导出画布 1:1 的分辨率」把图片画上去，放大倍数 > 1 也不会变糊。
            const softwareFiltered = isAndroid
              && drawSoftwareFilteredImage(target, uploadedSource, drawRect.width, drawRect.height, layer, scale, uploadedUserFx, exportCssFilter)
            if (!softwareFiltered) {
              if (!isAndroid) target.filter = resolveImageFilterForExport(layer, exportCssFilter, scale, uploadedUserFx) || 'none'
              // canvas 默认 quality='low'（2×2 抽头），大倍数缩小时必须显式开到 high
              target.imageSmoothingEnabled = true
              target.imageSmoothingQuality = 'high'
              target.drawImage(uploadedSource, -drawRect.width / 2, -drawRect.height / 2, drawRect.width, drawRect.height)
              if (!isAndroid) target.filter = 'none'
            }
            target.restore()
          }

          if (uploadedMaskSvg) {
            await drawWithSvgMask(uploadedMaskSvg, { left, top, w, h }, paintUploaded, parsedShadow && !parsedShadow.inset
              ? {
                  offsetX: parsedShadow.offsetX * scale,
                  offsetY: parsedShadow.offsetY * scale,
                  blur: parsedShadow.blur * scale,
                  color: parsedShadow.color,
                }
              : undefined)
            // 合成完成后投影层（inset）仍按图层透明度绘制，与原路径一致
            ctx.globalAlpha = layerAlpha
          } else {
            if (parsedShadow && !parsedShadow.inset) {
              ctx.save()
              applyBoxShadow()
              applyImageClip(left, top, w, h)
              ctx.fillStyle = '#000'
              ctx.fill()
              ctx.restore()
              clearBoxShadow()
            }
            paintUploaded(ctx)
          }
          ctx.globalAlpha = 1
          drawInsetShadow()
        } catch (error) {
          console.error('[TemplateEditor] 用户上传图片导出失败:', uploadedState.imageUrl, error)
        }
        ctx.globalAlpha = 1
        if (hasLayerTransform) ctx.restore()
        continue
      }

      // ═══════════════════════════════════════════
      //  color / shape 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'color' || layer.type === 'shape') {
        // ── 填充颜色：直接复用预览的 cssToProps，保证导出与预览完全一致 ──
        const boxStyle = cssToProps(css) as Record<string, unknown>
        const bgColor = (boxStyle.backgroundColor as string) || ''
        // 原始 CSS 兜底：绕过 CSSOM 浏览器行为差异
        const paintPolicy = resolveBoxPaintPolicy(layer, css)
        const rawCssProps = paintPolicy.rawProps
        const rawBg = rawCssProps['background'] || rawCssProps['background-image'] || ''
        const bgImage = (boxStyle.backgroundImage as string) || (boxStyle.background as string) || rawBg || css['background-image'] || ''
        const isGradient = bgImage !== 'none' && /gradient\(/.test(bgImage)
        let fillColor: string
        if (isGradient) {
          fillColor = bgImage
        } else if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') {
          fillColor = bgColor
        } else if (layer.type !== 'shape' && layer.color && !css['background'] && !css['background-color'] && !css.backgroundColor) {
          fillColor = layer.color
        } else {
          fillColor = ''
        }
        if (layer.color_mode === 'picker' && pickedColor[realIdx]) {
          fillColor = layer.type === 'shape' && !paintPolicy.hasFill
            ? ''
            : fillColor.includes('gradient(')
              ? recolorLinearGradient(fillColor, pickedColor[realIdx]) || fillColor
              : pickedColor[realIdx]
        }
        const hasFill = fillColor && fillColor !== 'transparent' && fillColor !== 'rgba(0, 0, 0, 0)'
        ctx.globalAlpha = layerAlpha
        applyBoxShadow()

        const canvasGradient = hasFill
          ? createCanvasLinearGradient(ctx, fillColor, { left, top, width: w, height: h })
          : null
        // Canvas 不接受 CSS gradient 字符串。解析失败时宁可不填充，也不能沿用上一个图层的 fillStyle。
        const fillStyle: string | CanvasGradient | null = canvasGradient
          || (!/gradient\(/i.test(fillColor) ? fillColor : null)
        const hasRenderableFill = Boolean(fillStyle)

        const cpVal = getClipPath(css)
        if (cpVal) {
          const clipPts = parseClipPathToPoints(cpVal, rect.w, rect.h)
          if (clipPts) {
            ctx.save()
            ctx.translate(left, top)
            if (hasRenderableFill) { ctx.fillStyle = fillStyle!; fillClipPath(ctx, clipPts.map(p => [p[0] * scale, p[1] * scale])) }
            ctx.restore()
          }
        } else if (borderRadiusPx) {
          const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
          if (hasRenderableFill) { ctx.fillStyle = fillStyle!; roundRect(left, top, w, h, br); ctx.fill() }
        } else {
          if (hasRenderableFill) { ctx.fillStyle = fillStyle!; ctx.fillRect(left, top, w, h) }
        }

        // 绘制 border — CSSOM 和原始 CSS 双源兜底
        const rawBorderWidth = rawCssProps['border-width'] || rawCssProps['border-top-width'] || ''
        const rawBorderColor = rawCssProps['border-color'] || rawCssProps['border-top-color'] || ''
        const borderWidthRaw = css.borderTopWidth || css.borderWidth || css['border-top-width'] || rawBorderWidth || ''
        const borderColorRaw = css.borderTopColor || css.borderColor || css['border-top-color'] || rawBorderColor || ''
        const borderWidth = parseFloat(borderWidthRaw) || 0
        if (borderWidth > 0) {
          const borderColor = layer.type === 'shape' && layer.color_mode === 'picker' && !paintPolicy.hasFill && pickedColor[realIdx]
            ? pickedColor[realIdx]
            : borderColorRaw || '#000'
          ctx.strokeStyle = borderColor
          ctx.lineWidth = borderWidth * scale
          if (borderRadiusPx) {
            const br = borderRadiusPx.map(v => v * scale) as [number, number, number, number]
            roundRect(left, top, w, h, br)
          } else {
            ctx.beginPath()
            ctx.rect(left, top, w, h)
          }
          ctx.stroke()
        }

        clearBoxShadow()
        drawInsetShadow()
        ctx.globalAlpha = 1
        if (hasLayerTransform) ctx.restore()
        continue
      }

      // ═══════════════════════════════════════════
      //  text 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'text') {
        const text = (editedTexts[realIdx] ?? layer.text_content) || ''
        if (!text) { if (hasLayerTransform) ctx.restore(); continue }
        // 排版样式通常在上一步算背景模糊框时已经算过，这里直接复用同一份，避免两处漂移
        const textStyle = textStyleForBlur
          ?? resolveTextStyleWithOverride(layer, device.width, device.height, textAlignOverrides[realIdx])
        const fs = textStyle.fontSize * scale
        const lineHeight = textStyle.lineHeightPx * scale
        const boxLeft = textStyle.visualLeft * scale
        const boxTop = textStyle.visualTop * scale
        const boxWidth = (textStyle.width ?? 0) * scale
        const boxHeight = (textStyle.height ?? textStyle.lineHeightPx) * scale
        const lines = text.split('\n')
        const textBlockHeight = lines.length * lineHeight
        ctx.globalAlpha = layerAlpha
        ctx.fillStyle = layer.color_mode === 'picker' && pickedColor[realIdx] ? pickedColor[realIdx] : textStyle.color
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
        const strokeColor = layer.text_stroke_color_mode === 'picker' && pickedColor[realIdx]
          ? pickedColor[realIdx]
          : textStyle.textStrokeColor
        const strokeScale = textStyle.textStrokeWidth * scale
        const strokeRender = textStyle.textStrokeType === 'center' ? strokeScale : strokeScale * 2
        const drawStrokeLine = (line: string, y: number) => ctx.strokeText(line, tx, y)
        if (textStyle.textStrokeWidth > 0 && strokeColor) {
          ctx.strokeStyle = strokeColor
          if (textStyle.textStrokeType === 'inset') {
            // 内描边：先填充文字，再用文字形状作遮罩仅保留字形内部的描边
            lines.forEach((line, lineIndex) => ctx.fillText(line, tx, ty + lineIndex * lineHeight + baselineOffset))
            const pad = strokeRender * 2 + 2
            const maskWidth = Math.max(1, Math.ceil(boxWidth + pad * 2))
            const maskHeight = Math.max(1, Math.ceil(boxHeight + pad * 2))
            const maskCanvas = document.createElement('canvas')
            maskCanvas.width = maskWidth
            maskCanvas.height = maskHeight
            const maskCtx = maskCanvas.getContext('2d')
            if (maskCtx) {
              const offsetX = boxLeft - pad
              const offsetY = boxTop - pad
              maskCtx.font = ctx.font
              maskCtx.textAlign = ctx.textAlign
              maskCtx.textBaseline = ctx.textBaseline
              ;(maskCtx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
                (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing
              maskCtx.fillStyle = '#000'
              lines.forEach((line, lineIndex) =>
                maskCtx.fillText(line, tx - offsetX, ty + lineIndex * lineHeight + baselineOffset - offsetY))
              maskCtx.globalCompositeOperation = 'source-in'
              maskCtx.strokeStyle = strokeColor
              maskCtx.lineWidth = strokeRender
              maskCtx.lineJoin = 'round'
              lines.forEach((line, lineIndex) =>
                maskCtx.strokeText(line, tx - offsetX, ty + lineIndex * lineHeight + baselineOffset - offsetY))
              ctx.drawImage(maskCanvas, offsetX, offsetY)
            }
          } else {
            // 外描边线宽翻倍以补偿 fill 覆盖内侧一半；居中描边按设定值
            ctx.lineWidth = strokeRender
            ctx.lineJoin = 'round'
            lines.forEach((line, lineIndex) => drawStrokeLine(line, ty + lineIndex * lineHeight + baselineOffset))
            lines.forEach((line, lineIndex) => ctx.fillText(line, tx, ty + lineIndex * lineHeight + baselineOffset))
          }
        } else {
          lines.forEach((line, lineIndex) => ctx.fillText(line, tx, ty + lineIndex * lineHeight + baselineOffset))
        }
        ctx.lineWidth = 1
        clearBoxShadow()
        drawInsetShadow()
        ctx.globalAlpha = 1
        if (hasLayerTransform) ctx.restore()
        continue
      }

      // ═══════════════════════════════════════════
      //  svg 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'svg') {
        const svgCode = layer.css_code || ''
        if (!svgCode) { if (hasLayerTransform) ctx.restore(); continue }
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
          // SVG 数据 URI：必须补 xmlns，否则浏览器判定解码失败（SVG 图层在导出里会整块消失，
          // 只剩背景模糊的方框）；base64 编码避免 #/% 等字符在 URL 里被截断。
          const svgDataUri = svgToDataUri(finalSvg)
          if (!svgDataUri) { if (hasLayerTransform) ctx.restore(); continue }
          const svgImg = await loadImage(svgDataUri)
          // 绘制尺寸由 resolveLayerContentRect 统一算好（CSS → css_width/css_height → SVG 自带的
          // width/height/viewBox），和背景模糊用的是同一块框，两者不会再错位。
          const drawW = w
          const drawH = h
          ctx.globalAlpha = layerAlpha
          applyBoxShadow()
          ctx.drawImage(svgImg, left, top, drawW, drawH)
          clearBoxShadow()
          drawInsetShadow()
          ctx.globalAlpha = 1
        } catch (e) { console.error('[TemplateEditor] SVG 导出失败:', e) }
        if (hasLayerTransform) ctx.restore()
        continue
      }

      // ═══════════════════════════════════════════
      //  image 类型
      // ═══════════════════════════════════════════
      if (layer.type === 'image') {
        const imgUrl = layer.image_url
        if (!imgUrl) { if (hasLayerTransform) ctx.restore(); continue }

        try {
          const img = await loadImage(imgUrl)
          // 管理端给这一层配了 SVG 形状遮罩：模板自带的图片同样只显示在形状范围内
          const staticMaskSvg = (layer.mask_svg || '').trim()
          const paintStatic = (target: CanvasRenderingContext2D) => {
            target.globalAlpha = layerAlpha
            target.save()
            applyImageClip(left, top, w, h, target)
            target.clip()
            const drawRect = resolveImageDrawRect(
              img.naturalWidth,
              img.naturalHeight,
              { left, top, width: w, height: h },
              css['object-fit'],
              css['object-position'],
            )
            const imageCenterX = drawRect.left + drawRect.width / 2
            const imageCenterY = drawRect.top + drawRect.height / 2
            target.translate(imageCenterX, imageCenterY)
            target.rotate((layer.adjustments?.rotation ?? 0) * Math.PI / 180)
            target.scale(layer.adjustments?.scale ?? 1, layer.adjustments?.scale ?? 1)
            const staticCssFilter = css['filter'] || css['-webkit-filter']
            const staticScale = layer.adjustments?.scale ?? 1
            // 和用户上传图同样的处理：模板自带的照片也常常是几千像素，先折半再画（见上面那段注释）
            const staticSource = shrinkToHalfLimit(img, img.naturalWidth, img.naturalHeight, drawRect.width * staticScale, drawRect.height * staticScale)
            // 与用户上传图同一条路：Android 用软件像素处理，分辨率与导出画布 1:1（见 drawSoftwareFilteredImage）
            const softwareFiltered = isAndroid
              && drawSoftwareFilteredImage(target, staticSource, drawRect.width, drawRect.height, layer, scale, undefined, staticCssFilter)
            if (!softwareFiltered) {
              if (!isAndroid) target.filter = resolveImageFilterForExport(layer, staticCssFilter, scale) || 'none'
              target.imageSmoothingEnabled = true
              target.imageSmoothingQuality = 'high'
              target.drawImage(staticSource, -drawRect.width / 2, -drawRect.height / 2, drawRect.width, drawRect.height)
              if (!isAndroid) target.filter = 'none'
            }
            target.restore()
          }

          if (staticMaskSvg) {
            await drawWithSvgMask(staticMaskSvg, { left, top, w, h }, paintStatic, parsedShadow && !parsedShadow.inset
              ? {
                  offsetX: parsedShadow.offsetX * scale,
                  offsetY: parsedShadow.offsetY * scale,
                  blur: parsedShadow.blur * scale,
                  color: parsedShadow.color,
                }
              : undefined)
          } else {
            applyBoxShadow()
            paintStatic(ctx)
          }
          ctx.globalAlpha = 1
          clearBoxShadow()
          drawInsetShadow()
        } catch (e) { console.error('[TemplateEditor] 静态图片导出失败:', imgUrl, e) }
        ctx.globalAlpha = 1
        if (hasLayerTransform) ctx.restore()
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
      if (result.mode === 'gallery') {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err)
      setMsg(text || '保存失败')
      console.error('[TemplateEditor] 导出保存失败', err)
    } finally {
      setExporting(false)
    }
  }, [device, exporting, sortedLayers, layerStates, pickedColor, editedTexts, interactiveLayers, template, previewScale, imageFx, textAlignOverrides])

  const curCursor = dragMode
    ? (dragMode === 'move' ? 'grabbing' : dragMode.startsWith('rotate') ? 'crosshair' : 'nwse-resize')
    : 'default'
  const scaleCursor = (mode: DragMode) =>
    mode === 'scale-tl' || mode === 'scale-br' ? 'nwse-resize' : 'nesw-resize'

  /* ── 新版移动端界面（手环 Pro 系列）的派生数据 ── */
  // 「签名」标签当前编辑的文字图层：默认落在第一个文字图层
  const alignLayerIdx = alignTextIdx != null && textLayers.some(t => t.realIdx === alignTextIdx)
    ? alignTextIdx
    : (textLayers[0]?.realIdx ?? null)
  const alignLayer = alignLayerIdx != null ? device?.layers[alignLayerIdx] : undefined
  // 取色抽屉的色板：沿用第一个已提取到颜色的 picker 图层（与旧版行为一致）
  const paletteOwnerIdx = pickerColorLayers.find(({ realIdx }) => (pickerColors[realIdx]?.length ?? 0) > 0)?.realIdx ?? null
  const palette = paletteOwnerIdx != null ? (pickerColors[paletteOwnerIdx] || []) : []
  const paletteCurrent = paletteOwnerIdx != null ? pickedColor[paletteOwnerIdx] : undefined
  /** 取色作用于全部 picker 图层，和旧版一致；文字描边取色也跟随 */
  const setAllPickerColor = (color: string) => {
    setPickedColor(prev => {
      const next = { ...prev }
      for (const { realIdx } of pickerColorLayers) next[realIdx] = color
      return next
    })
  }
  const setAlign = (patch: TextAlignOverride) => {
    if (alignLayerIdx == null) return
    setTextAlignOverrides(prev => ({ ...prev, [alignLayerIdx]: { ...prev[alignLayerIdx], ...patch } }))
  }
  /** 排版按钮：单选，点哪个就只高亮哪个（水平/垂直各自独立生效，但指示只保留最后点的一个） */
  const pickAlign = (kind: AlignKind, patch: TextAlignOverride) => {
    setAlign(patch)
    setAlignKind(kind)
  }
  /** 上传图片：优先补第一个还没有图的交互图层，其次替换当前选中的图层 */
  const handleProUpload = () => {
    const empty = interactiveLayers.find(({ realIdx }) => !layerStates[realIdx]?.imageUrl)
    const target = empty?.realIdx ?? activeLayerIdx ?? interactiveLayers[0]?.realIdx
    if (target == null) return
    fileInputRefs.current[target]?.click()
  }
  const hasUploadedImage = uploadedImageIndexes.length > 0
  /** 「图片效果-模糊度」滑杆的上限由管理端写在模板里，缺省 50px */
  const blurMax = resolveBlurMax(template)
  /** 顶栏「重置 / 删除」作用的图层：优先当前选中，其次第一张已上传的图片。
   *  两个按钮上传后常驻，不要求先点中图层。 */
  const manageLayerIdx = activeLayerIdx != null && layerStates[activeLayerIdx]?.imageUrl
    ? activeLayerIdx
    : (uploadedImageIndexes[0] ?? null)
  /** 对比度 / 饱和度在数据里是「100 为中性」的百分比，滑杆上要显示成 ±（中点 0），所以进出都换算一次 */
  const toPercent = (signed: number) => signed + 100
  const toSigned = (percent: number) => percent - 100
  const formatSigned = (signed: number) => (signed > 0 ? `+${signed}` : `${signed}`)
  const alignButtons: { kind: AlignKind; patch: TextAlignOverride }[] = [
    { kind: 'left', patch: { h: 'left' } },
    { kind: 'hcenter', patch: { h: 'center' } },
    { kind: 'right', patch: { h: 'right' } },
    { kind: 'top', patch: { v: 'top' } },
    { kind: 'vcenter', patch: { v: 'middle' } },
    { kind: 'bottom', patch: { v: 'bottom' } },
  ]

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

  /* ═══════════════════════════════════════════════════════════
     新版桌面端界面（手环 Pro 系列）
     与移动端 Pro 是同一套编辑能力，版式换成旧版桌面那套「左侧预览框 + 右侧数据栏」：
     预览按可用区域等比缩放，右侧数据栏按站点整体风格排成卡片流，配色全部走主题变量。
     ═══════════════════════════════════════════════════════════ */
  if (isProDesktop) return (
    <div className={`h-dvh flex flex-col overflow-hidden${IS_OFFLINE ? ' safe-area-pad' : ''}`} style={{ background: 'var(--bg-primary)' }}>
      {!IS_OFFLINE && <Navbar />}

      <main className="flex-1 min-h-0 relative z-10 px-4 lg:px-6 py-4 lg:py-5">
        <div className="flex h-full min-h-0" style={{ gap: 20, maxWidth: 1440, margin: '0 auto' }}>

          {/* ── 左侧：预览编辑区 ── */}
          <section className="poolux-card flex-1 min-w-0 flex flex-col min-h-0">
            <div className="flex items-center flex-shrink-0" style={{ gap: 12, padding: '18px 20px 10px' }}>
              {!IS_OFFLINE ? (
                <Link
                  to="/tools/watch-face"
                  className="flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                >
                  <ArrowLeft className="w-4 h-4" style={{ color: 'var(--text-primary)' }} />
                </Link>
              ) : <div style={{ width: 4 }} />}
              <div className="flex-1 min-w-0">
                <h1 className="truncate" style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 570 }}>{template.name}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                  {device ? `${device.name} · ${device.width}×${device.height}px` : '请先选择设备'}
                </p>
              </div>
              <span className="hidden xl:inline" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {hasUploadedImage ? '拖动图片可平移，滚轮或双指手势可缩放' : '点击或拖拽图片到预览框即可上传'}
              </span>
            </div>

            {/* 预览区：可用尺寸由容器实时测量，画布始终按可用区域等比缩放（不超过 1:1） */}
            <div ref={previewWrapRef} className="flex-1 min-h-0 flex items-center justify-center" style={{ padding: 24 }}>
              {device ? (
                <div className="relative" style={{ width: containerWidth, height: containerHeight, cursor: curCursor }}>
                  {/* 预览框描边：贴在外框之内 2px，圆角与画布同心 */}
                  <div className="absolute pointer-events-none" style={{
                    left: vpLeft - 2, top: vpTop - 2,
                    width: previewWidth + 4, height: previewHeight + 4,
                    borderRadius: cornerRadius + 2,
                    border: '2px solid var(--frame-border)',
                    zIndex: 20,
                  }} />

                  <div
                    ref={containerRef}
                    className="absolute"
                    style={{ left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 21 }}
                    onClick={(e) => {
                      // 点交互图层时交给图层自己处理，避免误取消选中或弹出文件选择
                      if ((e.target as HTMLElement).closest('[data-interactive]')) return
                      if (activeLayerIdx !== null) { setActiveLayerIdx(null); return }
                      const firstEmpty = interactiveLayers.find(({ realIdx }) => !layerStates[realIdx]?.imageUrl)
                      if (firstEmpty) fileInputRefs.current[firstEmpty.realIdx]?.click()
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

                    <div className="absolute" style={{
                      left: vpLeft,
                      top: vpTop,
                      width: previewWidth,
                      height: previewHeight,
                      borderRadius: cornerRadius,
                      overflow: 'hidden',
                      clipPath: `inset(0 round ${cornerRadius}px)`,
                      WebkitClipPath: `inset(0 round ${cornerRadius}px)`,
                    }}>
                      {/* 未上传图片时只画一块比页面略深的占位、不画模板图层：
                          模板里铺满画布的形状否则看起来就像「已经有内容」，与移动端保持一致。 */}
                      <div className="absolute inset-0" style={{ background: hasUploadedImage ? (device.background || '#FFFFFF') : 'rgba(0, 0, 0, 0.06)' }} />
                      {hasUploadedImage && (
                        <WatchFaceLayerStack
                          device={device}
                          sortedLayers={sortedLayers}
                          previewScale={previewScale}
                          layerStates={layerStates}
                          pickedColor={pickedColor}
                          editedTexts={editedTexts}
                          imageFx={imageFxByLayer}
                          textAlignOverrides={textAlignOverrides}
                          backdropFilterOk={backdropFilterOk}
                          dragMode={dragMode}
                          activeLayerIdx={activeLayerIdx}
                          onActivateLayer={setActiveLayerIdx}
                          onLayerMouseDown={handleMouseDown}
                          onLayerTouchStart={handleTouchStart}
                          onRequestUpload={(realIdx) => fileInputRefs.current[realIdx]?.click()}
                          onSelectText={(realIdx) => {
                            setEditingTextIdx(realIdx)
                            setAlignTextIdx(realIdx)
                            setAlignKind(null)
                            setEditedTexts(prev => ({ ...prev, [realIdx]: prev[realIdx] ?? device.layers[realIdx]?.text_content ?? '' }))
                          }}
                        />
                      )}
                      {!hasUploadedImage && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <p style={{ fontSize: 14, color: isDragOver ? 'var(--accent)' : 'var(--text-muted)' }}>点击此处上传图片</p>
                        </div>
                      )}
                      {!hasUploadedImage && isDragOver && (
                        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 3px var(--accent)' }} />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>请先选择设备</p>
              )}
            </div>

            {/* 底部状态栏：缩放 / 旋转 / 偏移 */}
            <div className="flex items-center justify-center flex-wrap flex-shrink-0" style={{ gap: 8, padding: '0 20px 18px' }}>
              <div className="inline-flex items-center" style={{ gap: 6, padding: '4px 12px', borderRadius: 8, background: 'var(--accent-bg)' }}>
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>缩放</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {activeLayerIdx !== null && layerStates[activeLayerIdx] ? (layerStates[activeLayerIdx].scale * 100).toFixed(0) : '100'}%
                </span>
              </div>
              <div className="inline-flex items-center" style={{ gap: 6, padding: '4px 12px', borderRadius: 8, background: 'var(--accent-bg)' }}>
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>旋转</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {activeLayerIdx !== null && layerStates[activeLayerIdx] ? layerStates[activeLayerIdx].rotation.toFixed(1) : '0.0'}°
                </span>
              </div>
              {activeLayerIdx !== null && layerStates[activeLayerIdx] && (
                <div className="inline-flex items-center" style={{ gap: 6, padding: '4px 12px', borderRadius: 8, background: 'var(--accent-bg)' }}>
                  <span style={{ fontSize: 12, color: 'var(--accent)' }}>偏移</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {layerStates[activeLayerIdx].position.x.toFixed(0)}, {layerStates[activeLayerIdx].position.y.toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* ── 右侧：数据栏 ── */}
          <aside className="flex flex-col min-h-0 flex-shrink-0" style={{ width: 372, gap: 16 }}>
            <div className="flex flex-col min-h-0 no-scrollbar" style={{ gap: 16, flex: 1, overflowY: 'auto', paddingRight: 2 }}>

              <ProPanelCard
                title="目标设备"
                hint={template.devices.length > 1 ? '每个设备的编辑状态独立保存' : undefined}
              >
                {template.devices.length > 1 ? (
                  <div className="grid grid-cols-2" style={{ gap: 8 }}>
                    {template.devices.map((d, i) => (
                      <button key={i} type="button" onClick={() => setSelectedDeviceIdx(i)}
                        className="text-center transition-all duration-200"
                        style={{
                          padding: '8px 10px',
                          borderRadius: 12,
                          border: `1.5px solid ${selectedDeviceIdx === i ? 'var(--accent)' : 'var(--border-color)'}`,
                          background: selectedDeviceIdx === i ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                          color: selectedDeviceIdx === i ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: selectedDeviceIdx === i ? 600 : 400,
                          cursor: 'pointer',
                        }}>
                        <div style={{ fontSize: 13, lineHeight: 1.3 }}>{d.name}</div>
                        <div style={{ fontSize: 11, marginTop: 2, opacity: 0.75 }}>{d.width}×{d.height}px</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {device ? `${device.name} · ${device.width}×${device.height}px` : '请先选择设备'}
                  </p>
                )}
              </ProPanelCard>

              <ProPanelCard
                title="图片"
                hint={hasUploadedImage ? '效果滑杆对全部已上传图片生效' : '点击或拖拽图片到左侧预览框上传'}
              >
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    type="button"
                    onClick={handleProUpload}
                    disabled={interactiveLayers.length === 0}
                    className="poolux-btn poolux-btn-primary flex-1"
                    style={{ minHeight: 40, fontSize: 14, opacity: interactiveLayers.length === 0 ? 0.5 : 1, boxShadow: 'none' }}
                  >
                    <RiImageLine size={18} />
                    上传图片
                  </button>
                  {hasUploadedImage && manageLayerIdx != null && (
                    <>
                      <button
                        type="button"
                        title="恢复图片位置"
                        onClick={() => { hapticTick(); resetTransform(manageLayerIdx) }}
                        className="flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="删除图片"
                        onClick={() => { hapticTick(); clearImage(manageLayerIdx); setActiveLayerIdx(null) }}
                        className="flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--danger)', cursor: 'pointer' }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </ProPanelCard>

              <ProPanelCard title="图片效果" hint={hasUploadedImage ? undefined : '上传图片后生效'}>
                <div className="flex flex-col" style={{ gap: 23 }}>
                  <DesktopSlider
                    label="对比度" value={toSigned(imageFx.contrast ?? 100)} min={-100} max={100} step={1}
                    display={formatSigned(Math.round(toSigned(imageFx.contrast ?? 100)))} centerOrigin
                    onChange={(v) => setImageFx(prev => ({ ...prev, contrast: toPercent(v) }))}
                  />
                  <DesktopSlider
                    label="模糊度" value={imageFx.blur ?? 0} min={0} max={blurMax} step={1}
                    display={`${Math.round(imageFx.blur ?? 0)}px`} centerOrigin={false}
                    onChange={(v) => setImageFx(prev => ({ ...prev, blur: v }))}
                  />
                  <DesktopSlider
                    label="饱和度" value={toSigned(imageFx.saturation ?? 100)} min={-100} max={100} step={1}
                    display={formatSigned(Math.round(toSigned(imageFx.saturation ?? 100)))} centerOrigin
                    onChange={(v) => setImageFx(prev => ({ ...prev, saturation: toPercent(v) }))}
                  />
                </div>
              </ProPanelCard>

              <ProPanelCard
                title="签名"
                hint={textLayers.length === 0 ? '这个模板没有文字图层' : '选中文字图层后可改内容与排版'}
              >
                {textLayers.length > 0 && (
                  <>
                    {textLayers.length > 1 && (
                      <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
                        {textLayers.map(({ layer, realIdx }) => (
                          <button key={realIdx} type="button"
                            onClick={() => { setAlignTextIdx(realIdx); setAlignKind(null) }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              fontSize: 12,
                              cursor: 'pointer',
                              border: `1px solid ${alignLayerIdx === realIdx ? 'var(--accent)' : 'var(--border-color)'}`,
                              background: alignLayerIdx === realIdx ? 'var(--accent-bg)' : 'transparent',
                              color: alignLayerIdx === realIdx ? 'var(--accent)' : 'var(--text-secondary)',
                            }}>
                            {layer.name || `文字 ${realIdx + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                    {alignLayerIdx != null && alignLayer ? (
                      <>
                        <textarea
                          value={editedTexts[alignLayerIdx] ?? alignLayer.text_content ?? ''}
                          onFocus={() => setEditingTextIdx(alignLayerIdx)}
                          onBlur={() => setEditingTextIdx(null)}
                          onChange={e => setEditedTexts(prev => ({ ...prev, [alignLayerIdx]: e.target.value }))}
                          placeholder="输入签名文字"
                          rows={2}
                          className="w-full outline-none resize-none"
                          style={{
                            minHeight: 64,
                            padding: '12px 14px',
                            borderRadius: 12,
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-primary)',
                            border: `1px solid ${editingTextIdx === alignLayerIdx ? 'var(--accent)' : 'var(--border-color)'}`,
                            fontSize: 14,
                            lineHeight: '20px',
                          }}
                        />
                        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-primary)' }}>排版</div>
                        <div className="flex" style={{ gap: 8, marginTop: 10 }}>
                          {alignButtons.map(({ kind, patch }) => (
                            <DesktopAlignButton key={kind} kind={kind} active={alignKind === kind} onClick={() => pickAlign(kind, patch)} />
                          ))}
                        </div>
                      </>
                    ) : (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>点一下预览里的文字图层即可编辑</p>
                    )}
                  </>
                )}
              </ProPanelCard>

              <ProPanelCard
                title="颜色"
                hint={pickerColorLayers.length === 0
                  ? '这个模板没有可换色的图层'
                  : (palette.length === 0 ? '上传图片后自动提取配色' : undefined)}
              >
                {palette.length > 0 && (
                  <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
                    {palette.map(color => (
                      <button key={color} type="button" onClick={() => setAllPickerColor(color)} title={color}
                        style={{
                          width: 28, height: 28, borderRadius: '50%', background: color, flexShrink: 0, cursor: 'pointer',
                          border: paletteCurrent === color ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                          transform: paletteCurrent === color ? 'scale(1.1)' : undefined,
                        }} />
                    ))}
                  </div>
                )}
                {pickerColorLayers.length > 0 && (
                  <label className="flex items-center" style={{ marginTop: palette.length > 0 ? 14 : 0, height: 40, borderRadius: 12, background: 'var(--bg-tertiary)', padding: '0 14px', gap: 8, cursor: 'pointer' }}>
                    <Palette className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>自定义颜色</span>
                    <span style={{ marginLeft: 'auto', width: 22, height: 22, borderRadius: '50%', background: paletteCurrent || '#ffffff', border: '1px solid var(--border-color)' }} />
                    <input
                      type="color"
                      value={paletteCurrent || '#ffffff'}
                      onChange={(e) => setAllPickerColor(e.target.value)}
                      className="sr-only"
                    />
                  </label>
                )}
              </ProPanelCard>
            </div>

            {/* 导出：固定在数据栏底部，滚动面板时不跟着滚走 */}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !hasUploadedImage}
              className="poolux-btn poolux-btn-primary w-full flex-shrink-0"
              style={{ minHeight: 46, fontSize: 15, opacity: exporting || !hasUploadedImage ? 0.5 : 1, boxShadow: 'none' }}
            >
              <Download className="w-4 h-4" />
              {exporting ? '导出中…' : '导出图片'}
            </button>
          </aside>
        </div>
      </main>

      {(msg || preparingImage) && (
        <div className="fixed left-1/2 pointer-events-none" style={{
          transform: 'translateX(-50%)',
          bottom: 40,
          zIndex: 60,
          background: 'rgba(0,0,0,0.72)',
          color: '#ffffff',
          fontSize: 13,
          padding: '8px 16px',
          borderRadius: 999,
          maxWidth: '80vw',
        }}>
          {preparingImage ? '正在处理图片…' : msg}
        </div>
      )}

      {/* 导出成功弹窗（仅 Android 原生 App） */}
      {saveSuccess && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 9998, background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSaveSuccess(false)}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl shadow-xl"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              animation: 'fadeInScale 0.25s ease-out',
              minWidth: 220,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 56, height: 56,
                background: 'linear-gradient(135deg, #34d399, #10b981)',
                boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
              保存成功
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
              已保存到相册「POOLUX」
            </div>
          </div>
        </div>
      )}
    </div>
  )

  /* ═══════════════════════════════════════════════════════════
     新版移动端界面（手环 Pro 系列）
     布局取自 Figma 画板：顶栏 + 预览框 + 底部三个入口 + 底部抽屉
     ═══════════════════════════════════════════════════════════ */
  if (isProUi) return (
    // 安全区只在根节点上补一次（旧版是整块加 .safe-area-pad 类，顶栏里又算了一遍 env()，
    // 在沉浸式 APK 上状态栏高度被算了两次，整页被顶下去；底部那 34px 也不用补：
    // 底部入口栏自己的 paddingBottom 已经含了手势条，占位块也按实测高度留过白了）。
    <div
      className="h-dvh flex flex-col overflow-hidden relative"
      style={{
        background: PRO_PAGE_BG,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <div className="flex-1 flex flex-col min-h-0 w-full mx-auto" style={{ maxWidth: 430 }}>

        {/* 顶栏：返回 / 模板名 / 导出。抽屉展开或预览全屏放大时整块淡出（设计稿里展开后的画板没有顶栏，
            预览框上移后会盖到标题位置），留白高度不变，所以预览框的静置位置不会被顶栏带偏。 */}
        <div
          className="flex-shrink-0"
          style={{
            // 状态栏的避让由根节点的 paddingTop 负责，这里只留设计稿的 16px
            paddingTop: 16,
            opacity: activeSheet || previewExpanded ? 0 : 1,
            transition: 'opacity 0.24s ease',
            pointerEvents: activeSheet || previewExpanded ? 'none' : 'auto',
          }}
        >
          <div className="flex items-center justify-between px-4">
            {!IS_OFFLINE ? (
              <Link to="/tools/watch-face" className="flex items-center justify-center" style={proStrokeStyle(44)}>
                <ArrowLeft className="w-5 h-5" style={{ color: PRO_BUTTON_STROKE_COLOR }} />
              </Link>
            ) : (
              <div style={{ width: 44, height: 44 }} />
            )}
            <div className="flex items-center" style={{ gap: 10 }}>
              {/* 重置 / 删除当前图片：贴着导出按钮左侧排布。
                  上传后常驻，不必先点中图层——否则这两个按钮会突然出现在预览框角上，很突兀。 */}
              {hasUploadedImage && manageLayerIdx != null && (
                <>
                  <button
                    type="button"
                    onClick={() => { hapticTick(); resetTransform(manageLayerIdx) }}
                    className="flex items-center justify-center"
                    title="恢复图片位置"
                    style={proStrokeStyle(40)}
                  >
                    <RotateCcw className="w-4 h-4" style={{ color: PRO_BUTTON_STROKE_COLOR }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { hapticTick(); clearImage(manageLayerIdx); setActiveLayerIdx(null) }}
                    className="flex items-center justify-center"
                    title="删除图片"
                    style={proStrokeStyle(40)}
                  >
                    <Trash2 className="w-4 h-4" style={{ color: PRO_BUTTON_STROKE_COLOR }} />
                  </button>
                </>
              )}
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center justify-center transition-opacity"
                style={{ ...proStrokeStyle(44), opacity: exporting ? 0.5 : 1 }}
              >
                <Download className="w-5 h-5" style={{ color: PRO_BUTTON_STROKE_COLOR }} />
              </button>
            </div>
          </div>
          <div className="text-center px-12" style={{ marginTop: 9 }}>
            <div style={{ color: PRO_INK, fontSize: 24, fontWeight: 450, lineHeight: '32px' }}>{template.name}</div>
            <div style={{ color: PRO_DIM_INK, fontSize: 12, lineHeight: '16px', marginTop: 4 }}>双指滑动以缩放平移</div>
          </div>
          {template.devices.length > 1 && (
            <div className="flex justify-center flex-wrap" style={{ gap: 8, marginTop: 10 }}>
              {template.devices.map((d, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedDeviceIdx(i)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    fontSize: 12,
                    border: `1px solid ${PRO_BUTTON_STROKE_COLOR}`,
                    background: selectedDeviceIdx === i ? PRO_BUTTON_STROKE_COLOR : 'transparent',
                    color: selectedDeviceIdx === i ? '#ffffff' : PRO_INK,
                  }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 预览区：左右内边距 = 设计稿的 56 - PAD，容器自带 PAD 的把手空间，正好复刻设计稿的留白 */}
        <div
          ref={previewWrapRef}
          className="flex-1 min-h-0 flex items-center justify-center relative"
          style={{ padding: `20px ${56 - PAD}px` }}
          onClick={() => {
            if (activeSheet) { setActiveSheet(null); return }
            if (previewExpanded) setPreviewExpanded(false)
          }}
        >
          {device ? (
            <div
              ref={previewBoxRef}
              className="relative"
              style={{
                width: containerWidth,
                height: containerHeight,
                cursor: previewExpanded ? 'default' : curCursor,
                // 抽屉展开 / 全屏放大都只走 transform：位移和缩放不参与布局，
                // 所以预览框的尺寸不受动画影响，过渡也和抽屉上滑同一时长、同一曲线。
                // 全屏时先按屏幕中心缩放（transform-origin 是中心），再补一段位移把中心挪到屏幕正中。
                transform: previewExpanded
                  ? `translate(${previewExpandShiftX}px, ${previewExpandShiftY}px) scale(${previewExpandScale})`
                  : activeSheet
                    ? `translateY(${-previewShiftY}px) scale(${previewSheetScale})`
                    : 'translateY(0px) scale(1)',
                transition: `transform ${PRO_SHEET_DURATION}s ${PRO_SHEET_EASING}`,
              }}
            >
              <div className="absolute pointer-events-none" style={{
                left: vpLeft - 1, top: vpTop - 1,
                width: previewWidth + 2, height: previewHeight + 2,
                borderRadius: cornerRadius + 1,
                border: `1px solid ${PRO_HAIRLINE}`,
                zIndex: 20,
              }} />

              <div
                ref={containerRef}
                className="absolute"
                style={{ left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 21 }}
                onClick={(e) => {
                  // 上一次 mouseup 已经切换过全屏预览（按下图片、松手时手已经偏出图层，
                  // 于是 click 的落点变成容器本身）：这次 click 丢掉，否则会立刻又收回
                  if (suppressPreviewClickRef.current) { suppressPreviewClickRef.current = false; return }
                  if ((e.target as HTMLElement).closest('[data-interactive]')) return
                  if (previewExpanded) { setPreviewExpanded(false); return }
                  if (activeSheet) { setActiveSheet(null); return }
                  if (activeLayerIdx !== null) { setActiveLayerIdx(null); return }
                  const firstEmpty = interactiveLayers.find(({ realIdx }) => !layerStates[realIdx]?.imageUrl)
                  if (firstEmpty) fileInputRefs.current[firstEmpty.realIdx]?.click()
                }}
                // 每次在空处按下都先把上一条抑制标记清掉，避免它残留下来吞掉后面的点击
                onMouseDown={() => { suppressPreviewClickRef.current = false }}
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

                <div className="absolute" style={{
                  left: vpLeft,
                  top: vpTop,
                  width: previewWidth,
                  height: previewHeight,
                  borderRadius: cornerRadius,
                  overflow: 'hidden',
                  clipPath: `inset(0 round ${cornerRadius}px)`,
                  WebkitClipPath: `inset(0 round ${cornerRadius}px)`,
                }}>
                  {/* 未上传图片时对齐设计稿「主页（未上传图片）」：预览框是一块比页面略深的半透明占位
                      （设计稿节点 `用户端编辑预览框（未上传图片）`，无图片填充），
                      既不画模板自己的底色，也不画模板里的文字/形状图层 ——
                      否则模板里那块铺满画布的形状会直接看起来像「空预览框」，观感上和没改一样。
                      页面底色改为白色后，这里用 6% 黑代替原来的 9% 白，才能保持「比页面深一点」的观感。 */}
                  <div className="absolute inset-0" style={{ background: hasUploadedImage ? (device.background || '#FFFFFF') : 'rgba(0, 0, 0, 0.06)' }} />
                  {hasUploadedImage && (
                    <WatchFaceLayerStack
                      device={device}
                      sortedLayers={sortedLayers}
                      previewScale={previewScale}
                      layerStates={layerStates}
                      pickedColor={pickedColor}
                      editedTexts={editedTexts}
                      imageFx={imageFxByLayer}
                      textAlignOverrides={textAlignOverrides}
                      backdropFilterOk={backdropFilterOk}
                      dragMode={dragMode}
                      activeLayerIdx={activeLayerIdx}
                      onActivateLayer={setActiveLayerIdx}
                      onLayerMouseDown={handleMouseDown}
                      onLayerTouchStart={handleTouchStart}
                      onRequestUpload={(realIdx) => fileInputRefs.current[realIdx]?.click()}
                      onSelectText={(realIdx) => {
                        // 全屏放大时点文字只是收回预览，不从这里钻进「签名」抽屉
                        if (previewExpanded) { setPreviewExpanded(false); return }
                        setEditingTextIdx(realIdx)
                        setAlignTextIdx(realIdx)
                        setAlignKind(null)
                        setFxTab('text')
                        setActiveSheet('fx')
                        setEditedTexts(prev => ({ ...prev, [realIdx]: prev[realIdx] ?? device.layers[realIdx]?.text_content ?? '' }))
                      }}
                    />
                  )}
                  {/* 拖拽文件到预览框时给个落点提示（空白预览框里没有别的可见反馈） */}
                  {!hasUploadedImage && isDragOver && (
                    <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 0 3px ${PRO_ACCENT}` }} />
                  )}
                </div>

                {/* 缩放 / 旋转手柄（与旧版共用同一套坐标换算）。
                    移动端不显示四角的缩放柄：手指会直接挡住那个小圆点，
                    而且手机上有更顺手的双指手势（移动 + 缩放，见 handleTouchStart），
                    所以这里统一用 md 断点只在桌面端显示，和下面的旋转柄保持一致。 */}
                {(() => {
                  const idx = activeLayerIdx ?? interactiveLayers.find(({ realIdx }) => layerStates[realIdx]?.imageUrl)?.realIdx
                  if (idx == null) return null
                  const st = layerStates[idx]
                  if (!st?.imageUrl) return null
                  const al = device.layers[idx]
                  const acss = getLayerCss(al)
                  const arect = resolveLayerRect(al, acss, device.width, device.height)
                  const imageDisplay = getImageDisplay(idx)
                  const imgW = imageDisplay?.dw ?? arect.w
                  const imgH = imageDisplay?.dh ?? arect.h
                  const cx = arect.w / 2 + (imageDisplay?.baseX ?? 0) + st.position.x
                  const cy = arect.h / 2 + (imageDisplay?.baseY ?? 0) + st.position.y
                  const hw = imgW / 2 * st.scale
                  const hh = imgH / 2 * st.scale
                  const rad = (st.rotation * Math.PI) / 180
                  const cosA = Math.cos(rad), sinA = Math.sin(rad)
                  const toPreview = (dx: number, dy: number) => ({
                    x: vpLeft + (arect.left + dx) * previewScale,
                    y: vpTop + (arect.top + dy) * previewScale,
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
                        <div className="hidden md:block absolute" style={{ left: p1.x - HANDLE_R, top: p1.y - HANDLE_R, width: HANDLE_R * 2, height: HANDLE_R * 2, borderRadius: '50%', background: PRO_ACCENT, border: '2.5px solid white', cursor: scaleCursor(mode), boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
                          onMouseDown={(e) => handleScaleMouseDown(idx, mode, e)} onTouchStart={(e) => handleScaleTouchStart(idx, mode, e)} />
                        <div className="hidden md:block absolute" style={{ left: rpx - ROT_HANDLE_R, top: rpy - ROT_HANDLE_R, width: ROT_HANDLE_R * 2, height: ROT_HANDLE_R * 2, borderRadius: '50%', cursor: 'crosshair' }}
                          onMouseDown={(e) => handleScaleMouseDown(idx, rotMode, e)} onTouchStart={(e) => handleScaleTouchStart(idx, rotMode, e)} />
                        <svg className="hidden md:block absolute pointer-events-none" width="22" height="22" style={{ left: rpx - 11, top: rpy - 11 }} viewBox="0 0 24 24" fill="none">
                          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" fill={PRO_ACCENT} />
                        </svg>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          ) : (
            <p style={{ color: PRO_DIM_INK, fontSize: 14 }}>请先选择设备</p>
          )}
        </div>

        {/* 底部占位：不管抽屉开合，这里始终按入口栏的高度留白。
            预览区高度因此不会被抽屉挤动，预览框尺寸保持不变（设计稿展开前后都是 291×416）。 */}
        <div className="flex-shrink-0" style={{ height: actionBarHeight || 108 }} aria-hidden="true" />
      </div>

      {/* 底部区域：入口按钮和抽屉叠在预览区之上（绝对定位，不参与上面的布局）。
          容器本身不裁剪：抽屉收起时是「整体往下滑出屏幕」，靠外层根节点的 overflow 兜住，
          容器跟着一起变矮的话会把还在下滑的面板从顶边切掉，看起来像被吃掉而不是滑走。
          高度只在开合两态间切换，不参与动画，避免无意中挡住预览区的手势。 */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          marginLeft: 'auto',
          marginRight: 'auto',
          maxWidth: 430,
          zIndex: 40,
          height: activeSheet ? sheetHeight : (actionBarHeight || 108),
        }}
      >
          {/* 三个入口按钮：抽屉展开 / 预览全屏放大时淡出，收起时立刻显形。
              收起时不再延迟：面板正从按钮底下滑走，按钮要一直在面板之上，
              这样看到的是「面板钻到按钮下面去」，而不是面板原地渐变消失。 */}
          <div
            ref={actionBarRef}
            className="absolute left-0 right-0 bottom-0 flex items-start justify-center"
            style={{
              zIndex: 2,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 30px)',
              opacity: activeSheet || previewExpanded ? 0 : 1,
              transition: 'opacity 0.16s ease',
              pointerEvents: activeSheet || previewExpanded ? 'none' : 'auto',
            }}
          >
            <ProActionButton
              icon={<RiImageLine size={24} color={PRO_BUTTON_STROKE_COLOR} />}
              label="上传图片"
              onClick={handleProUpload}
              disabled={interactiveLayers.length === 0}
            />
            {/* 设计稿 `Rectangle 2`：只在上传图片与取色之间有一条竖分割线 */}
            <ProActionDivider />
            <ProActionButton
              icon={<RiDropperLine size={24} color={PRO_BUTTON_STROKE_COLOR} />}
              label="取色"
              onClick={() => { setActiveSheet('color'); setActiveLayerIdx(null) }}
              disabled={pickerColorLayers.length === 0}
            />
            <div aria-hidden style={{ width: PRO_ACTION_GAP }} />
            <ProActionButton
              icon={<RiColorFilterLine size={24} color={PRO_BUTTON_STROKE_COLOR} />}
              label="效果"
              onClick={() => { setActiveSheet('fx'); setActiveLayerIdx(null) }}
            />
          </div>

          {/* 抽屉：始终挂载，收起时整体平移到屏幕下方。
              始终挂载有两个好处：收起动画有「上一帧位置」可过渡；第一次展开也能直接滑上来
              （只在展开时才挂载的话，首帧没有起始位置，浏览器会直接跳到位、看不到动画）。 */}
          <div
            ref={sheetBoxRef}
            className="absolute left-0 right-0 bottom-0"
            aria-hidden={!activeSheet}
            style={{
              zIndex: 1,
              // 收起时按自身高度的 100% 往下推，而不是用实测出来的像素值：
              // 像素值在「刚挂载、ResizeObserver 还没回调」或安全区变化的那一帧会是旧的，
              // 面板就露出一条浅灰边（贴在页面底部，看起来像一块莫名其妙的灰色区域）。
              // 百分比永远等于自己当前的真实高度，收起即完全出屏。
              transform: activeSheet ? 'translateY(0)' : 'translateY(100%)',
              transition: `transform ${PRO_SHEET_DURATION}s ${PRO_SHEET_EASING}`,
              pointerEvents: activeSheet ? 'auto' : 'none',
            }}
          >
              <ProSheet minHeight={PRO_SHEET_MIN_HEIGHT[sheetKindForLayout]} onClose={() => setActiveSheet(null)}>
                {sheetKindForLayout === 'fx' ? (
              <>
                <div style={{ paddingTop: 25 }}>
                  <ProSegmented<'image' | 'text'>
                    value={fxTab}
                    onChange={setFxTab}
                    items={[{ value: 'image', label: '图片效果' }, { value: 'text', label: '签名' }]}
                  />
                </div>
                {/* 两个面板叠在同一个网格单元里、始终挂载：切换时靠 translateX 左右平移，
                    进来的从一侧推入、出去的从另一侧退出，和分段控件底块的移动方向一致。
                    始终挂载还顺带解决了滑杆的另一个毛病：面板重挂载会让 ProFxSlider 先按
                    兜底宽度画一帧、量到真实宽度后再跳一下（「位移一下」的来源）。 */}
                <div style={{ display: 'grid', overflow: 'hidden' }}>
                  <div
                    aria-hidden={fxTab !== 'image'}
                    style={{
                      gridArea: '1 / 1',
                      padding: '0 30px',
                      transform: `translateX(${fxTab === 'image' ? 0 : -100}%)`,
                      // 平移之外再加一层淡入淡出：只靠平移、两块内容又都是灰底滑杆时，
                      // 边界会显得很硬；淡淡地交叠一下，切换看起来才是「换页」而不是「硬切」
                      opacity: fxTab === 'image' ? 1 : 0,
                      transition: `transform ${PRO_TAB_DURATION}s ${PRO_TAB_EASING}, opacity ${PRO_TAB_DURATION}s ${PRO_TAB_EASING}`,
                    }}
                  >
                    <ProFxSlider
                      label="对比度" value={toSigned(imageFx.contrast ?? 100)} min={-100} max={100} step={1}
                      display={formatSigned(Math.round(toSigned(imageFx.contrast ?? 100)))} centerOrigin
                      onChange={(v) => setImageFx(prev => ({ ...prev, contrast: toPercent(v) }))}
                    />
                    <ProFxSlider
                      label="模糊度" value={imageFx.blur ?? 0} min={0} max={blurMax} step={1}
                      display={`${Math.round(imageFx.blur ?? 0)}px`} centerOrigin={false}
                      onChange={(v) => setImageFx(prev => ({ ...prev, blur: v }))}
                    />
                    <ProFxSlider
                      label="饱和度" value={toSigned(imageFx.saturation ?? 100)} min={-100} max={100} step={1}
                      display={formatSigned(Math.round(toSigned(imageFx.saturation ?? 100)))} centerOrigin
                      onChange={(v) => setImageFx(prev => ({ ...prev, saturation: toPercent(v) }))}
                    />
                  </div>
                  <div
                    aria-hidden={fxTab !== 'text'}
                    style={{
                      gridArea: '1 / 1',
                      padding: '0 18px',
                      transform: `translateX(${fxTab === 'text' ? 0 : 100}%)`,
                      opacity: fxTab === 'text' ? 1 : 0,
                      transition: `transform ${PRO_TAB_DURATION}s ${PRO_TAB_EASING}, opacity ${PRO_TAB_DURATION}s ${PRO_TAB_EASING}`,
                    }}
                  >
                    <div style={{ marginTop: 12, color: PRO_INK, fontSize: 16, fontWeight: 450, lineHeight: '21px' }}>签名</div>
                    {textLayers.length > 1 && (
                      <div className="flex flex-wrap" style={{ gap: 8, marginTop: 10 }}>
                        {textLayers.map(({ layer, realIdx }) => (
                          <button
                            key={realIdx}
                            onClick={() => { setAlignTextIdx(realIdx); setAlignKind(null) }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              fontSize: 12,
                              border: `1px solid ${alignLayerIdx === realIdx ? PRO_ACCENT : PRO_BUTTON_STROKE_COLOR}`,
                              background: alignLayerIdx === realIdx ? PRO_ACCENT : 'transparent',
                              color: alignLayerIdx === realIdx ? '#ffffff' : PRO_INK,
                            }}
                          >
                            {layer.name || `文字 ${realIdx + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                    {alignLayerIdx != null && alignLayer ? (
                      <>
                        <textarea
                          value={editedTexts[alignLayerIdx] ?? alignLayer.text_content ?? ''}
                          onFocus={() => setEditingTextIdx(alignLayerIdx)}
                          onBlur={() => setEditingTextIdx(null)}
                          onChange={e => setEditedTexts(prev => ({ ...prev, [alignLayerIdx]: e.target.value }))}
                          placeholder="输入签名文字"
                          className="pro-sign-textarea"
                          style={{
                            marginTop: 15,
                            width: '100%',
                            height: 61,
                            borderRadius: 20,
                            background: 'rgba(0,0,0,0.10)',
                            border: 'none',
                            outline: 'none',
                            // 全局 `textarea:focus` 会加一圈主题色光晕，这里按设计去掉
                            boxShadow: 'none',
                            resize: 'none',
                            padding: '20px 16px',
                            fontSize: 16,
                            lineHeight: '21px',
                            color: PRO_INK,
                          }}
                        />
                        <div style={{ marginTop: 21, color: PRO_INK, fontSize: 16, fontWeight: 450, lineHeight: '21px' }}>排版</div>
                        <div className="flex justify-between" style={{ marginTop: 15, gap: 12 }}>
                          {alignButtons.map(({ kind, patch }) => (
                            <ProAlignButton
                              key={kind}
                              kind={kind}
                              active={alignKind === kind}
                              onClick={() => pickAlign(kind, patch)}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <p style={{ marginTop: 15, fontSize: 13, color: 'rgba(19,19,19,0.55)' }}>这个模板没有文字图层</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: '0 30px' }}>
                <div style={{ marginTop: 35, color: PRO_INK, fontSize: 16, fontWeight: 450, lineHeight: '21px' }}>颜色</div>
                {palette.length > 0 ? (
                  <div className="flex justify-between" style={{ marginTop: 14 }}>
                    {palette.map(color => (
                      <button
                        key={color}
                        onClick={() => setAllPickerColor(color)}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 20,
                          background: color,
                          flexShrink: 0,
                          border: paletteCurrent === color ? `2px solid ${PRO_ACCENT}` : '1px solid rgba(0,0,0,0.12)',
                          transform: paletteCurrent === color ? 'scale(1.12)' : undefined,
                        }}
                        title={color}
                      />
                    ))}
                  </div>
                ) : (
                  <p style={{ marginTop: 14, fontSize: 13, color: 'rgba(19,19,19,0.55)' }}>上传图片后自动提取配色</p>
                )}
                <label className="flex items-center" style={{ marginTop: 26, height: 44, borderRadius: 22, background: 'rgba(0,0,0,0.08)', padding: '0 16px', gap: 8, cursor: 'pointer' }}>
                  <Palette className="w-4 h-4" style={{ color: PRO_INK }} />
                  <span style={{ color: PRO_INK, fontSize: 14 }}>自定义颜色</span>
                  <span style={{ marginLeft: 'auto', width: 22, height: 22, borderRadius: 11, background: paletteCurrent || '#ffffff', border: '1px solid rgba(0,0,0,0.15)' }} />
                  <input
                    type="color"
                    value={paletteCurrent || '#ffffff'}
                    onChange={(e) => setAllPickerColor(e.target.value)}
                    className="sr-only"
                  />
                </label>
                </div>
                )}
              </ProSheet>
          </div>
      </div>

      {(msg || preparingImage) && (
        <div className="fixed left-1/2 pointer-events-none" style={{
          transform: 'translateX(-50%)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)',
          zIndex: 60,
          background: 'rgba(0,0,0,0.72)',
          color: '#ffffff',
          fontSize: 13,
          padding: '8px 16px',
          borderRadius: 999,
          maxWidth: '80vw',
        }}>
          {preparingImage ? '正在处理图片…' : msg}
        </div>
      )}

      {/* 导出成功弹窗（仅 Android 原生 App） */}
      {saveSuccess && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 9998, background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSaveSuccess(false)}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl shadow-xl"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              animation: 'fadeInScale 0.25s ease-out',
              minWidth: 220,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 56, height: 56,
                background: 'linear-gradient(135deg, #34d399, #10b981)',
                boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
              保存成功
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
              已保存到相册「POOLUX」
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className={`h-dvh flex flex-col overflow-hidden${IS_OFFLINE ? ' safe-area-pad' : ''}`} style={{ background: 'var(--bg-primary)' }}>
      {!IS_OFFLINE && <Navbar />}

      <main className="flex-1 relative z-10 overflow-auto">
        <div className="min-h-full lg:h-full px-4 lg:px-6 py-4 lg:py-5">
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-5 lg:h-full">

            {/* 左侧 - 预览编辑区 */}
            <div className="lg:col-span-2 flex flex-col rounded-lg lg:h-full lg:max-h-none lg:min-h-0" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
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
                            <div className="absolute" style={{
                              left: vpLeft,
                              top: vpTop,
                              width: previewWidth,
                              height: previewHeight,
                              borderRadius: cornerRadius,
                              overflow: 'hidden',
                              clipPath: `inset(0 round ${cornerRadius}px)`,
                              WebkitClipPath: `inset(0 round ${cornerRadius}px)`,
                            }}>
                              <div className="absolute inset-0" style={{ background: device.background || '#FFFFFF' }} />
                              <WatchFaceLayerStack
                                device={device}
                                sortedLayers={sortedLayers}
                                previewScale={previewScale}
                                layerStates={layerStates}
                                pickedColor={pickedColor}
                                editedTexts={editedTexts}
                                backdropFilterOk={backdropFilterOk}
                                dragMode={dragMode}
                                activeLayerIdx={activeLayerIdx}
                                onActivateLayer={setActiveLayerIdx}
                                onLayerMouseDown={handleMouseDown}
                                onLayerTouchStart={handleTouchStart}
                                onRequestUpload={(realIdx) => fileInputRefs.current[realIdx]?.click()}
                                onSelectText={(realIdx) => {
                                  setEditingTextIdx(realIdx)
                                  setEditedTexts(prev => ({ ...prev, [realIdx]: prev[realIdx] ?? device.layers[realIdx]?.text_content ?? '' }))
                                }}
                              />

                            </div>

                            {/* 缩放/旋转手柄 — 始终显示在有图片的交互图层上 */}
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
                    {/* 取第一个有颜色数据的 picker 图层作为色板来源 */}
                    {(() => {
                      const firstPicker = pickerColorLayers.find(({ realIdx }) => pickerColors[realIdx]?.length > 0)
                      if (!firstPicker) return null
                      const { realIdx: firstIdx } = firstPicker
                      const currentColor = pickedColor[firstIdx]
                      const setAllPickerColor = (color: string) => {
                        setPickedColor(prev => {
                          const next = { ...prev }
                          for (const { realIdx } of pickerColorLayers) next[realIdx] = color
                          return next
                        })
                      }
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {(pickerColors[firstIdx] || []).map(color => (
                            <button key={color} onClick={() => setAllPickerColor(color)}
                              className="w-7 h-7 rounded-full transition-all duration-200 flex-shrink-0"
                              style={{
                                background: color,
                                border: `2.5px solid ${currentColor === color ? 'var(--accent)' : 'var(--border-color)'}`,
                                transform: currentColor === color ? 'scale(1.15)' : 'scale(1)',
                              }} title={color} />
                          ))}
                          <label className="w-7 h-7 rounded-full cursor-pointer flex-shrink-0 flex items-center justify-center"
                            style={{ background: currentColor || '#fff', border: '2.5px solid var(--border-color)' }}>
                            <input type="color" value={currentColor || '#ffffff'}
                              onChange={(e) => setAllPickerColor(e.target.value)}
                              className="sr-only" />
                            <Palette className="w-3 h-3" style={{ color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
                          </label>
                        </div>
                      )
                    })()}
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

                {(msg || preparingImage) && (
                  <div className="text-xs text-center py-1" style={{ color: 'var(--accent)' }}>{preparingImage ? '正在处理图片…' : msg}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 导出成功弹窗（仅 Android 原生 App） */}
      {saveSuccess && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 9998, background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSaveSuccess(false)}
        >
          <div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl shadow-xl"
            style={{
              background: 'var(--bg-secondary)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              animation: 'fadeInScale 0.25s ease-out',
              minWidth: 220,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 成功图标 */}
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 56, height: 56,
                background: 'linear-gradient(135deg, #34d399, #10b981)',
                boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
              保存成功
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
              已保存到相册「POOLUX」
            </div>
          </div>
        </div>
      )}
    </div>
  )
}