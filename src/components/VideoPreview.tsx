import { useCallback, useRef, useState, useEffect } from 'react'
import { Play, Pause, Upload, Eye, EyeOff } from 'lucide-react'
import { getEffectiveCrossfadeDuration, useVideoStore } from '../store/useVideoStore'

export function VideoPreview() {
  const {
    videoUrl,
    setVideoElement,
    setVideoFileAndUrl,
    cropSize,
    cropScale,
    setCropScale,
    cropPosition,
    setCropPosition,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    setDuration,
    fps,
    templateImage,
    videoNaturalSize,
    setVideoNaturalSize,
    videoDisplaySize,
    setVideoDisplaySize,
    crossfadeEnabled,
    crossfadeDuration,
  } = useVideoStore()

  const [isPlaying, setIsPlaying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState<'crop' | 'tl' | 'tr' | 'bl' | 'br' | 'left' | 'right' | 'range'>('crop')
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [stateStart, setStateStart] = useState({ x: 0, y: 0, scale: 1, startTime: 0, endTime: 0 })
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDurationLocal] = useState(0)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [isDragOver, setIsDragOver] = useState(false)
  const [showTemplate, setShowTemplate] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const crossfadeVideoRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const crossfadeFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const primary = videoRef.current
    const secondary = crossfadeVideoRef.current
    if (!primary || !secondary || !videoUrl) return

    const selectionDuration = endTime - startTime
    const fadeDuration = getEffectiveCrossfadeDuration(
      crossfadeEnabled,
      crossfadeDuration,
      selectionDuration,
    )
    const loopStart = startTime + fadeDuration

    const stopAnimation = () => {
      if (crossfadeFrameRef.current !== null) {
        window.cancelAnimationFrame(crossfadeFrameRef.current)
        crossfadeFrameRef.current = null
      }
      secondary.pause()
      secondary.style.opacity = '0'
    }

    const updateCrossfade = () => {
      if (primary.paused) {
        stopAnimation()
        return
      }

      const elapsed = primary.currentTime - startTime
      if (fadeDuration > 0 && primary.currentTime >= endTime - fadeDuration) {
        const fadeElapsed = Math.min(
          fadeDuration,
          Math.max(0, primary.currentTime - (endTime - fadeDuration)),
        )
        const expectedHeadTime = startTime + fadeElapsed
        if (Math.abs(secondary.currentTime - expectedHeadTime) > 0.08) {
          secondary.currentTime = expectedHeadTime
        }
        if (secondary.paused) void secondary.play().catch(() => undefined)
        const progress = fadeElapsed / fadeDuration
        const weight = progress * progress * (3 - 2 * progress)
        secondary.style.opacity = String(weight)
      } else {
        secondary.pause()
        secondary.style.opacity = '0'
      }

      if (elapsed >= selectionDuration - 0.01) {
        primary.currentTime = loopStart
        secondary.pause()
        secondary.currentTime = startTime
        secondary.style.opacity = '0'
        void primary.play().catch(() => undefined)
      }

      crossfadeFrameRef.current = window.requestAnimationFrame(updateCrossfade)
    }

    const handlePlay = () => {
      if (primary.currentTime < loopStart || primary.currentTime >= endTime) {
        primary.currentTime = loopStart
      }
      if (crossfadeFrameRef.current === null) {
        crossfadeFrameRef.current = window.requestAnimationFrame(updateCrossfade)
      }
    }

    const handlePause = () => stopAnimation()
    primary.addEventListener('play', handlePlay)
    primary.addEventListener('pause', handlePause)

    return () => {
      primary.removeEventListener('play', handlePlay)
      primary.removeEventListener('pause', handlePause)
      stopAnimation()
    }
  }, [videoUrl, startTime, endTime, crossfadeEnabled, crossfadeDuration])

  useEffect(() => {
    const updateContainerSize = () => {
      const stage = previewStageRef.current
      if (stage) {
        setContainerSize({
          width: stage.clientWidth,
          height: stage.clientHeight,
        })
      }
    }
    updateContainerSize()
    const stage = previewStageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateContainerSize)
      return () => window.removeEventListener('resize', updateContainerSize)
    }
    const observer = new ResizeObserver(updateContainerSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [videoUrl])

  useEffect(() => {
    if (containerSize.width > 0 && videoNaturalSize.width > 0) {
      const videoAspect = videoNaturalSize.width / videoNaturalSize.height
      const availableHeight = containerSize.height * 0.9
      const availableWidth = containerSize.width * 0.94

      let displayHeight = availableHeight
      let displayWidth = displayHeight * videoAspect

      if (displayWidth > availableWidth) {
        displayWidth = availableWidth
        displayHeight = displayWidth / videoAspect
      }

      setVideoDisplaySize({ width: displayWidth, height: displayHeight })
    }
  }, [containerSize, videoNaturalSize, setVideoDisplaySize])

  useEffect(() => {
    if (videoNaturalSize.width > 0) {
      const maxScale = Math.min(
        videoNaturalSize.width / cropSize.width,
        videoNaturalSize.height / cropSize.height,
      )
      const nextScale = Math.min(cropScale, maxScale)
      const cropPixelW = cropSize.width * nextScale
      const cropPixelH = cropSize.height * nextScale
      const maxX = Math.max(0, videoNaturalSize.width - cropPixelW)
      const maxY = Math.max(0, videoNaturalSize.height - cropPixelH)
      if (nextScale !== cropScale) setCropScale(nextScale)
      setCropPosition({
        x: Math.round(Math.min(cropPosition.x, maxX)),
        y: Math.round(Math.min(cropPosition.y, maxY)),
      })
    }
  }, [videoNaturalSize, cropSize, cropScale, cropPosition.x, cropPosition.y, setCropPosition, setCropScale, setStartTime, setVideoNaturalSize])

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const url = URL.createObjectURL(file)
    setVideoFileAndUrl(file, url)
    setVideoElement(null)
    setVideoNaturalSize({ width: 0, height: 0 })
    setVideoDisplaySize({ width: 0, height: 0 })
    setCropScale(1)
    setCropPosition({ x: 0, y: 0 })
    setStartTime(0)
    setEndTime(0)
    setDuration(0)
    setDurationLocal(0)
    setCurrentTime(0)
    setIsPlaying(false)
  }, [videoUrl, setVideoFileAndUrl, setVideoElement, setVideoNaturalSize, setVideoDisplaySize, setCropScale, setCropPosition, setStartTime, setEndTime, setDuration])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleVideoLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setVideoElement(videoRef.current)
      const w = videoRef.current.videoWidth
      const h = videoRef.current.videoHeight
      setVideoNaturalSize({ width: w, height: h })
      const dur = videoRef.current.duration
      setDurationLocal(dur)
      setDuration(dur)
      setStartTime(0)
      setCurrentTime(0)
      videoRef.current.currentTime = 0
      setEndTime(Math.min(10, dur))
    }
  }, [setVideoElement, setVideoNaturalSize, setStartTime, setEndTime, setDuration])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      void videoRef.current.play()
    } else {
      videoRef.current.pause()
    }
  }, [])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [])

  const getCropPixelSize = useCallback(() => {
    return { w: cropSize.width * cropScale, h: cropSize.height * cropScale }
  }, [cropSize, cropScale])

  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent, type: typeof dragType) => {
    if (!('touches' in e)) {
      e.preventDefault()
    }
    e.stopPropagation()
    setIsDragging(true)
    setDragType(type)
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    setDragStart({ x: clientX, y: clientY })
    setStateStart({ x: cropPosition.x, y: cropPosition.y, scale: cropScale, startTime, endTime })
  }, [cropPosition, cropScale, startTime, endTime])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !videoNaturalSize.width) return

    const wrapperRect = wrapperRef.current?.getBoundingClientRect()
    if (!wrapperRect) return

    const scaleX = videoNaturalSize.width / wrapperRect.width
    const scaleY = videoNaturalSize.height / wrapperRect.height

    const deltaX = (e.clientX - dragStart.x) * scaleX
    const deltaY = (e.clientY - dragStart.y) * scaleY

    if (dragType === 'crop') {
      const { w, h } = getCropPixelSize()
      let newX = stateStart.x + deltaX
      let newY = stateStart.y + deltaY
      newX = Math.max(0, Math.min(newX, videoNaturalSize.width - w))
      newY = Math.max(0, Math.min(newY, videoNaturalSize.height - h))
      setCropPosition({ x: Math.round(newX), y: Math.round(newY) })
    } else if (dragType === 'left' || dragType === 'right') {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, mouseX / rect.width))
      const newTime = percentage * duration

      if (dragType === 'left') {
        setStartTime(Math.max(0, Math.min(newTime, stateStart.endTime - 0.01)))
      } else {
        setEndTime(Math.min(duration, Math.max(newTime, stateStart.startTime + 0.01)))
      }
    } else if (dragType === 'range') {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, mouseX / rect.width))
      const newTime = percentage * duration
      const timeDelta = newTime - (dragStart.x - rect.left) / rect.width * duration
      const rangeDuration = stateStart.endTime - stateStart.startTime
      let newStart = stateStart.startTime + timeDelta
      let newEnd = stateStart.endTime + timeDelta
      if (newStart < 0) {
        newStart = 0
        newEnd = rangeDuration
      }
      if (newEnd > duration) {
        newEnd = duration
        newStart = duration - rangeDuration
      }
      setStartTime(newStart)
      setEndTime(newEnd)
    } else {
      const aspectRatio = cropSize.width / cropSize.height
      const basePixelW = stateStart.scale * cropSize.width

      let newPixelW: number
      if (dragType === 'br' || dragType === 'tr') {
        newPixelW = basePixelW + deltaX
      } else {
        newPixelW = basePixelW - deltaX
      }

      const maxPixelW = Math.min(videoNaturalSize.width, videoNaturalSize.height * aspectRatio)
      const minPixelW = Math.min(cropSize.width * 0.3, maxPixelW)
      newPixelW = Math.max(minPixelW, Math.min(maxPixelW, newPixelW))
      const newScale = newPixelW / cropSize.width
      const newPixelH = newPixelW / aspectRatio

      let newX = stateStart.x
      let newY = stateStart.y

      if (dragType === 'bl' || dragType === 'tl') {
        newX = stateStart.x - (newPixelW - basePixelW)
      }
      if (dragType === 'tr' || dragType === 'tl') {
        newY = stateStart.y - (newPixelH - basePixelW / aspectRatio)
      }

      newX = Math.max(0, Math.min(newX, videoNaturalSize.width - newPixelW))
      newY = Math.max(0, Math.min(newY, videoNaturalSize.height - newPixelH))

      setCropScale(newScale)
      setCropPosition({ x: Math.round(newX), y: Math.round(newY) })
    }
  }, [isDragging, dragType, dragStart, stateStart, videoNaturalSize, cropSize, getCropPixelSize, setCropPosition, setCropScale, duration, setStartTime, setEndTime])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      const handleTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0]
        handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent)
      }
      const handleTouchEnd = () => setIsDragging(false)

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !duration) return
    const rect = timelineRef.current.getBoundingClientRect()
    const percentage = (e.clientX - rect.left) / rect.width
    const newTime = percentage * duration
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }, [duration])

  const handleLeftHandleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!('touches' in e)) {
      e.preventDefault()
    }
    e.stopPropagation()
    setIsDragging(true)
    setDragType('left')
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    setDragStart({ x: clientX, y: 0 })
    setStateStart({ x: cropPosition.x, y: cropPosition.y, scale: cropScale, startTime, endTime })
  }, [cropPosition, cropScale, startTime, endTime])

  const handleRightHandleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!('touches' in e)) {
      e.preventDefault()
    }
    e.stopPropagation()
    setIsDragging(true)
    setDragType('right')
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    setDragStart({ x: clientX, y: 0 })
    setStateStart({ x: cropPosition.x, y: cropPosition.y, scale: cropScale, startTime, endTime })
  }, [cropPosition, cropScale, startTime, endTime])

  const handleRangeMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!('touches' in e)) {
      e.preventDefault()
    }
    e.stopPropagation()
    setIsDragging(true)
    setDragType('range')
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    setDragStart({ x: clientX, y: 0 })
    setStateStart({ x: cropPosition.x, y: cropPosition.y, scale: cropScale, startTime, endTime })
  }, [cropPosition, cropScale, startTime, endTime])

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const ms = Math.floor((time % 1) * 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }

  const selectionDuration = endTime - startTime
  const effectiveCrossfadeDuration = getEffectiveCrossfadeDuration(
    crossfadeEnabled,
    crossfadeDuration,
    selectionDuration,
  )
  const frameCount = Math.round((selectionDuration - effectiveCrossfadeDuration) * fps)

  if (!videoUrl) {
    return (
      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden flex flex-col rounded-lg"
        style={{
          background: 'var(--bg-tertiary)',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div
          className="flex-1 flex flex-col items-center justify-center cursor-pointer transition-all duration-200"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
          <div
            className="p-4 md:p-8 rounded-lg border-2 border-dashed transition-all duration-200 text-center"
            style={{
              borderColor: isDragOver ? 'var(--accent)' : 'var(--border-color)',
              background: isDragOver ? 'var(--accent-bg)' : 'transparent',
            }}
          >
            <Upload
              className="mx-auto h-8 w-8 md:h-14 md:w-14 mb-2 md:mb-4 transition-colors duration-200"
              style={{ color: isDragOver ? 'var(--accent)' : 'var(--text-secondary)' }}
            />
            <p className="text-sm md:text-lg font-medium mb-0.5 md:mb-1" style={{ color: 'var(--text-primary)' }}>
              请先上传视频
            </p>
            <p className="text-[10px] md:text-sm" style={{ color: 'var(--text-secondary)' }}>
              拖拽视频文件到此处，或点击选择
            </p>
            <p className="text-[9px] md:text-xs mt-1 md:mt-2" style={{ color: 'var(--text-secondary)' }}>
              支持 MP4, WebM, MOV 等格式
            </p>
          </div>
        </div>

        <div
          className="relative p-2 md:p-4 z-30 flex-shrink-0"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div className="mb-1 md:mb-2 text-center text-[10px] md:text-sm" style={{ color: 'var(--text-secondary)' }}>
            0:00.000 / 0:00.000
          </div>
          <div className="relative h-8 md:h-12 rounded-md" style={{ background: 'var(--bg-tertiary)' }} />
          <div className="mt-1 md:mt-2 text-center text-[9px] md:text-xs" style={{ color: 'var(--text-secondary)' }}>
            等待视频上传...
          </div>
        </div>
      </div>
    )
  }

  const cropPixelW = cropSize.width * cropScale
  const cropPixelH = cropSize.height * cropScale
  const cropDisplayW = (cropPixelW / videoNaturalSize.width) * videoDisplaySize.width
  const cropDisplayH = (cropPixelH / videoNaturalSize.height) * videoDisplaySize.height
  const cropDisplayX = (cropPosition.x / videoNaturalSize.width) * videoDisplaySize.width
  const cropDisplayY = (cropPosition.y / videoNaturalSize.height) * videoDisplaySize.height
  const cropDisplayRadius = Math.min(
    cropSize.cornerRadius * cropDisplayW / cropSize.width,
    cropDisplayW / 2,
    cropDisplayH / 2,
  )
  // 手柄中心沿圆角 45° 弧点向内收，避免圆角大时手柄飘在弧线外
  const handleInset = cropDisplayRadius * (1 - Math.SQRT1_2)

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden flex flex-col rounded-lg"
      style={{
        background: 'var(--bg-tertiary)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div ref={previewStageRef} className="relative flex-1 flex items-center justify-center min-h-0">

        <div
          ref={wrapperRef}
          className="relative"
          style={{
            width: videoNaturalSize.width > 0 ? videoDisplaySize.width : '80%',
            height: videoNaturalSize.width > 0 ? videoDisplaySize.height : '80%',
          }}
        >
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain rounded-lg"
            onLoadedMetadata={handleVideoLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
          {crossfadeEnabled && (
            <video
              ref={crossfadeVideoRef}
              src={videoUrl}
              muted
              playsInline
              preload="auto"
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-contain rounded-lg pointer-events-none"
              style={{ opacity: 0 }}
            />
          )}

          {videoNaturalSize.width > 0 && (
            <div
              className="absolute border-2 border-white cursor-move shadow-lg touch-none"
              style={{
                left: cropDisplayX,
                top: cropDisplayY,
                width: cropDisplayW,
                height: cropDisplayH,
                borderRadius: cropDisplayRadius,
              }}
              onMouseDown={(e) => handleMouseDown(e, 'crop')}
              onTouchStart={(e) => handleMouseDown(e, 'crop')}
            >
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
              </div>

              {templateImage && showTemplate && (
                <img
                  src={templateImage.src}
                  alt="模板预览"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  style={{ opacity: 0.4, borderRadius: cropDisplayRadius }}
                />
              )}

              {/* 四角拖拽手柄：沿圆角弧线内移，中心贴合圆弧 45° 点 */}
              <div
                className="absolute w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-nw-resize hover:scale-125 transition-transform z-30 touch-none -translate-x-1/2 -translate-y-1/2"
                style={{ background: 'var(--accent)', left: handleInset, top: handleInset }}
                onMouseDown={(e) => handleMouseDown(e, 'tl')}
                onTouchStart={(e) => handleMouseDown(e, 'tl')} />
              <div
                className="absolute w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-ne-resize hover:scale-125 transition-transform z-30 touch-none translate-x-1/2 -translate-y-1/2"
                style={{ background: 'var(--accent)', right: handleInset, top: handleInset }}
                onMouseDown={(e) => handleMouseDown(e, 'tr')}
                onTouchStart={(e) => handleMouseDown(e, 'tr')} />
              <div
                className="absolute w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-sw-resize hover:scale-125 transition-transform z-30 touch-none -translate-x-1/2 translate-y-1/2"
                style={{ background: 'var(--accent)', left: handleInset, bottom: handleInset }}
                onMouseDown={(e) => handleMouseDown(e, 'bl')}
                onTouchStart={(e) => handleMouseDown(e, 'bl')} />
              <div
                className="absolute w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-se-resize hover:scale-125 transition-transform z-30 touch-none translate-x-1/2 translate-y-1/2"
                style={{ background: 'var(--accent)', right: handleInset, bottom: handleInset }}
                onMouseDown={(e) => handleMouseDown(e, 'br')}
                onTouchStart={(e) => handleMouseDown(e, 'br')} />
            </div>
          )}
        </div>

        {/* 播放按钮 */}
        <button
          onClick={togglePlay}
          className="absolute bottom-2 left-2 md:bottom-4 md:left-4 p-2 md:p-3 rounded-full transition-all duration-200 z-30 hover:scale-105"
          style={{
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
          }}
        >
          {isPlaying ? <Pause className="w-4 h-4 md:w-6 md:h-6" /> : <Play className="w-4 h-4 md:w-6 md:h-6" />}
        </button>

        {/* 模板叠加显隐切换 */}
        {templateImage && (
          <button
            onClick={() => setShowTemplate((v) => !v)}
            className="absolute bottom-2 right-2 md:bottom-4 md:right-4 p-2 md:p-3 rounded-full transition-all duration-200 z-30 hover:scale-105"
            style={{
              background: 'rgba(0, 0, 0, 0.5)',
              color: showTemplate ? 'white' : 'rgba(255, 255, 255, 0.4)',
            }}
            title={showTemplate ? '隐藏模板叠加' : '显示模板叠加'}
          >
            {showTemplate ? <Eye className="w-4 h-4 md:w-6 md:h-6" /> : <EyeOff className="w-4 h-4 md:w-6 md:h-6" />}
          </button>
        )}
      </div>

      {/* 时间轴区域 */}
      <div
          className="relative p-2 md:p-4 z-30 flex-shrink-0"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div className="mb-1 md:mb-2 text-center text-[10px] md:text-sm" style={{ color: 'var(--text-secondary)' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <div
          ref={timelineRef}
          className="relative h-9 md:h-11 rounded-lg cursor-pointer touch-none overflow-hidden select-none"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.25)',
          }}
          onClick={handleTimelineClick}
        >
          {crossfadeEnabled && effectiveCrossfadeDuration > 0 && duration > 0 && (
            <>
              <div
                className="absolute top-0 bottom-0 z-[15] pointer-events-none"
                style={{
                  left: `${(startTime / duration) * 100}%`,
                  width: `${(effectiveCrossfadeDuration / duration) * 100}%`,
                  background: 'rgba(95, 237, 152, 0.2)',
                  borderRight: '2px solid #5FED98',
                }}
              />
              <div
                className="absolute top-0 bottom-0 z-[15] pointer-events-none"
                style={{
                  left: `${((endTime - effectiveCrossfadeDuration) / duration) * 100}%`,
                  width: `${(effectiveCrossfadeDuration / duration) * 100}%`,
                  background: 'rgba(237, 119, 92, 0.2)',
                  borderLeft: '2px solid #ED775C',
                }}
              />
            </>
          )}
          {/* 未选区遮罩：左侧 */}
          <div
            className="absolute top-0 bottom-0 left-0 z-10 pointer-events-none"
            style={{
              width: `${(startTime / duration) * 100}%`,
              background: 'rgba(0, 0, 0, 0.35)',
            }}
          />
          {/* 未选区遮罩：右侧 */}
          <div
            className="absolute top-0 bottom-0 right-0 z-10 pointer-events-none"
            style={{
              width: `${((duration - endTime) / duration) * 100}%`,
              background: 'rgba(0, 0, 0, 0.35)',
            }}
          />
          {/* 选区高亮 */}
          <div
            className="absolute top-0 bottom-0 z-10 cursor-grab active:cursor-grabbing"
            style={{
              left: `${(startTime / duration) * 100}%`,
              width: `${((endTime - startTime) / duration) * 100}%`,
              background: 'rgba(72, 120, 144, 0.18)',
              boxShadow: 'inset 0 2px 0 var(--accent), inset 0 -2px 0 var(--accent)',
            }}
            onMouseDown={handleRangeMouseDown}
            onTouchStart={handleRangeMouseDown}
          />
          {/* 播放进度指示线 */}
          <div
            className="absolute top-0 bottom-0 w-0.5 z-20 pointer-events-none"
            style={{
              left: `${(currentTime / duration) * 100}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(255, 255, 255, 0.9)',
              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
            }}
          />
          {/* 左手柄 - 绿色抓手 */}
          <div
            className="absolute top-0 bottom-0 flex items-center justify-center w-4 cursor-ew-resize z-30 touch-none group"
            style={{
              left: `max(8px, min(calc(100% - 8px), ${(startTime / duration) * 100}%))`,
              transform: 'translateX(-50%)',
            }}
            onMouseDown={handleLeftHandleMouseDown}
            onTouchStart={handleLeftHandleMouseDown}
          >
            <div
              className="w-1.5 h-5 md:h-6 rounded-full flex flex-col items-center justify-center gap-0.5 transition-transform group-hover:scale-y-110"
              style={{ background: '#5FED98', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }}
            >
              <span className="w-px h-2 rounded-full" style={{ background: 'rgba(0,0,0,0.25)' }} />
            </div>
          </div>
          {/* 右手柄 - 橙色抓手 */}
          <div
            className="absolute top-0 bottom-0 flex items-center justify-center w-4 cursor-ew-resize z-30 touch-none group"
            style={{
              left: `max(8px, min(calc(100% - 8px), ${(endTime / duration) * 100}%))`,
              transform: 'translateX(-50%)',
            }}
            onMouseDown={handleRightHandleMouseDown}
            onTouchStart={handleRightHandleMouseDown}
          >
            <div
              className="w-1.5 h-5 md:h-6 rounded-full flex flex-col items-center justify-center gap-0.5 transition-transform group-hover:scale-y-110"
              style={{ background: '#ED775C', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }}
            >
              <span className="w-px h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.4)' }} />
            </div>
          </div>
        </div>

        {/* 选区起止时间 */}
        <div className="mt-1.5 flex items-center justify-between text-[9px] md:text-xs">
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#5FED98' }} />
            {formatTime(startTime)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>拖动两端手柄或直接拖动选区</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            {formatTime(endTime)}
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ED775C' }} />
          </span>
        </div>

        {videoUrl && (
          <div className="mt-1.5 flex items-center justify-center gap-2 md:gap-3 flex-wrap">
            <div
              className="px-2 md:px-3 py-1 rounded-md"
              style={{
                background: 'rgba(72, 120, 144, 0.06)',
                border: '1px solid rgba(72, 120, 144, 0.15)',
              }}
            >
              <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>片段时长：</span>
              <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {formatTime(endTime - startTime)}
              </span>
            </div>
            <div
              className="px-2 md:px-3 py-1 rounded-md"
              style={{
                background: 'rgba(72, 120, 144, 0.06)',
                border: '1px solid rgba(72, 120, 144, 0.15)',
              }}
            >
              <span className="text-[10px] md:text-xs" style={{ color: 'var(--accent)' }}>序列帧数量：</span>
              <span className="text-[10px] md:text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {frameCount} 帧
              </span>
              <span className="text-[10px] md:text-xs ml-1" style={{ color: 'var(--text-muted)' }}>({fps}fps)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
