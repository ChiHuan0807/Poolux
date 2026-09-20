import { useCallback, useEffect, useState, useRef } from 'react'
import { Download, Image, Trash2, Plus, X, RotateCw } from 'lucide-react'
import {
  CROSSFADE_LIMITS,
  CUSTOM_CROP_LIMITS,
  FRAME_RATE_LIMITS,
  getEffectiveCrossfadeDuration,
  type CropSize,
  type ExportedFrame,
  useVideoStore,
  CROP_SIZES,
} from '../store/useVideoStore'

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('帧图像编码失败'))
    }, 'image/png')
  })
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`等待视频事件超时: ${eventName}`))
    }, 15000)
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener(eventName, handleEvent)
      video.removeEventListener('error', handleError)
    }
    const handleEvent = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(video.error ?? new Error('视频解码失败'))
    }
    video.addEventListener(eventName, handleEvent, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })
}

async function createExportVideo(videoUrl: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  const loaded = waitForVideoEvent(video, 'loadeddata')
  video.src = videoUrl
  video.load()
  await loaded
  video.pause()
  return video
}

async function seekExportVideo(video: HTMLVideoElement, time: number): Promise<number> {
  if (Math.abs(video.currentTime - time) <= 0.000001) {
    return video.currentTime
  }

  // rVFC 必须提前注册，但不能接受 seeked 之前的回调：该回调可能对应 seek 前
  // 已排队的旧帧。seeked 只作为阶段标记，不能直接作为帧已就绪的证明。
  return new Promise<number>((resolve, reject) => {
    let resolved = false
    let seeked = false
    let rvfcId: number | null = null
    let timeoutId: number | null = null

    const cleanup = () => {
      if (rvfcId !== null) {
        video.cancelVideoFrameCallback(rvfcId)
        rvfcId = null
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
      video.removeEventListener('error', onError)
    }

    const settle = (value: number) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(value)
    }

    const onError = () => {
      if (resolved) return
      resolved = true
      cleanup()
      reject(video.error ?? new Error('视频帧解码失败'))
    }

    const requestFrame = () => {
      if (resolved || typeof video.requestVideoFrameCallback !== 'function') return
      rvfcId = video.requestVideoFrameCallback((_now, metadata) => {
        rvfcId = null
        if (!seeked) {
          // 忽略 seek 前的旧帧，并继续等待真正的 seek 结果。
          requestFrame()
          return
        }
        settle(metadata.mediaTime)
      })
    }

    const onSeeked = () => {
      seeked = true
      // rVFC 通常会在目标帧 present 时回调；这里不直接 draw，也不立即 resolve。
      // 没有 rVFC 的浏览器才使用延迟兜底，避免读到尚未提交的旧缓冲区。
      if (typeof video.requestVideoFrameCallback !== 'function') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => settle(video.currentTime))
        })
      }
    }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    timeoutId = window.setTimeout(() => {
      if (seeked) settle(video.currentTime)
      else onError()
    }, 1000)

    requestFrame()
    video.currentTime = time
  })
}

function waitForNextPresentedFrame(
  video: HTMLVideoElement,
  previousMediaTime: number,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      reject(new Error('当前浏览器不支持逐帧视频采集'))
      return
    }

    let callbackId: number | null = null
    let finished = false

    const cleanup = () => {
      if (callbackId !== null) {
        video.cancelVideoFrameCallback(callbackId)
        callbackId = null
      }
      window.clearTimeout(timeoutId)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
    }

    const settle = (mediaTime: number | null) => {
      if (finished) return
      finished = true
      video.pause()
      cleanup()
      resolve(mediaTime)
    }

    const onEnded = () => settle(null)
    const onError = () => {
      if (finished) return
      finished = true
      cleanup()
      reject(video.error ?? new Error('视频帧解码失败'))
    }

    const timeoutId = window.setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('等待视频帧超时'))
    }, 15000)

    const requestNext = () => {
      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        callbackId = null
        if (metadata.mediaTime <= previousMediaTime + 0.000001) {
          requestNext()
          return
        }
        settle(metadata.mediaTime)
      })
    }

    video.addEventListener('ended', onEnded, { once: true })
    video.addEventListener('error', onError, { once: true })
    requestNext()
  })
}

async function renderExportFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cropSize: CropSize,
  cropScale: number,
  cropPosition: { x: number; y: number },
  templateImage: HTMLImageElement | null,
): Promise<Blob> {
  const targetWidth = cropSize.width
  const targetHeight = cropSize.height
  const radius = Math.min(cropSize.cornerRadius, targetWidth / 2, targetHeight / 2)
  const srcW = cropSize.width * cropScale
  const srcH = cropSize.height * cropScale

  ctx.clearRect(0, 0, targetWidth, targetHeight)
  ctx.save()
  ctx.beginPath()

  if (radius === 0) {
    ctx.rect(0, 0, targetWidth, targetHeight)
  } else if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, targetWidth, targetHeight, radius)
  } else {
    ctx.moveTo(radius, 0)
    ctx.lineTo(targetWidth - radius, 0)
    ctx.arcTo(targetWidth, 0, targetWidth, radius, radius)
    ctx.lineTo(targetWidth, targetHeight - radius)
    ctx.arcTo(targetWidth, targetHeight, targetWidth - radius, targetHeight, radius)
    ctx.lineTo(radius, targetHeight)
    ctx.arcTo(0, targetHeight, 0, targetHeight - radius, radius)
    ctx.lineTo(0, radius)
    ctx.arcTo(0, 0, radius, 0, radius)
  }
  ctx.clip()

  ctx.drawImage(
    video,
    cropPosition.x,
    cropPosition.y,
    srcW,
    srcH,
    0,
    0,
    targetWidth,
    targetHeight,
  )

  if (templateImage) {
    ctx.drawImage(templateImage, 0, 0, targetWidth, targetHeight)
  }
  ctx.restore()

  return canvasToBlob(canvas)
}

function addExportedFrame(frames: ExportedFrame[], blob: Blob): void {
  frames.push({ blob, url: URL.createObjectURL(blob) })
}

async function blendFrameBlobs(
  tailBlob: Blob,
  headBlob: Blob,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  weight: number,
): Promise<Blob> {
  const [tailImage, headImage] = await Promise.all([
    createImageBitmap(tailBlob),
    createImageBitmap(headBlob),
  ])

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = 1 - weight
  ctx.drawImage(tailImage, 0, 0)
  ctx.globalAlpha = weight
  ctx.drawImage(headImage, 0, 0)
  ctx.globalAlpha = 1
  tailImage.close()
  headImage.close()

  return canvasToBlob(canvas)
}

function selectNearestSourceFrame(
  sourceFrames: Array<{ mediaTime: number; blob: Blob }>,
  targetTime: number,
): { mediaTime: number; blob: Blob } {
  let right = sourceFrames.length - 1
  let left = 0
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (sourceFrames[middle].mediaTime < targetTime) left = middle + 1
    else right = middle
  }

  const nextFrame = sourceFrames[left]
  const previousFrame = sourceFrames[Math.max(0, left - 1)]
  return Math.abs(previousFrame.mediaTime - targetTime) <= Math.abs(nextFrame.mediaTime - targetTime)
    ? previousFrame
    : nextFrame
}

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
    setVideoNaturalSize,
    setVideoDisplaySize,
    crossfadeEnabled,
    crossfadeDuration,
    setCrossfadeEnabled,
    setCrossfadeDuration,
    getFrameCount,
  } = useVideoStore()

  const [isZipping, setIsZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const [customFrameInput, setCustomFrameInput] = useState('')
  const [customFpsInput, setCustomFpsInput] = useState(String(fps))
  const [customWidth, setCustomWidth] = useState(String(cropSize.width))
  const [customHeight, setCustomHeight] = useState(String(cropSize.height))
  const [customCornerRadius, setCustomCornerRadius] = useState(String(cropSize.cornerRadius))
  const [isClearHovered, setIsClearHovered] = useState(false)
  const templateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCustomWidth(String(cropSize.width))
    setCustomHeight(String(cropSize.height))
    setCustomCornerRadius(String(cropSize.cornerRadius))
  }, [cropSize])

  useEffect(() => {
    setCustomFpsInput(String(fps))
  }, [fps])

  const parsedCustomFps = Number(customFpsInput)
  const isCustomFpsValid = customFpsInput.trim() !== ''
    && Number.isFinite(parsedCustomFps)
    && parsedCustomFps >= FRAME_RATE_LIMITS.min
    && parsedCustomFps <= FRAME_RATE_LIMITS.max

  const applyCustomFps = useCallback(() => {
    if (!isCustomFpsValid) return
    setFps(parsedCustomFps)
  }, [isCustomFpsValid, parsedCustomFps, setFps])

  const parsedCustomSize = {
    width: Number(customWidth),
    height: Number(customHeight),
    cornerRadius: Number(customCornerRadius),
  }
  const isCustomSizeValid = customWidth.trim() !== ''
    && customHeight.trim() !== ''
    && customCornerRadius.trim() !== ''
    && Number.isFinite(parsedCustomSize.width)
    && Number.isFinite(parsedCustomSize.height)
    && Number.isFinite(parsedCustomSize.cornerRadius)
    && Number.isInteger(parsedCustomSize.width)
    && Number.isInteger(parsedCustomSize.height)
    && Number.isInteger(parsedCustomSize.cornerRadius)
    && parsedCustomSize.width >= CUSTOM_CROP_LIMITS.minDimension
    && parsedCustomSize.width <= CUSTOM_CROP_LIMITS.maxDimension
    && parsedCustomSize.height >= CUSTOM_CROP_LIMITS.minDimension
    && parsedCustomSize.height <= CUSTOM_CROP_LIMITS.maxDimension
    && parsedCustomSize.cornerRadius >= 0
    && parsedCustomSize.cornerRadius <= Math.min(parsedCustomSize.width, parsedCustomSize.height) / 2

  const applyCustomCropSize = useCallback(() => {
    if (!isCustomSizeValid) return
    setCropSize({
      label: '自定义',
      width: parsedCustomSize.width,
      height: parsedCustomSize.height,
      cornerRadius: parsedCustomSize.cornerRadius,
    })
  }, [isCustomSizeValid, parsedCustomSize.width, parsedCustomSize.height, parsedCustomSize.cornerRadius, setCropSize])

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
      const outputDuration = customFrames / fps
      const requestedSelectionDuration = crossfadeEnabled
        ? outputDuration + Math.min(crossfadeDuration, outputDuration)
        : outputDuration
      const newEnd = Math.min(startTime + requestedSelectionDuration, duration)
      setEndTime(newEnd)
    }
  }, [
    customFrameInput,
    fps,
    startTime,
    duration,
    crossfadeEnabled,
    crossfadeDuration,
    setEndTime,
  ])

  const releaseExportedFrames = useCallback(() => {
    exportedFrames.forEach((frame) => URL.revokeObjectURL(frame.url))
    setExportedFrames([])
  }, [exportedFrames, setExportedFrames])

  const exportFrames = useCallback(async () => {
    if (!videoElement || !videoUrl) return

    const selectionDuration = endTime - startTime
    const effectiveCrossfadeDuration = getEffectiveCrossfadeDuration(
      crossfadeEnabled,
      crossfadeDuration,
      selectionDuration,
    )
    const outputDuration = selectionDuration - effectiveCrossfadeDuration
    const frameCount = getFrameCount()
    if (frameCount <= 0) return

    releaseExportedFrames()
    setIsExporting(true)

    const targetWidth = cropSize.width
    const targetHeight = cropSize.height

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setIsExporting(false)
      return
    }

    canvas.width = targetWidth
    canvas.height = targetHeight

    const frames: ExportedFrame[] = []
    let exportVideo: HTMLVideoElement | null = null

    try {
      exportVideo = await createExportVideo(videoUrl)
      const sourceFrames: Array<{ mediaTime: number; blob: Blob }> = []
      let currentMediaTime = await seekExportVideo(exportVideo, startTime)
      let previousMediaTime = -Infinity

      // 只在起点 seek 一次。之后逐帧播放、逐帧暂停并截图，避免反复 seek 导致
      // VFR、B 帧、关键帧和硬件解码器产生不稳定的目标帧。
      while (currentMediaTime <= endTime + 0.000001) {
        if (currentMediaTime <= previousMediaTime + 0.000001) break

        const blob = await renderExportFrame(
          exportVideo,
          canvas,
          ctx,
          cropSize,
          cropScale,
          cropPosition,
          templateImage,
        )
        sourceFrames.push({ mediaTime: currentMediaTime, blob })
        previousMediaTime = currentMediaTime

        const nextFrame = waitForNextPresentedFrame(exportVideo, currentMediaTime)
        const playPromise = exportVideo.play()
        await playPromise
        currentMediaTime = await nextFrame
        if (currentMediaTime === null) break
        exportVideo.pause()
      }

      if (sourceFrames.length === 0) {
        throw new Error('没有捕获到视频帧')
      }

      // 过渡段只输出一次：尾部画面逐渐让位给片头画面，输出周期因此缩短一个过渡时长。
      for (let i = 0; i < frameCount; i++) {
        const outputTime = i / fps
        let blob: Blob
        if (effectiveCrossfadeDuration > 0 && outputTime >= outputDuration - effectiveCrossfadeDuration) {
          const fadeElapsed = outputTime - (outputDuration - effectiveCrossfadeDuration)
          const tailFrame = selectNearestSourceFrame(
            sourceFrames,
            endTime - effectiveCrossfadeDuration + fadeElapsed,
          )
          const headFrame = selectNearestSourceFrame(sourceFrames, startTime + fadeElapsed)
          const progress = fadeElapsed / effectiveCrossfadeDuration
          const weight = progress * progress * (3 - 2 * progress)
          blob = await blendFrameBlobs(tailFrame.blob, headFrame.blob, canvas, ctx, weight)
        } else {
          const selected = selectNearestSourceFrame(
            sourceFrames,
            startTime + effectiveCrossfadeDuration + outputTime,
          )
          blob = selected.blob
        }

        addExportedFrame(frames, blob)
        if (i % 2 === 1) await yieldToBrowser()
      }
      setExportedFrames(frames)
    } catch (error) {
      frames.forEach((frame) => URL.revokeObjectURL(frame.url))
      console.error('Frame export failed:', error)
      alert('序列帧导出失败，请重试')
    } finally {
      if (exportVideo) {
        exportVideo.pause()
        exportVideo.removeAttribute('src')
        exportVideo.load()
      }
      setIsExporting(false)
    }
  }, [
    videoElement,
    videoUrl,
    cropSize,
    cropScale,
    cropPosition,
    fps,
    startTime,
    endTime,
    templateImage,
    crossfadeEnabled,
    crossfadeDuration,
    getFrameCount,
    releaseExportedFrames,
    setIsExporting,
    setExportedFrames,
  ])

  const downloadFrame = useCallback((frame: ExportedFrame, index: number) => {
    const link = document.createElement('a')
    link.download = `frame-${index + 1}.png`
    link.href = frame.url
    link.click()
  }, [])

  const clearFrames = useCallback(() => {
    releaseExportedFrames()
  }, [releaseExportedFrames])

  const downloadAllAsZip = useCallback(async () => {
    if (exportedFrames.length === 0) return

    setIsZipping(true)
    setZipProgress(0)

    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()

    for (let i = 0; i < exportedFrames.length; i++) {
      const frame = exportedFrames[i]
      const fileName = `frame-${String(i + 1).padStart(4, '0')}.png`
      zip.file(fileName, frame.blob)
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

  const selectionDuration = endTime - startTime
  const effectiveCrossfadeDuration = getEffectiveCrossfadeDuration(
    crossfadeEnabled,
    crossfadeDuration,
    selectionDuration,
  )
  const outputDuration = selectionDuration - effectiveCrossfadeDuration
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

            <div
              className="mt-2.5 p-2.5 rounded-md"
              style={{
                border: `1.5px solid ${cropSize.label === '自定义' ? 'var(--accent)' : 'var(--border-color)'}`,
                background: cropSize.label === '自定义' ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
              }}
            >
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '宽度', value: customWidth, setter: setCustomWidth, min: 1, max: CUSTOM_CROP_LIMITS.maxDimension },
                  { label: '高度', value: customHeight, setter: setCustomHeight, min: 1, max: CUSTOM_CROP_LIMITS.maxDimension },
                  { label: 'R 角', value: customCornerRadius, setter: setCustomCornerRadius, min: 0, max: CUSTOM_CROP_LIMITS.maxDimension / 2 },
                ].map((field) => (
                  <label key={field.label} className="block">
                    <span className="block mb-1 text-[10px] lg:text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {field.label} / px
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={field.min}
                      max={field.max}
                      step="1"
                      value={field.value}
                      onChange={(event) => field.setter(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') applyCustomCropSize()
                      }}
                      className="w-full min-w-0 px-2 py-1.5 rounded-md text-xs lg:text-sm outline-none"
                      style={{
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] lg:text-xs" style={{ color: isCustomSizeValid ? 'var(--text-secondary)' : 'var(--danger)' }}>
                  分辨率范围 1–{CUSTOM_CROP_LIMITS.maxDimension}px，R 角最大为短边一半
                </span>
                <button
                  type="button"
                  onClick={applyCustomCropSize}
                  disabled={!isCustomSizeValid}
                  className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-white disabled:cursor-not-allowed"
                  style={{ background: 'var(--accent)', opacity: isCustomSizeValid ? 1 : 0.4 }}
                >
                  应用
                </button>
              </div>
            </div>
          </div>

          {/* 帧率 */}
          <div>
            <label className="block text-xs lg:text-sm font-medium mb-1.5 lg:mb-2" style={{ color: 'var(--text-secondary)' }}>
              帧率 (fps)
            </label>
            <div className="grid grid-cols-3 gap-1.5 lg:gap-2">
              {[30, 45, 60].map((fpsOption) => (
                <button
                  key={fpsOption}
                  type="button"
                  onClick={() => setFps(fpsOption)}
                  className="py-1.5 lg:py-2 px-3 lg:px-4 rounded-md transition-all duration-200 text-sm lg:text-base"
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
            <div
              className="mt-2 flex items-center gap-2 rounded-md p-2"
              style={{
                border: `1.5px solid ${![30, 45, 60].includes(fps) ? 'var(--accent)' : 'var(--border-color)'}`,
                background: ![30, 45, 60].includes(fps) ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">自定义帧率</span>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={FRAME_RATE_LIMITS.min}
                    max={FRAME_RATE_LIMITS.max}
                    step="0.001"
                    value={customFpsInput}
                    onChange={(event) => setCustomFpsInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyCustomFps()
                    }}
                    aria-invalid={!isCustomFpsValid}
                    placeholder="自定义帧率"
                    className="w-full min-w-0 rounded-md py-1.5 pl-2.5 pr-10 text-xs lg:text-sm outline-none"
                    style={{
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <span
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] lg:text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    fps
                  </span>
                </div>
              </label>
              <button
                type="button"
                onClick={applyCustomFps}
                disabled={!isCustomFpsValid}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)', opacity: isCustomFpsValid ? 1 : 0.4 }}
              >
                应用
              </button>
            </div>
            <p
              className="mt-1 text-[10px] lg:text-xs"
              style={{ color: isCustomFpsValid ? 'var(--text-secondary)' : 'var(--danger)' }}
            >
              自定义范围 {FRAME_RATE_LIMITS.min}–{FRAME_RATE_LIMITS.max} fps，最多三位小数
            </p>
          </div>

          {/* 循环交叉淡化 */}
          <div
            className="rounded-md p-2.5"
            style={{
              border: `1.5px solid ${crossfadeEnabled ? 'var(--accent)' : 'var(--border-color)'}`,
              background: crossfadeEnabled ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
            }}
          >
            <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
              <span>
                <span className="block text-xs lg:text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  循环交叉淡化
                </span>
                <span className="block mt-0.5 text-[10px] lg:text-xs" style={{ color: 'var(--text-secondary)' }}>
                  片尾逐渐过渡到片头，用于动态壁纸循环播放
                </span>
              </span>
              <input
                type="checkbox"
                checked={crossfadeEnabled}
                onChange={(event) => setCrossfadeEnabled(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
            </label>
            {crossfadeEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">交叉淡化时长</span>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={CROSSFADE_LIMITS.min}
                      max={CROSSFADE_LIMITS.max}
                      step="0.1"
                      value={crossfadeDuration}
                      onChange={(event) => setCrossfadeDuration(Number(event.target.value))}
                      className="w-full rounded-md py-1.5 pl-2.5 pr-9 text-xs lg:text-sm outline-none"
                      style={{
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <span
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] lg:text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      秒
                    </span>
                  </div>
                </label>
                <span className="shrink-0 text-[10px] lg:text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {CROSSFADE_LIMITS.min}–{CROSSFADE_LIMITS.max}s
                </span>
              </div>
            )}
            <p className="mt-1.5 text-[10px] lg:text-xs" style={{ color: 'var(--text-secondary)' }}>
              选区较短时会自动缩短为选区时长的一半，输出周期为 {outputDuration.toFixed(3)}s
            </p>
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
              <span style={{ color: 'var(--text-secondary)' }}>输出周期</span>
              <span style={{ color: 'var(--text-primary)' }}>{outputDuration.toFixed(3)}s</span>
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
                  src={frame.url}
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
