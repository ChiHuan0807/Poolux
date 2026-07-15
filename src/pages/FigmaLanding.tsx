import { RiDownloadLine, RiMessage3Line } from '@remixicon/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { apiFetch } from '@/lib/api'
import { toExternalUrl } from '@/lib/utils'
import './FigmaLanding.css'

const FALLBACK_WATCH_FACES = Array.from(
  { length: 11 },
  (_, index) => `/wf${index + 1}.webp`,
)

type SiteSettings = {
  slogan: string
  intro_line1: string
  intro_line2: string
  copyright: string
  contact_href: string
}

const DEFAULT_SETTINGS: SiteSettings = {
  slogan: '为小米腕上设备打造精致第三方表盘，让腕间与众不同。',
  intro_line1: 'POOLUX Studio，致力于为您打造更加美观、个性化的小米腕上设备表盘。',
  intro_line2: '这是我们的官网，收纳了我们制作的一些实用工具，并且集成了资源下载。',
  copyright: '© 2026 POOLUX Studio. All rights reserved.',
  contact_href: '#members',
}

type FriendLink = {
  id: number
  name: string
  url: string
}

type TeamMember = {
  id?: number
  name: string
  roles: string[]
  avatar: string
  href: string
}

const DEFAULT_MEMBERS: TeamMember[] = [
  {
    name: '池焕不是池焕',
    roles: ['网站构建、设计', '表盘设计'],
    avatar: '/ChiHuan.webp',
    href: 'https://space.bilibili.com/674795502',
  },
  {
    name: '山荼_skat',
    roles: ['表盘设计'],
    avatar: '/ShanTu.webp',
    href: 'https://www.bandbbs.cn/members/2567401/',
  },
  {
    name: 'AzumaChiaki',
    roles: ['技术支持'],
    avatar: '/AzumaChiaki.webp',
    href: 'https://github.com/AzumaChiaki',
  },
  {
    name: 'Fmkli',
    roles: ['技术支持'],
    avatar: '/Fmkli.webp',
    href: 'https://lli.moe/',
  },
]

const FALLBACK_FOOTER_LINKS = [
  { label: '米坛社区', href: 'https://www.bandbbs.cn/' },
  { label: 'lii.moe', href: 'https://lli.moe/' },
  { label: 'Azuma Studio', href: 'https://azumachiaki.com/' },
  { label: 'EVOA', href: 'https://evoa.top/' },
]

function HeroArtwork() {
  return (
    <div className="figma-home__hero-art" aria-hidden="true">
      <div className="figma-home__art-card figma-home__art-card--back">
        <img src="/wf3.webp" alt="" />
      </div>
      <div className="figma-home__art-card figma-home__art-card--middle">
        <img src="/wf4.webp" alt="" />
      </div>
      <div className="figma-home__art-card figma-home__art-card--front">
        <img src="/wf2.webp" alt="" />
      </div>
    </div>
  )
}

const TYPING_SPEED = 80
const DELETING_SPEED = 40
const PAUSE_AFTER_TYPED = 1800
const PAUSE_AFTER_DELETED = 600

function TypewriterSlogan({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('')
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'deleting' | 'idle'>('typing')
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current

  // 当文本变化时重置动画
  useEffect(() => {
    setDisplayed('')
    setPhase('typing')
  }, [text])

  useEffect(() => {
    if (reducedMotion) {
      setDisplayed(text)
      return
    }

    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      setPhase((currentPhase) => {
        setDisplayed((prev) => {
          if (currentPhase === 'typing') {
            const next = text.slice(0, prev.length + 1)
            if (next.length === text.length) {
              timer = setTimeout(() => setPhase('pausing'), TYPING_SPEED)
              return next
            }
            timer = setTimeout(tick, TYPING_SPEED)
            return next
          }

          if (currentPhase === 'pausing') {
            timer = setTimeout(() => setPhase('deleting'), PAUSE_AFTER_TYPED)
            return prev
          }

          if (currentPhase === 'deleting') {
            const next = prev.slice(0, -1)
            if (next.length === 0) {
              timer = setTimeout(() => setPhase('typing'), PAUSE_AFTER_DELETED)
              return ''
            }
            timer = setTimeout(tick, DELETING_SPEED)
            return next
          }

          return prev
        })
        return currentPhase
      })
    }

    timer = setTimeout(tick, TYPING_SPEED)
    return () => clearTimeout(timer)
  }, [reducedMotion])

  const showCursor = phase !== 'idle' && !(reducedMotion && displayed === text)

  return (
    <p className="figma-home__slogan">
      {displayed}
      {showCursor && <span className="figma-home__slogan-cursor" aria-hidden="true">|</span>}
    </p>
  )
}

type WorkImage = {
  id: number
  image_url: string
}

const repeatToLength = (images: string[], minimum: number) =>
  Array.from({ length: Math.max(minimum, images.length) }, (_, index) => images[index % images.length])

function WorksWall({ images }: { images: string[] }) {
  const wallRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const rows = useMemo(() => {
    const repeated = repeatToLength(images, 18)
    return [repeated, [...repeated].reverse(), repeated]
  }, [images])

  useEffect(() => {
    let progress = 0
    let raf = 0

    const step = () => {
      const wall = wallRef.current
      if (wall) {
        const rect = wall.getBoundingClientRect()
        const travel = window.innerHeight + rect.height
        const target = Math.max(0, Math.min(1, (window.innerHeight - rect.top) / travel))
        progress += (target - progress) * 0.12
        if (Math.abs(target - progress) < 0.0003) progress = target
      }

      rowRefs.current.forEach((row, rowIndex) => {
        if (!row) return
        const direction = rowIndex === 1 ? 1 : -1
        const start = rowIndex === 1 ? -42 : 4
        row.style.transform = `translate3d(${start + direction * progress * 42}vw, 0, 0)`
      })

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wallRef} className="figma-home__works-wall" aria-label="表盘作品展示">
      {rows.map((row, rowIndex) => (
        <div className="figma-home__works-row-clip" key={rowIndex}>
          <div
            ref={(element) => { rowRefs.current[rowIndex] = element }}
            className="figma-home__works-row"
          >
            {row.map((src, imageIndex) => (
              <img
                key={`${rowIndex}-${imageIndex}-${src}`}
                src={src}
                alt="POOLUX 表盘作品"
                loading="lazy"
                draggable={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function FigmaLanding() {
  const [workImages, setWorkImages] = useState(FALLBACK_WATCH_FACES)
  const [members, setMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS)
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)
  const [footerLinks, setFooterLinks] = useState(FALLBACK_FOOTER_LINKS)
  const [heroReady, setHeroReady] = useState(false)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setHeroReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    let disposed = false

    const loadWorks = async () => {
      try {
        const works = await apiFetch('/api/works') as WorkImage[]
        if (!disposed && works.length > 0) {
          setWorkImages(works.map((work) => work.image_url))
        }
      } catch { /* ignore */ }
    }

    const loadMembers = async () => {
      try {
        const data = await apiFetch('/api/team-members') as TeamMember[]
        if (!disposed && data.length > 0) {
          setMembers(data)
        }
      } catch { /* ignore */ }
    }

    const loadSettings = async () => {
      try {
        const data = await apiFetch('/api/site-settings') as SiteSettings
        if (!disposed) setSettings(data)
      } catch { /* ignore */ }
    }

    const loadFriends = async () => {
      try {
        const data = await apiFetch('/api/friends') as FriendLink[]
        if (!disposed && data.length > 0) {
          setFooterLinks(data.map(f => ({ label: f.name, href: toExternalUrl(f.url) })))
        }
      } catch { /* ignore */ }
    }

    void loadWorks()
    void loadMembers()
    void loadSettings()
    void loadFriends()
    const refresh = () => { void loadWorks(); void loadMembers(); void loadSettings(); void loadFriends() }
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={`figma-home${heroReady ? ' figma-home--hero-ready' : ''}`}>
      <Navbar />

      <main>
        <section className="figma-home__hero">
          <div className="figma-home__hero-viewport">
            <div className="figma-home__hero-stage">
              <div className="figma-home__hero-copy">
                <h1>POOLUX</h1>
                <TypewriterSlogan text={settings.slogan} />
                <p className="figma-home__intro">
                  <span>{settings.intro_line1}</span>
                  <span>{settings.intro_line2}</span>
                </p>
                <div className="figma-home__actions">
                  <Link className="figma-home__button figma-home__button--primary" to="/resources">
                    <RiDownloadLine aria-hidden="true" />
                    <span>资源下载</span>
                  </Link>
                  <a className="figma-home__button figma-home__button--secondary" href={settings.contact_href}>
                    <RiMessage3Line aria-hidden="true" />
                    <span>联系我们</span>
                  </a>
                </div>
              </div>
              <HeroArtwork />
            </div>
          </div>
        </section>

        <section className="figma-home__works" id="works">
          <div className="figma-home__section-heading">
            <h2>我们的一些作品</h2>
            <p>Our Stuff</p>
          </div>
          <WorksWall images={workImages} />
        </section>

        <section className="figma-home__members" id="members">
          <div className="figma-home__section-heading">
            <h2>我们的团队成员</h2>
            <p>Our Members</p>
          </div>
          <div className="figma-home__member-rail">
            <div className="figma-home__member-grid">
              {members.map((member) => (
                <a className="figma-home__member-card" href={toExternalUrl(member.href)} target="_blank" rel="noreferrer" key={member.id ?? member.name}>
                  <img src={member.avatar} alt={member.name} loading="lazy" />
                  <h3>{member.name}</h3>
                  <p>{member.roles.map((role) => <span key={role}>{role}</span>)}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="figma-home__footer">
        <div className="figma-home__footer-rule"><span /></div>
        <p className="figma-home__copyright">{settings.copyright}</p>
        <div className="figma-home__footer-links">
          <div>
            <h2>LINKS</h2>
            {footerLinks.map((link) => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.label}>{link.label}</a>
            ))}
          </div>
          <div>
            <h2>LEGAL</h2>
            <Link to="/terms">用户协议</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}