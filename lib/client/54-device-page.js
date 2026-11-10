// part: 54-device-page -- settings device page render
    // ZCode 设置 → 远程设备 (`zYn`): page heading, description and the `设备`
    // group. Runtime defaults are not part of that page, so this surface is
    // devices only; the sidebar panel renders the exact same page.
    function SettingsSection() {
      const [createOpen, setCreateOpen] = useState(false)
      const [refreshToken, setRefreshToken] = useState(0)
      useBackendPlatform()
      return h('div', { className: 'zc-ui zc-settings zc-remote-settings' },
        h('div', { className: 'zc-panel-head' },
          h('div', null,
            h('h2', { className: 'zc-panel-title' }, t('panel.heading')),
            h('p', { className: 'zc-panel-sub' }, t(supportsWsl() ? 'panel.sub' : 'panel.subNoWsl'))
          ),
          h('div', { className: 'zc-panel-actions' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-default',
              onClick: () => setCreateOpen(true)
            }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
          )
        ),
        h(HostsPane, {
          createOpen,
          onCloseCreate: () => setCreateOpen(false),
          refreshToken,
          onChanged: () => setRefreshToken((value) => value + 1)
        })
      )
    }

