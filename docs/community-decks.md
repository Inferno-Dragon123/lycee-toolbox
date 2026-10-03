# 卡组社区开发与维护

## 待审核的卡组检索升级（2026-10-03）

预览分支将卡组推荐整合为「卡组检索」，增加类型／会社／属性多选、六项属性数量范围、构成标签、指定页和末页。维护规则及迁移见 [卡组检索说明](deck-search.md)。本次只在社区预览库执行 005，生产仍为原版本；下文已发布状态及历史记录用于旧版本维护。

## 当前发布状态（2026-09-29）

用户已授权合并到 `master`，并选择独立生产环境。生产使用现有 Neon `production` / `br-fancy-cloud-b4giop68`，已执行 001～004 迁移并启用独立 Auth；Vercel Production 使用该分支的数据库、Auth URL 和独立 Cookie 密钥。预览仍使用 `dev-community-decks`，账号与用户上传互相隔离。

生产初始化仅复制 105 套官网卡组（104 个去重快照、2062 条卡号索引）及官网同步进度，没有复制预览账号、用户投稿或其他测试快照。正式域名已加入生产 Auth 可信域名；当前沿用 Neon 共享 SMTP，自有 SMTP、正式邮件投递与验证码体验仍待维护者配置和亲测。

每日维护工作流改为 checkout/push `master`，官网同步使用新增的 `PRODUCTION_SYNC_DATABASE_URL`。原预览 Secret 保留，不再被正式定时任务使用。当前操作入口以 [README](../README.md) 为准；下方 2026-09-28 的接续记录保留作为历史，不能把其中「未合并／Production 未变」当作现状。

当前实现：邮箱验证码登录、自定义昵称、主动公开发布、我的上传、名称/说明/卡牌编辑、下架/重新公开/删除、多卡推荐、独立预览、导入与恢复导入前草稿。浏览、预览和导入不要求登录。

## 数据与权限

- `toolbox_decks` 仍是匿名、不可变、按内容去重的分享快照，不代表作者归属。
- `toolbox_publications` 是独立发布记录。作者 ID 取自服务端验证的 Neon 会话；相同快照可以分别由不同用户发布。旧快照不会自动公开。
- `toolbox_publication_cards` 按基础卡号索引，合并同编号不同卡面的数量。实际组成保留完整卡号。
- 发布、编辑要求名称非空、卡号全部已收录、合计 60 张、说明不超过 2000 字符。这里只校验发布要求，不宣称比赛合法。
- 下架/删除隐藏发布记录，不撤销独立匿名分享链接或他人已经导入的副本。删除为软删除，旧快照保留。
- 写请求必须来自同源 JSON 请求，并在服务端重新验证会话、邮箱验证状态及所有权。`version` 防止多标签页覆盖。作者无法解除管理员下架。
- 每用户每小时最多 20 次发布、60 次管理操作，最多保留 200 条未删除发布；数据库计数不依赖单个 serverless 实例内存。
- 昵称保存在 `toolbox_profiles`，1～24 个字符，允许重名；未设置时显示玩家编号。公开卡组动态读取作者最新昵称，同时保留固定玩家编号，不公开邮箱。改名每用户每小时最多 10 次，不影响归属或卡组更新时间。

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
| `GET /api/community?codes=LO-6826,LO-6690&match=all` | 多卡推荐，all 同时包含，any 任意包含；同编号异画去重，最多 10 种 |
| `GET /api/community?mine=1` | 当前用户的未删除发布 |
| `GET /api/community?moderation=1` | 管理员列表，含管理下架记录 |
| `GET /api/community?id=p_…` | 详情；未知卡号列在 missing，禁止不完整导入 |
| `GET /api/community?session=1` | 最小化登录/验证/管理员状态，不返回邮箱 |
| `POST /api/community` | 发布 `{name,cards,description}` |
| `PATCH /api/community` | `{id,version,action}`，edit 另带完整 `{name,cards,description}` |
| `DELETE /api/community` | `{id,version}` 删除自己的发布 |

PATCH actions：`edit`、`publish`、`unpublish`，管理员另有 `hide`、`unhide`。

`PATCH /api/community` 的 `{action:"profile", nickname:"昵称"}` 更新当前登录用户自己的昵称，客户端不能指定被修改用户。`GET ?session=1` 另返回本人的 `profile`，用于设置页和登录状态显示。

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

来源区分官网赛事、官网玩家；手动链接但未确认类别的卡组归入官网玩家，已确认的赛事不会被手动重抓降级。详情校验逐卡数量及总张数，按卡号发现的结果还核验实际成员。未进入本地卡库的完整编号保留，预览提示缺卡。

数据库保存分页位置和待同步队列；每次先从首页发现新投稿，再继续历史页。已收录记录每 7 天允许重查；内容未变时不重建卡号索引。失败项目移到队尾并按 1 小时起、最多 7 天的退避重试。每天有界批次逐步增加覆盖，不能视为全站全量数据。直连连接的 advisory lock 防止并发同步。

`.github/workflows/sync-official-decks.yml` 在默认 master 分支执行每日北京时间 04:20 的维护，先更新卡牌、补译并推送，再同步卡组。仓库 Secret `PRODUCTION_SYNC_DATABASE_URL` 使用生产库 Neon **直连**地址，`DEEPSEEK_API_KEY` 用于卡牌补译。代码及数据 checkout/push `master`。运行状态见 [GitHub Actions](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/workflows/sync-official-decks.yml)。

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

推送结果：功能提交 `1f264ef8b402208ddd3b6cc61dc358e88fcc7da7` 已在 `origin/codex/community-decks`。Git 自动部署 `dpl_998WuK4dS6w2mLmr3CCE4aEJe1gc` 为 READY，地址 `https://lycee-toolbox-9s7a89w21-inferno-dragon.vercel.app`。固定分支别名为 `https://lycee-toolbox-git-codex-community-decks-inferno-dragon.vercel.app`，两者均已加入 Neon 开发分支 Auth 可信域名。

仅补做了必要云端检查：公开列表返回 4 条且无错误，`/api/auth/get-session` 返回正常匿名会话 null。未发送测试邮件，未重复整套本地测试。最初 curl 因本机代理未配置而超时，设置终端 HTTPS_PROXY 后通过，不是线上功能故障。当前待办更新为：用户亲测邮箱收信/OTP、按反馈修复、再决定正式发布与官网同步启用。作者权限阻塞已解决，不再要求用户处理旧占位作者。

### 昵称与多卡推荐（2026-09-28）

用户追加授权自定义昵称、多卡检索和容量评估。已实现动态昵称关联、固定玩家编号、多卡 ALL/ANY 匹配、基础编号去重、10 种上限、可移除/清空的所选卡牌和批量卡号输入。`003_profiles.sql` 已应用到同一社区开发分支，生产未变。

验证只运行构建和 5 项相关测试（扩展昵称归属、旧发布改名、重名隔离、多卡匹配/去重/下架过滤），以及一次 `tests/community-ui-smoke.js`。该 UI 测试仅模拟身份/昵称传输，推荐查询用真实开发数据库，覆盖显示转义、多卡交集/并集、移除清空和手机布局；没有新建账户或发送邮件，也未重跑旧 PDF、爬虫等无关测试。

容量结果和复查方法见 [storage-capacity.md](storage-capacity.md)：项目指标 31.22 MiB，1 万套模拟卡组约 44～50 MiB，1 万个昵称资料约 2.06 MiB。模拟只在本地执行。下一步为推送同一功能分支、等预览构建完成后由用户体验昵称与多卡筛选；邮箱 OTP 仍由用户亲测。


### 卡牌补译与官网卡组维护（2026-09-28）

用户的新扩展位于原工作目录 `D:/Code/.vscode/lycee-toolbox`，不是当前社区 worktree。已将主脚本及其说明、测试接入社区分支并完善；原目录的所有未提交文件保持原状，避免覆盖用户的其他开发。

- 官网卡牌重新扫描 50 页、9,952 个编号，无新增；结构化 catalog 重建后内容无变化。
- 修复扩展未读取 `.env`、只翻译上次新增而漏历史缺译、结束才存进度、非原子写入、截断返回被接受、失败仍报成功等问题。
- 补译 369 个卡面后，中日文均为 9,954 条记录、9,952 个唯一编号；完整编号序列相同，数字倒序、后缀字母升序。旧中文记录逐条验证全部保留。
- 历史重复 LO-2333 / LO-0068A 保留不同 cid；不推断未知编号。新译文为 DeepSeek 机器翻译，结构检查通过，仍可人工审校。
- `scripts/README_update_and_translate.md` 为最新操作说明。默认不 Git 提交，`--push` 才提交；dry-run 不调用翻译 API。缓存与备份在被忽略的 temp/ 和 .json.bak 中。
- 官网卡组同步按页批量查询已有编号，支持 `--days 0` 扩展到全部历史、请求临时失败重试、持久队列退避与 JSON 运行报告。默认仍是最近 365 天的独立 `/d/` 卡组（官网用户投稿及赛事），不把攻略文章当作独立卡组。
- 工作流每日 UTC 20:20（北京时间次日 04:20），每次最多 100 卡组、3 个列表页；支持手动指定 limit/days，报告保留 7 天。新数据与重查逐日处理，不能把一个有界批次说成全站全量完成。
- 预览阶段工作流明确 checkout `codex/community-decks`。当时尚在等待用户选择是否启用；本轮后续用户已要求设置每日任务，当前启用状态以下文“每日自动维护”为准。
- 同时修复质量检查脚本全角术语漏检、异画能力子串重叠、翻译后的能力标记误报和空结果除零。本次 369 条新增译文通过术语/结构检查，报告在 `temp/lycee-official-update/alignment/quality-report.json`。
- 已通过构建、14 项相关 JavaScript/SQL 测试、16 项原爬虫测试、10 项翻译/质量检查回归测试；未发送测试邮件。
- 卡组同步操作：本地执行 `npm run decks:sync -- --limit 100 --pages 3`，使用社区开发库；每次结果保存到 `temp/community/official-sync-report.json`，数据库的 `toolbox_sync_state` 持续保存分页与待处理队列。中日文补译已结束，无后台翻译任务。
- 交接评估：已定位并解决两个工作目录的版本差异；当前仍在同一维护任务的同步与发布阶段，先收拢运行结果。没有可靠宿主压缩计数，不推测次数；下次检查点为同步/预览交付，或新的真实压缩事件。没有新建线程。


### 每日自动维护、来源合并与列表滚动（2026-09-28）

用户明确要求每天北京时间 04:20 自动执行卡牌抓取、翻译与上传，沿用同一工作流启用卡组同步。`.github/workflows/sync-official-decks.yml` 现在先执行 cards 作业，再执行 sync 作业，全局并发组避免重复运行同时访问官网。

- cards：Python 3.12、Node 24；重新抓取官网、补齐缺译、重建 catalog、构建验证，通过后仅提交三份卡牌 JSON 到 `codex/community-decks`。数据未变不创建提交，推送并发冲突直接失败，不强制覆盖。使用 Actions 临时 `GITHUB_TOKEN` 的 contents:write 权限，不保存个人 GitHub 访问令牌。
- `DEEPSEEK_API_KEY` 和 `COMMUNITY_SYNC_DATABASE_URL` 已保存为仓库加密 Secret，后者指向社区开发库。缓存只保存成功译文，不缓存密钥；失败时仍保存缓存，下次从缺译项继续。运行报告保留 7 天。
- sync：沿用每日最多 100 个卡组、3 个列表页、最近 365 天；在卡牌任务结束后抓取。卡牌任务失败不会强行提交部分数据，卡组任务仍可独立处理已有资料。
- 手动运行可选择 all/cards/decks；`validate_only` 仅对卡牌作业跳过实际爬取/翻译，验证配置、构建及 Git 推送权限，卡组作业仍按 limit 实际同步。定时运行不会启用此选项。
- 仅工作流文件同步到默认 master 分支以启用 schedule；应用和自动生成数据仍留在预览分支。GitHub schedule 是尽力调度，04:20 为触发计划，实际开始可能延后。
- `004_merge_official_source.sql` 已在社区开发库执行：旧 `official` 来源归入 `official_user`，保留原卡组 ID、名称、链接、版本及时间。旧 API 查询 source=official 兼容为官网玩家，新写入不再创建单独的 official 类别，已识别赛事不会被手动重抓降级。
- 公开卡组/推荐/我的上传共用的列表固定为 `min(560px, 65vh)` 高度，可滚动、键盘聚焦；分页按钮放在列表外，翻页和切换条件后重置滚动位置。
- 验证：构建、5 项相关 SQL/API 测试；临时轻量浏览器检查桌面和 390px 手机，验证 20 项分页、列表滚动、翻页/筛选复位、来源合并和无横向溢出。未发送邮件。


云端核验结果：工作流验证运行 [36424093665](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/runs/36424093665) 全部成功。cards 作业使用 validate_only 检查密钥存在、Linux 构建及 Git dry-run 推送权限，未重复爬取/付费翻译；sync 作业实际成功同步 1 个卡组、0 失败，持久队列余 80 个，第 3 页继续。完整卡牌抓取与翻译逻辑沿用上轮实际全库扫描和 369 卡补译验证，首次夜间 schedule 触发尚未发生。

默认分支仅新增工作流文件（提交 `91e9151`），应用功能提交 `a660f2d` 保留在预览分支。该应用 Preview 已 READY，固定入口 https://lycee-toolbox-git-codex-community-decks-inferno-dragon.vercel.app 。云端旧 source=official 查询确认返回官网玩家，开发库旧 official 来源剩 0 条。后续正式上线需同时调整工作流 checkout/push 分支和数据库 Secret，不能只合并页面代码就删除预览分支。

本阶段交接评估：实现、迁移、云端验证和发布均已收拢，无运行中的测试/爬虫，不需要新建接续线程。下一次在新增实质维护阶段或可靠压缩检查点再评估；没有可核验压缩次数，不推测计数。
