/**
 * 条目 id：sha1(规范化URL + 标题指纹) 取前 16 位。跨天去重的基石。
 *
 * 单独成文件是因为它依赖 node:crypto，而同目录的 text.ts 要保持纯函数
 * （渲染层的"和昨天比"要复用 titleKey / canonicalUrl，那里没有 node:crypto）。
 */
import { createHash } from 'node:crypto'
import { canonicalUrl, titleKey } from './text'

export function itemId(url: string, title: string): string {
  return createHash('sha1').update(canonicalUrl(url) + titleKey(title), 'utf8').digest('hex').slice(0, 16)
}
