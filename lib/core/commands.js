import { BackupError, ERROR_CODES, formatError } from './errors.js'
import { deepMerge, redactConfig, resolveConfig } from './config.js'
import { configOverrides } from './args.js'
import { createBackup, listLocalArchives, listRemoteArchives, pruneLocalArchives } from './backup.js'
import { restoreArchive, resolveArchive, verifyArchive } from './restore.js'
import { detectSessionLocks, sessionStats } from './sessions.js'
import { WebdavClient } from './webdav.js'
import { formatBytes } from './fsutil.js'

/** Help text shared by the slash command, CLI and model tools. */
export const HELP_TEXT = `鲸鱼娘备份

用法：
  /easybackup status
  /easybackup backup [--to local|webdav|both] [--workspace auto|all|<path>]
                    [--profiles web,headless] [--compression zstd|gzip|none]
                    [--level N] [--label TEXT] [--include-credentials]
                    [--no-include-plugin-code] [--no-include-storages]
                    [--overwrite] [--no-prune] [--json]
  /easybackup list [--source local|webdav|both] [--limit N] [--json]
  /easybackup restore [archive|latest] [--source local|webdav|auto]
                    [--conflict overwrite|skip|prefer-newer|fail]
                    [--dry-run] [--yes] [--no-safety-backup] [--allow-running] [--json]
  /easybackup verify [archive|latest] [--source local|webdav|auto] [--json]
  /easybackup prune [--source local|webdav|both] [--keep N] [--yes] [--json]
  /easybackup config [--json]

说明：
  * 备份会压缩，并检查文件是否完整。
  * 恢复前默认先自动备份一次。
  * 恢复聊天记录时建议先关闭 dsh。
  * 默认不备份账号密码。勾选“包含凭据”后归档里会有明文密钥。
  * 完整配置项、错误处理和新电脑恢复步骤见 README.md。`

/**
 * Execute one parsed command.
 * @returns {Promise<{ text: string, data?: unknown }>}
 */
export async function runCommand(options) {
  const { subcommand, args, flags, cwd, logger, signal, flushSessions, harnessRunning } = options
  if (options.configError) throw options.configError
  if (flags.help === true || subcommand === 'help') return { text: HELP_TEXT, data: { help: HELP_TEXT } }
  const overrides = configOverrides(flags)
  let base = options.config
  if (flags.dshHome !== undefined) {
    base = { ...base }
    delete base.sessionsRoot
    if (flags.localDir === undefined) delete base.localDir
  }
  const config = resolveConfig(deepMerge(base, overrides), { cwd })
  switch (subcommand) {
    case 'status':
      return await statusCommand(config, flags, cwd, logger)
    case 'backup':
      return await backupCommand(config, flags, cwd, logger, signal, flushSessions)
    case 'list':
      return await listCommand(config, flags, logger, signal)
    case 'restore':
      return await restoreCommand(config, args, flags, cwd, logger, signal, harnessRunning)
    case 'verify':
      return await verifyCommand(config, args, flags, logger, signal)
    case 'prune':
      return await pruneCommand(config, flags, logger, signal)
    case 'config':
      return {
        text: JSON.stringify(redactConfig(config), null, 2),
        data: redactConfig(config),
      }
    default:
      throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `unknown subcommand ${JSON.stringify(subcommand)}; run /dshbackup help`)
  }
}

async function statusCommand(config, flags, cwd, logger) {
  const lines = []
  let data
  try {
    const stats = await sessionStats(config, cwd)
    const archives = await listLocalArchives(config)
    const locks = await detectSessionLocks(config, cwd)
    data = {
      dshHome: config.dshHome,
      sessionsRoot: config.sessionsRoot,
      localDir: config.localDir,
      profiles: config.profiles,
      workspace: stats.workspace,
      sessions: stats.sessions,
      sessionFiles: stats.files,
      sessionBytes: stats.bytes,
      archives: archives.length,
      newestArchive: archives[0] ? { name: archives[0].name, size: archives[0].size, createdAt: archives[0].createdAt } : undefined,
      webdavConfigured: config.webdav.url !== '',
      locks: locks.locks.length,
      lockDetectable: locks.detectable,
    }
    lines.push(`DSH_HOME:      ${config.dshHome}`)
    lines.push(`Sessions root: ${config.sessionsRoot}`)
    lines.push(`Local backups: ${config.localDir}`)
    lines.push(`Profiles:      ${Array.isArray(config.profiles) ? config.profiles.join(', ') : config.profiles}`)
    lines.push(`Workspace:     ${stats.workspace.mode}${stats.workspace.paths.length ? ` (${stats.workspace.paths.join(', ')})` : ''}`)
    lines.push(`Sessions:      ${stats.sessions} (${stats.files} log files, ${stats.bytesLabel})`)
    lines.push(`Local archives:${archives.length === 0 ? ' none' : ` ${archives.length}, newest ${archives[0].name} (${archives[0].sizeLabel})`}`)
    lines.push(`WebDAV:        ${config.webdav.url === '' ? 'not configured' : `${config.webdav.url}/${config.webdav.remoteDir}`}`)
    lines.push(`Compression:   ${config.compression} (level ${config.compressionLevel})`)
    lines.push(`Credentials:   ${config.includeCredentials ? 'INCLUDED (sensitive)' : 'excluded'}`)
    if (locks.locks.length > 0) {
      lines.push(`WARNING: ${locks.locks.length} session lock file(s) found; stop dsh before restoring sessions.`)
    } else if (!locks.detectable) {
      lines.push('Note: Windows session locks are kernel semaphores; stop dsh before restoring sessions.')
    }
  } catch (error) {
    if (error instanceof BackupError && error.code === ERROR_CODES.DSH_HOME_MISSING) throw error
    data = { error: formatError(error) }
    lines.push(formatError(error))
  }
  return { text: flags.json === true ? JSON.stringify(data, null, 2) : lines.join('\n'), data }
}

async function backupCommand(config, flags, cwd, logger, signal, flushSessions) {
  const result = await createBackup({
    config,
    cwd,
    destination: flags.to ?? 'local',
    label: flags.label ?? '',
    compression: flags.compression,
    compressionLevel: flags.level === undefined ? undefined : Number(flags.level),
    includeCredentials: flags.includeCredentials,
    includePluginCode: flags.includePluginCode,
    includeStorages: flags.includeStorages,
    overwrite: flags.overwrite === true,
    prune: flags.prune,
    signal,
    logger,
    flushSessions,
  })
  if (flags.json === true) return { text: JSON.stringify(result, null, 2), data: result }
  const lines = [
    `Backup complete: ${result.archiveName}`,
    `  size:        ${result.sizeLabel}`,
    `  compression: ${result.compression}`,
    `  sha256:      ${result.sha256}`,
    `  sessions:    ${result.summary.sessions} (${result.summary.sessionFiles} files, ${formatBytes(result.summary.sessionBytes)})`,
    `  files:       ${result.summary.files} total, ${formatBytes(result.summary.totalBytes)} packed`,
  ]
  if (result.local) lines.push(`  local:       ${result.local.path}`)
  if (result.remote) lines.push(`  webdav:      ${result.remote.url}`)
  if (result.pruned?.length) lines.push(`  pruned:      ${result.pruned.length} old local archive(s)`)
  if (result.remotePruned?.length) lines.push(`  pruned:      ${result.remotePruned.length} old WebDAV archive(s)`)
  if (result.summary.skipped > 0) lines.push(`  skipped:     ${result.summary.skipped} file(s); see warnings`)
  if (result.warnings.length > 0) {
    lines.push('  warnings:')
    for (const warning of result.warnings.slice(0, 20)) lines.push(`    - ${warning}`)
  }
  return { text: lines.join('\n'), data: result }
}

async function listCommand(config, flags, logger, signal) {
  const source = flags.source ?? 'local'
  const limit = Math.max(1, Math.min(1000, Number(flags.limit ?? 20) || 20))
  const rows = []
  if (source === 'local' || source === 'both') {
    rows.push(...(await listLocalArchives(config)).slice(0, limit))
  }
  if (source === 'webdav' || source === 'both') {
    if (!config.webdav.url) {
      if (source === 'webdav') throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV is not configured')
    } else {
      rows.push(...(await listRemoteArchives(config, logger, signal)).slice(0, limit))
    }
  }
  const data = { archives: rows }
  if (flags.json === true) return { text: JSON.stringify(data, null, 2), data }
  if (rows.length === 0) return { text: 'No backup archives found.', data }
  const lines = ['Source   Created                  Size        Name']
  for (const row of rows) {
    lines.push(`${row.source.padEnd(8)} ${(row.createdAt || '').padEnd(22)} ${String(row.sizeLabel).padEnd(11)} ${row.name}`)
  }
  return { text: lines.join('\n'), data }
}

async function restoreCommand(config, args, flags, cwd, logger, signal, harnessRunning) {
  const archive = flags.archive ?? args[0] ?? 'latest'
  const result = await restoreArchive({
    config,
    cwd,
    archive,
    source: flags.source ?? 'auto',
    conflict: flags.conflict,
    dryRun: flags.dryRun === true,
    yes: flags.yes === true,
    safetyBackup: flags.safetyBackup,
    allowRunning: flags.allowRunning === true,
    restoreWorkspaceFiles: flags.restoreWorkspaceFiles,
    harnessRunning: harnessRunning === true,
    signal,
    logger,
  })
  if (flags.json === true) return { text: JSON.stringify(result, null, 2), data: result }
  if (result.needsConfirmation === true) {
    const p = result.plan
    return {
      text: [
        `Restore plan for ${result.archive.name} (${result.archive.createdAt}) from ${result.source}:`,
        `  create:  ${p.create}`,
        `  replace: ${p.replace}`,
        `  skip:    ${p.skip}`,
        result.archive.sha256 ? `  sha256:  ${result.archive.sha256}` : '',
        p.conflicts.length > 0 ? `  conflicts: ${p.conflicts.slice(0, 10).map((c) => c.path).join(', ')}${p.conflicts.length > 10 ? ', …' : ''}` : '  conflicts: none',
        '',
        result.message,
      ].filter(Boolean).join('\n'),
      data: result,
    }
  }
  if (result.dryRun === true) {
    const p = result.plan
    return {
      text: [
        `Dry run for ${result.archive.name} from ${result.source}:`,
        `  create:  ${p.create}`,
        `  replace: ${p.replace}`,
        `  skip:    ${p.skip}`,
        `  conflicts: ${p.conflicts.length}`,
      ].join('\n'),
      data: result,
    }
  }
  if (result.verified === true) {
    return {
      text: [
        `Archive verified: ${result.name}`,
        `  sha256: ${result.sha256}${result.checksumVerified ? ' (sidecar verified)' : ' (no sidecar)'}`,
        `  created: ${result.createdAt}`,
        `  sessions: ${result.summary?.files ?? '?'} files`,
      ].join('\n'),
      data: result,
    }
  }
  const lines = [
    `Restore complete from ${result.archive.name} (${result.source}).`,
    `  files:    ${result.restored.files}`,
    `  dirs:     ${result.restored.dirs}`,
    `  symlinks: ${result.restored.symlinks}`,
    `  bytes:    ${formatBytes(result.restored.bytes)}`,
    `  skipped:  ${result.skipped.length}`,
  ]
  if (result.safetyBackup) lines.push(`  safety:   ${result.safetyBackup.path}`)
  if (result.reportPath) lines.push(`  report:   ${result.reportPath}`)
  if (result.workspaceDirs?.created?.length) lines.push(`  workspace dirs created: ${result.workspaceDirs.created.length}`)
  if (result.credentialWarning) lines.push(`  credentials: ${result.credentialWarning}`)
  if (result.linkRewrites?.length) lines.push(`  rewrote:  ${result.linkRewrites.length} local link spec(s)`)
  if (result.linkModules?.length) lines.push(`  links:    ${result.linkModules.length} node_modules link(s) restored`)
  if (result.installWarnings?.length) {
    lines.push('  plugin install:')
    for (const warning of result.installWarnings.slice(0, 20)) lines.push(`    - ${warning}`)
  }
  if (result.warnings?.length) {
    lines.push('  warnings:')
    for (const warning of result.warnings.slice(0, 20)) lines.push(`    - ${warning}`)
  }
  lines.push('', 'Restart dsh to load restored plugins and settings.')
  return { text: lines.join('\n'), data: result }
}

async function verifyCommand(config, args, flags, logger, signal) {
  const archive = flags.archive ?? args[0] ?? 'latest'
  const resolved = await resolveArchive(config, { archive, source: flags.source ?? 'auto', logger, signal })
  try {
    const result = await verifyArchive(config, resolved.path, { signal, requireChecksum: resolved.source === 'webdav' ? config.webdav.requireChecksum : config.requireChecksum })
    const data = { ...result, source: resolved.source, path: resolved.source === 'local' ? resolved.path : undefined }
    if (flags.json === true) return { text: JSON.stringify(data, null, 2), data }
    const lines = [
      `Archive verified: ${result.name}`,
      `  source:   ${resolved.source}`,
      `  sha256:   ${result.sha256}${result.checksumVerified ? ' (sidecar verified)' : ' (no sidecar)'}`,
      `  created:  ${result.createdAt}`,
      `  label:    ${result.label || '(none)'}`,
      `  files:    ${result.summary.files} (${formatBytes(result.summary.totalBytes)})`,
      `  host:     ${result.host?.hostname ?? '?'} / ${result.host?.platform ?? '?'}`,
      `  workspace:${result.workspace?.mode ?? '?'}`,
    ]
    if (result.warnings?.length) lines.push(`  warnings: ${result.warnings.length}`)
    return { text: lines.join('\n'), data }
  } finally {
    await resolved.cleanup()
  }
}

async function pruneCommand(config, flags, logger, signal) {
  const source = flags.source ?? 'local'
  const keep = Math.max(0, Number(flags.keep ?? config.keepLocal) || 0)
  const yes = flags.yes === true
  if ((source === 'webdav' || source === 'both') && !config.webdav.url) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV is not configured')
  }
  const summary = { local: [], webdav: [] }
  if (source === 'local' || source === 'both') {
    const archives = await listLocalArchives(config)
    const remove = archives.slice(keep)
    if (!yes) {
      for (const archive of remove) summary.local.push(archive.name)
    } else {
      summary.local = await pruneLocalArchives(config, keep, [], logger)
    }
  }
  if (source === 'webdav' || source === 'both') {
    if (!config.webdav.url) throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV is not configured')
    const archives = await listRemoteArchives(config, logger, signal)
    const remove = archives.slice(keep)
    if (!yes) {
      for (const archive of remove) summary.webdav.push(archive.name)
    } else {
      const client = new WebdavClient(config, logger)
      for (const archive of remove) {
        await client.remove(archive.name, signal)
        summary.webdav.push(archive.name)
      }
    }
  }
  if (source !== 'local' && source !== 'webdav' && source !== 'both') {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `source must be local, webdav or both`)
  }
  const total = summary.local.length + summary.webdav.length
  if (!yes) {
    if (total === 0) return { text: `Nothing to prune (keep ${keep}).`, data: { dryRun: true, ...summary } }
    return {
      text: `Would remove ${total} archive(s) (keep ${keep} per source):\n${[...summary.local, ...summary.webdav].map((name) => `  ${name}`).join('\n')}\nRe-run with --yes to apply.`,
      data: { dryRun: true, ...summary },
    }
  }
  return { text: `Pruned ${total} archive(s) (${summary.local.length} local, ${summary.webdav.length} WebDAV).`, data: { removed: summary } }
}
