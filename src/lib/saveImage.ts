/**
 * 导出 PNG：
 * - 网页：a.download
 * - Capacitor/Android：直接写入系统相册（非分享面板），文件名含时间戳防覆盖
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

export function isNativeApp(): boolean {
  try {
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

/** 生成带时间戳的文件名，防止多次导出覆盖 */
function uniqueFileName(name: string): string {
  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const stem = safeFileName(name).replace(/\.png$/i, '')
  return `${stem}_${ts}.png`
}

export type SaveImageResult = {
  mode: 'gallery' | 'download'
  message: string
}

const ALBUM_NAME = 'POOLUX'

async function ensureAlbumIdentifier(Media: {
  getAlbums: () => Promise<{ albums: { name: string; identifier: string }[] }>
  createAlbum: (o: { name: string }) => Promise<void>
}): Promise<string> {
  const first = await Media.getAlbums()
  const hit = first.albums.find((a) => a.name === ALBUM_NAME)
  if (hit?.identifier) return hit.identifier

  await Media.createAlbum({ name: ALBUM_NAME })
  const second = await Media.getAlbums()
  const created = second.albums.find((a) => a.name === ALBUM_NAME)
  if (!created?.identifier) throw new Error('创建相册失败，请检查系统相册权限')
  return created.identifier
}

export async function savePngBlob(blob: Blob, filename: string): Promise<SaveImageResult> {
  const fileName = uniqueFileName(filename)

  if (isNativeApp()) {
    const { Media } = await import('@capacitor-community/media')
    const base64 = await blobToBase64(blob)
    const dataUrl = `data:image/png;base64,${base64}`
    const albumIdentifier = await ensureAlbumIdentifier(Media)
    const bareName = fileName.replace(/\.png$/i, '')

    await Media.savePhoto({
      path: dataUrl,
      albumIdentifier,
      fileName: bareName,
    })

    return {
      mode: 'gallery',
      message: `已保存到相册「${ALBUM_NAME}」`,
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