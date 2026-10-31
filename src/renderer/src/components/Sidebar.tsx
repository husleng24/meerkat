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

/** 左侧导航。橙色只用在"源失效"这一个地方——它是全站唯一的警报位。 */
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
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-cream bg-[#F1EBE0]">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <img src="./icon-meerkat-64.png" alt="" className="h-8 w-8 rounded-lg" />
        <div className="leading-tight">
          <div className="text-[13px] font-bold text-ink">Meerkat</div>
          <div className="text-[10px] text-caramel">替你盯着</div>
        </div>
      </div>

      <nav className="px-3">
        {NAV.map((n) => {
          const isActive = n.id === active
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={[
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                isActive ? 'bg-white font-semibold text-ink shadow-sm' : 'text-ink/70 hover:bg-white/60'
              ].join(' ')}
            >
              <span className="flex-1">{n.label}</span>
              {n.id === 'sources' && failedSources > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-alert px-1 text-[10px] font-bold text-white">
                  {failedSources}
                </span>
              )}
              {n.id === 'timeline' && <span className="text-[10px] text-caramel/60">{dateLabel}</span>}
            </button>
          )
        })}
      </nav>

      <div className="mx-5 my-4 h-px bg-cream" />

      <div className="space-y-1.5 px-5 text-[11.5px] text-ink/60">
        <Row label="今日条目" value={String(itemCount)} />
        <Row label="已读" value={String(readCount)} />
        <Row label="已收藏" value={String(savedCount)} />
        <Row label="失效源" value={failedSources > 0 ? `${failedSources}` : '0'} warn={failedSources > 0} />
      </div>

      <div className="mt-auto px-5 pb-5 text-[10px] leading-relaxed text-caramel/70">
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
      <span className={warn ? 'font-semibold text-alert' : 'tabular-nums text-ink/80'}>{value}</span>
    </div>
  )
}
