import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConfig } from '../lib/core/config.js'
import { createHttpApi } from '../lib/core/http.js'
import { computeNextRun, createScheduler, describeSchedule, normalizeSchedule } from '../lib/core/schedule.js'

const root = join(tmpdir(), `dsh-schedule-${process.pid}-${Date.now()}`)
test.after(async () => { await rm(root, { recursive: true, force: true }) })

function quiet() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

test('schedule normalizes values and describes plans', () => {
  const value = normalizeSchedule({ enabled: true, kind: 'weekly', weekday: 3, time: '07:30', days: 999 })
  assert.equal(value.enabled, true)
  assert.equal(value.weekday, 3)
  assert.equal(value.days, 365)
  assert.equal(value.time, '07:30')
  assert.match(describeSchedule(value), /每周三/)
  assert.equal(describeSchedule({ enabled: false }), '未开启')
  assert.equal(normalizeSchedule({ kind: 'nope', time: '99:99' }).kind, 'daily')
  assert.equal(normalizeSchedule({ time: '99:99' }).time, '20:00')
})

test('computeNextRun picks the next local occurrence', () => {
  const now = new Date(2026, 0, 1, 12, 0, 0)
  const daily = computeNextRun({ enabled: true, kind: 'daily', time: '20:00' }, now)
  assert.equal(daily.getHours(), 20)
  assert.ok(daily > now)
  const weekly = computeNextRun({ enabled: true, kind: 'weekly', weekday: 3, time: '20:00' }, now)
  assert.equal(weekly.getDay(), 3)
  assert.ok(weekly > now)
  const monthly = computeNextRun({ enabled: true, kind: 'monthly', dayOfMonth: 15, time: '08:00' }, now)
  assert.equal(monthly.getDate(), 15)
  assert.equal(monthly.getHours(), 8)
  assert.equal(computeNextRun({ enabled: false }), undefined)
})

test('scheduler runs a due backup once and records the result', async () => {
  const home = join(root, 'scheduler-home')
  await mkdir(home, { recursive: true })
  let clock = new Date(2026, 0, 1, 19, 59, 0)
  const calls = []
  const config = { dshHome: home, schedule: { enabled: true, kind: 'daily', time: '20:00', destination: 'both' } }
  const scheduler = createScheduler({
    getConfig: () => config,
    runBackup: async (_config, schedule) => {
      calls.push(schedule.destination)
      return { archiveName: 'auto-20260101.tar.zst', sizeLabel: '1 KiB' }
    },
    logger: quiet(),
    now: () => clock,
  })
  try {
    await scheduler.sync()
    const before = scheduler.view()
    assert.ok(before.nextRunAt)
    assert.equal(before.lastResult, undefined)

    await scheduler.tick()
    assert.equal(calls.length, 0)

    clock = new Date(2026, 0, 1, 20, 0, 30)
    await scheduler.tick()
    assert.deepEqual(calls, ['both'])
    const after = scheduler.view()
    assert.equal(after.lastResult.name, 'auto-20260101.tar.zst')
    assert.ok(new Date(after.lastRunAt).getTime() <= clock.getTime())
    assert.ok(new Date(after.nextRunAt) > clock)

    await scheduler.tick()
    assert.equal(calls.length, 1, 'a finished run must not repeat')
  } finally {
    scheduler.stop()
  }
})

test('web API reads and saves the schedule', async () => {
  const home = join(root, 'http-home')
  await mkdir(home, { recursive: true })
  let current = resolveConfig({ dshHome: home })
  const syncCalls = []
  const scheduler = {
    view: () => ({ schedule: current.schedule, description: '测试', nextRunAt: '2026-01-01T12:00:00.000Z' }),
    sync: async () => {
      syncCalls.push(current.schedule)
      return scheduler.view()
    },
  }
  const api = createHttpApi({
    config: () => current,
    baseConfig: () => ({}),
    setConfig: (next) => { current = next },
    scheduler,
    logger: quiet(),
  })
  const server = createServer((req, res) => { void api.handler(req, res) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    let response = await fetch(`${base}/dsh-backup-api/schedule`)
    assert.equal(response.status, 200)
    let data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.schedule.enabled, false)

    response = await fetch(`${base}/dsh-backup-api/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: { enabled: true, kind: 'daily', time: '07:00', destination: 'local' } }),
    })
    assert.equal(response.status, 200)
    data = await response.json()
    assert.equal(data.schedule.enabled, true)
    assert.equal(data.schedule.time, '07:00')
    assert.equal(data.schedule.destination, 'local')
    assert.equal(syncCalls.length, 1)

    const overlay = JSON.parse(await readFile(join(home, 'dsh-backup.config.json'), 'utf8'))
    assert.equal(overlay.schedule.enabled, true)
    assert.equal(overlay.schedule.time, '07:00')
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})
