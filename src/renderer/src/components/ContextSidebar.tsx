import { useCallback, useEffect, useState } from 'react'
import type { StoryPayload } from '../lib/ipc-types'

type TrackingTab = 'active' | 'paused' | 'archived'

interface Props {
  nav: string
  attentionSources: number
}

const TITLES: Record<string, string> = {
  stories: '跟踪',
  search: '搜索',
  timeline: '历史简报',
  sources: '事实源',
  videos: '视频解读',
  review: '周回顾',
  entities: '实体',
  settings: '设置',
  onboarding: '开始使用'
}

const RECENT_KEY = 'meerkat.search.recent'

function recentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

/**
 * 非今日页的上下文侧栏。
 *
 * 这里不再列主题：用户在搜索、跟踪、设置时，主题不是当前任务的上下文。
 * 跟踪和搜索做成可操作；其余页面给当前页的范围说明，不造假的假按钮。
 */
export function ContextSidebar({ nav, attentionSources }: Props): React.JSX.Element {
  const [trackingTab, setTrackingTab] = useState<TrackingTab>('active')
  const [stories, setStories] = useState<StoryPayload[]>([])
  const [recent, setRecent] = useState<string[]>(() => recentSearches())
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const title = TITLES[nav] ?? 'Meerkat'

  const loadStories = useCallback(async (): Promise<void> => {
    const api = window.meerkat?.stories
    if (!api) return
    const list = await api.list().catch(() => [])
    setStories(list)
  }, [])

  useEffect(() => {
    if (nav !== 'stories') return
    void loadStories()
    const reload = (): void => void loadStories()
    window.addEventListener('meerkat:tracking-updated', reload)
    window.addEventListener('brief:updated', reload)
    const sync = (e: Event): void => {
      const tab = (e as CustomEvent<{ tab?: TrackingTab }>).detail?.tab
      if (tab === 'active' || tab === 'paused' || tab === 'archived') setTrackingTab(tab)
    }
    window.addEventListener('meerkat:tracking-tab-sync', sync)
    return () => {
      window.removeEventListener('meerkat:tracking-updated', reload)
      window.removeEventListener('brief:updated', reload)
      window.removeEventListener('meerkat:tracking-tab-sync', sync)
    }
  }, [nav, loadStories])

  useEffect(() => {
    if (nav !== 'search') return
    const reload = (): void => setRecent(recentSearches())
    window.addEventListener('meerkat:search-recent', reload)
    return () => window.removeEventListener('meerkat:search-recent', reload)
  }, [nav])

  const active = stories.filter((s) => s.status === 'active')
  const paused = stories.filter((s) => s.status === 'paused')
  const archived = stories.filter((s) => s.status === 'archived')
  const quiet = active.filter((s) => s.missCount >= 3).length

  const chooseTracking = (tab: TrackingTab): void => {
    setTrackingTab(tab)
    window.dispatchEvent(new CustomEvent('meerkat:tracking-tab', { detail: { tab } }))
  }

  const chooseSearch = (q: string): void => {
    window.dispatchEvent(new CustomEvent('meerkat:search-query', { detail: { q } }))
  }

  const section = (): React.JSX.Element => {
    if (nav === 'stories') {
      return (
        <>
          <p className="mb-2 px-2.5 text-[11px] leading-relaxed text-ink-3">
            持续关注的事件；有新报道会追加到同一条评论串。
          </p>
          <div className="space-y-0.5">
            {[
              { id: 'active' as const, label: '进行中', count: active.length },
              { id: 'paused' as const, label: '已暂停', count: paused.length },
              { id: 'archived' as const, label: '已放弃', count: archived.length }
            ].map((row) => (
              <button
                key={row.id}
                onClick={() => chooseTracking(row.id)}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors',
                  trackingTab === row.id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-cream hover:text-ink'
                ].join(' ')}
              >
                <span className="flex-1">{row.label}</span>
                <span className="text-[10.5px] tabular-nums text-ink-3">{row.count}</span>
              </button>
            ))}
          </div>
          {quiet > 0 && (
            <p className="mt-3 rounded-lg bg-alert/5 px-2.5 py-2 text-[10.5px] leading-4 text-alert">
              {quiet} 个跟踪连续多次没有新进展
            </p>
          )}
        </>
      )
    }

    if (nav === 'search') {
      return (
        <>
          <p className="mb-2 px-2.5 text-[11px] leading-relaxed text-ink-3">
            搜索标题、摘要、来源；FTS5 支持中文子串。
          </p>
          <p className="mb-1 px-2.5 text-[10px] font-medium text-ink-3">最近搜索</p>
          {recent.length === 0 ? (
            <p className="px-2.5 text-[10.5px] leading-4 text-ink-3">还没有搜索记录</p>
          ) : (
            <div className="space-y-0.5">
              {recent.map((q) => (
                <button
                  key={q}
                  onClick={() => chooseSearch(q)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left text-[12px] text-ink-2 hover:bg-cream hover:text-ink"
                >
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-rule pt-2 text-[10.5px] leading-5 text-ink-3">
            <p>⌘K 随时聚焦搜索</p>
            <p>可用板块 / 来源 / 时间筛选</p>
          </div>
        </>
      )
    }

    const rows: Record<string, Array<[string, string]>> = {
      timeline: [
        ['按日期回看', '每一期简报都留在本地'],
        ['无变化', '也会保留，不会假装有内容'],
        ['来源证据', '回看时仍可展开 trace']
      ],
      sources: [
        ['全部事实源', '全局共享，按主题勾选'],
        [`需要关注 ${attentionSources}`, '连续失败或不稳定'],
        ['健康度', '失败次数、延迟、条目量']
      ],
      videos: [
        ['最近 12 条', '选一期手动解读'],
        ['字幕优先', '无字幕明确失败'],
        ['导出 Markdown', '摘要 + 完整对话']
      ],
      review: [
        ['内容判断', '每条内容下的判断'],
        ['事件判断', '事件页里的判断'],
        ['无变化', '这周真正安静的日子']
      ],
      entities: [
        ['公司 / 人物', '本地词表 + 别名匹配'],
        ['事件', '融资 / 产品 / 裁员 / 监管'],
        ['本周 vs 上周', '看变化方向']
      ],
      settings: [
        ['领域与主题', '分组与排程'],
        ['事实源', '健康度与归属'],
        ['模型与密钥', '本机加密'],
        ['每日推送', '飞书 / Slack / 邮件']
      ],
      onboarding: [
        ['选择主题', '先有输入才有简报'],
        ['挂上默认源', '不用手工找 RSS'],
        ['立即采集', '约 1–2 分钟']
      ]
    }
    const list = rows[nav] ?? [['当前页面', 'Meerkat']]
    return (
      <div className="space-y-0.5">
        {list.map(([label, hint]) => (
          <div key={label} className="rounded-lg px-2.5 py-2">
            <p className="text-[12px] font-medium text-ink">{label}</p>
            <p className="mt-0.5 text-[10.5px] leading-4 text-ink-3">{hint}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <aside
      className={[
        'flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 max-[900px]:hidden',
        isMac ? 'pt-10' : 'pt-3'
      ].join(' ')}
    >
      <h2 className="mb-1 px-2.5 text-[15px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mb-3 px-2.5 text-[10.5px] text-ink-3">当前页面</div>
      {section()}
    </aside>
  )
}
