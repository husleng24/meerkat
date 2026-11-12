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
import { ShortcutHelp } from './components/ShortcutHelp'
import { ChatWidget } from './components/ChatWidget'
import { useTopics } from './lib/useTopics'
import { useDomains } from './lib/useDomains'

const TITLES: Record<string, string> = {
  search: '搜索',
  sources: '事实源',
  settings: '设置',
  timeline: '时间线',
  onboarding: '开始使用'
}

export default function App(): React.JSX.Element {
  // 指定日期时读历史简报；null 表示最新一期
  const [viewDate, setViewDate] = useState<string | null>(null)
  const {
    topics,
    activeId,
    setActiveId,
    create: createTopic,
    reload: reloadTopics,
    available: topicsAvailable
  } = useTopics()
  const {
    domains,
    create: createDomain,
    rename: renameDomain,
    remove: removeDomain,
    reload: reloadDomains
  } = useDomains()

  // 只有一个选择状态：当前主题。领域由主题推导，不再单独选。
  const activeTopic = topics.find((t) => t.id === activeId)
  const activeDomain = activeTopic?.domainId ?? domains[0]?.id ?? ''
  useEffect(() => {
    if (topics.length === 0) return
    if (!topics.some((t) => t.id === activeId)) setActiveId(topics[0]!.id)
  }, [topics, activeId, setActiveId])

  const { brief, loading, origin, bridgeAvailable, urlToId, comparison, previousDate } = useBriefData(
    viewDate,
    activeId || undefined
  )
  const flags = useFlags(brief, urlToId)
  const sourceState = useSources()
  const { sorted, summary } = useSortedSources(sourceState.sources)
  // 用 hash 做初始路由：便于深链，也便于无头浏览器直接截某一页
  const KNOWN_ROUTES = ['today', 'search', 'timeline', 'sources', 'settings', 'onboarding']
  const hashParts = (typeof location !== 'undefined' ? location.hash : '').replace(/^#+/, '').split('/')
  const [helpOpen, setHelpOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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

  /** 跳到源页并直接展开"新增源"表单（表单里会默认勾上当前主题） */
  const goAddSource = (): void => {
    if (typeof location !== 'undefined') history.replaceState(null, '', '#sources/add')
    setNav('sources')
  }

  /** 选主题：只切换当前主题，页面本身不动 */
  const pickTopic = (id: string): void => {
    setActiveId(id)
  }

  /** 报头右侧的"更新"：和设置页走同一个 run:now，跑完靠 brief:updated 广播刷新界面 */
  const refresh = async (): Promise<void> => {
    const api = window.meerkat?.runNow
    if (!api || refreshing) return
    setRefreshing(true)
    try {
      await api(activeId || undefined)
    } finally {
      setRefreshing(false)
    }
  }

  const dateLabel = brief?.title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''

  // ⌘1–9 直接切主题：侧栏是扁平列表，序号就是列表顺序（跨领域也成立）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const t = topics[n - 1]
      if (!t) return
      e.preventDefault()
      setActiveId(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [topics, setActiveId])

  // Ctrl/Cmd+K 跳到搜索：这是阅读器里最常用的一个动作
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        go('search')
      }
      // 输入框里打问号是正常输入，不能抢
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.key === '?' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        setHelpOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        active={nav}
        topics={topics}
        activeTopic={activeId}
        onPickTopic={pickTopic}
        topicsAvailable={topicsAvailable}
        onCreateTopic={async (input) => createTopic({ ...input, domainId: activeDomain })}
        onNavigate={go}
        attentionSources={summary.attention}
        origin={origin}
        bridgeAvailable={bridgeAvailable}
        dateLabel={dateLabel}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 今日页不设页头：报头在内容里，页头会跟它抢同一件事 */}
        {nav !== 'today' && (
          <header className="flex items-baseline gap-3 px-10 pb-3 pt-6">
            <h1 className="text-[20px] font-bold tracking-[-0.03em] text-ink">
              {TITLES[nav] ?? brief?.title ?? '简报'}
            </h1>
            <span className="hidden text-[11.5px] text-ink-3 md:inline">
              {nav === 'sources'
                ? `${summary.total} 个`
                : nav === 'settings'
                  ? '排程 · 运行 · 导出'
                  : nav === 'search'
                    ? '全文检索（Ctrl/Cmd+K）'
                    : nav === 'timeline'
                      ? '历史简报'
                      : ''}
            </span>
          </header>
        )}

        <div className="lumen-glow" />
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {loading && <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>}

          {!loading && nav === 'today' && !brief && (
            <div className="px-10 py-16">
              <div className="text-[13px] text-ink-3">
                「{topics.find((t) => t.id === activeId)?.name ?? '这个领域'}」还没有简报
              </div>
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                className="mt-3 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {refreshing ? '运行中…' : '立即采集'}
              </button>
            </div>
          )}

          {!loading && brief && nav === 'today' && (
            <BriefView
              brief={brief}
              flags={flags}
              comparison={comparison}
              previousDate={previousDate}
              onRefresh={() => void refresh()}
              refreshing={refreshing}
              topicName={topics.find((t) => t.id === activeId)?.name}
            />
          )}

          {nav === 'search' && <SearchPage />}

          {nav === 'sources' && (
            <SourcesPage
              state={sourceState}
              sorted={sorted}
              summary={summary}
              initialAdding={subRoute === 'add'}
              initialEdit={subRoute === 'edit'}
              domains={domains}
              topics={topics}
              activeDomain={activeDomain}
              activeTopic={activeId}
              onCreateTopic={async (input) => createTopic({ ...input, domainId: activeDomain })}
              onTopicsChanged={reloadTopics}
            />
          )}

          {nav === 'settings' && (
            <SettingsPage
              topicId={activeId}
              topics={topics}
              domains={domains}
              onPickTopic={setActiveId}
              onTopicsChanged={reloadTopics}
              onCreateDomain={createDomain}
              onRenameDomain={renameDomain}
              onRemoveDomain={removeDomain}
              onDomainsChanged={reloadDomains}
              onAddSource={goAddSource}
            />
          )}

          {nav === 'onboarding' && (
            <Onboarding sourceCount={summary.total} createTopic={createTopic} onDone={() => go('today')} />
          )}

          {nav === 'timeline' && (
            <TimelinePage
              topicId={activeId || undefined}
              current={dateLabel}
              onOpen={(d) => {
                setViewDate(d)
                go('today')
              }}
            />
          )}

          {nav === 'today' && viewDate && (
            <div className="mx-auto mt-5 flex max-w-[780px] items-center gap-2 rounded-lg bg-accent-soft/60 px-4 py-2 text-[11.5px] text-ink-2">
              正在回看 {viewDate}
              <button onClick={() => setViewDate(null)} className="ml-auto font-medium text-accent hover:underline">
                回到最新
              </button>
            </div>
          )}
        </div>
      </main>

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {activeId && (
        <ChatWidget topicId={activeId} briefDate={dateLabel} hasPrevious={previousDate.length > 0} />
      )}
    </div>
  )
}
