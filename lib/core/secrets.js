/**
 * Credential-seam bridge for the WebDAV password and bearer token.
 *
 * DSH keeps secrets out of configuration: settings carry a reference
 * (an environment-style name) and the credential provider owns the value.
 * When a credential service is present we resolve the reference for the
 * duration of one operation; standalone CLI runs keep the environment
 * fallback that `normalizeWebdav` already implements.
 *
 * @param {Record<string, any>} config resolved plugin configuration
 * @param {{ resolve?: (ref: string) => Promise<{ value?: string }|undefined> }|null|undefined} credentials
 */
export async function hydrateWebdav(config, credentials) {
  if (!config) return config
  if (!credentials || typeof credentials.resolve !== 'function') return config
  const next = { ...config }
  let changed = false
  const webdav = { ...(config.webdav ?? {}) }
  if (!webdav.password) {
    const ref = webdav.passwordEnv || 'DSH_BACKUP_WEBDAV_PASSWORD'
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
        webdav.password = resolved.value
        changed = true
      }
    } catch {
      // An unavailable credential provider falls back to the environment.
    }
  }
  if (!webdav.token) {
    const ref = webdav.tokenEnv || 'DSH_BACKUP_WEBDAV_TOKEN'
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
        webdav.token = resolved.value
        changed = true
      }
    } catch {
      // Same fallback as above.
    }
  }
  const notify = { ...(config.notifyEmail ?? {}) }
  if (notify.to && !notify.password) {
    const ref = notify.passwordEnv || 'DSH_BACKUP_NOTIFY_PASSWORD'
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
        notify.password = resolved.value
        changed = true
      }
    } catch {
      // Same fallback as above.
    }
  }
  if (!changed) return config
  return { ...config, webdav, notifyEmail: notify }
}

/**
 * Describe whether a reference is configured without exposing the value.
 * @param {any} credentials
 * @param {string} ref
 */
export async function credentialConfigured(credentials, ref) {
  if (!credentials || typeof credentials.describe !== 'function') return undefined
  try {
    const info = await credentials.describe(ref)
    return info && typeof info.configured === 'boolean' ? info.configured : undefined
  } catch {
    return undefined
  }
}
