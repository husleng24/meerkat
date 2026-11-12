/**
 * 导出：把「某一期简报」写成文件。
 *
 * 导出只需要两个身份字段：主题 + 日期。谁渲染 HTML 不重要（markdown 解析只有渲染层一份），
 * 主进程负责：查主题名 → 生成文件名 → 落地 → 在文件管理器里定位。
 * 三种格式共用这一条规则，避免「某个格式忘了带主题」——那会静默覆盖另一个主题的文件。
 */
import { BrowserWindow, app, clipboard, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { briefFileName } from '../app/brief-identity'
import type { Store } from '../core/ports/store'

export type BriefFormat = 'md' | 'html' | 'pdf'

/**
 * md 由主进程从库里取；html/pdf 由渲染层渲染后传进来（解析器只有一份）。
 * 两个分支都必须给 topicId + date，文件名才有唯一性。
 */
export type ExportRequest =
  | { format: 'md'; topicId: string; date: string }
  | { format: 'html' | 'pdf'; topicId: string; date: string; html: string }

function targetDir(): string {
  const dir = join(app.getPath('documents'), 'Meerkat')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 一次导出：查询、命名、落地都在这里，调用方不需要知道文件名规则 */
export async function exportBrief(store: Store, req: ExportRequest): Promise<string> {
  const topic = store.topics.get(req.topicId)
  if (!topic) throw new Error('主题不存在')

  const file = join(targetDir(), briefFileName(topic.name, req.date, req.format))

  if (req.format === 'md') {
    const brief = store.briefs.byDate(req.date, topic.id)
    if (!brief) throw new Error('这一期简报不存在')
    writeFileSync(file, brief.markdown, 'utf8')
    shell.showItemInFolder(file)
    return file
  }

  if (req.format === 'html') {
    writeFileSync(file, req.html, 'utf8')
    shell.showItemInFolder(file)
    return file
  }

  // PDF：用隐藏窗口渲染同一份 HTML 再 printToPDF，与 HTML 导出共用版式
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(req.html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5 }
    })
    writeFileSync(file, pdf)
    shell.showItemInFolder(file)
    return file
  } finally {
    win.destroy()
  }
}

/** 复制为富文本：同时放 text/html 与 text/plain，粘到 Word/邮件里保留排版 */
export function copyBriefRichText(html: string, text: string): boolean {
  clipboard.write({ text, html })
  return true
}
