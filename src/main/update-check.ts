/**
 * 检查 GitHub 上有没有更新的 Release。
 *
 * 只做"提示"，不做下载：当前两个平台都是未签名包，静默替换安装包在 macOS 上会被
 * Gatekeeper 拦，Windows 也会被 SmartScreen 拦。所以这里只回答"有没有新版本、去哪下"。
 *
 * 失败要静默：这是后台行为，网络不通（尤其国内访问 api.github.com）不该弹错误。
 */
import { isNewerVersion } from '../app/version'

export interface ReleaseInfo {
  tag: string
  url: string
  publishedAt?: string
  notes?: string
}

export interface UpdateCheckResult {
  ok: boolean
  current: string
  latest?: string
  hasUpdate: boolean
  url?: string
  publishedAt?: string
  /** 失败原因，只在手动检查时展示 */
  error?: string
}

export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal }
) => Promise<FetchResponseLike>

const DEFAULT_REPO = 'husleng24/meerkat'

function parseRelease(raw: unknown): ReleaseInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const tag = typeof r['tag_name'] === 'string' ? r['tag_name'] : ''
  const url = typeof r['html_url'] === 'string' ? r['html_url'] : ''
  if (!tag || !url) return null
  // 草稿与预发布不参与提醒：/releases/latest 本身会排除，这里再兜一层
  if (r['draft'] === true || r['prerelease'] === true) return null
  return {
    tag,
    url,
    ...(typeof r['published_at'] === 'string' ? { publishedAt: r['published_at'] } : {}),
    ...(typeof r['body'] === 'string' ? { notes: r['body'].slice(0, 4000) } : {})
  }
}

export async function fetchLatestRelease(
  fetchImpl: FetchLike,
  opts: { repo?: string; timeoutMs?: number } = {}
): Promise<{ ok: true; release: ReleaseInfo } | { ok: false; error: string }> {
  const repo = opts.repo ?? DEFAULT_REPO
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Meerkat-update-check',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })
    if (res.status === 404) return { ok: false, error: '找不到 Release（仓库可能未公开，或还没有已发布版本）' }
    if (res.status === 403) return { ok: false, error: 'GitHub API 限流，请稍后再试' }
    if (!res.ok) return { ok: false, error: `GitHub 返回 ${res.status}` }
    const release = parseRelease(await res.json())
    return release ? { ok: true, release } : { ok: false, error: 'Release 数据无法解析' }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? '检查超时' : '无法访问 GitHub'
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkForUpdate(
  fetchImpl: FetchLike,
  opts: { current: string; repo?: string; timeoutMs?: number } = { current: '0.0.0' }
): Promise<UpdateCheckResult> {
  const r = await fetchLatestRelease(fetchImpl, opts)
  if (!r.ok) return { ok: false, current: opts.current, hasUpdate: false, error: r.error }
  const hasUpdate = isNewerVersion(r.release.tag, opts.current)
  return {
    ok: true,
    current: opts.current,
    latest: r.release.tag,
    hasUpdate,
    url: r.release.url,
    ...(r.release.publishedAt ? { publishedAt: r.release.publishedAt } : {})
  }
}
