// RemoteManager helpers: timeouts, local command runners, download and HTTP probe.
//
// Moved verbatim out of lib/remote.js; shared by the other lib/remote/*.js files.

import { open, readdir, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { firstLine, q, tailLines } from '../util.js'

export const DEFAULT_HTTP_TIMEOUT_MS = 120000
export const INSTALL_TIMEOUT_MS = 20 * 60 * 1000
export const PROBE_INTERVAL_MS = 2000

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ZCode 3.17.2 `ssh.assetInstallMode`: local-download-upload moves the runtime
// artifacts over SFTP; remote-download lets the server fetch them itself.
export const DEFAULT_ASSET_INSTALL_MODE = 'local-download-upload'

export function assetInstallModeOf(host) {
  return host?.assetInstallMode === 'remote-download' ? 'remote-download' : DEFAULT_ASSET_INSTALL_MODE
}

export function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`
}

// Recursive size of a directory; used as the progress signal for a local npm
// install, whose piped output has nothing to parse.
export async function directorySize(root) {
  let total = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile()) total += (await stat(path).catch(() => null))?.size ?? 0
    }
  }
  return total
}

export function runLocal(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs || 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
      // npm/tar are .cmd shims on Windows; every argument is fixed by us or
      // validated before this point.
      shell: process.platform === 'win32',
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = tailLines(String(stderr || '').trim(), 8) || firstLine(error.message)
        reject(new Error(`${command} ${args.slice(0, 2).join(' ')} 失败: ${detail}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

export async function downloadToFile(url, destination, { onProgress } = {}) {
  if (typeof fetch !== 'function') throw new Error('当前 dsh 运行时没有 fetch，无法本地下载资源')
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`)
  const total = Number(response.headers.get('content-length') || 0)
  const handle = await open(destination, 'w')
  let received = 0
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk)
      received += chunk.length
      onProgress?.(received, total)
    }
  } finally {
    await handle.close()
  }
  if (total > 0 && received !== total) throw new Error(`下载不完整（${received}/${total} 字节）：${url}`)
  return received
}

export function httpProbeCommand(port, nodeBin = 'node') {
  return [
    `if command -v curl >/dev/null 2>&1; then`,
    `  curl -s -o /dev/null -w '%{http_code}' --max-time 4 ${q(`http://127.0.0.1:${port}/`)} 2>/dev/null || true`,
    `elif command -v wget >/dev/null 2>&1; then`,
    `  wget -q -O /dev/null --timeout=4 ${q(`http://127.0.0.1:${port}/`)} >/dev/null 2>&1 && printf 200 || printf 000`,
    `else`,
    `  ${q(nodeBin)} -e ${q(`fetch('http://127.0.0.1:${port}/').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log(0);process.exit(0)})`)} 2>/dev/null || printf 000`,
    `fi`
  ].join('\n')
}
