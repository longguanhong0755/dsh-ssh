// part: 86-row-decoration -- row decorator, row menu, rename/remove dialogs, directory flow
    function nativeWorkspaceOrder() {
      try {
        const items = runtimeCtx?.get?.('workspaces')?.list?.getSnapshot?.()?.items || []
        return Array.isArray(items) ? items.map((row) => String(row.workspaceId || '')) : []
      } catch {
        return []
      }
    }

    // ZCode's 置顶: the project moves to the front of the sidebar order. DSH
    // keeps workspace order on the Host (`insertBefore`), so the same reorder
    // the native drag writes is used here; the flag is stored with the plugin
    // workspace so the menu can offer 取消置顶 later.
    async function setRowPinned(workspace, pinned) {
      const id = String(workspace?.id || '')
      if (!id) return false
      if (pinned && workspace.nativeWorkspaceId) {
        try {
          const order = nativeWorkspaceOrder()
          const first = order.find((rowId) => rowId && rowId !== String(workspace.nativeWorkspaceId))
          const controller = runtimeCtx?.get?.('workspaces')
          if (first && controller && typeof controller.insertBefore === 'function') {
            await controller.insertBefore(String(workspace.nativeWorkspaceId), first)
          }
        } catch (error) {
          console.warn('[dsh-ssh-remote] workspace reorder failed', error)
        }
      }
      try {
        await api('POST', '/ssh-remote/workspaces/pin', { id, pinned })
        await loadRowMeta(true)
        scheduleRowDecorate(true)
        return true
      } catch (error) {
        console.warn('[dsh-ssh-remote] pin state failed', error)
        return false
      }
    }

    function decorateRemoteRow(row, workspace) {
      const children = Array.from(row.children)
      const folderSlot = children[0]
      let projectText = children[2]
      if (!projectText || !projectText.querySelector('span')) {
        projectText = children.find((node) => node.tagName === 'SPAN'
          && node.querySelector('span')
          && node.textContent === workspace.name) || null
      }
      if (!folderSlot || !projectText) return
      row.setAttribute('data-dsh-ssh-row', workspace.id)
      folderSlot.classList.add('dsh-ssh-cloud-slot')
      const chevronSlot = children[1]
      if (chevronSlot) chevronSlot.classList.add('dsh-ssh-chevron')
      projectText.classList.add('dsh-ssh-project-text')
      const nativeActions = children[3]
      if (nativeActions) nativeActions.classList.add('dsh-ssh-native-actions')

      // Right-click belongs to the ZCode project menu, not the native row's.
      if (!row.__dshSshContextMenu) {
        row.__dshSshContextMenu = true
        row.addEventListener('contextmenu', (event) => {
          const currentWorkspace = row.__dshSshWorkspace
          if (!currentWorkspace) return
          event.preventDefault()
          event.stopPropagation()
          openRowMenuAt(currentWorkspace, event.clientX, event.clientY)
        })
      }

      const state = rowIconState(workspace)
      const label = workspace.hostName || workspace.host || ''
      const hideDeviceName = rowMeta.settings?.hideProjectDeviceNames === true
      const statusText = rowStatusLabel(workspace)
      const online = workspace.status?.state === 'running'
      // The native row can be re-rendered by the host at any time, but most
      // 5 s ticks carry identical data. Skip the DOM writes when nothing that
      // this decorator renders has changed.
      const signature = [
        workspace.id,
        state,
        workspace.name,
        label,
        hideDeviceName ? 1 : 0,
        statusText,
        online ? 1 : 0
      ].join('|')
      row.__dshSshWorkspace = workspace
      // Skip only when the row still carries every node this decorator owns; a
      // host re-render can drop them while the data signature is unchanged.
      const decorated = folderSlot.querySelector('svg[data-dsh-ssh-cloud]')
        && projectText.querySelector(':scope > .dsh-ssh-device')
        && projectText.querySelector(':scope > .dsh-ssh-status')
        && row.querySelector(':scope > .dsh-ssh-row-actions')
      if (row.__dshSshSig === signature && decorated) return
      row.__dshSshSig = signature
      // Never touch the host's own nodes: React owns them and a replaced icon
      // makes its later removeChild throw (crashing the workspaces slot). The
      // native folder icon is hidden with CSS; ours is appended next to it.
      let icon = folderSlot.querySelector('svg[data-dsh-ssh-cloud]')
      if (!icon) {
        folderSlot.appendChild(cloudIcon(state))
      } else if (icon.dataset.dshSshCloud !== state) {
        icon.replaceWith(cloudIcon(state))
      }

      const title = projectText.firstElementChild
      if (title) title.classList.add('dsh-ssh-row-title')
      let device = projectText.querySelector(':scope > .dsh-ssh-device')
      if (!device) {
        device = document.createElement('span')
        device.className = 'dsh-ssh-device'
        projectText.appendChild(device)
      }
      if (device.textContent !== label) device.textContent = label
      // ZCode 偏好设置 → 隐藏项目行设备名: keep the label available on hover.
      device.hidden = hideDeviceName
      if (hideDeviceName) {
        device.title = label
        if (projectText.getAttribute('title') !== label) projectText.setAttribute('title', label)
      } else if (projectText.getAttribute('title')) {
        projectText.removeAttribute('title')
      }

      let status = projectText.querySelector(':scope > .dsh-ssh-status')
      if (!status) {
        status = document.createElement('span')
        status.className = 'dsh-ssh-status'
        projectText.appendChild(status)
      }
      if (status.textContent !== statusText) status.textContent = statusText
      status.hidden = statusText === ''

      let actions = row.querySelector(':scope > .dsh-ssh-row-actions')
      if (!actions) {
        actions = document.createElement('span')
        actions.className = 'dsh-ssh-row-actions'
        // ZCode's `virtual-project-actions` order: menu, files, create task.
        const moreButton = rowActionButton('more', t('row.more'))
        const filesButton = rowActionButton('files', t('row.viewFiles'))
        const newButton = rowActionButton('new', t('row.newTask'))
        moreButton.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const currentWorkspace = row.__dshSshWorkspace
          if (currentWorkspace) openRowMenu(currentWorkspace, moreButton)
        })
        filesButton.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const currentWorkspace = row.__dshSshWorkspace
          if (currentWorkspace) openWorkspaceFiles(currentWorkspace)
        })
        newButton.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const currentWorkspace = row.__dshSshWorkspace
          if (currentWorkspace) startNativeSession(currentWorkspace.nativeWorkspaceId)
        })
        actions.appendChild(moreButton)
        actions.appendChild(filesButton)
        actions.appendChild(newButton)
        actions.__dshSshFilesButton = filesButton
        actions.__dshSshNewButton = newButton
        row.appendChild(actions)
      }
      // ZCode renders files/create-task only while the device is online.
      if (actions.__dshSshFilesButton) actions.__dshSshFilesButton.hidden = !online
      if (actions.__dshSshNewButton) actions.__dshSshNewButton.hidden = !online
    }

    function decorateRemoteRows() {
      const remote = rowMeta.workspaces.filter((workspace) => workspace.nativeWorkspaceId)
      if (remote.length === 0) return
      const byNativeId = new Map(remote.map((workspace) => [String(workspace.nativeWorkspaceId), workspace]))
      for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        const key = row.getAttribute('data-row-key') || ''
        const workspace = byNativeId.get(key.slice('workspace:'.length))
        if (!workspace) continue
        try {
          decorateRemoteRow(row, workspace)
        } catch {
          // decoration is best-effort; never break the native row
        }
      }
    }

    let decorateScheduled = false
    function scheduleRowDecorate(force = false) {
      // Nobody can see the rows while the window is hidden; skip the request
      // and let visibilitychange refresh once on return.
      if (typeof document !== 'undefined' && document.hidden) return
      if (decorateScheduled) return
      decorateScheduled = true
      const run = () => {
        decorateScheduled = false
        void loadRowMeta(force).then(() => {
          try { decorateRemoteRows() } catch { /* ignore */ }
        })
      }
      // requestAnimationFrame is paused while the window is hidden/minimized;
      // the timer keeps row decoration current in the background too.
      let fired = false
      const once = () => {
        if (fired) return
        fired = true
        run()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(once)
      setTimeout(once, 50)
    }

    function installRemoteRowDecorator() {
      let lastMutation = 0
      const observer = new MutationObserver(() => {
        const now = Date.now()
        if (now - lastMutation < 250) return
        lastMutation = now
        scheduleRowDecorate(false)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      const timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        scheduleRowDecorate(true)
      }, 5000)
      const onVisible = () => {
        if (typeof document !== 'undefined' && !document.hidden) scheduleRowDecorate(true)
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      scheduleRowDecorate(true)
      return () => {
        observer.disconnect()
        clearInterval(timer)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      }
    }

    async function waitForJob(jobId) {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`)
        const job = data.job || data
        if (job && job.state && job.state !== 'running') {
          if (job.state !== 'succeeded') throw new Error(job.error || t('row.removeFailed'))
          return job
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
      }
      throw new Error(t('row.removeFailed'))
    }

    function RenameRemoteDialog({ workspace, onClose }) {
      const [name, setName] = useState(workspace.name || '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const save = async () => {
        const value = name.trim()
        if (!value || busy) return
        setBusy(true); setError('')
        try {
          await api('POST', '/ssh-remote/workspaces/rename', { id: workspace.id, name: value })
          onClose()
          scheduleRowDecorate(true)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, {
        title: t('row.renameTitle'),
        onClose: busy ? undefined : onClose,
        footer: h('div', { className: 'sshR-inline', style: { justifyContent: 'flex-end' } },
          h(Btn, { onClick: onClose, disabled: busy }, t('common.cancel')),
          h(Btn, { kind: 'primary', onClick: () => void save(), disabled: busy || !name.trim() }, t('common.save'))
        )
      },
        h(Field, { label: t('row.name') },
          h(Input, {
            value: name,
            onChange: setName,
            onKeyDown: (event) => { if (event.key === 'Enter') void save() }
          })
        ),
        error ? h('div', { className: 'sshR-errorBox', style: { marginTop: 12 } }, error) : null
      )
    }

    function RemoveRemoteDialog({ workspace, onClose }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const device = workspace.hostName || workspace.host || t('panel.title')
      const remove = async () => {
        if (busy) return
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/action', { op: 'remove', id: workspace.id })
          if (data.jobId) await waitForJob(data.jobId)
          onClose()
          scheduleRowDecorate(true)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, {
        title: t('row.deleteTitle'),
        onClose: busy ? undefined : onClose,
        footer: h('div', { className: 'sshR-inline', style: { justifyContent: 'flex-end' } },
          h(Btn, { onClick: onClose, disabled: busy }, t('common.cancel')),
          h(Btn, { kind: 'danger', onClick: () => void remove(), disabled: busy }, busy ? t('row.deleting') : t('common.delete'))
        )
      },
        h('p', { className: 'sshR-sub', style: { margin: '0 0 10px' } }, t('row.deleteBody', { device })),
        h('p', { className: 'sshR-sub', style: { margin: 0 } }, workspace.name),
        error ? h('div', { className: 'sshR-errorBox', style: { marginTop: 12 } }, error) : null
      )
    }

    function RemoteRowMenu() {
      const [state, setState] = useState({ ...rowMenuFlow.snapshot })
      useEffect(() => rowMenuFlow.subscribe(() => setState({ ...rowMenuFlow.snapshot })), [])
      useEffect(() => {
        if (!state.open) return undefined
        const onDown = (event) => {
          if (event.target?.closest?.('.dsh-ssh-row-menu, .zc-overlay')) return
          rowMenuFlow.close()
        }
        const onKey = (event) => { if (event.key === 'Escape') rowMenuFlow.close() }
        document.addEventListener('mousedown', onDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          window.removeEventListener('keydown', onKey)
        }
      }, [state.open])
      if (!state.open || !state.workspace) return null
      if (state.mode === 'rename') {
        return h(RenameRemoteDialog, { workspace: state.workspace, onClose: () => rowMenuFlow.close() })
      }
      if (state.mode === 'remove') {
        return h(RemoveRemoteDialog, { workspace: state.workspace, onClose: () => rowMenuFlow.close() })
      }
      const workspace = state.workspace
      const online = workspace.status?.state === 'running'
      const host = rowMeta.hosts.find((row) => row.id === workspace.hostId) || null
      const pinned = workspace.pinned === true
      const entries = []
      // ZCode `virtual-project-row` menu: online tasks first, then the device /
      // project actions; files and create-task disappear with the connection.
      if (online) {
        entries.push(h('button', {
          key: 'create-task',
          type: 'button',
          className: 'dsh-ssh-menu-item',
          onClick: () => { rowMenuFlow.close(); startNativeSession(workspace.nativeWorkspaceId) }
        }, h(Icon, { name: 'plus', size: 14 }), t('row.newTask')))
        entries.push(h('button', {
          key: 'files',
          type: 'button',
          className: 'dsh-ssh-menu-item',
          onClick: () => { rowMenuFlow.close(); openWorkspaceFiles(workspace) }
        }, h(Icon, { name: 'folder', size: 14 }), t('row.viewFiles')))
        entries.push(h('div', { key: 'sep-online', className: 'dsh-ssh-menu-sep', role: 'separator' }))
      }
      if (host) {
        entries.push(h('button', {
          key: 'device-settings',
          type: 'button',
          className: 'dsh-ssh-menu-item',
          onClick: () => { rowMenuFlow.close(); openDeviceSettings(host.id) }
        }, h(Icon, { name: 'server', size: 14 }), t('row.deviceSettings')))
      }
      entries.push(h('button', {
        key: 'edit',
        type: 'button',
        className: 'dsh-ssh-menu-item',
        onClick: () => rowMenuFlow.set({ mode: 'rename' })
      }, h(Icon, { name: 'edit', size: 14 }), t('row.edit')))
      entries.push(h('button', {
        key: 'pin',
        type: 'button',
        className: 'dsh-ssh-menu-item',
        onClick: () => { rowMenuFlow.close(); void setRowPinned(workspace, !pinned) }
      }, h(Icon, { name: 'pin', size: 14 }), pinned ? t('row.unpin') : t('row.pin')))
      entries.push(h('button', {
        key: 'delete',
        type: 'button',
        className: 'dsh-ssh-menu-item danger',
        onClick: () => rowMenuFlow.set({ mode: 'remove' })
      }, h(Icon, { name: 'trash', size: 14 }), t('row.delete')))
      return h('div', {
        className: 'zc-ui dsh-ssh-row-menu',
        style: { left: state.rect?.x ?? 120, top: state.rect?.y ?? 120 },
        role: 'menu',
        onMouseDown: (event) => event.stopPropagation()
      }, entries)
    }

    async function pickNativeLocalDirectory() {
      try {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__
        if (desktop && typeof desktop.pick === 'function') {
          const path = await desktop.pick()
          return path ? { kind: 'picked', path } : { kind: 'cancelled' }
        }
      } catch (error) {
        return { kind: 'error', error: errorMessage(error) }
      }
      try {
        const workspace = runtimeCtx?.get?.('uiWorkspace')
        if (workspace && typeof workspace.pickDirectory === 'function') {
          const path = await workspace.pickDirectory()
          return path ? { kind: 'picked', path } : { kind: 'cancelled' }
        }
      } catch (error) {
        return { kind: 'error', error: errorMessage(error) }
      }
      return { kind: 'unavailable' }
    }

    function DirectoryFlow(props) {
      const { open, onPicked, onCancel, openNativeWorkspace, defaultDeviceId } = props
      if (!open) return null
      return h(CreateProjectDialog, {
        onClose: onCancel,
        onLocalCreate: typeof onPicked === 'function' ? onPicked : null,
        localAvailable: typeof onPicked === 'function',
        openNativeWorkspace,
        defaultDeviceId: defaultDeviceId || 'local'
      })
    }

    function PanelIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 4, width: 18, height: 6, rx: 2 }),
        h('rect', { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
        h('path', { d: 'M7 7h.01M7 17h.01' }),
        h('path', { d: 'M12 7h5M12 17h5' })
      )
    }

