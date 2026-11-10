// part: 90-apply -- apply(ctx): slot registration
    function apply(ctx) {
      ensureCss()
      runtimeCtx = ctx
      // Learn the host platform once; every WSL surface waits on it.
      void api('GET', '/ssh-remote/discover?kind=none')
        .then((data) => setBackendPlatform(data?.platform))
        .catch(() => {})
      // ZCode 启动时自动重连: reattach devices seen online in the last 7 days.
      // This only rebuilds the local relay; remote daemons and tasks are left
      // untouched, so an app launch never interrupts running work.
      void (async () => {
        // 启动时自动重连 must fire once per app window, not once per plugin
        // activation or renderer reload. sessionStorage is shared by every
        // module instance in this window and is cleared by a real app restart.
        const marker = 'dsh-ssh-remote:startup-reconnect'
        try {
          if (globalThis.sessionStorage?.getItem(marker)) return
          globalThis.sessionStorage?.setItem(marker, '1')
        } catch {
          // storage may be unavailable; fall through to the best-effort run
        }
        try {
          const [settingsData, hostData] = await Promise.all([
            api('GET', '/ssh-remote/settings'),
            api('GET', '/ssh-remote/hosts')
          ])
          if (settingsData?.settings?.startupAutoReconnect === false) return
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
          for (const host of hostData.hosts || []) {
            if (!host.lastOnlineAt || host.serviceState === 'stopped') continue
            const seen = new Date(host.lastOnlineAt).getTime()
            if (!Number.isFinite(seen) || seen < cutoff) continue
            await api('POST', '/ssh-remote/hosts/action', { id: host.id, op: 'reconnect' }).catch(() => {})
          }
        } catch {
          // best-effort: startup must never block on a device
        }
      })()
      const slots = ctx.get('slots')
      const openPanel = () => {
        try {
          ctx.get('layout')?.selectPanel('ssh-remote')
        } catch {
          // layout may not be ready yet
        }
      }
      // Host service that selects a workspace row and opens its blank session.
      // This is what makes "click a recent remote directory" land in the
      // native workspace instead of stopping at a status dialog.
      const openNativeWorkspace = (workspaceId) => {
        try {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace && typeof uiWorkspace.openWorkspace === 'function') {
            uiWorkspace.openWorkspace(String(workspaceId))
            return true
          }
        } catch {
          // fall back to the status panel
        }
        return false
      }
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'ssh-remote',
        order: 41,
        label: () => t('settings.title')
      }, SettingsSection))
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: 'ssh-remote',
        order: 45,
        label: () => t('panel.title')
      }, PanelIcon))
      slots.inject('main', function* () {
        yield slots.register({
          name: 'main',
          key: 'ssh-remote',
          inject: () => ({ openPanel, openNativeWorkspace })
        }, MainPanel)
      })
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'ssh-remote-background',
        inject: () => ({ openPanel, openNativeWorkspace })
      }, BackgroundPill))
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'ssh-remote-row-menu'
      }, RemoteRowMenu))
      for (const slot of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) {
        slots.inject(slot, () => slots.register({
          name: slot,
          id: 'ssh-remote',
          priority: -100,
          inject: () => ({ openPanel, openNativeWorkspace })
        }, DirectoryFlow))
      }
      // Remote file panel: 查看文件 has to read the project's real tree, which the
      // native files tab cannot do off the local anchor. The tab registry is
      // provided by the sidebar-right plugin, so wait for it briefly.
      let tabAttempts = 0
      const registerFilesTabs = () => {
        let tabTypes = null
        try { tabTypes = ctx.get('sidebarRightTabs') } catch { tabTypes = null }
        if (!tabTypes || typeof tabTypes.register !== 'function') {
          tabAttempts += 1
          if (tabAttempts < 40) setTimeout(registerFilesTabs, 250)
          return
        }
        try {
          const disposers = []
          for (const definition of [
            {
              id: REMOTE_FILES_ID,
              kind: REMOTE_FILES_KIND,
              patterns: [`${REMOTE_FILES_PREFIX}**`],
              canOpen: (address) => parseRemoteAddress(address, REMOTE_FILES_PREFIX) !== null,
              title: () => t('files.title')
            },
            {
              id: REMOTE_FILE_ID,
              kind: REMOTE_FILE_KIND,
              patterns: [`${REMOTE_FILE_PREFIX}**`],
              canOpen: (address) => parseRemoteAddress(address, REMOTE_FILE_PREFIX) !== null,
              title: (address) => {
                const coords = parseRemoteAddress(address, REMOTE_FILE_PREFIX)
                const base = coords ? coords.path.split('/').filter(Boolean).pop() : ''
                return base || t('files.previewTitle')
              }
            }
          ]) {
            const dispose = tabTypes.register(definition)
            if (typeof dispose === 'function') disposers.push(dispose)
          }
          slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: REMOTE_FILES_ID }, RemoteFilesBody))
          slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: REMOTE_FILE_ID }, RemoteFilePreviewBody))
          slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: REMOTE_FILES_ID }, RemoteFilesTitle))
          slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: REMOTE_FILE_ID }, RemoteFileTitle))
          remoteFilesTabReady = true
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => {
              remoteFilesTabReady = false
              for (const dispose of disposers) {
                try { dispose() } catch {}
              }
            }, 'dsh-ssh-remote.files-tabs')
          }
        } catch (error) {
          console.warn('[dsh-ssh-remote] remote files tab registration failed', error)
        }
      }
      registerFilesTabs()
      const stopRowDecorator = installRemoteRowDecorator()
      if (typeof ctx.effect === 'function') ctx.effect(() => stopRowDecorator, 'dsh-ssh-remote.rows')
    }

