// Remote side deployment units: systemd unit text and start/stop shell scripts.
//
// Moved verbatim out of lib/remote.js; used by the deploy and service methods.

import { q } from '../util.js'

function unitEnv(workspace) {
  return [
    `Environment=${q(`HOME=${workspace.home}`)}`,
    `Environment=${q(`DSH_HOME=${workspace.dshHome}`)}`,
    `Environment=${q(`DSH_SSH_REMOTE_WORKSPACE=${workspace.id}`)}`,
    `Environment=${q(`PATH=${workspace.nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}`
  ].join('\n')
}

function unitPath(value) {
  // WorkingDirectory= takes the value literally (quotes are not stripped), so
  // escape spaces/percent signs with systemd's C-style escapes instead.
  return String(value ?? '').replace(/\\/gu, '\\\\').replace(/ /gu, '\\x20').replace(/%/gu, '%%')
}

export function unitContent(workspace, { userUnit }) {
  const exec = `"${workspace.nodeBin}" "${workspace.dshBin}" --profile web --no-open --port ${workspace.port}`
  return [
    '[Unit]',
    `Description=DSH SSH remote workspace ${workspace.name} (${workspace.id})`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    ...(userUnit ? [] : ['User=' + workspace.username]),
    `WorkingDirectory=${unitPath(workspace.remotePath)}`,
    unitEnv(workspace),
    `ExecStart=${exec}`,
    'Restart=always',
    'RestartSec=3',
    'KillMode=mixed',
    'TimeoutStopSec=20',
    // Journal, not a file: SELinux on RHEL-family hosts denies init_t writing
    // into a user home, which makes append: log targets fail with 209/STDOUT.
    'StandardOutput=journal',
    'StandardError=journal',
    `SyslogIdentifier=${workspace.unit}`,
    '',
    '[Install]',
    `WantedBy=${userUnit ? 'default.target' : 'multi-user.target'}`,
    ''
  ].join('\n')
}

export function startScript(workspace) {
  return [
    '#!/bin/sh',
    'set -eu',
    `export HOME=${q(workspace.home)}`,
    `export DSH_HOME=${q(workspace.dshHome)}`,
    `export DSH_SSH_REMOTE_WORKSPACE=${q(workspace.id)}`,
    `export PATH=${q(`${workspace.nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}`,
    `echo $$ > ${q(workspace.pidFile)}`,
    `cd ${q(workspace.remotePath)}`,
    `exec ${q(workspace.nodeBin)} ${q(workspace.dshBin)} --profile web --no-open --port ${workspace.port}`,
    ''
  ].join('\n')
}

export function stopScript(workspace) {
  return [
    '#!/bin/sh',
    'set -u',
    `pidfile=${q(workspace.pidFile)}`,
    'if [ -f "$pidfile" ]; then',
    '  pid=$(cat "$pidfile" 2>/dev/null || true)',
    '  if [ -n "${pid:-}" ]; then',
    '    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true',
    '    i=0',
    '    while [ $i -lt 30 ]; do',
    '      kill -0 "$pid" 2>/dev/null || break',
    '      i=$((i + 1))',
    '      sleep 0.5',
    '    done',
    '    kill -0 "$pid" 2>/dev/null && { kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true; }',
    '  fi',
    'fi',
    'rm -f "$pidfile"',
    ''
  ].join('\n')
}
