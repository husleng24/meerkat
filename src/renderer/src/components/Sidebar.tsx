interface Props {
  active: string
  onNavigate: (id: string) => void
  itemCount: number
  savedCount: number
  readCount: number
  failedSources: number
  origin: 'ipc' | 'sample'
  bridgeAvailable: boolean
  dateLabel: string
}

const NAV = [
  { id: 'today', label: '今日', hint: '' },
  { id: 'search', label: '搜索', hint: '' },
  { id: 'timeline', label: '时间线', hint: '' },
  { id: 'sources', label: '源', hint: 'warn' },
  { id: 'settings', label: '设置', hint: '' }
]

/**
 * 左侧导航。
 *
 * 从前是米色底板 + 白色药丸 + 阴影；现在退成近白 + 一条细线，
 * 选中态用靛蓝浅底与靛蓝字，不再需要阴影来"抬起来"。
 * 橙色（现在是红色）只留给"失效源"——全站唯一的警报位。
 */
export function Sidebar({
  active,
  onNavigate,
  itemCount,
  savedCount,
  readCount,
  failedSources,
  origin,
  bridgeAvailable,
  dateLabel
}: Props): React.JSX.Element {
  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 pt-6">
      <div className="flex items-center gap-2.5 px-2">
        <img src="./icon-meerkat-64.png" alt="" className="h-8 w-8 rounded-[10px]" />
        <div className="leading-tight">
          <div className="text-[13.5px] font-bold tracking-[-0.02em] text-ink">Meerkat</div>
          <div className="text-[10px] tracking-[0.06em] text-ink-3">替你盯着</div>
        </div>
      </div>

      <nav className="mt-7 flex flex-col gap-0.5">
        {NAV.map((n) => {
          const isActive = n.id === active
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={[
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'font-medium text-ink-2 hover:bg-cream hover:text-ink'
              ].join(' ')}
            >
              <span className="flex-1">{n.label}</span>
              {n.id === 'sources' && failedSources > 0 && (
                <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#fee2e2] px-1 text-[10px] font-bold text-[#dc2626]">
                  {failedSources}
                </span>
              )}
              {n.id === 'timeline' && <span className="text-[10px] tabular-nums text-ink-3">{dateLabel}</span>}
            </button>
          )
        })}
      </nav>

      <div className="mx-2 my-5 h-px bg-rule" />

      <div className="space-y-1.5 px-2.5 text-[11.5px] text-ink-3">
        <Row label="今日条目" value={String(itemCount)} />
        <Row label="已读" value={String(readCount)} />
        <Row label="已收藏" value={String(savedCount)} />
        <Row label="失效源" value={failedSources > 0 ? String(failedSources) : '0'} warn={failedSources > 0} />
      </div>

      <div className="mt-auto px-2.5 text-[10px] leading-relaxed text-ink-3">
        {!bridgeAvailable
          ? '浏览器预览（无 preload）'
          : origin === 'sample'
            ? '示例数据 · 还没有简报'
            : '数据来源：本地数据库'}
      </div>
    </aside>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={warn ? 'font-bold tabular-nums text-alert' : 'tabular-nums text-ink-2'}>{value}</span>
    </div>
  )
}
