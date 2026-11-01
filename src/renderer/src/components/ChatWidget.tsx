import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { actionPrompt, visibleActions, type ChatActionId } from '../../../core/chat/actions'
import type { ChatMessagePayload, ChatModelPayload, ChatThreadPayload } from '../lib/ipc-types'

interface Props {
  topicId: string
  /** 当前简报日期，用作默认上下文 */
  briefDate: string
  /** 有没有上一期：没有就藏起「和昨天比」 */
  hasPrevious: boolean
}

const OPEN_KEY = 'meerkat.chat.open'
const MODEL_KEY = 'meerkat.chat.model'

/**
 * 右下角 AI 对话。
 *
 * P0 的边界：单窗口浮层、非流式、一次只跑一条。设计里 P1 的流式、多会话列表、
 * 选中条目上下文都还没做——先把"问了有没有用"这件事验证掉。
 */
export function ChatWidget({ topicId, briefDate, hasPrevious }: Props): React.JSX.Element {
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY, false))
  const [thread, setThread] = useState<ChatThreadPayload | null>(null)
  const [messages, setMessages] = useState<ChatMessagePayload[]>([])
  const [models, setModels] = useState<ChatModelPayload[]>([])
  const [model, setModel] = useState(() => readString(MODEL_KEY) || 'deepseek-flash')
  const [includePrevious, setIncludePrevious] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const api = window.meerkat?.chat

  const actions = useMemo(() => visibleActions(hasPrevious), [hasPrevious])

  // 模型目录
  useEffect(() => {
    if (!api) return
    void api.models().then(setModels).catch(() => undefined)
  }, [api])

  // 打开时确保有会话并拉历史
  useEffect(() => {
    if (!open || !api || !topicId) return
    let cancelled = false
    void api
      .ensure({ topicId, ...(briefDate ? { briefDate } : {}), model })
      .then(async (t) => {
        if (cancelled || !t) return
        setThread(t)
        const history = await api.messages(t.id)
        if (!cancelled) setMessages(history)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // 只在打开/切主题/切日期时重新建会话；model 变化不应重开会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api, topicId, briefDate])

  // 新消息滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, sending])

  const toggle = useCallback(() => {
    setOpen((v) => {
      writeFlag(OPEN_KEY, !v)
      return !v
    })
  }, [])

  // ⌘J / Ctrl+J 开合；打开后焦点进输入框
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggle()
        setTimeout(() => document.getElementById('chat-input')?.focus(), 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const send = useCallback(
    async (text: string, actionId?: ChatActionId) => {
      if (!api || !thread || sending) return
      const body = text.trim() || (actionId ? actionPrompt(actionId) : '')
      if (!body) return
      setSending(true)
      setError('')
      setDraft('')
      try {
        const res = await api.send({
          threadId: thread.id,
          text: body,
          ...(actionId ? { actionId } : {}),
          model,
          includePrevious: includePrevious || actionId === 'compare'
        })
        if (!res.ok) {
          setError(res.error ?? '对话失败')
          // 失败时把用户那条补回界面：服务端已经存了，重开面板也会看到
          if (res.user) setMessages((prev) => [...prev, res.user!])
          return
        }
        if (res.user && res.assistant) setMessages((prev) => [...prev, res.user!, res.assistant!])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSending(false)
      }
    },
    [api, thread, sending, model, includePrevious]
  )

  const cancel = useCallback(async () => {
    await api?.cancel()
  }, [api])

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void send(draft)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      writeFlag(OPEN_KEY, false)
    }
  }

  if (!api) return <></>

  return (
    <>
      {open && (
        <section
          className="fixed bottom-24 right-5 z-40 flex h-[min(72vh,640px)] w-[420px] flex-col overflow-hidden rounded-2xl border border-rule bg-white"
          style={{ boxShadow: '0 30px 80px -40px rgba(11,18,32,.45), 0 2px 8px rgba(11,18,32,.05)' }}
          role="dialog"
          aria-label="AI 对话"
        >
          <header className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <span className="text-[13px] font-bold text-ink">AI 对话</span>
            <button
              onClick={toggle}
              className="ml-auto text-[11px] text-ink-3 transition-colors hover:text-ink"
            >
              收起 ⌘J
            </button>
          </header>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-4 py-2.5">
            <span className="rounded-full border border-rule bg-cream px-2.5 py-1 text-[10.5px] text-ink-2">
              今日简报 · {briefDate || '—'}
            </span>
            {hasPrevious && (
              <button
                onClick={() => setIncludePrevious((v) => !v)}
                className={[
                  'rounded-full border px-2.5 py-1 text-[10.5px] transition-colors',
                  includePrevious
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-rule text-ink-3 hover:border-accent hover:text-ink'
                ].join(' ')}
              >
                昨天{includePrevious ? ' ✓' : ' ＋'}
              </button>
            )}
            {thread && (
              <span className="ml-auto text-[10px] tabular-nums text-ink-3">上下文 ≈{fmtK(thread.contextTokens)}</span>
            )}
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !sending && (
              <p className="text-[12px] leading-relaxed text-ink-3">
                就这期简报提问，或者用下面的动作。回答只依据简报内容，不会编外部信息。
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  'text-[12.5px] leading-[1.75]',
                  m.role === 'user' ? 'rounded-xl bg-cream px-3 py-2 text-ink' : 'text-ink'
                ].join(' ')}
              >
                {m.role === 'assistant' && (
                  <div className="mb-1 text-[10px] text-ink-3">AI{m.model ? ` · ${m.model}` : ''}</div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                正在读简报…
                <button onClick={() => void cancel()} className="ml-auto text-accent hover:underline">
                  停止
                </button>
              </div>
            )}
            {error && <div className="rounded-lg bg-alert/10 px-3 py-2 text-[11.5px] text-alert">{error}</div>}
          </div>

          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {actions.map((a) => (
              <button
                key={a.id}
                title={a.hint}
                disabled={sending}
                onClick={() => void send('', a.id)}
                className="rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="mx-3 mb-3 rounded-xl border border-rule px-3 py-2">
            <textarea
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKey}
              rows={2}
              placeholder="问点什么，⌘↵ 发送…"
              className="w-full resize-none bg-transparent text-[12.5px] leading-6 text-ink outline-none placeholder:text-ink-3/70"
            />
            <div className="mt-1 flex items-center gap-2">
              {sending ? (
                <button
                  onClick={() => void cancel()}
                  className="rounded-lg border border-rule px-2.5 py-1 text-[10.5px] text-ink-2 hover:border-alert hover:text-alert"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={() => void send(draft)}
                  disabled={!draft.trim()}
                  className="rounded-lg bg-ink px-3 py-1 text-[10.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  发送
                </button>
              )}
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value)
                  writeString(MODEL_KEY, e.target.value)
                }}
                className="ml-auto rounded-full border border-rule bg-white px-2 py-0.5 text-[10.5px] text-ink-2 outline-none focus:border-accent"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      <button
        onClick={toggle}
        title="问一问（⌘J）"
        aria-label="打开 AI 对话"
        className="fixed bottom-6 right-6 z-40 grid h-[52px] w-[52px] place-items-center rounded-full text-white transition-transform hover:scale-105"
        style={{
          background: 'linear-gradient(135deg,#4f46e5,#06b6d4)',
          boxShadow: '0 12px 30px -10px rgba(79,70,229,.55)'
        }}
      >
        <span className="text-[18px] leading-none">{open ? '×' : '✦'}</span>
      </button>
    </>
  )
}

function fmtK(n: number): string {
  if (!n) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* 隐私模式忽略 */
  }
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 忽略 */
  }
}
