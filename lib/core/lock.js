import { open, readFile, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BackupError, ERROR_CODES } from './errors.js'
import { ensureDir } from './fsutil.js'

const STALE_MS = 6 * 60 * 60 * 1000

/**
 * Serialize backup/restore/prune operations per DSH_HOME. A stale lock from a
 * killed process is reclaimed after six hours or when its PID is gone.
 * @param {import('./config.js').defaultConfig extends never ? never : any} config
 * @param {string} operation
 */
export async function acquireOperationLock(config, operation) {
  await ensureDir(config.dshHome)
  const path = join(config.dshHome, '.dsh-backup.lock')
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, operation, token, startedAt: new Date().toISOString() })}\n`)
      await handle.close()
      return {
        path,
        async release() {
          try {
            const text = await readFile(path, 'utf8')
            const parsed = JSON.parse(text)
            if (parsed.token === token) await unlink(path)
          } catch {
            // Already gone or replaced; do not delete another process's lock.
          }
        },
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error
      const stale = await inspectLock(path)
      if (stale.stale) {
        await unlink(path).catch(() => undefined)
        continue
      }
      throw new BackupError(ERROR_CODES.ALREADY_RUNNING, `another DSH backup operation is already running (${stale.operation ?? 'unknown'}, pid ${stale.pid ?? '?'})`, {
        details: { lockPath: path },
        hint: 'Wait for it to finish, or remove the stale lock file if the process is gone.',
      })
    }
  }
  throw new BackupError(ERROR_CODES.ALREADY_RUNNING, `could not acquire ${path}`)
}

async function inspectLock(path) {
  try {
    const st = await stat(path)
    const text = await readFile(path, 'utf8')
    let parsed = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {}
    }
    const age = Date.now() - st.mtimeMs
    const pid = Number(parsed.pid)
    const alive = Number.isSafeInteger(pid) && pid > 0 ? isProcessAlive(pid) : false
    return {
      ...parsed,
      age,
      stale: age > STALE_MS || !alive,
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { stale: true }
    return { stale: false }
  }
}

function isProcessAlive(pid) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && typeof error === 'object' && error.code === 'EPERM')
  }
}

/** Run a callback under the operation lock. */
export async function withOperationLock(config, operation, callback) {
  const lock = await acquireOperationLock(config, operation)
  try {
    return await callback()
  } finally {
    await lock.release()
  }
}
