# Lycee Overture 工具箱

站点：https://lycee-toolbox.top/ 。静态 HTML/JavaScript + Vercel Node API，卡牌来自仓库最终 JSON，卡组保存使用 Neon PostgreSQL。

## 当前改造状态

2026-09-28：卡组社区初版已完成本地验证，新增邮箱登录、主动发布和管理、按单卡推荐、预览导入及官网增量同步。使用独立 Neon 分支 `dev-community-decks`（`br-misty-pond-b48ax8kf`），迁移 `002_community.sql` 已应用。维护和接续入口见 [docs/community-decks.md](docs/community-decks.md)。下方 2026-09-25 记录属于上一阶段，不包含本次社区功能。

本轮构建、18 项 JavaScript/SQL 测试、16 项 Python 测试及真实 Neon 会话浏览器测试通过；临时测试账户已清理。邮箱真实收信与 OTP 输入交给用户亲自验收，不重复自动测试。当前本地入口为 `http://localhost:3100/`。

Git 推送已成功：功能分支 `codex/community-decks`，功能提交 `1f264ef`，使用已核实的 `Inferno-Dragon123` GitHub 身份。Git 自动触发的 Vercel 部署 `dpl_998WuK4dS6w2mLmr3CCE4aEJe1gc` 已为 READY，云端公开列表返回 4 个官网样例，同源登录路由返回正常匿名会话。可使用[社区测试版](https://lycee-toolbox-9s7a89w21-inferno-dragon.vercel.app)（保留 Vercel 预览访问保护），邮箱收信和验证码登录由用户亲自验收。Preview 使用社区开发分支的数据库和 Auth；未改 Production、未合并到 master。

此前直接 CLI 部署 `dpl_8xZqemuvbc3wWw5NWaeQB5dmA5zM` 因旧提交作者为占位邮箱而被置为 `BLOCKED / TEAM_ACCESS_REQUIRED`。已通过真实账号提交并正常 Git 推送解决；旧的 blocked URL 不再作为测试入口。

2026-09-25：本地已切换到自有卡库；Neon 项目 `lycee-toolbox`（`gentle-paper-09879029`）的 `dev-catalog-migration` 分支已建表。生产数据库尚未迁移，代码尚未提交或推送；已部署并验证独立 Preview，正式域名仍运行旧版。首次接手的历史架构与实验文件说明保存在 [docs/initial-project-review.md](docs/initial-project-review.md)，其中“当前”指改造前。

## 数据与请求链路

- `lycee-japanese-database-final.json`：9,954 条日文记录，9,952 个唯一完整卡号。
- `lycee-chinese-database-final.json`：9,585 条中文记录，9,583 个唯一完整卡号。**字段 `japaneseText` 实际保存中文译文**，保留现有格式。
- `data/catalog.json`：官网结构化资料（名称、卡图、属性、费用、数值、类别、版本、稀有度、类型、画师及额外团队能力），9,952 个唯一卡号。
- `lib/catalog.js`：服务端首次加载上述三份文件，按完整卡号合并并建立内存索引；命中中文库显示中文，未翻译的 369 张卡面显示日文，不在线调用 DeepSeek。
- 正式页面检索、组卡、TTS/PDF、分享链接均使用本站接口。卡图仍依赖 Lycee 官网。只有显式导入萌卡社旧链接时才调用其 `showDeck`。
- 卡号按数字倒序，同编号无后缀在前、字母后缀升序。保留 `LO-0001A` 和 `LO-6826-A` 等来源中的完整写法，不根据数字缺号推测卡牌，不合并异画。
- 两个最终库中已有的重复记录（`LO-2333`、`LO-0068A`）保留；运行时按完整 code 建 Map，后出现的记录优先。

## 启动与测试

```powershell
npm install
npm run build
npm run dev
```

打开 http://localhost:3000/ 。开发服务只监听本机，复用与 Vercel 相同的 API handler。修改服务端模块后需重启服务。未配置 Neon 时仍可搜索、组卡、恢复本机草稿及导出文件；云端保存会明确提示未配置。

```powershell
npm test
npm run test:python
# 以下需先运行本地开发服务，并连接 Neon 开发分支，会保存“开发验证 WP日”测试卡组：
node tests/browser-smoke.js
```

本机若使用 Windows 系统代理而 Node 无法访问官网，可仅为当前终端配置代理后启动：

```powershell
$env:HTTPS_PROXY = python -c "import urllib.request; print(urllib.request.getproxies().get('https',''))"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = 'localhost,127.0.0.1'
npm run dev
```

这些代理配置只用于本地，不要复制到 Vercel 环境变量。

## 页面、API 与卡组

| 入口 | 用途 |
| --- | --- |
| `public/index.html` / `public/app.js` | 原有页面样式、筛选、分页、组卡、本机草稿、文件导入导出 |
| `public/deck-format.js` | 浏览器与服务端共享卡号排序、卡组校验、链接识别、TTS 生成 |
| `GET /api/cards?facets=1` | 自有筛选选项 |
| `GET /api/cards?q=关键词&code=LO-6826&page=1&limit=30` | 中日文检索；支持属性、类别、稀有度、版本、作品简称、EX、效果、类型、画师、费用/AP/DP/SP/DMG 上下限 |
| `GET /api/cards?codes=LO-6826,LO-6826-A` | 精确批量读取，存在未知卡号时整批报错 |
| `POST /api/decks` | 验证并保存不可变卡组快照，返回新 ID；相同内容复用已有 ID |
| `GET /api/decks?id=d_…` | 读取本站快照及自有卡牌资料 |
| `GET /api/import-deck?type=official&id=k0PjKL` | 直接读取 Lycee 官网卡组，校验逐卡数量及官网总数，再匹配本地完整卡号 |
| `GET /api/import-deck?type=legacy&id=…` | 萌卡社旧卡组兼容导入；仍依赖其服务在线 |
| `POST /api/generate-pdf` | 按卡号从服务端取名称和效果，PDFKit + 本地中文字体生成 A4 卡表 |
| `GET /api/image-proxy?url=…` | 官方卡图代理，限制协议与准确域名，禁止跳转 |

卡组文件与保存请求：

```json
{
  "schemaVersion": 1,
  "name": "我的卡组",
  "cards": { "LO-6826": 4, "LO-6826-A": 1 }
}
```

新分享链接为 `https://lycee-toolbox.top/?deck=d_…`。保留旧站 `?id=…`、萌卡社卡组链接、官网 `https://lycee-tcg.com/d/?d=k0PjKL` 及 `https://lyc.ee/dk0PjKL` 导入。

匿名分享仍无需登录：持有链接者可读取，编辑后保存得到另一个快照。本机草稿使用 localStorage；卡组社区另行增加用户发布记录及管理权限，详见社区文档。为限制请求体，匿名保存的单卡数量为 1～60、总卡数最多 200、名称最多 100 字符；公开发布要求合计 60 张。这些是工具容量和发布限制，不是比赛合法性检查。未知卡号、部分解析失败不会被静默跳过。

PDF 内嵌图片按打印尺寸压缩，最多四路并发、总下载等待 18 秒；坏图以文字占位并在页面提示。长效果自动跨页，页脚显示页码。超过 4 MiB 时明确报错。网页请求设置 `Accept: application/octet-stream`，服务端以二进制响应，浏览器再生成 PDF 下载，避免部分下载管理器截获直接 PDF 响应；其他请求仍返回 `application/pdf`。

## Neon 配置与迁移

Neon CLI 和 `neon` / `neon-postgres` 技能已通过官方仓库安装。工作区 `.neon` 与所有 `.env*` 均被 Git 忽略，不要提交连接字符串。当前 `.env` 使用开发分支，保留原来的历史环境变量。

服务端环境变量：

- `DATABASE_URL`：应用连接字符串，使用 Neon pooled 地址；仅服务端可见。
- `DATABASE_URL_UNPOOLED`：直连地址，只用于执行数据库迁移。

使用 `pg` 连接池，Vercel 中通过 `@vercel/functions` 的 `attachDatabasePool` 管理空闲连接；配置启用 Fluid compute。

```powershell
# 先确认 .neon / .env 指向希望操作的开发分支
npm run db:migrate
```

迁移保存在 `migrations/001_decks.sql`，脚本按 `toolbox_migrations` 记录执行，事务与锁防止重复应用。保存 SQL 参数化，分享 ID 使用 128 位随机数；`content_hash` 唯一约束防止相同卡组重复占用存储。正常请求不会自动建表或执行迁移。

## 生产发布步骤（尚未执行）

1. 在开发分支完成验证并检查 `neon diff`。
2. 为 Neon `production` 获取单独的直连环境文件；确认变量确实指向生产分支后执行 `node --env-file=.env.production scripts/migrate.js`。不要把开发分支的连接当成生产连接。
3. 在 Vercel 项目的 Production 环境设置生产分支的 pooled `DATABASE_URL`。Preview 若使用开发分支，应设置独立的 Preview 环境值。运行时不需要迁移用直连变量。
4. 提交代码、三个卡库文件、依赖锁文件及迁移，部署后验证官网示例导入、保存分享、PDF/TTS。`vercel.json` 指定 `npm run build`、静态目录 `public`、函数最长 60 秒及卡库/字体打包。

Vercel 项目实际名称为 `lycee-toolbox`（本地关联文件中的旧名 `translate` 已刷新）。已配置 Preview 环境的敏感变量 `DATABASE_URL`，指向 Neon 开发分支；Production 尚未配置。Windows 本地 `vercel build` 遇到 CLI 启动 `cmd.exe` 的问题，已通过 Vercel 云端 Linux 构建验证，无需修改生产构建命令。

## 新卡与中文更新

完整扫描并补入官网实际存在的新卡，同时更新检索元数据：

```powershell
python scripts/update_japanese_database.py --catalog
```

网络中断可 `--resume --catalog` 继续当前扫描；隔一段时间检查新卡必须重新扫描，不使用旧断点。只想预览新增记录可先 `--dry-run`，核对后 `--resume --catalog` 合并。

原始页面、校验和、报告与备份在被忽略的 `temp/lycee-official-update/` 中。程序等所有分页成功才合并日文库，保留原有记录，按完整卡号增加旧特典卡及异画。每次请求间隔至少 10 秒。

已有完整页面快照时可独立执行 `npm run catalog:build`，无需网络。构建器要求官网快照与最终日文库卡号集合一致；缺页、字段变化、未知数值或缺失图片会中止。如果官网下架旧卡导致集合变化，应人工核对并决定元数据保留方式，不能删除最终库记录以绕过检查。

新增卡离线翻译后，将中文效果按完整 code 合并到最终中文 JSON；中文更新无需再爬官网，运行 `npm run build` 并重新部署即可。`generatedAt` 是历史字段，不代表精确最后更新时间。历史 DeepSeek 批处理脚本不追溯、不重建、不重新翻译全库。

**勘误边界：** 当前扫描仅增加新卡，不覆盖已收录卡牌的日文效果；官网对旧卡修改效果时仍需单独核对更新日文及中文。结构化资料使用此次官网快照。

## 历史文件与已知边界

旧在线翻译、Redis 导入/清理、管理员统计页面、`api/lo-proxy.js` 等实验入口暂时保留，正式页面不再调用。当前改造没有清理历史 Redis 或使用 DeepSeek。不要把旧指南当作正式更新流程。

初次接手记录的既有事项仍需单独处理：规则 PDF 链接对应的静态文件缺失；历史测试文件中的硬编码凭据；旧实验 API 的开放状态。详细背景见历史交接文档。本次没有改动这些不属于数据源迁移的功能。

## 本次验证结果

- 13 项 JavaScript 测试及 16 项 Python 更新器测试通过；构建校验覆盖 9,952 张卡及 9,583 条中文效果。
- 浏览器端通过搜索、添加卡牌、刷新恢复草稿、官网真实链接导入、Neon 保存、分享链接读取、PDF/TTS/卡组文件导出及文件重导入；桌面和 390px 手机视口无横向溢出，未捕获脚本异常。正常流程没有请求萌卡社。
- 示例 `k0PjKL` 完整保留 17 种、60 张；PDF 6 页、约 1.25 MB，17 张卡图全部成功，逐页检查并确认全部卡号出现且文本未越界。TTS 校验 60 个卡牌对象，尚未在 Tabletop Simulator 客户端实测。
- Neon 开发分支迁移重复执行无重复建表，结构对比仅新增卡组与迁移记录表；测试快照 ID 为 `d_t1MN5p5TMaxFefI4RQnaDQ`，仅存在开发数据库。
- Vercel 云端构建已通过；实际预览接口验证了筛选选项、卡号查询、官网真实导入、Neon 保存与读取、重复保存去重及 PDF 导出。云端 PDF 为 6 页、17 张内嵌卡图，文本无越界。生产数据库仍未迁移。

## 已验证的预览版本

- [打开预览](https://lycee-toolbox-bzji84i1q-inferno-dragon.vercel.app)（保留 Vercel 预览访问保护，使用项目账号登录）。
- 部署 ID：`dpl_FkG5avM8pEQ8h3UZmWoBNE3hB33n`。
- [预览验证卡组](https://lycee-toolbox-bzji84i1q-inferno-dragon.vercel.app/?deck=d_KLFIxyhRBBq7WiWo2IKGmA)：开发数据库中的「预览验证 WP日」。
- `.vercelignore` 明确排除本地环境文件、Neon 上下文、测试与抓取临时文件，线上函数按 `vercel.json` 打包正式卡库与字体。
- 正式站点返回 200，仍包含旧版萌卡社检索入口；本次未切换正式域名。
