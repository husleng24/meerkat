import { describe, it, expect } from 'vitest'
import {
  CATEGORY_LABEL,
  MAX_MESSAGE,
  buildFeedback,
  issueUrl,
  type FeedbackInput
} from '../src/app/feedback'
import { redact } from '../src/app/diagnostic'

const NOW = Date.parse('2026-10-31T08:00:00Z')

function input(over: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    category: 'bug',
    message: '点「立即采集」后停在运行中，5 分钟没反应',
    appVersion: '0.0.1',
    platform: 'win32 x64',
    diagnostics: '版本 0.0.1\n源 35 个：正常 34，失效 1',
    now: NOW,
    ...over
  }
}

describe('buildFeedback：正常路径', () => {
  const r = buildFeedback(input())

  it('生成成功', () => {
    expect(r.ok).toBe(true)
  })

  it('标题带分类标签', () => {
    if (!r.ok) return
    expect(r.text.title.startsWith('[Bug]')).toBe(true)
    expect(r.text.title).toContain('立即采集')
  })

  it('正文包含描述、环境、诊断三段', () => {
    if (!r.ok) return
    expect(r.text.body).toContain('点「立即采集」后停在运行中')
    expect(r.text.body).toContain('### 环境')
    expect(r.text.body).toContain('- 版本：0.0.1')
    expect(r.text.body).toContain('- 平台：win32 x64')
    expect(r.text.body).toContain('### 诊断信息')
    expect(r.text.body).toContain('正常 34，失效 1')
  })

  it('标题被压成一行并截断', () => {
    const long = 'a'.repeat(200)
    const lr = buildFeedback(input({ message: long }))
    if (!lr.ok) return
    expect(lr.text.title.length).toBeLessThanOrEqual(70)
  })

  it('四个分类都有标签', () => {
    for (const c of ['bug', 'idea', 'source', 'other'] as const) {
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0)
    }
  })
})

describe('buildFeedback：边界', () => {
  it('空描述被拒', () => {
    const r = buildFeedback(input({ message: '   ' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('描述')
  })

  it('超长描述被拒', () => {
    const r = buildFeedback(input({ message: 'x'.repeat(MAX_MESSAGE + 1) }))
    expect(r.ok).toBe(false)
  })

  it('恰好到上限仍然接受', () => {
    expect(buildFeedback(input({ message: 'x'.repeat(MAX_MESSAGE) })).ok).toBe(true)
  })

  it('不附带诊断时明确写"未附带"', () => {
    const r = buildFeedback(input({ diagnostics: undefined }))
    if (!r.ok) return
    expect(r.body ?? r.text.body).toContain('未附带诊断信息')
    expect(r.text.body).not.toContain('### 诊断信息')
  })
})

describe('安全检查：反馈材料里不能有密钥', () => {
  it('描述里粘了密钥也会被打码', () => {
    // buildFeedback 本身不做脱敏（诊断部分由调用方先脱敏），
    // 但这里验证：用户自己粘贴的密钥，走一遍 redact 后必须消失
    const r = buildFeedback(input({ message: '日志里出现 sk-abcdef1234567890xyz，正常吗' }))
    if (!r.ok) return
    const safe = redact(r.text.body)
    expect(safe).not.toContain('sk-abcdef1234567890xyz')
  })

  it('诊断摘要本身就是脱敏过的（依赖 diagnostic 模块）', () => {
    const r = buildFeedback(input({ diagnostics: redact('api_key=abcd1234efgh') }))
    if (!r.ok) return
    expect(r.text.body).not.toContain('abcd1234efgh')
  })
})

describe('issueUrl', () => {
  it('仓库未配置时返回 undefined', () => {
    const r = buildFeedback(input())
    if (!r.ok) return
    expect(issueUrl('', r.text)).toBeUndefined()
  })

  it('配置了仓库时生成预填链接', () => {
    const r = buildFeedback(input())
    if (!r.ok) return
    const url = issueUrl('meerkat/app', r.text)!
    expect(url.startsWith('https://github.com/meerkat/app/issues/new?')).toBe(true)
    expect(url).toContain('title=')
    expect(url).toContain('body=')
  })
})
