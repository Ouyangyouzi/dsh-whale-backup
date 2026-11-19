import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, rm, writeFile, utimes, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createBackup } from '../lib/core/backup.js'
import { listArchiveContents, restoreArchive } from '../lib/core/restore.js'
import { createHttpApi } from '../lib/core/http.js'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-whale-scope-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

async function makeHome() {
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(join(home, 'sessions', projectKey(workspace), 'session-a'), { recursive: true })
  await mkdir(join(home, 'sessions', projectKey(workspace), 'session-b'), { recursive: true })
  await mkdir(join(home, 'sessions', projectKey(workspace), 'session-c'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  const header = (id) => JSON.stringify({ type: 'session', version: 4, id, createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })
  for (const id of ['session-a', 'session-b', 'session-c']) {
    await writeFile(join(home, 'sessions', projectKey(workspace), id, 'session.v4.jsonl'), `${header(id)}\n`)
  }
  const now = Date.now() / 1000
  await utimes(join(home, 'sessions', projectKey(workspace), 'session-a', 'session.v4.jsonl'), now - 3600, now - 3600)
  await utimes(join(home, 'sessions', projectKey(workspace), 'session-b', 'session.v4.jsonl'), now - 1800, now - 1800)
  await utimes(join(home, 'sessions', projectKey(workspace), 'session-c', 'session.v4.jsonl'), now - 60, now - 60)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')
  return { home, workspace }
}

test('manual scope supports recent and selected sessions', async () => {
  const { home, workspace } = await makeHome()
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })

  const recent = await createBackup({ config, cwd: workspace, destination: 'local', recentSessions: 1, logger: quiet() })
  assert.equal(recent.summary.sessions, 1)
  assert.equal(recent.summary.sessionFiles, 1)

  const selected = await createBackup({ config, cwd: workspace, destination: 'local', sessionIds: ['session-a'], logger: quiet() })
  assert.equal(selected.summary.sessions, 1)
})

test('the sessions endpoint lists workspaces for the picker', async () => {
  const { home, workspace } = await makeHome()
  const { createZstdCompress } = await import('node:zlib')
  const { pipeline } = await import('node:stream/promises')
  const { createReadStream, createWriteStream } = await import('node:fs')
  const plain = join(home, 'sessions', projectKey(workspace), 'session-c', 'session.v4.jsonl')
  const compressed = `${plain}.zstd`
  await pipeline(createReadStream(plain), createZstdCompress(), createWriteStream(compressed))
  await rm(plain)
  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all' })
  const api = createHttpApi({ config, logger: quiet() })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(`${base}/dsh-backup-api/sessions`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.sessions.length, 3)
    assert.ok(data.sessions.every((session) => session.workspace === workspace), 'compressed sessions still expose their workspace')
    assert.ok(data.sessions.every((session) => session.id && session.files === 1))
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('archive contents drive selective restore of sessions', async () => {
  const { home, workspace } = await makeHome()
  await writeFile(join(workspace, 'notes.txt'), 'hello\n')
  const config = resolveConfig({
    dshHome: home,
    profiles: ['web'],
    workspace: 'all',
    localDir: join(home, 'backups'),
    includeWorkspaceFiles: true,
  }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', logger: quiet() })

  const contents = await listArchiveContents(config, backup.local.path)
  assert.equal(contents.sessions.length, 3)
  assert.equal(contents.workspaces.length, 1)
  assert.equal(contents.workspaces[0].path, workspace)

  const target = join(root, 'restore-target')
  await mkdir(target, { recursive: true })
  const targetConfig = resolveConfig({
    dshHome: target,
    profiles: ['web'],
    workspace: 'all',
    restore: { autoInstallPlugins: false },
  }, { cwd: workspace })
  await restoreArchive({
    config: targetConfig,
    cwd: workspace,
    archive: backup.local.path,
    source: 'local',
    categories: ['sessions'],
    restoreSessionIds: ['session-a'],
    yes: true,
    conflict: 'overwrite',
    safetyBackup: false,
    logger: quiet(),
  })
  const restoredDir = join(target, 'sessions', projectKey(workspace))
  const rest = await readdir(restoredDir).catch(() => [])
  assert.deepEqual(rest.sort(), ['session-a'])
})

test('notification mail settings normalize and validate', () => {  const config = resolveConfig({
    dshHome: join(root, 'notify-home'),
    notifyEmail: { to: 'me@example.com', smtpHost: 'smtp.example.com', username: 'me@example.com', password: 'secret', retries: 99 },
  })
  assert.equal(config.notifyEmail.to, 'me@example.com')
  assert.equal(config.notifyEmail.smtpPort, 587)
  assert.equal(config.notifyEmail.retries, 10)
  assert.equal(config.notifyEmail.password, 'secret')
  assert.throws(() => resolveConfig({ dshHome: join(root, 'notify-home'), notifyEmail: { to: 'not-an-email' } }), /通知邮箱地址无效/)
})
