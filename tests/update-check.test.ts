import { describe, it, expect, vi } from 'vitest'
import { checkForUpdate, type FetchLike } from '../src/main/update-check'

function respond(body: unknown, status = 200): FetchLike {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })
}

const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/husleng24/meerkat/releases/tag/${tag}`,
  published_at: '2026-11-01T00:00:00Z',
  draft: false,
  prerelease: false
})

describe('检查 GitHub Release', () => {
  it('有更新版本时给出下载地址与 changelog', async () => {
    const r = await checkForUpdate(
      respond({ ...release('v0.2.0'), body: '## 新增\n- 升级提醒' }),
      { current: '0.1.0' }
    )
    expect(r).toMatchObject({ ok: true, latest: 'v0.2.0', hasUpdate: true })
    expect(r.url).toContain('/releases/tag/v0.2.0')
    expect(r.notes).toContain('升级提醒')
  })

  it('同版本或更旧的版本不算更新', async () => {
    expect((await checkForUpdate(respond(release('v0.1.0')), { current: '0.1.0' })).hasUpdate).toBe(false)
    expect((await checkForUpdate(respond(release('v0.0.9')), { current: '0.1.0' })).hasUpdate).toBe(false)
  })

  it('草稿或预发布不提醒', async () => {
    const draft = { ...release('v0.2.0'), draft: true }
    const pre = { ...release('v0.2.0'), prerelease: true }
    expect((await checkForUpdate(respond(draft), { current: '0.1.0' })).hasUpdate).toBe(false)
    expect((await checkForUpdate(respond(pre), { current: '0.1.0' })).hasUpdate).toBe(false)
  })

  it('404 / 403 / 网络错误都返回可读原因，而不是抛异常', async () => {
    expect(await checkForUpdate(respond({}, 404), { current: '0.1.0' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('仓库可能未公开')
    })
    expect(await checkForUpdate(respond({}, 403), { current: '0.1.0' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('限流')
    })
    const boom: FetchLike = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await checkForUpdate(boom, { current: '0.1.0' })).toMatchObject({ ok: false, error: '无法访问 GitHub' })
  })

  it('返回结构不对时不误报', async () => {
    expect((await checkForUpdate(respond({}), { current: '0.1.0' })).ok).toBe(false)
  })
})
