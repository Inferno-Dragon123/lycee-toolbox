# 腾讯云原生部署与迁移运行手册

本目录提供可执行的原生部署脚本：GitHub Actions 在 Linux 构建前端和运行依赖，通过 SSH 上传归档；服务器运行 Node.js、Nginx 和本机 PostgreSQL，由 systemd 管理。服务器无需 Docker、面板、GitHub git clone 或 Puppeteer 浏览器。

2026-10-04 迁移准备阶段实测目标为 Ubuntu 26.04 LTS x86_64、2 vCPU、约 3.6 GiB 可用物理内存、2 GiB Swap、约 69 GB 磁盘。基础软件已验证 Node.js 24.21.0、PostgreSQL 18.6；源 Neon 也是 PostgreSQL 18.6。以下完整自动部署、HTTPS 和定时任务仍须逐项验收，不能以基础软件安装代表正式切换。备案审核期间保留 Vercel 的正式访问和写入源，国内站先经 SSH 隧道演练。

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

分支名按 UTF-8 做 SHA-256，取前 12 位形成稳定地址 `https://p-<hash>.preview.lycee-toolbox.top`。最多保留两个预览，各 `MemoryMax=384M`、`CPUQuota=30%`；第三个预览拒绝部署并提示先删除。分支删除会清理服务、数据库、环境密钥、发布目录和运行用户；七天未部署的预览由过期清理定时器删除。预览图片采用自己的同源 URL，但读取共享图片目录，不额外复制卡图。

预览初始为空库，可选用专门的只读来源角色和 `scripts/seed-preview.js` 复制官网公开卡组、它们引用的快照和构成索引。该脚本要求 `DEPLOYMENT_KIND=preview`、目标数据库名符合上述规则、来源与目标不同，并以来源只读事务读取。用户投稿、身份、昵称、匿名分享和同步队列都不迁入预览。生产 `.env` 不会被复制到预览；预览只可使用独立 SMTP 账号，默认不配置 SMTP，浏览和健康检查仍正常，发验证码会提示尚未配置发信服务。

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

证书续期 hook 必须先检查证书文件及 `nginx -t`，成功后 reload。通配符需 DNS-01，不能改用 HTTP-01 获取通配符。DNSPod API 与 ACME hook 由本项目独立运维脚本维护，首次签发和模拟续期成功后才启用定时续期；云主机安全组/防火墙的 80、443 放行由运维核对，5432 和应用端口继续仅 loopback。

正式切换顺序：完成备案和邮件验证 → 暂停旧站写入及旧数据库同步 → 最终业务/身份同步并审计 → 更新 `SITE_ORIGIN`、图片 origin 和证书 → 国内 HTTPS 验收 → 切换 DNS → 确认只剩一个写入源 → 最后把服务器 `MIGRATION_LIVE=1` 与 GitHub variable `MIGRATION_LIVE=1` 打开。演练已产生的数据不直接覆盖旧站最终增量；新站开始真实写入后，回切 Vercel 必须处理新增数据。

## GitHub 自动部署

工作流为 `.github/workflows/tencent-deploy.yml`。启用 repository variable `TENCENT_DEPLOY_ENABLED=1` 后，push `master` 部署生产，其他分支 push 和同仓库 PR 生成稳定预览；fork PR 跳过含密钥的任务，不使用 `pull_request_target`，不发送 PR 评论。成功地址写入 GitHub Job Summary。删除分支触发对应预览清理，预览最多两个，自动过期七天。

配置两个 GitHub Environments：

- `tencent-production`：允许部署分支 **仅 `master`**，独立的 `lycee-release` SSH 密钥。
- `tencent-preview`：同仓库预览分支，独立的 `lycee-deploy` SSH 密钥。

各 Environment 配置同名 Secrets：`TENCENT_SSH_HOST`、`TENCENT_SSH_PORT`（默认 22）、`TENCENT_SSH_USER`、`TENCENT_SSH_KEY`、`TENCENT_SSH_KNOWN_HOSTS`。不要给预览 Environment 生产 key。known_hosts 的主机指纹必须经可信渠道核对，不在部署时用未验证的 `ssh-keyscan` 自动接受。两个用户只能 sudo root 所有的验证管理器，不授权 shell、`systemctl`、编辑器或任意脚本；建议 SSH authorized_keys 配置 `restrict`，不允许端口转发或代理转发，运维隧道继续使用独立 ubuntu 账户。

生产还受服务器 `MIGRATION_LIVE=1` 开关和 SSH 身份/`master` ref guard 限制。即使预览工作流把参数改成 `--target production`，服务器也会拒绝。

每日卡库抓取/翻译/提交继续在 GitHub 运行。GitHub 的 `GITHUB_TOKEN` 推送不会自动引发另一个 push 工作流，因此新增受限 `workflow_run`：只接受已有 `Daily card and deck maintenance` 的成功 `master` 完成事件，重新 checkout 可信 `master` 构建部署，不使用前一个运行上传的代码或 artifact。切换时旧工作流的数据库 sync job 须在 `MIGRATION_LIVE=1` 后跳过，删除旧 `PRODUCTION_SYNC_DATABASE_URL` CI Secret；保留 cards job。服务器不需从 GitHub clone，也不将本机数据库暴露给 GitHub。

## 备份、更新与日志

`lycee-backup.timer` 每天北京时间 03:40 左右执行完整本地 PostgreSQL 备份和 root 私有配置归档。每份数据库 dump 都在临时数据库真实恢复并查询发布/快照表，再计算 SHA-256；本地保留 14 天。备份包含本地 Auth 和私有配置，目录权限 0700，必须按秘密管理。

`BACKUP_OFFSITE` 可配置独立机器的 `user@host:/absolute/path`，使用 root 专用受限 SSH key 和核验的 known_hosts；rsync 后在异机执行 `sha256sum --check`，成功才记 `offsite-verified`。未配置时输出 `offsiteVerified=false`，不能当作完成异机备份。当前对象存储/COS 的自动备份目标尚未选择，不声称已自动上传或加密；首次可由维护者安全下载一份已验证备份到本机，另外设计异机/COS 的权限、加密和恢复演练。

```bash
sudo /usr/local/lib/lycee/backup.sh
sudo systemctl enable --now lycee-backup.timer
sudo systemctl list-timers 'lycee-*'
```

`lycee-maintenance.timer` 在北京时间 04:35 左右增量同步官方卡组到本机生产库；先在 production.env 设置 `MAINTENANCE_ENABLED=1`，确认旧 Neon sync job 已停，再启用。共享卡库更新仍来自 GitHub 发布，不在服务器运行整库翻译或编译。

```bash
sudo systemctl enable --now lycee-maintenance.timer
# 初次全量图片抓取是长任务，默认 10 秒官网间隔，有断点和失败退避；不阻塞部署。
sudo -u lycee-assets env IMAGE_STORAGE_DIR=/var/lib/lycee/images \
  /usr/local/bin/node /opt/lycee/instances/production/current/scripts/mirror-card-images.js --all
```

卡图定时维护先创建 root 私有 `/etc/lycee/images.env`，填入 `IMAGE_MIRROR_ENABLED=1`；`lycee-images.timer` 每天北京时间 05:20 左右只补最多 100 张。更新原图用显式 `--refresh-code`/`--refresh-all` 和稳定 `--refresh-revision`，不要把每日增量任务改成反复全量刷新。状态与锁在图片目录内，预览和应用只读。首轮全量需要较长时间，可通过 systemd 的受限持久进程管理，查看进度后逐步完成。

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

本机 Bash 语法、Python 编译和 YAML 解析用于脚本静态检查；完整安装、PostgreSQL 真实恢复、SSH 权限边界、Nginx 测试、预览两个实例、健康失败回滚、SMTP、证书续期与 GitHub Actions 运行必须在目标环境验收。尚未通过的项目应保留在交接记录中，不能以静态检查冒充线上完成。
