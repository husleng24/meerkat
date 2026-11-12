/**
 * 把解析后的简报渲染成一份「脱离应用也能看」的 HTML。
 *
 * 为什么在渲染层做：markdown 的唯一解析器在这里（parseBrief），
 * 主进程再写一份解析就会有两套"什么叫一条简报"的定义。
 * 主进程只负责把拿到的 HTML 写文件 / 转 PDF / 放进剪贴板。
 */
import type { ParsedBrief } from './parseBrief'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CSS = `
  :root { --ink:#0b1220; --ink2:#5a6472; --ink3:#646e7b; --rule:#e6eaf2; --accent:#4f46e5; }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 32px 72px; background:#f7f8fb; color:var(--ink);
         font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,sans-serif;
         -webkit-font-smoothing:antialiased; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size:26px; line-height:1.3; letter-spacing:-0.02em; margin:0 0 6px; }
  .meta { color:var(--ink3); font-size:12px; margin:0 0 28px; }
  h2 { font-size:14px; margin:32px 0 10px; }
  h2 .n { color:var(--ink3); font-weight:500; margin-left:6px; }
  .hl { background:#fff; border:1px solid var(--rule); border-radius:14px; padding:6px 20px; }
  .hl div { display:flex; gap:14px; padding:12px 0; border-top:1px solid var(--rule); }
  .hl div:first-child { border-top:0; }
  .hl .i { color:var(--accent); font-weight:800; font-size:15px; width:18px; flex:none; }
  .hl p { margin:0; font-size:14px; line-height:1.75; }
  article { background:#fff; border:1px solid var(--rule); border-radius:14px; padding:14px 18px; margin:10px 0; }
  article h3 { font-size:14.5px; margin:0 0 6px; line-height:1.5; }
  article p { margin:0; font-size:12.5px; line-height:1.75; color:#39414d; }
  .links { margin-top:8px; font-size:11px; color:var(--ink3); }
  .links a { color:var(--accent); text-decoration:none; margin-right:10px; }
  .punch { margin-top:28px; background:#111827; color:#f3f4f6; border-radius:14px; padding:18px 22px; }
  .punch .k { font-size:10.5px; letter-spacing:0.18em; color:#9ca3af; margin-bottom:8px; }
  .punch p { margin:0; font-size:15px; line-height:1.75; font-weight:600; }
  footer { margin-top:32px; color:var(--ink3); font-size:10.5px; }
  @page { margin: 18mm 14mm; }
`

export interface BriefDocument {
  /** 完整 HTML 文档，可直接写文件或交给 printToPDF */
  html: string
  /** 纯文本，用于剪贴板的 text/plain 回退 */
  text: string
}

export function renderBriefDocument(brief: ParsedBrief, dateLabel: string): BriefDocument {
  const highlights = brief.highlights
    .map((h, i) => `<div><span class="i">${i + 1}</span><p>${esc(h)}</p></div>`)
    .join('')

  const sections = brief.sections
    .map((s) => {
      const heading = s.heading.replace(/^[\u2460-\u2473]\s*/, '')
      const items = s.items
        .map((it) => {
          const links = it.links.map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join('')
          return `<article><h3>${esc(it.title)}</h3>${it.body ? `<p>${esc(it.body)}</p>` : ''}${
            links ? `<div class="links">${links}</div>` : ''
          }</article>`
        })
        .join('')
      return `<h2>${esc(heading)}<span class="n">${s.items.length}</span></h2>${items}`
    })
    .join('')

  const punch = brief.punchline
    ? `<section class="punch"><div class="k">今日一句</div><p>${esc(brief.punchline)}</p></section>`
    : ''

  const title = brief.title || `简报 · ${dateLabel}`
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>${CSS}</style></head>
<body><main>
  <h1>${esc(title)}</h1>
  <p class="meta">${esc(brief.meta || dateLabel)}</p>
  ${highlights ? `<section class="hl">${highlights}</section>` : ''}
  ${sections}
  ${punch}
  <footer>导出自 Meerkat · ${esc(dateLabel)}</footer>
</main></body></html>`

  const text = [
    brief.title,
    brief.meta,
    '',
    ...brief.highlights.map((h, i) => `${i + 1}. ${h}`),
    '',
    ...brief.sections.flatMap((s) => [
      s.heading,
      ...s.items.map((it) => `- ${it.title}\n  ${it.body}\n  ${it.links.map((l) => l.url).join(' ')}`),
      ''
    ]),
    brief.punchline ? `今日一句：${brief.punchline}` : ''
  ]
    .filter((x) => x !== undefined)
    .join('\n')

  return { html, text }
}
