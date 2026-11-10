// Prints the exact remote launch script the bridge would run, so the same
// shell can be replayed by hand on the host (with `bash -x`) when a launch
// fails and the plugin log only has the exit code.
import { writeFileSync } from 'node:fs'
import { SessionBridge } from '../lib/bridge.js'

let captured = ''
const bridge = new SessionBridge({
  pool: { async exec(host, command) { captured = command; return { code: 0, stdout: '', stderr: '' } } },
  store: { root: 'C:\\tmp\\dsh-ssh-inspect', settings: {} },
  manager: { async prepareRemote() { return {} } },
  log: (level, message) => { if (level !== 'debug') console.error(`[${level}] ${message}`) }
})

const state = {
  localSessionId: 'session-3628add6-0b7f-4be5-a42f-7b9f03ce01ae',
  remoteSessionId: '',
  host: { id: 'host-mw79ig9r-0ffae0' },
  workspace: {
    id: 'ws-mw7cbldw-3fb8ea',
    name: 'ui-showcase',
    remotePath: '/root/ui-showcase',
    wsRoot: '/root/.dsh-remote/workspaces/ws-mw7cbldw-3fb8ea',
    dshHome: '/root/.dsh-remote/home',
    nodeBin: '/root/.dsh-remote/runtime/node/bin/node',
    dshBin: '/root/.dsh-remote/runtime/dsh-0.2.2-rc.1/node_modules/@deepseek-ai/dsh/lib/bin.js',
    dshVersion: '0.2.2-rc.1'
  },
  sdk: null,
  closed: false
}

const sdk = Object.assign(bridge.sdkPaths(state), { ready: false })
await bridge.launchSdk(state, sdk)
writeFileSync(process.argv[2] || 'launch.sh', captured, 'utf8')
console.log(`wrote ${Buffer.byteLength(captured)} bytes`)
