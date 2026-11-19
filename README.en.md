# Whale Girl Backup (dsh-whale)

[中文](README.md) · [Full features](FEATURES.md) · [Store copy](INTRO.md)

A backup and restore plugin for DeepSeek Harness (`dsh`). It packs chat history, plugins, plugin data, settings and project files into a SHA-256-verified archive on disk or WebDAV, and restores them after a machine change, reinstall or accidental deletion.

- Version: v0.56 · License: MIT · Zero runtime dependencies
- Requires: Node.js `^22.19.0 || >=24.0.0`, dsh `>= 0.2.0`
- Entry points: Settings → Whale Girl Backup · `/easybackup` · `whale-backup`

![Whale girl](lib/assets/whale-girl.png)

## Install

```bash
dsh plugin --profile desktop add dsh-whale
# from a local checkout
dsh plugin --profile desktop add link:/absolute/path/to/dsh-whale
```

Restart dsh after installation.

## Features

- **Backup** chat history, plugins and plugin code, plugin data, settings and project files; save locally, to WebDAV, or both; zstd, gzip or no compression.
- **Selective scope** — all or current project; all sessions, the latest N, or manually picked sessions and project folders.
- **Integrity** — per-file SHA-256 manifest plus an archive checksum file; verify before restoring.
- **Controlled restore** — pick categories, sessions and project files; four conflict policies; a pre-restore safety snapshot by default.
- **Scheduling** — daily, every N days, weekly, monthly or every N hours; backup health, retention caps, catch-up runs and SMTP notifications.
- **Entry points** — five settings tabs, `/easybackup`, the `whale-backup` CLI and 5 model tools.

## CLI

```bash
whale-backup status
whale-backup backup --to both --workspace all
whale-backup list --source both
whale-backup verify latest
whale-backup restore latest --source local --yes
whale-backup prune --source local --keep 10 --yes
```

## Privacy

Credentials (`.credentials.yaml`, `.env`) are excluded by default and require an explicit opt-in. WebDAV passwords and SMTP tokens go to the dsh credential service first. Only public dsh extension contracts are used; the host is never patched, and there is no telemetry.

## Development

```bash
npm test
```
