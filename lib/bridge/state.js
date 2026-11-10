// SessionBridge methods: persisted bridge journal and trace file.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { errorText } from '../util.js'

export const stateMethods = {
  armStreamProbe() {
    try {
      const register = this.ctx?.on
      if (typeof register !== 'function') return null
      return register.call(this.ctx, 'agent/assistant-stream', ({ agent, frame } = {}) => {
        const id = String(agent?.session?.id ?? '')
        if (!id || !frame) return
        const row = this.streamSeen.get(id) || { frames: 0, chunks: 0, revision: 0, lastType: '' }
        row.frames += 1
        if (frame.type === 'chunk') row.chunks += 1
        row.revision = Number(frame.revision) || row.revision
        row.lastType = String(frame.type)
        this.streamSeen.set(id, row)
      }, { global: true })
    } catch {
      return null
    }
  },

  traceStream(record) {
    try {
      mkdirSync(dirname(this.streamTracePath), { recursive: true })
      try {
        if (statSync(this.streamTracePath).size > 512 * 1024) writeFileSync(this.streamTracePath, '')
      } catch {
        // file does not exist yet
      }
      appendFileSync(this.streamTracePath, `${JSON.stringify(record)}\n`)
    } catch {
      // diagnostics must never break a turn
    }
  },

  loadJournalSync() {
    try {
      const raw = readFileSync(this.journalPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
        return parsed.sessions
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const backup = `${this.journalPath}.corrupt-${new Date().toISOString().replace(/[:.]/gu, '-')}`
        try {
          renameSync(this.journalPath, backup)
          this.log('warn', `bridge journal unreadable, backed up to ${backup}`)
        } catch {
          // Keep going with an empty journal; the original file stays in place.
        }
      }
    }
    return {}
  },

  saveSoon() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.persist()
    }, 500)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  },

  async persist() {
    try {
      await mkdir(dirname(this.journalPath), { recursive: true })
      const temp = `${this.journalPath}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify({ version: 1, sessions: this.journal }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.journalPath)
    } catch (error) {
      this.log('warn', `bridge journal write failed: ${errorText(error)}`)
    }
  },

  /**
   * Synchronous flush for turn end / shutdown. Without it the 500 ms debounce
   * can lose the last offset and bytes, so the next attach replays the final
   * assistant message and turn/end into the restored local session.
   */
  persistSync() {
    try {
      mkdirSync(dirname(this.journalPath), { recursive: true })
      const temp = `${this.journalPath}.${process.pid}.sync.tmp`
      writeFileSync(temp, `${JSON.stringify({ version: 1, sessions: this.journal }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, this.journalPath)
    } catch (error) {
      this.log('warn', `bridge journal sync write failed: ${errorText(error)}`)
    }
  }
}
