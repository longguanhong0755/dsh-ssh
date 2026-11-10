// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.
// job list, remote and local directory browsing
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { errorText } from '../util.js'
import {
  expandLocal,
  localListing,
  readBody,
  sendJson
} from './support.js'

export function registerFileRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/jobs', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    const job = jobs.get(url.searchParams.get('id') || '')
    if (!job) return sendJson(res, 404, { ok: false, error: 'job not found' })
    return sendJson(res, 200, { ok: true, job: jobs.snapshot(job) })
  })

  route('/ssh-remote/remote/list', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const host = store.host(url.searchParams.get('hostId') || '')
      if (!host) throw new Error('host not found')
      const listing = await manager.listRemoteDirs(host, url.searchParams.get('path') || '~')
      return sendJson(res, 200, { ok: true, ...listing })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/remote/read', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const host = store.host(url.searchParams.get('hostId') || '')
      if (!host) throw new Error('host not found')
      const file = await manager.readRemoteFile(host, url.searchParams.get('path') || '', url.searchParams.get('maxBytes'))
      return sendJson(res, 200, { ok: true, ...file })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/remote/mkdir', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.hostId || ''))
      if (!host) throw new Error('host not found')
      const target = await manager.makeRemoteDir(host, String(body.path || '~'), String(body.name || ''))
      return sendJson(res, 200, { ok: true, path: target })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/pick', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const picker = typeof ctx.get === 'function' ? ctx.get('directoryPicker') : null
      if (picker && typeof picker.capability === 'function') {
        const capability = await picker.capability()
        if (capability?.kind === 'native' && typeof capability.pick === 'function') {
          try {
            // `DirectoryPickerNativeCapability.pick` requires a real
            // AbortSignal; null throws before the OS dialog can open.
            const path = await capability.pick(new AbortController().signal)
            if (path) return sendJson(res, 200, { ok: true, path })
            return sendJson(res, 200, { ok: true, cancelled: true })
          } catch (error) {
            // The Host has no usable OS chooser; `browse` is a successful
            // answer to "which picking interaction is available?", so the
            // client can fall back instead of showing an error.
            return sendJson(res, 200, { ok: true, kind: 'browse', reason: errorText(error) })
          }
        }
      }
      return sendJson(res, 200, { ok: true, kind: 'browse' })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/list', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const listing = await localListing(url.searchParams.get('path') || '')
      return sendJson(res, 200, { ok: true, ...listing })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/mkdir', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const base = expandLocal(String(body.path || ''))
      const name = String(body.name || '').trim().replace(/[\\/]+/gu, '')
      if (!name || name === '.' || name === '..') throw new Error('目录名不合法')
      const target = join(base, name)
      await mkdir(target, { recursive: false })
      return sendJson(res, 200, { ok: true, path: target })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

}
