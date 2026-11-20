import { describe, expect, it } from 'vitest'
import { auditTrust, classifyClaim } from '../src/app/trust'

describe('信任层', () => {
  it('按措辞区分传闻、推断和事实', () => {
    expect(classifyClaim('Reportedly, OpenAI will ship a model')).toBe('rumor')
    expect(classifyClaim('OpenAI 据称正在测试新模型')).toBe('rumor')
    expect(classifyClaim('OpenAI may launch a cheaper model')).toBe('inference')
    expect(classifyClaim('OpenAI 预计明年推出新模型')).toBe('inference')
    expect(classifyClaim('OpenAI launches GPT-6.2')).toBe('fact')
  })

  it('统计来源多样性、最大单源占比和无依据率', () => {
    const audit = auditTrust([
      { title: 'OpenAI ships A', body: '', sourceNames: ['TechCrunch'], hasTrace: true },
      { title: 'OpenAI ships A again', body: '', sourceNames: ['TechCrunch', 'The Verge'], hasTrace: true },
      { title: 'OpenAI may ship B', body: '', sourceNames: ['TechCrunch'], hasTrace: false }
    ])
    expect(audit.total).toBe(3)
    expect(audit.sources).toBe(2)
    expect(audit.topSource).toBe('TechCrunch')
    expect(audit.topShare).toBe(100)
    expect(audit.unsupported).toBe(1)
    expect(audit.unsupportedRate).toBe(33)
    expect(audit.inference).toBe(1)
    expect(audit.traceAvailable).toBe(true)
  })

  it('完全没有 trace 时不伪造无依据率', () => {
    const audit = auditTrust([{ title: 'x', body: '', sourceNames: [], hasTrace: false }])
    expect(audit.unsupported).toBeNull()
    expect(audit.unsupportedRate).toBeNull()
    expect(audit.traceAvailable).toBe(false)
  })
})
