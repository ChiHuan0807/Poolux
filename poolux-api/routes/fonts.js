import { Router } from 'express'
import multer from 'multer'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { authMiddleware } from '../middleware/auth.js'
import { getFonts, createFont, deleteFont } from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FONTS_DIR = join(__dirname, '..', 'uploads', 'fonts')

if (!existsSync(FONTS_DIR)) mkdirSync(FONTS_DIR, { recursive: true })

const ALLOWED_EXTS = new Set(['.ttf', '.otf', '.woff2'])

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FONTS_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    const base = file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
    const ts = Date.now()
    cb(null, `${ts}_${base}${ext}`)
  },
})

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTS.has(ext)) cb(null, true)
    else cb(new Error(`不支持的字体格式: ${ext}，仅支持 .ttf .otf .woff2`))
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
})

const router = Router()

// GET /api/fonts - 获取所有字体
router.get('/', (_req, res) => {
  try {
    const fonts = getFonts()
    res.json(fonts.map(f => ({
      ...f,
      url: `/api/uploads/fonts/${f.filename}`,
      is_variable: !!f.is_variable,
    })))
  } catch (err) {
    res.status(500).json({ error: '获取字体列表失败' })
  }
})

// POST /api/fonts/upload - 上传字体（需登录）
router.post('/upload', authMiddleware, upload.single('font'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未选择文件' })
    const { originalname, filename, size } = req.file
    // 尝试从文件名提取 family name 和 style
    const nameNoExt = originalname.replace(/\.[^.]+$/, '')
    // 常见 pattern: "FamilyName-Bold" "FamilyName_Regular" "FamilyName 700"
    const weightMap = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }
    let familyName = nameNoExt, style = 'Regular', weight = 400
    const styleMatch = nameNoExt.match(/[-_\s](thin|extralight|light|regular|medium|semibold|bold|extrabold|black|italic|bolditalic)$/i)
    if (styleMatch) {
      const raw = styleMatch[1].toLowerCase()
      familyName = nameNoExt.slice(0, styleMatch.index ?? nameNoExt.length)
      if (raw === 'italic') { style = 'Italic'; weight = 400 }
      else if (raw === 'bolditalic') { style = 'Bold Italic'; weight = 700 }
      else if (weightMap[raw]) { style = raw.charAt(0).toUpperCase() + raw.slice(1); weight = weightMap[raw] }
    }
    // 纯数字 weight
    const numMatch = nameNoExt.match(/[-_\s](\d{3})$/i)
    if (numMatch) { weight = parseInt(numMatch[1]); familyName = nameNoExt.slice(0, numMatch.index ?? nameNoExt.length); style = String(weight) }

    const isVariable = req.body.is_variable === 'true' || req.body.is_variable === true

    const result = createFont({
      filename, original_name: originalname, family_name: familyName,
      style, weight, is_variable: isVariable, file_size: size,
    })
    res.json({
      id: result.lastInsertRowid,
      filename, original_name: originalname, family_name: familyName,
      style, weight, is_variable: isVariable, file_size: size,
      url: `/api/uploads/fonts/${filename}`,
    })
  } catch (err) {
    res.status(500).json({ error: '上传失败: ' + err.message })
  }
})

// DELETE /api/fonts/:id - 删除字体（需登录）
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const fonts = getFonts()
    const font = fonts.find(f => f.id === parseInt(req.params.id))
    if (!font) return res.status(404).json({ error: '字体不存在' })
    const filePath = join(FONTS_DIR, font.filename)
    try { if (existsSync(filePath)) unlinkSync(filePath) } catch {}
    deleteFont(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: '删除失败' })
  }
})

export default router