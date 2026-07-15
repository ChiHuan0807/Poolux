import { useCallback, useRef, useState, useEffect } from 'react'
import { Play, Pause, Upload } from 'lucide-react'
import { useVideoStore } from '../store/useVideoStore'

export function VideoPreview() {
  const {
    videoUrl,
    videoFile,
    videoElement,
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

  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const updateContainerSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }
    updateContainerSize()
    window.addEventListener('resize', updateContainerSize)
    return () => window.removeEventListener('resize', updateContainerSize)
  }, [])

  useEffect(() => {
    if (containerSize.width > 0 && videoNaturalSize.width > 0) {
      const videoAspect = videoNaturalSize.width / videoNaturalSize.height
      const availableHeight = containerSize.height * 0.68
      const availableWidth = containerSize.width

      let displayHeight = availableHeight
      let displayWidth = displayHeight * videoAspect

      if (displayWidth > availableWidth) {
        displayWidth = availableWidth
        displayHeight = displayWidth / videoAspect
      }

      setVideoDisplaySize({ width: displayWidth, height: displayHeight })
    }
  }, [containerSize, videoNaturalSize])

  useEffect(() => {
    if (videoNaturalSize.width > 0) {
      const cropPixelW = cropSize.width * cropScale
      const cropPixelH = cropSize.height * cropScale
      const maxX = Math.max(0, videoNaturalSize.width - cropPixelW)
      const maxY = Math.max(0, videoNaturalSize.height - cropPixelH)
      setCropPosition({
        x: Math.round(Math.min(cropPosition.x, maxX)),
        y: Math.round(Math.min(cropPosition.y, maxY)),
      })
    }
  }, [videoNaturalSize, cropSize, cropScale])

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const url = URL.createObjectURL(file)
    setVideoFileAndUrl(file, url)
    setVideoNaturalSize({ width: 0, height: 0 })
    setVideoDisplaySize({ width: 0, height: 0 })
    setCurrentTime(0)
    setIsPlaying(false)
  }, [videoUrl, setVideoFileAndUrl])

  const handleClearVideo = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    if (videoRef.current) videoRef.current.pause()
    setVideoFileAndUrl(null, null)
    setVideoNaturalSize({ width: 0, height: 0 })
    setVideoDisplaySize({ width: 0, height: 0 })
    setCurrentTime(0)
    setIsPlaying(false)
    setDurationLocal(0)
    setDuration(0)
  }, [videoUrl, setVideoFileAndUrl, setDuration])

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
      setEndTime(Math.min(10, dur))
    }
  }, [setVideoElement, setEndTime, setDuration])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

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
      newPixelW = Math.max(cropSize.width * 0.3, Math.min(maxPixelW, newPixelW))
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
  }, [isDragging, dragType, dragStart, stateStart, videoNaturalSize, cropSize, getCropPixelSize, setCropPosition, setCropScale, duration, startTime, endTime, setStartTime, setEndTime])

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

  const frameCount = Math.round((endTime - startTime) * fps)

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
      <div className="relative flex-1 flex items-center justify-center min-h-0">

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
            onEnded={() => setIsPlaying(false)}
          />

          {videoNaturalSize.width > 0 && (
            <div
              className="absolute border-2 border-white cursor-move shadow-lg touch-none"
              style={{
                left: cropDisplayX,
                top: cropDisplayY,
                width: cropDisplayW,
                height: cropDisplayH,
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

              {templateImage && (
                <img
                  src={templateImage.src}
                  alt="模板预览"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  style={{ opacity: 0.4 }}
                />
              )}

              {/* 四角拖拽手柄 */}
              <div
                className="absolute -top-2.5 -left-2.5 w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-nw-resize hover:scale-110 transition-transform z-30 touch-none"
                style={{ background: 'var(--accent)' }}
                onMouseDown={(e) => handleMouseDown(e, 'tl')}
                onTouchStart={(e) => handleMouseDown(e, 'tl')} />
              <div
                className="absolute -top-2.5 -right-2.5 w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-ne-resize hover:scale-110 transition-transform z-30 touch-none"
                style={{ background: 'var(--accent)' }}
                onMouseDown={(e) => handleMouseDown(e, 'tr')}
                onTouchStart={(e) => handleMouseDown(e, 'tr')} />
              <div
                className="absolute -bottom-2.5 -left-2.5 w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-sw-resize hover:scale-110 transition-transform z-30 touch-none"
                style={{ background: 'var(--accent)' }}
                onMouseDown={(e) => handleMouseDown(e, 'bl')}
                onTouchStart={(e) => handleMouseDown(e, 'bl')} />
              <div
                className="absolute -bottom-2.5 -right-2.5 w-6 h-6 md:w-5 md:h-5 border-2 border-white rounded-full cursor-se-resize hover:scale-110 transition-transform z-30 touch-none"
                style={{ background: 'var(--accent)' }}
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
          className="relative h-8 md:h-12 rounded-md cursor-pointer touch-none"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
          }}
          onClick={handleTimelineClick}
        >
          {/* 选区 */}
          <div
            className="absolute top-0 bottom-0 z-10 cursor-grab active:cursor-grabbing rounded-lg"
            style={{
              left: `${(startTime / duration) * 100}%`,
              width: `${((endTime - startTime) / duration) * 100}%`,
              background: 'rgba(72, 120, 144, 0.2)',
            }}
            onMouseDown={handleRangeMouseDown}
            onTouchStart={handleRangeMouseDown}
          />
          {/* 左手柄 - 绿色 */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-5 h-8 md:w-6 md:h-8 rounded cursor-ew-resize transition-all duration-200 z-30 touch-none hover:scale-110"
            style={{
              left: `${(startTime / duration) * 100}%`,
              transform: 'translateX(-50%)',
              background: '#5FED98',
            }}
            onMouseDown={handleLeftHandleMouseDown}
            onTouchStart={handleLeftHandleMouseDown}
          />
          {/* 右手柄 - 橙色 */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-5 h-8 md:w-6 md:h-8 rounded cursor-ew-resize transition-all duration-200 z-30 touch-none hover:scale-110"
            style={{
              left: `${(endTime / duration) * 100}%`,
              transform: 'translateX(-50%)',
              background: '#ED775C',
            }}
            onMouseDown={handleRightHandleMouseDown}
            onTouchStart={handleRightHandleMouseDown}
          />
          {/* 起始时间标签 */}
          <div
            className="absolute top-0.5 left-0.5 px-1 py-px md:px-2 text-[9px] md:text-xs rounded-md z-40"
            style={{
              background: '#5FED98',
              color: '#2D3436',
            }}
          >
            {formatTime(startTime)}
          </div>
          {/* 结束时间标签 */}
          <div
            className="absolute top-0.5 right-0.5 px-1 py-px md:px-2 text-[9px] md:text-xs rounded-md z-40"
            style={{
              background: '#ED775C',
              color: '#fff',
            }}
          >
            {formatTime(endTime)}
          </div>
        </div>

        <div className="mt-1 md:mt-2 text-center text-[10px] md:text-xs" style={{ color: 'rgba(160, 160, 160, 1)' }}>
          拖动绿色和红色标记选择要导出的视频片段
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
