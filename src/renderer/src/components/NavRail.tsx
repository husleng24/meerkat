import { UpdateNotice } from './UpdateNotice'

interface Props {
  active: string
  attentionSources: number
  /** 跟踪中/待确认数量；不传时入口仍然显示，只是没有数字 */
  tracking?: { active: number; quiet: number }
  onNavigate: (id: string) => void
}

interface RailItem {
  id: string
  label: string
  icon: React.JSX.Element
}

const iconProps = {
  width: 17,
  height: 17,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.35,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function HomeIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M2.4 7.2 8 2.5l5.6 4.7v5.4a.9.9 0 0 1-.9.9H3.3a.9.9 0 0 1-.9-.9V7.2Z" />
      <path d="M6.2 13.5V9.8h3.6v3.7" />
    </svg>
  )
}
function TrackingIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <path d="M8 2.5v2M13.5 8h-2" />
    </svg>
  )
}
function SearchIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  )
}
function ClockIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}
function LayersIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="m8 2.3 5.2 2.8L8 7.9 2.8 5.1 8 2.3Z" />
      <path d="m3 8 5 2.7L13 8M3 10.7l5 2.7 5-2.7" />
    </svg>
  )
}
function VideoIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="2.2" y="4" width="8.6" height="8" rx="1.6" />
      <path d="m10.8 7.2 3-1.6v4.8l-3-1.6" />
    </svg>
  )
}
function ReviewIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="3" y="2.4" width="10" height="11.2" rx="1.6" />
      <path d="M5.4 5.6h5.2M5.4 8h5.2M5.4 10.4h3.2" />
    </svg>
  )
}
function EntityIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="5" r="2.2" />
      <path d="M3.5 13.2c.4-2.5 2.1-3.9 4.5-3.9s4.1 1.4 4.5 3.9" />
    </svg>
  )
}
function GearIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.9v1.4M8 12.7v1.4M14.1 8h-1.4M3.3 8H1.9M12.3 3.7l-1 1M4.7 11.3l-1 1M12.3 12.3l-1-1M4.7 4.7l-1-1" />
    </svg>
  )
}

const ITEMS: RailItem[] = [
  { id: 'today', label: '今日简报', icon: <HomeIcon /> },
  { id: 'stories', label: '跟踪', icon: <TrackingIcon /> },
  { id: 'search', label: '搜索', icon: <SearchIcon /> },
  { id: 'timeline', label: '历史简报', icon: <ClockIcon /> },
  { id: 'sources', label: '事实源', icon: <LayersIcon /> },
  { id: 'videos', label: '视频解读', icon: <VideoIcon /> },
  { id: 'review', label: '周回顾', icon: <ReviewIcon /> },
  { id: 'entities', label: '实体', icon: <EntityIcon /> },
  { id: 'settings', label: '设置', icon: <GearIcon /> }
]

/** 最左侧的常驻导航栏：所有全局入口一眼可见，不需要先点开菜单。 */
export function NavRail({ active, attentionSources, tracking, onNavigate }: Props): React.JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  return (
    <nav
      aria-label="全局导航"
      className={`flex w-[44px] shrink-0 flex-col items-center border-r border-rule bg-white pb-4 ${isMac ? 'pt-10' : 'pt-3'}`}
    >
      <div className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const selected = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={selected ? 'page' : undefined}
              title={
                item.id === 'stories' && tracking?.active
                  ? `跟踪 · ${tracking.active} 个进行中`
                  : item.id === 'stories' && tracking?.quiet
                    ? `跟踪 · ${tracking.quiet} 个很久没进展`
                    : item.label
              }
              className={[
                'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                selected ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-cream hover:text-ink'
              ].join(' ')}
            >
              {item.icon}
              {item.id === 'stories' && tracking && tracking.quiet > 0 && (
                <span
                  aria-label={`${tracking.quiet} 个跟踪很久没有新进展`}
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-alert ring-2 ring-white"
                />
              )}
              {item.id === 'stories' && tracking && tracking.active > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 min-w-[13px] rounded-full bg-ink px-1 text-center text-[8px] leading-[13px] text-paper">
                  {tracking.active > 9 ? '9+' : tracking.active}
                </span>
              )}
              {item.id === 'sources' && attentionSources > 0 && (
                <span
                  aria-label={`${attentionSources} 个事实源需关注`}
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-alert ring-2 ring-white"
                />
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-auto pt-3">
        <UpdateNotice />
      </div>
    </nav>
  )
}
