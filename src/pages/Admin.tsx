import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { apiFetch, apiUpload, apiUploadTo, API_BASE } from '@/lib/api'
import { toExternalUrl } from '@/lib/utils'
import { Plus, Trash2, Save, Upload, LogOut, Settings, EyeOff, Eye, ChevronRight, Check, Menu, X, GripVertical, PanelsTopLeft, Package, Download, Loader2 } from 'lucide-react'
import { GalleryAdmin } from '@/pages/Gallery'
import { TemplateCreator } from '@/pages/TemplateCreator'

interface DeviceOption {
  id: string
  label: string
  downloadUrl: string
}

interface Resource {
  id: string
  name: string
  icon: string
  banners: string[]
  author: string
  devices: string[]
  paid: boolean
  purchase_link: string
  hidden: boolean
  device_options: DeviceOption[]
}

const EMPTY_RESOURCE: Resource = {
  id: '', name: '', icon: '', banners: [], author: '',
  devices: [], paid: false, purchase_link: '', hidden: false, device_options: [],
}

const ALL_DEVICES = ['小米手环 9 Pro', '小米手环 10', '小米手环 10 Pro', 'REDMI Watch 6']

type Tab = 'resources' | 'gallery' | 'homepage' | 'template' | 'settings'

export function Admin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [resources, setResources] = useState<Resource[]>([])
  const [editing, setEditing] = useState<Resource | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<Tab>('resources')
  const [defaultAuthor, setDefaultAuthor] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/auth/check', { signal: ac.signal }).then((data: any) => {
      setLoggedIn(true)
      if (data.defaultAuthor) setDefaultAuthor(data.defaultAuthor)
    }).catch(() => {})
    return () => ac.abort()
  }, [])

  const loadResources = useCallback(async () => {
    try {
      const data = await apiFetch('/api/resources/all')
      setResources(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (loggedIn) loadResources()
  }, [loggedIn, loadResources])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }).then((data: any) => {
        if (data.defaultAuthor) setDefaultAuthor(data.defaultAuthor)
      })
      setLoggedIn(true)
    } catch (err: any) {
      setLoginError(err.message)
    }
  }

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch { /* best-effort */ }
    setLoggedIn(false)
    setEditing(null)
  }

  const handleNew = () => {
    setEditing({ ...EMPTY_RESOURCE, author: defaultAuthor })
    setIsNew(true)
    setMsg('')
    setSidebarOpen(false)
  }

  const handleEdit = (r: any) => {
    // 兼容旧数据：banner 可能是字符串
    const banners = Array.isArray(r.banners) ? r.banners
      : r.banner ? [r.banner] : []
    setEditing({ ...r, banners, devices: [...r.devices], device_options: r.device_options.map(d => ({ ...d })) })
    setIsNew(false)
    setMsg('')
    setSidebarOpen(false)
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    setMsg('')
    try {
      if (isNew) {
        await apiFetch('/api/resources', { method: 'POST', body: JSON.stringify(editing) })
        setMsg('创建成功')
      } else {
        await apiFetch(`/api/resources/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
        setMsg('保存成功')
      }
      await loadResources()
      setEditing(null)
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该资源？')) return
    try {
      await apiFetch(`/api/resources/${id}`, { method: 'DELETE' })
      await loadResources()
      if (editing?.id === id) setEditing(null)
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleToggleHidden = async (id: string) => {
    try {
      await apiFetch(`/api/resources/${id}/toggle-hidden`, { method: 'PATCH' })
      await loadResources()
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleDeleteFile = async (url: string) => {
    try {
      await apiFetch(`/api/resources/delete-file?url=${encodeURIComponent(url)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
  }

  const handleUpload = async (file: File, field: 'icon' | 'banner') => {
    try {
      const result = await apiUpload(file)
      if (editing) {
        const url = `${API_BASE}${result.path}`
        if (field === 'banner') {
          setEditing({ ...editing, banners: [...editing.banners, url] })
        } else {
          setEditing({ ...editing, [field]: url })
        }
      }
      setMsg('上传成功')
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleUploadMulti = async (files: File[]) => {
    if (!editing) return
    setSaving(true)
    setMsg('')
    try {
      const urls: string[] = []
      for (const file of files) {
        const result = await apiUpload(file)
        urls.push(`${API_BASE}${result.path}`)
      }
      setEditing({ ...editing, banners: [...editing.banners, ...urls] })
      setMsg(`成功上传 ${files.length} 张图片`)
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleUploadBin = async (file: File, deviceName: string) => {
    try {
      const result = await apiUpload(file)
      if (editing) {
        const url = `${API_BASE}${result.path}`
        const newOpt: DeviceOption = { id: deviceName, label: deviceName, downloadUrl: url }
        const filtered = editing.device_options.filter(opt => opt.id !== deviceName)
        setEditing({ ...editing, device_options: [...filtered, newOpt] })
      }
      setMsg('上传成功')
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const switchTab = (t: Tab) => {
    setTab(t)
    setEditing(null)
    setSidebarOpen(false)
  }

  // --- 未登录 ---
  if (!loggedIn) {
    return (
      <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <form onSubmit={handleLogin} className="w-full max-w-sm">
            <div className="rounded-2xl p-8 space-y-5" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-elevated)' }}>
              <div className="text-center">
                <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>管理后台</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>请登录以继续</p>
              </div>
              <div className="space-y-3">
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="用户名"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="密码"
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
              </div>
              {loginError && (
                <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>{loginError}</p>
              )}
              <button type="submit" className="w-full py-3 rounded-xl text-sm font-medium text-white transition-all"
                style={{ background: 'var(--gradient-accent)' }}>
                登录
              </button>
            </div>
          </form>
        </main>
      </div>
    )
  }

  // --- 已登录 ---
  const pageTitle = tab === 'settings' ? '设置' : tab === 'gallery' ? '相册图片资源库管理' : tab === 'homepage' ? '首页内容' : tab === 'template' ? '模板管理' : '资源管理'

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `} style={{ background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)', top: '60px' }}>
          <div className="flex items-center justify-between px-4 py-4 lg:hidden" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>菜单</span>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-xl" style={{ color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-auto">
            <button onClick={() => switchTab('resources')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === 'resources' ? 'var(--accent-bg)' : 'transparent',
                color: tab === 'resources' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <Eye className="w-4 h-4 flex-shrink-0" />
              资源管理
            </button>
            <button onClick={() => switchTab('gallery')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === 'gallery' ? 'var(--accent-bg)' : 'transparent',
                color: tab === 'gallery' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <span className="w-4 h-4 flex-shrink-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span>
              相册图片资源库管理
            </button>
            <button onClick={() => switchTab('homepage')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === 'homepage' ? 'var(--accent-bg)' : 'transparent',
                color: tab === 'homepage' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <PanelsTopLeft className="w-4 h-4 flex-shrink-0" />
              首页内容
            </button>
            <button onClick={() => switchTab('template')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === 'template' ? 'var(--accent-bg)' : 'transparent',
                color: tab === 'template' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <span className="w-4 h-4 flex-shrink-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></span>
              模板管理
            </button>
            <Link to="/" onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{ color: 'var(--text-secondary)' }}>
              <PanelsTopLeft className="w-4 h-4 flex-shrink-0" />
              官网首页
            </Link>
            <button onClick={() => switchTab('settings')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === 'settings' ? 'var(--accent-bg)' : 'transparent',
                color: tab === 'settings' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <Settings className="w-4 h-4 flex-shrink-0" />
              设置
            </button>
          </nav>

          <div className="p-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <button onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{ color: 'var(--text-muted)' }}>
              <LogOut className="w-4 h-4 flex-shrink-0" />
              退出登录
            </button>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 relative z-10 overflow-auto no-scrollbar">
          {/* 移动端顶栏 */}
          <div className="flex items-center gap-3 px-4 py-3 lg:hidden" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-xl" style={{ color: 'var(--text-primary)' }}>
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
            {tab === 'resources' && !editing && (
              <button onClick={handleNew} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white transition-all"
                style={{ background: 'var(--gradient-accent)' }}>
                <Plus className="w-3.5 h-3.5" /> 新增
              </button>
            )}
          </div>

          <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
            {/* 桌面端顶栏 */}
            <div className="hidden lg:flex items-center justify-between mb-8">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{pageTitle}</h1>
              {tab === 'resources' && !editing && (
                <button onClick={handleNew} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all"
                  style={{ background: 'var(--gradient-accent)' }}>
                  <Plus className="w-4 h-4" /> 新增
                </button>
              )}
            </div>

            {tab === 'settings' ? (
              <SettingsPanel msg={msg} setMsg={setMsg} defaultAuthor={defaultAuthor} setDefaultAuthor={setDefaultAuthor} />
            ) : tab === 'gallery' ? (
              <GalleryAdmin />
            ) : tab === 'homepage' ? (
              <HomepageAdmin />
            ) : tab === 'template' ? (
              <TemplateManager msg={msg} setMsg={setMsg} />
            ) : (
              <div className="flex gap-6 flex-col lg:flex-row">
                <div className="lg:w-80 flex-shrink-0 space-y-2">
                  {resources.map(r => (
                    <button key={r.id}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left"
                      style={{
                        background: editing?.id === r.id ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                        boxShadow: editing?.id === r.id ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
                      }}
                      onClick={() => handleEdit(r)}>
                      <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                        {r.icon ? <img src={r.icon} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', opacity: r.hidden ? 0.5 : 1 }}>
                          {r.name || r.id}
                        </p>
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {r.author || '未知作者'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {r.paid && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>付费</span>}
                        {r.hidden && <EyeOff className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />}
                      </div>
                      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  ))}
                  {resources.length === 0 && (
                    <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无资源</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>点击「新增」创建第一个资源</p>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {editing ? (
                    <ResourceEditor
                      editing={editing} setEditing={setEditing} isNew={isNew} saving={saving} msg={msg}
                      onSave={handleSave} onCancel={() => setEditing(null)} onDelete={handleDelete}
                      onUpload={handleUpload} onUploadMulti={handleUploadMulti} onUploadBin={handleUploadBin} onToggleHidden={handleToggleHidden} onDeleteFile={handleDeleteFile}
                    />
                  ) : (
                    <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>选择左侧资源进行编辑</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

// --- 资源编辑器 ---
function ResourceEditor({ editing, setEditing, isNew, saving, msg, onSave, onCancel, onDelete, onUpload, onUploadMulti, onUploadBin, onToggleHidden, onDeleteFile }: {
  editing: Resource
  setEditing: (r: Resource) => void
  isNew: boolean
  saving: boolean
  msg: string
  onSave: () => void
  onCancel: () => void
  onDelete: (id: string) => void
  onUpload: (file: File, field: 'icon' | 'banner') => void
  onUploadMulti: (files: File[]) => void
  onUploadBin: (file: File, deviceName: string) => void
  onToggleHidden: (id: string) => void
  onDeleteFile: (url: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isNew ? '新增资源' : editing.name || editing.id}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {isNew ? '填写以下信息创建资源' : `ID: ${editing.id}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <button onClick={() => onToggleHidden(editing.id)}
                className="p-2 rounded-xl transition-colors"
                style={{ color: editing.hidden ? 'var(--warning)' : 'var(--text-muted)' }}
                title={editing.hidden ? '显示资源' : '隐藏资源'}>
                {editing.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={() => onDelete(editing.id)}
                className="p-2 rounded-xl transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title="删除资源">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            取消
          </button>
          <button onClick={onSave} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium text-white transition-all"
            style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
            {saving ? '保存中...' : <><Save className="w-4 h-4" /> 保存</>}
          </button>
        </div>
      </div>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      <Section title="基本信息">
        <Field label="资源 ID">
          <input value={editing.id} onChange={e => setEditing({ ...editing, id: e.target.value })} disabled={!isNew}
            placeholder="唯一标识，如 shiyu-wym"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', opacity: isNew ? 1 : 0.5 }} />
        </Field>
        <Field label="名称">
          <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
            placeholder="资源名称"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="作者">
          <input value={editing.author} onChange={e => setEditing({ ...editing, author: e.target.value })}
            placeholder="作者名称"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
      </Section>

      <Section title="图片资源">
        <Field label="Logo 图">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {editing.icon ? (
                <div className="relative group">
                  <img src={editing.icon} alt="" className="w-20 h-20 rounded-2xl object-cover" />
                  <button onClick={() => { onDeleteFile(editing.icon); setEditing({ ...editing, icon: '' }) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <UploadBtn onChange={f => onUpload(f, 'icon')} />
              )}
            </div>
          </div>
        </Field>
        <Field label="Banner 图">
          <div className="space-y-3">
            {editing.banners && editing.banners.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editing.banners.map((url, idx) => (
                  <div key={idx} className="relative group">
                    <img src={url} alt="" className="w-32 h-20 rounded-xl object-cover" />
                    <button
                      onClick={() => {
                        onDeleteFile(url)
                        const next = editing.banners.filter((_, i) => i !== idx)
                        setEditing({ ...editing, banners: next })
                      }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'var(--danger)', color: '#fff' }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
                      {idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <UploadBtn label="上传 Banner（可多选）" multiple onFiles={onUploadMulti} />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>建议尺寸大于 1350×900，支持 JPG/PNG/WebP</p>
          </div>
        </Field>
      </Section>

      <Section title="设备与价格">
        <Field label="适配设备">
          <div className="flex flex-wrap gap-2">
            {ALL_DEVICES.map(d => {
              const checked = editing.devices.includes(d)
              return (
                <button key={d}
                  onClick={() => {
                    const devices = checked ? editing.devices.filter(x => x !== d) : [...editing.devices, d]
                    setEditing({ ...editing, devices })
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: checked ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                    color: checked ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}>
                  {checked && <Check className="w-3 h-3" />}
                  {d}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="价格">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditing({ ...editing, paid: false, purchase_link: '' })}
              className="px-4 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: !editing.paid ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                color: !editing.paid ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1px solid ${!editing.paid ? 'var(--accent)' : 'var(--border-color)'}`,
              }}>免费</button>
            <button onClick={() => setEditing({ ...editing, paid: true })}
              className="px-4 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: editing.paid ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                color: editing.paid ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1px solid ${editing.paid ? 'var(--accent)' : 'var(--border-color)'}`,
              }}>付费</button>
          </div>
          {editing.paid && (
            <input value={editing.purchase_link} onChange={e => setEditing({ ...editing, purchase_link: e.target.value })}
              placeholder="输入购买链接"
              className="w-full px-4 py-2.5 mt-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          )}
        </Field>
      </Section>

      <Section title="下载文件">
        {editing.devices.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>请先在上方勾选适配设备</p>
        ) : (
          <div className="space-y-2">
            {editing.devices.map(device => {
              const existing = editing.device_options.find(opt => opt.id === device)
              return (
                <div key={device} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
                  <span className="text-xs font-medium flex-shrink-0 w-36 truncate" style={{ color: 'var(--text-primary)' }}>{device}</span>
                  {existing ? (
                    <>
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }}>
                        {existing.downloadUrl.split('/').pop()}
                      </span>
                      <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
                      <button onClick={() => {
                        setEditing({ ...editing, device_options: editing.device_options.filter(opt => opt.id !== device) })
                      }} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <DeviceUploadBtn deviceName={device} onUploadBin={onUploadBin} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

// --- 友链管理 ---
function FriendsAdmin() {
  const [links, setLinks] = useState<{ id: number; name: string; url: string; description: string; sort_order: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ id?: number; name: string; url: string; description: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const load = useCallback(async () => {
    try { setLinks(await apiFetch('/api/friends')) } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!editing) return
    if (!editing.name.trim() || !editing.url.trim()) { setMsg('名称和链接为必填'); return }
    setSaving(true)
    try {
      const payload = { ...editing, url: toExternalUrl(editing.url) }
      if (isNew) {
        await apiFetch('/api/friends', { method: 'POST', body: JSON.stringify({ ...payload, sort_order: links.length }) })
      } else {
        await apiFetch(`/api/friends/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      }
      await load()
      setEditing(null)
      setIsNew(false)
      setMsg('保存成功')
    } catch (err: any) { setMsg(err.message) }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    try { await apiFetch(`/api/friends/${id}`, { method: 'DELETE' }); await load(); setMsg('已删除') } catch (err: any) { setMsg(err.message) }
  }

  const handleDragStart = (idx: number) => setDragIdx(idx)

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const reordered = [...links]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setLinks(reordered)
    setDragIdx(idx)
  }

  const handleDragEnd = async () => {
    setDragIdx(null)
    const ids = links.map(l => l.id)
    try { await apiFetch('/api/friends/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }) } catch {}
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div className="space-y-4">
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msg.includes('成功') || msg.includes('已删除') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') || msg.includes('已删除') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      {editing ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => { setEditing(null); setIsNew(false) }} className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              ← 返回列表
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
              <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
            </button>
          </div>

          <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>站点名称 *</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="如：POOLUX Studio"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            </div>
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>链接地址 *</label>
              <input value={editing.url} onChange={e => setEditing({ ...editing, url: e.target.value })}
                placeholder="https://example.com 或 example.com"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>可不写协议，保存时自动补全 https://，避免被当成站内链接</p>
            </div>
            <div><label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>描述</label>
              <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder="简短介绍（可选）"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <button onClick={() => { setEditing({ name: '', url: '', description: '' }); setIsNew(true) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-white transition-all"
            style={{ background: 'var(--gradient-accent)' }}>
            <Plus className="w-4 h-4" /> 添加友链
          </button>

          {links.length === 0 ? (
            <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无友链</p>
            </div>
          ) : (
            <div className="space-y-2">
              {links.map((link, idx) => (
                <div key={link.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  className="flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer group"
                  style={{
                    background: dragIdx === idx ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                    boxShadow: dragIdx === idx ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
                    opacity: dragIdx === idx ? 0.6 : 1,
                  }}
                  onClick={() => { setEditing({ ...link }); setIsNew(false) }}>
                  <div className="flex-shrink-0 cursor-grab active:cursor-grabbing" style={{ color: 'var(--text-muted)' }}>
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{link.name}</p>
                    <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{link.url}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(link.id) }}
                    className="w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// --- 模板管理（含每模板独立 APK 打包） ---
type ApkJob = {
  id: string
  template_id: number
  template_name?: string
  package_name?: string
  status: string
  apk_filename?: string
  error?: string
  updated_at?: string
  finished_at?: string
}

const APK_BUSY = new Set(['queued', 'preparing', 'building'])

/** finished_at 为后端写入的中国大陆墙钟时间（无时区后缀），禁止再用 Date 当 UTC/本地二次换算 */
function formatApkFinishedAt(value?: string) {
  if (!value) return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (match) return `${match[2]}/${match[3]} ${match[4]}:${match[5]}`
  // 兼容旧数据：带 Z / 偏移的 ISO 统一按上海时区展示
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return value
}

function apkStatusLabel(job?: ApkJob | null) {
  if (!job) return ''
  if (job.status === 'preparing') return '准备资源中…'
  if (job.status === 'building' || job.status === 'queued') return 'GitHub Actions 编译中…'
  if (job.status === 'ready') {
    const time = formatApkFinishedAt(job.finished_at)
    return '可下载' + (time ? ` (${time})` : '')
  }
  if (job.status === 'failed') return job.error ? `失败：${job.error}` : '打包失败'
  return job.status
}

function TemplateManager({ msg, setMsg }: { msg: string; setMsg: (s: string) => void }) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [editData, setEditData] = useState<any>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // 每个模板最新一条打包任务
  const [apkJobs, setApkJobs] = useState<Record<number, ApkJob | null>>({})
  const [apkBusy, setApkBusy] = useState<Record<number, boolean>>({})

  const load = useCallback(async () => {
    try { setTemplates(await apiFetch('/api/templates/all')) } catch {}
    setLoading(false)
  }, [])

  const loadApkJobs = useCallback(async (list: any[]) => {
    const next: Record<number, ApkJob | null> = {}
    await Promise.all(
      list.map(async (t) => {
        try {
          const rows = await apiFetch(`/api/apk-builds?template_id=${t.id}`)
          next[t.id] = Array.isArray(rows) && rows[0] ? rows[0] : null
        } catch {
          next[t.id] = null
        }
      }),
    )
    setApkJobs((prev) => ({ ...prev, ...next }))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (view !== 'list' || templates.length === 0) return
    loadApkJobs(templates)
  }, [view, templates, loadApkJobs])

  // 有进行中的任务时轮询状态
  useEffect(() => {
    if (view !== 'list') return
    const hasBusy = Object.values(apkJobs).some((j) => j && APK_BUSY.has(j.status))
    if (!hasBusy) return
    const timer = window.setInterval(() => {
      loadApkJobs(templates)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [view, apkJobs, templates, loadApkJobs])

  const handleToggleHidden = async (id: number) => {
    try { await apiFetch(`/api/templates/${id}/toggle-hidden`, { method: 'PATCH' }); await load(); setMsg('状态已切换') } catch (err: any) { setMsg(err.message) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此模板？')) return
    try { await apiFetch(`/api/templates/${id}`, { method: 'DELETE' }); await load(); setMsg('已删除') } catch (err: any) { setMsg(err.message) }
  }

  const handleEdit = (tpl: any) => {
    setEditData(tpl)
    setView('edit')
  }

  const handleBuildApk = async (templateId: number) => {
    setApkBusy((p) => ({ ...p, [templateId]: true }))
    try {
      const res = await apiFetch('/api/apk-builds', {
        method: 'POST',
        body: JSON.stringify({ template_id: templateId }),
      })
      setMsg(`已开始打包 APK（${res.package_name || 'top.poolux.album'}）`)
      await loadApkJobs([{ id: templateId }])
    } catch (err: any) {
      setMsg(err.message || '打包失败')
    }
    setApkBusy((p) => ({ ...p, [templateId]: false }))
  }

  const handleDownloadApk = async (job: ApkJob, name: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/apk-builds/${job.id}/download`, {
        credentials: 'include',
      })
      if (!res.ok) {
        let errText = '下载失败'
        try {
          const data = await res.json()
          errText = data.error || errText
        } catch { /* ignore */ }
        throw new Error(errText)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'template'}-${job.template_id}.apk`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMsg('APK 下载已开始')
    } catch (err: any) {
      setMsg(err.message || '下载失败')
    }
  }

  if (view === 'create') {
    return (
      <div className="space-y-4">
        <button onClick={() => { setView('list'); load() }} className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          ← 返回列表
        </button>
        <TemplateCreator onSaved={() => load()} />
      </div>
    )
  }

  if (view === 'edit') {
    return (
      <div className="space-y-4">
        <button onClick={() => { setView('list'); load() }} className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          ← 返回列表
        </button>
        <TemplateCreator editTemplate={editData} onSaved={() => { load() }} />
      </div>
    )
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  const msgOk = /成功|已删除|已切换|状态已切换|已开始打包|下载已开始/.test(msg)

  return (
    <div className="space-y-4">
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msgOk ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msgOk ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      <button onClick={() => setView('create')}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-white transition-all"
        style={{ background: 'var(--gradient-accent)' }}>
        <Plus className="w-4 h-4" /> 创建新模板
      </button>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        每个模板可独立打包离线 APK（GitHub Actions 编译，包名 top.poolux.album.t{'{id}'}，图标 dark.svg）
      </p>

      {templates.length === 0 ? (
        <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无模板</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t: any) => {
            const job = apkJobs[t.id]
            const busy = !!apkBusy[t.id] || !!(job && APK_BUSY.has(job.status))
            const statusText = apkStatusLabel(job)
            return (
              <div key={t.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl transition-all group"
                style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', opacity: t.hidden ? 0.5 : 1 }}>
                    {t.name}
                  </p>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {Array.isArray(t.devices) ? t.devices.length : 0} 个设备 · {Array.isArray(t.layers) ? t.layers.length : 0} 个图层
                    {job?.package_name ? ` · ${job.package_name}` : ''}
                  </p>
                  {statusText && (
                    <p className="text-xs mt-1 truncate" style={{
                      color: job?.status === 'failed' ? 'var(--danger)' : job?.status === 'ready' ? 'var(--success)' : 'var(--text-muted)',
                    }}>
                      APK：{statusText}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => handleBuildApk(t.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                    title="打包离线 APK"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                    {busy ? '打包中' : '打包APK'}
                  </button>
                  <button
                    onClick={() => job && handleDownloadApk(job, t.name)}
                    disabled={!job || job.status !== 'ready'}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                    title="下载 APK"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载
                  </button>
                  <button onClick={() => handleEdit(t)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                    title="编辑">
                    编辑
                  </button>
                  <button onClick={() => handleToggleHidden(t.id)}
                    className="p-1.5 rounded-lg transition-all"
                    style={{ color: t.hidden ? 'var(--text-muted)' : 'var(--success)' }}
                    title={t.hidden ? '显示' : '隐藏'}>
                    {t.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(t.id)}
                    className="p-1.5 rounded-lg transition-all"
                    style={{ color: 'var(--danger)' }}
                    title="删除">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- 设置面板 ---
function SettingsPanel({ msg, setMsg, defaultAuthor, setDefaultAuthor }: {
  msg: string; setMsg: (s: string) => void; defaultAuthor: string; setDefaultAuthor: (s: string) => void
}) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [saving, setSaving] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [authorValue, setAuthorValue] = useState(defaultAuthor)

  const handleChangePwd = async () => {
    if (!oldPwd || !newPwd) { setMsg('请填写完整'); return }
    if (newPwd !== newPwd2) { setMsg('两次新密码不一致'); return }
    setSaving(true)
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      })
      setMsg('密码修改成功')
      setOldPwd(''); setNewPwd(''); setNewPwd2('')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleChangeUsername = async () => {
    if (!newUsername.trim()) { setMsg('用户名不能为空'); return }
    setSaving(true)
    try {
      await apiFetch('/api/auth/change-username', {
        method: 'POST',
        body: JSON.stringify({ newUsername: newUsername.trim() }),
      })
      setMsg('用户名修改成功，请重新登录')
      setNewUsername('')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleChangeDefaultAuthor = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/auth/change-default-author', {
        method: 'POST',
        body: JSON.stringify({ defaultAuthor: authorValue }),
      })
      setDefaultAuthor(authorValue)
      setMsg('默认作者名已保存')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="max-w-lg space-y-4">
      <Section title="修改用户名">
        <Field label="新用户名">
          <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
            placeholder="输入新用户名"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <button onClick={handleChangeUsername} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
          {saving ? '修改中...' : '修改用户名'}
        </button>
      </Section>

      <Section title="默认作者名">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>新建资源时自动填充的作者名</p>
        <Field label="作者名">
          <input value={authorValue} onChange={e => setAuthorValue(e.target.value)}
            placeholder="如 @你的名字"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <button onClick={handleChangeDefaultAuthor} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
          {saving ? '保存中...' : '保存'}
        </button>
      </Section>

      <Section title="修改密码">
        <Field label="当前密码">
          <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)}
            placeholder="输入当前密码"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="新密码">
          <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
            placeholder="输入新密码"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="确认新密码">
          <input type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)}
            placeholder="再次输入新密码"
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <button onClick={handleChangePwd} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
          {saving ? '修改中...' : '修改密码'}
        </button>
      </Section>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}
    </div>
  )
}

// --- 通用组件 ---
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  )
}

function DeviceUploadBtn({ deviceName, onUploadBin }: { deviceName: string; onUploadBin: (file: File, deviceName: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept=".bin" onChange={e => {
        const f = e.target.files?.[0]; if (f) onUploadBin(f, deviceName); e.target.value = ''
      }} />
      <button onClick={() => ref.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
        style={{ color: 'var(--accent)', background: 'var(--accent-bg)' }}>
        <Upload className="w-3 h-3" /> 上传 .bin
      </button>
    </>
  )
}

function UploadBtn({ label, onChange, onFiles, multiple }: { label?: string; onChange?: (file: File) => void; onFiles?: (files: File[]) => void; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept="image/*" multiple={multiple} onChange={e => {
        const files = e.target.files
        if (files && files.length > 0) {
          if (onFiles) onFiles(Array.from(files))
          else if (onChange) onChange(files[0])
        }
        e.target.value = ''
      }} />
      <button onClick={() => ref.current?.click()} className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium transition-colors w-full justify-center"
        style={{ border: '2px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
        <Upload className="w-4 h-4" /> {label || '点击上传图片'}
      </button>
    </>
  )
}

// ═══ 首页内容管理（站点设置 + 作品图片 + 团队成员 + 友链） ═══
function HomepageAdmin() {
  return (
    <div className="space-y-10">
      <SiteSettingsSection />
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />
      <WorksSection />
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />
      <TeamMembersSection />
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />
      <section>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>友链管理</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>管理页脚 LINKS 区域的友情链接，支持拖拽排序。</p>
        <FriendsAdmin />
      </section>
    </div>
  )
}

// ── 站点设置 ──
function SiteSettingsSection() {
  const emptySettings = {
    slogan: '',
    intro_line1: '',
    intro_line2: '',
    copyright: '',
    contact_href: '#members',
  }
  const [settings, setSettings] = useState<Record<string, string>>(emptySettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/site-settings') as Record<string, string>
      // 兼容旧字段 hero_slogan
      const next: Record<string, string> = { ...emptySettings, ...data }
      if (!next.slogan && next.hero_slogan) next.slogan = next.hero_slogan
      setSettings(next)
      setMsg('')
    } catch (err: any) {
      setMsg(err.message || '加载站点文案失败，请确认后端 API 已启动')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        slogan: settings.slogan || '',
        intro_line1: settings.intro_line1 || '',
        intro_line2: settings.intro_line2 || '',
        copyright: settings.copyright || '',
        contact_href: settings.contact_href || '#members',
      }
      const result = await apiFetch('/api/site-settings', { method: 'PUT', body: JSON.stringify(payload) })
      if (result?.settings) setSettings({ ...emptySettings, ...result.settings })
      setMsg('保存成功')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const update = (key: string, value: string) => setSettings(prev => ({ ...prev, [key]: value }))

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <section>
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>站点文案</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>编辑首页显示的标语、介绍、版权和联系链接，保存后实时生效。</p>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium mb-3" style={{
          background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
        <Field label="打字机标语">
          <input value={settings.slogan || ''} onChange={e => update('slogan', e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="介绍第一行">
          <input value={settings.intro_line1 || ''} onChange={e => update('intro_line1', e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="介绍第二行">
          <input value={settings.intro_line2 || ''} onChange={e => update('intro_line2', e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="版权文字">
          <input value={settings.copyright || ''} onChange={e => update('copyright', e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <Field label="联系我们跳转链接">
          <input value={settings.contact_href || ''} onChange={e => update('contact_href', e.target.value)}
            placeholder="#members 或 https://..."
            className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
        </Field>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
          <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存站点文案'}
        </button>
      </div>
    </section>
  )
}

// ── 作品图片 ──
function WorksSection() {
  const [images, setImages] = useState<{ id: number; image_url: string; sort_order: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/works')
      setImages(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const result = await apiUploadTo('/api/works/upload', file)
      const imageUrl = `${API_BASE}${result.path}`
      await apiFetch('/api/works', { method: 'POST', body: JSON.stringify({ image_url: imageUrl, sort_order: Date.now() }) })
      await load()
      setMsg('上传成功')
    } catch (err: any) {
      setMsg(err.message)
    }
    setUploading(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该作品图片？')) return
    try {
      await apiFetch(`/api/works/${id}`, { method: 'DELETE' })
      await load()
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <section>
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>作品图片</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>管理首页「我们的作品」区域的图片，上传后自动显示在首页瀑布流画廊中。</p>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium mb-3" style={{
          background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      <label className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium transition-colors cursor-pointer w-fit mb-4"
        style={{ border: '2px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
        <Upload className="w-4 h-4" />
        {uploading ? '上传中...' : '上传作品图片'}
        <input type="file" className="hidden" accept="image/*" multiple onChange={e => {
          const files = e.target.files
          if (files) Array.from(files).forEach(f => handleUpload(f))
          e.target.value = ''
        }} disabled={uploading} />
      </label>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {images.map(img => (
          <div key={img.id} className="rounded-2xl overflow-hidden group" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <div className="rounded-xl overflow-hidden relative" style={{ background: 'var(--bg-tertiary)' }}>
              <img src={img.image_url} alt="" className="w-full object-contain" style={{ maxHeight: '200px' }} loading="lazy" />
              <button onClick={() => handleDelete(img.id)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--danger)', color: '#fff' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {images.length === 0 && (
        <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无作品图片</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>点击上方按钮上传</p>
        </div>
      )}
    </section>
  )
}

// ── 团队成员 ──
interface TeamMember {
  id: number
  name: string
  roles: string[]
  avatar: string
  href: string
  sort_order: number
}

const EMPTY_MEMBER: Omit<TeamMember, 'id' | 'sort_order'> = { name: '', roles: [], avatar: '', href: '' }

function TeamMembersSection() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [rolesInput, setRolesInput] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/team-members')
      setMembers(data as TeamMember[])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditing({ ...EMPTY_MEMBER, id: 0, sort_order: members.length } as TeamMember)
    setRolesInput('')
    setIsNew(true)
    setMsg('')
  }

  const openEdit = (m: TeamMember) => {
    setEditing({ ...m })
    setRolesInput(m.roles.join('\n'))
    setIsNew(false)
    setMsg('')
  }

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) { setMsg('请输入姓名'); return }
    setSaving(true)
    try {
      const roles = rolesInput.split('\n').map(s => s.trim()).filter(Boolean)
      const body = {
        ...editing,
        roles,
        href: toExternalUrl(editing.href),
        sort_order: editing.sort_order || members.length,
      }
      if (isNew) {
        await apiFetch('/api/team-members', { method: 'POST', body: JSON.stringify(body) })
      } else {
        await apiFetch(`/api/team-members/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) })
      }
      setEditing(null)
      await load()
      setMsg(isNew ? '添加成功' : '保存成功')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该成员？')) return
    try {
      await apiFetch(`/api/team-members/${id}`, { method: 'DELETE' })
      await load()
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleAvatarUpload = async (file: File) => {
    try {
      const result = await apiUploadTo('/api/team-members/upload', file)
      const avatarUrl = `${API_BASE}${result.path}`
      if (editing) setEditing({ ...editing, avatar: avatarUrl })
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleDragStart = (idx: number) => setDragIdx(idx)

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const reordered = [...members]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setMembers(reordered)
    setDragIdx(idx)
  }

  const handleDragEnd = async () => {
    setDragIdx(null)
    const ids = members.map(m => m.id)
    try {
      await apiFetch('/api/team-members/reorder', { method: 'PUT', body: JSON.stringify({ ids }) })
      setMsg('排序已保存')
    } catch (err: any) {
      setMsg(err.message || '排序保存失败')
      await load()
    }
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>团队成员</h2>
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white transition-all"
          style={{ background: 'var(--gradient-accent)' }}>
          <Plus className="w-3.5 h-3.5" /> 添加成员
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>管理首页「我们的团队成员」区域。横向拖动卡片可调整显示顺序，松手后自动保存。</p>

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium mb-3" style={{
          background: msg.includes('成功') || msg.includes('已保存') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') || msg.includes('已保存') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      {/* 横向可拖拽列表 */}
      <div className="flex gap-3 overflow-x-auto pb-2 mb-4" style={{ scrollbarWidth: 'thin' }}>
        {members.map((m, idx) => (
          <div
            key={m.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className="flex-shrink-0 w-56 flex flex-col items-center gap-3 p-4 rounded-2xl group cursor-grab active:cursor-grabbing select-none"
            style={{
              background: dragIdx === idx ? 'var(--accent-bg)' : 'var(--bg-secondary)',
              boxShadow: dragIdx === idx ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
              opacity: dragIdx === idx ? 0.7 : 1,
              border: dragIdx === idx ? '1px solid var(--accent)' : '1px solid transparent',
            }}
          >
            <div className="w-full flex items-center justify-between">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                #{idx + 1}
              </span>
              <GripVertical className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <img src={m.avatar || '/dark.svg'} alt={m.name} className="w-14 h-14 rounded-full object-cover" draggable={false} />
            <div className="w-full text-center min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{m.roles.join(' / ')}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => openEdit(m)} className="px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                编辑
              </button>
              <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded-lg"
                style={{ color: 'var(--danger)' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {members.length === 0 && (
        <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无团队成员</p>
        </div>
      )}

      {/* 编辑/新建弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-primary)', boxShadow: 'var(--shadow-card)' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{isNew ? '添加成员' : '编辑成员'}</h3>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>姓名</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>角色（每行一个）</label>
              <textarea value={rolesInput} onChange={e => setRolesInput(e.target.value)} rows={3}
                className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>头像</label>
              <div className="flex items-center gap-3">
                {editing.avatar && <img src={editing.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs cursor-pointer"
                  style={{ border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
                  <Upload className="w-3.5 h-3.5" /> 上传头像
                  <input type="file" className="hidden" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ''
                  }} />
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>链接地址</label>
              <input value={editing.href} onChange={e => setEditing({ ...editing, href: e.target.value })}
                className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                placeholder="https://..." />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>可不写协议，保存时自动补全 https://</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-medium text-white"
                style={{ background: 'var(--gradient-accent)' }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}