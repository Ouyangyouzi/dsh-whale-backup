import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { hostname, platform, arch } from 'node:os'
import { BackupError, ERROR_CODES, fromNodeError } from './errors.js'
import {
  archiveExtension,
} from './config.js'
import {
  ensureDir,
  formatBytes,
  isWithin,
  makeTempDir,
  movePath,
  removePath,
  statOrNull,
  sha256Text,
  timestampForName,
  toPosix,
  walk,
} from './fsutil.js'
import { collectLocalLinks, discoverRepositoryDirs, profileInventory, readProfilePackage, assertDshHome } from './plugins.js'
import { isSessionArtifact, selectedProjectDirs, sessionArchivePath, snapshotSessionFile } from './sessions.js'
import { TarWriter, compressArchive } from './tar.js'
import { createManifest, MANIFEST_NAME, serializeManifest, writeChecksumSidecar } from './manifest.js'
import { WebdavClient } from './webdav.js'
import { withOperationLock } from './lock.js'

/** Archive filename extensions accepted by list/restore. */
export const ARCHIVE_NAME_RE = /\.(?:tar\.zst|tar\.gz|tgz|tzst|tar)$/i

/**
 * Create a backup archive.
 *
 * @param {{
 *   config: ReturnType<typeof resolveConfig>,
 *   cwd?: string,
 *   destination?: 'local'|'webdav'|'both',
 *   label?: string,
 *   compression?: string,
 *   compressionLevel?: number,
 *   includeCredentials?: boolean,
 *   includePluginCode?: boolean,
 *   includeStorages?: boolean,
 *   overwrite?: boolean,
 *   prune?: boolean,
 *   signal?: AbortSignal,
 *   skipLock?: boolean,
 *   logger?: { info: Function, warn: Function, debug?: Function },
 *   flushSessions?: () => Promise<void>,
 * }} options
 */
export async function createBackup(options) {
  const { config, logger } = options
  const destination = options.destination ?? 'local'
  if (!['local', 'webdav', 'both'].includes(destination)) {
    throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `destination must be local, webdav or both, got ${JSON.stringify(destination)}`)
  }
  if ((destination === 'webdav' || destination === 'both') && !config.webdav.url) {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'WebDAV destination requested but webdav.url is empty', {
      hint: 'Configure webdav.url/username/passwordEnv, or run with --to local.',
    })
  }
  await assertDshHome(config)
  const report = (phase, percent, message, extra = {}) => {
    if (typeof options.onProgress !== 'function') return
    try {
      options.onProgress({ phase, percent: Math.max(0, Math.min(100, percent)), message, ...extra })
    } catch {
      // A broken progress listener must never fail the backup.
    }
  }
  const execute = async () => {
    const startedAt = Date.now()
    const compression = options.compression ?? config.compression
    const level = options.compressionLevel ?? config.compressionLevel
    const cwd = resolve(options.cwd ?? process.cwd())
    const label = sanitizeLabel(options.label ?? '')
    const effective = {
      ...config,
      compression,
      compressionLevel: level,
      includeCredentials: options.includeCredentials ?? config.includeCredentials,
      includePluginCode: options.includePluginCode ?? config.includePluginCode,
      includeStorages: options.includeStorages ?? config.includeStorages,
    }
    const warnings = []
    const skipped = []
    const seen = new Set()
    const tempDir = await makeTempDir(config.tempDir, 'backup')
    const tarPath = join(tempDir, 'payload.tar')
    const archiveName = buildArchiveName(effective, label)
    const archivePath = join(tempDir, archiveName)
    let writer
    try {
      report('start', 1, '正在准备备份…')
      logger?.info?.(`[dsh-backup] collecting data from ${config.dshHome}`)
      if (options.flushSessions) {
        try {
          await options.flushSessions()
        } catch (error) {
          warnings.push(`could not flush live sessions: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const profiles = await profileInventory(config)
      const localLinks = []
      for (const profile of profiles) {
        if (!profile.exists) {
          warnings.push(`profile ${profile.name} does not exist; skipped`)
          continue
        }
        const pkg = await readProfilePackage(profile.dir)
        localLinks.push(...(await collectLocalLinks(profile.dir, profile.name, pkg)))
      }
      const repoDirs = effective.includeRepositoryPlugins ? await discoverRepositoryDirs(effective) : []
      const workspace = await selectedProjectDirs(effective, cwd)

      writer = await TarWriter.create(tarPath)
      const addEntry = async (kind, sourcePath, archivePath, meta = {}) => {
        const normalized = toPosix(archivePath).replace(/^\/+/, '')
        if (seen.has(normalized)) return
        seen.add(normalized)
        if (kind === 'dir') await writer.addDirectory(normalized, meta)
        else if (kind === 'file') await writer.addFile(sourcePath, normalized, meta)
        else if (kind === 'symlink') await writer.addSymlink(normalized, meta.linkTarget, meta)
      }

      const addTree = async (sourceRoot, archiveRoot, treeOptions = {}) => {
        const st = await statOrNull(sourceRoot)
        if (!st || !st.isDirectory()) {
          if (treeOptions.required) warnings.push(`missing directory: ${sourceRoot}`)
          return { files: 0, bytes: 0, dirs: 0 }
        }
        await addEntry('dir', sourceRoot, archiveRoot, { mode: 0o755, mtime: st.mtime })
        let files = 0
        let bytes = 0
        let dirs = 0
        const iterator = walk(sourceRoot, {
          exclude: [...effective.excludePatterns, ...(treeOptions.exclude ?? [])],
          maxFileSize: effective.maxFileSizeMB * 1024 * 1024,
          signal: options.signal,
          onError: (error, rel) => warnings.push(`cannot read ${toPosix(join(sourceRoot, rel))}: ${error instanceof Error ? error.message : String(error)}`),
          onSkip: (rel, reason, size) => skipped.push({ path: toPosix(join(sourceRoot, rel)), reason, size }),
        })
        for await (const entry of iterator) {
          if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new BackupError(ERROR_CODES.ABORTED, 'backup aborted')
          const target = `${archiveRoot}/${entry.rel}`.replace(/\/+/g, '/')
          if (entry.type === 'dir') {
            dirs += 1
            await addEntry('dir', entry.abs, target, { mode: entry.stat.mode, mtime: entry.stat.mtime })
          } else if (entry.type === 'file') {
            files += 1
            bytes += entry.stat.size
            scannedFiles += 1
            if (scannedFiles % 20 === 0) report('scan', Math.min(48, 6 + scannedFiles / 25), `正在收集文件（${scannedFiles} 个）`)
            await addEntry('file', entry.abs, target, { mode: entry.stat.mode, mtime: entry.stat.mtime, size: entry.stat.size })
          } else if (entry.type === 'symlink') {
            if (treeOptions.skipSymlinks?.has(toPosix(entry.rel))) {
              skipped.push({ path: entry.abs, reason: 'link: plugin symlink is restored separately', size: 0 })
              continue
            }
            const targetLink = entry.linkTarget ?? ''
            const resolvedTarget = isAbsolute(targetLink) ? targetLink : resolve(dirname(entry.abs), targetLink)
            const portable = isWithin(resolvedTarget, sourceRoot) || isWithin(resolvedTarget, effective.dshHome)
            if (!portable) {
              warnings.push(`skipped non-portable symlink ${toPosix(entry.rel)} -> ${targetLink}`)
              skipped.push({ path: entry.abs, reason: 'symlink target is absolute or outside DSH_HOME', size: 0 })
              continue
            }
            // Absolute symlinks are common in pnpm stores and Windows junctions;
            // storing them relative keeps the restored tree movable.
            const storedTarget = isAbsolute(targetLink) ? toPosix(relative(dirname(entry.abs), resolvedTarget)) : targetLink
            await addEntry('symlink', entry.abs, target, { mode: entry.stat.mode, mtime: entry.stat.mtime, linkTarget: storedTarget })
          }
        }
        return { files, bytes, dirs }
      }

      const counts = { sessions: 0, sessionFiles: 0, sessionBytes: 0, profileFiles: 0, pluginFiles: 0, configFiles: 0, storageFiles: 0, pluginDataFiles: 0, workspaceFiles: 0 }
      let scannedFiles = 0
      const workspaceCwds = new Set()
      const workspaceFiles = []

      if (effective.includeSessions) {
        const snapshotsDir = join(tempDir, 'session-snapshots')
        await ensureDir(snapshotsDir)
        let snapshotIndex = 0
        const candidates = []
        for (const projectDir of workspace.dirs) {
          const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const sessionDir = join(projectDir, entry.name)
            const files = await readdir(sessionDir, { withFileTypes: true }).catch(() => [])
            const artifacts = files.filter((file) => file.isFile() && isSessionArtifact(file.name))
            if (artifacts.length === 0) continue
            let updatedAt = 0
            for (const artifact of artifacts) {
              const info = await statOrNull(join(sessionDir, artifact.name))
              if (info && info.mtimeMs > updatedAt) updatedAt = info.mtimeMs
            }
            candidates.push({ id: entry.name, sessionDir, artifacts, updatedAt })
          }
        }
        const wanted = new Set((Array.isArray(options.sessionIds) ? options.sessionIds : []).map(String).filter(Boolean))
        if (wanted.size > 0) {
          for (let i = candidates.length - 1; i >= 0; i -= 1) {
            if (!wanted.has(candidates[i].id)) candidates.splice(i, 1)
          }
        } else if (Number(options.recentSessions) > 0) {
          candidates.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          candidates.length = Math.min(candidates.length, Number(options.recentSessions))
        }
        for (const candidate of candidates) {
          const { sessionDir, artifacts } = candidate
          counts.sessions += 1
          report('scan', Math.min(50, 6 + counts.sessionFiles / 10), `正在读取聊天记录（${counts.sessions} 个会话）`)
          for (const artifact of artifacts) {
              const source = join(sessionDir, artifact.name)
              const st = await statOrNull(source)
              if (!st) continue
              if (st.size > effective.maxFileSizeMB * 1024 * 1024) {
                skipped.push({ path: source, reason: 'larger than maxFileSizeMB', size: st.size })
                continue
              }
              const snapshot = join(snapshotsDir, `${snapshotIndex}-${artifact.name}`)
              snapshotIndex += 1
              const stable = await snapshotSessionFile(source, snapshot, {
                flush: options.flushSessions,
                signal: options.signal,
                attempts: 6,
              })
              if (typeof stable.header.cwd === 'string' && stable.header.cwd !== '') workspaceCwds.add(stable.header.cwd)
              counts.sessionFiles += 1
              counts.sessionBytes += stable.size
              await addEntry('file', snapshot, sessionArchivePath(config.sessionsRoot, source), { mode: st.mode, mtime: stable.mtime, size: stable.size })
            }
        }
      }

      if (effective.includeWorkspaceFiles) {
        const paths = new Set()
        for (const path of workspace.workspace.paths) paths.add(resolve(path))
        for (const cwd of workspaceCwds) paths.add(resolve(cwd))
        const workspaceExcludes = [
          '**/.git/**', '**/.git',
          '**/node_modules/**', '**/node_modules',
          '**/.next/**', '**/dist/**', '**/build/**',
          '**/target/**', '**/__pycache__/**',
          '**/.venv/**', '**/venv/**', '**/.cache/**',
          ...effective.excludePatterns,
        ]
        for (const workspacePath of paths) {
          const st = await statOrNull(workspacePath)
          if (!st || !st.isDirectory()) {
            warnings.push(`workspace files: directory does not exist: ${workspacePath}`)
            continue
          }
          if (resolve(workspacePath) === parse(workspacePath).root) {
            warnings.push(`workspace files: refusing to archive filesystem root ${workspacePath}`)
            continue
          }
          if (resolve(workspacePath) === resolve(config.dshHome)) {
            warnings.push(`workspace files: refusing to archive DSH_HOME itself ${workspacePath}`)
            continue
          }
          const relativeDsh = relative(workspacePath, config.dshHome)
          if (relativeDsh !== '' && !relativeDsh.startsWith('..') && !isAbsolute(relativeDsh)) {
            workspaceExcludes.push(`${toPosix(relativeDsh)}/**`)
          }
          const id = sha256Text(workspacePath).slice(0, 16)
          const archivePath = `workspace-files/${id}`
          const result = await addTree(workspacePath, archivePath, { required: true, exclude: workspaceExcludes })
          counts.workspaceFiles += result.files
          workspaceFiles.push({ id, path: resolve(workspacePath), archivePath, files: result.files })
        }
      }

      if (effective.includePlugins) {
        for (const profile of profiles) {
          if (!profile.exists) continue
          const profileExcludes = effective.includePluginCode ? [] : ['**/node_modules', '**/node_modules/**']
          const profileLinks = new Set(localLinks.filter((link) => link.profile === profile.name).map((link) => `node_modules/${link.dependency}`))
          const result = await addTree(profile.dir, `profiles/${profile.name}`, { required: true, exclude: profileExcludes, skipSymlinks: profileLinks })
          counts.profileFiles += result.files
          if (!effective.includePluginCode) skipped.push({ path: join(profile.dir, 'node_modules'), reason: 'includePluginCode=false' })
        }
        if (effective.includePluginCode) {
          // dsh keeps an out-of-tree flat-closure fallback at
          // $DSH_HOME/profiles/node_modules; profiles reference it.
          const sharedModules = join(config.dshHome, 'profiles', 'node_modules')
          const shared = await addTree(sharedModules, 'profiles/node_modules', { required: false })
          counts.pluginFiles += shared.files
        }
        for (const repo of repoDirs) {
          const result = await addTree(repo.realPath, repo.archivePath, { required: false })
          counts.pluginFiles += result.files
        }
        if (effective.includePluginCode) {
          for (const link of localLinks) {
            const result = await addTree(link.realPath, link.archivedPath, { required: true })
            counts.pluginFiles += result.files
          }
        }
      } else if (effective.includeConfig) {
        // A config-only backup still needs the profile's mount and dependency
        // manifests, otherwise restored plugins cannot be reinstalled.
        for (const profile of profiles) {
          if (!profile.exists) continue
          for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml', '.npmrc']) {
            const source = join(profile.dir, name)
            const st = await statOrNull(source)
            if (!st || !st.isFile()) continue
            counts.configFiles += 1
            await addEntry('file', source, `profiles/${profile.name}/${name}`, { mode: st.mode, mtime: st.mtime, size: st.size })
          }
        }
      }

      if (effective.includeConfig) {
        const homeFiles = ['settings.yaml', 'cordis.patch.yml', 'dsh-backup.config.json']
        if (effective.includeCredentials) homeFiles.push('.credentials.yaml', '.env')
        else if (effective.includeEnv) homeFiles.push('.env')
        for (const name of homeFiles) {
          const source = join(config.dshHome, name)
          const st = await statOrNull(source)
          if (!st || !st.isFile()) continue
          counts.configFiles += 1
          await addEntry('file', source, `home/${name}`, { mode: st.mode, mtime: st.mtime, size: st.size })
        }
      }

      if (effective.includeStorages) {
        const storagesDir = join(config.dshHome, 'storages')
        const result = await addTree(storagesDir, 'storages', { required: false })
        counts.storageFiles += result.files
        for (const name of ['storage.sqlite', 'storage.sqlite-wal', 'storage.sqlite-shm']) {
          const source = join(config.dshHome, name)
          const st = await statOrNull(source)
          if (!st || !st.isFile()) continue
          counts.storageFiles += 1
          await addEntry('file', source, `home/${name}`, { mode: st.mode, mtime: st.mtime, size: st.size })
        }
      }

      const pluginData = []
      if (effective.includePluginData) {
        // Plugin/account state often lives in top-level DSH_HOME directories
        // (for example workbuddy-vault, dsh-market, openai-gateway). Those are
        // not profile data and were the missing half of a "plugins restored but
        // their data is gone" recovery.
        const reserved = new Set([
          'sessions', 'profiles', 'storages', 'backups', 'plugins',
          'logs', 'cache', 'dsh-runtimes', '.dsh-backup', 'node_modules',
        ])
        const topLevel = await readdir(config.dshHome, { withFileTypes: true }).catch(() => [])
        for (const entry of topLevel.sort((a, b) => a.name.localeCompare(b.name))) {
          const name = entry.name
          if (reserved.has(name) || name === '.credentials.yaml' || name === '.env') continue
          if (name.startsWith('.dsh-backup')) continue
          const source = join(config.dshHome, name)
          if (entry.isDirectory()) {
            const result = await addTree(source, `home/${name}`, { required: false })
            counts.pluginDataFiles += result.files
            pluginData.push({ name, type: 'dir', files: result.files })
          } else if (entry.isFile()) {
            const st = await statOrNull(source)
            if (!st) continue
            if (st.size > effective.maxFileSizeMB * 1024 * 1024) {
              skipped.push({ path: source, reason: 'larger than maxFileSizeMB', size: st.size })
              continue
            }
            counts.pluginDataFiles += 1
            await addEntry('file', source, `home/${name}`, { mode: st.mode, mtime: st.mtime, size: st.size })
            pluginData.push({ name, type: 'file', files: 1 })
          } else if (entry.isSymbolicLink()) {
            warnings.push(`skipped top-level symlink: ${source}`)
          }
        }
      }

      for (const extra of effective.extraPaths) {
        const st = await statOrNull(extra)
        if (!st) {
          warnings.push(`extraPaths entry does not exist: ${extra}`)
          continue
        }
        const archiveRoot = `state/extra/${basename(extra)}`
        if (st.isDirectory()) {
          const result = await addTree(extra, archiveRoot, { required: false })
          counts.configFiles += result.files
        } else if (st.isFile()) {
          counts.configFiles += 1
          await addEntry('file', extra, archiveRoot, { mode: st.mode, mtime: st.mtime, size: st.size })
        }
      }

      const inventory = {
        profiles,
        localLinks,
        repositoryPlugins: repoDirs.map((repo) => ({ name: repo.name, archivePath: repo.archivePath, insideDshHome: repo.insideDshHome })),
        pluginData,
        workspaceFiles,
        workspace: { mode: workspace.workspace.mode, paths: workspace.workspace.paths, keys: workspace.workspace.keys },
      }
      await writer.addBuffer('meta/inventory.json', `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 })

      const manifest = createManifest({
        label,
        host: { hostname: hostname(), platform: platform(), arch: arch(), node: process.version },
        source: { dshHome: config.dshHome, sessionsRoot: config.sessionsRoot, profiles: profiles.map((p) => p.name), cwd },
        workspace: inventory.workspace,
        compression,
        includesCredentials: effective.includeCredentials,
        includesEnv: effective.includeEnv,
        inventory,
        localLinkPlugins: localLinks,
        workspaceFiles,
        warnings,
      }, writer.entries)
      await writer.addBuffer(MANIFEST_NAME, serializeManifest(manifest), { mode: 0o600 })
      await writer.finalize()
      writer = undefined

      if (options.signal?.aborted) throw new BackupError(ERROR_CODES.ABORTED, 'backup aborted')
      logger?.info?.(`[dsh-backup] compressing ${formatBytes((await stat(tarPath)).size)} with ${compression} level ${level}`)
      report('compress', 52, '正在压缩备份…')
      await compressArchive(tarPath, archivePath, compression, level, (ratio) => {
        report('compress', 52 + ratio * 40, `正在压缩 ${Math.round(ratio * 100)}%`)
      })
      await removePath(tarPath)
      report('checksum', 93, '正在生成校验信息…')
      const checksum = await writeChecksumSidecar(archivePath)
      const archiveSize = (await stat(archivePath)).size
      logger?.info?.(`[dsh-backup] archive ready: ${archiveName} (${formatBytes(archiveSize)}, sha256 ${checksum.digest.slice(0, 12)}…)`)

      const result = {
        ok: true,
        name: archiveName,
        archiveName,
        size: archiveSize,
        sizeLabel: formatBytes(archiveSize),
        sha256: checksum.digest,
        compression,
        createdAt: manifest.createdAt,
        summary: {
          ...manifest.summary,
          sessions: counts.sessions,
          sessionFiles: counts.sessionFiles,
          sessionBytes: counts.sessionBytes,
          profileFiles: counts.profileFiles,
          pluginFiles: counts.pluginFiles,
          configFiles: counts.configFiles,
          storageFiles: counts.storageFiles,
          pluginDataFiles: counts.pluginDataFiles,
          workspaceFiles: counts.workspaceFiles,
          skipped: skipped.length,
        },
        warnings,
        skipped,
        local: undefined,
        remote: undefined,
        durationMs: Date.now() - startedAt,
      }

      if (destination === 'local' || destination === 'both') {
        report('save', 95, '正在保存备份文件…')
        await ensureDir(config.localDir)
        const finalPath = await chooseLocalPath(effective, archiveName, options.overwrite === true)
        await movePath(archivePath, finalPath)
        const finalSidecar = `${finalPath}.sha256`
        await movePath(`${archivePath}.sha256`, finalSidecar)
        result.local = { path: finalPath, sidecar: finalSidecar, name: basename(finalPath), size: archiveSize }
        logger?.info?.(`[dsh-backup] local backup written: ${finalPath}`)
        if (options.prune !== false) {
          result.pruned = await pruneLocalArchives(config, config.keepLocal, [basename(finalPath)], logger)
        }
      }

      if (destination === 'webdav' || destination === 'both') {
        const uploadSource = result.local?.path ?? archivePath
        const uploadName = result.local?.name ?? archiveName
        report('upload', 97, '正在上传到 WebDAV…')
        const client = new WebdavClient(effective, logger)
        try {
          const remote = await client.upload(uploadSource, uploadName, options.signal)
          result.remote = remote
          logger?.info?.(`[dsh-backup] WebDAV upload complete: ${remote.url}`)
          if (options.prune !== false) {
            result.remotePruned = await pruneRemoteArchives(client, config.keepWebdav, [uploadName], logger, options.signal)
          }
        } catch (error) {
          if (error instanceof BackupError && result.local) {
            error.details = { ...error.details, localArchive: result.local.path }
            error.hint = error.hint ? `${error.hint} The local archive is still valid at ${result.local.path}.` : `The local archive is still valid at ${result.local.path}.`
          }
          throw error
        }
      }

      report('done', 100, '备份完成')
      return result
    } catch (error) {
      if (writer) await writer.abort().catch(() => undefined)
      if (error instanceof BackupError) throw error
      throw fromNodeError(error, 'backup')
    } finally {
      await removePath(tempDir).catch(() => undefined)
    }
  }
  return options.skipLock === true ? execute() : withOperationLock(config, 'backup', execute)
}

/** Build a timestamped archive name. */
export function buildArchiveName(config, label = '') {
  const suffix = label === '' ? '' : `-${sanitizeLabel(label)}`
  return `${config.archivePrefix}-${timestampForName()}${suffix}${archiveExtension(config.compression)}`
}

/** List local archives, newest first. */
export async function listLocalArchives(config) {
  const st = await statOrNull(config.localDir)
  if (!st || !st.isDirectory()) return []
  const entries = await readdir(config.localDir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !ARCHIVE_NAME_RE.test(entry.name)) continue
    const path = join(config.localDir, entry.name)
    const info = await stat(path)
    out.push({
      name: entry.name,
      path,
      size: info.size,
      sizeLabel: formatBytes(info.size),
      mtime: info.mtimeMs,
      createdAt: new Date(info.mtimeMs).toISOString(),
      source: 'local',
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** List WebDAV archives, newest first. */
export async function listRemoteArchives(config, logger, signal) {
  const client = new WebdavClient(config, logger)
  const entries = await client.list(signal)
  return entries
    .filter((entry) => ARCHIVE_NAME_RE.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: entry.url,
      size: entry.size,
      sizeLabel: entry.size === undefined ? '?' : formatBytes(entry.size),
      mtime: entry.lastModified ? Date.parse(entry.lastModified) : 0,
      createdAt: entry.lastModified ? new Date(entry.lastModified).toISOString() : '',
      source: 'webdav',
    }))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || b.name.localeCompare(a.name))
}

/** Keep only the newest N local archives (and their sidecars). */
export async function pruneLocalArchives(config, keep, protect = [], logger) {
  const archives = await listLocalArchives(config)
  const isAuto = (name) => /-auto\b|-auto\.|-auto-/.test(name) || /^auto-/.test(name)
  const autoCount = archives.filter((archive) => isAuto(archive.name)).length
  // Manual backups are never pruned by the schedule. When the scheduled run
  // carries its own limit, it applies only to `auto` labelled archives.
  const autoLimit = config.schedule?.keepAuto > 0
    ? config.schedule.keepAuto
    : null
  const kept = new Set(protect)
  const removed = []
  let autoKept = 0
  for (const archive of archives) {
    if (kept.has(archive.name)) continue
    if (autoLimit !== null) {
      if (!isAuto(archive.name)) continue
      if (autoKept >= autoLimit) {
        await removePath(archive.path)
        await removePath(`${archive.path}.sha256`).catch(() => undefined)
        removed.push(archive.name)
      } else {
        autoKept += 1
      }
      continue
    }
    if (kept.size >= keep) {
      await removePath(archive.path)
      await removePath(`${archive.path}.sha256`).catch(() => undefined)
      removed.push(archive.name)
    } else {
      kept.add(archive.name)
    }
  }
  if (removed.length > 0) logger?.info?.(`[dsh-backup] pruned ${removed.length} old local archive(s) (auto pool ${autoCount})`)
  return removed
}

/** Keep only the newest N WebDAV archives (and their sidecars). */
export async function pruneRemoteArchives(client, keep, protect = [], logger, signal) {
  const archives = (await client.list(signal)).filter((entry) => ARCHIVE_NAME_RE.test(entry.name))
  archives.sort((a, b) => (Date.parse(b.lastModified ?? '') || 0) - (Date.parse(a.lastModified ?? '') || 0) || b.name.localeCompare(a.name))
  const kept = new Set(protect)
  const removed = []
  for (const archive of archives) {
    if (kept.has(archive.name)) continue
    if (kept.size >= keep) {
      await client.remove(archive.name, signal)
      removed.push(archive.name)
    } else {
      kept.add(archive.name)
    }
  }
  if (removed.length > 0) logger?.info?.(`[dsh-backup] pruned ${removed.length} old WebDAV archive(s)`)
  return removed
}

async function chooseLocalPath(config, archiveName, overwrite) {
  const target = join(config.localDir, archiveName)
  if (overwrite || !(await statOrNull(target))) return target
  const ext = archiveExtension(config.compression)
  const base = archiveName.slice(0, archiveName.length - ext.length)
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = join(config.localDir, `${base}-${i}${ext}`)
    if (!(await statOrNull(candidate))) return candidate
  }
  throw new BackupError(ERROR_CODES.INVALID_ARGUMENT, `cannot find a free archive name for ${archiveName}`)
}

function sanitizeLabel(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}
