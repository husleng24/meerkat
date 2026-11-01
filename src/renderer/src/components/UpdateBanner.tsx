import { useEffect, useState } from 'react'
import type { UpdateCheckPayload } from '../lib/ipc-types'

const DISMISS_KEY = 'meerkat.update.dismissed'

/**
 * 侧栏之上的一条细提示：有新版本时才出现。
 *
 * 只提示、不自动下载：两个平台都是未签名包，静默替换安装包会被 Gatekeeper /
 * SmartScreen 拦掉。用户点了「下载」才跳浏览器。
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent/20 bg-accent-soft/50 px-10 py-2 text-[11.5px] text-ink-2">
      <span>
        新版本 <b className="text-ink">{info.latest}</b> 可用（当前 v{info.current}）
      </span>
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
  )
}
