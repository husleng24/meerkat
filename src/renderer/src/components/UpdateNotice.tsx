import { useEffect, useState } from 'react'
import type { UpdateCheckPayload } from '../lib/ipc-types'

/**
 * 侧栏底部的升级入口。
 *
 * 比内容区顶部的整条横幅克制：不占正文宽度、不打断阅读，位置固定在侧栏底部，
 * 和有新消息的侧栏角标是同一种"顺带看一眼"的存在。
 *
 * 图标用向下的箭头（下载语义），而不是向上——这里表达的是"去下载"，不是"上传"。
 * 点击直接打开 Release 页：changelog 与安装包都在那一页；设置 → 关于 里另有
 * 应用内的 changelog 展开。
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateCheckPayload | null>(null)

  useEffect(() => {
    const api = window.meerkat?.update
    if (!api) return
    void api.latest().then((v) => {
      if (v) setInfo(v)
    })
    return api.onAvailable((v) => setInfo(v))
  }, [])

  if (!info?.hasUpdate || !info.url) return null

  return (
    <button
      onClick={() => void window.meerkat?.update?.open(info.url!)}
      title={`当前 v${info.current}，点击查看 ${info.latest} 的更新内容与下载`}
      className="mb-3 flex w-full items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-[7px] text-left text-[12px] text-accent transition-colors hover:bg-accent-soft/70"
    >
      <span aria-hidden="true" className="shrink-0">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1.8v5.4M3.6 4.9 6 7.3l2.4-2.4M2.2 9.4h7.6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="truncate font-medium">新版本 {info.latest}</span>
      <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-accent/70">下载</span>
    </button>
  )
}
