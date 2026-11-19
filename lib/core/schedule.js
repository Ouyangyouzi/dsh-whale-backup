import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './fsutil.js'

/** Default automatic backup plan. Disabled until the user turns it on. */
export const DEFAULT_SCHEDULE = Object.freeze({
  enabled: false,
  kind: 'daily',
  time: '20:00',
  days: 3,
  weekday: 0,
  dayOfMonth: 1,
  hours: 24,
  destination: 'local',
})

/** Read and validate a schedule fragment. */
export function normalizeSchedule(value) {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const kind = ['daily', 'every-n-days', 'weekly', 'weekdays', 'weekends', 'monthly', 'every-hours'].includes(source.kind) ? source.kind : 'daily'
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.time ?? '')) ? String(source.time) : '20:00'
  return {
    enabled: source.enabled === true,
    kind,
    time,
    days: clampInt(source.days, 1, 365, 3),
    weekday: clampInt(source.weekday, 0, 6, 0),
    dayOfMonth: clampInt(source.dayOfMonth, 1, 31, 1),
    hours: clampInt(source.hours, 1, 24 * 30, 24),
    destination: ['local', 'webdav', 'both'].includes(source.destination) ? source.destination : 'local',
    workspaceMode: ['all', 'auto', 'custom'].includes(source.workspaceMode) ? source.workspaceMode : 'all',
    workspacePaths: normalizeStringArray(source.workspacePaths).slice(0, 100),
    includeWorkspaceFiles: source.includeWorkspaceFiles === true,
    sessionMode: ['all', 'recent', 'selected'].includes(source.sessionMode) ? source.sessionMode : 'all',
    sessionCount: clampInt(source.sessionCount, 1, 1000, 10),
    sessionIds: normalizeStringArray(source.sessionIds).slice(0, 1000),
    // Retention override for auto backups. `0` means "use the settings page
    // values (keepLocal/keepWebdav)"; a positive number keeps at most that
    // many auto backups, deleting older ones after each run.
    keepAuto: clampInt(source.keepAuto, 0, 999, 0),
    keepLocal: clampInt(source.keepLocal, 0, 999, 0),
    keepWebdav: clampInt(source.keepWebdav, 0, 999, 0),
  }
}

/** Human-readable plan name for logs and UI. */
export function describeSchedule(schedule) {
  const s = normalizeSchedule(schedule)
  if (!s.enabled) return '未开启'
  if (s.kind === 'daily') return `每天 ${s.time}`
  if (s.kind === 'every-n-days') return `每 ${s.days} 天 ${s.time}`
  if (s.kind === 'weekly') return `每周${'日一二三四五六'[s.weekday]} ${s.time}`
  if (s.kind === 'weekdays') return `工作日 ${s.time}`
  if (s.kind === 'weekends') return `节假日 ${s.time}`
  if (s.kind === 'monthly') return `每月 ${s.dayOfMonth} 号 ${s.time}`
  return `每 ${s.hours} 小时`
}

/** Fingerprint used to detect a plan change and recompute the next run. */
export function scheduleKey(schedule) {
  return JSON.stringify(normalizeSchedule(schedule))
}

/** State file next to the plugin settings. */
export function scheduleStatePath(dshHome) {
  return join(dshHome, 'dsh-whale-schedule.json')
}

/** Read persisted scheduler state. */
export async function readScheduleState(dshHome) {
  try {
    const text = await readFile(scheduleStatePath(dshHome), 'utf8')
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** Persist scheduler state atomically. */
export async function writeScheduleState(dshHome, state) {
  await atomicWriteFile(scheduleStatePath(dshHome), `${JSON.stringify(state, null, 2)}\n`, 0o600)
}

/**
 * Compute the next run strictly after `now`.
 * @param {object} schedule
 * @param {Date} now
 * @param {number|string|undefined} lastRunAt
 */
export function computeNextRun(schedule, now = new Date(), lastRunAt) {
  const s = normalizeSchedule(schedule)
  if (!s.enabled) return undefined
  const base = new Date(now)
  if (s.kind === 'every-hours') {
    const anchor = lastRunAt ? new Date(lastRunAt) : base
    return new Date(Math.max(base.getTime(), anchor.getTime() + s.hours * 3600_000))
  }
  const [hour, minute] = s.time.split(':').map(Number)
  if (s.kind === 'every-n-days') {
    const anchor = lastRunAt ? new Date(lastRunAt) : null
    if (anchor && anchor.getTime() > base.getTime() - 24 * 3600_000) {
      const candidate = new Date(anchor)
      candidate.setDate(candidate.getDate() + s.days)
      candidate.setHours(hour, minute, 0, 0)
      if (candidate > base) return candidate
    }
    const candidate = nextDaily(base, hour, minute)
    if (!anchor) return candidate
    const intervalCandidate = new Date(anchor)
    intervalCandidate.setDate(intervalCandidate.getDate() + s.days)
    intervalCandidate.setHours(hour, minute, 0, 0)
    return intervalCandidate > base ? intervalCandidate : nextDaily(base, hour, minute)
  }
  if (s.kind === 'weekly') {
    const candidate = new Date(base)
    candidate.setHours(hour, minute, 0, 0)
    let delta = (s.weekday - candidate.getDay() + 7) % 7
    if (delta === 0 && candidate <= base) delta = 7
    candidate.setDate(candidate.getDate() + delta)
    return candidate
  }
  if (s.kind === 'weekdays') {
    const candidate = new Date(base)
    candidate.setHours(hour, minute, 0, 0)
    for (let i = 0; i < 8; i += 1) {
      const day = candidate.getDay()
      if (day >= 1 && day <= 5 && candidate > base) return candidate
      candidate.setDate(candidate.getDate() + 1)
    }
    return candidate
  }
  if (s.kind === 'weekends') {
    const candidate = new Date(base)
    candidate.setHours(hour, minute, 0, 0)
    for (let i = 0; i < 8; i += 1) {
      const day = candidate.getDay()
      if ((day === 0 || day === 6) && candidate > base) return candidate
      candidate.setDate(candidate.getDate() + 1)
    }
    return candidate
  }
  if (s.kind === 'monthly') {
    let year = base.getFullYear()
    let month = base.getMonth()
    for (let i = 0; i < 24; i += 1) {
      const candidate = new Date(year, month, Math.min(s.dayOfMonth, daysInMonth(year, month)), hour, minute, 0, 0)
      if (candidate > base) return candidate
      month += 1
      if (month > 11) {
        month = 0
        year += 1
      }
    }
  }
  return nextDaily(base, hour, minute)
}

/** Whether a state is due now. */
export function isDue(schedule, state, now = new Date()) {
  const s = normalizeSchedule(schedule)
  if (!s.enabled) return false
  if (state.nextRunAt === undefined) return false
  const next = new Date(state.nextRunAt)
  return Number.isFinite(next.getTime()) && now >= next
}

/** Compute the state after a run. */
export function stateAfterRun(schedule, now = new Date()) {
  return {
    lastRunAt: now.toISOString(),
    nextRunAt: computeNextRun(schedule, now, now.toISOString())?.toISOString(),
    scheduleKey: scheduleKey(schedule),
  }
}

/** Build a state for a newly enabled/changed plan. */
export function stateForPlan(schedule, now = new Date(), previous = {}) {
  const s = normalizeSchedule(schedule)
  if (!s.enabled) return { ...previous, scheduleKey: scheduleKey(s), nextRunAt: undefined }
  const key = scheduleKey(s)
  if (previous.scheduleKey === key && previous.nextRunAt) return previous
  return {
    ...previous,
    scheduleKey: key,
    nextRunAt: computeNextRun(s, now, previous.lastRunAt)?.toISOString(),
  }
}

function nextDaily(base, hour, minute) {
  const candidate = new Date(base)
  candidate.setHours(hour, minute, 0, 0)
  if (candidate <= base) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split('\n').map((item) => item.trim()).filter(Boolean)
  return []
}

/**
 * Small in-process scheduler. It wakes up periodically and runs one backup
 * when the stored `nextRunAt` has passed, then records the run so the UI can
 * show "last backup" and "next backup".
 *
 * @param {{
 *   getConfig: () => Record<string, any>,
 *   runBackup: (config: Record<string, any>, schedule: Record<string, any>) => Promise<any>,
 *   logger?: { info?: Function, warn?: Function },
 *   intervalMs?: number,
 *   now?: () => Date,
 * }} options
 */
export function createScheduler({ getConfig, runBackup, logger, intervalMs = 60_000, now = () => new Date() }) {
  let timer
  let tickTimer
  let state = {}
  let stateHome
  let running = false
  let stopped = false

  const currentSchedule = () => normalizeSchedule(getConfig().schedule)

  const load = async (dshHome) => {
    if (stateHome === dshHome) return
    state = await readScheduleState(dshHome)
    stateHome = dshHome
  }

  const persist = async (dshHome) => {
    try {
      await writeScheduleState(dshHome, state)
    } catch (error) {
      logger?.warn?.(`[easy-backup] could not save schedule state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const view = () => {
    const schedule = currentSchedule()
    return {
      schedule,
      description: describeSchedule(schedule),
      nextRunAt: schedule.enabled ? state.nextRunAt : undefined,
      lastRunAt: state.lastRunAt,
      lastResult: state.lastResult,
      lastError: state.lastError,
    }
  }

  const sync = async () => {
    const config = getConfig()
    await load(config.dshHome)
    state = stateForPlan(currentSchedule(), now(), state)
    await persist(config.dshHome)
    return view()
  }

  const tick = async () => {
    if (stopped || running) return
    const config = getConfig()
    const schedule = currentSchedule()
    if (!schedule.enabled) return
    await load(config.dshHome)
    if (!state.nextRunAt) {
      await sync()
      return
    }
    const next = new Date(state.nextRunAt)
    if (!Number.isFinite(next.getTime()) || now().getTime() < next.getTime()) return
    running = true
    try {
      const result = await runBackup(config, schedule)
      const at = now()
      state = {
        ...stateAfterRun(schedule, at),
        lastResult: {
          at: at.toISOString(),
          name: result?.archiveName,
          size: result?.sizeLabel,
          destination: schedule.destination,
        },
        lastError: undefined,
      }
      logger?.info?.(`[easy-backup] scheduled backup finished: ${result?.archiveName ?? '(unknown)'}`)
    } catch (error) {
      const at = now()
      state = {
        ...state,
        lastRunAt: at.toISOString(),
        nextRunAt: computeNextRun(schedule, at)?.toISOString(),
        scheduleKey: scheduleKey(schedule),
        lastResult: undefined,
        lastError: { at: at.toISOString(), message: error instanceof Error ? error.message : String(error) },
      }
      logger?.warn?.(`[easy-backup] scheduled backup failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await persist(config.dshHome)
      running = false
    }
  }

  return {
    start() {
      stopped = false
      void sync().catch(() => undefined)
      void tick().catch(() => undefined)
      timer = setInterval(() => { void tick().catch(() => undefined) }, Math.max(1000, intervalMs))
      timer?.unref?.()
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      if (tickTimer !== undefined) clearTimeout(tickTimer)
      timer = undefined
      tickTimer = undefined
    },
    sync,
    view,
    tick,
  }
}

