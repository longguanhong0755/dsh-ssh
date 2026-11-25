// part: 88-view -- open a remote workspace's own DSH in a browser tab
    // ── 打开远程 DSH ────────────────────────────────────────────────────────
    // The headline action: the remote workspace already serves a complete DSH
    // Web UI on its loopback. The Host mirrors that port on a fixed local port
    // and hands back a tokenized URL; a tab opens it. On the desktop build
    // `window.open` goes through the shell handler to the system browser, whose
    // cookie then lives outside the app window (30 days, authority-bound).
    const remoteViewFlow = (() => {
      const listeners = new Set()
      const state = {
        workspaceId: '',
        name: '',
        phase: 'idle',
        lines: [],
        error: '',
        url: '',
        port: 0
      }
      const emit = () => {
        for (const fn of [...listeners]) {
          try { fn() } catch { /* one broken subscriber must not stop the rest */ }
        }
      }
      const set = (patch) => { Object.assign(state, patch); emit() }
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const reveal = (url) => {
        if (!url) return false
        try {
          window.open(url, '_blank', 'noopener,noreferrer')
          return true
        } catch {
          return false
        }
      }
      return {
        get snapshot() { return state },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        reset() {
          set({ workspaceId: '', name: '', phase: 'idle', lines: [], error: '', url: '', port: 0 })
        },
        async open(workspace) {
          if (!workspace?.id) return
          if (state.phase === 'opening') return
          set({ workspaceId: workspace.id, name: workspace.name || '', phase: 'opening', lines: [], error: '', url: '', port: 0 })
          try {
            const started = await api('POST', '/ssh-remote/workspaces/view', { id: workspace.id })
            if (!started?.jobId) throw new Error(t('view.startFailed'))
            // The job covers start/restart of the remote service, so poll it
            // here instead of blocking the caller on one long request.
            for (;;) {
              await wait(700)
              const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(started.jobId)}`)
              const job = data.job
              set({ lines: (job.lines || []).slice(-8) })
              if (job.state === 'succeeded') {
                const url = job.result?.url || ''
                set({ phase: url ? 'done' : 'failed', url, port: job.result?.port || 0 })
                if (!url) throw new Error(t('view.startFailed'))
                reveal(url)
                return
              }
              if (job.state === 'failed' || job.state === 'cancelled') {
                const failure = new Error(job.error || t('view.startFailed'))
                failure.hint = job.errorHint || ''
                throw failure
              }
            }
          } catch (error) {
            set({ phase: 'failed', error: errorMessage(error), lines: [...state.lines, errorMessage(error)] })
          }
        },
        reopen() {
          reveal(state.url)
        }
      }
    })()

    function openRemoteView(workspace) {
      void remoteViewFlow.open(workspace)
    }

    function RemoteViewToast() {
      const [state, setState] = useState({ ...remoteViewFlow.snapshot })
      useEffect(() => remoteViewFlow.subscribe(() => setState({ ...remoteViewFlow.snapshot })), [])
      const done = state.phase === 'done'
      useEffect(() => {
        if (!done) return undefined
        // Leave the confirmation up long enough to click 「再次打开」, then get
        // out of the way: the browser tab is the real surface now.
        const timer = setTimeout(() => remoteViewFlow.reset(), 12000)
        return () => clearTimeout(timer)
      }, [done])
      if (state.phase === 'idle') return null
      const lastLine = state.lines.filter(Boolean).slice(-1)[0] || ''
      return h('div', {
        className: `rem-ui rem-view-toast is-${state.phase}`,
        role: 'status',
        'data-testid': 'remote-view-toast'
      },
        h('div', { className: 'rem-view-toast-head' },
          h(Icon, { name: done ? 'check' : state.phase === 'failed' ? 'alert' : 'loader', size: 15,
            className: state.phase === 'opening' ? 'dsh-ssh-spin' : undefined }),
          h('span', { className: 'rem-view-toast-title' },
            done ? t('view.opened') : state.phase === 'failed' ? t('view.failed') : t('view.opening')),
          h('button', {
            type: 'button',
            className: 'rem-view-toast-close',
            'aria-label': t('view.dismiss'),
            onClick: () => remoteViewFlow.reset()
          }, h(Icon, { name: 'x', size: 13 }))
        ),
        h('div', { className: 'rem-view-toast-body' },
          done
            ? h('p', { className: 'rem-view-toast-text' }, t('view.openedHint', { name: state.name }))
            : state.phase === 'failed'
              ? h('p', { className: 'rem-view-toast-text' }, state.error)
              : h('p', { className: 'rem-view-toast-text' }, t('view.openingHint', { name: state.name })),
          state.phase === 'failed' && lastLine && lastLine !== state.error
            ? h('p', { className: 'rem-view-toast-detail' }, lastLine)
            : null,
          done && state.port
            ? h('p', { className: 'rem-view-toast-detail' }, t('view.localPort', { port: String(state.port) }))
            : null
        ),
        h('div', { className: 'rem-view-toast-actions' },
          done
            ? h('button', { type: 'button', className: 'rem-btn rem-btn-secondary rem-btn-sm', onClick: () => remoteViewFlow.reopen() }, t('view.reopen'))
            : null,
          !done ? h('button', { type: 'button', className: 'rem-btn rem-btn-default rem-btn-sm', onClick: () => remoteViewFlow.reset() }, t('view.dismiss')) : null
        )
      )
    }