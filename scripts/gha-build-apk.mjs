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
  existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync,
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
    android: { allowMixedContent: true },
  }
  writeFileSync(join(root, 'capacitor.config.json'), JSON.stringify(cfg, null, 2))
}

function ensureCapacitorPackages() {
  run('npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 --no-save --no-package-lock')
}

function ensureAndroidProject() {
  if (existsSync(androidDir)) {
    rmSync(androidDir, { recursive: true, force: true })
  }
  run('npx cap add android')
  run('npx cap sync android')
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
      // ImageMagick 不可用时直接拷贝原图
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
applyIcons()
patchStrings()
buildApk()