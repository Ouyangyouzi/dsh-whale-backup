import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rm, copyFile, stat, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createBackup, listRemoteArchives } from '../lib/core/backup.js'
import { restoreArchive, verifyArchive } from '../lib/core/restore.js'
import { BackupError, ERROR_CODES } from '../lib/core/errors.js'
import { projectKey } from '../lib/core/sessions.js'
import { TarWriter, compressArchive } from '../lib/core/tar.js'
import { writeChecksumSidecar } from '../lib/core/manifest.js'

const root = join(tmpdir(), `dsh-backup-advanced-${process.pid}-${Date.now()}`)

test.after(async () => { await rm(root, { recursive: true, force: true }) })

async function fixture(name) {
  const home = join(root, name)
  const workspace = join(root, `${name}-workspace`)
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-abc')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  const header = { type: 'session', version: 4, id: 'session-abc', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 }
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n`)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web","version":"0.56.0"}\n')
  return { home, workspace }
}

test('gzip and uncompressed archives round-trip', async () => {
  const { home, workspace } = await fixture('formats')
  for (const compression of ['gzip', 'none']) {
    const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', compression, localDir: join(home, 'backups') }, { cwd: workspace })
    const backup = await createBackup({ config, cwd: workspace, destination: 'local', prune: false, logger: quiet() })
    assert.match(backup.archiveName, compression === 'gzip' ? /\.tar\.gz$/ : /\.tar$/)
    const verified = await verifyArchive(config, backup.local.path)
    assert.equal(verified.ok, true)
    assert.equal(verified.summary.sessions, 1)
  }
})

test('conflict=fail refuses and conflict=skip preserves existing data', async () => {
  const { home, workspace } = await fixture('conflicts')
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', prune: false, logger: quiet() })
  const targetHome = join(root, 'conflicts-target')
  await mkdir(targetHome, { recursive: true })
  await writeFile(join(targetHome, 'settings.yaml'), 'keep-me\n')
  const target = resolveConfig({ dshHome: targetHome, profiles: ['web'], workspace: 'all', localDir: join(targetHome, 'backups') }, { cwd: workspace })
  await assert.rejects(
    () => restoreArchive({ config: target, cwd: workspace, archive: backup.local.path, yes: true, conflict: 'fail', safetyBackup: false, logger: quiet() }),
    (error) => error instanceof BackupError && error.code === ERROR_CODES.RESTORE_CONFLICT,
  )
  const skipped = await restoreArchive({ config: target, cwd: workspace, archive: backup.local.path, yes: true, conflict: 'skip', safetyBackup: false, logger: quiet() })
  assert.equal(skipped.ok, true)
  assert.equal((await readFile(join(targetHome, 'settings.yaml'), 'utf8')), 'keep-me\n')
  const overwritten = await restoreArchive({ config: target, cwd: workspace, archive: backup.local.path, yes: true, conflict: 'overwrite', safetyBackup: false, logger: quiet() })
  assert.equal(overwritten.ok, true)
  assert.equal((await readFile(join(targetHome, 'settings.yaml'), 'utf8')).includes('deepseek-official'), true)
})

test('checksum tampering is rejected', async () => {
  const { home, workspace } = await fixture('checksum')
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', prune: false, logger: quiet() })
  await appendFile(backup.local.path, 'tampered')
  await assert.rejects(
    () => verifyArchive(config, backup.local.path),
    (error) => error instanceof BackupError && error.code === ERROR_CODES.CHECKSUM_MISMATCH,
  )
})

test('path traversal and symlink escape are rejected', async () => {
  const staging = join(root, 'malicious')
  await mkdir(staging, { recursive: true })
  const tar = join(staging, 'payload.tar')
  const writer = await TarWriter.create(tar)
  await writer.addBuffer('../evil.txt', 'nope\n')
  await writer.finalize()
  const archive = join(staging, 'evil.tar')
  await compressArchive(tar, archive, 'none', 0)
  await writeChecksumSidecar(archive)
  const config = resolveConfig({ dshHome: join(root, 'malicious-home'), localDir: join(root, 'malicious-home', 'backups') }, { cwd: root })
  await assert.rejects(
    () => verifyArchive(config, archive),
    (error) => error instanceof BackupError && error.code === ERROR_CODES.PATH_TRAVERSAL,
  )

  const tar2 = join(staging, 'payload2.tar')
  const writer2 = await TarWriter.create(tar2)
  await writer2.addSymlink('home/link', '../../outside')
  await writer2.finalize()
  const archive2 = join(staging, 'evil2.tar')
  await compressArchive(tar2, archive2, 'none', 0)
  await writeChecksumSidecar(archive2)
  await assert.rejects(
    () => verifyArchive(config, archive2),
    (error) => error instanceof BackupError && error.code === ERROR_CODES.UNSAFE_SYMLINK,
  )
})

test('long and unicode archive paths round-trip', async () => {
  const { home, workspace } = await fixture('longpath')
  const deep = join(home, 'profiles', 'web', 'node_modules', 'a-very-long-package-name-that-exceeds-one-hundred-bytes-in-the-tar-header', 'nested', '目录', 'file-with-a-long-name.txt')
  await mkdir(join(deep, '..'), { recursive: true })
  await writeFile(deep, 'long-path-content\n')
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', prune: false, logger: quiet() })
  const targetHome = join(root, 'longpath-target')
  await mkdir(targetHome, { recursive: true })
  const target = resolveConfig({ dshHome: targetHome, profiles: ['web'], workspace: 'all', localDir: join(targetHome, 'backups') }, { cwd: workspace })
  const restored = await restoreArchive({ config: target, cwd: workspace, archive: backup.local.path, yes: true, conflict: 'overwrite', safetyBackup: false, logger: quiet() })
  assert.equal(restored.ok, true)
  assert.equal((await readFile(join(targetHome, 'profiles', 'web', 'node_modules', 'a-very-long-package-name-that-exceeds-one-hundred-bytes-in-the-tar-header', 'nested', '目录', 'file-with-a-long-name.txt'), 'utf8')), 'long-path-content\n')
})

test('corrupt zstd payload is reported, not thrown as an unhandled stream error', async () => {
  const path = join(root, 'corrupt-zstd.tar.zst')
  await mkdir(root, { recursive: true })
  await writeFile(path, Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from('not a zstd frame')]))
  const config = resolveConfig({ dshHome: join(root, 'corrupt-home'), localDir: join(root, 'corrupt-home', 'backups') }, { cwd: root })
  await assert.rejects(
    () => verifyArchive(config, path, { requireChecksum: false }),
    (error) => error instanceof BackupError,
  )
})

test('restore creates an empty missing workspace directory so a session can open', async () => {
  const home = join(root, 'missing-workspace-home')
  const workspace = join(root, 'workspace-not-created')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-missing-cwd')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'desktop'), { recursive: true })
  await writeFile(join(home, 'profiles', 'desktop', 'package.json'), '{"name":"desktop"}\n')
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-missing-cwd', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  const config = resolveConfig({ dshHome: home, profiles: 'all', workspace: 'all', localDir: join(home, 'backups') }, { cwd: root })
  const backup = await createBackup({ config, cwd: root, destination: 'local', prune: false, logger: quiet() })
  const targetHome = join(root, 'missing-workspace-target')
  await mkdir(targetHome, { recursive: true })
  const target = resolveConfig({ dshHome: targetHome, profiles: 'all', workspace: 'all', localDir: join(targetHome, 'backups') }, { cwd: root })
  const restored = await restoreArchive({ config: target, cwd: root, archive: backup.local.path, yes: true, conflict: 'overwrite', safetyBackup: false, logger: quiet() })
  assert.equal(restored.ok, true)
  assert.equal(restored.workspaceDirs.created.includes(workspace), true)
  assert.equal((await stat(workspace)).isDirectory(), true)
  assert.equal(restored.credentialWarning.includes('凭据'), true)
})

test('WebDAV upload, list, download and restore', async () => {
  const { home, workspace } = await fixture('webdav')
  const store = new Map()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'MKCOL') {
      res.writeHead(store.has(url.pathname) ? 405 : 201)
      res.end()
      return
    }
    if (req.method === 'PUT') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      store.set(url.pathname, Buffer.concat(chunks))
      res.writeHead(201)
      res.end()
      return
    }
    if (req.method === 'MOVE') {
      const from = url.pathname
      const destination = new URL(req.headers.destination, 'http://127.0.0.1').pathname
      if (!store.has(from)) { res.writeHead(404); res.end(); return }
      store.set(destination, store.get(from))
      store.delete(from)
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'PROPFIND') {
      const prefix = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
      const items = [`<d:response><d:href>${prefix}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`]
      for (const [name, body] of store) {
        if (!name.startsWith(prefix) || name === prefix) continue
        const rest = name.slice(prefix.length)
        if (rest.includes('/')) continue
        items.push(`<d:response><d:href>${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${body.length}</d:getcontentlength><d:getlastmodified>${new Date().toUTCString()}</d:getlastmodified></d:prop></d:propstat></d:response>`)
      }
      res.writeHead(207, { 'Content-Type': 'application/xml' })
      res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`)
      return
    }
    if (req.method === 'HEAD') {
      const body = store.get(url.pathname)
      if (!body) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end()
      return
    }
    if (req.method === 'GET') {
      const body = store.get(url.pathname)
      if (!body) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end(body)
      return
    }
    if (req.method === 'DELETE') {
      store.delete(url.pathname)
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(405)
    res.end()
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  try {
    const config = resolveConfig({
      dshHome: home,
      profiles: ['web'],
      workspace: 'all',
      localDir: join(home, 'backups'),
      includeCredentials: false,
      webdav: { url: `http://127.0.0.1:${port}/dav/`, remoteDir: 'backups', auth: 'none', retries: 2 },
    }, { cwd: workspace })
    const backup = await createBackup({ config, cwd: workspace, destination: 'webdav', prune: false, logger: quiet() })
    assert.equal(backup.remote.bytes, backup.size)
    const remote = await listRemoteArchives(config, quiet())
    assert.equal(remote.length, 1)
    assert.equal(remote[0].name, backup.archiveName)

    const targetHome = join(root, 'webdav-target')
    await mkdir(targetHome, { recursive: true })
    const target = resolveConfig({ dshHome: targetHome, profiles: ['web'], workspace: 'all', localDir: join(targetHome, 'backups'), webdav: { url: `http://127.0.0.1:${port}/dav/`, remoteDir: 'backups', auth: 'none' } }, { cwd: workspace })
    const restored = await restoreArchive({ config: target, cwd: workspace, archive: 'latest', source: 'webdav', yes: true, conflict: 'overwrite', safetyBackup: false, logger: quiet() })
    assert.equal(restored.ok, true)
    assert.equal((await readFile(join(targetHome, 'settings.yaml'), 'utf8')).includes('deepseek-official'), true)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

function quiet() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
}
