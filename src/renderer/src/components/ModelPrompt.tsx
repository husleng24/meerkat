interface Props {
  onOpenSettings: () => void
  onDismiss: () => void
}

/**
 * 首份「仅聚合」简报之后的轻提示。
 *
 * 刻意不放在首屏：先让用户看到一份真实产物，再问要不要接模型。
 * 只显示在最新一期的今日页，历史回看不打扰。
 */
export function ModelPrompt({ onOpenSettings, onDismiss }: Props): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rule bg-white px-4 py-3">
      <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold leading-[1.4] text-accent">
        仅聚合
      </span>
      <p className="min-w-0 flex-1 text-[11.5px] leading-[1.65] text-ink-2">
        这期是「仅聚合」版：只有标题、来源和链接。接上模型后，会写成三句话速览。
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="text-[11.5px] font-medium text-accent hover:underline"
      >
        去设置接模型
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[11.5px] text-ink-3 transition-colors hover:text-ink"
      >
        以后再说
      </button>
    </div>
  )
}
