import { useEffect, useState } from 'react'
import type { PushPlatform, PushStatePayload } from '../lib/ipc-types'

const LABELS: Record<PushPlatform, string> = {
  feishu: '飞书',
  slack: 'Slack',
  discord: 'Discord',
  generic: '通用 webhook'
}

/** 设置页的推送配置：一个 webhook，不引入账号体系。 */
export function PushPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState<PushPlatform>('feishu')
  const [state, setState] = useState<PushStatePayload | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const api = window.meerkat?.push
    if (!api) return
    void api
      .get()
      .then((s) => {
        setState(s)
        setEnabled(s.enabled)
        setUrl(s.webhookUrl)
        setPlatform(s.platform)
      })
      .catch(() => undefined)
  }, [])

  const save = async (): Promise<boolean> => {
    const api = window.meerkat?.push
    if (!api) return false
    const r = await api.set({ enabled, webhookUrl: url, platform })
    if (!r.ok) {
      setMsg(r.error ?? '保存失败')
      return false
    }
    setState((prev) => (prev ? { ...prev, enabled, webhookUrl: url, platform } : prev))
    setMsg('已保存')
    return true
  }

  const test = async (): Promise<void> => {
    const api = window.meerkat?.push
    if (!api) return
    setBusy(true)
    setMsg('')
    try {
      if (!(await save())) return
      const r = await api.test()
      setMsg(r.ok ? '测试消息已发送' : (r.error ?? '发送失败'))
    } finally {
      setBusy(false)
    }
  }

  const detect = async (): Promise<void> => {
    const api = window.meerkat?.push
    if (!api || !url.trim()) return
    const r = await api.detect(url)
    setPlatform(r.platform)
  }

  return (
    <div className="card px-5 py-4 text-[12px]">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="font-medium text-ink">每天简报完成后发送到 webhook</span>
      </label>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
        Webhook 地址本身就是密钥，只保存在本机 SQLite。飞书群机器人、Slack Incoming Webhook、Discord Webhook 都可以用。
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px]">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void detect()}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
          className="min-w-0 rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PushPlatform)}
          className="rounded-lg border border-cream bg-white px-2 py-1.5 text-[11.5px] outline-none focus:border-accent"
        >
          {(Object.keys(LABELS) as PushPlatform[]).map((p) => (
            <option key={p} value={p}>
              {LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save()}
          className="rounded-lg border border-cream px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent"
        >
          保存
        </button>
        <button
          onClick={() => void test()}
          disabled={busy || !url.trim()}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          {busy ? '发送中…' : '发送测试'}
        </button>
        {msg && <span className="text-[10.5px] text-ink-3">{msg}</span>}
      </div>

      {state?.lastAt && (
        <p className="mt-2 text-[10.5px] text-ink-3">
          上次尝试：{new Date(state.lastAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          {state.lastError ? ` · 失败：${state.lastError}` : ' · 成功'}
        </p>
      )}
    </div>
  )
}
