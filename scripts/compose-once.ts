/**
 * 从库里取条目 → 调 DeepSeek 成稿 → 落库 + 写文件。
 * 用途：P1-3 的集成验收。
 *
 * 运行：pnpm compose-once
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from '../src/adapters/store-sqlite/store'
import { createDeepSeekComposer, resolveApiKey } from '../src/adapters/llm/deepseek'
import { composeBrief, weekdayOf, type BriefItem, type BriefSourceStats } from '../src/app/compose-brief'
import type { Brief } from '../src/core/domain/types'

const ROOT = join(__dirname, '..')
const WINDOW_HOURS = 48

async function main(): Promise<void> {
  const now = Date.now()
  const dateLabel = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

  const store = createStore(join(ROOT, 'data', 'meerkat.db'))
  const sources = store.sources.list()
  const nameById = new Map(sources.map((s) => [s.id, s.name]))

  const recent = store.items.since(now - WINDOW_HOURS * 3_600_000, 80)
  if (recent.length === 0) {
    console.error('库里没有条目，请先跑 pnpm run-once')
    store.close()
    process.exit(1)
  }

  const items: BriefItem[] = recent.map((it) => ({
    ...it,
    sourceName: nameById.get(it.sourceId) ?? it.sourceId
  }))

  const sourceStats: BriefSourceStats[] = sources.map((s) => ({
    name: s.name,
    ok: s.failStreak === 0,
    n: s.avgItems !== undefined ? Math.round(s.avgItems) : 0,
    note: s.lastError ?? ''
  }))

  const promptPath = join(ROOT, 'resources', 'prompts', 'compose.zh.md')
  const systemPrompt = readFileSync(promptPath, 'utf8')
  const apiKey = resolveApiKey()

  console.log(`[compose] 条目 ${items.length} 条，源 ${sources.length} 个`)
  console.log(`[compose] API key: ${apiKey ? '已找到（长度 ' + apiKey.length + '）' : '未找到 → 将走仅聚合降级'}`)

  const composer = createDeepSeekComposer({ apiKey, systemPrompt, maxTokens: 32_000 })
  const t0 = Date.now()
  const out = await composeBrief(composer, items, {
    now,
    windowHours: WINDOW_HOURS,
    dateLabel,
    weekday: weekdayOf(now),
    sourceStats
  })
  const elapsed = Date.now() - t0

  console.log(`[compose] 耗时 ${(elapsed / 1000).toFixed(1)}s  model=${out.model}`)
  console.log(`[compose] token 输入 ${out.usage.input} / 输出 ${out.usage.output}`)
  console.log(
    `[compose] 链接校验 ${out.linkCheck.good}/${out.linkCheck.total} = ${(out.linkCheck.rate * 100).toFixed(0)}%  ${out.linkCheck.passed ? '✅ 通过' : '⚠️ 未通过'}`
  )
  if (out.linkCheck.bad.length > 0) {
    console.log(`[compose] 可疑链接（不在素材中）：`)
    for (const b of out.linkCheck.bad.slice(0, 5)) console.log(`   - ${b}`)
  }
  if (out.degraded) console.log(`[compose] ⚠️ 已降级：${out.degradedReason}`)
  if (out.issues.length > 0) {
    console.log('[compose] ⚠️ 结构问题：')
    for (const i of out.issues) console.log('   - ' + i)
  }

  const outDir = join(ROOT, 'out')
  mkdirSync(outDir, { recursive: true })
  const mdPath = join(outDir, `AI简报-${dateLabel}.md`)
  writeFileSync(mdPath, out.markdown, 'utf8')
  console.log(`[compose] 写入 ${mdPath}（${out.markdown.length} 字符）`)

  const brief: Brief = {
    id: dateLabel,
    date: dateLabel,
    topicId: 'default',
    markdown: out.markdown,
    model: out.model,
    tokensIn: out.usage.input,
    tokensOut: out.usage.output,
    linkCheck: `${out.linkCheck.good}/${out.linkCheck.total}`,
    createdAt: now
  }
  store.briefs.save(brief)
  console.log(`[compose] 已落库，当前共 ${store.briefs.list().length} 期`)

  // 打印前 20 行给人工过目
  console.log('\n--- 简报前 20 行 ---')
  console.log(out.markdown.split('\n').slice(0, 20).join('\n'))
  store.close()
}

main().catch((e: unknown) => {
  console.error('compose-once 失败:', e)
  process.exit(1)
})
