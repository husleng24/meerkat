import { afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { exportBrief } from '../src/main/export'
import type { Store } from '../src/core/ports/store'

// 主进程导出只依赖 electron 的路径与「在文件管理器里定位」；测试里换成临时目录
vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return {
    app: { getPath: () => join(tmpdir(), `meerkat-export-test-${process.pid}`) },
    shell: { showItemInFolder: () => undefined },
    clipboard: { write: () => undefined },
    BrowserWindow: class {
      destroy(): void {}
    }
  }
})

const DOCS = join(tmpdir(), `meerkat-export-test-${process.pid}`)

afterAll(() => {
  rmSync(DOCS, { recursive: true, force: true })
})

const DATE = '2026-11-12'

function seed(): Store {
  const store = createMemoryStore()
  store.domains.upsert({ id: 'tech', name: '科技', createdAt: 1 })
  for (const [id, name] of [
    ['chip', '芯片与算力'],
    ['policy', '政策与安全']
  ] as const) {
    store.topics.upsert({
      id,
      name,
      domainId: 'tech',
      enabled: true,
      hour: 8,
      minute: 30,
      createdAt: 1,
      updatedAt: 1
    })
    store.briefs.save({
      id: `${DATE}-${id}`,
      date: DATE,
      topicId: id,
      markdown: `# ${name} 简报 · ${DATE}（周四）\n\n正文：${name}`,
      model: 'fake',
      tokensIn: 0,
      tokensOut: 0,
      createdAt: 1
    })
  }
  return store
}

describe('导出：文件名由「主题 + 日期」决定', () => {
  it('两个主题同一天导出到不同文件，内容各自对应', async () => {
    const store = seed()
    try {
      const chip = await exportBrief(store, { format: 'md', topicId: 'chip', date: DATE })
      const policy = await exportBrief(store, { format: 'md', topicId: 'policy', date: DATE })

      expect(chip).not.toBe(policy)
      expect(chip.endsWith('芯片与算力-简报-2026-11-12.md')).toBe(true)
      expect(policy.endsWith('政策与安全-简报-2026-11-12.md')).toBe(true)
      expect(readFileSync(chip, 'utf8')).toContain('芯片与算力')
      expect(readFileSync(policy, 'utf8')).toContain('政策与安全')
    } finally {
      store.close()
    }
  })

  it('html 导出也带主题，不会覆盖 md', async () => {
    const store = seed()
    try {
      const md = await exportBrief(store, { format: 'md', topicId: 'chip', date: DATE })
      const html = await exportBrief(store, { format: 'html', topicId: 'chip', date: DATE, html: '<h1>x</h1>' })
      expect(html).not.toBe(md)
      expect(html.endsWith('芯片与算力-简报-2026-11-12.html')).toBe(true)
    } finally {
      store.close()
    }
  })

  it('主题不存在 / 当天没有简报时明确失败，不写文件', async () => {
    const store = createMemoryStore()
    try {
      await expect(exportBrief(store, { format: 'md', topicId: 'nope', date: DATE })).rejects.toThrow('主题不存在')
      await expect(exportBrief(store, { format: 'md', topicId: 'ai', date: DATE })).rejects.toThrow('这一期简报不存在')
    } finally {
      store.close()
    }
  })
})
