// part: 64-create-dialog -- CreateProjectDialog
    function CreateProjectDialog({
      onClose,
      onCreated,
      onLocalCreate,
      openNativeWorkspace,
      localAvailable = false,
      defaultDeviceId = 'local',
      initialHosts = null
    }) {
      const [allHosts, setHosts] = useState(initialHosts || [])
      useBackendPlatform()
      const hosts = useMemo(() => visibleHosts(allHosts), [allHosts])
      const [workspaces, setWorkspaces] = useState([])
      const [settings, setSettings] = useState(null)
      const [name, setName] = useState('')
      const [deviceId, setDeviceId] = useState(defaultDeviceId || 'local')
      const [roots, setRoots] = useState([])
      const [menuOpen, setMenuOpen] = useState(false)
      const [browseOpen, setBrowseOpen] = useState(false)
      const [localBrowseOpen, setLocalBrowseOpen] = useState(false)
      const [localPath, setLocalPath] = useState('')
      const [browsePath, setBrowsePath] = useState('~')
      const [dirReady, setDirReady] = useState(false)
      const [showExisting, setShowExisting] = useState(false)
      const [addOpen, setAddOpen] = useState(false)
      const [trustOpen, setTrustOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [connecting, setConnecting] = useState(false)
      const [error, setError] = useState('')
      const [jobId, setJobId] = useState('')
      const menuRef = useRef(null)
      const deviceButtonRef = useRef(null)
      const mounted = useRef(true)

      useEffect(() => () => { mounted.current = false }, [])
      // The directory flow is the other surface that can host the dialog; the
      // shell pill uses this to reopen a minimized connection from here.
      useEffect(() => setDialogOpener(() => setAddOpen(true)), [])

      const load = useCallback(async (selectId) => {
        try {
          const [hostData, workspaceData, settingsData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0'),
            api('GET', '/ssh-remote/settings').catch(() => ({ settings: null }))
          ])
          if (!mounted.current) return
          const list = hostData.hosts || []
          setHosts(list)
          setWorkspaces(workspaceData.workspaces || [])
          setSettings(settingsData.settings || null)
          const pickable = visibleHosts(list)
          // ZCode 设为默认连接 preselects that device when a project is created.
          const preferred = String(settingsData.settings?.defaultHostId || '')
          if (selectId) setDeviceId(selectId)
          else if (deviceId === 'local' && pickable.some((row) => row.id === preferred)) setDeviceId(preferred)
          else if (pickable.length > 0 && !localAvailable && (deviceId === 'local' || !pickable.some((row) => row.id === deviceId))) setDeviceId(pickable[0].id)
          else if (deviceId !== 'local' && !pickable.some((row) => row.id === deviceId)) setDeviceId(localAvailable ? 'local' : (pickable[0]?.id || 'local'))
        } catch (err) {
          if (mounted.current) setError(errorMessage(err))
        }
      }, [deviceId])

      useEffect(() => { void load() }, [])

      useEffect(() => {
        if (!menuOpen) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-zc-popover="true"]')) return
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [menuOpen])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          // The add-device wizard is a modal above this dialog and owns Escape.
          if (addOpen) return
          // So does the folder-trust confirmation (ZCode asks before saving).
          if (trustOpen) { setTrustOpen(false); return }
          if (menuOpen) { setMenuOpen(false); return }
          // ZCode's project dialog closes as a whole; the embedded folder
          // browser is not a step of it (取消 returns to the form instead).
          if (busy || connecting) return
          onClose?.()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [addOpen, trustOpen, menuOpen, busy, connecting, onClose])

      const host = hosts.find((row) => row.id === deviceId) || null
      const isLocal = deviceId === 'local' || !host

      const statusOf = (row) => {
        if (!row) return 'offline'
        const rows = workspaces.filter((item) => item.hostId === row.id)
        if (rows.some((item) => item.status?.state === 'running')) return 'online'
        if (row.connectionStatus === 'connecting' || rows.some((item) => item.status?.state === 'starting')) return 'connecting'
        if (row.connectionStatus === 'failed' || rows.some((item) => item.status?.state === 'error' || item.status?.state === 'unreachable')) return 'failed'
        if (row.connectionStatus === 'pending') return 'pending'
        return 'offline'
      }
      const hostStatus = host ? statusOf(host) : 'offline'
      const existing = host ? workspaces.filter((row) => row.hostId === host.id) : []

      const chooseDevice = (nextId) => {
        setMenuOpen(false)
        if (nextId === deviceId) return
        if (roots.length > 0 && !window.confirm(`${t('z.project.switchDevice')}\n${t('z.project.switchDeviceDescription')}`)) return
        setRoots([])
        setShowExisting(false)
        setError('')
        setDeviceId(nextId)
      }

      const pickLocal = async () => {
        if (!localAvailable) return
        setBusy(true); setError('')
        try {
          // Prefer the renderer's own OS dialog (Electron preload), then the
          // Host's native picker, and only then the plugin's HTTP fallback.
          const native = await pickNativeLocalDirectory()
          if (native.kind === 'picked') {
            setRoots([native.path])
            setShowExisting(false)
            return
          }
          if (native.kind === 'cancelled') return
          const data = await api('POST', '/ssh-remote/local/pick', {})
          if (data?.path) {
            setRoots([data.path])
            setShowExisting(false)
          } else if (data?.cancelled) {
            return
          } else {
            // No OS chooser on this Host (browse backend) — keep the flow
            // alive with the in-app folder browser instead of a dead end.
            setLocalPath(roots[0] || '')
            setLocalBrowseOpen(true)
          }
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const openRemoteBrowser = async () => {
        if (!host) return
        setError('')
        const recent = workspaces.find((row) => row.hostId === host.id)
        const startPath = roots[0] || recent?.remotePath || host.defaultPath || '~'
        if (hostStatus === 'online') {
          setBrowsePath(startPath)
          setDirReady(false)
          setBrowseOpen(true)
          return
        }
        // ZCode `project.connectAndBrowse`: non-online devices connect before
        // the picker opens.
        setConnecting(true)
        try {
          await api('POST', '/ssh-remote/hosts/test', { host: { id: host.id } })
          if (!mounted.current) return
          setBrowsePath(startPath)
          setDirReady(false)
          setBrowseOpen(true)
          void load()
        } catch (err) {
          if (mounted.current) setError(errorMessage(err))
        } finally {
          if (mounted.current) setConnecting(false)
        }
      }

      const pickFolder = () => {
        if (busy || connecting) return
        if (isLocal) void pickLocal()
        else void openRemoteBrowser()
      }

      const openWorkspace = async (workspace) => {
        if (!workspace) return
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/open', { id: workspace.id })
          const target = data.workspace || workspace
          const opened = target.nativeWorkspaceId ? openNativeWorkspace?.(target.nativeWorkspaceId) : false
          onCreated?.(target)
          if (!opened) {
            setError(t('z.openFailed'))
            return
          }
          onClose?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const create = () => {
        if (roots.length !== 1 || busy || connecting || jobId) return
        // ZCode's project editor confirms every new project's folders before
        // saving (hyt); 取消 returns to the form, not out of the dialog.
        setTrustOpen(true)
      }

      const runCreate = async () => {
        if (roots.length !== 1 || busy || connecting || jobId) return
        if (isLocal) {
          if (!onLocalCreate) {
            setError(t('z.project.createFailed'))
            return
          }
          onLocalCreate(roots[0])
          return
        }
        const path = roots[0]
        const duplicate = workspaces.find((row) => row.hostId === host.id && row.remotePath === path)
        if (duplicate) {
          void openWorkspace(duplicate)
          return
        }
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/create', {
            hostId: host.id,
            remotePath: path,
            name: name.trim() || undefined,
            syncCredentials: settings ? settings.syncCredentials !== false : true,
            createIfMissing: settings ? settings.createIfMissing !== false : true
          })
          if (!mounted.current) return
          setJobId(data.jobId)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const folderMode = browseOpen || localBrowseOpen
      const title = folderMode ? t('z.folder.title') : t('z.project.create')
      const canCreate = roots.length === 1 && !busy && !connecting && !jobId

      const headerRow = h('div', { className: 'zc-create-head' },
        h('h2', { className: 'zc-create-title', id: 'zc-project-title' }, title),
        h('button', {
          type: 'button',
          className: 'zc-create-close',
          title: t('common.close'),
          'aria-label': t('common.close'),
          onClick: () => {
            if (busy || connecting) return
            onClose?.()
          }
        }, h(Icon, { name: 'x', size: 16 }))
      )

      const deviceMenuItems = [
        localAvailable ? h('button', {
          key: 'local',
          type: 'button',
          role: 'option',
          className: 'zc-select-item',
          'data-selected': isLocal ? 'true' : 'false',
          onClick: () => chooseDevice('local')
        },
          isLocal ? h('span', { className: 'zc-select-check' }, h(Icon, { name: 'check', size: 14 })) : null,
          h(DeviceLabel, { label: t('z.project.thisComputer'), local: true })
        ) : null,
        ...hosts.map((row) => h('button', {
          key: row.id,
          type: 'button',
          role: 'option',
          className: 'zc-select-item',
          'data-device-id': row.id,
          'data-selected': deviceId === row.id ? 'true' : 'false',
          onClick: () => chooseDevice(row.id)
        },
          deviceId === row.id ? h('span', { className: 'zc-select-check' }, h(Icon, { name: 'check', size: 14 })) : null,
          h(DeviceLabel, { label: row.name, status: statusOf(row) })
        )),
        hosts.length > 0 ? h('div', { key: 'sep', className: 'zc-select-sep' }) : null,
        h('button', {
          key: 'add',
          type: 'button',
          className: 'zc-select-item zc-select-add',
          onClick: () => { setMenuOpen(false); setAddOpen(true) }
        }, h(Icon, { name: 'plus', size: 16 }), t('z.project.addRemoteDevice'))
      ].filter(Boolean)

      const existingBlock = !isLocal && host
        ? showExisting
          ? h('div', { className: 'zc-folder-list' },
              existing.length > 0
                ? existing.map((row) => h('button', {
                    key: row.id,
                    type: 'button',
                    className: 'zc-folder-add',
                    onClick: () => void openWorkspace(row)
                  },
                    h(Icon, { name: 'folder', size: 16 }),
                    h('span', { className: 'zc-folder-name', title: row.remotePath }, row.name || projectBaseName(row.remotePath)),
                    h('span', { className: 'zc-folder-empty-hint', style: { marginLeft: 'auto' } }, row.remotePath)
                  ))
                : h('p', { className: 'zc-existing-hint', style: { padding: '12px' } }, t('z.project.noExisting')),
              h('button', {
                type: 'button',
                className: 'zc-folder-add',
                onClick: () => setShowExisting(false)
              }, h(Icon, { name: 'chevronLeft', size: 16 }), t('common.back'))
            )
          : h('p', { className: 'zc-existing-hint' },
              t('z.project.existingHint'),
              h('button', {
                type: 'button',
                className: 'zc-link',
                'data-testid': 'virtual-project-existing',
                onClick: () => setShowExisting(true)
              }, t('z.project.existingAction'), h(Icon, { name: 'chevronRight', size: 14 }))
            )
        : null

      const browseButtonLabel = busy
        ? t('common.loading')
        : connecting
          ? t('z.connecting')
          : isLocal
            ? t('z.folder.select')
            : hostStatus === 'online' ? t('z.folder.select') : t('z.project.connectAndBrowse')
      const browseHint = isLocal
        ? t('z.project.browseHint')
        : hostStatus === 'online'
          ? t('z.project.browseHint')
          : t('z.project.connectAndBrowseHint', { status: t(`z.project.deviceStatus.${hostStatus}`) })

      const createBody = h('div', { className: 'zc-create-body' },
        h('div', { className: 'zc-create-field' },
          h('label', { className: 'zc-create-label', htmlFor: 'zc-project-name' }, t('z.project.name')),
          h('input', {
            id: 'zc-project-name',
            className: 'zc-input zc-create-input',
            'data-testid': 'virtual-project-name',
            autoFocus: true,
            value: name,
            placeholder: t('z.project.new'),
            disabled: busy || Boolean(jobId),
            onChange: (event) => setName(event.target.value)
          })
        ),
        h('div', { className: 'zc-create-field' },
          h('span', { className: 'zc-create-label' }, t('z.project.device')),
          h('div', { className: 'zc-select-wrap', ref: menuRef },
            h('button', {
              type: 'button',
              id: 'zc-project-device',
              ref: deviceButtonRef,
              className: 'zc-select-trigger',
              'data-testid': 'virtual-project-device',
              'aria-expanded': menuOpen ? 'true' : 'false',
              disabled: busy || Boolean(jobId),
              onClick: () => setMenuOpen((old) => !old)
            },
              h(DeviceLabel, {
                label: isLocal ? t('z.project.thisComputer') : (host?.name || deviceId),
                status: isLocal ? null : hostStatus,
                local: isLocal
              }),
              h(Icon, { name: 'chevronDown', size: 14 })
            )
          )
        ),
        existingBlock,
        h('div', { className: 'zc-folders' },
          h('span', { className: 'zc-create-label' }, t('z.project.folders')),
          roots.length > 0
            ? h('div', { className: 'zc-folder-list', 'data-testid': 'virtual-project-roots' },
                roots.map((path) => h('div', { key: path, className: 'zc-folder-row', 'data-testid': 'virtual-project-root-row' },
                  h(Icon, { name: 'folder', size: 16 }),
                  h('span', {
                    className: `zc-folder-name${isLocal ? ' break' : ''}`,
                    title: path,
                    'data-testid': 'virtual-project-root-name'
                  }, isLocal ? path : projectBaseName(path)),
                  h('span', { className: 'zc-primary-badge', 'data-testid': 'virtual-project-primary' }, t('z.project.primary')),
                  h('button', {
                    type: 'button',
                    className: 'zc-btn zc-btn-ghost zc-btn-icon zc-folder-remove',
                    title: t('z.project.removeFolder'),
                    'aria-label': t('z.project.removeFolder'),
                    'data-testid': 'virtual-project-remove-folder',
                    disabled: busy,
                    onClick: () => setRoots([])
                  }, h(Icon, { name: 'x', size: 16 }))
                )),
                h('button', {
                  type: 'button',
                  className: 'zc-folder-add',
                  'data-testid': 'virtual-project-browse',
                  disabled: busy || connecting,
                  onClick: pickFolder
                }, h(Icon, { name: 'folderPlus', size: 16 }),
                  !isLocal && hostStatus !== 'online' ? t('z.project.connectAndBrowse') : t('z.project.addSourceFolder'))
              )
            : h('button', {
                type: 'button',
                className: 'zc-folder-empty',
                'data-testid': 'virtual-project-browse',
                disabled: busy || connecting || (isLocal && !localAvailable),
                onClick: pickFolder
              },
                h('span', { className: 'zc-folder-empty-icon' }, h(Icon, { name: 'folderPlus', size: 16 })),
                h('span', { className: 'zc-folder-empty-title' }, browseButtonLabel),
                h('span', { className: 'zc-folder-empty-hint' }, browseHint)
              )
        ),
        error ? h('p', { className: 'zc-create-error', role: 'alert' }, error) : null
      )

      const createFooter = h('div', { className: 'zc-create-foot' },
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost',
          onClick: onClose,
          disabled: busy
        }, t('z.project.cancel')),
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-default',
          'data-testid': 'virtual-project-save',
          disabled: !canCreate,
          onClick: () => void create()
        }, busy ? h(Spinner, { className: 'zc-spin' }) : null, t('z.project.create'))
      )

      const browseBody = host
        ? h('div', { className: 'zc-folder-modal', 'data-testid': 'virtual-project-directory-browser' },
            h(RemoteBrowser, {
              hostId: host.id,
              value: browsePath,
              onChange: setBrowsePath,
              allowMissing: true,
              onNavState: setDirReady
            }),
            h('div', { className: 'zc-folder-foot' },
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-secondary',
                onClick: () => setBrowseOpen(false)
              }, t('common.cancel')),
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-default',
                'data-testid': 'directory-browser-confirm',
                disabled: !browsePath.trim() || !dirReady,
                onClick: () => {
                  setRoots([browsePath])
                  setBrowseOpen(false)
                }
              }, t('z.folder.select'))
            )
          )
        : null

      const localBrowseBody = h('div', { className: 'zc-folder-modal', 'data-testid': 'virtual-project-directory-browser' },
        h(LocalBrowser, {
          value: localPath,
          onChange: setLocalPath
        }),
        h('div', { className: 'zc-folder-foot' },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-secondary',
            onClick: () => setLocalBrowseOpen(false)
          }, t('common.cancel')),
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-default',
            'data-testid': 'directory-browser-confirm',
            disabled: !localPath.trim(),
            onClick: () => {
              setRoots([localPath])
              setLocalBrowseOpen(false)
            }
          }, t('z.folder.select'))
        )
      )

      return h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose?.() }
      },
        h('div', { className: 'zc-create-center' },
          h('div', {
            className: 'zc-dialog zc-create',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'zc-project-title'
          },
            headerRow,
            folderMode ? (browseOpen ? browseBody : localBrowseBody) : createBody,
            folderMode ? null : createFooter
          )
        ),
        trustOpen ? h('div', {
          className: 'zc-ui zc-overlay',
          onMouseDown: (event) => { if (event.target === event.currentTarget) setTrustOpen(false) }
        },
          h('div', { className: 'zc-create-center' },
            h('div', {
              className: 'zc-dialog zc-trust',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'zc-trust-title',
              'data-testid': 'project-folder-trust-dialog'
            },
              h('h2', { className: 'zc-trust-title', id: 'zc-trust-title' }, t('z.project.trustFolderTitle')),
              h('div', { className: 'zc-trust-meta' },
                h('p', { className: 'zc-trust-device' }, isLocal ? t('z.project.thisComputer') : (host?.name || deviceId)),
                h('ul', { className: 'zc-trust-list' },
                  roots.map((path) => h('li', {
                    key: path,
                    className: 'zc-trust-path',
                    'data-testid': 'project-folder-trust-path'
                  }, path))
                )
              ),
              h('p', { className: 'zc-trust-desc' }, t('z.project.trustFolderDescription')),
              h('div', { className: 'zc-trust-foot' },
                h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-secondary',
                  'data-testid': 'project-folder-trust-cancel',
                  onClick: () => setTrustOpen(false)
                }, t('z.project.cancel')),
                h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-default',
                  'data-testid': 'project-folder-trust-confirm',
                  onClick: () => {
                    setTrustOpen(false)
                    void runCreate()
                  }
                }, t('z.project.trustFolderConfirm'))
              )
            )
          )
        ) : null,
        h(AnchoredMenu, {
          open: menuOpen,
          anchorRef: deviceButtonRef,
          className: 'zc-select-menu',
          children: deviceMenuItems
        }),
        jobId ? h(JobModal, {
          jobId,
          title: t('z.project.create'),
          onClose: () => setJobId(''),
          onDone: (job) => {
            if (job.state === 'succeeded') {
              setJobId('')
              void openWorkspace(job.result)
            }
          }
        }) : null,
        addOpen ? h(ZcodeRemoteDialog, {
          mode: 'device-management',
          onClose: () => setAddOpen(false),
          onManaged: (createdHost) => {
            setAddOpen(false)
            void load(createdHost?.id)
          }
        }) : null
      )
    }

