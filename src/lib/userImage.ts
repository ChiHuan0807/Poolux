/**
 * 用户上传图片的归一化。
 *
 * 为什么不直接把原图交给 <img>：
 *   1. 高像素照片必须先整张解成位图才能用：5000×4000 是 80MB，
 *      一亿像素的长曝光照片是 400MB。编辑器还要预览重绘、自动取色、导出时再解一次，
 *      低配机和手机直接卡死，严重时整页崩掉。
 *   2. HDR / 广色域图片自带色彩描述（10bit、Display P3、HDR 增益图…）。
 *      这份描述在预览（<img>，浏览器按图片自己的色彩空间渲染）和
 *      导出（canvas 8bit sRGB）两条路上的处理并不一致，有的环节干脆丢掉，
 *      结果就是同一个文件的预览和导出是两个颜色，看着发灰、变淡。
 *
 * 所以在这里做一次归一化，让后面所有环节只认同一份纯 sRGB 位图：
 *   - 解码时就按目标尺寸解（createImageBitmap 的 resize* 让浏览器直接产出缩略位图），
 *     不会先把上亿像素铺满内存；
 *   - 重绘进一张显式声明 sRGB 的画布，把色彩描述转换并烧进像素，
 *     之后预览、取色、滤镜、导出都只认这份数据，不会中途再丢描述；
 *   - 重新编码成 WebP 再交出去（浏览器不支持编码 WebP 时退回 PNG），
 *     编码结果不带色彩描述与 HDR 元数据，各处渲染自然一致。
 *
 * 例外：SVG 与 GIF 原样使用 —— 重绘会把矢量栅格化、把动图压成静态图。
 */

/** 长边上限。设备画面最大 432×514，导出再 ×2；用户最多把图放大 5 倍，
 *  4096 足够覆盖这个极限，又不至于让全景图占满内存。 */
const MAX_EDGE = 4096

/** 总像素上限 ≈ 420 万（位图约 17MB）。
 *  这条才是「不卡死」的关键：上限按像素总数封顶，和原图多大无关，
 *  一张 4032×3024 的手机照片会落到 2367×1775 —— 仍然远高于导出分辨率
 *  （432×514 的设备导出成 864×1028），肉眼看不出差别，但内存只有原来的 1/3。 */
const MAX_PIXELS = 4_200_000

/** 超过这个体积才值得提示「正在处理」：小图几十毫秒就完了，提示反而像闪屏 */
const NOTICE_BYTES = 2 * 1024 * 1024

export interface PreparedUserImage {
  /** 归一化之后的地址（blob:），调用方替换旧图时负责 revoke */
  url: string
  /** 已经解码好的图片元素：直接读 naturalWidth / naturalHeight，也可以画到 canvas 取色 */
  image: HTMLImageElement
  /** 原图像素尺寸（resized 为 true 时用它给用户一个交代） */
  sourceWidth: number
  sourceHeight: number
  /** 是否真的缩小过 */
  resized: boolean
  /** 是否重新编码过；SVG / GIF 原样使用，为 false */
  reencoded: boolean
}

/** 这类文件重绘会掉特性，保持原样 */
function keepOriginal(file: File): boolean {
  return file.type === 'image/svg+xml' || file.type === 'image/gif'
}

/** 大图才提示，避免小图闪一下 */
export function isHeavyUpload(file: File): boolean {
  return file.type.startsWith('image/') && !keepOriginal(file) && file.size >= NOTICE_BYTES
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('这张图片浏览器解不开，请先转成 JPG / PNG 再上传'))
    img.src = src
  })
}

/** 按像素上限等比缩到目标尺寸；本来就够小就原样返回 */
function fitToLimit(width: number, height: number): { width: number; height: number; scaled: boolean } {
  const factor = Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)))
  if (!(factor < 1)) return { width, height, scaled: false }
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), scaled: true }
}

let webpEncodeSupport: boolean | null = null

/** 能否用 canvas 编码 WebP（Safari 16.6 以下不行，退回 PNG） */
function supportsWebpEncode(): boolean {
  if (webpEncodeSupport === null) {
    try {
      const probe = document.createElement('canvas')
      probe.width = 1
      probe.height = 1
      webpEncodeSupport = probe.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      webpEncodeSupport = false
    }
  }
  return webpEncodeSupport
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const type = supportsWebpEncode() ? 'image/webp' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('图片编码失败，请换一张再试'))),
      type,
      // PNG 忽略 quality；WebP 用 0.95，肉眼分不出的损失换小得多的体积
      type === 'image/webp' ? 0.95 : undefined,
    )
  })
}

/**
 * 按目标尺寸解码。
 *
 * 关键是让 createImageBitmap 在解码时就缩到目标尺寸：否则几百 MB 的位图会先被完整解出来。
 * imageOrientation 用 from-image 让 EXIF 方向在解码阶段就摆正（和 <img> 的行为一致），
 * 免得后面按 naturalWidth/Height 算好的画布和实际位图转 90°。
 * 老浏览器（Safari 15 之前）不认 resize 参数，退回把 <img> 当绘制源，由 drawImage 缩放。
 */
async function decodeAtSize(
  file: File,
  probe: HTMLImageElement,
  target: { width: number; height: number },
): Promise<{ source: CanvasImageSource; sourceWidth: number; sourceHeight: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const resize = { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' as ResizeQuality }
    for (const options of [{ imageOrientation: 'from-image' as ImageOrientation, ...resize }, resize, { imageOrientation: 'from-image' as ImageOrientation }]) {
      try {
        const bitmap = await createImageBitmap(file, options)
        // 以位图自己的尺寸为准：浏览器可能把 resize 结果取整（比如奇数边差的图）
        return { source: bitmap, sourceWidth: bitmap.width, sourceHeight: bitmap.height, close: () => bitmap.close() }
      } catch {
        // 这组参数不被支持，试下一组；都不行就落到 <img>
      }
    }
  }
  return { source: probe, sourceWidth: probe.naturalWidth, sourceHeight: probe.naturalHeight, close: () => {} }
}

/**
 * 把用户选的文件变成「编辑器可以直接用」的图片。
 * 失败时抛出带中文说明的 Error，调用方原样显示即可。
 */
export async function prepareUserImage(file: File): Promise<PreparedUserImage> {
  // SVG / GIF 原样使用，只量一下尺寸
  if (keepOriginal(file)) {
    const url = URL.createObjectURL(file)
    try {
      const image = await loadImageElement(url)
      return {
        url,
        image,
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        resized: false,
        reencoded: false,
      }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }

  // 先用 <img> 探尺寸：onload 在解析完文件头后就触发，不像 createImageBitmap 那样先解全图
  const probeUrl = URL.createObjectURL(file)
  let probe: HTMLImageElement
  try {
    probe = await loadImageElement(probeUrl)
  } catch (error) {
    URL.revokeObjectURL(probeUrl)
    throw error
  }

  const sourceWidth = probe.naturalWidth
  const sourceHeight = probe.naturalHeight
  if (!sourceWidth || !sourceHeight) {
    URL.revokeObjectURL(probeUrl)
    throw new Error('这张图片没有有效的尺寸，无法使用')
  }

  const limit = fitToLimit(sourceWidth, sourceHeight)

  try {
    const decoded = await decodeAtSize(file, probe, limit)
    try {
      // 画布尺寸按「解码结果的实际尺寸」再套一次上限：
      // 浏览器认 resize 参数时这里等于 1（就是目标尺寸）；
      // 退回到 <img> 或忽略了 resize 的浏览器上，这里才会真的缩放。
      // 用它自己的宽高算比例，EXIF 方向在不同浏览器上不一致时也不会把图拉变形。
      const shrink = Math.min(1, limit.width / decoded.sourceWidth, limit.height / decoded.sourceHeight)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(decoded.sourceWidth * shrink))
      canvas.height = Math.max(1, Math.round(decoded.sourceHeight * shrink))
      // 显式声明 sRGB：HDR / 广色域的色彩描述在这一步被转换并烧进像素，
      // 之后预览、取色、导出都只认这份数据，不会中途丢描述而发灰
      const ctx = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' }) || canvas.getContext('2d')
      if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法处理图片')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)

      const blob = await encodeCanvas(canvas)
      const url = URL.createObjectURL(blob)
      let image: HTMLImageElement
      try {
        image = await loadImageElement(url)
      } catch (error) {
        URL.revokeObjectURL(url)
        throw error
      }
      return {
        url,
        image,
        sourceWidth,
        sourceHeight,
        resized: limit.scaled || canvas.width !== sourceWidth || canvas.height !== sourceHeight,
        reencoded: true,
      }
    } finally {
      decoded.close()
    }
  } finally {
    URL.revokeObjectURL(probeUrl)
  }
}

/** 给「已压缩」提示用：把像素数说成人话 */
export function describeScale(prepared: PreparedUserImage): string {
  const { sourceWidth, sourceHeight, image } = prepared
  return `${sourceWidth}×${sourceHeight} → ${image.naturalWidth}×${image.naturalHeight}`
}
