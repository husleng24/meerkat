import { afterEach, describe, expect, it } from 'vitest'
import { startShare, stopShare } from '../src/main/share'

afterEach(() => stopShare())

describe('手机分享服务', () => {
  it('只在 token 路径返回简报，其他路径 404', async () => {
    const r = await startShare({ title: '测试简报', html: '<!doctype html><h1>手机阅读</h1>' })
    expect(r.ok).toBe(true)
    expect(r.url).toMatch(/^http:\/\/.+:\d+\/s\/[a-f0-9]+$/)

    const ok = await fetch(r.url!)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('text/html')
    expect(await ok.text()).toContain('手机阅读')

    const bad = await fetch(r.url!.replace(/\/s\/[a-f0-9]+$/, '/s/wrong'))
    expect(bad.status).toBe(404)
  })

  it('空内容不启动服务', async () => {
    expect(await startShare({ title: 'x', html: '   ' })).toEqual({ ok: false, error: '没有可分享的简报内容' })
  })
})
