import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createHttpApi } from '../lib/core/http.js'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-whale-backup-progress-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

test('async backup exposes progress and the mascot icon', async () => {
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-progress')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-progress', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')

  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const api = createHttpApi({ config, logger: quiet(), flushSessions: async () => undefined })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const icon = await fetch(`${base}/dsh-backup-api/icon`)
    assert.equal(icon.status, 200)
    assert.match(icon.headers.get('content-type') || '', /image\/png/)
    assert.ok((await icon.arrayBuffer()).byteLength > 1000)

    const started = await fetch(`${base}/dsh-backup-api/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, destination: 'local', workspace: 'all' }),
    })
    assert.equal(started.status, 202)
    const { job } = await started.json()
    assert.equal(job.status, 'running')

    let final
    let last
    for (let i = 0; i < 300; i += 1) {
      const data = await (await fetch(`${base}/dsh-backup-api/job?id=${encodeURIComponent(job.id)}`)).json()
      assert.equal(data.ok, true)
      last = data.job
      if (data.job.status !== 'running') {
        final = data.job
        break
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    assert.ok(final, `job finished (last=${JSON.stringify(last)})`)
    assert.equal(final.status, 'done')
    assert.equal(final.percent, 100)
    assert.ok(final.result?.result?.archiveName)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})
