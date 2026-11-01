// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatMarkdown } from '../src/renderer/src/components/ChatMarkdown'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(text: string): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    root!.render(<ChatMarkdown text={text} />)
  })
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('对话里的 markdown', () => {
  it('粗体渲染成 strong，而不是露出星号', async () => {
    const el = await render('这是 **重点** 内容')
    expect(el.querySelector('strong')?.textContent).toBe('重点')
    expect(el.textContent).not.toContain('**')
  })

  it('链接渲染成可点的 a，且带 noopener', async () => {
    const el = await render('见 [The Verge](https://example.com/x)')
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/x')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('无序与有序列表分别渲染', async () => {
    const ul = await render('- 甲\n- 乙')
    expect(ul.querySelectorAll('li')).toHaveLength(2)
    expect(ul.querySelector('ul')).not.toBeNull()
    await act(async () => root?.unmount())
    ul.remove()

    const ol = await render('1. 甲\n2. 乙')
    expect(ol.querySelector('ol')).not.toBeNull()
  })

  it('标题行渲染成加粗段落', async () => {
    const el = await render('## 三条要点\n正文')
    expect(el.textContent).toContain('三条要点')
    expect(el.textContent).toContain('正文')
  })

  it('行内代码用等宽样式', async () => {
    const el = await render('执行 `pnpm test` 即可')
    expect(el.querySelector('code')?.textContent).toBe('pnpm test')
  })

  it('纯文本里的尖括号不会被当成 HTML（React 元素渲染，无注入面）', async () => {
    const el = await render('<script>alert(1)</script>')
    expect(el.querySelector('script')).toBeNull()
    expect(el.textContent).toContain('<script>alert(1)</script>')
  })
})
