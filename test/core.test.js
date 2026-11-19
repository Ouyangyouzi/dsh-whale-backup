import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createBackup, listLocalArchives } from '../lib/core/backup.js'
import { restoreArchive, verifyArchive } from '../lib/core/restore.js'
import { BackupError, ERROR_CODES } from '../lib/core/errors.js'
import { projectKey, validateSessionLog } from '../lib/core/sessions.js'

const root = join(tmpdir(), `dsh-backup-test-${process.pid}-${Date.now()}`)

test('backup, verify and restore a workspace with plugins and credentials', async (t) => {
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const home2 = join(root, 'home2')
  const workspace = join(root, 'workspace')
  const profile = join(home, 'profiles', 'web')
  const sessionDir = join(home, 'sessions', projectKey(workspace), 'session-abc')
  const localPlugin = join(home, 'local-demo')
  await mkdir(sessionDir, { recursive: true })
  await mkdir(join(profile, 'node_modules', 'fake-plugin'), { recursive: true })
  await mkdir(join(home, 'storages', 'demo'), { recursive: true })
  await mkdir(join(home, 'workbuddy-vault'), { recursive: true })
  await mkdir(localPlugin, { recursive: true })
  await mkdir(home2, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'notes.txt'), 'workspace-content\n')

  const header = { type: 'session', version: 4, id: 'session-abc', createdAt: 1700000000000, cwd: workspace, isSeeded: false, delegationDepth: 0 }
  const event = { type: 'user/message', seq: 1, time: 1700000000001, data: { content: [{ type: 'text', text: 'hello' }] } }
  await writeFile(join(sessionDir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n${JSON.stringify(event)}\n`)
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'fake-plugin': '0.56.0', 'local-demo': 'link:../../local-demo' },
    dsh: { profile: { bundles: ['fake-plugin'] } },
  }, null, 2))
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profile, 'node_modules', 'fake-plugin', 'index.js'), "export const name = 'fake-plugin'\n")
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')
  await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-test\n')
  await writeFile(join(home, 'storages', 'demo', 'state.json'), '{"ok":true}\n')
  await writeFile(join(home, 'workbuddy-vault', 'accounts.json'), '{"accounts":[{"id":"demo"}]}\n')
  await writeFile(join(localPlugin, 'package.json'), '{"name":"local-demo","version":"0.0.1"}\n')
  await writeFile(join(localPlugin, 'index.js'), "export const name = 'local-demo'\n")
  await symlink(localPlugin, join(profile, 'node_modules', 'local-demo'), process.platform === 'win32' ? 'junction' : 'dir')

  const config = resolveConfig({
    dshHome: home,
    profiles: ['web'],
    workspace: 'all',
    includeCredentials: true,
    includePluginCode: true,
    includeWorkspaceFiles: true,
    includeStorages: true,
    localDir: join(home, 'backups'),
    compression: 'zstd',
  }, { cwd: workspace })
  const backup = await createBackup({ config, cwd: workspace, destination: 'local', label: 'test', logger: quietLogger() })
  assert.equal(backup.ok, true)
  assert.ok(backup.local?.path)
  assert.ok((await stat(backup.local.path)).size > 0)
  assert.ok((await stat(`${backup.local.path}.sha256`)).size > 0)
  assert.equal(backup.summary.sessions, 1)

  const verified = await verifyArchive(config, backup.local.path)
  assert.equal(verified.ok, true)
  assert.equal(verified.checksumVerified, true)
  assert.equal(verified.summary.sessions, 1)

  const config2 = resolveConfig({ dshHome: home2, profiles: ['web'], workspace: 'all', localDir: join(home2, 'backups') }, { cwd: workspace })
  await assert.rejects(
    () => restoreArchive({
      config: config2,
      cwd: workspace,
      archive: backup.local.path,
      source: 'local',
      yes: true,
      conflict: 'overwrite',
      safetyBackup: false,
      harnessRunning: true,
      logger: quietLogger(),
    }),
    (error) => error instanceof BackupError && error.code === ERROR_CODES.RESTORE_TARGET_LOCKED,
  )
  const restored = await restoreArchive({
    config: config2,
    cwd: workspace,
    archive: backup.local.path,
    source: 'local',
    yes: true,
    conflict: 'overwrite',
    logger: quietLogger(),
  })
  assert.equal(restored.ok, true)
  assert.equal(restored.restored.files >= 5, true)

  const restoredHeader = JSON.parse((await readFile(join(home2, 'sessions', projectKey(workspace), 'session-abc', 'session.v4.jsonl'), 'utf8')).split('\n')[0])
  assert.equal(restoredHeader.id, 'session-abc')
  assert.equal((await readFile(join(home2, 'settings.yaml'), 'utf8')).includes('deepseek-official'), true)
  assert.equal((await readFile(join(home2, '.credentials.yaml'), 'utf8')).includes('sk-test'), true)
  assert.equal((await readFile(join(home2, 'workbuddy-vault', 'accounts.json'), 'utf8')).includes('demo'), true)
  assert.equal((await readFile(join(workspace, 'notes.txt'), 'utf8')), 'workspace-content\n')
  assert.equal((await readFile(join(home2, 'profiles', 'web', 'node_modules', 'fake-plugin', 'index.js'), 'utf8')).includes('fake-plugin'), true)
  const rewritten = JSON.parse(await readFile(join(home2, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.match(rewritten.dependencies['local-demo'], /^link:/)
  assert.equal(await exists(join(home2, '.dsh-backup', 'local-plugins', 'web', 'local-demo', 'index.js')), true)
  assert.equal(await exists(join(home2, 'profiles', 'web', 'node_modules', 'local-demo')), true)

  const archives = await listLocalArchives(config)
  assert.equal(archives.length, 1)
  assert.equal(archives[0].name, backup.local.name)
})

test('torn session logs are rejected', async (t) => {
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const path = join(root, 'torn', 'session.v4.jsonl')
  await mkdir(join(root, 'torn'), { recursive: true })
  const header = { type: 'session', version: 4, id: 'session-torn', createdAt: 1700000000000, isSeeded: false, delegationDepth: 0 }
  await writeFile(path, `${JSON.stringify(header)}\n{"type":"user/message"`)
  await assert.rejects(() => validateSessionLog(path), (error) => error.code === 'ARCHIVE_CORRUPT')
})

function quietLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
