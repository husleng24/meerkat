import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * IPC 边界测试。
 *
 * 这里不测业务逻辑（那些在 app/core 里已经有测试），只测一件事：
 * **renderer 传进来的东西不可信时，handler 必须返回结构化失败，而不是抛异常或写坏数据**。
 *
 * 做法是 mock 掉 electron，把 ipcMain.handle 注册的 handler 抓进一张表里直接调用——
 * 这样测的就是真实的 handler（含 zod 校验、错误文案、store 读写），
 * 而不是另写一份"和 handler 长得一样"的校验函数。
 */
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => {
  class FakeTray {
    setToolTip(): void {}
    setContextMenu(): void {}
    on(): void {}
    destroy(): void {}
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 16, height: 16 }
    }
  }
  class FakeWindow {
    static getAllWindows(): unknown[] {
      return []
    }
  }
  return {
    app: {
      getVersion: () => '0.0.1-test',
      getPath: () => '/tmp/meerkat-ipc-test',
      getAppPath: () => '/tmp/meerkat-ipc-test',
      isPackaged: false,
      on: () => {},
      once: () => {},
      whenReady: () => Promise.resolve(),
      quit: () => {},
      exit: () => {}
    },
    ipcMain: {
      handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn),
      on: () => {}
    },
    BrowserWindow: FakeWindow,
    Tray: FakeTray,
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    Notification: class {
      static isSupported(): boolean {
        return true
      }
      show(): void {}
    },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ isEmpty: () => true }) }),
      createEmpty: () => ({ isEmpty: () => true })
    },
    shell: { openExternal: async () => {}, showItemInFolder: () => {}, openPath: async () => '' },
    net: {
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) })
    },
    clipboard: { writeText: () => {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) },
    safeStorage: { isEncryptionAvailable: () => false }
  }
})

// mock 必须在 import 之前生效，所以这里的 import 是"晚绑定"的
const { initStore, registerIpc, closeStore } = await import('../src/main/ipc')

const dir = mkdtempSync(join(tmpdir(), 'meerkat-ipc-'))

/** 直接调用 handler，第一个参数是 IpcMainInvokeEvent，这里给个最小替身 */
function call(name: string, ...args: unknown[]): any {
  const fn = handlers.get(name)
  if (!fn) throw new Error(`handler 未注册: ${name}`)
  return fn({ sender: { isDestroyed: () => true, send: () => {} } }, ...args)
}

beforeAll(() => {
  initStore(join(dir, 'test.db'))
  registerIpc()
})

afterAll(() => {
  closeStore()
  rmSync(dir, { recursive: true, force: true })
})

describe('IPC：领域与主题的两层结构', () => {
  it('默认领域存在，且主题都挂在它下面', () => {
    const list = call('domains:list') as Array<{ id: string; name: string; topicCount: number }>
    expect(list.map((d) => d.id)).toEqual(['ai'])
    expect(list[0]!.name).toBe('AI')
    expect(list[0]!.topicCount).toBeGreaterThanOrEqual(1)
    const topics = call('topics:list') as Array<{ domainId: string }>
    expect(topics.every((t) => t.domainId === 'ai')).toBe(true)
  })

  it('领域名不能重复', () => {
    expect(call('domains:create', { name: 'AI' })).toEqual({ ok: false, error: '领域名重复' })
  })

  it('建主题时领域必须存在', () => {
    expect(call('topics:create', { id: 'x1', name: 'X', domainId: 'nope' })).toEqual({
      ok: false,
      error: '领域不存在'
    })
  })

  it('sources:recommend 非法入参返回空数组，合法入参返回候选列表', () => {
    expect(call('sources:recommend', 'nope')).toEqual([])
    const list = call('sources:recommend', { topicId: 'ai', limit: 3 }) as unknown[]
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeLessThanOrEqual(3)
  })

  it('update:current 返回版本；没有缓存时 latest 为 null；检查失败给可读原因', async () => {
    expect(call('update:current')).toBe('0.0.1-test')
    expect(call('update:latest')).toBeNull()
    const r = (await call('update:check')) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('找不到 Release')
  })

  it('update:open 只接受本仓库的 Release 链接', async () => {
    expect(await call('update:open', 'https://example.com/evil')).toEqual({
      ok: false,
      error: '不支持的地址'
    })
    expect(await call('update:open', 'not-a-url')).toEqual({ ok: false, error: '参数非法' })
    expect(await call('update:open', 'https://github.com/husleng24/meerkat/releases/tag/v0.2.0')).toEqual({
      ok: true
    })
  })

  it('stats:overview 返回全局计数与 schema 版本', () => {
    const r = call('stats:overview') as Record<string, number>
    for (const key of ['items', 'briefs', 'read', 'saved', 'failingSources', 'totalSources', 'schemaVersion']) {
      expect(typeof r[key], key).toBe('number')
    }
    expect(r.schemaVersion).toBe(6)
  })

  it('领域下还有主题时不能删领域', () => {
    const r = call('domains:remove', 'ai')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('还有主题')
  })
})

describe('IPC 边界：非法入参必须返回结构化失败', () => {
  it('注册了预期的 handler 集合', () => {
    for (const name of ['brief:latest', 'flags:set', 'sources:add', 'schedule:set', 'items:search', 'stats:overview']) {
      expect(handlers.has(name), name).toBe(true)
    }
  })

  it('flags:set 拒绝非对象与空 patch', () => {
    expect(call('flags:set', 'not-an-object')).toEqual({ ok: false, error: '参数非法' })
    expect(call('flags:set', null)).toEqual({ ok: false, error: '参数非法' })
    // patch 里一个字段都没有 → refine 拦下
    expect(call('flags:set', { itemId: 'x', patch: {} })).toEqual({ ok: false, error: '参数非法' })
    // id 空串
    expect(call('flags:set', { itemId: '', patch: { isRead: true } })).toEqual({ ok: false, error: '参数非法' })
  })

  it('flags:set 合法入参但条目不存在时，报"条目不存在"而不是参数非法', () => {
    expect(call('flags:set', { itemId: 'no-such-item', patch: { isRead: true } })).toEqual({
      ok: false,
      error: '条目不存在'
    })
  })

  it('flags:get 非法入参返回空对象（界面不必处理异常）', () => {
    expect(call('flags:get', 'oops')).toEqual({})
    expect(call('flags:get', [''])).toEqual({})
  })

  it('schedule:set 拒绝越界时间与错误类型', () => {
    expect(call('schedule:set', { enabled: true, hour: 25, minute: 0 })).toEqual({
      ok: false,
      error: '参数非法'
    })
    expect(call('schedule:set', { enabled: true, hour: 8, minute: 60 })).toEqual({
      ok: false,
      error: '参数非法'
    })
    expect(call('schedule:set', { enabled: 'yes', hour: 8, minute: 0 })).toEqual({
      ok: false,
      error: '参数非法'
    })
  })

  it('sources:add 拒绝缺字段与超长名字', () => {
    expect(call('sources:add', {})).toEqual({ ok: false, error: '参数非法' })
    expect(
      call('sources:add', { name: 'x'.repeat(81), kind: 'rss', tier: 1, bucketHint: 'product' })
    ).toEqual({ ok: false, error: '参数非法' })
  })

  it('sources:remove 拒绝空 id / 非字符串', () => {
    expect(call('sources:remove', '')).toEqual({ ok: false, error: '参数非法' })
    expect(call('sources:remove', 42)).toEqual({ ok: false, error: '参数非法' })
  })

  it('key:set 拒绝空值与超长值', () => {
    expect(call('key:set', '')).toEqual({ ok: false, error: '参数非法' })
    expect(call('key:set', 'k'.repeat(201))).toEqual({ ok: false, error: '参数非法' })
  })

  it('brief:get 非法日期返回 null（不是抛异常）', () => {
    expect(call('brief:get', 123)).toBeNull()
    expect(call('brief:get', 'x'.repeat(30))).toBeNull()
  })

  it('items:search 非法查询返回空数组', () => {
    expect(call('items:search', { q: 'x' })).toEqual([])
    expect(call('items:search', 1)).toEqual([])
  })

  it('没有简报时 brief:latest 返回 null', () => {
    expect(call('brief:latest')).toBeNull()
  })

  it('sources:list 在空库上返回数组而不是 undefined', () => {
    expect(Array.isArray(call('sources:list'))).toBe(true)
  })

  it('topics:list 至少包含默认主题', () => {
    const list = call('topics:list') as Array<{ id: string; sourceCount: number }>
    expect(list.some((t) => t.id === 'ai')).toBe(true)
    expect(typeof list[0]!.sourceCount).toBe('number')
  })

  it('topics:create 拒绝非法入参', () => {
    expect(call('topics:create', {})).toEqual({ ok: false, error: '参数非法' })
    expect(call('topics:create', { id: '', name: 'x' })).toEqual({ ok: false, error: '参数非法' })
    expect(call('topics:create', { id: 'chip', name: 'x'.repeat(31) })).toEqual({
      ok: false,
      error: '参数非法'
    })
  })

  it('新主题默认只带推荐源，显式 sourceIds 时以传入为准', () => {
    const created = call('topics:create', { id: 'auto-sources', name: '芯片与算力' }) as { ok: boolean }
    expect(created.ok).toBe(true)
    const auto = call('topics:sourceIds', 'auto-sources') as string[]
    expect(auto.length).toBeLessThanOrEqual(8)

    const all = call('sources:list') as Array<{ id: string }>
    const explicit = [all[0]!.id, all[1]!.id]
    expect(call('topics:create', { id: 'explicit-sources', name: '显式主题', sourceIds: explicit }).ok).toBe(true)
    expect(call('topics:sourceIds', 'explicit-sources')).toEqual(explicit)

    // 清掉本用例创建的主题，后面的"不能删最后一个主题"仍然成立
    expect(call('topics:remove', 'auto-sources').ok).toBe(true)
    expect(call('topics:remove', 'explicit-sources').ok).toBe(true)
  })

  it('topics:create 成功后出现在列表里，重复创建被拒', () => {
    expect(call('topics:create', { id: 'chip', name: '芯片与算力' })).toMatchObject({ ok: true, id: 'chip' })
    expect(call('topics:create', { id: 'chip', name: '芯片' })).toEqual({
      ok: false,
      error: '主题已存在'
    })
    const list = call('topics:list') as Array<{ id: string }>
    expect(list.map((t) => t.id)).toContain('chip')
  })

  it('topics:update / remove 校验目标存在', () => {
    expect(call('topics:update', { id: 'nope', name: 'x' })).toEqual({
      ok: false,
      error: '主题不存在'
    })
    expect(call('topics:remove', 'nope')).toEqual({ ok: false, error: '主题不存在' })
  })

  it('topics:remove 拒绝删掉最后一个主题', () => {
    // 现在有 ai 和 chip；先删 chip，再删 ai 必须被拦住
    expect(call('topics:remove', 'chip')).toEqual({ ok: true })
    expect(call('topics:remove', 'ai')).toEqual({ ok: false, error: '至少要保留一个主题' })
  })

  it('topics:setSources 拒绝不存在的主题', () => {
    expect(call('topics:setSources', { topicId: 'nope', sourceIds: [] })).toEqual({
      ok: false,
      error: '主题不存在'
    })
  })

  it('run:cancel 在空闲时返回 cancelled:false', () => {
    expect(call('run:cancel')).toEqual({ ok: true, cancelled: false })
  })

  it('run:compose 校验主题与运行状态', async () => {
    // handler 是 async 的，必须 await 才能拿到结构化结果
    expect(await call('run:compose', { topicId: '' })).toEqual({ ok: false, error: '参数非法' })
    expect(await call('run:compose', 123)).toEqual({ ok: false, error: '参数非法' })
  })

  it('chat:ensure 拒绝非法入参', () => {
    expect(call('chat:ensure', {})).toBeNull()
    expect(call('chat:ensure', { topicId: '' })).toBeNull()
  })

  it('chat:send 拒绝非法入参', async () => {
    expect(await call('chat:send', {})).toEqual({ ok: false, error: '参数非法' })
    expect(await call('chat:send', { threadId: 'x', text: 'hi', actionId: 'nope' })).toEqual({
      ok: false,
      error: '参数非法'
    })
  })

  it('chat:cancel 空闲时返回 cancelled:false', async () => {
    expect(await call('chat:cancel')).toEqual({ cancelled: false })
  })

  it('schedule:set 必须带 topicId', () => {
    expect(call('schedule:set', { enabled: true, hour: 8, minute: 30 })).toEqual({
      ok: false,
      error: '参数非法'
    })
    expect(call('schedule:set', { topicId: 'nope', enabled: true, hour: 8, minute: 30 })).toEqual({
      ok: false,
      error: '主题不存在'
    })
  })
})
