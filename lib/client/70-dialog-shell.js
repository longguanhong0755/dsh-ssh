// part: 70-dialog-shell -- RemoteDialog: header, leave confirm, return

      const headTitles = h('div', { className: 'rem-head-titles' },
        h('div', { className: 'rem-title-row' },
          h('h2', { className: 'rem-title' }, header.title),
          header.kind
            ? h('span', { className: `rem-badge rem-badge-${header.kind}` },
                h(Icon, { name: kindIconName(header.kind), size: 12 }),
                h('span', null, kindLabel(header.kind))
              )
            : null
        ),
        header.preview
          ? h('p', { className: 'rem-preview' }, header.preview)
          : header.desc ? h('p', { className: 'rem-desc' }, header.desc) : null
      )
      const minimizableFlow = bg.phase === 'running' || bg.phase === 'failed'
      const headActions = h('div', { className: 'rem-head-actions' },
        !deviceManagement || minimizableFlow ? h('button', {
          type: 'button',
          className: 'rem-btn rem-btn-ghost rem-btn-icon',
          title: t('z.minimize'),
          onClick: minimizeWizard
        }, h(Icon, { name: 'minus', size: 12 })) : null,
        h('button', {
          type: 'button',
          className: 'rem-btn rem-btn-ghost rem-btn-icon',
          title: t('common.close'),
          onClick: closeOrMinimize
        }, h(Icon, { name: 'x', size: 12 }))
      )

      // Confirm before dropping an in-flight connection; the stay button is focused first.
      const leaveNode = leaveConfirm
        ? h(Modal, {
            title: t('z.leave.title'),
            footer: [
              h('button', {
                key: 'stay',
                type: 'button',
                className: 'rem-btn rem-btn-outline',
                autoFocus: true,
                onClick: () => setLeaveConfirm(false)
              }, t('common.cancel')),
              h('button', {
                key: 'stop',
                type: 'button',
                className: 'rem-btn rem-btn-default',
                onClick: () => { setLeaveConfirm(false); stopAndClose() }
              }, t('z.leave.confirm'))
            ]
          },
            h('p', { className: 'rem-desc', style: { margin: 0 } }, t('z.leave.desc'))
          )
        : null

      const wizardNode = h('div', {
        className: 'rem-ui rem-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) closeOrMinimize() }
      },
        h('div', { className: 'rem-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': header.title },
          h('div', { className: 'rem-body' },
            h('div', { className: 'rem-head' },
              h('div', { className: 'rem-head-top' },
                deviceManagement ? headTitles : h(WizardSteps, { step }),
                headActions
              ),
              deviceManagement ? null : headTitles
            ),
            step !== 'connecting' && error
              ? h('div', { className: 'rem-error' }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error))
              : null,
            body
          )
        ),
        importMenuNode
      )
      return leaveNode ? h(React.Fragment, null, wizardNode, leaveNode) : wizardNode
    }

