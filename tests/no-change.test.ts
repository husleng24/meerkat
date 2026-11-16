import { describe, expect, it } from 'vitest'
import { allSourcesFailed, NO_CHANGE_MIN_ITEMS, renderNoChangeBrief, shouldSkipBrief } from '../src/app/no-change'

describe('无变化简报', () => {
  it('候选不足阈值时跳过成稿', () => {
    expect(shouldSkipBrief({ length: 0 })).toBe(true)
    expect(shouldSkipBrief({ length: NO_CHANGE_MIN_ITEMS - 1 })).toBe(true)
    expect(shouldSkipBrief({ length: NO_CHANGE_MIN_ITEMS })).toBe(false)
  })

  it('明确说没有变化，并给出检查范围', () => {
    const md = renderNoChangeBrief({
      topicName: 'AI 创业公司',
      dateLabel: '2026-11-16',
      weekday: '周一',
      windowHours: 48,
      sourceCount: 8,
      failedSources: 0,
      candidates: 2,
      droppedAsBriefed: 5
    })
    expect(md).toContain('AI 创业公司')
    expect(md).toContain('今天没有值得改变判断的变化')
    expect(md).toContain('8 个信息源')
    expect(md).toContain('2 条新候选')
    expect(md).toContain('另有 5 条此前已经推送过')
    expect(md).not.toContain('## 模型与产品')
  })

  it('全部源失败时不能下「没有变化」的结论', () => {
    expect(allSourcesFailed([{ ok: false }, { ok: false }])).toBe(true)
    expect(allSourcesFailed([{ ok: true }, { ok: false }])).toBe(false)
    expect(allSourcesFailed([])).toBe(false)
  })

  it('部分源失败时明确提示可能是抓取问题', () => {
    const md = renderNoChangeBrief({
      topicName: 'AI 综合',
      dateLabel: '2026-11-16',
      weekday: '周一',
      windowHours: 48,
      sourceCount: 8,
      failedSources: 2,
      candidates: 1,
      droppedAsBriefed: 0
    })
    expect(md).toContain('2 个信息源抓取失败')
    expect(md).not.toContain('这不是抓取失败')
  })

  it('部分源失败且已有旧闻时，两个事实都保留', () => {
    const md = renderNoChangeBrief({
      topicName: 'AI 综合',
      dateLabel: '2026-11-16',
      weekday: '周一',
      windowHours: 48,
      sourceCount: 8,
      failedSources: 2,
      candidates: 1,
      droppedAsBriefed: 5
    })
    expect(md).toContain('2 个信息源抓取失败')
    expect(md).toContain('5 条此前已经推送过')
  })

  it('没有旧闻时说明不是抓取失败', () => {
    const md = renderNoChangeBrief({
      topicName: 'AI 综合',
      dateLabel: '2026-11-16',
      weekday: '周一',
      windowHours: 48,
      sourceCount: 3,
      failedSources: 0,
      candidates: 0,
      droppedAsBriefed: 0
    })
    expect(md).toContain('这不是抓取失败')
  })
})
