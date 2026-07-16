import { useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { TemplateEditor } from './pages/TemplateEditor'
import { setupNativeChrome } from './lib/nativeChrome'
import { SplashScreen } from './components/SplashScreen'
import './index.css'

/** 离线 APK 入口：仅挂载模板处理页，模板数据来自 ./offline/template.json */
function OfflineApp() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/tools/watch-face/edit-template/:id" element={<TemplateEditor />} />
          <Route path="*" element={<Navigate to="/tools/watch-face/edit-template/offline" replace />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}
window.scrollTo(0, 0)

// 状态栏 / 导航栏沉浸（Capacitor）
void setupNativeChrome()

/** 启动页 + 主应用 */
function AppWithSplash() {
  const [showSplash, setShowSplash] = useState(true)
  const handleDone = useCallback(() => setShowSplash(false), [])
  return (
    <>
      {showSplash && <SplashScreen onDone={handleDone} />}
      <OfflineApp />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<AppWithSplash />)