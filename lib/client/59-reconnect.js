// part: 59-reconnect -- startup reattach, and what to say when it fails
    // ── 启动时自动重连 ──────────────────────────────────────────────────────
    // Reattaching rebuilds only the local relay; remote daemons and running
    // tasks are untouched. It used to fail silently, which left a user staring
    // at devices marked offline with no way to know whether anything ran.
    // Now the failures are collected and offered as one retry.
    const reconnectReport = (() => {
      const listeners = new Set()
      const state = { phase: 'idle', busy: false, failed: [] }
      const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* ignore */ } } }
      const set = (patch) => { Object.assign(state, patch); emit() }
      const reconnectOne = async (host) => {
        try {
          await api('POST', '/ssh-remote/hosts/action', { id: host.id, op: 'reconnect' })
          return null
        } catch (error) {
          return { id: host.id, name: host.name || host.host || host.id, error: errorMessage(error) }
        }
      }
      const eligible = (host) => Boolean(host.lastOnlineAt) && host.serviceState !== 'stopped'
      return {
        get snapshot() { return state },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        reset() { set({ phase: 'idle', busy: false, failed: [] }) },
        async run() {
          // Once per app window: a renderer reload must not re-run the loop.
          const marker = 'dsh-ssh-remote:startup-reconnect'
          try {
            if (globalThis.sessionStorage?.getItem(marker)) return state
            globalThis.sessionStorage?.setItem(marker, '1')
          } catch {
            // storage may be unavailable; fall through to the best-effort run
          }
          let settings = null
          let hosts = []
          try {
            const [settingsData, hostData] = await Promise.all([
              api('GET', '/ssh-remote/settings'),
              api('GET', '/ssh-remote/hosts')
            ])
            settings = settingsData?.settings || null
            hosts = hostData?.hosts || []
          } catch {
            return state // the plugin is not ready yet; nothing to report
          }
          if (settings?.startupAutoReconnect === false) return state
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
          const targets = hosts.filter((host) => {
            if (!eligible(host)) return false
            const seen = new Date(host.lastOnlineAt).getTime()
            return Number.isFinite(seen) && seen >= cutoff
          })
          if (!targets.length) return state
          set({ phase: 'running', busy: true, failed: [] })
          const results = await Promise.all(targets.map(reconnectOne))
          const failed = results.filter(Boolean)
          set({ phase: failed.length ? 'failed' : 'done', busy: false, failed })
          return state
        },
        async retry() {
          if (state.busy || !state.failed.length) return state
          set({ busy: true })
          const results = await Promise.all(state.failed.map(reconnectOne))
          const failed = results.filter(Boolean)
          set({ phase: failed.length ? 'failed' : 'done', busy: false, failed })
          return state
        }
      }
    })()

    function runStartupReconnect() {
      return reconnectReport.run()
    }

    function ReconnectBanner() {
      const [state, setState] = useState({ ...reconnectReport.snapshot })
      useEffect(() => reconnectReport.subscribe(() => setState({ ...reconnectReport.snapshot })), [])
      if (!state.failed.length) return null
      return h('div', { className: 'rem-ui rem-reconnect-banner', role: 'status', 'data-testid': 'ssh-remote-reconnect' },
        h(Icon, { name: 'alert', size: 15 }),
        h('div', { className: 'rem-reconnect-main' },
          h('p', { className: 'rem-reconnect-title' }, t('reconnect.title', { count: state.failed.length })),
          h('p', { className: 'rem-reconnect-detail' },
            t('reconnect.detail', { names: state.failed.map((row) => row.name).slice(0, 3).join('、') }))
        ),
        h('div', { className: 'rem-reconnect-actions' },
          h('button', {
            type: 'button',
            className: 'rem-btn rem-btn-secondary rem-btn-sm',
            disabled: state.busy,
            onClick: () => void reconnectReport.retry()
          }, state.busy ? t('reconnect.retrying') : t('reconnect.retry')),
          h('button', {
            type: 'button',
            className: 'rem-btn rem-btn-ghost rem-btn-sm',
            onClick: () => reconnectReport.reset()
          }, t('reconnect.dismiss'))
        )
      )
    }