# 简报风格：主题级 PromptProfile

> 状态：P0 + P1 + P2 已实现（2026-11-23）。A/B 对比仍可继续做。

## 为什么

不同领域不该共用一份「AI 行业日报」提示词。时装、芯片、政策需要不同的选材标准和板块，
但硬规则（不编造、链接必须来自素材、传闻标注）不能交给用户改。

目标是把「核心积累」拆成三层：

```
PromptProfile     编辑判断与写法（可版本化、按主题绑定）
SelectionPolicy   窗口/条数/板块/信号词（P1）
OutputContract    必填段落/链接校验/条数上限（代码，不可绕过）
```

## 数据

```sql
prompt_profiles(
  id, name, version, system_md, created_at, updated_at
)
prompt_profile_versions(
  profile_id, version, system_md, created_at
)
topics.prompt_profile_id  -- 空 = 内置模板
```

- 内置模板：`resources/prompts/compose.zh.md`，只读
- 自定义：SQLite，保存即新版本，旧内容进 versions
- 删除自定义后，主题自动退回内置模板

## 变量

| 变量 | 含义 |
|---|---|
| `{topic}` | 主题名 |
| `{date}` | 简报日期 |
| `{weekday}` | 星期 |
| `{editorialFocus}` | 该主题的编辑重点 |

渲染在 `src/app/prompt-profile.ts`；未绑定主题时用内置模板。

## 代码路径

| 层 | 文件 |
|---|---|
| 解析/变量/检查 | `src/app/prompt-profile.ts` |
| 内置模板加载 | `src/main/prompts.ts` |
| 成稿使用 | `src/main/daily.ts` → `promptTextForTopic()` |
| 存储 | `src/adapters/store-sqlite/store.ts`（schema v17） |
| UI（提示词） | `src/renderer/src/components/PromptSettings.tsx` |
| 选材策略 | `src/app/selection-policy.ts` |
| UI（选材） | `src/renderer/src/components/SelectionPolicySettings.tsx` |

## UI

设置 → 简报风格：

- 下拉绑定内置或自定义 profile
- 内置只读；「复制为自定义」后可编辑
- 保存为新版本；历史版本可恢复
- 变量预览（用当前主题名/日期渲染）
- 缺 `{topic}` / `{editorialFocus}` / 三句话速览 / 链接约束时给警告，但不阻止保存

## 不可绕过

以下仍由代码校验，prompt 不能取消：

- 链接必须逐字来自素材（命中率 <85% 判失败）
- 统计/源健康度由程序追加
- 标题由程序规范化
- 输出条数、板块标签由程序约束

## P1：选材策略（已实现）

每个主题可配置：

| 字段 | 默认 | 作用 |
|---|---|---|
| `windowHours` | 48 | 回看窗口 |
| `maxItems` | 80 | 候选上限 |
| `targetMin/Max` | 15/24 | 注入 prompt 的目标条数 |
| `buckets` | 全部 | 参与选材的板块 |
| `boostKeywords` | 空 | 命中 +1.5 分 |
| `suppressKeywords` | 空 | 命中 −2.5 分 |

入口：设置 → 选材策略。策略存 `topics.selection_policy_json`（schema v18），
采集窗口、候选数、板块过滤、关键词加减分都在 `runDaily` / `recomposeDaily` 里生效。
目标条数与板块列表通过 `{targetMin}` `{targetMax}` `{bucketList}` 注入 prompt。

## P2：试跑与评测（已实现）

- **试跑**：设置 → 简报风格 →「试跑（最近素材）」；用主题最近窗口的素材走一遍成稿，
  不落库、不标记已读，预览完整 markdown
- **指标**：素材数、引用条目数、链接数、链接有效率、板块数、字数、是否截断、模型
- **人工评分**：1–5 星 + 备注；写入 `prompt_evaluations`
- **历史评测**：按主题列出最近 10 条，保存 profile 名称/版本与指标

API：`prompts:dryRun` / `prompts:evaluate` / `prompts:evaluations`。

## 还没做

- 两份 prompt A/B 同时试跑
- 基于历史评测的自动对比/趋势
- boost/suppress 词表的可视化编辑
