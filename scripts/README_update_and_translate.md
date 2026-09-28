# 卡牌更新、补译与中日文对齐

本脚本在用户新增的 `update_and_translate.py` 基础上完善。使用 Python 3.10+ 标准库，无需安装 Python 依赖。保留用户的翻译术语表与历史中文库字段 `japaneseText`。

## 常用命令

```powershell
# 官网重新扫描、生成搜索元数据、补齐全部缺译、排序（不自动提交）
npm run update:full

# 已完成日文爬取时，直接按完整中日文数据库差集补译
npm run update:translate-only

# 只查看缺译编号，不联网翻译、不修改最终数据库
python -X utf8 scripts/update_and_translate.py --skip-crawl --dry-run

# 爬取中断后复用页面缓存；译文缓存始终自动复用
python -X utf8 scripts/update_and_translate.py --resume --catalog

# 明确需要脚本提交并推送时才加 --push
python -X utf8 scripts/update_and_translate.py --catalog --push
```

默认读取仓库 `.env` 中的 `DEEPSEEK_API_KEY`；已设置的环境变量优先。可以用 `--env-file PATH` 指定另一份本机配置，不会复制配置或把密钥写入报告。`DEEPSEEK_MODEL` 可覆盖默认 `deepseek-chat`。密钥配置文件必须保持 Git 忽略。

`--workers` 为翻译并发数，默认 2、最大 4。它不影响官网爬取：官网仍串行、最少 10 秒间隔。`--delay`、`--timeout`、`--retries`、`--max-pages` 传递给原日文爬虫；`--catalog` 同步重建 `data/catalog.json`。`--no-git` 保留兼容，但现在默认就不提交。`--dry-run` 不调用付费翻译 API；未加 `--skip-crawl` 时仍会抓取官网并写临时扫描报告。

## 处理规则

1. 官网爬虫只新增官网实际列出的编号，不依据数字缺口造卡。
2. 不再依赖某次 `new-cards.json`：每次比较完整日文与中文库，历史缺译、上次失败都能补上。
3. 保留已有中文内容。仅在同一个基础卡号、完整日文文本一致、已有译文无冲突时复用其译文；待翻译的同文异画也只调用一次 API。每个卡面保留自己的编号、名字、cid。
4. 每组成功译文立即原子写入缓存，缓存键包含基础编号、原文、提示词、模型和缓存版本。重跑自动跳过成功项；网络失败有重试，认证/余额等永久错误停止任务。
5. 拒绝空返回、截断返回、格式分隔符变化和费用符号变化。`[コスト]` 翻译成 `[COST]` 属于能力标题的正常翻译。空效果卡仍创建对应中文条目。
6. 两份 JSON 均按编号数字倒序、字母后缀升序排序。历史同编号不同 cid 记录保留并报告，避免误删；不会擅自移除中文独有记录。
7. 覆盖前备份，JSON 原子替换；翻译期间若有人修改最终文件则停止合并，已完成译文仍可重用。
8. 有失败或编号未对齐，退出码为 1，不自动推送。Git 推送失败也返回失败；`--push` 拒绝混入运行前已暂存的无关文件。

## 报告与恢复

- `temp/lycee-official-update/latest-report.json`：官网卡牌扫描结果。
- `temp/lycee-official-update/alignment/report.json`：中日文条目数、唯一编号数、缺译编号、中文独有编号和失败详情。
- `temp/lycee-official-update/alignment/translation-result.json`：本次翻译进度。
- `temp/lycee-official-update/alignment/translation-cache/`：逐组译文缓存；已完成任务再次执行不会重译。
- 最终文件旁 `.json.bak` 和爬虫运行目录：修改前备份，均不提交。

网络中断后直接重跑相同命令。只需补译时加 `--skip-crawl`，无需手动修改历史报告或新增卡牌文件。不要删除缓存来解决普通网络错误。

自动结构校验不能替代翻译质量审校；生成内容是机器翻译。费用按真实输入/输出 token 与供应商当前模型价格计算，不沿用旧文档中的固定单卡报价或一秒一张耗时估计。

## 验证

```powershell
npm run test:update
npm run test:python
npm run build
```

也可用 `python scripts/check_translation_quality.py --codes LO-6971 LO-6963` 检查指定卡牌，`--all` 检查整个库。该工具检查术语和结构，不判断复杂效果的语义是否翻译准确。

回归测试使用临时数据库和模拟 API，覆盖历史缺译、异画复用、断点重试、截断/费用符号保护、保留精翻、空效果及 dry-run 无 API 调用。

DeepSeek 接口说明：https://api-docs.deepseek.com/api/create-chat-completion/


## 云端定时运行

GitHub Actions 的 `Daily card and deck maintenance` 已启用，每天 UTC 20:20（北京时间次日 04:20）先执行本脚本的 `--catalog --no-git`，再构建校验，仅在数据变化且校验成功时自动提交/推送三份卡牌 JSON 到预览分支。完成后继续官网卡组增量采集。手动触发入口在仓库 Actions 中，支持 all/cards/decks 范围。

云端从 Secret 读取 DeepSeek 密钥，使用临时 GITHUB_TOKEN 推送。成功译文跨运行缓存，失败不推送部分数据库；报告保留 7 天。`validate_only` 只跳过卡牌抓取与翻译，卡组仍按 limit 实际同步。定时运行使用完整流程，GitHub 排队可能使实际启动略晚于计划时间。
