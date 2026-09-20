// 紧跟 vite build 执行：把 public/ 里的本机调试页从 dist/ 清掉。
// 这样 dist/ 本身（以及由它打出的 poolux-web.zip）都能直接上传，
// 不会把 bfcheck.html / bftest.html / tmp-*.png 这类探针页带到线上。
import { join } from 'path'
import { pruneDebugArtifacts } from './lib-dist-prune.mjs'

const ROOT = join(import.meta.dirname, '..')
const removed = pruneDebugArtifacts(join(ROOT, 'dist'))
if (removed.length === 0) {
  console.log('[prune-dist] dist/ 无需清理')
}
