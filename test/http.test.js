import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createHttpApi } from '../lib/core/http.js'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-backup-http-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('web API exposes status, backup, archives, verify, download and plan', async () => {
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-http')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-http', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')

  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const api = createHttpApi({ config, logger: quiet(), flushSessions: async () => undefined })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  try {
    let response = await fetch(`${base}/dsh-backup-api/status`)
    assert.equal(response.status, 200)
    let data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.status.sessions, 1)

    response = await fetch(`${base}/dsh-backup-api/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: 'local', workspace: 'all', label: 'http-test' }),
    })
    assert.equal(response.status, 200)
    data = await response.json()
    assert.equal(data.ok, true)
    assert.ok(data.result.local.path)

    response = await fetch(`${base}/dsh-backup-api/archives?source=local`)
    data = await response.json()
    assert.equal(data.local.length, 1)

    response = await fetch(`${base}/dsh-backup-api/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: data.local[0].name, source: 'local' }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.result.checksumVerified, true)

    response = await fetch(`${base}/dsh-backup-api/download?name=${encodeURIComponent(data.result.name)}`)
    assert.equal(response.status, 200)
    assert.equal((await response.arrayBuffer()).byteLength, data.result.size)

    response = await fetch(`${base}/dsh-backup-api/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: 'latest', source: 'local', dryRun: true }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.ok(data.result.plan)

    response = await fetch(`${base}/dsh-backup-api/config`)
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.config.webdav.password, '')

    response = await fetch(`${base}/dsh-backup-api/status`, { headers: { origin: 'http://evil.example' } })
    assert.equal(response.status, 403)

    response = await fetch(`${base}/dsh-backup-api/prune`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'local', keep: 10, yes: false }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.dryRun, true)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('web API can browse and back up to a user-selected local directory', async () => {
  const home = join(root, 'custom-home')
  const workspace = join(root, 'custom-workspace')
  const customDir = join(root, 'chosen', 'backups')
  await mkdir(join(home, 'sessions', projectKey(workspace), 'session-custom'), { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(join(root, 'chosen'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(home, 'sessions', projectKey(workspace), 'session-custom', 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-custom', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'default-backups') }, { cwd: workspace })
  const api = createHttpApi({ config, logger: quiet() })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  try {
    let response = await fetch(`${base}/dsh-backup-api/browse?path=${encodeURIComponent(workspace)}`)
    let data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.current, workspace)
    assert.ok(Array.isArray(data.roots))

    response = await fetch(`${base}/dsh-backup-api/browse/mkdir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent: join(root, 'chosen'), name: 'backups' }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.path, customDir)

    response = await fetch(`${base}/dsh-backup-api/browse?path=${encodeURIComponent(join(root, 'chosen', 'not-created', 'nested'))}`)
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.current, join(root, 'chosen'))
    assert.ok(data.notice)

    response = await fetch(`${base}/dsh-backup-api/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destination: 'local', workspace: 'all', localDir: customDir, label: 'chosen' }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.result.local.path.startsWith(customDir), true)

    response = await fetch(`${base}/dsh-backup-api/archives?source=local&localDir=${encodeURIComponent(customDir)}`)
    data = await response.json()
    assert.equal(data.local.length, 1)
    assert.equal(data.localDir, customDir)

    response = await fetch(`${base}/dsh-backup-api/download?name=${encodeURIComponent(data.local[0].name)}&localDir=${encodeURIComponent(customDir)}`)
    assert.equal(response.status, 200)

    const archiveName = data.local[0].name
    response = await fetch(`${base}/dsh-backup-api/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: archiveName, source: 'local', localDir: customDir }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    await assert.rejects(() => readFile(join(customDir, archiveName), 'utf8'))

    response = await fetch(`${base}/dsh-backup-api/archives?source=local&localDir=${encodeURIComponent(customDir)}`)
    data = await response.json()
    assert.equal(data.local.length, 0)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('web API saves and resets the interactive configuration overlay', async () => {
  const home = join(root, 'config-home')
  const customDir = join(root, 'config-backups')
  await mkdir(home, { recursive: true })
  const base = resolveConfig({ dshHome: home, localDir: join(home, 'backups') }, { cwd: root })
  let current = base
  const api = createHttpApi({
    config: () => current,
    baseConfig: () => ({ dshHome: home }),
    setConfig: (next) => { current = next },
    logger: quiet(),
  })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    let response = await fetch(`${baseUrl}/dsh-backup-api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: {
          localDir: customDir,
          compression: 'gzip',
          compressionLevel: 6,
          profiles: 'all',
          includeCredentials: true,
          webdav: { remoteDir: 'chosen-dav', password: 'stored-password' },
          restore: { conflict: 'skip' },
        },
      }),
    })
    let data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.config.localDir, customDir)
    assert.equal(data.config.compression, 'gzip')
    assert.equal(current.localDir, customDir)
    assert.equal(data.config.webdav.password, '<set>')
    const overlay = JSON.parse(await readFile(join(home, 'dsh-backup.config.json'), 'utf8'))
    assert.equal(overlay.webdav.password, 'stored-password')
    assert.equal(overlay.webdav.remoteDir, 'chosen-dav')

    // Saving the redacted form again keeps the stored password.
    response = await fetch(`${baseUrl}/dsh-backup-api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { ...data.config, localDir: customDir } }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    const overlay2 = JSON.parse(await readFile(join(home, 'dsh-backup.config.json'), 'utf8'))
    assert.equal(overlay2.webdav.password, 'stored-password')

    response = await fetch(`${baseUrl}/dsh-backup-api/config`)
    data = await response.json()
    assert.equal(data.config.localDir, customDir)

    response = await fetch(`${baseUrl}/dsh-backup-api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
    data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.config.localDir, join(home, 'backups'))
    await assert.rejects(() => readFile(join(home, 'dsh-backup.config.json'), 'utf8'))
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('web API rejects missing archive and traversal download names', async () => {
  const home = join(root, 'empty')
  await mkdir(home, { recursive: true })
  const config = resolveConfig({ dshHome: home }, { cwd: root })
  const api = createHttpApi({ config, logger: quiet() })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  try {
    let response = await fetch(`http://127.0.0.1:${port}/dsh-backup-api/download?name=..%2Fsecret.tar.zst`)
    assert.equal(response.status, 400)
    response = await fetch(`http://127.0.0.1:${port}/dsh-backup-api/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: 'missing.tar.zst', source: 'local' }),
    })
    assert.equal(response.status, 404)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

function quiet() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
}
