import { useEffect, useRef, useState } from 'react'
import type { UpdateCheckPayload } from '../lib/ipc-types'

/**
 * 侧栏底部的升级入口。
 *
 * 克制成一个 36px 图标 + 红点：有新版本才出现，点击展开更新卡片。
 * 仍然只打开 Release 页，不自动下载/安装——两个平台的包都未签名。
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateCheckPayload | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const api = window.meerkat?.update
    if (!api) return
    void api.latest().then((v) => {
      if (v) setInfo(v)
    })
    return api.onAvailable((v) => setInfo(v))
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!info?.hasUpdate || !info.url) return null

  const openRelease = (): void => {
    void window.meerkat?.update?.open(info.url!)
    setOpen(false)
  }
  const notes = info.notes?.replace(/\r\n/g, '\n').trim() ?? ''
  const notesPreview = notes
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '· ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 700)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`有新版本 ${info.latest}，查看更新`}
        aria-expanded={open}
        title={`当前 v${info.current}，有新版本 ${info.latest}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent transition-colors hover:bg-accent-soft/70"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2.2v7.1M5.2 6.5 8 9.3l2.8-2.8M3 12.7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-alert ring-2 ring-white" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="软件更新"
          className="absolute bottom-full left-0 z-40 mb-2 w-[300px] rounded-xl border border-rule bg-white p-3.5 shadow-xl"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-ink">发现新版本 {info.latest}</p>
              <p className="mt-0.5 text-[10.5px] text-ink-3">当前 v{info.current}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="关闭" className="text-[14px] leading-none text-ink-3 hover:text-ink">
              ×
            </button>
          </div>

          {notes && (
            <p className="mt-2.5 max-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-cream/60 px-2.5 py-2 text-[10.5px] leading-5 text-ink-2">
              {notesPreview}
            </p>
          )}

          <p className="mt-2 text-[10px] leading-4 text-ink-3">安装包未签名；请到 Release 页选择对应平台下载并手动安装。</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button onClick={openRelease} className="rounded-lg bg-ink px-2.5 py-1.5 text-[10.5px] font-medium text-paper">
              下载安装包
            </button>
            <button onClick={openRelease} className="rounded-lg border border-cream px-2.5 py-1.5 text-[10.5px] text-ink-2 hover:border-accent">
              查看完整说明
            </button>
            <button onClick={() => setOpen(false)} className="ml-auto text-[10.5px] text-ink-3 hover:text-ink">
              稍后
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
