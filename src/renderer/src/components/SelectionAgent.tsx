import { useEffect, useState } from 'react'

interface SelectionState {
  text: string
  top: number
  left: number
  itemId?: string
  title?: string
}

/**
 * 选中正文文字后浮出的小工具条。
 *
 * 阅读时看到一句想追问的话，直接选中就能进 agent，不需要先点右下角按钮。
 * 选中内容在新闻卡片里时额外提供「跟踪」；纯段落只提供提问。
 */
export function SelectionAgent(): React.JSX.Element | null {
  const [state, setState] = useState<SelectionState | null>(null)

  useEffect(() => {
    const clear = (): void => setState(null)

    const read = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        clear()
        return
      }
      const text = sel.toString().trim()
      if (text.length < 2 || text.length > 300) {
        clear()
        return
      }
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
      if (!el || !el.closest('main')) {
        clear()
        return
      }
      // 输入框、聊天面板里的选择不弹，避免和编辑操作打架
      if (el.closest('input, textarea, [contenteditable="true"], section[role="dialog"]')) {
        clear()
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        clear()
        return
      }
      const card = el.closest('[data-item-id]') as HTMLElement | null
      const width = 300
      setState({
        text,
        top: Math.min(window.innerHeight - 52, Math.max(8, rect.bottom + 8)),
        left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.left)),
        ...(card?.dataset.itemId ? { itemId: card.dataset.itemId } : {}),
        ...(card?.dataset.itemTitle ? { title: card.dataset.itemTitle } : {})
      })
    }

    const insideToolbar = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-selection-agent]') !== null

    // mouseup 之后 selection 才稳定；用 0ms 延迟读
    const onMouseUp = (e: MouseEvent): void => {
      if (insideToolbar(e.target)) return
      setTimeout(read, 0)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        clear()
        return
      }
      setTimeout(read, 0)
    }
    const onDown = (e: MouseEvent): void => {
      if (!insideToolbar(e.target)) clear()
    }
    const onScroll = (): void => clear()

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  if (!state) return null

  const ask = (mode: 'ask' | 'track'): void => {
    setState(null)
    window.getSelection()?.removeAllRanges()
    window.dispatchEvent(
      new CustomEvent('meerkat:ask-agent', {
        detail: {
          text: state.text,
          mode,
          ...(state.itemId ? { itemId: state.itemId } : {}),
          ...(state.title ? { title: state.title } : {})
        }
      })
    )
  }

  return (
    <div
      data-selection-agent
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-rule bg-white px-1 py-1"
      style={{ top: state.top, left: state.left, boxShadow: '0 12px 30px -12px rgba(11,18,32,.35)' }}
      role="toolbar"
      aria-label="用 agent 处理选中文字"
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ask('ask')}
        className="rounded-md px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft"
      >
        用 agent 提问
      </button>
      {state.itemId && (
        <>
          <span className="h-3 w-px bg-rule" />
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ask('track')}
            className="rounded-md px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:bg-cream hover:text-ink"
          >
            跟踪
          </button>
        </>
      )}
    </div>
  )
}
