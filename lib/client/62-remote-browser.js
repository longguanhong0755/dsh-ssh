// part: 62-remote-browser -- remote directory browser plus shared dialog primitives
    // ── Remote directory browser (shared by create modal/picker) ───────────
    // Mirrors ZCode's FP embedded browser: path form, go/hidden toggles and a
    // plain list with a ".." row.
    function RemoteBrowser({ hostId, value, onChange, request, allowMissing = false, onNavState }) {
      const [listing, setListing] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [draft, setDraft] = useState(value || '~')
      const [showHidden, setShowHidden] = useState(false)

      const load = useCallback(async (path) => {
        if (!hostId) return
        setLoading(true); setError('')
        try {
          const data = await api('GET', `/ssh-remote/remote/list?hostId=${encodeURIComponent(hostId)}&path=${encodeURIComponent(path || '~')}`)
          setListing(data)
          setDraft(data.path)
          onChange(data.path)
          onNavState?.(true)
        } catch (err) {
          setError(errorMessage(err))
          onNavState?.(false)
        } finally {
          setLoading(false)
        }
      }, [hostId])

      useEffect(() => {
        if (hostId) void load(value || '~')
      }, [hostId])

      // A quick-open chip changes the controlled path from outside; navigate
      // the listing to it without turning every keystroke into a request.
      useEffect(() => {
        if (hostId && request?.path) void load(request.path)
      }, [request?.key])

      const entries = (listing?.entries || []).filter((entry) => entry.dir && (showHidden || !entry.hidden))

      return h('div', { className: 'zc-browser' },
        h('div', { className: 'zc-browser-form' },
          h('input', {
            className: 'zc-input mono',
            value: draft,
            placeholder: t('z.folder.pathPlaceholder'),
            'aria-label': t('z.folder.pathPlaceholder'),
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void load(draft.trim() || '~')
            }
          }),
          h('div', { className: 'zc-browser-actions' },
            h('button', { type: 'button', className: 'zc-btn zc-btn-secondary', disabled: loading || !draft.trim(), onClick: () => void load(draft.trim() || '~') }, t('z.browserGo')),
            h('button', {
              type: 'button',
              className: `zc-btn ${showHidden ? 'zc-btn-secondary' : 'zc-btn-ghost'}`,
              'aria-pressed': showHidden ? 'true' : 'false',
              onClick: () => setShowHidden((old) => !old)
            }, showHidden ? t('z.browserHideHidden') : t('z.browserShowHidden'))
          )
        ),
        error ? h('div', { className: 'zc-browser-error' }, t('z.folder.errorUnavailable')) : null,
        h('div', { className: 'zc-browser-list' },
          listing?.parent ? h('button', { type: 'button', className: 'zc-browser-row zc-browser-up', onClick: () => void load(listing.parent) },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, t('z.browserParent'))
          ) : null,
          loading ? h('div', { className: 'zc-browser-empty' }, t('z.browserLoading')) : null,
          !loading && entries.length === 0 ? h('div', { className: 'zc-browser-empty' }, t('z.browserNoSubdirs')) : null,
          entries.map((entry) => h('button', {
            key: entry.path,
            type: 'button',
            className: 'zc-browser-row',
            onClick: () => void load(entry.path)
          },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, entry.name)
          ))
        )
      )
    }

    // Lucide icon set used by ZCode's dialog (stroke 2, 24px viewBox).
    const ICONS = {
      search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
      terminal: [['path', { d: 'm4 17 6-6-6-6' }], ['path', { d: 'M12 19h8' }]],
      plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
      folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
      folderPlus: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }], ['path', { d: 'M12 10v6' }], ['path', { d: 'M9 13h6' }]],
      monitor: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
      desktop: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
      check: [['path', { d: 'M20 6 9 17l-5-5' }]],
      x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
      minus: [['path', { d: 'M5 12h14' }]],
      loader: [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
      alert: [['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }], ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]],
      eye: [['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
      gitBranch: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
      eyeOff: [['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' }], ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }], ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' }], ['path', { d: 'm2 2 20 20' }]],
      chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
      chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
      chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
      server: [['rect', { x: 2, y: 2, width: 20, height: 8, rx: 2, ry: 2 }], ['rect', { x: 2, y: 14, width: 20, height: 8, rx: 2, ry: 2 }], ['path', { d: 'M6 6h.01' }], ['path', { d: 'M6 18h.01' }]],
      cloud: [['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }]],
      cloudOff: [['path', { d: 'M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057' }], ['path', { d: 'M18.796 18.796A4.5 4.5 0 0 1 17.5 19H9a7 7 0 0 1-5.66-11.06' }], ['path', { d: 'm2 2 20 20' }]],
      cloudAlert: [['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }], ['path', { d: 'M12 12v4' }], ['path', { d: 'M12 19h.01' }]],
      cloudX: [['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }], ['path', { d: 'm15 11-4 4' }], ['path', { d: 'm11 11 4 4' }]],
      more: [['path', { d: 'M5 12h.01' }], ['path', { d: 'M12 12h.01' }], ['path', { d: 'M19 12h.01' }]],
      squareTerminal: [['path', { d: 'm7 11 2-2-2-2' }], ['path', { d: 'M11 13h4' }], ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }]],
      box: [['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }], ['path', { d: 'm3.3 7 8.7 5 8.7-5' }], ['path', { d: 'M12 22V12' }]],
      file: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }]],
      edit: [['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }], ['path', { d: 'm15 5 4 4' }]],
      pin: [['path', { d: 'M12 17v5' }], ['path', { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z' }]],
      trash: [['path', { d: 'M3 6h18' }], ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }], ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }]],
      copy: [['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }], ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]],
      power: [['path', { d: 'M12 2v10' }], ['path', { d: 'M18.4 6.6a9 9 0 1 1-12.77.04' }]],
      rotate: [['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }], ['path', { d: 'M3 3v5h5' }]],
      scrollText: [['path', { d: 'M15 12h-5' }], ['path', { d: 'M15 8h-5' }], ['path', { d: 'M19 17V5a2 2 0 0 0-2-2H4' }], ['path', { d: 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3' }]]
    }
    function Icon({ name, size = 14, className }) {
      const children = (ICONS[name] || []).map(([tag, attrs], index) => h(tag, { key: index, ...attrs }))
      return h('svg', {
        className,
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, children)
    }

    function Spinner({ className = 'zc-spin' }) {
      return h(Icon, { name: 'loader', size: 14, className })
    }

    // ZCode's Bj status badge.
    function StatusBadge({ tone = 'neutral', children, dot = true, icon }) {
      return h('span', { className: `zc-badge zc-badge-${tone}` },
        icon ? h(Icon, { name: icon, size: 12 }) : (dot ? h('span', { className: 'zc-badge-dot' }) : null),
        h('span', null, children)
      )
    }

    // ZCode's yVn wizard indicator.
    function WizardSteps({ step }) {
      const current = step === 'directory' ? 2 : (step === 'device' ? 0 : 1)
      const labels = [t('z.wizard.device'), t('z.wizard.connect'), t('z.wizard.directory')]
      return h('nav', { className: 'zc-wizard-nav', 'aria-label': t('z.wizard') },
        h('ol', { className: 'zc-wizard' }, labels.map((label, index) =>
          h('li', { key: label, 'data-current': index === current ? 'true' : undefined },
            index > 0 ? h('span', { className: 'zc-wizard-sep' }) : null,
            h('span', { className: 'zc-wizard-dot' }, index < current ? h(Icon, { name: 'check', size: 10 }) : String(index + 1)),
            h('span', null, label)
          )))
      )
    }

    function FieldError({ message }) {
      if (!message) return null
      return h('p', { className: 'zc-field-err' }, h(Icon, { name: 'alert', size: 14 }), h('span', null, message))
    }

    function EyeIcon({ off }) {
      return h(Icon, { name: off ? 'eyeOff' : 'eye', size: 16 })
    }

    function FolderIcon({ size = 14 }) {
      return h(Icon, { name: 'folder', size })
    }

    function emptyConnectForm() {
      return { ...emptyHostForm(), username: '', password: '' }
    }

    // ZCode's `dd` validation rule for `wsl.user`.
    function isValidWslUserClient(value) {
      const text = String(value ?? '').trim()
      if (text.length === 0 || text.length > 64) return false
      if (text.includes(':') || text.includes('/') || text.includes('\\')) return false
      for (const character of text) {
        const codePoint = character.codePointAt(0) ?? 0
        if (codePoint < 32 || codePoint === 127) return false
      }
      return true
    }

    function kindOfrow(row) {
      return row?.kind === 'wsl' || row?.kind === 'docker' ? row.kind : 'ssh'
    }

    // ZCode `gmt` target label.
    function targetLabelFor(row) {
      if (!row) return ''
      const kind = kindOfrow(row)
      if (kind === 'wsl') {
        const distro = row.distro === undefined ? row.wslDistro : row.distro
        const user = row.user === undefined ? row.wslUser : row.user
        return ['WSL', String(distro || '').trim() || 'default', String(user || '').trim()].filter(Boolean).join(' · ')
      }
      if (kind === 'docker') {
        const container = row.dockerMode === 'manual' ? row.manualContainer : (row.container || row.manualContainer)
        return `Docker · ${String(container || '').trim() || 'container'}`
      }
      return `${row.username || 'user'}@${row.host || 'host'}:${row.port || 22}`
    }

    function kindLabel(kind) {
      return kind === 'wsl' ? t('z.wsl') : kind === 'docker' ? t('z.docker') : t('z.ssh')
    }

    function kindIconName(kind) {
      return kind === 'wsl' ? 'squareTerminal' : kind === 'docker' ? 'box' : 'server'
    }

    // ZCode `availableKinds`: WSL only on Windows desktops, Docker always.
    // The renderer UA is only a first-paint guess; the backend's
    // `process.platform` is authoritative (a browser on Windows can be
    // driving a DSH host that runs on macOS).
    let backendPlatform = ''
    const platformListeners = new Set()
    function setBackendPlatform(value) {
      const next = String(value || '').trim()
      if (!next || next === backendPlatform) return
      backendPlatform = next
      for (const listener of platformListeners) listener()
    }
    function useBackendPlatform() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        platformListeners.add(listener)
        return () => platformListeners.delete(listener)
      }, [])
      return backendPlatform
    }
    function isWindowsClient() {
      return typeof navigator !== 'undefined' && /Windows/iu.test(navigator.userAgent || '')
    }
    function supportsWsl() {
      return backendPlatform ? backendPlatform === 'win32' : isWindowsClient()
    }
    function visibleHosts(rows) {
      return (rows || []).filter((row) => supportsWsl() || kindOfrow(row) !== 'wsl')
    }

    // ZCode `Vvt`/`Hvt`: parse `ssh [-p port] target` commands and plain
    // user@host:port targets pasted into the host field.
    function parseSshPaste(text) {
      const value = String(text ?? '').trim()
      if (!value) return null
      const commandMatch = /^ssh\s+(.+)$/u.exec(value)
      if (commandMatch) {
        const tokens = commandMatch[1].split(/\s+/u)
        let target = ''
        let port = ''
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index]
          if (token === '-p') {
            port = tokens[index + 1] ?? ''
            if (!port) return null
            index += 1
          } else if (token.startsWith('-') || target) return null
          else target = token
        }
        if (!target) return null
        const parsed = parseSshPasteTarget(target)
        if (!parsed) return null
        if (port && !/^\d+$/u.test(port)) return null
        return port ? { ...parsed, port } : parsed
      }
      const parsed = parseSshPasteTarget(value)
      return parsed && (parsed.username || parsed.port) ? parsed : null
    }

    function parseSshPasteTarget(value) {
      const match = /^(?:([^@\s:/]+)@)?(\[[^\]\s]+\]|[^:@\s[\]/]+)(?::([^:\s]+))?$/u.exec(value)
      if (!match) return null
      const [, username, rawHost = '', port] = match
      if (port && !/^\d+$/u.test(port)) return null
      if (port && !(Number(port) >= 1 && Number(port) <= 65535)) return null
      return {
        host: rawHost.startsWith('[') ? rawHost.slice(1, -1) : rawHost,
        ...(username ? { username } : {}),
        ...(port ? { port } : {})
      }
    }

    // ZCode `remote.phase.channel.<kind>`.
    function phaseChannelLabel(kind) {
      return kind === 'wsl' ? t('z.phase.wsl') : kind === 'docker' ? t('z.phase.docker') : t('z.phase.ssh')
    }

    // ZCode 3.17.2 log tags ([source-server:*] → [ssh-remote:*]) mapped onto
    // the five wizard stages; percent lines drive the transfer progress bar.
    const STAGE_TAG_MAP = {
      probe: 'channel',
      channel: 'channel',
      'directory-record': 'identify',
      preflight: 'deploy',
      download: 'deploy',
      upload: 'deploy',
      extract: 'deploy',
      'verify-archive': 'deploy',
      verify: 'deploy',
      install: 'deploy',
      daemon: 'handshake',
      restart: 'handshake',
      'protocol-handshake': 'handshake',
      'publish-online': 'handshake',
      workspace: 'workspace'
    }
    const TAGGED_LINE_RE = /^\[ssh-remote:([a-z-]+)\]\s*/u

    function parseStageTags(lines) {
      const info = {}
      for (const raw of lines) {
        const match = TAGGED_LINE_RE.exec(raw)
        if (!match) continue
        const stage = STAGE_TAG_MAP[match[1]]
        if (!stage) continue
        const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/u)
        const sizeMatch = raw.match(/(\d+(?:\.\d+)?)\s*MB/u)
        info[stage] = {
          rawPhase: match[1],
          line: raw.replace(TAGGED_LINE_RE, ''),
          percent: percentMatch ? percentMatch[1] : null,
          detail: sizeMatch ? `${sizeMatch[1]} MB` : null
        }
      }
      return info
    }

    // ZCode `iyt`: per-stage sub-messages from the flow state machine.
    function stageSubMessage(row, ctx) {
      const tagInfo = ctx.tags[row.key]
      if (row.key === 'channel' && row.status === 'complete') {
        const kind = ctx.kind === 'server' ? '' : ctx.kind
        return kind ? t(`z.phaseSub.${kind}`) : t('z.status.connected')
      }
      if (row.key === 'identify') {
        if (ctx.device) return t('z.phaseSub.identifyExisting', { device: ctx.device })
        if (ctx.confirmPending) return t('z.phaseSub.identifyNew')
        return ''
      }
      if (row.key === 'deploy') {
        if (ctx.failed) return t('z.phaseSub.uploadFailed', { reason: ctx.error || '' })
        if (ctx.confirmPending) return t('z.phaseSub.deployWaitingConfirm')
        if (row.status === 'active' && tagInfo) {
          const map = {
            extract: 'z.phaseSub.extracting',
            'verify-archive': 'z.phaseSub.verifyingArchive',
            verify: 'z.phaseSub.verifyingFiles',
            install: 'z.phaseSub.installed'
          }
          if (tagInfo.rawPhase === 'download' || tagInfo.rawPhase === 'upload') {
            const base = t(tagInfo.rawPhase === 'download' ? 'z.phaseSub.downloading' : 'z.phaseSub.uploading')
            // The package phases carry live progress (percent for uploads and
            // the Node download, MB for the local dependency install); drop it
            // and the row sits on a static 正在下载安装包 for minutes.
            if (tagInfo.percent) return `${base} ${tagInfo.percent}%`
            if (tagInfo.detail) return `${base}（${tagInfo.detail}）`
            return base
          }
          if (map[tagInfo.rawPhase]) return t(map[tagInfo.rawPhase])
          return tagInfo.line || ''
        }
        return ''
      }
      if (row.key === 'handshake' && row.status === 'active' && tagInfo?.rawPhase === 'restart') {
        return t('z.phaseSub.restarting')
      }
      if (row.key === 'handshake' && row.status === 'complete') {
        return t('z.phaseSub.readyOnline')
      }
      if (row.key === 'workspace' && row.status === 'active' && ctx.path) {
        return t('z.phaseSub.workspaceReading', { path: ctx.path })
      }
      return ''
    }

    // ZCode's "新建连接" flow, rebuilt from its renderer components:
    // nVn (device list) -> Smt/rmt (SSH form) -> hmt (connection log) ->
    // directory picker. The dialog shell mirrors OVn (max-w-2xl, top 10vh,
    // rounded-2xl, p-4/p-6, footer 取消 / 添加并连接).
    // ZCode 3.17.2 `jI`/`fI`: the create-project dialog doubles as the remote
    // folder picker. `project.browse` is the title while the embedded browser
    // is open; the footer belongs to the browser in that mode.
    // ZCode uses Radix popovers (portaled). DSH's dialog has overflow:hidden and
    // a transform, so menus are rendered as fixed siblings of the dialog and
    // flipped upward when they would leave the viewport.
    function AnchoredMenu({ open, anchorRef, width, align = 'start', className, onClose, children, estimatedHeight = 280 }) {
      const [box, setBox] = useState(null)
      useEffect(() => {
        if (!open) { setBox(null); return undefined }
        const update = () => {
          const rect = anchorRef.current?.getBoundingClientRect()
          if (!rect) return
          const menuWidth = width || rect.width
          let left = align === 'end' ? rect.right - menuWidth : rect.left
          left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))
          // Keep the whole menu on screen: flip above the anchor when there is
          // not enough room below, otherwise clamp to the viewport.
          const menuHeight = Math.min(estimatedHeight, window.innerHeight - 16)
          let top = rect.bottom + 6
          if (top + menuHeight > window.innerHeight - 8) {
            top = Math.max(8, Math.min(rect.top - menuHeight - 6, window.innerHeight - menuHeight - 8))
          }
          setBox({ position: 'fixed', left, top, width: menuWidth, zIndex: 72 })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open, anchorRef, width, align, estimatedHeight])
      if (!open || !box) return null
      return h('div', {
        className: `zc-floating-menu${className ? ` ${className}` : ''}`,
        style: box,
        'data-zc-popover': 'true',
        onMouseDown: (event) => event.stopPropagation()
      }, children)
    }

    function DeviceLabel({ label, status, local = false }) {
      return h('span', { className: 'zc-device-label' },
        h(Icon, { name: local ? 'desktop' : 'server', size: 16 }),
        h('span', { className: 'zc-device-label-name' }, label),
        status
          ? h('span', { className: 'zc-device-status', 'data-status': status },
              h('span', { className: 'zc-device-status-dot' }),
              h('span', { className: status === 'online' ? 'sr-only' : '' }, t(`z.project.deviceStatus.${status}`)))
          : null
      )
    }

    function projectBaseName(path) {
      const parts = String(path || '').split(/[\\/]/u).filter(Boolean)
      return parts[parts.length - 1] || String(path || '')
    }

