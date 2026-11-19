import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createBackup } from '../lib/core/backup.js'
import { restoreArchive } from '../lib/core/restore.js'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-selective-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('restore can bring back plugins without sessions, settings or plugin data', async () => {
  const home = join(root, 'home')
  const target = join(root, 'target')
  const workspace = join(root, 'workspace')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-one')
  const profile = join(home, 'profiles', 'web')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(profile, { recursive: true })
  await mkdir(join(home, 'storages', 'demo'), { recursive: true })
  await mkdir(join(home, 'workbuddy-vault'), { recursive: true })
  await mkdir(target, { recursive: true })
  await mkdir(workspace, { recursive: true })

  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify({ type: 'session', version: 4, id: 'session-one', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 })}\n`)
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', dependencies: {} }, null, 2))
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'storages', 'demo', 'state.json'), '{"ok":true}\n')
  await writeFile(join(home, 'workbuddy-vault', 'accounts.json'), '{"accounts":[]}\n')

  const config = resolveConfig({
    dshHome: home,
    profiles: ['web'],
    workspace: 'all',
    localDir: join(home, 'backups'),
  }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', logger: quiet() })

  const targetConfig = resolveConfig({
    dshHome: target,
    profiles: ['web'],
    workspace: 'all',
    localDir: join(target, 'backups'),
    restore: { autoInstallPlugins: false },
  }, { cwd: workspace })
  await restoreArchive({
    config: targetConfig,
    cwd: workspace,
    archive: backup.local.path,
    source: 'local',
    categories: ['plugins'],
    yes: true,
    conflict: 'overwrite',
    safetyBackup: false,
    restoreWorkspaceFiles: false,
    logger: quiet(),
  })

  assert.equal(await exists(join(target, 'profiles', 'web', 'package.json')), true, 'plugins are restored')
  assert.equal(await exists(join(target, 'sessions')), false, 'sessions stay untouched')
  assert.equal(await exists(join(target, 'settings.yaml')), false, 'settings stay untouched')
  assert.equal(await exists(join(target, 'storages')), false, 'plugin storages stay untouched')
  assert.equal(await exists(join(target, 'workbuddy-vault')), false, 'plugin account data stays untouched')
})
