/**
 * Stable error type and user-facing formatting for every backup/restore path.
 * The plugin never throws raw Node errors at the command boundary: each one is
 * mapped to a code plus a remediation hint.
 */

export class BackupError extends Error {
  /**
   * @param {string} code stable machine-readable code
   * @param {string} message human message
   * @param {{ cause?: unknown, details?: Record<string, unknown>, hint?: string, retryable?: boolean }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BackupError'
    this.code = code
    this.details = options.details ?? {}
    this.hint = options.hint
    this.retryable = options.retryable ?? false
  }
}

/** Error codes that are safe to branch on in callers and tests. */
export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_CONFIG: 'INVALID_CONFIG',
  DSH_HOME_MISSING: 'DSH_HOME_MISSING',
  NO_DATA: 'NO_DATA',
  SESSION_UNSTABLE: 'SESSION_UNSTABLE',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  ARCHIVE_NOT_FOUND: 'ARCHIVE_NOT_FOUND',
  ARCHIVE_CORRUPT: 'ARCHIVE_CORRUPT',
  ARCHIVE_UNSUPPORTED: 'ARCHIVE_UNSUPPORTED',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  MANIFEST_MISMATCH: 'MANIFEST_MISMATCH',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  UNSAFE_SYMLINK: 'UNSAFE_SYMLINK',
  RESTORE_CONFLICT: 'RESTORE_CONFLICT',
  RESTORE_TARGET_LOCKED: 'RESTORE_TARGET_LOCKED',
  RESTORE_ROLLED_BACK: 'RESTORE_ROLLED_BACK',
  WEBDAV_AUTH: 'WEBDAV_AUTH',
  WEBDAV_NOT_FOUND: 'WEBDAV_NOT_FOUND',
  WEBDAV_CONFLICT: 'WEBDAV_CONFLICT',
  WEBDAV_LOCKED: 'WEBDAV_LOCKED',
  WEBDAV_RATE_LIMIT: 'WEBDAV_RATE_LIMIT',
  WEBDAV_SERVER: 'WEBDAV_SERVER',
  WEBDAV_TLS: 'WEBDAV_TLS',
  WEBDAV_PROTOCOL: 'WEBDAV_PROTOCOL',
  DISK_FULL: 'DISK_FULL',
  PERMISSION: 'PERMISSION',
  FILE_BUSY: 'FILE_BUSY',
  ZSTD_UNSUPPORTED: 'ZSTD_UNSUPPORTED',
  ABORTED: 'ABORTED',
  INTERNAL: 'INTERNAL',
})

/** Map an errno-style failure to a BackupError. */
export function fromNodeError(error, context = 'operation') {
  if (error instanceof BackupError) return error
  const code = error && typeof error === 'object' ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error)
  const path = error && typeof error === 'object' ? error.path : undefined
  const details = path === undefined ? {} : { path: String(path) }
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return new BackupError(ERROR_CODES.DISK_FULL, `${context}: disk is full (${message})`, {
      cause: error,
      details,
      hint: 'Free disk space or choose another localDir/tempDir.',
    })
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new BackupError(ERROR_CODES.PERMISSION, `${context}: permission denied (${message})`, {
      cause: error,
      details,
      hint: 'Close the file, run dsh as the same user that owns $DSH_HOME, or fix directory permissions.',
    })
  }
  if (code === 'EBUSY' || code === 'ETXTBSY') {
    return new BackupError(ERROR_CODES.FILE_BUSY, `${context}: file is locked by another process (${message})`, {
      cause: error,
      details,
      hint: 'Stop dsh and any editor/terminal holding the file, then retry.',
      retryable: true,
    })
  }
  if (code === 'ENOENT') {
    return new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `${context}: not found (${message})`, {
      cause: error,
      details,
    })
  }
  return new BackupError(ERROR_CODES.INTERNAL, `${context}: ${message}`, { cause: error, details })
}

/** Format any thrown value for a slash command, CLI or tool result. */
export function formatError(error) {
  if (!(error instanceof BackupError)) {
    const message = error instanceof Error ? error.message : String(error)
    return `DSH backup failed: ${message}`
  }
  const lines = [`DSH backup failed [${error.code}]: ${error.message}`]
  if (error.hint) lines.push(`Hint: ${error.hint}`)
  if (error.details && Object.keys(error.details).length > 0) {
    try {
      lines.push(`Details: ${JSON.stringify(error.details)}`)
    } catch {
      // A hostile details object must not break error rendering.
    }
  }
  return lines.join('\n')
}

/** Machine-readable error envelope used by --json and model tools. */
export function errorEnvelope(error) {
  const normalized = error instanceof BackupError ? error : fromNodeError(error)
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      hint: normalized.hint,
      details: normalized.details,
    },
  }
}
