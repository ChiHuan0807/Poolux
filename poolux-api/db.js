import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

const db = new Database(join(__dirname, 'data.db'))

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

// 密码哈希
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
}

// 初始化默认管理员账号（admin / poolux2026）
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
if (!existingAdmin) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword('poolux2026', salt)
  db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)').run('admin', hash, salt)
  console.log('[db] 默认管理员已创建: admin / poolux2026')
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
  if (!user) return null
  const hash = hashPassword(password, user.salt)
  if (hash !== user.password_hash) return null
  return { id: user.id, username: user.username, default_author: user.default_author || '' }
}

export function getUsers() {
  return db.prepare('SELECT id, username, default_author, created_at FROM users').all()
}

export function createUser(username, password, defaultAuthor = '') {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(password, salt)
  return db.prepare('INSERT INTO users (username, password_hash, salt, default_author) VALUES (?, ?, ?, ?)').run(username, hash, salt, defaultAuthor)
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
  return db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId)
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
db.exec(`
  CREATE TABLE IF NOT EXISTS watchface_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    devices TEXT DEFAULT '[]',
    layers TEXT DEFAULT '[]',
    preview_image TEXT DEFAULT '',
    hidden INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`)
try { db.exec(`ALTER TABLE watchface_templates ADD COLUMN preview_image TEXT DEFAULT ''`) } catch { /* 已存在 */ }
try { db.exec(`ALTER TABLE watchface_templates ADD COLUMN hidden INTEGER DEFAULT 0`) } catch { /* 已存在 */ }

export function getTemplates() {
  return db.prepare('SELECT * FROM watchface_templates ORDER BY id ASC').all().map(r => ({
    ...r,
    hidden: !!r.hidden,
    devices: JSON.parse(r.devices || '[]'),
    layers: JSON.parse(r.layers || '[]'),
  }))
}

export function getVisibleTemplates() {
  return db.prepare('SELECT * FROM watchface_templates WHERE hidden = 0 ORDER BY id ASC').all().map(r => ({
    ...r,
    hidden: false,
    devices: JSON.parse(r.devices || '[]'),
    layers: JSON.parse(r.layers || '[]'),
  }))
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
    'INSERT INTO watchface_templates (name, devices, layers, preview_image) VALUES (?, ?, ?, ?)'
  ).run(data.name, JSON.stringify(data.devices || []), JSON.stringify(data.layers || []), data.preview_image || '')
}

export function updateTemplate(id, data) {
  const sets = []
  const vals = []
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name) }
  if (data.devices !== undefined) { sets.push('devices = ?'); vals.push(JSON.stringify(data.devices)) }
  if (data.layers !== undefined) { sets.push('layers = ?'); vals.push(JSON.stringify(data.layers)) }
  if (data.preview_image !== undefined) { sets.push('preview_image = ?'); vals.push(data.preview_image) }
  sets.push("updated_at = datetime('now')")
  vals.push(id)
  return db.prepare(`UPDATE watchface_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteTemplate(id) {
  return db.prepare('DELETE FROM watchface_templates WHERE id = ?').run(id)
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
  const rows = db.prepare('SELECT * FROM site_settings').all()
  const result = { ...DEFAULT_SETTINGS }
  rows.forEach(r => { result[r.key] = r.value })
  return result
}

export function updateSiteSetting(key, value) {
  return db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value)
}

export default db