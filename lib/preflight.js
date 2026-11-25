// Environment checks that run before a workspace is created.
//
// A first deployment used to fail deep inside the installer: an old Node, a
// read-only home, a full disk or an unreachable npm mirror surfaced as a raw
// stderr tail minutes later. Everything here is cheap (one exec plus one HTTP
// HEAD), runs before any file is written, and returns the same items to the
// wizard, the diagnostics panel and the create job.
//
// Each row carries Chinese and English copy: the UI picks by the language the
// user chose, the remote job log keeps the Chinese one. Ids and states are
// stable so the client can also style them without parsing text.

import { q } from './util.js'
import { versionAtLeast, resolveRuntimeTarget, portableNodeVersion } from './dsh-version.js'
import { assetInstallModeOf } from './remote/shared.js'

export const PREFLIGHT_REVISION = '2026-11-25 preflight-2'

/** Free space a first install needs: dsh tree, portable Node and logs. */
const REQUIRED_DISK_KB = 300 * 1024

const SUPPORTED_ARCH = new Set(['x86_64', 'amd64', 'aarch64', 'arm64', 'armv7l', 'ppc64le', 's390x'])

function parseMarkers(stdout) {
  const values = {}
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    const match = line.match(/^@@([A-Z]+)@@(.*)$/u)
    if (match) values[match[1]] = match[2].trim()
  }
  return values
}

/** The one remote command: every cheap fact at once, no file writes. */
function probeScript(version) {
  return [
    'printf "@@OS@@"; uname -s 2>/dev/null || printf unknown; echo',
    'printf "@@ARCH@@"; uname -m 2>/dev/null || printf unknown; echo',
    'printf "@@USER@@"; id -un 2>/dev/null || printf unknown; echo',
    'printf "@@UID@@"; id -u 2>/dev/null || printf 0; echo',
    'printf "@@HOME@@"; printf %s "$HOME"; echo',
    'printf "@@NODE@@"; command -v node 2>/dev/null || true; echo',
    'printf "@@NODEV@@"; node -v 2>/dev/null || true; echo',
    'printf "@@INIT@@"; ps -p 1 -o comm= 2>/dev/null || true; echo',
    'printf "@@SYSTEMD@@"; command -v systemctl 2>/dev/null || true; echo',
    'printf "@@CRON@@"; command -v crontab 2>/dev/null || true; echo',
    'printf "@@SUDO@@"; command -v sudo 2>/dev/null || true; echo',
    'printf "@@DISK@@"; df -Pk "$HOME" 2>/dev/null | tail -1 || true; echo',
    'printf "@@WRITE@@"; if [ -w "$HOME" ]; then printf yes; else printf no; fi; echo',
    // `$HOME` must expand, so this path stays double-quoted; `version` is a
    // validated semver and carries no shell metacharacters.
    `printf "@@DSH@@"; if [ -f "$HOME/.dsh-remote/runtime/dsh-${version}/node_modules/@deepseek-ai/dsh/lib/bin.js" ]; then printf yes; else printf no; fi; echo`,
    'printf "@@END@@"'
  ].join('\n')
}

/**
 * One row of the report.
 *
 * `en` carries the same three slots in English; a slot that is not translated
 * (a path, a version, a measurement) falls back to the value it repeats.
 */
function check(id, state, title, detail, en, hint = '') {
  return {
    id,
    state,
    title,
    detail,
    hint,
    titleEn: en?.title || title,
    detailEn: en?.detail || detail,
    hintEn: en?.hint || hint
  }
}

const REGISTRY_HINT = '把这个设备的安装方式改成「本机下载后上传」，或换一个远端能访问的镜像。'
const REGISTRY_HINT_EN = 'Switch this device to "download here, upload", or point it at a mirror the host can reach.'

async function registryCheck(manager, host, settings, registry) {
  const probe = [
    `if command -v curl >/dev/null 2>&1; then curl -sS -m 8 -o /dev/null -w '%{http_code}' ${q(registry)}`,
    `elif command -v wget >/dev/null 2>&1; then wget -q -T 8 -O /dev/null ${q(registry)} && printf 200 || printf 000`,
    `elif command -v node >/dev/null 2>&1; then node -e ${q(`const m=require(${JSON.stringify('https')});const r=m.get(${JSON.stringify(registry)},res=>{console.log(res.statusCode);res.resume()});r.on('error',()=>console.log('000'));r.setTimeout(8000,()=>{console.log('000');r.destroy()})`)}`,
    'else printf 000',
    'fi'
  ].join('\n')
  try {
    const result = await manager.pool.exec(host, probe, { timeoutMs: 20000 })
    const code = String(result.stdout || '').trim().slice(-3)
    if (/^[23]/u.test(code)) {
      return check('registry', 'ok', 'npm 镜像可达', `${registry}（HTTP ${code}）`,
        { title: 'npm registry reachable', detail: `${registry} (HTTP ${code})` })
    }
    return check('registry', 'warn', 'npm 镜像不可达', `${registry} 返回 ${code || '无响应'}`,
      { title: 'npm registry unreachable', detail: `${registry} answered ${code || 'nothing'}`, hint: REGISTRY_HINT_EN }, REGISTRY_HINT)
  } catch (error) {
    return check('registry', 'warn', 'npm 镜像不可达', String(error?.message || error),
      { title: 'npm registry unreachable', hint: REGISTRY_HINT_EN }, REGISTRY_HINT)
  }
}

/**
 * Run every check for one target.
 *
 * @param {object} manager RemoteManager (needs `pool`).
 * @param {object} host stored host record.
 * @param {{onLog?: Function, settings?: object}} options
 * @returns {Promise<{revision: string, ok: boolean, checks: object[], target: object, at: string}>}
 */
export async function runPreflight(manager, host, { onLog = () => {}, settings = null } = {}) {
  const effective = settings || manager.store?.settings || {}
  const target = resolveRuntimeTarget(effective)
  const portable = portableNodeVersion(effective)
  const mode = assetInstallModeOf(host)
  const checks = []

  let values = {}
  try {
    const result = await manager.pool.exec(host, probeScript(target.version), { timeoutMs: 30000 })
    values = parseMarkers(result.stdout)
    onLog(`[ssh-remote:preflight] 环境检查：${values.OS || '未知系统'} ${values.ARCH || ''}`)
  } catch (error) {
    // Not fatal here: the create step repeats the connection and reports the
    // transport error with its own code. Preflight just says it could not run.
    return {
      revision: PREFLIGHT_REVISION,
      ok: true,
      degraded: true,
      checks: [check('transport', 'warn', '环境检查未完成', String(error?.message || error),
        {
          title: 'Environment checks did not finish',
          hint: 'Continue creating; check the job log if it fails.'
        }, '继续创建，失败时看任务日志。')],
      target,
      at: new Date().toISOString()
    }
  }

  const os = values.OS || ''
  if (/linux/iu.test(os)) {
    checks.push(check('platform', 'ok', '操作系统', `${os} ${values.ARCH || ''}`,
      { title: 'Operating system' }))
  } else {
    checks.push(check('platform', 'error', '不支持的操作系统', os || '未知',
      {
        title: 'Unsupported operating system',
        detail: os || 'unknown',
        hint: 'The remote service needs Linux (systemd or setsid): use a Linux host, WSL or Docker.'
      },
      '远端服务依赖 Linux 的 systemd/setsid；请用 Linux 主机、WSL 或 Docker。'))
  }

  const arch = values.ARCH || ''
  checks.push(SUPPORTED_ARCH.has(arch)
    ? check('arch', 'ok', 'CPU 架构', arch, { title: 'CPU architecture' })
    : check('arch', 'error', '不支持的 CPU 架构', arch || '未知',
      {
        title: 'Unsupported CPU architecture',
        detail: arch || 'unknown',
        hint: 'There is no portable Node build for this architecture; use another machine or install Node yourself.'
      },
      '便携 Node 没有这个架构的构建；换一台机器或手动安装 Node。'))

  const home = values.HOME || ''
  checks.push(home && home.startsWith('/')
    ? check('home', 'ok', '登录用户', `${values.USER || '?'}（uid ${values.UID || '?'}）${home}`,
      { title: 'Login user', detail: `${values.USER || '?'} (uid ${values.UID || '?'}) ${home}` })
    : check('home', 'error', '无法解析远程主目录', JSON.stringify(values),
      {
        title: 'Cannot resolve the remote home directory',
        hint: 'Make sure the SSH user has a usable $HOME.'
      },
      '确认 SSH 登录用户有可用的 $HOME。'))

  const nodeVersion = values.NODEV || ''
  if (versionAtLeast(nodeVersion, target.nodeMinimum)) {
    checks.push(check('node', 'ok', '远程 Node', `${nodeVersion} ≥ ${target.nodeMinimum}`,
      { title: 'Remote Node' }))
  } else {
    checks.push(check('node', 'warn', '远程 Node 偏旧',
      `${nodeVersion || '未安装'} < ${target.nodeMinimum}，将安装便携 Node ${portable}`,
      {
        title: 'Remote Node is older than the runtime needs',
        detail: `${nodeVersion || 'not installed'} < ${target.nodeMinimum}, portable Node ${portable} will be installed`,
        hint: `The first deploy downloads Node ${portable} (about 30 MB); nothing to install by hand.`
      },
      `插件会在首次部署时下载 Node ${portable}（约 30 MB），无需手动安装。`))
  }

  const init = String(values.INIT || '')
  const hasSystemd = Boolean(values.SYSTEMD) && /systemd|init/iu.test(init)
  const isRoot = String(values.UID || '') === '0'
  if (hasSystemd && isRoot) {
    checks.push(check('service', 'ok', '常驻方式', 'systemd 系统服务（开机自启）',
      { title: 'How the service stays up', detail: 'systemd system service (starts at boot)' }))
  } else if (hasSystemd) {
    checks.push(check('service', 'warn', '常驻方式', '用户级 systemd（需要 loginctl linger）',
      {
        title: 'How the service stays up',
        detail: 'per-user systemd (needs loginctl linger enabled)',
        hint: 'If the service stops after you log out, the plugin falls back to setsid.'
      },
      '如果服务在退出登录后停止，插件会退回 setsid 方式。'))
  } else if (values.CRON) {
    checks.push(check('service', 'warn', '常驻方式', 'setsid + crontab @reboot',
      {
        title: 'How the service stays up',
        hint: 'No systemd; crontab restarts it after a reboot, which can lag by a few dozen seconds.'
      },
      '没有 systemd；重启后靠 crontab 拉起，可能晚几十秒。'))
  } else {
    checks.push(check('service', 'warn', '常驻方式', 'setsid（重启后需手动连接）',
      {
        title: 'How the service stays up',
        detail: 'setsid (needs a manual connect after a reboot)',
        hint: 'Neither systemd nor crontab is available; after a reboot, connect here once.'
      },
      '这台机器没有 systemd 也没有 crontab，重启后需要在这里点一次「连接」。'))
  }

  const disk = String(values.DISK || '').trim()
  const diskFields = disk.split(/\s+/u).filter(Boolean)
  const availableKb = diskFields.length >= 4 ? Number(diskFields[3]) : NaN
  if (Number.isFinite(availableKb)) {
    const availableMb = Math.round(availableKb / 1024)
    checks.push(availableKb >= REQUIRED_DISK_KB
      ? check('disk', 'ok', '剩余空间', `约 ${availableMb} MB`,
        { title: 'Free space', detail: `about ${availableMb} MB` })
      : check('disk', 'error', '剩余空间不足', `约 ${availableMb} MB，需要 300 MB`,
        {
          title: 'Not enough free space',
          detail: `about ${availableMb} MB, 300 MB needed`,
          hint: 'Free space in the remote home and retry, or use another directory or device.'
        },
        '清理远端主目录后重试，或换一个目录/设备。'))
  } else {
    checks.push(check('disk', 'skip', '剩余空间', '无法读取 df 输出',
      { title: 'Free space', detail: 'could not read df output' }))
  }

  checks.push(values.WRITE === 'yes'
    ? check('write', 'ok', '主目录可写', home, { title: 'Home directory writable' })
    : check('write', 'error', '主目录不可写', home || '(空)',
      {
        title: 'Home directory is not writable',
        detail: home || '(empty)',
        hint: 'This SSH user cannot write to its own home; use a different user.'
      },
      '这个 SSH 用户对自己的主目录没有写权限，换一个用户。'))

  checks.push(values.DSH === 'yes'
    ? check('runtime', 'ok', 'dsh 运行时', `已安装 ${target.version}`,
      { title: 'dsh runtime', detail: `${target.version} is already installed` })
    : check('runtime', 'ok', 'dsh 运行时', `将在部署时安装 ${target.version}`,
      { title: 'dsh runtime', detail: `${target.version} will be installed during the deploy` }))

  if (mode === 'remote-download') {
    checks.push(await registryCheck(manager, host, effective, effective.npmRegistry || 'https://registry.npmjs.org'))
  } else {
    checks.push(check('registry', 'skip', 'npm 镜像', '本机下载后上传，不需要远端访问 npm',
      { title: 'npm registry', detail: 'downloaded here and uploaded, the host never reaches npm' }))
  }

  for (const row of checks) onLog(`[ssh-remote:preflight] ${row.state === 'ok' ? '✓' : row.state === 'warn' ? '!' : row.state === 'error' ? '✗' : '-'} ${row.title}: ${row.detail || ''}`)

  const errors = checks.filter((row) => row.state === 'error')
  return {
    revision: PREFLIGHT_REVISION,
    ok: errors.length === 0,
    degraded: false,
    checks,
    target: { version: target.version, nodeMinimum: target.nodeMinimum, portableNode: portable },
    at: new Date().toISOString()
  }
}