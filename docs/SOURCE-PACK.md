# 源配置包（source pack）

> 状态：已实现（2026-11-12）。
> 目标：把「一组源 + 主题归属」变成可导出、可分享、可复用的 JSON，换机或扩展新主题时不用逐条点。

## 一、入口

源页顶部有三个动作：

- **导出当前主题**：只包含当前主题、它收录的源、所属领域；
- **导出全部**：全部源、全部主题、全部领域；
- **导入配置**：选一个 JSON 文件，先出预览，确认后才写库。

导出走系统保存对话框，默认目录 `文档/Meerkat/`，文件名 `meerkat-sources-<主题 id|all>-<日期>.json`。

## 二、格式

```json
{
  "format": "meerkat/source-pack",
  "version": 1,
  "exportedAt": "2026-11-12T15:36:00.000Z",
  "domains": [{ "id": "ai", "name": "AI" }],
  "topics": [
    {
      "id": "robotics",
      "name": "机器人",
      "domainId": "ai",
      "enabled": true,
      "focus": "只保留机器人公司的融资、裁员与产品发布；论文只取 cs.RO",
      "sources": ["arxiv-org-api", "therobotreport-com-feed"]
    }
  ],
  "sources": [
    {
      "id": "arxiv-org-api",
      "name": "arXiv cs.RO",
      "kind": "rss",
      "url": "https://export.arxiv.org/api/query?search_query=cat:cs.RO&max_results=20",
      "tier": 2,
      "bucketHint": "research",
      "enabled": true
    }
  ]
}
```

### 故意不包含

| 字段 | 原因 |
|---|---|
| `hour` / `minute` / 排程开关 | 排程是个人习惯；导入时保留本机值，新主题用默认 08:30 |
| `failStreak` / `lastOkAt` / `avgMs` | 本机运行状态，不是配置 |
| 已读 / 收藏 / 简报 | 不属于源配置 |

### source 字段

必填：`id`、`name`、`kind`、`tier`（1–3）、`bucketHint`（见 `core/domain/types.ts` 的 `BUCKET_LABEL`）。
可选：`url`、`channelId`、`parser`、`windowHours`、`alwaysKeep`、`insecure`、`enabled`。
`kind` 支持 `rss` / `atom` / `arxiv` / `hn` / `youtube` / `github-trending` / `hfpapers` / `anthropic` / `html`。

### topic 字段

`id`、`name`、`domainId`、`sources`（源 id 数组）；`enabled` 可选。主题引用的每个源必须出现在同一包的 `sources` 里。
`focus` 可选，是该主题的编辑重点（最多 200 字）；只影响选题与解读，不改变简报格式，导入时随同名主题一起覆盖。

## 三、导入规则：覆盖同名

1. **领域**：按 `id`，其次按名称匹配；存在则更新名称，不存在则新建。
2. **源**：按 `id` → 规范化 URL → 名称匹配；
   - 命中：更新名称/URL/kind/tier/bucket 等元数据，**保留本机健康度**（`failStreak`、`lastOkAt` 等）；
   - 未命中：新建。
3. **主题**：按 `id`，其次按名称匹配；
   - 命中：更新名称/领域/启用状态，**源归属整组替换**为包里的列表，**保留本机排程**；
   - 未命中：新建，排程默认 08:30。
4. **不删除**：包里没有的源/主题/领域保持不动。
5. **原子性**：整个导入在一个 SQLite 事务里，失败回滚，不会留下半套数据。

预览会列出每一项是「新增」还是「覆盖」，确认后才执行。

## 四、校验与限制

- `format` 必须是 `meerkat/source-pack`，`version` 必须是 `1`；
- 文件不超过 2 MB；源 ≤ 500、主题 ≤ 100、领域 ≤ 50；
- 包内 id/名称/URL 不能重复，主题不能引用不存在的源；
- URL 必须是 `http(s)`；
- 未知字段忽略（为未来版本留余地），但版本号不匹配直接拒绝。

## 五、示例：机器人主题

当前真实导出的精简版：

```json
{
  "format": "meerkat/source-pack",
  "version": 1,
  "domains": [{ "id": "ai", "name": "AI" }],
  "topics": [
    {
      "id": "robotics",
      "name": "机器人",
      "domainId": "ai",
      "sources": [
        "arxiv-org-api",
        "therobotreport-com-feed",
        "robohub-org-feed",
        "ieee-org-feeds",
        "nvidia-com-blog",
        "ros-org-latestrss",
        "reddit-com-r"
      ]
    }
  ],
  "sources": [
    {
      "id": "arxiv-org-api",
      "name": "arXiv cs.RO",
      "kind": "rss",
      "url": "https://export.arxiv.org/api/query?search_query=cat:cs.RO&max_results=20",
      "tier": 2,
      "bucketHint": "research"
    }
  ]
}
```

把这份文件发给另一台机器，导入后源、主题、归属一次到位；排程仍是那台机器自己的 08:30。

## 六、以后扩展

- 新源类型（如 MCP / LSP / 站点专用 API）：加 `kind` 与新可选字段，`version` 升到 2，导入器保留对 v1 的读取；
- 如果要做「配置即代码」：可以让启动时读取一个固定路径的 pack 并走同一个 `applyImport`，但那是下一步，不在当前实现里。
