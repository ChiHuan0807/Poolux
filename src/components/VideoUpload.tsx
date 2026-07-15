import { useCallback, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { useVideoStore } from '../store/useVideoStore'

export function VideoUpload() {
  const [isDragging, setIsDragging] = useState(false)
  const { videoFile, videoUrl, setVideoFileAndUrl, reset } = useVideoStore()

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('请上传视频文件')
      return
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl)
    }
    const url = URL.createObjectURL(file)
    setVideoFileAndUrl(file, url)
  }, [setVideoFileAndUrl, videoUrl])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onRemove = useCallback(() => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl)
    }
    reset()
  }, [reset, videoUrl])

  return (
    <div className="w-full">
      {!videoFile ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 cursor-pointer ${
            isDragging 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <input
            type="file"
            accept="video/*"
            onChange={onChange}
            className="hidden"
            id="video-upload"
          />
          <label htmlFor="video-upload" className="cursor-pointer">
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-lg font-medium text-gray-700">点击或拖拽上传视频</p>
            <p className="text-sm text-gray-500 mt-2">支持 MP4, WebM, MOV 等格式</p>
          </label>
        </div>
      ) : (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-medium text-gray-800">{videoFile.name}</p>
              <p className="text-sm text-gray-500">{(videoFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
          <button
            onClick={onRemove}
            className="p-2 hover:bg-green-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      )}
    </div>
  )
}
