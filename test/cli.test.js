import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { projectKey } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-backup-cli-${process.pid}-${Date.now()}`)
const bin = fileURLToPath(new URL('../bin/dsh-backup.js', import.meta.url))

test.after(async () => { await rm(root, { recursive: true, force: true }) })

test('standalone CLI can backup, list, verify and restore with --dsh-home', async () => {
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  const targetHome = join(root, 'target-home')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-cli')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(targetHome, { recursive: true })
  const header = { type: 'session', version: 4, id: 'session-cli', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 }
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n`)
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}\n')

  const backup = run(['backup', '--dsh-home', home, '--workspace', workspace, '--json'])
  assert.equal(backup.status, 0, backup.stderr)
  const backupData = JSON.parse(backup.stdout)
  assert.equal(backupData.ok, true)

  const list = run(['list', '--dsh-home', home, '--json'])
  assert.equal(list.status, 0, list.stderr)
  assert.equal(JSON.parse(list.stdout).archives.length, 1)

  const verify = run(['verify', 'latest', '--dsh-home', home, '--json'])
  assert.equal(verify.status, 0, verify.stderr)
  assert.equal(JSON.parse(verify.stdout).ok, true)

  const restore = run(['restore', backupData.local.path, '--dsh-home', targetHome, '--source', 'local', '--yes', '--json'])
  assert.equal(restore.status, 0, restore.stderr)
  const restoreData = JSON.parse(restore.stdout)
  assert.equal(restoreData.ok, true)
  assert.equal((await readFile(join(targetHome, 'settings.yaml'), 'utf8')).includes('deepseek-official'), true)
  assert.equal((await readFile(join(targetHome, 'sessions', projectKey(workspace), 'session-cli', 'session.v4.jsonl'), 'utf8')).includes('session-cli'), true)
})

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_BACKUP_WEBDAV_PASSWORD: '' },
    timeout: 120_000,
  })
}
