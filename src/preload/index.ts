import { contextBridge, ipcRenderer } from 'electron'

/**
 * 暴露给渲染进程的窄接口。
 * 规则：只暴露方法，不暴露 ipcRenderer / require / fs；
 * 入参在主进程侧用 zod 校验（见 src/main/ipc.ts）。
 */
const api = {
  ping: (): Promise<{ ok: boolean; version: string; ts: number }> => ipcRenderer.invoke('app:ping'),

  briefLatest: (): Promise<{
    date: string
    markdown: string
    model: string
    linkCheck?: string
    urlToId?: Record<string, string>
  } | null> => ipcRenderer.invoke('brief:latest'),

  briefList: (): Promise<Array<{ date: string; model: string; linkCheck: string; chars: number; createdAt: number }>> =>
    ipcRenderer.invoke('brief:list'),

  briefByDate: (
    date: string
  ): Promise<{ date: string; markdown: string; model: string; linkCheck?: string; urlToId?: Record<string, string> } | null> =>
    ipcRenderer.invoke('brief:get', date),

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
      q: string
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
    > => ipcRenderer.invoke('items:search', q)
  },

  schedule: {
    get: (): Promise<{ enabled: boolean; hour: number; minute: number; lastRunAt: number | null }> =>
      ipcRenderer.invoke('schedule:get'),
    set: (cfg: { enabled: boolean; hour: number; minute: number }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('schedule:set', cfg)
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

  runNow: (): Promise<{ ok: boolean; nKept: number; nOk: number; nSources: number; degraded: boolean }> =>
    ipcRenderer.invoke('run:now'),

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
    status: (): Promise<{
      hasKey: boolean
      source: string
      sourceLabel: string
      masked: string
      canEncrypt: boolean
      dshAvailable: boolean
    }> => ipcRenderer.invoke('key:status'),
    set: (value: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('key:set', value),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('key:clear'),
    importDsh: (): Promise<{ ok: boolean; masked?: string; error?: string }> => ipcRenderer.invoke('key:importDsh')
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
