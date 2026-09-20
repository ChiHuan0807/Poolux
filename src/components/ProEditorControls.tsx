import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PAD } from '@/lib/watchFaceKit'
import { hapticEdge, hapticTick } from '@/lib/haptics'

/* ═══════════════════════════════════════════════════════════
   新版移动端编辑器（手环 Pro 系列）的通用控件
   尺寸与配色取自 Figma 画板「主页 / 效果-文字编辑 / 效果-图片效果 / 取色」
   ═══════════════════════════════════════════════════════════ */

/** 底部抽屉底色：8% 黑，叠在白色页面上是 #EBEBEB。
 *  设计稿的 #FFFFFF 65% 是叠在深色页面上才成形的面板色，页面改成白色之后
 *  那一层等于纯白、和页面糊在一起，所以换成一个明显比页面深的浅灰，
 *  把「抽屉是浮在页面上的一层」这件事重新表达出来。
 *  抽屉里的控件（分段控件轨道、滑杆轨道、输入框）本身也是黑色透明叠加，
 *  在这层浅灰上依然逐级变深，层次没有被压平。 */
export const PRO_SHEET_BG = 'rgba(0, 0, 0, 0.08)'
/** 设计稿主色：滑杆进度条与选中态 */
export const PRO_ACCENT = '#3382ff'
export const PRO_INK = '#131313'
/** 圆形按钮的描边宽度：顶栏的返回 / 恢复 / 删除 / 下载与底栏的三个入口共用。
 *  它们从「实心深灰圆」改成「白底 + 描边」，描边细一点才不至于比原来的实心块还重。 */
export const PRO_BUTTON_STROKE = 1.5
/** 按钮描边与按钮内图标的颜色：深灰 #333333，不是纯黑。
 *  按钮原来的实心块就是这个灰，描边沿用同一个色号，观感才和换掉的那版是一套东西；
 *  也顺带和排版按钮的图标色（#363636）落在同一个色阶上。 */
export const PRO_BUTTON_STROKE_COLOR = '#333333'
/** 底部抽屉的顶部圆角（设计稿展开后的参数栏是圆角面板，不是直角；48px 由设计稿确认） */
export const PRO_SHEET_RADIUS = 48
/** 抽屉展开/收起的时长与曲线：抽屉上滑、预览框缩小、两侧淡入淡出共用同一组，避免各走各的节奏。
 *  曲线取 iOS 模态面板的标准缓动（0.32, 0.72, 0, 1）：起步快、尾巴慢，
 *  也就是「快-慢」的速率 —— 手感上先冲出来再稳稳落位，比匀速/对称曲线舒适。
 *  时长从 0.44s 收到 0.32s：整体提速，同时因为曲线前段跑得快，观感比数字上更利落。 */
export const PRO_SHEET_DURATION = 0.32
export const PRO_SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** 抽屉内「图片效果 / 签名」两个面板左右平移的时长与曲线。
 *  比抽屉本身再快一点：面板只是原地换页，走太久会显得拖沓；
 *  曲线沿用同一条 iOS 缓动，起步快、尾巴稳，避免匀速平移那种「硬切」的生硬感。 */
export const PRO_TAB_DURATION = 0.3
export const PRO_TAB_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** 抽屉展开后预览框整体缩小的比例：对应 iOS「内容往后退一层」的层次感。
 *  不缩到刚好放下（那样在 393×852 上正好是 1:1，等于没效果），保留一成左右的退让。 */
export const PRO_PREVIEW_SHEET_SCALE = 0.92
/** 抽屉顶部的拖拽热区高度：设计稿的 64×4 拖拽条本身只有 13px 高，
 *  手指很容易一滑就落到页面下拉刷新上。这里用一层透明热区把可拖拽范围放到 48px，
 *  视觉仍然是 64×4，不动设计稿。
 *  热区只覆盖「横条 + 横条以下的一段留白」：分段控件在 DOM 里排在热区之后，
 *  它自己那 250px 宽的范围内会盖住热区，所以把热区加高不会挡住分段控件的点击。 */
export const PRO_SHEET_DRAG_ZONE = 48
/** 向下拖多少像素判定为「收起抽屉」 */
export const PRO_SHEET_CLOSE_DISTANCE = 60
/** 抽屉展开后预览框底边与抽屉顶边之间保留的最小间隙（设计稿 517-490 = 27） */
export const PRO_SHEET_GAP = 27
/** 抽屉展开后预览框在「抽屉顶边以上的可视区域」里居中，这是该区域的上边界（距屏幕顶边的高度）。
 *  由设计稿两个展开画板反推：「效果-图片效果」抽屉 357 高时预览框底边离抽屉正好 27px（= PRO_SHEET_GAP），
 *  「取色」抽屉 217 高时间隙 95px —— 两者都等于「以 67px 为上边界居中」，而 67 = 27 + 2×20（容器上下各留 PAD）。 */
export const PRO_SHEET_TOP_RESERVE = PRO_SHEET_GAP + PAD * 2

/** 圆形按钮的描边样式：白底 + 深灰描边。页面与抽屉里的按钮统一用它，
 *  避免有的按钮是实心深灰、有的是描边，看起来像两套东西。 */
export function proStrokeStyle(size: number): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'transparent',
    border: `${PRO_BUTTON_STROKE}px solid ${PRO_BUTTON_STROKE_COLOR}`,
  }
}

/** 底部三个圆形入口按钮：56×56 圆 + 12px 标签。宽度固定 56，保证三个按钮的横向间距和设计稿一致 */
export function ProActionButton({ icon, label, onClick, disabled }: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => { hapticTick(); onClick() }}
      disabled={disabled}
      className="flex flex-col items-center"
      style={{ width: 56, gap: 6, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <span
        className="flex items-center justify-center transition-transform active:scale-95"
        style={proStrokeStyle(56)}
      >
        {icon}
      </span>
      <span style={{ color: PRO_INK, fontSize: 12, fontWeight: 450, lineHeight: '16px' }}>{label}</span>
    </button>
  )
}

/** 底栏「上传图片」与「取色」之间的横向间距（设计稿 71px，分割线居中） */
export const PRO_ACTION_DIVIDED_GAP = 71
/** 底栏「取色」与「效果」之间的横向间距（设计稿 34px，无分割线） */
export const PRO_ACTION_GAP = 34

/** 底栏分割线：设计稿 `Rectangle 2`，3×44、圆角 35，竖直居中于 56px 圆形按钮。
 *  颜色跟按钮描边一起收成同一个深灰，否则纯黑的分割线会比旁边的细描边圈更抢眼。 */
export function ProActionDivider() {
  return (
    <div
      aria-hidden
      className="flex"
      style={{ width: PRO_ACTION_DIVIDED_GAP, justifyContent: 'center', alignItems: 'flex-start', marginTop: 6 }}
    >
      <div style={{ width: 3, height: 44, borderRadius: 35, background: PRO_BUTTON_STROKE_COLOR }} />
    </div>
  )
}

/**
 * 底部抽屉外壳：64×4 视觉拖拽条 + 浅灰面板底（PRO_SHEET_BG），向下拖超过 60px 关闭。
 *
 * 展开 / 收起动画不在这里做：抽屉被放在一个高度固定的容器里（见 TemplateEditor），
 * 容器贴着屏幕底边，抽屉整体从屏幕下方滑上来、收起时再滑回去，
 * 因此收起过程能一直看到面板往下走，最后被底部入口按钮盖住，而不是原地淡出。
 */
export function ProSheet({ children, minHeight, onClose }: {
  children: ReactNode
  minHeight: number
  onClose: () => void
}) {
  const [dragY, setDragY] = useState(0)
  const draggingRef = useRef(false)
  const startRef = useRef(0)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    startRef.current = e.clientY
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 指针捕获在部分环境下不可用，失败也要继续跟手 */ }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    setDragY(Math.max(0, e.clientY - startRef.current))
  }
  const finishDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (dragY > PRO_SHEET_CLOSE_DISTANCE) onClose()
    setDragY(0)
  }

  return (
    <div
      style={{
        position: 'relative',
        background: PRO_SHEET_BG,
        minHeight,
        borderTopLeftRadius: PRO_SHEET_RADIUS,
        borderTopRightRadius: PRO_SHEET_RADIUS,
        transform: `translateY(${dragY}px)`,
        transition: draggingRef.current ? 'none' : `transform ${PRO_SHEET_DURATION}s ${PRO_SHEET_EASING}`,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      {/* 视觉拖拽条：只是长相，真正吃手势的是下面那层覆盖在上方的透明热区 */}
      <div className="flex justify-center pointer-events-none" style={{ paddingTop: 9 }}>
        <div style={{ width: 64, height: 4, borderRadius: 20, background: 'rgba(0, 0, 0, 0.31)' }} />
      </div>
      {/* 拖拽热区：高度只覆盖到第一个控件之前，不会挡到分段控件 / 滑杆的手势。
          加高之后手指落在抽屉顶部任意位置都能拖动面板，不必精准点中那 4px 的横条。 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: PRO_SHEET_DRAG_ZONE,
          cursor: 'grab',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
      {children}
    </div>
  )
}

/** 分段控件的轨道尺寸（设计稿 250×42 胶囊、内边距 3、选中胶囊 36 高） */
export const PRO_SEGMENT_WIDTH = 250
export const PRO_SEGMENT_PAD = 3
/** 按住 / 拖动底块时四周内缩的像素值：
 *  四条边内缩同一个值，缩放后「到左右」和「到上下」的间距才会完全一致；
 *  底块从 36 高收到 28，视觉上是「按下去、变小一点」，不是横向抻长。 */
export const PRO_SEGMENT_PRESS_INSET = 4
/** 分段控件的轨道底色；页面为白色后改成正向的浅灰（原来是 21% 白，白底上看不见） */
export const PRO_SEGMENT_TRACK_BG = 'rgba(0, 0, 0, 0.06)'
/** 分段控件选中底块的底色：比轨道再深一点，保持「底块从轨道里浮出来」的关系 */
export const PRO_SEGMENT_PILL_BG = 'rgba(0, 0, 0, 0.11)'

/**
 * 分段切换（图片效果 / 签名）：250×42 胶囊，选中项是深色小胶囊。
 *
 * 底块（指示当前页的那块灰色胶囊）的行为：
 *  - 按住另一档：底块「带动画」滑到手指位置，而不是瞬间跳过去 —— 手指刚落下就有位移可看。
 *  - 按住当前档：底块原地不动。否则松手后它会先被手指带走、再弹回原位，
 *    看起来就像「位移一下然后返回原位」。
 *  - 手指拖动：底块 1:1 跟手（这期间关掉过渡），滑过中点时文字高亮跟着换，和 iOS 分段控件一致。
 *  - 松手：带动画吸附到最近一档，并用一次弱震动确认切换。
 */
export function ProSegmented<T extends string>({ value, onChange, items }: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: string }[]
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const pressXRef = useRef(0)
  const [dragPos, setDragPos] = useState<number | null>(null)
  // idle 静止 / pressing 刚按下（底块带动画靠过去）/ following 手指在拖（底块 1:1 跟手）
  const [phase, setPhase] = useState<'idle' | 'pressing' | 'following'>('idle')

  const count = items.length
  const slotWidth = (PRO_SEGMENT_WIDTH - PRO_SEGMENT_PAD * 2) / count
  const index = Math.max(0, items.findIndex(item => item.value === value))
  const pos = dragPos ?? index
  const highlighted = Math.min(count - 1, Math.max(0, Math.round(pos)))

  /** 把手指的横坐标换算成连续档位（0 … count-1），两端夹住不越界 */
  const posFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el || count < 2) return 0
    const rect = el.getBoundingClientRect()
    const raw = (clientX - rect.left - PRO_SEGMENT_PAD - slotWidth / 2) / slotWidth
    return Math.min(count - 1, Math.max(0, raw))
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 指针捕获在部分环境下不可用，失败也要继续跟手
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    pressXRef.current = e.clientX
    setPhase('pressing')
    const pressed = posFromClientX(e.clientX)
    if (Math.round(pressed) !== index) setDragPos(pressed)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase === 'idle') return
    // 按下后的轻微抖动不算拖动，否则底块会立刻失去过渡、看起来像瞬移
    if (phase === 'pressing' && Math.abs(e.clientX - pressXRef.current) < 6) return
    setPhase('following')
    setDragPos(posFromClientX(e.clientX))
  }
  const finish = () => {
    if (phase === 'idle') return
    setPhase('idle')
    setDragPos(null)
    const next = items[highlighted]
    if (next && next.value !== value) {
      onChange(next.value)
      hapticTick()
    }
  }

  return (
    <div
      ref={trackRef}
      className="mx-auto flex relative"
      style={{
        width: PRO_SEGMENT_WIDTH,
        height: 42,
        borderRadius: 44,
        // 轨道原本是 21% 白（叠在深色页面上才看得见）。页面改成白色之后，
        // 白底叠白等于没有轨道，所以整体反过来：用 6% 黑做轨道，底块再用更深的 11% 黑。
        background: PRO_SEGMENT_TRACK_BG,
        padding: PRO_SEGMENT_PAD,
        touchAction: 'none',
        cursor: 'pointer',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {/* 位移跟手所以拖动期间不加过渡；内缩量在内层，单独过渡 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: PRO_SEGMENT_PAD,
          top: PRO_SEGMENT_PAD,
          width: slotWidth,
          height: 36,
          transform: `translateX(${pos * slotWidth}px)`,
          transition: phase === 'following' ? 'none' : `transform ${PRO_TAB_DURATION}s ${PRO_TAB_EASING}`,
          pointerEvents: 'none',
        }}
      >
        {/* 按住 / 拖动时四周各内缩同一个像素值。
            用等比 scale 缩小是不行的：底块偏扁（宽约 122、高 36），
            同样缩 10% 时左右各让出约 6px、上下只让出约 2px，四条边的间距肉眼一看就不一样。
            改成四周内缩相同值，缩放后的左右与上下间距才真正相等。 */}
        <div
          style={{
            position: 'absolute',
            borderRadius: 44,
            background: PRO_SEGMENT_PILL_BG,
            top: phase === 'idle' ? 0 : PRO_SEGMENT_PRESS_INSET,
            bottom: phase === 'idle' ? 0 : PRO_SEGMENT_PRESS_INSET,
            left: phase === 'idle' ? 0 : PRO_SEGMENT_PRESS_INSET,
            right: phase === 'idle' ? 0 : PRO_SEGMENT_PRESS_INSET,
            transition: `top 0.18s ease, bottom 0.18s ease, left 0.18s ease, right 0.18s ease`,
          }}
        />
      </div>
      {items.map((item, i) => (
        <button
          key={item.value}
          type="button"
          className="flex-1 relative"
          style={{
            borderRadius: 44,
            background: 'transparent',
            color: '#000000',
            fontSize: 15,
            fontWeight: i === highlighted ? 520 : 450,
            zIndex: 1,
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** 滑杆刻度：轨道 28 高、滑钮 22、轨道圆头半径 14 */
export const PRO_FX_TRACK_H = 28
export const PRO_FX_TRACK_HALF = PRO_FX_TRACK_H / 2
export const PRO_FX_KNOB = 22

/**
 * 效果抽屉里的滑杆：342×28 轨道 + 22px 滑钮。
 *
 * 蓝色进度条两端的圆头（半径 = 半个轨道高）不是压在各自的边界上，而是分别压在
 * 「起点」和「滑钮中心」上：滑钮一端外扩 14px，圆头正好把滑钮包住，和设计稿一致；
 * 起点一端会被夹在轨道内，所以对比度/饱和度回到中点时蓝色收成一小段（甚至为零）。
 *
 * 滑钮中心的行程两端各内缩 PRO_FX_TRACK_HALF：设计稿里白色圆圈始终落在轨道内，
 * 蓝色圆头也始终包得住它（滑钮贴到轨道最左边时不会被切掉半个）。
 */
export function ProFxSlider({ label, value, min, max, step, display, centerOrigin, onChange }: {
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
  // 记住上一次是否贴在两端：贴在端点上时滑杆不再往前走，用它做「只震一次」的去重
  const edgeRef = useRef<'min' | 'max' | null>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)))

  // 进度条两端要按像素外扩，所以需要轨道的实际宽度（不同机型抽屉宽度不同）
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
  // 滑钮中心的可移动范围：两端各让出 PRO_FX_TRACK_HALF
  const travel = Math.max(1, width - PRO_FX_TRACK_HALF * 2)
  const knobX = PRO_FX_TRACK_HALF + ratio * travel
  const originX = (centerOrigin ? 0.5 : 0) * (width - PRO_FX_TRACK_HALF * 2) + PRO_FX_TRACK_HALF
  const fillLeft = Math.max(0, Math.min(knobX, originX) - PRO_FX_TRACK_HALF)
  const fillRight = Math.min(width, Math.max(knobX, originX) + PRO_FX_TRACK_HALF)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const r = Math.min(1, Math.max(0, (clientX - rect.left - PRO_FX_TRACK_HALF) / Math.max(1, rect.width - PRO_FX_TRACK_HALF * 2)))
    const raw = min + r * (max - min)
    const stepped = Math.round(raw / step) * step
    const next = Math.min(max, Math.max(min, Number(stepped.toFixed(2))))
    // 推到两端时给一次弱震动：滑杆到端点后位置不再变化，靠震动告诉手指「已经到头了」
    const edge: 'min' | 'max' | null = next <= min ? 'min' : next >= max ? 'max' : null
    if (edge && edge !== edgeRef.current) hapticEdge()
    edgeRef.current = edge
    onChange(next)
  }

  return (
    <div style={{ marginTop: 23 }}>
      <div className="flex items-baseline justify-between">
        <span style={{ color: PRO_INK, fontSize: 16, fontWeight: 450, lineHeight: '21px' }}>{label}</span>
        <span style={{ color: 'rgba(19, 19, 19, 0.5)', fontSize: 13 }}>{display}</span>
      </div>
      {/* 外层不裁剪，滑钮推到两端时可以压住轨道边缘；轨道自己裁剪进度条的圆头 */}
      <div
        style={{ position: 'relative', marginTop: 7, height: PRO_FX_TRACK_H, touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e) => {
          // 指针捕获在部分环境下不可用，失败也要继续跟手
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          draggingRef.current = true
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => { if (draggingRef.current) setFromClientX(e.clientX) }}
        onPointerUp={() => { draggingRef.current = false }}
        onPointerCancel={() => { draggingRef.current = false }}
      >
        <div
          ref={trackRef}
          data-pro-slider={label}
          style={{ position: 'absolute', inset: 0, borderRadius: 36, background: 'rgba(0, 0, 0, 0.13)', overflow: 'hidden' }}
        >
          {fillRight > fillLeft && (
            <div style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: fillLeft,
              width: fillRight - fillLeft,
              background: PRO_ACCENT,
              borderRadius: 36,
            }} />
          )}
          {/* 中点刻度：只在中点为原点的滑杆上画（设计稿只有对比度、饱和度有） */}
          {centerOrigin && (
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 6,
              height: 6,
              borderRadius: 35,
              background: 'rgba(0, 0, 0, 0.32)',
            }} />
          )}
        </div>
        <div style={{
          position: 'absolute',
          top: (PRO_FX_TRACK_H - PRO_FX_KNOB) / 2,
          left: knobX - PRO_FX_KNOB / 2,
          width: PRO_FX_KNOB,
          height: PRO_FX_KNOB,
          borderRadius: 20,
          background: '#ffffff',
        }} />
      </div>
    </div>
  )
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 排版按钮里的三条短杠：线径 3px、相邻两条中心间距 8px（设计稿 4px/7px，改细一点更清爽） */
const ALIGN_BARS = [28, 16, 23]
const ALIGN_BAR_THICKNESS = 3
const ALIGN_BAR_STEP = 8
/** 排版按钮里的图标颜色 */
const ALIGN_GLYPH_COLOR = '#363636'
/** 上下对齐时三条杠是竖直的，外侧尺寸要跟着线径一起变 */
const ALIGN_CROSS = (ALIGN_BARS.length - 1) * ALIGN_BAR_STEP + ALIGN_BAR_THICKNESS
/** 三条短杠：左右/上下对齐靠第一条杠的宽度最大来体现 */
function alignOffsets(kind: AlignKind): number[] {
  if (kind === 'left' || kind === 'top') return [0, 0, 0]
  if (kind === 'hcenter' || kind === 'vcenter') return [0, (28 - 16) / 2, (28 - 23) / 2]
  return [0, 28 - 16, 28 - 23]
}

export function AlignGlyph({ kind, color }: { kind: AlignKind; color: string }) {
  const vertical = kind === 'top' || kind === 'vcenter' || kind === 'bottom'
  const offsets = alignOffsets(kind)
  return (
    <div style={{ position: 'relative', width: vertical ? ALIGN_CROSS : 28, height: vertical ? 28 : ALIGN_CROSS }}>
      {ALIGN_BARS.map((size, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            background: color,
            borderRadius: 33,
            ...(vertical
              ? { left: i * ALIGN_BAR_STEP, top: offsets[i], width: ALIGN_BAR_THICKNESS, height: size }
              : { left: offsets[i], top: i * ALIGN_BAR_STEP, width: size, height: ALIGN_BAR_THICKNESS }),
          }}
        />
      ))}
    </div>
  )
}

/** 单个排版按钮：51×51 圆角方块（白底 + 深灰描边，和里面的图标同色）；选中只在按钮外缘画主色描边，不整块填蓝 */
export function ProAlignButton({ kind, active, onClick }: {
  kind: AlignKind
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => { hapticTick(); onClick() }}
      aria-pressed={active}
      className="pro-align-btn flex items-center justify-center"
      style={{
        flex: 1,
        aspectRatio: '1 / 1',
        maxWidth: 51,
        borderRadius: 14,
        background: 'transparent',
        border: `${active ? 2 : PRO_BUTTON_STROKE}px solid ${active ? PRO_ACCENT : PRO_BUTTON_STROKE_COLOR}`,
      }}
    >
      <AlignGlyph kind={kind} color={ALIGN_GLYPH_COLOR} />
    </button>
  )
}
