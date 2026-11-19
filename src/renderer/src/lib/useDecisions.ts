import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DecisionNotePayload } from './ipc-types'

export interface DecisionsApi {
  of: (itemId: string | undefined) => DecisionNotePayload | undefined
  save: (itemId: string, note: string) => Promise<{ ok: boolean; error?: string }>
  remove: (itemId: string) => Promise<void>
  count: number
}

/**
 * 已读/收藏之外的个人判断。
 *
 * 批量取：一屏 20 条，逐条 IPC 会把主进程打满；只对当前简报里能映射到
 * 条目 id 的内容取判断，映射失败就当作没写过——和 flags 的降级一致。
 */
export function useDecisions(itemIds: string[]): DecisionsApi {
  const key = useMemo(() => [...new Set(itemIds)].sort().join('|'), [itemIds])
  const ids = useMemo(() => (key ? key.split('|') : []), [key])
  const [byItem, setByItem] = useState<Record<string, DecisionNotePayload>>({})

  useEffect(() => {
    const api = window.meerkat?.decisions
    if (!api || ids.length === 0) {
      setByItem({})
      return
    }
    let cancelled = false
    void api
      .list(ids)
      .then((rows) => {
        if (cancelled) return
        const next: Record<string, DecisionNotePayload> = {}
        for (const row of rows) next[row.itemId] = row
        setByItem(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ids])

  const save = useCallback(
    async (itemId: string, note: string): Promise<{ ok: boolean; error?: string }> => {
      const api = window.meerkat?.decisions
      if (!api) return { ok: false, error: '预览模式下不可用' }
      const r = await api.save({ itemId, note })
      if (r.ok && r.decision) setByItem((prev) => ({ ...prev, [itemId]: r.decision! }))
      return r
    },
    []
  )

  const remove = useCallback(async (itemId: string): Promise<void> => {
    const api = window.meerkat?.decisions
    if (!api) return
    await api.remove(itemId)
    setByItem((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }, [])

  return {
    of: (itemId) => (itemId ? byItem[itemId] : undefined),
    save,
    remove,
    count: Object.keys(byItem).length
  }
}
