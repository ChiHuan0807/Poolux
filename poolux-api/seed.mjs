import Database from 'better-sqlite3'
import crypto from 'crypto'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, 'data.db'))

db.pragma('journal_mode = WAL')

// 确保 purchase_link 列存在
try {
  db.exec(`ALTER TABLE resources ADD COLUMN purchase_link TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }

// 确保 default_author 列存在
try {
  db.exec(`ALTER TABLE users ADD COLUMN default_author TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }

// --- 密码工具 ---
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
}

function ensureUser(username, password, defaultAuthor) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    console.log(`[seed] 用户已存在: ${username}`)
    return
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = hashPassword(password, salt)
  db.prepare('INSERT INTO users (username, password_hash, salt, default_author) VALUES (?, ?, ?, ?)').run(username, hash, salt, defaultAuthor)
  console.log(`[seed] 已创建用户: ${username} (默认作者: ${defaultAuthor})`)
}

ensureUser('池焕不是迟缓', 'poolux2026', '@池焕不是迟缓')
ensureUser('山荼-skat', 'poolux2026', '@山荼-skat')
ensureUser('Fmkli', 'poolux2026', '')

// --- 资源数据 ---
const resources = [
  {
    id: 'shiyu-mayue',
    name: '「时语」- 五月猫',
    icon: '/resource/时语-五月猫/logo.webp',
    banner: '/resource/时语-五月猫/banner.webp',
    author: '@山荼-skat',
    devices: JSON.stringify(['小米手环 9 Pro', '小米手环 10', '小米手环 10 Pro', 'REDMI Watch 6']),
    paid: 0,
    purchase_link: '',
    device_options: JSON.stringify([
      { id: '9pro', label: '小米手环 9 Pro', downloadUrl: '/resource/时语-五月猫/9p「时语」-五月猫.bin' },
      { id: '10', label: '小米手环 10', downloadUrl: '/resource/时语-五月猫/10「时语」-五月猫.bin' },
      { id: '10pro', label: '小米手环 10 Pro', downloadUrl: '/resource/时语-五月猫/10p「时语」-五月猫.bin' },
      { id: 'rw6', label: 'REDMI Watch 6', downloadUrl: '/resource/时语-五月猫/rw6「时语」-五月猫.bin' },
    ]),
  },
  {
    id: 'layerui-mahiru',
    name: '「Layer UI」- 绪山真寻',
    icon: '/resource/LayerUI-绪山真寻/logo.webp',
    banner: '/resource/LayerUI-绪山真寻/banner.webp',
    author: '@池焕不是迟缓',
    devices: JSON.stringify(['小米手环 9 Pro', '小米手环 10 Pro']),
    paid: 0,
    purchase_link: '',
    device_options: JSON.stringify([
      { id: '9pro', label: '小米手环 9 Pro', downloadUrl: '/resource/LayerUI-绪山真寻/Layer UI - 真寻 - 9P.bin' },
      { id: '10pro', label: '小米手环 10 Pro', downloadUrl: '/resource/LayerUI-绪山真寻/Layer UI - 真寻 - 10P.bin' },
    ]),
  },
]

const insert = db.prepare(`
  INSERT OR IGNORE INTO resources (id, name, icon, banner, author, devices, paid, purchase_link, device_options)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

for (const r of resources) {
  insert.run(r.id, r.name, r.icon, r.banner, r.author, r.devices, r.paid, r.purchase_link, r.device_options)
  console.log(`[seed] 已导入: ${r.name}`)
}

// --- 首页作品图片（wf1-wf11） ---
const existingWorks = db.prepare('SELECT COUNT(*) as cnt FROM works_images').get()
if (existingWorks.cnt === 0) {
  const insertWork = db.prepare('INSERT INTO works_images (image_url, sort_order) VALUES (?, ?)')
  for (let i = 1; i <= 11; i++) {
    insertWork.run(`/wf${i}.webp`, i)
    console.log(`[seed] 已导入作品: wf${i}.webp`)
  }
} else {
  console.log(`[seed] 作品图片已存在 (${existingWorks.cnt} 条)，跳过`)
}

// --- 友链 ---
const existingLinks = db.prepare('SELECT COUNT(*) as cnt FROM friend_links').get()
if (existingLinks.cnt === 0) {
  const insertLink = db.prepare('INSERT INTO friend_links (name, url, description, sort_order) VALUES (?, ?, ?, ?)')
  insertLink.run('Azuma Studio', 'https://azumachiaki.com/', '技术伙伴', 0)
  insertLink.run('EVOA', 'https://evoa.top/', '技术伙伴', 1)
  insertLink.run('米坛社区', 'https://www.bandbbs.cn/', '米坛社区', 2)
  console.log('[seed] 已导入 3 条友链')
} else {
  console.log(`[seed] 友链已存在 (${existingLinks.cnt} 条)，跳过`)
}

console.log('[seed] 完成')
db.close()