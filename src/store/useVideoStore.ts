import { create } from 'zustand'

interface CropSize {
  width: number
  height: number
  label: string
  cornerRadius: number
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
  exportedFrames: string[]
  templateImage: HTMLImageElement | null
  videoNaturalSize: { width: number; height: number }
  videoDisplaySize: { width: number; height: number }
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
  setExportedFrames: (frames: string[]) => void
  setTemplateImage: (image: HTMLImageElement | null) => void
  setVideoNaturalSize: (size: { width: number; height: number }) => void
  setVideoDisplaySize: (size: { width: number; height: number }) => void
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
  setVideoFile: (file) => set({ videoFile: file }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setVideoFileAndUrl: (file, url) => set({ videoFile: file, videoUrl: url }),
  setVideoElement: (element) => set({ videoElement: element }),
  setCropSize: (size) => set({ cropSize: size }),
  setCropScale: (scale) => set({ cropScale: scale }),
  setCropPosition: (position) => set({ cropPosition: position }),
  setFps: (fps) => set({ fps: fps }),
  setStartTime: (time) => set({ startTime: time }),
  setEndTime: (time) => set({ endTime: time }),
  setDuration: (duration) => set({ duration: duration }),
  setIsExporting: (exporting) => set({ isExporting: exporting }),
  setExportedFrames: (frames) => set({ exportedFrames: frames }),
  setTemplateImage: (image) => set({ templateImage: image }),
  setVideoNaturalSize: (size) => set({ videoNaturalSize: size }),
  setVideoDisplaySize: (size) => set({ videoDisplaySize: size }),
  getFrameCount: () => {
    const state = get()
    return Math.round((state.endTime - state.startTime) * state.fps)
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
  }),
}))
