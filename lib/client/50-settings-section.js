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
    // device into online / connecting / stopped status. An explicit stop or
    // disconnect wins over a stale flag, and a reachable device counts as
    // connected even when it has no projects yet.
    function hostStatusFor(host, workspaces, expectedVersion = '') {
      if (host?.serviceState === 'stopped') {
        return { tone: 'neutral', label: t('device.status.stopped'), online: false }
      }
      if (host?.disconnectedAt) {
        return { tone: 'neutral', label: t('device.status.disconnected'), online: false }
      }
      // 更新中: 安装过程持有远端安装锁，安装完成前设备
      // 既不算空闲，也不能再次连接。
      if (host?.updating) {
        return { tone: 'progress', label: t('device.status.updating'), online: false }
      }
      const related = workspaces.filter((workspace) => workspace.hostId === host.id)
      if (related.some((workspace) => workspace.status?.state === 'running')) {
        return withVersionStatus(host, related, expectedVersion, { tone: 'success', label: t('device.status.online'), online: true })
      }
      if (host?.connState === 'connected') {
        return withVersionStatus(host, related, expectedVersion, { tone: 'success', label: t('device.status.online'), online: true })
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

    // 需要更新: 远端运行的服务版本低于本桌面端要求的版本，
    // 设备仍保持连接，列表里直接给出下一步操作。
    function withVersionStatus(host, related, expectedVersion, online) {
      const deployed = String(host?.runtimeVersion || related.find((row) => row.dshVersion)?.dshVersion || '')
      const wanted = String(expectedVersion || '')
      if (deployed && wanted && deployed !== wanted) {
        return { tone: 'warning', label: t('device.status.needsUpdate'), online: true }
      }
      return online
    }

    // relative device time: just now / N minutes ago / N hours ago / yesterday / date.
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

    // 偏好设置开关：用 button 承载 role="switch"，选中态写在 aria-checked 上。
    function DeviceSwitch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'rem-switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled: Boolean(disabled),
        onClick: () => onChange?.(!checked)
      }, h('span', { 'aria-hidden': 'true' }))
    }

    // 设备页时间戳（上次成功 / 最近在线）：当天只显示 HH:mm，跨天显示 MM-DD HH:mm。
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

    // device tile icons: SSH is a cloud, WSL a monitor, Docker a box.
    function deviceTileIcon(kind) {
      return kind === 'wsl' ? 'monitor' : kind === 'docker' ? 'box' : 'cloud'
    }

