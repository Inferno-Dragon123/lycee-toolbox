# Lycee Overture 工具箱

[正式站点](https://lycee-toolbox.top/) · [功能预览](https://lycee-toolbox-git-codex-community-decks-inferno-dragon.vercel.app)

日式卡牌 Lycee Overture 的中文检索、组卡与卡组交流工具。前端为 HTML/JavaScript，API 部署在 Vercel；卡牌资料来自仓库 JSON，云端卡组与账号使用 Neon PostgreSQL / Neon Auth。

## 功能

本分支包含待审核的 [多选检索与基本能力筛选](docs/search-filters.md)。预览分支为 `codex/search-filters`，用户人工审核通过后再合并到正式分支。

- **卡牌检索**：中日文关键词、完整卡号、属性、类别、稀有度、版本、费用与数值筛选。预制中文译文覆盖日文效果，新卡缺译时回退日文，无需在线翻译。
- **组卡与分享**：本机草稿自动保存、官网卡组链接导入、本站分享链接、卡组 JSON 导入导出、TTS 导出。
- **卡表 PDF**：A4 卡表，包含名称、图片和中文效果，适合查看与登记。
- **打印卡图 PDF**：按卡组实际数量输出完整卡面，保留异画。A4 纵向、卡面 63 × 88 mm、7 mm 安全边距、1 mm 间距，每页 9 张，60 张共 7 页。打印时选择「实际大小／100%」，关闭「适合页面」。详见 [打印说明](docs/print-pdf.md)。
- **卡组社区**：邮箱验证码登录、自定义昵称、主动发布、修改、下架和删除自己的卡组。未登录也可浏览、预览和导入。
- **卡组推荐**：选择最多 10 种卡，按「全部包含／任意包含」检索玩家上传、官网玩家与官网赛事卡组。列表采用固定高度滚动和分页。
- **自动维护**：每天北京时间 04:20 依次抓取新卡、补译、更新 JSON 并推送，再增量同步官网卡组。

## 运行与测试

需要 Node.js 24；卡库维护脚本使用 Python 3.12。

```powershell
npm ci
npm run build
npm run dev
```

打开 http://localhost:3000/ 。开发服务仅监听本机，复用线上 API handler；修改服务端模块后需要重启。未配置 Neon 时仍可搜索、组卡及导出，云端保存和社区功能需配置环境变量。

```powershell
npm test
npm run test:python
npm run test:update
```

`npm test` 使用本地测试与 PGlite，不会发送登录邮件。真实邮箱收信及验证码输入由维护者亲测。需数据库的浏览器集成测试及其副作用见 [社区维护说明](docs/community-decks.md)。

Windows 本机直连官网失败时，可在当前终端使用系统代理：

```powershell
$env:HTTPS_PROXY = python -c "import urllib.request; print(urllib.request.getproxies().get('https',''))"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NO_PROXY = 'localhost,127.0.0.1'
$env:NODE_USE_ENV_PROXY = '1'
npm run dev
```

不要将本地代理配置复制到 Vercel。

## 数据来源与格式

| 文件 | 用途 |
| --- | --- |
| `lycee-japanese-database-final.json` | 官网日文原文 |
| `lycee-chinese-database-final.json` | 中文效果；历史字段 `japaneseText` 实际保存中文 |
| `data/catalog.json` | 名称、卡图、属性、费用、数值、版本、稀有度等结构化资料 |
| `lib/catalog.js` | 合并三份数据并建立服务端检索索引 |

截至 2026-09-29，中日文最终库各有 9,954 条记录、9,952 个唯一完整卡号，中文覆盖 9,952 个卡面。历史重复 `LO-2333`、`LO-0068A` 保留，运行时按完整编号取最后一条。

卡号按数字倒序、同编号无后缀在前、字母后缀升序排列；保留 `LO-0001A`、`LO-6826-A` 等官网完整写法，不合并异画，不根据编号空缺推测漏卡。中文初始库与后续 DeepSeek 补译均可继续人工修订。

检索和常规组卡使用本站数据与 API，卡图仍来自 Lycee 官网。只有显式导入萌卡社旧链接时才调用萌卡社 `showDeck`。

## 卡组与 API

卡组文件示例：

```json
{
  "schemaVersion": 1,
  "name": "我的卡组",
  "cards": { "LO-6826": 4, "LO-6826-A": 1 }
}
```

匿名保存生成不可变快照，相同内容复用；编辑后保存得到另一个快照。持有分享链接者可以读取。公开发布是独立操作，要求登录且合计 60 张，只有作者或管理员可执行对应管理操作。工具不代替比赛合法性检查。

支持本站 `?deck=d_…`、公开卡组 `?publication=p_…`、历史 `?id=…`、萌卡社旧链接，以及官网 `https://lycee-tcg.com/d/?d=k0PjKL` 和 `https://lyc.ee/dk0PjKL`。

| 入口 | 用途 |
| --- | --- |
| `GET /api/cards?facets=1` | 筛选选项 |
| `GET /api/cards?q=关键词&page=1&limit=30` | 卡牌检索，支持更多筛选参数 |
| `GET /api/cards?codes=LO-6826,LO-6826-A` | 按完整编号批量读取 |
| `POST /api/decks` / `GET /api/decks?id=d_…` | 保存和读取匿名快照 |
| `GET /api/import-deck?type=official&id=k0PjKL` | 官网卡组导入 |
| `GET /api/community` | 公开列表与多卡推荐 |
| `POST/PATCH/DELETE /api/community` | 发布、管理和昵称设置 |
| `/api/auth/*` | 同源登录代理，仅开放必要路由 |
| `POST /api/generate-pdf` | 服务端生成含中文效果的卡表 PDF |
| `GET /api/image-proxy?url=…` | 限制来源的卡图代理 |
| `public/print-pdf.js` | 浏览器生成标准尺寸打印 PDF，无需上传生成文件 |

卡表 PDF 的图片失败时保留文字说明，响应超过 4 MiB 会报错。打印卡图 PDF 的图片失败时整次导出中止并显示卡号，避免打印出空白卡；重复卡只下载、嵌入一次图片。打印精度取决于打印设置，清晰度取决于官网源图。

## 环境与部署

`master` 是正式发布分支，推送后由 Vercel Git 集成部署正式域名。`codex/community-decks` 保留为功能预览分支，预览可能要求 Vercel 项目账号登录。

Neon 项目为 `lycee-toolbox`（`gentle-paper-09879029`）。生产使用独立分支 `production`（`br-fancy-cloud-b4giop68`）；预览使用 `dev-community-decks`（`br-misty-pond-b48ax8kf`）。两者账号、会话与用户卡组相互独立，预览账号和测试卡组不会自动迁移到正式站。生产首次初始化只复制已收录的官网公开卡组及同步进度。

| 服务端变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 对应环境的 Neon pooled 连接 |
| `DATABASE_URL_UNPOOLED` | 迁移和同步使用的直连；网页 API 无需配置 |
| `NEON_AUTH_BASE_URL` | 同一数据库分支的 Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | 每个环境独立生成的至少 32 字符密钥 |
| `COMMUNITY_ADMIN_IDS` | 可选，具有下架权限的 Neon 用户 ID，逗号分隔 |

`.env*`、`.neon`、`.vercel` 均为本机文件，不提交凭据。Vercel Production 和 Preview 必须分别配置，不能复制开发库连接充当独立生产环境。Neon Auth 可信域名需包含对应站点 origin。

迁移文件在 `migrations/`，已包含分享、社区、昵称及来源合并；通过事务、锁和 `toolbox_migrations` 记录防止重复执行。**运行迁移前先核对目标分支**：

```powershell
# 本机 .env 对应预览数据库
npm run db:migrate
# 发布时使用单独准备且被 Git 忽略的生产配置
node --env-file=.env.production scripts/migrate.js
```

2026-09-29 生产初始化已执行四项迁移并启用独立 Auth。当前邮件服务仍为 Neon 共享 SMTP，尚未配置自有 SMTP；正式邮箱投递仍需人工验收，后续应按 [Neon 生产检查清单](https://neon.com/docs/auth/production-checklist) 配置自有发信服务。生产管理员 ID 尚未指定。

## 每日维护与手动更新

工作流为 [Daily card and deck maintenance](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/workflows/sync-official-decks.yml)，北京时间 04:20（UTC 20:20）计划运行，GitHub 实际启动可能延后。

1. 从 `master` 读取代码，扫描官网、补齐中文、重建 catalog，并构建校验。
2. 仅有变化时提交三份 JSON 到 `master`，由 Vercel 自动部署；并发推送冲突直接失败，不强制覆盖。DeepSeek 不可用时仍发布新卡日文与目录，页面回退日文，并在后续运行继续补译。
3. 向生产库同步最近 365 天的官网独立卡组，每次最多 100 套、3 个列表页，保存进度与失败重试队列。卡牌更新失败时不提交部分结果，卡组作业仍可处理现有资料。

GitHub 仓库 Secrets：`DEEPSEEK_API_KEY` 用于补译，`PRODUCTION_SYNC_DATABASE_URL` 为生产库直连。旧 `COMMUNITY_SYNC_DATABASE_URL` 保留给预览维护，正式定时任务不再使用。工作流支持手动选择 all/cards/decks；`validate_only` 只跳过卡牌实际抓取和翻译，卡组作业仍按所选数量实际同步。

```powershell
npm run update:full
npm run update:translate-only
# 仅检查，不调用翻译 API
npm run update:dry-run
# 同步目标由当前 DATABASE_URL_UNPOOLED 决定
npm run decks:sync -- --limit 100 --pages 3
```

本机更新默认不 Git 提交，核对后自行提交推送。抓取间隔至少 10 秒，报告、备份和翻译缓存放在忽略目录 `temp/`；不重新翻译已有中文。官网下架或改写旧卡效果不自动删除或覆盖最终库，需要人工核对。

官网卡组采用有界增量同步，不代表已抓取全站所有历史卡组；遵循 robots.txt，不访问被禁止的检索路径，也不解析官方攻略文章中的多套配方。

## 维护资料与验证

- [社区实现、权限与历史开发记录](docs/community-decks.md)
- [卡库更新与翻译脚本](scripts/README_update_and_translate.md)
- [数据库容量评估](docs/storage-capacity.md)
- [打印 PDF 实现与验证](docs/print-pdf.md)
- [最初接手的历史架构](docs/initial-project-review.md)（描述旧版，不作为当前部署状态）

本次合并前通过 22 项 JavaScript/SQL 测试与构建校验（9,952 个卡号均有中文）。打印 PDF 已通过浏览器下载、全部页面物理尺寸校验和首尾页渲染检查；尚未实体打印。邮箱收信与验证码输入、TTS 客户端使用由维护者亲测。

仓库仍保留早期 Redis、在线翻译和其他实验脚本，正式检索不使用这些方案。旧链接兼容仍可能依赖外部服务。历史文档中「尚未提交／仅预览／正式环境未配置」是当时记录，当前运行方式以本 README 为准。
