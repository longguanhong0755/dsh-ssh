// part: 35-ui-primitives -- tiny UI primitives (Btn, Badge, Field, toText...)
    // ── tiny UI primitives ─────────────────────────────────────────────────
    function Btn(props) {
      const cls = ['sshR-btn', props.kind || '', props.className || ''].filter(Boolean).join(' ')
      return h('button', {
        type: 'button',
        className: cls,
        disabled: Boolean(props.disabled),
        title: props.title || undefined,
        onClick: props.onClick
      }, props.children)
    }
    function Modal(props) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && props.onClose) props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.onClose])
      return h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && props.onClose) props.onClose() }
      },
        h('div', { className: `zc-dialog zc-modal${props.wide ? ' wide' : ''}` },
          h('div', { className: 'zc-body' },
            h('div', { className: 'zc-head' },
              h('div', { className: 'zc-head-top' },
                h('h2', { className: 'zc-title' }, props.title),
                h('div', { className: 'zc-head-actions' },
                  props.onClose
                    ? h('button', {
                        type: 'button',
                        className: 'zc-btn zc-btn-ghost zc-btn-icon',
                        title: t('common.close'),
                        onClick: props.onClose
                      }, h(Icon, { name: 'x', size: 12 }))
                    : null
                )
              ),
              props.headRight || null
            ),
            h('div', { className: 'zc-modal-body' }, props.children),
            props.footer ? h('div', { className: 'zc-modal-foot' }, props.footer) : null
          )
        )
      )
    }
    function Field(props) {
      return h('div', { className: 'sshR-field', style: props.style },
        props.label ? h('label', null, props.label) : null,
        props.children,
        props.hint ? h('p', { className: 'sshR-hint' }, props.hint) : null
      )
    }
    function Input(props) {
      return h('input', {
        className: 'sshR-input',
        type: props.type || 'text',
        value: props.value ?? '',
        placeholder: props.placeholder || '',
        disabled: Boolean(props.disabled),
        autoComplete: props.autoComplete || 'off',
        spellCheck: false,
        onChange: (event) => props.onChange ? props.onChange(event.target.value) : undefined,
        onKeyDown: props.onKeyDown
      })
    }
    function Select(props) {
      return h('select', {
        className: 'sshR-select',
        style: props.style,
        value: props.value,
        disabled: Boolean(props.disabled),
        onChange: (event) => props.onChange ? props.onChange(event.target.value) : undefined
      }, props.children)
    }
    function HostPicker({ hosts, value, onChange }) {
      return h('div', { className: 'sshR-hostPick' },
        hosts.map((host) => h('button', {
          key: host.id,
          type: 'button',
          className: `sshR-hostOption ${host.id === value ? 'active' : ''}`.trim(),
          onClick: () => onChange(host.id)
        },
          h('span', { className: 'sshR-hostName' }, host.name),
          h('span', { className: 'sshR-hostAddr' }, `${host.username}@${host.host}:${host.port}`),
          h('span', { className: 'sshR-hostMeta' }, host.auth?.kind === 'key' ? 'key' : 'password')
        ))
      )
    }
    function Check(props) {
      return h('label', { className: 'sshR-check' },
        h('input', { type: 'checkbox', checked: Boolean(props.checked), disabled: Boolean(props.disabled), onChange: (event) => props.onChange ? props.onChange(event.target.checked) : undefined }),
        h('span', null, props.children)
      )
    }
    function stateLabel(state) {
      const key = `panel.state.${state || 'unknown'}`
      return t(key)
    }
    function fmtBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
      return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
    }
    function fmtUptime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '—'
      const total = Math.floor(seconds)
      const days = Math.floor(total / 86400)
      const hours = Math.floor((total % 86400) / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = total % 60
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m ${secs}s`
      return `${secs}s`
    }
    function errorMessage(error) {
      return String((error && error.message) || error || t('common.unknownError'))
    }

