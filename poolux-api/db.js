import Database from 'better-sqlite3'
import crypto from 'crypto'
import { DB_FILE } from './paths.js'

const db = new Database(DB_FILE)

// WAL mode for better concurrent performance
db.pragma('journal_mode = WAL')

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    banner TEXT DEFAULT '',
    author TEXT DEFAULT '',
    devices TEXT DEFAULT '[]',
    paid INTEGER DEFAULT 0,
    purchase_link TEXT DEFAULT '',
    device_options TEXT DEFAULT '[]',
    hidden INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    default_author TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// 兼容旧数据库：补充列
try { db.exec(`ALTER TABLE resources ADD COLUMN purchase_link TEXT DEFAULT ''`) } catch { /* 已存在 */ }
try { db.exec(`ALTER TABLE resources ADD COLUMN hidden INTEGER DEFAULT 0`) } catch { /* 已存在 */ }
try { db.exec(`ALTER TABLE users ADD COLUMN default_author TEXT DEFAULT ''`) } catch { /* 已存在 */ }
// 记录密码最后一次修改时间：改密码后，之前签发的 token 立即失效
try { db.exec(`ALTER TABLE users ADD COLUMN password_changed_at INTEGER DEFAULT 0`) } catch { /* 已存在 */ }

// 相册表盘图片
db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    watch_face_name TEXT DEFAULT '',
    watch_face_model TEXT DEFAULT '',
    character_name TEXT DEFAULT '',
    device TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)
try { db.exec(`ALTER TABLE gallery_images ADD COLUMN device TEXT DEFAULT ''`) } catch { /* 已存在 */ }

// 首页作品图片
db.exec(`
  CREATE TABLE IF NOT EXISTS works_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// ── 密码哈希 ──
// 旧版本用固定的 10000 次 PBKDF2 且明文比较，强度不足且可能被时序侧信道猜解。
// 现在把迭代次数写进哈希串（`pbkdf2:sha512:<iterations>:<hex>`），
// 老数据（纯 hex）仍能登录，登录成功后自动升级为新格式。
const PBKDF2_ITERATIONS = 210000
const PBKDF2_LEGACY_ITERATIONS = 10000
const PBKDF2_KEYLEN = 64
const PBKDF2_DIGEST = 'sha512'
const HASH_PREFIX = 'pbkdf2:sha512:'

function derive(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password), String(salt), iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

/** 生成新格式哈希：pbkdf2:sha512:<iterations>:<hex> */
function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  return `${HASH_PREFIX}${iterations}:${derive(password, salt, iterations).toString('hex')}`
}

/** 解析数据库里的哈希：返回 { iterations, expected(hex), legacy }；无法解析时返回 null */
function parseStoredHash(stored) {
  const value = String(stored || '')
  if (value.startsWith(HASH_PREFIX)) {
    const rest = value.slice(HASH_PREFIX.length)
    const sep = rest.indexOf(':')
    if (sep > 0) {
      const iterations = Number(rest.slice(0, sep))
      const hash = rest.slice(sep + 1)
      if (Number.isFinite(iterations) && iterations > 0 && /^[0-9a-f]+$/i.test(hash)) {
        return { iterations, expected: hash, legacy: false }
      }
    }
    return null
  }
  // 旧格式：纯 hex，迭代次数为历史值
  if (/^[0-9a-f]+$/i.test(value)) {
    return { iterations: PBKDF2_LEGACY_ITERATIONS, expected: value, legacy: true }
  }
  return null
}

/** 固定长度常量时间比较，避免通过响应耗时逐位猜出哈希 */
function hashEquals(aHex, bHex) {
  let a, b
  try {
    a = Buffer.from(String(aHex), 'hex')
    b = Buffer.from(String(bHex), 'hex')
  } catch {
    return false
  }
  if (a.length === 0 || a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// 初始化默认管理员账号。
// 旧版这里用的是写死在源码里的口令（admin / poolux2026），而源码是公开的，
// 等于给每个部署都留了一把公开的万能钥匙——扫描器直接用这个口令就能接管后台。
// 现在改为：
//   * 配了 ADMIN_INITIAL_PASSWORD（长度足够）→ 用它
//   * 没配 → 随机生成一个强口令，只在首次创建的日志里打印一次
const MAX_PASSWORD_LENGTH = 200
const MIN_PASSWORD_LENGTH = 8
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
if (!existingAdmin) {
  const configured = (process.env.ADMIN_INITIAL_PASSWORD || '').trim()
  const useConfigured = configured.length >= MIN_PASSWORD_LENGTH && configured.length <= MAX_PASSWORD_LENGTH
  const initialPassword = useConfigured ? configured : crypto.randomBytes(12).toString('base64url')
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(initialPassword, salt)
  db.prepare("INSERT INTO users (username, password_hash, salt, password_changed_at) VALUES (?, ?, ?, strftime('%s','now'))").run('admin', hash, salt)
  if (useConfigured) {
    console.warn('[db] 已按 ADMIN_INITIAL_PASSWORD 创建管理员账号 admin，请登录后立即改成新密码。')
  } else {
    console.warn(
      `\n${'='.repeat(64)}\n` +
      '[db] 已创建管理员账号（随机口令，仅本次打印，请立刻抄下来）：\n' +
      '       用户名：admin\n' +
      `       密码　：${initialPassword}\n` +
      '[db] 登录后请到后台「设置 → 修改密码」改成自己的强密码。\n' +
      '[db] 想自己指定初始口令，可在 poolux-api/.env 里设置 ADMIN_INITIAL_PASSWORD。\n' +
      `${'='.repeat(64)}\n`,
    )
  }
}

function parseRow(r) {
  // banner 兼容旧数据（单个 URL 字符串）和新数据（JSON 数组）
  let banners = []
  if (r.banner) {
    try {
      const parsed = JSON.parse(r.banner)
      banners = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      // 旧数据：直接是 URL 字符串
      banners = [r.banner]
    }
  }
  return {
    ...r,
    paid: !!r.paid,
    hidden: !!r.hidden,
    devices: JSON.parse(r.devices || '[]'),
    device_options: JSON.parse(r.device_options || '[]'),
    banners,
  }
}

// 导出 helper
export function verifyPassword(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) {
    // 账号不存在时也做一次等价开销的哈希，避免用响应耗时枚举用户名
    derive(password, 'missing-user-placeholder-salt', PBKDF2_ITERATIONS)
    return null
  }
  const parsed = parseStoredHash(user.password_hash)
  if (!parsed) return null
  const computed = derive(password, user.salt, parsed.iterations).toString('hex')
  if (!hashEquals(computed, parsed.expected)) return null
  // 老格式登录成功后顺手升级到新格式（对用户无感）
  if (parsed.legacy) {
    try {
      const salt = crypto.randomBytes(16).toString('hex')
      db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
        .run(hashPassword(password, salt), salt, user.id)
    } catch { /* 升级失败不影响本次登录 */ }
  }
  return { id: user.id, username: user.username, default_author: user.default_author || '' }
}

export function getUserById(id) {
  const user = db.prepare('SELECT id, username, default_author, password_changed_at FROM users WHERE id = ?').get(id)
  return user || null
}

export function getUsers() {
  return db.prepare('SELECT id, username, default_author, created_at FROM users').all()
}

export function createUser(username, password, defaultAuthor = '') {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(password, salt)
  return db.prepare("INSERT INTO users (username, password_hash, salt, default_author, password_changed_at) VALUES (?, ?, ?, ?, strftime('%s','now'))").run(username, hash, salt, defaultAuthor)
}

export function updateDefaultAuthor(userId, defaultAuthor) {
  return db.prepare('UPDATE users SET default_author = ? WHERE id = ?').run(defaultAuthor, userId)
}

export function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function changePassword(userId, newPassword) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(newPassword, salt)
  // 同时刷新 password_changed_at：改密后旧 token（可能已泄露）立即失效
  return db.prepare("UPDATE users SET password_hash = ?, salt = ?, password_changed_at = strftime('%s','now') WHERE id = ?").run(hash, salt, userId)
}

export function changeUsername(userId, newUsername) {
  return db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId)
}

// 管理后台：所有资源（含隐藏）
export function getAllResources() {
  return db.prepare('SELECT * FROM resources ORDER BY created_at DESC').all().map(parseRow)
}

// 公开页面：仅可见资源
export function getVisibleResources() {
  return db.prepare('SELECT * FROM resources WHERE hidden = 0 ORDER BY created_at DESC').all().map(parseRow)
}

export function getResourceById(id) {
  const r = db.prepare('SELECT * FROM resources WHERE id = ?').get(id)
  if (!r) return null
  return parseRow(r)
}

// banner 兼容：前端可能传字符串或数组，统一存为 JSON 数组
function normalizeBanner(b) {
  if (!b) return '[]'
  if (Array.isArray(b)) return JSON.stringify(b)
  return JSON.stringify([b])
}

export function createResource(data) {
  return db.prepare(`
    INSERT INTO resources (id, name, icon, banner, author, devices, paid, purchase_link, device_options, hidden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.id, data.name, data.icon || '', normalizeBanner(data.banners || data.banner),
    data.author || '', JSON.stringify(data.devices || []),
    data.paid ? 1 : 0, data.purchase_link || '', JSON.stringify(data.device_options || []),
    data.hidden ? 1 : 0,
  )
}

export function updateResource(id, data) {
  return db.prepare(`
    UPDATE resources SET
      name = ?, icon = ?, banner = ?, author = ?,
      devices = ?, paid = ?, purchase_link = ?, device_options = ?, hidden = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.name, data.icon || '', normalizeBanner(data.banners || data.banner), data.author || '',
    JSON.stringify(data.devices || []), data.paid ? 1 : 0,
    data.purchase_link || '', JSON.stringify(data.device_options || []),
    data.hidden ? 1 : 0, id,
  )
}

export function toggleHidden(id) {
  const r = db.prepare('SELECT hidden FROM resources WHERE id = ?').get(id)
  if (!r) return null
  const newVal = r.hidden ? 0 : 1
  db.prepare('UPDATE resources SET hidden = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newVal, id)
  return !!newVal
}

export function deleteResource(id) {
  return db.prepare('DELETE FROM resources WHERE id = ?').run(id)
}

// ═══ Gallery Images ═══
export function getGalleryImages() {
  return db.prepare('SELECT * FROM gallery_images ORDER BY sort_order ASC, id DESC').all()
}

export function createGalleryImage(data) {
  return db.prepare(
    `INSERT INTO gallery_images (image_url, watch_face_name, watch_face_model, character_name, device, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(data.image_url, data.watch_face_name || '', data.watch_face_model || '', data.character_name || '', data.device || '', data.sort_order || 0)
}

export function updateGalleryImage(id, data) {
  return db.prepare(
    `UPDATE gallery_images SET watch_face_name = ?, watch_face_model = ?, character_name = ?, device = ?, sort_order = ?
     WHERE id = ?`
  ).run(data.watch_face_name || '', data.watch_face_model || '', data.character_name || '', data.device || '', data.sort_order || 0, id)
}

export function deleteGalleryImage(id) {
  return db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id)
}

// ═══ Works Images ═══
export function getWorksImages() {
  return db.prepare('SELECT * FROM works_images ORDER BY sort_order ASC, id ASC').all()
}

export function createWorksImage(data) {
  return db.prepare(
    'INSERT INTO works_images (image_url, sort_order) VALUES (?, ?)'
  ).run(data.image_url, data.sort_order || 0)
}

export function deleteWorksImage(id) {
  return db.prepare('DELETE FROM works_images WHERE id = ?').run(id)
}

export function reorderWorksImages(ids) {
  const stmt = db.prepare('UPDATE works_images SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    ids.forEach((id, idx) => stmt.run(idx, id))
  })
  tx()
}

// ═══ 团队成员 ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roles TEXT DEFAULT '[]',
    avatar TEXT DEFAULT '',
    href TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// 初始化默认团队成员
const memberCount = db.prepare('SELECT COUNT(*) AS c FROM team_members').get()
if (memberCount.c === 0) {
  const defaultMembers = [
    { name: '池焕不是池焕', roles: ['网站构建、设计', '表盘设计'], avatar: '/ChiHuan.webp', href: 'https://space.bilibili.com/674795502' },
    { name: '山荼_skat', roles: ['表盘设计'], avatar: '/ShanTu.webp', href: 'https://www.bandbbs.cn/members/2567401/' },
    { name: 'AzumaChiaki', roles: ['技术支持'], avatar: '/AzumaChiaki.webp', href: 'https://github.com/AzumaChiaki' },
    { name: 'Fmkli', roles: ['技术支持'], avatar: '/Fmkli.webp', href: 'https://lli.moe/' },
  ]
  const insertMember = db.prepare('INSERT INTO team_members (name, roles, avatar, href, sort_order) VALUES (?, ?, ?, ?, ?)')
  const tx = db.transaction(() => {
    defaultMembers.forEach((m, i) => insertMember.run(m.name, JSON.stringify(m.roles), m.avatar, m.href, i))
  })
  tx()
  console.log('[db] 默认团队成员已初始化')
}

export function getTeamMembers() {
  return db.prepare('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC').all().map(r => ({
    ...r,
    roles: JSON.parse(r.roles || '[]'),
  }))
}

export function createTeamMember(data) {
  return db.prepare(
    'INSERT INTO team_members (name, roles, avatar, href, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(data.name, JSON.stringify(data.roles || []), data.avatar || '', data.href || '', data.sort_order || 0)
}

export function updateTeamMember(id, data) {
  return db.prepare(
    'UPDATE team_members SET name = ?, roles = ?, avatar = ?, href = ?, sort_order = ? WHERE id = ?'
  ).run(data.name, JSON.stringify(data.roles || []), data.avatar || '', data.href || '', data.sort_order || 0, id)
}

export function deleteTeamMember(id) {
  return db.prepare('DELETE FROM team_members WHERE id = ?').run(id)
}

export function reorderTeamMembers(ids) {
  const stmt = db.prepare('UPDATE team_members SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    ids.forEach((id, idx) => stmt.run(idx, id))
  })
  tx()
}

// 表盘模板
// 注意：封面（preview_image）由管理员上传 1:1 LOGO，不再由服务端自动合成预览图，
// 所以旧版的 description / preview_device / preview_layer_z_index / preview_color
// 一律不再建列（老库由下方迁移语句删除）。
db.exec(`
  CREATE TABLE IF NOT EXISTS watchface_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    devices TEXT DEFAULT '[]',
    layers TEXT DEFAULT '[]',
    preview_image TEXT DEFAULT '',
    hidden INTEGER DEFAULT 0,
    blur_max INTEGER DEFAULT 50,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`)
try { db.exec(`ALTER TABLE watchface_templates ADD COLUMN preview_image TEXT DEFAULT ''`) } catch { /* 已存在 */ }
try { db.exec(`ALTER TABLE watchface_templates ADD COLUMN hidden INTEGER DEFAULT 0`) } catch { /* 已存在 */ }
// 用户端「效果-图片效果-模糊度」滑杆的上限，由管理端按模板设置（默认 50px）
try { db.exec(`ALTER TABLE watchface_templates ADD COLUMN blur_max INTEGER DEFAULT 50`) } catch { /* 已存在 */ }

// 老库清理：删掉「简介」与旧版自动生成预览图留下的中间字段。
// SQLite 3.35+ 支持 DROP COLUMN；个别环境不支持时忽略，代码侧已经不再读写这些列。
for (const column of ['description', 'preview_device', 'preview_layer_z_index', 'preview_color']) {
  try { db.exec(`ALTER TABLE watchface_templates DROP COLUMN ${column}`) } catch { /* 不支持或列不存在 */ }
}

export function getTemplates() {
  return db.prepare('SELECT * FROM watchface_templates ORDER BY id ASC').all().map(r => ({
    ...r,
    hidden: !!r.hidden,
    devices: JSON.parse(r.devices || '[]'),
    layers: JSON.parse(r.layers || '[]'),
  }))
}

export function getVisibleTemplates() {
  // 公开接口只暴露模板库卡片需要的最小字段：名称 + 1:1 封面图。
  // 只放行服务端生成的上传路径，避免历史脏数据把任意外链当成封面渲染出来。
  // 封面文件名前缀：tpl-logo-（当前）与 tpl-preview-（旧版自动生成，保留兼容）。
  return db.prepare(`
    SELECT
      id,
      name,
      CASE
        WHEN preview_image LIKE '/api/uploads/tpl-logo-%.webp' THEN preview_image
        WHEN preview_image LIKE '/api/uploads/tpl-preview-%.webp' THEN preview_image
        ELSE ''
      END AS preview_image,
      created_at,
      updated_at
    FROM watchface_templates
    WHERE hidden = 0
    ORDER BY id ASC
  `).all()
}

export function toggleTemplateHidden(id) {
  const r = db.prepare('SELECT hidden FROM watchface_templates WHERE id = ?').get(id)
  if (!r) return null
  const newVal = r.hidden ? 0 : 1
  db.prepare('UPDATE watchface_templates SET hidden = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newVal, id)
  return !!newVal
}

export function getTemplateById(id) {
  const r = db.prepare('SELECT * FROM watchface_templates WHERE id = ?').get(id)
  if (!r) return null
  return { ...r, devices: JSON.parse(r.devices || '[]'), layers: JSON.parse(r.layers || '[]') }
}

export function createTemplate(data) {
  return db.prepare(
    'INSERT INTO watchface_templates (name, devices, layers, preview_image, blur_max) VALUES (?, ?, ?, ?, ?)'
  ).run(
    data.name,
    JSON.stringify(data.devices || []),
    JSON.stringify(data.layers || []),
    data.preview_image || '',
    data.blur_max ?? 50,
  )
}

export function updateTemplate(id, data) {
  const sets = []
  const vals = []
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name) }
  if (data.devices !== undefined) { sets.push('devices = ?'); vals.push(JSON.stringify(data.devices)) }
  if (data.layers !== undefined) { sets.push('layers = ?'); vals.push(JSON.stringify(data.layers)) }
  if (data.preview_image !== undefined) { sets.push('preview_image = ?'); vals.push(data.preview_image) }
  if (data.blur_max !== undefined) { sets.push('blur_max = ?'); vals.push(data.blur_max) }
  sets.push("updated_at = datetime('now')")
  vals.push(id)
  return db.prepare(`UPDATE watchface_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteTemplate(id) {
  return db.prepare('DELETE FROM watchface_templates WHERE id = ?').run(id)
}

// ═══ 设备名称（只针对「相册表盘模板」支持的设备） ═══
//
// 机型名的唯一权威来源是模板表：
//   watchface_templates.devices → [{"name":"小米手环 10", "width":..., ...}, ...]
//
// 下面两处虽然也带机型样子的字符串，但它们是「标签」，不参与这里的统计与改名：
//   resources.devices / resources.device_options → 管理员在资源里自己打的标签（可自由增删）
//   gallery_images.device                        → 相册自己的分类
// 混在一起统计时，资源标签会以「机型」的身份出现在改名名单里（曾经出现 10pro / rw6 这类名字），
// 而且改名会悄悄改掉资源标签，导致同一个机型在用户端筛选里裂成两个分类。

function readJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 列出「相册表盘模板」支持的全部机型名。
 * 每项带上引用它的模板（id + 名称），管理端据此显示「被哪些模板引用」。
 * count 即 templates.length：同一个模板里重复写两次同名设备只算一次。
 */
export function getUsedDevices() {
  const seen = new Map()
  for (const row of db.prepare('SELECT id, name, devices FROM watchface_templates ORDER BY id ASC').all()) {
    const usedInThisTemplate = new Set()
    for (const device of readJsonArray(row.devices)) {
      const name = String(device && typeof device === 'object' ? device.name : device ?? '').trim()
      if (!name || usedInThisTemplate.has(name)) continue
      usedInThisTemplate.add(name)
      let entry = seen.get(name)
      if (!entry) { entry = { name, count: 0, templates: [] }; seen.set(name, entry) }
      entry.count += 1
      entry.templates.push({ id: row.id, name: row.name || `模板 #${row.id}` })
    }
  }

  return [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/**
 * 把某个机型名在「相册表盘模板」里统一改成新名字。
 * 只动 watchface_templates，资源标签与相册分类是独立的，故意不碰。
 * 返回受影响的模板数量与名称（管理端据此提示「改了哪几个模板」）。
 */
export function renameDevice(from, to) {
  const oldName = String(from ?? '').trim()
  const newName = String(to ?? '').trim()
  if (!oldName || !newName) throw new Error('设备名称不能为空')
  if (oldName === newName) throw new Error('新旧设备名称相同')

  const result = { templates: 0, names: [], conflicts: [] }
  const transaction = db.transaction(() => {
    const updateTemplateRow = db.prepare('UPDATE watchface_templates SET devices = ?, updated_at = datetime(\'now\') WHERE id = ?')
    for (const row of db.prepare('SELECT id, name, devices FROM watchface_templates').all()) {
      const devices = readJsonArray(row.devices)
      let touched = false
      const next = devices.map((device) => {
        if (!device || typeof device !== 'object') return device
        if (String(device.name ?? '').trim() !== oldName) return device
        touched = true
        return { ...device, name: newName }
      })
      if (!touched) continue

      updateTemplateRow.run(JSON.stringify(next), row.id)
      result.templates += 1
      const label = row.name || `模板 #${row.id}`
      result.names.push(label)
      // 同一模板里已经有同名设备了 → 改完会出现重复项，提示管理员去编辑页去掉一个
      const sameName = next.filter(d => d && typeof d === 'object' && String(d.name ?? '').trim() === newName).length
      if (sameName > 1) result.conflicts.push(label)
    }
  })
  transaction()
  return { ok: true, from: oldName, to: newName, ...result }
}

// ═══ APK 打包任务 ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS apk_builds (
    id TEXT PRIMARY KEY,
    template_id INTEGER NOT NULL,
    template_name TEXT DEFAULT '',
    package_name TEXT DEFAULT '',
    status TEXT DEFAULT 'queued',
    apk_filename TEXT DEFAULT '',
    error TEXT DEFAULT '',
    bundle_token TEXT DEFAULT '',
    callback_token TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );
`)

export function createApkBuild(row) {
  return db.prepare(`
    INSERT INTO apk_builds
      (id, template_id, template_name, package_name, status, bundle_token, callback_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.template_id,
    row.template_name || '',
    row.package_name || '',
    row.status || 'queued',
    row.bundle_token || '',
    row.callback_token || '',
  )
}

export function getApkBuildById(id) {
  return db.prepare('SELECT * FROM apk_builds WHERE id = ?').get(id) || null
}

export function getApkBuildsByTemplate(templateId) {
  return db.prepare(
    'SELECT * FROM apk_builds WHERE template_id = ? ORDER BY created_at DESC'
  ).all(templateId)
}

export function getLatestApkBuildByTemplate(templateId) {
  return db.prepare(
    'SELECT * FROM apk_builds WHERE template_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(templateId) || null
}

export function listApkBuilds(limit = 50) {
  return db.prepare(
    'SELECT * FROM apk_builds ORDER BY created_at DESC LIMIT ?'
  ).all(limit)
}

export function updateApkBuild(id, data) {
  const sets = []
  const vals = []
  for (const key of ['status', 'apk_filename', 'error', 'finished_at', 'template_name', 'package_name']) {
    if (data[key] !== undefined) {
      sets.push(`${key} = ?`)
      vals.push(data[key])
    }
  }
  sets.push("updated_at = datetime('now')")
  vals.push(id)
  return db.prepare(`UPDATE apk_builds SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

// ═══ 友链 ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS friend_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

export function getFriendLinks() {
  return db.prepare('SELECT * FROM friend_links ORDER BY sort_order ASC, id ASC').all()
}

export function createFriendLink(data) {
  return db.prepare(
    'INSERT INTO friend_links (name, url, description, sort_order) VALUES (?, ?, ?, ?)'
  ).run(data.name, data.url, data.description || '', data.sort_order || 0)
}

export function updateFriendLink(id, data) {
  return db.prepare(
    `UPDATE friend_links SET name = ?, url = ?, description = ?, sort_order = ? WHERE id = ?`
  ).run(data.name, data.url, data.description || '', data.sort_order || 0, id)
}

export function deleteFriendLink(id) {
  return db.prepare('DELETE FROM friend_links WHERE id = ?').run(id)
}

export function reorderFriendLinks(ids) {
  const stmt = db.prepare('UPDATE friend_links SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    ids.forEach((id, idx) => stmt.run(idx, id))
  })
  tx()
}

// ═══ 字体 ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS fonts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    family_name TEXT NOT NULL DEFAULT '',
    style TEXT DEFAULT 'Regular',
    weight INTEGER DEFAULT 400,
    is_variable INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

export function getFonts() {
  return db.prepare('SELECT * FROM fonts ORDER BY id DESC').all()
}

export function createFont(data) {
  return db.prepare(
    'INSERT INTO fonts (filename, original_name, family_name, style, weight, is_variable, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(data.filename, data.original_name, data.family_name || '', data.style || 'Regular', data.weight || 400, data.is_variable ? 1 : 0, data.file_size || 0)
}

export function deleteFont(id) {
  return db.prepare('DELETE FROM fonts WHERE id = ?').run(id)
}

// ═══ 站点设置（首页文案等） ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`)

const DEFAULT_SETTINGS = {
  slogan: '为小米腕上设备打造精致第三方表盘，让腕间与众不同。',
  intro_line1: 'POOLUX Studio，致力于为您打造更加美观、个性化的小米腕上设备表盘。',
  intro_line2: '这是我们的官网，收纳了我们制作的一些实用工具，并且集成了资源下载。',
  copyright: '© 2026 POOLUX Studio. All rights reserved.',
  contact_href: '#members',
  // ── 入站提醒（用户每次进入站点时弹出的公告）──
  // 开关：'1' 开启、'0' 关闭
  notice_enabled: '0',
  // 每次进入都显示的正文
  notice_content: '',
  // 首次进入（本机浏览器没关过提醒）时显示的正文；留空则用 notice_content
  notice_first_content: '',
  // 用户端弹窗按钮文字
  notice_button_text: '知道了',
  // 自动关闭倒计时（秒）；'0' 表示不自动关闭
  notice_auto_close_seconds: '0',
  // 自动关闭的截止时间，东八区本地时间 'YYYY-MM-DDTHH:mm'；到点后提醒不再出现；留空表示不限制
  notice_expire_at: '',
}
const existingSettings = db.prepare('SELECT COUNT(*) AS c FROM site_settings').get()
if (existingSettings.c === 0) {
  const insert = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?)')
  const tx = db.transaction(() => {
    Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insert.run(k, v))
  })
  tx()
  console.log('[db] 默认站点设置已初始化')
}

export function getSiteSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS)
  const rows = db.prepare(`
    SELECT key, value FROM site_settings
    WHERE key IN (${keys.map(() => '?').join(', ')})
  `).all(...keys)
  const result = { ...DEFAULT_SETTINGS }
  rows.forEach(r => { result[r.key] = r.value })
  return result
}

export function updateSiteSetting(key, value) {
  return db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value)
}

const TERMS_SETTING_KEYS = ['terms_title', 'terms_content', 'terms_updated_at', 'terms_signature']

export function getTermsSettings() {
  const rows = db.prepare(`
    SELECT key, value FROM site_settings
    WHERE key IN (${TERMS_SETTING_KEYS.map(() => '?').join(', ')})
  `).all(...TERMS_SETTING_KEYS)
  const terms = Object.fromEntries(TERMS_SETTING_KEYS.map(key => [key, '']))
  rows.forEach(row => { terms[row.key] = row.value })
  return {
    initialized: Boolean(terms.terms_title.trim() && terms.terms_content.trim()),
    terms,
  }
}

export function updateTermsSettings(terms) {
  const statement = db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)')
  const transaction = db.transaction(data => {
    TERMS_SETTING_KEYS.forEach(key => statement.run(key, data[key] ?? ''))
  })
  transaction(terms)
  return getTermsSettings()
}

// ═══ 预览图生成已下线 ═══
// 旧版「机型底图 + 透视合成」的预览图生成功能（含 preview_devices 表）已整体移除，
// 模板封面改为管理员直接上传 1:1 LOGO。这里清掉老库遗留的表。
try { db.exec('DROP TABLE IF EXISTS preview_devices') } catch { /* 忽略 */ }

export default db