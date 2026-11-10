// part: 84-remote-files -- remote files tab and file preview
    // ── remote files panel ─────────────────────────────────────────────────
    // ZCode's 查看文件 opens the project's file tree. A DSH files tab reads the
    // native workspace directory, which for a remote project is only the local
    // anchor, so the plugin ships its own tab type over SFTP.
    const REMOTE_FILES_KIND = 'ssh-remote-files'
    const REMOTE_FILES_ID = 'dsh-ssh-remote-files'
    const REMOTE_FILE_KIND = 'ssh-remote-file'
    const REMOTE_FILE_ID = 'dsh-ssh-remote-file'
    const REMOTE_FILE_LIMIT = 256 * 1024
    let remoteFilesTabReady = false

    // Tab params are memory-only: a reopened app restores a tab from its
    // contentId. Coordinates therefore live in the address, not in params.
    const REMOTE_FILES_PREFIX = 'dsh-resource://ssh-files/'
    const REMOTE_FILE_PREFIX = 'dsh-resource://ssh-file/'

    function remoteFilesAddress(hostId, path) {
      return `${REMOTE_FILES_PREFIX}${encodeURIComponent(hostId)}/${encodeURIComponent(path)}`
    }

    function remoteFileAddress(hostId, path) {
      return `${REMOTE_FILE_PREFIX}${encodeURIComponent(hostId)}/${encodeURIComponent(path)}`
    }

    function parseRemoteAddress(address, prefix) {
      const text = String(address || '')
      if (!text.startsWith(prefix)) return null
      const rest = text.slice(prefix.length)
      const cut = rest.indexOf('/')
      if (cut < 0) return null
      try {
        const hostId = decodeURIComponent(rest.slice(0, cut))
        const path = decodeURIComponent(rest.slice(cut + 1))
        return hostId && path ? { hostId, path } : null
      } catch {
        return null
      }
    }

    function tabAddress(props) {
      try {
        const info = props?.useTabInfo?.()
        return String(info?.tab?.contentId || info?.tab?.navigation?.address || '')
      } catch {
        return ''
      }
    }

    function RemoteFilesTitle() {
      return t('files.title')
    }

    function RemoteFileTitle(props) {
      const coords = parseRemoteAddress(tabAddress(props), REMOTE_FILE_PREFIX)
      const base = coords ? coords.path.split('/').filter(Boolean).pop() : ''
      return base || t('files.previewTitle')
    }

    function RemoteFileRow({ entry, depth, expanded, onToggle, onOpen }) {
      const style = { paddingLeft: `${8 + depth * 14}px` }
      const name = h('span', { className: 'dsh-ssh-files-name' }, entry.name)
      const icon = h('span', { className: 'dsh-ssh-files-icon' }, h(Icon, { name: entry.dir ? 'folder' : 'file', size: 14 }))
      if (entry.dir) {
        return h('button', {
          type: 'button',
          className: 'dsh-ssh-files-row',
          style,
          title: entry.path,
          'aria-expanded': expanded ? 'true' : 'false',
          onClick: () => onToggle(entry.path)
        },
          h('span', { className: 'dsh-ssh-files-caret' }, h(Icon, { name: 'chevronRight', size: 12 })),
          icon,
          name
        )
      }
      return h('button', {
        type: 'button',
        className: 'dsh-ssh-files-row',
        style,
        title: entry.path,
        onClick: () => onOpen(entry.path)
      },
        h('span', { className: 'dsh-ssh-files-caret' }),
        icon,
        name
      )
    }

    function RemoteFilesBody(props) {
      const coords = parseRemoteAddress(tabAddress(props), REMOTE_FILES_PREFIX)
      const hostId = coords?.hostId || ''
      const root = coords?.path || ''
      const [levels, setLevels] = useState({})
      const [expanded, setExpanded] = useState(() => new Set(root ? [root] : []))
      const pending = useRef(new Set())

      const load = useCallback(async (path) => {
        if (!hostId || !path || pending.current.has(path)) return
        pending.current.add(path)
        setLevels((prev) => ({
          ...prev,
          [path]: prev[path]?.entries ? { ...prev[path], status: 'ready' } : { status: 'loading' }
        }))
        try {
          const data = await api('GET', `/ssh-remote/remote/list?hostId=${encodeURIComponent(hostId)}&path=${encodeURIComponent(path)}`)
          setLevels((prev) => ({ ...prev, [path]: { status: 'ready', entries: data.entries || [] } }))
        } catch (error) {
          setLevels((prev) => ({ ...prev, [path]: { status: 'failed', error: error.message } }))
        } finally {
          pending.current.delete(path)
        }
      }, [hostId])

      useEffect(() => {
        if (root) void load(root)
      }, [root, load])

      const toggle = (path) => {
        setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
        if (!levels[path]) void load(path)
      }

      const openFile = (path) => {
        if (!hostId) return
        try {
          const right = runtimeCtx?.get?.('sidebarRight')
          if (right && typeof right.openResource === 'function') {
            right.openResource(remoteFileAddress(hostId, path), { kind: REMOTE_FILE_KIND })
          } else {
            right?.openTab?.(REMOTE_FILE_KIND, { params: { hostId, path } })
          }
        } catch (error) {
          console.warn('[dsh-ssh-remote] file preview failed', error)
        }
      }

      if (!hostId || !root) {
        return h('div', { className: 'dsh-ssh-files' }, h('p', { className: 'dsh-ssh-files-note' }, t('files.failed')))
      }

      const rows = []
      const walk = (path, depth) => {
        const level = levels[path]
        if (!level || level.status === 'loading') {
          rows.push(h('p', { className: 'dsh-ssh-files-note', key: `loading:${path}` }, t('files.loading')))
          return
        }
        if (level.status === 'failed') {
          rows.push(h('div', { className: 'dsh-ssh-files-failed', key: `failed:${path}` },
            h('p', { className: 'dsh-ssh-files-note' }, `${t('files.failed')}: ${level.error || ''}`),
            h('button', { type: 'button', className: 'dsh-ssh-files-retry', onClick: () => { setLevels((prev) => { const next = { ...prev }; delete next[path]; return next }); void load(path) } }, t('files.retry'))
          ))
          return
        }
        if (level.entries.length === 0) {
          rows.push(h('p', { className: 'dsh-ssh-files-note', key: `empty:${path}` }, t('files.empty')))
          return
        }
        for (const entry of level.entries) {
          rows.push(h(RemoteFileRow, {
            key: entry.path,
            entry,
            depth,
            expanded: expanded.has(entry.path),
            onToggle: toggle,
            onOpen: openFile
          }))
          if (entry.dir && expanded.has(entry.path)) walk(entry.path, depth + 1)
        }
      }
      walk(root, 0)
      return h('div', { className: 'dsh-ssh-files', 'data-dsh-ssh-files': root }, rows)
    }

    function RemoteFilePreviewBody(props) {
      const coords = parseRemoteAddress(tabAddress(props), REMOTE_FILE_PREFIX)
      const hostId = coords?.hostId || ''
      const path = coords?.path || ''
      const [state, setState] = useState({ status: 'loading' })
      const [tick, setTick] = useState(0)

      useEffect(() => {
        if (!hostId || !path) {
          setState({ status: 'failed', error: t('files.failed') })
          return undefined
        }
        let alive = true
        setState({ status: 'loading' })
        void api('GET', `/ssh-remote/remote/read?hostId=${encodeURIComponent(hostId)}&path=${encodeURIComponent(path)}&maxBytes=${REMOTE_FILE_LIMIT}`)
          .then((data) => {
            if (!alive) return
            setState({ status: 'ready', text: data.text || '', truncated: data.truncated === true, binary: data.binary === true })
          })
          .catch((error) => {
            if (alive) setState({ status: 'failed', error: error.message })
          })
        return () => { alive = false }
      }, [hostId, path, tick])

      const head = h('div', { className: 'dsh-ssh-file-head', title: path },
        h('span', { className: 'dsh-ssh-file-path' }, path),
        state.status === 'ready' && state.truncated ? h('span', { className: 'dsh-ssh-file-note' }, t('files.truncated')) : null
      )

      if (state.status === 'loading') {
        return h('div', { className: 'dsh-ssh-file-preview' }, head, h('p', { className: 'dsh-ssh-files-note' }, t('files.loading')))
      }
      if (state.status === 'failed') {
        return h('div', { className: 'dsh-ssh-file-preview' }, head,
          h('p', { className: 'dsh-ssh-files-note' }, `${t('files.failed')}: ${state.error || ''}`),
          h('button', { type: 'button', className: 'dsh-ssh-files-retry', onClick: () => setTick((value) => value + 1) }, t('files.retry'))
        )
      }
      if (state.binary) {
        return h('div', { className: 'dsh-ssh-file-preview' }, head, h('p', { className: 'dsh-ssh-files-note' }, t('files.binary')))
      }
      return h('div', { className: 'dsh-ssh-file-preview' }, head,
        h('pre', { className: 'dsh-ssh-file-code' }, state.text || '')
      )
    }

    // ZCode's row files action: reveal the workspace and open the remote file
    // tree in the right sidebar. openTab needs a session in the active pane, so
    // the call is retried briefly while the workspace navigation settles.
    function openWorkspaceFiles(workspace) {
      const nativeId = String(workspace?.nativeWorkspaceId || '')
      if (!nativeId) return false
      try {
        const ui = runtimeCtx?.get?.('uiWorkspace')
        if (ui && typeof ui.openWorkspace === 'function') ui.openWorkspace(nativeId)
      } catch {
        // the current session may still resolve below
      }
      let right = null
      try { right = runtimeCtx?.get?.('sidebarRight') } catch { right = null }
      if (!right || typeof right.openTab !== 'function') return true
      const hostId = String(workspace.hostId || '')
      const remotePath = String(workspace.remotePath || '')
      const kind = remoteFilesTabReady && hostId && remotePath ? REMOTE_FILES_KIND : 'files'
      let attempts = 0
      const show = () => {
        try {
          if (kind === REMOTE_FILES_KIND && typeof right.openResource === 'function') {
            right.openResource(remoteFilesAddress(hostId, remotePath), { kind: REMOTE_FILES_KIND })
          } else {
            right.openTab('files', {})
          }
        } catch {
          attempts += 1
          if (attempts < 12) setTimeout(show, 120)
        }
      }
      setTimeout(show, 120)
      return true
    }

