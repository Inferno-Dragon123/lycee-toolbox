# 腾讯云原生部署与迁移运行手册

本目录提供可执行的原生部署脚本：GitHub Actions 在 Linux 构建前端和运行依赖，通过 SSH/rsync 上传归档；服务器运行 Node.js、Nginx 和本机 PostgreSQL，由 systemd 管理。服务器无需 Docker、面板、GitHub git clone 或 Puppeteer 浏览器。

2026-10-04 实测目标为腾讯 Lighthouse 轻量应用服务器，系统 Ubuntu 26.04 LTS x86_64、2 vCPU、约 3.6 GiB 可用物理内存、2 GiB Swap、约 69 GB 磁盘，运行 Node.js 24.21.0、PostgreSQL 18.6；源 Neon 也是 PostgreSQL 18.6。原生部署、生产演练和分支自动预览已执行；备案审核期间正式访问和写入仍为 Vercel/Neon，`master` 为 `21ff737`。

## 当前验收状态（2026-10-04）

- 迁移工作树 `C:/Users/35057/.codex/worktrees/migration-20261004/lycee-toolbox`，分支 `codex/tencent-migration-20261004`，最新已验运行版本为 `1414ff0`。该版本已通过目标 Ubuntu 完整构建和 69 项 JavaScript、9 项 DNS、11 项 COS 测试，生产演练已部署完整提交 `1414ff028a63b0e61c3c4edccafddab1b75ee351`；SSH 隧道 `/api/health` 返回 200 且显示实际 revision `1414ff0`，生产演练、预览两项应用服务和持久镜像服务 active。第二次预览 [Actions 37173420807](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/runs/37173420807) 已成功，固定地址自动更新到该版本。
- 首次提交 `2e101b0` 的 [Actions 运行 37171459769](https://github.com/Inferno-Dragon123/lycee-toolbox/actions/runs/37171459769) 成功，地址为 [p-5b541628e000.preview.lycee-toolbox.top](https://p-5b541628e000.preview.lycee-toolbox.top/)。Lighthouse 云防火墙原未放行 443，现已补齐；公网 HTTP 返回 302，目标为 `https://dnspod.qcloud.com/static/webblock.html?d=p-5b541628e000.preview.lycee-toolbox.top`，HTTPS 握手被重置，已核实为腾讯域名拦截。**备案待通过，公网访问尚未验收；应用无需因此修改。**
- 本机生产演练已恢复业务数据，8 张业务表的行数和内容指纹与 Neon 一致：707 条发布、683 份卡组快照；`1414ff0` 部署后复审 `changedTables=[]`，构成索引缺失／过期为 0，数据库约 13.1 MB。5 个原账号按旧用户 ID 导入本地 Auth，昵称、投稿和权限关联保留，旧会话不迁移，切换后须重新登录。
- 预览已采用独立数据库与空 Auth，种子库只有 706 套官网公开卡组；无真实用户、社区投稿、私有快照或同步队列。预览不共用生产身份、认证密钥或数据库，只共用 Resend 发信凭据。
- Resend 使用原 Sending access key，通过 SMTP 发送，发件地址为 `noreply@notifications.lycee-toolbox.top`；标题为「Lycee 工具箱迁移邮件测试」的真实测试邮件已送达。维护者随后在 `http://127.0.0.1:3310/` 亲测原邮箱 OTP 登录、刷新及原昵称／自己的卡组均正常。正式 Vercel/Neon 仍使用原 Neon 共享 SMTP。
- 9,957 个卡图／卡背目标由持久 `lycee-initial-images.service` 按官网间隔镜像中，已 enabled/active，重启后根据断点继续，尚未全量完成。每日 05:20 的增量定时器已启用，实机验证检测到初始任务 active 时正常跳过。缺失本地图仍由现有回源路径处理，不把持久运行和全量下载混为完成。
- 备份已在临时 PostgreSQL 数据库真实恢复验证，每次以 age 公钥加密，`BACKUP_REQUIRE_ENCRYPTION=1`，每日 03:40 的定时器已启用。已下载并验收的 `20261004T030403Z-135977.tar.age`（286,984 字节）在本机解密后验证四个文件的内部 SHA-256，恢复记录为 707 条发布、683 份快照；密文 SHA-256 为 `0534c60094ef56ae5a900a9f016dee21b3bcc97e2550cdec7fce82923135dead`。本机证据见 `D:/Backups/lycee-toolbox/20261004/verification-20261004T030403Z-135977.json`。后续部署又生成 `20261004T031824Z-141534` 备份，前一份用作稳定的恢复示例，不表示始终是最新备份。
- COS 已按用户授权配置并真实验收：上海 `ap-shanghai` 标准桶 `lycee-bak-20261004-1458291053`，私有 ACL 和匿名 Deny，`lycee-backups/` 前缀 30 天生命周期；独立 API-only CAM 仅三项动作及该前缀，root 0600 凭据。服务器默认 endpoint 实测内部 DNS `169.254.0.47`。首份密文真实 PUT／HEAD／GET 及 Windows 从 COS 下载解密验证成功；启用 `BACKUP_COS_CONFIG` 后备份任务再次成功，`offsiteVerified=true`，每天 03:40 自动异机备份已启用。备份详情见 [备份说明](tencent-backups.md)。
- COS 匿名／跨前缀／列桶请求实测 403，授权前缀三动作 200；下载密文解密后的 dump 又在独立临时 PG18 库真恢复，707 条发布、683 份快照、5 个 Auth 用户和 0 orphaned owners，恢复演练已清理且保留原生产演练库。
- `certbot.timer` 已启用，三域名真实 `dry-run` 返回 exit 0，TXT 挑战均清理，deploy hook 的 `nginx -t`／reload 成功；正在使用的正式 YE1 证书仍有效至 2027-01-01，没有被 staging 证书替换。

最终切换仍待备案、冻结旧写入、最终同步和内容审计、DNS 切换及唯一写入开关。以下为运维步骤和配置规范，初次检查及初始化命令不应在现有环境重复执行。

## 布局与隔离

| 内容 | 路径或规则 |
| --- | --- |
| 受信任控制平面 | `/usr/local/lib/lycee/`、`/usr/local/sbin/lycee-admin`，root 所有，仅运维人员更新 |
| 主机配置 | `/etc/lycee/host.conf`，root:root 0600 |
| 各环境密钥 | `/etc/lycee/instances/production.env`、`p-<hash>.env`，root:对应应用组 0640，父目录仅 root 可访问 |
| 不可变发布目录 | `/opt/lycee/instances/<target>/releases/<commit>-<timestamp>/` |
| 当前版本指针 | `/opt/lycee/instances/<target>/current`，原子切换符号链接 |
| 应用可写状态 | `/var/lib/lycee/production/` 或 `/var/lib/lycee/p-<hash>/`，运行用户独有；发布包中的 `temp` 指向此处 |
| 公共图片 | `/var/lib/lycee/images/original/`、`thumb/`，`lycee-assets` 写，应用与 Nginx 的 assets 组只读 |
| 上传目录 | `/var/lib/lycee/incoming/production/` 与 `preview/`，分别归独立 SSH 发布账户 |
| 生产数据库/角色 | `lycee_production`，仅 localhost，不向公网开放 5432 |
| 预览数据库/角色 | `lycee_preview_<12hex>`，每个分支独立，禁止连接或借用生产 Auth、数据库凭据 |
| 生产运行用户 | `lycee-production` |
| 预览运行用户 | `lycee-p-<12hex>`，无 shell，与其他预览用户和生产用户相互独立 |
| 生产 SSH 账户 | `lycee-release`，只能通过受限管理器部署 live `master` |
| 预览 SSH 账户 | `lycee-deploy`，只能部署/清理预览，服务器硬拒绝生产、初始化和全局清理 |

分支名按 UTF-8 做 SHA-256，取前 12 位形成稳定地址 `https://p-<hash>.preview.lycee-toolbox.top`。最多保留两个预览，各 `MemoryMax=384M`、`CPUQuota=30%`；第三个预览拒绝部署并提示先删除。管理器提供清理服务、数据库、环境密钥、发布目录和运行用户的功能；GitHub 分支删除事件要待工作流进入默认 `master` 后验收，当前只验收了真实 push 部署。七天未部署的预览由过期清理定时器处理。预览图片采用自己的同源 URL，但读取共享图片目录，不额外复制卡图。

预览初始为空库，可用专门的只读来源角色和 `scripts/seed-preview.js` 复制官网公开卡组、它们引用的快照和构成索引；当前预览已种入 706 套官网公开卡组。该脚本要求 `DEPLOYMENT_KIND=preview`、目标数据库名符合上述规则、来源与目标不同，并以来源只读事务读取。用户投稿、身份、昵称、匿名分享和同步队列都不迁入预览。生产 `.env` 不会被复制到预览；SMTP 仅按白名单显式配置，当前预览与演练共用 Resend 发信凭据，这不构成独立 SMTP 账号。未配 SMTP 的新预览仍可浏览和通过健康检查，发验证码则提示发信服务未配置。

## 初始化与检查

脚本支持 Ubuntu 24.04/26.04 LTS x86_64 和 systemd；要求 PostgreSQL 18 软件包可用，发现其他版本的既有集群会停止，不自动升级。其他发行版或 ARM 需要单独验证。安装前审查脚本，以 `--check` 查看，不会改动主机。`--apply` 才安装软件、用户或受信任控制文件；已有的无管理标记文件和非预期链接会被拒绝覆盖，不修改 `nginx.conf`、已有网站或防火墙。

```bash
sudo bash deployment/bootstrap-host.sh --check
sudo bash deployment/bootstrap-host.sh --apply
sudo bash deployment/install-control-plane.sh --check
sudo bash deployment/install-control-plane.sh --apply
sudo install -m 0600 deployment/host.conf.example /etc/lycee/host.conf
# 首次初始化；已存在的数据库、角色或环境文件会拒绝覆盖。
sudo /usr/local/sbin/lycee-admin init-production --origin http://127.0.0.1:3310
```

编辑 root 专有配置并保留 `MIGRATION_LIVE=0`。Node 首次安装从 `nodejs.org` 获取 v24 二进制并校验官方 SHA-256，不执行第三方安装脚本。控制平面安装只启动预览过期清理；应用、备份、卡组同步和图片定时器须单独启用。Nginx、运行时用户和候选健康检查进程均通过 `lycee-assets` 组读取 0640 图片文件；图片 worker 通过 ACL 读取生产版本的代码和卡库，不能读取生产 `.env`。

首次导入业务备份应使用与源同大版本的 `pg_dump`/`pg_restore`。目标角色已创建后，以数据库管理员恢复、将所有权归目标角色；业务导出须排除旧 Neon Auth 和本地 `toolbox_auth_*`，身份保留旧用户 ID 的映射由独立账号导入脚本处理。不要把现有目标库当作可覆盖的空库。

```bash
# 仅针对已确认的空演练库；私有备份路径由运维填写。
sudo -u postgres pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --role=lycee_production --dbname=lycee_production /path/to/business.dump
```

备份文件必须能被执行恢复的身份读取；若私有目录只有 root 权限，可由 root 将文件通过 stdin 交给 `runuser -u postgres -- pg_restore ...`，无需放宽目录。恢复后核对发布、快照、昵称、管理员归属及数据库审计；本地 Auth 迁移和用户 ID 导入完成前不开放真实登录。

## 首次演练与发布

在 Ubuntu x86_64 的可信 CI/构建机运行，输出 Linux 原生依赖。`build-release.sh` 执行 `npm ci`、构建和 JavaScript 测试，再移除开发依赖；跳过 Puppeteer 浏览器下载。只打包白名单运行目录，包含 PDF 字体，排除 `.env*`，不收录工作区根目录的 SSH 私钥、备份和 `temp`。

发布归档统一 tar 排序、时间戳和所有者，使用 `gzip -n --rsyncable`；`upload-release.sh` 通过已核验的 SSH 使用 rsync 增量传输，两个发布账户各保留一份 `incoming/<environment>/runtime-cache.tar.gz`，不随分支数增长。中断文件留在 `.rsync-partial/`，后续尝试可利用完整或部分基准；不使用 `--inplace`。每次最多三次 15 分钟传输尝试，工作流总上限 60 分钟；传输成功后核验远端完整 SHA-256，再原子生成部署管理器使用的 `<commit>.tar.gz`。校验或传输失败不触发部署，保留现有运行版本。此前跨境 scp 实测约 33 KiB/s，25 分钟上限不足以传完完整依赖包，因此改为可续传机制。

```bash
sha=$(git rev-parse HEAD)
bash deployment/build-release.sh "$sha" "/tmp/$sha.tar.gz"
# 通过运维 SSH 上传，再由 root 放入 production 上传目录。
sudo install -m 0600 "/path/to/$sha.tar.gz" "/var/lib/lycee/incoming/production/$sha.tar.gz"
# MIGRATION_LIVE=0 时只有运维 root 能显式进行演练。
sudo /usr/local/sbin/lycee-admin deploy --target production --sha "$sha" --ref-hex 6d6173746572 --rehearsal
```

`--ref-hex` 是分支 UTF-8 的十六进制；`6d6173746572` 为 `master`。归档解包使用 Python `data` 安全过滤和白名单，拒绝路径越界、危险链接、设备和环境文件，核对完整提交号与 Node 主版本，并检查字体、浏览器 bundle 及迁移入口。解包后的代码 root 所有，应用不能修改当前版本、控制脚本或下次部署。

部署首先备份生产数据库并在独立临时数据库真实恢复验证，然后以应用用户执行业务迁移、本地 Auth 迁移（显式主机 guard/`--apply`）和必要的缺失构成索引补建。候选实例先在 loopback 临时端口执行 `/api/health`，检查卡库、数据库及认证 schema；SMTP 未配置不会伪装成数据库故障。候选通过后才切换 `current`、重启正式实例、再次检查 readiness，最后 `nginx -t` 并 reload。失败恢复旧 `current` 和旧服务；初次部署失败则停止新服务。

**回滚恢复应用代码，不自动回滚数据库。** 当前迁移为可兼容的新增 schema；未来删表、删列、重写含义等操作必须先设计备份恢复及旧代码兼容，不能直接套用这套自动回滚。保留当前及两个旧版本。systemd 的停止超时为 130 秒，允许应用完成正在生成的 PDF；日常部署仍会有短暂重启。

备案等待期间，`SITE_ORIGIN=http://127.0.0.1:3310`；Nginx 只为演练监听 loopback 80，Node 监听 loopback 3100。公网 HTTP IP 不作为演练 origin。

```bash
# 在本机终端保持隧道，浏览器访问 http://127.0.0.1:3310。
ssh -N -L 3310:127.0.0.1:80 ubuntu@SERVER_IP
```

Nginx 保留外部 Host（含隧道端口）、设置 `X-Real-IP` 和 scheme、清空客户端 `X-Forwarded-For`。应用仅在 loopback 代理连接时信任真实 IP。普通 HTML/CSS/JS/JSON 开启 gzip，Auth 响应关闭 gzip。只公开合法卡号的 `original/*.png`、`thumb/*.webp` 和卡背；缺失图片转 Node 处理官网回源，`.mirror-state.json`、锁文件和其他路径不公开。

## HTTPS、域名与正式切换

DNSPod 的现有记录应先导出留存。备案审核通过和演练验收前，不让国内新服务器与旧 Vercel A 记录混合轮询。正式域名仍为 `lycee-toolbox.top`，预览为 `*.preview.lycee-toolbox.top`。使用 DNS-01 申请覆盖 apex 及预览通配符的证书，不需要提前把业务 A 记录指到新服务器；DNS API 凭据仅保存于 root 私有目录，不进入应用和 Actions 归档。证书及密钥路径填写到 `host.conf` 的生产/预览 TLS 字段。

证书续期 hook 必须先检查证书文件及 `nginx -t`，成功后 reload。通配符需 DNS-01，不能改用 HTTP-01 获取通配符。DNSPod API 与 ACME hook 由本项目独立运维脚本维护；`certbot.timer` 已启用，以下真实模拟续期已成功（exit 0）：

```bash
sudo certbot renew --cert-name lycee-toolbox.top --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

三个域名的 TXT 挑战全部清理，hook `nginx -t` 和 reload 成功；正式 YE1 证书仍在使用，有效至 2027-01-01，staging 模拟没有替换正式证书。这不代表待备案域名的公网业务已可访问。云主机安全组/防火墙的 80、443 放行由运维核对，5432 和应用端口继续仅 loopback。

正式切换顺序：完成备案和邮件验证 → 合入迁移分支并确认 Vercel 已部署兼容旧站的版本（两个 `MIGRATION_LIVE` 仍为 0）→ 暂停旧站写入及旧数据库同步 → 最终业务/身份同步并审计 → 更新 `SITE_ORIGIN`、图片 origin 和证书 → 国内 HTTPS 验收 → 切换 DNS → 确认只剩一个写入源 → 最后把服务器 `MIGRATION_LIVE=1` 与 GitHub variable `MIGRATION_LIVE=1` 打开。演练已产生的数据不直接覆盖旧站最终增量；新站开始真实写入后，回切 Vercel 必须处理新增数据。

旧站冻结须在含 `lib/http.js` 维护开关的新版本已部署后，设置 Vercel Production 的 `MIGRATION_READ_ONLY=1` 并重新部署，核验保存／社区／登录 POST 返回维护 503、读取仍正常。冻结期间暂时停用 `Daily card and deck maintenance` 工作流，取消或等候已在执行的旧 sync，确认没有写入后再导出最终快照。切换完成、正式 `MIGRATION_LIVE=1` 条件生效且旧数据库 Secret 移除后，再恢复该工作流的卡库抓取和翻译；本机数据库同步定时器在这之后启用。不能仅设置环境变量而不确认旧部署代码已支持，也不能只停新任务而遗漏运行中的旧任务。

## GitHub 自动部署

工作流为 `.github/workflows/tencent-deploy.yml`。设计为启用 repository variable `TENCENT_DEPLOY_ENABLED=1` 后，push `master` 部署生产，其他分支 push 和同仓库 PR 生成稳定预览；fork PR 跳过含密钥的任务，不使用 `pull_request_target`，不发送 PR 评论。成功地址写入 GitHub Job Summary。迁移分支真实 push 已通过；生产开关仍关闭，工作流尚未进入默认 `master`，分支删除自动清理与 `workflow_run` 触发须合入后分别验收，不能记为当前已运行。

配置两个 GitHub Environments：

- `tencent-production`：允许部署分支 **仅 `master`**，独立的 `lycee-release` SSH 密钥。
- `tencent-preview`：同仓库预览分支，独立的 `lycee-deploy` SSH 密钥。

各 Environment 配置同名 Secrets：`TENCENT_SSH_HOST`、`TENCENT_SSH_PORT`（默认 22）、`TENCENT_SSH_USER`、`TENCENT_SSH_KEY`、`TENCENT_SSH_KNOWN_HOSTS`。不要给预览 Environment 生产 key。known_hosts 的主机指纹必须经可信渠道核对，不在部署时用未验证的 `ssh-keyscan` 自动接受。两个用户只能 sudo root 所有的验证管理器，不授权 shell、`systemctl`、编辑器或任意脚本；建议 SSH authorized_keys 配置 `restrict`，不允许端口转发或代理转发，运维隧道继续使用独立 ubuntu 账户。

生产还受服务器 `MIGRATION_LIVE=1` 开关和 SSH 身份/`master` ref guard 限制。即使预览工作流把参数改成 `--target production`，服务器也会拒绝。

每日卡库抓取/翻译/提交继续在 GitHub 运行。GitHub 的 `GITHUB_TOKEN` 推送不会自动引发另一个 push 工作流，因此代码提供受限 `workflow_run`：只接受已有 `Daily card and deck maintenance` 的成功 `master` 完成事件，重新 checkout 可信 `master` 构建部署，不使用前一个运行上传的代码或 artifact；该事件要在工作流进入默认分支后验收。本轮迁移分支已为旧数据库 sync job 加入 `vars.MIGRATION_LIVE != '1'` 条件，当前正式 `master` 尚未含此迁移改动；切换前须确认条件已正式部署、关闭旧 Neon sync 并删除 `PRODUCTION_SYNC_DATABASE_URL` CI Secret，保留 cards job。服务器不需从 GitHub clone，也不将本机数据库暴露给 GitHub。

## 备份、更新与日志

`lycee-backup.timer` 已启用，每天北京时间 03:40 左右执行完整本地 PostgreSQL 备份和 root 私有配置归档。每份数据库 dump 都在临时数据库真实恢复并查询发布/快照表，再计算 SHA-256 和 age 加密；`BACKUP_REQUIRE_ENCRYPTION=1` 缺公钥时会失败。服务器本地明文备份文件权限 0600、目录 0700，保留 14 天，异机只发送密文及 SHA-256 sidecar；备份不包含卡图。服务器 `/etc/lycee/backup-recipient.txt` 仅保存公钥，恢复私钥 `backup-recovery.agekey` 只在维护者电脑，详情见 [备份与恢复](tencent-backups.md)。

当前异机目标为已授权且已验收启用的上海私有 COS，`BACKUP_COS_CONFIG=/etc/lycee/cos-backup.json`。首份 `20261004T030403Z-135977` 经真实上传、HEAD／GET 校验和 Windows 直接从 COS 下载解密验收；随后 `systemctl start lycee-backup.service` 生成 `20261004T032916Z-145357`，密文 SHA-256 为 `727db36ac0bef147bba7058151d9db2cbaa5e83d1bdab57b940adcf731af4951`，返回 `offsiteVerified=true`。每日备份定时器已启用，不需重复确认；新环境配置步骤见 [COS 备份说明](tencent-backups.md)。

`BACKUP_OFFSITE` 另支持独立机器的 `user@host:/absolute/path`，使用 root 专用受限 SSH key 和核验的 known_hosts；rsync 密文和 sidecar 后在异机执行 `sha256sum --check`，成功才记 `offsite-verified`。该 SSH 目标属于可选替代，不代替当前已启用的 COS。

```bash
sudo /usr/local/lib/lycee/backup.sh
sudo systemctl enable --now lycee-backup.timer
sudo systemctl list-timers 'lycee-*'
```

`lycee-maintenance.timer` 在北京时间 04:35 左右增量同步官方卡组到本机生产库；先在 production.env 设置 `MAINTENANCE_ENABLED=1`，确认旧 Neon sync job 已停，再启用。共享卡库更新仍来自 GitHub 发布，不在服务器运行整库翻译或编译。

```bash
sudo systemctl enable --now lycee-maintenance.timer
# 持久初次镜像已经启用，查看进度；不要另启动第二个全量进程。
sudo systemctl status lycee-initial-images.service
sudo journalctl -u lycee-initial-images.service -n 50 --no-pager
```

卡图定时维护读取 root 私有 `/etc/lycee/images.env` 中的 `IMAGE_MIRROR_ENABLED=1`；`lycee-images.timer` 已启用，每天北京时间 05:20 左右只补最多 100 张。实机已验证初始任务 active 时增量正常跳过，避免竞争。`/etc/systemd/system/lycee-initial-images.service` 已 enabled/active，开机恢复断点；全量尚未结束。更新原图用显式 `--refresh-code`/`--refresh-all` 和稳定 `--refresh-revision`，不要把每日增量任务改成反复全量刷新。状态与锁在图片目录内，预览和应用只读。

```bash
sudo systemctl enable --now lycee-images.timer
sudo journalctl -u lycee@production -n 100 --no-pager
sudo journalctl -u lycee-backup -u lycee-maintenance -u lycee-images --since today
sudo nginx -t
sudo /usr/local/sbin/lycee-admin check
```

应用与任务日志写入 systemd journal；管理的 drop-in 将 journal 磁盘上限设为 250 MB、最长 14 天并保留至少 2 GB 空间。Nginx 按 Ubuntu 自带 `/etc/logrotate.d/nginx` 轮转 `/var/log/nginx/*.log`，不再添加重复匹配的规则。预览内存 384 MB 为硬上限，PDF 同时一份；生产上限 1,100 MB，为数据库、两个预览和候选启动保留余量。若两套预览和图片/维护任务同时发生内存压力，优先停止非必要预览或错开任务，再根据实测调整限额。

## 资料依据与验收边界

实现参照官方资料：

- [GitHub：触发工作流的事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)（fork PR 密钥边界、delete 与 workflow_run）。
- [GitHub：GITHUB_TOKEN 身份验证](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) 与 [从工作流触发工作流](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)（避免漏部署卡库更新）。
- [GitHub：部署 Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)（Environment secrets 和部署分支限制）。
- [Nginx：proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) 与 [core 模块](https://nginx.org/en/docs/http/ngx_http_core_module.html)（保留 Host、真实 IP、缺图 `try_files` 转 named location）。
- [systemd.service 官方手册源](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml) 和 [资源限制官方手册源](https://github.com/systemd/systemd/blob/main/man/systemd.resource-control.xml)（ExecStart、重启、MemoryMax、CPUQuota）。官网 man 页面本次返回 HTTP 418，已改查官方仓库原文。
- [Let's Encrypt：挑战类型](https://letsencrypt.org/docs/challenge-types/)（DNS-01 与通配符）。

本机 Bash 语法、Python 编译和 YAML 解析用于脚本静态检查。目标 Ubuntu 完整构建及 69 项 JavaScript、9 项 DNS、11 项 COS 测试已通过；生产演练部署的 `1414ff0` 健康检查显示实际提交。数据指纹、本地 Auth 用户 ID、真实邮件及原账号 OTP、独立预览、两次 Actions、备份真实恢复、COS 实际上传／回读及电脑从 COS 下载解密均已验收；持久镜像和每日加密异机备份已启用，增量跳过初始任务与证书真实续期模拟也已实机核验。完整 9,957 个图片目标仍在后台镜像。云防火墙 443 已放行，公网域名拦截已定位；正式切换仍待备案通过、最终快照同步与审计、合入 `master`、DNS 及唯一写入开关。最新接续状态见 [社区维护记录](community-decks.md)。
