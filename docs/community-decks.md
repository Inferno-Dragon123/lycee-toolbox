# 卡组社区开发与维护

## 每日官网卡组解析修复（2026-10-05）

[每日任务 37242931029](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/runs/37242931029) 的卡牌更新成功，官网卡组同步成功 19 套、失败 1 套。失败卡组 `1548027024118` 的官网配方将 `LO-6186` 分成三行，每行 1 枚；原解析器把重复卡号直接判为无法完整解析，导致整体任务返回失败，已同步的其他卡组并未回滚。

官网导入与每日同步共用的解析器现按完整卡号累加合法重复行，异画卡号分别保留；每行数量必须是 1～60 的安全整数，合并后继续执行卡组数量限制和官网总张数核验。错误卡号、非法数量或总张数不符仍拒绝导入，保留失败报告与退避重试，不把失败任务改成无条件成功。

## 正式发布接续（2026-10-04，审核已通过）

用户已明确确认预览人工审核完成，并要求合并至主分支、更新 README。此前“等待审核／不得发布”边界已由此次明确授权替代，本次发布范围包含多选卡牌与基本能力、卡组组合检索、官网标签与双来源分页，以及 `82385df` 的四项反馈修复。

- 已重新 fetch：正式分支基线为 `e1fb555`，预览最新为 `82385df`，合并无冲突。为保留原目录未提交成果，在 `C:/Users/35057/.codex/worktrees/release-20261004/lycee-toolbox` 的 `codex/release-search-filters-20261004` 整合，合并提交为 `09b3a12`。
- 生产分支已通过 Neon API 重新核对为 `production` / `br-fancy-cloud-b4giop68`，当前 direct 主机为 `ep-blue-king-b462nnl2.c-6.us-east-2.aws.neon.tech`。旧记录对 `D:/Code/.vscode/lycee-toolbox/.env` 环境归属的说明不再作为发布依据；本次使用明确从生产分支取得的独立忽略配置。
- 生产库检查时共有707套公开卡组：官网赛事415、官网玩家291、本站投稿1；不能套用预览库106套的统计。生产已执行005并完成707套构成补建：系列单388、混成319、未知0，296套采用官网原标签，411套采用本地计算；全部属性统计完整，发布后再次核对索引缺失或快照不一致为0。发布记录、分享快照、昵称全量前后校验一致。
- 合并及README更新已推送`master`，首次验证版本`7e3e48b`的生产部署`dpl_C8gTjqnu9kaWLKSLY9FiwumguNPu`为Ready，并绑定`https://lycee-toolbox.top/`。线上数字卡号返回`LO-6826`及异画，换装返回52卡面，基本能力19类，术语修正生效；公开卡组707、系列单388、最后一页36，雪≥4且月≥4返回6套。社区条件栏、移除原链接及匿名会话核验通过。本段随后作为文档发布记录提交，不改变业务代码。
- 整合版本 `npm run build`、46 项 JavaScript/SQL 测试及18项针对性Python翻译回归测试通过，校验9,956个卡号及9,956个译文。本轮没有重复爬取、付费翻译或发送登录邮件。
- 原4062中的服务器迁移评估文档仍属于后续方案，未纳入本次功能发布。
- 接续无需再等待本批功能审核、重复005或全量补建。后续按用户新的维护或国内服务器迁移指令推进；新版双来源爬虫已进入正式分支，首次后续定时运行的覆盖及失败报告仍需关注。本轮没有触发额外官网同步。

下列接续记录保留为发布前的历史证据；现行审核和生产状态以上方正式发布记录为准。

## 已审核的卡组检索升级（2026-10-03开发，2026-10-04通过）

本次将卡组推荐整合为「卡组检索」，增加类型／会社／属性多选、六项属性数量范围、构成标签、指定页和末页。维护规则及迁移见 [卡组检索说明](deck-search.md)。预览及正式环境分别维护迁移和构成索引，当前发布状态见上方记录；下文历史记录不代表最新授权或生产状态。

## 接续记录（2026-10-04 更新，预览修复待审核）

交接记录编号：`lycee-20261003-tag-fix`（沿用既有记录，2026-10-04 增量更新）。用户已显式调用本机 `C:/Users/35057/.codex/skills/project-handoff/SKILL.md`；已按其保存流程增量整理并回读核验本记录。此次仅保存材料，尚未创建接手对话。源对话的宿主编号未取得。下文 2026-09-28 的接续状态是历史，不代表当前分支、授权或数据库状态。

### 工作位置与版本

- 当前工作目录：`C:/Users/35057/.codex/worktrees/4062/lycee-toolbox`。接续应使用此目录，避免进入旧工作树或默认分支后丢失预览改动与本机证据。
- 仓库：`https://github.com/Inferno-Dragon123/lycee-toolbox.git`，预览分支 `codex/search-filters`。
- 当前代码提交 `82385df` 已推送（上一提交 `d4d556e` 为官网标签修复）。保存本段时业务代码已提交；此交接文档随后在本机增量更新，尚未提交或推送。
- Vercel Preview 已 Ready：`https://lycee-toolbox-4bh0i2msi-inferno-dragon.vercel.app/`，部署编号 `dpl_CUCUHxGngv77mAdMcbhLY2Li7yDs`。固定入口：`https://lycee-toolbox-git-codex-search-filters-inferno-dragon.vercel.app/`。
- 本机 `origin/master` 指向 `e1fb555`（卡库维护提交）；没有在本轮重新拉取其最新远端状态，发布前应重新核对。
- 所有本轮爬取、测试、部署等待及子代理审查均已结束，没有待接续的后台任务。

### 当前用户决定与待审核边界

- 当前已完成官网标签修复及 2026-10-04 的人工测试反馈修正，已更新预览。卡牌多选／基本能力筛选、译文选项归并和卡组检索升级仍等待用户人工审核。
- **审核通过前不要合并 `master`、迁移／补建生产库或运行指向生产库的维护脚本。** 以前已经获准发布的社区／打印功能不等于本次筛选升级已获准发布。
- 用户偏好针对性、节省 token 的验证；邮箱收信及验证码输入由其亲测。本轮没有发送测试邮件或新建测试账号。
- 中日文 JSON 仍按数字编号倒序，同编号无后缀优先、字母后缀升序；保留完整异画编号及历史重复，不凭数字缺号造卡。用户已授权补齐官网实际列出的本地缺卡。
- 检索使用本地 JSON 与本站 API；译文离线生成，线上不调用 DeepSeek。早期实时翻译方案因延迟放弃。萌卡社只保留历史链接兼容用途。

### 环境定位（仅路径及标识，不含凭据）

- Neon 项目：`lycee-toolbox` / `gentle-paper-09879029`。
- 预览数据库：`dev-community-decks` / `br-misty-pond-b48ax8kf`；生产数据库：`production` / `br-fancy-cloud-b4giop68`，账号与投稿互相隔离。
- 预览凭据位于本机旧工作树 `C:/Users/35057/.codex/worktrees/a532/lycee-toolbox/.env`；本轮仅使用其中预览库，补建脚本已校验 direct 主机 `ep-round-river-b4eyh6dh.c-6.us-east-2.aws.neon.tech`。
- 原开发目录 `D:/Code/.vscode/lycee-toolbox/.env` 是生产环境，本轮不要使用。文件为本机私有材料，不在 Git；跨机器接续需要已有环境配置，不能把连接字符串抄入交接。
- 预览已应用 001～005，生产据既有发布记录为 001～004；本轮未修改生产，也未重新查询生产迁移状态。
- 每日工作流仍从 `master` 读取代码、将卡库推送到 `master`，卡组同步使用 `PRODUCTION_SYNC_DATABASE_URL`。定时为 UTC 20:20／北京时间次日 04:20。本轮爬虫修复仅在预览分支，尚未进入正式定时任务。
- `git push`／Vercel CLI 网络操作可在当前 PowerShell 中设置 `$env:HTTPS_PROXY = python -c "import urllib.request; print(urllib.request.getproxies().get('https',''))"`，不要打印代理凭据或把本机代理配置上传。
- Vercel 项目已链接在旧工作树 a532；从那里执行 `vercel curl PATH --deployment URL -- --silent --show-error --fail --output ABSOLUTE_PATH`，通过 tool 的工作目录指定旧树。不要把 `--cwd` 放在 curl 转发参数后。

### 本轮修复与已验证结果

2026-10-04 增量（代码 `82385df`）：

- 数字卡号查询恢复：`6826` 与 `LO-6826` 等效，兼容全角数字、编号前缀及异画后缀；只改变搜索输入，不放宽卡组文件编号校验。
- 增加「コンバート → 换装」基本能力，目前 19 类；52 个具备前导换装能力的卡面、28 种代价／目标形式，正文中引用／获得换装的卡不计入该能力筛选。
- 中文最终库精准修正 107 条记录：74 条含换装、33 条含支援，共 137 处术语替换；另修正 `LO-6907` / `LO-6907-K` 的「当这个角色进行辅助时」为「当这个角色受到支援时」。`アシスト → 辅助`、`サポーター → 支援者` 保持独立。
- 按用户完整新提示词更新翻译脚本；API 返回、缓存读取与异画复用会校准两项术语，防止旧词回流。新增 `scripts/normalize_translation_terms.py`，默认 dry-run，`--apply` 才更正本地中文库；可重跑，第二次评估为 0 更正、0 歧义。
- 全库 9,958 条记录／9,956 个唯一卡号的身份、cid、排序、专名、费用符号、分隔符及未改译文日期均核对保留；没有调用付费翻译 API、联网爬取或云库写入。
- 卡组检索新增条件栏，支持单项移除来源、类型、会社、属性、范围、卡号与匹配方式；移除后需检索应用，翻页／刷新仍沿用已应用条件。官网名称链接直达官网，本站投稿名称仍打开本站预览，独立原链接移除，预览／导入按钮保留。
- 验证：46 项 JS 测试、18 项针对性 Python 测试、构建通过；卡牌与社区本地浏览器检查桌面及 390px 手机通过。线上 API 核验数字卡号返回 2 卡面、换装返回 52 卡面，`LO-6907` / `LO-6465` 的新译文生效，页面已包含社区条件栏。
- 本机证据：`temp/lycee-official-update/alignment/terminology-repair.json`（更正报告），`temp/preview-polish-{numeric-code,convert,term-samples}.json`、`temp/preview-polish-markup.html`；截图 `temp/search-filters/mobile-convert.png`、`temp/community/deck-search-{desktop,mobile}.png`。其中大括号为对应文件列表的简写。这些文件仅在本机。
- 预存未跟踪的 `docs/domestic-server-migration-plan.md` 属于其他工作，本轮未读取、修改、提交或推送；接续时保留。正式库与工作流仍未切换为本轮新代码／提示词，待用户验收后合并。

2026-10-03 官网标签修复（代码 `d4d556e`，仍有效）：

- 根因一：此前要求官网六项属性数量合计等于卡组张数，错误排除了多色费用卡组。官网按费用中的不同颜色分别计数，同卡可贡献多栏；无五色费用（包括 0、`-`、纯無）归「他」。与已取得原标签的 96 套样本逐项匹配 96/96。
- `lib/deck-composition.js` 新增统一费用统计及原标签兼容校验；各栏不超过实际张数、合计允许总张数至五倍，费用资料完整时六项逐项匹配，拒绝过期标签。`lib/official-deck-list.js` 不再限制六项合计最多 200。
- `lib/community-store.js` 的保存、同步、补建统一使用上述校验；官网缺标签时也按费用统计。本站投稿继续按卡面属性。有效原标签不会被同一快照的本地 fallback 覆盖。
- 根因二：混合玩家／赛事列表跨页重复并遗漏部分赛事。`scripts/sync-official-decks.js` 与 `lib/official-sync-state.js` 改为 `_user=1`、`_festa=1` 分别分页，独立保存 `sourcePages`；优先刷新首页，剩余预算公平续扫。`--pages` 仍是总列表请求预算，1 页预算跨轮轮换来源；保留旧 pending 与失败重试队列，旧混合页码不直接迁移。
- `scripts/backfill-deck-compositions.js` 默认 dry-run，写入仍要求 `--apply` 和正确 `--expect-host`。本轮已使用合并列表缓存在预览库补建，不必重复运行。
- 预览共 106 套公开卡组：105 套官网、1 套本站投稿。官网原标签 103 套（54 玩家、49 赛事）；另外 2 套官网及 1 套投稿为本地计算。系列单 42、混成 64、未知 0。
- 恢复四套原标签：`0xwAnh`、`ITxtz1`、`9472nO`、`ROWEhk`，六栏分别合计 64、64、64、69；全部 `attributes_complete=true`，已在预览库及线上 API 验证能参与属性组合筛选。
- 从单独赛事首页补回七套大阪赛：`1608005012369`、`1608012013292`、`1608026011535`、`1608028011997`、`1608035021315`、`1608039000471`、`1608045000088`，均为 MIX。
- 仍缺完整原标签：`jKIlqu`（「ミックスSP花（自分用）」）官网详情 HTTP 200，但正文返回「デッキ情報を取得できませんでした。」；`R2ZY23`（「新しいデッキ」）详情仍在，但不在作者完整公开列表 18 套中。官网未说明原因，不断言已删除／改私密。这两套保留完整本地费用统计。
- 本地 `node --test tests/community.test.js tests/deck-composition.test.js tests/official-sync.test.js` 23 项通过；`npm run build` 通过，校验 9,956 个卡号及 9,956 个译文。其他功能未重复全量测试。
- 线上组合筛选已核验：雪≥4 且月≥4 返回 2 套并包含前两套；月≥4 且日≥4 返回 4 套并包含 `9472nO`；雪≥4 且花≥4 返回 3 套并包含 `ROWEhk`。页面说明已更新为费用重叠计数。此轮 UI 仅说明文字变化，未重跑完整浏览器套件。

### 资料与证据

- 项目入口与启动／部署：`README.md`；卡牌检索：`docs/search-filters.md`；卡组检索及 005 维护：`docs/deck-search.md`；本文件维护社区、环境和最新接续状态。
- 打印功能：`docs/print-pdf.md`；容量历史评估：`docs/storage-capacity.md`；卡牌增量／DeepSeek 补译：`scripts/README_update_and_translate.md`。
- `docs/initial-project-review.md` 是 2026-09-24 的历史调研，其中萌卡社、无 build 脚本等描述已被后续自有卡库迁移替代，不能作为当前运行方式。
- 本机忽略目录证据：`temp/tag-cost-audit-report.json`；`temp/community/tag-lookup/lookup-report.json`、`combined-list.html`（312 个唯一编号）；线上响应 `temp/preview-snow-moon.json`、`preview-moon-sun.json`、`preview-snow-flower.json`，页面 `temp/preview-tag-fix.html`。这些文件未上传 Git，跨机器不可假定存在。

### 接续第一步与完成标准

1. 先只读核对指定工作目录、分支／`82385df`、本机交接文档差异，以及固定预览是否仍对应本轮部署；不要重复抓取、重复补建、重复应用术语修正或重新发登录邮件。
2. 用户在预览审核数字卡号、换装筛选／术语译文、卡牌多选／基本能力译文归并、卡组类型／会社／属性范围／多卡条件／条件栏／名称链接、分页跳转与末页，以及四套多色费用卡组。未得到通过反馈时保持预览范围，按其新反馈继续修复。
3. 只有用户明确通过并要求正式发布后，才重新核对远端 `master` 和自动维护新增卡库，整合最新数据；在生产正确 direct 环境执行 005 和必要构成补建，然后发布代码并核验正式站。生产原标签缓存覆盖、生产数据数量及当前迁移状态届时重新评估，不能套用预览数量。
4. 需要继续扩大官网覆盖时，按新双来源分页运行有界同步；每天有限批次不等于全站爬取完成。本轮未运行新版联网同步，已完成纯队列回归及列表证据验证；完整上线后的首轮定时结果仍需关注。

材料状态：已回读核对本段的版本、环境边界和接续动作，上述业务文档与本机证据均可访问；仅保存，尚未创建接手对话。保存材料不代表用户验收或授权合并正式分支。

当前会话的可调用工具未提供 `list_projects`、`create_thread` 或打开 Codex 对话的入口，自动新建／打开／接手核验尚未执行；未通过其他渠道创建替代任务。

### 接手开场白

```text
使用 $project-handoff 恢复 Lycee 工具箱项目。项目目录为 C:/Users/35057/.codex/worktrees/4062/lycee-toolbox，交接来源为该目录的 docs/community-decks.md，记录编号 lycee-20261003-tag-fix（已于2026-10-04增量更新）。当前分支 codex/search-filters，代码 82385df 已推送并部署预览，交接文档本机未提交。当前目标是继续维护项目并处理预览人工审核反馈；审核通过前不合并 master、不修改生产库。第一步只读核对目录、分支、提交、交接文档差异和预览部署状态，报告差异及下一步；不重复抓取、补建、术语修正、测试登录邮件。此前针对性测试、构建与线上筛选已经通过，按记录中的证据核对；用户尚未验收。保留无关的未跟踪 docs/domestic-server-migration-plan.md。
```

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
