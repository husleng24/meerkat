/**
 * 简报身份：标题与导出文件名都只由「主题 + 日期」决定。
 *
 * 多主题模型里最容易被写死成「AI 简报」的地方就是这里，所以集中成两个纯函数：
 * 界面标题、通知标题、markdown 的 H1、以及 md/html/pdf 的文件名共用同一套规则。
 * 模型只负责正文——归属是数据，不是生成内容。
 */

/** 例如：briefTitle('芯片与算力', '2026-11-12', '周四') → 芯片与算力 简报 · 2026-11-12（周四） */
export function briefTitle(topicName: string, dateLabel: string, weekday: string): string {
  return `${topicName} 简报 · ${dateLabel}（${weekday}）`
}

/** 只留文件名安全字符；空白直接去掉（「AI 综合」→「AI综合」），中文保留 */
function safePart(s: string): string {
  return (s ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+|\.+$/g, '')
}

/** 例如：briefFileName('芯片与算力', '2026-11-12', 'md') → 芯片与算力-简报-2026-11-12.md */
export function briefFileName(topicName: string, dateLabel: string, ext: string): string {
  const topic = safePart(topicName)
  const date = safePart(dateLabel) || 'brief'
  const prefix = topic ? `${topic}-简报` : '简报'
  return `${prefix}-${date}.${ext.replace(/^\./, '')}`
}
