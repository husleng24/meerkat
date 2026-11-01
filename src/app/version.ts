/**
 * 版本号比较：只处理 "v1.2.3" 这种形式（GitHub release tag 与 app.getVersion 都是它）。
 *
 * 为什么不用 semver 库：这里只需要"谁新"，规则越少越不容易在预发布/脏 tag 上出错。
 * 预发布（1.2.3-beta.1）按"比同号正式版旧"处理，避免把 beta 当成升级推给用户。
 */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string
}

export function parseVersion(input: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? ''
  }
}

/** a > b 返回正数，a < b 返回负数，相等返回 0；无法解析时按"不比"处理 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  // 同号：有预发布标记的更旧
  if (pa.prerelease && !pb.prerelease) return -1
  if (!pa.prerelease && pb.prerelease) return 1
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}
