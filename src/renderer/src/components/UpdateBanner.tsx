import { useEffect, useState } from 'react'
import { ChatMarkdown } from './ChatMarkdown'
import type { UpdateCheckPayload } from '../lib/ipc-types'

const DISMISS_KEY = 'meerkat.update.dismissed'

/**
 * 内容区顶部的一条细提示：有新版本时才出现。
 *
 * 只提示、不自动下载：两个平台都是未签名包，静默替换安装包会被 Gatekeeper /
 * SmartScreen 拦掉。用户点了「下载更新」才跳浏览器。
 *
 * 图标用圆形 ↑ 徽章而不是 App 小图标：16px 的猫鼬细节会糊成一团，
 * 而 ↑ 在任意尺寸下都清楚，且表达的是"有更新"这个状态，不是品牌。
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateCheckPayload | null>(null)
  const [dismissed, setDismissed] = useState<string>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    const api = window.meerkat?.update
    if (!api) return
    void api.latest().then((v) => {
      if (v) setInfo(v)
    })
    return api.onAvailable((v) => setInfo(v))
  }, [])

  if (!info?.hasUpdate || !info.url || dismissed === info.latest) return null

  return (
    <div className="border-b border-accent/20 bg-accent-soft/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-10 py-2 text-[11.5px] text-ink-2">
        <span
          aria-hidden="true"
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M5 8V2.4M2.2 5 5 2.2 7.8 5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>
          新版本 <b className="text-ink">{info.latest}</b> 可用
        </span>
        <span className="tabular-nums text-ink-3">
          v{info.current} → {info.latest}
        </span>
        {info.notes && (
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="text-accent transition-colors hover:underline"
          >
            {showNotes ? '收起更新内容' : '更新内容'}
          </button>
        )}
        <button
          onClick={() => void window.meerkat?.update?.open(info.url!)}
          className="font-medium text-accent hover:underline"
        >
          下载更新
        </button>
        <button
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, info.latest ?? '')
            } catch {
              /* 忽略 */
            }
            setDismissed(info.latest ?? '')
          }}
          aria-label="忽略这个版本的提示"
          className="ml-auto rounded px-1 text-ink-3 transition-colors hover:text-ink"
        >
          ✕
        </button>
      </div>

      {showNotes && info.notes && (
        <div className="max-h-64 overflow-y-auto border-t border-accent/15 px-10 py-3 text-[12px] text-ink-2">
          <ChatMarkdown text={info.notes} />
        </div>
      )}
    </div>
  )
}
