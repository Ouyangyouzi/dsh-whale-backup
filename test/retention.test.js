import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig, deepMerge } from '../lib/core/config.js'
import { createBackup, pruneLocalArchives } from '../lib/core/backup.js'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `wgb-retention-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

test('scheduled retention only prunes auto-labelled archives', async () => {
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-keep')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-keep', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')

  const config = resolveConfig({ dshHome: home, profiles: ['web'], workspace: 'all', localDir: join(home, 'backups') }, { cwd: workspace })
  const manualNames = []
  for (const label of ['manual-a', 'manual-b']) {
    const run = await createBackup({ config, cwd: workspace, destination: 'local', label, logger: quiet() })
    manualNames.push(run.local.name)
  }
  const autoNames = []
  for (let i = 0; i < 4; i += 1) {
    const run = await createBackup({ config, cwd: workspace, destination: 'local', label: `auto-0${i + 1}`, logger: quiet() })
    autoNames.push(run.local.name)
  }

  const names = (await readdir(join(home, 'backups'))).filter((name) => name.endsWith('.tar.zst'))
  assert.equal(names.length, 6)

  // Simulate the schedule limit: keep at most 2 auto archives.
  const limited = resolveConfig(deepMerge(config, { schedule: { keepAuto: 2 } }), { cwd: workspace })
  const removed = await pruneLocalArchives(limited, limited.keepLocal, [], quiet())
  assert.equal(removed.length, 2, 'two oldest auto archives are removed')
  assert.ok(removed.every((name) => /-auto/.test(name)), 'only auto archives are pruned')
  assert.ok(manualNames.every((name) => !removed.includes(name)), 'manual backups survive')

  const remaining = (await readdir(join(home, 'backups'))).filter((name) => name.endsWith('.tar.zst'))
  assert.equal(remaining.length, 4)
  for (const name of manualNames) assert.ok(remaining.includes(name))
})
