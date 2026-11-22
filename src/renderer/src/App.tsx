import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { NavRail } from './components/NavRail'
import { ContextSidebar } from './components/ContextSidebar'
import { BriefView } from './components/BriefView'
import { SourcesPage } from './components/SourcesPage'
import { Onboarding } from './components/Onboarding'
import { SettingsPage } from './components/SettingsPage'
import { VideoPage } from './components/VideoPage'
import { ReviewPage } from './components/ReviewPage'
import { EntitiesPage } from './components/EntitiesPage'
import { TimelinePage } from './components/TimelinePage'
import { SearchPage } from './components/SearchPage'
import { useBriefData } from './lib/useBriefData'
import { useSortedSources, useSources } from './lib/useSources'
import { useFlags } from './lib/useFlags'
import { useCallback, useEffect } from 'react'
import { ShortcutHelp } from './components/ShortcutHelp'
import { NoChangeView } from './components/NoChangeView'
import { ChatWidget } from './components/ChatWidget'
import { TrackingReview } from './components/TrackingReview'
import { StoriesPage } from './components/StoriesPage'
import { SelectionAgent } from './components/SelectionAgent'
import { TimelineOverlay } from './components/TimelineOverlay'
import { useTopics } from './lib/useTopics'
import { useDomains } from './lib/useDomains'
import { useStoriesSummary } from './lib/useStoriesSummary'
import { useOnboarding } from './lib/useOnboarding'
import { useRunStatus } from './lib/useRunStatus'
import { ModelPrompt } from './components/ModelPrompt'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

const TITLES: Record<string, string> = {
  search: '搜索',
  sources: '事实源',
  settings: '设置',
  timeline: '历史简报',
  stories: '跟踪',
  videos: '视频解读',
  review: '周回顾',
  entities: '实体',
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
    loading: topicsLoading,
    available: topicsAvailable
  } = useTopics()
  const {
    domains,
    create: createDomain,
    rename: renameDomain,
    remove: removeDomain,
    reload: reloadDomains
  } = useDomains()
  const onboarding = useOnboarding()

  // 只有一个选择状态：当前主题。领域由主题推导，不再单独选。
  const activeTopic = topics.find((t) => t.id === activeId)
  const activeDomain = activeTopic?.domainId ?? domains[0]?.id ?? ''
  useEffect(() => {
    // 首启引导自己管当前主题：新建主题后的 reload 有延迟，
    // 这里如果按旧列表回退，会把刚切过去的 chip 又切回 ai。
    if (onboarding.shouldShow) return
    if (topics.length === 0) return
    if (!topics.some((t) => t.id === activeId)) setActiveId(topics[0]!.id)
  }, [topics, activeId, setActiveId, onboarding.shouldShow])

  const {
    brief,
    raw,
    date: briefDate,
    model: briefModel,
    loading,
    urlToId,
    trace,
    noChange,
    comparison,
    previousDate
  } = useBriefData(viewDate, activeId || undefined)
  const flags = useFlags(brief, urlToId)
  const tracking = useStoriesSummary()
  const sourceState = useSources()
  const { sorted, summary } = useSortedSources(sourceState.sources)
  // 用 hash 做初始路由：便于深链，也便于无头浏览器直接截某一页
  const KNOWN_ROUTES = ['today', 'search', 'timeline', 'stories', 'sources', 'videos', 'review', 'entities', 'settings', 'onboarding']
  const hashParts = (typeof location !== 'undefined' ? location.hash : '').replace(/^#+/, '').split('/')
  const [helpOpen, setHelpOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [modelPromptDismissed, setModelPromptDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('meerkat.modelPromptDismissed') === '1'
    } catch {
      return false
    }
  })
  const [nav, setNav] = useState<string>(() => {
    const head = hashParts[0]
    // 未知路由一律回落到今日，避免深链写错时界面一片空白
    return head && KNOWN_ROUTES.includes(head) ? head : 'today'
  })
  const subRoute = hashParts[1]
  const go = useCallback((id: string): void => {
    setNav(id)
    if (typeof location !== 'undefined') history.replaceState(null, '', '#' + id)
  }, [])

  // 今日页空状态：如果已有一轮在跑，显示“正在采集”而不是让用户再点一次
  const runStatus = useRunStatus(nav === 'today' && !brief && !loading)

  const cancelRun = async (): Promise<void> => {
    await window.meerkat?.cancelRun?.()
  }

  /** 首份仅聚合简报之后：跳到设置并滚到「模型与密钥」 */
  const openModelSettings = (): void => {
    go('settings')
    if (typeof document !== 'undefined') {
      setTimeout(() => document.getElementById('model-keys')?.scrollIntoView({ block: 'start' }), 80)
    }
  }

  const dismissModelPrompt = (): void => {
    setModelPromptDismissed(true)
    try {
      localStorage.setItem('meerkat.modelPromptDismissed', '1')
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  /** 跳到源页并直接展开"新增源"表单（表单里会默认勾上当前主题） */
  const goAddSource = (): void => {
    if (typeof location !== 'undefined') history.replaceState(null, '', '#sources/add')
    setNav('sources')
  }

  /** 选主题：切到该主题，并回到今日简报 */
  const pickTopic = (id: string): void => {
    setActiveId(id)
    go('today')
  }

  /** 报头右侧的"更新"：和设置页走同一个 run:now，跑完靠 brief:updated 广播刷新界面 */
  const refresh = async (): Promise<void> => {
    const api = window.meerkat?.runNow
    if (!api || refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const r = await api(activeId || undefined)
      // 取消是用户的动作，不是错误；不要在报头下面留一条红色横幅
      if (r && !r.ok && r.error !== '已取消') setRefreshError(r.error ?? '更新失败')
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : '更新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const dateLabel = brief?.title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''

  useEffect(() => {
    setRefreshError('')
  }, [activeId, viewDate, nav])

  // ⌘1–9 直接切主题：侧栏是扁平列表，序号就是列表顺序（跨领域也成立）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (onboarding.shouldShow || nav === 'onboarding') return
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const t = topics[n - 1]
      if (!t) return
      e.preventDefault()
      setActiveId(t.id)
      go('today')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [topics, setActiveId, go, onboarding.shouldShow, nav])

  // Ctrl/Cmd+K 跳到搜索：这是阅读器里最常用的一个动作
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (onboarding.shouldShow || nav === 'onboarding') return
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
  }, [go, onboarding.shouldShow, nav])

  // 首启门禁：先等状态和主题列表，避免先闪一下今日页
  if (onboarding.loading || (topicsAvailable && topicsLoading && topics.length === 0)) {
    return (
      <div className="relative grid h-full place-items-center overflow-hidden bg-paper">
        {IS_MAC && <div className="app-drag-strip" aria-hidden="true" />}
        <div className="lumen-glow" />
        <div className="relative z-10 flex items-center gap-3 text-ink-3">
          <img src="./icon-meerkat-64.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-[12px]">正在打开…</span>
        </div>
      </div>
    )
  }

  // `#onboarding` 在已完成首启的用户上进入回看模式；新用户仍然走首启。
  const replayOnboarding = nav === 'onboarding' && !onboarding.shouldShow
  if (replayOnboarding || onboarding.shouldShow) {
    return (
      <Onboarding
        mode={replayOnboarding ? 'replay' : 'first-run'}
        topics={topics}
        topicsAvailable={topicsAvailable}
        activeDomain={activeDomain}
        createTopic={createTopic}
        onPickTopic={setActiveId}
        startRun={onboarding.start}
        complete={onboarding.complete}
        onDone={() => {
          onboarding.hide()
          go('today')
        }}
      />
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 没有它，隐藏标题栏的窗口无法拖动 */}
      {IS_MAC && <div className="app-drag-strip" aria-hidden="true" />}
      <NavRail
        active={nav}
        attentionSources={summary.attention}
        tracking={tracking}
        onNavigate={go}
      />
      {nav === 'today' ? (
        <Sidebar
          topics={topics}
          activeTopic={activeId}
          onPickTopic={pickTopic}
          topicsAvailable={topicsAvailable}
          onCreateTopic={async (input) => createTopic({ ...input, domainId: activeDomain })}
        />
      ) : (
        <ContextSidebar nav={nav} />
      )}

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
                      ? '按日期回看'
                      : nav === 'stories'
                        ? '持续关注的事件'
                        : nav === 'videos'
                          ? '指定博主，选一期生成解读'
                          : nav === 'review'
                            ? '过去 7 天写下的判断'
                            : nav === 'entities'
                              ? '公司、人物与内容的时间线'
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
                「{activeTopic?.name ?? '这个领域'}」还没有简报
              </div>
              {runStatus.running ? (
                <>
                  <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
                    <span className="h-[7px] w-[7px] rounded-full bg-accent" />
                    {runStatus.topicId && runStatus.topicId !== activeId
                      ? `「${topics.find((t) => t.id === runStatus.topicId)?.name ?? '另一个主题'}」正在采集`
                      : '正在采集，完成后会自动出现'}
                  </div>
                  <button
                    onClick={() => void cancelRun()}
                    className="mt-3 rounded-lg border border-cream px-4 py-2 text-[12px] text-ink-2 transition-colors hover:border-alert hover:text-alert"
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void refresh()}
                  disabled={refreshing}
                  className="mt-3 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {refreshing ? '运行中…' : '立即采集'}
                </button>
              )}
            </div>
          )}

          {nav === 'today' && refreshError && (
            <div className="mx-auto max-w-[780px] px-9 pt-4">
              <p className="rounded-lg bg-alert/10 px-3 py-2 text-[11.5px] leading-5 text-alert">
                {refreshError}
              </p>
            </div>
          )}

          {!loading && noChange && nav === 'today' && (
            <NoChangeView
              date={briefDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}
              topicName={topics.find((t) => t.id === activeId)?.name}
              sourceCount={trace?.sourceCount ?? topics.find((t) => t.id === activeId)?.sourceCount ?? 0}
              failedSources={trace?.failedSources ?? 0}
              candidates={trace?.candidates ?? 0}
              droppedAsBriefed={trace?.droppedAsBriefed ?? 0}
              onRefresh={viewDate ? undefined : () => void refresh()}
              refreshing={refreshing}
              onOpenSources={() => go('sources')}
            />
          )}

          {!loading && brief && !noChange && nav === 'today' && !viewDate && briefModel === 'none' && !modelPromptDismissed && (
            <div className="mx-auto max-w-[780px] px-9 pt-4">
              <ModelPrompt onOpenSettings={openModelSettings} onDismiss={dismissModelPrompt} />
            </div>
          )}

          {!loading && brief && !noChange && nav === 'today' && (
            <BriefView
              brief={brief}
              flags={flags}
              trace={trace}
              comparison={comparison}
              previousDate={previousDate}
              onRefresh={() => void refresh()}
              refreshing={refreshing}
              topicName={topics.find((t) => t.id === activeId)?.name}
              rawMarkdown={raw}
            />
          )}

          {nav === 'search' && <SearchPage />}

          {nav === 'videos' && <VideoPage />}
          {nav === 'review' && <ReviewPage onGoToday={() => go('today')} />}
          {nav === 'entities' && <EntitiesPage topicId={activeId || undefined} />}

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
              onReplayOnboarding={() => go('onboarding')}
            />
          )}

          {nav === 'stories' && (
            <StoriesPage
              onOpen={(story) => {
                if (!story.itemId) return
                window.dispatchEvent(
                  new CustomEvent('meerkat:comment-item', {
                    detail: { itemId: story.itemId, title: story.title, topicId: story.topicId }
                  })
                )
                if (story.topicId && story.topicId !== activeId) setActiveId(story.topicId)
              }}
            />
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

      <SelectionAgent />
      <TimelineOverlay />
      <TrackingReview />
      {activeId && (
        <ChatWidget topicId={activeId} briefDate={dateLabel} hasPrevious={previousDate.length > 0} />
      )}
    </div>
  )
}
