/** 离线 APK：状态栏沉浸 + 底部导航栏透明 */
import { isNativeApp } from './saveImage'

export async function setupNativeChrome(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: true })
    // 浅色背景 → 黑色图标（Style.Light = 深色图标）
    await StatusBar.setStyle({ style: Style.Light })
    try {
      await StatusBar.setBackgroundColor({ color: '#f9f9f9' })
    } catch { /* 部分 WebView 忽略 */ }
  } catch (err) {
    console.warn('[nativeChrome] StatusBar 初始化失败', err)
  }
}