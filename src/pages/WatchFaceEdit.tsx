import { useState, useRef, useCallback, useEffect } from 'react'
import { Navbar } from '@/components/Navbar'
import { snapToEdges } from '@/lib/snapToEdges'
import { ArrowLeft, Upload, X, RotateCcw, Download, Palette, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

interface DeviceOption {
  id: string
  label: string
  width: number
  height: number
  cornerRadius: number
  // 底部遮罩面板
  maskTop: number
  maskHeight: number
  maskColorDefault: string
  maskRadiusTR: number
  maskShadowY: number
  maskShadowBlur: number
  // 圆形叠加层
  circleLeft: number
  circleTop: number
  circleSize: number
  // 模板叠加层（可选，图片或纯色矩形）
  templateSrc?: string
  templateColor?: string
  templateLeft?: number
  templateTop?: number
  templateWidth?: number
  templateHeight?: number
  // 白色圆角矩形指示器（可选）
  whiteRectLeft?: number
  whiteRectTop?: number
  whiteRectWidth?: number
  whiteRectHeight?: number
}

const devices: DeviceOption[] = [
  {
    id: 'miband-pro', label: '小米手环 Pro', width: 336, height: 480, cornerRadius: 48,
    maskTop: 336, maskHeight: 144, maskColorDefault: '#FFFFFF', maskRadiusTR: 49,
    maskShadowY: -6, maskShadowBlur: 20,
    circleLeft: 265, circleTop: 355, circleSize: 52,
    templateSrc: '/muban/qiong.webp', templateLeft: 17, templateTop: 345, templateWidth: 296, templateHeight: 109,
    whiteRectLeft: 284, whiteRectTop: 435, whiteRectWidth: 33, whiteRectHeight: 16,
  },
  {
    id: 'miband-10', label: '小米手环 10', width: 212, height: 520, cornerRadius: 108,
    maskTop: 364, maskHeight: 156, maskColorDefault: '#7B8CC3', maskRadiusTR: 37,
    maskShadowY: -6, maskShadowBlur: 20,
    circleLeft: 154, circleTop: 377, circleSize: 46,
    templateSrc: '/muban/qiong_10.webp', templateLeft: 12, templateTop: 370, templateWidth: 185, templateHeight: 84,
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

export function WatchFaceEdit() {
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
  const [ovImgNatW, setOvImgNatW] = useState(0)
  const [ovImgNatH, setOvImgNatH] = useState(0)
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
    setOvImgNatW(0)
    setOvImgNatH(0)
  }, [uploadedImage, overlayImage])

  const handleOverlayFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    if (overlayImage) URL.revokeObjectURL(overlayImage)
    setOverlayImage(url)
    setOvImgPos({ x: 0, y: 0 })
    setOvImgScale(1)
    setOvImgRotation(0)
    setOvImgNatW(0)
    setOvImgNatH(0)
    // 加载叠加图层自然尺寸
    const img = new Image()
    img.onload = () => { setOvImgNatW(img.naturalWidth); setOvImgNatH(img.naturalHeight) }
    img.src = url
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

  const previewScale = selectedDevice ? Math.min(maxAvailW / selectedDevice.width, maxAvailH / selectedDevice.height, 1) : 1
  const previewWidth = selectedDevice ? selectedDevice.width * previewScale : 0
  const previewHeight = selectedDevice ? selectedDevice.height * previewScale : 0
  const cornerRadius = selectedDevice ? selectedDevice.cornerRadius * previewScale : 0

  const imgW = imgNaturalW && imgNaturalH
    ? imgNaturalW * Math.max(previewWidth / imgNaturalW, previewHeight / imgNaturalH)
    : previewWidth
  const imgH = imgNaturalW && imgNaturalH
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

  // 圆形层编辑模式的缩放柄（按叠加图片实际宽高比 + 旋转）
  const getOvCorners = useCallback((cx: number, cy: number, r: number) => {
    // r = ovEditR * ovImgScale；图片用 objectFit:contain 放在 2r×2r 圆形容器内
    let hw: number, hh: number
    if (ovImgNatW && ovImgNatH) {
      const aspect = ovImgNatW / ovImgNatH
      if (aspect >= 1) { hw = r; hh = r / aspect }
      else { hw = r * aspect; hh = r }
    } else {
      hw = r; hh = r
    }
    const rad = (ovImgRotation * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    return [
      { x: cx + (-hw) * cos - (-hh) * sin, y: cy + (-hw) * sin + (-hh) * cos, mode: 'scale-tl' as DragMode },
      { x: cx + hw * cos - (-hh) * sin, y: cy + hw * sin + (-hh) * cos, mode: 'scale-tr' as DragMode },
      { x: cx + (-hw) * cos - hh * sin, y: cy + (-hw) * sin + hh * cos, mode: 'scale-bl' as DragMode },
      { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos, mode: 'scale-br' as DragMode },
    ]
  }, [ovImgNatW, ovImgNatH, ovImgRotation])

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
          setImagePosition(snapToEdges(raw.x, raw.y, imgW, imgH, imageScale, previewWidth, previewHeight))
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
          setImagePosition(snapToEdges(raw.x, raw.y, imgW, imgH, imageScale, previewWidth, previewHeight))
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

      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, exportW, exportH)

      const displayImgW = imgNaturalW * Math.max(exportW / imgNaturalW, exportH / imgNaturalH)
      const displayImgH = imgNaturalH * Math.max(exportW / imgNaturalW, exportH / imgNaturalH)

      ctx.translate(exportW / 2 + imagePosition.x * scale / previewScale, exportH / 2 + imagePosition.y * scale / previewScale)
      ctx.rotate(imageRotation * Math.PI / 180)
      ctx.scale(imageScale, imageScale)
      ctx.drawImage(img, -displayImgW / 2, -displayImgH / 2, displayImgW, displayImgH)
      ctx.resetTransform()

      const maskH = selectedDevice.maskHeight * scale
      const maskR = selectedDevice.maskRadiusTR * scale
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)'
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = selectedDevice.maskShadowY * scale
      ctx.shadowBlur = selectedDevice.maskShadowBlur * scale
      ctx.fillStyle = maskColor
      ctx.beginPath()
      if (maskR > 0) {
        ctx.moveTo(exportW, exportH)
        ctx.lineTo(exportW, exportH - maskH + maskR)
        ctx.arcTo(exportW, exportH - maskH, exportW - maskR, exportH - maskH, maskR)
        ctx.lineTo(0, exportH - maskH)
        ctx.lineTo(0, exportH)
      } else {
        ctx.rect(0, exportH - maskH, exportW, maskH)
      }
      ctx.closePath(); ctx.fill()
      ctx.shadowColor = 'transparent'

      const finishExport = () => {
        canvas.toBlob((blob) => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `watchface-${selectedDevice.id}.png`; a.click()
          URL.revokeObjectURL(url)
        }, 'image/png')
      }

      if (selectedDevice.whiteRectLeft != null && selectedDevice.whiteRectTop != null && selectedDevice.whiteRectWidth != null && selectedDevice.whiteRectHeight != null) {
        const wrX = selectedDevice.whiteRectLeft * scale
        const wrY = selectedDevice.whiteRectTop * scale
        const wrW = selectedDevice.whiteRectWidth * scale
        const wrH = selectedDevice.whiteRectHeight * scale
        const wrR = Math.min(wrW / 2, wrH / 2)
        const wrBorder = 2 * scale
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(wrX, wrY, wrW, wrH, wrR)
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = wrBorder
        ctx.stroke()
        ctx.restore()
      }

      if (overlayImage) {
        const oImg = new Image()
        oImg.onload = () => {
          const ow = selectedDevice.circleSize * scale
          const oh = selectedDevice.circleSize * scale
          const ox = selectedDevice.circleLeft * scale
          const oy = selectedDevice.circleTop * scale
          ctx.save()
          ctx.beginPath()
          ctx.arc(ox + ow / 2, oy + oh / 2, Math.min(ow, oh) / 2, 0, Math.PI * 2)
          ctx.clip()
          ctx.translate(ox + ow / 2, oy + oh / 2)
          ctx.translate(ovImgPos.x * scale / previewScale, ovImgPos.y * scale / previewScale)
          ctx.rotate(ovImgRotation * Math.PI / 180)
          ctx.scale(ovImgScale, ovImgScale)
          const imgAspect = oImg.naturalWidth / oImg.naturalHeight
          let drawW: number, drawH: number
          if (imgAspect > 1) { drawW = Math.min(ow, oh); drawH = drawW / imgAspect }
          else { drawH = Math.min(ow, oh); drawW = drawH * imgAspect }
          ctx.drawImage(oImg, -drawW / 2, -drawH / 2, drawW, drawH)
          ctx.restore()
          finishExport()
        }
        oImg.onerror = () => finishExport()
        oImg.src = overlayImage
      } else {
        finishExport()
      }
    }
    img.src = uploadedImage
  }, [uploadedImage, selectedDevice, imagePosition, imageScale, imageRotation, imgNaturalW, imgNaturalH, maskColor, overlayImage, ovImgPos, ovImgScale, ovImgRotation, previewScale])

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
                                <div className="absolute inset-0" style={{ background: '#111', borderRadius: cornerRadius }} />
                                {/* 图片层 */}
                                <div
                                  className="absolute"
                                  style={{
                                    left: (previewWidth - imgW) / 2,
                                    top: (previewHeight - imgH) / 2,
                                    width: imgW,
                                    height: imgH,
                                    transform: `translate(${imagePosition.x}px, ${imagePosition.y}px) rotate(${imageRotation}deg) scale(${imageScale})`,
                                    transformOrigin: 'center center',
                                    cursor: editingOverlay ? 'default' : (dragMode === 'move' ? 'grabbing' : 'grab'),
                                    opacity: 1,
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

                                {/* 白色底部遮罩层 */}
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: 0,
                                    top: selectedDevice.maskTop * previewScale,
                                    width: previewWidth,
                                    height: selectedDevice.maskHeight * previewScale,
                                    borderRadius: selectedDevice.maskRadiusTR > 0 ? `0px ${selectedDevice.maskRadiusTR * previewScale}px 0px 0px` : undefined,
                                    background: maskColor,
                                    boxShadow: `0px ${selectedDevice.maskShadowY * previewScale}px ${selectedDevice.maskShadowBlur * previewScale}px ${4 * previewScale}px rgba(0, 0, 0, 0.15)`,
                                    zIndex: 5,
                                  }}
                                />
                                {/* 模板叠加层 */}
                                {(selectedDevice.templateSrc || selectedDevice.templateColor) && selectedDevice.templateLeft != null && selectedDevice.templateTop != null && selectedDevice.templateWidth != null && selectedDevice.templateHeight != null && (
                                  selectedDevice.templateSrc ? (
                                    <img
                                      src={selectedDevice.templateSrc}
                                      alt="模板"
                                      className="absolute pointer-events-none select-none"
                                      style={{ left: selectedDevice.templateLeft * previewScale, top: selectedDevice.templateTop * previewScale, width: selectedDevice.templateWidth * previewScale, height: selectedDevice.templateHeight * previewScale, zIndex: 10 }}
                                    />
                                  ) : (
                                    <div
                                      className="absolute pointer-events-none"
                                      style={{ left: selectedDevice.templateLeft * previewScale, top: selectedDevice.templateTop * previewScale, width: selectedDevice.templateWidth * previewScale, height: selectedDevice.templateHeight * previewScale, background: selectedDevice.templateColor, zIndex: 10 }}
                                    />
                                  )
                                )}
                                {/* 白边圆角矩形 */}
                                {selectedDevice.whiteRectLeft != null && selectedDevice.whiteRectTop != null && selectedDevice.whiteRectWidth != null && selectedDevice.whiteRectHeight != null && (
                                  <div
                                    className="absolute pointer-events-none"
                                    style={{
                                      left: selectedDevice.whiteRectLeft * previewScale,
                                      top: selectedDevice.whiteRectTop * previewScale,
                                      width: selectedDevice.whiteRectWidth * previewScale,
                                      height: selectedDevice.whiteRectHeight * previewScale,
                                      borderRadius: Math.min(selectedDevice.whiteRectWidth / 2, selectedDevice.whiteRectHeight / 2) * previewScale,
                                      boxSizing: 'border-box',
                                      border: '2px solid #FFFFFF',
                                      zIndex: 5,
                                    }}
                                  />
                                )}
                              </div>

                              {/* 编辑叠加图层时背景变暗蒙版 - 覆盖整个预览区域 */}
                              {ovEditMode && (
                                <div
                                  className="absolute pointer-events-none"
                                  style={{
                                    left: vpLeft, top: vpTop, width: previewWidth, height: previewHeight,
                                    borderRadius: cornerRadius,
                                    background: 'rgba(0,0,0,0.45)',
                                    zIndex: 12,
                                  }}
                                />
                              )}

                              {/* 叠加图层 - 渲染在裁切容器外，不被裁剪 */}
                              <div
                                className="absolute"
                                style={{
                                  left: ovEditMode ? vpLeft + previewWidth / 2 - (ovEditR + 12) : vpLeft + (selectedDevice.circleLeft - 12) * previewScale,
                                  top: ovEditMode ? vpTop + previewHeight / 2 - (ovEditR + 12) : vpTop + (selectedDevice.circleTop - 12) * previewScale,
                                  width: ovEditMode ? (ovEditR + 12) * 2 : (selectedDevice.circleSize + 24) * previewScale,
                                  height: ovEditMode ? (ovEditR + 12) * 2 : (selectedDevice.circleSize + 24) * previewScale,
                                  zIndex: 30,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'left 0.3s ease, top 0.3s ease, width 0.3s ease, height 0.3s ease',
                                }}
                                onMouseDown={(e) => { e.stopPropagation() }}
                                onTouchStart={(e) => { e.stopPropagation() }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (overlayImage) {
                                    if (!editingOverlay) {
                                      const targetR = Math.min(previewWidth, previewHeight) * 0.55
                                      const r = ovPreviewR > 0 ? targetR / ovPreviewR : 1
                                      if (r !== 1) setOvImgPos(prev => ({ x: prev.x * r, y: prev.y * r }))
                                      setEditingOverlay(true)
                                    }
                                  } else {
                                    overlayFileInputRef.current?.click()
                                  }
                                }}
                              >
                                <div
                                  style={{
                                    width: ovEditMode ? ovEditR * 2 : selectedDevice.circleSize * previewScale,
                                    height: ovEditMode ? ovEditR * 2 : selectedDevice.circleSize * previewScale,
                                    borderRadius: '50%',
                                    overflow: 'hidden',
                                    position: 'relative',
                                    flexShrink: 0,
                                    transition: 'width 0.3s ease, height 0.3s ease, left 0.3s ease, top 0.3s ease',
                                    ...(overlayImage
                                      ? { boxShadow: editingOverlay ? '0 0 0 2px var(--accent), 0 0 6px 0px rgba(0,0,0,0.3)' : '0px 0px 6px 0px rgba(0, 0, 0, 0.3)', cursor: 'pointer', background: '#111' }
                                      : { background: '#fff', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }
                                    ),
                                  }}
                                >
                                  {overlayImage ? (
                                    editingOverlay ? (
                                      <div
                                        style={{ width: '100%', height: '100%', position: 'relative' }}
                                        onMouseDown={handleOvMouseDown}
                                        onTouchStart={handleOvTouchStart}
                                      >
                                        <img
                                          src={overlayImage}
                                          alt="叠加图层"
                                          style={{
                                            position: 'absolute',
                                            left: '50%',
                                            top: '50%',
                                            transform: `translate(calc(-50% + ${ovImgPos.x}px), calc(-50% + ${ovImgPos.y}px)) rotate(${ovImgRotation}deg) scale(${ovImgScale})`,
                                            transformOrigin: 'center center',
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'contain',
                                            cursor: dragMode === 'move' ? 'grabbing' : 'grab',
                                            pointerEvents: 'none',
                                            userSelect: 'none',
                                          }}
                                          draggable={false}
                                        />
                                      </div>
                                    ) : (
                                      <img
                                        src={overlayImage}
                                        alt="叠加图层"
                                        style={{
                                          position: 'absolute',
                                          left: '50%',
                                          top: '50%',
                                          transform: `translate(calc(-50% + ${ovImgPos.x}px), calc(-50% + ${ovImgPos.y}px)) rotate(${ovImgRotation}deg) scale(${ovImgScale})`,
                                          transformOrigin: 'center center',
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'contain',
                                          pointerEvents: 'none',
                                          userSelect: 'none',
                                        }}
                                        draggable={false}
                                      />
                                    )
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Upload className="w-4 h-4" style={{ color: '#999' }} />
                                    </div>
                                  )}
                                </div>
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
                  <h3 className="text-base lg:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>「Canopy UI」- 相册表盘</h3>
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
                        <div className="flex items-center gap-1">
                          <span style={{ color: 'var(--text-primary)' }}>{(editingOverlay ? ovImgPos.x : imagePosition.x).toFixed(0)}, {(editingOverlay ? ovImgPos.y : imagePosition.y).toFixed(0)}</span>
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