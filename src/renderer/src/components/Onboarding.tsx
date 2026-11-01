import { useState } from 'react'

interface Props {
  sourceCount: number
  /** 建主题：选了几个领域就建几个，之后各自排程、各自出简报 */
  createTopic: (input: { id: string; name: string }) => Promise<string | null>
  onDone: () => void
}

/**
 * 首启引导：三步，目标 90 秒内出第一份简报。
 * 刻意不做账号、不做轮播——第 3 步允许跳过，因为"要不要花钱"应该
 * 推迟到用户已经看到价值之后（与 Python 版的产品判断一致）。
 */
export function Onboarding({ sourceCount, createTopic, onDone }: Props): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set(['ai']))

  const topics = [
    { id: 'ai', label: 'AI 综合', desc: '模型 / Agent / 研究全覆盖' },
    { id: 'chip', label: '芯片与算力', desc: 'GPU、代工、数据中心' },
    { id: 'robot', label: '具身智能', desc: '人形、灵巧手、世界模型' },
    { id: 'dev', label: '开发者工具', desc: 'IDE、CLI、SDK' }
  ]

  // 每个选中的领域 = 一个主题（一组源 + 一套排程 + 一条独立简报）
  const finish = async (): Promise<void> => {
    for (const id of picked) {
      const t = topics.find((x) => x.id === id)
      if (t) await createTopic({ id, name: t.label })
    }
    onDone()
  }

  return (
    <div className="grid h-full place-items-center px-10">
      <div className="w-full max-w-[560px]">
        <div className="mb-8 flex items-center gap-3">
          <img src="./icon-meerkat-64.png" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <div className="text-[17px] font-bold text-ink">Meerkat</div>
            <div className="text-[12px] text-ink-3">只看真正变了的那几条</div>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          {['选领域', '确认源', '接模型'].map((t, i) => (
            <div key={t} className="flex-1">
              <div className={`h-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-cream'}`} />
              <div className={`mt-2 text-[11px] ${i <= step ? 'text-ink' : 'text-ink-3/60'}`}>{t}</div>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div>
            <h2 className="mb-1 text-[14px] font-semibold text-ink">你主要想盯哪些方向？</h2>
            <p className="mb-4 text-[12px] text-ink-3">决定预置源的勾选，之后随时可改。</p>
            <div className="grid grid-cols-2 gap-2">
              {topics.map((t) => {
                const on = picked.has(t.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      const next = new Set(picked)
                      if (on) next.delete(t.id)
                      else next.add(t.id)
                      setPicked(next)
                    }}
                    className={[
                      'rounded-xl border px-3.5 py-3 text-left transition-colors',
                      on ? 'border-accent bg-white shadow-sm' : 'border-cream bg-white/40 hover:border-accent/40'
                    ].join(' ')}
                  >
                    <div className="text-[12.5px] font-semibold text-ink">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">{t.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="mb-1 text-[14px] font-semibold text-ink">已为你预置 {sourceCount} 个源</h2>
            <p className="mb-4 text-[12px] text-ink-3">
              全部可单独启停。连续失败的源会在"源"页标红，并给出可替代的同类型源。
            </p>
            <ul className="space-y-1.5 card px-4 py-3 text-[12px] text-ink/80">
              <li>· 一手官方：OpenAI、Anthropic、Google DeepMind、Hugging Face…</li>
              <li>· 研究：arXiv、HF 热榜、Google Research</li>
              <li>· 社区与媒体：HN、Reddit、TechCrunch、量子位</li>
              <li>· 视频：官方频道 + 7 个独立创作者</li>
            </ul>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-1 text-[14px] font-semibold text-ink">接一个模型来写简报</h2>
            <p className="mb-4 text-[12px] text-ink-3">
              不接也能用——会退化成"仅聚合"简报，按板块列条目和链接。
            </p>
            <div className="card px-4 py-3">
              <label className="text-[11px] font-semibold text-ink/70">DeepSeek API Key</label>
              <input
                type="password"
                placeholder="sk-…（可跳过）"
                className="mt-1.5 w-full rounded-lg border border-cream bg-white px-3 py-2 text-[12px] outline-none focus:border-accent"
              />
              <p className="mt-2 text-[10.5px] text-ink-3/80">
                密钥存在系统钥匙串（safeStorage），不进数据库、不进日志。
              </p>
            </div>
          </div>
        )}

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="text-[12px] text-ink-3 hover:text-ink">
              上一步
            </button>
          )}
          <button
            onClick={() => (step === 2 ? void finish() : setStep(step + 1))}
            className="ml-auto rounded-xl bg-ink px-5 py-2.5 text-[12.5px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            {step === 2 ? '开始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
