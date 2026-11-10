// Remote side of the plugin. Mirrors what ZCode's SSH feature does for a
// remote workspace: upload a Node runtime when needed, install the dsh Web
// runtime under the remote home, write credentials, start the Web profile as a
// detached service (systemd when available, setsid/nohup otherwise), verify its
// health, and keep it alive when the local app disconnects.
//
// This file deliberately has no port-forwarding / console code: the local side
// only monitors the remote service, it never proxies its HTTP UI.

// Entry point. This module keeps the class shell (constructor) and assembles the
// rest of the prototype from lib/remote/*.js at the end, so `import { RemoteManager }
// from './remote.js'` keeps working unchanged.

import { runtimeMethods } from './remote/runtime.js'
import { deployMethods } from './remote/deploy.js'
import { serviceMethods } from './remote/service.js'
import { statusMethods } from './remote/status.js'
import { fileMethods } from './remote/files.js'

export class RemoteManager {
  constructor({ dshHome, pool, store, log = () => {} }) {
    this.dshHome = dshHome
    this.pool = pool
    this.store = store
    this.log = log
    this.homeCache = new Map()
    this.runtimePromises = new Map()
    this.statusPromises = new Map()
    // In-flight per-host connection probes (device page status).
    this.connProbes = new Map()
    this.disposed = false
  }
}

// Everything else lives in lib/remote/*.js as plain objects of method entries,
// grouped by concern; assigning them keeps the same names on the prototype.
Object.assign(RemoteManager.prototype, runtimeMethods, deployMethods, serviceMethods, statusMethods, fileMethods)

// A class body declares its methods non-enumerable; the objects above are plain
// literals, so restore the descriptor shape the pre-split class had.
for (const name of Object.keys(RemoteManager.prototype)) {
  Object.defineProperty(RemoteManager.prototype, name, { enumerable: false })
}

export { deriveWorkspaceState } from './remote/status.js'
