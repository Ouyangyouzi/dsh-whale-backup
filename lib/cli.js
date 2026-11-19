import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deepMerge, readUserOverlaySync, resolveConfig } from './core/config.js'
import { BackupError, ERROR_CODES, formatError } from './core/errors.js'
import { parseArgs } from './core/args.js'
import { runCommand } from './core/commands.js'

const CLI_HELP = `easy-backup 0.56.0 - simple backup and restore CLI

Usage:
  dsh-backup status
  dsh-backup backup   [--to local|webdav|both] [--workspace auto|all|<path>]
                      [--compression zstd|gzip|none] [--level N]
                      [--include-credentials] [--no-include-plugin-code]
                      [--json]
  dsh-backup list     [--source local|webdav|both] [--limit N] [--json]
  dsh-backup restore  [archive|latest] [--source local|webdav|auto]
                      [--conflict overwrite|skip|prefer-newer|fail]
                      [--dry-run] [--yes] [--allow-running] [--json]
  dsh-backup verify   [archive|latest] [--source local|webdav|auto]
  dsh-backup prune    [--source local|webdav|both] [--keep N] [--yes]
  dsh-backup config

Global options:
  --dsh-home <path>   Override DSH_HOME (default $DSH_HOME or ~/.dsh)
  --config <file>     JSON file with plugin row config (or its "backup" object)
  --help              Show this help

Environment:
  DSH_HOME, DSH_BACKUP_CONFIG,
  DSH_BACKUP_WEBDAV_PASSWORD, DSH_BACKUP_WEBDAV_TOKEN

This CLI reads the same archive format as the /dshbackup command, so it can
restore a backup on a fresh machine before dsh (and the plugin) is installed.`

/** Parse argv, load config, and run one CLI command. */
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--version') || argv.includes('-V')) {
    process.stdout.write('easy-backup 0.56.0\n')
    return 0
  }
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`)
    return 1
  }
  if (parsed.flags.help === true || parsed.subcommand === 'help') {
    process.stdout.write(`${CLI_HELP}\n`)
    return 0
  }
  const configPath = parsed.flags.config ?? process.env.DSH_BACKUP_CONFIG
  let rawConfig = {}
  if (configPath) {
    try {
      const text = await readFile(resolve(configPath), 'utf8')
      const value = JSON.parse(text)
      rawConfig = value?.backup && typeof value.backup === 'object' ? value.backup : value
    } catch (error) {
      process.stderr.write(`Cannot read config ${configPath}: ${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  let config
  try {
    const preliminary = resolveConfig(
      parsed.flags.dshHome === undefined ? rawConfig : { ...rawConfig, dshHome: parsed.flags.dshHome },
      { cwd: process.cwd() },
    )
    const overlay = readUserOverlaySync(preliminary.dshHome)
    config = resolveConfig(deepMerge(rawConfig, overlay), { cwd: process.cwd() })
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`)
    return 1
  }
  const logger = {
    info: (message) => process.stderr.write(`${message}\n`),
    warn: (message) => process.stderr.write(`${message}\n`),
    error: (message) => process.stderr.write(`${message}\n`),
    debug: () => undefined,
  }
  const controller = new AbortController()
  const onSignal = () => controller.abort(new BackupError(ERROR_CODES.ABORTED, 'interrupted by signal'))
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    const result = await runCommand({
      subcommand: parsed.subcommand,
      args: parsed.args,
      flags: parsed.flags,
      config,
      cwd: process.cwd(),
      logger,
      signal: controller.signal,
    })
    process.stdout.write(`${result.text}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`)
    return 1
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}
