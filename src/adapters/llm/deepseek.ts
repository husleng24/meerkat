/**
 * DeepSeek 适配器（OpenAI 兼容协议）。
 *
 * 实测过的两个坑，直接在这里处理掉：
 *  1. `deepseek-v4-pro` 是推理模型，默认 7000 max_tokens 会被"思考"吃光、正文为空
 *     → 默认给 16000，并把空正文识别成 empty-output 而不是静默成功
 *  2. 正文偶尔被 ``` 包起来 → 统一 strip
 */
import type {
  ComposeInput,
  ComposeResult,
  Composer,
  TokenUsage
} from '../../core/ports/composer'

export interface DeepSeekOptions {
  apiKey: string
  /** 外部注入的 prompt 文本（来自 resources/prompts/compose.zh.md） */
  systemPrompt: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

/** 素材 → 用户提示词。与 Python 版 build_user_prompt 等价 */
export function buildUserPrompt(input: ComposeInput, maxSummary = 240): string {
  const lines: string[] = [`以下是 ${input.items.length} 条候选素材（已按重要度排序）：`, '']
  input.items.forEach((it, i) => {
    const when = it.publishedAt
      ? new Date(it.publishedAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '时间未知'
    const extra = it.alsoIn.length > 0 ? `（另见：${it.alsoIn.join('、')}）` : ''
    lines.push(
      `### 素材 ${i + 1}｜${input.bucketLabels[it.bucket]}｜${it.sourceName}｜${when}｜分数 ${it.score.toFixed(2)}${extra}`
    )
    lines.push(`标题：${it.title}`)
    if (it.summary) lines.push(`摘要：${it.summary.slice(0, maxSummary).replace(/\s+/g, ' ')}`)
    lines.push(`链接：${it.url}`)
    lines.push('')
  })
  return lines.join('\n')
}

function stripFences(md: string): string {
  const t = md.trim()
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(t)
  return m ? m[1]!.trim() : t
}

export function createDeepSeekComposer(opts: DeepSeekOptions): Composer {
  const baseUrl = (opts.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '')
  const model = opts.model ?? 'deepseek-flash'
  const temperature = opts.temperature ?? 0.55
  const maxTokens = opts.maxTokens ?? 16_000

  return {
    model,
    async compose(input: ComposeInput, signal?: AbortSignal): Promise<ComposeResult> {
      if (!opts.apiKey) return { ok: false, reason: 'no-key', detail: '未配置 API Key' }

      const user = buildUserPrompt(input)
      const body = {
        model,
        messages: [
          {
            role: 'system',
            content: opts.systemPrompt
              .replace(/\{date\}/g, input.dateLabel)
              .replace(/\{weekday\}/g, input.weekday)
          },
          { role: 'user', content: user }
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false
      }

      let res: Response
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
          signal: signal ?? AbortSignal.timeout(300_000)
        })
      } catch (e) {
        return { ok: false, reason: 'provider-error', detail: e instanceof Error ? e.message : String(e) }
      }

      if (res.status === 429) return { ok: false, reason: 'rate-limit', detail: 'HTTP 429' }
      if (res.status === 400 || res.status === 413) {
        const txt = await res.text().catch(() => '')
        if (/context|too long|maximum/i.test(txt)) {
          return { ok: false, reason: 'context-overflow', detail: txt.slice(0, 200) }
        }
        return { ok: false, reason: 'provider-error', detail: txt.slice(0, 200) }
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return { ok: false, reason: 'provider-error', detail: `HTTP ${res.status} ${txt.slice(0, 160)}` }
      }

      let data: ChatResponse
      try {
        data = (await res.json()) as ChatResponse
      } catch (e) {
        return { ok: false, reason: 'provider-error', detail: `响应非 JSON：${String(e)}` }
      }

      const choice = data.choices?.[0]
      const content = stripFences(choice?.message?.content ?? '')
      const usage: TokenUsage = {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0
      }

      if (!content) {
        const finish = choice?.finish_reason ?? 'unknown'
        const reasoningLen = (choice?.message?.reasoning_content ?? '').length
        return {
          ok: false,
          reason: finish === 'length' ? 'context-overflow' : 'empty-output',
          detail: `正文为空（finish_reason=${finish}${reasoningLen ? `，reasoning 长度 ${reasoningLen}` : ''}）`
        }
      }

      return {
        ok: true,
        markdown: content,
        usage,
        model,
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {})
      }
    }
  }
}

/** 从环境变量或 ~/.dsh/.credentials.yaml 取 key（与 Python 版一致的两级兜底） */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['DEEPSEEK_API_KEY']?.trim()
  if (fromEnv) return fromEnv
  try {
    // 延迟 require，避免在渲染进程/测试环境里强依赖 fs
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { homedir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const p = join(homedir(), '.dsh', '.credentials.yaml')
    const txt = readFileSync(p, 'utf8')
    const m = /DEEPSEEK_API_KEY\s*:\s*['"]?(sk-[A-Za-z0-9_-]+)/.exec(txt)
    return m ? m[1]! : ''
  } catch {
    return ''
  }
}
