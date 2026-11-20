# 鲸鱼娘备份（dsh-whale-backup）

[English](README.en.md) · [功能详解](FEATURES.md) · [简介文案](INTRO.md)

DeepSeek Harness（`dsh`）的备份与找回插件。把聊天记录、插件、插件数据、设置和项目文件打包成一份带 SHA-256 校验的归档，存到本机或 WebDAV；换机、重装或误删后一键找回。

- 版本：v0.56　- 许可证：MIT　- 运行时零依赖
- 要求：Node.js `^22.19.0 || >=24.0.0`，dsh `>= 0.2.0`
- 入口：设置 → 鲸鱼娘备份 ｜ `/easybackup` ｜ `whale-backup`

![鲸鱼娘](lib/assets/whale-girl.png)

## 安装

```bash
dsh plugin --profile desktop add dsh-whale-backup
# 本地目录
dsh plugin --profile desktop add link:/absolute/path/to/dsh-whale-backup
```

安装后重启 dsh。

## 功能

- **备份**：聊天记录、插件与插件代码、插件数据、设置、项目文件；目的地可选本机、WebDAV 或双写；zstd / gzip / 不压缩。
- **选择范围**：全部或当前项目；全部会话、最近 N 个或手动勾选会话与项目目录。
- **校验**：逐文件 SHA-256 清单 + 归档校验文件，恢复前可先检查。
- **恢复**：按类别、会话、项目文件精细恢复；四种同名冲突策略；默认先做恢复前安全备份。
- **计划**：每天 / 每 N 天 / 每周 / 每月 / 工作日 / 节假日 / 每 N 小时；数量上限、错过补跑、SMTP 邮件提醒。
- **入口**：设置页五个标签、`/easybackup` 命令、`whale-backup` CLI、5 个模型工具。

## 命令

```bash
whale-backup status
whale-backup backup --to both --workspace all
whale-backup list --source both
whale-backup verify latest
whale-backup restore latest --source local --yes
whale-backup prune --source local --keep 10 --yes
```

## 隐私

默认不备份 `.credentials.yaml`、`.env` 等凭据，需手动勾选。WebDAV 密码和 SMTP 授权码优先存入 dsh 凭据服务。只使用 dsh 公开扩展接口，不修改宿主代码，无遥测、无第三方上报。

## 开发

```bash
npm test
```
