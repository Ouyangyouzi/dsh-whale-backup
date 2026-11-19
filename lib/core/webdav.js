import { createReadStream, createWriteStream } from 'node:fs'
import { stat, readFile, rename, rm } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { basename, dirname } from 'node:path'
import net from 'node:net'
import { pipeline } from 'node:stream/promises'
import { BackupError, ERROR_CODES } from './errors.js'
import { ensureDir, formatBytes, sleep } from './fsutil.js'

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`

/** URL-encode every path segment without destroying existing slashes. */
export function encodePath(path) {
  return path.split('/').filter((part) => part !== '').map((part) => encodeURIComponent(part)).join('/')
}

/** Join a WebDAV base URL and relative path, preserving the base path. */
export function joinUrl(base, path = '') {
  const url = new URL(base)
  const basePath = url.pathname.replace(/\/+$/, '')
  const extra = encodePath(path)
  url.pathname = `${basePath}/${extra}`.replace(/\/{2,}/g, '/')
  url.search = ''
  url.hash = ''
  return url
}

/** Build the collection URL for the configured remote directory. */
export function collectionUrl(config) {
  if (!config.webdav.url) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'webdav.url is not configured', {
      hint: 'Set webdav.url (and credentials) in the plugin row config, or use --to local.',
    })
  }
  return joinUrl(config.webdav.url, config.webdav.remoteDir)
}

/** One WebDAV client bound to the plugin config. */
export class WebdavClient {
  constructor(config, logger) {
    this.config = config
    this.webdav = config.webdav
    this.logger = logger
    this.collection = collectionUrl(config)
    this.baseOrigin = new URL(this.webdav.url).origin
  }

  authHeader() {
    const w = this.webdav
    if (w.auth === 'bearer' && w.token) return `Bearer ${w.token}`
    if (w.auth === 'basic' && (w.username || w.password)) {
      return `Basic ${Buffer.from(`${w.username}:${w.password}`, 'utf8').toString('base64')}`
    }
    return undefined
  }

  headers(extra = {}) {
    const auth = this.authHeader()
    return {
      'User-Agent': 'dsh-whale-backup/0.56.0',
      ...(auth ? { Authorization: auth } : {}),
      ...this.webdav.headers,
      ...extra,
    }
  }

  /** Ensure the remote collection exists, creating each missing segment. */
  async ensureCollection(signal) {
    const base = new URL(this.webdav.url)
    const segments = this.webdav.remoteDir.split('/').filter(Boolean)
    let current = base.pathname.replace(/\/+$/, '')
    for (const segment of segments) {
      current = `${current}/${encodeURIComponent(segment)}`
      const url = new URL(base.toString())
      url.pathname = current
      url.search = ''
      const response = await this.request('MKCOL', url, { signal, allowStatus: [200, 201, 204, 301, 405] })
      if (response.status === 409) {
        throw new BackupError(ERROR_CODES.WEBDAV_CONFLICT, `WebDAV parent collection is missing while creating ${url.pathname}`)
      }
    }
    return this.collection
  }

  /** List files in the backup collection. */
  async list(signal) {
    await this.ensureCollection(signal)
    const response = await this.request('PROPFIND', this.collection, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: Buffer.from(PROPFIND_BODY, 'utf8'),
      signal,
      allowStatus: [207, 200],
      collectBody: true,
    })
    const xml = response.body.toString('utf8')
    const entries = parseMultistatus(xml, this.collection)
    return entries
      .filter((entry) => entry.name !== '' && entry.name !== decodeURIComponent(this.collection.pathname.split('/').filter(Boolean).at(-1) ?? ''))
      .filter((entry) => !entry.collection)
  }

  /** Upload an archive and its `.sha256` sidecar atomically. */
  async upload(archivePath, archiveName, signal) {
    await this.ensureCollection(signal)
    const st = await stat(archivePath)
    const tempName = `.${archiveName}.${process.pid}.${Date.now()}.part`
    const finalUrl = joinUrl(this.collection.toString(), archiveName)
    const tempUrl = joinUrl(this.collection.toString(), tempName)
    try {
      await this.putFile(tempUrl, archivePath, st.size, signal)
      try {
        await this.move(tempUrl, finalUrl, signal)
      } catch (error) {
        if (!(error instanceof BackupError) || ![405, 501].includes(error.details?.status)) throw error
        this.logger?.warn?.('WebDAV server rejected MOVE; uploading directly (non-atomic fallback)')
        await this.deleteUrl(finalUrl, signal)
        await this.putFile(finalUrl, archivePath, st.size, signal)
        await this.deleteUrl(tempUrl, signal).catch(() => undefined)
      }
      if (this.webdav.verifyUpload) {
        const head = await this.head(finalUrl, signal)
        if (head.size !== undefined && head.size !== st.size) {
          throw new BackupError(ERROR_CODES.WEBDAV_PROTOCOL, `WebDAV upload size mismatch for ${archiveName}`, {
            details: { expected: st.size, actual: head.size },
          })
        }
      }
      const sidecarPath = `${archivePath}.sha256`
      const sidecarName = `${archiveName}.sha256`
      const sidecarStat = await stat(sidecarPath)
      const sidecarUrl = joinUrl(this.collection.toString(), sidecarName)
      await this.putFile(sidecarUrl, sidecarPath, sidecarStat.size, signal)
      if (this.webdav.verifyUpload) {
        const remote = await this.getText(sidecarUrl, signal)
        const local = await readFile(sidecarPath, 'utf8')
        if (remote.trim() !== local.trim()) {
          throw new BackupError(ERROR_CODES.WEBDAV_PROTOCOL, `WebDAV checksum sidecar verification failed for ${sidecarName}`)
        }
      }
      return { name: archiveName, sidecarName, bytes: st.size, bytesLabel: formatBytes(st.size), url: finalUrl.toString() }
    } catch (error) {
      await this.deleteUrl(tempUrl, signal).catch(() => undefined)
      throw error
    }
  }

  /** Download a remote file to a local path, atomically. */
  async download(name, targetPath, signal) {
    await this.ensureCollection(signal)
    const url = joinUrl(this.collection.toString(), name)
    const temp = `${targetPath}.part-${process.pid}`
    await ensureDir(dirname(targetPath))
    try {
      const result = await this.getToFile(url, temp, signal)
      const st = await stat(temp)
      if (result.contentLength !== undefined && result.contentLength !== st.size) {
        throw new BackupError(ERROR_CODES.WEBDAV_PROTOCOL, `WebDAV download size mismatch for ${name}`, {
          details: { expected: result.contentLength, actual: st.size },
        })
      }
      await rm(targetPath, { force: true })
      await rename(temp, targetPath)
      return { name, path: targetPath, bytes: st.size, bytesLabel: formatBytes(st.size) }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Download a small text file (checksum sidecar). */
  async getText(urlOrName, signal) {
    const url = looksLikeUrl(urlOrName) ? urlOrName : joinUrl(this.collection.toString(), urlOrName)
    const response = await this.request('GET', url, { signal, allowStatus: [200], collectBody: true, maxBody: 1024 * 1024 })
    return response.body.toString('utf8')
  }

  /** Delete a remote archive and its sidecar. */
  async remove(name, signal) {
    const url = joinUrl(this.collection.toString(), name)
    await this.deleteUrl(url, signal)
    await this.deleteUrl(joinUrl(this.collection.toString(), `${name}.sha256`), signal).catch(() => undefined)
  }

  /** HEAD one remote file. */
  async head(urlOrName, signal) {
    const url = looksLikeUrl(urlOrName) ? urlOrName : joinUrl(this.collection.toString(), urlOrName)
    const response = await this.request('HEAD', url, { signal, allowStatus: [200, 204] })
    const length = response.headers['content-length']
    return { status: response.status, size: length === undefined ? undefined : Number(length), headers: response.headers }
  }

  async putFile(url, path, size, signal) {
    const response = await this.request('PUT', url, {
      signal,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(size),
      },
      bodyPath: path,
      allowStatus: [200, 201, 204],
      collectBody: true,
      maxBody: 1024 * 1024,
    })
    if (response.status === 423) throw new BackupError(ERROR_CODES.WEBDAV_LOCKED, `WebDAV file is locked: ${url.pathname}`)
    return response
  }

  async move(sourceUrl, destinationUrl, signal) {
    const response = await this.request('MOVE', sourceUrl, {
      signal,
      headers: {
        Destination: destinationUrl.toString(),
        Overwrite: 'T',
      },
      allowStatus: [200, 201, 204],
      collectBody: true,
      maxBody: 1024 * 1024,
    })
    return response
  }

  async deleteUrl(url, signal) {
    return this.request('DELETE', url, { signal, allowStatus: [200, 202, 204, 404] })
  }

  async getToFile(url, targetPath, signal) {
    const response = await this.request('GET', url, { signal, allowStatus: [200], streamTo: targetPath })
    const length = response.headers['content-length']
    return { contentLength: length === undefined ? undefined : Number(length) }
  }

  /**
   * One HTTP request with bounded retries for transient failures.
   * Bodies are re-opened per attempt, so retries never replay a consumed stream.
   */
  async request(method, url, options = {}) {
    const retries = options.retries ?? this.webdav.retries
    let lastError
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (options.signal?.aborted) throw abortFrom(options.signal)
      try {
        const response = await this.requestOnce(method, url, options)
        if (shouldRetryStatus(response.status) && attempt < retries) {
          await this.backoff(attempt, response.headers['retry-after'])
          continue
        }
        if (options.allowStatus && !options.allowStatus.includes(response.status)) {
          throw statusError(response.status, method, url)
        }
        return response
      } catch (error) {
        lastError = error
        if (error instanceof BackupError && !error.retryable) throw error
        if (!isRetryableError(error) || attempt >= retries) throw error
        await this.backoff(attempt)
      }
    }
    throw lastError ?? new BackupError(ERROR_CODES.WEBDAV_SERVER, `${method} ${url.pathname} failed`)
  }

  async backoff(attempt, retryAfter) {
    const retryMs = parseRetryAfter(retryAfter)
    const delay = retryMs ?? Math.min(30_000, this.webdav.retryBaseMs * (2 ** attempt))
    this.logger?.warn?.(`WebDAV request failed transiently; retrying in ${delay}ms`)
    await sleep(delay)
  }

  requestOnce(method, url, options) {
    return new Promise((resolvePromise, rejectPromise) => {
      const target = url instanceof URL ? url : new URL(url)
      const transport = target.protocol === 'https:' ? https : http
      const headers = this.headers(options.headers)
      if (options.body !== undefined && headers['Content-Length'] === undefined) {
        headers['Content-Length'] = String(Buffer.byteLength(options.body))
      }
      const request = transport.request(target, {
        method,
        headers,
        ...(target.protocol === 'https:' ? { rejectUnauthorized: this.webdav.rejectUnauthorized } : {}),
      }, (response) => {
        const status = response.statusCode ?? 0
        const responseHeaders = response.headers
        if (isRedirect(status) && responseHeaders.location && (method === 'GET' || method === 'HEAD')) {
          const next = new URL(responseHeaders.location, target)
          response.resume()
          if (next.origin !== this.baseOrigin) {
            rejectPromise(new BackupError(ERROR_CODES.WEBDAV_PROTOCOL, `WebDAV redirect crosses origins (${this.baseOrigin} -> ${next.origin}); refusing to forward credentials`))
            return
          }
          this.requestOnce(method, next, options).then(resolvePromise, rejectPromise)
          return
        }
        if (options.streamTo) {
          const out = createWriteStream(options.streamTo)
          pipeline(response, out).then(() => {
            resolvePromise({ status, headers: responseHeaders, body: Buffer.alloc(0) })
          }, rejectPromise)
          return
        }
        const chunks = []
        let total = 0
        const maxBody = options.maxBody ?? 8 * 1024 * 1024
        response.on('data', (chunk) => {
          total += chunk.length
          if (total > maxBody) {
            response.destroy(new BackupError(ERROR_CODES.WEBDAV_PROTOCOL, `WebDAV response body exceeds ${formatBytes(maxBody)}`))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          resolvePromise({ status, headers: responseHeaders, body: Buffer.concat(chunks) })
        })
        response.on('error', rejectPromise)
      })
      request.setTimeout(this.webdav.timeoutMs, () => {
        request.destroy(new BackupError(ERROR_CODES.WEBDAV_SERVER, `WebDAV request timed out after ${this.webdav.timeoutMs}ms`, { retryable: true }))
      })
      request.on('error', (error) => rejectPromise(normalizeWebdavError(error)))
      if (options.signal) {
        const onAbort = () => request.destroy(abortFrom(options.signal))
        options.signal.addEventListener('abort', onAbort, { once: true })
        request.on('close', () => options.signal.removeEventListener('abort', onAbort))
      }
      if (options.bodyPath) {
        const stream = createReadStream(options.bodyPath)
        stream.on('error', (error) => request.destroy(error))
        stream.pipe(request)
      } else if (options.body !== undefined) {
        request.end(options.body)
      } else {
        request.end()
      }
    })
  }
}

function parseMultistatus(xml, baseUrl) {
  const entries = []
  const responseRe = /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi
  let match
  while ((match = responseRe.exec(xml)) !== null) {
    const block = match[1]
    const href = xmlText(block, 'href')
    if (!href) continue
    const resourceType = xmlText(block, 'resourcetype') ?? ''
    const length = xmlText(block, 'getcontentlength')
    const modified = xmlText(block, 'getlastmodified')
    const url = new URL(href, baseUrl)
    let name
    try {
      name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    } catch {
      name = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    }
    entries.push({
      name,
      href,
      collection: /collection/i.test(resourceType),
      size: length === undefined ? undefined : Number(length),
      lastModified: modified,
      url: url.toString(),
    })
  }
  return entries
}

function xmlText(block, localName) {
  const re = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${localName}>`, 'i')
  const match = re.exec(block)
  if (!match) return undefined
  return decodeXml(match[1].trim())
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value)
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function shouldRetryStatus(status) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function isRetryableError(error) {
  if (error instanceof BackupError) return error.retryable
  const code = error && typeof error === 'object' ? error.code : undefined
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
}

function normalizeWebdavError(error) {
  if (error instanceof BackupError) return error
  const code = error && typeof error === 'object' ? error.code : undefined
  if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'].includes(code)) {
    return new BackupError(ERROR_CODES.WEBDAV_TLS, `WebDAV TLS verification failed: ${error.message}`, {
      cause: error,
      hint: 'Use a valid certificate, or set webdav.rejectUnauthorized: false only on a trusted LAN.',
    })
  }
  return new BackupError(ERROR_CODES.WEBDAV_SERVER, `WebDAV network error: ${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
    retryable: isRetryableError(error),
  })
}

function statusError(status, method, url) {
  if (status === 401 || status === 403) {
    return new BackupError(ERROR_CODES.WEBDAV_AUTH, `WebDAV authentication failed (${status}) for ${method} ${url.pathname}`, {
      hint: 'Check webdav.username/password, the passwordEnv variable, and the server ACL.',
    })
  }
  if (status === 404) return new BackupError(ERROR_CODES.WEBDAV_NOT_FOUND, `WebDAV path not found (404) for ${method} ${url.pathname}`)
  if (status === 409) return new BackupError(ERROR_CODES.WEBDAV_CONFLICT, `WebDAV conflict (409) for ${method} ${url.pathname}`)
  if (status === 423) return new BackupError(ERROR_CODES.WEBDAV_LOCKED, `WebDAV resource is locked (423) for ${method} ${url.pathname}`)
  if (status === 429) return new BackupError(ERROR_CODES.WEBDAV_RATE_LIMIT, `WebDAV rate limited (429) for ${method} ${url.pathname}`, { retryable: true })
  return new BackupError(ERROR_CODES.WEBDAV_SERVER, `WebDAV server returned ${status} for ${method} ${url.pathname}`, {
    details: { status },
    retryable: status >= 500,
  })
}

function parseRetryAfter(value) {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function abortFrom(signal) {
  return signal?.reason instanceof Error ? signal.reason : new BackupError(ERROR_CODES.ABORTED, 'operation aborted')
}

export { parseMultistatus, statusError }
