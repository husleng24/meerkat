import { contextBridge, ipcRenderer } from 'electron'
import type { BriefPayload } from '../renderer/src/lib/ipc-types'

/**
 * 暴露给渲染进程的窄接口。
 * 规则：只暴露方法，不暴露 ipcRenderer / require / fs；
 * 入参在主进程侧用 zod 校验（见 src/main/ipc.ts）。
 */
const api = {
  ping: (): Promise<{ ok: boolean; version: string; ts: number }> => ipcRenderer.invoke('app:ping'),

  briefLatest: (topicId?: string): Promise<BriefPayload | null> => ipcRenderer.invoke('brief:latest', topicId),

  briefList: (
    topicId?: string
  ): Promise<Array<{ date: string; model: string; linkCheck: string; chars: number; createdAt: number }>> =>
    ipcRenderer.invoke('brief:list', topicId),

  briefByDate: (date: string, topicId?: string): Promise<BriefPayload | null> =>
    ipcRenderer.invoke('brief:get', topicId ? { date, topicId } : date),

  flags: {
    get: (ids: string[]): Promise<Record<string, { isRead: boolean; isSaved: boolean; isHidden: boolean }>> =>
      ipcRenderer.invoke('flags:get', ids),
    set: (
      itemId: string,
      patch: { isRead?: boolean; isSaved?: boolean; isHidden?: boolean }
    ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('flags:set', { itemId, patch })
  },

  sources: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('sources:list'),
    toggle: (id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sources:toggle', { id, enabled }),
    test: (id: string): Promise<{ ok: boolean; n?: number; ms?: number; error?: string }> =>
      ipcRenderer.invoke('sources:test', id),
    testAll: (): Promise<{ ok: boolean; summary: string }> => ipcRenderer.invoke('sources:testAll'),
    add: (input: {
      name: string
      url?: string
      kind: string
      tier: number
      bucketHint: string
    }): Promise<{ ok: boolean; id?: string; error?: string }> => ipcRenderer.invoke('sources:add', input),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sources:remove', id),
    update: (input: {
      id: string
      name: string
      url?: string
      tier: number
      bucketHint: string
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sources:update', input),
    /** 订阅全量自检进度；返回取消订阅函数 */
    onProgress: (
      cb: (p: { id: string; ok: boolean; n: number; ms: number; error?: string; done: number; total: number }) => void
    ): (() => void) => {
      const handler = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
      ipcRenderer.on('sources:progress', handler)
      return () => ipcRenderer.removeListener('sources:progress', handler)
    }
  },

  items: {
    search: (
      input: { q: string; bucket?: string; sourceId?: string; days?: number; sort?: 'score' | 'time' }
    ): Promise<
      Array<{
        id: string
        title: string
        url: string
        bucket: string
        summary: string
        score: number
        publishedAt?: number
        sourceName: string
      }>
    > => ipcRenderer.invoke('items:search', input)
  },

  schedule: {
    get: (topicId: string): Promise<{ enabled: boolean; hour: number; minute: number; lastRunAt: number | null }> =>
      ipcRenderer.invoke('schedule:get', topicId),
    set: (cfg: {
      topicId: string
      enabled: boolean
      hour: number
      minute: number
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('schedule:set', cfg)
  },

  chat: {
    models: (): Promise<Array<{ id: string; label: string; provider: string; contextWindow: number; tier: 'fast' | 'deep' }>> =>
      ipcRenderer.invoke('chat:models'),
    ensure: (input: {
      topicId: string
      briefDate?: string
      model?: string
    }): Promise<{
      id: string
      title: string
      topicId: string
      briefDate?: string
      model: string
      createdAt: number
      updatedAt: number
      archived: boolean
      contextTokens: number
      briefStale: boolean
    } | null> => ipcRenderer.invoke('chat:ensure', input),
    messages: (
      threadId: string
    ): Promise<
      Array<{
        id: string
        threadId: string
        role: 'user' | 'assistant'
        content: string
        model?: string
        tokensIn?: number
        tokensOut?: number
        contextJson?: string
        createdAt: number
      }>
    > => ipcRenderer.invoke('chat:messages', threadId),
    send: (input: {
      threadId: string
      text: string
      actionId?: 'ask' | 'summarize5' | 'compare' | 'why' | 'reorder'
      model?: string
      includePrevious?: boolean
    }): Promise<{
      ok: boolean
      user?: { id: string; role: 'user'; content: string; createdAt: number }
      assistant?: { id: string; role: 'assistant'; content: string; model?: string; createdAt: number }
      error?: string
      estimatedTokens?: number
      model?: string
    }> => ipcRenderer.invoke('chat:send', input),
    cancel: (): Promise<{ cancelled: boolean }> => ipcRenderer.invoke('chat:cancel'),
    reset: (threadId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chat:reset', threadId),
    providers: (): Promise<
      Array<{
        id: string
        label: string
        protocol: string
        defaultModel: string
        override: string
        hasKey: boolean
      }>
    > => ipcRenderer.invoke('chat:providers'),
    setModel: (input: { provider: string; model: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chat:setModel', input)
  },

  topics: {
    list: (): Promise<
      Array<{
        id: string
        name: string
        domainId: string
        enabled: boolean
        hour: number
        minute: number
        sourceCount: number
        hasBrief: boolean
        todayCount: number
        unreadCount: number
      }>
    > => ipcRenderer.invoke('topics:list'),
    create: (input: { id: string; name: string; domainId?: string; sourceIds?: string[] }): Promise<{ ok: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('topics:create', input),
    update: (input: { id: string; name?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('topics:update', input),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('topics:remove', id),
    sourceIds: (id: string): Promise<string[]> => ipcRenderer.invoke('topics:sourceIds', id),
    setSources: (input: { topicId: string; sourceIds: string[] }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('topics:setSources', input)
  },

  domains: {
    list: (): Promise<Array<{ id: string; name: string; createdAt: number; topicCount: number }>> =>
      ipcRenderer.invoke('domains:list'),
    create: (input: { id?: string; name: string }): Promise<{ ok: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('domains:create', input),
    rename: (input: { id: string; name: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('domains:rename', input),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('domains:remove', id)
  },

  prefs: {
    get: (): Promise<{ autoLaunch: { enabled: boolean; supported: boolean; reason?: string } }> =>
      ipcRenderer.invoke('prefs:get'),
    setAutoLaunch: (
      enabled: boolean
    ): Promise<{
      ok: boolean
      error?: string
      autoLaunch?: { enabled: boolean; supported: boolean; reason?: string }
    }> => ipcRenderer.invoke('prefs:setAutoLaunch', enabled)
  },

  runNow: (
    topicId?: string
  ): Promise<{ ok: boolean; nKept?: number; nOk?: number; nSources?: number; degraded?: boolean; error?: string }> =>
    ipcRenderer.invoke('run:now', topicId),

  /** 不重新抓取，用库里已有的素材重新成稿 */
  composeNow: (
    topicId?: string
  ): Promise<{ ok: boolean; nKept?: number; nOk?: number; nSources?: number; degraded?: boolean; error?: string }> =>
    ipcRenderer.invoke('run:compose', topicId),

  cancelRun: (): Promise<{ ok: boolean; cancelled: boolean }> => ipcRenderer.invoke('run:cancel'),

  exportHtml: (input: { html: string; date: string }): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:html', input),

  exportPdf: (input: { html: string; date: string }): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:pdf', input),

  copyRich: (input: { html: string; text: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('export:richtext', input),

  exportBrief: (): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('brief:export'),

  exportDiagnostic: (): Promise<{ ok: boolean; path?: string; summary?: string; error?: string }> =>
    ipcRenderer.invoke('diag:export'),

  feedback: {
    compose: (input: {
      category: 'bug' | 'idea' | 'source' | 'other'
      message: string
      includeDiagnostics: boolean
    }): Promise<{ ok: boolean; title?: string; body?: string; issueUrl?: string; error?: string }> =>
      ipcRenderer.invoke('feedback:compose', input),
    save: (text: { title: string; body: string }): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('feedback:save', text),
    copy: (text: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('feedback:copy', text)
  },

  key: {
    all: (): Promise<
      Array<{
        provider: string
        providerLabel: string
        hasKey: boolean
        source: string
        sourceLabel: string
        masked: string
        canEncrypt: boolean
        dshAvailable: boolean
      }>
    > => ipcRenderer.invoke('key:all'),
    status: (provider: string): Promise<{
      provider: string
      providerLabel: string
      hasKey: boolean
      source: string
      sourceLabel: string
      masked: string
      canEncrypt: boolean
      dshAvailable: boolean
    }> => ipcRenderer.invoke('key:status', provider),
    set: (input: { provider: string; value: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('key:set', input),
    clear: (provider: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('key:clear', provider),
    importDsh: (): Promise<{ ok: boolean; masked?: string; error?: string }> => ipcRenderer.invoke('key:importDsh')
  },

  domainBrief: {
    latest: (input: { domainId: string; date?: string }): Promise<unknown> =>
      ipcRenderer.invoke('domainBrief:latest', input),
    compose: (input: { domainId: string }): Promise<{
      ok: boolean
      date?: string
      degraded?: boolean
      topicCount?: number
      itemCount?: number
      error?: string
      note?: string
    }> => ipcRenderer.invoke('domainBrief:compose', input)
  },

  onDomainBriefUpdated: (cb: (domainId: string) => void): (() => void) => {
    const handler = (_e: unknown, domainId: string): void => cb(domainId)
    ipcRenderer.on('domain-brief:updated', handler)
    return () => ipcRenderer.removeListener('domain-brief:updated', handler)
  },

  /** 定时任务完成后主进程会推这个事件，界面据此刷新 */
  onBriefUpdated: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('brief:updated', handler)
    return () => ipcRenderer.removeListener('brief:updated', handler)
  }
}

export type MeerkatApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('meerkat', api)
} else {
  ;(globalThis as unknown as { meerkat: MeerkatApi }).meerkat = api
}
