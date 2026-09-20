import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import {
  existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync, createReadStream,
} from 'fs'
import { execFile } from 'child_process'
import { lookup } from 'dns/promises'
import { promisify } from 'util'
import sharp from 'sharp'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTemplateById, getFonts,
  createApkBuild, getApkBuildById, getLatestApkBuildByTemplate,
  listApkBuilds, updateApkBuild, getApkBuildsByTemplate,
} from '../db.js'
import { pruneTemplateApkVersions } from '../apk-retention.js'
import { JOBS_DIR, UPLOADS_DIR, uploadFilePath, safeJoinWithin } from '../paths.js'
import { hasAllowedExt, safeUploadName } from '../upload-files.js'
import { sanitizeTemplateRow } from '../svg-safety.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const router = Router()

// JOBS_DIR / UPLOADS_DIR 由 paths.js 解析（可用环境变量指到网站目录之外）
// 优先仓库 public/dark.svg，部署后回退到 poolux-api/assets
const PUBLIC_DARK_SVG = [
  join(__dirname, '..', '..', 'public', 'dark.svg'),
  join(__dirname, '..', 'assets', 'dark.svg'),
].find((p) => existsSync(p))

/** 中国大陆墙钟时间（Asia/Shanghai），格式 YYYY-MM-DD HH:mm:ss，避免 UTC ISO 被前端当本地时间误读 */
function formatChinaDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace('T', ' ')
}

mkdirSync(JOBS_DIR, { recursive: true })

const APK_EXTS = ['.apk']

const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      // 任务 ID 来自 URL，必须做「目录内」校验，否则 ../ 可以把文件写到 JOBS_DIR 之外
      const dir = safeJoinWithin(JOBS_DIR, req.params.id)
      if (!dir) return cb(new Error('任务 ID 非法'))
      mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    // 文件名由服务端生成：originalname 里的 ../ 会被原样拼进路径，形成任意目录写入
    filename: (_req, file, cb) => cb(null, safeUploadName('apk-', file.originalname, APK_EXTS, '.apk')),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!hasAllowedExt(file.originalname, APK_EXTS)) return cb(new Error('仅支持 .apk 文件'))
    cb(null, true)
  },
})

/** 常量时间比较 token，避免通过响应耗时逐字节猜出回调凭证 */
function tokenEquals(provided, expected) {
  const expectedBuf = Buffer.from(String(expected || ''))
  const providedBuf = Buffer.from(String(provided || ''))
  if (expectedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false
  return crypto.timingSafeEqual(providedBuf, expectedBuf)
}

/**
 * 回调凭证前置校验，必须排在 multer 之前。
 *
 * 裸的 `apkUpload.single('file')` 会先把 multipart 整体落到磁盘、再执行 token 校验，
 * 于是任何人只要 POST 一个 200MB 的 body 就能白写一份文件（未授权磁盘 DoS）。
 * 凭证统一走 `X-Callback-Token` 请求头（GitHub Actions 工作流就是这么发的），
 * 头校验放在 multer 之前，未通过则连 body 都不读。
 */
function requireCallbackToken(req, res, next) {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  if (!tokenEquals(req.headers['x-callback-token'], job.callback_token)) {
    return res.status(403).json({ error: 'callback token 无效' })
  }
  req.apkJob = job
  next()
}

function publicBaseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.SITE_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '')
}

function packageNameFor(templateId) {
  const n = String(templateId).replace(/[^0-9a-zA-Z]/g, '') || '0'
  return `top.poolux.album.t${n}`
}

function collectUrls(template) {
  const urls = new Set()
  if (template.preview_image) urls.add(template.preview_image)
  for (const dev of template.devices || []) {
    for (const layer of dev.layers || []) {
      if (layer.image_url) urls.add(layer.image_url)
      if (layer.background) {
        // ignore pure css colors
      }
    }
  }
  return [...urls]
}

function resolveLocalUpload(url) {
  const full = uploadFilePath(url)
  return full && existsSync(full) ? full : null
}

/**
 * SSRF 防护：判断主机名是不是「不该由服务端主动去访问」的地址。
 * 打包时会按图层里的 image_url 去下载图片，如果那里写了内网地址，
 * 服务器就会替攻击者去访问内网（云厂商元数据接口 169.254.169.254 尤其危险）。
 */
function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some(n => n > 255)) return true
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true          // 链路本地 / 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true // 私有段
    if (a === 192 && b === 168) return true          // 私有段
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  if (host === '::1' || host === '::') return true
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true  // IPv6 唯一本地地址
  if (/^fe80:/i.test(host)) return true              // IPv6 链路本地
  if (host.startsWith('::ffff:')) return isBlockedHost(host.slice('::ffff:'.length))
  return false
}

/**
 * DNS 层二次校验：hostname 是公网域名，但完全可能解析到内网地址
 * （内网域名、或 DNS rebinding）。解析后逐个地址复用 isBlockedHost 判定。
 * 注意 lookup 只接受主机名，IP 字面量在上一步已经拦过。
 */
async function assertHostResolvesPublic(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '')
  if (!host) throw new Error('资源地址缺少主机名')
  let records = []
  try {
    records = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error(`无法解析主机名: ${host}`)
  }
  if (records.length === 0) throw new Error(`无法解析主机名: ${host}`)
  for (const record of records) {
    if (isBlockedHost(record.address)) {
      throw new Error(`出于安全考虑，拒绝下载解析到内网的地址: ${host} → ${record.address}`)
    }
  }
}

const MAX_ASSET_REDIRECTS = 3

/**
 * 带校验的外链下载。
 *
 * 关键点：默认的 fetch 会自动跟随 3xx，于是「公网地址 → 302 到 169.254.169.254」
 * 就能绕过 isBlockedHost（请求已经在 fetch 内部发出）。这里改成手动处理重定向，
 * 每一跳都重新做协议、内网地址与 DNS 校验，超过上限直接失败。
 */
async function fetchExternalSafely(url) {
  let current = null
  try { current = new URL(String(url)) } catch { throw new Error(`无法解析资源: ${url}`) }

  for (let hop = 0; hop <= MAX_ASSET_REDIRECTS; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`不支持的资源协议（${current.protocol}）: ${url}`)
    }
    if (isBlockedHost(current.hostname)) {
      throw new Error(`出于安全考虑，拒绝下载内网地址: ${current.hostname}`)
    }
    await assertHostResolvesPublic(current.hostname)

    const res = await fetch(current.href, { redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      // 丢弃重定向响应体，避免连接悬挂
      try { await res.arrayBuffer() } catch { /* ignore */ }
      if (!location) throw new Error(`重定向缺少 Location: ${current.href}`)
      try {
        current = new URL(location, current)
      } catch {
        throw new Error(`重定向地址无效: ${location}`)
      }
      continue
    }
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
    return res
  }
  throw new Error(`重定向次数过多: ${url}`)
}

async function downloadToFile(url, dest) {
  const local = resolveLocalUpload(url)
  if (local) {
    copyFileSync(local, dest)
    return
  }
  const res = await fetchExternalSafely(url)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
}

function rewriteTemplateUrls(template, map) {
  const next = JSON.parse(JSON.stringify(template))
  if (next.preview_image && map[next.preview_image]) {
    next.preview_image = map[next.preview_image]
  }
  for (const dev of next.devices || []) {
    for (const layer of dev.layers || []) {
      if (layer.image_url && map[layer.image_url]) {
        layer.image_url = map[layer.image_url]
      }
    }
  }
  return next
}

async function packBundleArchive(srcDir, outFile) {
  // Linux 服务器用 tar.gz（几乎必装）；Windows 开发机同样可用 tar
  if (existsSync(outFile)) rmSync(outFile, { force: true })
  try {
    await execFileAsync('tar', ['-czf', outFile, '-C', srcDir, '.'])
    return
  } catch (e) {
    throw new Error(`打包 bundle 失败，请安装 tar: ${e.message}`)
  }
}

async function prepareBundle(jobId, template) {
  const jobDir = join(JOBS_DIR, jobId)
  const bundleDir = join(jobDir, 'bundle')
  const assetsDir = join(bundleDir, 'assets')
  mkdirSync(assetsDir, { recursive: true })

  const urlMap = {}
  const urls = collectUrls(template)
  let i = 0
  for (const url of urls) {
    i += 1
    const ext = extname(url.split('?')[0]) || '.bin'
    const safeExt = ext.length <= 8 ? ext : '.bin'
    const name = `asset-${i}${safeExt}`
    const dest = join(assetsDir, name)
    try {
      await downloadToFile(url, dest)
      urlMap[url] = `./offline/assets/${name}`
    } catch (err) {
      console.error('[apk] asset failed', url, err.message)
    }
  }

  // 字体：把模板用到的字体拷进 assets
  const families = new Set()
  for (const dev of template.devices || []) {
    for (const layer of dev.layers || []) {
      if (layer.type === 'text' && layer.font_family) families.add(layer.font_family)
    }
  }
  const allFonts = getFonts()
  const offlineFonts = []
  for (const f of allFonts) {
    const name = f.family_name || f.original_name
    if (families.size > 0 && !families.has(name)) continue
    const src = join(UPLOADS_DIR, 'fonts', f.filename)
    const alt = join(UPLOADS_DIR, f.filename)
    const file = existsSync(src) ? src : (existsSync(alt) ? alt : null)
    if (!file) continue
    const outName = `font-${f.id}${extname(f.filename) || '.ttf'}`
    copyFileSync(file, join(assetsDir, outName))
    offlineFonts.push({
      ...f,
      filename: outName,
      url: `./offline/assets/${outName}`,
    })
  }

  const offlineTemplate = rewriteTemplateUrls(template, urlMap)
  writeFileSync(join(bundleDir, 'template.json'), JSON.stringify(offlineTemplate, null, 2))
  writeFileSync(join(bundleDir, 'fonts.json'), JSON.stringify(offlineFonts, null, 2))
  writeFileSync(join(bundleDir, 'meta.json'), JSON.stringify({
    template_id: template.id,
    template_name: template.name,
    package_name: packageNameFor(template.id),
    generated_at: formatChinaDateTime(),
  }, null, 2))

  // 图标：dark.svg → png（APK 启动图标）
  if (PUBLIC_DARK_SVG && existsSync(PUBLIC_DARK_SVG)) {
    await sharp(PUBLIC_DARK_SVG).resize(512, 512).png().toFile(join(bundleDir, 'icon.png'))
    copyFileSync(PUBLIC_DARK_SVG, join(bundleDir, 'icon.svg'))
  }

  const archivePath = join(jobDir, 'bundle.tar.gz')
  await packBundleArchive(bundleDir, archivePath)
  return archivePath
}

function getGithubConfig() {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  const repo = (process.env.GITHUB_REPO || '').trim()
  const missing = [
    !token ? 'GITHUB_TOKEN（或 GH_TOKEN）' : null,
    !repo ? 'GITHUB_REPO' : null,
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `未配置 ${missing.join('、')}，无法触发 Actions 编译。请写入 poolux-api/.env 后重启 API（见 .env.example）`,
    )
  }
  const repoParts = repo.split('/')
  if (
    repoParts.length !== 2 ||
    !repoParts[0] ||
    !repoParts[1] ||
    repo.includes(' ') ||
    repo.includes('\t') ||
    repo.includes('\n')
  ) {
    throw new Error('GITHUB_REPO 格式无效，应为 owner/name（不要填写仓库 URL）')
  }

  return { token, repo }
}

async function triggerGithubActions(payload) {
  const { token, repo } = getGithubConfig()
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'poolux-apk-builder',
    },
    body: JSON.stringify({
      event_type: 'build-template-apk',
      client_payload: payload,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub dispatch 失败 (${res.status}): ${text}`)
  }
}

// POST /api/apk-builds  { template_id }
router.post('/', authMiddleware, async (req, res) => {
  try {
    const templateId = Number(req.body.template_id)
    if (!templateId) return res.status(400).json({ error: '缺少 template_id' })

    const template = sanitizeTemplateRow(getTemplateById(templateId))
    if (!template) return res.status(404).json({ error: '模板不存在' })

    // 配置问题应在创建任务前返回，避免留下无法执行的失败任务
    try {
      getGithubConfig()
    } catch (err) {
      return res.status(503).json({ error: err.message })
    }

    // 同模板若正在打包，拒绝重复
    const latest = getLatestApkBuildByTemplate(templateId)
    if (latest && (latest.status === 'queued' || latest.status === 'building' || latest.status === 'preparing')) {
      return res.status(409).json({ error: '该模板正在打包中', job: latest })
    }

    const id = crypto.randomBytes(12).toString('hex')
    const bundleToken = crypto.randomBytes(24).toString('hex')
    const callbackToken = crypto.randomBytes(24).toString('hex')
    const pkg = packageNameFor(templateId)

    createApkBuild({
      id,
      template_id: templateId,
      template_name: template.name,
      package_name: pkg,
      status: 'preparing',
      bundle_token: bundleToken,
      callback_token: callbackToken,
    })

    // 异步准备 + 触发，避免阻塞
    ;(async () => {
      try {
        await prepareBundle(id, template)
        updateApkBuild(id, { status: 'building' })

        const base = publicBaseUrl(req)
        await triggerGithubActions({
          job_id: id,
          template_id: String(templateId),
          template_name: template.name,
          package_name: pkg,
          app_name: template.name || `POOLUX-${templateId}`,
          bundle_url: `${base}/api/apk-builds/${id}/bundle?token=${bundleToken}`,
          callback_url: `${base}/api/apk-builds/${id}/complete`,
          fail_url: `${base}/api/apk-builds/${id}/fail`,
          callback_token: callbackToken,
        })
      } catch (err) {
        console.error('[apk] job failed', id, err)
        updateApkBuild(id, {
          status: 'failed',
          error: err.message || String(err),
          finished_at: formatChinaDateTime(),
        })
      }
    })()

    res.json({
      ok: true,
      id,
      package_name: pkg,
      status: 'preparing',
      message: '已创建打包任务，将由 GitHub Actions 编译',
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/apk-builds?template_id=
// 带 template_id 时返回该模板的全部历史版本（新的在前，服务端每个模板只保留最近几个），
// 前端取 [0] 当最新任务，并可用后面的「已就绪」版本提供上一版下载。
router.get('/', authMiddleware, (req, res) => {
  const tid = req.query.template_id
  if (tid) return res.json(getApkBuildsByTemplate(Number(tid)))
  res.json(listApkBuilds(100))
})

// GET /api/apk-builds/:id
router.get('/:id', authMiddleware, (req, res) => {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  res.json(job)
})

// GET /api/apk-builds/:id/bundle?token=
router.get('/:id/bundle', (req, res) => {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  if (!tokenEquals(req.query.token, job.bundle_token)) {
    return res.status(403).json({ error: 'token 无效' })
  }
  const archivePath = join(JOBS_DIR, job.id, 'bundle.tar.gz')
  if (!existsSync(archivePath)) return res.status(404).json({ error: 'bundle 尚未就绪' })
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="bundle-${job.id}.tar.gz"`)
  createReadStream(archivePath).pipe(res)
})

// POST /api/apk-builds/:id/complete  (GHA 回调，multipart file=apk)
// requireCallbackToken 必须在 multer 之前：否则未授权的 200MB 请求会先落盘再被拒绝
router.post('/:id/complete', requireCallbackToken, apkUpload.single('file'), (req, res) => {
  const job = req.apkJob
  if (!req.file) return res.status(400).json({ error: '未上传 apk' })

  const finalName = `template-${job.template_id}.apk`
  const finalPath = join(JOBS_DIR, job.id, finalName)
  try {
    if (req.file.path !== finalPath) {
      copyFileSync(req.file.path, finalPath)
      try { rmSync(req.file.path, { force: true }) } catch {}
    }
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  updateApkBuild(job.id, {
    status: 'ready',
    apk_filename: finalName,
    error: '',
    finished_at: formatChinaDateTime(),
  })

  // 新版本已就绪，顺手清掉更早的版本（每个模板只留最近 APK_KEEP_VERSIONS 个）
  try {
    const removed = pruneTemplateApkVersions(job.template_id)
    if (removed.length > 0) console.log('[apk] 已清理旧版本:', removed.join(', '))
  } catch (err) {
    // 清理失败不该影响「打包成功」这个结果
    console.error('[apk] 清理旧版本失败:', err.message)
  }

  res.json({ ok: true })
})

// POST /api/apk-builds/:id/fail
router.post('/:id/fail', requireCallbackToken, (req, res) => {
  updateApkBuild(req.apkJob.id, {
    status: 'failed',
    error: req.body?.error || 'GitHub Actions 编译失败',
    finished_at: formatChinaDateTime(),
  })
  res.json({ ok: true })
})

// GET /api/apk-builds/:id/download
router.get('/:id/download', authMiddleware, (req, res) => {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  if (job.status !== 'ready' || !job.apk_filename) {
    return res.status(400).json({ error: 'APK 尚未就绪' })
  }
  const filePath = join(JOBS_DIR, job.id, job.apk_filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: '文件不存在' })
  res.download(filePath, `${job.template_name || 'template'}-${job.template_id}.apk`)
})

export default router