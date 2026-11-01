import { useEffect } from 'react'

/** 单一真源：快捷键面板与各处提示都从这里取，避免两处写得不一样 */
export const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['j', 'k'], what: '下一条 / 上一条' },
  { keys: ['g', '⇧G'], what: '跳到首条 / 末条' },
  { keys: ['s'], what: '收藏' },
  { keys: ['o'], what: '打开原文' },
  { keys: ['m'], what: '标记已读' },
  { keys: ['h'], what: '隐藏 / 取消隐藏' },
  { keys: ['Ctrl/⌘', 'K'], what: '搜索' },
  { keys: ['?'], what: '打开这个面板' },
  { keys: ['Esc'], what: '关闭' }
]

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 快捷键帮助。
 *
 * 之前 `j/k/s/o/m/h` 只有正文底部一行小字提示——那条提示还占着版面。
 * 收进 `?` 之后，底部只留一句"按 ? 看全部"，学会了就不需要再看。
 */
export function ShortcutHelp({ open, onClose }: Props): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="快捷键"
    >
      <div
        className="card w-full max-w-[420px] px-6 py-5"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 24px 60px -30px rgba(11,18,32,0.45)' }}
      >
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[14px] font-bold tracking-[-0.01em] text-ink">快捷键</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            title="关闭 (Esc)"
            className="grid h-6 w-6 place-items-center rounded-md text-[13px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1">
          {SHORTCUTS.map((s) => (
            <li key={s.what} className="flex items-center justify-between rounded-lg px-1.5 py-1.5">
              <span className="text-[12.5px] text-ink-2">{s.what}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-rule pt-2.5 text-[10.5px] leading-relaxed text-ink-3">
          输入框聚焦时快捷键不生效（中文输入法要能正常打字）。
        </p>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="min-w-[22px] rounded border border-rule bg-cream px-1.5 py-0.5 text-center font-mono text-[10.5px] text-ink-2">
      {children}
    </kbd>
  )
}
