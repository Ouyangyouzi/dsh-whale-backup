import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackupError, ERROR_CODES, errorEnvelope } from './errors.js'
import {
  clearUserOverlay,
  deepMerge,
  readUserOverlaySync,
  redactConfig,
  resolveConfig,
  sanitizeOverlay,
  writeUserOverlay,
} from './config.js'
import { ARCHIVE_NAME_RE, createBackup, listLocalArchives, listRemoteArchives, pruneLocalArchives } from './backup.js'
import { listArchiveContents, resolveArchive, restoreArchive, verifyArchive } from './restore.js'
import { detectSessionLocks, listSessionSummaries, sessionStats } from './sessions.js'
import { collectProfiles } from './plugins.js'
import { WebdavClient } from './webdav.js'
import { isWithin, pathExists, removePath } from './fsutil.js'
import { normalizeSchedule, describeSchedule } from './schedule.js'
import { credentialConfigured, hydrateWebdav } from './secrets.js'

const API_PREFIX = '/dsh-backup-api'
const MAX_BODY = 1024 * 1024

/**
 * Host HTTP surface for the browser panel. It is mounted only in profiles that
 * have a webServer, and every request must be same-origin (the browser sends
 * Origin; local CLI tools without Origin are still limited to the loopback
 * listener dsh binds).
 */
export function createHttpApi({ config, baseConfig, setConfig, scheduler, connection, credentials, flushSessions, logger }) {
  const readConfig = typeof config === 'function' ? config : () => config
  const readBase = typeof baseConfig === 'function' ? baseConfig : () => baseConfig ?? readConfig()
  const jobs = new Map()
  const startJob = (kind, run) => {
    const id = randomUUID()
    const job = {
      id,
      kind,
      status: 'running',
      percent: 1,
      phase: 'start',
      message: '正在准备…',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      cancelRequested: false,
      abort: new AbortController(),
    }
    jobs.set(id, job)
    const onProgress = (value) => {
      if (!value || typeof value !== 'object') return
      if (typeof value.percent === 'number') job.percent = Math.max(0, Math.min(100, value.percent))
      if (typeof value.phase === 'string') job.phase = value.phase
      if (typeof value.message === 'string') job.message = value.message
      job.updatedAt = Date.now()
    }
    Promise.resolve()
      .then(() => run(onProgress, job.abort.signal))
      .then((result) => {
        Object.assign(job, { status: 'done', percent: 100, phase: 'done', message: '完成', result, finishedAt: Date.now(), updatedAt: Date.now() })
      }, (error) => {
        Object.assign(job, {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          error: errorEnvelope(error).error,
          finishedAt: Date.now(),
          updatedAt: Date.now(),
        })
      })
    for (const [key, value] of jobs) {
      if (value.finishedAt && Date.now() - value.finishedAt > 10 * 60_000) jobs.delete(key)
    }
    return job
  }
  const api = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.local')
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    try {
      const rejection = admitRequest(req, connection)
      if (rejection !== undefined) {
        return sendJson(res, rejection, {
          ok: false,
          error: rejection === 401
            ? { code: 'UNAUTHORIZED', message: '请先登录 dsh，再使用备份助手' }
            : { code: 'FORBIDDEN', message: '请求被跨站保护拒绝' },
        })
      }
      const config = await hydrateWebdav(readConfig(), credentials)
      if (req.method === 'GET' && (route === '/status' || route === '/status/')) {
        return sendJson(res, 200, await status(config, url, logger))
      }
      if (req.method === 'GET' && route === '/config') {
        const overlay = readUserOverlaySync(config.dshHome)
        const safeOverlay = overlay && overlay.webdav
          ? {
              ...overlay,
              webdav: {
                ...overlay.webdav,
                password: overlay.webdav.password ? '<set>' : '',
                token: overlay.webdav.token ? '<set>' : '',
              },
            }
          : overlay
        return sendJson(res, 200, {
          ok: true,
          config: redactConfig(config),
          overlay: safeOverlay,
          path: join(config.dshHome, 'dsh-backup.config.json'),
        })
      }
      if (req.method === 'POST' && route === '/config') {
        const body = await readJson(req)
        if (body.reset === true) {
          await clearUserOverlay(config.dshHome)
          const next = resolveConfig(readBase(), { cwd: process.cwd() })
          setConfig?.(next)
          return sendJson(res, 200, { ok: true, reset: true, config: redactConfig(next) })
        }
        const overlay = sanitizeOverlay(body.config ?? body)
        const existing = readUserOverlaySync(config.dshHome)
        const passwordRef = config.webdav.passwordEnv || 'DSH_BACKUP_WEBDAV_PASSWORD'
        const tokenRef = config.webdav.tokenEnv || 'DSH_BACKUP_WEBDAV_TOKEN'
        const store = credentials && typeof credentials.set === 'function' ? credentials : null
        const rawPassword = body.config?.webdav?.password ?? body.webdav?.password
        const rawToken = body.config?.webdav?.token ?? body.webdav?.token
        const rawNotifyPassword = body.config?.notifyEmail?.password ?? body.notifyEmail?.password

        // Secrets never belong in the settings overlay when the credential
        // seam is available: the overlay keeps the reference name only.
        if (overlay.webdav !== undefined) {
          delete overlay.webdav.password
          delete overlay.webdav.token
        }
        if (overlay.notifyEmail !== undefined) delete overlay.notifyEmail.password
        if (store) {
          if (typeof rawPassword === 'string' && rawPassword !== '' && rawPassword !== '<set>') {
            await store.set(passwordRef, rawPassword)
          }
          if (body.clearPassword === true && typeof credentials.unset === 'function') {
            await credentials.unset(passwordRef)
          }
          if (typeof rawToken === 'string' && rawToken !== '' && rawToken !== '<set>') {
            await store.set(tokenRef, rawToken)
          }
          if (body.clearToken === true && typeof credentials.unset === 'function') {
            await credentials.unset(tokenRef)
          }
          if (typeof rawNotifyPassword === 'string' && rawNotifyPassword !== '' && rawNotifyPassword !== '<set>') {
            await store.set(config.notifyEmail.passwordEnv || 'DSH_BACKUP_NOTIFY_PASSWORD', rawNotifyPassword)
          }
          if (body.clearNotifyPassword === true && typeof credentials.unset === 'function') {
            await credentials.unset(config.notifyEmail.passwordEnv || 'DSH_BACKUP_NOTIFY_PASSWORD')
          }
        } else if (overlay.webdav !== undefined) {
          if (body.clearPassword === true) {
            delete overlay.webdav.password
          } else if (typeof rawPassword === 'string' && rawPassword !== '' && rawPassword !== '<set>') {
            overlay.webdav.password = rawPassword
          } else if (existing.webdav?.password) {
            overlay.webdav.password = existing.webdav.password
          }
          if (body.clearToken === true) {
            delete overlay.webdav.token
          } else if (typeof rawToken === 'string' && rawToken !== '' && rawToken !== '<set>') {
            overlay.webdav.token = rawToken
          } else if (existing.webdav?.token) {
            overlay.webdav.token = existing.webdav.token
          }
        }
        if (!store && overlay.notifyEmail !== undefined) {
          if (body.clearNotifyPassword === true) delete overlay.notifyEmail.password
          else if (typeof rawNotifyPassword === 'string' && rawNotifyPassword !== '' && rawNotifyPassword !== '<set>') overlay.notifyEmail.password = rawNotifyPassword
          else if (existing.notifyEmail?.password) overlay.notifyEmail.password = existing.notifyEmail.password
        }
        if (overlay.webdav !== undefined && Object.keys(overlay.webdav).length === 0) delete overlay.webdav
        await writeUserOverlay(config.dshHome, overlay)
        const next = resolveConfig(deepMerge(readBase() ?? {}, overlay), { cwd: process.cwd() })
        setConfig?.(next)
        return sendJson(res, 200, { ok: true, config: redactConfig(next) })
      }
      if (req.method === 'GET' && route === '/schedule') {
        return sendJson(res, 200, { ok: true, ...scheduleView(config, scheduler) })
      }
      if (req.method === 'POST' && route === '/schedule') {
        const body = await readJson(req)
        const schedule = normalizeSchedule(body.schedule ?? body)
        const existing = readUserOverlaySync(config.dshHome)
        await writeUserOverlay(config.dshHome, { ...existing, schedule })
        const next = resolveConfig(deepMerge(readBase() ?? {}, { ...existing, schedule }), { cwd: process.cwd() })
        setConfig?.(next)
        const view = scheduler ? await scheduler.sync() : scheduleView(next)
        return sendJson(res, 200, { ok: true, ...view })
      }
      if (req.method === 'GET' && route === '/icon') {
        return await sendIcon(res)
      }
      if (req.method === 'GET' && route === '/job') {
        const id = url.searchParams.get('id') ?? ''
        const job = jobs.get(id)
        if (!job) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'job not found' } })
        return sendJson(res, 200, { ok: true, job })
      }
      if (req.method === 'POST' && route === '/job/cancel') {
        const body = await readJson(req)
        const id = String(body.id ?? '')
        const job = jobs.get(id)
        if (!job) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'job not found' } })
        if (job.status !== 'running') return sendJson(res, 200, { ok: true, job })
        job.cancelRequested = true
        const controller = job.abort
        if (controller && typeof controller.abort === 'function') controller.abort(new BackupError(ERROR_CODES.ABORTED, '已手动停止'))
        job.message = '正在停止…'
        job.updatedAt = Date.now()
        return sendJson(res, 200, { ok: true, job })
      }
      if (req.method === 'POST' && route === '/notify/test') {
        const body = await readJson(req)
        const merged = resolveConfig(deepMerge(config, { notifyEmail: body.notifyEmail ?? {} }), { cwd: process.cwd() })
        const { sendNotificationMailWithRetry, buildBackupNotice } = await import('./mail.js')
        await sendNotificationMailWithRetry({
          smtp: merged.notifyEmail,
          subject: '鲸鱼娘备份：测试通知',
          text: buildBackupNotice({ kind: 'backup', archiveName: '（测试邮件）', sizeLabel: '—' }),
        }, logger)
        return sendJson(res, 200, { ok: true, result: { message: `测试邮件已发送到 ${merged.notifyEmail.to}` } })
      }
      if (req.method === 'POST' && route === '/archive/contents') {
        const body = await readJson(req)
        const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const effective = scopedConfig(config, { cwd, localDir: body.localDir, remoteDir: body.remoteDir ?? body.webdavRemoteDir })
        const resolved = await resolveArchive(effective, { archive: body.archive ?? 'latest', source: body.source ?? 'auto', logger })
        try {
          const contents = await listArchiveContents(effective, resolved.path)
          return sendJson(res, 200, { ok: true, result: { ...contents, source: resolved.source, name: resolved.name } })
        } finally {
          await resolved.cleanup?.().catch(() => undefined)
        }
      }
      if (req.method === 'POST' && route === '/webdav/test') {
        const body = await readJson(req)
        const patch = body.webdav !== null && typeof body.webdav === 'object' && !Array.isArray(body.webdav) ? body.webdav : {}
        const testConfig = resolveConfig(deepMerge(config, { webdav: patch }), { cwd: process.cwd() })
        if (testConfig.webdav.url === '') {
          throw new BackupError(ERROR_CODES.INVALID_CONFIG, '请先填写 WebDAV 地址')
        }
        const startedAt = Date.now()
        const client = new WebdavClient(testConfig, logger)
        const entries = await client.list()
        return sendJson(res, 200, {
          ok: true,
          result: {
            ok: true,
            message: '连接成功',
            url: testConfig.webdav.url,
            remoteDir: testConfig.webdav.remoteDir,
            entries: entries.length,
            durationMs: Date.now() - startedAt,
          },
        })
      }
      if (req.method === 'GET' && route === '/sessions') {
        const scoped = scopedConfig(config, { cwd: url.searchParams.get('cwd') || process.cwd() })
        return sendJson(res, 200, { ok: true, sessions: await listSessionSummaries(scoped, scoped.dshHome) })
      }
      if (req.method === 'GET' && route === '/archives') {
        return sendJson(res, 200, await archives(config, url, logger))
      }
      if (req.method === 'GET' && route === '/browse') {
        return sendJson(res, 200, await browseDirectory(url))
      }
      if (req.method === 'POST' && route === '/browse/mkdir') {
        const body = await readJson(req)
        return sendJson(res, 200, await createDirectory(body))
      }
      if (req.method === 'GET' && route === '/download') {
        return await download(config, url, res)
      }
      if (req.method === 'POST' && route === '/backup') {
        const body = await readJson(req)
        if (body.async === true) {
          const job = startJob('backup', (onProgress, signal) => backup(config, body, flushSessions, logger, onProgress, signal))
          return sendJson(res, 202, { ok: true, job })
        }
        return sendJson(res, 200, await backup(config, body, flushSessions, logger))
      }
      if (req.method === 'POST' && route === '/restore') {
        const body = await readJson(req)
        if (body.async === true) {
          const job = startJob('restore', (onProgress, signal) => restore(config, body, logger, onProgress, signal))
          return sendJson(res, 202, { ok: true, job })
        }
        return sendJson(res, 200, await restore(config, body, logger))
      }
      if (req.method === 'POST' && route === '/verify') {
        const body = await readJson(req)
        return sendJson(res, 200, await verify(config, body, logger))
      }
      if (req.method === 'POST' && route === '/prune') {
        const body = await readJson(req)
        return sendJson(res, 200, await prune(config, body, logger))
      }
      if (req.method === 'POST' && route === '/delete') {
        const body = await readJson(req)
        return sendJson(res, 200, await deleteArchive(config, body, logger))
      }
      return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `unknown endpoint ${route}` } })
    } catch (error) {
      const envelope = errorEnvelope(error)
      const status = error instanceof BackupError ? httpStatus(error.code) : 500
      logger?.warn?.(`[dsh-backup] web API ${req.method} ${route} failed: ${error instanceof Error ? error.message : String(error)}`)
      return sendJson(res, status, envelope)
    }
  }
  return { path: API_PREFIX, handler: api }
}

async function status(config, url, logger) {
  const cwd = url.searchParams.get('cwd') || process.cwd()
  const effective = scopedConfig(config, {
    cwd,
    localDir: url.searchParams.get('localDir'),
    remoteDir: url.searchParams.get('remoteDir'),
    workspace: 'all',
  })
  const stats = await sessionStats(effective, cwd)
  const local = await listLocalArchives(effective)
  const locks = await detectSessionLocks(effective, cwd)
  const profiles = await collectProfiles(effective)
  return {
    ok: true,
    status: {
      dshHome: effective.dshHome,
      sessionsRoot: effective.sessionsRoot,
      localDir: effective.localDir,
      profiles: profiles.map((profile) => profile.name),
      profilesConfigured: effective.profiles,
      compression: effective.compression,
      compressionLevel: effective.compressionLevel,
      webdavConfigured: effective.webdav.url !== '',
      webdav: effective.webdav.url === '' ? undefined : {
        url: effective.webdav.url,
        remoteDir: effective.webdav.remoteDir,
      },
      credentialsIncludedByDefault: effective.includeCredentials,
      sessions: stats.sessions,
      sessionFiles: stats.files,
      sessionBytes: stats.bytes,
      sessionBytesLabel: stats.bytesLabel,
      archives: local.length,
      newestArchive: local[0] ? { name: local[0].name, size: local[0].size, sizeLabel: local[0].sizeLabel, createdAt: local[0].createdAt } : undefined,
      locks: locks.locks.length,
      lockDetectable: locks.detectable,
    },
  }
}

async function archives(config, url, logger) {
  const source = url.searchParams.get('source') || 'both'
  const effective = scopedConfig(config, {
    localDir: url.searchParams.get('localDir'),
    remoteDir: url.searchParams.get('remoteDir'),
    cwd: url.searchParams.get('cwd') || process.cwd(),
  })
  const result = { ok: true, local: [], webdav: [], webdavError: undefined, localDir: effective.localDir, remoteDir: effective.webdav.remoteDir }
  if (source === 'local' || source === 'both') {
    result.local = await listLocalArchives(effective)
  }
  if ((source === 'webdav' || source === 'both') && effective.webdav.url) {
    try {
      result.webdav = await listRemoteArchives(effective, logger)
    } catch (error) {
      result.webdavError = errorEnvelope(error).error
    }
  }
  return result
}

async function backup(config, body, flushSessions, logger, onProgress, signal) {
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
  const effective = scopedConfig(config, {
    cwd,
    localDir: body.localDir,
    remoteDir: body.remoteDir ?? body.webdavRemoteDir,
    workspace: body.workspace === undefined ? 'all' : body.workspace,
    extra: {
      ...(body.compression === undefined ? {} : { compression: body.compression }),
      ...(body.level === undefined ? {} : { compressionLevel: body.level }),
      ...(body.notifyEmail === undefined ? {} : { notifyEmail: body.notifyEmail }),
      ...(body.includeSessions === undefined ? {} : { includeSessions: body.includeSessions }),
      ...(body.includePlugins === undefined ? {} : { includePlugins: body.includePlugins }),
      ...(body.includeConfig === undefined ? {} : { includeConfig: body.includeConfig }),
      ...(body.includeCredentials === undefined ? {} : { includeCredentials: body.includeCredentials }),
      ...(body.includePluginCode === undefined ? {} : { includePluginCode: body.includePluginCode }),
      ...(body.includePluginData === undefined ? {} : { includePluginData: body.includePluginData }),
      ...(body.includeWorkspaceFiles === undefined ? {} : { includeWorkspaceFiles: body.includeWorkspaceFiles }),
      ...(body.includeStorages === undefined ? {} : { includeStorages: body.includeStorages }),
    },
  })
  const result = await createBackup({
    config: effective,
    cwd,
    destination: body.destination ?? 'local',
    label: typeof body.label === 'string' ? body.label : '',
    overwrite: body.overwrite === true,
    prune: body.prune !== false,
    onProgress,
    signal,
    sessionIds: Array.isArray(body.sessionIds) ? body.sessionIds : undefined,
    recentSessions: body.recentSessions === undefined ? undefined : Number(body.recentSessions),
    logger,
    flushSessions,
  })
  if (effective.notifyEmail) {
    const { sendNotificationMailWithRetry, buildBackupNotice } = await import('./mail.js')
    sendNotificationMailWithRetry({ smtp: effective.notifyEmail, subject: '鲸鱼娘备份：手动备份完成', text: buildBackupNotice({ ...result, kind: 'backup' }) }, logger)
      .catch((error) => logger?.warn?.(`[dsh-whale-backup] notification not sent: ${error instanceof Error ? error.message : String(error)}`))
  }
  return { ok: true, result }
}

async function restore(config, body, logger, onProgress, signal) {
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
  const effective = scopedConfig(config, { cwd, localDir: body.localDir, remoteDir: body.remoteDir ?? body.webdavRemoteDir })
  const toggles = [body.restoreSessions, body.restorePlugins, body.restoreConfig, body.restorePluginData, body.restoreStorages]
  let categories
  if (toggles.some((value) => value === false)) {
    categories = []
    if (body.restoreSessions !== false) categories.push('sessions')
    if (body.restorePlugins !== false) categories.push('plugins')
    if (body.restoreConfig !== false) categories.push('config')
    if (body.restorePluginData !== false) {
      categories.push('pluginData')
      if (body.restoreStorages !== false) categories.push('storages')
    }
  }
  const result = await restoreArchive({
    config: effective,
    cwd,
    archive: body.archive ?? 'latest',
    source: body.source ?? 'auto',
    conflict: body.conflict,
    dryRun: body.dryRun === true,
    yes: body.yes === true,
    safetyBackup: body.safetyBackup,
    allowRunning: body.allowRunning === true,
    harnessRunning: true,
    categories,
    createMissingWorkspaceDirs: body.createMissingWorkspaceDirs,
    restoreWorkspaceFiles: body.restoreWorkspaceFiles,
    restoreSessionIds: Array.isArray(body.restoreSessionIds) ? body.restoreSessionIds : undefined,
    restoreWorkspaceIds: Array.isArray(body.restoreWorkspaceIds) ? body.restoreWorkspaceIds : undefined,
    onProgress,
    signal,
    logger,
  })
  if (result.actions) {
    delete result.actions
  }
  if (effective.notifyEmail?.to) {
    const { sendNotificationMailWithRetry, buildBackupNotice } = await import('./mail.js')
    sendNotificationMailWithRetry({
      smtp: effective.notifyEmail,
      subject: '鲸鱼娘备份：恢复完成',
      text: buildBackupNotice({ ...result, kind: 'restore' }),
    }, logger).catch((error) => logger?.warn?.(`[dsh-whale-backup] notification not sent: ${error instanceof Error ? error.message : String(error)}`))
  }
  return { ok: true, result }
}

async function verify(config, body, logger) {
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
  const effective = scopedConfig(config, { cwd, localDir: body.localDir, remoteDir: body.remoteDir ?? body.webdavRemoteDir })
  const resolved = await resolveArchive(effective, { archive: body.archive ?? 'latest', source: body.source ?? 'auto', logger })
  try {
    const result = await verifyArchive(effective, resolved.path, {
      requireChecksum: resolved.source === 'webdav' ? effective.webdav.requireChecksum : effective.requireChecksum,
    })
    return { ok: true, result: { ...result, source: resolved.source } }
  } finally {
    await resolved.cleanup()
  }
}

async function prune(config, body, logger) {
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
  const effective = scopedConfig(config, { cwd, localDir: body.localDir, remoteDir: body.remoteDir ?? body.webdavRemoteDir })
  const source = body.source ?? 'local'
  if ((source === 'webdav' || source === 'both') && !effective.webdav.url) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV is not configured')
  }
  const keep = Math.max(0, Number(body.keep ?? effective.keepLocal) || 0)
  const yes = body.yes === true
  const result = { local: [], webdav: [] }
  if (source === 'local' || source === 'both') {
    const list = await listLocalArchives(effective)
    const remove = list.slice(keep)
    if (yes) result.local = await pruneLocalArchives(effective, keep, [], logger)
    else result.local = remove.map((item) => item.name)
  }
  if (source === 'webdav' || source === 'both') {
    const list = await listRemoteArchives(effective, logger)
    const remove = list.slice(keep)
    if (yes) {
      const client = new WebdavClient(effective, logger)
      for (const item of remove) {
        await client.remove(item.name)
        result.webdav.push(item.name)
      }
    } else {
      result.webdav = remove.map((item) => item.name)
    }
  }
  return { ok: true, dryRun: !yes, result }
}

async function download(config, url, res) {
  const effective = scopedConfig(config, { cwd: url.searchParams.get('cwd') || process.cwd(), localDir: url.searchParams.get('localDir') })
  const name = basename(url.searchParams.get('name') ?? '')
  if (name === '' || name !== url.searchParams.get('name') || !ARCHIVE_NAME_RE.test(name)) {
    return sendJson(res, 400, { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'invalid archive name' } })
  }
  const path = join(effective.localDir, name)
  if (!isWithin(path, effective.localDir) || !(await pathExists(path))) {
    return sendJson(res, 404, { ok: false, error: { code: 'ARCHIVE_NOT_FOUND', message: `archive not found: ${name}` } })
  }
  const info = await stat(path)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(info.size),
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_')}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  createReadStream(path).pipe(res)
}

async function deleteArchive(config, body, logger) {
  const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
  const source = body.source === 'webdav' ? 'webdav' : 'local'
  const effective = scopedConfig(config, { cwd, localDir: body.localDir, remoteDir: body.remoteDir ?? body.webdavRemoteDir })
  const name = basename(String(body.name ?? ''))
  if (name === '' || name !== String(body.name ?? '') || !ARCHIVE_NAME_RE.test(name)) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, 'invalid archive name')
  }
  if (source === 'webdav') {
    if (!effective.webdav.url) throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV is not configured')
    const client = new WebdavClient(effective, logger)
    await client.remove(name)
    return { ok: true, deleted: { source, name } }
  }
  const path = join(effective.localDir, name)
  if (!isWithin(path, effective.localDir)) throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, 'archive path escapes localDir')
  if (!(await pathExists(path))) throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `archive not found: ${name}`)
  await removePath(path)
  await removePath(`${path}.sha256`).catch(() => undefined)
  return { ok: true, deleted: { source, name } }
}

async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, 'request body is too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, 'request body is not valid JSON', { cause: error })
  }
}

let iconCache
async function sendIcon(res) {
  if (iconCache === undefined) {
    iconCache = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../assets/whale-girl.png'))
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(iconCache.length),
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(iconCache)
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value, null, 2), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function admitRequest(req, connection) {
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection === 401 || rejection === 403) return rejection
      if (rejection === undefined) return undefined
    } catch {
      // Fall back to the conservative same-origin check.
    }
  }
  return sameOrigin(req) ? undefined : 403
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function httpStatus(code) {
  if (code === ERROR_CODES.ARCHIVE_NOT_FOUND) return 404
  if (code === ERROR_CODES.WEBDAV_AUTH) return 401
  if (code === ERROR_CODES.RESTORE_CONFLICT || code === ERROR_CODES.ALREADY_RUNNING) return 409
  if (code === ERROR_CODES.PERMISSION) return 403
  return 400
}

function scheduleView(config, scheduler) {
  if (scheduler && typeof scheduler.view === 'function') return scheduler.view()
  const schedule = normalizeSchedule(config.schedule)
  return {
    schedule,
    description: describeSchedule(schedule),
    nextRunAt: undefined,
    lastRunAt: undefined,
  }
}

function scopedConfig(config, options = {}) {
  const overrides = { ...(options.extra ?? {}) }
  if (typeof options.workspace === 'string' || Array.isArray(options.workspace)) overrides.workspace = options.workspace
  if (typeof options.localDir === 'string' && options.localDir.trim() !== '') overrides.localDir = options.localDir.trim()
  if (typeof options.remoteDir === 'string' && options.remoteDir.trim() !== '') {
    overrides.webdav = { ...(overrides.webdav ?? {}), remoteDir: options.remoteDir.trim() }
  }
  return resolveConfig(deepMerge(config, overrides), { cwd: options.cwd ?? process.cwd() })
}

async function browseDirectory(url) {
  const requested = resolve(url.searchParams.get('path')?.trim() || homedir())
  let current = requested
  let info = await stat(current).catch(() => null)
  let notice
  while (info === null) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
    info = await stat(current).catch(() => null)
  }
  if (info === null || !info.isDirectory()) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `无法打开目录：${requested}`)
  }
  if (current !== requested) {
    notice = `目录 ${requested} 尚不存在，已定位到最近的上级目录 ${current}。可在此新建文件夹。`
  }
  const entries = await readdir(current, { withFileTypes: true })
  const dirs = []
  for (const entry of entries) {
    let isDirectory = entry.isDirectory()
    if (!isDirectory && entry.isSymbolicLink()) {
      const target = await stat(join(current, entry.name)).catch(() => null)
      isDirectory = target !== null && target.isDirectory()
    }
    if (!isDirectory) continue
    dirs.push({ name: entry.name, path: join(current, entry.name), hidden: entry.name.startsWith('.') })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  const parent = dirname(current)
  return {
    ok: true,
    current,
    requested,
    notice,
    parent: parent === current ? null : parent,
    separator: sep,
    roots: await filesystemRoots(),
    entries: dirs,
  }
}

async function createDirectory(body) {
  const parent = resolve(typeof body.parent === 'string' && body.parent.trim() !== '' ? body.parent : homedir())
  const name = String(body.name ?? '').trim()
  if (name === '' || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, '文件夹名称不能包含路径分隔符或非法字符')
  }
  const target = join(parent, name)
  try {
    await mkdir(target, { recursive: false })
  } catch (error) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `无法创建文件夹：${target}`, { cause: error })
  }
  return { ok: true, path: target }
}

async function filesystemRoots() {
  if (filesystemRoots.cache !== undefined) return filesystemRoots.cache
  if (process.platform !== 'win32') {
    filesystemRoots.cache = [{ name: '/', path: '/' }]
    return filesystemRoots.cache
  }
  const roots = []
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code)
    const path = `${letter}:\\`
    const info = await stat(path).catch(() => null)
    if (info && info.isDirectory()) roots.push({ name: path, path })
  }
  filesystemRoots.cache = roots
  return roots
}
filesystemRoots.cache = undefined

export { API_PREFIX }
