/**
 * 模型辅助的 claim → source 语义匹配。
 *
 * 这不是「抓原文逐句对齐」，而是在候选来源集合内做语义归因：
 * - 输入是句子 + 候选来源（名称/URL）；
 * - 模型只能从候选 URL 里选，不能编新 URL；
 * - 结果标记 method=model，界面上明确显示「模型语义判断」。
 */
import type { ChatProvider } from '../core/ports/chat'

export interface SemanticClaim {
  id: string
  text: string
  candidates: Array<{ name: string; url: string }>
}

export interface SemanticBinding {
  id: string
  /** 只允许 candidates 里的 URL */
  sources: string[]
  confidence: number
  reason?: string
}

export function buildSemanticPrompt(claims: SemanticClaim[]): { system: string; user: string } {
  const system = [
    '你是引用归因器。你的任务：为每条断言选择语义上支持它的候选来源。',
    '只能从该条断言给出的候选 URL 中选择；不确定就返回空数组。禁止编造 URL。',
    '这是语义相关性判断，不是核实原文真假。',
    '只输出 JSON，不要 markdown 代码块：',
    '{"bindings":[{"id":"claim-id","sources":["https://..."],"confidence":0.0,"reason":"简短理由"}]}',
    'confidence 取 0–1。'
  ].join('\n')
  const user = JSON.stringify(
    claims.map((c) => ({
      id: c.id,
      claim: c.text,
      candidates: c.candidates.map((x) => ({ name: x.name, url: x.url }))
    }))
  )
  return { system, user }
}

function stripFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export function parseSemanticBindings(raw: string, claims: SemanticClaim[]): SemanticBinding[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return []
  }
  const byId = new Map(claims.map((c) => [c.id, new Set(c.candidates.map((x) => x.url))]))
  const rows = (parsed as { bindings?: unknown })?.bindings
  if (!Array.isArray(rows)) return []
  const out: SemanticBinding[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = (row as { id?: unknown }).id
    if (typeof id !== 'string' || !byId.has(id)) continue
    const allowed = byId.get(id)!
    const sources = Array.isArray((row as { sources?: unknown }).sources)
      ? ((row as { sources: unknown[] }).sources.filter((u): u is string => typeof u === 'string' && allowed.has(u)))
      : []
    const confidenceRaw = (row as { confidence?: unknown }).confidence
    const confidence = typeof confidenceRaw === 'number' ? Math.max(0, Math.min(1, confidenceRaw)) : 0
    const reason = (row as { reason?: unknown }).reason
    out.push({
      id,
      sources,
      confidence,
      ...(typeof reason === 'string' ? { reason: reason.slice(0, 200) } : {})
    })
  }
  return out
}

export async function semanticBindClaims(
  provider: ChatProvider,
  model: string,
  claims: SemanticClaim[]
): Promise<{ ok: boolean; bindings?: SemanticBinding[]; error?: string }> {
  if (claims.length === 0) return { ok: true, bindings: [] }
  const prompt = buildSemanticPrompt(claims)
  const res = await provider.chat({
    model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    temperature: 0,
    maxTokens: 4_000
  })
  if (!res.ok) return { ok: false, error: res.detail }
  const bindings = parseSemanticBindings(res.text, claims)
  if (bindings.length === 0) return { ok: false, error: '模型没有返回可解析的语义绑定' }
  return { ok: true, bindings }
}
