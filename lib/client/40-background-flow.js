// part: 40-background-flow -- background connection flow, JobModal and BackgroundPill
    // ── background connection flow ─────────────────────────────────────────
    // ZCode keeps "connect" alive when the wizard is minimized: the dialog is
    // only a view over this module-level flow, and a shell pill resumes it.
    const backgroundFlow = (() => {
      const listeners = new Set()
      const state = {
        phase: 'idle',
        kind: '',
        targetKind: 'ssh',
        title: '',
        device: '',
        hostId: '',
        path: '',
        name: '',
        jobId: '',
        lines: [],
        confirm: null,
        phases: [],
        result: null,
        workspace: null,
        error: '',
        // ZCode renders a mapped error title plus a separate reason line.
        errorCode: '',
        errorReason: '',
        minimized: false,
        startedAt: 0,
        endedAt: 0
      }
      let runToken = 0
      let timer = null
      const emit = () => {
        for (const fn of [...listeners]) {
          try { fn() } catch { /* a stale subscriber must not break the flow */ }
        }
      }
      const update = (patch) => { Object.assign(state, patch); emit() }
      const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null } }
      const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms) })
      const setPhase = (key, status) => {
        const now = Date.now()
        update({
          phases: state.phases.map((row) => {
            if (row.key !== key || row.status === status) return row
            const times = row.times || {}
            if (status === 'active') times.start = times.start || now
            if (status === 'complete' || status === 'failed') times.end = times.end || now
            return { ...row, status, times }
          })
        })
      }
      const fail = (token, error) => {
        if (token !== runToken) return
        const message = errorMessage(error)
        update({
          phase: 'failed',
          error: message,
          errorCode: error?.code || '',
          errorReason: error?.reason || '',
          lines: [...state.lines, message],
          phases: state.phases.map((row) => (row.status === 'active' ? { ...row, status: 'failed' } : row)),
          endedAt: Date.now()
        })
      }
      const pollJob = async (token, jobId) => {
        while (token === runToken) {
          // Keep the flow alive while hidden (it must finish), but stop paying
          // a request every 700 ms for a window nobody is looking at.
          if (typeof document !== 'undefined' && document.hidden) {
            await sleep(2000)
            continue
          }
          const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`).catch((error) => {
            // Plugin reload / host restart drops the in-memory job registry;
            // say so instead of polling a dead id forever.
            if (/job not found/iu.test(errorMessage(error))) {
              throw new Error('任务已中断（插件可能重新加载过），请重新执行')
            }
            throw error
          })
          if (token !== runToken) return
          const job = data.job
          update({ lines: (job.lines || []).slice(-240) })
          if (job.state === 'succeeded') {
            update({
              phase: 'done',
              result: job.result || null,
              workspace: job.result && job.result.id ? job.result : state.workspace,
              phases: state.phases.map((row) => ({ ...row, status: 'complete' })),
              endedAt: Date.now()
            })
            return
          }
          if (job.state === 'failed' || job.state === 'cancelled') {
            const failure = new Error(job.error || t('job.failed'))
            failure.code = job.errorCode || ''
            failure.reason = job.errorReason || ''
            throw failure
          }
          await sleep(700)
        }
      }
      const begin = (kind, options) => {
        runToken += 1
        stopTimer()
        const channelLabel = phaseChannelLabel(options.targetKind || 'ssh')
        const stages = [
          { key: 'channel', label: channelLabel, status: 'active' },
          { key: 'identify', label: t('z.phase.identify'), status: 'pending' },
          { key: 'deploy', label: t('z.phase.deploy'), status: 'pending' },
          { key: 'handshake', label: t('z.phase.handshake'), status: 'pending' },
          { key: 'workspace', label: t('z.phase.workspace'), status: 'pending' }
        ]
        // The connect phase stops at deploy; the create phase starts with the
        // channel already established and deploy being re-verified.
        const phases = kind === 'prepare'
          ? stages.slice(0, 3)
          : stages.map((row, index) => {
              if (index === 0 || index === 1) return { ...row, status: 'complete', times: { start: Date.now() - 1000, end: Date.now() } }
              if (index === 2) return { ...row, status: 'active', times: { start: Date.now() } }
              return row
            })
        update({
          phase: 'running',
          kind,
          targetKind: options.targetKind || 'ssh',
          title: kind === 'prepare' ? t('z.phase.deploy') : t('z.phase.create'),
          device: options.device || '',
          hostId: options.hostId || '',
          path: options.path || '',
          name: options.name || '',
          jobId: '',
          lines: [],
          confirm: null,
          phases,
          result: null,
          workspace: null,
          error: '',
          minimized: false,
          startedAt: Date.now(),
          endedAt: 0
        })
        return runToken
      }
      return {
        get snapshot() { return state },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        update,
        reset() {
          runToken += 1
          stopTimer()
          this.continuation = null
          update({
            phase: 'idle', kind: '', targetKind: 'ssh', title: '', device: '', hostId: '', path: '', name: '',
            jobId: '', lines: [], confirm: null, phases: [], result: null, workspace: null, error: '',
            minimized: false, startedAt: 0, endedAt: 0
          })
        },
        minimize() { update({ minimized: true }) },
        restore() { update({ minimized: false }) },
        async startPrepare(host, options = {}) {
          const token = begin('prepare', {
            device: targetLabelFor(host),
            targetKind: kindOfrow(host),
            hostId: host.id,
            path: options.path || host.defaultPath || '~'
          })
          try {
            this.update({ title: t('z.phase.deploy') })
            let probe = options.probe
            if (!probe) {
              const data = await api('POST', '/ssh-remote/hosts/test', { host: { id: host.id } })
              if (token !== runToken) return
              probe = data.probe || {}
            }
            update({
              lines: [
                `${t('z.connect')} ${targetLabelFor(host)}`,
                `${probe.platform || ''} ${probe.arch || ''} · Node ${probe.node || '—'} · ${probe.latencyMs ?? '?'}ms`
              ]
            })
            setPhase('channel', 'complete')
            setPhase('identify', 'active')
            const runtime = await this.gateInstallIfNeeded(token, host)
            if (runtime === 'gated') return
            await this.runPrepareJob(token, host)
          } catch (error) {
            fail(token, error)
          }
        },
        // ZCode 3.17.2 shows an install-confirmation card inside the deploy
        // stage before touching the remote: target, version, path and size.
        async gateInstallIfNeeded(token, host) {
          const data = await api('POST', '/ssh-remote/hosts/runtime-check', { hostId: host.id })
          if (token !== runToken) return 'gated'
          const runtime = data.runtime || {}
          setPhase('identify', 'complete')
          if (runtime.present) return runtime
          setPhase('deploy', 'active')
          update({
            phase: 'confirm-install',
            confirm: {
              target: targetLabelFor(host),
              version: runtime.version || '',
              installPath: runtime.installPath || '',
              sizeBytes: runtime.sizeBytes ?? null,
              // An older runtime is already deployed: ZCode shows 需要更新 and
              // asks before replacing a working service (更新远端).
              mode: runtime.outdated ? 'update' : 'install',
              fromVersion: runtime.installedVersion || ''
            }
          })
          this.continuation = { token, host, run: () => this.runPrepareJob(token, host) }
          return 'gated'
        },
        runPrepareJob(token, host) {
          setPhase('deploy', 'active')
          void (async () => {
            const data = await api('POST', '/ssh-remote/hosts/prepare', { hostId: host.id })
            if (token !== runToken) return
            update({ jobId: data.jobId })
            await pollJob(token, data.jobId)
          })().catch((error) => fail(token, error))
        },
        confirmInstall() {
          const pending = this.continuation
          if (!pending || pending.token !== runToken) return
          this.continuation = null
          update({ phase: 'running', confirm: null })
          pending.run()
        },
        cancelInstall() {
          this.continuation = null
          this.reset()
        },
        async startCreate(options = {}) {
          const token = begin('create', options)
          try {
            const host = options.host || null
            if (!host) throw new Error(t('common.hostNotFound'))
            const runtime = await this.gateInstallIfNeeded(token, host)
            if (runtime === 'gated') {
              // The create job includes the runtime install itself.
              this.continuation = {
                token,
                host,
                run: () => {
                  void (async () => {
                    const data = await api('POST', '/ssh-remote/workspaces/create', {
                      hostId: options.hostId,
                      remotePath: options.path,
                      name: options.name || undefined,
                      syncCredentials: options.syncCredentials !== false,
                      createIfMissing: options.createIfMissing !== false
                    })
                    if (token !== runToken) return
                    update({ jobId: data.jobId })
                    await pollJob(token, data.jobId)
                  })().catch((error) => fail(token, error))
                }
              }
              return
            }
            const data = await api('POST', '/ssh-remote/workspaces/create', {
              hostId: options.hostId,
              remotePath: options.path,
              name: options.name || undefined,
              syncCredentials: options.syncCredentials !== false,
              createIfMissing: options.createIfMissing !== false
            })
            if (token !== runToken) return
            update({ jobId: data.jobId })
            await pollJob(token, data.jobId)
          } catch (error) {
            fail(token, error)
          }
        }
      }
    })()

    function useBackgroundFlow() {
      const [snapshot, setSnapshot] = useState(backgroundFlow.snapshot)
      useEffect(() => backgroundFlow.subscribe(() => setSnapshot({ ...backgroundFlow.snapshot })), [])
      return snapshot
    }

    // A single dialog opener is enough: the create dialog lives either in the
    // status panel or in the workspace directory flow, and the shell pill asks
    // whichever one is mounted to reopen it.
    let dialogOpener = null
    let dialogPending = false
    // Set by the pill so the dialog knows it must resume the live background
    // flow instead of starting a fresh form.
    let dialogResumeFlow = false
    function setDialogOpener(opener) {
      if (typeof opener !== 'function') {
        dialogOpener = null
        return () => {}
      }
      const current = opener
      dialogOpener = current
      if (dialogPending) {
        dialogPending = false
        current()
      }
      // A surface that unmounts must not clear an opener registered later by
      // another surface (status panel vs. directory flow).
      return () => {
        if (dialogOpener === current) dialogOpener = null
      }
    }
    function requestRemoteDialog(openPanel) {
      if (dialogOpener) {
        dialogResumeFlow = true
        dialogOpener()
        return true
      }
      if (typeof openPanel !== 'function') {
        dialogResumeFlow = false
        return false
      }
      dialogPending = true
      dialogResumeFlow = true
      openPanel()
      return true
    }

    function JobModal({ jobId, title, onClose, onDone }) {
      const { job, error } = useJob(jobId, onDone)
      const log = job ? job.lines.join('\n') : ''
      const state = job?.state || 'running'
      return h(Modal, {
        title: title || t('job.title'),
        onClose,
        wide: true,
        footer: h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-default',
          onClick: onClose,
          disabled: state === 'running'
        }, t('job.close'))
      },
        h('div', { className: 'zc-conn-title-row' },
          state === 'running' ? h(Spinner, { size: 14 }) : null,
          h('span', null, state === 'running' ? t('job.running') : state === 'succeeded' ? t('job.succeeded') : t('job.failed'))
        ),
        error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        job?.error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, job.error)) : null,
        h('pre', { className: 'zc-pre' }, log || t('panel.loading')),
        h('div', { style: { marginTop: 10, display: 'flex', gap: 8 } },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-ghost zc-btn-sm',
            onClick: () => navigator.clipboard?.writeText(log)
          }, t('job.copyLog'))
        )
      )
    }

    // ZCode's minimized connection pill: the flow keeps running above, and
    // this is the only surface while the wizard is closed.
    // A wizard minimized before it started a job (device/settings/directory)
    // is parked here so the shell pill can offer "continue configuration".
    let pausedWizard = null
    const pausedListeners = new Set()
    function setPausedWizard(value) {
      pausedWizard = value
      for (const fn of [...pausedListeners]) {
        try { fn() } catch { /* keep other subscribers alive */ }
      }
    }
    function usePausedWizard() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        pausedListeners.add(listener)
        return () => pausedListeners.delete(listener)
      }, [])
      return pausedWizard
    }

    function BackgroundPill({ openPanel, openNativeWorkspace }) {
      const bg = useBackgroundFlow()
      const paused = usePausedWizard()
      const flowVisible = bg.minimized && (bg.phase === 'running' || bg.phase === 'failed' || bg.phase === 'done' || bg.phase === 'prepared')
      if (!flowVisible && !paused) return null
      if (!flowVisible) {
        const title = paused.step === 'settings'
          ? t('z.paused.settings')
          : paused.step === 'directory'
            ? t('z.paused.directory', { device: paused.device || '' })
            : t('z.paused.device')
        return h('div', { className: 'zc-ui zc-pill', role: 'status' },
          h('button', {
            type: 'button',
            className: 'zc-pill-card',
            onClick: () => requestRemoteDialog(openPanel)
          },
            h('span', { className: 'zc-pill-title' }, h('span', { className: 'zc-truncate' }, title)),
            h('span', { className: 'zc-pill-sub' }, t('z.resume')),
            h('span', { className: 'zc-pill-action' }, t('z.backgroundReview'))
          ),
          h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => setPausedWizard(null) }, t('common.close'))
        )
      }
      const running = bg.phase === 'running'
      const failed = bg.phase === 'failed'
      const prepared = bg.phase === 'done' && bg.kind === 'prepare'
      const done = bg.phase === 'done' && bg.kind === 'create' && bg.workspace
      if (!running && !failed && !prepared && !done) return null
      const phases = bg.phases || []
      const completed = phases.filter((row) => row.status === 'complete').length
      const percent = phases.length > 0 ? Math.round((completed / phases.length) * 100) : 0
      const title = running
        ? t('z.bgConnecting', { device: bg.device })
        : failed
          ? t('z.bgFailed', { device: bg.device })
          : prepared
            ? t('z.bgPrepared', { device: bg.device })
            : t('z.bgReady', { name: bg.workspace?.name || bg.path })
      const sub = running
        ? t('z.resume')
        : failed
          ? `${bg.error || ''}`
          : prepared
            ? t('z.title.directory')
            : (bg.workspace?.remotePath || bg.path || '')
      const act = () => {
        if (done) {
          const opened = bg.workspace.nativeWorkspaceId ? openNativeWorkspace?.(bg.workspace.nativeWorkspaceId) : false
          backgroundFlow.reset()
          if (!opened) openPanel?.()
          return
        }
        // Reopen whichever dialog is mounted (status panel or directory flow).
        // Only drop the pill once a dialog actually took over; otherwise the
        // flow would become unreachable.
        if (requestRemoteDialog(openPanel)) backgroundFlow.restore()
      }
      const cardClass = failed ? 'zc-pill-card danger' : (running ? 'zc-pill-card progress' : 'zc-pill-card')
      return h('div', { className: 'zc-ui zc-pill', role: 'status' },
        h('button', { type: 'button', className: cardClass, 'data-testid': 'remote-connection-minimized', onClick: act },
          h('span', { className: 'zc-pill-title' },
            failed ? h(Icon, { name: 'alert', size: 14 })
              : running ? h(Spinner, { size: 14 })
                : null,
            h('span', { className: 'zc-truncate' }, title),
            running ? h('span', null, `${percent}%`) : null
          ),
          h('span', { className: 'zc-pill-sub' }, sub),
          running
            ? h('span', { className: 'zc-pill-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
                h('span', { style: { width: `${percent}%` } })
              )
            : null,
          h('span', { className: 'zc-pill-action' }, done ? t('z.openWorkspace') : running ? t('z.backgroundReview') : t('z.backgroundContinue'))
        ),
        running
          ? h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => backgroundFlow.reset() }, t('z.backgroundCancel'))
          : h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => backgroundFlow.reset() }, t('common.close'))
      )
    }

