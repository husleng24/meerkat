import { describe, it, expect } from 'vitest'
import { classifyIntent, hasAgentMention, stripMention } from '../src/app/agent-intent'

describe('@agent 意图', () => {
  it('明确说跟踪才落库', () => {
    expect(classifyIntent('@agent 帮我盯着这件事')).toBe('track')
    expect(classifyIntent('@agent 持续关注英伟达')).toBe('track')
  })

  it('停止跟踪优先于跟踪', () => {
    expect(classifyIntent('@agent 别再跟踪了')).toBe('untrack')
    expect(classifyIntent('@agent 取消跟踪')).toBe('untrack')
  })

  it('整理时间线但不持续跟踪', () => {
    expect(classifyIntent('@agent 整理一下时间线')).toBe('timeline')
    expect(classifyIntent('@agent 梳理来龙去脉')).toBe('timeline')
  })

  it('问句走问答，不建 story', () => {
    expect(classifyIntent('@agent 这件事是真的吗？')).toBe('ask')
    expect(classifyIntent('@agent 英伟达回应了吗')).toBe('ask')
  })

  it('mention 识别与剥离', () => {
    expect(hasAgentMention('@agent 你好')).toBe(true)
    expect(hasAgentMention('@Agent 你好')).toBe(true)
    expect(stripMention('@agent 这件事是真的吗？')).toBe('这件事是真的吗？')
    expect(stripMention('@meerkat 整理')).toBe('整理')
  })
})
