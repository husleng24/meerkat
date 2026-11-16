/**
 * 只读的简报 CLI：让简报进入终端、笔记和脚本，而不是只能待在窗口里。
 *
 * 运行：
 *   pnpm brief list --topic ai-startups
 *   pnpm brief show --topic ai-startups --date 2026-11-13
 *   pnpm brief export --topic ai-startups --date 2026-11-13 --out ./brief.md
 *   pnpm brief search "LangChain"
 *
 * 默认读桌面应用同一个 userData 数据库；用 --db 覆盖。只读打开，
 * 不跑迁移、不写库，也不和正在运行的应用抢写锁。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createStore } from '../src/adapters/store-sqlite/store'
import { LATEST_VERSION } from '../src/adapters/store-sqlite/schema'
import type { Brief, Topic } from '../src/core/domain/types'

interface Args {
  command: string
  values: Map<string, string>
  bools: Set<string>
  rest: string[]
}

const HELP = `用法：pnpm brief <command> [options]

命令：
  list                  列出历史简报
  show                  输出某一期/最新一期 Markdown
  export                把某一期导出为 Markdown 文件
  search <query>        全文检索条目

选项：
  --topic <id|name>     主题，默认第一个
  --date <yyyy-mm-dd>   日期，默认最新一期
  --limit <n>           list/search 条数，默认 20
  --out <path>          export 输出路径，默认 brief-<topic>-<date>.md
  --db <path>           数据库路径，默认桌面应用的 userData 数据库
  --json                JSON 输出（list/search）
  -h, --help            显示帮助

示例：
  pnpm brief list --topic ai-startups
  pnpm brief show --topic ai-startups
  pnpm brief export --topic ai-startups --date 2026-11-13 --out ./brief.md
`

function parseArgs(argv: string[]): Args {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help'
  const values = new Map<string, string>()
  const bools = new Set<string>()
  const rest: string[] = []
  const start = command === 'help' ? 0 : 1

  for (let i = start; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '-h' || token === '--help') {
      bools.add('help')
      continue
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq > 0) {
        values.set(token.slice(2, eq), token.slice(eq + 1))
        continue
      }
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        values.set(key, next)
        i++
      } else {
        bools.add(key)
      }
      continue
    }
    rest.push(token)
  }

  return { command, values, bools, rest }
}

function defaultDbPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Meerkat', 'meerkat.db')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Meerkat', 'meerkat.db')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Meerkat', 'meerkat.db')
}

function fail(message: string): never {
  console.error(`brief: ${message}`)
  process.exit(1)
}

function resolveTopic(topics: Topic[], raw: string | undefined): Topic {
  if (raw) {
    const hit = topics.find((t) => t.id === raw || t.name === raw)
    if (!hit) fail(`主题不存在：${raw}`)
    return hit
  }
  const first = topics[0]
  if (!first) fail('库里没有主题')
  return first
}

function briefMeta(b: Brief): Record<string, unknown> {
  return {
    date: b.date,
    topicId: b.topicId,
    model: b.model,
    noChange: b.model === 'no-change',
    chars: b.markdown.length,
    linkCheck: b.linkCheck ?? '',
    createdAt: b.createdAt
  }
}

function printList(briefs: Brief[]): void {
  if (briefs.length === 0) {
    console.log('还没有简报。')
    return
  }
  for (const b of briefs) {
    const check = b.linkCheck ? ` · 链接 ${b.linkCheck}` : ''
    const label = b.model === 'no-change' ? '无变化' : b.model
    console.log(`${b.date}  ${label.padEnd(12, ' ')}  ${String(b.markdown.length).padStart(5, ' ')} 字符${check}`)
  }
}

function formatDate(ts: number | undefined): string {
  if (ts === undefined) return '时间未知'
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'help' || args.bools.has('help')) {
    console.log(HELP)
    return
  }

  const dbPath = resolve(args.values.get('db') ?? defaultDbPath())
  if (!existsSync(dbPath)) fail(`数据库不存在：${dbPath}\n提示：先启动一次 Meerkat，或用 --db 指定路径`)
  let store
  try {
    store = createStore(dbPath, { readOnly: true })
  } catch (e) {
    fail(`无法打开数据库：${dbPath}\n${e instanceof Error ? e.message : String(e)}`)
  }
  let version: number
  try {
    version = store.schemaVersion()
  } catch (e) {
    store.close()
    fail(`不是有效的 Meerkat 数据库：${dbPath}\n${e instanceof Error ? e.message : String(e)}`)
  }
  if (version < LATEST_VERSION) {
    store.close()
    fail(
      `数据库 schema 版本 ${version} 落后于当前 CLI（需要 ${LATEST_VERSION}）。\n` +
        '先启动一次最新版 Meerkat 完成迁移，或换一条 --db。'
    )
  }

  try {
    const topics = store.topics.list()
    const topic = resolveTopic(topics, args.values.get('topic'))
    const sourceNames = new Map(store.sources.list().map((s) => [s.id, s.name]))

    if (args.command === 'list') {
      const limit = Number(args.values.get('limit') ?? 20)
      const briefs = store.briefs.list(Number.isFinite(limit) && limit > 0 ? limit : 20, topic.id)
      if (args.bools.has('json')) {
        console.log(JSON.stringify(briefs.map(briefMeta), null, 2))
      } else {
        printList(briefs)
      }
      return
    }

    if (args.command === 'show' || args.command === 'export') {
      const date = args.values.get('date')
      const brief = date ? store.briefs.byDate(date, topic.id) : store.briefs.latest(topic.id)
      if (!brief) fail(`${topic.name} 没有${date ? ` ${date} 的` : ''}简报`)

      if (args.command === 'show') {
        console.log(brief.markdown)
        return
      }

      const out = resolve(
        args.values.get('out') ?? `brief-${topic.id}-${brief.date}.md`
      )
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, `${brief.markdown}\n`, 'utf8')
      console.log(out)
      return
    }

    if (args.command === 'search') {
      const query = args.rest.join(' ').trim()
      if (!query) fail('search 需要查询词')
      const limit = Number(args.values.get('limit') ?? 20)
      const hits = store.items.search(query, { limit: Number.isFinite(limit) && limit > 0 ? limit : 20 })
      if (args.bools.has('json')) {
        console.log(
          JSON.stringify(
            hits.map((it) => ({
              id: it.id,
              title: it.title,
              url: it.url,
              sourceName: sourceNames.get(it.sourceId) ?? it.sourceId,
              publishedAt: it.publishedAt,
              score: it.score
            })),
            null,
            2
          )
        )
        return
      }
      for (const it of hits) {
        console.log(`- ${it.title}`)
        console.log(`  ${sourceNames.get(it.sourceId) ?? it.sourceId} · ${formatDate(it.publishedAt)}`)
        console.log(`  ${it.url}`)
      }
      return
    }

    fail(`未知命令：${args.command}\n\n${HELP}`)
  } finally {
    store.close()
  }
}

main()
