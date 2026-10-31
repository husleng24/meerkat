/**
 * 端到端跑一次采集：真实网络 → 归一/去重/打分 → 落库 → 打印摘要。
 *
 * 这个脚本现在只是 runCollect 的薄壳——采集逻辑只有一份实现，
 * 桌面应用的"立即采集"和定时任务走的也是同一份（见 src/app/run-collect.ts）。
 *
 * 运行：pnpm run-once
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStore } from '../src/adapters/store-sqlite/store'
import { fetchSource } from '../src/adapters/sources'
import { runCollect, COLLECT_DEFAULTS } from '../src/app/run-collect'
import { BUCKET_LABEL } from '../src/core/domain/types'
import type { Bucket, Source } from '../src/core/domain/types'

const ROOT = join(__dirname, '..')

async function main(): Promise<void> {
  const store = createStore(join(ROOT, 'data', 'meerkat.db'))

  // 首启灌入源配置（与主进程 seedSources 等价）
  const seed = JSON.parse(readFileSync(join(ROOT, 'resources', 'sources.json'), 'utf8')) as Source[]
  store.sources.upsertMany(seed)

  const started = Date.now()
  const result = await runCollect(
    { store, fetchSource },
    {
      now: started,
      ...COLLECT_DEFAULTS,
      onProgress: ({ done, total }) => {
        if (done % 10 === 0 || done === total) process.stdout.write(`\r  抓取进度 ${done}/${total}`)
      }
    }
  )
  process.stdout.write('\n')

  console.log(`\n=== 抓取结果（${result.nOk}/${result.nSources} 源成功）===`)
  for (const s of result.sourceStats) {
    console.log(`  ${s.ok ? '✅' : '❌'} ${s.name.padEnd(20, ' ')} ${String(s.n).padStart(3, ' ')} 条  ${s.note}`)
  }

  console.log(`\n=== 管线 ===`)
  console.log(`  原始 ${result.nRaw} 条，窗口外丢弃 ${result.nFiltered} 条，去重截断后 ${result.nKept} 条`)

  const byBucket = new Map<Bucket, number>()
  for (const it of result.items) byBucket.set(it.bucket, (byBucket.get(it.bucket) ?? 0) + 1)
  console.log(`\n=== 板块分布 ===`)
  for (const [b, n] of [...byBucket.entries()].sort((a, c) => c[1] - a[1])) {
    console.log(`  ${BUCKET_LABEL[b].padEnd(16, ' ')} ${n}`)
  }

  console.log(`\n=== Top 8 ===`)
  for (const it of result.items.slice(0, 8)) {
    console.log(`  ${it.score.toFixed(2).padStart(6, ' ')}  [${it.bucket}] ${it.title.slice(0, 58)}`)
  }

  console.log(`\n=== 落库 ===`)
  console.log(`  items   ${store.items.count()}`)
  console.log(`  sources ${store.sources.list().length}`)
  console.log(`  schema  v${store.schemaVersion()}`)
  const hit = store.items.search('Gemini', { limit: 3 })
  console.log(`  FTS "Gemini": ${hit.length} 条`)
  store.close()

  console.log(`\n总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  const failed = result.sourceStats.filter((s) => !s.ok)
  if (failed.length > 0) {
    console.log(`⚠️ 失败源：${failed.map((s) => `${s.name}(${s.note})`).join('; ')}`)
  }
}

main().catch((e: unknown) => {
  console.error('run-once 失败:', e)
  process.exit(1)
})
