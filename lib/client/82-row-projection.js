// part: 82-row-projection -- native sidebar row projection (ZcodeRemoteRow)
    // ── Native sidebar row projection (ZCode-style) ─────────────────────────
    // DSH workspace rows expose no icon/badge field, so remote rows are
    // decorated in place: cloud status glyph + device label + row menu. The
    // native row menu is hidden because it would rename/delete only the local
    // projection and drift away from the plugin's state.
    let runtimeCtx = null
    const rowMeta = { at: 0, workspaces: [], hosts: [], settings: null }
    let rowMetaPromise = null

    // ZCode's 项目行 → 远程设备设置: the row opens the device-management surface
    // with that device in edit mode. The SSH panel owns the form, so the request
    // is parked here until the panel mounts and its host list is ready.
    const deviceSettingsFlow = {
      pendingHostId: '',
      seq: 0,
      listeners: new Set(),
      request(hostId) {
        this.pendingHostId = String(hostId || '')
        this.seq += 1
        for (const listener of [...this.listeners]) {
          try { listener(this.seq) } catch { /* keep other subscribers alive */ }
        }
      },
      consume() {
        const hostId = this.pendingHostId
        this.pendingHostId = ''
        return hostId
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }
    }

    function openDeviceSettings(hostId) {
      if (!hostId) return false
      deviceSettingsFlow.request(hostId)
      try {
        runtimeCtx?.get?.('layout')?.selectPanel('ssh-remote')
      } catch {
        // layout may not be ready; the pending request survives for the panel
      }
      return true
    }

    async function loadRowMeta(force = false) {
      if (!force && Date.now() - rowMeta.at < 4000) return rowMeta
      if (rowMetaPromise) return rowMetaPromise
      rowMetaPromise = Promise.all([
        api('GET', '/ssh-remote/workspaces?refresh=0'),
        api('GET', '/ssh-remote/hosts'),
        api('GET', '/ssh-remote/settings').catch(() => null)
      ]).then(([workspaceData, hostData, settingsData]) => {
        rowMeta.workspaces = workspaceData.workspaces || []
        rowMeta.hosts = hostData.hosts || []
        rowMeta.settings = settingsData?.settings || null
        rowMeta.at = Date.now()
        return rowMeta
      }).catch(() => rowMeta).finally(() => { rowMetaPromise = null })
      return rowMetaPromise
    }

    const rowMenuFlow = {
      snapshot: { open: false, mode: 'menu', workspace: null, rect: null },
      listeners: new Set(),
      set(patch) {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of [...this.listeners]) {
          try { listener() } catch { /* keep other subscribers alive */ }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      open(workspace, rect) {
        this.set({ open: true, mode: 'menu', workspace, rect })
      },
      close() {
        this.set({ open: false, mode: 'menu', workspace: null, rect: null })
      }
    }

    function rowIconState(workspace) {
      const state = workspace?.status?.state
      if (state === 'running') return 'online'
      if (state === 'starting') return 'starting'
      if (state === 'error') return 'error'
      return 'offline'
    }

    function cloudIcon(state) {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      const set = (name, value) => svg.setAttribute(name, value)
      set('viewBox', '0 0 24 24')
      set('width', '16')
      set('height', '16')
      set('fill', 'none')
      set('stroke', 'currentColor')
      set('stroke-width', '2')
      set('stroke-linecap', 'round')
      set('stroke-linejoin', 'round')
      set('aria-hidden', 'true')
      svg.dataset.dshSshCloud = state
      const path = (d) => {
        const node = document.createElementNS(NS, 'path')
        node.setAttribute('d', d)
        svg.appendChild(node)
      }
      if (state === 'starting') {
        svg.classList.add('dsh-ssh-spin')
        path('M21 12a9 9 0 1 1-6.219-8.56')
      } else if (state === 'offline') {
        path('M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057')
        path('M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78')
        path('m2 2 20 20')
      } else {
        path('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z')
        if (state === 'error') path('M15.5 14.5l4 4M19.5 14.5l-4 4')
      }
      return svg
    }

    function rowStatusLabel(workspace) {
      const state = workspace?.status?.state
      if (state === 'running') return ''
      if (state === 'starting') return t('row.connecting')
      if (state === 'error') return t('row.failed')
      return t('row.offline')
    }

    function rowActionButton(kind, label) {
      const NS = 'http://www.w3.org/2000/svg'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-ssh-row-btn'
      button.title = label
      button.setAttribute('aria-label', label)
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '14')
      svg.setAttribute('height', '14')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '2')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      const paths = kind === 'more'
        ? ['M5 12h.01', 'M12 12h.01', 'M19 12h.01']
        : kind === 'files'
          ? ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z']
          : ['M12 5v14', 'M5 12h14']
      for (const d of paths) {
        const node = document.createElementNS(NS, 'path')
        node.setAttribute('d', d)
        svg.appendChild(node)
      }
      button.appendChild(svg)
      return button
    }

    function startNativeSession(nativeWorkspaceId) {
      try {
        const workspace = runtimeCtx?.get?.('uiWorkspace')
        if (!workspace) return false
        if (typeof workspace.startSession === 'function') {
          workspace.startSession(String(nativeWorkspaceId))
          return true
        }
        if (typeof workspace.openWorkspace === 'function') {
          workspace.openWorkspace(String(nativeWorkspaceId))
          return true
        }
      } catch {
        // fall back below
      }
      return false
    }

    function openRowMenu(workspace, anchor) {
      const rect = anchor.getBoundingClientRect()
      rowMenuFlow.open(workspace, {
        x: Math.max(8, Math.min(window.innerWidth - 176, rect.right - 168)),
        y: Math.max(8, Math.min(window.innerHeight - 248, rect.bottom + 4))
      })
    }

    // ZCode's project row also opens the same menu on context-menu.
    function openRowMenuAt(workspace, x, y) {
      rowMenuFlow.open(workspace, {
        x: Math.max(8, Math.min(window.innerWidth - 184, Number(x) || 0)),
        y: Math.max(8, Math.min(window.innerHeight - 248, Number(y) || 0))
      })
    }

