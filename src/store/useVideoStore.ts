import { create } from 'zustand'

export interface ExportedFrame {
  blob: Blob
  url: string
}

export interface CropSize {
  width: number
  height: number
  label: string
  cornerRadius: number
}

export const CUSTOM_CROP_LIMITS = {
  minDimension: 1,
  maxDimension: 4096,
} as const

export const FRAME_RATE_LIMITS = {
  min: 1,
  max: 120,
} as const

export function normalizeFrameRate(frameRate: number, fallback = 60): number {
  if (!Number.isFinite(frameRate)) return fallback
  const clamped = Math.min(FRAME_RATE_LIMITS.max, Math.max(FRAME_RATE_LIMITS.min, frameRate))
  return Math.round(clamped * 1000) / 1000
}

export function normalizeCropSize(size: CropSize): CropSize {
  const width = Math.round(Math.min(CUSTOM_CROP_LIMITS.maxDimension, Math.max(CUSTOM_CROP_LIMITS.minDimension, size.width)))
  const height = Math.round(Math.min(CUSTOM_CROP_LIMITS.maxDimension, Math.max(CUSTOM_CROP_LIMITS.minDimension, size.height)))
  const cornerRadius = Math.round(Math.min(Math.min(width, height) / 2, Math.max(0, size.cornerRadius)))
  return { ...size, width, height, cornerRadius }
}

export const CROSSFADE_LIMITS = {
  min: 0.2,
  max: 2,
  default: 0.8,
} as const

export function getEffectiveCrossfadeDuration(
  enabled: boolean,
  requestedDuration: number,
  selectionDuration: number,
): number {
  if (!enabled || selectionDuration <= 0) return 0
  const normalized = Number.isFinite(requestedDuration)
    ? Math.min(CROSSFADE_LIMITS.max, Math.max(CROSSFADE_LIMITS.min, requestedDuration))
    : CROSSFADE_LIMITS.default
  return Math.min(normalized, selectionDuration / 2)
}

export const CROP_SIZES: CropSize[] = [
  { width: 336, height: 480, label: '小米手环 Pro', cornerRadius: 48 },
  { width: 212, height: 520, label: '小米手环 10', cornerRadius: 108 },
  { width: 432, height: 514, label: 'REDMI Watch', cornerRadius: 108 },
]

interface VideoStore {
  videoFile: File | null
  videoUrl: string | null
  videoElement: HTMLVideoElement | null
  cropSize: CropSize
  cropScale: number
  cropPosition: { x: number; y: number }
  fps: number
  startTime: number
  endTime: number
  duration: number
  isExporting: boolean
  exportedFrames: ExportedFrame[]
  templateImage: HTMLImageElement | null
  videoNaturalSize: { width: number; height: number }
  videoDisplaySize: { width: number; height: number }
  crossfadeEnabled: boolean
  crossfadeDuration: number
  setVideoFile: (file: File | null) => void
  setVideoUrl: (url: string | null) => void
  setVideoFileAndUrl: (file: File | null, url: string | null) => void
  setVideoElement: (element: HTMLVideoElement | null) => void
  setCropSize: (size: CropSize) => void
  setCropScale: (scale: number) => void
  setCropPosition: (position: { x: number; y: number }) => void
  setFps: (fps: number) => void
  setStartTime: (time: number) => void
  setEndTime: (time: number) => void
  setDuration: (duration: number) => void
  setIsExporting: (exporting: boolean) => void
  setExportedFrames: (frames: ExportedFrame[]) => void
  setTemplateImage: (image: HTMLImageElement | null) => void
  setVideoNaturalSize: (size: { width: number; height: number }) => void
  setVideoDisplaySize: (size: { width: number; height: number }) => void
  setCrossfadeEnabled: (enabled: boolean) => void
  setCrossfadeDuration: (duration: number) => void
  getFrameCount: () => number
  reset: () => void
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  videoFile: null,
  videoUrl: null,
  videoElement: null,
  cropSize: CROP_SIZES[0],
  cropScale: 1,
  cropPosition: { x: 0, y: 0 },
  fps: 60,
  startTime: 0,
  endTime: 10,
  duration: 0,
  isExporting: false,
  exportedFrames: [],
  templateImage: null,
  videoNaturalSize: { width: 0, height: 0 },
  videoDisplaySize: { width: 0, height: 0 },
  crossfadeEnabled: true,
  crossfadeDuration: CROSSFADE_LIMITS.default,
  setVideoFile: (file) => set({ videoFile: file }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setVideoFileAndUrl: (file, url) => set({
    videoFile: file,
    videoUrl: url,
  }),
  setVideoElement: (element) => set({ videoElement: element }),
  setCropSize: (size) => set({ cropSize: normalizeCropSize(size) }),
  setCropScale: (scale) => set({ cropScale: scale }),
  setCropPosition: (position) => set({ cropPosition: position }),
  setFps: (fps) => set((state) => ({ fps: normalizeFrameRate(fps, state.fps) })),
  setStartTime: (time) => set((state) => ({
    startTime: Math.max(0, Math.min(time, state.endTime - 0.01)),
  })),
  setEndTime: (time) => set((state) => ({
    endTime: Math.max(state.startTime + 0.01, Math.min(time, state.duration)),
  })),
  setDuration: (duration) => set({ duration: duration }),
  setIsExporting: (exporting) => set({ isExporting: exporting }),
  setExportedFrames: (frames) => set({ exportedFrames: frames }),
  setTemplateImage: (image) => set({ templateImage: image }),
  setVideoNaturalSize: (size) => set({ videoNaturalSize: size }),
  setVideoDisplaySize: (size) => set({ videoDisplaySize: size }),
  setCrossfadeEnabled: (enabled) => set({ crossfadeEnabled: enabled }),
  setCrossfadeDuration: (duration) => set({
    crossfadeDuration: Number.isFinite(duration)
      ? Math.min(CROSSFADE_LIMITS.max, Math.max(CROSSFADE_LIMITS.min, duration))
      : CROSSFADE_LIMITS.default,
  }),
  getFrameCount: () => {
    const state = get()
    const selectionDuration = state.endTime - state.startTime
    const crossfade = getEffectiveCrossfadeDuration(
      state.crossfadeEnabled,
      state.crossfadeDuration,
      selectionDuration,
    )
    return Math.round((selectionDuration - crossfade) * state.fps)
  },
  reset: () => set({
    videoFile: null,
    videoUrl: null,
    videoElement: null,
    cropScale: 1,
    cropPosition: { x: 0, y: 0 },
    exportedFrames: [],
    isExporting: false,
    duration: 0,
    videoNaturalSize: { width: 0, height: 0 },
    videoDisplaySize: { width: 0, height: 0 },
    crossfadeEnabled: true,
    crossfadeDuration: CROSSFADE_LIMITS.default,
  }),
}))
