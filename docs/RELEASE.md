# 发版流程

产物由 GitHub Actions 出：`.github/workflows/release.yml` 在 `v*` tag 上跑
macos-14 与 windows-latest，测试通过后打包并附加到一个 **draft** release。

## 步骤

1. **改版本号**：`package.json` 的 `version`（如 `0.1.0`）。tag 必须与之一致。
2. **写发布说明**：新建 `docs/releases/v<版本>.md`，CI 用它作 release body。
3. **本地验证**（可选但推荐）：
   ```bash
   pnpm test && pnpm typecheck && pnpm build
   # macOS 出 dmg 需要 electron-builder 的 dmg-builder 二进制，国内要镜像
   CSC_IDENTITY_AUTO_DISCOVERY=false \
   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
   ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
   pnpm exec electron-builder --mac dmg --arm64 --publish never
   ```
4. **提交并打 tag**：
   ```bash
   git commit -am "chore: release v0.1.0"
   git tag -a v0.1.0 -m "Meerkat 0.1.0"
   git push origin main v0.1.0
   ```
   > 注意：改到 `.github/workflows/**` 时，https 的 OAuth token 会因缺 `workflow` scope 被拒；
   > 改用 SSH 推：
   > `GIT_SSH_COMMAND='ssh -o ProxyCommand="nc -X connect -x 127.0.0.1:7890 %h %p" -p 443' git push git@ssh.github.com:husleng24/meerkat.git main v0.1.0`
5. **等 CI**：`gh run watch`（国内需要 `HTTPS_PROXY=http://127.0.0.1:7890`）。
6. **检查 draft release**：四个产物 + 说明是否齐全。
7. **发布**：`gh release edit v0.1.0 --draft=false`。

## 产物

| 平台 | 目标 | 文件名 |
|---|---|---|
| macOS arm64 | dmg | `Meerkat-<版本>-arm64.dmg` |
| macOS x64 | dmg | `Meerkat-<版本>-x64.dmg` |
| Windows | nsis | `Meerkat-<版本>-x64.exe` |
| Windows | portable | `Meerkat-<版本>-portable.exe` |

## 签名

两个平台都是**未签名**：macOS 首次打开要右键「打开」，Windows SmartScreen 要选「仍要运行」。
接签名需要另外配置证书与 `CSC_LINK` / `WIN_CSC_LINK`。

## 本机打包的已知限制

- Windows NSIS 在本机（Windows 开发机）因实时防护会失败，CI 上正常
- macOS 的 dmg 需要 `dmg-builder` 二进制，国内要设 `ELECTRON_BUILDER_BINARIES_MIRROR`
- 不要用 `--publish always` 在本机发版：CI 是唯一出包入口

## 更新检查的前提

应用通过 `https://api.github.com/repos/husleng24/meerkat/releases/latest` 判断有没有新版本，
这是**匿名请求**：

- **仓库必须是 public**。private 仓库匿名访问会返回 404，应用只会显示"找不到 Release"
- Release 必须是**已发布**状态，draft 不会被 `/releases/latest` 返回
- 未认证请求限流 60 次/小时；应用 24 小时内最多查一次
- 国内访问 api.github.com 可能失败，应用会静默跳过，不影响使用

## macOS 签名（重要）

没有证书时 `electron-builder` 默认**不签名**，产物只剩 linker 签名，在 macOS 15+ 上
从 Finder 双击启动会被 AMFI 拒绝（`Unrecoverable CT signature issue`），进程直接退出。

现在配置为 **ad-hoc 签名**（`mac.identity: "-"`）+ 关闭库校验的 entitlements
（`build/entitlements.mac.plist`），构建更接近可用状态；但在本机 macOS 15.7.9 上
LaunchServices 启动仍会被 AMFI 拒绝，只有直接执行二进制才能启动。

**结论：macOS 要分发给普通用户，必须用 Apple Developer ID 证书签名并公证**
（需要 Apple Developer 账号）。在那之前，macOS 包只适合开发者本机使用。

