import { BackupError, ERROR_CODES } from './errors.js'

const BOOLEAN_FLAGS = new Set([
  'yes',
  'dry-run',
  'overwrite',
  'prune',
  'include-credentials',
  'include-env',
  'include-plugin-code',
  'include-plugin-data',
  'include-workspace-files',
  'restore-workspace-files',
  'include-storages',
  'include-sessions',
  'include-plugins',
  'include-config',
  'require-checksum',
  'json',
  'help',
  'allow-running',
  'safety-backup',
])

const VALUE_FLAGS = new Set([
  'to',
  'destination',
  'workspace',
  'profiles',
  'compression',
  'level',
  'label',
  'source',
  'from',
  'conflict',
  'dsh-home',
  'local-dir',
  'temp-dir',
  'keep',
  'url',
  'username',
  'password',
  'password-env',
  'token',
  'token-env',
  'remote-dir',
  'timeout',
  'retries',
  'archive',
  'limit',
  'config',
])

/** Minimal shell-like tokenizer used by slash commands and the CLI. */
export function shellSplit(input) {
  const text = String(input ?? '')
  const tokens = []
  let token = ''
  let quote = null
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      token += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      const next = text[i + 1]
      if (next === '"' || next === "'" || next === '\\' || next === ' ' || next === '\t') {
        escaped = true
        continue
      }
      token += ch
      continue
    }
    if (quote !== null) {
      if (ch === quote) quote = null
      else token += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (token !== '') {
        tokens.push(token)
        token = ''
      }
      continue
    }
    token += ch
  }
  if (escaped) token += '\\'
  if (quote !== null) throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `unterminated quote in command input`)
  if (token !== '') tokens.push(token)
  return tokens
}

/**
 * Parse `backup [options]`, `/dshbackup restore ...`, etc.
 * @returns {{ subcommand: string, args: string[], flags: Record<string, string|boolean|number> }}
 */
export function parseArgs(input) {
  const tokens = Array.isArray(input) ? input : shellSplit(input)
  let index = 0
  let subcommand = 'help'
  if (tokens.length > 0 && !tokens[0].startsWith('-')) {
    subcommand = tokens[0].toLowerCase()
    index = 1
  }
  const args = []
  const flags = {}
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === '--') {
      args.push(...tokens.slice(index + 1))
      break
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      let key = eq === -1 ? token.slice(2) : token.slice(2, eq)
      let value = eq === -1 ? undefined : token.slice(eq + 1)
      let negated = false
      if (key.startsWith('no-')) {
        key = key.slice(3)
        negated = true
      }
      const canonical = canonicalFlag(key)
      if (BOOLEAN_FLAGS.has(canonical)) {
        if (value === undefined) {
          flags[camel(canonical)] = negated ? false : true
        } else {
          const truthy = !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())
          flags[camel(canonical)] = negated ? !truthy : truthy
        }
        index += 1
        continue
      }
      if (!VALUE_FLAGS.has(canonical)) {
        throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `unknown option --${key}; run /dshbackup help`)
      }
      if (value === undefined) {
        index += 1
        if (index >= tokens.length || tokens[index].startsWith('--')) {
          throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `option --${key} requires a value`)
        }
        value = tokens[index]
      }
      if (negated) throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `option --no-${key} is not valid for a value option`)
      flags[camel(canonical)] = value
      index += 1
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1)
      if (short === 'y') {
        flags.yes = true
        index += 1
        continue
      }
      if (short === 'h') {
        flags.help = true
        index += 1
        continue
      }
      if (short === 'n') {
        flags.dryRun = true
        index += 1
        continue
      }
      throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `unknown option -${short}; run /dshbackup help`)
    }
    args.push(token)
    index += 1
  }
  return { subcommand, args, flags }
}

/** Normalize aliases to one canonical flag name. */
function canonicalFlag(key) {
  const aliases = {
    destination: 'to',
    from: 'source',
    'dsh-home': 'dsh-home',
    'local-dir': 'local-dir',
    'temp-dir': 'temp-dir',
    'password-env': 'password-env',
    'token-env': 'token-env',
    'remote-dir': 'remote-dir',
    'include-plugin-code': 'include-plugin-code',
    'include-credentials': 'include-credentials',
    'include-storages': 'include-storages',
    'include-sessions': 'include-sessions',
    'include-plugins': 'include-plugins',
    'include-config': 'include-config',
    'require-checksum': 'require-checksum',
    'allow-running': 'allow-running',
    'safety-backup': 'safety-backup',
  }
  return aliases[key] ?? key
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

/** Convert parsed flags into a plugin config override object. */
export function configOverrides(flags) {
  const out = {}
  if (flags.dshHome !== undefined) out.dshHome = flags.dshHome
  if (flags.localDir !== undefined) out.localDir = flags.localDir
  if (flags.tempDir !== undefined) out.tempDir = flags.tempDir
  if (flags.workspace !== undefined) out.workspace = flags.workspace
  if (flags.profiles !== undefined) out.profiles = String(flags.profiles).split(',').map((s) => s.trim()).filter(Boolean)
  if (flags.compression !== undefined) out.compression = flags.compression
  if (flags.level !== undefined) out.compressionLevel = Number(flags.level)
  if (flags.keep !== undefined) {
    out.keepLocal = Number(flags.keep)
    out.keepWebdav = Number(flags.keep)
  }
  if (flags.includeCredentials !== undefined) out.includeCredentials = flags.includeCredentials
  if (flags.includeEnv !== undefined) out.includeEnv = flags.includeEnv
  if (flags.includePluginCode !== undefined) out.includePluginCode = flags.includePluginCode
  if (flags.includePluginData !== undefined) out.includePluginData = flags.includePluginData
  if (flags.includeWorkspaceFiles !== undefined) out.includeWorkspaceFiles = flags.includeWorkspaceFiles
  if (flags.restoreWorkspaceFiles !== undefined) out.restore = { ...(out.restore || {}), workspaceFiles: flags.restoreWorkspaceFiles }
  if (flags.includeStorages !== undefined) out.includeStorages = flags.includeStorages
  if (flags.includeSessions !== undefined) out.includeSessions = flags.includeSessions
  if (flags.includePlugins !== undefined) out.includePlugins = flags.includePlugins
  if (flags.includeConfig !== undefined) out.includeConfig = flags.includeConfig
  if (flags.requireChecksum !== undefined) out.requireChecksum = flags.requireChecksum
  const webdav = {}
  if (flags.url !== undefined) webdav.url = flags.url
  if (flags.username !== undefined) webdav.username = flags.username
  if (flags.password !== undefined) webdav.password = flags.password
  if (flags.passwordEnv !== undefined) webdav.passwordEnv = flags.passwordEnv
  if (flags.token !== undefined) webdav.token = flags.token
  if (flags.tokenEnv !== undefined) webdav.tokenEnv = flags.tokenEnv
  if (flags.remoteDir !== undefined) webdav.remoteDir = flags.remoteDir
  if (flags.timeout !== undefined) webdav.timeoutMs = Number(flags.timeout)
  if (flags.retries !== undefined) webdav.retries = Number(flags.retries)
  if (Object.keys(webdav).length > 0) out.webdav = webdav
  return out
}
