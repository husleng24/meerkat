import type { BriefItem, BriefLink } from '../lib/parseBrief'

/**
 * 同一来源常被引用多次（模型给的是不同 URL）。
 * 直接并排渲染会变成 "TechCrunch TechCrunch TechCrunch"，
 * 所以按来源名归组、只保留一个可点链接，用 ×N 表达次数。
 */
function groupLinks(links: BriefLink[]): Array<{ label: string; url: string; count: number }> {
  const byLabel = new Map<string, { label: string; url: string; count: number }>()
  for (const l of links) {
    const hit = byLabel.get(l.label)
    if (hit) hit.count += 1
    else byLabel.set(l.label, { label: l.label, url: l.url, count: 1 })
  }
  return [...byLabel.values()]
}

interface Props {
  item: BriefItem
  selected: boolean
  saved: boolean
  hidden: boolean
  read: boolean
  lead?: boolean
  onSelect: () => void
  onToggleSave: () => void
  onToggleHide: () => void
  onOpen: () => void
  /** 有 itemId 时才给评论入口 */
  onComment?: () => void
}

/**
 * 一条简报。
 *
 * 悬浮卡片：白底 + 1px 边框定轮廓，悬停时加一层很淡的靛蓝投影并上浮 1px。
 * 选中态用靛蓝描边 + 浅底，不用左侧色条——色条是廉价的强调。
 */
export function ItemCard({
  item,
  selected,
  saved,
  hidden,
  read,
  lead = false,
  onSelect,
  onToggleSave,
  onToggleHide,
  onOpen,
  onComment
}: Props): React.JSX.Element {
  if (hidden) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-rule bg-white/60 px-4 py-2.5 text-[12px] text-ink-3">
        <span className="truncate">已隐藏 · {item.title}</span>
        <button onClick={onToggleHide} className="ml-auto shrink-0 font-medium text-accent hover:underline">
          撤销
        </button>
      </div>
    )
  }

  return (
    <article
      id={`item-${item.key}`}
      onClick={onSelect}
      className={[
        'card card-hover group relative cursor-default px-[18px]',
        // 选中态要"一眼看到"：加一圈 3px 的靛蓝光晕，不改边框宽度（避免布局抖动）
        selected ? 'border-accent bg-accent-soft/45 shadow-[0_0_0_3px_rgba(79,70,229,0.14)]' : '',
        lead ? 'py-[18px]' : 'py-[15px]'
      ].join(' ')}
    >
      <h3
        className={[
          'max-w-[62ch] font-bold leading-[1.55] tracking-[-0.015em] transition-colors',
          lead ? 'text-[15.5px]' : 'text-[15px]',
          read ? 'text-ink-2' : 'text-ink'
        ].join(' ')}
      >
        {item.title}
      </h3>

      <p
        className={[
          'mt-1.5 max-w-[66ch] leading-[1.75] text-[#39424f]',
          lead ? 'text-[14px]' : 'text-[13.8px]'
        ].join(' ')}
      >
        {item.body}
      </p>

      <footer className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
        {item.links.length > 0 && (
          <span className="rounded-full bg-cream px-2 py-0.5 tabular-nums text-ink-2">{item.links.length} 源</span>
        )}
        <span className="flex flex-wrap items-center gap-x-2.5">
          {groupLinks(item.links).map((l) => (
            <a
              key={l.label}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-accent/90 hover:text-accent hover:underline"
            >
              {l.count > 1 ? `${l.label} ×${l.count}` : l.label}
            </a>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {onComment && (
            <IconButton label="评论 · @agent 整理时间线" onClick={onComment}>
              💬
            </IconButton>
          )}
          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconButton label={saved ? '取消收藏' : '收藏 (s)'} active={saved} onClick={onToggleSave}>
              {saved ? '★' : '☆'}
            </IconButton>
            <IconButton label="打开原文 (o)" onClick={onOpen}>
              ↗
            </IconButton>
            <IconButton label="隐藏 (h)" onClick={onToggleHide}>
              ✕
            </IconButton>
          </span>
          {saved && <span className="font-medium text-accent/80">★ 已收藏</span>}
          {read && <span className="text-accent/70">已读</span>}
          {item.dateLabel && <span className="tabular-nums tracking-[0.04em]">{item.dateLabel}</span>}
        </span>
      </footer>
    </article>
  )
}

function IconButton({
  children,
  label,
  active,
  onClick
}: {
  children: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={[
        'grid h-6 w-6 place-items-center rounded-md text-[12px] transition-colors',
        active ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-cream hover:text-ink'
      ].join(' ')}
    >
      {children}
    </button>
  )
}
