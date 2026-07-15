import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import {
  existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync, createReadStream,
} from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import { authMiddleware } from '../middleware/auth.js'
import {
  getTemplateById, getFonts,
  createApkBuild, getApkBuildById, getLatestApkBuildByTemplate,
  listApkBuilds, updateApkBuild,
} from '../db.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const router = Router()

const JOBS_DIR = join(__dirname, '..', 'apk-jobs')
const UPLOADS_DIR = join(__dirname, '..', 'uploads')
// 优先仓库 public/dark.svg，部署后回退到 poolux-api/assets
const PUBLIC_DARK_SVG = [
  join(__dirname, '..', '..', 'public', 'dark.svg'),
  join(__dirname, '..', 'assets', 'dark.svg'),
].find((p) => existsSync(p))

mkdirSync(JOBS_DIR, { recursive: true })

const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = join(JOBS_DIR, req.params.id)
      mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname.endsWith('.apk') ? file.originalname : 'app-debug.apk')
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
})

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
  if (!url || typeof url !== 'string') return null
  let rel = ''
  if (url.includes('/api/uploads/')) rel = url.split('/api/uploads/')[1]
  else if (url.includes('/uploads/')) rel = url.split('/uploads/').pop()
  if (!rel) return null
  // strip query
  rel = rel.split('?')[0]
  const full = join(UPLOADS_DIR, rel)
  return existsSync(full) ? full : null
}

async function downloadToFile(url, dest) {
  const local = resolveLocalUpload(url)
  if (local) {
    copyFileSync(local, dest)
    return
  }
  const abs = /^https?:\/\//i.test(url) ? url : null
  if (!abs) throw new Error(`无法解析资源: ${url}`)
  const res = await fetch(abs)
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
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
    generated_at: new Date().toISOString(),
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

async function triggerGithubActions(payload) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const repo = process.env.GITHUB_REPO // owner/name
  if (!token || !repo) {
    throw new Error('未配置 GITHUB_TOKEN / GITHUB_REPO，无法触发 Actions 编译')
  }
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

    const template = getTemplateById(templateId)
    if (!template) return res.status(404).json({ error: '模板不存在' })

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
          finished_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
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
router.get('/', authMiddleware, (req, res) => {
  const tid = req.query.template_id
  if (tid) {
    const latest = getLatestApkBuildByTemplate(Number(tid))
    return res.json(latest ? [latest] : [])
  }
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
  if (!req.query.token || req.query.token !== job.bundle_token) {
    return res.status(403).json({ error: 'token 无效' })
  }
  const archivePath = join(JOBS_DIR, job.id, 'bundle.tar.gz')
  if (!existsSync(archivePath)) return res.status(404).json({ error: 'bundle 尚未就绪' })
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="bundle-${job.id}.tar.gz"`)
  createReadStream(archivePath).pipe(res)
})

// POST /api/apk-builds/:id/complete  (GHA 回调，multipart file=apk)
router.post('/:id/complete', apkUpload.single('file'), (req, res) => {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  const token = req.headers['x-callback-token'] || req.body?.callback_token
  if (!token || token !== job.callback_token) {
    return res.status(403).json({ error: 'callback token 无效' })
  }
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
    finished_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  })
  res.json({ ok: true })
})

// POST /api/apk-builds/:id/fail
router.post('/:id/fail', (req, res) => {
  const job = getApkBuildById(req.params.id)
  if (!job) return res.status(404).json({ error: '任务不存在' })
  const token = req.headers['x-callback-token'] || req.body?.callback_token
  if (!token || token !== job.callback_token) {
    return res.status(403).json({ error: 'callback token 无效' })
  }
  updateApkBuild(job.id, {
    status: 'failed',
    error: req.body?.error || 'GitHub Actions 编译失败',
    finished_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
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