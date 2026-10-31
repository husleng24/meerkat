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

describe('IPC 边界：非法入参必须返回结构化失败', () => {
  it('注册了预期的 handler 集合', () => {
    for (const name of ['brief:latest', 'flags:set', 'sources:add', 'schedule:set', 'items:search']) {
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

  it('topics:create 成功后出现在列表里，重复创建被拒', () => {
    expect(call('topics:create', { id: 'chip', name: '芯片与算力' })).toEqual({ ok: true, id: 'chip' })
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
