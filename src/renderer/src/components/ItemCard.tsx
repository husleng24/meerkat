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
  index: number
  selected: boolean
  saved: boolean
  hidden: boolean
  read: boolean
  onSelect: () => void
  onToggleSave: () => void
  onToggleHide: () => void
  onOpen: () => void
}

/**
 * 条目卡片。
 * 设计原则：默认只给"标题 + 一句解读"，链接和证据按需展开——
 * 5 分钟阅读的核心是密度，不是把所有信息一次推到脸上。
 */
export function ItemCard({
  item,
  index,
  selected,
  saved,
  hidden,
  read,
  onSelect,
  onToggleSave,
  onToggleHide,
  onOpen
}: Props): React.JSX.Element {
  if (hidden) {
    return (
      <div className="rounded-lg border border-dashed border-cream px-4 py-2 text-xs text-caramel/70">
        已隐藏 · {item.title.slice(0, 40)}…
        <button onClick={onToggleHide} className="ml-2 underline hover:text-ink">
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
        'group relative rounded-xl border px-5 py-4 transition-colors cursor-default',
        selected
          ? 'border-caramel bg-white shadow-sm'
          : 'border-cream bg-white/50 hover:border-caramel/50 hover:bg-white/80'
      ].join(' ')}
    >
      {/* 选中指示条：键盘导航的视觉锚点 */}
      <span
        className={[
          'absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-opacity',
          selected ? 'bg-caramel opacity-100' : 'opacity-0'
        ].join(' ')}
      />

      <header className="flex items-baseline gap-2">
        <span className="text-[11px] tabular-nums text-caramel/70">{String(index + 1).padStart(2, '0')}</span>
        <h3 className={['flex-1 text-[15px] font-semibold leading-6', read ? 'text-ink/55' : 'text-ink'].join(' ')}>
          {item.title}
        </h3>
        {read && <span className="h-1 w-1 shrink-0 rounded-full bg-caramel/60" title="已读" />}
        {item.dateLabel && <span className="text-[11px] tabular-nums text-caramel">{item.dateLabel}</span>}
      </header>

      <p className="mt-2 text-[13.5px] leading-6 text-ink/85">{item.body}</p>

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {item.links.length > 0 && (
          <span
            className="rounded-full bg-cream px-2 py-0.5 text-[11px] text-ink/70"
            title={item.links.map((l) => l.label).join(' · ')}
          >
            {item.links.length} 源
          </span>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
          {groupLinks(item.links).map((l) => (
            <a
              key={l.label}
              href={l.url}
              onClick={(e) => e.stopPropagation()}
              className="text-ink/60 underline decoration-cream decoration-2 underline-offset-2 hover:text-ink hover:decoration-caramel"
            >
              {l.count > 1 ? `${l.label} ×${l.count}` : l.label}
            </a>
          ))}
        </div>

        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
        'grid h-6 w-6 place-items-center rounded-md border text-[12px] transition-colors',
        active
          ? 'border-caramel bg-cream text-ink'
          : 'border-transparent text-ink/40 hover:border-cream hover:bg-cream hover:text-ink'
      ].join(' ')}
    >
      {children}
    </button>
  )
}
