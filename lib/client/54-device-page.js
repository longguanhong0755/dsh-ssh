// part: 54-device-page -- settings device page render
    // 设置 → 远程设备页：页头标题、说明文字和 `设备` 分组。
    // 运行时默认值不属于这一页，所以这个界面只管理设备；
    // 侧边栏面板渲染的就是同一个页面。
    function SettingsSection() {
      const [createOpen, setCreateOpen] = useState(false)
      const [refreshToken, setRefreshToken] = useState(0)
      useBackendPlatform()
      return h('div', { className: 'rem-ui rem-settings rem-remote-settings' },
        h('div', { className: 'rem-panel-head' },
          h('div', null,
            h('h2', { className: 'rem-panel-title' }, t('panel.heading')),
            h('p', { className: 'rem-panel-sub' }, t(supportsWsl() ? 'panel.sub' : 'panel.subNoWsl'))
          ),
          h('div', { className: 'rem-panel-actions' },
            h('button', {
              type: 'button',
              className: 'rem-btn rem-btn-default',
              onClick: () => setCreateOpen(true)
            }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
          )
        ),
        h(HostsPane, {
          createOpen,
          onCreate: () => setCreateOpen(true),
          onCloseCreate: () => setCreateOpen(false),
          refreshToken,
          onChanged: () => setRefreshToken((value) => value + 1)
        })
      )
    }

