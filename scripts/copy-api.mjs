// 把 poolux-api 的「代码」复制到 dist-server/poolux-api，供部署使用。
//
// 关键点：数据（数据库 / 上传文件 / 打包任务）和 .env 绝不进包。
// 部署时用这个产物覆盖服务器，服务端已有的数据不会被覆盖，也就不会丢。
//
// 为什么放在 dist-server 而不是 dist：
//   dist/ 是「整包上传到网站根目录」的前端产物。以前后端代码也放在 dist/poolux-api，
//   一旦有人把 dist 里的内容整体覆盖上去，服务器上的 poolux-api（含 data.db、uploads）
//   就会被一起替换掉。现在 dist/ 里只有前端文件，覆盖 dist 永远碰不到服务端数据。
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { copyDirRecursive, removeTree } from './lib-copy.mjs'

const ROOT = join(import.meta.dirname, '..')
export const SRC = join(ROOT, 'poolux-api')
export const DEST = join(ROOT, 'dist-server', 'poolux-api')

// 这些是「服务端自己的数据 / 环境配置」，任何情况下都不要上传覆盖
const EXCLUDE = new Set([
  'node_modules',
  'uploads',          // 上传的图片、字体
  'apk-jobs',         // APK 打包任务与产物
  'data.db',          // SQLite 主库
  'data.db-wal',      // SQLite WAL（漏传/误传会导致数据库损坏）
  'data.db-shm',
  '.env',             // 服务器密钥（GITHUB_TOKEN 等）
  'package-lock.json',
])

// 这些一旦混入部署包就会覆盖服务器数据或泄露密钥，必须直接报错
const FORBIDDEN_IN_PACKAGE = ['.env', 'data.db', 'data.db-wal', 'data.db-shm', 'uploads', 'apk-jobs']

// 本地临时脚本/调试转储没有任何部署价值，从产物里剔除，避免把调试代码和聊天记录转到服务器。
// 两种命名都要认：项目根目录用的是 `.tmp-*`，而 poolux-api/ 里用的是 `tmp-*`
// （只认前一种时，tmp-users.cjs、tmp-hist.txt 这类会跟着上传）。
function isTempArtifact(name) {
  return name.startsWith('.tmp-') || name.startsWith('tmp-')
}

function pruneTempFiles(dir) {
  let removed = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) removed += pruneTempFiles(p)
    else if (isTempArtifact(entry.name)) { unlinkSync(p); removed += 1 }
  }
  return removed
}

// 递归检查是否混入了不能部署的东西；混入就直接报错，不产出包
function assertClean(dir) {
  const found = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (FORBIDDEN_IN_PACKAGE.includes(entry.name)) found.push(join(d, entry.name))
      if (entry.isDirectory()) walk(join(d, entry.name))
    }
  }
  walk(dir)
  if (found.length > 0) {
    throw new Error(
      `部署包里混入了服务端数据/密钥：\n  ${found.join('\n  ')}\n` +
      '请手动删除 dist-server/poolux-api 后重试（这些文件不能上传，否则会覆盖服务器数据）。',
    )
  }
}

export function copyApi() {
  removeTree(DEST)
  mkdirSync(DEST, { recursive: true })
  const n = copyDirRecursive(SRC, DEST, EXCLUDE)
  const pruned = pruneTempFiles(DEST)
  assertClean(DEST)
  console.log(
    `[copy-api] poolux-api → dist-server/poolux-api（${n - pruned} 个文件，不含 data.db / uploads / .env` +
    `${pruned > 0 ? `，已剔除 ${pruned} 个 .tmp-* 临时脚本` : ''}）`,
  )
  return DEST
}

// 直接用 node scripts/copy-api.mjs 调用时执行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyApi()
}
