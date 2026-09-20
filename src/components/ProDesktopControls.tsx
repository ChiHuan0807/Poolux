import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AlignGlyph, type AlignKind } from '@/components/ProEditorControls'
import { hapticTick } from '@/lib/haptics'

/* ═══════════════════════════════════════════════════════════
   新版桌面端（PC）编辑器控件 —— 手环 Pro 系列的右侧数据栏
   与移动端抽屉是同一套能力（滑杆 / 排版按钮 / 面板卡），
   配色不走移动端那套写死的白底，改用站点主题变量，深色模式直接跟着走。
   ═══════════════════════════════════════════════════════════ */

/** 滑杆刻度：轨道 28 高、滑钮 22、轨道圆头半径 14 —— 与移动端抽屉同一套尺寸，
 *  桌面端只换配色（走主题变量），形状、比例、字号都跟移动端对齐。 */
export const DESKTOP_TRACK_H = 28
export const DESKTOP_TRACK_HALF = DESKTOP_TRACK_H / 2
export const DESKTOP_KNOB = 22

/**
 * 数据栏里的滑杆：342×28 轨道 + 22px 滑钮，版式取自移动端 ProFxSlider。
 *
 * 蓝色进度条两端的圆头（半径 = 半个轨道高）不是压在各自的边界上，而是分别压在
 * 「起点」和「滑钮中心」上：滑钮一端外扩 14px，圆头正好把滑钮包住；
 * 起点一端会被夹在轨道内，所以对比度/饱和度回到中点时蓝色收成一小段（甚至为零）。
 * 滑钮中心的行程两端各内缩半个轨道高，滑钮贴到轨道最左边时也不会被切掉半个。
 *
 * 与移动端的唯一区别是颜色：轨道、中点刻度改读主题变量（深色模式下要看得见），
 * 进度条用站点主色，而不是移动端写死的那套浅灰底配色。
 */
export function DesktopSlider({ label, value, min, max, step, display, centerOrigin, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  centerOrigin: boolean
  onChange: (value: number) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [trackWidth, setTrackWidth] = useState(0)
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)))

  // 进度条两端要按像素外扩，先量出轨道实际宽度（数据栏宽度可随窗口变化）
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const width = trackWidth || 342
  // 滑钮中心的可移动范围：两端各让出半个轨道高
  const travel = Math.max(1, width - DESKTOP_TRACK_HALF * 2)
  const knobX = DESKTOP_TRACK_HALF + ratio * travel
  const originX = (centerOrigin ? 0.5 : 0) * (width - DESKTOP_TRACK_HALF * 2) + DESKTOP_TRACK_HALF
  const fillLeft = Math.max(0, Math.min(knobX, originX) - DESKTOP_TRACK_HALF)
  const fillRight = Math.min(width, Math.max(knobX, originX) + DESKTOP_TRACK_HALF)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const r = Math.min(1, Math.max(0, (clientX - rect.left - DESKTOP_TRACK_HALF) / Math.max(1, rect.width - DESKTOP_TRACK_HALF * 2)))
    const stepped = Math.round((min + r * (max - min)) / step) * step
    onChange(Math.min(max, Math.max(min, Number(stepped.toFixed(2)))))
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 450, lineHeight: '21px' }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{display}</span>
      </div>
      {/* 外层不裁剪，滑钮推到两端时可以压住轨道边缘；轨道自己裁剪进度条的圆头 */}
      <div
        style={{ position: 'relative', marginTop: 7, height: DESKTOP_TRACK_H, touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
          // 指针捕获在部分环境下不可用，失败也要继续跟手
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          draggingRef.current = true
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => { if (draggingRef.current) setFromClientX(e.clientX) }}
        onPointerUp={() => { draggingRef.current = false }}
        onPointerCancel={() => { draggingRef.current = false }}
      >
        <div
          ref={trackRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 36,
            background: 'var(--pro-fx-track)',
            overflow: 'hidden',
          }}
        >
          {fillRight > fillLeft && (
            <div style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: fillLeft,
              width: fillRight - fillLeft,
              background: 'var(--accent)',
              borderRadius: 36,
            }} />
          )}
          {/* 中点刻度：只在中点为原点的滑杆上画（对比度 / 饱和度） */}
          {centerOrigin && (
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 6,
              height: 6,
              borderRadius: 35,
              background: 'var(--pro-fx-notch)',
            }} />
          )}
        </div>
        <div style={{
          position: 'absolute',
          top: (DESKTOP_TRACK_H - DESKTOP_KNOB) / 2,
          left: knobX - DESKTOP_KNOB / 2,
          width: DESKTOP_KNOB,
          height: DESKTOP_KNOB,
          borderRadius: 20,
          background: '#ffffff',
        }} />
      </div>
    </div>
  )
}

/** 数据栏里的一张分组卡：标题 + 可选说明 + 右上角附加内容。
 *  只留描边，不加投影：数据栏是一列紧挨着的卡片，每张都带一层阴影时
 *  底边会连成一片灰，读起来像「每张卡下面都压了一道」。 */
export function ProPanelCard({ title, hint, right, children, style }: {
  title: string
  hint?: string
  right?: ReactNode
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <section className="poolux-card" style={{ padding: 20, boxShadow: 'none', ...style }}>
      <div className="flex items-center justify-between" style={{ gap: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</h3>
        {right}
      </div>
      {hint && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{hint}</p>}
      <div style={{ marginTop: hint ? 14 : 16 }}>{children}</div>
    </section>
  )
}

/**
 * 桌面端排版按钮：与移动端 ProAlignButton 同一个图标（三条短杠），
 * 配色换成主题变量；选中只在描边上体现，不整块填色。
 */
export function DesktopAlignButton({ kind, active, onClick }: {
  kind: AlignKind
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => { hapticTick(); onClick() }}
      aria-pressed={active}
      title={ALIGN_TITLE[kind]}
      className="pro-align-btn flex items-center justify-center"
      style={{
        flex: 1,
        aspectRatio: '1 / 1',
        maxWidth: 46,
        borderRadius: 12,
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <AlignGlyph kind={kind} color={active ? 'var(--accent)' : 'var(--text-secondary)'} />
    </button>
  )
}

const ALIGN_TITLE: Record<AlignKind, string> = {
  left: '左对齐',
  hcenter: '水平居中',
  right: '右对齐',
  top: '顶对齐',
  vcenter: '垂直居中',
  bottom: '底对齐',
}
