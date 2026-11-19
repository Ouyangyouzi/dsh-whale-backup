import { readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { BackupError, ERROR_CODES } from './errors.js'
import { atomicWriteFile, copyTree, ensureDir, isWithin, pathExists, symlinkSafe, toPosix } from './fsutil.js'

/** Validate that DSH_HOME exists and is a directory. */
export async function assertDshHome(config) {
  const st = await stat(config.dshHome).catch(() => null)
  if (!st || !st.isDirectory()) {
    throw new BackupError(ERROR_CODES.DSH_HOME_MISSING, `DSH home is not a directory: ${config.dshHome}`, {
      hint: 'Set DSH_HOME, or pass --dsh-home <path>, to the directory that contains sessions/ and profiles/.',
    })
  }
}

/**
 * Resolve the requested profiles.
 * @returns {Promise<Array<{ name: string, dir: string, exists: boolean }>>}
 */
export async function collectProfiles(config) {
  const profilesRoot = join(config.dshHome, 'profiles')
  if (config.profiles === 'all') {
    const entries = await readdir(profilesRoot, { withFileTypes: true }).catch(() => [])
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    return names.map((name) => ({ name, dir: join(profilesRoot, name), exists: true }))
  }
  return config.profiles.map((name) => ({ name, dir: join(profilesRoot, name), exists: false }))
}

/** Read a profile package.json without failing the whole backup on one bad file. */
export async function readProfilePackage(profileDir) {
  const path = join(profileDir, 'package.json')
  try {
    const text = await readFile(path, 'utf8')
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, `cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** Profiles and their declared plugin dependencies for the manifest. */
export async function profileInventory(config) {
  const profiles = await collectProfiles(config)
  const out = []
  for (const profile of profiles) {
    const exists = await pathExists(profile.dir)
    const pkg = exists ? await readProfilePackage(profile.dir) : undefined
    out.push({
      name: profile.name,
      dir: profile.dir,
      exists,
      packageName: pkg?.name,
      version: pkg?.version,
      dependencies: pkg?.dependencies ?? {},
      devDependencies: pkg?.devDependencies ?? {},
      optionalDependencies: pkg?.optionalDependencies ?? {},
      bundles: pkg?.dsh?.profile?.bundles ?? [],
    })
  }
  return out
}

/** Sanitize one dependency name into a single path segment. */
export function safePluginSegment(name) {
  return String(name).replace(/^@/, 'at-').replace(/[\\/:*?"<>|]/g, '__')
}

/**
 * Find local `link:`/`file:` dependencies so their real directories can be
 * archived with the profile and their specs rewritten after restore.
 */
export async function collectLocalLinks(profileDir, profileName, packageJson) {
  if (!packageJson) return []
  const specs = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  }
  const links = []
  for (const [name, spec] of Object.entries(specs)) {
    if (typeof spec !== 'string' || !/^(link|file):/i.test(spec)) continue
    const raw = spec.replace(/^(link|file):/i, '')
    const candidate = raw.startsWith('.') || raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)
      ? resolve(profileDir, raw)
      : resolve(profileDir, raw)
    const real = await realpath(candidate).catch(() => null)
    if (!real) continue
    const st = await stat(real).catch(() => null)
    if (!st || !st.isDirectory()) continue
    links.push({
      profile: profileName,
      dependency: name,
      sourceSpec: spec,
      realPath: real,
      archivedPath: `local-plugins/${profileName}/${safePluginSegment(name)}`,
      insideDshHome: isWithin(real, resolve(profileDir, '..', '..')),
    })
  }
  return links
}

/** Candidate repository-plugin directories under DSH_HOME. */
export async function discoverRepositoryDirs(config) {
  const candidates = [
    join(config.dshHome, 'plugins'),
    join(config.dshHome, 'repository-plugins'),
    join(config.dshHome, '.dsh-plugin'),
    join(config.dshHome, 'extensions'),
    ...config.extraPaths,
  ]
  const out = []
  const seen = new Set()
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => null)
    if (!real || seen.has(real)) continue
    const st = await stat(real).catch(() => null)
    if (!st || !st.isDirectory()) continue
    seen.add(real)
    const inside = isWithin(real, config.dshHome)
    out.push({
      name: basename(real),
      realPath: real,
      archivePath: inside ? `home/${toPosix(relative(config.dshHome, real))}` : `state/${basename(real)}`,
      insideDshHome: inside,
    })
  }
  return out
}

/**
 * Rewrite `link:` specs in profile package.json files to the restored copy.
 * This is deliberately a narrow, line-preserving JSON rewrite: JSON.stringify
 * would reformat the user's file, so parse -> modify -> pretty-print with the
 * original indentation when detectable.
 */
export async function rewriteLocalLinkSpecs(config, localLinks, logger) {
  const byProfile = new Map()
  for (const link of localLinks) {
    if (!byProfile.has(link.profile)) byProfile.set(link.profile, [])
    byProfile.get(link.profile).push(link)
  }
  const changed = []
  for (const [profile, links] of byProfile) {
    const packagePath = join(config.dshHome, 'profiles', profile, 'package.json')
    if (!(await pathExists(packagePath))) continue
    let text
    try {
      text = await readFile(packagePath, 'utf8')
    } catch {
      continue
    }
    let pkg
    try {
      pkg = JSON.parse(text)
    } catch {
      logger?.warn?.(`cannot rewrite ${packagePath}: invalid JSON`)
      continue
    }
    let dirty = false
    for (const link of links) {
      const newTarget = join(config.dshHome, '.dsh-backup', 'local-plugins', profile, safePluginSegment(link.dependency))
      const newSpec = `link:${toPosix(newTarget)}`
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        if (pkg[key] && Object.hasOwn(pkg[key], link.dependency) && pkg[key][link.dependency] !== newSpec) {
          pkg[key][link.dependency] = newSpec
          dirty = true
        }
      }
    }
    if (!dirty) continue
    const indent = detectIndent(text)
    await atomicWriteFile(packagePath, `${JSON.stringify(pkg, null, indent)}\n`, 0o644)
    changed.push(packagePath)
  }
  return changed
}

function detectIndent(text) {
  const match = /\n([ \t]+)"/.exec(text)
  if (!match) return 2
  return match[1].includes('\t') ? '\t' : match[1].length
}

/**
 * Recreate `node_modules/<dependency>` symlinks for restored `link:` plugins.
 * A link plugin's real directory is archived separately, so the profile's
 * node_modules symlink is intentionally skipped at backup time (it points at
 * an absolute path from the old machine) and rebuilt here.
 */
export async function ensureLocalLinkModules(config, localLinks, logger) {
  const changed = []
  const warnings = []
  for (const link of localLinks) {
    if (!link?.profile || !link?.dependency) continue
    const source = join(config.dshHome, '.dsh-backup', 'local-plugins', link.profile, safePluginSegment(link.dependency))
    if (!(await pathExists(source))) {
      warnings.push(`link plugin ${link.dependency} was not archived at ${source}`)
      continue
    }
    const modulePath = join(config.dshHome, 'profiles', link.profile, 'node_modules', ...String(link.dependency).split('/'))
    try {
      await ensureDir(dirname(modulePath))
      await rm(modulePath, { recursive: true, force: true })
      await symlinkSafe(source, modulePath, process.platform === 'win32' ? 'junction' : 'dir')
      changed.push(modulePath)
    } catch (error) {
      try {
        await copyTree(source, modulePath)
        warnings.push(`materialized link plugin ${link.dependency} because creating a symlink failed: ${error instanceof Error ? error.message : String(error)}`)
        changed.push(modulePath)
      } catch (copyError) {
        warnings.push(`could not restore link plugin ${link.dependency}: ${copyError instanceof Error ? copyError.message : String(copyError)}`)
      }
    }
  }
  if (changed.length > 0) logger?.info?.(`[dsh-backup] restored ${changed.length} link plugin module link(s)`)
  return { changed, warnings }
}
