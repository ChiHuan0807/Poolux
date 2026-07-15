import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { Search } from 'lucide-react'
import { apiFetch } from '@/lib/api'

interface DeviceOption {
  id: string
  label: string
  downloadUrl: string
}

export interface Resource {
  id: string
  name: string
  icon: string
  banner?: string
  banners: string[]
  author?: string
  description?: string
  devices: string[]
  paid: boolean
  hidden?: boolean
  purchase_link?: string
  device_options?: DeviceOption[]
  deviceOptions?: DeviceOption[]
}

// Fisher-Yates 洗牌
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 所有不重复的设备名
function getAllDevices(list: Resource[]) {
  return [...new Set(list.flatMap(r => r.devices))]
}

export function Resources() {
  const [query, setQuery] = useState('')
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const ac = new AbortController()
    apiFetch('/api/resources', { signal: ac.signal })
      .then((data: Resource[]) => setResources(data))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [])

  const ALL_DEVICES = useMemo(() => getAllDevices(resources), [resources])

  const displayList = useMemo(() => {
    let base = resources
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      base = base.filter(r => r.name.toLowerCase().includes(q) || r.devices.some(d => d.toLowerCase().includes(q)))
    }
    if (deviceFilter) {
      base = base.filter(r => r.devices.includes(deviceFilter))
    }
    return shuffle(base)
  }, [query, deviceFilter, resources])

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />

      <main className="flex-1 relative z-10 overflow-auto no-scrollbar">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 py-10 lg:py-16">
          {/* 标题 */}
          <div className="text-center mb-8 lg:mb-12">
            <h1 className="section-title">资源下载</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8 }}>下载表盘资源</p>
          </div>

          {/* 搜索框 + 设备筛选 */}
          <div className="max-w-2xl mx-auto mb-10 lg:mb-14">
            <div
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
            >
              <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索资源名称..."
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--text-primary)' }}
              />
              {deviceFilter && (
                <button
                  onClick={() => setDeviceFilter(null)}
                  className="text-xs px-2 py-0.5 rounded-md transition-colors"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}
                >
                  {deviceFilter} ×
                </button>
              )}
            </div>
            {/* 设备筛选按钮 */}
            <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
              {ALL_DEVICES.map(d => (
                <button
                  key={d}
                  onClick={() => setDeviceFilter(deviceFilter === d ? null : d)}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: deviceFilter === d ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: deviceFilter === d ? '#fff' : 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* 资源网格 - 两列 */}
          {loading ? (
            <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>加载中...</p>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>暂无相关资源</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-5">
              {displayList.map(item => (
                <ResourceCard key={item.id} item={item} onClick={() => navigate(`/resources/${item.id}`)} />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] mt-8 pb-4" style={{ color: 'var(--text-muted)' }}>
          付费资源仅收取设计、打包费用，图片素材版权归属原作者，如有侵权请联系
        </p>
      </main>
    </div>
  )
}

function ResourceCard({ item, onClick }: { item: Resource; onClick: () => void }) {
  return (
    <div
      className="flex items-center gap-4 p-3 lg:p-4 rounded-xl transition-all cursor-pointer"
      style={{ background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)' }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-elevated)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
      }}
    >
      {/* 左侧图标 */}
      <div
        className="flex-shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-tertiary)' }}
      >
        <img
          src={item.icon}
          alt={item.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* 右侧信息 */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm lg:text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {item.name}
        </h3>
        <p className="text-xs lg:text-sm mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
          {item.author ?? '未知作者'}
        </p>
      </div>

      {/* 价格标签 + 购买按钮 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {item.paid ? (
          <span
            className="px-3 py-1 rounded-lg text-xs font-medium"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            付费
          </span>
        ) : (
          <span
            className="px-3 py-1 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(48, 209, 88, 0.1)', color: '#30D158' }}
          >
            免费
          </span>
        )}
      </div>
    </div>
  )
}