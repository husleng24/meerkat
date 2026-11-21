# 账号与登录（Supabase Auth）

当前只做**身份**：邮箱注册/登录、GitHub OAuth、加密保存 session。

**跨设备同步还没有接入。** 登录成功后不会上传本地简报；同步需要下一步建服务端表、RLS 和同步协议。

## 为什么是 Supabase

- 邮箱密码、邮箱确认、OAuth 都有现成实现；
- Postgres + RLS 可以承接下一步同步；
- 开源，可自托管；
- 桌面端只需要 OIDC/OAuth 的标准流程。

## Supabase 配置

1. 新建 Supabase 项目；
2. Authentication → Providers → GitHub：
   - 填 GitHub OAuth App 的 Client ID / Secret；
   - 在 GitHub OAuth App 里把 Supabase 提供的 callback URL 配好；
3. Authentication → URL Configuration：
   - Site URL 可以是 `http://localhost:5173`（占位）；
   - **Redirect URLs** 加上：
     ```text
     meerkat://auth/callback
     ```
4. 决定邮箱确认：
   - 开启：注册后必须点邮件里的确认链接；
   - 关闭：注册后直接拿到 session。
5. 在 Meerkat：设置 → 账号 → 填 Project URL + anon key。

`anon key` 是公开客户端 key，可以放在本机；**不要**把 service_role key 放进应用。

## 桌面端流程

```text
渲染层点“GitHub 登录”
  → 主进程 supabase.auth.signInWithOAuth(skipBrowserRedirect)
  → 系统浏览器打开 GitHub
  → GitHub 回调 Supabase
  → Supabase 重定向 meerkat://auth/callback?code=…
  → Electron single-instance / open-url 收到 deep link
  → 主进程 exchangeCodeForSession
  → session 写入 safeStorage 加密文件
  → auth:changed 推送回界面
```

- 不用 Electron BrowserWindow 内嵌登录页；
- 不在渲染层保存 access token / refresh token；
- 自定义协议为 `meerkat://auth/callback`；
- Windows 由 app 注册协议，macOS 还需要 `electron-builder.yml` 的 `protocols`。

## 当前限制

- 没有忘记密码/重置密码 UI；
- 没有 MFA；
- 没有账号删除（需要服务端/service role 或 Edge Function）；
- 没有同步、订阅、设备管理；
- 自定义协议在开发态可能未注册成功，打包版更可靠；
- GitHub provider 未在 Supabase 控制台启用时，会明确返回 provider 错误。

## 下一步

```text
1. 确认 Supabase 项目可用
2. 邮箱注册/登录 + GitHub 登录端到端验收
3. 建 profiles / devices / sync_objects 表与 RLS
4. 选择同步协议：整库加密备份 or 行级增量同步
5. 账号中心：设备列表、退出所有设备、删除账号、导出
```
