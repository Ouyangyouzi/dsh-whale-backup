import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, readdir, rm, stat, utimes } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { BackupError, ERROR_CODES, fromNodeError } from './errors.js'
import { CONFLICT_POLICIES } from './config.js'
import {
  atomicWriteFile,
  copyFileEnsured,
  ensureDir,
  formatBytes,
  isWithin,
  lstatOrNull,
  makeTempDir,
  movePath,
  pathExists,
  removePath,
  statOrNull,
  timestampForName,
  toPosix,
  writeJsonFile,
} from './fsutil.js'
import {
  assertArchivePath,
  MANIFEST_NAME,
  parseManifest,
  restoreTargetPath,
  verifyArchiveChecksum,
  verifyManifestEntries,
} from './manifest.js'
import {
  codecLabel,
  openArchiveStream,
  readEntryJson,
  TarReader,
  TAR_TYPES,
} from './tar.js'
import { detectSessionLocks, isSessionArtifact, validateSessionLog } from './sessions.js'
import { rewriteLocalLinkSpecs, ensureLocalLinkModules } from './plugins.js'
import { createBackup, listLocalArchives, listRemoteArchives } from './backup.js'
import { WebdavClient } from './webdav.js'
import { withOperationLock } from './lock.js'

/**
 * Resolve a local path or download a WebDAV archive.
 * @param {ReturnType<import('./config.js').resolveConfig>} config
 * @param {{ archive?: string, source?: 'auto'|'local'|'webdav', logger?: any, signal?: AbortSignal }} options
 */
export async function resolveArchive(config, options = {}) {
  const source = options.source ?? 'auto'
  const wanted = options.archive ?? 'latest'
  if (!['auto', 'local', 'webdav'].includes(source)) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `source must be auto, local or webdav, got ${JSON.stringify(source)}`)
  }
  if (looksLikeLocalPath(wanted)) {
    const path = resolve(wanted)
    if (!(await pathExists(path))) throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `local archive not found: ${path}`)
    return { path, source: 'local', name: basename(path), cleanup: async () => undefined }
  }

  if (source === 'local' || source === 'auto') {
    const local = await findLocal(config, wanted)
    if (local) return { path: local.path, source: 'local', name: local.name, cleanup: async () => undefined }
    if (source === 'local') throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `local archive not found: ${wanted} (looked in ${config.localDir})`)
  }

  if (source === 'webdav' || source === 'auto') {
    if (!config.webdav.url) {
      if (source === 'webdav') throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'webdav.url is not configured')
      throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `local archive not found: ${wanted}`, {
        hint: 'Configure WebDAV or pass a full local path.',
      })
    }
    const client = new WebdavClient(config, options.logger)
    let remoteName = wanted
    if (wanted === 'latest') {
      const list = await listRemoteArchives(config, options.logger, options.signal)
      if (list.length === 0) throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `no archives found in WebDAV ${config.webdav.remoteDir}`)
      const regular = list.filter((archive) => !archive.name.includes('-pre-restore'))
      remoteName = (regular[0] ?? list[0]).name
    }
    const downloadDir = await makeTempDir(config.tempDir, 'download')
    const target = join(downloadDir, remoteName)
    try {
      options.logger?.info?.(`[dsh-backup] downloading ${remoteName} from WebDAV`)
      await client.download(remoteName, target, options.signal)
      try {
        const sidecar = await client.getText(`${remoteName}.sha256`, options.signal)
        await atomicWriteFile(`${target}.sha256`, sidecar, 0o600)
      } catch (error) {
        if (!(error instanceof BackupError) || error.code !== ERROR_CODES.WEBDAV_NOT_FOUND) {
          options.logger?.warn?.(`[dsh-backup] checksum sidecar unavailable: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return {
        path: target,
        source: 'webdav',
        name: remoteName,
        cleanup: async () => removePath(downloadDir),
      }
    } catch (error) {
      await removePath(downloadDir).catch(() => undefined)
      throw error
    }
  }
  throw new BackupError(ERROR_CODES.ARCHIVE_NOT_FOUND, `archive not found: ${wanted}`)
}

/** Inspect an archive without modifying DSH_HOME. */
export async function inspectArchive(config, archivePath, options = {}) {
  const checksum = await verifyArchiveChecksum(archivePath, { require: options.requireChecksum ?? config.requireChecksum })
  const staging = await makeTempDir(config.tempDir, 'inspect')
  try {
    const extracted = await extractArchive(config, archivePath, staging, options)
    const actual = extracted.entries
    const manifest = parseManifest(extracted.manifest)
    const verification = verifyManifestEntries(manifest, actual)
    if (!verification.ok) {
      throw new BackupError(ERROR_CODES.MANIFEST_MISMATCH, 'archive contents do not match its manifest', {
        details: {
          missing: verification.missing.slice(0, 20),
          extra: verification.extra.slice(0, 20),
          mismatched: verification.mismatched.slice(0, 20),
          duplicates: verification.duplicates.slice(0, 20),
        },
        hint: 'The archive is incomplete or was modified. Re-download it, or use another backup.',
      })
    }
    const sessionCwds = new Set()
    const includesCredentials = manifest.includesCredentials === true
      || manifest.entries.some((entry) => entry.path === 'home/.credentials.yaml' || entry.path === 'home/.env')
    if (config.restore.verifySessions) {
      const failures = []
      for (const entry of manifest.entries) {
        if (entry.type !== 'file' || !entry.path.startsWith('sessions/') || !isSessionArtifact(basename(entry.path))) continue
        try {
          const checked = await validateSessionLog(join(staging, entry.path))
          if (typeof checked.header.cwd === 'string' && checked.header.cwd !== '') sessionCwds.add(checked.header.cwd)
        } catch (error) {
          failures.push({ path: entry.path, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (failures.length > 0) {
        throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive contains ${failures.length} unreadable session log(s)`, {
          details: { failures: failures.slice(0, 20) },
          hint: 'Use an older backup or repair the session log before restoring.',
        })
      }
    }
    return {
      archivePath,
      staging,
      manifest,
      entries: actual,
      codec: extracted.codec,
      checksum,
      sessionCwds: [...sessionCwds],
      summary: {
        name: basename(archivePath),
        size: (await stat(archivePath)).size,
        sizeLabel: formatBytes((await stat(archivePath)).size),
        checksumVerified: checksum.verified,
        sha256: checksum.digest,
        codec: codecLabel(extracted.codec),
        createdAt: manifest.createdAt,
        label: manifest.label,
        host: manifest.host,
        source: manifest.source,
        workspace: manifest.workspace,
        includesCredentials,
        includesEnv: manifest.includesEnv === true || manifest.entries.some((entry) => entry.path === 'home/.env'),
        summary: manifest.summary,
        inventory: manifest.inventory,
        warnings: manifest.warnings,
      },
      cleanup: async () => removePath(staging),
    }
  } catch (error) {
    await removePath(staging).catch(() => undefined)
    if (error instanceof BackupError) throw error
    throw fromNodeError(error, 'archive inspection')
  }
}

/** Verify an archive and return its summary. */
export async function verifyArchive(config, archivePath, options = {}) {
  const inspection = await inspectArchive(config, archivePath, options)
  try {
    return { ok: true, ...inspection.summary }
  } finally {
    await inspection.cleanup()
  }
}

/**
 * Restore an archive.
 * @param {{
 *   config: ReturnType<import('./config.js').resolveConfig>,
 *   cwd?: string,
 *   archive?: string,
 *   source?: 'auto'|'local'|'webdav',
 *   conflict?: 'overwrite'|'skip'|'prefer-newer'|'fail',
 *   dryRun?: boolean,
 *   yes?: boolean,
 *   safetyBackup?: boolean,
 *   allowRunning?: boolean,
 *   harnessRunning?: boolean,
 *   createMissingWorkspaceDirs?: boolean,
 *   restoreWorkspaceFiles?: boolean,
 *   verifyOnly?: boolean,
 *   signal?: AbortSignal,
 *   logger?: any,
 * }} options
 */
/** List the sessions and workspace folders inside an archive for the restore picker. */
export async function listArchiveContents(config, archivePath) {
  const inspection = await inspectArchive(config, archivePath, {})
  try {
    const seen = new Set()
    const sessions = []
    for (const entry of inspection.manifest.entries) {
      if (!entry.path.startsWith('sessions/')) continue
      const parts = entry.path.split('/')
      if (parts.length < 3) continue
      const key = `${parts[1]}/${parts[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      sessions.push({ id: parts[2], project: parts[1] })
    }
    const workspaces = (inspection.manifest.workspaceFiles ?? []).map((item) => ({ id: item.id, path: item.path, files: item.files }))
    return { sessions, workspaces, summary: inspection.summary }
  } finally {
    await inspection.cleanup?.().catch(() => undefined)
  }
}

export async function restoreArchive(options) {
  const { config, logger } = options
  const report = (phase, percent, message, extra = {}) => {
    if (typeof options.onProgress !== 'function') return
    try {
      options.onProgress({ phase, percent: Math.max(0, Math.min(100, percent)), message, ...extra })
    } catch {
      // Ignore broken progress listeners.
    }
  }
  report('inspect', 2, '正在检查备份…')
  const conflict = options.conflict ?? config.restore.conflict
  if (!CONFLICT_POLICIES.includes(conflict)) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `conflict must be one of ${CONFLICT_POLICIES.join(', ')}`)
  }
  const resolved = await resolveArchive(config, { archive: options.archive, source: options.source, logger, signal: options.signal })
  let inspection
  try {
    inspection = await inspectArchive(config, resolved.path, {
      signal: options.signal,
      requireChecksum: resolved.source === 'webdav' ? config.webdav.requireChecksum : config.requireChecksum,
      onProgress: options.onProgress,
    })
    if (options.verifyOnly) return { ok: true, verified: true, ...inspection.summary, source: resolved.source }
    report('inspect', 10, '正在生成恢复计划…')
    const categories = normalizeRestoreCategories(options.categories)
    const plan = await buildRestorePlan(config, inspection, conflict, {
      workspaceFiles: options.restoreWorkspaceFiles ?? config.restore.workspaceFiles,
    })
    if (categories) plan.actions = plan.actions.filter((action) => action.category === 'meta' || categories.includes(action.category))
    const sessionFilter = new Set((options.restoreSessionIds ?? []).map(String).filter(Boolean))
    if (sessionFilter.size > 0) {
      plan.actions = plan.actions.filter((action) => {
        if (action.category !== 'sessions') return true
        const parts = action.entry.path.split('/')
        return parts.length >= 3 && sessionFilter.has(parts[2])
      })
    }
    const workspaceFilter = new Set((options.restoreWorkspaceIds ?? []).map(String).filter(Boolean))
    if (workspaceFilter.size > 0) {
      plan.actions = plan.actions.filter((action) => {
        if (action.category !== 'workspace') return true
        const parts = action.entry.path.split('/')
        return parts.length >= 2 && workspaceFilter.has(parts[1])
      })
    }
    const conflictCount = plan.actions.filter((action) => action.action === 'replace').length
    const skipped = plan.actions.filter((action) => action.action === 'skip')
    const creates = plan.actions.filter((action) => action.action === 'create').length
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        needsConfirmation: false,
        archive: inspection.summary,
        source: resolved.source,
        plan: {
          create: creates,
          replace: conflictCount,
          skip: skipped.length,
          conflicts: plan.conflicts.slice(0, 100),
        },
        actions: plan.actions,
        warnings: inspection.manifest.warnings,
      }
    }
    if (config.restore.requireConfirmation && options.yes !== true) {
      return {
        ok: true,
        needsConfirmation: true,
        archive: inspection.summary,
        source: resolved.source,
        plan: {
          create: creates,
          replace: conflictCount,
          skip: skipped.length,
          conflicts: plan.conflicts.slice(0, 100),
        },
        message: 'This restore will modify DSH_HOME. Re-run with --yes (or confirm: true) to apply it.',
      }
    }

    if (plan.actions.some((action) => action.category === 'sessions') && options.allowRunning !== true && !config.restore.allowRunningHarness) {
      if (options.harnessRunning === true) {
        throw new BackupError(ERROR_CODES.RESTORE_TARGET_LOCKED, 'cannot restore session logs while dsh is running', {
          hint: 'Stop dsh, then restore from the CLI, or explicitly allow a running restore with --allow-running after making a safety backup.',
        })
      }
      const lockInfo = await detectSessionLocks(config, options.cwd ?? process.cwd())
      if (lockInfo.locks.length > 0) {
        throw new BackupError(ERROR_CODES.RESTORE_TARGET_LOCKED, `found ${lockInfo.locks.length} live session lock(s)`, {
          details: { locks: lockInfo.locks.slice(0, 20).map((lock) => lock.path) },
          hint: lockInfo.hint,
        })
      }
      if (!lockInfo.detectable) {
        inspection.manifest.warnings.push(lockInfo.hint)
      }
    }

    return await withOperationLock(config, 'restore', async () => {
      let safetyBackup
      if (config.restore.safetyBackup && options.safetyBackup !== false) {
        report('safety', 12, '正在做恢复前备份…')
        try {
          logger?.info?.('[dsh-backup] creating a pre-restore safety backup')
          const safety = await createBackup({
            config,
            cwd: options.cwd,
            destination: 'local',
            label: 'pre-restore',
            prune: false,
            overwrite: false,
            skipLock: true,
            logger,
            signal: options.signal,
          })
          safetyBackup = safety.local
          logger?.info?.(`[dsh-backup] safety backup: ${safetyBackup.path}`)
        } catch (error) {
          logger?.warn?.(`[dsh-backup] pre-restore safety backup failed: ${error instanceof Error ? error.message : String(error)}`)
          inspection.manifest.warnings.push(`pre-restore safety backup failed: ${error instanceof Error ? error.message : String(error)}`)
          if (error instanceof BackupError && error.code === ERROR_CODES.ALREADY_RUNNING) throw error
        }
      }

      const apply = await applyPlan(config, inspection, plan, logger, options.signal, options.onProgress)
      report('finalize', 94, '正在修复插件链接…')
      const workspaceDirs = await ensureWorkspaceDirs(
        inspection.sessionCwds || [],
        options.createMissingWorkspaceDirs ?? config.restore.createMissingWorkspaceDirs,
      )
      const credentialWarning = inspection.summary.includesCredentials
        ? undefined
        : '归档未包含凭据（.credentials.yaml/.env）。插件已恢复，但模型 provider 或需要 API Key 的插件可能需要重新填写凭据。'
      const linkRewrites = await rewriteLocalLinkSpecs(config, inspection.manifest.localLinkPlugins ?? [], logger)
      const linkModules = await ensureLocalLinkModules(config, inspection.manifest.localLinkPlugins ?? [], logger)
      const installWarnings = []
      if (config.restore.autoInstallPlugins) {
        installWarnings.push(...await maybeInstallPlugins(config, inspection.manifest, logger))
      }
      apply.workspaceDirs = workspaceDirs
      apply.credentialWarning = credentialWarning
      const reportPath = await writeRestoreReport(config, inspection, plan, apply, safetyBackup, resolved, installWarnings)
      report('done', 100, '恢复完成')
      return {
        ok: true,
        restored: apply.restored,
        skipped: apply.skipped,
        conflicts: plan.conflicts.slice(0, 100),
        safetyBackup,
        linkRewrites,
        linkModules: linkModules.changed,
        workspaceDirs,
        credentialWarning,
        installWarnings,
        reportPath,
        archive: inspection.summary,
        source: resolved.source,
        warnings: [
          ...inspection.manifest.warnings,
          ...apply.warnings,
          ...linkModules.warnings,
          ...(workspaceDirs.created.length > 0 ? [`已创建 ${workspaceDirs.created.length} 个缺失的工作区目录（空目录）；项目文件不在备份范围内。`] : []),
          ...(workspaceDirs.missing.length > 0 ? [`以下工作区目录不存在且未能创建：${workspaceDirs.missing.join(', ')}`] : []),
        ],
      }
    })
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw fromNodeError(error, 'restore')
  } finally {
    await inspection?.cleanup?.().catch(() => undefined)
    await resolved.cleanup?.().catch(() => undefined)
  }
}

/** Extract all entries into staging, hash them, and validate paths. */
async function extractArchive(config, archivePath, staging, options) {
  const { stream, codec } = await openArchiveStream(archivePath)
  const reader = new TarReader(stream)
  const entries = []
  const symlinks = []
  const seen = new Set()
  let manifest
  let total = 0
  let entryCount = 0
  const maxTotal = config.maxExtractMB * 1024 * 1024
  try {
    for (;;) {
      if (options?.signal?.aborted) throw new BackupError(ERROR_CODES.ABORTED, 'restore aborted')
      const entry = await reader.next()
      if (entry === null) break
      entryCount += 1
      if (typeof options?.onProgress === 'function' && entryCount % 20 === 0) {
        try {
          options.onProgress({ phase: 'extract', percent: Math.min(18, 2 + entryCount / 40), message: `正在读取备份内容（${entryCount} 个文件）` })
        } catch {
          // Ignore listener errors.
        }
      }
      if (seen.has(entry.path)) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive repeats path ${entry.path}`)
      seen.add(entry.path)
      assertArchivePath(entry.path)
      const target = join(staging, entry.path)
      if (!isWithin(target, staging)) throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `archive path escapes staging: ${entry.path}`)
      if (entry.path === MANIFEST_NAME) {
        manifest = await readEntryJson(entry)
        entries.push({ path: entry.path, type: 'file', size: entry.size, mode: entry.mode, mtime: entry.mtime, sha256: shaOfJson(manifest) })
        await reader.closeEntry()
        continue
      }
      if (entry.type === 'dir') {
        await ensureDir(target)
        entries.push({ path: entry.path, type: 'dir', size: 0, mode: entry.mode, mtime: entry.mtime })
        await reader.closeEntry()
        continue
      }
      if (entry.type === 'symlink') {
        validateSymlink(staging, entry.path, entry.linkTarget)
        symlinks.push({ path: entry.path, target: entry.linkTarget })
        entries.push({ path: entry.path, type: 'symlink', size: 0, mode: entry.mode, mtime: entry.mtime, linkTarget: entry.linkTarget, sha256: createHash('sha256').update(entry.linkTarget).digest('hex') })
        await reader.closeEntry()
        continue
      }
      if (entry.type !== 'file') throw new BackupError(ERROR_CODES.ARCHIVE_UNSUPPORTED, `unsupported archive entry ${entry.type}: ${entry.path}`)
      total += entry.size
      if (total > maxTotal) {
        throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `archive expands beyond the configured maxExtractMB (${config.maxExtractMB} MiB)`, {
          hint: 'Raise maxExtractMB if this is a legitimate large backup.',
        })
      }
      await ensureDir(dirname(target))
      const hash = createHash('sha256')
      let bytes = 0
      const hasher = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(entry.read(), hasher, createWriteStream(target))
      if (bytes !== entry.size) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `truncated archive entry ${entry.path} (expected ${entry.size}, read ${bytes})`)
      await reader.closeEntry()
      entries.push({ path: entry.path, type: 'file', size: bytes, mode: entry.mode, mtime: entry.mtime, sha256: hash.digest('hex') })
    }
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `cannot read archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!manifest) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, 'archive has no dsh-backup.json manifest')
  await createSymlinks(staging, symlinks)
  return { entries, manifest, symlinks, codec }
}

async function createSymlinks(staging, symlinks) {
  for (const link of symlinks) {
    const target = join(staging, link.path)
    const linkTargetAbs = resolve(dirname(target), link.target)
    if (!isWithin(linkTargetAbs, staging)) throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `symlink ${link.path} escapes the archive root`)
    await ensureDir(dirname(target))
    await rm(target, { force: true })
    try {
      const { symlink } = await import('node:fs/promises')
      await symlink(link.target, target)
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined
      if (code !== 'EPERM' && code !== 'EACCES') throw error
      const source = await statOrNull(linkTargetAbs)
      if (!source) {
        throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `cannot materialize symlink ${link.path}: target ${link.target} is missing`, { cause: error })
      }
      const { copyTree } = await import('./fsutil.js')
      await copyTree(linkTargetAbs, target)
    }
  }
}

function validateSymlink(staging, path, linkTarget) {
  if (typeof linkTarget !== 'string' || linkTarget === '' || linkTarget.includes('\0')) {
    throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `symlink ${path} has an invalid target`)
  }
  if (linkTarget.startsWith('/') || /^[A-Za-z]:/.test(linkTarget) || linkTarget.startsWith('\\\\')) {
    throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `symlink ${path} uses an absolute target: ${linkTarget}`)
  }
  const resolved = resolve(dirname(join(staging, path)), linkTarget)
  if (!isWithin(resolved, staging)) throw new BackupError(ERROR_CODES.UNSAFE_SYMLINK, `symlink ${path} escapes the archive root`)
}

async function buildRestorePlan(config, inspection, conflict, options = {}) {
  const actions = []
  const conflicts = []
  const workspaceMap = new Map((inspection.manifest.workspaceFiles ?? []).map((item) => [item.id, item]))
  for (const entry of inspection.manifest.entries) {
    let target
    let category
    if (entry.path === 'workspace-files' || entry.path.startsWith('workspace-files/')) {
      if (options.workspaceFiles !== true) continue
      const match = /^workspace-files\/([^/]+)(?:\/(.*))?$/.exec(entry.path)
      if (!match) throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `invalid workspace archive path: ${entry.path}`)
      const workspace = workspaceMap.get(match[1])
      if (!workspace || typeof workspace.path !== 'string' || !isAbsolute(workspace.path)) {
        throw new BackupError(ERROR_CODES.ARCHIVE_CORRUPT, `workspace mapping is missing for: ${entry.path}`)
      }
      target = match[2] ? join(workspace.path, match[2]) : workspace.path
      if (!isWithin(target, workspace.path)) {
        throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `workspace restore target escapes its root: ${entry.path}`)
      }
      category = 'workspace'
    } else {
      target = restoreTargetPath(entry.path, config.dshHome, { sessionsRoot: config.sessionsRoot })
      if (target === undefined) continue
      if (!isWithin(target, config.dshHome) && !isWithin(target, config.sessionsRoot)) {
        throw new BackupError(ERROR_CODES.PATH_TRAVERSAL, `restore target escapes DSH_HOME: ${entry.path}`)
      }
      category = categoryOf(entry.path)
    }
    const staged = join(inspection.staging, entry.path)
    const existing = await lstatOrNull(target)
    let action = 'create'
    if (existing) {
      if (entry.type === 'dir' && existing.isDirectory()) {
        actions.push({ entry, target, staged, action: 'merge', category })
        continue
      }
      if (conflict === 'skip') action = 'skip'
      else if (conflict === 'fail') {
        action = 'replace'
        conflicts.push({ path: entry.path, target })
      } else if (conflict === 'prefer-newer') {
        const incoming = Number(entry.mtime) * 1000
        action = incoming > existing.mtimeMs + 1000 ? 'replace' : 'skip'
      } else {
        action = 'replace'
        conflicts.push({ path: entry.path, target })
      }
    }
    actions.push({ entry, target, staged, action, category })
  }
  if (conflict === 'fail' && conflicts.length > 0) {
    throw new BackupError(ERROR_CODES.RESTORE_CONFLICT, `${conflicts.length} file(s) already exist; restore was not started`, {
      details: { conflicts: conflicts.slice(0, 50) },
      hint: 'Use --conflict overwrite|skip|prefer-newer, or move the existing files away.',
    })
  }
  actions.sort((a, b) => depth(a.target) - depth(b.target) || a.target.localeCompare(b.target))
  return { actions, conflicts }
}

async function applyPlan(config, inspection, plan, logger, signal, onProgress) {
  const txnDir = await makeTempDir(join(config.dshHome, '.dsh-backup'), 'txn')
  const applied = []
  const createdDirs = []
  const warnings = []
  const restored = { files: 0, dirs: 0, symlinks: 0, bytes: 0 }
  const skipped = plan.actions.filter((action) => action.action === 'skip').map((action) => action.entry.path)
  const total = plan.actions.length
  let processed = 0
  try {
    for (const action of plan.actions) {
      if (signal?.aborted) throw new BackupError(ERROR_CODES.ABORTED, 'restore aborted')
      processed += 1
      if (typeof onProgress === 'function' && (processed % 5 === 0 || processed === total)) {
        try {
          onProgress({ phase: 'restore', percent: 20 + (processed / Math.max(1, total)) * 72, message: `正在恢复 ${processed}/${total} 个文件` })
        } catch {
          // Ignore listener errors.
        }
      }
      if (action.action === 'skip') continue
      const { entry, target, staged } = action
      if (entry.type === 'dir') {
        const st = await lstatOrNull(target)
        if (st && st.isDirectory()) continue
        if (st) {
          const original = await backupOriginal(target, txnDir)
          applied.push({ target, original })
        }
        await ensureDir(target, entry.mode)
        createdDirs.push(target)
        restored.dirs += 1
        continue
      }
      const existing = await lstatOrNull(target)
      let original
      if (existing) original = await backupOriginal(target, txnDir)
      if (existing) applied.push({ target, original })
      await ensureDir(dirname(target))
      if (entry.type === 'file') {
        await copyFileEnsured(staged, target, entry.mode)
        if (config.restore.preserveMode) {
          try {
            await chmod(target, entry.mode)
          } catch {
            // Windows does not implement POSIX modes.
          }
        }
        if (Number.isFinite(entry.mtime)) {
          try {
            await utimes(target, entry.mtime, entry.mtime)
          } catch {
            // best effort
          }
        }
        if (basename(target) === '.credentials.yaml') {
          try {
            await chmod(target, 0o600)
          } catch {
            // best effort
          }
        }
        restored.files += 1
        restored.bytes += entry.size
      } else if (entry.type === 'symlink') {
        const { symlinkSafe } = await import('./fsutil.js')
        try {
          await symlinkSafe(entry.linkTarget, target)
        } catch (error) {
          const code = error && typeof error === 'object' ? error.code : undefined
          if (code !== 'EPERM' && code !== 'EACCES') throw error
          const source = join(inspection.staging, entry.path)
          const resolved = await import('node:fs/promises').then((fs) => fs.realpath(source)).catch(() => null)
          if (!resolved) throw error
          const { copyTree } = await import('./fsutil.js')
          await copyTree(resolved, target)
          warnings.push(`materialized symlink ${entry.path} because this OS refused to create it`)
        }
        restored.symlinks += 1
      }
      applied.push({ target, original })
    }
    return { restored, skipped, warnings, txnDir }
  } catch (error) {
    const rollback = []
    for (const item of applied.reverse()) {
      try {
        await rm(item.target, { recursive: true, force: true })
        if (item.original) await movePath(item.original, item.target)
      } catch (rollbackError) {
        rollback.push(`${item.target}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
    }
    for (const dir of createdDirs.reverse()) {
      try {
        await rm(dir, { recursive: false, force: true })
      } catch {
        // Not empty or already gone.
      }
    }
    const detail = rollback.length === 0 ? '' : `; rollback problems: ${rollback.slice(0, 10).join(' | ')}`
    throw new BackupError(ERROR_CODES.RESTORE_ROLLED_BACK, `restore failed and was rolled back${detail}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
      details: { rollbackProblems: rollback.slice(0, 20) },
    })
  } finally {
    await removePath(txnDir).catch(() => undefined)
  }
}

async function backupOriginal(target, txnDir) {
  const rel = toPosix(target).replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
  const original = join(txnDir, 'orig', rel)
  await ensureDir(dirname(original))
  await movePath(target, original)
  return original
}

async function ensureWorkspaceDirs(cwds, enabled) {
  const created = []
  const missing = []
  for (const cwd of cwds) {
    if (typeof cwd !== 'string' || cwd.trim() === '' || !isAbsolute(cwd)) continue
    const existing = await statOrNull(cwd)
    if (existing?.isDirectory()) continue
    if (!enabled) {
      missing.push(cwd)
      continue
    }
    try {
      await ensureDir(cwd)
      created.push(cwd)
    } catch {
      missing.push(cwd)
    }
  }
  return { created, missing }
}

async function writeRestoreReport(config, inspection, plan, apply, safetyBackup, resolved, installWarnings) {
  const dir = join(config.localDir, 'restore-reports')
  await ensureDir(dir)
  const path = join(dir, `restore-${timestampForName()}.json`)
  await writeJsonFile(path, {
    format: 'dsh-backup-restore-report',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    archive: inspection.summary,
    source: resolved.source,
    safetyBackup,
    restored: apply.restored,
    workspaceDirs: apply.workspaceDirs,
    credentialWarning: apply.credentialWarning,
    skipped: apply.skipped,
    conflicts: plan.conflicts,
    installWarnings,
    warnings: apply.warnings,
  }, 0o600)
  return path
}

async function maybeInstallPlugins(config, manifest, logger) {
  const warnings = []
  const profiles = Array.isArray(manifest.inventory?.profiles) ? manifest.inventory.profiles : []
  for (const profile of profiles) {
    if (!profile?.exists) continue
    const dir = join(config.dshHome, 'profiles', profile.name)
    const packageJson = join(dir, 'package.json')
    if (!(await pathExists(packageJson))) continue
    const nodeModules = join(dir, 'node_modules')
    const hasModules = (await pathExists(nodeModules)) && (await readdir(nodeModules).catch(() => [])).length > 0
    if (hasModules) continue
    const pnpm = runPnpm(['--version'], { encoding: 'utf8', timeout: 15_000 })
    if (pnpm.status !== 0) {
      warnings.push(`profile ${profile.name}: node_modules is missing and pnpm is unavailable; run "dsh plugin --profile ${profile.name} install" later`)
      continue
    }
    logger?.info?.(`[dsh-backup] node_modules missing for profile ${profile.name}; running pnpm install`)
    const install = runPnpm(['install', '--prefer-offline'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10 * 60_000,
      env: process.env,
    })
    if (install.status !== 0) {
      warnings.push(`profile ${profile.name}: pnpm install failed: ${(install.stderr || install.stdout || '').trim().slice(0, 500)}`)
    }
  }
  return warnings
}

function runPnpm(args, options) {
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], options)
  }
  return spawnSync('pnpm', args, options)
}

const RESTORE_CATEGORIES = Object.freeze(['sessions', 'plugins', 'config', 'storages', 'state', 'workspace', 'pluginData'])

function normalizeRestoreCategories(value) {
  if (value === undefined || value === null) return undefined
  const list = (Array.isArray(value) ? value : [value]).map((item) => String(item))
  const filtered = list.filter((item) => RESTORE_CATEGORIES.includes(item))
  return filtered.length > 0 ? filtered : undefined
}

function categoryOf(path) {
  const p = toPosix(path)
  if (p === 'sessions' || p.startsWith('sessions/')) return 'sessions'
  if (p === 'profiles' || p.startsWith('profiles/')) return 'plugins'
  if (p === 'home' || p.startsWith('home/')) {
    const name = p.slice('home/'.length).split('/')[0]
    return ['settings.yaml', 'cordis.patch.yml', 'cordis.yml', '.credentials.yaml', '.env'].includes(name) ? 'config' : 'pluginData'
  }
  if (p === 'storages' || p.startsWith('storages/')) return 'storages'
  if (p === 'plugins' || p.startsWith('plugins/')) return 'plugins'
  if (p === 'local-plugins' || p.startsWith('local-plugins/')) return 'plugins'
  if (p === 'state' || p.startsWith('state/')) return 'state'
  return 'meta'
}

function depth(path) {
  return toPosix(path).split('/').length
}

function looksLikeLocalPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.includes('\\') || value.includes('/')
}

async function findLocal(config, wanted) {
  const list = await listLocalArchives(config)
  if (wanted === 'latest') {
    const regular = list.filter((archive) => !archive.name.includes('-pre-restore'))
    return regular[0] ?? list[0]
  }
  return list.find((archive) => archive.name === wanted)
}

function shaOfJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
