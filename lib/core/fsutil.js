import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

/** True when the path exists (including symlinks). */
export async function pathExists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/** lstat without throwing for absence. */
export async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/** stat without throwing for absence. */
export async function statOrNull(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/** mkdir -p. */
export async function ensureDir(path, mode) {
  await mkdir(path, { recursive: true, ...(mode === undefined ? {} : { mode }) })
}

/** Recursively remove a path, ignoring absence. */
export async function removePath(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

/**
 * Walk a tree without following symlinks. Errors are reported via `onError`
 * and the walk continues, because one unreadable cache file must not abort a
 * whole backup.
 *
 * @param {string} root absolute root
 * @param {{
 *   exclude?: string[],
 *   maxFileSize?: number,
 *   includeDirs?: boolean,
 *   signal?: AbortSignal,
 *   onError?: (error: unknown, rel: string) => void,
 *   onSkip?: (rel: string, reason: string, size?: number) => void,
 * }} [options]
 * @returns {AsyncGenerator<{ abs: string, rel: string, type: 'file'|'dir'|'symlink', stat: import('node:fs').Stats, linkTarget?: string }>}
 */
export async function* walk(root, options = {}) {
  const exclude = options.exclude ?? []
  const includeDirs = options.includeDirs ?? true
  const maxFileSize = options.maxFileSize ?? Number.POSITIVE_INFINITY
  const stack = [{ abs: root, rel: '' }]
  while (stack.length > 0) {
    if (options.signal?.aborted) throw abortError(options.signal)
    const current = stack.pop()
    let st
    try {
      st = await lstat(current.abs)
    } catch (error) {
      options.onError?.(error, current.rel || '.')
      continue
    }
    if (current.rel !== '') {
      if (isExcluded(current.rel, exclude)) continue
      if (st.isSymbolicLink()) {
        let linkTarget = ''
        try {
          linkTarget = (await readlinkSafe(current.abs)) ?? ''
        } catch (error) {
          options.onError?.(error, current.rel)
        }
        yield { abs: current.abs, rel: toPosix(current.rel), type: 'symlink', stat: st, linkTarget }
        continue
      }
      if (st.isDirectory()) {
        if (includeDirs) yield { abs: current.abs, rel: toPosix(current.rel), type: 'dir', stat: st }
      } else if (st.isFile()) {
        if (st.size > maxFileSize) {
          options.onSkip?.(toPosix(current.rel), `larger than maxFileSize (${st.size} bytes)`, st.size)
          continue
        }
        yield { abs: current.abs, rel: toPosix(current.rel), type: 'file', stat: st }
        continue
      } else {
        options.onSkip?.(toPosix(current.rel), 'not a regular file, directory or symlink')
        continue
      }
    }
    if (st.isDirectory()) {
      let entries
      try {
        entries = await readdir(current.abs, { withFileTypes: true })
      } catch (error) {
        options.onError?.(error, current.rel || '.')
        continue
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i]
        const childRel = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`
        if (isExcluded(childRel, exclude)) continue
        stack.push({ abs: resolve(current.abs, entry.name), rel: childRel })
      }
    }
  }
}

/** Match a relative POSIX path against a small, predictable glob subset. */
export function isExcluded(relPosix, patterns) {
  const rel = toPosix(relPosix).replace(/^\.\//, '')
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  for (const pattern of patterns) {
    if (pattern === '') continue
    const normalized = toPosix(pattern)
    if (matchGlob(rel, normalized) || matchGlob(base, normalized)) return true
    // A bare directory pattern also excludes its contents.
    if (!/[?*[\]{]/.test(normalized) && (rel === normalized || rel.startsWith(`${normalized}/`))) return true
  }
  return false
}

const globCache = new Map()

/** Convert `*`, `?`, `**` and character classes into a RegExp. */
export function globToRegExp(pattern) {
  const cached = globCache.get(pattern)
  if (cached) return cached
  let out = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      const slash = pattern[i + 2] === '/'
      out += slash ? '(?:.*/)?' : '.*'
      i += slash ? 3 : 2
      continue
    }
    if (ch === '*') {
      out += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      out += '[^/]'
      i += 1
      continue
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) {
        out += '\\['
        i += 1
        continue
      }
      let klass = pattern.slice(i + 1, end)
      if (klass.startsWith('!')) klass = `^${klass.slice(1)}`
      out += `[${klass.replace(/\\/g, '\\\\')}]`
      i = end + 1
      continue
    }
    out += ch.replace(/[.+^${}()|\\]/g, '\\$&')
    i += 1
  }
  out += '$'
  const regexp = new RegExp(out)
  globCache.set(pattern, regexp)
  return regexp
}

function matchGlob(value, pattern) {
  return globToRegExp(pattern).test(value)
}

/** SHA-256 of a file. */
export async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** SHA-256 of a string or Buffer. */
export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Copy a file, creating parent directories. */
export async function copyFileEnsured(source, target, mode) {
  await ensureDir(dirname(target))
  await copyFile(source, target)
  if (mode !== undefined) {
    try {
      await chmod(target, mode)
    } catch {
      // chmod is best-effort on Windows.
    }
  }
}

/** Rename with a copy/remove fallback for cross-device or Windows replacement. */
export async function movePath(source, target) {
  await ensureDir(dirname(target))
  try {
    await rename(source, target)
    return
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'EXDEV' && code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error
  }
  await rm(target, { recursive: true, force: true })
  try {
    await rename(source, target)
    return
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error
  }
  await copyTree(source, target)
  await rm(source, { recursive: true, force: true })
}

/** Recursively copy a tree, preserving symlinks as symlinks when possible. */
export async function copyTree(source, target) {
  const st = await lstat(source)
  if (st.isSymbolicLink()) {
    await ensureDir(dirname(target))
    const linkTarget = await readlinkSafe(source)
    if (linkTarget !== null) await symlinkSafe(linkTarget, target)
    return
  }
  if (st.isDirectory()) {
    await ensureDir(target, st.mode)
    const entries = await readdir(source)
    for (const entry of entries) await copyTree(resolve(source, entry), resolve(target, entry))
    return
  }
  if (st.isFile()) {
    await copyFileEnsured(source, target, st.mode)
  }
}

/** Read a symlink target, returning null for non-symlinks. */
export async function readlinkSafe(path) {
  try {
    const { readlink } = await import('node:fs/promises')
    return await readlink(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EINVAL' || errorCode(error) === 'UNKNOWN') return null
    throw error
  }
}

/** Create a symlink, converting Windows EPERM into a useful error. */
export async function symlinkSafe(linkTarget, target, type) {
  const { symlink } = await import('node:fs/promises')
  await ensureDir(dirname(target))
  try {
    await symlink(linkTarget, target, type)
  } catch (error) {
    if (errorCode(error) === 'EPERM' || errorCode(error) === 'EACCES') {
      const err = new Error(`cannot create symlink ${target} -> ${linkTarget}: Windows requires Developer Mode or administrator privileges`, { cause: error })
      err.code = 'EPERM'
      throw err
    }
    throw error
  }
}

/** Write a file atomically through a sibling temp file. */
export async function atomicWriteFile(target, data, mode = 0o600) {
  await ensureDir(dirname(target))
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, data, { mode })
  try {
    await chmod(temp, mode)
  } catch {
    // best effort
  }
  await movePath(temp, target)
  try {
    await chmod(target, mode)
  } catch {
    // best effort
  }
}

/** Write JSON with a trailing newline, atomically. */
export async function writeJsonFile(target, value, mode = 0o600) {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`, mode)
}

/** Read JSON with a clear error. */
export async function readJsonFile(path) {
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

/** Absolute, normalized path comparison that is case-insensitive on Windows. */
export function isWithin(child, parent) {
  const a = resolve(child)
  const b = resolve(parent)
  if (process.platform === 'win32') {
    const ac = a.toLowerCase()
    const bc = b.toLowerCase()
    return ac === bc || ac.startsWith(`${bc}${sep}`)
  }
  return a === b || a.startsWith(`${b}${sep}`)
}

/** Relative POSIX path from a base. */
export function relPosix(from, to) {
  return toPosix(relative(from, to))
}

/** Convert Windows separators to `/`. */
export function toPosix(path) {
  return path.replace(/\\/g, '/')
}

/** Filesystem-safe timestamp used in archive names. */
export function timestampForName(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

/** Human-readable byte count. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = n
  let index = -1
  do {
    value /= 1024
    index += 1
  } while (value >= 1024 && index < units.length - 1)
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

/** Promise sleep. */
export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

/** Error code without trusting the thrown value. */
export function errorCode(error) {
  return error && typeof error === 'object' ? error.code : undefined
}

/** Abort reason normalized to an Error. */
export function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

/** Create the temp directory for an operation and return a unique child. */
export async function makeTempDir(base, prefix) {
  await ensureDir(base)
  const path = resolve(base, `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
  await ensureDir(path, 0o700)
  return path
}

/** Open a file and return its first N bytes. */
export async function readPrefix(path, length = 512) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Remove a path while tolerating absence. */
export async function unlinkIfExists(path) {
  try {
    await unlink(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

export { createWriteStream }
