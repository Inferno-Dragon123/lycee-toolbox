# Lycee Overture 工具箱：维护交接

本文记录 2026-09-24 对本地仓库的接手梳理，代码基线为 `3892a4b`（`master`）。部署在 Vercel 并连接 Git 是项目负责人的说明；本次未连接 Vercel 控制台或验证线上部署版本。

## 已确定的实现方案

项目使用萌卡社 API 提供检索条件、卡牌信息、机翻效果文本及卡组服务。离线爬取 Lycee 官网的日文原文，通过 DeepSeek 翻译后生成中文 JSON；线上按完整卡号查 JSON，覆盖萌卡社的效果文本。实时翻译等早期方案因延迟过高已被放弃。

**后续维护应延续离线预翻译方案。** 当前主页面查不到精翻时保留萌卡社文本，不调用 DeepSeek。旧文件中的注释和 Redis 导入指南不能作为当前生产流程的依据。

```mermaid
flowchart LR
    M[萌卡社检索 API] --> P[public/index.html]
    P --> T[/api/translate-from-json]
    Z[最终中文 JSON] --> T
    T --> C[浏览器卡牌信息缓存]
    C --> V[检索结果与卡组]
    C --> F[/api/generate-pdf]
    I[远程卡图与本地中文字体] --> F
    F --> PDF[PDF 卡表]
    J[Lycee 官网日文原文] --> O[离线 DeepSeek 翻译]
    O --> Z
```

图中的离线 DeepSeek 批处理步骤来自项目负责人说明。负责人进一步确认：当时处理近 8,000 张卡，因网络问题、漏卡等情况分多个脚本处理、修复后整合成最终 JSON，并非单一脚本生成。当前以现有最终库为维护基线，暂不追溯或重建这段历史流水线。

## 官网日文库自动增量更新（2026-09-24 新增）

使用 Python 3.10 或以上版本，无需安装第三方依赖。在仓库根目录执行：

```powershell
python scripts/update_japanese_database.py
```

程序遍历官网按编号倒序排列的完整列表，每页 200 张，直接提取列表中的日文效果、官方显示名称和完整卡号。它以完整 `code` 与本地最终日文库比对，补入官网存在而本地没有的卡牌，包括旧编号特典卡及新增异画。数字空号本身不视为漏卡，也不会逐个试探空号。

负责人最初确认应补 LO-6826；全站扫描又发现官网确实列出了部分旧缺号特典卡，负责人随后明确授权：**补全官网实际列出、但本地尚未收录的所有卡牌。** 后续应继续以官网实际列表为准。

- 所有分页成功后才合并 `lycee-japanese-database-final.json`，保留已有内容及重复记录，不刷新已有卡勘误。
- 新记录仍使用 `code`、`cid`、`name`、`japaneseText` 四个字段；`cid` 留空，`name` 使用官网完整显示名称（可能包含称号），不编造萌卡社 ID。
- 合并后按数字编号降序、同编号无后缀优先、字母后缀升序排列，并更新 `totalCards`、`updatedAt`；保留 `generatedAt`。
- 不修改中文库，不调用 DeepSeek、Redis 或萌卡社。新增日文卡牌需要后续离线翻译，才会进入正式中文效果覆盖库。
- 单次扫描保存原始 HTML、校验和及分页断点；网络请求间隔至少 10 秒，默认超时 45 秒、最多尝试 3 次。
- 原始数据库备份、此次新增记录和报告保存在 `temp/lycee-official-update/` 下的运行目录，最新报告是 `temp/lycee-official-update/latest-report.json`。该目录被 Git 忽略。
- 官网删除或暂时不展示的已有卡牌不会从本地删除，会在报告的 `existingOnlyCodes` 中列出。

网络中断后继续同一轮扫描：

```powershell
python scripts/update_japanese_database.py --resume
```

只扫描、生成新增清单，暂不合并：

```powershell
python scripts/update_japanese_database.py --dry-run
python scripts/update_japanese_database.py --resume
```

第二条命令可将前一次完整扫描的候选合并。`--resume` 复用旧页面快照，适合同一次任务断点恢复；隔一段时间检查新卡应执行不带 `--resume` 的普通命令，重新扫描官网。遇到重复分页、跨页重叠卡号、缺失字段或解析失败，程序会中止，不能将部分结果当作完成。

离线回归测试：

```powershell
python -m unittest discover -s tests -v
```

本次执行结果：官网共扫描 50 页、9,952 个完整卡号，补入 369 条记录，其中数字编号大于 6827 的卡面 210 条、LO-6826 与 LO-6826-A 两条、较早编号的卡牌 157 条。日文最终库由 9,585 条增至 9,954 条（9,952 个唯一卡号，保留原有两条重复记录）；中文库未改动。已有卡牌内容与备份逐条核对一致，排序及卡号覆盖检查通过。16 项离线测试通过，并抽查 LO-6971-A、LO-6826、LO-5813 的独立官网详情页，效果文本与列表提取结果一致。最新报告位于 `temp/lycee-official-update/latest-report.json`。

## 当前代码入口

| 文件 | 用途与边界 |
| --- | --- |
| `public/index.html` | 正式前端入口，原生 HTML/CSS/JavaScript，样式和业务逻辑集中在同一文件，没有前端构建框架 |
| `api/translate-from-json.js` | 正式效果覆盖接口；进程内首次读取最终中文 JSON 并建立 Map，后续复用 |
| `lycee-chinese-database-final.json` | 线上效果译文来源；按 `cards[].code` 匹配 |
| `lycee-japanese-database-final.json` | 日文原文归档；当前正式翻译接口不读取它 |
| `api/generate-pdf.js` | PDFKit 后端生成 A4 卡表，包含卡图、卡号、卡名、数量、效果；动态计算行高 |
| `public/fonts/NotoSansSC.ttf` | PDF 中文字体，后端通过仓库根目录拼接路径读取 |
| `api/image-proxy.js` | 搜索卡图代理，设置一小时缓存；下载失败返回占位 PNG |
| `api/lo-proxy.js` | 通过萌卡社的 `makeTtsByLo` 服务获取官网卡组对应的 TTS JSON |
| `vercel.json` | 当前只声明版本和 API CORS 头，未声明构建命令、输出目录、运行时或函数时限 |

`package.json` 使用 ESM（`type: module`）。没有 `dev`、`build`、`start` 脚本；`npm test` 是固定失败的占位命令。`main: wenjian.js` 并非网站服务入口。

## 前端业务与数据约定

萌卡社游戏编号固定为 `kid=9`。以下是源码中使用的接口路径，未在本次接手中重新验证远端行为：

| 功能 | 上游路径 |
| --- | --- |
| 筛选字段 | `www.moetcg.club/Api/getKindColumn` |
| 卡牌检索 | `www.moetcg.club/Api/search` |
| 保存卡组 | `www.moetcg.club/Api/buildDeck` |
| 读取卡组 | `www.moetcg.club/Api/showDeck` |
| 已保存卡组 TTS 导出 | `moetcg.club/Api/outTts` |
| 官网卡组转换 | `www.moetcg.club/cardBuilder/makeTtsByLo/did/{id}.html` |

- 浏览器直接调用筛选、搜索、保存和卡组详情接口，受上游响应格式和 CORS 配置影响。
- `deck` 是 `cid -> 数量`，`cardInfoMap` 是 `cid -> 卡牌信息`，`currentDeckId` 是萌卡社保存后的卡组 ID。`cid` 用于浏览器状态；`code` 用于精翻查找及保存卡组。
- 搜索固定请求 `page=1`，目前没有翻页 UI。首次渲染通常显示“翻译中”占位，再批量查 JSON 并局部回填效果。
- `translateCards()` 把 `{ id: cid, code, text: effect }` 发给覆盖接口，译文写入 `effectTranslated`；上游文本保存在 `effectOriginal`。若已有非空译文缓存则跳过；若上游 `effect` 为空也会跳过查库。
- 保存时将 `cid` 转成 `code`，用 FormData 提交 `deck`、`deckName`、`kid`。缺少 `code` 的卡会被跳过；响应 `data.hash` 用作分享链接的 `?id=` 参数。
- 官网卡组导入从 TTS 对象的 `Nickname` 统计卡号，再逐卡串行搜索补全详情，目前取搜索结果第一张。
- 新建卡组及增减卡牌后，页面要求重新保存才能导出；刚导入的官网卡组可以直接导出 PDF/TTS。
- 已保存卡组的 TTS 通过上游下载，官网导入且未保存的卡组由浏览器组装 TTS JSON。PDF 导出将卡组数据和缓存译文提交后端，后端本身不查翻译库。
- 卡组及译文缓存只在页面内存中，未使用 localStorage/IndexedDB。刷新后依赖分享 ID 重新加载已保存卡组。

## 精翻数据格式与接口

两个最终库均使用以下结构。**中文库的 `japaneseText` 字段实际存储中文译文**，不要单独改名，否则当前接口读不到译文；`name` 仍可保留日文卡名。

```json
{
  "generatedAt": "时间戳",
  "totalCards": 1,
  "cards": [
    { "code": "LO-xxxx", "cid": "上游卡牌ID", "name": "卡名", "japaneseText": "效果文本" }
  ]
}
```

首次接手时的数据核对结果（官网增量更新前的快照）：

- 两库各 9,585 条记录、9,583 个唯一卡号，卡号集合相同，无空效果文本。
- 重复卡号为 `LO-2333`、`LO-0068A`，各有两条记录。运行时 Map 对重复卡号取后出现的非空文本，因此加载日志为 9,583。
- 两库的 `generatedAt` 均为 `2026-08-01T12:08:05.594Z`；中文库沿用了该时间，不能将它视为精确的翻译或最后更新时间。
- `code` 严格匹配，没有去后缀、大小写转换或异画自动回退；不要擅自合并完整卡号。

`POST /api/translate-from-json` 支持：

```json
{ "items": [{ "id": "123", "code": "LO-xxxx", "text": "萌卡社效果文本" }] }
```

响应为 `{ "translations": { "123": "命中译文或原输入文本" } }`。也兼容单条 `{ "code": "LO-xxxx", "text": "兜底文本" }`，返回 `translatedText`。空批次返回空映射，缺少单条输入返回 400，非 POST/OPTIONS 返回 405。

接口以 `process.cwd()` 定位最终中文库，实例加载后不会自动重新读取文件。更新文件后需要新进程/新部署，浏览器旧缓存也需刷新。正式查库流程不依赖 DeepSeek 或 Redis 环境变量。

## 离线采集与更新流程

现有采集代码先从萌卡社取得卡号，再请求 `https://lycee-tcg.com/card/card_detail.pl?cardno={code}`，用正则抽取指定 `td`，将 `<br>` 转为换行、移除 HTML 等内容。

| 脚本 | 当前行为 |
| --- | --- |
| `crawl-all-lycee.js` | 全量抓取，输出 `lycee-japanese-database.json`；列表最多 100 页 |
| `crawl-all-lycee-resume.js` | 进度保存在 `crawl-progress.json`，同样输出中间日文库；跳过已失败项，正常结束时删除进度文件 |
| `update-database.js` | 对中间日文库按 code 查找新增卡；最多取 100 页；不检查已有卡勘误，不翻译，不输出最终中文库 |
| `retry-failed-cards.js`、`retry-failed-direct.js`、`retry-lycee-direct.js` | 不同阶段的失败补抓方案，将中间日文库合并到 `lycee-japanese-database-complete.json` |
| `retry-6-cards.js` | complete 库加补抓结果，输出最终日文库 |
| `retry-last-2.js` | 最终日文库加补抓结果，输出另一文件 `lycee-japanese-database-complete-final.json`，不自动替换正式库 |
| `extract-failed-codes.js` / `.py` | 从硬编码桌面路径的 `失败.md` 提取失败卡号，不能视为通用更新入口 |

上述旧脚本是分阶段工具；日文增量采集现在应使用本文前述 `scripts/update_japanese_database.py`。部分旧重试脚本用空 `cid`/`name` 保存补抓记录；最终效果覆盖依靠 `code`，可以命中这些记录。中文库的历史生成流程仍暂缓追溯。

后续更新应保留现有最终库，先生成增量候选，核验新增/变更的日文原文，再离线翻译、检查术语和完整性，最后合并最终中文库并检查卡号、重复记录及空文本。需要另外覆盖官网勘误；当前增量脚本只找新卡。正式替换前应核对少量卡牌的检索显示、导入和 PDF 效果。

**暂缓事项（负责人已确认）：** 不追查历史 JSON 生成脚本。未来实际需要更新卡库时，再围绕该次新增或勘误数据确定离线处理方式。仓库现有在线翻译提示词不能自动认定为最终库的生成配置，也不应为了还原历史流程重新翻译全库。

## 历史方案及其他文件

| 文件/分组 | 定位 |
| --- | --- |
| `api/translate.js` | Redis 日文源库 + `trans:*` 翻译缓存 + 在线 DeepSeek，缓存 30 天；正式主页已不调用 |
| `api/translate-test.js`、`public/translate-test.html`、`test-translation.js` | 在线翻译调参实验；不是最终中文库生成器 |
| `api/admin-stats.js`、`public/admin.html` | 统计 Redis `trans:*`，不反映当前 JSON 库覆盖率；页面部分文件统计字段后端未提供 |
| `data/translations.json` | 203 条旧的 `code -> { zh, src, ts }` 缓存；当前正式接口没有读取引用 |
| `import-to-redis.js`、`batch-import-redis.js`、`REDIS_IMPORT_GUIDE.md` | 旧日文库导入 Redis；当前 JSON 覆盖方案不需要执行 |
| `check-cache.js`、`clear-cache.js`、`clear-translation-cache.js` | 旧缓存检查/删除脚本，运行清理脚本会修改远端 Redis |
| 根目录 `卡表生成器.html` | 旧前端副本，与正式页面主要差异是仍调用 `/api/translate`；后续页面修改应定位 `public/index.html` |
| `pdf test-1.html` | 早期浏览器 html2pdf 导出实验 |
| `6420.html`、`crawl-lycee-*.js`、`test-*.js`、`debug-single-card.js` | 保存的官网样本、结构探测及手工实验，不是自动回归测试套件 |
| `wenjian.js` | 与卡牌项目无关的 docx 论文生成脚本，使用 CommonJS 并写入硬编码桌面路径；不应作为站点入口运行 |

旧 API 和测试页面仍位于 `api/`、`public/`，代码中未看到这些入口的鉴权。主页面未调用不等于部署时已关闭；后续清理需结合实际部署确认。

## 已发现的维护事项

以下记录来自本地静态检查，接手时未修改业务代码：

1. **凭据：** 已被 Git 跟踪的 `test-translation.js` 含硬编码 API Key 形式的回退值。本次没有验证其有效性或调用它；应确认是否仍有效，有效则在服务端轮换并去除源码回退值。本文不记录密钥内容。
2. **规则 PDF：** 页面链接为 `assets/lo-rules.pdf`，该文件本地不存在；现有文件是根目录 `assets/LO规则妙妙小解.pdf`，且 `*.pdf` 被 Git 忽略。当前 Git 跟踪清单未包含该资源，需核对发布路径。
3. **前端换行：** JSON 使用真实换行，效果渲染仅将 `|` 转为 `<br>`，对应样式未保留换行，可能使各能力挤在一起。
4. **PDF 延迟及分页：** 后端逐卡串行下载图片，每卡最多尝试三个 URL、每次 8 秒；大卡组遇到坏图会显著变慢。超长效果超过一页时需专门检查分页，当前一次换页判断不足以证明布局正确。
5. **官网卡组匹配：** 按 code 搜索后直接取首条，未验证精确卡号；跳过失败卡后仍用请求的种类数提示成功，可能掩盖导入不完整。
6. **代理输入：** 图片代理以 `hostname.includes(domain)` 判定域名；PDF 接口直接下载传入 `img`，未见域名限制或卡牌数量上限；LO 代理关闭了 TLS 证书校验。后续加固应分别处理。
7. **旧说明：** 正式前端仍有“新卡调 DeepSeek”和“jsPDF 导出”等注释，以及未使用的 jsPDF CDN 引用和辅助函数，容易误导维护。
8. **流程缺口：** 增量脚本不更新最终库、不处理已有卡勘误，抓取失败可提前终止列表；不能凭脚本完成日志判断已获取全部新卡。

## 首次接手时的配置与验证边界

本地存在 `.env`、`.env.redis`、`.env.test`，被 Git 忽略；本次只核对了变量名，未把环境文件值写入交接文档。旧在线方案用 `DEEPSEEK_API_KEY`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`。

本地 `.vercel/project.json` 的项目名为 `translate`，未包含足以还原构建/输出目录的设置。正式 HTML 在 `public/`，函数和最终 JSON 在根目录对应位置，不能仅根据本地关联文件保证线上打包正确。静态文件服务器只能预览页面，无法执行 Vercel API；localhost 翻译地址还固定为 3000 端口，其他接口使用同源路径。

首次接手使用 Node `v24.14.0` 完成了离线检查：

- 根目录及 `api/` 下 37 个 JavaScript 文件通过 `node --check`。
- `public/` 三个 HTML 的内联脚本通过语法解析。
- 两个最终 JSON 可解析，并完成上述条数、卡号集合及空文本检查。
- 直接调用真实 `translate-from-json` handler，验证批量命中/未命中、单条 code/text、空批次、缺失输入、GET 拒绝及 OPTIONS；测试禁止网络调用，全部通过。

语法通过不代表旧脚本可以直接运行。首次接手阶段没有执行抓取、Redis 写入、DeepSeek 付费调用、卡组保存、PDF 视觉验收或线上端到端测试；没有提交、推送或触发部署。之后授权的官网日文库更新见本文的自动更新章节。
