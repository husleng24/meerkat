/**
 * 对话动作与提示词。
 *
 * 动作 = 固定提示词 + 当前上下文，没有隐藏的编排逻辑。这样做的好处是：
 * 用户看得到每个按钮会问什么，改提示词只需要改这个文件。
 *
 * 「重新编排」产出的是一段 markdown 文本，P0 **不写库**——真正的草稿态
 * （diff、应用、还原）在 P2，先验证这类输出有没有人用。
 */

export type ChatActionId = 'ask' | 'summarize5' | 'compare' | 'why' | 'reorder'

export interface ChatAction {
  id: ChatActionId
  label: string
  /** 按钮 tooltip：说清它会拿什么、产出什么 */
  hint: string
  /** 需要上一期简报作为上下文 */
  needsPrevious?: boolean
  /** 产出 markdown 而不是一段话 */
  producesMarkdown?: boolean
}

export const CHAT_ACTIONS: ChatAction[] = [
  { id: 'summarize5', label: '总结成 5 条', hint: '只保留事实，每条 ≤50 字，带来源' },
  { id: 'compare', label: '和昨天比', hint: '用上一期做对照，列出新增 / 延续 / 消失', needsPrevious: true },
  { id: 'why', label: '这条为什么重要', hint: '先选中一条，再问它的影响面' },
  { id: 'reorder', label: '重新编排', hint: '按重要性重排，输出一版可直接复制的 markdown', producesMarkdown: true }
]

/** 系统提示词：约束语气、引用与"不知道"的处理 */
export const CHAT_SYSTEM_PROMPT = `你是 Meerkat 的阅读助手。用户刚读完一份 AI 行业日报，正在就这份简报提问。

规则：
1. 只依据提供的简报内容回答；简报里没有的信息，明确说"简报里没有提到"，不要用外部知识补全。
2. 引用具体条目时，带上它的来源名与链接（简报里给了链接就必须原样复制，不要改写 URL）。
3. 回答用中文，简洁直接；除非用户要求展开，控制在 300 字以内。
4. 涉及"哪个更重要"这类判断时，给出你的排序理由，并说明依据是简报里的哪些事实。
5. 不要输出 markdown 代码围栏，除非用户明确要求一版可复制的稿件。`

/**
 * 动作 → 用户消息。
 *
 * 注意：这里返回的是**用户口吻**的一句话，不是 system prompt。
 * 历史消息里会留下这句话，用户回看时能明白当时点了什么。
 */
export function actionPrompt(actionId: ChatActionId, opts: { itemTitle?: string } = {}): string {
  switch (actionId) {
    case 'summarize5':
      return '把今天这期简报总结成 5 条，每条不超过 50 字，保留来源名。'
    case 'compare':
      return '和上一期比，今天新增了什么、哪些是延续、哪些没再提？用三组列表回答。'
    case 'why':
      return opts.itemTitle
        ? `简报里的「${opts.itemTitle}」为什么重要？它对做 AI 产品的人意味着什么？`
        : '这期里最值得关注的一条为什么重要？它对做 AI 产品的人意味着什么？'
    case 'reorder':
      return '把今天这期简报按重要性重新编排：保留原有事实与链接，不新增内容，输出一版完整的 markdown。'
    case 'ask':
      return ''
  }
}

/** 动作按钮在界面上是否可用（缺上一期时藏起"和昨天比"） */
export function visibleActions(hasPrevious: boolean): ChatAction[] {
  return CHAT_ACTIONS.filter((a) => !a.needsPrevious || hasPrevious)
}
