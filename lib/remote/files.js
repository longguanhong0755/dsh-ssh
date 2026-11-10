// RemoteManager methods: remote directory browsing and file access.
//
// Moved verbatim out of lib/remote.js (the bodies still use `this`) and assigned
// onto RemoteManager.prototype at the end of that module.

import { dirname } from 'node:path'
import { joinRemote, q } from '../util.js'

export const fileMethods = {
  async listRemoteDirs(host, inputPath) {
    const path = await this.resolveRemotePath(host, inputPath || '~')
    const rows = await this.pool.listDirs(host, path)
    const entries = rows
      .filter((row) => row.name !== '.' && row.name !== '..')
      .map((row) => ({
        name: row.name,
        path: joinRemote(path, row.name),
        dir: row.dir === true,
        // ZCode's `fI` hides dot-directories until 显示隐藏目录 is on.
        hidden: row.name.startsWith('.'),
        size: row.size ?? null,
        mtime: row.mtime ?? null
      }))
      .sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1
        const aHidden = a.name.startsWith('.')
        const bHidden = b.name.startsWith('.')
        if (aHidden !== bHidden) return aHidden ? 1 : -1
        return a.name.localeCompare(b.name)
      })
    const home = await this.hostHome(host)
    return { path, home, parent: path === '/' ? null : dirname(path), entries }
  },

  async readRemoteFile(host, inputPath, maxBytes) {
    const path = await this.resolveRemotePath(host, inputPath || '~')
    const file = await this.pool.readFile(host, path, maxBytes)
    return { path, ...file }
  },

  async makeRemoteDir(host, inputPath, name) {
    const base = await this.resolveRemotePath(host, inputPath || '~')
    const clean = String(name || '').trim().replace(/[\\/]+/gu, '')
    if (!clean || clean === '.' || clean === '..') throw new Error('目录名不合法')
    const target = joinRemote(base, clean)
    await this.pool.run(host, `mkdir -p ${q(target)}`, { timeoutMs: 20000 })
    return target
  },

  dispose() {
    this.disposed = true
  }
}
