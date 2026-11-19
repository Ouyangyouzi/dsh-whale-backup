import { createReadStream } from 'node:fs'
import { copyFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createGunzip, createZstdDecompress } from 'node:zlib'
import { StringDecoder } from 'node:string_decoder'
import { BackupError, ERROR_CODES } from './errors.js'
import { formatBytes, pathExists, readPrefix, toPosix } from './fsutil.js'

/**
 * Exact copy of DSH's session project-directory key algorithm
 * (packages/session/session-persistence-jsonl/src/format.ts).
 * Keeping this byte-compatible is what makes a workspace-scoped backup
 * restore into the same project directory on another machine.
 */
/** Read the first JSON line of a possibly zstd-compressed session log. */
async function readSessionHeader(path) {
  const compressed = /\.zstd$/i.test(path)
  try {
    if (!compressed) {
      const text = (await readPrefix(path, 4096)).toString('utf8')
      return JSON.parse(text.split('\n')[0])
    }
    const { createZstdDecompress } = await import('node:zlib')
    const source = createReadStream(path)
    const decoder = createZstdDecompress()
    let text = ''
    source.pipe(decoder)
    try {
      for await (const chunk of decoder) {
        text += chunk.toString('utf8')
        if (text.includes('\n') || text.length > 65536) break
      }
    } finally {
      source.destroy()
      decoder.destroy()
    }
    const line = text.split('\n')[0]
    return JSON.parse(line)
  } catch {
    return null
  }
}

/**
 * List session summaries on disk so the schedule page can pick workspaces
 * and sessions without opening the session store service.
 */
export async function listSessionSummaries(config, cwd) {
  const root = config.sessionsRoot
  const projects = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessions = []
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    const children = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
    for (const child of children) {
      if (!child.isDirectory()) continue
      const sessionDir = join(projectDir, child.name)
      const files = await readdir(sessionDir, { withFileTypes: true }).catch(() => [])
      const artifacts = files.filter((file) => file.isFile() && isSessionArtifact(file.name))
      if (artifacts.length === 0) continue
      let workspace = ''
      let updatedAt = 0
      for (const artifact of artifacts) {
        const path = join(sessionDir, artifact.name)
        const info = await stat(path).catch(() => null)
        if (info && info.mtimeMs > updatedAt) updatedAt = info.mtimeMs
        if (workspace === '') {
          const header = await readSessionHeader(path)
          if (header && typeof header.cwd === 'string' && header.cwd !== '') workspace = header.cwd
        }
      }
      sessions.push({ id: child.name, project: project.name, workspace, files: artifacts.length, updatedAt })
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  return sessions
}

export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** The `_no-cwd` project directory name. */
export const NO_CWD_KEY = '_no-cwd'

/**
 * Turn the configured workspace mode into a set of project keys.
 * @param {import('./config.js').defaultConfig extends never ? never : any} config
 * @param {string} [cwd]
 */
export function resolveWorkspace(config, cwd = process.cwd()) {
  if (!config.includeSessions) return { mode: 'disabled', paths: [], keys: [] }
  if (config.workspace === 'all') return { mode: 'all', paths: [], keys: [] }
  const paths = config.workspace === 'auto' ? [resolve(cwd)] : config.workspace.map((value) => resolve(value))
  const keys = [...new Set(paths.map(projectKey))]
  return { mode: config.workspace === 'auto' ? 'auto' : 'selected', paths, keys }
}

/** Absolute project directories selected by the workspace mode. */
export async function selectedProjectDirs(config, cwd = process.cwd()) {
  const root = config.sessionsRoot
  if (!(await pathExists(root))) return { root, workspace: resolveWorkspace(config, cwd), dirs: [], missingRoot: true }
  const workspace = resolveWorkspace(config, cwd)
  if (!config.includeSessions) return { root, workspace, dirs: [], missingRoot: false }
  let names
  try {
    const entries = await readdir(root, { withFileTypes: true })
    names = entries.filter((entry) => entry.isDirectory() && (entry.name.startsWith('--') || entry.name === NO_CWD_KEY)).map((entry) => entry.name)
  } catch (error) {
    throw new BackupError(ERROR_CODES.PERMISSION, `cannot read sessions root ${root}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (workspace.mode === 'all') {
    return { root, workspace, dirs: names.sort().map((name) => join(root, name)), missingRoot: false }
  }
  const wanted = new Set(workspace.keys)
  const dirs = names.filter((name) => wanted.has(name)).sort().map((name) => join(root, name))
  return { root, workspace, dirs, missingRoot: false }
}

/** Count sessions and bytes under selected project directories. */
export async function sessionStats(config, cwd = process.cwd()) {
  const selected = await selectedProjectDirs(config, cwd)
  let sessions = 0
  let files = 0
  let bytes = 0
  for (const projectDir of selected.dirs) {
    const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      sessions += 1
      const sessionDir = join(projectDir, entry.name)
      const inner = await readdir(sessionDir, { withFileTypes: true }).catch(() => [])
      for (const file of inner) {
        if (!file.isFile()) continue
        if (!isSessionArtifact(file.name)) continue
        const st = await stat(join(sessionDir, file.name)).catch(() => null)
        if (st) {
          files += 1
          bytes += st.size
        }
      }
    }
  }
  return { ...selected, sessions, files, bytes, bytesLabel: formatBytes(bytes) }
}

/**
 * Validate a complete session log: decompress it, parse every JSONL record,
 * and require a final newline. A backup that catches dsh mid-append can
 * otherwise capture a complete zstd frame with a torn JSONL record, which
 * dsh rejects on restore.
 * @param {string} path
 * @returns {Promise<{ events: number, header: { id?: string, version?: number, cwd?: string, createdAt?: number } }>}
 */
export async function validateSessionLog(path) {
  const prefix = await readPrefix(path, 4)
  let stream
  let source
  if (prefix.length >= 4 && prefix[0] === 0x28 && prefix[1] === 0xb5 && prefix[2] === 0x2f && prefix[3] === 0xfd) {
    if (typeof createZstdDecompress !== 'function') {
      throw new BackupError(ERROR_CODES.ZSTD_UNSUPPORTED, 'cannot validate zstd session log: this Node.js build has no zstd support')
    }
    source = createReadStream(path)
    stream = guardDecompression(source, source.pipe(createZstdDecompress()))
  } else if (prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) {
    source = createReadStream(path)
    stream = guardDecompression(source, source.pipe(createGunzip()))
  } else {
    source = createReadStream(path)
    stream = source
  }
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let events = 0
  let header
  let endedWithNewline = false
  try {
    for await (const chunk of stream) {
      pending += decoder.write(chunk)
      let newline
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        endedWithNewline = true
        if (line.trim() === '') continue
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch (error) {
          throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `session log contains a torn or invalid JSONL record: ${path}`, { cause: error })
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `session log contains a non-object record: ${path}`)
        }
        if (header === undefined) {
          if (parsed.type !== 'session' || typeof parsed.id !== 'string') {
            throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `session log has an invalid header: ${path}`)
          }
          header = parsed
        } else {
          events += 1
        }
      }
    }
    pending += decoder.end()
  } catch (error) {
    source?.destroy()
    if (error instanceof BackupError) throw error
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `cannot decode session log ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (pending.trim() !== '') {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `session log ends with a torn JSONL record: ${path}`, {
      hint: 'The session was being appended while it was read. Stop dsh and run the backup again.',
    })
  }
  if (header === undefined || !endedWithNewline) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `session log is empty or missing its header: ${path}`)
  }
  return { events, header }
}

function guardDecompression(source, decoder) {
  decoder.on('error', () => { source.destroy() })
  source.on('error', (error) => { decoder.destroy(error) })
  decoder.on('error', () => {})
  return decoder
}

/**
 * Snapshot one session artifact to a private temp file, retrying until the
 * source is stable and the snapshot parses as a complete session log.
 * @param {string} source
 * @param {string} target
 * @param {{ flush?: () => Promise<void>, attempts?: number, signal?: AbortSignal }} [options]
 */
export async function snapshotSessionFile(source, target, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 6)
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new BackupError(ERROR_CODES.ABORTED, 'backup aborted')
    if (options.flush) await options.flush()
    const before = await stat(source)
    await copyFile(source, target)
    const after = await stat(source)
    try {
      const validated = await validateSessionLog(target)
      const stable = before.size === after.size && before.mtimeMs === after.mtimeMs
      if (stable) return { size: after.size, mtime: after.mtime, events: validated.events, header: validated.header }
      lastError = new BackupError(ERROR_CODES.SESSION_UNSTABLE, `session log kept changing while being read: ${source}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts - 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150 * (attempt + 1)))
    }
  }
  if (lastError instanceof BackupError) throw lastError
  throw new BackupError(ERROR_CODES.SESSION_UNSTABLE, `could not obtain a stable session snapshot: ${source}`, { cause: lastError })
}

/** Whether a filename is a committed session artifact we should archive. */
export function isSessionArtifact(name) {
  if (name === 'session.lock') return false
  if (name.endsWith('.tmp') || name.endsWith('.part') || name.endsWith('.partial')) return false
  return /^session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.zstd)?$/.test(name)
}

/**
 * Look for live session locks. POSIX uses a `session.lock` file; Windows uses
 * a named kernel semaphore with no file, so on Windows this check can only
 * report staleness, not live ownership.
 */
export async function detectSessionLocks(config, cwd = process.cwd()) {
  const selected = await selectedProjectDirs(config, cwd)
  const locks = []
  for (const projectDir of selected.dirs) {
    const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const lockPath = join(projectDir, entry.name, 'session.lock')
      const st = await stat(lockPath).catch(() => null)
      if (st) locks.push({ path: lockPath, mtime: st.mtimeMs, ageMs: Date.now() - st.mtimeMs })
    }
  }
  return {
    locks,
    detectable: process.platform !== 'win32',
    hint: process.platform === 'win32'
      ? 'Windows session locks are kernel semaphores without a file, so stop dsh before restoring session data.'
      : 'Stop dsh before restoring session data, or pass --allow-running to override.',
  }
}

/** Archive-relative path for a session file, given the sessions root. */
export function sessionArchivePath(sessionsRoot, absolutePath) {
  return `sessions/${toPosix(absolutePath.slice(sessionsRoot.length).replace(/^[\\/]+/, ''))}`
}
