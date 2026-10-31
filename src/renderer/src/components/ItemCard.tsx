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
}

/**
 * 一条简报。
 *
 * 从"卡片"改成"报纸行"：没有边框、没有阴影、没有序号。
 * 分隔线负责节奏，悬停是一层暖光洗过而不是抬起来——
 * 早上读的是内容，界面不该跟着动。
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
  onOpen
}: Props): React.JSX.Element {
  if (hidden) {
    return (
      <div className="flex items-center gap-2 border-b border-rule py-3 text-[12px] text-ink-3">
        <span className="truncate">已隐藏 · {item.title}</span>
        <button onClick={onToggleHide} className="ml-auto shrink-0 text-accent hover:underline">
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
        'group relative -mx-5 cursor-default px-5 transition-colors duration-150',
        lead ? 'py-5' : 'py-[15px]',
        selected ? 'bg-accent-soft/45' : 'hover:bg-[linear-gradient(90deg,rgba(79,70,229,0.045),transparent_72%)]'
      ].join(' ')}
    >
      {/* 选中标记用一个小圆点，不用左侧色条——色条是廉价的强调，且会跟分隔线打架 */}
      {selected && <span className="absolute left-1.5 top-[22px] h-1.5 w-1.5 rounded-full bg-accent" />}

      <h3
        className={[
          'max-w-[64ch] font-bold leading-[1.5] transition-colors',
          lead ? 'text-[18.5px] tracking-[-0.022em]' : 'text-[16px] tracking-[-0.012em]',
          read ? 'text-ink-2' : 'text-ink'
        ].join(' ')}
      >
        {item.title}
      </h3>

      <p className={['mt-1.5 max-w-[68ch] leading-[1.78] text-[#2f2a26]', lead ? 'text-[15px]' : 'text-[14px]'].join(' ')}>{item.body}</p>

      <footer className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-3">
        {item.links.length > 0 && <span className="tabular-nums">{item.links.length} 源</span>}
        <span className="h-[3px] w-[3px] rounded-full bg-ink-3/60" />
        <span className="flex flex-wrap items-center gap-x-2.5">
          {groupLinks(item.links).map((l) => (
            <a
              key={l.label}
              href={l.url}
              onClick={(e) => e.stopPropagation()}
              className="text-ink-2 underline decoration-rule decoration-1 underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent/40"
            >
              {l.count > 1 ? `${l.label} ×${l.count}` : l.label}
            </a>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3">
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
          {read && <span className="text-accent/70">已读</span>}
          {item.dateLabel && <span className="tabular-nums tracking-[0.06em]">{item.dateLabel}</span>}
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
