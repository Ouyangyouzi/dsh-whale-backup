import { BackupError, ERROR_CODES } from './errors.js'
import { sleep } from './fsutil.js'
import tls from 'node:tls'
import net from 'node:net'

/**
 * Minimal SMTP client for backup notifications. Supports the two common
 * provider setups (STARTTLS on port 587 and implicit TLS on port 465) with
 * only Node built-ins, keeping the plugin dependency-free.
 */

function parseHostport(url) {
  try {
    const parsed = new URL(url.includes('://') ? url : `smtp://${url}`)
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === 'smtps:' ? 465 : 587),
      secure: parsed.protocol === 'smtps:',
    }
  } catch {
    throw new BackupError(ERROR_CODES.INVALID_CONFIG, `通知 SMTP 服务器地址无效：${url}`)
  }
}

function readReply(socket) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = ''
    const lines = []
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      let index
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (line.length < 4) continue
        lines.push(line)
        if (line[3] === ' ') {
          cleanup()
          resolvePromise({ code: Number(line.slice(0, 3)), lines })
        }
      }
    }
    const onError = (error) => { cleanup(); rejectPromise(error) }
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}

function command(socket, text, expect) {
  return new Promise((resolvePromise, rejectPromise) => {
    socket.write(`${text}\r\n`, 'utf8', () => {
      readReply(socket).then((reply) => {
        if (expect && !expect.includes(reply.code)) {
          rejectPromise(new BackupError(ERROR_CODES.INVALID_CONFIG, `SMTP ${text.split(' ')[0]} 失败：${reply.lines.join(' / ')}`))
          return
        }
        resolvePromise(reply)
      }, rejectPromise)
    })
  })
}

/** Encode a UTF-8 mail body as quoted-printable. */
function quotedPrintable(text) {
  return String(text).split('\n').map((line) => {
    let out = ''
    for (const ch of line) {
      const code = ch.codePointAt(0)
      if (code < 128 && code >= 32 && ch !== '=' && ch !== '?') out += ch
      else out += `=${code.toString(16).toUpperCase().padStart(2, '0')}`
    }
    return out
  }).join('=\r\n')
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

async function startSession(smtp, host, port, secure, timeoutMs) {
  let socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })
  await new Promise((resolvePromise, rejectPromise) => {
    socket.once(secure ? 'secureConnect' : 'connect', resolvePromise)
    socket.once('error', rejectPromise)
  })
  socket.setTimeout(timeoutMs, () => { socket.destroy(); throw new BackupError(ERROR_CODES.INVALID_CONFIG, `SMTP 连接超时：${host}:${port}`) })

  const reply = await readReply(socket)
  if (reply.code !== 220) throw new BackupError(ERROR_CODES.INVALID_CONFIG, `SMTP 服务器问候异常：${reply.lines.join(' / ')}`)
  await command(socket, `EHLO dsh-whale`, [250])
  if (!secure) {
    await command(socket, 'STARTTLS', [220])
    socket = tls.connect({ socket, servername: host })
    await new Promise((resolvePromise, rejectPromise) => {
      socket.once('secureConnect', resolvePromise)
      socket.once('error', rejectPromise)
    })
    socket.setTimeout(timeoutMs, () => { socket.destroy(); throw new BackupError(ERROR_CODES.INVALID_CONFIG, 'SMTP TLS 升级后超时') })
    await command(socket, `EHLO dsh-whale`, [250])
  }
  return socket
}

/** Send one plain-text notification mail. */
export async function sendNotificationMail(options) {
  const smtp = options.smtp ?? {}
  if (!smtp.to) throw new BackupError(ERROR_CODES.INVALID_CONFIG, '通知邮箱未配置：请先填写收件邮箱')
  const hostRaw = smtp.host || smtp.smtpHost
  if (!hostRaw) throw new BackupError(ERROR_CODES.INVALID_CONFIG, '通知邮箱未配置：请先填写 SMTP 服务器')
  const parsed = parseHostport(hostRaw)
  const port = Number(smtp.port ?? smtp.smtpPort) || parsed.port
  const secure = smtp.secure === true || parsed.secure || port === 465
  const host = parsed.host
  const timeoutMs = Math.max(5000, Number(smtp.timeoutMs) || 20000)
  let socket = await startSession(smtp, host, port, secure, timeoutMs)
  try {
    if (smtp.username) {
      await command(socket, 'AUTH LOGIN', [334])
      await command(socket, Buffer.from(smtp.username, 'utf8').toString('base64'), [334])
      await command(socket, Buffer.from(smtp.password ?? '', 'utf8').toString('base64'), [235])
    }
    await command(socket, `MAIL FROM:<${smtp.from || smtp.username}>`, [250])
    for (const to of String(smtp.to).split(',').map((item) => item.trim()).filter(Boolean)) {
      await command(socket, `RCPT TO:<${to}>`, [250, 251])
    }
    await command(socket, 'DATA', [354])
    const headers = [
      `From: DSH Whale Backup <${smtp.from || smtp.username}>`,
      `To: ${smtp.to}`,
      `Subject: ${encodeHeader(options.subject ?? 'DSH 备份通知')}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
    ].join('\r\n')
    await command(socket, `${headers}${quotedPrintable(options.text ?? '')}\r\n.`, [250])
    await command(socket, 'QUIT', [221])
    socket.end()
  } catch (error) {
    socket.destroy()
    throw error
  }
}

/** Retry helper with short backoff for flaky SMTP servers. */
export async function sendNotificationMailWithRetry(options, logger) {
  const attempts = Math.max(1, Number(options.smtp?.retries ?? 2) + 1)
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await sendNotificationMail(options)
    } catch (error) {
      lastError = error
      logger?.warn?.(`[dsh-whale] notification mail attempt ${attempt + 1}/${attempts} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt + 1 < attempts) await sleep(800 * (attempt + 1))
    }
  }
  throw lastError
}

/** Compose the notification text for a finished backup or restore. */
export function buildBackupNotice(result) {
  const lines = [
    result.kind === 'restore' ? '鲸鱼娘备份：恢复已完成' : '鲸鱼娘备份：备份已完成',
    '',
    `时间：${new Date().toLocaleString()}`,
  ]
  if (result.archiveName) lines.push(`备份文件：${result.archiveName}`)
  if (result.sizeLabel) lines.push(`大小：${result.sizeLabel}`)
  if (result.local) lines.push(`本机位置：${result.local.path ?? result.local}`)
  if (result.remote) lines.push(`WebDAV 位置：${result.remote.url ?? result.remote}`)
  if (result.durationMs !== undefined) lines.push(`耗时：${Math.round(result.durationMs / 1000)} 秒`)
  return lines.join('\n')
}

/** Compose the notification text for a failure. */
export function buildFailureNotice(kind, message) {
  return [
    `鲸鱼娘备份：${kind === 'restore' ? '恢复' : '自动备份'}失败`,
    '',
    `时间：${new Date().toLocaleString()}`,
    `原因：${message}`,
    '',
    '请打开 dsh 设置里的鲸鱼娘备份查看详情。',
  ].join('\n')
}
