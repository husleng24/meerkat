import { describe, it, expect } from 'vitest'
import { compareVersions, isNewerVersion, parseVersion } from '../src/app/version'

describe('版本号', () => {
  it('解析 v 前缀与预发布', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' })
    expect(parseVersion('1.2.3-beta.1')?.prerelease).toBe('beta.1')
    expect(parseVersion('abc')).toBeNull()
  })

  it('按 major/minor/patch 比较', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
  })

  it('预发布比同号正式版旧', () => {
    expect(isNewerVersion('1.2.3', '1.2.3-beta.1')).toBe(true)
    expect(isNewerVersion('1.2.3-beta.1', '1.2.3')).toBe(false)
  })

  it('无法解析时不误报升级', () => {
    expect(isNewerVersion('nightly', '0.1.0')).toBe(false)
  })
})
