/**
 * GitHub Actions 内执行：用 Capacitor 把 dist-offline 打成 Android debug APK
 * 环境变量：
 *   PACKAGE_NAME  top.poolux.album.t{id}
 *   APP_NAME      显示名
 *   BUNDLE_DIR    解压后的 bundle 目录（含 icon.png）
 *   WEB_DIR       默认 dist-offline
 */
import { execFileSync, execSync } from 'child_process'
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync,
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = (process.env.PACKAGE_NAME || 'top.poolux.album.app').replace(/[^a-zA-Z0-9._]/g, '')
const appName = (process.env.APP_NAME || 'POOLUX').slice(0, 30) || 'POOLUX'
const webDir = process.env.WEB_DIR || 'dist-offline'
const bundleDir = process.env.BUNDLE_DIR || '/tmp/apk-bundle'
const androidDir = join(root, 'android')

function run(cmd, opts = {}) {
  console.log(`[gha-apk] $ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

function writeCapacitorConfig() {
  const cfg = {
    appId: packageName,
    appName,
    webDir,
    server: { androidScheme: 'https' },
    android: {
      allowMixedContent: true,
      // 背景延伸到系统栏区域
      backgroundColor: '#f9f9f9',
    },
    plugins: {
      StatusBar: {
        overlaysWebView: true,
        style: 'DARK',
        backgroundColor: '#00000000',
      },
    },
  }
  writeFileSync(join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2))
}

function ensureCapacitorPackages() {
  // media：直接保存到相册；status-bar：沉浸状态栏
  run(
    'npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 @capacitor/filesystem@6 @capacitor/status-bar@6 @capacitor-community/media@7 --no-save --no-package-lock',
  )
}

function ensureAndroidProject() {
  if (existsSync(androidDir)) {
    rmSync(androidDir, { recursive: true, force: true })
  }
  run('npx cap add android')
  run('npx cap sync android')
}

/** 写入媒体相关权限（选图兼容旧机；相册保存走 MediaStore 多数情况无需弹窗） */
function patchAndroidManifest() {
  const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!existsSync(manifestPath)) {
    console.warn('[gha-apk] 未找到 AndroidManifest.xml')
    return
  }
  let xml = readFileSync(manifestPath, 'utf8')
  const perms = [
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ]
  for (const p of perms) {
    if (xml.includes(p)) continue
    const tag =
      p === 'android.permission.WRITE_EXTERNAL_STORAGE'
        ? `    <uses-permission android:name="${p}" android:maxSdkVersion="28" />\n`
        : p === 'android.permission.READ_EXTERNAL_STORAGE'
          ? `    <uses-permission android:name="${p}" android:maxSdkVersion="32" />\n`
          : `    <uses-permission android:name="${p}" />\n`
    if (xml.includes('<application')) {
      xml = xml.replace('<application', `${tag}<application`)
    } else {
      xml = xml.replace('</manifest>', `${tag}</manifest>`)
    }
  }
  if (!xml.includes('android:requestLegacyExternalStorage') && xml.includes('<application')) {
    xml = xml.replace(
      /<application\b([^>]*)>/,
      (m, attrs) => {
        if (String(attrs).includes('requestLegacyExternalStorage')) return m
        return `<application${attrs} android:requestLegacyExternalStorage="true">`
      },
    )
  }
  writeFileSync(manifestPath, xml)
  console.log('[gha-apk] AndroidManifest 权限已补齐')
}

/** 透明状态栏 + 导航栏，内容 edge-to-edge */
function patchAndroidStyles() {
  const stylesPath = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'styles.xml')
  if (!existsSync(stylesPath)) {
    console.warn('[gha-apk] 未找到 styles.xml')
    return
  }
  let xml = readFileSync(stylesPath, 'utf8')
  // 给 NoActionBar 主题补沉浸属性
  if (!xml.includes('android:statusBarColor')) {
    xml = xml.replace(
      /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
      `$1
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:enforceNavigationBarContrast">false</item>
        <item name="android:enforceStatusBarContrast">false</item>`,
    )
  }
  // 刘海屏全屏延伸
  if (!xml.includes('windowLayoutInDisplayCutoutMode')) {
    xml = xml.replace(
      /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
      `$1
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>`,
    )
  }
  writeFileSync(stylesPath, xml)
  console.log('[gha-apk] styles 沉浸属性已写入')
}

function findMainActivityPath() {
  const javaRoot = join(androidDir, 'app', 'src', 'main', 'java')
  if (!existsSync(javaRoot)) return null
  const stack = [javaRoot]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name)
      if (name.isDirectory()) stack.push(p)
      else if (name.name === 'MainActivity.java' || name.name === 'MainActivity.kt') return p
    }
  }
  return null
}

/** MainActivity：edge-to-edge + 透明系统栏 */
function patchMainActivity() {
  const path = findMainActivityPath()
  if (!path) {
    console.warn('[gha-apk] 未找到 MainActivity')
    return
  }
  if (path.endsWith('.kt')) {
    writeFileSync(
      path,
      `package ${packageName}

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = true
    controller.isAppearanceLightNavigationBars = true
    // 布局延伸到状态栏 / 手势条区域（小白条半透明沉浸，不强制隐藏以免误触难用）
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility = (
      View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
      )
  }
}
`,
    )
  } else {
    writeFileSync(
      path,
      `package ${packageName};

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (controller != null) {
      controller.setAppearanceLightStatusBars(true);
      controller.setAppearanceLightNavigationBars(true);
    }
    // 布局延伸到状态栏 / 手势条区域
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    );
  }
}
`,
    )
  }
  console.log('[gha-apk] MainActivity edge-to-edge 已写入:', path)
}

function applyIcons() {
  const iconPng = join(bundleDir, 'icon.png')
  if (!existsSync(iconPng)) {
    console.warn('[gha-apk] 无 icon.png，跳过图标替换')
    return
  }
  const resRoot = join(androidDir, 'app', 'src', 'main', 'res')
  const sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  }
  for (const [folder, size] of Object.entries(sizes)) {
    const dir = join(resRoot, folder)
    mkdirSync(dir, { recursive: true })
    const out = join(dir, 'ic_launcher.png')
    const outRound = join(dir, 'ic_launcher_round.png')
    try {
      execFileSync('convert', [iconPng, '-resize', `${size}x${size}`, out], { stdio: 'inherit' })
      cpSync(out, outRound)
    } catch {
      cpSync(iconPng, out)
      cpSync(iconPng, outRound)
    }
  }
}

function patchStrings() {
  const stringsPath = join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml')
  if (!existsSync(stringsPath)) return
  let xml = readFileSync(stringsPath, 'utf8')
  const safe = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  xml = xml.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${safe}</string>`)
  xml = xml.replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${safe}</string>`)
  writeFileSync(stringsPath, xml)
}

function buildApk() {
  const gradlew = join(androidDir, 'gradlew')
  run(`chmod +x "${gradlew}"`)
  run(`"${gradlew}" assembleDebug`, { cwd: androidDir, env: { ...process.env } })
  const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  if (!existsSync(apk)) {
    throw new Error('未找到 app-debug.apk')
  }
  const out = join(root, 'app-release-local.apk')
  cpSync(apk, out)
  console.log(`[gha-apk] APK → ${out}`)
  return out
}

writeCapacitorConfig()
ensureCapacitorPackages()
ensureAndroidProject()
patchAndroidManifest()
patchAndroidStyles()
patchMainActivity()
applyIcons()
patchStrings()
buildApk()