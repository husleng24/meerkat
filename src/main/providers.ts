/**
 * 供应商运行时：把「目录里的元数据 + key」变成可调用的适配器。
 *
 * 放在 main 而不是 core：它要读 settings（模型 id 覆盖），而 core 不认识存储。
 * 协议选择本身仍然是 core 的定义（`ProviderMeta.protocol`），这里只做实例化。
 */
import { createOpenAICompatibleChat } from '../adapters/llm/openai-compatible'
import { createAnthropicChat } from '../adapters/llm/anthropic'
import { PROVIDERS, providerMeta, type ProviderId } from '../core/chat/providers'
import type { ChatProvider, ChatModelInfo } from '../core/ports/chat'
import type { Store } from '../core/ports/store'

export type ProviderKeys = Partial<Record<ProviderId, string>>

export function createProviderInstance(id: ProviderId, key: string): ChatProvider | null {
  const meta = providerMeta(id)
  if (!meta) return null
  if (meta.protocol === 'anthropic') {
    return createAnthropicChat({ apiKey: key, baseUrl: meta.baseUrl, models: meta.models })
  }
  return createOpenAICompatibleChat({ id: meta.id, baseUrl: meta.baseUrl, apiKey: key, models: meta.models })
}

/** 用户可在设置里覆盖某个供应商的模型 id：模型下线时不必改代码 */
export function modelOverrideKey(id: ProviderId): string {
  return `chat.model.${id}`
}

export function readModelOverrides(store: Store): Partial<Record<ProviderId, string>> {
  const out: Partial<Record<ProviderId, string>> = {}
  for (const p of PROVIDERS) {
    const v = store.settings.get<string>(modelOverrideKey(p.id))
    if (typeof v === 'string' && v.trim()) out[p.id] = v.trim()
  }
  return out
}

export interface ModelChoice {
  model: ChatModelInfo
  provider: ProviderId
}

/**
 * 可用模型清单（只含已配置 key 的供应商）。
 *
 * 覆盖规则：某个供应商设了自定义模型 id 时，用它**替换**该供应商的默认模型，
 * 而不是追加——追加会留下一个"选了就 404"的旧模型。
 */
export function modelCatalog(keys: ProviderKeys, overrides: Partial<Record<ProviderId, string>> = {}): ModelChoice[] {
  const out: ModelChoice[] = []
  for (const p of PROVIDERS) {
    if (!keys[p.id]) continue
    const custom = overrides[p.id]
    if (custom) {
      out.push({
        provider: p.id,
        model: { ...p.models[0]!, id: custom, label: `${custom}（自定义）` }
      })
      continue
    }
    for (const m of p.models) out.push({ model: m, provider: p.id })
  }
  return out
}

export function resolveModel(
  modelId: string,
  keys: ProviderKeys,
  overrides: Partial<Record<ProviderId, string>> = {}
): { provider: ProviderId; key: string; model: ChatModelInfo } | null {
  for (const choice of modelCatalog(keys, overrides)) {
    if (choice.model.id === modelId) {
      const key = keys[choice.provider]
      if (!key) return null
      return { provider: choice.provider, key, model: choice.model }
    }
  }
  return null
}

export interface ComposeTarget {
  provider: ProviderId
  key: string
  model: string
}

/**
 * 成稿用哪家：优先 DeepSeek（它的两个模型都实测过），其次 OpenAI，最后 Anthropic。
 * 这样只配了 OpenAI/Anthropic 的机器也能出完整简报，而不是降级成"仅聚合"。
 */
export function composeTarget(
  keys: ProviderKeys,
  overrides: Partial<Record<ProviderId, string>> = {}
): ComposeTarget | null {
  for (const id of ['deepseek', 'openai', 'anthropic'] as ProviderId[]) {
    const key = keys[id]
    if (!key) continue
    const catalog = modelCatalog(keys, overrides).filter((c) => c.provider === id)
    const model = catalog[0]?.model.id ?? providerMeta(id)?.models[0]?.id
    if (!model) continue
    return { provider: id, key, model }
  }
  return null
}
