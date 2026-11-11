// JSON routes shared by the Web carrier (`webServer.register`) and the Desktop
// carrier (`connection.fetch.register` under /api). The client picks the prefix
// by location.protocol, exactly like dsh-remote does for dsh-app.
//
// The route bodies live in ./routes/*.js (one group per file) so no single file
// grows past a few hundred lines; this module only composes them.

import { errorText } from './util.js'
import { MAX_BODY_BYTES, readBody, sendJson } from './routes/support.js'
import { registerHostRoutes } from './routes/hosts.js'
import { registerHostExtraRoutes } from './routes/hosts-extra.js'
import { registerWorkspaceRoutes } from './routes/workspaces.js'
import { registerFileRoutes } from './routes/files.js'
import { registerMiscRoutes } from './routes/misc.js'
import { registerPluginRoutes } from './routes/plugins.js'

export function connectionRoute(route) {
  if (!route.path.startsWith('/ssh-remote/')) {
    throw new Error('dsh-ssh-remote: expected a plugin route under /ssh-remote/')
  }
  return {
    path: `/api${route.path}`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const chunks = []
      let size = 0
      const reader = request.body?.getReader()
      try {
        if (reader) {
          while (true) {
            request.signal.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_BODY_BYTES) {
              await reader.cancel()
              return Response.json({ ok: false, error: 'request body too large' }, { status: 413 })
            }
            chunks.push(Buffer.from(value))
          }
        }
      } finally {
        reader?.releaseLock()
      }
      request.signal.throwIfAborted()
      const url = new URL(request.url)
      const req = Readable.from(size ? [Buffer.concat(chunks, size)] : [])
      req.method = request.method
      req.url = `${route.path}${url.search}`
      const headers = new Headers()
      let response
      const res = {
        statusCode: 200,
        setHeader(key, value) {
          headers.set(key, value)
        },
        end(body) {
          response = new Response(body, { status: this.statusCode, headers })
        }
      }
      try {
        await route.handler(req, res)
        if (!response) throw new Error('route handler did not finish its response')
        return response
      } finally {
        req.destroy()
      }
    }
  }
}


export function createRoutes({ ctx, store, pool, manager, jobs, bridge, log, ready = Promise.resolve() }) {
  const routes = []
  const route = (path, handler) => routes.push({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      await ready
      return handler(req, res)
    }
  })

  const register = { route, ctx, store, pool, manager, jobs, bridge, log }
  registerHostRoutes(register)
  registerHostExtraRoutes(register)
  registerWorkspaceRoutes(register)
  registerFileRoutes(register)
  registerPluginRoutes(register)
  registerMiscRoutes(register)

  return routes
}

export function registerTransports(ctx, routes, log = () => {}) {
  const disposers = []
  try {
    ctx.inject(['webServer'], (inner) => {
      const server = inner.get('webServer')
      const own = routes.map((item) => server.register(item))
      disposers.push(...own)
    })
  } catch (error) {
    log('warn', `[ssh-remote] webServer unavailable: ${errorText(error)}`)
  }
  try {
    ctx.inject(['connection'], (inner) => {
      const connection = inner.get('connection')
      if (!connection?.fetch || typeof connection.fetch.register !== 'function') return
      for (const item of routes) disposers.push(connection.fetch.register(connectionRoute(item)))
    })
  } catch (error) {
    log('warn', `[ssh-remote] connection carrier unavailable: ${errorText(error)}`)
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // ignore
      }
    }
  }
}
