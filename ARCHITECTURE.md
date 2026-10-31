# AI Radar 代码架构设计

> v0.1 · 2026-10-30
> 配套：[DESIGN.md](DESIGN.md)（功能设计）
> 技术基线：Electron 45 / Node 24 / TypeScript 5.x

---

## 〇、一句话结论

**这个系统的稳定核心只有一个：`Item` 的数据形状 + `fetch → normalize → dedupe → rank → select → compose` 这条管线的拓扑 + 三条认知保证（可追溯、增量、可降级）。
除此之外——源怎么抓、模型怎么调、界面长什么样——全部应该是可替换的插件。**

架构的目标不是"分层好看"，而是**把变更关进盒子里**：加一个源不碰核心，换一个模型不碰界面，改一版简报不动数据层。

---

## 一、先测"什么在变"——用真实证据，不靠感觉

过去 24 小时我们实际遇到的变更，是最好的采样：

| 事件 | 变更类型 | 波及范围（当前 Python 版） |
|---|---|---|
| nitter / xcancel 挂掉 | 端点失效 | 无（本来就没接） |
| YouTube 下线频道 Atom feed，改 `lockupViewModel` | **页面结构变更** | 重写 1 个抓取器 |
| arXiv 公告滞后 1–2 天 | 数据语义变更 | 改 1 行窗口配置 |
| Reddit 429 | 访问策略变更 | 加退避 |
| `deepseek-v4-pro` 把 token 全烧在推理上 | **模型行为变更** | 改 1 个参数 |
| HF 页面没有 `upvotes` 字段 | 我曾假设的字段不存在 | 改用排名替代 |

由此可以给每个维度打出"变化频率"：

| 维度 | 变化频率 | 证据 | 架构结论 |
|---|---|---|---|
| 源端点 URL | **周** | nitter 死、YT RSS 下线 | 必须是**数据**，不是代码 |
| 源页面结构 | **月** | ytInitialData → lockupViewModel | 必须是**独立适配器**，可单独替换 |
| 反爬策略 | **周** | Reddit 429、X 全封 | 必须是横切能力（退避/代理/限流），不能散落 |
| 模型与参数 | **月** | v4-pro 推理截断 | 必须是**端口 + 适配器** |
| 简报内容/版式 | **天**（用户会调） | 编辑方针可改 | 必须是**内容**（prompt 文件），不是代码 |
| 排序权重 | **周**（调优期） | 研究类压过新闻那次 | 必须是**数据 + 版本号** |
| 板块分类 | **季** | 9 个板块可能增减 | 配置驱动 |
| `Item` 字段 | **年** | — | **稳定核心**，改动要付迁移代价 |
| 管线拓扑 | **年** | — | **稳定核心** |
| 增量/去重语义 | **年** | — | **稳定核心** |
| UI 结构 | **周** | 还在找手感 | 完全隔离，不得渗透进核心 |

**反过来看"什么几乎不变"：**

1. `Item` 的形状：`{id, sourceId, title, url, publishedAt, summary, raw}`。三个月里我们只加过 `engagement` 和 `also_in`。
2. 管线的**顺序**：先抓、再去重、再排序、最后写。这个顺序有语义依赖，换不掉。
3. "同一件事只讲一次"——这是产品定义，不是实现细节。
4. "每条结论必须能点回原文"——这是可信度的地基。
5. "没有模型也要能用"——降级路径不是容错，是产品的一等形态。

> **判断标准**：一个维度如果"一年内大概率变 3 次以上"，它就是易变的，必须挡在核心之外。

---

## 二、核心稳定 vs 边缘易变：一张边界图

```
┌─────────────────────────────────────────────────────────────┐
│  框架层（最易变）  Electron / React / better-sqlite3 / undici │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  适配器层（易变）  RSS解析 / HTML选择器 / SQL / LLM调用  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  应用层（较稳）  Collect / Compose / Manage      │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  核心（不变）  Item / 管线 / 三条保证      │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
     依赖只能向内。核心不知道 Electron 存在，也不知道 sqlite 存在。
```

用 Martin 的稳定度指标 `I = Ce / (Ca + Ce)` 来表达目标：

| 层 | 期望 I 值 | 含义 |
|---|---|---|
| `core/domain` | **0.0** | 不依赖任何东西（Ce=0） |
| `core/pipeline` | **0.1** | 只依赖 domain + ports |
| `core/ports` | **0.0** | 纯接口 |
| `app`（用例） | 0.3 | 依赖 core，不依赖适配器具体实现 |
| `adapters/*` | 0.8–1.0 | 被注入，依赖一切底层 |
| `main` / `renderer` | 1.0 | 最外层，随时可换 |

违反这个分布的代码，一律在任何 review 里打回。

---

## 三、深模块（Deep Modules）设计

Ousterhout 的定义：**接口的复杂度远小于实现的复杂度**。深模块的价值是"用一句话就能说清，但背后很复杂"。

### 3.1 本系统的六个深模块

| 模块 | 对外接口（一句话） | 背后隐藏的复杂度 | 实现规模 |
|---|---|---|---|
| **`Radar.run()`** | 跑一次完整采集，边跑边报进度 | 35 源并发、限速、重试、归一、去重、打分、落库 | ~600 行 |
| **`SourceRegistry.probe(url)`** | 这个地址能不能读？读出来长什么样？ | 类型嗅探、9 类抓取器、编码/gzip、反爬识别 | ~400 行 |
| **`Dedupe.absorb(items)`** | 把重复的合并掉，并记住"这件事昨天已经讲过" | URL 规范化、标题模糊匹配、跨天状态、相似度阈值 | ~200 行 |
| **`Composer.compose(input)`** | 把素材写成一份简报 | prompt 组装、截断策略、重试、token 计量 | ~250 行 |
| **`BriefStore`** | 存取简报与条目 | SQLite、迁移、FTS5、索引、事务 | ~350 行 |
| **`Ranker.rank(items, policy)`** | 排个序 | 时效衰减、互动量对数、信号词、噪声惩罚、版本化 | ~150 行 |

### 3.2 判据：接口 / 实现的"厚度比"

我给自己定的量化标准：

```
深模块： exported symbols ≤ 5  且  实现行数 / 接口符号数 ≥ 60
浅模块： exported symbols > 8  或   实现行数 / 接口符号数 < 15
```

按这个尺子，`Radar.run()` 是 **1 个导出（`run`）+ 600 行**，厚度比 600，是典型深模块。
而一个 `ItemFactory + ItemBuilder + ItemValidator + ItemMapper` 的四件套是典型**浅模块化**——四个类合起来做的事，一个 `normalize(raw): Item` 就够了。

### 3.3 刻意**不建**的模块（负面清单）

这是 Clean Code 最容易翻车的地方——把"分层"做成"层层转发"。

| 不建 | 理由 |
|---|---|
| `ItemService` / `SourceManager` / `BriefController` | 没有第二个实现、没有跨切面逻辑的"Service"只是转发壳 |
| `utils.ts` / `helpers/` / `common/` | 万能桶 = 没有归属 = 谁都能往里塞垃圾。按领域命名：`normalizeTitle` 就该在 `dedupe` 里 |
| DTO 层（`ItemDTO → ItemVO → Item`） | 单一进程内没有序列化边界需要跨，映射三层是纯损耗 |
| ORM | 六张表 + 一张 FTS5 虚拟表，手写 SQL 更短更透明 |
| 基类 / 继承体系 | 全线组合，零继承 |
| 泛型 `Repository<T>` | 六张表的查询形态差异极大，强行泛型会把差异挤进 `any` |

**一条硬规则**：新建文件前先回答"它的名字是一个**领域名词**吗？"答不上来，就不要建。

---

## 四、信息隐藏：三个"接缝"

架构的本质是决定"在哪里允许切开"。本系统只保留三个接缝，其余地方一律焊死。

### 接缝 ①：源（Source）——数据优先，代码兜底

```ts
// core/domain/source.ts
export type SourceKind =
  | 'rss' | 'atom' | 'arxiv' | 'hn' | 'youtube'
  | 'github-trending' | 'hfpapers' | 'html'

export interface SourceSpec {
  id: string
  name: string
  kind: SourceKind
  /** kind 为 rss/atom 时必填 */
  url?: string
  /** kind 为 youtube 时必填 */
  channelId?: string
  tier: 1 | 2 | 3
  bucketHint: Bucket
  windowHours?: number
  alwaysKeep?: boolean
  /** kind 为 html 时指定解析器名，对应 adapters/sources/parsers 注册表 */
  parser?: string
}
```

**关键决策：声明式源用数据，命令式源用插件。**

- 加一个 RSS 源 → **改 1 个 YAML，0 行代码**
- 加一个结构特殊的站点 → 写 1 个 `PageParser` 文件 + 注册 1 行
- 核心代码**永远不需要为"新增源"而改**

这是整个架构里投入产出比最高的一条。当前 Python 版的 `FETCHERS` 字典已经接近这个形态，但缺一个"命名解析器注册表"，导致 HTML 源只能硬编码在函数里。

### 接缝 ②：模型（Composer）

```ts
// core/ports/composer.ts
export interface Composer {
  compose(input: ComposeInput): Promise<ComposeResult>
}

export type ComposeResult =
  | { ok: true; markdown: string; usage: TokenUsage }
  | { ok: false; reason: 'rate-limit' | 'context-overflow' | 'provider-error'; detail: string }
```

**信息隐藏的关键**：`ComposeInput` 里**不含 prompt**。prompt 由适配器从 `prompts/*.md` 读取并与输入拼装。核心只知道"要一份 markdown"，不知道 OpenAI 协议、不知道温度、不知道模型名。

**这条设计让"编辑方针可改"成为可能**：prompt 是磁盘上的内容文件，用户可以改，改了不需要重新编译。

### 接缝 ③：渲染（Render）

```ts
// app 层产出的是领域 IR，不是字符串
export interface BriefDoc {
  meta: BriefMeta
  highlights: string[]            // 三句话速览
  sections: BriefSection[]        // { bucket, items: BriefItem[] }
  punchline: string
  markdown: string                // 原文保真副本
}
```

渲染器（md / docx / React 组件）全部从 `BriefDoc` 出发。

> **为什么同时保留 `markdown` 和 IR？**
> IR 给界面用（要挂条目 id、点击、已读态）；markdown 给导出用（保真，改版式不会丢内容）。
> 只存 markdown → UI 要现解析；只存 IR → 模型输出里的细微格式全丢。两个都留，代价是几 KB。

---

## 五、Clean Architecture 落地（不做仪式，只做依赖方向）

### 5.1 目录结构

```
src/
├── core/                        # 零依赖，纯 TS，可 100% 单测
│   ├── domain/                  # 实体，无行为外泄
│   │   ├── item.ts
│   │   ├── source.ts
│   │   ├── brief.ts
│   │   └── run.ts
│   ├── ports/                   # 接口由 core 拥有（依赖倒置）
│   │   ├── fetcher.ts
│   │   ├── store.ts
│   │   ├── composer.ts
│   │   ├── clock.ts
│   │   └── logger.ts
│   ├── pipeline/                # 纯函数，可组合
│   │   ├── run.ts               # ★ 深模块：Radar.run
│   │   ├── normalize.ts
│   │   ├── dedupe.ts
│   │   ├── classify.ts
│   │   ├── rank.ts
│   │   └── select.ts
│   └── policy/
│       ├── policy.ts            # 排序权重、板块规则的**数据**
│       └── versions.ts          # formulaVersion：让历史分数可追溯
│
├── adapters/                    # 易变，全部可替换
│   ├── http/                    # undici 封装：重试/限速/超时/代理
│   ├── sources/                 # 9 类抓取器 + 命名解析器注册表
│   ├── store/sqlite/            # 迁移、仓储、FTS5
│   ├── llm/                     # deepseek.ts + prompts/*.md
│   └── render/                  # markdown.ts / docx.ts
│
├── app/                         # 用例：编排 core 与 ports
│   ├── collect.ts               # 一次采集
│   ├── compose-brief.ts         # 生成简报（含链接校验）
│   ├── manage-sources.ts
│   └── query-timeline.ts
│
├── main/                        # Electron 主进程：窗口/托盘/调度/IPC
├── preload/                     # contextBridge 白名单
└── renderer/                    # React，无 node 权限
```

### 5.2 依赖规则（用 lint 强制，不靠自觉）

`dependency-cruiser` 三条禁令，违反即 CI 失败：

```jsonc
{
  "forbidden": [
    // core 不得知道任何外部世界
    { "name": "core-must-be-pure",
      "from": { "path": "^src/core" },
      "to": { "pathNot": "^src/core" } },

    // 适配器之间不得互相依赖
    { "name": "adapters-are-siblings",
      "from": { "path": "^src/adapters/([^/]+)" },
      "to": { "path": "^src/adapters/(?!$1)" } },

    // 渲染进程不得碰 node 与主进程
    { "name": "renderer-sandbox",
      "from": { "path": "^src/renderer" },
      "to": { "path": "^(src/main|src/adapters|node:)" } }
  ]
}
```

第一条是 Clean Architecture 的**全部要义**：`core` 一行外部 import 都不能有。做到这条，核心就天然可测、可移植、可换框架。

### 5.3 用例层很薄，这是对的

`app/collect.ts` 大概是这份文档里最短的文件：

```ts
export async function collect(deps: Deps, opts: CollectOpts): Promise<RunSummary> {
  const specs = deps.sources.enabled(opts.topicId)
  const results = await deps.fetcher.fetchAll(specs, opts.signal)

  // 失败不抛，只记录——降级是一等公民
  for (const r of results.failed) deps.logger.warn('source.failed', r.sourceId, r.error)

  const items = results.items
    .map(normalize)
    .reduce(absorb, emptyDedupeState())     // 去重（含跨天状态）
    .filter(notSeenRecently)
  const ranked = rank(items, deps.policy.rankingFor(opts.topicId))
  const selected = select(ranked, opts.maxItems)

  await deps.store.items.saveMany(selected)
  return summarize(results, selected)
}
```

它只做编排：**没有 if/else 业务分支，没有 IO 细节，没有错误处理逻辑**。所有"怎么做"都在被调用者里。

> 判断用例层是否写坏的信号：**它开始出现 `try/catch` 之外的业务判断**。一旦出现 `if (source.kind === 'youtube')`，说明抽象漏了。

---

## 六、关键决策记录（ADR）

深度决策要留痕，否则半年后没人知道为什么这样写。

### ADR-1：端口由 core 拥有，而不是 adapter 定义接口 ✅

- **选择**：`core/ports/*.ts` 定义接口；`adapters/*` 去实现它。
- **备选**：adapter 各自导出接口，core 依赖具体类型。
- **理由**：依赖倒置的全部意义在于"**接口的拥有者是被服务方**"。若接口由 adapter 拥有，换 adapter 就等于改 core。
- **代价**：adapter 要 `implements` 别人的接口，初次读代码会跳一次。

### ADR-2：简报同时产出 IR 与 markdown ✅

见 §4 接缝③。
- **代价**：多一层"从 markdown 解析出 IR"的代码（约 80 行，且必须容忍模型格式抖动）。
- **兜底**：解析失败时 IR 退化为"单段全文"，界面仍可读——**解析失败不能等于功能失败**。

### ADR-3：错误用 Result 类型，不跨边界抛异常 ✅

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

- **规则**：异常只用于"程序员写错了"（断言）；一切**可预期的失败**（网络、限流、解析失败、模型超时）走 Result。
- **理由**：一个源挂了不应该让整次采集抛栈；`try/catch` 层层包裹会让主干流程读不出来。
- **实测依据**：Python 版里 35 个源，每次都有 0–2 个失败，这是**常态而非异常**。

### ADR-4：打分是策略数据 + 版本号，不是硬编码 ✅

```ts
export interface RankingPolicy {
  version: number
  tierWeight: Record<1|2|3, number>
  halfLifeHours: number
  engagementScale: number
  signalWords: { term: string; weight: number }[]
  noiseWords: string[]
  typePenalty: Record<string, number>
}
```

- 入库时同时写 `score` 与 `formulaVersion`。
- **理由**：调权重是高频操作（我们已经调过 3 次：研究类降权、GitHub 噪声、YouTube 时间解析）。做成数据后可以 A/B、可以按主题不同、可以解释"这条为什么排第一"。
- **代价**：历史分数不可跨版本直接比较 → 所以记版本号，重算时才可解释。

### ADR-5：无 LLM 也能用，降级路径是一等公民 ✅

- `Composer` 返回 `{ok:false}` 时，用例层仍要产出一份"仅聚合"简报：按板块列出标题 + 来源 + 链接。
- **理由**：① 用户可能没配 key；② 模型限流/宕机；③ 用户可能只想看原始列表。
- **架构含义**：**渲染器不能假设 IR 一定完整**。`BriefDoc.highlights` 允许为空，`punchline` 允许为空。

### ADR-6：时间、随机数、网络全部可注入 ✅

```ts
export interface Clock { now(): Date }
export interface HttpClient { get(url: string, opts?: RequestOpts): Promise<Response> }
```

- **理由**：时效衰减（`exp(-age/20h)`）是打分的核心变量，测试必须能冻结时间；抓取器测试必须能回放 fixture 而不打真网。
- **收益**：所有"看起来要连网"的逻辑都能在 vitest 里 100ms 跑完。

### ADR-7：去重做成"有状态累加器"，不是纯函数 ✅

```ts
export interface DedupeState { seen: Map<string, number> }
export function absorb(state: DedupeState, item: Item): DedupeState
```

- **理由**：跨天去重（昨天讲过的今天不讲）和跨源合并（同一事件多来源）是同一个机制的两面。做成累加器后，两者共用一套代码。
- **备选被否**：纯函数 + 外部查库 → 每次都要 IO，且无法对"同批次内"和"历史"用同一套阈值。

### ADR-8：HTML 解析器是"命名插件"，不是 union 分支 ✅

- **反面**：`if (kind === 'anthropic') {...} else if (kind === 'github-trending') {...}`
- **正面**：`parsers.get(spec.parser ?? spec.kind)`，返回 `PageParser`。
- **理由**：每加一个 HTML 源就改一次核心 switch，是典型的"开闭原则"违反，且会让 `core` 知道具体站点。

---

## 七、变更预算（架构好坏的唯一硬指标）

架构的收益必须可量化。目标值：

| 变更 | 需改文件数 | 触碰 `core`？ |
|---|---|---|
| 加一个标准 RSS 源 | **1**（YAML） | 否 |
| 加一个结构特殊的 HTML 源 | **2**（parser + 注册） | 否 |
| 换 LLM 供应商 | **1**（新 adapter） | 否 |
| 调整排序权重 | **1**（policy 数据） | 否 |
| 改简报语气/版式 | **1**（prompt 文件） | 否 |
| 加一个界面页面 | **0 核心**（+ 若干 renderer 文件） | 否 |
| 加一个字段到 `Item` | **3–5**（domain + 迁移 + 视图） | **是**（付迁移成本） |

**读法**：前 6 行是日常，应该是零成本；最后一行是罕见但昂贵的——这正是"稳定核心"的定义：**它不常变，所以它变的时候值得花钱。**

---

## 八、测试策略（架构的验证手段）

| 层 | 手段 | 覆盖目标 |
|---|---|---|
| `core/pipeline` | 纯函数单测 + 属性测试 | 90%+ |
| 去重 | 属性：幂等、对称、传递 | 关键 |
| 抓取器 | **fixture 回放**（存真实 HTML/XML 快照） | 每个源 1 个 |
| store | 契约测试（同一套套件跑 sqlite 与内存实现） | 关键路径 |
| 打分 | **golden test 对照 Python 版**（差 > 0.1 失败） | 迁移期必备 |
| 用例层 | 用 fake ports 编排测试 | 主流程 |
| E2E | Playwright：启动 → 生成 → 阅读 → 导出 | 3 条冒烟 |

**属性测试的三个不变量**（这是去重模块真正的规格）：

```
1. 幂等：  absorb(absorb(s, x), x) === absorb(s, x)
2. 对称：  similar(a, b) === similar(b, a)
3. 传递：  a~b 且 b~c 在阈值内 → 三条应合并为一条（或明确说明不保证）
```

第 3 条要特别小心：模糊匹配**不满足**严格传递性，实现里必须显式选择"链式合并"还是"两两比较"，并把选择写进注释——这是未来 bug 的高发区。

---

## 九、这个设计会在哪里碎掉（诚实的边界）

架构不是越抽象越好，要提前说清楚哪里会撑不住：

| 未来需求 | 会击穿什么 | 届时怎么改 |
|---|---|---|
| 用 embedding 做语义去重 | `Dedupe.absorb` 是同步纯函数 → 需要异步 + 模型调用 | 把 `Dedupe` 拆成端口（`SimilarityFn`），同步实现保留为默认 |
| 多用户/云同步 | `store` 端口假设单写者 | 引入 outbox + 版本号；核心不动，`app` 层加同步用例 |
| 需要登录态的源（X cookie） | `HttpClient` 无凭据概念 | 加 `Secrets` 端口；仍然不碰 core |
| 简报要支持"追问"（对话） | 当前 `BriefDoc` 是静态的 | 新增 `Conversation` 用例，**不要**往 `BriefDoc` 里塞消息数组 |
| 主题从 1 个变 10 个 | `policyFor(topicId)` 已预留 | 基本无痛——这是提前埋对的点 |

**一条反向原则**：以上任何一个都**不要现在就抽象**。ADR-1 到 8 已经覆盖了当前确定的变更；为假设的需求预先抽象，就是浅模块化的开始。

---

## 十、代码风格约束（Clean Code 的具体化）

不抄清单，只写这条代码库里真正会被 review 卡住的六条：

1. **函数是"数据进、数据出"**。管线里的每个 stage 签名都是 `(Item[]) => Item[]` 或 `(State, Item) => State`。不允许 stage 里 `await store.save()`。
2. **命名用领域语言**。`Source / Item / Brief / Run / Probe / Policy`。禁止 `Manager / Helper / Util / Handler / Processor`。
3. **不为单一实现建接口**。只有三种情况允许 `interface`：① 有两个以上实现；② 测试需要 fake；③ 它是接缝（ports）。
4. **导出的符号越少越好**。一个文件一个主导出；其余保持模块私有。深模块的"深"体现在这里。
5. **不许出现 `any`**。边界处用 `unknown` + zod 解析，内部用具体类型。
6. **注释写"为什么"，不写"是什么"**。特别是阈值（0.86、20h、3 次失败）必须写清来历，否则半年后没人敢改。

---

## 附：落地顺序

架构不是一次性画完的，按"先证明最难的部分"排序：

1. **`core/domain` + `core/ports`**（1 天）——先定 `Item` 与六个接口，其余全部往后靠。
2. **`core/pipeline` + 属性测试**（2 天）——纯函数，不连网，最快拿到信心。
3. **golden test 对照 Python**（1 天）——移植正确性的唯一证明。
4. **`adapters/store/sqlite` + `better-sqlite3` 打通**（2 天）——最高风险项，早验。
5. **`adapters/sources` 9 类**（4 天）——有 fixture，一天 2–3 个。
6. **`app` 用例 + `adapters/llm`**（2 天）。
7. **`main` / `preload` / `renderer`**（后面按功能进度走）。

> 到第 6 步为止，**整个引擎可以在 Node 里跑通、可以单测、不依赖 Electron**。
> 这是这套架构最重要的验收标准：**如果去掉 Electron 整个核心就散了，说明它并没有真的分层。**
