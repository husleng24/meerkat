import type { ReactNode } from 'react'

/**
 * 对话消息里的轻量 markdown 渲染。
 *
 * 为什么不用 marked/react-markdown：这里只需要标题、列表、粗体、行内代码和链接，
 * 引一个解析库换来的是 XSS 面（必须再配 sanitizer）和几十 KB。模型输出的结构
 * 由我们的提示词约束，是受控子集——用 React 元素手工渲染，天然没有注入问题。
 */
export function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  const blocks = splitBlocks(text)
  return <div className="space-y-1.5">{blocks.map((b, i) => renderBlock(b, i))}</div>
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }

function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'p', lines: para })
      para = []
    }
  }
  const flushList = (): void => {
    if (list) {
      blocks.push(list.kind === 'ul' ? { kind: 'ul', items: list.items } : { kind: 'ol', items: list.items })
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      flushList()
      blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]! })
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, items: [] }
      }
      list.items.push((ul ?? ol)![1]!)
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks
}

function renderBlock(b: Block, key: number): React.JSX.Element {
  if (b.kind === 'h') {
    const cls =
      b.level <= 2 ? 'text-[13px] font-bold text-ink' : 'text-[12.5px] font-semibold text-ink'
    return (
      <p key={key} className={cls}>
        {inline(b.text)}
      </p>
    )
  }
  if (b.kind === 'ul') {
    return (
      <ul key={key} className="list-disc space-y-0.5 pl-4">
        {b.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ul>
    )
  }
  if (b.kind === 'ol') {
    return (
      <ol key={key} className="list-decimal space-y-0.5 pl-4">
        {b.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ol>
    )
  }
  return (
    <p key={key}>
      {b.lines.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {inline(l)}
        </span>
      ))}
    </p>
  )
}

/** 行内：链接 → 粗体 → 行内代码。顺序有讲究：先切链接，避免 URL 里的 ** 被当成粗体 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let key = 0

  const pushText = (s: string): void => {
    if (!s) return
    out.push(<span key={`t${key++}`}>{renderEmphasis(s, key)}</span>)
  }

  for (;;) {
    const m = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(rest)
    if (!m) {
      pushText(rest)
      break
    }
    pushText(rest.slice(0, m.index))
    out.push(
      <a
        key={`a${key++}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
      >
        {m[1]}
      </a>
    )
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

function renderEmphasis(text: string, seed: number): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let key = seed * 100
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(
        <strong key={`b${key++}`} className="font-semibold text-ink">
          {m[1]}
        </strong>
      )
    } else {
      out.push(
        <code key={`c${key++}`} className="rounded bg-cream px-1 py-0.5 font-mono text-[11.5px]">
          {m[2]}
        </code>
      )
    }
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
