import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { BackupError, ERROR_CODES } from './errors.js'
import { atomicWriteFile, ensureDir, sha256File, toPosix } from './fsutil.js'

export const MANIFEST_NAME = 'dsh-backup.json'
export const MANIFEST_FORMAT = 'dsh-backup'
export const MANIFEST_VERSION = 1
export const TOOL_NAME = 'dsh-whale'
export const TOOL_VERSION = '0.56.0'

/** Top-level archive roots and their restore destinations. */
export const ARCHIVE_ROOTS = Object.freeze({
  sessions: 'sessions',
  profiles: 'profiles',
  home: '.',
  storages: 'storages',
  plugins: 'plugins',
  'local-plugins': '.dsh-backup/local-plugins',
  state: '.dsh-backup/state',
  'workspace-files': undefined,
  meta: undefined,
})

/** Build the manifest object written as the last tar entry. */
export function createManifest(meta, entries) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  const files = sorted.filter((entry) => entry.type === 'file')
  const dirs = sorted.filter((entry) => entry.type === 'dir')
  const symlinks = sorted.filter((entry) => entry.type === 'symlink')
  const manifest = {
    format: MANIFEST_FORMAT,
    formatVersion: MANIFEST_VERSION,
    tool: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    label: meta.label ?? '',
    host: meta.host,
    source: meta.source,
    workspace: meta.workspace,
    compression: meta.compression,
    includesCredentials: meta.includesCredentials === true,
    includesEnv: meta.includesEnv === true,
    inventory: meta.inventory,
    localLinkPlugins: meta.localLinkPlugins ?? [],
    workspaceFiles: meta.workspaceFiles ?? [],
    entries: sorted,
    summary: {
      files: files.length,
      directories: dirs.length,
      symlinks: symlinks.length,
      totalBytes: files.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
      sessions: countSessionDirs(sorted),
      sessionFiles: files.filter((entry) => entry.path.startsWith('sessions/')).length,
    },
    warnings: meta.warnings ?? [],
  }
  manifest.manifestSha256 = digestManifest(manifest)
  return manifest
}

/** Digest the semantic manifest, excluding the digest field itself. */
export function digestManifest(manifest) {
  const { manifestSha256: _ignored, ...rest } = manifest
  return createHash('sha256').update(stableStringify(rest)).digest('hex')
}

/** Serialize a manifest with a trailing newline. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** Parse and structurally validate a manifest. */
export function parseManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest is not an object')
  }
  if (value.format !== MANIFEST_FORMAT) {
    throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `not a DSH backup archive (format ${JSON.stringify(value.format)})`)
  }
  if (value.formatVersion !== MANIFEST_VERSION) {
    throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `unsupported backup format version ${JSON.stringify(value.formatVersion)}; this plugin reads version ${MANIFEST_VERSION}`, {
      hint: 'Upgrade dsh-plugin-backup to read this archive.',
    })
  }
  if (!Array.isArray(value.entries)) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest has no entries array')
  }
  if (typeof value.manifestSha256 !== 'string') {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest has no digest')
  }
  const expected = digestManifest(value)
  if (expected !== value.manifestSha256) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest digest does not match its contents', {
      details: { expected, actual: value.manifestSha256 },
    })
  }
  const seen = new Set()
  for (const entry of value.entries) {
    if (entry === null || typeof entry !== 'object') {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest contains a non-object entry')
    }
    if (typeof entry.path !== 'string' || typeof entry.type !== 'string') {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive manifest entry is missing path/type')
    }
    if (seen.has(entry.path)) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive manifest repeats path ${entry.path}`)
    seen.add(entry.path)
    if (!['file', 'dir', 'symlink'].includes(entry.type)) {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive manifest entry ${entry.path} has unknown type ${entry.type}`)
    }
    if (entry.type === 'file' && (typeof entry.sha256 !== 'string' || !Number.isSafeInteger(entry.size))) {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive manifest file ${entry.path} has no size/hash`)
    }
    if (entry.type === 'symlink' && typeof entry.linkTarget !== 'string') {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive manifest symlink ${entry.path} has no target`)
    }
    assertArchivePath(entry.path)
  }
  return value
}

/** Ensure a manifest path is relative and cannot escape the archive root. */
export function assertArchivePath(path) {
  const p = toPosix(path)
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..') || p.includes('\0')) {
    throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `unsafe archive path: ${path}`)
  }
  const root = p.split('/')[0]
  if (!Object.hasOwn(ARCHIVE_ROOTS, root) && root !== MANIFEST_NAME) {
    throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `unknown archive root ${JSON.stringify(root)} in ${path}`)
  }
  if (p === 'home/.dsh-backup.lock' || p.startsWith('home/.dsh-backup/') || p.startsWith('home/backups/')) {
    throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `archive tries to write an internal DSH backup path: ${path}`)
  }
}

/**
 * Compare the manifest with the entries actually extracted from the archive.
 * @returns {{ ok: boolean, missing: string[], extra: string[], mismatched: Array<{path: string, reason: string}> }}
 */
export function verifyManifestEntries(manifest, actualEntries, options = {}) {
  const manifestMap = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  const actualMap = new Map()
  const duplicates = []
  for (const entry of actualEntries) {
    if (actualMap.has(entry.path)) duplicates.push(entry.path)
    actualMap.set(entry.path, entry)
  }
  const missing = []
  const mismatched = []
  for (const [path, expected] of manifestMap) {
    const actual = actualMap.get(path)
    if (!actual) {
      missing.push(path)
      continue
    }
    if (actual.type !== expected.type) {
      mismatched.push({ path, reason: `type ${actual.type} != ${expected.type}` })
      continue
    }
    if (expected.type === 'file') {
      if (actual.size !== expected.size) mismatched.push({ path, reason: `size ${actual.size} != ${expected.size}` })
      if (options.skipHash === true) continue
      if (actual.sha256 !== expected.sha256) mismatched.push({ path, reason: 'sha256 mismatch' })
    }
    if (expected.type === 'symlink' && actual.linkTarget !== expected.linkTarget) {
      mismatched.push({ path, reason: `symlink target ${JSON.stringify(actual.linkTarget)} != ${JSON.stringify(expected.linkTarget)}` })
    }
  }
  const extra = [...actualMap.keys()].filter((path) => !manifestMap.has(path) && path !== MANIFEST_NAME)
  return { ok: missing.length === 0 && extra.length === 0 && mismatched.length === 0 && duplicates.length === 0, missing, extra, mismatched, duplicates }
}

/** Restore destination for a manifest path, or undefined for metadata-only paths. */
export function restoreTargetPath(path, dshHome, options = {}) {
  const p = toPosix(path)
  if (p === MANIFEST_NAME) return undefined
  const root = p.split('/')[0]
  const destination = ARCHIVE_ROOTS[root]
  if (destination === undefined) return undefined
  const rest = p.slice(root.length + 1)
  if (root === 'sessions') {
    const sessionsRoot = options.sessionsRoot ?? join(dshHome, 'sessions')
    return rest === '' ? sessionsRoot : join(sessionsRoot, rest)
  }
  if (destination === '.') return join(dshHome, rest)
  if (rest === '') return join(dshHome, destination)
  return join(dshHome, destination, rest)
}

/** Category label used in reports. */
export function archiveCategory(path) {
  const p = toPosix(path)
  if (p === MANIFEST_NAME) return 'manifest'
  return p.split('/')[0]
}

/** Write `<archive>.sha256`. */
export async function writeChecksumSidecar(archivePath) {
  const digest = await sha256File(archivePath)
  const sidecarPath = `${archivePath}.sha256`
  await ensureDir(dirname(sidecarPath))
  await atomicWriteFile(sidecarPath, `${digest}  ${basename(archivePath)}\n`, 0o600)
  return { digest, sidecarPath }
}

/** Read `<archive>.sha256` if present. */
export async function readChecksumSidecar(archivePath) {
  const sidecarPath = `${archivePath}.sha256`
  try {
    const text = await readFile(sidecarPath, 'utf8')
    const match = /^([a-f0-9]{64})\b/i.exec(text.trim())
    if (!match) {
      throw new BackupError(ERROR_CODES.CHECKSUM_MISMATCH, `checksum sidecar is malformed: ${sidecarPath}`)
    }
    return { digest: match[1].toLowerCase(), sidecarPath }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Verify an archive against its sidecar. */
export async function verifyArchiveChecksum(archivePath, options = {}) {
  const sidecar = await readChecksumSidecar(archivePath)
  if (!sidecar) {
    if (options.require === true) {
      throw new BackupError(ERROR_CODES.CHECKSUM_MISMATCH, `checksum sidecar is missing: ${archivePath}.sha256`, {
        hint: 'Copy the .sha256 file together with the archive, or set requireChecksum: false.',
      })
    }
    return { verified: false, digest: await sha256File(archivePath), sidecar: undefined }
  }
  const actual = await sha256File(archivePath)
  if (actual !== sidecar.digest) {
    throw new BackupError(ERROR_CODES.CHECKSUM_MISMATCH, 'archive checksum does not match its .sha256 sidecar', {
      details: { expected: sidecar.digest, actual },
      hint: 'Re-download or re-copy the archive; do not restore a corrupted file.',
    })
  }
  return { verified: true, digest: actual, sidecar: sidecar.sidecarPath }
}

/** Count restored session directories in a manifest entry list. */
function countSessionDirs(entries) {
  const sessions = new Set()
  for (const entry of entries) {
    if (!entry.path.startsWith('sessions/')) continue
    const parts = entry.path.split('/')
    if (parts.length >= 3) sessions.add(`${parts[0]}/${parts[1]}/${parts[2]}`)
  }
  return sessions.size
}

/** Deterministic JSON stringification for digests. */
export function stableStringify(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}
