# AGENTS.md

给在这个仓库里工作的编码代理（以及未来的自己）的约定。

## 提交信息用英文

**Commit messages are written in English.** Subject in imperative mood, body explains *why*.

```
fix: keep the brief visible when the window is restored from tray

The window was created hidden on autostart, so `restore()` ran before
the renderer finished loading and the brief never painted.
```

这条约束由 `.githooks/commit-msg` 强制：标题行含中文会被拒绝。启用方式：

```powershell
git config core.hooksPath .githooks
```

**其余一切仍然用中文**：代码注释、文档、界面文案、日志。这个产品的用户看中文，
把注释改成英文只会让代码和文档脱节。

## 提交前必做

```powershell
pnpm test       # 204 个测试
pnpm typecheck  # 两个 tsconfig 都要过
```

改了 UI 就截图看一眼，不要只信 typecheck。这个项目踩过两次"看起来写了但没验证"：
定时链路没日志、托盘导出是个死按钮。

## 三个会浪费你二十分钟的环境坑

1. **`ELECTRON_RUN_AS_NODE=1` 可能被注入 shell**——启动 Electron 前先
   `Remove-Item Env:\ELECTRON_RUN_AS_NODE`，否则跑起来的是纯 Node（报 `bad option: --no-sandbox`）。
2. **不要直接跑 `release\win-unpacked\Meerkat.exe`**——静默秒退，无窗口、无日志、
   事件日志无崩溃记录。装到用户目录再跑：
   ```powershell
   robocopy release\win-unpacked "$env:LOCALAPPDATA\Programs\Meerkat" /E
   ```
3. **`--no-sandbox` 会让托盘 `getBounds()` 返回 0**、`Notification.isSupported()` 返回 false。
   这两个指标是验收依据，别带这个参数去测。

## 架构红线

- `core/` 不 import 任何适配器；`app/` 只依赖 `core/` 的端口；`main/` 负责组装
- 仓储接口全部同步（better-sqlite3 是同步的，包成 async 只会制造假象）
- 同一份逻辑只能有一份实现：桌面应用的「立即采集」和 `scripts/run-once.ts` 走同一个
  `runCollect`，不要为脚本另写一份

## 不要提交

`data/`、`release/`、`out/`、`node_modules/`、`*.db`、密钥文件。`.gitignore` 已覆盖，
但 `git add -A` 之前扫一眼 `git status`。

密钥只在两处：`%APPDATA%\Meerkat\secret.bin`（DPAPI 加密）和环境变量。
**任何情况下不要把它写进仓库、日志或提交信息。**

## 文档在哪

| 文件 | 内容 |
|---|---|
| `README.md` | 能力、验收记录、怎么跑 |
| `PRODUCT.md` | 产品事实：用户、定位、约束（设计工作的前提） |
| `docs/VISUAL-WORLD.md` | 视觉规范：色值、对比度、版式规则 |
| `docs/VERIFICATION-RESULT.md` | 真机验收的原始记录 |
| `docs/TODO.md` | 待办，按"阻塞/未验证/功能缺口/工程债"分类 |
| `docs/FEEDBACK.md` | 反馈分级与修复流程 |
| `ARCHITECTURE.md` / `DESIGN.md` | 架构与功能设计 |
