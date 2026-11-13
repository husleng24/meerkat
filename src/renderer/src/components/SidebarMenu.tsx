import { useEffect, useRef, useState } from 'react'

interface Props {
  active: string
  attentionSources: number
  dateLabel: string
  onNavigate: (id: string) => void
}

interface Item {
  id: string
  label: string
  meta?: string
  warn?: boolean
  icon: React.JSX.Element
}

/**
 * 侧栏底部的全局导航。
 *
 * 四个页面（搜索/时间线/事实源/设置）不再各占一行：一个轻量按钮 + 向上弹出的菜单。
 * 事实源的告警以红点留在按钮上，不把「有源失效」藏进菜单。
 */
export function SidebarMenu({ active, attentionSources, dateLabel, onNavigate }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const items: Item[] = [
    { id: 'search', label: '搜索', meta: isMac ? '⌘K' : 'Ctrl K', icon: <SearchIcon /> },
    { id: 'timeline', label: '时间线', meta: dateLabel, icon: <ClockIcon /> },
    {
      id: 'sources',
      label: '事实源',
      ...(attentionSources > 0 ? { meta: String(attentionSources), warn: true } : {}),
      icon: <LayersIcon />
    },
    { id: 'settings', label: '设置', icon: <GearIcon /> }
  ]
  const inMenu = items.some((i) => i.id === active)

  useEffect(() => {
    if (!open) return
    const focusables = (): HTMLButtonElement[] => [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    ]

    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const list = focusables()
      const current = list.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'ArrowDown' ? (current + 1) % list.length : (current - 1 + list.length) % list.length
      list[next]?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (id: string): void => {
    setOpen(false)
    onNavigate(id)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={attentionSources > 0 ? `导航，${attentionSources} 个事实源需关注` : '导航'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="sidebar-menu"
        title="导航"
        onClick={() => setOpen((v) => !v)}
        className={[
          'relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
          inMenu
            ? 'border-transparent bg-accent-soft text-accent'
            : 'border-rule bg-white text-ink-2 hover:bg-cream hover:text-ink'
        ].join(' ')}
      >
        <GridIcon />
        {attentionSources > 0 && (
          <span
            aria-label={`${attentionSources} 个事实源需关注`}
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-alert ring-2 ring-white"
          />
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          id="sidebar-menu"
          role="menu"
          aria-label="全局导航"
          className="absolute bottom-full left-0 z-30 mb-2 w-[184px] rounded-xl border border-rule bg-white p-1.5 shadow-lg"
        >
          {items.map((item) => {
            const isActive = item.id === active
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => go(item.id)}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
                  isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-cream hover:text-ink'
                ].join(' ')}
              >
                <span className={['shrink-0', isActive ? 'text-accent' : 'text-ink-3'].join(' ')}>{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.meta && (
                  <span
                    className={[
                      'shrink-0 text-[10px] tabular-nums',
                      item.warn ? 'font-medium text-alert' : isActive ? 'text-accent/70' : 'text-ink-3'
                    ].join(' ')}
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function GridIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} width={16} height={16}>
      <rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1.2" />
      <rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1.2" />
      <rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1.2" />
      <rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1.2" />
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
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

function LayersIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="m8 2.2 5.6 2.9L8 8 2.4 5.1 8 2.2Z" />
      <path d="m2.4 8 5.6 2.9L13.6 8" />
      <path d="m2.4 10.9 5.6 2.9 5.6-2.9" />
    </svg>
  )
}

function GearIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M2.2 4.5h2.9M8.4 4.5h5.4M2.2 8h5.3M11 8h2.8M2.2 11.5h1.3M6.8 11.5h7" />
      <circle cx="7" cy="4.5" r="1.5" />
      <circle cx="9.5" cy="8" r="1.5" />
      <circle cx="5.2" cy="11.5" r="1.5" />
    </svg>
  )
}
