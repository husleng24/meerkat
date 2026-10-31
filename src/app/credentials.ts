/**
 * 凭据解析：纯函数，便于单测。
 *
 * 为什么单独抽出来：解析 DSH 的 credentials.yaml 属于"读别人的文件格式"，
 * 格式随时可能变。把所有对它的假设集中在一处，将来只需改这个文件。
 */

/** key 打码：保留前缀便于用户确认是哪一把，绝不整串外泄 */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 10) return '***'
  return `${k.slice(0, 7)}***${k.slice(-2)}`
}

/**
 * 从 DeepSeek Harness 的 credentials.yaml 里取 API Key。
 *
 * 已知结构（2026-10）：
 *   refs:
 *     DEEPSEEK_API_KEY: sk-xxxx
 * 但也兼容 `DEEPSEEK_API_KEY: "sk-xxxx"` 带引号的写法。
 * 取不到就返回 undefined，让上层继续尝试别的来源。
 */
export function parseDshCredentials(text: string): string | undefined {
  if (!text) return undefined
  const m = /DEEPSEEK_API_KEY\s*:\s*['"]?(sk-[A-Za-z0-9_-]{8,})/.exec(text)
  return m ? m[1] : undefined
}

export type KeySource = 'store' | 'env' | 'dsh-file' | 'none'

export const KEY_SOURCE_LABEL: Record<KeySource, string> = {
  store: '已保存在本机（加密）',
  env: '来自环境变量 DEEPSEEK_API_KEY',
  'dsh-file': '来自 DeepSeek Harness 的凭据文件',
  none: '未配置'
}

/** 只接受看起来像 DeepSeek key 的输入，避免用户把别的东西粘进来 */
export function looksLikeDeepSeekKey(s: string): boolean {
  return /^sk-[A-Za-z0-9_-]{16,}$/.test(s.trim())
}
