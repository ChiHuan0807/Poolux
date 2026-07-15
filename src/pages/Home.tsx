import { VideoPreview } from '../components/VideoPreview'
import { ControlPanel } from '../components/ControlPanel'
import { Navbar } from '@/components/Navbar'

export function Home() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />

      {/* 主内容 */}
      <main className="flex-1 relative z-10 overflow-hidden min-h-0">
        <div className="h-full px-4 lg:px-6 py-4 lg:py-5">
          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-5" style={{ height: '100%' }}>
            <div className="lg:col-span-2 min-h-[40vh] lg:min-h-0 h-full">
              <VideoPreview />
            </div>
            <div className="lg:col-span-1 overflow-auto no-scrollbar lg:min-h-0 h-full">
              <ControlPanel />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}