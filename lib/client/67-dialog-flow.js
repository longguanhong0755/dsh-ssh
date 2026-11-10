// part: 67-dialog-flow -- ZcodeRemoteDialog: effects and connect/create handlers
      // ZCode renders the Docker picker as a popover; close it on an outside
      // press the same way Radix does.
      useEffect(() => {
        if (!dockerOpen) return undefined
        const onPointerDown = (event) => {
          if (dockerRef.current && !dockerRef.current.contains(event.target)) setDockerOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [dockerOpen])

      useEffect(() => {
        if (!importOpen) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-zc-popover="true"]')) return
          if (importButtonRef.current && !importButtonRef.current.contains(event.target)) setImportOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [importOpen])

      // Phase durations in ZCode's connecting list tick every second.
      useEffect(() => {
        if (step !== 'connecting') return undefined
        const timer = setInterval(() => setClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [step])

      // The wizard is a view over the module-level flow: reopening it after a
      // minimize lands on the live step instead of resetting to the device list.
      useEffect(() => {
        if (previous) {
          setPausedWizard(null)
          return
        }
        // Device management always starts a fresh 新建连接 form; only a pill
        // resume reopens the live connecting view instead.
        if (deviceManagement) {
          const resume = dialogResumeFlow
          dialogResumeFlow = false
          const snapshot = backgroundFlow.snapshot
          if (resume && (snapshot.phase === 'running' || snapshot.phase === 'failed' || snapshot.phase === 'done')) {
            backgroundFlow.restore()
            setStep('connecting')
            setConnectStartedAt(snapshot.startedAt || Date.now())
          }
          return
        }
        backgroundFlow.restore()
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' || snapshot.phase === 'failed') {
          setStep('connecting')
          setConnectStartedAt(snapshot.startedAt || Date.now())
        }
        if (snapshot.phase === 'done' && snapshot.kind === 'prepare') {
          setEditingId(snapshot.hostId)
          setDirHostId(snapshot.hostId)
          setRemotePath(snapshot.path || '~')
          setStep('directory')
        }
        if (snapshot.phase === 'done' && snapshot.kind === 'create') {
          // The workspace already exists in the native list; a fresh wizard
          // should not reopen the old completion.
          backgroundFlow.reset()
        }
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          // Esc closes the innermost surface first, exactly like the Radix
          // popovers/dialogs ZCode stacks here.
          if (leaveConfirm) { setLeaveConfirm(false); return }
          if (importOpen) { setImportOpen(false); return }
          if (dockerOpen) { setDockerOpen(false); return }
          const phase = backgroundFlow.snapshot.phase
          // ZCode `Bn()`: leaving an in-flight connection asks first
          // ("要中止当前连接吗？") instead of silently dropping the attempt.
          // The connecting step has two live attempts: the inline probe
          // (`busy`, flow still idle) and the background prepare job.
          if (step === 'connecting' && (busy || phase === 'running' || phase === 'confirm-install')) {
            setLeaveConfirm(true)
            return
          }
          if (phase === 'running' || phase === 'failed') backgroundFlow.minimize()
          onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose, leaveConfirm, importOpen, dockerOpen, step, busy])

      useEffect(() => {
        if (!bg.hostId || hosts.length === 0) return
        const host = hosts.find((row) => row.id === bg.hostId)
        if (!host) return
        setEditingId((current) => current || host.id)
        setForm((current) => (current.host ? current : hostToForm(host)))
      }, [bg.hostId, hosts])

      const sortWorkspaces = (rows) => [...rows].sort((a, b) => {
        const left = String(a.lastOpenedAt || a.updatedAt || '')
        const right = String(b.lastOpenedAt || b.updatedAt || '')
        return right.localeCompare(left)
      })
      const workspacesFor = (hostId) => sortWorkspaces(workspaces.filter((row) => row.hostId === hostId))
      const hostOf = (hostId) => hosts.find((row) => row.id === hostId) || null

      const finishCreate = useCallback((workspace) => {
        backgroundFlow.reset()
        if (!workspace) {
          onClose()
          return
        }
        onCreated?.(workspace)
        const opened = workspace.nativeWorkspaceId ? openNativeWorkspace?.(workspace.nativeWorkspaceId) : false
        onClose()
        if (!opened) openPanel?.()
      }, [onClose, onCreated, openPanel, openNativeWorkspace])

      useEffect(() => {
        if (bg.phase !== 'done') return
        if (bg.kind === 'prepare' && step === 'connecting') {
          if (deviceManagement) {
            if (!editingId || bg.hostId !== editingId) return
            // Close on success and drop the finished flow: leaving it at
            // `done` makes the next 新建连接 jump straight back to the
            // connecting step and close itself before a new probe starts.
            const managed = hostOf(bg.hostId)
            backgroundFlow.reset()
            onManaged?.(managed)
            onClose()
            return
          }
          setEditingId(bg.hostId)
          setDirHostId(bg.hostId)
          setRemotePath(bg.path || '~')
          setStep('directory')
          return
        }
        if (bg.kind === 'create' && step === 'connecting') finishCreate(bg.workspace)
      }, [bg.phase, bg.kind, bg.startedAt, bg.workspace, step, finishCreate, deviceManagement, editingId, onManaged, onClose])

      useEffect(() => {
        if (step !== 'directory') return
        const host = hostOf(dirHostId)
        if (host) setDeviceName(host.name)
      }, [step, dirHostId, hosts])

      const update = (patch) => {
        // ZCode `Kvt`: editing any connection field unlinks the SSH config alias.
        if (['host', 'port', 'username', 'privateKeyPath', 'authKind'].some((key) => key in patch)) {
          setSelectedAlias('')
        }
        setForm((old) => ({ ...old, ...patch }))
      }
      const applyAlias = (alias) => {
        setForm((old) => ({
          ...old,
          name: old.name || alias.alias,
          host: alias.host || alias.alias,
          port: alias.port || 22,
          username: alias.username || old.username,
          authKind: alias.privateKeyPath ? 'key' : old.authKind,
          privateKeyPath: alias.privateKeyPath || old.privateKeyPath
        }))
        setSelectedAlias(alias.alias)
        setImportOpen(false)
        setImportQuery('')
        setErrors({})
      }
      const openHost = (host) => {
        setForm(hostToForm(host))
        setEditingId(host.id)
        setSelectedAlias('')
        setErrors({}); setError(''); setImportOpen(false)
        setStep('settings')
      }
      const openNew = (kind = 'ssh') => {
        setForm({ ...emptyConnectForm(), kind })
        setEditingId('')
        setDirHostId('')
        setRemotePath('~')
        setDeviceName('')
        setSelectedAlias('')
        setErrors({}); setError(''); setImportOpen(false); setAdvanced(false); setDockerOpen(false)
        setStep('settings')
      }
      // nVn's WSL distribution / Docker container rows select that target and
      // land on the settings step with the value prefilled.
      const openDiscovered = (kind, row) => {
        if (kind === 'wsl') {
          setForm({ ...emptyConnectForm(), kind: 'wsl', distro: row.name })
        } else {
          setForm({
            ...emptyConnectForm(),
            kind: 'docker',
            container: row.name,
            manualContainer: row.name,
            dockerMode: 'select',
            image: row.image || ''
          })
        }
        setEditingId(''); setDirHostId(''); setRemotePath('~'); setDeviceName('')
        setErrors({}); setError(''); setImportOpen(false); setAdvanced(false); setDockerOpen(false)
        setStep('settings')
      }

      const refreshDocker = useCallback(async () => {
        setDockerLoading(true)
        try {
          const data = await api('GET', '/ssh-remote/discover?kind=docker')
          setDiscovery((old) => ({
            ...old,
            docker: {
              available: Boolean(data.docker?.available),
              containers: data.docker?.containers || [],
              error: data.docker?.error || '',
              loading: false
            }
          }))
        } catch (err) {
          setDiscovery((old) => ({
            ...old,
            docker: { ...old.docker, error: errorMessage(err), loading: false }
          }))
        } finally {
          setDockerLoading(false)
        }
      }, [])

      const hostPayload = () => {
        if (form.kind === 'wsl') {
          return {
            id: editingId || undefined,
            kind: 'wsl',
            name: form.name || form.distro.trim() || 'WSL',
            distro: form.distro.trim(),
            user: form.wslUser.trim(),
            defaultPath: form.defaultPath || '~'
          }
        }
        if (form.kind === 'docker') {
          const container = (form.dockerMode === 'manual' ? form.manualContainer : form.container).trim()
          return {
            id: editingId || undefined,
            kind: 'docker',
            name: form.name || container || 'Docker',
            container,
            image: form.image || '',
            defaultPath: form.defaultPath || '~'
          }
        }
        const auth = form.authKind === 'key'
          ? { kind: 'key', privateKeyPath: form.privateKeyPath.trim(), ...(form.passphrase ? { passphrase: form.passphrase } : {}) }
          : { kind: 'password', ...(form.password ? { password: form.password } : {}) }
        return {
          id: editingId || undefined,
          kind: 'ssh',
          name: form.name || form.host.trim(),
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username.trim(),
          auth,
          defaultPath: form.defaultPath || '~',
          hostKeyMode: form.hostKeyMode || 'accept-new',
          assetInstallMode: form.assetInstallMode || 'local-download-upload'
        }
      }

      const submitSettings = async () => {
        setImportOpen(false)
        const next = {}
        if (form.kind === 'wsl') {
          if (form.wslUser.trim() && !isValidWslUserClient(form.wslUser)) next.wslUser = t('z.wslInvalidUser')
        } else if (form.kind === 'docker') {
          const container = (form.dockerMode === 'manual' ? form.manualContainer : form.container).trim()
          if (!container) next.container = t('z.dockerRequired')
        } else {
          if (!form.host.trim()) next.host = t('z.validation.host')
          const port = Number(form.port)
          if (!Number.isInteger(port) || port < 1 || port > 65535) next.port = t('z.validation.port')
          if (!form.username.trim()) next.username = t('z.validation.username')
          if (form.authKind === 'key') {
            if (!form.privateKeyPath.trim()) next.privateKey = t('z.validation.key')
          } else if (!editingId && !form.password) {
            next.password = t('z.validation.password')
          }
        }
        setErrors(next)
        if (Object.keys(next).length > 0) return

        setStep('connecting'); setBusy(true); setError(''); setConnectLog(''); setConnectStartedAt(Date.now()); setCancelled(false)
        setPhases([
          { key: 'channel', label: phaseChannelLabel(form.kind), status: 'active' },
          { key: 'identify', label: t('z.phase.identify'), status: 'pending' },
          { key: 'deploy', label: t('z.phase.deploy'), status: 'pending' }
        ])
        const payload = hostPayload()
        const token = probeToken.current + 1
        probeToken.current = token
        try {
          // Probe before saving so a typo does not leave a broken device behind,
          // and reuse an existing record with the same target.
          const probeData = await api('POST', '/ssh-remote/hosts/test', { host: payload })
          if (probeToken.current !== token) return
          const probe = probeData.probe || {}
          setConnectLog([
            `${t('z.connect')} ${targetLabelFor(payload)}`,
            `${probe.platform || ''} ${probe.arch || ''} · Node ${probe.node || '—'} · ${probe.latencyMs ?? '?'}ms`
          ].join('\n'))
          setPhases((old) => old.map((row) => ({ ...row, status: 'complete' })))
          const existing = hosts.find((row) => {
            if (row.id === editingId || kindOfrow(row) !== form.kind) return false
            if (form.kind === 'wsl') {
              return (String(row.distro || '').trim()) === String(payload.distro || '').trim()
                && (String(row.user || '').trim()) === String(payload.user || '').trim()
            }
            if (form.kind === 'docker') return String(row.container || '') === String(payload.container || '')
            return row.host === payload.host
              && Number(row.port) === Number(payload.port)
              && row.username === payload.username
          })
          // Re-entering an existing target without typing a name must keep the
          // device's own name (ZCode renames only through 编辑连接), not fall
          // back to the host address.
          if (existing && !form.name.trim()) payload.name = existing.name
          const saved = await api('POST', '/ssh-remote/hosts/save', { host: { ...payload, id: payload.id || existing?.id } })
          if (probeToken.current !== token) return
          const host = saved.host
          setEditingId(host.id)
          setDirHostId(host.id)
          const recent = workspacesFor(host.id)[0]
          const path = recent?.remotePath || host.defaultPath || '~'
          setRemotePath(path)
          setBusy(false)
          void backgroundFlow.startPrepare(host, { path, probe })
        } catch (err) {
          if (probeToken.current !== token) return
          setBusy(false)
          setError(errorMessage(err))
          setConnectLog((old) => `${old}${old ? '\n' : ''}${errorMessage(err)}`)
          setPhases((old) => old.map((row) => (row.status === 'active' ? { ...row, status: 'failed' } : row)))
        }
      }

      const connectSaved = (host) => {
        setEditingId(host.id)
        setForm(hostToForm(host))
        setErrors({}); setError(''); setConnectLog(''); setRenameState('idle')
        const recent = workspacesFor(host.id)[0]
        const path = recent?.remotePath || host.defaultPath || '~'
        setDirHostId(host.id)
        setRemotePath(path)
        setStep('connecting')
        setConnectStartedAt(Date.now())
        setCancelled(false)
        void backgroundFlow.startPrepare(host, { path })
      }

      const createWorkspace = () => {
        if (!dirHostId || connecting || bg.phase === 'running') return
        const host = hostOf(dirHostId)
        const path = String(remotePath || '~').trim() || '~'
        // ZCode reuses the existing workspace when the directory already has
        // one instead of failing the create job.
        const existing = workspaces.find((row) => row.hostId === dirHostId && row.remotePath === path)
        if (existing) {
          void openExisting(existing)
          return
        }
        setError('')
        setStep('connecting')
        setConnectStartedAt(Date.now())
        setCancelled(false)
        void backgroundFlow.startCreate({
          hostId: dirHostId,
          host,
          targetKind: host ? kindOfrow(host) : 'ssh',
          path,
          name: '',
          device: host ? targetLabelFor(host) : deviceLabel,
          syncCredentials: settings ? settings.syncCredentials !== false : true,
          createIfMissing: settings ? settings.createIfMissing !== false : true
        })
      }

      const openExisting = async (workspace) => {
        setOpeningId(workspace.id)
        setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/open', { id: workspace.id })
          const ws = data.workspace || workspace
          const opened = ws.nativeWorkspaceId ? openNativeWorkspace?.(ws.nativeWorkspaceId) : false
          if (!opened) {
            setError(t('z.openFailed'))
            return
          }
          onCreated?.(ws)
          onClose()
          // ZCode reconnects the device after opening a project. Probe the
          // real service (the cached badge can be stale) and start it in the
          // background when needed; navigation never blocks on the probe.
          void api('GET', `/ssh-remote/workspaces/status?id=${encodeURIComponent(ws.id)}`)
            .then((data) => {
              if (data?.ok && data.status?.state !== 'running') {
                return api('POST', '/ssh-remote/workspaces/action', { op: 'start', id: ws.id })
              }
              return null
            })
            .catch(() => {})
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setOpeningId('')
        }
      }

      const retryConnection = () => {
        const snapshot = backgroundFlow.snapshot
        const wasIdle = snapshot.phase === 'idle'
        const kind = snapshot.kind
        backgroundFlow.reset()
        setError(''); setConnectLog(''); setCancelled(false); setConnectStartedAt(Date.now())
        // A validation/probe failure never reached the background job: repeat
        // the form submission so edited credentials are used.
        if (wasIdle) {
          void submitSettings()
          return
        }
        if (kind === 'create' && dirHostId) {
          createWorkspace()
          return
        }
        const host = editingId ? hostOf(editingId) : null
        if (host) {
          void backgroundFlow.startPrepare(host, { path: remotePath })
          return
        }
        setStep('settings')
      }

      const backToConfig = () => {
        probeToken.current += 1
        const wasCreate = backgroundFlow.snapshot.kind === 'create'
        backgroundFlow.reset()
        setBusy(false); setCancelled(false)
        setError(''); setConnectLog('')
        if (wasCreate) {
          setStep('directory')
          return
        }
        const host = editingId ? hostOf(editingId) : null
        if (host) setForm(hostToForm(host))
        setStep('settings')
      }

      const minimizeFlow = () => {
        backgroundFlow.minimize()
        onClose()
      }

      // ZCode's header offers minimize on every step. Before a job exists we
      // park the wizard state so the pill can resume configuration.
      const minimizeWizard = () => {
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' || snapshot.phase === 'failed') {
          minimizeFlow()
          return
        }
        setPausedWizard({
          step,
          form,
          editingId,
          dirHostId,
          remotePath,
          query,
          deviceName,
          device: wizardName
        })
        onClose()
      }

      const closeOrMinimize = () => {
        const phase = backgroundFlow.snapshot.phase
        if (step === 'connecting' && (busy || phase === 'running' || phase === 'confirm-install')) {
          setLeaveConfirm(true)
          return
        }
        if (phase === 'running' || phase === 'failed') minimizeFlow()
        else onClose()
      }

      // ZCode `Xn` (`onCancelConnection`): 取消连接 aborts the attempt. In
      // device management that closes the dialog (`zn(); i(e)`); in the wizard
      // the connecting view stays open in the cancelled state so 重试 can
      // restart the same attempt. Preparing the runtime is side-effect-free,
      // so dropping the flow is safe; a workspace creation that already
      // started keeps running and stays visible in the pill.
      const cancelAttempt = () => {
        probeToken.current += 1
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' && snapshot.kind === 'create') {
          minimizeFlow()
          return
        }
        backgroundFlow.reset()
        setBusy(false); setError(''); setConnectLog(''); setPhases([])
        if (deviceManagement) {
          onClose()
          return
        }
        setCancelled(true)
      }

      // Leaving through the header X / Esc / the overlay performs the same
      // abort, then closes the dialog.
      const stopAndClose = () => {
        cancelAttempt()
        onClose()
      }

      const saveRename = async () => {
        const host = hostOf(dirHostId)
        const name = deviceName.trim()
        if (!host || !name || name === host.name) return
        setRenameState('saving')
        try {
          const data = await api('POST', '/ssh-remote/hosts/rename', { id: dirHostId, name })
          setHosts((old) => old.map((row) => (row.id === data.host.id ? data.host : row)))
          setRenameState('saved')
        } catch {
          setRenameState('failed')
        }
      }

