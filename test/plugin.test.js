import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../lib/index.js'

test('plugin disposes the dynamic webServer injection on unload', async () => {
  let disposed = false
  const cleanups = []
  const ctx = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    commands: { register: () => () => undefined },
    tools: { register: () => () => undefined },
    sessions: { list: () => [], flush: async () => undefined },
    inject(_deps, _callback) {
      return { dispose: () => { disposed = true } }
    },
    effect(fn) {
      const cleanup = fn()
      cleanups.push(cleanup)
      return cleanup
    },
  }
  apply(ctx, { dshHome: join(tmpdir(), 'dsh-backup-unload'), profiles: 'all' })
  for (const cleanup of cleanups) {
    if (typeof cleanup === 'function') cleanup()
  }
  assert.equal(disposed, true)
})

test('plugin registers /easybackup and model tools, then runs status', async (t) => {
  const root = join(tmpdir(), `dsh-backup-plugin-${process.pid}-${Date.now()}`)
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await mkdir(join(home, 'sessions'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n')

  const commands = []
  const tools = []
  const effects = []
  const logs = []
  const ctx = {
    logger: {
      info: (m) => logs.push(`info:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      error: (m) => logs.push(`error:${m}`),
      debug: () => undefined,
    },
    commands: {
      register(definition) {
        commands.push(definition)
        return () => undefined
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => undefined
      },
    },
    sessions: {
      list: () => [],
      flush: async () => undefined,
    },
    effect(fn) {
      const cleanup = fn()
      effects.push(cleanup)
      return cleanup
    },
  }

  apply(ctx, {
    dshHome: home,
    profiles: ['web'],
    workspace: 'all',
    localDir: join(home, 'backups'),
  })

  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'easybackup')
  assert.ok(commands[0].description.length > 0)
  assert.equal(tools.length, 5)
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'dsh_backup_create',
    'dsh_backup_list',
    'dsh_backup_restore',
    'dsh_backup_status',
    'dsh_backup_verify',
  ])
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
  }

  const agent = { session: { header: { cwd: workspace } } }
  const result = await commands[0].handler({ agent, rawInput: 'status', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /DSH_HOME:/)
  assert.match(result.text, /Local backups:/)

  const backupTool = tools.find((tool) => tool.name === 'dsh_backup_create')
  const backupText = await backupTool.execute({ destination: 'local', label: 'unit' }, { agent, signal: new AbortController().signal })
  const parsed = JSON.parse(backupText)
  assert.equal(parsed.ok, true)
  assert.ok(parsed.local.path.endsWith('.tar.zst'))

  const listTool = tools.find((tool) => tool.name === 'dsh_backup_list')
  const list = JSON.parse(await listTool.execute({ source: 'local' }, { agent, signal: new AbortController().signal }))
  assert.equal(list.archives.length, 1)

  const restoreTool = tools.find((tool) => tool.name === 'dsh_backup_restore')
  const refused = await restoreTool.execute({ archive: 'latest', confirm: false }, { agent, signal: new AbortController().signal })
  assert.match(refused, /confirm=true/)

  for (const cleanup of effects) cleanup()
})
