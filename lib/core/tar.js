import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import * as zlib from 'node:zlib'
import { BackupError, ERROR_CODES } from './errors.js'
import { ensureDir, movePath, readPrefix, toPosix } from './fsutil.js'

const BLOCK = 512
const RECORD = BLOCK * 20
const ZERO_BLOCK = Buffer.alloc(BLOCK)

/** Tar entry types this implementation writes and accepts. */
export const TAR_TYPES = Object.freeze({ file: '0', symlink: '2', directory: '5' })

/**
 * Streaming ustar/PAX writer. It writes exactly one archive and is not reusable.
 */
export class TarWriter {
  /** @param {import('node:stream').Writable} stream */
  constructor(stream) {
    this.stream = stream
    this.bytes = 0
    this.finished = false
    this.entries = []
  }

  /** Start a writer on a filesystem path. */
  static async create(path) {
    await ensureDir(dirname(path))
    const stream = createWriteStream(path)
    await once(stream, 'open')
    return new TarWriter(stream)
  }

  async write(chunk) {
    if (this.finished) throw new Error('tar writer already finished')
    if (chunk.length === 0) return
    this.bytes += chunk.length
    if (!this.stream.write(chunk)) await once(this.stream, 'drain')
  }

  async pad(size) {
    const remainder = size % BLOCK
    if (remainder !== 0) await this.write(Buffer.alloc(BLOCK - remainder))
  }

  /**
   * Add a directory entry.
   * @param {string} archivePath POSIX relative path
   * @param {{ mode?: number, mtime?: Date|number, uid?: number, gid?: number }} [meta]
   */
  async addDirectory(archivePath, meta = {}) {
    const path = normalizeTarWritePath(archivePath, true)
    const mtime = toSeconds(meta.mtime)
    const mode = (meta.mode ?? 0o755) & 0o7777
    await this.writeHeader({ path, type: TAR_TYPES.directory, mode, size: 0, mtime, uid: meta.uid ?? 0, gid: meta.gid ?? 0 })
    this.entries.push({ path: path.replace(/\/$/, ''), type: 'dir', size: 0, mode, mtime })
  }

  /**
   * Add a regular file and hash its exact archived bytes.
   * @param {string} sourcePath
   * @param {string} archivePath
   * @param {{ mode?: number, mtime?: Date|number, size: number }} meta
   */
  async addFile(sourcePath, archivePath, meta) {
    const path = normalizeTarWritePath(archivePath, false)
    const size = Number(meta.size)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid file size for ${archivePath}`)
    const mode = (meta.mode ?? 0o644) & 0o7777
    const mtime = toSeconds(meta.mtime)
    await this.writeHeader({ path, type: TAR_TYPES.file, mode, size, mtime, uid: 0, gid: 0 })
    const hash = createHash('sha256')
    let written = 0
    if (size > 0) {
      const stream = createReadStream(sourcePath, { start: 0, end: size - 1 })
      for await (const chunk of stream) {
        hash.update(chunk)
        written += chunk.length
        await this.write(chunk)
      }
    }
    if (written !== size) {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `file changed while archiving: ${sourcePath} (expected ${size} bytes, read ${written})`, {
        hint: 'Stop dsh or the writer appending to this file, then run the backup again.',
      })
    }
    await this.pad(size)
    this.entries.push({ path, type: 'file', size, mode, mtime, sha256: hash.digest('hex') })
  }

  /**
   * Add an in-memory file (manifest, inventory, reports).
   * @param {string} archivePath
   * @param {Buffer|string} data
   * @param {{ mode?: number, mtime?: Date|number }} [meta]
   */
  async addBuffer(archivePath, data, meta = {}) {
    const path = normalizeTarWritePath(archivePath, false)
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const mtime = toSeconds(meta.mtime)
    const mode = (meta.mode ?? 0o600) & 0o7777
    await this.writeHeader({ path, type: TAR_TYPES.file, mode, size: buffer.length, mtime, uid: 0, gid: 0 })
    await this.write(buffer)
    await this.pad(buffer.length)
    this.entries.push({
      path,
      type: 'file',
      size: buffer.length,
      mode,
      mtime,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    })
  }

  /**
   * Add a symlink entry.
   * @param {string} archivePath
   * @param {string} linkTarget
   * @param {{ mode?: number, mtime?: Date|number }} [meta]
   */
  async addSymlink(archivePath, linkTarget, meta = {}) {
    const path = normalizeTarWritePath(archivePath, false)
    if (linkTarget.includes('\0')) throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `symlink target contains NUL: ${archivePath}`)
    const mtime = toSeconds(meta.mtime)
    const mode = (meta.mode ?? 0o777) & 0o7777
    await this.writeHeader({ path, type: TAR_TYPES.symlink, mode, size: 0, mtime, uid: 0, gid: 0, linkTarget })
    this.entries.push({
      path,
      type: 'symlink',
      size: 0,
      mode,
      mtime,
      linkTarget,
      sha256: createHash('sha256').update(linkTarget).digest('hex'),
    })
  }

  async writeHeader({ path, type, mode, size, mtime, uid, gid, linkTarget = '' }) {
    const pax = []
    let headerPath = path
    let headerLink = linkTarget
    if (!isAscii(path) || Buffer.byteLength(path) > 100) pax.push(['path', path])
    if (linkTarget !== '' && (!isAscii(linkTarget) || Buffer.byteLength(linkTarget) > 100)) pax.push(['linkpath', linkTarget])
    if (!Number.isInteger(mtime)) pax.push(['mtime', String(mtime)])
    if (size > 0o77777777777) pax.push(['size', String(size)])
    if (pax.length > 0) {
      await this.writePax(pax)
      headerPath = truncateBytes(path, 100, type === TAR_TYPES.directory)
      headerLink = truncateBytes(linkTarget, 100, false)
    }
    const split = splitUstarPath(headerPath)
    const header = Buffer.alloc(BLOCK, 0)
    writeString(header, 0, 100, split.name)
    writeOctal(header, 100, 8, mode & 0o7777)
    writeOctal(header, 108, 8, uid)
    writeOctal(header, 116, 8, gid)
    writeOctal(header, 124, 12, size)
    writeOctal(header, 136, 12, Math.max(0, Math.trunc(mtime)))
    header.fill(0x20, 148, 156)
    header[156] = type.charCodeAt(0)
    writeString(header, 157, 100, headerLink)
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')
    writeString(header, 265, 32, 'root')
    writeString(header, 297, 32, 'root')
    writeString(header, 345, 155, split.prefix)
    let checksum = 0
    for (const byte of header) checksum += byte
    writeOctal(header, 148, 8, checksum)
    await this.write(header)
  }

  async writePax(records) {
    let payload = ''
    for (const [key, value] of records) {
      const body = `${key}=${value}\n`
      const bodyLength = Buffer.byteLength(body)
      let length = bodyLength + 2
      while (String(length).length + 1 + bodyLength !== length) length = String(length).length + 1 + bodyLength
      payload += `${length} ${body}`
    }
    const data = Buffer.from(payload, 'utf8')
    const name = `PaxHeaders.${process.pid}/${Date.now().toString(36)}`
    const header = Buffer.alloc(BLOCK, 0)
    writeString(header, 0, 100, name)
    writeOctal(header, 100, 8, 0o600)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, data.length)
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
    header.fill(0x20, 148, 156)
    header[156] = 'x'.charCodeAt(0)
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')
    let checksum = 0
    for (const byte of header) checksum += byte
    writeOctal(header, 148, 8, checksum)
    await this.write(header)
    await this.write(data)
    await this.pad(data.length)
  }

  /** Write the two end blocks and close the stream. */
  async finalize() {
    if (this.finished) return
    await this.write(ZERO_BLOCK)
    await this.write(ZERO_BLOCK)
    const remainder = this.bytes % RECORD
    if (remainder !== 0) await this.write(Buffer.alloc(RECORD - remainder))
    this.finished = true
    this.stream.end()
    await once(this.stream, 'close')
  }

  /** Abort the stream without finalizing. */
  async abort() {
    if (this.finished) return
    this.finished = true
    this.stream.destroy()
    await once(this.stream, 'close').catch(() => undefined)
  }
}

/**
 * Streaming tar reader. One instance reads one archive.
 */
export class TarReader {
  /** @param {AsyncIterable<Buffer>} source */
  constructor(source) {
    this.iterator = source[Symbol.asyncIterator]()
    this.buffer = Buffer.alloc(0)
    this.offset = 0
    this.pendingEntry = null
    this.globalPax = {}
  }

  /** Read exactly n bytes or throw on EOF. */
  async readExact(n) {
    while (this.buffer.length < n) {
      const next = await this.iterator.next()
      if (next.done) {
        if (this.buffer.length === 0 && n === BLOCK) return null
        throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive ended in the middle of a tar block')
      }
      this.buffer = this.buffer.length === 0 ? next.value : Buffer.concat([this.buffer, next.value])
    }
    const out = this.buffer.subarray(0, n)
    this.buffer = this.buffer.subarray(n)
    this.offset += n
    return out
  }

  /** Skip exactly n bytes. */
  async skip(n) {
    let remaining = n
    while (remaining > 0) {
      if (this.buffer.length > 0) {
        const take = Math.min(remaining, this.buffer.length)
        this.buffer = this.buffer.subarray(take)
        remaining -= take
        this.offset += take
      } else {
        const next = await this.iterator.next()
        if (next.done) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive ended while skipping tar padding')
        this.buffer = next.value
      }
    }
  }

  /**
   * Return the next entry, or null at the end. The previous entry's data is
   * skipped if the caller did not consume it.
   * @returns {Promise<null | { path: string, type: 'file'|'dir'|'symlink', size: number, mode: number, mtime: number, linkTarget?: string, read: () => AsyncGenerator<Buffer> }>}
   */
  async next() {
    if (this.pendingEntry !== null) {
      await this.skip(this.pendingEntry.remaining + this.pendingEntry.padding)
      this.pendingEntry = null
    }
    let pax = { ...this.globalPax }
    for (;;) {
      const header = await this.readExact(BLOCK)
      if (header === null) return null
      if (isZeroBlock(header)) {
        // Consume the second zero block when present, then stop.
        const second = await this.readExact(BLOCK)
        if (second !== null && !isZeroBlock(second)) {
          throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'tar end marker is not followed by a zero block')
        }
        return null
      }
      verifyChecksum(header)
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
      const size = readOctal(header, 124, 12)
      if (type === 'x' || type === 'g') {
        const payload = await this.readBytes(size)
        await this.skip(paddingFor(size))
        const records = parsePax(payload)
        if (type === 'g') this.globalPax = { ...this.globalPax, ...records }
        else pax = { ...pax, ...records }
        continue
      }
      if (type === 'L') {
        const payload = await this.readBytes(size)
        await this.skip(paddingFor(size))
        pax.path = payload.toString('utf8').replace(/\0+$/, '')
        continue
      }
      const name = cString(header, 0, 100)
      const prefix = cString(header, 345, 155)
      let path = prefix === '' ? name : `${prefix}/${name}`
      if (pax.path !== undefined) path = pax.path
      path = normalizeArchivePath(path, type === '5')
      const linkTarget = pax.linkpath ?? cString(header, 157, 100)
      const mtime = pax.mtime !== undefined ? Number(pax.mtime) : readOctal(header, 136, 12)
      const mode = readOctal(header, 100, 8)
      const effectiveSize = pax.size !== undefined ? Number(pax.size) : size
      if (!Number.isSafeInteger(effectiveSize) || effectiveSize < 0) {
        throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `invalid entry size for ${path}`)
      }
      let entryType
      if (type === '0' || type === '\0') entryType = 'file'
      else if (type === '5') entryType = 'dir'
      else if (type === '2') entryType = 'symlink'
      else if (type === '1') {
        throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `hard-link tar entry is not supported: ${path}`)
      } else {
        throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `unsupported tar entry type ${JSON.stringify(type)} for ${path}`)
      }
      const padding = entryType === 'file' ? paddingFor(effectiveSize) : 0
      const entry = {
        path,
        type: entryType,
        size: effectiveSize,
        mode: mode || (entryType === 'dir' ? 0o755 : 0o644),
        mtime: Number.isFinite(mtime) ? mtime : 0,
        linkTarget,
        read: () => this.readEntryData(effectiveSize),
      }
      this.pendingEntry = { remaining: entryType === 'file' ? effectiveSize : 0, padding }
      return entry
    }
  }

  async *readEntryData(size) {
    let remaining = size
    while (remaining > 0) {
      if (this.buffer.length === 0) {
        const next = await this.iterator.next()
        if (next.done) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive ended in the middle of a file entry')
        this.buffer = next.value
      }
      const take = Math.min(remaining, this.buffer.length)
      const chunk = this.buffer.subarray(0, take)
      this.buffer = this.buffer.subarray(take)
      remaining -= take
      this.offset += take
      if (this.pendingEntry) this.pendingEntry.remaining = remaining
      yield chunk
    }
  }

  async readBytes(size) {
    const chunks = []
    for await (const chunk of this.readEntryData(size)) chunks.push(chunk)
    return Buffer.concat(chunks)
  }

  /** Consume any unread data and padding for the previous entry. */
  async closeEntry() {
    if (this.pendingEntry === null) return
    await this.skip(this.pendingEntry.remaining + this.pendingEntry.padding)
    this.pendingEntry = null
  }
}

/** Pad bytes for a data size. */
export function paddingFor(size) {
  const remainder = size % BLOCK
  return remainder === 0 ? 0 : BLOCK - remainder
}

/** Normalize and validate a path from an untrusted archive. */
export function normalizeArchivePath(path, directory = false) {
  if (typeof path !== 'string' || path === '') throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, 'archive entry has an empty path')
  if (path.includes('\0')) throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, 'archive entry path contains NUL')
  let p = toPosix(path).replace(/^\.\/+/, '')
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `archive entry uses an absolute path: ${path}`)
  const parts = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `archive entry escapes its root: ${path}`)
    parts.push(part)
  }
  if (parts.length === 0) throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `archive entry has no path segments: ${path}`)
  p = parts.join('/')
  return p
}

/** Detect the codec from magic bytes, independent of the file extension. */
export function detectCodec(prefix) {
  if (prefix.length >= 4 && prefix[0] === 0x28 && prefix[1] === 0xb5 && prefix[2] === 0x2f && prefix[3] === 0xfd) return 'zstd'
  if (prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) return 'gzip'
  if (prefix.length >= 262 && prefix.subarray(257, 262).toString('ascii') === 'ustar') return 'none'
  return 'none'
}

/** Codec from a filename, for reporting and default choices. */
export function codecFromName(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tar.zst') || lower.endsWith('.tzst') || lower.endsWith('.zst')) return 'zstd'
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.gz')) return 'gzip'
  if (lower.endsWith('.tar')) return 'none'
  return undefined
}

function guardDecompression(source, decoder) {
  // A late zstd/gzip error after the consumer stops reading must never become
  // an unhandled 'error' event in the dsh host process.
  decoder.on('error', () => { source.destroy() })
  source.on('error', (error) => { decoder.destroy(error) })
  decoder.on('error', () => {})
  return decoder
}

/** Open a decompression stream for an archive. */
export async function openArchiveStream(path) {
  const prefix = await readPrefix(path, 512)
  if (prefix.length === 0) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive is empty: ${path}`)
  const codec = detectCodec(prefix)
  if (codec === 'zstd') {
    if (typeof zlib.createZstdDecompress !== 'function') {
      throw new BackupError(ERROR_CODES.ZSTD_UNSUPPORTED, 'this Node.js build has no zstd support; use a gzip archive or upgrade Node.js')
    }
    const source = createReadStream(path)
    return { stream: guardDecompression(source, source.pipe(zlib.createZstdDecompress())), codec }
  }
  if (codec === 'gzip') {
    const source = createReadStream(path)
    return { stream: guardDecompression(source, source.pipe(zlib.createGunzip())), codec }
  }
  const stream = createReadStream(path)
  stream.on('error', () => {})
  return { stream, codec }
}

/** Compress an uncompressed tar file to its final archive path. */
export async function compressArchive(sourceTar, target, compression, level, onProgress) {
  await ensureDir(dirname(target))
  const total = (await stat(sourceTar)).size
  const tracker = () => {
    if (typeof onProgress !== 'function') return undefined
    let read = 0
    return new Transform({
      transform(chunk, _encoding, callback) {
        read += chunk.length
        try {
          onProgress(total === 0 ? 1 : Math.min(1, read / total))
        } catch {
          // ignore listener errors
        }
        callback(null, chunk)
      },
    })
  }
  if (compression === 'none') {
    await movePath(sourceTar, target)
    return
  }
  if (compression === 'gzip') {
    const counter = tracker()
    if (counter) await pipeline(createReadStream(sourceTar), counter, zlib.createGzip({ level: clamp(level, 1, 9) }), createWriteStream(target))
    else await pipeline(createReadStream(sourceTar), zlib.createGzip({ level: clamp(level, 1, 9) }), createWriteStream(target))
    return
  }
  if (typeof zlib.createZstdCompress !== 'function') {
    throw new BackupError(ERROR_CODES.ZSTD_UNSUPPORTED, 'this Node.js build has no zstd support; set compression: gzip or none')
  }
  const params = {}
  if (zlib.constants.ZSTD_c_compressionLevel !== undefined) params[zlib.constants.ZSTD_c_compressionLevel] = clamp(level, 1, 22)
  const counter = tracker()
  if (counter) await pipeline(createReadStream(sourceTar), counter, zlib.createZstdCompress({ params }), createWriteStream(target))
  else await pipeline(createReadStream(sourceTar), zlib.createZstdCompress({ params }), createWriteStream(target))
}

/** Read a whole JSON file from an archive entry, bounded. */
export async function readEntryJson(entry, maxBytes = 16 * 1024 * 1024) {
  if (entry.size > maxBytes) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive metadata entry is too large: ${entry.path}`)
  const chunks = []
  for await (const chunk of entry.read()) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `invalid JSON in archive entry ${entry.path}`, { cause: error })
  }
}

/** Compute the SHA-256 of a file. */
export async function hashFile(path) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

/** Open a file and return its size, throwing a clear error when absent. */
export async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `archive not found: ${path}`)
    }
    throw error
  }
}

function normalizeTarWritePath(path, directory) {
  let p = toPosix(path).replace(/^\/+/, '')
  if (directory) p = p.endsWith('/') ? p : `${p}/`
  return p
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  const parts = path.split('/')
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const prefix = parts.slice(0, i).join('/')
    const name = parts.slice(i).join('/')
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  return { name: truncateBytes(path, 100, false), prefix: '' }
}

function truncateBytes(value, max, directory) {
  const buf = Buffer.from(value, 'utf8')
  if (buf.length <= max) return value
  let end = max
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  const text = buf.subarray(0, end).toString('utf8')
  return directory && !text.endsWith('/') ? `${text}/` : text
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8')
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length))
}

function writeOctal(buffer, offset, length, value) {
  const n = Math.max(0, Math.trunc(Number(value) || 0))
  const text = n.toString(8).padStart(length - 1, '0').slice(-(length - 1))
  buffer.write(text, offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

function readOctal(buffer, offset, length) {
  const text = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) ? value : 0
}

function cString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length)
  const zero = slice.indexOf(0)
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString('utf8')
}

function isZeroBlock(block) {
  for (const byte of block) if (byte !== 0) return false
  return true
}

function verifyChecksum(header) {
  const expected = readOctal(header, 148, 8)
  let actual = 0
  for (let i = 0; i < BLOCK; i += 1) {
    actual += i >= 148 && i < 156 ? 0x20 : header[i]
  }
  if (expected !== actual) {
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `tar header checksum mismatch (expected ${expected}, computed ${actual})`)
  }
}

function parsePax(payload) {
  const records = {}
  let offset = 0
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset)
    if (space === -1) break
    const length = Number(payload.subarray(offset, space).toString('ascii'))
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > payload.length) {
      throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'malformed PAX header length')
    }
    const record = payload.subarray(space + 1, offset + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1)
    offset += length
  }
  return records
}

function isAscii(value) {
  return /^[\x00-\x7F]*$/.test(value)
}

function toSeconds(value) {
  if (value === undefined) return Math.floor(Date.now() / 1000)
  if (value instanceof Date) return value.getTime() / 1000
  return Number(value)
}

function clamp(value, min, max) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : max
}

/** Buffer size helper used by tests. */
export function tarRecordSize(bytes) {
  return Math.ceil(bytes / RECORD) * RECORD
}

/** Human name for an archive codec. */
export function codecLabel(codec) {
  return codec === 'zstd' ? 'Zstandard' : codec === 'gzip' ? 'gzip' : 'uncompressed tar'
}

export { basename }
