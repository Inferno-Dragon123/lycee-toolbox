# 加密备份、COS 配置与恢复

2026-10-04，`lycee-backup.timer` 已启用，每天北京时间 03:40 左右执行完整数据库备份、临时 PostgreSQL 18 库真实恢复验证、内部 SHA-256 校验及 age 公钥加密。`BACKUP_REQUIRE_ENCRYPTION=1`，加密缺少公钥时任务失败。备份含业务、本地 Auth 和 `/etc/lycee` 私有配置，不复制图片；卡图由镜像任务管理。

服务器 `/etc/lycee/backup-recipient.txt` 只有 age 公钥。恢复私钥仅保存在维护者电脑 `D:/Backups/lycee-toolbox/20261004/backup-recovery.agekey`，不上传服务器、COS 或 Git。服务器本地明文文件为 root 0600、目录 0700，保留 14 天；异机只发送 `.tar.age` 密文和 `.sha256` sidecar。

已下载并验收的 `20261004T030403Z-135977.tar.age` 为 286,984 字节，SHA-256 为 `0534c60094ef56ae5a900a9f016dee21b3bcc97e2550cdec7fce82923135dead`。该密文和 sidecar 经真实 COS PUT／HEAD／GET 校验，并从 Windows 直接下载，使用核验官方资产 SHA-256 的 age v1.3.2 解密，四个内部文件校验通过；`verification.json` 记录真实恢复 707 条发布、683 份快照。证据为同目录的 `verification-20261004T030403Z-135977.json`。本文用该份作为稳定恢复示例，实际恢复时选择所需时间点。

**用户已授权且自动 COS 备份已验收启用，无需重复确认。** 启用配置后再次手动启动备份服务成功，生成 `20261004T032916Z-145357`，密文 SHA-256 `727db36ac0bef147bba7058151d9db2cbaa5e83d1bdab57b940adcf731af4951`，输出 `offsiteVerified=true`。北京时间 03:40 的定时器 enabled，后续自动备份使用相同流程。

## 已启用的 COS 目标

当前桶为 `lycee-bak-20261004-1458291053`、上海 `ap-shanghai`、STANDARD，私有 owner-only ACL 与 COS 原生匿名 Deny；`lycee-backups/` 前缀 30 天生命周期已配置并读回。专用 API-only CAM 用户 `lycee-cos-backup-20261004` 无控制台登录或组，只授权该前缀的 PutObject／HeadObject／GetObject；服务器 `/etc/lycee/cos-backup.json` 为 root:root 0600。`deployment/cos-backup.py` 的 11 项模拟边界测试在 Windows／Ubuntu 通过，真实上传、回读及下载恢复也已验收。

最小权限已实测：匿名对象 HEAD、备份身份跨前缀 HEAD 和 ListBucket GET 均返回 403，同一凭据对授权前缀的 PUT／HEAD／GET 返回 200。从 COS 下载并在电脑解密的 `database.dump` 经 SSH stdin 恢复到新的独立临时 PostgreSQL 18 库，核验 707 条发布、683 份快照、5 个 Auth 用户、0 个无对应用户的投稿归属；完成后清理临时库，原生产演练库保持不变。证据为 `D:/Backups/lycee-toolbox/20261004/cos-20261004T030403Z-135977/restore-verification.json`。

以下步骤供不同目标或密钥的新环境配置，现有桶及自动备份不需重建、重新审批。上传脚本自身不创建桶或修改生命周期。

推荐独立的 **上海 `ap-shanghai`、私有读写、标准存储** 桶，默认不启用版本控制。管理员在桶「基础配置 → 生命周期」添加规则：前缀 `lycee-backups/`、最后修改时间、30 天后到期删除当前版本，不沉降至低频或归档，不设对象大小下限，确保小于 64 KB 的 checksum sidecar 也能清理。若启用版本控制，另行处理历史版本和删除标记。

为备份单独创建 CAM 子用户或密钥，只授权该桶前缀的三个动作，不复用 DNS 管理密钥：

```json
{
  "version": "2.0",
  "statement": [{
    "effect": "allow",
    "action": ["name/cos:PutObject", "name/cos:HeadObject", "name/cos:GetObject"],
    "resource": ["qcs::cos:ap-shanghai:uid/APPID:BUCKET-APPID/lycee-backups/*"]
  }]
}
```

将 `APPID`、`BUCKET-APPID` 替换成实际值。运行时不需要建桶、列桶、删对象或更改策略权限，过期删除由桶生命周期执行。root 私有 `/etc/lycee/cos-backup.json` 权限 0600，使用大写字段：

```json
{
  "SecretId": "填写独立备份密钥ID",
  "SecretKey": "填写独立备份密钥",
  "Bucket": "填写完整桶名-APPID",
  "Region": "ap-shanghai",
  "Prefix": "lycee-backups"
}
```

先做离线检查，`--check` **不联网、不上传**：

```bash
sudo python3 /usr/local/lib/lycee/cos-backup.py \
  --archive /var/backups/lycee/20261004T030403Z-135977.tar.age \
  --stamp 20261004T030403Z-135977 \
  --checksum 0534c60094ef56ae5a900a9f016dee21b3bcc97e2550cdec7fce82923135dead \
  --credentials /etc/lycee/cos-backup.json --check
```

当前 `/etc/lycee/host.conf` 已设置 `BACKUP_COS_CONFIG=/etc/lycee/cos-backup.json`，手动 `systemctl start lycee-backup.service` 验收成功，每日 timer 已启用。新环境在目标及权限配置完成后按同样流程检查。实际调用上传到 `lycee-backups/<stamp>/backup.tar.age` 和对应 `.sha256`；PUT 校验 Content-MD5，随后对两份对象执行 HEAD 和实际 GET 的 SHA-256 核验，全部成功才写 `cos-verification.json`、输出 `offsiteVerified=true`。错误使整次备份报告失败，不把 ETag 当成内容校验；迁到其他目标也需实际下载恢复核验。

本项目 Lighthouse 到当前默认 COS endpoint 已实测解析为内部 DNS `169.254.0.47`；迁到其他机器或地域时应重新验证。存储、请求及可能的公网下载仍按 COS 规则计费，内网解析不代表所有服务项目免费。

## 本机解密与恢复演练

先下载密文及 sidecar，恢复私钥留在电脑。COS 对象名为 `backup.tar.age`，手工下载的服务器备份名为 `<stamp>.tar.age`，保留配对文件或按实际名称修改下列变量。使用已核验的官方 age，解密目录限本人访问；不要把解密后的配置、数据库或私钥放进项目目录。

```powershell
$backupDir = 'D:/Backups/lycee-toolbox/20261004'
$archiveName = '20261004T030403Z-135977.tar.age'
$archive = Join-Path $backupDir $archiveName
$checksumLine = (Get-Content ($archive + '.sha256') -Raw).Trim()
$expected = ($checksumLine -split '\s+', 2)[0]
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw '密文校验失败' }
$recoveryDir = Join-Path $backupDir 'recovery-20261004T030403Z-135977'
New-Item -ItemType Directory -Path $recoveryDir -ErrorAction Stop | Out-Null
$recoverySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $recoveryDir /inheritance:r /grant:r "*${recoverySid}:(OI)(CI)F"
age --decrypt --identity (Join-Path $backupDir 'backup-recovery.agekey') --output (Join-Path $recoveryDir 'backup.tar') $archive
if ($LASTEXITCODE -ne 0) { throw 'age 解密失败' }
tar -xf (Join-Path $recoveryDir 'backup.tar') -C $recoveryDir
if ($LASTEXITCODE -ne 0) { throw '归档解包失败' }
foreach ($line in Get-Content (Join-Path $recoveryDir 'SHA256SUMS')) {
    if ($line -notmatch '^([0-9a-f]{64})  (database\.dump|private-config\.tar\.gz|verification\.json)$') { throw '内部校验清单无效' }
    $wanted = $Matches[1]; $fileName = $Matches[2]
    if ((Get-FileHash (Join-Path $recoveryDir $fileName) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wanted) { throw "内部校验失败：$fileName" }
}
```

解密后应有 `database.dump`、`private-config.tar.gz`、`verification.json` 和 `SHA256SUMS`。内部校验通过再用 PostgreSQL 18 的工具恢复至独立演练库；不要直接覆盖正在写入的正式库。以下在隔离 Linux 恢复环境执行，先将已验证的 dump 安全传入，由 root 通过 stdin 提供，不放宽私有目录：

```bash
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole lycee_restore_drill_owner
sudo -u postgres createdb --owner=lycee_restore_drill_owner lycee_restore_drill_20261004
sudo sh -c 'runuser -u postgres -- pg_restore --exit-on-error --single-transaction --no-owner --no-acl --role=lycee_restore_drill_owner --dbname=lycee_restore_drill_20261004 < /private/recovery/database.dump'
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d lycee_restore_drill_20261004 <<'SQL'
SELECT count(*) AS publications FROM toolbox_publications;
SELECT count(*) AS snapshots FROM toolbox_decks;
SELECT count(*) AS users FROM toolbox_auth_users;
SELECT count(*) AS missing_or_stale FROM toolbox_publications p
LEFT JOIN toolbox_publication_compositions c ON c.publication_id=p.id
WHERE p.status<>'deleted' AND (c.publication_id IS NULL OR c.snapshot_id<>p.snapshot_id);
SELECT count(*) AS orphaned_owners FROM toolbox_publications p
LEFT JOIN toolbox_auth_users u ON u.id=p.owner_id
WHERE p.owner_id IS NOT NULL AND u.id IS NULL;
SQL
```

核对行数与该备份的 `verification.json`，检查构成索引、旧用户 ID、投稿归属、昵称、管理员和登录；演练站关闭维护写入、使用独立 origin，不混入正式访问。完整业务行指纹可用 `scripts/db-audit.js` 生成，若有**同备份时点**的原始审计报告，使用 `--compare` 比较；`verification.json` 本身只有恢复行数，不能替代全行指纹比较。

正式恢复前先冻结写入、停止同步任务，并另备份当前库；确认需要处理的新增数据和恢复时间点，再恢复到新数据库、审计、切换应用连接和健康检查，最后才恢复写入。不要自动覆盖旧私有配置和 live 开关，按现有系统用户/权限逐项恢复；**DNS 回切不能搬回新站已产生的新增写入**，需要先同步这些数据或采用明确的数据恢复方案。

官方依据：[COS 授权动作](https://cloud.tencent.com/document/product/598/69901)、[HeadObject 权限](https://cloud.tencent.com/document/product/436/31923)、[生命周期配置](https://cloud.tencent.com/document/product/436/17031)、[COS 内网访问](https://cloud.tencent.com/document/product/436/6224)、[费用说明](https://cloud.tencent.com/document/product/436/53863)。
