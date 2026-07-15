/**
 * 导出 PNG：浏览器走 download；Capacitor/Android 写缓存后走系统分享
 *（WebView 里 a.download 通常无效且无反馈）
 */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = String(reader.result || '')
      const i = result.indexOf(',')
      resolve(i >= 0 ? result.slice(i + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取图片数据失败'))
    reader.readAsDataURL(blob)
  })
}

function isNativeApp(): boolean {
  try {
    // 运行时由 Capacitor 注入；未打包进 APK 时走网页逻辑
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return Boolean(cap?.isNativePlatform?.())
  } catch {
    return false
  }
}

function safeFileName(name: string): string {
  const base = (name || 'export.png').replace(/[^\w.\u4e00-\u9fff-]+/g, '_')
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`
}

export type SaveImageResult = {
  mode: 'share' | 'download'
  message: string
}

export async function savePngBlob(blob: Blob, filename: string): Promise<SaveImageResult> {
  const fileName = safeFileName(filename)

  if (isNativeApp()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const base64 = await blobToBase64(blob)
    const written = await Filesystem.writeFile({
      path: `poolux-export/${Date.now()}-${fileName}`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    })

    try {
      await Share.share({
        title: '保存图片',
        text: fileName,
        files: [written.uri],
        dialogTitle: '保存到相册或分享',
      })
      return {
        mode: 'share',
        message: '请在系统菜单中选择「保存到相册 / 文件」或分享到微信等',
      }
    } catch (err: unknown) {
      // 用户取消分享不算致命错误
      const msg = err instanceof Error ? err.message : String(err)
      if (/cancel|dismiss|abort/i.test(msg)) {
        return { mode: 'share', message: '已取消分享；可再次点击导出' }
      }
      throw err instanceof Error ? err : new Error(msg || '分享失败')
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }

  return { mode: 'download', message: '图片已开始下载' }
}