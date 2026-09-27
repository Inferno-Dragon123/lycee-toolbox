# 卡组社区开发与维护

当前实现：邮箱验证码登录、主动公开发布、我的上传、名称/说明/卡牌编辑、下架/重新公开/删除、单卡推荐、独立预览、导入与恢复导入前草稿。浏览、预览和导入不要求登录。

## 数据与权限

- `toolbox_decks` 仍是匿名、不可变、按内容去重的分享快照，不代表作者归属。
- `toolbox_publications` 是独立发布记录。作者 ID 取自服务端验证的 Neon 会话；相同快照可以分别由不同用户发布。旧快照不会自动公开。
- `toolbox_publication_cards` 按基础卡号索引，合并同编号不同卡面的数量。实际组成保留完整卡号。
- 发布、编辑要求名称非空、卡号全部已收录、合计 60 张、说明不超过 2000 字符。这里只校验发布要求，不宣称比赛合法。
- 下架/删除隐藏发布记录，不撤销独立匿名分享链接或他人已经导入的副本。删除为软删除，旧快照保留。
- 写请求必须来自同源 JSON 请求，并在服务端重新验证会话、邮箱验证状态及所有权。`version` 防止多标签页覆盖。作者无法解除管理员下架。
- 每用户每小时最多 20 次发布、60 次管理操作，最多保留 200 条未删除发布；数据库计数不依赖单个 serverless 实例内存。
- 公开显示哈希生成的玩家编号，不公开邮箱。昵称编辑尚未加入。

## 登录与环境配置

前端使用 `@neondatabase/auth`，固定为 `0.5.0-beta`。服务端使用该包提供的 `@neondatabase/auth/server` 适配工具，通过同源 `/api/auth/*` 转发，SDK 负责会话 Cookie 的签名和改写。未引入 Next.js，不把令牌存入 localStorage。

只开放 `get-session`、`email-otp/send-verification-otp`、`sign-in/email-otp`、`sign-out` 路由。受保护操作逐次校验上游会话，关闭会话缓存读取。生产前仍需真实邮件收发验证。

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 对应环境的 Neon pooled 地址 |
| `DATABASE_URL_UNPOOLED` | 迁移、官网同步、开发集成测试；线上页面 API 不需要 |
| `NEON_AUTH_BASE_URL` | 同一 Neon 分支的 Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | 至少 32 字符的随机服务端密钥，各环境独立 |
| `COMMUNITY_ADMIN_IDS` | 可选，逗号分隔的 Neon 用户 ID，允许内容下架/恢复 |

Neon Auth 要开启邮箱登录并将站点 origin 加入可信域名。开发使用共享邮件服务；正式上线前配置自己的 SMTP。开发账户不等于生产账户。

开发分支：`dev-community-decks` / `br-misty-pond-b48ax8kf`，从 `dev-catalog-migration` 分出，项目 `gentle-paper-09879029`。`.env`、`.neon`、`.env.local` 为忽略文件，不提交凭据。

## 启动和接口

```powershell
npm ci
npm run db:migrate
npm run dev
```

`npm run build` 校验卡库并打包社区前端，`npm run dev` 自动先打包。`public/community.bundle.js` 为生成文件；修改社区前端后需重新构建或重启开发服务。

| 接口 | 用途 |
| --- | --- |
| `GET /api/community?page=1&source=community` | 公开列表，每页 20 条，source 可省略 |
| `GET /api/community?code=LO-6826-A` | 按基础卡号推荐 |
| `GET /api/community?mine=1` | 当前用户的未删除发布 |
| `GET /api/community?moderation=1` | 管理员列表，含管理下架记录 |
| `GET /api/community?id=p_…` | 详情；未知卡号列在 missing，禁止不完整导入 |
| `GET /api/community?session=1` | 最小化登录/验证/管理员状态，不返回邮箱 |
| `POST /api/community` | 发布 `{name,cards,description}` |
| `PATCH /api/community` | `{id,version,action}`，edit 另带完整 `{name,cards,description}` |
| `DELETE /api/community` | `{id,version}` 删除自己的发布 |

PATCH actions：`edit`、`publish`、`unpublish`，管理员另有 `hide`、`unhide`。

公开发布链接 `/?publication=p_…` 打开预览，不直接替换组卡器。原 `/?deck=d_…` 保留。

## 官网同步

```powershell
# 入库，默认近一年，请求间隔至少 10 秒
npm run decks:sync -- --limit 30 --pages 2
# 只校验，不入库
npm run decks:sync -- --dry-run --limit 2 --pages 1
# 补充指定卡号，异画自动归为基础编号
npm run decks:sync -- --code LO-6826-A --limit 10
# 单独收录已知 /d/?d= 链接
npm run decks:sync -- --id k0PjKL --limit 1
```

程序读取 robots.txt，遵循禁止路径及至少 10 秒间隔；失败不会删除已有卡组。只解析 `/deck/` 列表和 `/d/` 独立卡组，不访问被禁止的 `/card/deck_search.pl`，不解析官方博客中的多套配方文章。

来源区分官网赛事、官网玩家，以及手动链接但未确认类别的官网卡组。详情校验逐卡数量及总张数，按卡号发现的结果还核验实际成员。未进入本地卡库的完整编号保留，预览提示缺卡。

数据库保存分页位置和待同步队列；每次先从首页发现新投稿，再继续历史页。已收录记录每 7 天允许重查。失败项目移到队尾。每天有界批次逐步增加覆盖，不能视为全站全量数据。直连连接的 advisory lock 防止并发同步。

`.github/workflows/sync-official-decks.yml` 提供每日任务与手动入口。需代码进入 GitHub，并配置仓库 Secret `COMMUNITY_SYNC_DATABASE_URL` 为目标环境的 Neon **直连**地址。当前尚未提交/推送、未配置该 Secret，自动任务未启用。

## 验证

```powershell
npm test
# localhost:3100 开发服务和开发分支就绪后
node tests/community-live-smoke.js
```

SQL 测试使用 PGlite，覆盖独立归属、匿名/跨用户拒绝、异画索引、更新索引、下架删除、管理员状态、版本冲突、发布限额和官网列表解析。

真实会话测试仅允许 `NEON_BRANCH=dev-community-decks`，创建 `example.invalid` 临时用户，在开发分支将这些账户标为已验证，检查真实会话与应用权限，最后清理本次数据。**它不验证真实邮件送达或 OTP 输入。** 不能将测试初始化接入业务 API。

正式发布前仍需真实邮件登录验收、正式 SMTP、管理员 ID、确认官网覆盖范围，以及生产数据库/认证配置和部署。当前执行开发和预览验证。

## 接续状态（2026-09-28）

- 用户已授权尝试制作上述方案；未另外指定产品规则，当前按前次建议选择邮箱 OTP、60 张发布、单卡推荐、近一年官网赛事和玩家卡组。用户最新要求尽量节省测试 token，邮箱收信及验证码输入由其亲自测试。
- 工作目录 `C:\Users\35057\.codex\worktrees\a532\lycee-toolbox`，Git 为 detached HEAD `3892a4b`。既有卡库排序、官网补卡、自有检索/Neon 迁移仍全部未提交；不能把这些既有修改当作本轮新增或清理掉。
- `npm run build`、18 项 JS/SQL 测试、16 项 Python 测试通过。`tests/community-live-smoke.js` 最后完整通过真实会话、发布、编辑、越权拒绝、旧版本冲突、下架/公开、异画推荐、预览、导入、恢复草稿、桌面/手机无横向溢出和退出后的会话失效。
- 浏览器证据仅本机：`temp/community/verified-desktop.png`、`temp/community/verified-mobile.png`。早期 `failure.png` 属于已修复的测试选卡/DOM 时序问题，不代表最终结果。测试账户已清理，数据库当前留有 4 个官网样例：3 个官网玩家卡组和 `k0PjKL`（17 种、60 张）。
- 本地开发服务使用端口 3100；若进程不在，设置 `PORT=3100` 后运行 `npm run dev`。Windows 代理环境沿用 README 的配置；使用 Node SDK 访问 Auth 时另设置 `NODE_USE_ENV_PROXY=1`，这只是本地代理设置，不要写入 Vercel。
- 预览部署 URL `https://lycee-toolbox-hk2q8fqn5-inferno-dragon.vercel.app`，ID `dpl_8xZqemuvbc3wWw5NWaeQB5dmA5zM`。**BLOCKED，不能作为可用体验链接。** Vercel 返回 `TEAM_ACCESS_REQUIRED`：提交作者 `Lycee Toolbox <deploy@lycee-toolbox.local>` 不具备部署权限。应核实真实授权 Git 身份后按正常提交/部署流程处理，不绕过权限检查。
- Vercel Preview 已配置 `DATABASE_URL`、`NEON_AUTH_BASE_URL`、`NEON_AUTH_COOKIE_SECRET`，指向社区开发分支；对应预览 origin 已加入该分支 Auth 白名单。Production 未变。正式 SMTP、管理员 ID、GitHub 同步 Secret 均未配置；同步工作流未推送激活。
- 下一步先等待用户在本地页面验证真实邮箱登录/注册、刷新保持登录和退出，然后按反馈定点修复。现有测试通过，未改相关代码时不要重复全套验证。解决 Vercel 作者权限后再做一次云端构建和关键路由检查。上线正式站前仍需生产认证、数据库迁移与邮件服务配置。
- 交接评估：当前是可独立验收的本地初版，后续为用户体验与部署配置。进度保存在本文件和 README；没有新建接手对话，也没有将用户未验收的成果记作已验收。当前没有可靠宿主压缩计数/turn ID，不推测压缩次数。下次在真实压缩检查点或邮箱验收后的阶段切换重新评估。

### Git 发布接续（2026-09-28）

用户随后明确授权尝试 `git push`。已通过当前 Git 凭据向 GitHub `/user` 核实账号为 `Inferno-Dragon123`（ID `196516294`），本次提交使用该真实账号对应的 GitHub 隐私邮箱，替代旧提交的占位作者。工作分支为 `codex/community-decks`，推送目标同名远端分支以触发 Preview；不会推送到 `master`。此前“detached HEAD／未提交”描述为推送前检查点。邮箱实际收信和 OTP 输入仍交由用户验收，已通过的测试不重复运行。
