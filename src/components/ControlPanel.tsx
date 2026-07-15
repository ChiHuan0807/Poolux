import { useCallback, useState, useRef } from 'react'
import { Download, Image, Trash2, Plus, X, RotateCw } from 'lucide-react'
import { useVideoStore, CROP_SIZES } from '../store/useVideoStore'

export function ControlPanel() {
  const {
    cropSize,
    setCropSize,
    cropScale,
    cropPosition,
    fps,
    setFps,
    isExporting,
    setIsExporting,
    exportedFrames,
    setExportedFrames,
    videoElement,
    videoUrl,
    setVideoFileAndUrl,
    setVideoElement,
    startTime,
    endTime,
    setEndTime,
    duration,
    setDuration,
    templateImage,
    setTemplateImage,
    videoNaturalSize,
    setVideoNaturalSize,
    setVideoDisplaySize,
    getFrameCount,
  } = useVideoStore()

  const [isZipping, setIsZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const [customFrameInput, setCustomFrameInput] = useState('')
  const [isClearHovered, setIsClearHovered] = useState(false)
  const templateInputRef = useRef<HTMLInputElement>(null)

  const handleClearVideo = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const videoEl = document.querySelector('video') as HTMLVideoElement | null
    if (videoEl) videoEl.pause()
    setVideoFileAndUrl(null, null)
    setVideoElement(null)
    setVideoNaturalSize({ width: 0, height: 0 })
    setVideoDisplaySize({ width: 0, height: 0 })
    setDuration(0)
  }, [videoUrl, setVideoFileAndUrl, setVideoElement, setVideoNaturalSize, setVideoDisplaySize, setDuration])

  const handleTemplateUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    const img = new window.Image()
    img.onload = () => {
      setTemplateImage(img)
    }
    img.src = URL.createObjectURL(file)
    e.target.value = ''
  }, [setTemplateImage])

  const handleRemoveTemplate = useCallback(() => {
    if (templateImage) {
      URL.revokeObjectURL(templateImage.src)
    }
    setTemplateImage(null)
  }, [templateImage, setTemplateImage])

  const applyCustomFrameCount = useCallback(() => {
    const customFrames = parseInt(customFrameInput)
    if (customFrames > 0 && duration > 0) {
      const customDuration = customFrames / fps
      const newEnd = Math.min(startTime + customDuration, duration)
      setEndTime(newEnd)
    }
  }, [customFrameInput, fps, startTime, duration, setEndTime])

  const exportFrames = useCallback(async () => {
    if (!videoElement || !videoUrl) return

    const frameCount = getFrameCount()
    if (frameCount <= 0) return

    setIsExporting(true)
    setExportedFrames([])

    const targetWidth = cropSize.width
    const targetHeight = cropSize.height
    const r = cropSize.cornerRadius

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = targetWidth
    canvas.height = targetHeight

    const frames: string[] = []
    const segmentDuration = endTime - startTime
    const srcW = cropSize.width * cropScale
    const srcH = cropSize.height * cropScale

    for (let i = 0; i < frameCount; i++) {
      const time = startTime + (segmentDuration / frameCount) * i
      videoElement.currentTime = time

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked)
          resolve()
        }
        videoElement.addEventListener('seeked', onSeeked)
      })

      ctx.clearRect(0, 0, targetWidth, targetHeight)

      ctx.save()
      ctx.beginPath()

      const rx = Math.min(r, targetWidth / 2)
      const ry = Math.min(r, targetHeight / 2)

      ctx.ellipse(rx, ry, rx, ry, 0, Math.PI, 1.5 * Math.PI)
      ctx.lineTo(targetWidth - rx, 0)
      ctx.ellipse(targetWidth - rx, ry, rx, ry, 0, 1.5 * Math.PI, 2 * Math.PI)
      ctx.lineTo(targetWidth, targetHeight - ry)
      ctx.ellipse(targetWidth - rx, targetHeight - ry, rx, ry, 0, 0, 0.5 * Math.PI)
      ctx.lineTo(rx, targetHeight)
      ctx.ellipse(rx, targetHeight - ry, rx, ry, 0, 0.5 * Math.PI, Math.PI)
      ctx.closePath()
      ctx.clip()

      ctx.drawImage(
        videoElement,
        cropPosition.x,
        cropPosition.y,
        srcW,
        srcH,
        0,
        0,
        targetWidth,
        targetHeight
      )

      ctx.restore()

      if (templateImage) {
        ctx.drawImage(templateImage, 0, 0, targetWidth, targetHeight)
      }

      frames.push(canvas.toDataURL('image/png'))
    }

    setExportedFrames(frames)
    setIsExporting(false)
  }, [videoElement, videoUrl, cropSize, cropScale, cropPosition, startTime, endTime, templateImage, getFrameCount, setIsExporting, setExportedFrames])

  const downloadFrame = useCallback((frameData: string, index: number) => {
    const link = document.createElement('a')
    link.download = `frame-${index + 1}.png`
    link.href = frameData
    link.click()
  }, [])

  const clearFrames = useCallback(() => {
    setExportedFrames([])
  }, [setExportedFrames])

  const downloadAllAsZip = useCallback(async () => {
    if (exportedFrames.length === 0) return

    setIsZipping(true)
    setZipProgress(0)

    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()

    for (let i = 0; i < exportedFrames.length; i++) {
      const frame = exportedFrames[i]
      const fileName = `frame-${String(i + 1).padStart(4, '0')}.png`
      const base64Data = frame.split(',')[1]
      if (base64Data) {
        zip.file(fileName, base64Data, { base64: true })
      }
      setZipProgress(Math.round(((i + 1) / exportedFrames.length) * 100))
    }

    try {
      const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgress(Math.round(metadata.percent))
      })
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(content)
      link.download = `video_frames_${timestamp}.zip`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      console.error('ZIP creation failed:', error)
      alert('ZIP文件创建失败，请重试')
    } finally {
      setIsZipping(false)
      setZipProgress(0)
    }
  }, [exportedFrames])

  const frameCount = getFrameCount()

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* 导出设置卡片 */}
      <div
        className="rounded-lg p-4 lg:p-5"
        style={{
          background: 'var(--bg-tertiary)',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div className="flex items-center justify-between mb-3 lg:mb-4">
          <h3
            className="text-base lg:text-lg font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Image className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: 'var(--accent)' }} />
            导出设置
          </h3>
          {videoUrl && (
            <button
              onClick={handleClearVideo}
              onMouseEnter={() => setIsClearHovered(true)}
              onMouseLeave={() => setIsClearHovered(false)}
              className="flex items-center rounded-md"
              style={{
                border: `1.5px solid ${isClearHovered ? '#ED775C' : 'rgba(237, 119, 92, 0.4)'}`,
                background: isClearHovered ? 'rgba(237, 119, 92, 0.06)' : 'transparent',
                padding: '6px',
                transition: 'border-color 0.3s, background 0.3s',
              }}
            >
              <div 
                className="flex items-center justify-center"
                style={{ 
                  width: '28px', 
                  height: '28px',
                  flexShrink: 0,
                }}
              >
                <RotateCw className="w-4 h-4" style={{ color: '#ED775C' }} />
              </div>
              <div
                className="overflow-hidden"
                style={{
                  maxWidth: isClearHovered ? '100px' : '0px',
                  transition: 'max-width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                <span className="text-xs lg:text-sm font-medium whitespace-nowrap" style={{ color: '#ED775C' }}>
                  清除视频
                </span>
              </div>
            </button>
          )}
        </div>

        <div className="space-y-3 lg:space-y-4">
          {/* 目标设备 */}
          <div>
            <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>
              目标设备
            </label>
            <div className="grid grid-cols-3 gap-1.5 lg:gap-2">
              {CROP_SIZES.map((size) => (
                <button
                  key={size.label}
                  onClick={() => setCropSize(size)}
                  className="py-1.5 lg:py-2 px-1.5 lg:px-3 rounded-md transition-all duration-200 text-center"
                  style={{
                    border: `1.5px solid ${cropSize.label === size.label ? 'var(--accent)' : 'var(--border-color)'}`,
                    background: cropSize.label === size.label ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                    color: cropSize.label === size.label ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: cropSize.label === size.label ? 600 : 400,
                  }}
                >
                  <div className="text-[10px] lg:text-sm leading-tight">{size.label}</div>
                  <div className="text-[9px] lg:text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {size.width}×{size.height}px
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 帧率 */}
          <div>
            <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>
              帧率 (fps)
            </label>
            <div className="flex gap-1.5 lg:gap-2">
              {[30, 45, 60].map((fpsOption) => (
                <button
                  key={fpsOption}
                  onClick={() => setFps(fpsOption)}
                  className="flex-1 py-1.5 lg:py-2 px-3 lg:px-4 rounded-md transition-all duration-200 text-sm lg:text-base"
                  style={{
                    border: `1.5px solid ${fps === fpsOption ? 'var(--accent)' : 'var(--border-color)'}`,
                    background: fps === fpsOption ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                    color: fps === fpsOption ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: fps === fpsOption ? 600 : 400,
                  }}
                >
                  {fpsOption}
                </button>
              ))}
            </div>
          </div>

          {/* 模板图片 */}
          <div>
            <input
              ref={templateInputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={handleTemplateUpload}
            />
            {templateImage ? (
              <div
                className="flex items-center gap-2 p-2 rounded-md"
                style={{
                  background: 'rgba(95, 237, 152, 0.08)',
                  border: '1px solid rgba(95, 237, 152, 0.3)',
                }}
              >
                <img
                  src={templateImage.src}
                  alt="模板预览"
                  className="w-10 h-10 object-contain rounded-lg"
                />
                <span className="flex-1 text-sm font-medium" style={{ color: '#4CAF7D' }}>模板已添加</span>
                <button
                  onClick={handleRemoveTemplate}
                  className="p-1 rounded-lg transition-colors"
                  style={{ background: 'rgba(95, 237, 152, 0.12)' }}
                >
                  <X className="w-4 h-4" style={{ color: '#4CAF7D' }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => templateInputRef.current?.click()}
                className="w-full py-2 px-4 rounded-md transition-all duration-200 flex items-center justify-center gap-2"
                style={{
                  border: '1.5px dashed var(--border-color)',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-tertiary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.color = 'var(--accent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                <Plus className="w-4 h-4" />
                添加模板
              </button>
            )}
          </div>

          {/* 摘要信息 */}
          <div
            className="p-2.5 lg:p-3 rounded-md"
            style={{ background: 'var(--bg-tertiary)' }}
          >
            <div className="flex items-center justify-between text-xs lg:text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>片段时长</span>
              <span style={{ color: 'var(--text-primary)' }}>{(endTime - startTime).toFixed(3)}s</span>
            </div>
            <div className="flex items-center justify-between text-xs lg:text-sm mt-1">
              <span style={{ color: 'var(--text-secondary)' }}>帧率</span>
              <span style={{ color: 'var(--text-primary)' }}>{fps} fps</span>
            </div>
            <div className="flex items-center justify-between text-xs lg:text-sm mt-1 pt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>序列帧数量</span>
              <span className="font-bold" style={{ color: 'var(--accent)' }}>{frameCount} 帧</span>
            </div>
            <p className="text-[10px] lg:text-xs mt-1.5 lg:mt-2" style={{ color: 'var(--text-secondary)' }}>
              导出分辨率：{cropSize.width}×{cropSize.height}px | 圆角：{cropSize.cornerRadius}px
            </p>
          </div>

          {/* 导出按钮 */}
          <button
            onClick={exportFrames}
            disabled={!videoElement || isExporting || frameCount <= 0}
            className="w-full py-2.5 lg:py-3 px-4 font-medium rounded-md transition-all duration-200 flex items-center justify-center gap-2 text-sm lg:text-base text-white disabled:cursor-not-allowed"
            style={{
              background: 'var(--accent)',
              opacity: (!videoElement || isExporting || frameCount <= 0) ? 0.4 : 1,
            }}
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 lg:w-5 lg:h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                导出中...
              </>
            ) : (
              '导出序列帧'
            )}
          </button>

          {/* 指定帧数 */}
          <div className="pt-2" style={{ borderTop: '1px solid var(--border-color)' }}>
            <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>
              指定序列帧数量
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={customFrameInput}
                onChange={(e) => setCustomFrameInput(e.target.value)}
                placeholder="输入帧数"
                className="flex-1 px-2.5 lg:px-3 py-1.5 lg:py-2 rounded-md text-xs lg:text-sm focus:outline-none transition-all duration-200"
                style={{
                  border: '1.5px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-bg)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyCustomFrameCount()
                  }
                }}
              />
              <button
                onClick={applyCustomFrameCount}
                disabled={!videoElement || duration <= 0 || !customFrameInput}
                className="px-3 lg:px-4 py-1.5 lg:py-2 disabled:cursor-not-allowed text-xs lg:text-sm font-medium rounded-md transition-all duration-200"
                style={{
                  background: (!videoElement || duration <= 0 || !customFrameInput)
                    ? 'rgba(72, 120, 144, 0.15)'
                    : 'var(--accent)',
                  color: 'white',
                }}
              >
                应用
              </button>
            </div>
            <p className="text-[10px] lg:text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              应用后将调整选区时长，您可以在时间轴上拖动选择起始位置
            </p>
          </div>
        </div>
      </div>

      {/* 导出结果卡片 */}
      {exportedFrames.length > 0 && (
        <div
          className="rounded-lg p-4 lg:p-5"
          style={{
            background: 'var(--bg-tertiary)',
            boxShadow: 'var(--shadow-card)',
            border: '1px solid var(--border-color)',
          }}
        >
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <h3
              className="text-base lg:text-lg font-semibold flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Image className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: 'var(--accent)' }} />
              导出结果
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={clearFrames}
                disabled={isZipping}
                className="p-1.5 lg:p-2 disabled:opacity-50 text-white rounded-md transition-all duration-200"
                style={{ background: 'var(--danger)' }}
                title="清除所有"
              >
                <Trash2 className="w-4 h-4 lg:w-5 lg:h-5" />
              </button>
              <button
                onClick={downloadAllAsZip}
                disabled={isZipping}
                className="p-1.5 lg:p-2 disabled:opacity-50 rounded-md transition-all duration-200"
                style={{
                  background: 'var(--success)',
                  color: '#2D3436',
                }}
                title="下载 ZIP"
              >
                {isZipping ? (
                  <div className="w-4 h-4 lg:w-5 lg:h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download className="w-4 h-4 lg:w-5 lg:h-5" />
                )}
              </button>
            </div>
          </div>

          {isZipping && (
            <div className="mb-3 lg:mb-4">
              <div
                className="w-full rounded-full h-2"
                style={{ background: 'var(--border-color)' }}
              >
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${zipProgress}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-5 gap-3">
            {exportedFrames.map((frame, index) => (
              <div
                key={index}
                className="relative group rounded-md p-1"
                style={{ background: 'var(--accent-bg)' }}
              >
                <img
                  src={frame}
                  alt={`Frame ${index + 1}`}
                  className="w-full object-contain rounded-lg"
                  style={{ aspectRatio: `${cropSize.width}/${cropSize.height}` }}
                />
                <div
                  className="absolute inset-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                >
                  <button
                    onClick={() => downloadFrame(frame, index)}
                    className="p-2 rounded-full transition-colors"
                    style={{ background: 'var(--bg-active)' }}
                  >
                    <Download className="w-4 h-4" style={{ color: 'var(--text-primary)' }} />
                  </button>
                </div>
                <span
                  className="absolute bottom-2 left-2 text-white text-xs px-1.5 py-0.5 rounded-md"
                  style={{ background: 'rgba(0,0,0,0.6)' }}
                >
                  {index + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
