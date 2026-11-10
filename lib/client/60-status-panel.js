// part: 60-status-panel -- main status panel and its rows
    // ── Main status panel ──────────────────────────────────────────────────
    function StatusDot({ state }) {
      return h('span', { className: `sshR-dot ${state || 'stopped'}` })
    }
    function WorkspaceCard({ workspace, busy, onAction, onLogs, onRemove, onOpen }) {
      const status = workspace.status || {}
      const state = status.state || (workspace.desiredState === 'running' ? 'starting' : 'stopped')
      const tone = state === 'running' ? 'success'
        : state === 'starting' ? 'progress'
          : (state === 'error' || state === 'unreachable') ? 'danger' : 'neutral'
      const start = state === 'running'
        ? { label: t('panel.stop'), op: 'stop' }
        : { label: t('panel.start'), op: 'start' }
      const kind = workspace.targetKind === 'wsl' || workspace.targetKind === 'docker' ? workspace.targetKind : 'ssh'
      const deviceLabel = kind === 'wsl'
        ? `WSL · ${workspace.host || 'default'}`
        : kind === 'docker'
          ? `Docker · ${workspace.host || 'container'}`
          : `${workspace.username}@${workspace.host}:${workspace.targetPort || 22}`
      return h('div', { className: 'zc-card' },
        h('div', { className: 'zc-card-top' },
          h('span', { className: 'zc-card-title' }, workspace.name),
          h(StatusBadge, { tone }, stateLabel(state)),
          h('span', { className: 'zc-card-device' }, deviceLabel),
          workspace.serviceKind ? h('span', { className: 'zc-badge zc-badge-neutral' }, workspace.serviceKind) : null
        ),
        h('div', { className: 'zc-card-path' }, workspace.remotePath),
        h('div', { className: 'zc-card-meta' },
          h('span', null, t('panel.uptime'), ' ', h('b', null, fmtUptime(status.uptimeSec))),
          h('span', null, t('panel.mem'), ' ', h('b', null, fmtBytes(status.rssBytes))),
          h('span', null, t('panel.cpu'), ' ', h('b', null, status.cpuPercent != null ? `${status.cpuPercent.toFixed(1)}%` : '—')),
          h('span', null, t('panel.http'), ' ', h('b', null, status.httpStatus || '—')),
          h('span', null, t('panel.defaultPort'), ' ', h('b', null, workspace.port)),
          h('span', null, 'PID ', h('b', null, status.pid || '—')),
          h('span', null, t('panel.lastCheck'), ' ', h('b', null, status.checkedAt ? new Date(status.checkedAt).toLocaleTimeString() : '—'))
        ),
        status.error ? h('div', { className: 'zc-error', style: { marginTop: 10 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, status.error)) : null,
        h('div', { className: 'zc-card-actions' },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-default zc-btn-sm',
            disabled: busy || !workspace.nativeWorkspaceId,
            title: !workspace.nativeWorkspaceId ? t('z.openFailed') : undefined,
            onClick: () => onOpen(workspace)
          }, t('z.openWorkspace')),
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-outline zc-btn-sm',
            disabled: busy,
            onClick: () => onAction(start.op, workspace)
          }, start.label),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm', disabled: busy, onClick: () => onAction('restart', workspace) }, t('panel.restart')),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm', disabled: busy, onClick: () => onLogs(workspace) }, t('panel.logs')),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm danger', disabled: busy, onClick: () => onRemove(workspace) }, t('panel.remove'))
        )
      )
    }

    // The left-sidebar SSH surface is device management only. Creating or
    // opening a workspace happens in the main directory flow, exactly like
    // ZCode's device panel, which never creates projects.
    function MainPanel() {
      const [createOpen, setCreateOpen] = useState(false)
      const [refreshToken, setRefreshToken] = useState(0)
      useBackendPlatform()
      // The shell pill reopens the connection/create dialog here while this
      // panel is mounted; the return value unregisters on unmount.
      useEffect(() => setDialogOpener(() => setCreateOpen(true)), [])
      return h('div', { className: 'zc-ui zc-panel' },
        h('div', { className: 'zc-panel-head' },
          h('div', null,
            h('h2', { className: 'zc-panel-title' }, t('panel.heading')),
            h('p', { className: 'zc-panel-sub' }, t(supportsWsl() ? 'panel.sub' : 'panel.subNoWsl'))
          ),
          h('div', { className: 'zc-panel-actions' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-default',
              onClick: () => setCreateOpen(true)
            }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
          )
        ),
        h('div', { style: { marginTop: 16 } },
          h(HostsPane, {
            createOpen,
            onCloseCreate: () => setCreateOpen(false),
            refreshToken,
            onChanged: () => setRefreshToken((value) => value + 1)
          })
        )
      )
    }

