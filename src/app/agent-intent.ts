/**
 * 评论里 @agent 之后到底想干什么。
 *
 * 规则优先：跟踪/停止跟踪是明确的动词，不能被"顺便问一句"淹没；
 * 其余按有没有问句来分。P0 不调模型，省一次往返，也避免把"@agent 真的吗"
 * 误判成持续跟踪。
 */
export type AgentIntent = 'track' | 'untrack' | 'timeline' | 'ask'

const UNTRACK = /(别|不要|停止|取消|不用|别再|先别)(再)?(跟踪|追踪|盯着|关注)/
const TRACK = /(跟踪|追踪|盯着|关注|留意|跟进|持续看着)/
const TIMELINE = /(时间线|整理|梳理|脉络|来龙去脉|经过|发生了什么|前因后果)/
const QUESTION = /[?？]|(吗|是否|真的|为什么|怎么回事|如何|多少|哪|谁|什么时候)/

export const AGENT_MENTION = /@(agent|meerkat)\b/i

export function hasAgentMention(text: string): boolean {
  return AGENT_MENTION.test(text)
}

/** 去掉 @agent，剩下的才是用户真正说的话 */
export function stripMention(text: string): string {
  return text.replace(/@(agent|meerkat)\b/gi, '').replace(/\s{2,}/g, ' ').trim()
}

export function classifyIntent(text: string): AgentIntent {
  if (UNTRACK.test(text)) return 'untrack'
  if (TRACK.test(text)) return 'track'
  if (TIMELINE.test(text)) return 'timeline'
  if (QUESTION.test(text)) return 'ask'
  // @agent 后面是一句陈述/指令但没说跟踪：当作"整理一下"，不落库
  return 'timeline'
}
