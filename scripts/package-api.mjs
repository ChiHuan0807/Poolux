// 生成可直接上传到宝塔解压的后端压缩包：dist-server/poolux-api.zip（只含代码）。
// 放在 dist-server 而不是 dist：dist 只装前端文件，整包覆盖网站根目录时不会碰到后端与数据。
// 用法：npm run package:api
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { copyApi, DEST } from './copy-api.mjs'
import { findBackslashEntries, listZipNames } from './lib-zip.mjs'

const ROOT = join(import.meta.dirname, '..')
const ZIP = join(ROOT, 'dist-server', 'poolux-api.zip')

// 部署包里绝对不允许出现的东西（混进去就会覆盖服务器数据或泄露密钥）
const FORBIDDEN = ['.env', 'data.db', 'data.db-wal', 'data.db-shm', 'uploads', 'apk-jobs']

copyApi()

// 写入构建标识：服务启动后由 /api/health 返回，用来确认线上跑的到底是哪一版代码。
// 每个「需要在线上确认是否已生效」的修复在这里登记一个标记，一旦发现线上还是旧行为，
// 不用猜是「代码没上传」还是「真有新 bug」。
const FEATURES = [
  'webp-target-name', // 上传 webp 图片不再因为「转码目标名和源文件同名」而报解析失败
]

const buildId = new Date().toLocaleString('sv-SE').slice(0, 19)
writeFileSync(
  join(DEST, 'build-info.json'),
  `${JSON.stringify({ id: buildId, features: FEATURES }, null, 2)}\n`,
  'utf8',
)
console.log(`[package-api] 构建标识: ${buildId}（${FEATURES.join('、')}）`)

if (existsSync(ZIP)) rmSync(ZIP, { force: true })

const topLevel = readdirSync(DEST)
if (topLevel.length === 0) {
  console.error('[package-api] dist-server/poolux-api 是空的，打包中止')
  process.exit(1)
}

let produced = ''
console.log('[package-api] 正在压缩…')

// 优先用 tar 生成 zip：条目分隔符是 '/'，上传到 Linux 解压正常。
// 不要用 PowerShell 的 Compress-Archive，它写的是 '\'，在 Linux 上会解出一堆怪文件名。
try {
  execFileSync('tar', ['-a', '-cf', ZIP, '-C', DEST, ...topLevel], { stdio: 'inherit' })
  produced = ZIP
} catch (err) {
  console.warn(`[package-api] tar 生成 zip 失败（${err.message}），改用 zip/tar.gz`)
}

if (!produced) {
  try {
    execFileSync('zip', ['-qr', ZIP, ...topLevel], { cwd: DEST, stdio: 'inherit' })
    produced = ZIP
  } catch {
    const tgz = ZIP.replace(/\.zip$/, '.tar.gz')
    execFileSync('tar', ['-czf', tgz, '-C', DEST, '.'], { stdio: 'inherit' })
    produced = tgz
  }
}

// ── 校验：不能有反斜杠分隔符，不能混入数据/密钥文件 ──
if (produced.endsWith('.zip')) {
  const names = listZipNames(produced)
  const backslash = findBackslashEntries(names)
  if (backslash.length > 0) {
    console.error(
      `[package-api] 压缩包条目用了反斜杠（${backslash.length} 个），Linux 解压会出错：\n  ${backslash.slice(0, 5).join('\n  ')}`,
    )
    process.exit(1)
  }
  const bad = names.filter((n) => FORBIDDEN.includes(n.split('/').pop()) || FORBIDDEN.some((f) => n.startsWith(`${f}/`)))
  if (bad.length > 0) {
    console.error(`[package-api] 压缩包里混入了服务端数据/密钥，已中止：\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  const mb = (statSync(produced).size / 1024 / 1024).toFixed(2)
  console.log(`[package-api] 完成 → ${produced}（${mb} MB，${names.length} 个条目，校验通过）`)
} else {
  console.log(`[package-api] 完成 → ${produced}（不含 data.db / uploads / .env）`)
}
