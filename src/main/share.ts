/**
 * 手机阅读：把当前简报渲染成一份静态 HTML，用一次性 token 在局域网里临时提供。
 *
 * 不引入云、不上传任何内容；手机和电脑在同一 Wi-Fi 时才能打开。
 * 服务只返回这一份 HTML，没有 API、没有 cookie；30 分钟后自动关。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'

export interface ShareInput {
  title: string
  html: string
}

export interface ShareSession {
  ok: boolean
  url?: string
  expiresAt?: number
  error?: string
}

interface ActiveShare {
  server: Server
  token: string
  timer: NodeJS.Timeout
  expiresAt: number
}

const TTL_MS = 30 * 60_000
let active: ActiveShare | null = null

function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) return item.address
    }
  }
  return '127.0.0.1'
}

function closeActive(): void {
  if (!active) return
  clearTimeout(active.timer)
  active.server.close()
  active = null
}

export function stopShare(): void {
  closeActive()
}

export function shareUrl(): string | undefined {
  return active ? `http://${lanIp()}:${(active.server.address() as AddressInfo).port}/s/${active.token}` : undefined
}

/** 开始/替换当前分享页；内容只留在内存，不写盘。 */
export async function startShare(input: ShareInput): Promise<ShareSession> {
  if (!input.html.trim()) return { ok: false, error: '没有可分享的简报内容' }
  closeActive()
  const token = randomBytes(16).toString('hex')
  const html = input.html
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method !== 'GET' || url.pathname !== `/s/${token}`) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex'
    })
    res.end(html)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '0.0.0.0', () => resolve())
    })
    const expiresAt = Date.now() + TTL_MS
    const timer = setTimeout(() => closeActive(), TTL_MS)
    timer.unref?.()
    active = { server, token, timer, expiresAt }
    return { ok: true, url: shareUrl(), expiresAt }
  } catch (e) {
    server.close()
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
