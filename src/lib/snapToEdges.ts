const SNAP_THRESHOLD = 10

/**
 * 将图片可见边缘吸附到目标图层边界。
 * x/y 是图片中心相对目标图层中心的偏移；viewportW/viewportH 是目标图层尺寸。
 */
export function snapToEdges(
  x: number, y: number,
  imgW: number, imgH: number, imageScale: number,
  viewportW: number, viewportH: number,
  frameLeft: number = 0,
  frameTop: number = 0,
  frameRight: number = viewportW,
  frameBottom: number = viewportH,
): { x: number; y: number } {
  const halfW = (imgW * imageScale) / 2
  const halfH = (imgH * imageScale) / 2

  // 图片中心在 viewport 坐标系中的位置
  const cx = viewportW / 2 + x
  const cy = viewportH / 2 + y

  // 图片四边
  const imgLeft = cx - halfW
  const imgRight = cx + halfW
  const imgTop = cy - halfH
  const imgBottom = cy + halfH

  let sx = x, sy = y

  // X 轴吸附
  const distLeft = Math.abs(imgLeft - frameLeft)
  const distRight = Math.abs(imgRight - frameRight)
  if (distLeft < SNAP_THRESHOLD && distLeft <= distRight) {
    sx = (frameLeft + halfW) - viewportW / 2
  } else if (distRight < SNAP_THRESHOLD) {
    sx = (frameRight - halfW) - viewportW / 2
  }

  // Y 轴吸附
  const distTop = Math.abs(imgTop - frameTop)
  const distBottom = Math.abs(imgBottom - frameBottom)
  if (distTop < SNAP_THRESHOLD && distTop <= distBottom) {
    sy = (frameTop + halfH) - viewportH / 2
  } else if (distBottom < SNAP_THRESHOLD) {
    sy = (frameBottom - halfH) - viewportH / 2
  }

  return { x: sx, y: sy }
}