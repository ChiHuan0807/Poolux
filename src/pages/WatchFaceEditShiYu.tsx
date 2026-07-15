import { useState, useRef, useCallback, useEffect } from 'react'
import { Navbar } from '@/components/Navbar'
import { snapToEdges } from '@/lib/snapToEdges'
import { ArrowLeft, Upload, X, RotateCcw, Download, Palette, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

interface ShiYuLayout {
  line: { left: number; top: number; w: number; h: number }
  pill: { left: number; top: number; w: number; h: number; r: number; opacity: number }
  frame: { left: number; top: number; w: number; h: number; r: number }
  whiteBorder: { left: number; top: number; w: number; h: number; r: number }
  panel: { left: number; top: number; w: number; h: number; opacity: number }
  bottomBar: { left: number; top: number; w: number; h: number; rTL: number; rTR: number; rBR: number; rBL: number; opacity: number }
  dots: { x: number; y: number; o: number }[]
  triangle: { left: number; top: number; s: number; r: number }
  whiteBar: { left: number; top: number; w: number; h: number; r: number; opacity: number }
  templateSrc?: string
  template?: { left: number; top: number; w: number; h: number }
  gradient?: { left: number; top: number; w: number; h: number; opacity: number; whiteToTransparent: boolean }
}

interface DeviceOption {
  id: string
  label: string
  width: number
  height: number
  cornerRadius: number
  maskColorDefault: string
  layout: ShiYuLayout
  circleSize?: number
  circleLeft?: number
  circleTop?: number
}

const devices: DeviceOption[] = [
  {
    id: 'miband-pro', label: '小米手环 Pro', width: 336, height: 480, cornerRadius: 48,
    maskColorDefault: '#FFFFFF',
    layout: {
      line: { left: 267, top: 0, w: 2, h: 480 },
      pill: { left: 25, top: 49, w: 116, h: 17, r: 50, opacity: 0.7 },
      frame: { left: 23, top: 90, w: 221, h: 288, r: 15 },
      whiteBorder: { left: 29, top: 97, w: 209, h: 274, r: 9.08 },
      panel: { left: 269, top: 170, w: 67, h: 310, opacity: 0.5 },
      bottomBar: { left: 23, top: 404, w: 221, h: 54, rTL: 5, rTR: 5, rBR: 5, rBL: 29, opacity: 0.9 },
      dots: [{ x: 285, y: 28, o: 0.8 }, { x: 305, y: 28, o: 0.6 }, { x: 305, y: 48, o: 0.4 }, { x: 305, y: 68, o: 0.2 }],
      triangle: { left: 225, top: 408, s: 16, r: 1 },
      whiteBar: { left: 45, top: 442, w: 189, h: 4, r: 50, opacity: 0.5 },
      templateSrc: '/muban/shiyu.webp',
      template: { left: 28, top: 24, w: 292, h: 423 },
      gradient: { left: 23, top: 305, w: 221, h: 73, opacity: 0.5, whiteToTransparent: false },
    },
  },
  {
    id: 'miband-10', label: '小米手环 10', width: 212, height: 520, cornerRadius: 108,
    maskColorDefault: '#7B8CC3',
    layout: {
      line: { left: 167, top: 0, w: 2, h: 520 },
      pill: { left: 18, top: 74, w: 86, h: 12.6, r: 37.07, opacity: 0.7 },
      frame: { left: 14, top: 110, w: 139, h: 288, r: 15 },
      whiteBorder: { left: 18, top: 114, w: 131, h: 280, r: 12 },
      panel: { left: 169, top: 174, w: 43, h: 346, opacity: 0.5 },
      bottomBar: { left: 15, top: 420, w: 139, h: 36, rTL: 3, rTR: 3, rBR: 3, rBL: 18, opacity: 0.9 },
      dots: [{ x: 174, y: 65, o: 0.8 }, { x: 174, y: 85, o: 0.6 }, { x: 194, y: 85, o: 0.4 }, { x: 194, y: 105, o: 0.2 }],
      triangle: { left: 140, top: 423, s: 10.71, r: 0.67 },
      whiteBar: { left: 29, top: 445, w: 117, h: 3, r: 103, opacity: 0.5 },
      templateSrc: '/muban/shiyu_10.webp',
      template: { left: 20, top: 55, w: 187, h: 393 },
      gradient: { left: 14, top: 327, w: 139, h: 73, opacity: 0.5, whiteToTransparent: false },
    },
  },
]

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

export function WatchFaceEditShiYu() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceOption | null>(null)
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
  const [maskColor, setMaskColor] = useState('#FFFFFF')
  const [extractedColors, setExtractedColors] = useState<string[]>([])
  const [overlayImage, setOverlayImage] = useState<string | null>(null)
  const [editingOverlay, setEditingOverlay] = useState(false)
  const [ovImgPos, setOvImgPos] = useState({ x: 0, y: 0 })
  const [ovImgScale, setOvImgScale] = useState(1)
  const [ovImgRotation, setOvImgRotation] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const overlayFileInputRef = useRef<HTMLInputElement>(null)
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

  // 测量预览区域实际可用尺寸，避免 maxWidth:100% 只裁剪宽度不裁剪高度导致偏移
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

  const handleDeviceSelect = useCallback((device: DeviceOption) => {
    setSelectedDevice(device)
    setMaskColor(device.maskColorDefault)
    setImagePosition({ x: 0, y: 0 })
    setImageScale(1)
    setImageRotation(0)
    if (overlayImage) URL.revokeObjectURL(overlayImage)
    setOverlayImage(null)
    setEditingOverlay(false)
  }, [overlayImage])

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
    setMaskColor('#FFFFFF')
    setExtractedColors([])
    if (overlayImage) URL.revokeObjectURL(overlayImage)
    setOverlayImage(null)
    setEditingOverlay(false)
  }, [uploadedImage, overlayImage])

  const handleOverlayFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    if (overlayImage) URL.revokeObjectURL(overlayImage)
    setOverlayImage(url)
    setOvImgPos({ x: 0, y: 0 })
    setOvImgScale(1)
    setOvImgRotation(0)
  }, [overlayImage])

  useEffect(() => {
    if (!uploadedImage) return
    const img = new Image()
    img.onload = () => {
      setImgNaturalW(img.naturalWidth); setImgNaturalH(img.naturalHeight)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const sampleW = 128, sampleH = 128
      canvas.width = sampleW; canvas.height = sampleH
      ctx.drawImage(img, 0, 0, sampleW, sampleH)
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data
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
      const colorDiff = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
        Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
      const picked: typeof sorted = []
      for (const c of sorted) {
        if (picked.every(p => colorDiff(p, c) >= 60)) picked.push(c)
        if (picked.length >= 10) break
      }
      const toHex = (n: number) => Math.min(255, n).toString(16).padStart(2, '0')
      const brightness = (c: { r: number; g: number; b: number }) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
      picked.sort((a, b) => brightness(a) - brightness(b))
      const colors = picked.map(c => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`)
      setExtractedColors(colors)
      if (colors.length > 0) setMaskColor(colors[0])
    }
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
  // 用 wrapSize（实际可用空间）约束，避免容器被 maxWidth/maxHeight 裁切导致内部坐标偏移
  const rawAvailW = isMobile
    ? Math.max(160, winSize.w - 72)
    : Math.max(200, (winSize.w - 136) * 2 / 3)
  const rawAvailH = isMobile
    ? Math.max(200, winSize.h - 220)
    : Math.max(200, winSize.h - 200)
  const maxAvailW = wrapSize.w > 0 ? Math.min(rawAvailW, wrapSize.w - PAD * 2) : rawAvailW
  const maxAvailH = wrapSize.h > 0 ? Math.min(rawAvailH, wrapSize.h - PAD * 2) : rawAvailH

  const L = selectedDevice?.layout ?? devices[0].layout
  const previewScale = selectedDevice ? Math.min(maxAvailW / selectedDevice.width, maxAvailH / selectedDevice.height, 1) : 1
  const previewWidth = selectedDevice ? selectedDevice.width * previewScale : 0
  const previewHeight = selectedDevice ? selectedDevice.height * previewScale : 0
  const cornerRadius = selectedDevice ? selectedDevice.cornerRadius * previewScale : 0

  const imgW = imgNaturalW && imgNaturalH
    ? imgNaturalW * Math.max(L.frame.w * previewScale / imgNaturalW, L.frame.h * previewScale / imgNaturalH)
    : L.frame.w * previewScale
  const imgH = imgNaturalW && imgNaturalH
    ? imgNaturalH * Math.max(L.frame.w * previewScale / imgNaturalW, L.frame.h * previewScale / imgNaturalH)
    : L.frame.h * previewScale

  const containerWidth = previewWidth + PAD * 2
  const containerHeight = previewHeight + PAD * 2
  const vpLeft = (containerWidth - previewWidth) / 2
  const vpTop = (containerHeight - previewHeight) / 2

  const imgCenterX = vpLeft + L.frame.left * previewScale + L.frame.w * previewScale / 2 + imagePosition.x
  const imgCenterY = vpTop + L.frame.top * previewScale + L.frame.h * previewScale / 2 + imagePosition.y
  const vpCenterX = vpLeft + previewWidth / 2
  const vpCenterY = vpTop + previewHeight / 2

  // 圆形叠加层中心坐标（预览坐标系）
  const ovPreviewR = (selectedDevice?.circleSize ?? 52) / 2 * previewScale
  const ovCenterX = vpLeft + (selectedDevice?.circleLeft ?? 265) * previewScale + ovPreviewR
  const ovCenterY = vpTop + (selectedDevice?.circleTop ?? 355) * previewScale + ovPreviewR

  // 编辑模式：放大显示圆形层，居中渲染（移动端和桌面端均适用）
  const ovEditMode = editingOverlay
  const ovEditR = ovEditMode ? Math.min(previewWidth, previewHeight) * 0.55 : ovPreviewR
  // 编辑模式下圆心始终在预览区正中央
  const ovEditCX = vpLeft + previewWidth / 2
  const ovEditCY = vpTop + previewHeight / 2

  // 编辑模式下：当前操作的中心和状态
  const activeCenterX = editingOverlay ? ovEditCX : vpCenterX
  const activeCenterY = editingOverlay ? ovEditCY : vpCenterY
  const activePos = editingOverlay ? ovImgPos : imagePosition
  const activeScale = editingOverlay ? ovImgScale : imageScale
  const activeRotation = editingOverlay ? ovImgRotation : imageRotation

  // 缩放柄位置（图片四角）
  const getImageCorners = useCallback((cx: number, cy: number, scale: number, rotation: number) => {
    const hw = (imgW * scale) / 2
    const hh = (imgH * scale) / 2
    const rad = (rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return [
      { x: cx + (-hw) * cos - (-hh) * sin, y: cy + (-hw) * sin + (-hh) * cos, mode: 'scale-tl' as DragMode },
      { x: cx + hw * cos - (-hh) * sin, y: cy + hw * sin + (-hh) * cos, mode: 'scale-tr' as DragMode },
      { x: cx + (-hw) * cos - hh * sin, y: cy + (-hw) * sin + hh * cos, mode: 'scale-bl' as DragMode },
      { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos, mode: 'scale-br' as DragMode },
    ]
  }, [imgW, imgH])

  // 圆形层编辑模式的缩放柄（四角围绕圆形）
  const getOvCorners = useCallback((cx: number, cy: number, r: number) => {
    return [
      { x: cx - r, y: cy - r, mode: 'scale-tl' as DragMode },
      { x: cx + r, y: cy - r, mode: 'scale-tr' as DragMode },
      { x: cx - r, y: cy + r, mode: 'scale-bl' as DragMode },
      { x: cx + r, y: cy + r, mode: 'scale-br' as DragMode },
    ]
  }, [])

  // 使用编辑状态计算手柄
  const editCx = editingOverlay
    ? ovEditCX + ovImgPos.x
    : vpCenterX + imagePosition.x
  const editCy = editingOverlay
    ? ovEditCY + ovImgPos.y
    : vpCenterY + imagePosition.y

  const currentCorners = editingOverlay
    ? getOvCorners(editCx, editCy, ovEditR * activeScale)
    : getImageCorners(imgCenterX, imgCenterY, imageScale, imageRotation)

  const currentRotHandles = currentCorners.map((c) => {
    const dx = c.x - editCx
    const dy = c.y - editCy
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const rotMode = c.mode.replace('scale-', 'rotate-') as DragMode
    return {
      x: c.x + (dx / len) * ROT_HANDLE_OFFSET,
      y: c.y + (dy / len) * ROT_HANDLE_OFFSET,
      mode: rotMode,
    }
  })

  // 图片层：mousedown 只做移动
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!uploadedImage) return
    if (editingOverlay) return // 编辑模式下主图不可拖拽
    e.preventDefault()
    setDragMode('move')
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: imagePosition.x, y: imagePosition.y, scale: imageScale, rotation: imageRotation })
  }, [uploadedImage, imagePosition, imageScale, imageRotation, editingOverlay])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!uploadedImage) return
    if (editingOverlay) return
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
  }, [uploadedImage, imagePosition, imageScale, imageRotation, editingOverlay])

  // 圆形层拖拽：mousedown
  const handleOvMouseDown = useCallback((e: React.MouseEvent) => {
    if (!overlayImage || !editingOverlay) return
    e.stopPropagation()
    e.preventDefault()
    setDragMode('move')
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: ovImgPos.x, y: ovImgPos.y, scale: ovImgScale, rotation: ovImgRotation })
  }, [overlayImage, editingOverlay, ovImgPos, ovImgScale, ovImgRotation])

  const handleOvTouchStart = useCallback((e: React.TouchEvent) => {
    if (!overlayImage || !editingOverlay) return
    e.stopPropagation()
    if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      setDragMode('pinch-rotate')
      setDragStart({
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
        _pinchDist: Math.sqrt((t1.clientX - t0.clientX) ** 2 + (t1.clientY - t0.clientY) ** 2),
        _pinchAngle: Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
      } as any)
      setDragStartState({ x: ovImgPos.x, y: ovImgPos.y, scale: ovImgScale, rotation: ovImgRotation })
      return
    }
    const touch = e.touches[0]
    setDragMode('move')
    setDragStart({ x: touch.clientX, y: touch.clientY })
    setDragStartState({ x: ovImgPos.x, y: ovImgPos.y, scale: ovImgScale, rotation: ovImgRotation })
  }, [overlayImage, editingOverlay, ovImgPos, ovImgScale, ovImgRotation])

  // 统一的 scale/rotate 柄 mousedown
  const handleScaleMouseDown = useCallback((mode: DragMode, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDragMode(mode)
    setDragStart({ x: e.clientX, y: e.clientY })
    setDragStartState({ x: activePos.x, y: activePos.y, scale: activeScale, rotation: activeRotation })
  }, [activePos, activeScale, activeRotation])

  const handleScaleTouchStart = useCallback((mode: DragMode, e: React.TouchEvent) => {
    e.stopPropagation()
    const touch = e.touches[0]
    setDragMode(mode)
    setDragStart({ x: touch.clientX, y: touch.clientY })
    setDragStartState({ x: activePos.x, y: activePos.y, scale: activeScale, rotation: activeRotation })
  }, [activePos, activeScale, activeRotation])

  // 全局拖拽
  useEffect(() => {
    if (!dragMode) return
    const onMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y

      if (dragMode === 'move') {
        if (editingOverlay) {
          setOvImgPos({ x: dragStartState.x + dx, y: dragStartState.y + dy })
        } else {
          const raw = { x: dragStartState.x + dx, y: dragStartState.y + dy }
          setImagePosition(snapToEdges(raw.x, raw.y, imgW, imgH, imageScale,
            L.frame.w * previewScale, L.frame.h * previewScale))
        }
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const startDist = Math.sqrt(
          (dragStart.x - rect.left - activeCenterX - dragStartState.x) ** 2 +
          (dragStart.y - rect.top - activeCenterY - dragStartState.y) ** 2
        )
        const curDist = Math.sqrt(
          (e.clientX - rect.left - activeCenterX - dragStartState.x) ** 2 +
          (e.clientY - rect.top - activeCenterY - dragStartState.y) ** 2
        )
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          if (editingOverlay) setOvImgScale(newScale)
          else setImageScale(newScale)
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const cx = activeCenterX + dragStartState.x
        const cy = activeCenterY + dragStartState.y
        const startAngle = Math.atan2(dragStart.y - rect.top - cy, dragStart.x - rect.left - cx)
        const curAngle = Math.atan2(e.clientY - rect.top - cy, e.clientX - rect.left - cx)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        if (editingOverlay) setOvImgRotation(newRot)
        else setImageRotation(newRot)
      }
    }
    const onMouseUp = () => setDragMode(null)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragMode, dragStart, dragStartState, activeCenterX, activeCenterY, editingOverlay])

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
        const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        const cx = (t0.clientX + t1.clientX) / 2
        const cy = (t0.clientY + t1.clientY) / 2
        if (editingOverlay) {
          setOvImgScale(newScale)
          setOvImgRotation(newRot)
          setOvImgPos({ x: dragStartState.x + cx - dragStart.x, y: dragStartState.y + cy - dragStart.y })
        } else {
          setImageScale(newScale)
          setImageRotation(newRot)
          setImagePosition({ x: dragStartState.x + cx - dragStart.x, y: dragStartState.y + cy - dragStart.y })
        }
        return
      }
      const touch = e.touches[0]
      const dx = touch.clientX - dragStart.x
      const dy = touch.clientY - dragStart.y
      if (dragMode === 'move') {
        if (editingOverlay) {
          setOvImgPos({ x: dragStartState.x + dx, y: dragStartState.y + dy })
        } else {
          const raw = { x: dragStartState.x + dx, y: dragStartState.y + dy }
          setImagePosition(snapToEdges(raw.x, raw.y, imgW, imgH, imageScale,
            L.frame.w * previewScale, L.frame.h * previewScale))
        }
      } else if (dragMode.startsWith('scale-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const startDist = Math.sqrt(
          (dragStart.x - rect.left - activeCenterX - dragStartState.x) ** 2 +
          (dragStart.y - rect.top - activeCenterY - dragStartState.y) ** 2
        )
        const curDist = Math.sqrt(
          (touch.clientX - rect.left - activeCenterX - dragStartState.x) ** 2 +
          (touch.clientY - rect.top - activeCenterY - dragStartState.y) ** 2
        )
        if (startDist > 0) {
          const newScale = Math.max(0.1, Math.min(5, dragStartState.scale * (curDist / startDist)))
          if (editingOverlay) setOvImgScale(newScale)
          else setImageScale(newScale)
        }
      } else if (dragMode.startsWith('rotate-')) {
        const rect = containerRef.current!.getBoundingClientRect()
        const cx = activeCenterX + dragStartState.x
        const cy = activeCenterY + dragStartState.y
        const startAngle = Math.atan2(dragStart.y - rect.top - cy, dragStart.x - rect.left - cx)
        const curAngle = Math.atan2(touch.clientY - rect.top - cy, touch.clientX - rect.left - cx)
        const newRot = dragStartState.rotation + (curAngle - startAngle) * (180 / Math.PI)
        if (editingOverlay) setOvImgRotation(newRot)
        else setImageRotation(newRot)
      }
    }
    const onTouchEnd = () => {
      if (dragMode === 'pinch-rotate') {
        if (editingOverlay) setOvImgRotation(prev => snapRotation(prev))
        else setImageRotation(prev => snapRotation(prev))
      }
      setDragMode(null)
    }
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [dragMode, dragStart, dragStartState, activeCenterX, activeCenterY, editingOverlay])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.08 : 0.08
      if (editingOverlay) {
        setOvImgScale(prev => Math.max(0.1, Math.min(5, prev + delta)))
      } else {
        setImageScale(prev => Math.max(0.1, Math.min(5, prev + delta)))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const resetTransform = useCallback(() => {
    if (editingOverlay) {
      setOvImgPos({ x: 0, y: 0 })
      setOvImgRotation(0)
    } else {
      setImagePosition({ x: 0, y: 0 })
      setImageRotation(0)
    }
  }, [editingOverlay])

  const exitOverlayEdit = useCallback(() => {
    const r = ovPreviewR > 0 ? ovEditR / ovPreviewR : 1
    if (r !== 1) setOvImgPos(prev => ({ x: prev.x / r, y: prev.y / r }))
    setEditingOverlay(false)
  }, [ovPreviewR, ovEditR])

  const handleExport = useCallback(async () => {
    if (!uploadedImage || !selectedDevice || !imgNaturalW || !imgNaturalH) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const exportW = selectedDevice.width * EXPORT_SCALE
      const exportH = selectedDevice.height * EXPORT_SCALE
      canvas.width = exportW
      canvas.height = exportH
      const ctx = canvas.getContext('2d')!
      const scale = exportW / selectedDevice.width
      const L = selectedDevice.layout

      // CSS 规范：相邻圆角之和超过边长时等比缩小；Canvas 不会自动处理，需手动 clamp
      const r = Math.min(selectedDevice.cornerRadius * scale, exportW / 2, exportH / 2)
      ctx.beginPath()
      ctx.moveTo(r, 0); ctx.lineTo(exportW - r, 0)
      ctx.arcTo(exportW, 0, exportW, r, r)
      ctx.lineTo(exportW, exportH - r)
      ctx.arcTo(exportW, exportH, exportW - r, exportH, r)
      ctx.lineTo(r, exportH)
      ctx.arcTo(0, exportH, 0, exportH - r, r)
      ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
      ctx.closePath(); ctx.clip()

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, exportW, exportH)

      // 竖线
      ctx.fillStyle = 'rgba(204, 204, 204, 1)'
      ctx.fillRect(L.line.left * scale, L.line.top * scale, L.line.w * scale, L.line.h * scale)

      // 相片框背景
      const frameX = L.frame.left * scale, frameY = L.frame.top * scale, frameW = L.frame.w * scale, frameH = L.frame.h * scale, frameR = L.frame.r * scale
      ctx.fillStyle = 'rgba(204, 204, 204, 1)'
      ctx.beginPath()
      ctx.roundRect(frameX, frameY, frameW, frameH, frameR)
      ctx.fill()

      // 图片裁切到相片框
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(frameX, frameY, frameW, frameH, frameR)
      ctx.clip()

      const displayImgW = imgNaturalW * Math.max(frameW / imgNaturalW, frameH / imgNaturalH)
      const displayImgH = imgNaturalH * Math.max(frameW / imgNaturalW, frameH / imgNaturalH)

      ctx.translate(frameX + frameW / 2 + imagePosition.x * scale / previewScale, frameY + frameH / 2 + imagePosition.y * scale / previewScale)
      ctx.rotate(imageRotation * Math.PI / 180)
      ctx.scale(imageScale, imageScale)
      ctx.drawImage(img, -displayImgW / 2, -displayImgH / 2, displayImgW, displayImgH)
      ctx.restore()

      // 时语模板：顶部药丸条
      ctx.save()
      ctx.globalAlpha = L.pill.opacity
      ctx.fillStyle = maskColor
      ctx.beginPath()
      ctx.roundRect(L.pill.left * scale, L.pill.top * scale, L.pill.w * scale, L.pill.h * scale, L.pill.r * scale)
      ctx.fill()
      ctx.restore()

      // 时语模板：白色边框（图片上层）
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
      ctx.lineWidth = 2 * scale
      ctx.beginPath()
      ctx.roundRect(L.whiteBorder.left * scale, L.whiteBorder.top * scale, L.whiteBorder.w * scale, L.whiteBorder.h * scale, L.whiteBorder.r * scale)
      ctx.stroke()
      ctx.restore()

      // 时语模板：右侧竖面板
      ctx.save()
      ctx.globalAlpha = L.panel.opacity
      ctx.fillStyle = maskColor
      ctx.beginPath()
      ctx.rect(L.panel.left * scale, L.panel.top * scale, L.panel.w * scale, L.panel.h * scale)
      ctx.fill()
      ctx.restore()

      // 时语模板：圆点
      for (const d of L.dots) {
        ctx.save()
        ctx.globalAlpha = d.o
        ctx.fillStyle = maskColor
        ctx.beginPath()
        ctx.arc(d.x * scale + 7 * scale, d.y * scale + 7 * scale, 7 * scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 时语模板：渐变遮罩（图片上层）
      if (L.gradient) {
        ctx.save()
        ctx.globalAlpha = L.gradient.opacity
        const gX = L.gradient.left * scale, gY = L.gradient.top * scale, gW = L.gradient.w * scale, gH = L.gradient.h * scale
        const grad = ctx.createLinearGradient(0, gY, 0, gY + gH)
        if (L.gradient.whiteToTransparent) {
          grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        } else {
          grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
          grad.addColorStop(1, 'rgba(255, 255, 255, 1)')
        }
        ctx.fillStyle = grad
        ctx.fillRect(gX, gY, gW, gH)
        ctx.restore()
      }

      // 时语模板：底部信息条
      ctx.save()
      ctx.globalAlpha = L.bottomBar.opacity
      ctx.fillStyle = maskColor
      ctx.beginPath()
      const barX = L.bottomBar.left * scale, barY = L.bottomBar.top * scale, barW = L.bottomBar.w * scale, barH = L.bottomBar.h * scale
      const brTL = L.bottomBar.rTL * scale, brTR = L.bottomBar.rTR * scale, brBR = L.bottomBar.rBR * scale, brBL = L.bottomBar.rBL * scale
      ctx.moveTo(barX + brTL, barY)
      ctx.lineTo(barX + barW - brTR, barY)
      ctx.arcTo(barX + barW, barY, barX + barW, barY + brTR, brTR)
      ctx.lineTo(barX + barW, barY + barH - brBR)
      ctx.arcTo(barX + barW, barY + barH, barX + barW - brBR, barY + barH, brBR)
      ctx.lineTo(barX + brBL, barY + barH)
      ctx.arcTo(barX, barY + barH, barX, barY + barH - brBL, brBL)
      ctx.lineTo(barX, barY + brTL)
      ctx.arcTo(barX, barY, barX + brTL, barY, brTL)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // 时语模板：白色三角形（右上角直角等腰，1px圆角）
      ctx.save()
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(255, 255, 255, 1)'
      const triX = L.triangle.left * scale, triY = L.triangle.top * scale, triS = L.triangle.s * scale, triR = L.triangle.r * scale
      const t45 = L.triangle.r * 2.414 * scale
      ctx.beginPath()
      ctx.moveTo(triX + t45, triY)
      ctx.lineTo(triX + triS - triR, triY)
      ctx.arcTo(triX + triS, triY, triX + triS, triY + triR, triR)
      ctx.lineTo(triX + triS, triY + triS - t45)
      ctx.arcTo(triX + triS, triY + triS, triX + triS - t45, triY + triS, triR)
      ctx.lineTo(triX + t45 * 0.7071, triY + t45 * 0.7071)
      ctx.arcTo(triX, triY, triX + t45, triY, triR)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // 时语模板：底部白色横条
      ctx.save()
      ctx.globalAlpha = L.whiteBar.opacity
      ctx.fillStyle = 'rgba(255, 255, 255, 1)'
      ctx.beginPath()
      ctx.roundRect(L.whiteBar.left * scale, L.whiteBar.top * scale, L.whiteBar.w * scale, L.whiteBar.h * scale, L.whiteBar.r * scale)
      ctx.fill()
      ctx.restore()

      const finishExport = () => {
        canvas.toBlob((blob) => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `watchface-${selectedDevice.id}.png`; a.click()
          URL.revokeObjectURL(url)
        }, 'image/png')
      }

      finishExport()
    }
    img.src = uploadedImage
  }, [uploadedImage, selectedDevice, imagePosition, imageScale, imageRotation, imgNaturalW, imgNaturalH, maskColor, previewScale])

  const curCursor = dragMode
    ? (dragMode === 'move' ? 'grabbing' : dragMode.startsWith('rotate') ? 'crosshair' : 'nwse-resize')
    : editingOverlay ? 'default' : 'default'

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
                {selectedDevice ? (
                  <>
                    <div className="flex items-center gap-3 px-4 lg:px-5 pt-4 lg:pt-5 pb-2 flex-shrink-0">
                      <Link to="/tools/watch-face" className="p-2 rounded-md transition-all duration-200" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                        <ArrowLeft className="w-4 h-4" style={{ color: 'var(--text-primary)' }} />
                      </Link>
                      <h3 className="text-sm lg:text-base font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
                        预览 - {selectedDevice.label}
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
                            left: vpLeft - 3, top: vpTop - 3,
                            width: previewWidth + 6, height: previewHeight + 6,
                            borderRadius: cornerRadius + 3,
                            border: '2px solid var(--frame-border)',
                            boxShadow: 'none',
                            zIndex: 20,
                          }}
                        />

                        <div
                          ref={containerRef}
                          className="absolute"
                          style={{ left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 21 }}
                          onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                          onClick={(e) => {
                            // 编辑模式下点击空白区域退出
                            if (editingOverlay) {
                              const target = e.target as HTMLElement
                              if (target === containerRef.current || target === e.currentTarget) {
                                // 退出编辑：按圆缩小比例还原 ovImgPos
                                const r = ovPreviewR > 0 ? ovEditR / ovPreviewR : 1
                                if (r !== 1) setOvImgPos(prev => ({ x: prev.x / r, y: prev.y / r }))
                                setEditingOverlay(false)
                              }
                            } else if (!uploadedImage) {
                              fileInputRef.current?.click()
                            }
                          }}
                        >
                          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = '' }} />
                          <input ref={overlayFileInputRef} type="file" accept="image/*" className="hidden"
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleOverlayFile(file); e.target.value = '' }} />

                          {uploadedImage ? (
                            <>
                              {/* 裁切遮罩层 */}
                              <div
                                className="absolute"
                                style={{ left: vpLeft, top: vpTop, width: previewWidth, height: previewHeight, borderRadius: cornerRadius, overflow: 'hidden' }}
                              >
                                {/* 设备区域背景 */}
                                <div className="absolute inset-0" style={{ background: '#FFFFFF', borderRadius: cornerRadius }} />
                                {/* 竖线 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.line.left * previewScale,
                                    top: L.line.top * previewScale,
                                    width: L.line.w * previewScale,
                                    height: L.line.h * previewScale,
                                    background: 'rgba(204, 204, 204, 1)',
                                    zIndex: 3,
                                  }}
                                />
                                {/* 模板叠加层 */}
                                {L.templateSrc && (
                                  <img
                                    src={L.templateSrc}
                                    alt="时语模板"
                                    className="absolute pointer-events-none select-none"
                                    style={{
                                      left: L.template!.left * previewScale,
                                      top: L.template!.top * previewScale,
                                      width: L.template!.w * previewScale,
                                      height: L.template!.h * previewScale,
                                      zIndex: 20,
                                    }}
                                  />
                                )}
                                {/* 相片框背景 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.frame.left * previewScale,
                                    top: L.frame.top * previewScale,
                                    width: L.frame.w * previewScale,
                                    height: L.frame.h * previewScale,
                                    borderRadius: L.frame.r * previewScale,
                                    background: 'rgba(204, 204, 204, 1)',
                                    zIndex: 1,
                                  }}
                                />
                                {/* 图片层（裁切到相片框） */}
                                <div
                                  className="absolute"
                                  style={{
                                    left: L.frame.left * previewScale,
                                    top: L.frame.top * previewScale,
                                    width: L.frame.w * previewScale,
                                    height: L.frame.h * previewScale,
                                    borderRadius: L.frame.r * previewScale,
                                    overflow: 'hidden',
                                    zIndex: 2,
                                  }}
                                >
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: (L.frame.w * previewScale - imgW) / 2,
                                      top: (L.frame.h * previewScale - imgH) / 2,
                                      width: imgW,
                                      height: imgH,
                                      transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) rotate(${imageRotation}deg) scale(${imageScale})`,
                                      transformOrigin: 'center center',
                                      cursor: dragMode === 'move' ? 'grabbing' : 'grab',
                                    }}
                                    onMouseDown={handleMouseDown}
                                    onMouseMove={(e) => { if (!dragMode) setMousePos({ x: e.clientX, y: e.clientY }) }}
                                    onTouchStart={handleTouchStart}
                                  >
                                    <img
                                      src={uploadedImage}
                                      alt="表盘预览"
                                      className="w-full h-full pointer-events-none select-none"
                                      draggable={false}
                                    />
                                  </div>
                                </div>

                                {/* 时语模板：顶部药丸条 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.pill.left * previewScale,
                                    top: L.pill.top * previewScale,
                                    width: L.pill.w * previewScale,
                                    height: L.pill.h * previewScale,
                                    borderRadius: L.pill.r * previewScale,
                                    background: maskColor,
                                    opacity: L.pill.opacity,
                                    zIndex: 5,
                                  }}
                                />
                                {/* 时语模板：白色边框（图片上层） */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.whiteBorder.left * previewScale,
                                    top: L.whiteBorder.top * previewScale,
                                    width: L.whiteBorder.w * previewScale,
                                    height: L.whiteBorder.h * previewScale,
                                    borderRadius: L.whiteBorder.r * previewScale,
                                    border: `${2 * previewScale}px solid rgba(255, 255, 255, 1)`,
                                    zIndex: 6,
                                  }}
                                />
                                {/* 时语模板：右侧竖面板 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.panel.left * previewScale,
                                    top: L.panel.top * previewScale,
                                    width: L.panel.w * previewScale,
                                    height: L.panel.h * previewScale,
                                    background: maskColor,
                                    opacity: L.panel.opacity,
                                    zIndex: 4,
                                  }}
                                />
                                {/* 时语模板：圆点 */}
                                {L.dots.map((dot, i) => (
                                  <div
                                    key={i}
                                    className="absolute pointer-events-none"
                                    style={{
                                      left: dot.x * previewScale,
                                      top: dot.y * previewScale,
                                      width: 14 * previewScale,
                                      height: 14 * previewScale,
                                      borderRadius: '50%',
                                      background: maskColor,
                                      opacity: dot.o,
                                      zIndex: 5,
                                    }}
                                  />
                                ))}
                                {/* 时语模板：渐变遮罩（图片上层） */}
                                {L.gradient && (
                                  <div
                                    className="absolute pointer-events-none"
                                    style={{
                                      left: L.gradient.left * previewScale,
                                      top: L.gradient.top * previewScale,
                                      width: L.gradient.w * previewScale,
                                      height: L.gradient.h * previewScale,
                                      background: L.gradient.whiteToTransparent
                                        ? 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)'
                                        : 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 100%)',
                                      opacity: L.gradient.opacity,
                                      zIndex: 6,
                                    }}
                                  />
                                )}
                                {/* 时语模板：底部信息条 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.bottomBar.left * previewScale,
                                    top: L.bottomBar.top * previewScale,
                                    width: L.bottomBar.w * previewScale,
                                    height: L.bottomBar.h * previewScale,
                                    borderRadius: `${L.bottomBar.rTL * previewScale}px ${L.bottomBar.rTR * previewScale}px ${L.bottomBar.rBR * previewScale}px ${L.bottomBar.rBL * previewScale}px`,
                                    background: maskColor,
                                    opacity: L.bottomBar.opacity,
                                    zIndex: 5,
                                  }}
                                />
                                {/* 时语模板：白色三角形 */}
                                <svg
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.triangle.left * previewScale,
                                    top: L.triangle.top * previewScale,
                                    width: L.triangle.s * previewScale,
                                    height: L.triangle.s * previewScale,
                                    opacity: 1,
                                    zIndex: 6,
                                  }}
                                  viewBox="0 0 16 16"
                                  fill="rgba(255, 255, 255, 1)"
                                >
                                  <path
                                    d="M 2.414 0 L 15 0 A 1 1 0 0 1 16 1 L 16 13.586 A 1 1 0 0 1 14.293 14.293 L 1.707 1.707 A 1 1 0 0 1 2.414 0 Z"
                                    fill="rgba(255, 255, 255, 1)"
                                  />
                                </svg>
                                {/* 时语模板：底部白色横条 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: L.whiteBar.left * previewScale,
                                    top: L.whiteBar.top * previewScale,
                                    width: L.whiteBar.w * previewScale,
                                    height: L.whiteBar.h * previewScale,
                                    borderRadius: L.whiteBar.r * previewScale,
                                    background: 'rgba(255, 255, 255, 1)',
                                    opacity: L.whiteBar.opacity,
                                    zIndex: 6,
                                  }}
                                />
                              </div>

                              {/* 缩放柄 + 旋转柄 */}
                              {(editingOverlay ? currentCorners.length > 0 : true) && currentCorners.map((corner, i) => {
                                const rot = currentRotHandles[i]
                                const lineDx = rot.x - corner.x
                                const lineDy = rot.y - corner.y

                                return (
                                  <div key={`${editingOverlay ? 'ov' : 'img'}-${corner.mode}`} style={{ position: 'absolute', zIndex: 25 }}>
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

                    <div className="p-2 md:p-4 z-10 flex-shrink-0" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
                        <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                          <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>缩放：</span>
                          <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{((editingOverlay ? ovImgScale : imageScale) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center" style={{ background: 'rgba(72,120,144,0.06)', border: '1px solid rgba(72,120,144,0.15)' }}>
                          <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>旋转：</span>
                          <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{(editingOverlay ? ovImgRotation : imageRotation).toFixed(1)}°</span>
                        </div>
                        {editingOverlay && (
                          <div className="px-2 md:px-3 py-1 rounded-md inline-flex items-center cursor-pointer" style={{ background: 'rgba(72,120,144,0.15)', border: '1px solid rgba(72,120,144,0.3)' }}
                            onClick={(e) => { e.stopPropagation(); exitOverlayEdit() }}
                            onTouchEnd={(e) => { e.stopPropagation(); exitOverlayEdit() }}>
                            <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--accent)' }}>完成编辑</span>
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
                <div
                  className="rounded-xl p-4 lg:p-5"
                  style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
                >
                  <h3 className="text-base lg:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>「时语」- 相册表盘</h3>
                </div>

                <div
                  className="rounded-xl p-4 lg:p-5"
                  style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
                >
                  <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>
                    目标设备
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 lg:gap-2">
                    {devices.map((device) => (
                      <button key={device.id} onClick={() => handleDeviceSelect(device)}
                        className="py-1.5 lg:py-2 px-1.5 lg:px-3 rounded-lg transition-all duration-200 text-center"
                        style={{
                          border: `1.5px solid ${selectedDevice?.id === device.id ? 'var(--accent)' : 'var(--border-color)'}`,
                          background: selectedDevice?.id === device.id ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                          color: selectedDevice?.id === device.id ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: selectedDevice?.id === device.id ? 600 : 400,
                        }}>
                        <div className="text-[10px] lg:text-sm leading-tight">{device.label}</div>
                        <div className="text-[9px] lg:text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          {device.width}×{device.height}px
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {uploadedImage && extractedColors.length > 0 && (
                  <div
                    className="rounded-xl p-4 lg:p-5"
                    style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
                  >
                    <h3 className="text-sm lg:text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>主题颜色</h3>
                    <div className="flex items-center gap-2 lg:gap-2.5 flex-wrap">
                      {extractedColors.map((color) => (
                        <button
                          key={color}
                          onClick={() => setMaskColor(color)}
                          className="w-9 h-9 rounded-full transition-all duration-200 flex-shrink-0"
                          style={{
                            background: color,
                            border: `2.5px solid ${maskColor === color ? 'var(--accent)' : 'var(--border-color)'}`,
                            boxShadow: maskColor === color ? `0 0 0 2px var(--accent-bg), 0 2px 8px ${color}66` : '0 1px 3px rgba(0,0,0,0.1)',
                            transform: maskColor === color ? 'scale(1.15)' : 'scale(1)',
                          }}
                          title={color}
                        />
                      ))}
                      <label
                        className="w-9 h-9 rounded-full cursor-pointer flex-shrink-0 flex items-center justify-center transition-all duration-200 relative"
                        style={{
                          background: maskColor,
                          border: `2.5px solid var(--border-color)`,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        }}
                        title="自定义颜色"
                      >
                        <input
                          type="color"
                          value={maskColor}
                          onChange={(e) => setMaskColor(e.target.value)}
                          className="sr-only"
                        />
                        <Palette className="w-3.5 h-3.5" style={{ color: maskColor === '#ffffff' || maskColor === '#FFFFFF' ? '#666' : '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
                      </label>
                    </div>
                  </div>
                )}

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
                    onClick={(e) => { e.stopPropagation(); handleClearImage() }}
                    onTouchStart={(e) => e.stopPropagation()}
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
                            value={Math.round((editingOverlay ? ovImgScale : imageScale) * 100)}
                            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const s = Math.max(0.1, Math.min(5, v / 100)); editingOverlay ? setOvImgScale(s) : setImageScale(s) } }}
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
                            value={editingOverlay ? ovImgRotation.toFixed(1) : imageRotation.toFixed(1)}
                            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) { editingOverlay ? setOvImgRotation(v) : setImageRotation(v) } }}
                            className="w-14 text-right text-xs lg:text-sm bg-transparent outline-none"
                            style={{ color: 'var(--text-primary)', border: 'none', WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                          />
                          <span style={{ color: 'var(--text-primary)' }}>°</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs lg:text-sm mt-1">
                        <span style={{ color: 'var(--text-secondary)' }}>偏移</span>
                        <div className="flex items-center">
                          <span style={{ color: 'var(--text-primary)' }}>{Math.round(editingOverlay ? ovImgPos.x : imagePosition.x)}, {Math.round(editingOverlay ? ovImgPos.y : imagePosition.y)}</span>
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