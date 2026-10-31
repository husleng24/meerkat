/**
 * 文本与 URL 归一化。与 Python 原型 radar.py 的对应函数保持逐行等价，
 * 差异只允许出现在语言特性上，不允许出现在行为上（有 golden test 兜底）。
 *
 * 这个模块必须保持"纯"：不能 import node:*，因为渲染层的「和昨天比」要复用
 * titleKey / canonicalUrl。需要哈希的 itemId 在 ./item-id.ts。
 */

/** 去标签、解实体、压空白。对应 radar.py::clean_html */
export function cleanHtml(s: string | null | undefined): string {
  if (!s) return ''
  let t = s
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  t = t.replace(/<br\s*\/?>/gi, ' ')
  t = t.replace(/<\/p>/gi, ' ')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
  t = t.replace(/&#\d+;/g, ' ')
  t = t.replace(/\s+/g, ' ')
  return t.trim()
}

const TRACKING_PREFIXES = ['utm_', 'ref', 'fbclid', 'gclid']

/**
 * URL 规范化：去跟踪参数、小写域名、去尾斜杠。
 * 对应 radar.py::canon_url。差异：Python 对空 path 保留 ''，URL API 会给 '/'，
 * 这里显式把根路径归一成 '/'，两边一致。
 */
export function canonicalUrl(input: string): string {
  const raw = (input ?? '').trim()
  try {
    const u = new URL(raw)
    for (const key of [...u.searchParams.keys()]) {
      const lower = key.toLowerCase()
      if (TRACKING_PREFIXES.some((p) => lower.startsWith(p))) u.searchParams.delete(key)
    }
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '')
    }
    let out = u.toString()
    // URL 会把空查询的 '?' 去掉；避免 '?': 直接返回
    if (u.search === '' && out.endsWith('?')) out = out.slice(0, -1)
    return out
  } catch {
    return raw
  }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'on', 'in', 'with',
  'is', 'are', 'how', 'why', 'what', 'its', 'it'
])

/** 标题指纹：小写、只留字母数字与 CJK、去停用词。对应 radar.py::title_key */
export function titleKey(t: string): string {
  const normalized = (t ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
  return normalized
    .split(' ')
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .join(' ')
}
