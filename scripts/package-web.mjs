// 生成可直接上传到宝塔「网站根目录」解压的前端压缩包：dist-server/poolux-web.zip。
//
// 为什么也打成 zip：宝塔文件管理器一次传 60+ 个小文件很麻烦，传一个包再解压即可。
// dist/ 里只有前端文件（没有 poolux-api、没有 data.db），所以覆盖解压到网站根目录是安全的。
// 用法：npm run build 之后执行 npm run package:web
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { assertNoForbidden, findBackslashEntries, listZipNames } from './lib-zip.mjs'
import { pruneDebugArtifacts } from './lib-dist-prune.mjs'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'dist')
const OUT_DIR = join(ROOT, 'dist-server')
const ZIP = join(OUT_DIR, 'poolux-web.zip')

// 前端包里不该出现的东西：后端目录、数据库、上传目录、密钥
const FORBIDDEN = ['poolux-api', 'data.db', 'data.db-wal', 'data.db-shm', 'uploads', 'apk-jobs', '.env']

if (!existsSync(SRC)) {
  console.error('[package-web] 找不到 dist/，请先执行 npm run build')
  process.exit(1)
}

// 单独跑 npm run package:web 时也要保证干净：把 public/ 里带过来的本机调试页删掉
pruneDebugArtifacts(SRC)

const topLevel = readdirSync(SRC)
if (topLevel.length === 0) {
  console.error('[package-web] dist/ 是空的，请先执行 npm run build')
  process.exit(1)
}

// 打包前先拦一道：dist/ 里出现这些说明构建流程串了，直接停下不产出包
assertNoForbidden([...topLevel.map((n) => `${n}/`), ...topLevel], FORBIDDEN, 'package-web')

mkdirSync(OUT_DIR, { recursive: true })
// 旧包必须真正删掉：Windows + Node 24 上 rmSync 会静默失败，改用 unlinkSync
if (existsSync(ZIP)) unlinkSync(ZIP)

console.log('[package-web] 正在压缩…')
try {
  execFileSync('tar', ['-a', '-cf', ZIP, '-C', SRC, ...topLevel], { stdio: 'inherit' })
} catch (err) {
  console.error(`[package-web] tar 生成 zip 失败：${err.message}`)
  process.exit(1)
}

// 校验：条目分隔符必须是 '/'，否则 Linux 上解压会得到一堆怪文件名
const names = listZipNames(ZIP)
const backslash = findBackslashEntries(names)
if (backslash.length > 0) {
  console.error(
    `[package-web] 压缩包条目用了反斜杠（${backslash.length} 个），Linux 解压会出错：\n  ${backslash.slice(0, 5).join('\n  ')}`,
  )
  process.exit(1)
}

const mb = (statSync(ZIP).size / 1024 / 1024).toFixed(2)
console.log(`[package-web] 完成 → ${ZIP}（${mb} MB，${names.length} 个条目，校验通过）`)
