import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createHttpApi } from '../lib/core/http.js'

const root = join(tmpdir(), `dsh-whale-compliance-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

test('manifest declares the DSH plugin contract and market metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.name, 'dsh-whale')
  assert.ok(pkg.engines?.dsh, 'engines.dsh is required for installation checks')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.exports['./assets/*'], './lib/assets/*')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.match(pkg.icon, /whale-girl\.png$/)
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'))
  assert.ok(en.meta.title)
  assert.ok(en.meta.description)
})

test('the client bundle loads the icon through the official asset API', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /require\.asset\('plugins\/dsh-whale\/assets\/whale-girl\.png'\)/)
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
})

test('web API rejects requests refused by the connection service', async () => {
  const home = join(root, 'auth-home')
  await mkdir(home, { recursive: true })
  const config = resolveConfig({ dshHome: home })
  const api = createHttpApi({
    config,
    connection: { requestRejection: () => 401 },
    logger: quiet(),
  })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(`${base}/dsh-backup-api/status`)
    assert.equal(response.status, 401)
    const data = await response.json()
    assert.equal(data.error.code, 'UNAUTHORIZED')
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})

test('WebDAV secrets go through the credential service instead of the overlay', async () => {
  const home = join(root, 'cred-home')
  await mkdir(home, { recursive: true })
  let current = resolveConfig({ dshHome: home })
  const stored = new Map()
  const credentials = {
    async resolve(ref) {
      return stored.has(ref) ? { value: stored.get(ref), source: 'test' } : undefined
    },
    async describe(ref) {
      return { configured: stored.has(ref), writable: true }
    },
    async set(ref, value) {
      stored.set(ref, value)
    },
    async unset(ref) {
      stored.delete(ref)
    },
  }
  const api = createHttpApi({
    config: () => current,
    baseConfig: () => ({}),
    setConfig: (next) => { current = next },
    credentials,
    logger: quiet(),
  })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(`${base}/dsh-backup-api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: {
          webdav: { url: 'https://dav.example.com', username: 'me', password: 's3cret' },
        },
      }),
    })
    assert.equal(response.status, 200)
    assert.equal(stored.get('DSH_BACKUP_WEBDAV_PASSWORD'), 's3cret')

    const overlay = JSON.parse(await readFile(join(home, 'dsh-backup.config.json'), 'utf8'))
    assert.equal(overlay.webdav?.url, 'https://dav.example.com')
    assert.equal(overlay.webdav?.password, undefined, 'plaintext password must not be persisted')

    const storedConfig = await (await fetch(`${base}/dsh-backup-api/config`)).json()
    assert.equal(storedConfig.config.webdav.password, '<set>')
    assert.equal(storedConfig.overlay.webdav?.password || '', '')

    await fetch(`${base}/dsh-backup-api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { webdav: { url: 'https://dav.example.com' } }, clearPassword: true }),
    })
    assert.equal(stored.has('DSH_BACKUP_WEBDAV_PASSWORD'), false)
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})
