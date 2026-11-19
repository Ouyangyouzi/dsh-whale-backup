import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { BackupError, ERROR_CODES } from './errors.js'
import { atomicWriteFile, removePath } from './fsutil.js'
import { DEFAULT_SCHEDULE, normalizeSchedule } from './schedule.js'

/** Supported archive codecs. `none` is an uncompressed tar (largest, easiest to inspect). */
export const COMPRESSIONS = Object.freeze(['zstd', 'gzip', 'none'])

/** Supported restore conflict policies. */
export const CONFLICT_POLICIES = Object.freeze(['overwrite', 'skip', 'prefer-newer', 'fail'])

const DEFAULT_EXCLUDES = Object.freeze([
  '**/.git/**',
  '**/.git',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.tmp',
  '**/*.temp',
  '**/*.part',
  '**/*.partial',
  '**/node_modules/.cache/**',
  '**/node_modules/.vite/**',
  '**/node_modules/.turbo/**',
  '**/node_modules/.pnpm-store/**',
  '**/.pnpm-store/**',
  '**/session.lock',
  '**/cache/**',
])

/** Default configuration. Every value can be overridden by the plugin row config. */
export function defaultConfig(env = process.env) {
  const dshHome = env.DSH_HOME && env.DSH_HOME.trim() !== ''
    ? resolve(expandHome(env.DSH_HOME.trim(), env))
    : join(homedir(), '.dsh')
  return {
    dshHome,
    sessionsRoot: join(dshHome, 'sessions'),
    localDir: join(dshHome, 'backups'),
    tempDir: join(tmpdir(), 'wgb'),
    archivePrefix: 'whale-backup',
    compression: 'zstd',
    compressionLevel: 9,
    profiles: 'all',
    workspace: 'auto',
    includeSessions: true,
    includePlugins: true,
    includeConfig: true,
    includeStorages: true,
    includePluginData: true,
    includeWorkspaceFiles: false,
    includeCredentials: false,
    includeEnv: false,
    includePluginCode: true,
    includeRepositoryPlugins: true,
    extraPaths: [],
    excludePatterns: [...DEFAULT_EXCLUDES],
    maxFileSizeMB: 1024,
    maxExtractMB: 102400,
    keepLocal: 10,
    keepWebdav: 10,
    requireChecksum: false,
    logLevel: 'info',
    schedule: { ...DEFAULT_SCHEDULE },
    // Notification mail for finished or failed backups. Empty `to` disables
    // notifications entirely.
    notifyEmail: {
      to: '',
      smtpHost: '',
      smtpPort: 587,
      secure: false,
      username: '',
      password: '',
      passwordEnv: 'DSH_BACKUP_NOTIFY_PASSWORD',
      retries: 2,
      timeoutMs: 20000,
    },
    webdav: {
      url: '',
      remoteDir: 'easy-backup',
      username: '',
      password: '',
      passwordEnv: 'DSH_BACKUP_WEBDAV_PASSWORD',
      token: '',
      tokenEnv: 'DSH_BACKUP_WEBDAV_TOKEN',
      auth: 'basic',
      headers: {},
      timeoutMs: 60_000,
      retries: 3,
      retryBaseMs: 800,
      rejectUnauthorized: true,
      verifyUpload: true,
      requireChecksum: true,
    },
    restore: {
      conflict: 'overwrite',
      safetyBackup: true,
      requireConfirmation: true,
      allowRunningHarness: false,
      autoInstallPlugins: true,
      verifySessions: true,
      preserveMode: true,
      createMissingWorkspaceDirs: true,
      workspaceFiles: true,
    },
  }
}

/**
 * Resolve, merge and validate user configuration.
 * @param {Record<string, unknown>} raw plugin row config
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 */
export function resolveConfig(raw = {}, options = {}) {
  const env = options.env ?? process.env
  const defaults = defaultConfig(env)
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const merged = deepMerge(defaults, source)
  const cwd = resolve(options.cwd ?? process.cwd())

  merged.dshHome = absolutePath(merged.dshHome, cwd, 'dshHome')
  if (source.sessionsRoot === undefined) merged.sessionsRoot = join(merged.dshHome, 'sessions')
  if (source.localDir === undefined) merged.localDir = join(merged.dshHome, 'backups')
  merged.sessionsRoot = absolutePath(merged.sessionsRoot, cwd, 'sessionsRoot')
  merged.localDir = absolutePath(merged.localDir, cwd, 'localDir')
  merged.tempDir = absolutePath(merged.tempDir, cwd, 'tempDir')
  merged.archivePrefix = safeName(String(merged.archivePrefix || 'dsh-backup'))
  merged.compression = normalizeCompression(merged.compression)
  merged.compressionLevel = normalizeLevel(merged.compression, merged.compressionLevel)
  merged.profiles = normalizeProfiles(merged.profiles)
  merged.workspace = normalizeWorkspace(merged.workspace, cwd)
  merged.includeSessions = asBool(merged.includeSessions, true)
  merged.includePlugins = asBool(merged.includePlugins, true)
  merged.includeConfig = asBool(merged.includeConfig, true)
  merged.includeStorages = asBool(merged.includeStorages, true)
  merged.includePluginData = asBool(merged.includePluginData, true)
  merged.includeWorkspaceFiles = asBool(merged.includeWorkspaceFiles, false)
  merged.includeCredentials = asBool(merged.includeCredentials, false)
  merged.includeEnv = asBool(merged.includeEnv, false)
  merged.includePluginCode = asBool(merged.includePluginCode, true)
  merged.includeRepositoryPlugins = asBool(merged.includeRepositoryPlugins, true)
  merged.extraPaths = normalizeStringArray(merged.extraPaths).map((p) => absolutePath(p, merged.dshHome, 'extraPaths[]'))
  merged.excludePatterns = normalizeStringArray(merged.excludePatterns)
  merged.maxFileSizeMB = clampNumber(merged.maxFileSizeMB, 1, 1_048_576, 1024)
  merged.maxExtractMB = clampNumber(merged.maxExtractMB, 1, 1_048_576, 102400)
  merged.keepLocal = clampInt(merged.keepLocal, 0, 10_000, 10)
  merged.keepWebdav = clampInt(merged.keepWebdav, 0, 10_000, 10)
  merged.requireChecksum = asBool(merged.requireChecksum, false)
  merged.logLevel = ['silent', 'error', 'warn', 'info', 'debug'].includes(merged.logLevel) ? merged.logLevel : 'info'

  merged.webdav = normalizeWebdav(merged.webdav, env, cwd)
  merged.restore = normalizeRestore(merged.restore)
  merged.schedule = normalizeSchedule(merged.schedule)
  merged.notifyEmail = normalizeNotifyEmail(merged.notifyEmail, env)
  if (!merged.includeSessions && !merged.includePlugins && !merged.includeConfig && !merged.includeStorages) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'at least one of includeSessions/includePlugins/includeConfig/includeStorages must be true')
  }
  return merged
}

/** Deep merge plain objects; arrays and scalars replace. */
export function deepMerge(base, extra) {
  if (!isPlainObject(extra)) return clone(base)
  const out = clone(base)
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key], value)
    else out[key] = clone(value)
  }
  return out
}

function normalizeNotifyEmail(value, env) {
  const base = defaultConfig(env).notifyEmail
  const n = deepMerge(base, isPlainObject(value) ? value : {})
  n.to = String(n.to ?? '').trim()
  n.smtpHost = String(n.smtpHost ?? '').trim()
  n.smtpPort = clampInt(n.smtpPort, 1, 65535, 587)
  n.secure = asBool(n.secure, false)
  n.username = String(n.username ?? '')
  if (typeof n.password !== 'string') n.password = ''
  n.passwordEnv = String(n.passwordEnv ?? 'DSH_BACKUP_NOTIFY_PASSWORD')
  if (n.password === '' && n.passwordEnv && env[n.passwordEnv]) n.password = env[n.passwordEnv]
  n.retries = clampInt(n.retries, 0, 10, 2)
  n.timeoutMs = clampInt(n.timeoutMs, 5000, 120000, 20000)
  if (n.to !== '' && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(n.to.split(',')[0] ?? '')) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, `通知邮箱地址无效：${n.to}`)
  }
  return n
}

function normalizeWebdav(value, env, cwd) {
  const base = defaultConfig(env).webdav
  const w = deepMerge(base, isPlainObject(value) ? value : {})
  w.url = typeof w.url === 'string' ? w.url.trim().replace(/\/+$/, '') : ''
  w.remoteDir = normalizeRemoteDir(String(w.remoteDir ?? 'dsh-backups'))
  w.username = String(w.username ?? '')
  w.auth = ['basic', 'bearer', 'none'].includes(w.auth) ? w.auth : 'basic'
  w.headers = isPlainObject(w.headers) ? Object.fromEntries(Object.entries(w.headers).map(([k, v]) => [k, String(v)])) : {}
  w.timeoutMs = clampInt(w.timeoutMs, 1000, 600_000, 60_000)
  w.retries = clampInt(w.retries, 0, 10, 3)
  w.retryBaseMs = clampInt(w.retryBaseMs, 100, 60_000, 800)
  w.rejectUnauthorized = asBool(w.rejectUnauthorized, true)
  w.verifyUpload = asBool(w.verifyUpload, true)
  w.requireChecksum = asBool(w.requireChecksum, true)
  w.passwordEnv = String(w.passwordEnv ?? 'DSH_BACKUP_WEBDAV_PASSWORD')
  w.tokenEnv = String(w.tokenEnv ?? 'DSH_BACKUP_WEBDAV_TOKEN')
  if (typeof w.password !== 'string') w.password = ''
  if (typeof w.token !== 'string') w.token = ''
  if (w.password === '' && w.passwordEnv && env[w.passwordEnv]) w.password = env[w.passwordEnv]
  if (w.token === '' && w.tokenEnv && env[w.tokenEnv]) w.token = env[w.tokenEnv]
  if (w.url !== '' && !/^https?:\/\//i.test(w.url)) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, `webdav.url must start with http:// or https://, got ${JSON.stringify(w.url)}`)
  }
  return w
}

function normalizeRestore(value) {
  const r = deepMerge(defaultConfig().restore, isPlainObject(value) ? value : {})
  r.conflict = CONFLICT_POLICIES.includes(r.conflict) ? r.conflict : 'overwrite'
  r.safetyBackup = asBool(r.safetyBackup, true)
  r.requireConfirmation = asBool(r.requireConfirmation, true)
  r.allowRunningHarness = asBool(r.allowRunningHarness, false)
  r.autoInstallPlugins = asBool(r.autoInstallPlugins, true)
  r.verifySessions = asBool(r.verifySessions, true)
  r.preserveMode = asBool(r.preserveMode, true)
  r.createMissingWorkspaceDirs = asBool(r.createMissingWorkspaceDirs, true)
  r.workspaceFiles = asBool(r.workspaceFiles, true)
  return r
}

function normalizeCompression(value) {
  const v = String(value ?? 'zstd').replace(/^\./, '').toLowerCase()
  if (v === 'zstandard' || v === 'zst' || v === 'zstd') return 'zstd'
  if (v === 'gz' || v === 'gzip') return 'gzip'
  if (v === 'tar' || v === 'none' || v === 'off') return 'none'
  throw new BackupError(ERROR_CODES.INVALID_CONFIG, `compression must be one of ${COMPRESSIONS.join(', ')}, got ${JSON.stringify(value)}`)
}

function normalizeLevel(compression, value) {
  if (compression === 'none') return 0
  if (compression === 'gzip') return clampInt(value, 1, 9, 6)
  return clampInt(value, 1, 22, 9)
}

function normalizeProfiles(value) {
  if (value === 'all' || value === '*') return 'all'
  const list = normalizeStringArray(value).map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return ['web']
  for (const name of list) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new BackupError(ERROR_CODES.INVALID_CONFIG, `invalid profile name ${JSON.stringify(name)}`)
    }
  }
  return [...new Set(list)]
}

function normalizeWorkspace(value, cwd) {
  if (value === undefined || value === null || value === '' || value === 'auto') return 'auto'
  if (value === 'all' || value === '*') return 'all'
  const list = normalizeStringArray(value).filter(Boolean)
  if (list.length === 1 && (list[0] === 'all' || list[0] === '*')) return 'all'
  if (list.length === 0) return 'auto'
  return list.map((p) => absolutePath(p, cwd, 'workspace'))
}

function normalizeRemoteDir(value) {
  const trimmed = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts = trimmed.split('/').filter((s) => s !== '' && s !== '.')
  if (parts.some((part) => part === '..')) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'webdav.remoteDir must not contain ".."')
  }
  return parts.join('/') || 'dsh-backups'
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.trim() !== '')
  if (typeof value === 'string' && value.trim() !== '') return value.split(',').map((v) => v.trim()).filter(Boolean)
  return []
}

function absolutePath(value, base, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, `${field} must be a non-empty path`)
  }
  const expanded = expandHome(value.trim())
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded)
}

function expandHome(value, env = process.env) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => env[name] ?? '')
}

function asBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return fallback
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function safeName(value) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'dsh-backup'
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
  return value
}

/** Secrets-free view for logs, `/dshbackup config` and reports. */
export function redactConfig(config) {
  return {
    ...config,
    notifyEmail: {
      ...config.notifyEmail,
      password: config.notifyEmail.password ? '<set>' : '',
    },
    webdav: {
      ...config.webdav,
      password: config.webdav.password ? '<set>' : '',
      token: config.webdav.token ? '<set>' : '',
      headers: Object.fromEntries(Object.keys(config.webdav.headers).map((key) => [key, /auth|token|key|secret/i.test(key) ? '<set>' : config.webdav.headers[key]])),
    },
  }
}

/** File extension for a codec. */
export function archiveExtension(compression) {
  if (compression === 'zstd') return '.tar.zst'
  if (compression === 'gzip') return '.tar.gz'
  return '.tar'
}

/** Runtime overlay written by the settings UI. */
export const USER_CONFIG_FILE = 'dsh-backup.config.json'

/** Absolute path of the UI-managed overlay. */
export function userConfigPath(dshHome) {
  return join(dshHome, USER_CONFIG_FILE)
}

/** Read the UI overlay synchronously (used at plugin boot). */
export function readUserOverlaySync(dshHome) {
  const path = userConfigPath(dshHome)
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** Persist the sanitized UI overlay atomically with owner-only permissions. */
export async function writeUserOverlay(dshHome, overlay) {
  await atomicWriteFile(userConfigPath(dshHome), `${JSON.stringify(overlay, null, 2)}\n`, 0o600)
}

/** Delete the UI overlay (reset to the plugin row configuration). */
export async function clearUserOverlay(dshHome) {
  await removePath(userConfigPath(dshHome))
}

/**
 * Keep only settings the UI is allowed to persist. Passwords and bearer
 * tokens are deliberately not accepted: the overlay stores environment
 * variable names instead of secrets.
 */
export function sanitizeOverlay(value) {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const out = {}
  const top = [
    'localDir', 'archivePrefix', 'compression', 'compressionLevel',
    'profiles', 'workspace',
    'includeSessions', 'includePlugins', 'includeConfig', 'includeStorages',
    'includePluginData',
    'includeWorkspaceFiles',
    'includeCredentials', 'includeEnv', 'includePluginCode', 'includeRepositoryPlugins',
    'extraPaths', 'excludePatterns',
    'maxFileSizeMB', 'maxExtractMB', 'keepLocal', 'keepWebdav', 'requireChecksum',
    'schedule',
    'notifyEmail',
  ]
  for (const key of top) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  const webdavKeys = [
    'url', 'remoteDir', 'username', 'passwordEnv', 'tokenEnv', 'auth',
    'timeoutMs', 'retries', 'retryBaseMs', 'rejectUnauthorized', 'verifyUpload', 'requireChecksum',
  ]
  if (source.webdav && typeof source.webdav === 'object' && !Array.isArray(source.webdav)) {
    out.webdav = {}
    for (const key of webdavKeys) {
      if (source.webdav[key] !== undefined) out.webdav[key] = source.webdav[key]
    }
    // Direct credentials are deliberately opt-in: the field is only stored
    // when the user typed a value. '<set>' is the redacted placeholder read
    // back from /config and means "keep the existing value".
    for (const key of ['password', 'token']) {
      const value = source.webdav[key]
      if (typeof value === 'string' && value !== '' && value !== '<set>') out.webdav[key] = value
    }
    if (Object.keys(out.webdav).length === 0) delete out.webdav
  }
  const notifyKeys = ['to', 'smtpHost', 'smtpPort', 'secure', 'username', 'passwordEnv', 'retries', 'timeoutMs']
  if (source.notifyEmail && typeof source.notifyEmail === 'object' && !Array.isArray(source.notifyEmail)) {
    out.notifyEmail = {}
    for (const key of notifyKeys) {
      if (source.notifyEmail[key] !== undefined) out.notifyEmail[key] = source.notifyEmail[key]
    }
    for (const key of ['password']) {
      const raw = source.notifyEmail[key]
      if (typeof raw === 'string' && raw !== '' && raw !== '<set>') out.notifyEmail[key] = raw
    }
    if (Object.keys(out.notifyEmail).length === 0) delete out.notifyEmail
  }
  const restoreKeys = [
    'conflict', 'safetyBackup', 'requireConfirmation', 'allowRunningHarness',
    'autoInstallPlugins', 'verifySessions', 'preserveMode', 'createMissingWorkspaceDirs', 'workspaceFiles',
  ]
  if (source.restore && typeof source.restore === 'object' && !Array.isArray(source.restore)) {
    out.restore = {}
    for (const key of restoreKeys) {
      if (source.restore[key] !== undefined) out.restore[key] = source.restore[key]
    }
    if (Object.keys(out.restore).length === 0) delete out.restore
  }
  return out
}
