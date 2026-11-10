// part: 50-settings-section -- settings section helpers (host form, log clock, labels)
    // ── Settings section ───────────────────────────────────────────────────
    function emptyHostForm() {
      return {
        id: '',
        kind: 'ssh',
        name: '',
        host: '',
        port: 22,
        username: 'root',
        authKind: 'password',
        password: '',
        privateKeyPath: '',
        passphrase: '',
        distro: '',
        wslUser: '',
        container: '',
        manualContainer: '',
        dockerMode: 'manual',
        image: '',
        defaultPath: '~',
        hostKeyMode: 'accept-new',
        assetInstallMode: 'local-download-upload'
      }
    }
    function hostToForm(host) {
      return {
        id: host.id,
        kind: host.kind === 'wsl' || host.kind === 'docker' ? host.kind : 'ssh',
        name: host.name || '',
        host: host.host || '',
        port: host.port || 22,
        username: host.username || 'root',
        authKind: host.auth?.kind === 'key' ? 'key' : 'password',
        password: '',
        privateKeyPath: host.auth?.privateKeyPath || '',
        passphrase: '',
        distro: host.distro || '',
        wslUser: host.user || '',
        container: host.container || '',
        manualContainer: host.container || '',
        dockerMode: host.container ? 'select' : 'manual',
        image: host.image || '',
        defaultPath: host.defaultPath || '~',
        hostKeyMode: host.hostKeyMode || 'accept-new',
        assetInstallMode: host.assetInstallMode || 'local-download-upload'
      }
    }
    // Aggregate the live SSH reachability and workspace runner state per
    // device, mirroring ZCode's online / connecting / no-connection / stopped
    // status. An explicit stop or disconnect wins over a stale flag, and a
    // reachable device is 已连接 even when it has no projects yet.
    function hostStatusFor(host, workspaces) {
      if (host?.serviceState === 'stopped') {
        return { tone: 'neutral', label: t('device.status.stopped'), online: false }
      }
      if (host?.disconnectedAt) {
        return { tone: 'neutral', label: t('device.status.disconnected'), online: false }
      }
      const related = workspaces.filter((workspace) => workspace.hostId === host.id)
      if (related.some((workspace) => workspace.status?.state === 'running')) {
        return { tone: 'success', label: t('device.status.online'), online: true }
      }
      if (host?.connState === 'connected') {
        return { tone: 'success', label: t('device.status.online'), online: true }
      }
      if (related.some((workspace) => workspace.status?.state === 'starting')) {
        return { tone: 'progress', label: t('device.status.connecting'), online: false }
      }
      if (related.some((workspace) => workspace.status?.state === 'error')) {
        return { tone: 'danger', label: t('device.status.failed'), online: false }
      }
      if (host?.connState === 'connecting' || !host?.connState) {
        return { tone: 'progress', label: t('device.status.connecting'), online: false }
      }
      return { tone: 'neutral', label: t('device.status.offline'), online: false }
    }

    // ZCode `j9`: just now / N minutes ago / N hours ago / yesterday / date.
    function formatRelativeDeviceTime(iso) {
      const time = new Date(iso).getTime()
      if (!iso || Number.isNaN(time)) return ''
      const delta = Math.max(0, Date.now() - time)
      if (delta < 60_000) return t('device.justNow')
      if (delta < 3_600_000) return t('device.minutesAgo', { count: Math.floor(delta / 60_000) })
      if (delta < 86_400_000) return t('device.hoursAgo', { count: Math.floor(delta / 3_600_000) })
      if (delta < 172_800_000) return t('device.yesterday')
      const date = new Date(time)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function formatLogClock(iso) {
      const date = new Date(iso)
      if (!iso || Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    // ZCode `Dj` switch used by 偏好设置.
    function DeviceSwitch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'zc-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: Boolean(disabled),
        onClick: () => onChange?.(!checked)
      }, h('span', { 'aria-hidden': 'true' }))
    }

    // ZCode `zYn` device page timestamps (`上次成功 {time}` / `最近在线 {time}`).
    function formatDeviceTime(iso) {
      const date = new Date(iso)
      if (!iso || Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      const now = new Date()
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
    }

    // ZCode `zYn` tiles: SSH is a cloud, WSL a monitor, Docker a box.
    function deviceTileIcon(kind) {
      return kind === 'wsl' ? 'monitor' : kind === 'docker' ? 'box' : 'cloud'
    }

