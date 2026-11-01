import { useEffect, useRef, useState } from 'react'
import { healthOf, suggestReplacement, type HealthLevel } from '../../../app/source-health'
import { BUCKET_LABEL, type Bucket, type Source } from '../../../core/domain/types'
import type { SourcesState } from '../lib/useSources'

const KIND_LABEL: Record<string, string> = {
  rss: 'RSS',
  atom: 'Atom',
  arxiv: 'arXiv',
  hn: 'HN',
  youtube: 'YouTube',
  'github-trending': 'GitHub',
  hfpapers: 'HF',
  anthropic: 'HTML',
  html: 'HTML'
}

const LEVEL_TEXT: Record<HealthLevel, string> = {
  ok: '正常',
  degraded: '不稳定',
  failing: '失效',
  unknown: '未抓取'
}

interface Props {
  state: SourcesState
  sorted: Source[]
  summary: ReturnType<typeof import('../../../app/source-health').summarizeHealth>
  initialAdding?: boolean
  initialEdit?: boolean
}

/**
 * 源管理页 = 这个应用的"维修间"。
 * 排序规则：坏源排前面（见 sortByHealth），因为打开这一页的人 90% 是来修东西的。
 */
export function SourcesPage({ state, sorted, summary, initialAdding = false, initialEdit = false }: Props): React.JSX.Element {
  const { probing, progress } = state
  const [adding, setAdding] = useState(initialAdding)
  const [editing, setEditing] = useState<Source | null>(null)
  // 深链 #sources/edit：等源加载完再打开第一个"需关注的源"，只自动开一次
  const didInitEdit = useRef(false)
  useEffect(() => {
    if (!initialEdit || didInitEdit.current || sorted.length === 0) return
    didInitEdit.current = true
    setEditing(sorted.find((s) => s.failStreak > 0) ?? sorted[0] ?? null)
  }, [initialEdit, sorted])

  return (
    <div className="mx-auto max-w-[900px] px-10 pb-24 pt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 whitespace-nowrap text-[11.5px] text-ink-3">
          <span>可用 {summary.ok}</span>
          <span className="h-[3px] w-[3px] rounded-full bg-ink-3/50" />
          <span className={summary.attention > 0 ? 'font-medium text-alert' : ''}>需关注 {summary.attention}</span>
          {summary.attention > 0 && (
            <span className="hidden text-[10.5px] text-ink-3/70 min-[900px]:inline">
              失效 {summary.failing} · 不稳定 {summary.degraded}
            </span>
          )}
          <span className="h-[3px] w-[3px] rounded-full bg-ink-3/50" />
          <span>共 {summary.total}</span>
        </div>
        <div className="flex items-center gap-2">
          {progress && (
            <span className="text-[11px] tabular-nums text-ink-3">
              自检中 {progress.done}/{progress.total}
            </span>
          )}
          <button
            onClick={() => setAdding((v) => !v)}
            className="whitespace-nowrap rounded-lg border border-cream px-3 py-2 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink"
          >
            {adding ? '收起' : '新增源'}
          </button>
          <button
            onClick={() => void state.testAll()}
            disabled={progress !== null}
            className="whitespace-nowrap rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            全部自检
          </button>
        </div>
      </div>


      {adding && <AddSourceForm state={state} onDone={() => setAdding(false)} />}

      {editing && (
        <EditSourceForm
          state={state}
          source={editing}
          onDone={() => setEditing(null)}
        />
      )}

      <div className="overflow-hidden card">
        {/* 宽屏是表；窄屏每一行折成两行（名称 + 元信息/操作），因为 720px 宽时名称列会被挤成 0 */}
        <div className="hidden grid-cols-[1fr_58px_82px_62px_50px_102px] items-center gap-2 border-b border-cream px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3/80 min-[900px]:grid">
          <span>名称</span>
          <span>类型</span>
          <span>最近成功</span>
          <span>平均条数</span>
          <span>状态</span>
          <span className="text-right">操作</span>
        </div>

        {sorted.map((s) => {
          const level = healthOf(s)
          const replacement = level === 'failing' ? suggestReplacement(s, state.sources) : undefined
          const busy = probing.has(s.id)
          return (
            <div
              key={s.id}
              className={[
                'grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 border-b border-cream/70 px-4 py-3 text-[12px] last:border-b-0',
                'min-[900px]:grid-cols-[1fr_58px_82px_62px_50px_102px] min-[900px]:items-center min-[900px]:gap-2 min-[900px]:py-2.5',
                s.enabled ? '' : 'opacity-55'
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditing(s)}
                    title="点击编辑名称与地址"
                    className="truncate text-left font-medium text-ink hover:underline hover:decoration-accent hover:underline-offset-2"
                  >
                    {s.name}
                  </button>
                  <span className="shrink-0 rounded bg-cream px-1.5 py-px text-[9.5px] text-ink/60">T{s.tier}</span>
                  {!s.enabled && (
                    <span className="shrink-0 rounded bg-cream px-1.5 py-px text-[9.5px] text-ink-3">已停用</span>
                  )}
                </div>
                {s.lastError && level !== 'ok' && (
                  <div className="mt-0.5 truncate text-[10.5px] text-alert/90" title={s.lastError}>
                    {s.lastError}
                  </div>
                )}
                {replacement && s.enabled && (
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                    <span className="truncate" title={`可换用：${replacement.name}`}>
                      可换用：{replacement.name}
                    </span>
                    <button
                      onClick={() => void state.toggle(s.id, false)}
                      title={`停用「${s.name}」，采集交给「${replacement.name}」；随时可以再启用`}
                      className="shrink-0 rounded border border-cream px-1.5 py-px text-[10px] text-ink/70 transition-colors hover:border-accent hover:text-accent"
                    >
                      改用它
                    </button>
                  </div>
                )}
                {replacement && !s.enabled && (
                  <div className="mt-0.5 truncate text-[10.5px] text-ink-3">已停用，由「{replacement.name}」覆盖</div>
                )}
              </div>

              <HealthDot
                level={level}
                className="justify-self-end self-center min-[900px]:col-start-5 min-[900px]:row-start-1 min-[900px]:justify-self-start"
              />

              <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3 min-[900px]:contents">
                <span className="min-[900px]:col-start-2">{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className="tabular-nums text-ink/60 min-[900px]:col-start-3">
                  <span className="min-[900px]:hidden">最近成功 </span>
                  {relTime(s.lastOkAt)}
                </span>
                <span className="tabular-nums text-ink/60 min-[900px]:col-start-4">
                  <span className="min-[900px]:hidden">平均 </span>
                  {s.avgItems !== undefined ? `${Math.round(s.avgItems)} 条` : '—'}
                </span>
                <div className="ml-auto flex gap-1 min-[900px]:col-start-6 min-[900px]:ml-0 min-[900px]:justify-end">
                  <button
                    onClick={() => void state.testOne(s.id)}
                    disabled={busy}
                    className="shrink-0 whitespace-nowrap rounded border border-cream px-2 py-1 text-[10.5px] text-ink/70 transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
                  >
                    {busy ? '…' : '测试'}
                  </button>
                  <button
                    onClick={() => void state.toggle(s.id, !s.enabled)}
                    title={s.enabled ? '停用' : '启用'}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-cream text-[10.5px] text-ink/50 transition-colors hover:border-accent hover:text-ink"
                  >
                    {s.enabled ? '◉' : '○'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`删除源「${s.name}」？已抓取的条目会一并删除。`)) void state.remove(s.id)
                    }}
                    title="删除"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-cream text-[10.5px] text-ink/40 transition-colors hover:border-alert hover:text-alert"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-[11px] leading-6 text-ink-3/80">
        连续失败 3 次的源会被标红；若同类里有健康源，会给出"可换用"建议。
        {state.origin === 'sample' && '（当前是预览样例数据）'}
      </p>
    </div>
  )
}

function HealthDot({ level, className = '' }: { level: HealthLevel; className?: string }): React.JSX.Element {
  const color =
    level === 'ok'
      ? 'bg-ink/70'
      : level === 'degraded'
        ? 'bg-accent'
        : level === 'failing'
          ? 'bg-alert'
          : 'bg-ink/25'
  return (
    <span className={`flex items-center gap-1.5 text-[11px] text-ink/70 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {LEVEL_TEXT[level]}
    </span>
  )
}

/** 编辑已有源：只改名称/地址/层级/板块；id 与类型不可改（改了等于换了个源） */
function EditSourceForm({
  state,
  source,
  onDone
}: {
  state: SourcesState
  source: Source
  onDone: () => void
}): React.JSX.Element {
  const [name, setName] = useState(source.name)
  // YouTube 源只存 channelId，没有 url——还原成可读可编辑的频道地址
  const [url, setUrl] = useState(
    source.url ?? (source.channelId ? `https://www.youtube.com/channel/${source.channelId}` : '')
  )
  const [tier, setTier] = useState(source.tier)
  const [bucket, setBucket] = useState<Bucket>(source.bucketHint)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await state.update({ id: source.id, name, url, tier, bucketHint: bucket })
    setBusy(false)
    if (r.ok) {
      onDone()
      return
    }
    setMsg(r.error ?? '保存失败')
  }

  const urlLabel =
    source.kind === 'youtube' ? '频道地址（…/channel/UC…）' : source.kind === 'hn' ? '地址（可留空）' : '地址'

  return (
    <div className="mb-4 rounded-xl border border-accent/50 bg-white px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink">编辑：{source.name}</span>
        <span className="rounded bg-cream px-1.5 py-px text-[9.5px] text-ink/60">
          {KIND_LABEL[source.kind] ?? source.kind}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </Field>
        <Field label={urlLabel}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </Field>
        <Field label="层级">
          <select
            value={tier}
            onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          >
            <option value={1}>1 · 一手信源（官方/实验室）</option>
            <option value={2}>2 · 媒体/研究</option>
            <option value={3}>3 · 社区信号</option>
          </select>
        </Field>
        <Field label="板块">
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as Bucket)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          >
            {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={busy || name.trim().length < 2}
          onClick={() => void save()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button onClick={onDone} className="text-[12px] text-ink-3 hover:text-ink">
          取消
        </button>
        {msg && <span className="ml-2 text-[11.5px] text-alert">{msg}</span>}
      </div>
    </div>
  )
}

/** 新增源表单：字段少到一屏能填完，错误就地提示 */
function AddSourceForm({ state, onDone }: { state: SourcesState; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('rss')
  const [tier, setTier] = useState(2)
  const [bucket, setBucket] = useState<Bucket>('product')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await state.add({ name, url, kind, tier, bucketHint: bucket })
    setBusy(false)
    if (r.ok) {
      setName('')
      setUrl('')
      setMsg('已添加。点该行的「测试」可以立刻验证能不能抓到内容。')
    } else {
      setMsg(r.error ?? '添加失败')
    }
  }

  return (
    <div className="mb-4 card px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的博客"
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </Field>
        <Field label="类型">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          >
            {['rss', 'atom', 'html', 'youtube', 'arxiv', 'hn', 'github-trending', 'hfpapers'].map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === 'youtube' ? '频道地址（…/channel/UC…）' : '地址'}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={kind === 'hn' ? '可留空' : 'https://example.com/feed.xml'}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </Field>
        <Field label="层级">
          <select
            value={tier}
            onChange={(e) => setTier(Number(e.target.value))}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          >
            <option value={1}>1 · 一手信源（官方/实验室）</option>
            <option value={2}>2 · 媒体/研究</option>
            <option value={3}>3 · 社区信号</option>
          </select>
        </Field>
        <Field label="板块">
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as Bucket)}
            className="w-full rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
          >
            {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={busy || name.trim().length < 2}
          onClick={() => void submit()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          {busy ? '添加中…' : '添加'}
        </button>
        <button onClick={onDone} className="text-[12px] text-ink-3 hover:text-ink">
          取消
        </button>
        {msg && <span className="ml-2 text-[11.5px] text-ink/70">{msg}</span>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] text-ink-3">{label}</span>
      {children}
    </label>
  )
}

function relTime(ts?: number): string {
  if (ts === undefined) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}
