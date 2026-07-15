import { useState, useRef, useCallback, useEffect } from 'react'
import { Navbar } from '@/components/Navbar'
import { snapToEdges } from '@/lib/snapToEdges'
import { ArrowLeft, Upload, X, RotateCcw, Download, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

// 固定设备：手环Pro 336x480
const DEVICE = { width: 336, height: 480, cornerRadius: 48 }

// 装饰元素布局（device 坐标系）
// 设计图：三张白色卡片居中堆叠，轻微旋转，底部 dock 栏
const CARDS = [
  { left: 40, top: 33, w: 256, h: 350, rotate: -3, r: 3 },   // 卡片3(底)
  { left: 40, top: 33, w: 256, h: 350, rotate: 0, r: 3 },    // 卡片2(中)
  { left: 40, top: 33, w: 256, h: 350, rotate: 3, r: 3 },    // 卡片1(顶)
]
const DOCK = { left: 31, top: 405, w: 274, h: 55, r: 20 }
const CARD_COLOR = '#F2F2F2'
const CARD_SHADOW = '0px 0px 5px rgba(0, 0, 0, 0.25)'

// 背景图缩放倍数
const BG_SCALE = 2

// 顶层照片框（device 坐标系）
const PHOTO_FRAME = { left: 54.6, top: 47.6, w: 226.8, h: 302.4, rotate: 3, r: 3.6 }

type DragMode = 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate-tl' | 'rotate-tr' | 'rotate-bl' | 'rotate-br' | 'pinch-rotate'

/** 双指旋转松手时，角度距 90° 整数倍在 15° 以内则自动吸附 */
function snapRotation(deg: number): number {
  const nearest = Math.round(deg / 90) * 90
  return Math.abs(deg - nearest) < 5 ? nearest : deg
}

const PAD = 20
const HANDLE_R = 7
const ROT_HANDLE_R = 6
const ROT_HANDLE_OFFSET = 36
const EXPORT_SCALE = 2

export function WatchFaceEditLayerUI() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [imgNaturalW, setImgNaturalW] = useState(0)
  const [imgNaturalH, setImgNaturalH] = useState(0)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const [imageScale, setImageScale] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)
  const [dragMode, setDragMode] = useState<DragMode | null>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragStartState, setDragStartState] = useState({ x: 0, y: 0, scale: 1, rotation: 0 })
  const [isDragOver, setIsDragOver] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewWrapRef = useRef<HTMLDivElement>(null)
  const [wrapSize, setWrapSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth - 80 : 300, h: typeof window !== 'undefined' ? window.innerHeight - 260 : 400 })
  const [winSize, setWinSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 375, h: typeof window !== 'undefined' ? window.innerHeight : 667 })

  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setUploadedImage(url)
    setImagePosition({ x: 0, y: 0 })
    setImageScale(1)
    setImageRotation(0)
  }, [])

  const handleClearImage = useCallback(() => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage)
    setUploadedImage(null)
    setImgNaturalW(0)
    setImgNaturalH(0)
    setImagePosition({ x: 0, y: 0 })
    setImageScale(1)
    setImageRotation(0)
  }, [uploadedImage])

  useEffect(() => {
    if (!uploadedImage) return
    const img = new Image()
    img.onload = () => { setImgNaturalW(img.naturalWidth); setImgNaturalH(img.naturalHeight) }
    img.src = uploadedImage
  }, [uploadedImage])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragOver(false), [])

  const isMobile = winSize.w < 1024
  const rawAvailW = isMobile
    ? Math.max(160, winSize.w - 72)
    : Math.max(200, (winSize.w - 136) * 2 / 3)
  const rawAvailH = isMobile
    ? Math.max(200, winSize.h - 220)
    : Math.max(200, winSize.h - 200)
  const maxAvailW = wrapSize.w > 0 ? Math.min(rawAvailW, wrapSize.w - PAD * 2) : rawAvailW
  const maxAvailH = wrapSize.h > 0 ? Math.min(rawAvailH, wrapSize.h - PAD * 2) : rawAvailH

  const previewScale = Math.min(maxAvailW / DEVICE.width, maxAvailH / DEVICE.height, 1)
  const previewWidth = DEVICE.width * previewScale
  const previewHeight = DEVICE.height * previewScale
  const cornerRadius = DEVICE.cornerRadius * previewScale

  const imgW = (imgNaturalW && imgNaturalH
    ? imgNaturalW * Math.max(previewWidth / imgNaturalW, previewHeight / imgNaturalH)
    : previewWidth) * BG_SCALE
  const imgH = (imgNaturalW && imgNaturalH
    ? imgNaturalH * Math.max(previewWidth / imgNaturalW, previewHeight / imgNaturalH)
    : previewHeight) * BG_SCALE
  const imgW1x = imgNaturalW && imgNaturalH
    ? imgNaturalW * Math.max(previewWidth / imgNaturalW, previewHeight / imgNaturalH)
    : previewWidth
  const imgH1x = imgNaturalW && imgNaturalH
    ? imgNaturalH * Math.max(previewWidth / imgNaturalW, previewHeight / imgNaturalH)
    : previewHeight

  const containerWidth = previewWidth + PAD * 2
  const containerHeight = previewHeight + PAD * 2
  const vpLeft = (containerWidth - previewWidth) / 2
  const vpTop = (containerHeight - previewHeight) / 2

  const imgCenterX = vpLeft + previewWidth / 2 + imagePosition.x
  const imgCenterY = vpTop + previewHeight / 2 + imagePosition.y
  const vpCenterX = vpLeft + previewWidth / 2
  const vpCenterY = vpTop + previewHeight / 2

  const getImageCorners = useCallback((cx: number, cy: number, scale: number, rotation: number) => {
    const hw = (imgW1x * scale) / 2
    const hh = (imgH1x * scale) / 2
    const rad = (rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return [
      { x: cx + (-hw) * cos - (-hh) * sin, y: cy + (-hw) * sin + (-hh) * cos, mode: 'scale-tl' as DragMode },
      { x: cx + hw * cos - (-hh) * sin, y: cy + hw * sin + (-hh) * cos, mode: 'scale-tr' as DragMode },
      { x: cx + (-hw) * cos - hh * sin, y: cy + (-hw) * sin + hh * cos, mode: 'scale-bl' as DragMode },
      { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos, mode: 'scale-br' as DragMode },
    ]
  }, [imgW1x, imgH1x])

  const currentCorners = getImageCorners(imgCenterX, imgCenterY, imageScale, imageRotation)

  const currentRotHandles = currentCorners.map((c) => {
    const dx = c.x - vpCenterX - imagePosition.x
    const dy = c.y - vpCenterY - imagePosition.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const rotMode = c.mode.replace('scale-', 'rotate-') as DragMode
    return {
      x: c.x + (dx / len) * ROT_HANDLE_OFFSET,
      y: c.y + (dy / len) * ROT_HANDLE_OFFSET,
      mode: rotMode,
    }
  })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!uploadedImage) return
    e.preventDefault()
    setDragMode('move')
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
  }, [uploadedImage, imagePosition, imageScale, imageRotation])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!uploadedImage) return
    if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      setDragMode('pinch-rotate')
      setDragStart({
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
        _pinchDist: Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2),
        _pinchAngle: Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
      } as any)
      setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
      return
    }
    const touch = e.touches[0]
    setDragMode('move')
    setDragStart({ x: touch.clientX, y: touch.clientY })
    setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
  }, [uploadedImage, imagePosition, imageScale, imageRotation])

  const handleScaleMouseDown = useCallback((mode: DragMode, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDragMode(mode)
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
  }, [imagePosition, imageScale, imageRotation])

  const handleScaleTouchStart = useCallback((mode: DragMode, e: React.TouchEvent) => {
    e.stopPropagation()
    const touch = e.touches[0]
    setDragMode(mode)
    setDragStart({ x: touch.clientX, y: touch.clientY })
    setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
  }, [imagePosition, imageScale, imageRotation])

  useEffect(() => {
    if (!dragMode) return
    const onMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      if (dragMode === 'move') {
        const raw = { x: dragStartState.x + dx, y: dragStartState.y + dy }
        setImagePosition(snapToEdges(raw.x, raw.y, imgW1x, imgH1x, imageScale, previewWidth, previewHeight,
          PHOTO_FRAME.left * previewScale, PHOTO_FRAME.top * previewScale,
          (PHOTO_FRAME.left + PHOTO_FRAME.w) * previewScale, (PHOTO_FRAME.top + PHOTO_FRAME.h) * previewScale))
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const startDist = Math.sqrt(
          (dragStart.x - rect.left - vpCenterX - dragStartState.x) ** 2 +
          (dragStart.y - rect.top - vpCenterY - dragStartState.y) ** 2
        )
        const curDist = Math.sqrt(
          (e.clientX - rect.left - vpCenterX - dragStartState.x) ** 2 +
          (e.clientY - rect.top - vpCenterY - dragStartState.y) ** 2
        )
        if (startDist > 0) {
          setImageScale(Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist))))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const cx = vpCenterX + dragStartState.x
        const cy = vpCenterY + dragStartState.y
        const startAngle = Math.atan2(dragStart.y - rect.top - cy, dragStart.x - rect.left - cx)
        const curAngle = Math.atan2(e.clientY - rect.top - cy, e.clientX - rect.left - cx)
        setImageRotation(dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI))
      }
    }
    const onMouseUp = () => setDragMode(null)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragMode, dragStart, dragStartState, vpCenterX, vpCenterY])

  useEffect(() => {
    if (!dragMode) return
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (dragMode === 'pinch-rotate' && e.touches.length >= 2) {
        const t0 = e.touches[0], t1 = e.touches[1]
        const curDist = Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2)
        const curAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX)
        const startDist = (dragStart as any)._pinchDist || 1
        const startAngle = (dragStart as any)._pinchAngle || 0
        setImageScale(Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist))))
        setImageRotation(dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI))
        const cx = (t0.clientX + t1.clientX) / 2
        const cy = (t0.clientY + t1.clientY) / 2
        setImagePosition({ x: dragStartState.x + cx - dragStart.x, y: dragStartState.y + cy - dragStart.y })
        return
      }
      const touch = e.touches[0]
      const dx = touch.clientX - dragStart.x
      const dy = touch.clientY - dragStart.y
      if (dragMode === 'move') {
        const raw = { x: dragStartState.x + dx, y: dragStartState.y + dy }
        setImagePosition(snapToEdges(raw.x, raw.y, imgW1x, imgH1x, imageScale, previewWidth, previewHeight,
          PHOTO_FRAME.left * previewScale, PHOTO_FRAME.top * previewScale,
          (PHOTO_FRAME.left + PHOTO_FRAME.w) * previewScale, (PHOTO_FRAME.top + PHOTO_FRAME.h) * previewScale))
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const startDist = Math.sqrt(
          (dragStart.x - rect.left - vpCenterX - dragStartState.x) ** 2 +
          (dragStart.y - rect.top - vpCenterY - dragStartState.y) ** 2
        )
        const curDist = Math.sqrt(
          (touch.clientX - rect.left - vpCenterX - dragStartState.x) ** 2 +
          (touch.clientY - rect.top - vpCenterY - dragStartState.y) ** 2
        )
        if (startDist > 0) {
          setImageScale(Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist))))
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const cx = vpCenterX + dragStartState.x
        const cy = vpCenterY + dragStartState.y
        const startAngle = Math.atan2(dragStart.y - rect.top - cy, dragStart.x - rect.left - cx)
        const curAngle = Math.atan2(touch.clientY - rect.top - cy, touch.clientX - rect.left - cx)
        setImageRotation(dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI))
      }
    }
    const onTouchEnd = () => {
      if (dragMode === 'pinch-rotate') setImageRotation(prev => snapRotation(prev))
      setDragMode(null)
    }
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [dragMode, dragStart, dragStartState, vpCenterX, vpCenterY])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setImageScale(prev => Math.max(0.1, Math.min(5, prev + (e.deltaY > 0 ? -0.08 : 0.08))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const resetTransform = useCallback(() => {
    setImagePosition({ x: 0, y: 0 })
    setImageRotation(0)
  }, [])

  const drawCard = (ctx: CanvasRenderingContext2D, card: typeof CARDS[0], scale: number) => {
    // 旋转锚点：卡片中心（与 CSS transformOrigin: center center 一致）
    const cx = card.left * scale + (card.w * scale) / 2
    const cy = card.top * scale + (card.h * scale) / 2
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(card.rotate * Math.PI / 180)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.shadowBlur = 5 * scale
    ctx.fillStyle = CARD_COLOR
    ctx.beginPath()
    ctx.roundRect(-card.w * scale / 2, -card.h * scale / 2, card.w * scale, card.h * scale, card.r * scale)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.restore()
  }

  const handleExport = useCallback(async () => {
    if (!uploadedImage || !imgNaturalW || !imgNaturalH) return
    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve) => {
      const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.src = src
    })
    const img = await loadImage(uploadedImage)
    const canvas = document.createElement('canvas')
    const exportW = DEVICE.width * EXPORT_SCALE
    const exportH = DEVICE.height * EXPORT_SCALE
    canvas.width = exportW
    canvas.height = exportH
    const ctx = canvas.getContext('2d')!
    const scale = exportW / DEVICE.width

    // 圆角裁切
    const r = DEVICE.cornerRadius * scale
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.lineTo(exportW - r, 0)
    ctx.arcTo(exportW, 0, exportW, r, r)
    ctx.lineTo(exportW, exportH - r)
    ctx.arcTo(exportW, exportH, exportW - r, exportH, r)
    ctx.lineTo(r, exportH)
    ctx.arcTo(0, exportH, 0, exportH - r, r)
    ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
    ctx.closePath(); ctx.clip()

    // 黑色背景
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, exportW, exportH)

    // 用户图片（背景，2倍放大）
    const displayImgW = imgNaturalW * Math.max(exportW / imgNaturalW, exportH / imgNaturalH) * BG_SCALE
    const displayImgH = imgNaturalH * Math.max(exportW / imgNaturalW, exportH / imgNaturalH) * BG_SCALE
    // 照片框用 1x 尺寸
    const displayImgW1x = imgNaturalW * Math.max(exportW / imgNaturalW, exportH / imgNaturalH)
    const displayImgH1x = imgNaturalH * Math.max(exportW / imgNaturalW, exportH / imgNaturalH)
    ctx.save()
    ctx.translate(exportW / 2 + imagePosition.x * scale / previewScale, exportH / 2 + imagePosition.y * scale / previewScale)
    ctx.rotate(imageRotation * Math.PI / 180)
    ctx.scale(imageScale, imageScale)
    ctx.filter = `contrast(1.18) saturate(1.37) blur(${40 * scale}px)`
    ctx.drawImage(img, -displayImgW / 2, -displayImgH / 2, displayImgW, displayImgH)
    ctx.filter = 'none'
    ctx.restore()

    // 三张卡片（从底到顶）
    for (const card of CARDS) drawCard(ctx, card, scale)

    // dock 栏
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)'
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 4 * scale
    ctx.shadowBlur = 12 * scale
    ctx.fillStyle = CARD_COLOR
    ctx.beginPath()
    ctx.roundRect(DOCK.left * scale, DOCK.top * scale, DOCK.w * scale, DOCK.h * scale, DOCK.r * scale)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.restore()

    // dock 装饰条
    ctx.fillStyle = 'rgba(48, 48, 48, 1)'
    ctx.beginPath()
    ctx.roundRect(179 * scale, 421 * scale, 4 * scale, 22 * scale, 11 * scale)
    ctx.fill()

    // 顶层照片框
    const pfX = PHOTO_FRAME.left * scale
    const pfY = PHOTO_FRAME.top * scale
    const pfW = PHOTO_FRAME.w * scale
    const pfH = PHOTO_FRAME.h * scale
    const pfR = PHOTO_FRAME.r * scale
    ctx.save()
    ctx.translate(pfX + pfW / 2, pfY + pfH / 2)
    ctx.rotate(PHOTO_FRAME.rotate * Math.PI / 180)
    ctx.translate(-(pfX + pfW / 2), -(pfY + pfH / 2))
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.roundRect(pfX, pfY, pfW, pfH, pfR)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.clip()
    // 同步变换：照片框用 1x（无模糊）
    ctx.save()
    ctx.translate(exportW / 2 + imagePosition.x * scale / previewScale, exportH / 2 + imagePosition.y * scale / previewScale)
    ctx.rotate(imageRotation * Math.PI / 180)
    ctx.scale(imageScale, imageScale)
    ctx.drawImage(img, -displayImgW1x / 2, -displayImgH1x / 2, displayImgW1x, displayImgH1x)
    ctx.restore()
    ctx.restore()

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'watchface-layerui.png'; a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [uploadedImage, imagePosition, imageScale, imageRotation, imgNaturalW, imgNaturalH, previewScale])

  const curCursor = dragMode
    ? (dragMode === 'move' ? 'grabbing' : dragMode.startsWith('rotate') ? 'crosshair' : 'nwse-resize')
    : 'default'

  const scaleCursor = (mode: DragMode) =>
    mode === 'scale-tl' || mode === 'scale-br' ? 'nwse-resize' : 'nesw-resize'

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>

      <Navbar />

      <main className="flex-1 relative z-10 overflow-auto lg:overflow-hidden">
        <div className="min-h-full lg:h-full px-4 lg:px-6 py-4 lg:py-5">
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-5 lg:h-full">

            {/* 左侧 - 预览编辑区 */}
            <div className="lg:col-span-2 flex flex-col rounded-lg lg:h-full lg:max-h-none lg:min-h-0 lg:overflow-hidden" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3 px-4 lg:px-5 pt-4 lg:pt-5 pb-2 flex-shrink-0">
                <Link to="/tools/watch-face" className="p-2 rounded-md transition-all duration-200" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <ArrowLeft className="w-4 h-4" style={{ color: 'var(--text-primary)' }} />
                </Link>
                <h3 className="text-sm lg:text-base font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
                  预览 - Layer UI
                </h3>
                {uploadedImage && (
                  <button onClick={handleClearImage} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div ref={previewWrapRef} className="flex-1 flex items-center justify-center p-4 lg:p-6 min-h-0">
                <div
                  className="relative mx-auto"
                  style={{ width: containerWidth, height: containerHeight, cursor: curCursor }}
                >
                  {/* 深色描边 + 阴影 */}
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: vpLeft - 4, top: vpTop - 4,
                      width: previewWidth + 8, height: previewHeight + 8,
                      borderRadius: cornerRadius + 4,
                      border: '4px solid var(--frame-border)',
                      boxShadow: 'none',
                      zIndex: 20,
                    }}
                  />

                  <div
                    ref={containerRef}
                    className="absolute"
                    style={{ left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 21 }}
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                    onClick={() => { if (!uploadedImage) fileInputRef.current?.click() }}
                  >
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = '' }} />

                    {uploadedImage ? (
                      <>
                        {/* 裁切遮罩层 */}
                        <div
                          className="absolute"
                          style={{ left: vpLeft, top: vpTop, width: previewWidth, height: previewHeight, borderRadius: cornerRadius, overflow: 'hidden' }}
                        >
                          {/* 设备区域背景 */}
                          <div className="absolute inset-0" style={{ background: '#111', borderRadius: cornerRadius }} />

                          {/* 背景图（仅视觉，1.5x 模糊） */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: (previewWidth - imgW) / 2,
                              top: (previewHeight - imgH) / 2,
                              width: imgW,
                              height: imgH,
                              transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) rotate(${imageRotation}deg) scale(${imageScale})`,
                              transformOrigin: 'center center',
                            }}
                          >
                            <img
                              src={uploadedImage}
                              alt="背景"
                              className="w-full h-full pointer-events-none select-none"
                              draggable={false}
                              style={{ filter: 'contrast(1.18) saturate(1.37) blur(40px)' }}
                            />
                          </div>

                          {/* 三张卡片（从底到顶） */}
                          {CARDS.map((card, i) => (
                            <div
                              key={i}
                              className="absolute pointer-events-none"
                              style={{
                                left: card.left * previewScale,
                                top: card.top * previewScale,
                                width: card.w * previewScale,
                                height: card.h * previewScale,
                                borderRadius: card.r * previewScale,
                                background: CARD_COLOR,
                                transform: card.rotate ? `rotate(${card.rotate}deg)` : undefined,
                                transformOrigin: 'center center',
                                boxShadow: CARD_SHADOW,
                              }}
                            />
                          ))}

                          {/* dock 栏 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: DOCK.left * previewScale,
                              top: DOCK.top * previewScale,
                              width: DOCK.w * previewScale,
                              height: DOCK.h * previewScale,
                              borderRadius: DOCK.r * previewScale,
                              background: CARD_COLOR,
                              boxShadow: CARD_SHADOW,
                            }}
                          />

                          {/* dock 装饰条 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: 179 * previewScale,
                              top: 421 * previewScale,
                              width: 4 * previewScale,
                              height: 22 * previewScale,
                              background: 'rgba(48, 48, 48, 1)',
                              borderRadius: 11 * previewScale,
                            }}
                          />

                          {/* 模板装饰图 */}
                          <img
                            src="/muban/layerui.webp"
                            className="absolute pointer-events-none select-none"
                            draggable={false}
                            style={{
                              left: 49.55 * previewScale,
                              top: 347 * previewScale,
                              width: 237.55 * previewScale,
                              height: 102 * previewScale,
                            }}
                          />

                          {/* 顶层照片框 */}
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: PHOTO_FRAME.left * previewScale,
                              top: PHOTO_FRAME.top * previewScale,
                              width: PHOTO_FRAME.w * previewScale,
                              height: PHOTO_FRAME.h * previewScale,
                              borderRadius: PHOTO_FRAME.r * previewScale,
                              background: '#111',
                              transform: `rotate(${PHOTO_FRAME.rotate}deg)`,
                              transformOrigin: 'center center',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              className="absolute"
                              style={{
                                left: (previewWidth - imgW1x) / 2 - PHOTO_FRAME.left * previewScale,
                                top: (previewHeight - imgH1x) / 2 - PHOTO_FRAME.top * previewScale,
                                width: imgW1x,
                                height: imgH1x,
                                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) rotate(${imageRotation}deg) scale(${imageScale})`,
                                transformOrigin: 'center center',
                              }}
                            >
                              <img
                                src={uploadedImage}
                                alt="照片层"
                                className="w-full h-full pointer-events-none select-none"
                                draggable={false}
                              />
                            </div>
                          </div>
                        </div>

                        {/* 交互层（透明，捕获鼠标/触摸事件） */}
                        <div
                          className="absolute"
                          style={{
                            left: vpLeft,
                            top: vpTop,
                            width: previewWidth,
                            height: previewHeight,
                            zIndex: 22,
                            cursor: dragMode === 'move' ? 'grabbing' : dragMode ? (dragMode.startsWith('rotate') ? 'crosshair' : 'nwse-resize') : 'grab',
                          }}
                          onMouseDown={handleMouseDown}
                          onTouchStart={handleTouchStart}
                        />

                        {/* 缩放柄 + 旋转柄 */}
                        {currentCorners.map((corner, i) => {
                          const rot = currentRotHandles[i]
                          const lineDx = rot.x - corner.x
                          const lineDy = rot.y - corner.y
                          return (
                            <div key={corner.mode} style={{ position: 'absolute', zIndex: 25 }}>
                              <svg
                                className="hidden md:block absolute pointer-events-none"
                                style={{
                                  left: Math.min(corner.x, rot.x) - 2,
                                  top: Math.min(corner.y, rot.y) - 2,
                                  width: Math.abs(lineDx) + 4,
                                  height: Math.abs(lineDy) + 4,
                                  overflow: 'visible',
                                }}
                              >
                                <line
                                  x1={corner.x - Math.min(corner.x, rot.x) + 2}
                                  y1={corner.y - Math.min(corner.y, rot.y) + 2}
                                  x2={rot.x - Math.min(corner.x, rot.x) + 2}
                                  y2={rot.y - Math.min(corner.y, rot.y) + 2}
                                  stroke="rgba(72,120,144,0.4)"
                                  strokeWidth="1.5"
                                  strokeDasharray="4 3"
                                />
                              </svg>

                              <div
                                className="absolute"
                                style={{
                                  left: corner.x - HANDLE_R,
                                  top: corner.y - HANDLE_R,
                                  width: HANDLE_R * 2,
                                  height: HANDLE_R * 2,
                                  borderRadius: '50%',
                                  background: 'var(--accent)',
                                  border: '2.5px solid white',
                                  cursor: scaleCursor(corner.mode),
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                }}
                                onMouseDown={(e) => handleScaleMouseDown(corner.mode, e)}
                                onTouchStart={(e) => handleScaleTouchStart(corner.mode, e)}
                              />

                              <div
                                className="hidden md:block absolute"
                                style={{
                                  left: rot.x - ROT_HANDLE_R,
                                  top: rot.y - ROT_HANDLE_R,
                                  width: ROT_HANDLE_R * 2,
                                  height: ROT_HANDLE_R * 2,
                                  borderRadius: '50%',
                                  cursor: 'crosshair',
                                }}
                                onMouseDown={(e) => handleScaleMouseDown(rot.mode, e)}
                                onTouchStart={(e) => handleScaleTouchStart(rot.mode, e)}
                              />
                              <svg
                                className="hidden md:block absolute pointer-events-none"
                                width="22" height="22"
                                style={{ left: rot.x - 11, top: rot.y - 11 }}
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <path
                                  d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
                                  fill="var(--accent)"
                                />
                              </svg>
                            </div>
                          )
                        })}
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div
                          className="absolute flex items-center justify-center cursor-pointer"
                          style={{ left: vpLeft, top: vpTop, width: previewWidth, height: previewHeight }}
                        >
                          <Upload className="w-12 h-12 md:w-16 md:h-16 transition-colors duration-200"
                            style={{ color: isDragOver ? 'var(--accent)' : 'var(--text-secondary)' }} />
                        </div>
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
                    <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{(imageScale * 100).toFixed(0)}%</span>
                  </div>
                  <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                    <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>旋转：</span>
                    <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{imageRotation.toFixed(1)}°</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧 */}
            <div className="lg:col-span-1 lg:overflow-auto no-scrollbar lg:min-h-0 lg:flex-none">
              <div className="space-y-3 lg:space-y-4">
                <div
                  className="rounded-xl p-4 lg:p-5"
                  style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
                >
                  <h3 className="text-base lg:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>「Layer UI」- 相册表盘</h3>
                </div>

                {uploadedImage && (
                  <button
                    onClick={handleExport}
                    className="w-full py-2.5 lg:py-3 px-4 font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm lg:text-base text-white"
                    style={{ background: 'var(--gradient-accent)', boxShadow: 'var(--shadow-elevated)' }}
                  >
                    <Download className="w-4 h-4" />
                    导出图片
                  </button>
                )}

                {uploadedImage && (
                  <button
                    onClick={handleClearImage}
                    className="w-full py-2 lg:py-2.5 px-4 font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm lg:text-base"
                    style={{ color: 'var(--text-secondary)', border: '1.5px solid var(--border-color)', background: 'var(--bg-secondary)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                    清除图片
                  </button>
                )}

                {uploadedImage && (
                  <div
                    className="rounded-xl p-4 lg:p-5"
                    style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm lg:text-base font-semibold" style={{ color: 'var(--text-primary)' }}>当前图片修改参数</h3>
                      <button onClick={resetTransform} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary)' }}>
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-2.5 lg:p-3 rounded-md" style={{ background: 'var(--bg-tertiary)' }}>
                      <div className="flex items-center justify-between text-xs lg:text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>缩放</span>
                        <div className="flex items-center">
                          <input type="number" step="1" min="10" max="500"
                            value={Math.round(imageScale * 100)}
                            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setImageScale(Math.max(0.1, Math.min(5, v / 100))) }}
                            className="w-14 text-right text-xs lg:text-sm bg-transparent outline-none"
                            style={{ color: 'var(--text-primary)', border: 'none', WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                          />
                          <span style={{ color: 'var(--text-primary)' }}>%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs lg:text-sm mt-1">
                        <span style={{ color: 'var(--text-secondary)' }}>旋转</span>
                        <div className="flex items-center">
                          <input type="number" step="0.1"
                            value={imageRotation.toFixed(1)}
                            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setImageRotation(v) }}
                            className="w-14 text-right text-xs lg:text-sm bg-transparent outline-none"
                            style={{ color: 'var(--text-primary)', border: 'none', WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                          />
                          <span style={{ color: 'var(--text-primary)' }}>°</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs lg:text-sm mt-1">
                        <span style={{ color: 'var(--text-secondary)' }}>偏移</span>
                        <div className="flex items-center">
                          <span style={{ color: 'var(--text-primary)' }}>{Math.round(imagePosition.x)}, {Math.round(imagePosition.y)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}