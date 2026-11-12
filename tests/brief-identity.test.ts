import { describe, it, expect } from 'vitest'
import { briefFileName, briefTitle } from '../src/app/brief-identity'

describe('简报标题', () => {
  it('带上主题名，多主题下才能分辨归属', () => {
    expect(briefTitle('芯片与算力', '2026-11-12', '周四')).toBe('芯片与算力 简报 · 2026-11-12（周四）')
  })

  it('默认主题也走同一规则，不再特殊对待「AI」', () => {
    expect(briefTitle('AI 综合', '2026-11-12', '周四')).toBe('AI 综合 简报 · 2026-11-12（周四）')
  })
})

describe('导出文件名', () => {
  it('文件名带主题与日期，两个主题同一天不会互相覆盖', () => {
    expect(briefFileName('芯片与算力', '2026-11-12', 'md')).toBe('芯片与算力-简报-2026-11-12.md')
    expect(briefFileName('政策与安全', '2026-11-12', 'md')).toBe('政策与安全-简报-2026-11-12.md')
    expect(briefFileName('芯片与算力', '2026-11-12', 'md')).not.toBe(
      briefFileName('政策与安全', '2026-11-12', 'md')
    )
  })

  it('去掉空白、把路径分隔符等非法字符换成 -', () => {
    expect(briefFileName('AI 综合', '2026-11-12', 'pdf')).toBe('AI综合-简报-2026-11-12.pdf')
    expect(briefFileName('AI/安全', '2026-11-12', 'html')).toBe('AI-安全-简报-2026-11-12.html')
    expect(briefFileName(' ..  ', '2026-11-12', 'md')).toBe('简报-2026-11-12.md')
  })

  it('主题为空时只留「简报」，日期为空时兜底 brief，避免生成空文件名', () => {
    expect(briefFileName('', '2026-11-12', 'md')).toBe('简报-2026-11-12.md')
    expect(briefFileName('芯片', '', 'md')).toBe('芯片-简报-brief.md')
  })

  it('扩展名前带不带点都能工作', () => {
    expect(briefFileName('芯片', '2026-11-12', '.md')).toBe('芯片-简报-2026-11-12.md')
  })
})
