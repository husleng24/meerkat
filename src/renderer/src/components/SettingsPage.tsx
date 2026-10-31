import { useCallback, useEffect, useState } from 'react'
import { describeNext, describeSchedule, type ScheduleConfig } from '../../../app/schedule'
import type { AutoLaunchState, KeyStatusPayload } from '../lib/ipc-types'
import type { SchedulePayload } from '../lib/ipc-types'

const DEFAULT: SchedulePayload = { enabled: true, hour: 8, minute: 30, lastRunAt: null }

type Phase = 'idle' | 'running' | 'done' | 'error'

/**
 * 设置页。三件事：排程、手动跑一次、导出。
 * 没有"主题""语言"这类装饰性设置——这个应用的设置项应该少到一个屏幕放得下。
 */
export function SettingsPage(): React.JSX.Element {
  const [cfg, setCfg] = useState<SchedulePayload>(DEFAULT)
  const [origin, setOrigin] = useState<'ipc' | 'preview'>('preview')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const api = window.meerkat?.schedule
    if (!api) return
    let cancelled = false
    void api
      .get()
      .then((res) => {
        if (!cancelled) {
          setCfg(res)
          setOrigin('ipc')
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(
    async (next: ScheduleConfig & { enabled: boolean }) => {
      setCfg((prev) => ({ ...prev, ...next }))
      const api = window.meerkat?.schedule
      if (!api) return
      const res = await api.set(next)
      if (!res.ok) setMessage(res.error ?? '保存失败')
    },
    []
  )

  const runNow = useCallback(async () => {
    const api = window.meerkat?.runNow
    if (!api) {
      setMessage('预览模式下不可用：需要在桌面应用内运行')
      return
    }
    setPhase('running')
    setMessage('正在采集并生成简报，可能需要 1–2 分钟…')
    try {
      const r = await api()
      setPhase('done')
      setMessage(`完成：${r.nOk}/${r.nSources} 源成功，入库 ${r.nKept} 条${r.degraded ? '（简报已降级）' : ''}`)
      setCfg((prev) => ({ ...prev, lastRunAt: Date.now() }))
    } catch (e) {
      setPhase('error')
      setMessage(`失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const doExport = useCallback(async () => {
    const api = window.meerkat?.exportBrief
    if (!api) {
      setMessage('预览模式下不可用：需要在桌面应用内运行')
      return
    }
    const r = await api()
    setMessage(r.ok ? `已导出到 ${r.path}` : (r.error ?? '导出失败'))
  }, [])

  const doDiagnostic = useCallback(async () => {
    const api = window.meerkat?.exportDiagnostic
    if (!api) {
      setMessage('预览模式下不可用：需要在桌面应用内运行')
      return
    }
    const r = await api()
    setMessage(
      r.ok ? `诊断包已导出到 ${r.path}\n\n${r.summary ?? ''}` : (r.error ?? '导出诊断包失败'),
    )
  }, [])

  const now = Date.now()

  return (
    <div className="mx-auto max-w-[680px] px-10 pb-24 pt-8">
      <section className="mb-8">
        <h2 className="mb-1 text-[14px] font-semibold text-ink">每日排程</h2>
        <p className="mb-4 text-[12px] text-ink-3">
          到点自动采集并生成简报，完成后弹通知。错过时间点会在 6 小时内补一次。
        </p>

        <div className="rounded-xl border border-cream bg-white/60 px-5 py-4">
          <AutoLaunchRow />

          <div className="mt-4 flex items-center justify-between border-t border-cream pt-4">
            <span className="text-[13px] text-ink">启用定时</span>
            <button
              onClick={() => void save({ ...cfg, enabled: !cfg.enabled })}
              className={[
                'relative h-6 w-11 rounded-full transition-colors',
                cfg.enabled ? 'bg-ink' : 'bg-cream'
              ].join(' ')}
              aria-pressed={cfg.enabled}
            >
              <span
                className={[
                  'absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-all',
                  cfg.enabled ? 'left-[22px]' : 'left-0.5'
                ].join(' ')}
              />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <TimeField
              label="时"
              value={cfg.hour}
              max={23}
              disabled={!cfg.enabled}
              onChange={(v) => void save({ ...cfg, hour: v })}
            />
            <span className="text-[13px] text-ink-3">:</span>
            <TimeField
              label="分"
              value={cfg.minute}
              max={59}
              disabled={!cfg.enabled}
              onChange={(v) => void save({ ...cfg, minute: v })}
            />
            <div className="ml-auto text-right">
              <div className="text-[12px] font-medium text-ink">{describeSchedule(cfg)}</div>
              <div className="text-[11px] text-ink-3">
                {cfg.enabled ? `下次 ${describeNext(now, cfg)}` : '不会自动运行'}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 border-t border-cream pt-3 text-[11px] text-ink-3">
            <span>
              上次运行：
              {cfg.lastRunAt ? new Date(cfg.lastRunAt).toLocaleString('zh-CN', { hour12: false }) : '从未运行'}
            </span>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-[14px] font-semibold text-ink">手动运行</h2>
        <p className="mb-4 text-[12px] text-ink-3">立即抓取全部启用的源并重新生成简报。</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void runNow()}
            disabled={phase === 'running'}
            className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {phase === 'running' ? '运行中…' : '立即采集'}
          </button>
          <button
            onClick={() => void doExport()}
            className="rounded-lg border border-cream px-4 py-2 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink"
          >
            导出今日简报
          </button>
        </div>
        {message && (
          <p
            className={[
              'mt-3 rounded-lg px-3 py-2 text-[11.5px]',
              phase === 'error' ? 'bg-alert/10 text-alert' : 'bg-cream/60 text-ink/70'
            ].join(' ')}
          >
            {message}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-ink">模型与密钥</h2>
        <p className="mb-4 text-[12px] text-ink-3">
          未接模型时自动退化为"仅聚合"简报——只列标题和链接，没有解读。
        </p>
        <KeyPanel />
        <div className="mt-3 rounded-xl border border-cream bg-white/60 px-5 py-4 text-[12px]">
          <Row k="模型" v="deepseek-flash" />
          <Row k="温度" v="0.55" />
          <Row k="最大输出" v="32,000 tokens" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-semibold text-ink">反馈</h2>
        <p className="mb-4 text-[12px] text-ink-3">
          生成一份可以直接贴出去的材料（问题描述 + 环境 + 已脱敏的诊断摘要）。
          没有服务器，所以不做「提交」按钮——它只会往虚空里发。
        </p>
        <FeedbackPanel />
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-semibold text-ink">排查问题</h2>
        <p className="mb-4 text-[12px] text-ink-3">
          导出诊断包（版本、源健康度、最近运行记录、日志尾部）。内容已自动脱敏：
          密钥、邮箱、路径里的用户名都会被打码。
        </p>
        <button
          onClick={() => void doDiagnostic()}
          className="rounded-lg border border-cream px-4 py-2 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink"
        >
          导出诊断包
        </button>
      </section>

      {origin === 'preview' && (
        <p className="mt-6 text-[11px] text-ink-3/70">预览模式：显示默认值，按钮需在桌面应用内生效。</p>
      )}
    </div>
  )
}

function TimeField({
  label,
  value,
  max,
  disabled,
  onChange
}: {
  label: string
  value: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col items-center gap-1">
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 0 && n <= max) onChange(n)
        }}
        className="w-16 rounded-lg border border-cream bg-white px-2 py-1.5 text-center text-[13px] tabular-nums text-ink outline-none focus:border-accent disabled:opacity-40"
      />
      <span className="text-[10px] text-ink-3/70">{label}</span>
    </label>
  )
}

/**
 * 开机自启。
 *
 * 这一项决定"每天自动"在重启后是否还成立——不做的话，用户重启一次电脑，
 * 第二天就没有简报，而且他不知道为什么。
 */
function AutoLaunchRow(): React.JSX.Element {
  const [st, setSt] = useState<AutoLaunchState | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const api = window.meerkat?.prefs
    if (!api) return
    let cancelled = false
    void api
      .get()
      .then((r) => {
        if (!cancelled) setSt(r.autoLaunch)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (): Promise<void> => {
    const api = window.meerkat?.prefs
    if (!api || !st) return
    const r = await api.setAutoLaunch(!st.enabled)
    if (r.autoLaunch) setSt(r.autoLaunch)
    if (!r.ok) setMsg(r.error ?? '设置失败')
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-ink">开机自动启动</span>
        {st?.supported ? (
          <button
            onClick={() => void toggle()}
            className={['relative h-6 w-11 rounded-full transition-colors', st.enabled ? 'bg-ink' : 'bg-cream'].join(' ')}
            aria-pressed={st.enabled}
          >
            <span
              className={[
                'absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-all',
                st.enabled ? 'left-[22px]' : 'left-0.5'
              ].join(' ')}
            />
          </button>
        ) : (
          <span className="text-[11.5px] text-ink-3/80">不可用</span>
        )}
      </div>
      {st && !st.supported && st.reason && (
        <p className="mt-1 text-[11px] leading-5 text-ink-3/80">{st.reason}</p>
      )}
      {st?.supported && !st.enabled && (
        <p className="mt-1 text-[11px] leading-5 text-alert/90">
          关闭后，重启电脑就不会自动采集——定时任务只在应用运行时生效。
        </p>
      )}
      {msg && <p className="mt-1 text-[11px] text-alert">{msg}</p>}
    </div>
  )
}

/**
 * 反馈面板。
 *
 * 刻意不做「提交」：没有后端，提交按钮只会往虚空里发。
 * 这里做的是"生成一份能直接贴给别人的材料"——复制、存文件、或（配置了仓库时）开 issue。
 */
function FeedbackPanel(): React.JSX.Element {
  const [category, setCategory] = useState<'bug' | 'idea' | 'source' | 'other'>('bug')
  const [message, setMessage] = useState('')
  const [includeDiag, setIncludeDiag] = useState(true)
  const [preview, setPreview] = useState<{ title: string; body: string; issueUrl?: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const api = window.meerkat?.feedback
  const hasIpc = api !== undefined

  const compose = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    setMsg('')
    try {
      const r = await api.compose({ category, message, includeDiagnostics: includeDiag })
      if (!r.ok || !r.body || !r.title) {
        setMsg(r.error ?? '生成失败')
        setPreview(null)
        return
      }
      setPreview({ title: r.title, body: r.body, ...(r.issueUrl ? { issueUrl: r.issueUrl } : {}) })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (!api || !preview) return
    const r = await api.copy(`${preview.title}\n\n${preview.body}`)
    setMsg(r.ok ? '已复制到剪贴板，可以直接粘贴出去' : (r.error ?? '复制失败'))
  }

  const save = async (): Promise<void> => {
    if (!api || !preview) return
    const r = await api.save({ title: preview.title, body: preview.body })
    setMsg(r.ok ? `已保存到 ${r.path}` : (r.error ?? '保存失败'))
  }

  return (
    <div className="rounded-xl border border-cream bg-white/60 px-5 py-4">
      <div className="flex flex-wrap gap-1.5">
        {(['bug', 'idea', 'source', 'other'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={[
              'rounded-full border px-3 py-1 text-[11.5px] transition-colors',
              category === c ? 'border-accent bg-accent-soft text-accent' : 'border-cream text-ink/60 hover:border-accent'
            ].join(' ')}
          >
            {{ bug: '缺陷', idea: '功能建议', source: '信息源问题', other: '其他' }[c]}
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="发生了什么？你期望什么？（越具体越好，比如「点立即采集后停在运行中」）"
        className="mt-3 w-full resize-y rounded-lg border border-cream bg-white px-3 py-2 text-[12px] leading-5 outline-none focus:border-accent"
      />

      <label className="mt-2 flex items-center gap-2 text-[11.5px] text-ink/70">
        <input
          type="checkbox"
          checked={includeDiag}
          onChange={(e) => setIncludeDiag(e.target.checked)}
          className="accent-[#3A2921]"
        />
        附带诊断信息（版本、源健康度、最近运行、日志尾部；密钥/邮箱/用户名已打码）
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          disabled={busy || !hasIpc || message.trim().length === 0}
          onClick={() => void compose()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          {busy ? '生成中…' : '生成反馈材料'}
        </button>
        {preview && (
          <>
            <button onClick={() => void copy()} className="rounded-lg border border-cream px-3 py-1.5 text-[12px] hover:border-accent">
              复制
            </button>
            <button onClick={() => void save()} className="rounded-lg border border-cream px-3 py-1.5 text-[12px] hover:border-accent">
              保存为文件
            </button>
            {preview.issueUrl && (
              <a
                href={preview.issueUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-cream px-3 py-1.5 text-[12px] hover:border-accent"
              >
                在 GitHub 新建 issue
              </a>
            )}
          </>
        )}
      </div>

      {preview && (
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-cream/50 px-3 py-2 text-[11px] leading-5 text-ink/70">
          {preview.body}
        </pre>
      )}
      {msg && <p className="mt-2 text-[11.5px] text-ink/70">{msg}</p>}
      {!hasIpc && <p className="mt-2 text-[11px] text-ink-3/70">预览模式下不可用。</p>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-cream/60 py-1.5 last:border-b-0">
      <span className="text-ink-3">{k}</span>
      <span className="text-ink/80">{v}</span>
    </div>
  )
}

/**
 * 密钥面板。
 * 三种来源要能一眼看懂：本地加密存储 / 环境变量 / DSH 凭据文件。
 * 本机装了 DSH 的话，给一个一键导入——这是最快让应用"真的会用 AI"的路径。
 */
function KeyPanel(): React.JSX.Element {
  const [status, setStatus] = useState<KeyStatusPayload | null>(null)
  const [input, setInput] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.meerkat?.key
    if (!api) return
    try {
      setStatus(await api.status())
    } catch {
      /* 预览模式忽略 */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string; masked?: string }>, okText: string) => {
      setBusy(true)
      setMsg('')
      try {
        const r = await fn()
        setMsg(r.ok ? okText : (r.error ?? '操作失败'))
        if (r.ok) {
          setInput('')
          await refresh()
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const api = window.meerkat?.key
  const hasIpc = api !== undefined

  return (
    <div className="rounded-xl border border-cream bg-white/60 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-ink">DeepSeek API Key</span>
        {status?.hasKey ? (
          <span className="flex items-center gap-1.5 text-[11.5px] text-ink/70">
            <span className="h-1.5 w-1.5 rounded-full bg-ink/70" />
            {status.sourceLabel} · {status.masked}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11.5px] text-alert">
            <span className="h-1.5 w-1.5 rounded-full bg-alert" />
            未配置 · 简报会降级
          </span>
        )}
      </div>

      {status?.dshAvailable && status.source !== 'store' && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-cream/50 px-3 py-2">
          <span className="flex-1 text-[11.5px] text-ink/70">
            检测到本机的 DeepSeek Harness 凭据，可直接导入并加密保存
          </span>
          <button
            disabled={busy || !hasIpc}
            onClick={() => void act(() => api!.importDsh(), '已导入并加密保存')}
            className="shrink-0 rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper disabled:opacity-40"
          >
            一键导入
          </button>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="sk-…"
          disabled={!hasIpc}
          className="flex-1 rounded-lg border border-cream bg-white px-3 py-2 text-[12px] outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          disabled={busy || !hasIpc || input.trim().length === 0}
          onClick={() => void act(() => api!.set(input), '已保存（加密存储）')}
          className="rounded-lg border border-cream px-3 py-2 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          保存
        </button>
        {status?.source === 'store' && (
          <button
            disabled={busy}
            onClick={() => void act(() => api!.clear(), '已清除本机保存的密钥')}
            className="rounded-lg border border-cream px-3 py-2 text-[12px] text-ink/60 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
          >
            清除
          </button>
        )}
      </div>

      {status && !status.canEncrypt && (
        <p className="mt-2 text-[11px] text-alert">系统加密不可用，无法安全保存。请改用环境变量。</p>
      )}
      {msg && <p className="mt-2 text-[11.5px] text-ink/70">{msg}</p>}
      {!hasIpc && <p className="mt-2 text-[11px] text-ink-3/70">预览模式下不可用。</p>}
    </div>
  )
}
