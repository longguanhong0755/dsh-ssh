// SessionBridge methods: remote profile setup, SDK runtime boot/watchdog and its JSON-RPC channel.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { errorText, joinRemote, q, safeId } from '../util.js'
import { sdkOwnerKillCommand, sdkReapCommand } from './sdk-owner.js'
import { HEADLESS_PACKAGE, HEADLESS_PATCH, SDK_PACKAGE, SDK_TTL_SECONDS, SDK_HEARTBEAT_MS, STREAM_PLUGIN_NAME, STREAM_PLUGIN_PACKAGE, STREAM_PLUGIN_SOURCE, STREAM_PATCH, PROFILE_VERSION, profileStamp, RUNTIME_SYNC_TTL_MS } from './shared.js'


import { sdkCoreMethods } from './sdk-core.js'
import { sdkIoMethods } from './sdk-io.js'

// One flat bag keeps `SessionBridge.prototype` shape identical to the single
// object this module used to export.
export const sdkMethods = {
  ...sdkCoreMethods,
  ...sdkIoMethods
}
