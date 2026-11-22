# 插件市场发布信息 · 鲸鱼娘备份

以下文案可直接复制到插件市场的对应字段。按长度分成多个版本，按平台字数限制取用。

---

## 基本信息

| 字段 | 内容 |
| --- | --- |
| 插件名称 | 鲸鱼娘备份 |
| 英文名称 | Whale Girl Backup |
| 包名 / ID | `dsh-whale-backup` |
| 版本 | 0.56.0 |
| 分类 | 数据管理 / 备份恢复 |
| 许可证 | MIT |
| 图标 | `lib/assets/whale-girl.png` |
| 设置页 | 设置 → 鲸鱼娘备份 |
| 斜杠命令 | `/easybackup` |
| 运行环境 | Node.js `^22.19.0 \|\| >=24.0.0`，DeepSeek Harness `>= 0.2.0` |
| 运行时依赖 | 无 |

---

## 一句话简介

> 把 dsh 的聊天记录、插件、设置和项目文件，一键备份与找回。

备选：

> 给 DeepSeek Harness 的聊天记录、插件和设置，一个随时能回去的存档点。

---

## 简短简介（推荐用于卡片 / 列表）

> 鲸鱼娘备份为 DeepSeek Harness 提供一键备份与恢复：聊天记录、插件、插件数据、设置和项目文件都能打包到本机或 WebDAV。换电脑、重装系统、插件升级翻车，都能快速找回。

---

## 标准简介（推荐用于详情页开头）

> 鲸鱼娘备份是 DeepSeek Harness（dsh）的备份与找回插件。她把你**聊天记录、插件、插件数据、设置和项目文件**装进一个带 SHA-256 校验的压缩归档，保存在电脑或 WebDAV；换电脑、重装系统后一键找回。
>
> 支持定时自动备份、备份健康度、范围选择、恢复前安全备份、同名文件策略和邮件提醒。默认不备份账号密钥，运行时零依赖。

---

## 详情页完整介绍

### 为什么需要她

dsh 里的聊天记录、插件配置和项目文件，平时安静地躺在 `DSH_HOME` 里。一次重装、一次插件升级、一次手滑删除，就可能让几个月的积累消失。

鲸鱼娘备份把这些东西打包成一份可验证、可携带、可回滚的存档，并且尽量不打扰你。

### 主要功能

- **一键备份**：聊天记录、插件与插件代码、插件数据、设置、项目文件，一次打包。项目文件默认关闭，可按需打开。
- **本机 / WebDAV / 双写**：存本地文件夹，或上传到 Nextcloud、坚果云等 WebDAV，也可以两边各存一份。
- **范围可选**：所有项目或当前项目；全部会话、最近 N 个，或手动勾选具体会话和项目文件夹。
- **完整校验**：逐文件 SHA-256 清单 + 归档整体校验文件；恢复前可以先「检查」。
- **精细恢复**：按类别恢复，只挑需要的会话和项目文件；支持覆盖、跳过、保留较新、遇到冲突即停止四种策略。
- **恢复前安全备份**：默认先在本机留一份 `pre-restore` 快照，选错归档也能回去。
- **自动备份**：每天 / 每 N 天 / 每周 / 每月 / 每 N 小时；错过会在下次启动 dsh 后补跑。
- **备份健康度**：24 小时内为健康，1–7 天提醒，超过 7 天标红。
- **邮件提醒**：自动备份完成 / 失败、手动备份完成、恢复完成都可以发邮件。
- **多种入口**：设置页、`/easybackup` 命令、`whale-backup` CLI，另有 5 个模型工具。

### 安全与隐私

- 默认**不备份** `.credentials.yaml`、`.env` 等账号密钥；需要时必须手动勾选，且归档内为明文。
- WebDAV 密码和 SMTP 授权码优先交给 dsh 凭据服务保存，设置文件只留引用名。
- 只使用 dsh 公开扩展接口，不修改宿主代码；无遥测、无第三方上报。
- 备份 / 恢复串行执行，带操作锁；恢复聊天记录前会检查 dsh 是否仍在运行。

### 适合谁

- 经常换电脑、重装系统，或者同时用多台机器的人。
- 装了很多插件、调过很多设置，不想每次重配的人。
- 希望聊天记录和项目文件除了本地之外，还有一份云端副本的人。
- 喜欢可爱界面，但更在意「真的能恢复」的人。

### 安装

```bash
dsh plugin --profile desktop add dsh-whale-backup
```

安装后重启 dsh，打开 **设置 → 鲸鱼娘备份**。

### 兼容性

- DeepSeek Harness `>= 0.2.0`（开发验证于 `0.2.2-rc.5`）
- Node.js `^22.19.0 || >=24.0.0`
- Windows / macOS / Linux
- 运行时零第三方依赖

---

## 标签

```text
备份, 恢复, 数据安全, 聊天记录, 插件管理, WebDAV, 自动备份, 迁移, 换机, DeepSeek Harness, dsh
```

英文标签：

```text
backup, restore, data safety, chat history, plugin manager, WebDAV, scheduled backup, migration, DeepSeek Harness, dsh
```

---

## 版本亮点（v0.56.0）

> **鲸鱼娘备份 0.56.0**
>
> - 计划备份：每天 / 每 N 天 / 每周 / 每月 / 每 N 小时，支持错过补跑。
> - 备份健康度、自动备份独立数量上限和 SMTP 邮件提醒。
> - 恢复前安全备份、会话 / 项目文件精细恢复和恢复报告。
> - 本地 `link:` 插件路径改写与 `node_modules` 修复。
> - WebDAV 上传使用临时文件 + MOVE，并校验远端大小与校验文件。
> - 设置页五个标签页，实时进度、预计剩余时间和随时停止。

---

## 英文简介

### One-liner

> One-click backup and restore for DeepSeek Harness: chat history, plugins, plugin data, settings and project files.

### Short

> Whale Girl Backup packs your DeepSeek Harness chat history, plugins, plugin data, settings and project files into one verified archive on disk or WebDAV — and brings everything back after a reinstall, a new machine, or a bad plugin upgrade.

### Standard

> Whale Girl Backup is a backup and restore plugin for DeepSeek Harness (dsh). It stores chat logs, plugins, plugin data, settings and optional project files in a SHA-256-verified archive on your computer or WebDAV. Scheduled backups, backup health, selective restore, pre-restore safety snapshots and email notifications are built in. Credentials are excluded by default, and the plugin has zero runtime dependencies.

---

## 商店页短描述（可直接填入 locale）

中文：

> 把聊天记录、插件、插件数据、设置和项目文件备份到本机或 WebDAV，需要时一键找回。

English:

> Back up and restore chat history, plugins, plugin data, settings and project files to this computer or WebDAV.

---

## 截图建议

| 顺序 | 页面 | 仓库文件 |
| --- | --- | --- |
| 1 | 开始备份 | `docs/ui-start-backup.png` |
| 2 | 恢复备份 | `docs/ui-restore.png` |
| 3 | 设置 | `docs/ui-settings.png` |
| 4 | 我的备份 | `docs/ui-my-backups.png` |

四张图已放进 `docs/`，展示顺序由仓库根目录的 `screenshots.json` 声明，插件市场详情页按该顺序展示，README 的「界面预览」章节也引用同一组图片。换图只需更新这两个地方，不必再提 PR。
