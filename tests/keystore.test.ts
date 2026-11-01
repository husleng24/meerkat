import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { userData, homeDir } = vi.hoisted(() => ({
  userData: { dir: '' },
  homeDir: { dir: '' }
}))

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // 假加密：前缀 + 原文，够验证"写进去的是密文、读出来的是原文"
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, '')
  }
}))

// 把 homedir 指到临时目录：否则这台机器上真实存在的 ~/.dsh/.credentials.yaml
// 会让 DeepSeek 永远是"已配置"，测不出"未配置"与供应商隔离
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => homeDir.dir }
})

const KEY_DEEPSEEK = 'sk-deepseek-0123456789abcdef'
const KEY_OPENAI = 'sk-openai-0123456789abcdef'
const KEY_ANTHROPIC = 'sk-ant-anthropic-0123456789'

beforeAll(() => {
  userData.dir = mkdtempSync(join(tmpdir(), 'meerkat-keys-'))
})

beforeEach(() => {
  homeDir.dir = mkdtempSync(join(tmpdir(), 'meerkat-home-'))
  for (const f of readdirSync(userData.dir)) {
    rmSync(join(userData.dir, f), { force: true })
  }
  delete process.env['DEEPSEEK_API_KEY']
  delete process.env['OPENAI_API_KEY']
  delete process.env['ANTHROPIC_API_KEY']
})

describe('多供应商密钥', () => {
  it('每个供应商写自己的文件，互不覆盖', async () => {
    const { setApiKey, getApiKey } = await import('../src/main/keystore')
    expect(setApiKey('deepseek', KEY_DEEPSEEK)).toEqual({ ok: true })
    expect(setApiKey('openai', KEY_OPENAI)).toEqual({ ok: true })

    expect(getApiKey('deepseek').key).toBe(KEY_DEEPSEEK)
    expect(getApiKey('openai').key).toBe(KEY_OPENAI)
    // DeepSeek 沿用旧的单 key 文件名，OpenAI 用带后缀的
    expect(readdirSync(userData.dir).sort()).toEqual(['secret-openai.bin', 'secret.bin'])
  })

  it('清除一家不影响另一家', async () => {
    const { setApiKey, getApiKey, clearApiKey } = await import('../src/main/keystore')
    setApiKey('deepseek', KEY_DEEPSEEK)
    setApiKey('openai', KEY_OPENAI)
    clearApiKey('openai')
    expect(getApiKey('openai').key).toBe('')
    expect(getApiKey('deepseek').key).toBe(KEY_DEEPSEEK)
  })

  it('按供应商校验格式：Anthropic 必须是 sk-ant-', async () => {
    const { setApiKey } = await import('../src/main/keystore')
    const bad = setApiKey('anthropic', KEY_OPENAI)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('Anthropic')
    expect(setApiKey('anthropic', KEY_ANTHROPIC).ok).toBe(true)
  })

  it('环境变量按供应商读，且不串台', async () => {
    const { getApiKey, keyStatus } = await import('../src/main/keystore')
    process.env['OPENAI_API_KEY'] = KEY_OPENAI
    expect(getApiKey('openai')).toEqual({ key: KEY_OPENAI, source: 'env' })
    expect(keyStatus('openai').sourceLabel).toContain('OPENAI_API_KEY')
    // 没配 DeepSeek 的环境变量，也没有 DSH 文件 → 未配置
    expect(getApiKey('deepseek').key).toBe('')
  })

  it('状态一次列全三家', async () => {
    const { allKeyStatuses } = await import('../src/main/keystore')
    const list = allKeyStatuses()
    expect(list.map((s) => s.provider)).toEqual(['deepseek', 'openai', 'anthropic'])
    expect(list.every((s) => typeof s.hasKey === 'boolean')).toBe(true)
  })

  it('旧版 secret.bin 仍然被当作 DeepSeek 的 key 读出来', async () => {
    const { getApiKey } = await import('../src/main/keystore')
    // 直接写一个"加密"后的旧文件，模拟升级前的用户
    writeFileSync(join(userData.dir, 'secret.bin'), Buffer.from(`enc:${KEY_DEEPSEEK}`, 'utf8'))
    expect(getApiKey('deepseek')).toEqual({ key: KEY_DEEPSEEK, source: 'store' })
  })
})
