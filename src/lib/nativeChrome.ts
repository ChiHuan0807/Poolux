/** 离线 APK：状态栏沉浸（内容延伸到系统栏下方） */
import { isNativeApp } from './saveImage'

export async function setupNativeChrome(): Promise<void> {
  if (!isNativeApp()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // 内容绘制到状态栏下方
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: Style.Dark })
    // 透明状态栏（部分机型需配合原生 theme）
    try {
      await StatusBar.setBackgroundColor({ color: '#00000000' })
    } catch {
      /* 部分 WebView 忽略 */
    }
  } catch (err) {
    console.warn('[nativeChrome] StatusBar 初始化失败', err)
  }
}