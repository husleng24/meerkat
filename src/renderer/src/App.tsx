import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { BriefView } from './components/BriefView'
import { SourcesPage } from './components/SourcesPage'
import { Onboarding } from './components/Onboarding'
import { SettingsPage } from './components/SettingsPage'
import { TimelinePage } from './components/TimelinePage'
import { SearchPage } from './components/SearchPage'
import { useBriefData } from './lib/useBriefData'
import { useSortedSources, useSources } from './lib/useSources'
import { useFlags } from './lib/useFlags'
import { useEffect } from 'react'

const TITLES: Record<string, string> = {
  search: '搜索',
  sources: '信息源',
  settings: '设置',
  timeline: '时间线',
  onboarding: '开始使用'
}

export default function App(): React.JSX.Element {
  // 指定日期时读历史简报；null 表示最新一期
  const [viewDate, setViewDate] = useState<string | null>(null)
  const { brief, loading, origin, bridgeAvailable, urlToId } = useBriefData(viewDate)
  const flags = useFlags(brief, urlToId)
  const sourceState = useSources()
  const { sorted, summary } = useSortedSources(sourceState.sources)
  // 用 hash 做初始路由：便于深链，也便于无头浏览器直接截某一页
  const KNOWN_ROUTES = ['today', 'search', 'timeline', 'sources', 'settings', 'onboarding']
  const hashParts = (typeof location !== 'undefined' ? location.hash : '').replace(/^#+/, '').split('/')
  const [nav, setNav] = useState<string>(() => {
    const head = hashParts[0]
    // 未知路由一律回落到今日，避免深链写错时界面一片空白
    return head && KNOWN_ROUTES.includes(head) ? head : 'today'
  })
  const subRoute = hashParts[1]
  const go = (id: string): void => {
    setNav(id)
    if (typeof location !== 'undefined') history.replaceState(null, '', '#' + id)
  }

  const itemCount = brief ? brief.sections.reduce((n, s) => n + s.items.length, 0) : 0
  const dateLabel = brief?.title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''

  // Ctrl/Cmd+K 跳到搜索：这是阅读器里最常用的一个动作
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        go('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        active={nav}
        onNavigate={go}
        itemCount={itemCount}
        savedCount={flags.counts.saved}
        readCount={flags.counts.read}
        failedSources={summary.failing}
        origin={origin}
        bridgeAvailable={bridgeAvailable}
        dateLabel={dateLabel}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-cream px-10 py-4">
          <h1 className="text-[15px] font-bold text-ink">{TITLES[nav] ?? brief?.title ?? 'AI 简报'}</h1>
          <span className="hidden text-[11.5px] text-caramel md:inline">
            {nav === 'today'
              ? brief?.meta
              : nav === 'sources'
                ? `${summary.total} 个源`
                : nav === 'settings'
                  ? '排程 · 运行 · 导出'
                  : ''}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <div className="px-10 py-16 text-[13px] text-caramel">加载中…</div>}

          {!loading && nav === 'today' && !brief && (
            <div className="px-10 py-16 text-[13px] text-caramel">还没有简报</div>
          )}

          {!loading && brief && nav === 'today' && <BriefView brief={brief} flags={flags} />}

          {nav === 'search' && <SearchPage />}

          {nav === 'sources' && (
            <SourcesPage
              state={sourceState}
              sorted={sorted}
              summary={summary}
              initialAdding={subRoute === 'add'}
              initialEdit={subRoute === 'edit'}
            />
          )}

          {nav === 'settings' && <SettingsPage />}

          {nav === 'onboarding' && <Onboarding sourceCount={summary.total} onDone={() => go('today')} />}

          {nav === 'timeline' && (
            <TimelinePage
              current={dateLabel}
              onOpen={(d) => {
                setViewDate(d)
                go('today')
              }}
            />
          )}

          {nav === 'today' && viewDate && (
            <div className="mx-auto mt-6 flex max-w-[760px] items-center gap-2 rounded-lg bg-cream/60 px-4 py-2 text-[11.5px] text-ink/70">
              正在回看 {viewDate}
              <button onClick={() => setViewDate(null)} className="ml-auto underline hover:text-ink">
                回到最新
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
