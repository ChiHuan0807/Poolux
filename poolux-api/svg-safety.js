// 表盘模板里的 SVG 内容安全判定（SVG 图层的 css_code、图片图层的 SVG 形状遮罩 mask_svg）。
//
// 背景：模板 SVG 图层（layer.css_code）在前端是以「原始标记」注入 DOM 的
// （dangerouslySetInnerHTML），API 里它又是先 POST /api/templates 再原样落库的。
// 只要里面带了 <script> 或 onload= 这类内容，就等价于全站范围的存储型 XSS
// —— 每个打开模板编辑页的访客都会在站点源上执行攻击者的脚本。
// 图片图层新增的「SVG 形状遮罩」（layer.mask_svg）同样由管理员上传、同样存进模板数据，
// 所以一并按同一套规则判定。
//
// 策略：不尝试「改写」SVG（正则改写容易被绕过），而是把实体解码后做黑名单判定：
//   * 写入时（POST/PUT /api/templates）命中即 400 拒绝，让管理员重新处理图片；
//   * 读取时（getTemplateById / getTemplates）命中则把该图层的 css_code 置空，
//     这样历史脏数据也不会被渲染执行。
//
// 注意：只能挡住「已知危险结构」，不等于完整的 SVG 消毒器。
// 真正的第一道防线是：模板接口必须登录 + 上传接口只收位图，不要把来路不明的 SVG 直接贴进来。

/** 解码 HTML 实体，避免 `&#106;avascript:` / `&lt;script&gt;` 这类编码绕过 */
function decodeEntities(input) {
  return String(input || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos|amp|colon|Tab|NewLine|sol|bsol|period|comma|excl);/g, (_m, name) => {
      switch (name) {
        case 'lt': return '<'
        case 'gt': return '>'
        case 'quot': return '"'
        case 'apos': return "'"
        case 'amp': return '&'
        case 'colon': return ':'
        case 'Tab': return '\t'
        case 'NewLine': return '\n'
        case 'sol': return '/'
        case 'bsol': return '\\'
        case 'period': return '.'
        case 'comma': return ','
        case 'excl': return '!'
        default: return ''
      }
    })
}

function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try { return String.fromCodePoint(code) } catch { return '' }
}

/** 危险结构黑名单：命中任意一条即判定为「不能注入 DOM」 */
const DANGEROUS_PATTERNS = [
  /<\s*script/i,
  /<\s*foreignobject/i,
  /<\s*iframe/i,
  /<\s*embed/i,
  /<\s*object/i,
  /<\s*applet/i,
  /<\s*meta/i,
  /<\s*base/i,
  /<\s*link/i,
  /<\s*form/i,
  /<\s*textarea/i,
  /\son[a-z]+\s*=/i,                          // 事件属性：onload / onclick / onbegin ...
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\s*\/\s*html/i,
  /expression\s*\(/i,
  /-moz-binding/i,
  // <style> 本身放行（表盘 SVG 可能用类名），但 @import 会把外部样式表拉进页面，
  // 在本站源上生效，属于变相的界面劫持，直接拒绝。
  /@import/i,
  /<\s*!entity/i,
  /<\s*!doctype/i,
]

/**
 * 判定一段 SVG 标记是否可以安全地注入 DOM。
 * 空值视为安全（没有 SVG 内容）。
 */
export function isSafeSvgMarkup(markup) {
  const raw = String(markup || '')
  if (!raw.trim()) return true
  const decoded = decodeEntities(raw)
  return !DANGEROUS_PATTERNS.some((re) => re.test(decoded))
}

/**
 * 一行模板记录里所有「会被当成 SVG 使用」的内容：
 *   * SVG 图层：layer.css_code —— 前端以原始标记注入 DOM（dangerouslySetInnerHTML）；
 *   * 图片图层的 SVG 形状遮罩：layer.mask_svg —— 前端拼成 mask-image 的 data URI。
 * 两者都来自管理员上传的文件，所以要过同一套安全判定。
 */
function collectRowSvgUsages(row) {
  const out = []
  const collect = (layers) => {
    for (const layer of Array.isArray(layers) ? layers : []) {
      if (!layer || typeof layer !== 'object') continue
      if (layer.type === 'svg') {
        out.push({ layer, field: 'css_code', markup: layer.css_code, label: `${layer.name || '未命名'}（SVG 图层）` })
      }
      if (layer.mask_svg) {
        out.push({ layer, field: 'mask_svg', markup: layer.mask_svg, label: `${layer.name || '未命名'}（SVG 形状遮罩）` })
      }
    }
  }
  for (const device of Array.isArray(row?.devices) ? row.devices : []) collect(device?.layers)
  collect(row?.layers)
  return out
}

/**
 * 校验（并规范化）待写入的模板数据。
 * 命中危险 SVG 时抛错，由路由转成 400，前端把错误文案直接展示给管理员。
 */
export function assertTemplateSvgSafe(data) {
  const unsafe = collectRowSvgUsages(data).filter((usage) => !isSafeSvgMarkup(usage.markup))
  if (unsafe.length === 0) return
  const names = unsafe.map((usage) => usage.label).join('、')
  throw new Error(
    `SVG 内容含不安全结构（${names}）：不接受脚本、事件属性、javascript: 协议或外部 @import，请重新导出 SVG 后再上传`,
  )
}

/**
 * 读取时的兜底：把历史脏数据里的危险 SVG 内容置空，避免被渲染执行。
 * 返回新的行对象（不修改传入对象）。
 */
export function sanitizeTemplateRow(row) {
  if (!row || typeof row !== 'object') return row
  const unsafe = collectRowSvgUsages(row).filter((usage) => !isSafeSvgMarkup(usage.markup))
  if (unsafe.length === 0) return row

  // 同一个图层可能同时命中（例如既是不安全的 SVG 图层、遮罩也不安全），按图层收集要清空的字段
  const fieldsByLayer = new Map()
  for (const usage of unsafe) {
    const fields = fieldsByLayer.get(usage.layer) || new Set()
    fields.add(usage.field)
    fieldsByLayer.set(usage.layer, fields)
  }
  const clean = (layers) => (Array.isArray(layers) ? layers.map((layer) => {
    const fields = layer && fieldsByLayer.get(layer)
    if (!fields) return layer
    const patched = { ...layer }
    for (const field of fields) patched[field] = ''
    return patched
  }) : layers)

  console.warn('[poolux-api] 检测到模板中存在不安全的 SVG 内容，已在读取时清空')
  return {
    ...row,
    devices: Array.isArray(row.devices)
      ? row.devices.map((device) => (device ? { ...device, layers: clean(device.layers) } : device))
      : row.devices,
    layers: clean(row.layers),
  }
}
