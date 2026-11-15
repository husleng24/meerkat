/**
 * 调一次小模型，把标题扩展成中英文/换说法别名。
 *
 * 只在用户首次"跟踪"时调用；失败就退回标题实体词，绝不阻断跟踪。
 */
import type { Item } from '../core/domain/types'
import { buildAliasPrompt, fallbackAliases, mergeAliases, parseAliasesJson } from '../app/aliases'
import { createProviderInstance, modelCatalog, resolveModel, type ProviderKeys } from './providers'
import type { ProviderId } from '../core/chat/providers'

export interface AliasDeps {
  keys: ProviderKeys
  overrides?: Partial<Record<ProviderId, string>>
}

function pickModel(
  deps: AliasDeps,
  preferred?: string
): { provider: ReturnType<typeof createProviderInstance>; model: string } | null {
  if (preferred) {
    const resolved = resolveModel(preferred, deps.keys, deps.overrides ?? {})
    if (resolved) {
      const provider = createProviderInstance(resolved.provider, resolved.key)
      if (provider) return { provider, model: preferred }
    }
  }
  const first = modelCatalog(deps.keys, deps.overrides ?? {})[0]
  if (!first) return null
  const provider = createProviderInstance(first.provider, deps.keys[first.provider] ?? '')
  return provider ? { provider, model: first.model.id } : null
}

export async function expandAliases(
  deps: AliasDeps,
  item: Item,
  opts: { model?: string; signal?: AbortSignal } = {}
): Promise<string[]> {
  const base = fallbackAliases(item.title)
  const chat = pickModel(deps, opts.model)
  if (!chat?.provider) return base

  try {
    const r = await chat.provider.chat(
      {
        model: chat.model,
        messages: buildAliasPrompt(item.title, item.summary),
        maxTokens: 400,
        temperature: 0.2
      },
      opts.signal
    )
    if (!r.ok || !r.text.trim()) return base
    const extra = parseAliasesJson(r.text)
    return mergeAliases(base, extra)
  } catch {
    return base
  }
}
