/**
 * 标题相似度：实现 Ratcliff/Obershelp（Python difflib.SequenceMatcher.ratio 的算法），
 * 保证与 radar.py::dedupe 的 0.86 阈值语义一致。
 *
 * 为什么不用 Levenshtein：两边的分数不可比，阈值需要重新调参，
 * 而黄金测试只能保证"阈值不变时行为不变"。
 */

/** 最长匹配块：返回 [startA, startB, length] */
function longestMatch(
  a: string,
  b: string,
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number
): [number, number, number] | null {
  let bestI = -1
  let bestJ = -1
  let bestSize = 0
  // b2j: 字符 -> b 中出现的下标列表
  const b2j = new Map<string, number[]>()
  for (let j = bLo; j < bHi; j += 1) {
    const ch = b[j]!
    const list = b2j.get(ch)
    if (list) list.push(j)
    else b2j.set(ch, [j])
  }
  const j2len = new Map<number, number>()
  for (let i = aLo; i < aHi; i += 1) {
    const newJ2len = new Map<number, number>()
    for (const j of b2j.get(a[i]!) ?? []) {
      if (j < bLo || j >= bHi) continue
      const k = (j2len.get(j - 1) ?? 0) + 1
      newJ2len.set(j, k)
      if (k > bestSize) {
        bestI = i - k + 1
        bestJ = j - k + 1
        bestSize = k
      }
    }
    j2len.clear()
    for (const [k, v] of newJ2len) j2len.set(k, v)
  }
  return bestSize > 0 ? [bestI, bestJ, bestSize] : null
}

function matchingBlocks(a: string, b: string): number {
  let total = 0
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]]
  while (queue.length > 0) {
    const [aLo, aHi, bLo, bHi] = queue.pop()!
    const m = longestMatch(a, b, aLo, aHi, bLo, bHi)
    if (!m) continue
    const [i, j, size] = m
    total += size
    if (aLo < i && bLo < j) queue.push([aLo, i, bLo, j])
    if (i + size < aHi && j + size < bHi) queue.push([i + size, aHi, j + size, bHi])
  }
  return total
}

/** 相似度 0..1，等价于 difflib.SequenceMatcher(None, a, b).ratio() */
export function sequenceRatio(a: string, b: string): number {
  if (a === b) return 1
  const total = a.length + b.length
  if (total === 0) return 1
  return (2 * matchingBlocks(a, b)) / total
}
