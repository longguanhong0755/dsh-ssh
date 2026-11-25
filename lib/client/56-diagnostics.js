// part: 56-diagnostics -- one report: environment checks, service, logs
    // ── 诊断 ────────────────────────────────────────────────────────────────
    // "为什么连不上" answered in one place: the same preflight the wizard runs,
    // the deployed runtime, the service state, the local Web mirror and the
    // tail of the service log — read-only, no restart, no install.
    const DIAG_STATE_LABEL = {
      ok: 'diag.state.ok',
      warn: 'diag.state.warn',
      error: 'diag.state.error',
      skip: 'diag.state.skip'
    }

    function DiagnosticsDialog({ host, onClose, onOpenView }) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: '', copied: false })
      const load = async () => {
        setState({ phase: 'loading', data: null, error: '', copied: false })
        try {
          const data = await api('GET', `/ssh-remote/diagnostics?id=${encodeURIComponent(host.id)}`)
          setState({ phase: 'ready', data: data.diagnostics, error: '', copied: false })
        } catch (error) {
          setState({ phase: 'failed', data: null, error: errorMessage(error), copied: false })
        }
      }
      useEffect(() => { void load() }, [host.id])

      const copy = async () => {
        if (!state.data) return
        const report = [state.data]
        const text = JSON.stringify(report, null, 2)
        try {
          await navigator.clipboard.writeText(text)
          setState((old) => ({ ...old, copied: true }))
        } catch {
          setState((old) => ({ ...old, copied: false }))
        }
      }

      const body = (() => {
        if (state.phase === 'loading') {
          return h('div', { className: 'zc-diag-loading' },
            h(Icon, { name: 'loader', size: 16, className: 'dsh-ssh-spin' }),
            h('span', null, t('diag.running'))
          )
        }
        if (state.phase === 'failed') {
          return h('div', { className: 'zc-error' }, h(Icon, { name: 'alert', size: 16 }), h('span', null, state.error))
        }
        const data = state.data
        const checks = data.preflight?.checks || []
        const failed = checks.filter((row) => row.state === 'error')
        const warned = checks.filter((row) => row.state === 'warn')
        const target = data.workspace || null
        return h('div', { className: 'zc-diag' },
          h('div', { className: `zc-diag-verdict is-${failed.length ? 'error' : warned.length ? 'warn' : 'ok'}` },
            h(Icon, { name: failed.length ? 'alert' : warned.length ? 'info' : 'check', size: 15 }),
            h('span', null, failed.length
              ? t('diag.verdictBlocked', { count: failed.length })
              : warned.length
                ? t('diag.verdictWarn', { count: warned.length })
                : t('diag.verdictOk'))
          ),
          h('section', { className: 'zc-diag-section' },
            h('h3', { className: 'zc-diag-title' }, t('diag.environment')),
            h('ul', { className: 'zc-diag-checks' },
              checks.map((check) => h('li', { key: check.id, className: `zc-diag-check is-${check.state}` },
                h(Icon, {
                  name: check.state === 'ok' ? 'check' : check.state === 'warn' ? 'info' : check.state === 'skip' ? 'minus' : 'alert',
                  size: 14
                }),
                h('span', { className: 'zc-diag-check-main' },
                  h('span', { className: 'zc-diag-check-title' }, check.title || check.id),
                  check.detail ? h('span', { className: 'zc-diag-check-detail' }, check.detail) : null,
                  check.hint ? h('span', { className: 'zc-diag-check-hint' }, check.hint) : null
                ),
                h('span', { className: 'zc-diag-check-state' }, t(DIAG_STATE_LABEL[check.state] || 'diag.state.skip'))
              ))
            )
          ),
          h('section', { className: 'zc-diag-section' },
            h('h3', { className: 'zc-diag-title' }, t('diag.runtime')),
            h('dl', { className: 'zc-diag-grid' },
              h('dt', null, t('diag.localTarget')),
              h('dd', null, `${data.target?.version || '—'} · Node ≥ ${data.target?.nodeMinimum || '—'}`),
              h('dt', null, t('diag.remoteTarget')),
              h('dd', null, target ? target.remotePath : t('diag.noWorkspace')),
              h('dt', null, t('diag.service')),
              h('dd', null, data.status
                ? `${data.status.active ? t('diag.serviceActive') : t('diag.serviceStopped')}${data.status.httpStatus ? ` · HTTP ${data.status.httpStatus}` : ''}${data.status.pid ? ` · PID ${data.status.pid}` : ''}`
                : '—'),
              h('dt', null, t('diag.webMirror')),
              h('dd', null, data.view?.open
                ? t('diag.mirrorOpen', { port: String(data.view.port) })
                : t('diag.mirrorClosed')),
              h('dt', null, t('diag.hostKey')),
              h('dd', null, data.hostKey?.fingerprint || t('diag.hostKeyUnknown'))
            )
          ),
          data.logs?.length
            ? h('section', { className: 'zc-diag-section' },
                h('h3', { className: 'zc-diag-title' }, t('diag.logs')),
                h('pre', { className: 'zc-diag-log' }, data.logs.join('\n'))
              )
            : null
        )
      })()

      return h(Modal, {
        title: t('diag.title'),
        wide: true,
        onClose,
        footer: h('div', { className: 'zc-diag-foot' },
          state.data?.workspace && onOpenView
            ? h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-secondary',
                onClick: () => { onClose(); onOpenView(state.data.workspace) }
              }, h(Icon, { name: 'externalLink', size: 14 }), t('row.openDsh'))
            : null,
          h('div', { className: 'zc-diag-foot-right' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-outline',
              disabled: state.phase === 'loading',
              onClick: () => void load()
            }, h(Icon, { name: 'rotate', size: 14 }), t('diag.rerun')),
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-outline',
              disabled: !state.data,
              onClick: () => void copy()
            }, h(Icon, { name: 'copy', size: 14 }), state.copied ? t('diag.copied') : t('diag.copy')),
            h('button', { type: 'button', className: 'zc-btn zc-btn-default', onClick: onClose }, t('common.close'))
          )
        )
      },
        h('p', { className: 'zc-diag-lead' }, t('diag.lead', { device: host.name || host.host || host.id })),
        body
      )
    }