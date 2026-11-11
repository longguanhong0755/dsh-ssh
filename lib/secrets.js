// System credential storage for SSH passwords and key passphrases.
//
// state.json is the source of truth for host records, but a password has no
// business sitting in a plain JSON file. Each platform has a user-scoped
// secret store; the store migrates existing plaintext once per host and
// strips it from the file on the next write.
//
//   Windows  Credential Manager, via advapi32 CredWrite/CredRead in a
//            short-lived PowerShell process. The secret travels on stdin,
//            never on the command line.
//   macOS    `security` generic passwords. The payload is base64 inside the
//            keychain so the raw secret is never an argv token (argv is
//            world-readable through ps); `security -i` takes the command on
//            stdin and the entry is read back to verify the write.
//   Linux    libsecret `secret-tool` with service/account attributes. The
//            secret travels on stdin.
//
// A missing backend is not an error: callers keep the legacy plaintext field
// (state.json is mode 0600) and the health check reports the fallback.

import { spawn } from 'node:child_process'

export const SECRET_SERVICE = 'dsh-ssh-remote'
const OP_TIMEOUT_MS = 15000

function run(command, args, { input = '', timeoutMs = OP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      const error = new Error(`${command} 没有在 ${Math.round(timeoutMs / 1000)} 秒内完成`)
      error.code = 'ETIMEDOUT'
      error.stderr = stderr
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish(error)
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (code === 0) {
        finish(null, { stdout, stderr })
        return
      }
      const detail = (stderr || stdout).trim().split(/\r?\n/u)[0] || `${command} exited ${code}`
      const error = new Error(detail)
      error.exitCode = code
      error.stderr = stderr
      finish(error)
    })
    // The child may exit before reading its input (missing binary, instant
    // failure); an EPIPE on stdin must not crash the host process.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

const WINDOWS_SCRIPT = `<#
  Read or write one Credential Manager entry. Kept self-contained: the plugin
  has no native dependency, and Add-Type compiles this in memory only.
#>
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DshCred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, int flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    public static void Write(string target, string user, string secret) {
        byte[] blob = Encoding.Unicode.GetBytes(secret);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        try {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = target;
            cred.UserName = user;
            cred.CredentialBlob = blobPtr;
            cred.CredentialBlobSize = blob.Length;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            if (!CredWrite(ref cred, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            Marshal.FreeHGlobal(blobPtr);
        }
    }

    public static string Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out ptr)) {
            int code = Marshal.GetLastWin32Error();
            if (code == 1168) return null;
            throw new System.ComponentModel.Win32Exception(code);
        }
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize == 0) return "";
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, blob.Length);
            return Encoding.Unicode.GetString(blob);
        } finally {
            CredFree(ptr);
        }
    }

    public static bool Delete(string target) {
        if (CredDelete(target, CRED_TYPE_GENERIC, 0)) return true;
        int code = Marshal.GetLastWin32Error();
        if (code == 1168) return false;
        throw new System.ComponentModel.Win32Exception(code);
    }
}
'@

$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
$req = $request | ConvertFrom-Json
$prefix = '${SECRET_SERVICE}/'
if ($req.action -eq 'readMany') {
  foreach ($id in $req.ids) {
    $text = [DshCred]::Read($prefix + $id)
    if ($null -ne $text) {
      $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
      Write-Output ($id + [char]9 + $payload)
    }
  }
} elseif ($req.action -eq 'write') {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($req.payload))
  [DshCred]::Write($prefix + $req.id, $env:USERNAME, $text)
  Write-Output 'ok'
} elseif ($req.action -eq 'delete') {
  $removed = [DshCred]::Delete($prefix + $req.id)
  if ($removed) { Write-Output 'removed' } else { Write-Output 'missing' }
}
`

function request(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function encodePayload(value) {
  return JSON.stringify({ password: String(value?.password || ''), passphrase: String(value?.passphrase || '') })
}

function encodeValue(value) {
  return Buffer.from(encodePayload(value), 'utf8').toString('base64')
}

function decodeValue(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  let json = ''
  try {
    json = Buffer.from(raw, 'base64').toString('utf8')
  } catch {
    return { password: raw, passphrase: '' }
  }
  try {
    const value = JSON.parse(json)
    if (!value || typeof value !== 'object') return { password: json, passphrase: '' }
    return { password: String(value.password || ''), passphrase: String(value.passphrase || '') }
  } catch {
    // An entry someone typed by hand is still a usable password.
    return { password: json, passphrase: '' }
  }
}

function looksMissing(error) {
  // secret-tool exits 1 for "no such secret"; security exits 44. Neither is a
  // backend failure, so a missing entry must not abort the read loop.
  return error?.exitCode === 44 || error?.exitCode === 1 ||
    /could not be found|not found|No such secret/iu.test(String(error?.stderr || error?.message || ''))
}

export class SecretStore {
  constructor({ platform = process.platform, run: runner = run, service = SECRET_SERVICE, log = null } = {}) {
    this.platform = platform
    this.runner = runner
    this.service = service
    this.log = log || (() => {})
    this.backendPromise = null
  }

  /** 'windows' | 'macos' | 'libsecret' | '' (no usable store on this host). */
  backend() {
    if (!this.backendPromise) this.backendPromise = this.detect()
    return this.backendPromise
  }

  async detect() {
    if (this.platform === 'win32') return 'windows'
    if (this.platform === 'darwin') return 'macos'
    if (this.platform !== 'linux') return ''
    try {
      // A missing entry exits 1 with no stderr; a broken D-Bus session explains
      // itself. Either way this is the cheapest availability probe.
      await this.runner('secret-tool', ['lookup', 'service', this.service, 'account', '__probe__'])
      return 'libsecret'
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      if (/D-Bus|Secret Service|dbus/iu.test(String(error?.stderr || error?.message || ''))) return ''
      return error?.exitCode === 1 ? 'libsecret' : ''
    }
  }

  async windows(command) {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')]
    return this.runner('powershell.exe', args, { input: `${request(command)}\n` })
  }

  async readMany(ids) {
    const list = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))]
    const found = new Map()
    if (list.length === 0) return found
    const backend = await this.backend()
    if (!backend) return found
    if (backend === 'windows') {
      const result = await this.windows({ action: 'readMany', ids: list })
      for (const line of String(result.stdout || '').split(/\r?\n/u)) {
        const index = line.indexOf('\t')
        if (index <= 0) continue
        const value = decodeValue(line.slice(index + 1))
        if (value) found.set(line.slice(0, index), value)
      }
      return found
    }
    if (backend === 'macos') {
      for (const id of list) {
        try {
          const result = await this.runner('security', ['find-generic-password', '-s', this.service, '-a', id, '-w'])
          const value = decodeValue(result.stdout)
          if (value) found.set(id, value)
        } catch (error) {
          if (!looksMissing(error)) throw error
        }
      }
      return found
    }
    for (const id of list) {
      try {
        const result = await this.runner('secret-tool', ['lookup', 'service', this.service, 'account', id])
        const text = String(result.stdout || '').trim()
        if (!text) continue
        const value = decodePlain(text)
        if (value) found.set(id, value)
      } catch (error) {
        if (!looksMissing(error)) throw error
      }
    }
    return found
  }

  async read(id) {
    return (await this.readMany([id])).get(String(id)) || null
  }

  /** Best effort: false means the caller must keep its plaintext fallback. */
  async write(id, value) {
    const key = String(id || '')
    if (!key) return false
    try {
      const backend = await this.backend()
      if (!backend) return false
      if (backend === 'windows') {
        const payload = encodeValue(value)
        await this.windows({ action: 'write', id: key, payload })
        return true
      }
      if (backend === 'macos') {
        // `security -i` keeps the payload out of argv. The stored value is the
        // base64 envelope; read() decodes it.
        const payload = encodeValue(value)
        await this.runner('security', ['-i'], {
          input: `add-generic-password -U -s ${this.service} -a ${key} -w ${payload}\n`
        })
        const check = await this.runner('security', ['find-generic-password', '-s', this.service, '-a', key, '-w'])
        return String(check.stdout || '').trim() === payload
      }
      await this.runner('secret-tool', ['store', '--label', `${this.service} ${key}`, 'service', this.service, 'account', key], {
        input: encodePayload(value)
      })
      return true
    } catch (error) {
      this.log('warn', `无法写入系统凭据库（${this.platform}）: ${error?.message || error}`)
      return false
    }
  }

  async remove(id) {
    const key = String(id || '')
    if (!key) return false
    try {
      const backend = await this.backend()
      if (!backend) return false
      if (backend === 'windows') {
        await this.windows({ action: 'delete', id: key })
        return true
      }
      if (backend === 'macos') {
        await this.runner('security', ['delete-generic-password', '-s', this.service, '-a', key])
        return true
      }
      await this.runner('secret-tool', ['clear', 'service', this.service, 'account', key])
      return true
    } catch (error) {
      if (looksMissing(error)) return false
      this.log('warn', `无法从系统凭据库删除 ${key}: ${error?.message || error}`)
      return false
    }
  }
}

/** libsecret keeps the JSON payload verbatim: the value is written on stdin
 *  and read back from stdout, so no shell or argv ever sees it. */
function decodePlain(text) {
  const raw = String(text || '')
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object') return { password: raw, passphrase: '' }
    return { password: String(value.password || ''), passphrase: String(value.passphrase || '') }
  } catch {
    return { password: raw, passphrase: '' }
  }
}

export const BACKEND_LABELS = {
  windows: 'Windows 凭据管理器',
  macos: 'macOS 钥匙串',
  libsecret: 'libsecret',
  '': 'state.json（0600）'
}

export function secretLabel(backend) {
  return BACKEND_LABELS[backend] || backend
}
