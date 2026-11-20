import { describe, expect, it } from 'vitest'
import { buildSemanticPrompt, parseSemanticBindings, type SemanticClaim } from '../src/app/claim-semantic'

const claims: SemanticClaim[] = [
  {
    id: 'c1',
    text: 'TechCrunch reports OpenAI shipped a model.',
    candidates: [
      { name: 'TechCrunch', url: 'https://tc.example/a' },
      { name: 'The Verge', url: 'https://verge.example/b' }
    ]
  }
]

describe('语义 claim-source 匹配', () => {
  it('提示词只允许候选来源', () => {
    const p = buildSemanticPrompt(claims)
    expect(p.system).toContain('只能从该条断言给出的候选 URL 中选择')
    expect(p.user).toContain('https://tc.example/a')
    expect(p.user).toContain('The Verge')
  })

  it('解析时丢弃不在候选里的 URL 和未知 claim', () => {
    const raw = JSON.stringify({
      bindings: [
        { id: 'c1', sources: ['https://tc.example/a', 'https://evil.example/x'], confidence: 0.8, reason: '直接报道' },
        { id: 'unknown', sources: ['https://tc.example/a'], confidence: 1 }
      ]
    })
    const bindings = parseSemanticBindings(raw, claims)
    expect(bindings).toEqual([
      { id: 'c1', sources: ['https://tc.example/a'], confidence: 0.8, reason: '直接报道' }
    ])
  })

  it('容忍 markdown code fence，坏 JSON 返回空数组', () => {
    expect(parseSemanticBindings('```json\n{"bindings":[]}\n```', claims)).toEqual([])
    expect(parseSemanticBindings('not json', claims)).toEqual([])
  })
})
