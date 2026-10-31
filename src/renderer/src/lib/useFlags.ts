import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBrief } from './parseBrief'
import { resolveItemIds } from './itemIds'

export interface ItemFlagState {
  isRead: boolean
  isSaved: boolean
  isHidden: boolean
}

const EMPTY: ItemFlagState = { isRead: false, isSaved: false, isHidden: false }

export interface FlagsApi {
  /** 解析条目的 key → 数据库条目 id（映射失败时为 undefined） */
  idOf: (key: string) => string | undefined
  /** 拿某个解析条目的状态（无 id 时返回空状态） */
  of: (itemId: string | undefined) => ItemFlagState
  toggle: (itemId: string | undefined, field: keyof ItemFlagState) => void
  markRead: (itemId: string | undefined) => void
  counts: { read: number; saved: number; hidden: number }
}

/**
 * 已读/收藏/隐藏的持久化。
 *
 * 关键点：解析出来的条目只有 URL，没有数据库 id。所以先用简报里的
 * url → id 映射反查，查不到就退化成"仅本次会话有效"——不能因为映射失败就崩。
 * 这条降级在模型把两条素材合并成一条（多链接）时尤其重要。
 */
export function useFlags(brief: ParsedBrief | null, urlToId: Record<string, string>): FlagsApi {
  const [state, setState] = useState<Record<string, ItemFlagState>>({})
  const pending = useRef<Set<string>>(new Set())

  // 解析条目 → 数据库 id（用第一个能对上源的链接）
  const idByKey = useMemo(() => resolveItemIds(brief, urlToId), [brief, urlToId])

  // 初次加载已有状态
  useEffect(() => {
    const ids = [...idByKey.values()]
    const api = window.meerkat?.flags
    if (!api || ids.length === 0) return
    let cancelled = false
    void api
      .get(ids)
      .then((res) => {
        if (!cancelled) setState((prev) => ({ ...res, ...prev }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [idByKey])

  const of = useCallback(
    (itemId: string | undefined): ItemFlagState => (itemId ? (state[itemId] ?? EMPTY) : EMPTY),
    [state]
  )

  const write = useCallback((itemId: string, next: ItemFlagState) => {
    setState((prev) => ({ ...prev, [itemId]: next }))
    const api = window.meerkat?.flags
    if (!api) return
    // 同一 id 的并发写入串起来，避免来回切换时后到的旧值覆盖新值
    if (pending.current.has(itemId)) return
    pending.current.add(itemId)
    void api
      .set(itemId, next)
      .catch(() => undefined)
      .finally(() => pending.current.delete(itemId))
  }, [])

  const toggle = useCallback(
    (itemId: string | undefined, field: keyof ItemFlagState) => {
      if (!itemId) return
      const cur = state[itemId] ?? EMPTY
      write(itemId, { ...cur, [field]: !cur[field] })
    },
    [state, write]
  )

  const markRead = useCallback(
    (itemId: string | undefined) => {
      if (!itemId) return
      const cur = state[itemId] ?? EMPTY
      if (cur.isRead) return
      write(itemId, { ...cur, isRead: true })
    },
    [state, write]
  )

  const counts = useMemo(() => {
    let read = 0
    let saved = 0
    let hidden = 0
    for (const itemId of idByKey.values()) {
      const f = state[itemId] ?? EMPTY
      if (f.isRead) read += 1
      if (f.isSaved) saved += 1
      if (f.isHidden) hidden += 1
    }
    return { read, saved, hidden }
  }, [idByKey, state])

  return { idOf: (key: string) => idByKey.get(key), of, toggle, markRead, counts }
}
