import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createOpenAICompatibleChat } from '../src/adapters/llm/openai-compatible'
import { createAnthropicChat } from '../src/adapters/llm/anthropic'
import { modelsOf } from '../src/core/chat/providers'

/**
 * 协议级测试：起一个本地 HTTP 服务器，让适配器真的发请求，断言 header / body / 解析。
 *
 * 为什么值得这么测：多供应商最容易错的地方是**协议差异**（鉴权头、system 字段、
 * 响应结构），而这些错误在本机没有任何提示——只有用户配置了 key、真的发出去才会 404/400。
 */

let server: Server
let baseUrl = ''
let lastRequest: { url: string; headers: IncomingMessage['headers']; body: any } | null = null
let response: { status: number; body: unknown } = { status: 200, body: {} }

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        lastRequest = { url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') }
      } catch {
        lastRequest = { url: req.url ?? '', headers: req.headers, body: raw }
      }
      res.writeHead(response.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(response.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('OpenAI 兼容协议（DeepSeek / OpenAI 共用）', () => {
  const provider = () =>
    createOpenAICompatibleChat({
      id: 'deepseek',
      baseUrl,
      apiKey: 'sk-test-key-0123456789',
      models: modelsOf('deepseek')
    })

  it('发到 /chat/completions，用 Bearer 鉴权', async () => {
    response = {
      status: 200,
      body: { choices: [{ message: { content: ' 你好 ' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }
    }
    const r = await provider().chat({
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '你好' }
      ],
      temperature: 0.2,
      maxTokens: 123
    })
    expect(lastRequest?.url).toBe('/chat/completions')
    expect(lastRequest?.headers.authorization).toBe('Bearer sk-test-key-0123456789')
    expect(lastRequest?.body).toMatchObject({
      model: 'deepseek-flash',
      temperature: 0.2,
      max_tokens: 123,
      stream: false
    })
    expect(lastRequest?.body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' }
    ])
    expect(r).toEqual({
      ok: true,
      text: '你好',
      model: 'deepseek-flash',
      usage: { input: 12, output: 3 }
    })
  })

  it('429 归类为限流，400+context 归类为超窗', async () => {
    response = { status: 429, body: {} }
    expect(await provider().chat({ model: 'deepseek-flash', messages: [] })).toEqual({
      ok: false,
      reason: 'rate-limit',
      detail: '模型限流（HTTP 429）'
    })

    response = { status: 400, body: { error: { message: 'maximum context length exceeded' } } }
    const r = await provider().chat({ model: 'deepseek-flash', messages: [] })
    expect(r.ok === false && r.reason).toBe('context-overflow')
  })

  it('空正文不当成功', async () => {
    response = { status: 200, body: { choices: [{ message: { content: '   ' } }] } }
    const r = await provider().chat({ model: 'deepseek-flash', messages: [] })
    expect(r).toEqual({ ok: false, reason: 'empty-output', detail: '模型没有返回正文' })
  })
})

describe('Anthropic Messages 协议', () => {
  const provider = () =>
    createAnthropicChat({ apiKey: 'sk-ant-test-0123456789', baseUrl, models: modelsOf('anthropic') })

  it('发到 /v1/messages，用 x-api-key + anthropic-version，system 提到顶层', async () => {
    response = {
      status: 200,
      body: {
        content: [
          { type: 'text', text: '第一段。' },
          { type: 'text', text: '第二段。' }
        ],
        usage: { input_tokens: 20, output_tokens: 8 }
      }
    }
    const r = await provider().chat({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: '规则一' },
        { role: 'system', content: '规则二' },
        { role: 'user', content: '问题' }
      ],
      maxTokens: 900
    })

    expect(lastRequest?.url).toBe('/v1/messages')
    expect(lastRequest?.headers['x-api-key']).toBe('sk-ant-test-0123456789')
    expect(lastRequest?.headers['anthropic-version']).toBe('2023-06-01')
    // 不能带 Bearer
    expect(lastRequest?.headers.authorization).toBeUndefined()

    expect(lastRequest?.body.system).toBe('规则一\n\n规则二')
    expect(lastRequest?.body.messages).toEqual([{ role: 'user', content: '问题' }])
    expect(lastRequest?.body.max_tokens).toBe(900)

    expect(r).toEqual({
      ok: true,
      text: '第一段。第二段。',
      model: 'claude-sonnet-4-5',
      usage: { input: 20, output: 8 }
    })
  })

  it('相邻同角色消息会合并（Anthropic 要求交替）', async () => {
    response = { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }
    await provider().chat({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: 'A' },
        { role: 'user', content: 'B' },
        { role: 'assistant', content: 'C' },
        { role: 'user', content: 'D' }
      ]
    })
    expect(lastRequest?.body.messages).toEqual([
      { role: 'user', content: 'A\n\nB' },
      { role: 'assistant', content: 'C' },
      { role: 'user', content: 'D' }
    ])
  })

  it('max_tokens 缺省时会补上（Anthropic 必填）', async () => {
    response = { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }
    await provider().chat({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] })
    expect(lastRequest?.body.max_tokens).toBe(4000)
  })

  it('错误响应里带 message 时把它作为 detail', async () => {
    response = { status: 401, body: { error: { message: 'invalid x-api-key' } } }
    expect(await provider().chat({ model: 'claude-sonnet-4-5', messages: [] })).toEqual({
      ok: false,
      reason: 'provider-error',
      detail: 'invalid x-api-key'
    })
  })
})
