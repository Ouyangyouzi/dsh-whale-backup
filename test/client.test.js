import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('package declares a web client half and the bundle registers a settings section', async () => {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')

  const source = await readFile(clientPath, 'utf8')
  assert.match(source, /settings\.section/)
  assert.match(source, /dsh-whale-backup/)

  let loaded
  const fakeReact = {
    createElement: () => null,
    useState: () => [undefined, () => undefined],
    useEffect: () => undefined,
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) { loaded = entry },
      },
    },
    require(name) {
      if (name === 'react') return fakeReact
      throw new Error(`unexpected require ${name}`)
    },
  }
  vm.runInNewContext(source, sandbox, { filename: clientPath })
  assert.equal(loaded.id, 'dsh-whale-backup')
  const client = loaded.factory(sandbox.require)
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual([...client.inject], ['slots'])

  let section
  const ctx = {
    effect(fn) { return fn() },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.section'); callback() },
      register(definition, component) { section = { definition, component } },
    },
  }
  client.apply(ctx)
  assert.equal(section.definition.name, 'settings.section')
  assert.equal(section.definition.id, 'backup')
  assert.equal(section.definition.order, 18)
  assert.equal(section.definition.label(), '鲸鱼娘备份')
  assert.equal(typeof section.component, 'function')
})
