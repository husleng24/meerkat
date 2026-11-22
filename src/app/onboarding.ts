/**
 * 首启引导的状态与方向预设。
 *
 * 纯函数，不碰 Electron：
 * - main 用 `onboardingStatus` / `shouldDeferSchedule` 决定是否让定时器让路；
 * - renderer 用 `ONBOARDING_DIRECTIONS` 渲染方向卡。
 *
 * 状态存在 settings 表而不是 localStorage：首启期间需要主进程的定时器
 * 能读到它，否则会出现“引导还没出现，后台已经开始跑”的竞态。
 */
import type { Store } from '../core/ports/store'

export const ONBOARDING_VERSION = 1
export const ONBOARDING_KEY = 'onboarding.state'

export interface OnboardingRecord {
  version: number
  at: number
  /** 用户点了「跳过」；只用于诊断，不影响是否再次出现 */
  skipped?: boolean
  /** 老库按使用痕迹放行，不再弹引导 */
  grandfathered?: boolean
}

export interface OnboardingStatus {
  shouldShow: boolean
  /** 当前引导版本 */
  version: number
  /** 用户完成的版本；没完成过是 0 */
  completedVersion: number
  /** 这次是按“老用户”放行的 */
  grandfathered: boolean
}

export interface OnboardingDirection {
  id: string
  name: string
  desc: string
  /** 新主题的编辑重点；已存在的主题不覆盖 */
  editorialFocus?: string
}

/**
 * 首启可选的四个方向。
 *
 * id 沿用旧引导的 `ai/chip/robot/dev`：老库里可能已经有同名主题，
 * 首启必须复用而不是重新创建。
 */
export const ONBOARDING_DIRECTIONS: OnboardingDirection[] = [
  {
    id: 'ai',
    name: 'AI 综合',
    desc: '模型 / Agent / 研究 / 产品'
  },
  {
    id: 'chip',
    name: '芯片与算力',
    desc: 'GPU、代工、数据中心',
    editorialFocus:
      '只保留半导体、GPU、代工、数据中心与算力供应链的实质变化；忽略泛 AI 应用与融资新闻。'
  },
  {
    id: 'robot',
    name: '具身智能',
    desc: '人形、灵巧手、世界模型',
    editorialFocus:
      '只保留人形机器人、灵巧手、世界模型、具身数据与量产进展；忽略纯软件 Agent 与通用模型发布。'
  },
  {
    id: 'dev',
    name: '开发者工具',
    desc: 'IDE、CLI、SDK、Agent 框架',
    editorialFocus:
      '只保留 IDE、CLI、SDK、代码托管、Agent 框架与开发者工作流的实质变化；忽略消费级 AI 产品新闻。'
  }
]

function readRecord(store: Store): OnboardingRecord | null {
  const raw = store.settings.get<Partial<OnboardingRecord> | undefined>(ONBOARDING_KEY)
  if (!raw || typeof raw !== 'object') return null
  return {
    version: typeof raw.version === 'number' ? raw.version : 0,
    at: typeof raw.at === 'number' ? raw.at : 0,
    ...(raw.skipped === true ? { skipped: true } : {}),
    ...(raw.grandfathered === true ? { grandfathered: true } : {})
  }
}

/** 库里有没有真实使用痕迹；只在没有引导标记时用来识别老用户 */
function hasUsage(store: Store): boolean {
  return store.briefs.count() > 0 || store.items.count() > 0
}

/**
 * 首启判定。
 *
 * 没有标记 + 有使用痕迹 = 老库，按 grandfather 放行；
 * 没有标记 + 没有使用痕迹 = 新库，显示引导。
 */
export function onboardingStatus(store: Store): OnboardingStatus {
  const rec = readRecord(store)
  const completedVersion = rec?.version ?? 0

  if (rec && completedVersion >= ONBOARDING_VERSION) {
    return {
      shouldShow: false,
      version: ONBOARDING_VERSION,
      completedVersion,
      grandfathered: rec.grandfathered === true
    }
  }

  if (!rec && hasUsage(store)) {
    return {
      shouldShow: false,
      version: ONBOARDING_VERSION,
      completedVersion: 0,
      grandfathered: true
    }
  }

  return {
    shouldShow: true,
    version: ONBOARDING_VERSION,
    completedVersion,
    grandfathered: rec?.grandfathered === true
  }
}

/**
 * 老库升级：有使用痕迹但没有引导标记时补一个 grandfathered 标记，
 * 避免以后版本号变化又把老用户拉回来。新库不动。
 *
 * 返回是否真的写了标记。
 */
export function grandfatherOnboarding(store: Store): boolean {
  if (readRecord(store)) return false
  if (!hasUsage(store)) return false
  const rec: OnboardingRecord = {
    version: ONBOARDING_VERSION,
    at: Date.now(),
    grandfathered: true
  }
  store.settings.set(ONBOARDING_KEY, rec)
  return true
}

export function markOnboardingComplete(
  store: Store,
  opts: { skipped?: boolean; grandfathered?: boolean } = {}
): OnboardingRecord {
  const rec: OnboardingRecord = {
    version: ONBOARDING_VERSION,
    at: Date.now(),
    ...(opts.skipped ? { skipped: true } : {}),
    ...(opts.grandfathered ? { grandfathered: true } : {})
  }
  store.settings.set(ONBOARDING_KEY, rec)
  return rec
}

/**
 * 首启未完成时让定时器让路。
 *
 * 新库的 ai 和 youtube 都没有 lastRunAt，早上启动时两个都会 due；
 * 不拦的话，用户还在看引导，后台已经跑了两轮，CTA 只会拿到「正在运行中」。
 */
export function shouldDeferSchedule(store: Store): boolean {
  return onboardingStatus(store).shouldShow
}
