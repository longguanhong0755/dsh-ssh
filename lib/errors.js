// One place that turns a failure into something a person can act on.
//
// The Host already attaches machine codes to the failures it raises
// (`remote-authentication-failed`, `source-server-update-in-progress`, …).

// This module adds the part the raw message never carries: the next action.
// JSON routes keep sending `{ok:false,error,code?,hint?}` so older clients are
// unaffected, and the wizard renders `hint` under the reason line.

/** Known codes: a one-line next action in both UI languages. */
export const ERROR_CATALOG = {
  'remote-authentication-failed': {
    hint: '检查用户名、密码或私钥；确认服务器允许这种登录方式（PasswordAuthentication / PubkeyAuthentication）。',
    hintEn: 'Check the user, password or key, and that the server allows this login method.',
    retryable: true
  },
  'remote-authentication-unsupported': {
    hint: '服务器只接受交互式二次验证，改用私钥登录，或在服务器上关闭该验证方式。',
    hintEn: 'The server only offers interactive verification; use a private key or disable it on the server.',
    retryable: false
  },
  'remote-authentication-key-missing': {
    hint: '这台设备的凭据没有读到（系统凭据库可能已锁定），重新输入一次密码或私钥口令。',
    hintEn: 'The stored credential could not be read; enter the password or passphrase again.',
    retryable: true
  },
  'remote-connection-timeout': {
    hint: '确认地址和端口正确、sshd 正在监听，并检查本机或云安全组的防火墙。',
    hintEn: 'Check the address and port, that sshd is listening, and any firewall or security group.',
    retryable: true
  },
  'remote-connection-closed': {
    hint: '连接在握手完成前被关闭：多半是端口写错、被防火墙重置，或服务器拒绝了该客户端。',
    hintEn: 'The connection closed before the handshake finished; usually a wrong port, a firewall reset, or a refused client.',
    retryable: true
  },
  'remote-host-key-changed': {
    hint: '主机密钥与上次记录不一致。确认这台机器确实重装过，再在设备详情里更新指纹。',
    hintEn: 'The host key changed. Confirm the machine was reinstalled, then update the fingerprint in the device details.',
    retryable: false
  },
  'remote-host-not-found': {
    hint: '主机名解析失败，检查拼写，或直接填 IP 地址。',
    hintEn: 'The host name did not resolve; check the spelling or use an IP address.',
    retryable: true
  },
  'remote-host-unreachable': {
    hint: '网络不通或端口未开放：先在终端试一次 ssh，再检查防火墙和 SSH 服务。',
    hintEn: 'The host is unreachable: try ssh in a terminal, then check the firewall and SSH service.',
    retryable: true
  },
  'source-server-update-in-progress': {
    hint: '另一台桌面正在更新这台设备的远端服务，等它完成后再重试。',
    hintEn: 'Another desktop is updating this device; retry when it finishes.',
    retryable: true
  },
  'runtime-node-engine': {
    hint: '远端 Node 版本低于这个 dsh 版本的要求。允许插件安装便携 Node，或先升级远端 Node。',
    hintEn: 'The remote Node is older than this dsh build requires. Allow the portable Node, or upgrade Node on the host.',
    retryable: true
  },
  'runtime-registry-unreachable': {
    hint: '远端访问不了 npm 镜像。把安装方式改成「本机下载后上传」，或换一个镜像地址。',
    hintEn: 'The host cannot reach the npm registry. Switch to download-locally-then-upload, or change the mirror.',
    retryable: true
  },
  'runtime-sudo-required': {
    hint: '安装系统服务需要 root 或 sudo。换用 root 账号，或让插件退回 setsid 方式运行。',
    hintEn: 'Installing the system service needs root or sudo. Use root, or let the plugin fall back to setsid.',
    retryable: true
  },
  'runtime-no-service-manager': {
    hint: '这台机器没有 systemd，服务会用 setsid + crontab 常驻；如果也没装 crontab，重启后需要手动重连。',
    hintEn: 'No systemd here; the service runs under setsid + crontab. Without crontab it must be reconnected after a reboot.',
    retryable: true
  },
  'runtime-disk-low': {
    hint: '远端主目录剩余空间不足（需要约 300 MB）。清理后重试。',
    hintEn: 'The remote home is low on space (about 300 MB needed). Free space and retry.',
    retryable: true
  },
  'runtime-port-in-use': {
    hint: '目标端口已被占用。删掉这个项目后重新创建，插件会换一个空闲端口。',
    hintEn: 'The port is already in use. Recreate the project so the plugin picks a free port.',
    retryable: true
  },
  'runtime-install-failed': {
    hint: '安装 npm 包失败，展开日志看最后几行；常见原因是镜像不可达或磁盘满。',
    hintEn: 'Installing the npm package failed; expand the log for the last lines (registry or disk).',
    retryable: true
  },
  'runtime-permission': {
    hint: '远端目录不可写。确认登录用户对主目录有写权限。',
    hintEn: 'The remote directory is not writable for this user.',
    retryable: false
  },
  'view-token-missing': {
    hint: '没有在服务日志里找到启动令牌。点「重启服务」会生成新的令牌。',
    hintEn: 'No launch token in the service log. Restarting the service mints a new one.',
    retryable: true
  },
  'view-port-conflict': {
    hint: '本机转发端口被占用。换一个项目端口或关闭占用该端口的程序后重试。',
    hintEn: 'The local forwarding port is busy. Free it or use another project port.',
    retryable: true
  },
  'view-docker-port-unpublished': {
    hint: '这个容器没有发布 Web 端口，无法在本地打开远程界面。重建容器时加 `-p 127.0.0.1:<端口>:<端口>`。',
    hintEn: 'This container publishes no web port. Recreate it with `-p 127.0.0.1:<port>:<port>`.',
    retryable: false
  },
  'view-target-offline': {
    hint: '远端服务没有运行。先启动项目，或点「重启服务」。',
    hintEn: 'The remote service is not running. Start the project or restart the service.',
    retryable: true
  },
  'view-unsupported': {
    hint: '这个目标类型暂不支持在本地打开远程界面。',
    hintEn: 'Opening the remote UI locally is not supported for this target type yet.',
    retryable: false
  }
}

const PATTERNS = [
  [/EACCES|permission denied|权限不够/iu, 'runtime-permission'],
  [/ENOSPC|no space left|磁盘空间/iu, 'runtime-disk-low'],
  [/npm ERR!|npm error/iu, 'runtime-install-failed'],
  [/EADDRINUSE|address already in use|端口.*占用/iu, 'runtime-port-in-use'],
  [/requires? (?:root|sudo)|root privileges|must be run as root/iu, 'runtime-sudo-required'],
  [/ETIMEDOUT|timed out|timeout|超时/iu, 'remote-connection-timeout']
]

/** Best-effort code for a message that arrived without one. */
export function classifyMessage(message) {
  const text = String(message || '')
  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(text)) return code
  }
  return ''
}

/**
 * Normalize any thrown value into `{code, message, hint, hintEn, retryable}`.
 * Unknown failures keep their original message and carry no hint.
 */
export function describeError(error) {
  const message = typeof error === 'string' ? error : (error?.message || String(error ?? ''))
  const code = String(error?.code || '').trim() || classifyMessage(message)
  const entry = code ? ERROR_CATALOG[code] : null
  const hint = String(error?.hint || entry?.hint || '')
  const hintEn = String(error?.hintEn || entry?.hintEn || '')
  const retryable = typeof error?.retryable === 'boolean' ? error.retryable : Boolean(entry?.retryable)
  return { code, message, hint, hintEn, retryable }
}

/**
 * Add `code`/`hint`/`retryable` to a failed JSON payload. Called from
 * `sendJson` so every existing route gains the actionable half without being
 * rewritten, and an explicit `code` from the thrown error always wins.
 */
export function enrichFailure(payload) {
  if (!payload || payload.ok !== false) return payload
  if (payload.code) {
    const entry = ERROR_CATALOG[payload.code]
    if (entry) {
      if (!payload.hint) payload.hint = entry.hint
      if (!payload.hintEn) payload.hintEn = entry.hintEn
      if (payload.retryable === undefined) payload.retryable = entry.retryable
    }
    return payload
  }
  const code = classifyMessage(payload.error)
  if (!code) return payload
  const entry = ERROR_CATALOG[code]
  payload.code = code
  if (!payload.hint) payload.hint = entry.hint
  if (!payload.hintEn) payload.hintEn = entry.hintEn
  if (payload.retryable === undefined) payload.retryable = entry.retryable
  return payload
}
