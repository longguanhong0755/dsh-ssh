// part: 52-hosts-pane -- HostsPane: settings -> SSH remote device manager
    function HostsPane({ refreshToken = 0, onChanged, createOpen: controlledCreateOpen, onCloseCreate } = {}) {
      const [hosts, setHosts] = useState([])
      const [workspaces, setWorkspaces] = useState([])
      const [appSettings, setAppSettings] = useState(null)
      const [query, setQuery] = useState('')
      const [expanded, setExpanded] = useState(() => new Set())
      const [showAllProjects, setShowAllProjects] = useState(() => new Set())
      const [logsOpen, setLogsOpen] = useState(() => new Set())
      const [infoBusy, setInfoBusy] = useState(() => new Set())
      const [checkedInfo, setCheckedInfo] = useState(() => new Set())
      const [confirmAction, setConfirmAction] = useState(null)
      const [job, setJob] = useState(null)
      const [copiedId, setCopiedId] = useState('')
      const [form, setForm] = useState(null)
      const [createOpenLocal, setCreateOpenLocal] = useState(false)
      const [confirmHost, setConfirmHost] = useState(null)
      const [menuHost, setMenuHost] = useState(null)
      const [showPassword, setShowPassword] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const menuAnchorRef = useRef(null)
      useBackendPlatform()
      const uncontrolled = controlledCreateOpen === undefined
      const createOpen = uncontrolled ? createOpenLocal : controlledCreateOpen
      const closeCreate = () => {
        if (uncontrolled) setCreateOpenLocal(false)
        else onCloseCreate?.()
      }
      const load = useCallback(async () => {
        try {
          const [hostData, workspaceData, platformData, settingsData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0').catch(() => ({ workspaces: [] })),
            api('GET', '/ssh-remote/discover?kind=none').catch(() => null),
            api('GET', '/ssh-remote/settings').catch(() => null)
          ])
          setBackendPlatform(platformData?.platform)
          setHosts(hostData.hosts || [])
          setWorkspaces(workspaceData.workspaces || [])
          if (settingsData?.settings) setAppSettings(settingsData.settings)
          setError('')
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { void load() }, [load, refreshToken])

      // ZCode closes the row menu on an outside press or Esc.
      useEffect(() => {
        if (!menuHost) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-zc-popover="true"]')) return
          if (menuAnchorRef.current && menuAnchorRef.current.contains(event.target)) return
          setMenuHost(null)
        }
        const onKey = (event) => { if (event.key === 'Escape') setMenuHost(null) }
        document.addEventListener('mousedown', onPointerDown)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onPointerDown)
          window.removeEventListener('keydown', onKey)
        }
      }, [menuHost])

      const update = (patch) => setForm((old) => ({ ...(old || emptyHostForm()), ...patch }))
      const openForm = (host) => {
        setShowPassword(false)
        setError('')
        setForm(hostToForm(host))
      }
      // A project row asked for 远程设备设置 before this panel mounted; apply the
      // parked request once the host list that resolves it is here.
      const [settingsTick, setSettingsTick] = useState(0)
      useEffect(() => deviceSettingsFlow.subscribe(() => setSettingsTick((value) => value + 1)), [])
      useEffect(() => {
        if (!deviceSettingsFlow.pendingHostId || hosts.length === 0) return
        const host = hosts.find((row) => row.id === deviceSettingsFlow.pendingHostId)
        deviceSettingsFlow.consume()
        if (host) openForm(host)
      }, [hosts, settingsTick])
      const save = async () => {
        if (!form || busy) return
        // ZCode's edit dialog requires a device name (`deviceNameRequired`)
        // instead of silently falling back to the address.
        if (form.id && !form.name.trim()) {
          setError(t('settings.deviceNameRequired'))
          return
        }
        setBusy(true); setError('')
        try {
          const kind = form.kind
          const host = {
            id: form.id || undefined,
            kind,
            name: form.name || form.host || form.distro || form.container,
            host: kind === 'wsl' ? form.distro : kind === 'docker' ? form.container : form.host,
            port: Number(form.port) || 22,
            username: kind === 'wsl' ? form.wslUser : form.username,
            user: kind === 'docker' ? form.username : form.wslUser,
            distro: form.distro,
            container: form.container,
            image: form.image,
            auth: form.authKind === 'key'
              ? { kind: 'key', privateKeyPath: form.privateKeyPath, passphrase: form.passphrase || undefined }
              : { kind: 'password', password: form.password || undefined },
            defaultPath: form.defaultPath || '~',
            hostKeyMode: form.hostKeyMode
          }
          await api('POST', '/ssh-remote/hosts/save', { host })
          setForm(null)
          await load()
          void loadRowMeta(true).then(() => decorateRemoteRows())
          onChanged?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      const remove = async () => {
        if (!confirmHost || busy) return
        setBusy(true); setError('')
        try {
          await api('POST', '/ssh-remote/hosts/delete', { id: confirmHost.id })
          setConfirmHost(null)
          await load()
          void loadRowMeta(true).then(() => decorateRemoteRows())
          onChanged?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }

      // ZCode 设为默认连接: stored on the app settings, used to preselect the
      // device in project creation.
      const setDefault = async (host) => {
        if (!host || busy) return
        setBusy(true); setError('')
        try {
          await api('POST', '/ssh-remote/hosts/default', { id: host.id })
          await load()
          onChanged?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      const openMenu = (host, button) => {
        menuAnchorRef.current = button
        setMenuHost(host)
      }

      const toggleSet = (setter, id) => setter((old) => {
        const next = new Set(old)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })

      // ZCode expands a row and probes the device once for its real metadata.
      const toggleHost = (host) => {
        toggleSet(setExpanded, host.id)
        if (!checkedInfo.has(host.id)) void loadInfo(host.id)
      }
      const loadInfo = async (hostId) => {
        setCheckedInfo((old) => new Set(old).add(hostId))
        setInfoBusy((old) => new Set(old).add(hostId))
        try {
          const data = await api('GET', `/ssh-remote/hosts/info?id=${encodeURIComponent(hostId)}`)
          if (data?.host) {
            setHosts((rows) => rows.map((row) => (row.id === hostId ? { ...row, ...data.host } : row)))
          }
        } catch {
          // Keep the cached metadata; ZCode shows 暂无法获取 for missing fields.
        } finally {
          setInfoBusy((old) => {
            const next = new Set(old)
            next.delete(hostId)
            return next
          })
        }
      }

      const actionTitle = (op) => op === 'stop'
        ? t('device.stopRemoteService')
        : op === 'restart'
          ? t('device.restartRemoteService')
          : op === 'reinstall'
            ? t('device.reinstallRemoteService')
            : op === 'connect'
              ? t('device.connect')
              : t('device.disconnect')

      const runAction = async (host, op) => {
        setBusy(true); setError('')
        try {
          const result = await api('POST', '/ssh-remote/hosts/action', {
            id: host.id,
            op,
            version: appSettings?.dshVersion || undefined
          })
          if (result?.jobId) {
            setJob({ jobId: result.jobId, title: actionTitle(op) })
          } else {
            await load()
            onChanged?.()
          }
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }

      // Preferences are persisted immediately, like ZCode's switches.
      const updatePref = async (key, value) => {
        const previous = appSettings
        setAppSettings((old) => ({ ...(old || {}), [key]: value }))
        try {
          const result = await api('POST', '/ssh-remote/settings', { settings: { [key]: value } })
          if (result?.settings) setAppSettings(result.settings)
          // Apply hide-device-name immediately to the native project rows.
          void loadRowMeta(true).then(() => decorateRemoteRows())
        } catch (err) {
          setAppSettings(previous)
          setError(errorMessage(err))
        }
      }

      const copyDeviceId = async (host) => {
        try {
          await navigator.clipboard?.writeText(String(host.deviceId || host.id))
          setCopiedId(host.id)
          setTimeout(() => setCopiedId((current) => (current === host.id ? '' : current)), 1500)
        } catch (err) {
          setError(errorMessage(err))
        }
      }

      const projectsFor = (host) => workspaces
        .filter((workspace) => workspace.hostId === host.id)
        .sort((a, b) => String(b.lastOpenedAt || b.updatedAt || '').localeCompare(String(a.lastOpenedAt || a.updatedAt || '')))

      // Search matches the device name, the address and any project path,
      // exactly like ZCode's `i1n` filter.
      const visible = visibleHosts(hosts).filter((host) => {
        const needle = query.trim().toLocaleLowerCase()
        if (!needle) return true
        if (String(host.name || '').toLocaleLowerCase().includes(needle)) return true
        if (targetLabelFor(host).toLocaleLowerCase().includes(needle)) return true
        return workspaces.some((workspace) => workspace.hostId === host.id
          && `${workspace.name || ''} ${workspace.remotePath || ''}`.toLocaleLowerCase().includes(needle))
      })

      const confirmConfig = confirmAction
        ? confirmAction.op === 'stop'
          ? {
              title: t('device.stopRemoteServiceTitle'),
              description: t('device.stopRemoteServiceDescription'),
              confirm: t('device.stopRemoteService'),
              danger: true
            }
          : confirmAction.op === 'restart'
            ? {
                title: t('device.restartRemoteServiceTitle'),
                description: t('device.restartRemoteServiceDescription'),
                confirm: t('device.restartRemoteService'),
                danger: false
              }
            : {
                title: t('device.reinstallRemoteServiceTitle'),
                description: t('device.reinstallRemoteServiceDescription', {
                  source: targetLabelFor(confirmAction.host),
                  version: appSettings?.dshVersion || ''
                }),
                confirm: t('device.reinstallRemoteServiceConfirm'),
                danger: false
              }
        : null

      // Small builders keep the modal readable and reuse the ZCode form
      // primitives (`zc-field` / `zc-label`) already used by the connect dialog.
      const field = (label, control, hint) => h('label', { className: 'zc-field' },
        h('span', { className: 'zc-label' }, label),
        control,
        hint ? h('span', { className: 'zc-hint' }, hint) : null
      )
      const formModal = form ? h(Modal, {
        title: t('settings.editConnectionTitle'),
        onClose: () => { if (!busy) { setForm(null); setError('') } },
        footer: [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'zc-btn zc-btn-outline',
            disabled: busy,
            onClick: () => { setForm(null); setError('') }
          }, t('settings.cancel')),
          h('button', {
            key: 'save',
            type: 'button',
            className: 'zc-btn zc-btn-default',
            disabled: busy,
            'aria-busy': busy ? 'true' : 'false',
            onClick: () => void save()
          }, busy ? t('settings.saving') : t('settings.saveChanges'))
        ]
      },
        h('p', { className: 'zc-desc', style: { margin: '0 0 16px' } }, t('settings.editConnectionDescription')),
        error ? h('div', { className: 'zc-error', style: { marginBottom: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        h('div', { className: 'zc-fields' },
          field(t('settings.deviceName'), h('input', {
            className: 'zc-input',
            value: form.name,
            onChange: (event) => update({ name: event.target.value })
          })),
          form.kind === 'ssh' ? h('div', { className: 'zc-grid-host' },
            field(t('settings.host'), h('input', {
              className: 'zc-input mono',
              value: form.host,
              placeholder: t('z.hostPlaceholder'),
              spellCheck: false,
              onChange: (event) => update({ host: event.target.value })
            })),
            field(t('settings.port'), h('input', {
              className: 'zc-input mono',
              value: form.port,
              inputMode: 'numeric',
              placeholder: '22',
              onChange: (event) => update({ port: event.target.value })
            }))
          ) : null,
          form.kind === 'wsl' && supportsWsl() ? h('div', { className: 'zc-grid-2' },
            field(t('z.wslDistro'), h('input', {
              className: 'zc-input mono',
              value: form.distro,
              placeholder: t('z.wslDefaultDistro'),
              onChange: (event) => update({ distro: event.target.value })
            })),
            field(t('z.wslUser'), h('input', {
              className: 'zc-input mono',
              value: form.wslUser,
              placeholder: t('z.wslDefaultUser'),
              onChange: (event) => update({ wslUser: event.target.value })
            }))
          ) : null,
          form.kind === 'docker' ? h('div', null,
            field(t('z.dockerContainer'), h('input', {
              className: 'zc-input mono',
              value: form.container,
              placeholder: t('z.dockerContainerPlaceholder'),
              onChange: (event) => update({ container: event.target.value })
            }))
          ) : null,
          form.kind === 'ssh' ? field(t('settings.username'), h('input', {
            className: 'zc-input mono',
            value: form.username,
            placeholder: t('z.usernamePlaceholder'),
            spellCheck: false,
            autoCapitalize: 'none',
            onChange: (event) => update({ username: event.target.value })
          })) : null,
          form.kind === 'ssh' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'zc-auth-row' },
              h('span', { className: 'zc-auth-label' }, t('z.auth')),
              h('div', { className: 'zc-seg' },
                h('button', {
                  type: 'button',
                  'aria-pressed': form.authKind === 'password' ? 'true' : 'false',
                  onClick: () => update({ authKind: 'password' })
                }, t('z.password')),
                h('button', {
                  type: 'button',
                  'aria-pressed': form.authKind === 'key' ? 'true' : 'false',
                  onClick: () => update({ authKind: 'key' })
                }, t('z.privateKey'))
              )
            ),
            form.authKind === 'password'
              ? h('div', null,
                  h('div', { className: 'zc-pwd' },
                    h('input', {
                      className: 'zc-input',
                      type: showPassword ? 'text' : 'password',
                      value: form.password,
                      placeholder: form.id ? t('settings.keepSavedSecret') : t('z.passwordPlaceholder'),
                      autoComplete: 'off',
                      onChange: (event) => update({ password: event.target.value })
                    }),
                    h('button', {
                      type: 'button',
                      className: 'zc-eye',
                      title: showPassword ? t('z.hidePassword') : t('z.showPassword'),
                      'aria-label': showPassword ? t('z.hidePassword') : t('z.showPassword'),
                      onClick: () => setShowPassword((old) => !old)
                    }, h(EyeIcon, { off: showPassword }))
                  )
                )
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                  field(t('z.privateKey'), h('input', {
                    className: 'zc-input mono',
                    value: form.privateKeyPath,
                    placeholder: t('z.keyPlaceholder'),
                    spellCheck: false,
                    onChange: (event) => update({ privateKeyPath: event.target.value })
                  })),
                  field(t('z.passphrase'), h('input', {
                    className: 'zc-input',
                    type: 'password',
                    value: form.passphrase,
                    placeholder: t('z.passphrasePlaceholder'),
                    autoComplete: 'off',
                    onChange: (event) => update({ passphrase: event.target.value })
                  }))
                )
          ) : null
        )
      ) : null
      const removeModal = confirmHost ? h(Modal, {
        title: t('device.removeDeviceTitle'),
        onClose: () => { if (!busy) setConfirmHost(null) },
        footer: [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'zc-btn zc-btn-outline',
            disabled: busy,
            onClick: () => setConfirmHost(null)
          }, t('settings.cancel')),
          h('button', {
            key: 'remove',
            type: 'button',
            className: 'zc-btn zc-btn-danger',
            disabled: busy,
            onClick: () => void remove()
          }, t('device.removeDevice'))
        ]
      },
        h('p', { className: 'zc-desc', style: { margin: 0 } }, t('device.removeDeviceDescription')),
        error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null
      ) : null

      const actionModal = confirmAction && confirmConfig ? h(Modal, {
        title: confirmConfig.title,
        onClose: () => { if (!busy) setConfirmAction(null) },
        footer: [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'zc-btn zc-btn-outline',
            disabled: busy,
            onClick: () => setConfirmAction(null)
          }, t('settings.cancel')),
          h('button', {
            key: 'run',
            type: 'button',
            className: confirmConfig.danger ? 'zc-btn zc-btn-danger' : 'zc-btn zc-btn-default',
            disabled: busy,
            onClick: () => {
              const pending = confirmAction
              setConfirmAction(null)
              void runAction(pending.host, pending.op)
            }
          }, confirmConfig.confirm)
        ]
      },
        h('p', { className: 'zc-desc', style: { margin: 0 } }, confirmConfig.description)
      ) : null

      const menuSep = (key) => h('div', { key, className: 'zc-menu-sep', role: 'separator' })

      // ZCode only offers 断开 for a device that is actually connected; an
      // offline device gets 连接 on the row instead of a no-op disconnect.
      const isOnline = menuHost ? hostStatusFor(menuHost, workspaces).online : false

      const menuNode = menuHost ? h(AnchoredMenu, {
        open: true,
        anchorRef: menuAnchorRef,
        align: 'end',
        width: 288,
        estimatedHeight: 470,
        className: 'zc-import-menu zc-device-menu',
        onClose: () => setMenuHost(null)
      },
        h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item',
          onClick: () => { const host = menuHost; setMenuHost(null); openForm(host) }
        }, h(Icon, { name: 'edit', size: 16 }), t('device.edit')),
        !menuHost.serviceState || menuHost.serviceState !== 'stopped'
          ? (!menuHost.disconnectedAt && isOnline ? h('button', {
              type: 'button',
              role: 'menuitem',
              className: 'zc-import-item',
              disabled: busy,
              onClick: () => { const host = menuHost; setMenuHost(null); void runAction(host, 'disconnect') }
            },
              h(Icon, { name: 'power', size: 16 }),
              h('span', { className: 'zc-import-item-main' },
                h('span', null, t('device.disconnect')),
                h('span', null, t('device.disconnectHint'))
              )
            ) : null)
          : null,
        menuSep('sep-1'),
        h('div', { className: 'zc-device-info', 'data-device-info': true },
          [
            ['version', menuHost.runtimeVersion],
            ['hostname', menuHost.hostname],
            ['osUser', menuHost.osUser],
            ['deviceId', menuHost.deviceId || menuHost.id]
          ].map(([key, value]) => h('p', { key, className: 'zc-device-info-row' },
            h('span', null, `${t(`device.${key}`)}: `),
            value ? String(value) : h('span', { className: 'zc-device-info-missing' }, t('device.infoUnavailable'))
          ))
        ),
        h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item',
          onClick: () => { const host = menuHost; setMenuHost(null); void copyDeviceId(host) }
        }, h(Icon, { name: 'copy', size: 16 }), copiedId === menuHost.id ? t('device.copied') : t('device.copyDeviceId')),
        menuSep('sep-2'),
        menuHost.serviceState !== 'stopped' ? h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item',
          disabled: busy,
          onClick: () => { const host = menuHost; setMenuHost(null); setError(''); setConfirmAction({ host, op: 'reinstall' }) }
        },
          h(Icon, { name: 'rotate', size: 16 }),
          h('span', { className: 'zc-import-item-main' },
            h('span', null, t('device.reinstallRemoteService')),
            h('span', null, t('device.reinstallRemoteServiceHint'))
          )
        ) : null,
        h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item',
          disabled: busy,
          onClick: () => { const host = menuHost; setMenuHost(null); setError(''); setConfirmAction({ host, op: 'restart' }) }
        }, h(Icon, { name: 'rotate', size: 16 }), t('device.restartRemoteService')),
        menuHost.serviceState !== 'stopped' ? h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item danger',
          disabled: busy,
          onClick: () => { const host = menuHost; setMenuHost(null); setError(''); setConfirmAction({ host, op: 'stop' }) }
        }, h(Icon, { name: 'power', size: 16 }), t('device.stopRemoteService')) : null,
        menuSep('sep-3'),
        h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'zc-import-item danger',
          onClick: () => { const host = menuHost; setMenuHost(null); setError(''); setConfirmHost(host) }
        }, h(Icon, { name: 'trash', size: 16 }), t('device.removeDevice'))
      ) : null

      return h('div', { className: 'zc-devices' },
        error ? h('div', { className: 'zc-error', style: { marginBottom: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        loading ? h('div', { className: 'zc-device-loading' }, h(Spinner), h('span', null, t('common.loading'))) : null,
        !loading ? h('label', { className: 'zc-search' },
          h(Icon, { name: 'search', size: 14 }),
          h('input', {
            type: 'search',
            value: query,
            placeholder: t('device.searchPlaceholder'),
            'aria-label': t('device.searchPlaceholder'),
            spellCheck: false,
            onChange: (event) => setQuery(event.target.value)
          })
        ) : null,
        !loading && visible.length === 0
          ? (query.trim()
              ? h('div', { className: 'zc-device-empty' },
                  h(Icon, { name: 'search', size: 20 }),
                  h('span', null, t('device.searchEmpty', { query: query.trim() }))
                )
              : h('div', { className: 'zc-device-empty' },
                  h(Icon, { name: 'cloud', size: 20 }),
                  h('span', null, t('settings.emptyDevices'))
                ))
          : null,
        !loading && visible.length > 0
          ? h('section', { 'aria-label': t('settings.devicesHeading') },
              h('div', { className: 'zc-device-head' },
                h('span', null, t('settings.devicesHeading')),
                h('span', { className: 'zc-device-count' }, String(visible.length))
              ),
              h('div', { className: 'zc-device-list' },
                visible.map((host) => {
                  const status = hostStatusFor(host, workspaces)
                  const isOpen = expanded.has(host.id)
                  const detailsId = `device-details-${host.id}`
                  const projects = projectsFor(host)
                  const allProjects = showAllProjects.has(host.id)
                  const shownProjects = allProjects ? projects : projects.slice(0, 3)
                  const logs = Array.isArray(host.logs) ? host.logs.slice(-20) : []
                  const showLogs = logsOpen.has(host.id)
                  const meta = status.online
                    ? t('device.projectCount', { count: Number(host.projectCount) || 0 })
                    : (host.lastOnlineAt ? t('device.lastOnline', { time: formatRelativeDeviceTime(host.lastOnlineAt) }) : '')
                  const connectable = host.serviceState === 'stopped'
                    || Boolean(host.disconnectedAt)
                    || status.tone === 'neutral'
                    || status.tone === 'danger'
                  return h('section', {
                    key: host.id,
                    'data-source-server-card': host.id,
                    className: 'zc-device-card'
                  },
                    h('div', {
                      'data-source-server-row': true,
                      className: 'zc-device-row2',
                      onClick: (event) => {
                        const target = event.target
                        if (target instanceof Element && target.closest('[data-device-row-actions]')) return
                        toggleHost(host)
                      }
                    },
                      h('button', {
                        type: 'button',
                        'data-source-server-toggle': true,
                        'aria-expanded': isOpen ? 'true' : 'false',
                        'aria-controls': isOpen ? detailsId : undefined,
                        className: 'zc-device-toggle'
                      },
                        h('span', { className: 'zc-device-icon' }, h(Icon, { name: deviceTileIcon(kindOfrow(host)), size: 16 })),
                        h('span', { className: 'zc-device-identity' },
                          h('span', { className: 'zc-device-name' }, host.name),
                          h('span', { className: 'zc-device-address', title: targetLabelFor(host) }, targetLabelFor(host))
                        ),
                        meta ? h('span', { 'data-device-row-meta': true, className: 'zc-device-row-meta', title: meta }, meta) : null
                      ),
                      h(StatusBadge, { tone: status.tone }, status.label),
                      h('div', { 'data-device-row-actions': true, className: 'zc-device-row-actions' },
                        connectable ? h('button', {
                          type: 'button',
                          className: 'zc-btn zc-btn-outline zc-btn-sm',
                          disabled: busy,
                          onClick: () => void runAction(host, 'connect')
                        }, t('device.connect')) : null,
                        h('button', {
                          type: 'button',
                          className: 'zc-btn zc-btn-ghost zc-btn-icon zc-device-more',
                          title: t('row.more'),
                          'aria-label': t('row.more'),
                          'aria-haspopup': 'menu',
                          'aria-expanded': menuHost?.id === host.id ? 'true' : 'false',
                          onClick: (event) => openMenu(host, event.currentTarget)
                        }, h(Icon, { name: 'more', size: 14 }))
                      ),
                      h(Icon, { name: 'chevronRight', size: 14, className: `zc-device-chevron${isOpen ? ' open' : ''}` })
                    ),
                    isOpen ? h('div', { id: detailsId, 'data-device-details': true, className: 'zc-device-details' },
                      h('div', { className: 'zc-device-connection', 'data-device-connection': true },
                        h(Icon, { name: deviceTileIcon(kindOfrow(host)), size: 14 }),
                        h('span', { className: 'zc-device-address', title: targetLabelFor(host) }, targetLabelFor(host)),
                        host.runtimeVersion
                          ? h('span', { className: 'zc-device-version', title: t('device.version') }, `· v${String(host.runtimeVersion).replace(/^v/iu, '')}`)
                          : null,
                        host.isDefault
                          ? h('span', { className: 'zc-device-tag' }, t('device.default'))
                          : h('button', {
                              type: 'button',
                              className: 'zc-device-link',
                              disabled: busy,
                              onClick: () => void setDefault(host)
                            }, t('settings.setDefault')),
                        !status.online && host.lastOnlineAt
                          ? h('span', { className: 'zc-device-version' }, `· ${t('device.lastOnline', { time: formatRelativeDeviceTime(host.lastOnlineAt) })}`)
                          : null,
                        infoBusy.has(host.id) ? h(Spinner) : null
                      ),
                      h('div', { className: 'zc-device-projects', 'data-device-projects': true },
                        projects.length === 0
                          ? h('p', { className: 'zc-device-project-empty' }, t('device.projectCount', { count: 0 }))
                          : h(React.Fragment, null,
                              h('div', { className: 'zc-device-projects-head' },
                                h('p', null, t('device.recentProjects')),
                                projects.length > 3 ? h('button', {
                                  type: 'button',
                                  className: 'zc-device-link',
                                  'aria-expanded': allProjects ? 'true' : 'false',
                                  onClick: () => toggleSet(setShowAllProjects, host.id)
                                }, allProjects
                                  ? t('device.showLessProjects')
                                  : t('device.showAllProjects', { count: projects.length })) : null
                              ),
                              shownProjects.map((workspace) => h('button', {
                                key: workspace.id,
                                type: 'button',
                                'data-device-project': true,
                                className: 'zc-device-project',
                                title: workspace.remotePath || '',
                                disabled: !workspace.nativeWorkspaceId,
                                onClick: () => openWorkspaceFiles(workspace)
                              },
                                h(Icon, { name: 'folder', size: 14 }),
                                h('span', { className: 'zc-device-project-name' }, workspace.name),
                                h('span', { className: 'zc-device-project-path' }, workspace.remotePath || ''),
                                workspace.lastOpenedAt
                                  ? h('span', { className: 'zc-device-project-time' }, formatRelativeDeviceTime(workspace.lastOpenedAt))
                                  : null,
                                h(Icon, { name: 'chevronRight', size: 14, className: 'zc-device-project-arrow' })
                              ))
                            )
                      ),
                      h('button', {
                        type: 'button',
                        className: 'zc-device-log-toggle',
                        'data-source-server-log-toggle': true,
                        'aria-expanded': showLogs ? 'true' : 'false',
                        onClick: () => toggleSet(setLogsOpen, host.id)
                      },
                        h(Icon, { name: 'chevronRight', size: 14, className: `zc-device-chevron${showLogs ? ' open' : ''}` }),
                        t('device.recentLog'),
                        logs.length > 0 ? h('span', { className: 'zc-device-log-count' }, String(logs.length)) : null
                      ),
                      showLogs ? h('div', { className: 'zc-device-log', 'data-source-server-log': true },
                        logs.length > 0
                          ? logs.map((row, index) => h('div', {
                              key: `${row.timestamp || ''}-${index}`,
                              className: `zc-device-log-row${row.level === 'error' ? ' error' : row.level === 'warn' ? ' warn' : ''}`
                            },
                              h('span', { className: 'zc-device-log-time', 'data-source-server-log-timestamp': true }, formatLogClock(row.timestamp)),
                              h('span', { className: 'zc-device-log-msg' }, String(row.message || ''))
                            ))
                          : h('p', { className: 'zc-device-log-empty' }, t('device.noLogs'))
                      ) : null
                    ) : null
                  )
                })
              )
            )
          : null,
        !loading ? h('section', { className: 'zc-device-prefs-section' },
          h('h3', { className: 'zc-device-prefs-title' }, t('device.preferences')),
          h('div', { className: 'zc-device-prefs' },
            h('div', { className: 'zc-device-pref' },
              h('div', { className: 'zc-device-pref-copy' },
                h('p', { className: 'zc-device-pref-title' }, t('device.hideProjectDeviceNames')),
                h('p', { className: 'zc-device-pref-desc' }, t('device.hideProjectDeviceNamesDescription'))
              ),
              h(DeviceSwitch, {
                checked: Boolean(appSettings?.hideProjectDeviceNames),
                label: t('device.hideProjectDeviceNames'),
                disabled: !appSettings,
                onChange: (value) => void updatePref('hideProjectDeviceNames', value)
              })
            ),
            h('div', { className: 'zc-device-pref' },
              h('div', { className: 'zc-device-pref-copy' },
                h('p', { className: 'zc-device-pref-title' }, t('device.startupAutoReconnect')),
                h('p', { className: 'zc-device-pref-desc' }, t('device.startupAutoReconnectDescription'))
              ),
              h(DeviceSwitch, {
                checked: appSettings ? appSettings.startupAutoReconnect !== false : true,
                label: t('device.startupAutoReconnect'),
                disabled: !appSettings,
                onChange: (value) => void updatePref('startupAutoReconnect', value)
              })
            )
          )
        ) : null,
        menuNode,
        formModal,
        removeModal,
        actionModal,
        job ? h(JobModal, {
          jobId: job.jobId,
          title: job.title,
          onClose: () => { setJob(null); void load(); onChanged?.(); setCheckedInfo(new Set()) },
          onDone: () => { void load(); onChanged?.(); setCheckedInfo(new Set()) }
        }) : null,
        createOpen ? h(ZcodeRemoteDialog, {
          mode: 'device-management',
          onClose: closeCreate,
          onManaged: () => { closeCreate(); void load(); onChanged?.() }
        }) : null
      )
    }

