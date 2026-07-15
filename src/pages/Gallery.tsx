import { useState, useEffect, useCallback, useRef } from 'react'
import { Navbar } from '@/components/Navbar'
import { apiFetch, apiUploadTo, API_BASE } from '@/lib/api'
import { Upload, Trash2, Edit3, Save, ChevronLeft, Menu, X, Filter, ChevronRight, Check, Download, Search } from 'lucide-react'

interface GalleryImage {
  id: number
  image_url: string
  watch_face_name: string
  watch_face_model: string
  character_name: string
  device: string
  sort_order: number
  created_at: string
}

const DEVICES = ['小米手环 10', '小米手环 Pro', 'REDMI Watch 6']

// 相册表盘模板（自动获取自表盘编辑页）
const TEMPLATES = ['「Canopy UI」', '「时语」', '「Layer UI」']

/* ═══ 公开浏览页面 ═══ */
export function Gallery() {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [activeDevice, setActiveDevice] = useState<string>('all')
  const [filterTemplate, setFilterTemplate] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/gallery', { signal: ac.signal }).then((data: GalleryImage[]) => {
      setImages(data)
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => ac.abort()
  }, [])

  // 动态获取实际存在的设备列表
  const actualDevices = [...new Set(images.map(i => i.device).filter(Boolean))]

  // 当前筛选下的所有模板名
  const templates = [...new Set(
    images
      .filter(i => activeDevice === 'all' || i.device === activeDevice)
      .filter(i => !filterTemplate || i.watch_face_name === filterTemplate)
      .map(i => i.watch_face_name)
      .filter(Boolean)
  )]

  // 筛选后的图片
  const q = searchQuery.trim().toLowerCase()
  const filtered = images.filter(i => {
    if (activeDevice !== 'all' && i.device !== activeDevice) return false
    if (filterTemplate && i.watch_face_name !== filterTemplate) return false
    if (q && !i.watch_face_name?.toLowerCase().includes(q) && !i.character_name?.toLowerCase().includes(q)) return false
    return true
  })

  const sidebarContent = (
    <nav className="space-y-1">
      <button onClick={() => { setActiveDevice('all'); setFilterTemplate(null); setSidebarOpen(false) }}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all text-left"
        style={{
          background: activeDevice === 'all' ? 'var(--accent-bg)' : 'transparent',
          color: activeDevice === 'all' ? 'var(--accent)' : 'var(--text-secondary)',
        }}>
        <span className="truncate">全部</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0"
          style={{ background: activeDevice === 'all' ? 'var(--accent)' : 'var(--bg-tertiary)', color: activeDevice === 'all' ? '#fff' : 'var(--text-muted)' }}>
          {images.length}
        </span>
      </button>
      {actualDevices.map(d => {
        const count = images.filter(i => i.device === d).length
        return (
          <button key={d} onClick={() => { setActiveDevice(d); setFilterTemplate(null); setSidebarOpen(false) }}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all text-left"
            style={{
              background: activeDevice === d ? 'var(--accent-bg)' : 'transparent',
              color: activeDevice === d ? 'var(--accent)' : 'var(--text-secondary)',
            }}>
            <span className="truncate">{d}</span>
            {count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0"
                style={{ background: activeDevice === d ? 'var(--accent)' : 'var(--bg-tertiary)', color: activeDevice === d ? '#fff' : 'var(--text-muted)' }}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />
      <div className="flex-1 flex overflow-hidden">

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col flex-shrink-0
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `} style={{
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border-color)',
          top: '60px',
        }}>
          <div className="flex items-center justify-between px-4 py-4 lg:hidden" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>设备分类</span>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-xl" style={{ color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 flex-1 overflow-auto no-scrollbar">
            {sidebarContent}
          </div>
        </aside>

        <main className="flex-1 relative z-10 overflow-auto no-scrollbar">
          <div className="flex items-center gap-3 px-4 py-3 lg:hidden" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-xl" style={{ color: 'var(--text-primary)' }}>
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {activeDevice === 'all' ? '全部' : activeDevice}
            </h1>
          </div>

          <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
            <div className="hidden lg:flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {activeDevice === 'all' ? '全部' : activeDevice}
              </h1>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} 张图片</span>
            </div>

            {/* 搜索框 */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索 IP 名称或角色名..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {templates.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <Filter className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <button onClick={() => setFilterTemplate(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: !filterTemplate ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                    color: !filterTemplate ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${!filterTemplate ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}>全部</button>
                {templates.map(t => (
                  <button key={t} onClick={() => setFilterTemplate(filterTemplate === t ? null : t)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                    style={{
                      background: filterTemplate === t ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                      color: filterTemplate === t ? 'var(--accent)' : 'var(--text-secondary)',
                      border: `1px solid ${filterTemplate === t ? 'var(--accent)' : 'var(--border-color)'}`,
                    }}>{t}</button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>该设备暂无相册图片</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>请在管理后台上传</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filtered.map(img => (
                  <div key={img.id} className="rounded-2xl overflow-hidden group/card" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', padding: '12px' }}>
                    <div className="relative overflow-hidden rounded-xl" style={{ height: '240px' }}>
                      <img src={img.image_url} alt={img.watch_face_name} className="w-full h-full object-contain" loading="lazy" />
                      <a
                        href={img.image_url}
                        download
                        className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity backdrop-blur-sm"
                        style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
                        onClick={(e) => e.stopPropagation()}
                        title="下载图片"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                    <div className="mt-3">
                      {img.watch_face_name && <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{img.watch_face_name}</p>}
                      {img.character_name && <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--accent)' }}>{img.character_name}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-center text-xs mt-8 pb-4" style={{ color: 'var(--text-secondary)' }}>
            本页面图片素材归属原版权方所有，为学习分享使用，非商用，如有侵权请联系
          </p>
        </main>
      </div>
    </div>
  )
}

/* ═══ 管理面板组件（供 Admin 页面内嵌）═══ */
export function GalleryAdmin() {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<GalleryImage | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [adminSearch, setAdminSearch] = useState('')

  const aq = adminSearch.trim().toLowerCase()
  const adminFiltered = aq
    ? images.filter(i => i.watch_face_name?.toLowerCase().includes(aq) || i.character_name?.toLowerCase().includes(aq))
    : images

  // 上传弹窗
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadDevice, setUploadDevice] = useState(DEVICES[0])

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/gallery')
      setImages(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const doUpload = async () => {
    if (pendingFiles.length === 0) return
    setUploading(true)
    try {
      for (const file of pendingFiles) {
        const result = await apiUploadTo('/api/gallery/upload', file)
        const imageUrl = `${API_BASE}${result.path}`
        await apiFetch('/api/gallery', { method: 'POST', body: JSON.stringify({ image_url: imageUrl, device: uploadDevice }) })
      }
      await load()
      setMsg(`成功上传 ${pendingFiles.length} 张图片`)
    } catch (err: any) {
      setMsg(err.message)
    }
    setUploading(false)
    setShowUploadModal(false)
    setPendingFiles([])
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await apiFetch(`/api/gallery/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) })
      await load()
      setEditing(null)
      setMsg('保存成功')
    } catch (err: any) {
      setMsg(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除？')) return
    try {
      await apiFetch(`/api/gallery/${id}`, { method: 'DELETE' })
      await load()
      if (editing?.id === id) setEditing(null)
    } catch (err: any) {
      setMsg(err.message)
    }
  }

  const handleUploadClick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    setPendingFiles(Array.from(files))
    setShowUploadModal(true)
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div className="space-y-4">
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-medium" style={{
          background: msg.includes('成功') ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)',
          color: msg.includes('成功') ? 'var(--success)' : 'var(--danger)',
        }}>{msg}</div>
      )}

      {/* 上传弹窗 */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setShowUploadModal(false); setPendingFiles([]) }}>
          <div className="rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4" style={{ background: 'var(--bg-primary)', boxShadow: 'var(--shadow-elevated)' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>选择设备</h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>即将上传 {pendingFiles.length} 张图片到：</p>
            <div className="space-y-1">
              {DEVICES.map(d => (
                <button key={d} onClick={() => setUploadDevice(d)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left"
                  style={{
                    background: uploadDevice === d ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                    color: uploadDevice === d ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${uploadDevice === d ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}>
                  {uploadDevice === d && <Check className="w-3.5 h-3.5" />}
                  {d}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowUploadModal(false); setPendingFiles([]) }}
                className="flex-1 py-2.5 rounded-xl text-xs font-medium" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>取消</button>
              <button onClick={doUpload} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-xs font-medium text-white transition-all"
                style={{ background: 'var(--gradient-accent)', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setEditing(null)} className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <ChevronLeft className="w-4 h-4" /> 返回列表
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: 'var(--gradient-accent)', opacity: saving ? 0.6 : 1 }}>
              {saving ? '保存中...' : <><Save className="w-4 h-4" /> 保存</>}
            </button>
          </div>

          <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
            <div className="max-w-[200px] rounded-xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <img src={editing.image_url} alt="" className="w-full object-contain" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>设备</label>
              <select value={editing.device} onChange={e => setEditing({ ...editing, device: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                <option value="">未分类</option>
                {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>相册表盘模板</label>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map(t => (
                  <button key={t} onClick={() => setEditing({ ...editing, watch_face_name: editing.watch_face_name === t ? '' : t })}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                    style={{
                      background: editing.watch_face_name === t ? 'var(--accent-bg)' : 'var(--bg-tertiary)',
                      color: editing.watch_face_name === t ? 'var(--accent)' : 'var(--text-secondary)',
                      border: `1px solid ${editing.watch_face_name === t ? 'var(--accent)' : 'var(--border-color)'}`,
                    }}>{t}</button>
                ))}
              </div>
              <input value={editing.watch_face_name} onChange={e => setEditing({ ...editing, watch_face_name: e.target.value })}
                placeholder="或输入自定义模板名"
                className="w-full px-4 py-2.5 mt-2 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>IP 归属（角色名）</label>
              <input value={editing.character_name} onChange={e => setEditing({ ...editing, character_name: e.target.value })}
                placeholder="如 五月猫（可选）"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 上传按钮 */}
          <label className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium transition-colors cursor-pointer w-fit"
            style={{ border: '2px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
            <Upload className="w-4 h-4" />
            {uploading ? '上传中...' : '上传相册图片'}
            <input type="file" className="hidden" accept="image/*" multiple onChange={e => {
              handleUploadClick(e.target.files)
              e.target.value = ''
            }} disabled={uploading} />
          </label>

          <div className="flex gap-6 flex-col lg:flex-row">
            {/* 左侧图片列表 */}
            <div className="lg:w-80 flex-shrink-0 space-y-2 max-h-[60vh] overflow-auto no-scrollbar">
              {/* 搜索框 */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <input
                  value={adminSearch}
                  onChange={e => setAdminSearch(e.target.value)}
                  placeholder="搜索 IP 或角色..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                />
                {adminSearch && (
                  <button onClick={() => setAdminSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {adminFiltered.length === 0 ? (
                <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {adminSearch.trim() ? '无匹配结果' : '暂无相册图片'}
                  </p>
                  {!adminSearch.trim() && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>点击上方按钮上传</p>
                  )}
                </div>
              ) : adminFiltered.map(img => (
                <div key={img.id}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left cursor-pointer relative group"
                  style={{
                    background: editing?.id === img.id ? 'var(--accent-bg)' : 'var(--bg-secondary)',
                    boxShadow: editing?.id === img.id ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
                  }}
                  onClick={() => setEditing({ ...img })}>
                  <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                    <img src={img.image_url} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {img.watch_face_name || '未命名'}
                    </p>
                    <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {img.device || '未分类'}
                      {img.character_name && ` · ${img.character_name}`}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(img.id) }}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--danger)', color: '#fff' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* 右侧详情 */}
            <div className="flex-1 min-w-0">
              <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>选择左侧图片进行编辑</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}