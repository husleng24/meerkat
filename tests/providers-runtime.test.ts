import { describe, it, expect } from 'vitest'
import { composeTarget, modelCatalog, resolveModel } from '../src/main/providers'

const deepseekKey = 'sk-deepseek-0123456789'
const openaiKey = 'sk-openai-0123456789'

describe('模型目录与覆盖', () => {
  it('没有 key 的供应商不出现在目录里', () => {
    expect(modelCatalog({})).toEqual([])
    expect(modelCatalog({ openai: openaiKey }).map((c) => c.provider)).toEqual(['openai'])
  })

  it('默认模型：DeepSeek 两个都在，OpenAI 一个', () => {
    const all = modelCatalog({ deepseek: deepseekKey, openai: openaiKey })
    expect(all.map((c) => c.model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o'])
  })

  it('覆盖模型 id 时替换而不是追加（避免留下一个选了就 404 的旧模型）', () => {
    const all = modelCatalog({ deepseek: deepseekKey }, { deepseek: 'deepseek-v5-preview' })
    expect(all.map((c) => c.model.id)).toEqual(['deepseek-v5-preview'])
    expect(all[0]!.model.label).toContain('自定义')
  })

  it('覆盖后的 id 仍然能被解析到正确的供应商与 key', () => {
    const r = resolveModel('deepseek-v5-preview', { deepseek: deepseekKey }, { deepseek: 'deepseek-v5-preview' })
    expect(r).toEqual({ provider: 'deepseek', key: deepseekKey, model: r!.model })
    expect(r!.model.id).toBe('deepseek-v5-preview')
  })

  it('未覆盖的 id 解析不到时返回 null（界面据此报"未配置"而不是发出去）', () => {
    expect(resolveModel('gpt-4o', { deepseek: deepseekKey })).toBeNull()
  })
})

describe('成稿用哪家', () => {
  it('优先 DeepSeek，其次 OpenAI', () => {
    expect(composeTarget({ openai: openaiKey })?.provider).toBe('openai')
    const both = composeTarget({ deepseek: deepseekKey, openai: openaiKey })
    expect(both).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('覆盖模型时成稿跟着换', () => {
    const t = composeTarget({ deepseek: deepseekKey }, { deepseek: 'deepseek-v5-preview' })
    expect(t?.model).toBe('deepseek-v5-preview')
  })

  it('一个 key 都没有时返回 null（调用方走降级聚合）', () => {
    expect(composeTarget({})).toBeNull()
  })
})
