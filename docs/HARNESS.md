# 本机 Agent Harness：扫描、评估与接入方案

> 状态：**暂缓**（2026-11-01 决定）。当前只支持「API Key」方式接入模型；
> 本机 Agent 的扫描与接入未排期，本文仅作为调研与方案存档。
> 实测时间 2026-11-01，机器为 macOS arm64。
> 问题：除了填 API Key，能不能扫描本机已装的 agent harness（codex / claude / dsh…），
> 扫到之后直接「全项使用」？

---

## 一、先看实测：这台机器上有什么

| Harness | 是否安装 | 登录态 | 非交互入口 | 实测结果 |
|---|---|---|---|---|
| **Codex CLI** `0.157.1` | ✅ `/opt/homebrew/bin/codex` | ✅ `Logged in using ChatGPT` | `codex exec --skip-git-repo-check -s read-only "<prompt>"` | 能出结果，但**一句「只回复两个字」耗时 119 秒**（首 token 118s） |
| **Claude Code** `1.0.35` | ✅ `/opt/homebrew/bin/claude` | ❌ 未登录 | `claude -p "<prompt>" --output-format json` | 返回 `Invalid API key · Please run /login`——**装了 ≠ 能用** |
| **DSH（DeepSeek Harness）** | ✅ 应用 + `~/.dsh/` | ✅ `~/.dsh/.credentials.yaml` | 无 CLI | 只能读凭据文件里的 DeepSeek key（**已经接入**） |
| **Ollama** | 数据目录存在（`~/.ollama/models`） | — | `localhost:11434` HTTP | 服务未运行，CLI 不在 PATH |

两个直接结论：

1. **「装了」和「能用」是两件事**。claude 装得很完整，但登录态缺失，任何调用都会失败。
2. **「能用」和「好用」也是两件事**。codex 确实能用，但 2 分钟的首字延迟，放在一个"边读边问"的浮层里是灾难。

---

## 二、把「扫描到就直接全项使用」拆成三件事

### ① 扫描安装：可行，成本极低

判定依据（全部只读）：

- PATH 上有没有可执行文件（`command -v codex`）
- 版本探测（`codex --version`，2 秒超时）
- 配置/凭据目录是否存在（`~/.codex`、`~/.claude`、`~/.dsh`、`~/.ollama`）
- 登录态（`codex login status`；claude 只能靠一次轻量调用或读其配置）

### ② 复用它的凭据直接打厂商 API：**不建议，多数也做不到**

- Codex 用的是 **ChatGPT 登录态**（OAuth 类），不是 API key：短期、绑定设备/客户端，读出来调用属于灰色地带，且随时失效
- Claude Code 同理：OAuth 令牌 + 组织策略，抄出来等于绕过它的客户端
- 唯一本来就是明文 key 的是 **DSH 的 `~/.dsh/.credentials.yaml`**——这也正是我们当前已经支持的那条路
- 结论：**不要做凭据搬运**。既脆（一升级就废），又不体面（绕过厂商的授权模型）

### ③ 把 harness 当 provider，调它的**非交互 CLI**：可行，但要付"延迟税"

这是唯一既合法又可持续的接法：用用户自己的订阅与配额，通过厂商自己的客户端执行。

- `claude -p --output-format json` / `codex exec --json` 都能拿结构化输出
- 代价：**进程冷启动 + agent 编排开销**。实测 codex 119 秒；claude 因为未登录无法测，但其 CLI 冷启动通常在 2–5 秒量级
- 附带风险：这些 CLI 默认是**会动手的 agent**（读写文件、跑命令），必须显式收窄权限

---

## 三、方案：Harness as Provider

### 3.1 分层

```
core/harness/detect.ts     纯函数：给定探测结果 → HarnessInfo[]（可单测）
main/harness/probe.ts      真实探测：existsSync / execFile(版本) / login status
main/harness/provider.ts   HarnessProvider implements ChatProvider（spawn 子进程）
renderer Settings          列出检测结果 + 显式开启 + 测试按钮
```

### 3.2 检测结果长什么样

```ts
interface HarnessInfo {
  id: 'codex' | 'claude' | 'dsh' | 'ollama'
  label: string
  kind: 'cli' | 'local-server' | 'credentials'
  installed: boolean
  version?: string
  /** 已登录 / 服务在跑 / 凭据可读 */
  ready: boolean
  /** 为什么不可用，直接给用户看 */
  reason?: string
  /** 预估延迟档位：fast(<5s) / slow(>60s) */
  speed: 'fast' | 'slow' | 'unknown'
}
```

**`installed` 与 `ready` 必须分开**：claude 的实测就是"装了但没登录"，界面上要能直接说清。

### 3.3 运行时的硬约束（缺一不可）

| 约束 | 做法 | 为什么 |
|---|---|---|
| 只读 | codex `-s read-only`、`--skip-git-repo-check`；claude `--allowedTools ""`（或等价的最小集合） | 聊天不该有副作用 |
| 不用危险开关 | **绝不**传 `--dangerously-bypass-approvals-and-sandbox` / `--dangerously-skip-permissions` | 一行代码就能让模型在你仓库里为所欲为 |
| 超时 | 默认 180s，可取消（kill 子进程组） | codex 实测 119s，超时值不能按 HTTP 的习惯设 |
| 输出上限 | 读取上限 256KB，超出截断 | 防止把整份会话日志读进内存 |
| 不出现在默认路径 | 默认关闭，只作"深度任务"的可选项 | 2 分钟延迟不能塞进默认聊天 |
| 内容提示 | 首次启用时明确告知：内容会发给对应厂商 | 隐私边界要写在用户点按钮之前 |
| 不在 PATH 里猜 | 只认白名单里的可执行名，不执行任意路径 | 避免被同名恶意二进制劫持 |

### 3.4 它适合做什么、不适合做什么

| 适合 | 不适合 |
|---|---|
| 「把今天这期按重要性重排，输出完整 markdown」（长任务、可等 1–2 分钟） | 默认的"这期讲了什么"问答（要 2 分钟不如直接用 DeepSeek） |
| 「对比本周所有简报，写一段趋势判断」 | 高频、短问短答 |
| 需要更强模型但用户没有 API key 时 | 需要流式输出的场景（CLI 的流式输出是行缓冲，不好接） |

### 3.5 与现有 provider 的关系

- 复用 `ChatProvider` 端口，新增一种实现：`HarnessProvider`（`spawn` 而非 `fetch`）
- 在模型目录里单独分组，标签写明「本机 Agent · 慢 · 用你的订阅额度」
- 成稿（compose）**不要**走 harness：一跑就是两分钟起，且失败模式不可控

---

## 四、风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| 凭据合规 | 读 OAuth 令牌违反厂商授权模型 | 不做；只走官方 CLI |
| 隐私 | 简报内容会进入第三方客户端与其日志 | 首次启用必须显式确认；设置页常驻说明 |
| 子进程逃逸 | agent 可能执行命令、写文件 | 只读沙箱 + 最小工具集 + 独立工作目录 |
| 输出格式漂移 | CLI 的 `--json` 结构随版本变 | 解析失败时降级为纯文本 + 记录版本号 |
| 登录过期 | 表现为"突然不能用了" | 检测结果里保留 `ready/reason`，失败时提示重新登录 |
| 配额 | 走用户的 ChatGPT/Claude 订阅额度 | 界面标注；不自动重试，避免连续烧额度 |
| 进程泄漏 | 超时/取消没杀干净 | kill 进程组 + 启动时登记，退出时兜底清理 |

---

## 五、分阶段

| 阶段 | 内容 | 风险 | 预估 |
|---|---|---|---|
| **P0** | 只做**检测与展示**：设置页列出本机 Agent 的 installed / ready / version / 原因 | 零（只读） | 半天 |
| **P1** | `HarnessProvider`（先接 Codex，只读 + 超时 + 取消），默认关闭，只允许"深度任务" | 中（子进程） | 1 天 |
| **P2** | Claude Code（需用户先 `/login`）、Ollama 本地 HTTP（服务在跑时） | 低 | 各半天 |
| **P3** | 若 DSH 暴露 CLI，再接；否则维持"凭据来源"角色 | 低 | 待定 |

---

## 六、不做什么

- ❌ 不读取/搬运 Codex、Claude 的登录令牌
- ❌ 不把 harness 作为默认聊天后端（延迟不允许）
- ❌ 不传任何 `--dangerously-*`、不在用户仓库里跑 agent
- ❌ 不让 harness 参与成稿（`runDaily` 的稳定性优先）

---

## 七、结论

**"扫描安装"值得做，成本极低、体验直观；"扫到就直接全项使用"不建议——但可以退一步做得更好：**

> 把本机 Agent 当成**可选的重型 provider**，用它们自己的非交互入口执行，
> 明确告知延迟与隐私代价，默认关闭，只在"愿意等两分钟"的任务里出现。

这台机器的实测正好说明了为什么：claude **装了但没登录**，codex **能用但两分钟**。
把这两件事在界面上说清楚，比假装"一键全项使用"诚实得多。
