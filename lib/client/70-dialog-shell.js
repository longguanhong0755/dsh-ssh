// part: 70-dialog-shell -- ZcodeRemoteDialog: header, leave confirm, return

      const headTitles = h('div', { className: 'zc-head-titles' },
        h('div', { className: 'zc-title-row' },
          h('h2', { className: 'zc-title' }, header.title),
          header.kind
            ? h('span', { className: `zc-badge zc-badge-${header.kind}` },
                h(Icon, { name: kindIconName(header.kind), size: 12 }),
                h('span', null, kindLabel(header.kind))
              )
            : null
        ),
        header.preview
          ? h('p', { className: 'zc-preview' }, header.preview)
          : header.desc ? h('p', { className: 'zc-desc' }, header.desc) : null
      )
      const minimizableFlow = bg.phase === 'running' || bg.phase === 'failed'
      const headActions = h('div', { className: 'zc-head-actions' },
        !deviceManagement || minimizableFlow ? h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost zc-btn-icon',
          title: t('z.minimize'),
          onClick: minimizeWizard
        }, h(Icon, { name: 'minus', size: 12 })) : null,
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost zc-btn-icon',
          title: t('common.close'),
          onClick: closeOrMinimize
        }, h(Icon, { name: 'x', size: 12 }))
      )

      // ZCode `Bn()`: AlertDialog before dropping an in-flight connection.
      const leaveNode = leaveConfirm
        ? h(Modal, {
            title: t('z.leave.title'),
            footer: [
              h('button', {
                key: 'stay',
                type: 'button',
                className: 'zc-btn zc-btn-outline',
                autoFocus: true,
                onClick: () => setLeaveConfirm(false)
              }, t('common.cancel')),
              h('button', {
                key: 'stop',
                type: 'button',
                className: 'zc-btn zc-btn-default',
                onClick: () => { setLeaveConfirm(false); stopAndClose() }
              }, t('z.leave.confirm'))
            ]
          },
            h('p', { className: 'zc-desc', style: { margin: 0 } }, t('z.leave.desc'))
          )
        : null

      const wizardNode = h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) closeOrMinimize() }
      },
        h('div', { className: 'zc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': header.title },
          h('div', { className: 'zc-body' },
            h('div', { className: 'zc-head' },
              h('div', { className: 'zc-head-top' },
                deviceManagement ? headTitles : h(WizardSteps, { step }),
                headActions
              ),
              deviceManagement ? null : headTitles
            ),
            step !== 'connecting' && error
              ? h('div', { className: 'zc-error' }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error))
              : null,
            body
          )
        ),
        importMenuNode
      )
      return leaveNode ? h(React.Fragment, null, wizardNode, leaveNode) : wizardNode
    }

