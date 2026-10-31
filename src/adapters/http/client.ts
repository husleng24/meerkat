/**
 * HTTP 客户端。
 *
 * 用 undici 的 `fetch` 而不是 `request`：
 *  - `request` 不支持 maxRedirections（会直接抛 "use the redirect interceptor"），
 *    而 arXiv 的 http:// 会 301，实测因此拿到空 body
 *  - `fetch` 默认跟随重定向并自动解压，少两类踩坑
 *
 * 退避策略来自实测：Reddit 对同 IP 连发 429，Substack 偶发 SSL 异常。
 */
import { Agent, fetch } from 'undici'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  /** 证书异常的源（如 substack）：跳过校验 */
  insecure?: boolean
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  body: string
  contentType: string
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 按 host 串行限速。
 * 实测：两个 reddit 子版并发请求会双双 429，即使各自先 sleep 也没用——
 * 因为它们会同时结束 sleep、同时发车。必须在客户端按 host 排队。
 */
const HOST_GAP_MS = 1800
const hostNextAt = new Map<string, number>()

async function throttle(url: string): Promise<void> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return
  }
  const now = Date.now()
  const slot = Math.max(now, hostNextAt.get(host) ?? 0)
  hostNextAt.set(host, slot + HOST_GAP_MS)
  const wait = slot - now
  if (wait > 0) await sleep(wait)
}

/** 每个 insecure 源一个短命 Agent，用完即弃，避免污染全局连接池 */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? 25_000
  const retries = opts.retries ?? 2
  let lastError = 'unknown'

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
    if (opts.signal) signals.push(opts.signal)
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : AbortSignal.timeout(timeoutMs)

    try {
      await throttle(url)
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal,
        headers: {
          'user-agent': UA,
          'accept-language': 'en-US,en;q=0.9',
          accept: '*/*',
          ...opts.headers
        },
        ...(opts.insecure ? { dispatcher: insecureAgent } : {})
      })

      if (res.status === 429 && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 0)
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : 3000 * (attempt + 1))
        lastError = 'HTTP 429'
        continue
      }
      if (res.status >= 500 && attempt < retries) {
        const waited = 1500 * (attempt + 1)
        await sleep(waited)
        lastError = `HTTP ${res.status}`
        continue
      }

      const body = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1))
        continue
      }
    }
  }
  throw new Error(lastError)
}

/** JSON 便捷读取 */
export async function httpGetJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpGet(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } })
  return JSON.parse(res.body) as T
}
