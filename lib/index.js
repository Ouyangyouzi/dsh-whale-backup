import { deepMerge, readUserOverlaySync, resolveConfig } from './core/config.js'
import { formatError } from './core/errors.js'
import { parseArgs } from './core/args.js'
import { runCommand, HELP_TEXT } from './core/commands.js'
import { createHttpApi } from './core/http.js'
import { createBackup } from './core/backup.js'
import { createScheduler } from './core/schedule.js'
import { hydrateWebdav } from './core/secrets.js'

/** Cordis plugin name; the bundle patch mounts this row by id `whale`. */
export const name = 'whale'

/** The command registry, tool registry and session store are all shipped by dsh-base. */
export const inject = ['commands', 'tools', 'sessions']

/**
 * Plugin entry point.
 *
 * Everything is dependency-free at runtime: the plugin talks to the harness
 * only through the `ctx` handed to `apply()`, so it survives the developer
 * preview's moving host package APIs.
 */
export function apply(ctx, rawConfig = {}) {
  let config
  let configError
  try {
    const preliminary = resolveConfig(rawConfig)
    const overlay = readUserOverlaySync(preliminary.dshHome)
    config = resolveConfig(deepMerge(rawConfig, overlay))
  } catch (error) {
    configError = error
    config = resolveConfig({})
    ctx.logger?.error?.(`[dsh-backup] invalid configuration; commands will report it: ${error instanceof Error ? error.message : String(error)}`)
  }

  const logger = {
    info: (message) => ctx.logger?.info?.(message),
    warn: (message) => ctx.logger?.warn?.(message),
    error: (message) => ctx.logger?.error?.(message),
    debug: (message) => ctx.logger?.debug?.(message),
  }

  const flushSessions = async () => {
    const sessions = ctx.sessions
    if (!sessions || typeof sessions.list !== 'function' || typeof sessions.flush !== 'function') return
    for (const session of sessions.list()) {
      try {
        await sessions.flush(session)
      } catch (error) {
        logger.warn(`[dsh-backup] could not flush session ${session?.id ?? '?'}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const cwdFor = (agent) => {
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
  }

  /** Probe an optional service without declaring a hard dependency. */
  const service = (key) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(key) : undefined
    } catch {
      return undefined
    }
  }

  const scheduler = createScheduler({
    getConfig: () => config,
    logger,
    runBackup: async (currentConfig, schedule) => {
      const hydrated = await hydrateWebdav(currentConfig, service('credentials'))
      const overrides = { workspace: 'all' }
      if (schedule.workspaceMode === 'custom' && schedule.workspacePaths.length > 0) overrides.workspace = schedule.workspacePaths
      else if (schedule.workspaceMode === 'auto') overrides.workspace = 'auto'
      overrides.includeWorkspaceFiles = schedule.includeWorkspaceFiles === true
      // Scheduled runs can carry their own retention numbers; 0 means
      // "inherit keepLocal / keepWebdav from the settings page".
      if (schedule.keepAuto > 0) {
        overrides.keepLocal = schedule.keepLocal > 0 ? schedule.keepLocal : schedule.keepAuto
        overrides.keepWebdav = schedule.keepWebdav > 0 ? schedule.keepWebdav : schedule.keepAuto
      }
      const effective = resolveConfig(deepMerge(hydrated, overrides), { cwd: process.cwd() })
      const sessionOptions = schedule.sessionMode === 'recent'
        ? { recentSessions: schedule.sessionCount }
        : schedule.sessionMode === 'selected'
          ? { sessionIds: schedule.sessionIds }
          : {}
      try {
        const result = await createBackup({
          config: effective,
          cwd: process.cwd(),
          destination: schedule.destination,
          label: 'auto',
          prune: true,
          ...sessionOptions,
          logger,
          flushSessions,
        })
        if (effective.notifyEmail?.to) {
          import('./core/mail.js').then(({ sendNotificationMailWithRetry, buildBackupNotice }) =>
            sendNotificationMailWithRetry({
              smtp: effective.notifyEmail,
              subject: '鲸鱼娘备份：自动备份完成',
              text: buildBackupNotice({ ...result, kind: 'backup' }),
            }, logger),
          ).catch(() => undefined)
        }
        return result
      } catch (error) {
        if (effective.notifyEmail?.to) {
          import('./core/mail.js').then(({ sendNotificationMailWithRetry, buildFailureNotice }) =>
            sendNotificationMailWithRetry({
              smtp: effective.notifyEmail,
              subject: '鲸鱼娘备份：自动备份失败',
              text: buildFailureNotice('backup', error instanceof Error ? error.message : String(error)),
            }, logger),
          ).catch(() => undefined)
        }
        throw error
      }
    },
  })

  if (typeof ctx.inject === 'function') {
    ctx.effect(() => {
      let active = true
      let fiber
      fiber = ctx.inject(['webServer'], (webCtx) => {
        if (!active) return
        const api = createHttpApi({
          config: () => config,
          baseConfig: () => rawConfig,
          setConfig: (next) => { config = next; configError = undefined },
          scheduler,
          connection: webCtx.get?.('connection') ?? service('connection'),
          credentials: webCtx.get?.('credentials') ?? service('credentials'),
          flushSessions,
          logger,
        })
        return webCtx.webServer.register({
          kind: 'prefix',
          path: api.path,
          handler: api.handler,
        })
      })
      return () => {
        active = false
        try {
          fiber?.dispose?.()
        } catch {
          // The injection fiber may already be disposed with the plugin fiber.
        }
      }
    }, 'dsh-backup-web-api')
  }

  const executeCommand = async (rawInput, agent, signal) => {
    const parsed = parseArgs(rawInput ?? '')
    if (parsed.flags.help === true) return { text: HELP_TEXT }
    const result = await runCommand({
      subcommand: parsed.subcommand,
      args: parsed.args,
      flags: parsed.flags,
      config,
      configError,
      cwd: cwdFor(agent),
      logger,
      signal,
      flushSessions,
      harnessRunning: true,
    })
    return result
  }

  const disposeCommand = (() => {
    try {
      return ctx.commands.register({
        name: 'easybackup',
        description: 'Back up or restore DSH chats, plugins and settings to a folder or WebDAV. Simple mode.',
        input: {
          hint: 'status | backup | list | restore | verify | prune | config | help',
        },
        handler: async ({ agent, rawInput, signal }) => {
          try {
            const result = await executeCommand(rawInput, agent, signal)
            return { kind: 'success', text: result.text }
          } catch (error) {
            return { kind: 'error', text: formatError(error) }
          }
        },
      })
    } catch (error) {
      logger.warn(`[dsh-backup] could not register /dshbackup: ${error instanceof Error ? error.message : String(error)}`)
      return () => undefined
    }
  })()

  const toolDisposers = []
  const registerTool = (definition) => {
    try {
      toolDisposers.push(ctx.tools.register(definition))
    } catch (error) {
      logger.warn(`[dsh-backup] could not register tool ${definition.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const toolResult = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
  const output = { schema: { type: 'string' }, render: (_args, value) => [toolResult(value)] }

  const runTool = async (subcommand, args, flags, agent, signal) => {
    const result = await runCommand({
      subcommand,
      args,
      flags: { ...flags, json: true },
      config,
      configError,
      cwd: cwdFor(agent),
      logger,
      signal,
      flushSessions,
      harnessRunning: true,
    })
    return result.text
  }

  registerTool({
    name: 'dsh_backup_status',
    description: 'Show DSH backup status: DSH_HOME, session counts, local archive count, WebDAV configuration and live session locks.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output,
    timeoutMs: 30_000,
    async execute(_args, exec) {
      return runTool('status', [], {}, exec.agent, exec.signal)
    },
  })

  registerTool({
    name: 'dsh_backup_create',
    description: 'Create a compressed, SHA-256-verified backup of DSH workspace session logs, installed plugins and configuration. Writes to a local directory, WebDAV, or both.',
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string', enum: ['local', 'webdav', 'both'], description: 'Where to write the archive; defaults to local.' },
        workspace: { type: 'string', description: 'auto (current workspace), all, or an absolute workspace path.' },
        compression: { type: 'string', enum: ['zstd', 'gzip', 'none'] },
        level: { type: 'number', description: 'zstd 1-22 or gzip 1-9.' },
        label: { type: 'string', description: 'Optional short label embedded in the archive name.' },
        includeCredentials: { type: 'boolean', description: 'Include $DSH_HOME/.credentials.yaml and .env. Sensitive.' },
        includePluginCode: { type: 'boolean', description: 'Include profile node_modules and local link plugins.' },
        includeStorages: { type: 'boolean', description: 'Include storages and SQLite files.' },
        overwrite: { type: 'boolean', description: 'Overwrite an existing archive with the same timestamp name.' },
      },
      additionalProperties: false,
    },
    output,
    timeoutMs: 30 * 60_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const flags = {
        ...(args.destination === undefined ? {} : { to: args.destination }),
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
        ...(args.compression === undefined ? {} : { compression: args.compression }),
        ...(args.level === undefined ? {} : { level: args.level }),
        ...(args.label === undefined ? {} : { label: args.label }),
        ...(args.includeCredentials === undefined ? {} : { includeCredentials: args.includeCredentials }),
        ...(args.includePluginCode === undefined ? {} : { includePluginCode: args.includePluginCode }),
        ...(args.includeStorages === undefined ? {} : { includeStorages: args.includeStorages }),
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
      }
      return runTool('backup', [], flags, exec.agent, exec.signal)
    },
  })

  registerTool({
    name: 'dsh_backup_list',
    description: 'List available DSH backup archives in the local backup directory, on WebDAV, or both.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['local', 'webdav', 'both'] },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    output,
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return runTool('list', [], {
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }, exec.agent, exec.signal)
    },
  })

  registerTool({
    name: 'dsh_backup_verify',
    description: 'Verify an archive checksum, manifest and session headers without modifying DSH_HOME. Use before a restore.',
    parameters: {
      type: 'object',
      properties: {
        archive: { type: 'string', description: 'Archive name, absolute path, or latest.' },
        source: { type: 'string', enum: ['auto', 'local', 'webdav'] },
      },
      additionalProperties: false,
    },
    output,
    timeoutMs: 10 * 60_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return runTool('verify', args.archive === undefined ? [] : [args.archive], {
        ...(args.source === undefined ? {} : { source: args.source }),
      }, exec.agent, exec.signal)
    },
  })

  registerTool({
    name: 'dsh_backup_restore',
    description: 'Restore sessions, plugins and configuration from an archive. Destructive: requires confirm=true. A safety backup is made first unless disabled. Stop dsh before restoring session data.',
    parameters: {
      type: 'object',
      properties: {
        archive: { type: 'string', description: 'Archive name, absolute path, or latest.' },
        source: { type: 'string', enum: ['auto', 'local', 'webdav'] },
        conflict: { type: 'string', enum: ['overwrite', 'skip', 'prefer-newer', 'fail'] },
        dryRun: { type: 'boolean', description: 'Show the plan without writing anything.' },
        confirm: { type: 'boolean', description: 'Must be true to apply the restore.' },
        allowRunning: { type: 'boolean', description: 'Restore sessions even when live session locks exist.' },
        safetyBackup: { type: 'boolean', description: 'Create a pre-restore local backup; default true.' },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    output,
    timeoutMs: 60 * 60_000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.confirm !== true) {
        return 'Restore not applied: call dsh_backup_restore again with confirm=true after reviewing the plan (dryRun=true).'
      }
      return runTool('restore', args.archive === undefined ? [] : [args.archive], {
        ...(args.source === undefined ? {} : { source: args.source }),
        ...(args.conflict === undefined ? {} : { conflict: args.conflict }),
        ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
        yes: true,
        ...(args.allowRunning === undefined ? {} : { allowRunning: args.allowRunning }),
        ...(args.safetyBackup === undefined ? {} : { safetyBackup: args.safetyBackup }),
      }, exec.agent, exec.signal)
    },
  })

  ctx.effect(() => {
    scheduler.start()
    logger.info('[dsh-backup] loaded; use /easybackup help or the dsh_backup_* tools')
    return () => {
      try {
        scheduler.stop()
      } catch {
        // Already stopped.
      }
      try {
        disposeCommand()
      } catch {
        // Already disposed.
      }
      for (const dispose of toolDisposers.splice(0)) {
        try {
          dispose()
        } catch {
          // Already disposed.
        }
      }
    }
  }, 'dsh-backup-lifecycle')
}

export { HELP_TEXT }
