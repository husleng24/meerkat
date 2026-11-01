import { useCallback, useEffect, useState } from 'react'
import type { DomainBriefPayload } from '../lib/ipc-types'

interface Props {
  domainId: string
  domainName: string
}

interface RollupItem {
  title: string
  interpretation: string
  links: Array<{ label: string; url: string }>
}

interface RollupSection {
  title: string
  items: RollupItem[]
}

interface ParsedRollup {
  overview: string[]
  sections: RollupSection[]
}

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g

/**
 * 汇总稿是我们自己 prompt 规定的受控结构：
 * `## 综述` + `## 主题（N 条）` + `- **标题**——解读` + 缩进的链接行。
 * 所以直接按结构渲染，而不是把所有 markdown 都塞进通用渲染器——
 * 后者会把续行的链接拆成独立段落，读起来像坏数据。
 */
export function parseRollup(markdown: string): ParsedRollup {
  const overview: string[] = []
  const sections: RollupSection[] = []
  let mode: 'overview' | 'section' = 'overview'
  let current: RollupItem | null = null

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    const h = /^##\s+(.*)$/.exec(line)
    if (h) {
      current = null
      const title = h[1]!.trim()
      if (/今天这个领域在发生什么/.test(title)) {
        mode = 'overview'
      } else {
        mode = 'section'
        sections.push({ title, items: [] })
      }
      continue
    }
    if (/^#\s/.test(line)) continue
    if (/^>\s?/.test(line)) {
      overview.push(line.replace(/^>\s?/, ''))
      continue
    }
    if (mode === 'overview') {
      if (line.trim()) overview.push(line.trim())
      continue
    }

    const item = /^-\s+\*\*(.+?)\*\*\s*——?\s*(.*)$/.exec(line.trim())
    if (item) {
      current = { title: item[1]!.trim(), interpretation: item[2]!.trim(), links: [] }
      sections.at(-1)?.items.push(current)
      continue
    }
    if (current) {
      for (const m of line.matchAll(LINK_RE)) {
        current.links.push({ label: m[1]!, url: m[2]! })
      }
    }
  }

  return { overview, sections }
}

export function DomainRollupView({ domainId, domainName }: Props): React.JSX.Element {
  const [brief, setBrief] = useState<DomainBriefPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const api = window.meerkat?.domainBrief
    if (!api) {
      setLoading(false)
      return
    }
    const b = await api.latest({ domainId })
    setBrief(b)
    setLoading(false)
  }, [domainId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    const off = window.meerkat?.onDomainBriefUpdated?.((id) => {
      if (id === domainId) void load()
    })
    return off
  }, [domainId, load])

  const compose = async (): Promise<void> => {
    const api = window.meerkat?.domainBrief
    if (!api || composing) return
    setComposing(true)
    setMsg('')
    try {
      const r = await api.compose({ domainId })
      if (!r.ok) {
        setMsg(r.error ?? '生成失败')
        return
      }
      await load()
      setMsg(r.degraded ? `已生成摘录版（${r.note ?? '未接模型'}）` : '已生成')
    } finally {
      setComposing(false)
    }
  }

  if (loading) {
    return <div className="px-10 py-16 text-[13px] text-ink-3">正在读取汇总…</div>
  }

  const parsed = brief ? parseRollup(brief.markdown) : null

  return (
    <div className="mx-auto max-w-[860px] px-10 pb-24 pt-8">
      <header className="mb-6 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <span className="mb-1.5 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[10.5px] font-medium text-accent">
            {domainName} · 领域汇总
          </span>
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-ink">
            今天这个领域在发生什么
          </h1>
          <p className="mt-1 text-[11.5px] tabular-nums text-ink-3">
            {brief && parsed
              ? `${brief.date} · ${parsed.sections.length} 个主题 · ${parsed.sections.reduce((n, x) => n + x.items.length, 0)} 条 · ${brief.model === 'fallback' ? '摘录兜底' : '模型合成'}`
              : '还没有汇总'}
          </p>
        </div>
        <button
          onClick={() => void compose()}
          disabled={composing}
          title="默认每天 08:45 自动汇总；这里可以立刻重算"
          className="shrink-0 rounded-full border border-rule px-3 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
        >
          {composing ? '汇总中…' : brief ? '重新汇总' : '生成汇总'}
        </button>
      </header>

      {msg && <p className="mb-4 text-[11.5px] text-ink-3">{msg}</p>}

      {!brief || !parsed ? (
        <div className="card px-6 py-8 text-center">
          <p className="text-[13px] text-ink-3">「{domainName}」还没有领域汇总</p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            它由该领域各主题当天的简报合成；主题先要有简报。
          </p>
        </div>
      ) : (
        <article className="space-y-4">
          {parsed.overview.length > 0 && (
            <div className="card px-6 py-5">
              {parsed.overview.map((line, i) => (
                <p key={i} className={['text-[13.5px] leading-[1.8] text-ink/85', i > 0 ? 'mt-2' : ''].join(' ')}>
                  {line}
                </p>
              ))}
            </div>
          )}

          {parsed.sections.map((section) => (
            <div key={section.title} className="card overflow-hidden">
              <div className="flex items-baseline gap-2 border-b border-cream px-5 py-2.5">
                <h2 className="text-[13px] font-bold text-ink">{section.title}</h2>
                <span className="text-[11px] text-ink-3">{section.items.length} 条</span>
              </div>
              <div className="px-5 py-1">
                {section.items.map((item, i) => (
                  <div key={`${item.title}-${i}`} className="border-b border-cream/70 py-3 last:border-b-0">
                    <p className="text-[13.5px] font-semibold leading-snug text-ink">{item.title}</p>
                    {item.interpretation && (
                      <p className="mt-1 text-[12.5px] leading-[1.7] text-ink-2">{item.interpretation}</p>
                    )}
                    {item.links.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.links.map((l) => (
                          <a
                            key={l.url}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-cream px-1.5 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:text-accent"
                          >
                            {l.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </article>
      )}
    </div>
  )
}
