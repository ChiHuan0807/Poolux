// 上传文件名 / 扩展名的安全处理。
//
// 为什么必须有：multer 的 `file.originalname` 完全来自客户端，既可能是
// `..\..\evil.php`，也可能是 `x.html` / `x.svg` 这种会被浏览器当成页面执行的类型。
// 所有落盘文件名都改成「服务端生成的随机名 + 白名单扩展名」，原文件名只存进数据库展示。
import { randomBytes } from 'crypto'
import { extname } from 'path'

/** 只允许字母数字组成的短扩展名，其余一律视为不安全 */
const SAFE_EXT_RE = /^\.[a-z0-9]{1,8}$/

/** 图片扩展名（会交给 sharp 转码） */
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif']

/** 允许直接落盘、不做转码的非图片扩展名 */
export const BINARY_EXTS = ['.bin', '.zip', '.7z', '.rar', '.tar', '.gz', '.apk', '.ttf', '.otf', '.woff2']

/** 取安全的扩展名；不在白名单内时返回 fallback */
export function sanitizeExt(originalname, allowed, fallback = '.bin') {
  const ext = extname(String(originalname || '')).toLowerCase()
  if (!SAFE_EXT_RE.test(ext)) return fallback
  if (allowed && !allowed.includes(ext)) return fallback
  return ext
}

/**
 * 生成落盘文件名：服务端随机部分 + 白名单扩展名。
 * 不使用任何客户端提供的路径片段，因此不可能穿越目录。
 */
export function safeUploadName(prefix, originalname, allowed, fallback = '.bin') {
  const ext = sanitizeExt(originalname, allowed, fallback)
  return `${prefix}${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
}

/** 该扩展名是否在白名单内 */
export function hasAllowedExt(originalname, allowed) {
  const ext = extname(String(originalname || '')).toLowerCase()
  return SAFE_EXT_RE.test(ext) && allowed.includes(ext)
}

/**
 * 由落盘的原始文件名推出「转码后的 webp 文件名」。
 *
 * 为什么不能直接 replace(/\.[^.]+$/, '.webp')：
 * 上传的文件本身就是 .webp 时，换完扩展名得到的路径和源文件**完全相同**，
 * 于是 sharp 被要求「读这个文件、同时把结果写回这个文件」，
 * libvips 会直接失败（表现为误导性的「图片解析失败，请确认文件是有效的图片」）。
 * 所有「上传图片 → 转 webp」的接口都必须用这个函数取目标名。
 */
export function webpTargetName(filename) {
  const name = String(filename || '')
  const base = name.replace(/\.\w+$/, '')
  const target = `${base}.webp`
  // 与源文件同名时换一个后缀，保证目标路径和源路径一定不同
  return target === name ? `${base}-conv.webp` : target
}
