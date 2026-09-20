import { shrinkToHalfLimit } from './watchFaceKit'

export function extractImageColors(img: HTMLImageElement, count = 10): string[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  canvas.width = 128
  canvas.height = 128
  // 缩到 128 是十几到几十倍的缩小：canvas 默认 quality='low'（2×2 抽头）会漏采样，
  // 细密纹理（织物、条纹、噪点）会缩成摩尔纹，取色跟着偏。
  // 先用逐级折半取到真正的面积平均（每级正好 2:1），再让最后一步缩放倍数 ≤2。
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const source = shrinkToHalfLimit(img, img.naturalWidth, img.naturalHeight, 128, 128)
  ctx.drawImage(source, 0, 0, 128, 128)
  const data = ctx.getImageData(0, 0, 128, 128).data
  const step = 24
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>()

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 32) continue
    const r = Math.min(255, Math.round(data[index] / step) * step)
    const g = Math.min(255, Math.round(data[index + 1] / step) * step)
    const b = Math.min(255, Math.round(data[index + 2] / step) * step)
    const key = `${r},${g},${b}`
    const entry = buckets.get(key)
    if (entry) entry.count++
    else buckets.set(key, { r, g, b, count: 1 })
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)
  const difference = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
    Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
  const picked: typeof sorted = []

  for (const color of sorted) {
    if (picked.every(existing => difference(existing, color) >= 60)) picked.push(color)
    if (picked.length >= count) break
  }

  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return picked.map(color => `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`)
}

export function colorLuminance(color: string): number {
  const hex = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 0
  const [r, g, b] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function colorDistance(left: string, right: string): number {
  const parse = (color: string) => {
    const hex = color.replace('#', '')
    return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  }
  const [lr, lg, lb] = parse(left)
  const [rr, rg, rb] = parse(right)
  return Math.sqrt((lr - rr) ** 2 + (lg - rg) ** 2 + (lb - rb) ** 2)
}

function isNearNeutralExtreme(color: string): boolean {
  const hex = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false
  const [r, g, b] = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  return spread < 18 && (Math.max(r, g, b) > 238 || Math.min(r, g, b) < 18)
}

export function selectPaletteColor(colors: string[], preference: 'light' | 'dark' = 'dark'): string {
  if (colors.length === 0) return ''
  const validColors = colors.filter(color => /^[#]?[0-9a-f]{6}$/i.test(color.replace('#', '')))
  if (validColors.length === 0) return ''

  // 极值只决定明暗方向，候选仍优先保持与最高频主色相近，避免被纯黑/纯白抢走。
  const dominant = validColors[0]
  const sorted = [...validColors].sort((a, b) => colorLuminance(a) - colorLuminance(b))
  const meaningful = sorted.length > 1
    ? sorted.filter(color => !isNearNeutralExtreme(color))
    : sorted
  const candidates = meaningful.length > 0 ? meaningful : sorted
  const count = Math.max(1, Math.ceil(candidates.length * 0.35))
  const extreme = preference === 'light' ? candidates.slice(-count) : candidates.slice(0, count)
  return extreme
    .sort((left, right) => colorDistance(left, dominant) - colorDistance(right, dominant))[0] || dominant
}