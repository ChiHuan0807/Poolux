import React, { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'

const TOOL_LINKS = [
  { label: '视频处理', to: '/tools/video-crop' },
  { label: '相册表盘', to: '/tools/watch-face' },
] as const

/** 全站顶栏：与官网首页同一套结构与样式 */
export function Navbar() {
  const { theme } = useTheme()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)

  const contactHref = location.pathname === '/' ? '#members' : '/#members'
  const logoSrc = theme === 'dark' ? '/light.svg' : '/dark.svg'

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setToolsOpen(false)
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      setToolsOpen(false)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [menuOpen, closeMenu])

  useEffect(() => {
    if (!toolsOpen || menuOpen) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.site-header__tools--desktop')) return
      setToolsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [toolsOpen, menuOpen])

  // 路由变化时收起菜单
  useEffect(() => {
    closeMenu()
  }, [location.pathname, closeMenu])

  return (
    <div className={`site-header-root${menuOpen ? ' is-menu-open' : ''}${toolsOpen ? ' is-tools-open' : ''}`}>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" aria-label="返回 POOLUX 首页" className="site-header__brand" onClick={closeMenu}>
            <img className="site-header__logo" src={logoSrc} alt="POOLUX Studio" />
          </Link>

          <nav className="site-header__nav site-header__nav--desktop" aria-label="主要导航">
            <a href="https://azumachiaki.com/activate" target="_blank" rel="noreferrer">产品激活</a>
            <Link to="/resources">资源下载</Link>
            <div className={`site-header__tools site-header__tools--desktop${toolsOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="site-header__tools-trigger"
                aria-expanded={toolsOpen}
                aria-haspopup="menu"
                onClick={() => setToolsOpen((v) => !v)}
              >
                <span className="site-header__tools-label">相关工具</span>
                <span className="site-header__tools-caret" aria-hidden="true" />
              </button>
              <div className="site-header__tools-panel" role="menu">
                {TOOL_LINKS.map((item) => (
                  <Link key={item.to} to={item.to} role="menuitem" onClick={() => setToolsOpen(false)}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <a href={contactHref}>联系我们</a>
          </nav>

          <button
            type="button"
            className="site-header__menu-btn"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="site-header__menu-bar" />
            <span className="site-header__menu-bar" />
            <span className="site-header__menu-bar" />
          </button>
        </div>
      </header>

      <div className="site-header__menu-panel" aria-hidden={!menuOpen}>
        <nav className="site-header__nav site-header__nav--mobile" aria-label="移动端导航">
          <a href="https://azumachiaki.com/activate" target="_blank" rel="noreferrer" onClick={closeMenu}>产品激活</a>
          <Link to="/resources" onClick={closeMenu}>资源下载</Link>
          <div className={`site-header__tools site-header__tools--mobile${toolsOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="site-header__tools-trigger"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((v) => !v)}
            >
              <span className="site-header__tools-label">相关工具</span>
              <span className="site-header__tools-caret" aria-hidden="true" />
            </button>
            <div className="site-header__tools-panel" role="menu">
              {TOOL_LINKS.map((item) => (
                <Link key={item.to} to={item.to} role="menuitem" onClick={closeMenu}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <a href={contactHref} onClick={closeMenu}>联系我们</a>
        </nav>
      </div>
      {menuOpen && (
        <button type="button" className="site-header__menu-backdrop" aria-label="关闭菜单" onClick={closeMenu} />
      )}
    </div>
  )
}