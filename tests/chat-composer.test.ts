import { describe, it, expect, vi } from 'vitest'
import { createChatComposer, createNoopComposer } from '../src/adapters/llm/chat-composer'
import type { ChatProvider, ChatRequest, ChatResult } from '../src/core/ports/chat'
import type { ComposeInput } from '../src/core/ports/composer'
import { BUCKET_LABEL } from '../src/core/domain/types'

function stubProvider(result: ChatResult, spy?: (req: ChatRequest) => void): ChatProvider {
  return {
    id: 'stub',
    listModels: () => [],
    async chat(req) {
      spy?.(req)
      return result
    }
  }
}

const input: ComposeInput = {
  dateLabel: '2026-11-01',
  weekday: '周日',
  topicName: 'AI 综合',
  windowHours: 48,
  bucketLabels: BUCKET_LABEL,
  items: [
    {
      title: 'Gemini 4 Carbon 发布',
      url: 'https://example.com/a',
      sourceName: 'Google DeepMind',
      bucket: 'product',
      summary: '摘要',
      score: 9.2,
      alsoIn: []
    }
  ]
}

const systemPrompt = '你是主编。主题 {topic}，日期 {date}，星期 {weekday}。'

describe('用对话供应商成稿', () => {
  it('把素材拼成用户提示词，并替换系统模板里的主题/日期占位', async () => {
    let seen: ChatRequest | null = null
    const composer = createChatComposer({
      provider: stubProvider({ ok: true, text: '# 简报', model: 'm', usage: { input: 1, output: 2 } }, (r) => (seen = r)),
      model: 'm',
      systemPrompt
    })
    const out = await composer.compose(input)
    expect(out.ok).toBe(true)
    expect(seen!.messages[0]).toEqual({
      role: 'system',
      content: '你是主编。主题 AI 综合，日期 2026-11-01，星期 周日。'
    })
    expect(seen!.messages[1]!.content).toContain('Gemini 4 Carbon 发布')
    expect(seen!.messages[1]!.content).toContain('https://example.com/a')
  })

  it('模型把整篇包在 ```markdown 里时剥掉围栏', async () => {
    const composer = createChatComposer({
      provider: stubProvider({ ok: true, text: '```markdown\n# 简报\n```', model: 'm', usage: { input: 0, output: 0 } }),
      model: 'm',
      systemPrompt
    })
    const out = await composer.compose(input)
    expect(out.ok && out.markdown).toBe('# 简报')
  })

  it('供应商报错原样映射成成稿的失败原因', async () => {
    const composer = createChatComposer({
      provider: stubProvider({ ok: false, reason: 'rate-limit', detail: 'HTTP 429' }),
      model: 'm',
      systemPrompt
    })
    expect(await composer.compose(input)).toEqual({ ok: false, reason: 'rate-limit', detail: 'HTTP 429' })
  })

  it('被 max_tokens 截断时算上下文超限，而不是"模型没话说"', async () => {
    const composer = createChatComposer({
      provider: stubProvider({ ok: false, reason: 'empty-output', detail: '空', finishReason: 'length' }),
      model: 'm',
      systemPrompt
    })
    const out = await composer.compose(input)
    expect(out.ok === false && out.reason).toBe('context-overflow')
  })

  it('没有任何供应商时用空组合器，让 composeBrief 走降级而不是抛异常', async () => {
    const out = await createNoopComposer().compose(input)
    expect(out).toEqual({ ok: false, reason: 'no-key', detail: '未配置任何模型 API Key' })
  })

  it('取消会传下去（signal 到达供应商）', async () => {
    const spy = vi.fn()
    const controller = new AbortController()
    const provider: ChatProvider = {
      id: 'stub',
      listModels: () => [],
      async chat(_req, signal) {
        spy(signal)
        return { ok: false, reason: 'aborted', detail: '已取消' }
      }
    }
    const composer = createChatComposer({ provider, model: 'm', systemPrompt })
    await composer.compose(input, controller.signal)
    expect(spy).toHaveBeenCalledWith(controller.signal)
  })
})
