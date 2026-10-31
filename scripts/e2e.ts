/**
 * 端到端验证（纯 Node，不需要 Electron）：
 * 连跑两次「每日任务」，验证采集、生成、跨天去重、覆盖保护、持久化。
 *
 * 第二次用「今天」再跑一遍，预期：昨天/上次真正被引用的条目被过滤掉。
 * 这条链路就是托盘"立即采集"和定时任务调用的 runDaily。
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from '../src/adapters/store-sqlite/store'
import { seedDefaultMembership } from '../src/app/topics'
import { resolveApiKey } from '../src/adapters/llm/deepseek'
import { runDaily } from '../src/main/daily'
import { seedSources } from '../src/app/seed-sources'
import { decideDue } from '../src/app/schedule'
import type { Source } from '../src/core/domain/types'

const ROOT = join(__dirname, '..')
const TMP = join(ROOT, '.e2e-tmp')
const HOUR = 3_600_000

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })

  const store = createStore(join(TMP, 'meerkat.db'))
  const seed = JSON.parse(readFileSync(join(ROOT, 'resources', 'sources.json'), 'utf8')) as Source[]
  const added = seedSources(store, seed)
  seedDefaultMembership(store)
  const deps = {
    apiKey: resolveApiKey(),
    promptText: readFileSync(join(ROOT, 'resources', 'prompts', 'compose.zh.md'), 'utf8')
  }
  console.log(`[1] 建库 schema v${store.schemaVersion()} · 灌入 ${added} 个源 · key ${deps.apiKey ? '有' : '无'}`)
  console.log(`    首次排程判定 due=${decideDue(undefined, Date.now(), { enabled: true, hour: 8, minute: 30 }).due}`)

  // ── 第一次：今天 ───────────────────────────────────────
  const now1 = Date.now()
  const r1 = await runDaily(store, deps, { topicId: 'ai', now: now1 })
  console.log(
    `[2] 第一次  ${r1.collect.nOk}/${r1.collect.nSources} 源 · ${r1.collect.nRaw}→${r1.collect.nKept} 条 · ` +
      `${r1.degraded ? '降级' : r1.collect && 'ok'} · 链接 ${r1.linkCheck.good}/${r1.linkCheck.total}`
  )
  console.log(`    去重丢弃 ${r1.droppedAsBriefed} · 标记已推送 ${r1.markedBriefed} · 落库 ${r1.save.reason}`)

  const briefedAfter1 = store.items.briefedIds(now1 - 90 * 86_400_000).size
  console.log(`[3] 已推送池 ${briefedAfter1} 条`)

  // ── 第二次：模拟"同一天又点了一次立即采集" ──────────────
  const now2 = now1 + 2 * HOUR
  const r2 = await runDaily(store, deps, { topicId: 'ai', now: now2 })
  console.log(
    `[4] 第二次  去重丢弃 ${r2.droppedAsBriefed}（回退=${r2.filterOverridden}）· 标记 ${r2.markedBriefed} · 落库 ${r2.save.reason}`
  )

  // ── 读回 ───────────────────────────────────────────────
  const brief = store.briefs.latest()
  const list = store.briefs.list(10)
  console.log(`[5] 简报 ${brief ? brief.date + ' · ' + brief.markdown.length + ' 字符 · ' + brief.model : '无'}`)
  console.log(`    历史期数 ${list.length}`)

  const ok =
    r1.collect.nOk >= 30 &&
    r1.linkCheck.good / Math.max(1, r1.linkCheck.total) >= 0.85 &&
    r1.markedBriefed > 0 &&
    briefedAfter1 > 0 &&
    // 第二次应能过滤掉一部分已推送内容（除非整体回退）
    (r2.droppedAsBriefed > 0 || r1.filterOverridden) &&
    brief !== undefined

  store.close()
  rmSync(TMP, { recursive: true, force: true })
  console.log(`\n${ok ? '端到端验证通过' : '端到端验证失败'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('e2e 失败:', e)
  process.exit(1)
})
