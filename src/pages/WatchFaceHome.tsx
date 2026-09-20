import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, LayoutGrid, RefreshCw, TriangleAlert } from 'lucide-react'
import { Navbar } from '@/components/Navbar'
import { apiFetch, API_BASE } from '@/lib/api'

// 公开接口只返回卡片需要的字段：模板名 + 1:1 封面图。
// 简介（description）已下线，封面也不再由服务端自动合成。
interface TemplateCard {
  id: number
  name: string
  preview_image: string
}

type LoadState = 'loading' | 'ready' | 'error'

/** 骨架数量取桌面端两行的量（一行 4 个），加载完成前后网格高度不跳动 */
const SKELETON_COUNT = 8

// 一行几列由 .tpl-grid 的 CSS 变量控制：手机 2 列、平板 3 列、桌面 4 列，最后一行不满时居中
const GRID_CLASS = 'tpl-grid'

function assetUrl(path: string): string {
  if (!path) return ''
  return /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`
}

function CardSkeleton() {
  return (
    <div className="tpl-skeleton" aria-hidden="true">
      <div className="tpl-skeleton__cover" />
      <div className="tpl-skeleton__bar">
        <div className="tpl-skeleton__line" />
      </div>
    </div>
  )
}

/** 空态与错误态：版式与后台其他空态保持一致（圆角面板 + 图标 + 说明 + 可选操作） */
function StatePanel({ tone, title, hint, action }: {
  tone: 'muted' | 'danger'
  title: string
  hint: string
  action?: { label: string; onClick: () => void }
}) {
  const danger = tone === 'danger'
  const Icon = danger ? TriangleAlert : LayoutGrid
  return (
    <div className="text-center py-14 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
      <span
        className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-3"
        style={{
          background: danger ? 'rgba(255, 59, 48, 0.1)' : 'var(--bg-tertiary)',
          color: danger ? 'var(--danger)' : 'var(--text-muted)',
        }}
      >
        <Icon className="w-5 h-5" />
      </span>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl text-xs font-medium transition-all"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', cursor: 'pointer' }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {action.label}
        </button>
      )}
    </div>
  )
}

export function WatchFaceHome() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateCard[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  // 封面图已解码的模板 id 集合（骨架微光照上面再停掉）
  const [loadedCovers, setLoadedCovers] = useState<Record<number, boolean>>({})

  // 重试：bump reloadKey 让下面的 effect 重新拉一次
  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    apiFetch('/api/templates', { signal: controller.signal })
      .then((data: TemplateCard[]) => {
        setTemplates(Array.isArray(data) ? data : [])
        setState('ready')
      })
      .catch((err: unknown) => {
        // 卸载或重试导致的主动取消不算失败
        if ((err as { name?: string })?.name === 'AbortError') return
        setState('error')
      })
    return () => controller.abort()
  }, [reloadKey])

  const openTemplate = useCallback(
    (id: number) => navigate(`/tools/watch-face/edit-template/${id}`),
    [navigate],
  )

  // 封面图解码完成的模板：没解码完之前封面铺一层微光骨架，解码完成后停掉动画
  const markCoverLoaded = useCallback((id: number) => {
    setLoadedCovers(prev => (prev[id] ? prev : { ...prev, [id]: true }))
  }, [])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />
      <main className="flex-1 relative z-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-10 lg:py-14">
          <header className="text-center mb-12 lg:mb-16">
            <h1 className="section-title">相册表盘模板库</h1>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8 }}>
              选择一款心仪的相册表盘，上传图片 DIY 专属表盘
            </p>
          </header>

          {state === 'loading' && (
            <>
              <p className="sr-only" role="status">正在加载模板…</p>
              <div className={GRID_CLASS}>
                {Array.from({ length: SKELETON_COUNT }, (_, i) => <CardSkeleton key={i} />)}
              </div>
            </>
          )}

          {state === 'error' && (
            <StatePanel
              tone="danger"
              title="模板加载失败"
              hint="请检查网络后重试，或稍后再来看看"
              action={{ label: '重新加载', onClick: () => setReloadKey(k => k + 1) }}
            />
          )}

          {state === 'ready' && templates.length === 0 && (
            <StatePanel
              tone="muted"
              title="暂无模板"
              hint="模板正在准备中，稍后再来看看"
            />
          )}

          {state === 'ready' && templates.length > 0 && (
            <div className={GRID_CLASS}>
              {templates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className="tpl-card"
                  onClick={() => openTemplate(template.id)}
                >
                  <div
                    className={
                      'tpl-card__cover' +
                      (template.preview_image && !loadedCovers[template.id] ? ' is-loading' : '')
                    }
                  >
                    {template.preview_image ? (
                      // 封面是装饰性的：卡片名由下面的文字提供，避免读屏重复念一遍
                      <img
                        src={assetUrl(template.preview_image)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onLoad={() => markCoverLoaded(template.id)}
                        // 命中缓存时 load 事件可能早于 React 挂载，这里补一次判断，避免微光一直转
                        ref={el => { if (el?.complete) markCoverLoaded(template.id) }}
                      />
                    ) : (
                      <div className="tpl-card__cover-empty">暂无封面</div>
                    )}
                  </div>
                  <div className="tpl-card__body">
                    <span className="tpl-card__name" title={template.name}>{template.name}</span>
                    <span className="tpl-card__go" aria-hidden="true">
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
