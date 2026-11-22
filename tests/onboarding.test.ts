import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  grandfatherOnboarding,
  markOnboardingComplete,
  onboardingStatus,
  shouldDeferSchedule
} from '../src/app/onboarding'
import type { Brief } from '../src/core/domain/types'

function saveBrief(topicId = 'ai'): Brief {
  return {
    id: 'b1',
    date: '2026-11-22',
    topicId,
    markdown: '# 今天的简报',
    model: 'test',
    tokensIn: 0,
    tokensOut: 0,
    createdAt: Date.now()
  }
}

describe('首启判定', () => {
  it('新库显示引导', () => {
    const store = createMemoryStore()
    const status = onboardingStatus(store)
    expect(status.shouldShow).toBe(true)
    expect(status.version).toBe(ONBOARDING_VERSION)
    expect(status.completedVersion).toBe(0)
    expect(status.grandfathered).toBe(false)
    expect(shouldDeferSchedule(store)).toBe(true)
    store.close()
  })

  it('完成或跳过后不再显示，并且定时器恢复', () => {
    const store = createMemoryStore()
    markOnboardingComplete(store, { skipped: true })
    const status = onboardingStatus(store)
    expect(status.shouldShow).toBe(false)
    expect(status.completedVersion).toBe(ONBOARDING_VERSION)
    expect(shouldDeferSchedule(store)).toBe(false)
    expect(store.settings.get<{ skipped?: boolean }>(ONBOARDING_KEY)?.skipped).toBe(true)
    store.close()
  })

  it('版本号落后于当前引导时重新显示', () => {
    const store = createMemoryStore()
    store.settings.set(ONBOARDING_KEY, { version: 0, at: Date.now() })
    expect(onboardingStatus(store).shouldShow).toBe(true)
    store.close()
  })

  it('损坏的标记按未完成处理，不抛异常', () => {
    const store = createMemoryStore()
    store.settings.set(ONBOARDING_KEY, 'not-an-object')
    expect(onboardingStatus(store).shouldShow).toBe(true)
    store.close()
  })
})

describe('老用户 grandfather', () => {
  it('有简报的老库补标记并放行', () => {
    const store = createMemoryStore()
    store.briefs.save(saveBrief())
    expect(onboardingStatus(store).shouldShow).toBe(false)
    expect(onboardingStatus(store).grandfathered).toBe(true)

    expect(grandfatherOnboarding(store)).toBe(true)
    expect(store.settings.get<{ grandfathered?: boolean }>(ONBOARDING_KEY)?.grandfathered).toBe(true)
    expect(onboardingStatus(store).shouldShow).toBe(false)
    expect(shouldDeferSchedule(store)).toBe(false)
    // 第二次不重复写
    expect(grandfatherOnboarding(store)).toBe(false)
    store.close()
  })

  it('没有使用痕迹的新库不补标记', () => {
    const store = createMemoryStore()
    expect(grandfatherOnboarding(store)).toBe(false)
    expect(store.settings.get(ONBOARDING_KEY)).toBeUndefined()
    expect(onboardingStatus(store).shouldShow).toBe(true)
    store.close()
  })

  it('已经有引导标记时 grandfather 不覆盖它', () => {
    const store = createMemoryStore()
    markOnboardingComplete(store)
    store.briefs.save(saveBrief())
    expect(grandfatherOnboarding(store)).toBe(false)
    expect(onboardingStatus(store).completedVersion).toBe(ONBOARDING_VERSION)
    store.close()
  })
})
