// part: 68-dialog-view -- ZcodeRemoteDialog: derived view values and import menu
      const needle = query.trim().toLowerCase()
      const matches = (...parts) => !needle || parts.filter(Boolean).join(' ').toLowerCase().includes(needle)
      const filteredHosts = visibleHosts(hosts).filter((host) => matches(host.name, host.host, host.username, host.distro, host.user, host.container, host.image))
      const filteredAliases = aliases.filter((alias) => matches(alias.alias, alias.host, alias.username))
      const importNeedle = importQuery.trim().toLowerCase()
      const importAliases = aliases.filter((alias) => !importNeedle
        || [alias.alias, alias.host, alias.username].filter(Boolean).join(' ').toLowerCase().includes(importNeedle))
      const filteredDistros = (supportsWsl() ? discovery.wsl.distros || [] : []).filter((row) => matches(row.name))
      const filteredContainers = (discovery.docker.containers || []).filter((row) => matches(row.name, row.id, row.image))
      const activeHost = hostOf(dirHostId) || (editingId ? hostOf(editingId) : null)
      const activeKind = activeHost ? kindOfrow(activeHost) : kindOfrow(form)
      const deviceLabel = activeHost ? targetLabelFor(activeHost) : targetLabelFor(form)
      const flowIdle = bg.phase === 'idle'
      const displayPhases = flowIdle ? phases : bg.phases
      const displayLines = flowIdle ? connectLog : bg.lines.join('\n')
      const displayError = flowIdle ? error : (bg.error || error)
      // ZCode renders the mapped error title and its reason as two lines
      // (`remote.error.<code>` + `.reason`), e.g. 远程设备正在更新远端服务.
      const displayErrorReason = flowIdle ? '' : (bg.errorReason || '')
      const deployActive = displayPhases.some((row) => row.key === 'deploy' && row.status === 'active')
      const createActive = displayPhases.some((row) => row.key === 'create' && row.status === 'active')
      const wizardName = activeHost?.name || form.name || deviceLabel
      // ZCode `qpt`: SSH user@host:port, WSL distribution, Docker container.
      const previewTarget = (kind, row) => {
        if (kind === 'wsl') return String(row.distro ?? row.wslDistro ?? '').trim() || null
        if (kind === 'docker') return String(row.dockerMode === 'manual' ? row.manualContainer : (row.container || row.manualContainer) || '').trim() || null
        return row.host ? `${row.username || 'user'}@${row.host}:${row.port || 22}` : null
      }
      const header = step === 'device'
        ? { title: t('z.title.device'), desc: t('z.desc.device') }
        : step === 'settings'
          ? deviceManagement
            ? { title: t('z.settings.newConnection'), desc: '' }
            : { title: t('z.title.settings'), preview: previewTarget(activeKind, form), kind: activeKind }
          : step === 'directory'
            ? { title: t('z.title.directory'), desc: t('z.desc.directory', { method: wizardName }), kind: activeKind }
            : {
                title: t('z.title.connecting'),
                kind: bg.phase === 'idle' ? activeKind : (bg.targetKind || activeKind),
                desc: cancelled
                  ? t('z.cancelled')
                  : displayError
                    ? t('z.desc.failed')
                    : bg.phase === 'done'
                      ? t('z.connectedTo', { device: wizardName })
                      // ZCode `Fvt`: the subtitle names the line type, not the
                      // full user@host target.
                      : t('z.connectingVia', { method: kindLabel(bg.phase === 'idle' ? activeKind : (bg.targetKind || activeKind)) })
              }

      const importMenuNode = h(AnchoredMenu, {
        open: importOpen && form.kind === 'ssh',
        anchorRef: importButtonRef,
        width: 320,
        align: 'end',
        className: 'zc-import-menu',
        children: [
          h('input', {
            key: 'search',
            className: 'zc-input zc-import-search',
            type: 'search',
            autoFocus: true,
            placeholder: t('z.configAliasSearch'),
            'aria-label': t('z.configAliasSearch'),
            value: importQuery,
            onChange: (event) => setImportQuery(event.target.value)
          }),
          ...importAliases.map((alias) => h('button', {
            key: alias.alias,
            type: 'button',
            className: 'zc-import-item',
            'data-checked': selectedAlias === alias.alias ? 'true' : 'false',
            onClick: () => applyAlias(alias)
          },
            h(Icon, { name: 'server', size: 16 }),
            h('span', { className: 'zc-import-item-main' },
              h('span', null, alias.alias),
              h('span', null, `${alias.username ? `${alias.username}@` : ''}${alias.host || alias.alias}:${alias.port || 22}`)
            )
          )),
          importAliases.length === 0
            ? h('div', { key: 'empty', className: 'zc-docker-empty' }, t('z.configAliasEmpty'))
            : null
        ].filter(Boolean)
      })

