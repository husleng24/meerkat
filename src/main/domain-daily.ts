/**
 * 领域汇总的生成。
 *
 * 与主题简报的分工：主题简报读原始素材，领域汇总只读**各主题已经写好的简报**。
 * 好处是口径一致、只多一次模型调用；坏处是汇总看不到主题简报没选的条目——
 * 这正是我们要的（汇总不是重新挑一遍）。
 */
import type { Store } from '../core/ports/store'
import type { ChatProvider } from '../core/ports/chat'
import type { DomainBrief } from '../core/domain/types'
import {
  buildRollupDigest,
  buildRollupPrompt,
  renderRollupFallback,
  type TopicBriefInput
} from '../app/domain-rollup'

export interface DomainComposeTarget {
  provider: ChatProvider
  model: string
}

export interface DomainDeps {
  chat: DomainComposeTarget | null
}

export interface DomainOutcome {
  ok: boolean
  domainId: string
  date: string
  markdown: string
  model: string
  /** 没接模型 / 调用失败，用的是摘录兜底稿 */
  degraded: boolean
  topicCount: number
  itemCount: number
  reason?: string
}

const dateOf = (now: number): string =>
  new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

export async function composeDomainRollup(
  store: Store,
  deps: DomainDeps,
  opts: { domainId: string; date?: string; now?: number; signal?: AbortSignal }
): Promise<DomainOutcome> {
  const domain = store.domains.get(opts.domainId)
  const now = opts.now ?? Date.now()
  const date = opts.date ?? dateOf(now)
  if (!domain) {
    return {
      ok: false,
      domainId: opts.domainId,
      date,
      markdown: '',
      model: 'none',
      degraded: true,
      topicCount: 0,
      itemCount: 0,
      reason: '领域不存在'
    }
  }

  const topics = store.topics.list().filter((t) => t.domainId === domain.id)
  const inputs: TopicBriefInput[] = []
  for (const t of topics) {
    // 优先当天的；当天没出（某个主题没跑成）就用它的最新一期，并在兜底稿里如实标注
    const b = store.briefs.byDate(date, t.id) ?? store.briefs.latest(t.id)
    if (b) inputs.push({ topicId: t.id, topicName: t.name, markdown: b.markdown })
  }

  if (inputs.length === 0) {
    return {
      ok: false,
      domainId: domain.id,
      date,
      markdown: '',
      model: 'none',
      degraded: true,
      topicCount: 0,
      itemCount: 0,
      reason: '这个领域的主题还没有简报'
    }
  }

  const digest = buildRollupDigest(inputs)
  let markdown = renderRollupFallback(digest, domain.name, date, inputs.length)
  let model = 'fallback'
  let degraded = true
  let tokensIn = 0
  let tokensOut = 0
  let reason: string | undefined

  if (deps.chat) {
    const messages = buildRollupPrompt(inputs, digest, domain.name, date)
    try {
      const r = await deps.chat.provider.chat(
        { model: deps.chat.model, messages, maxTokens: 4000, temperature: 0.4 },
        opts.signal
      )
      if (r.ok && r.text.trim()) {
        markdown = r.text.trim()
        model = r.model
        degraded = false
        tokensIn = r.usage.input
        tokensOut = r.usage.output
      } else {
        reason = r.ok ? '模型没有输出' : r.detail
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e)
    }
  } else {
    reason = '未配置模型'
  }

  const brief: DomainBrief = {
    id: `${date}-${domain.id}`,
    domainId: domain.id,
    date,
    markdown,
    model,
    tokensIn,
    tokensOut,
    createdAt: now
  }
  store.domainBriefs.save(brief)

  return {
    ok: true,
    domainId: domain.id,
    date,
    markdown,
    model,
    degraded,
    topicCount: inputs.length,
    itemCount: digest.total,
    ...(reason ? { reason } : {})
  }
}
