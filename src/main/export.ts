/**
 * 导出：HTML / PDF / 富文本。
 *
 * 主进程只做"把渲染层给的 HTML 落地"，不做 markdown 解析——
 * 解析器只有渲染层那一份，两套解析必然漂移。
 */
import { BrowserWindow, app, clipboard, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function targetDir(): string {
  const dir = join(app.getPath('documents'), 'Meerkat')
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(dateLabel: string): string {
  // 日期可能是 "2026-10-30"，也可能被换成别的文案；只留安全字符
  const cleaned = dateLabel.replace(/[^\w\u4e00-\u9fff.-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'brief'
}

export function exportBriefHtml(html: string, dateLabel: string): string {
  const file = join(targetDir(), `AI简报-${safeName(dateLabel)}.html`)
  writeFileSync(file, html, 'utf8')
  shell.showItemInFolder(file)
  return file
}

/**
 * 转 PDF。
 *
 * 用一个隐藏窗口渲染同一份 HTML，再 printToPDF——这样导出的 PDF 与 HTML
 * 用的是同一套排版，不需要在 node 里引一个 PDF 排版库（中文断行是最容易翻车的地方）。
 */
export async function exportBriefPdf(html: string, dateLabel: string): Promise<string> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.5, right: 0.5 }
    })
    const file = join(targetDir(), `AI简报-${safeName(dateLabel)}.pdf`)
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
