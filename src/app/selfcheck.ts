/**
 * 自检：判定"应用能不能正常工作"的基础设施检查。
 *
 * 刻意不 import electron——环境通过 SelfCheckEnv 注入。
 * 这样同一份检查既能被 `Meerkat --verify` 用，也能被普通 Node 脚本跑，
 * 从而在"Electron 完全起不来"的机器上依然能验证数据层与资源布局。
 */
import { join } from 'node:path'
import { createStore } from '../adapters/store-sqlite/store'
import { seedSources } from './seed-sources'
import { describeNext, type ScheduleConfig } from './schedule'
import { summarizeHealth } from './source-health'
import type { Source } from '../core/domain/types'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface SelfCheckEnv {
  appVersion: string
  versions: { electron?: string; node: string; modules?: string }
  userDataDir: string
  documentsDir: string
  /** 读 resources/ 下的文本文件；不存在返回 undefined */
  readResource: (rel: string) => string | undefined
  /** resources/ 目录的真实位置（用于报告） */
  resourceDirLabel: string
  /** 解析 brand/ 下的文件路径；不存在返回 undefined */
  brandFile: (file: string) => string | undefined
  /** 图片探测：不依赖 electron.nativeImage，用文件头判断 */
  imageInfo: (path: string) => { ok: boolean; width?: number; height?: number; error?: string }
  /** 检查目录可写 */
  ensureWritableDir: (dir: string) => { ok: boolean; error?: string }
  now: number
}

export interface SelfCheckResult {
  checks: Check[]
  ok: boolean
  lines: string[]
}

function run(env: SelfCheckEnv): SelfCheckResult {
  const checks: Check[] = []
  const add = (name: string, fn: () => string): void => {
    try {
      checks.push({ name, ok: true, detail: fn() })
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  add('运行时版本', () => {
    const parts = [`Node ${env.versions.node}`]
    if (env.versions.electron) parts.unshift(`Electron ${env.versions.electron}`)
    if (env.versions.modules) parts.push(`ABI ${env.versions.modules}`)
    return parts.join(' / ')
  })

  add('userData 目录可写', () => {
    const r = env.ensureWritableDir(env.userDataDir)
    if (!r.ok) throw new Error(r.error ?? '不可写')
    return env.userDataDir
  })

  add('资源目录定位', () => env.resourceDirLabel)

  let seed: Source[] = []
  add('源配置 sources.json', () => {
    const text = env.readResource('sources.json')
    if (!text) throw new Error('找不到 sources.json')
    seed = JSON.parse(text) as Source[]
    if (!Array.isArray(seed) || seed.length === 0) throw new Error('源配置为空或格式非法')
    const bad = seed.filter((s) => !s.id || !s.name || !s.kind)
    if (bad.length > 0) throw new Error(`${bad.length} 个源缺少必填字段`)
    return `${seed.length} 个源`
  })

  add('提示词 compose.zh.md', () => {
    const text = env.readResource('prompts/compose.zh.md')
    if (!text) throw new Error('找不到 compose.zh.md')
    if (text.length < 500) throw new Error('提示词过短，可能没打进包')
    if (!text.includes('今日一句')) throw new Error('提示词内容异常（缺少预期段落）')
    return `${text.length} 字符`
  })

  add('托盘图标可解码', () => {
    for (const name of ['icon-meerkat-head-32.png', 'icon-meerkat-head-16.png']) {
      const p = env.brandFile(name)
      if (!p) continue
      const info = env.imageInfo(p)
      if (!info.ok) throw new Error(`${name}: ${info.error ?? '无法解码'}`)
      if (info.width !== info.height) throw new Error(`${name} 不是正方形`)
      return `${name} ${info.width}×${info.height}`
    }
    throw new Error('找不到头部图标')
  })

  const holder: { store: ReturnType<typeof createStore> | null } = { store: null }

  add('数据库打开与迁移', () => {
    holder.store = createStore(join(env.userDataDir, 'meerkat.db'))
    const v = holder.store.schemaVersion()
    if (v < 1) throw new Error(`schema 版本异常: ${v}`)
    return `schema v${v}`
  })

  add('源入库与健康度', () => {
    const store = holder.store
    if (!store) throw new Error('数据库未打开')
    const added = seedSources(store, seed)
    const list = store.sources.list()
    if (list.length === 0) throw new Error('源表为空')
    const h = summarizeHealth(list)
    return `共 ${h.total}（本次新增 ${added}）· 正常 ${h.ok} · 未抓取 ${h.unknown}`
  })

  const probeId = `selfcheck-${env.now}`

  add('条目表可写（中文 + FTS）', () => {
    const store = holder.store
    if (!store) throw new Error('数据库未打开')
    const src = store.sources.list()[0]
    if (!src) throw new Error('没有可用源')
    const id = probeId
    store.items.upsertMany([
      {
        id,
        sourceId: src.id,
        title: '自检条目：中文检索验证',
        url: `https://example.invalid/${id}`,
        summary: '这是一条自检写入的条目',
        bucket: 'product',
        score: 1,
        formulaVersion: 1,
        alsoIn: [],
        fetchedAt: env.now
      }
    ])
    const hit = store.items.search('中文检索', { limit: 5 })
    if (!hit.some((i) => i.id === id)) throw new Error('写入成功但 FTS 检索不到')
    return `写入并检索命中（${hit.length} 条）`
  })

  add('标志位可写（已读/收藏）', () => {
    const store = holder.store
    if (!store) throw new Error('数据库未打开')
    store.flags.set(probeId, { isRead: true, isSaved: true })
    const f = store.flags.get(probeId)
    if (!f?.isRead || !f?.isSaved) throw new Error('标志位读回不一致')
    store.flags.set(probeId, { isSaved: false })
    if (store.flags.get(probeId)?.isSaved !== false) throw new Error('取消收藏未生效')
    return '写入、读回、取消均一致'
  })

  add('定时排程可读', () => {
    const store = holder.store
    if (!store) throw new Error('数据库未打开')
    const cfg = store.settings.get<ScheduleConfig>('schedule.config') ?? { enabled: true, hour: 8, minute: 30 }
    return `每天 ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')} · 下次 ${describeNext(env.now, cfg)}`
  })

  add('今日简报存在', () => {
    const store = holder.store
    if (!store) throw new Error('数据库未打开')
    const b = store.briefs.latest()
    if (!b) return '尚无简报（首次运行属正常）'
    return `${b.date} · ${b.markdown.length} 字符 · 链接校验 ${b.linkCheck ?? '—'}`
  })

  holder.store?.close()

  const lines = [
    '# Meerkat 自检报告',
    `生成时间：${new Date(env.now).toISOString()}`,
    `版本：${env.appVersion}`,
    '',
    ...checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`),
    '',
    checks.every((c) => c.ok) ? '结论：基础设施自检全部通过。' : '结论：存在失败项，见上面 ❌。'
  ]

  return { checks, ok: checks.every((c) => c.ok), lines }
}

export function runSelfCheck(env: SelfCheckEnv): SelfCheckResult {
  return run(env)
}
