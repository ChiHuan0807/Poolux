// 外链 URL 校验。
//
// 为什么必须有：友链、团队成员主页、资源购买链接这些字段最终都会渲染成 <a href>。
// 只要允许写入 `javascript:...`，前台就多出一个「点击即执行」的存储型 XSS 入口
// （站点源上执行脚本，能读 Cookie 之外的任何同源数据并冒充管理员操作后台接口）。
//
// 规则：只接受 http / https，以及（可选的）站内相对链接（以 / # . 开头）。
const SAFE_SCHEMES = new Set(['http:', 'https:'])

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

/**
 * 校验并规范化一个外链。
 * @param {string} value 用户提交的原始值
 * @param {object} [options]
 * @param {number} [options.maxLength] 最大长度
 * @param {boolean} [options.allowRelative] 是否允许站内相对链接（/xxx、#anchor、./xxx）
 * @param {boolean} [options.required] 是否必填
 * @param {string} [options.label] 出错时的字段名
 * @returns {string} 通过校验的链接（已 trim），空值返回 ''
 */
export function normalizeExternalUrl(value, {
  maxLength = 2000,
  allowRelative = true,
  required = false,
  label = '链接',
} = {}) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    if (required) throw new Error(`${label}不能为空`)
    return ''
  }
  if (raw.length > maxLength) throw new Error(`${label}过长（最多 ${maxLength} 字符）`)
  // 控制字符（换行、\t、\0 等）会被浏览器在解析协议时忽略，
  // 于是 "java\nscript:alert(1)" 会被当成 javascript: 执行，这里直接拒绝。
  if (CONTROL_CHARS_RE.test(raw)) throw new Error(`${label}包含非法字符`)

  const isRelative = allowRelative && /^([/#.]|[^:]*$)/.test(raw)
  // 只有「看起来是相对路径」时才走相对分支；带冒号的一律按绝对 URL 解析
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
  if (!hasScheme && !isRelative) throw new Error(`${label}格式无效`)

  let parsed = null
  try {
    // 相对链接用占位 base 解析，只用来判断「是否被解析成了危险的绝对协议」
    parsed = new URL(raw, 'https://poolux.invalid/')
  } catch {
    throw new Error(`${label}格式无效`)
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) {
    throw new Error(`${label}只支持 http 或 https`)
  }
  // 以 // 开头会被解析成外部域名，仍属于 http(s)，允许
  return raw
}

/**
 * 校验一串外链，返回规范化后的数组；任一项非法则抛错。
 * 用于 resources 的 device_options[].downloadUrl 之类的批量字段。
 */
export function normalizeExternalUrlList(values, options) {
  if (!Array.isArray(values)) return []
  return values.map((value) => normalizeExternalUrl(value, options))
}

/**
 * 校验图片 / 静态资源地址。
 *
 * 为什么必须有：相册图片、作品图、资源图标、头像这些字段会被前端直接渲染成
 * `<img src>`，相册页还会渲染成 `<a href download>`。只要写进一个
 * `javascript:...`，点击下载按钮就会在站点源上执行脚本（存储型 XSS）。
 *
 * 允许的形态只有两种：
 *   1. 站内相对路径：以 `/` 开头，且不含 `..`、反斜杠、控制字符
 *   2. http / https 绝对地址
 * 其余（javascript:、data:、vbscript:、file: 等）一律拒绝。
 */
export function normalizeAssetUrl(value, {
  maxLength = 2000,
  required = false,
  label = '图片地址',
  // 渲染位置只是 <img src> 时（图层图片等），任意相对路径都无害，
  // 只要求「不能是 javascript:/data: 这类危险协议」即可，避免误伤历史数据。
  allowAnyRelative = false,
} = {}) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    if (required) throw new Error(`${label}不能为空`)
    return ''
  }
  if (raw.length > maxLength) throw new Error(`${label}过长（最多 ${maxLength} 字符）`)
  // 换行/制表符会被浏览器在解析协议时忽略，"java\nscript:" 因此能绕过前缀判断
  if (CONTROL_CHARS_RE.test(raw)) throw new Error(`${label}包含非法字符`)

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    let parsed = null
    try { parsed = new URL(raw) } catch { throw new Error(`${label}格式无效`) }
    if (!SAFE_SCHEMES.has(parsed.protocol)) {
      throw new Error(`${label}只支持 http 或 https`)
    }
    return raw
  }

  if (allowAnyRelative) return raw

  if (!raw.startsWith('/')) {
    throw new Error(`${label}必须是站内路径（以 / 开头）或完整的 http(s) 链接`)
  }
  // URL 解码后再查穿越，避免 %2e%2e%2f 绕过
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* 保留原文 */ }
  if (decoded.includes('..') || decoded.includes('\\') || !decoded.startsWith('/')) {
    throw new Error(`${label}格式无效`)
  }
  return raw
}

/** 批量校验资源地址数组（例如资源 banner 列表） */
export function normalizeAssetUrlList(values, options) {
  if (!Array.isArray(values)) return []
  return values.map((value) => normalizeAssetUrl(value, options))
}
