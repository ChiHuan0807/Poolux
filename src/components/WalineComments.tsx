import { useEffect, useRef } from 'react'

/**
 * 站点主题色常量（与 index.css :root 一致）
 */
const T = {
  bgSecondary: '#FFFFFF',
  bgTertiary: '#F2F2F7',
  textPrimary: '#000000',
  textSecondary: 'rgba(60, 60, 67, 0.6)',
  textMuted: 'rgba(60, 60, 67, 0.3)',
  borderColor: 'rgba(60, 60, 67, 0.12)',
  accent: '#7890C0',
  accentHover: '#6078A0',
  accentSecondary: '#9AADD4',
  accentBg: 'rgba(120, 144, 192, 0.08)',
  danger: '#FF3B30',
  radiusSm: '8px',
  radiusMd: '10px',
  shadowCard: '0 0.5px 2px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
  shadowElevated: '0 2px 12px rgba(0,0,0,0.08), 0 0.5px 4px rgba(0,0,0,0.04)',
  font: '"MiSans", -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
}

const TDark = {
  bgSecondary: '#2C2C2E',
  bgTertiary: '#1C1C1E',
  textPrimary: '#F2F2F7',
  textSecondary: 'rgba(235, 235, 245, 0.6)',
  textMuted: 'rgba(235, 235, 245, 0.3)',
  borderColor: 'rgba(255, 255, 255, 0.10)',
  accent: '#6BA3B5',
  accentHover: '#7DB4C6',
  accentSecondary: '#8E9AD6',
  accentBg: 'rgba(107, 163, 181, 0.12)',
  danger: '#FF6961',
  radiusSm: '8px',
  radiusMd: '10px',
  shadowCard: '0 0.5px 2px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)',
  shadowElevated: '0 2px 12px rgba(0,0,0,0.4), 0 0.5px 4px rgba(0,0,0,0.2)',
  font: '"MiSans", -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? TDark : T
}

function css(el: HTMLElement, s: Record<string, string>) {
  for (const [k, v] of Object.entries(s)) el.style.setProperty(k, v, 'important')
}

function hide(el: Element | null) {
  if (el) (el as HTMLElement).style.setProperty('display', 'none', 'important')
}

/**
 * 需要完全隐藏的元素类名（CSS + JS 双保险）
 */
const HIDE_CLASSES = [
  // 点赞
  '.wl-like',
  // 编辑器工具栏
  '.wl-tool', '.wl-toolbar', '.wl-editor-tool',
  // 工具栏内的子按钮
  '.wl-emoji', '.wl-image', '.wl-md', '.wl-preview',
  // 管理员操作按钮（通过/待审核/垃圾）
  '.wl-operation', '.wl-admin',
  // 其他不需要的
  '.wl-sort', '.wl-copyright', '.wl-power', '.wl-rss',
  '.wl-meta', '.wl-ua', '.wl-useragent', '.wl-count',
  '.wl-loading', '.wl-footer .wl-info .wl-text-number',
].join(',')

/** 通过文本内容匹配需要隐藏的按钮 */
function hideByText(root: Element, texts: string[]) {
  root.querySelectorAll('button, a, span, div').forEach(el => {
    const t = (el.textContent || '').trim()
    if (texts.includes(t)) hide(el)
  })
}

/**
 * 应用主题到 Waline DOM
 */
function applyTheme(root: Element) {
  const t = getTheme()

  // ===== 第一步：隐藏所有不需要的元素 =====
  root.querySelectorAll(HIDE_CLASSES).forEach(hide)

  // 暴力隐藏 footer 工具栏：隐藏 .wl-footer 内所有不含 .wl-btn 的直接子元素
  root.querySelectorAll('.wl-footer').forEach(footer => {
    Array.from(footer.children).forEach(child => {
      if (!child.querySelector('.wl-btn')) hide(child)
    })
  })

  // 通过文本内容隐藏管理员按钮
  hideByText(root, ['通过', '待审核', '垃圾', 'Approved', 'Waiting', 'Spam'])

  // 隐藏空的子评论容器（含空白文本节点的情况）
  root.querySelectorAll('.wl-child').forEach(el => {
    const cards = el.querySelectorAll('.wl-card')
    const text = (el.textContent || '').trim()
    if (cards.length === 0 && !text) {
      hide(el)
    }
  })

  // ===== 面板 =====
  const panel = root.querySelector('.wl-panel')
  if (panel) {
    css(panel as HTMLElement, {
      background: 'transparent',
      border: 'none',
      boxShadow: 'none',
      margin: '0',
      padding: '0',
    })
  }

  // ===== 登录区 =====
  root.querySelectorAll('.wl-login').forEach(el => {
    css(el as HTMLElement, {
      background: t.bgSecondary,
      border: `1px solid ${t.borderColor}`,
      borderRadius: t.radiusMd,
      padding: '16px',
      marginBottom: '16px',
    })
  })
  root.querySelectorAll('.wl-login-nick').forEach(el => {
    css(el as HTMLElement, { color: t.accent })
  })

  // ===== 输入框（昵称/邮箱/网址） =====
  root.querySelectorAll('.wl-input').forEach(el => {
    css(el as HTMLElement, {
      background: t.bgTertiary,
      border: `1px solid ${t.borderColor}`,
      borderRadius: t.radiusSm,
      color: t.textPrimary,
      fontSize: '13px',
      padding: '8px 12px',
    })
  })

  // ===== Header =====
  root.querySelectorAll('.wl-header').forEach(el => {
    css(el as HTMLElement, {
      borderBottom: `1px solid ${t.borderColor}`,
      borderTop: 'none',
    })
  })
  root.querySelectorAll('.wl-header label').forEach(el => {
    css(el as HTMLElement, { color: t.textSecondary })
  })
  root.querySelectorAll('.wl-header input').forEach(el => {
    css(el as HTMLElement, { color: t.textPrimary, fontSize: '13px' })
  })

  // ===== 编辑器（消息框）——白色背景 =====
  root.querySelectorAll('.wl-editor').forEach(el => {
    css(el as HTMLElement, {
      background: t.bgSecondary,
      border: `1px solid ${t.borderColor}`,
      borderRadius: t.radiusMd,
      color: t.textPrimary,
      fontSize: '14px',
      lineHeight: '1.6',
      padding: '12px 14px',
      minHeight: '100px',
    })
  })

  // ===== Footer =====
  root.querySelectorAll('.wl-footer').forEach(el => {
    css(el as HTMLElement, {
      borderTop: `1px solid ${t.borderColor}`,
      paddingTop: '12px',
      marginTop: '10px',
    })
  })

  // ===== 操作栏图标（回复/删除/编辑）——不含点赞 =====
  root.querySelectorAll('.wl-card .wl-reply, .wl-card .wl-delete, .wl-card .wl-edit').forEach(el => {
    css(el as HTMLElement, {
      color: t.textMuted,
      transition: 'color 0.15s ease',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '4px 6px',
      borderRadius: t.radiusSm,
      display: 'inline-flex',
      alignItems: 'center',
    })
    el.addEventListener('mouseenter', () => { (el as HTMLElement).style.color = t.accent })
    el.addEventListener('mouseleave', () => { (el as HTMLElement).style.color = t.textMuted })
  })
  root.querySelectorAll('.wl-delete').forEach(el => {
    el.addEventListener('mouseenter', () => { (el as HTMLElement).style.color = t.danger })
    el.addEventListener('mouseleave', () => { (el as HTMLElement).style.color = t.textMuted })
  })

  // ===== 按钮 =====
  root.querySelectorAll('.wl-btn').forEach(el => {
    css(el as HTMLElement, {
      borderRadius: t.radiusSm,
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
    })
  })
  root.querySelectorAll('.wl-btn.primary').forEach(el => {
    css(el as HTMLElement, {
      background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accentSecondary} 100%)`,
      border: 'none',
      color: '#fff',
      padding: '8px 22px',
      boxShadow: t.shadowCard,
    })
  })

  // ===== 评论卡片 =====
  root.querySelectorAll('.wl-card').forEach(el => {
    css(el as HTMLElement, {
      background: 'transparent',
      border: 'none',
      borderRadius: '0',
      padding: '14px 0',
      marginBottom: '0',
      borderBottom: `1px solid ${t.borderColor}`,
    })
  })

  // ===== 卡片容器 =====
  root.querySelectorAll('.wl-card-item').forEach(el => {
    css(el as HTMLElement, { padding: '14px 0' })
  })
  const cardItems = root.querySelectorAll('.wl-card-item')
  if (cardItems.length > 0) {
    const last = cardItems[cardItems.length - 1] as HTMLElement
    last.style.paddingBottom = '0'
    const lastCard = last.querySelector('.wl-card') as HTMLElement | null
    if (lastCard) lastCard.style.borderBottom = 'none'
  }

  // ===== 头像 =====
  root.querySelectorAll('.wl-avatar, .wl-user-avatar').forEach(el => {
    css(el as HTMLElement, {
      borderRadius: '50%',
      border: `2px solid ${t.borderColor}`,
    })
  })

  // ===== 用户名 =====
  root.querySelectorAll('.wl-nick').forEach(el => {
    css(el as HTMLElement, {
      color: t.textPrimary,
      fontSize: '14px',
      fontWeight: '600',
      textDecoration: 'none',
    })
    el.addEventListener('mouseenter', () => { (el as HTMLElement).style.color = t.accent })
    el.addEventListener('mouseleave', () => { (el as HTMLElement).style.color = t.textPrimary })
  })

  // ===== 徽章 =====
  root.querySelectorAll('.wl-badge').forEach(el => {
    css(el as HTMLElement, {
      borderColor: t.accent,
      color: t.accent,
      fontSize: '0.75em',
    })
  })

  // ===== 时间戳 =====
  root.querySelectorAll('.wl-time').forEach(el => {
    css(el as HTMLElement, { color: t.textMuted, fontSize: '12px' })
  })

  // ===== 评论内容 =====
  root.querySelectorAll('.wl-card .wl-content').forEach(el => {
    css(el as HTMLElement, { color: t.textPrimary, fontSize: '14px', lineHeight: '1.7' })
  })
  root.querySelectorAll('.wl-content a').forEach(el => {
    css(el as HTMLElement, { color: t.accent, textDecoration: 'none' })
    el.addEventListener('mouseenter', () => {
      const e = el as HTMLElement; e.style.color = t.accentHover; e.style.textDecoration = 'underline'
    })
    el.addEventListener('mouseleave', () => {
      const e = el as HTMLElement; e.style.color = t.accent; e.style.textDecoration = 'none'
    })
  })

  // ===== 引用块 =====
  root.querySelectorAll('.wl-quote').forEach(el => {
    css(el as HTMLElement, {
      background: t.bgTertiary,
      borderInlineStart: `3px solid ${t.accentSecondary}`,
      borderRadius: `0 ${t.radiusSm} ${t.radiusSm} 0`,
      padding: '8px 12px',
      margin: '8px 0',
      color: t.textSecondary,
      fontSize: '13px',
    })
  })

  // ===== 空状态 =====
  root.querySelectorAll('.wl-empty').forEach(el => {
    css(el as HTMLElement, { color: t.textMuted, fontSize: '14px', textAlign: 'center', padding: '32px 16px' })
  })

  // ===== 加载更多 =====
  root.querySelectorAll('.wl-more').forEach(el => {
    css(el as HTMLElement, {
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      color: t.accent, fontSize: '13px', fontWeight: '500',
      borderRadius: t.radiusSm, padding: '6px 14px',
      background: 'none', border: `1px solid ${t.borderColor}`, cursor: 'pointer',
    })
    el.addEventListener('mouseenter', () => {
      const e = el as HTMLElement
      e.style.background = t.accentBg; e.style.color = t.accentHover; e.style.borderColor = t.accentSecondary
    })
    el.addEventListener('mouseleave', () => {
      const e = el as HTMLElement
      e.style.background = 'none'; e.style.color = t.accent; e.style.borderColor = t.borderColor
    })
  })

  // ===== 全局字体 =====
  root.querySelectorAll('*').forEach(el => {
    if (el instanceof HTMLElement) el.style.fontFamily = t.font
  })
}

/**
 * 加载 CSS 文件并等待完成
 */
function loadCSS(href: string): Promise<void> {
  return new Promise(resolve => {
    if (document.querySelector(`link[href="${href}"]`)) { resolve(); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => resolve()
    document.head.appendChild(link)
    setTimeout(resolve, 2000)
  })
}

/**
 * Waline 评论组件
 */
export function WalineComments() {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<{ destroy?: () => void } | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)
  const styleInjected = useRef(false)

  useEffect(() => {
    let cancelled = false

    const themeObserver = new MutationObserver(() => {
      if (containerRef.current) applyTheme(containerRef.current)
    })
    themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    })

    async function main() {
      await loadCSS('https://unpkg.com/@waline/client@v3/dist/waline.css')
      if (cancelled) return

      // 注入 CSS 覆盖（兜底，主要靠 JS inline style）
      if (!styleInjected.current) {
        const style = document.createElement('style')
        style.id = 'waline-override-css'
        style.textContent = `
.wl-panel{background:transparent!important;border:none!important;box-shadow:none!important;margin:0!important;padding:0!important}
.wl-card{border:none!important;border-bottom:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-radius:0!important;padding:14px 0!important;background:transparent!important}
.wl-card:last-child{border-bottom:none!important}
.wl-card-item{padding:14px 0!important}
.wl-card-item:last-child{padding-bottom:0!important}
.wl-card-item:last-child .wl-card{border-bottom:none!important}
.wl-header{border-bottom:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-top:none!important}
.wl-login{background:var(--bg-secondary,#fff)!important;border:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-radius:10px!important;padding:16px!important;margin-bottom:16px!important}
.wl-editor,div[contenteditable="true"]{background:#fff!important;border:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-radius:10px!important;color:var(--text-primary,#000)!important;font-size:14px!important;padding:12px 14px!important;min-height:100px!important;outline:none!important}
.wl-input{background:var(--bg-tertiary,#F2F2F7)!important;border:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-radius:8px!important;color:var(--text-primary,#000)!important;font-size:13px!important;padding:8px 12px!important}
.wl-footer{border-top:1px solid var(--border-color,rgba(60,60,67,0.12))!important;padding-top:12px!important;margin-top:10px!important}
.wl-btn.primary{background:linear-gradient(135deg,var(--accent,#7890C0),var(--accent-secondary,#9AADD4))!important;border:none!important;color:#fff!important;padding:8px 22px!important;border-radius:8px!important}
.wl-nick{color:var(--text-primary,#000)!important;font-size:14px!important;font-weight:600!important;text-decoration:none!important}
.wl-time{color:var(--text-muted,rgba(60,60,67,0.3))!important;font-size:12px!important}
.wl-card .wl-content{color:var(--text-primary,#000)!important;font-size:14px!important;line-height:1.7!important}
.wl-content a{color:var(--accent,#7890C0)!important;text-decoration:none!important}
.wl-badge{border-color:var(--accent,#7890C0)!important;color:var(--accent,#7890C0)!important}
.wl-quote{background:var(--bg-tertiary,#F2F2F7)!important;border-inline-start:3px solid var(--accent-secondary,#9AADD4)!important;border-radius:0 8px 8px 0!important;padding:8px 12px!important;color:var(--text-secondary,rgba(60,60,67,0.6))!important;font-size:13px!important}
.wl-empty{color:var(--text-muted,rgba(60,60,67,0.3))!important;font-size:14px!important;text-align:center!important;padding:32px 16px!important}
.wl-more{color:var(--accent,#7890C0)!important;border:1px solid var(--border-color,rgba(60,60,67,0.12))!important;border-radius:8px!important;padding:6px 14px!important;background:none!important}
.wl-avatar{border-radius:50%!important;border:2px solid var(--border-color,rgba(60,60,67,0.12))!important}
.wl-like,.wl-tool,.wl-toolbar,.wl-editor-tool,.wl-emoji,.wl-image,.wl-md,.wl-preview,.wl-sort,.wl-copyright,.wl-power,.wl-rss,.wl-meta,.wl-ua,.wl-useragent,.wl-count,.wl-operation,.wl-admin,.wl-loading{display:none!important}
.wl-action{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:2px!important;min-width:28px!important;height:28px!important}
.wl-panel::-webkit-scrollbar{display:none}
.wl-panel{scrollbar-width:none}
.wl-child{margin:0!important;padding:0!important}
*{font-family:"MiSans",-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif!important}
`
        document.head.appendChild(style)
        styleInjected.current = true
      }

      // 初始化 Waline
      const { init } = await import('https://unpkg.com/@waline/client@v3/dist/waline.js')
      if (cancelled || !containerRef.current) return

      instanceRef.current = init({
        el: containerRef.current,
        serverURL: 'https://waline.poolux.top/',
        dark: 'html[data-theme="dark"]',
        login: 'force',
        lang: 'zh-CN',
        emoji: [],
        search: false,
        pageview: false,
        reaction: [],
        copyright: false,
        locale: {
          placeholder: '说点什么...',
          nick: '昵称', mail: '邮箱', link: '网址',
          submit: '发布', reply: '回复', cancel: '取消',
          more: '加载更多', sofa: '还没有评论，来抢沙发吧~',
        },
      })

      // MutationObserver 持续应用样式
      if (containerRef.current) {
        observerRef.current = new MutationObserver(() => applyTheme(containerRef.current!))
        observerRef.current.observe(containerRef.current, { childList: true, subtree: true })
        setTimeout(() => applyTheme(containerRef.current!), 100)
        setTimeout(() => applyTheme(containerRef.current!), 500)
        setTimeout(() => applyTheme(containerRef.current!), 1000)
      }
    }

    main()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      themeObserver.disconnect()
      if (instanceRef.current?.destroy) {
        try { instanceRef.current.destroy() } catch { /* ignore */ }
      }
    }
  }, [])

  return (
    <div
      style={{
        background: 'var(--bg-secondary, #fff)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 16px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
        <div style={{ width: '3px', height: '18px', borderRadius: '2px', background: 'var(--gradient-accent)', flexShrink: 0 }} />
        <h3 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em', margin: 0, lineHeight: 1 }}>
          评论
        </h3>
      </div>
      <div ref={containerRef} />
    </div>
  )
}