import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Navbar } from '@/components/Navbar'
import { apiFetch } from '@/lib/api'
import { DEFAULT_TERMS_SETTINGS, type TermsSettings } from '@/lib/termsContent'

type TermsResponse = {
  initialized: boolean
  terms: TermsSettings
}

export function Terms() {
  const [settings, setSettings] = useState<TermsSettings>(DEFAULT_TERMS_SETTINGS)

  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/api/terms', { signal: controller.signal })
      .then((data: TermsResponse) => {
        if (data.initialized && data.terms) setSettings(data.terms)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-12 pb-32">
        <Link to="/" className="inline-flex items-center gap-2 mb-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" />
          返回首页
        </Link>

        <h1 className="text-2xl font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>
          {settings.terms_title}
        </h1>

        <div className="text-sm leading-relaxed space-y-4" style={{ color: 'var(--text-secondary)' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2 className="text-xl font-semibold pt-4" style={{ color: 'var(--text-primary)' }}>{children}</h2>,
              h2: ({ children }) => <h2 className="text-base font-semibold pt-4" style={{ color: 'var(--text-primary)' }}>{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold pt-3" style={{ color: 'var(--text-primary)' }}>{children}</h3>,
              p: ({ children }) => <p>{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-6 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-6 space-y-1">{children}</ol>,
              blockquote: ({ children }) => <blockquote className="pl-4 py-1" style={{ borderLeft: '3px solid var(--border-color)', color: 'var(--text-muted)' }}>{children}</blockquote>,
              a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{children}</a>,
              code: ({ children }) => <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{children}</code>,
              table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>,
              th: ({ children }) => <th className="px-3 py-2 font-semibold" style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>{children}</th>,
              td: ({ children }) => <td className="px-3 py-2" style={{ border: '1px solid var(--border-color)' }}>{children}</td>,
              hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--border-color)' }} />,
            }}
          >
            {settings.terms_content}
          </ReactMarkdown>
        </div>

        {(settings.terms_updated_at || settings.terms_signature) && (
          <div className="mt-12 pt-6 text-sm text-right" style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
            {settings.terms_updated_at && <p>{settings.terms_updated_at}</p>}
            {settings.terms_signature && <p className="mt-1">{settings.terms_signature}</p>}
          </div>
        )}
      </main>
    </div>
  )
}