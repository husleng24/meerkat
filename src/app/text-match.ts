/**
 * 轻量文本相似度：英文按词、中文按二元组。
 *
 * 规则推荐（加源时选主题、按主题推荐源）都靠它。刻意不用向量：
 * 离线可用、零调用成本，而且"为什么推荐"能说清楚——推荐不准时用户能自己判断。
 */
const STOP = new Set([
  'http', 'https', 'www', 'com', 'org', 'net', 'rss', 'feed', 'xml', 'html',
  'news', 'blog', 'the', 'and', 'for', 'with',
  // 中文里几乎每条标题都会出现的词，留着只会让所有东西都"相似"
  '发布', '模型', '我们', '一个', '这个', '可以', '如何', '什么', '今天'
])

export function tokenize(text: string): Set<string> {
  const out = new Set<string>()
  const lower = text.toLowerCase()
  for (const m of lower.matchAll(/[a-z0-9]+/g)) {
    const t = m[0]
    // 2 个字母的缩写也要留（AI、5G）——它们是主题名里最常见的词
    if (t.length >= 2 && !STOP.has(t)) out.add(t)
  }
  const seq = (lower.match(/[\u4e00-\u9fa5]+/g) ?? []).join('')
  for (let i = 0; i + 2 <= seq.length; i++) {
    const t = seq.slice(i, i + 2)
    if (!STOP.has(t)) out.add(t)
  }
  return out
}

export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n += 1
  return n
}
