// part: 66-dialog-state -- ZcodeRemoteDialog: props, state hooks and load()
    function ZcodeRemoteDialog({ onClose, onCreated, openPanel, openNativeWorkspace, mode = 'wizard', onManaged }) {
      const deviceManagement = mode === 'device-management'
      // A paused wizard belongs to the wizard surface; device management must
      // always start from a fresh 新建连接 form.
      const previous = deviceManagement ? null : pausedWizard
      const [step, setStep] = useState(previous?.step || (deviceManagement ? 'settings' : 'device'))
      const [hosts, setHosts] = useState([])
      const [workspaces, setWorkspaces] = useState([])
      const [settings, setSettings] = useState(null)
      const [aliases, setAliases] = useState([])
      const [discovery, setDiscovery] = useState({
        wsl: { available: false, distros: [], error: '', loading: true },
        docker: { available: false, containers: [], error: '', loading: true }
      })
      const [dockerOpen, setDockerOpen] = useState(false)
      const [dockerQuery, setDockerQuery] = useState('')
      const [dockerLoading, setDockerLoading] = useState(false)
      const [query, setQuery] = useState(previous?.query || '')
      const [form, setForm] = useState(previous?.form || emptyConnectForm())
      const [editingId, setEditingId] = useState(previous?.editingId || '')
      const [errors, setErrors] = useState({})
      const [showPassword, setShowPassword] = useState(false)
      const [advanced, setAdvanced] = useState(false)
      const [importOpen, setImportOpen] = useState(false)
      const [importQuery, setImportQuery] = useState('')
      const [selectedAlias, setSelectedAlias] = useState(previous?.selectedAlias || '')
      const [aliasesLoading, setAliasesLoading] = useState(false)
      const [aliasesError, setAliasesError] = useState('')
      const [phases, setPhases] = useState([])
      const [connectLog, setConnectLog] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [dirHostId, setDirHostId] = useState(previous?.dirHostId || '')
      const [remotePath, setRemotePath] = useState(previous?.remotePath || '~')
      const [deviceName, setDeviceName] = useState(previous?.deviceName || '')
      const [renameState, setRenameState] = useState('idle')
      const [openingId, setOpeningId] = useState('')
      const [browseRequest, setBrowseRequest] = useState(null)
      const [logOpen, setLogOpen] = useState(false)
      const [leaveConfirm, setLeaveConfirm] = useState(false)
      const [cancelled, setCancelled] = useState(false)
      const [pasteInfo, setPasteInfo] = useState(null)
      const [connectStartedAt, setConnectStartedAt] = useState(0)
      const [dirReady, setDirReady] = useState(false)
      const [clock, setClock] = useState(Date.now())
      const keyFileRef = useRef(null)
      const dockerRef = useRef(null)
      const importButtonRef = useRef(null)
      const probeToken = useRef(0)
      const bg = useBackgroundFlow()
      useBackendPlatform()

      const load = useCallback(async () => {
        setAliasesLoading(true)
        try {
          const [hostData, workspaceData, settingsData, aliasData, discoveryData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0'),
            api('GET', '/ssh-remote/settings'),
            api('GET', '/ssh-remote/ssh-config').catch((err) => ({ aliases: [], error: errorMessage(err) })),
            api('GET', '/ssh-remote/discover').catch(() => null)
          ])
          setHosts(hostData.hosts || [])
          setWorkspaces(workspaceData.workspaces || [])
          setSettings(settingsData.settings || null)
          setAliases(aliasData.aliases || [])
          setAliasesError(aliasData.error || '')
          if (discoveryData?.ok) {
            setBackendPlatform(discoveryData.platform)
            setDiscovery({
              wsl: {
                available: Boolean(discoveryData.wsl?.available),
                distros: discoveryData.wsl?.distros || [],
                error: discoveryData.wsl?.error || '',
                loading: false
              },
              docker: {
                available: Boolean(discoveryData.docker?.available),
                containers: discoveryData.docker?.containers || [],
                error: discoveryData.docker?.error || '',
                loading: false
              }
            })
          }
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setAliasesLoading(false)
        }
      }, [])
      useEffect(() => { void load() }, [load])

