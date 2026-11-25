// part: 69-dialog-body -- RemoteDialog: per-step body (device/settings/connecting/directory)
      let body = null
      if (step === 'device') {
        body = h('div', { className: 'rem-step-device' },
          h('div', { className: 'rem-search-wrap' },
            h('span', { className: 'rem-search-icon' }, h(Icon, { name: 'search', size: 16 })),
            h('input', {
              type: 'search',
              className: 'rem-input rem-search-input',
              autoFocus: true,
              placeholder: t('z.search'),
              'aria-label': t('z.search'),
              value: query,
              onChange: (event) => setQuery(event.target.value)
            })
          ),
          h('div', {
            className: 'rem-scroll',
            onKeyDown: (event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'))
              if (buttons.length === 0) return
              const index = buttons.indexOf(document.activeElement)
              const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              buttons[next]?.focus()
              event.preventDefault()
            }
          },
            filteredHosts.length > 0
              ? h('section', { key: 'hosts', 'aria-label': t('z.saved') },
                  h('p', { className: 'rem-section-title' }, t('z.saved')),
                  filteredHosts.map((host) => {
                    const rows = workspacesFor(host.id)
                    const online = rows.some((row) => row.status?.state === 'running')
                    return h('div', { key: host.id, className: 'rem-device-item', 'data-remote-source-server-id': host.id },
                      h('button', {
                        type: 'button',
                        className: 'rem-device',
                        title: `${t('z.connect')} ${targetLabelFor(host)}`,
                        onClick: () => connectSaved(host)
                      },
                        h('span', { className: `rem-device-icon rem-device-icon-${kindOfrow(host)}` }, h(Icon, { name: kindIconName(kindOfrow(host)), size: 16 })),
                        h('span', { className: 'rem-device-main' },
                          h('span', { className: 'rem-device-name' }, host.name),
                          h('span', { className: 'rem-device-desc' }, targetLabelFor(host))
                        ),
                        h(StatusBadge, { tone: online ? 'success' : 'neutral' }, online ? t('z.status.connected') : t('z.status.offline'))
                      ),
                      rows.length > 0
                        ? h('div', { className: 'rem-chips' }, rows.slice(0, 3).map((row) => h('button', {
                            key: row.id,
                            type: 'button',
                            className: 'rem-chip',
                            title: row.remotePath,
                            disabled: Boolean(openingId),
                            onClick: () => void openExisting(row)
                          },
                            openingId === row.id ? h(Spinner, { className: 'rem-spin' }) : h(Icon, { name: 'folder', size: 12 }),
                            h('span', null, row.remotePath)
                          )))
                        : null
                    )
                  })
                )
              : null,
            filteredAliases.length > 0
              ? h('section', { key: 'aliases', 'aria-label': t('z.sshHosts') },
                  h('p', { className: 'rem-section-title' }, t('z.sshHosts'), h('span', { className: 'rem-section-mono' }, '~/.ssh/config')),
                  filteredAliases.map((alias) => h('button', {
                    key: alias.alias,
                    type: 'button',
                    className: 'rem-device',
                    onClick: () => { applyAlias(alias); setStep('settings') }
                  },
                    h('span', { className: 'rem-device-icon rem-device-icon-ssh' }, h(Icon, { name: 'server', size: 16 })),
                    h('span', { className: 'rem-device-main' },
                      h('span', { className: 'rem-device-name' }, alias.alias),
                      h('span', { className: 'rem-device-desc' }, `${alias.username ? `${alias.username}@` : ''}${alias.host || alias.alias}${alias.port ? `:${alias.port}` : ''}`)
                    )
                  ))
                )
              : null,
            filteredDistros.length > 0
              ? h('section', { key: 'wsl', 'aria-label': t('z.wslSection') },
                  h('p', { className: 'rem-section-title' }, t('z.wslSection')),
                  filteredDistros.map((row) => h('button', {
                    key: row.name,
                    type: 'button',
                    className: 'rem-device',
                    onClick: () => openDiscovered('wsl', row)
                  },
                    h('span', { className: 'rem-device-icon rem-device-icon-wsl' }, h(Icon, { name: 'squareTerminal', size: 16 })),
                    h('span', { className: 'rem-device-main' },
                      h('span', { className: 'rem-device-name' }, row.name),
                      h('span', { className: 'rem-device-desc' }, t('z.wslDesc'))
                    )
                  ))
                )
              : null,
            filteredContainers.length > 0
              ? h('section', { key: 'docker', 'aria-label': t('z.dockerSection') },
                  h('p', { className: 'rem-section-title' }, t('z.dockerSection')),
                  filteredContainers.map((row) => h('button', {
                    key: row.id,
                    type: 'button',
                    className: 'rem-device',
                    onClick: () => openDiscovered('docker', row)
                  },
                    h('span', { className: 'rem-device-icon rem-device-icon-docker' }, h(Icon, { name: 'box', size: 16 })),
                    h('span', { className: 'rem-device-main' },
                      h('span', { className: 'rem-device-name' }, row.name),
                      h('span', { className: 'rem-device-desc' }, row.image)
                    )
                  ))
                )
              : null,
            discovery.wsl.loading || discovery.docker.loading
              ? h('p', { key: 'discovering', role: 'status', className: 'rem-section-title', style: { margin: 0 } }, t('common.loading'))
              : null,
            filteredHosts.length === 0 && filteredAliases.length === 0
              && filteredDistros.length === 0 && filteredContainers.length === 0
              && !discovery.wsl.loading && !discovery.docker.loading
              ? h('p', { key: 'empty', className: 'rem-section-title', style: { margin: 0 } }, t('z.empty'))
              : null,
            discovery.wsl.error || discovery.docker.error
              ? h('p', { key: 'discover-error', role: 'status', className: 'rem-hint', style: { margin: 0, color: 'var(--rem-warning-fg)' } }, t('z.optionsLoadFailed'))
              : null,
            h('div', { key: 'new', className: 'rem-new-row' },
              h('button', {
                type: 'button',
                className: 'rem-btn rem-btn-outline',
                'data-testid': 'remote-kind-ssh',
                onClick: () => openNew('ssh')
              },
                h(Icon, { name: 'plus', size: 14 }),
                t('z.newSsh')
              ),
              supportsWsl()
                ? h('button', {
                    type: 'button',
                    className: 'rem-btn rem-btn-outline',
                    'data-testid': 'remote-kind-wsl',
                    onClick: () => openNew('wsl')
                  },
                    h(Icon, { name: 'plus', size: 14 }),
                    t('z.newWsl')
                  )
                : null,
              h('button', {
                type: 'button',
                className: 'rem-btn rem-btn-outline',
                'data-testid': 'remote-kind-docker',
                onClick: () => openNew('docker')
              },
                h(Icon, { name: 'plus', size: 14 }),
                t('z.newDocker')
              )
            )
          ),
          h('p', { className: 'rem-kbd-hint' }, t('z.keyboard'))
        )
      } else if (step === 'settings') {
        body = h('form', {
          className: 'rem-form',
          noValidate: true,
          onSubmit: (event) => { event.preventDefault(); void submitSettings() }
        },
          h('div', { className: 'rem-form-scroll' },
            deviceManagement ? h('div', { className: 'rem-type-row' },
              h('div', { className: 'rem-seg', role: 'group', 'aria-label': t('z.typeLabel') },
                ['ssh', ...(supportsWsl() ? ['wsl'] : []), 'docker'].map((kind) => h('button', {
                  key: kind,
                  type: 'button',
                  'data-testid': `remote-kind-${kind}`,
                  'aria-pressed': form.kind === kind ? 'true' : 'false',
                  disabled: busy,
                  onClick: () => { if (kind !== form.kind) openNew(kind) }
                }, h(Icon, { name: kindIconName(kind), size: 14 }), kindLabel(kind)))
              ),
              form.kind === 'ssh'
                ? h('div', { className: 'rem-import-wrap' },
                    h('button', {
                      type: 'button',
                      ref: importButtonRef,
                      className: 'rem-import-btn',
                      'aria-expanded': importOpen ? 'true' : 'false',
                      disabled: busy || aliasesLoading || aliases.length === 0,
                      onClick: () => setImportOpen((old) => !old)
                    },
                      h(Icon, { name: 'gitBranch', size: 14 }),
                      t(aliasesLoading ? 'z.importLoading' : aliases.length === 0 ? 'z.importEmpty' : 'z.importFromConfig'),
                      h(Icon, { name: 'chevronDown', size: 14, className: 'rem-chev' })
                    )
                  )
                : null
            ) : null,
            deviceManagement && form.kind === 'ssh' && aliasesError
              ? h('div', { className: 'rem-hint rem-hint-warning', style: { margin: 0 } },
                  h(Icon, { name: 'alert', size: 14 }),
                  h('span', null, t('z.configAliasLoadFailed')))
              : null,
            form.kind === 'ssh'
              ? h('div', { className: 'rem-fields' },
              selectedAlias
                ? h('div', { className: 'rem-alias-row' },
                    h('span', { className: 'rem-alias-chip' },
                      h(Icon, { name: 'server', size: 14 }),
                      h('span', null, t('z.configAliasLinked', { alias: selectedAlias })),
                      h('button', {
                        type: 'button',
                        title: t('z.configAliasUnlink'),
                        'aria-label': t('z.configAliasUnlink'),
                        onClick: () => setSelectedAlias('')
                      }, h(Icon, { name: 'x', size: 12 }))
                    ),
                    h('span', { className: 'rem-alias-hint' }, t('z.configAliasLinkedHint'))
                  )
                : null,
              h('div', { className: 'rem-grid-host' },
                h('label', { className: 'rem-field' },
                  h('span', { className: 'rem-label' }, t('z.host')),
                  h('input', {
                    className: `rem-input mono${errors.host ? ' invalid' : ''}`,
                    value: form.host,
                    placeholder: t('z.hostPlaceholder'),
                    spellCheck: false,
                    autoCapitalize: 'none',
                    autoFocus: true,
                    onChange: (event) => {
                      setPasteInfo(null)
                      update({ host: event.target.value })
                      if (errors.host) validateField('host', event.target.value)
                    },
                    onBlur: (event) => validateField('host', event.target.value),
                    onPaste: (event) => {
                      // Recognizes `ssh …` command lines and user@host:port targets
                      // on paste, then fills all three fields.
                      const text = String(event.clipboardData?.getData('text') || '').trim()
                      const parsed = parseSshPaste(text)
                      if (!parsed) return
                      event.preventDefault()
                      setPasteInfo(`${parsed.username ? `${parsed.username}@` : ''}${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`)
                      update({
                        host: parsed.host,
                        ...(parsed.username ? { username: parsed.username } : {}),
                        ...(parsed.port ? { port: parsed.port } : {})
                      })
                    }
                  }),
                  h(FieldError, { message: errors.host })
                ),
                h('label', { className: 'rem-field' },
                  h('span', { className: 'rem-label' }, t('z.port')),
                  h('input', {
                    className: `rem-input mono${errors.port ? ' invalid' : ''}`,
                    value: form.port,
                    inputMode: 'numeric',
                    placeholder: '22',
                    onChange: (event) => {
                      update({ port: event.target.value })
                      if (errors.port) validateField('port', event.target.value)
                    },
                    onBlur: (event) => validateField('port', event.target.value)
                  }),
                  h(FieldError, { message: errors.port })
                )
              ),
              pasteInfo && !errors.host
                ? h('p', { className: 'rem-hint rem-hint-success' }, t('z.pasteRecognized', { target: pasteInfo }))
                : null,
              h('label', { className: 'rem-field' },
                h('span', { className: 'rem-label' }, t('z.username')),
                h('input', {
                  className: `rem-input mono${errors.username ? ' invalid' : ''}`,
                  value: form.username,
                  placeholder: t('z.usernamePlaceholder'),
                  spellCheck: false,
                  autoCapitalize: 'none',
                  onChange: (event) => {
                    update({ username: event.target.value })
                    if (errors.username) validateField('username', event.target.value)
                  },
                  onBlur: (event) => validateField('username', event.target.value)
                }),
                h(FieldError, { message: errors.username })
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { className: 'rem-auth-row' },
                  h('span', { className: 'rem-auth-label' }, t('z.auth')),
                  h('div', { className: 'rem-seg' },
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
                      h('div', { className: 'rem-pwd' },
                        h('input', {
                          className: `rem-input${errors.password ? ' invalid' : ''}`,
                          type: showPassword ? 'text' : 'password',
                          value: form.password,
                          placeholder: t('z.passwordPlaceholder'),
                          autoComplete: 'off',
                          'aria-label': t('z.password'),
                          onChange: (event) => update({ password: event.target.value })
                        }),
                        h('button', {
                          type: 'button',
                          className: 'rem-eye',
                          title: showPassword ? t('z.hidePassword') : t('z.showPassword'),
                          'aria-label': showPassword ? t('z.hidePassword') : t('z.showPassword'),
                          onClick: () => setShowPassword((old) => !old)
                        }, h(EyeIcon, { off: showPassword }))
                      ),
                      h(FieldError, { message: errors.password })
                    )
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                      h('div', null,
                        h('div', { className: 'rem-pwd' },
                          h('input', {
                            className: `rem-input mono${errors.privateKey ? ' invalid' : ''}`,
                            value: form.privateKeyPath,
                            placeholder: t('z.keyPlaceholder'),
                            spellCheck: false,
                            'aria-label': t('z.privateKey'),
                            onChange: (event) => update({ privateKeyPath: event.target.value })
                          }),
                          h('button', {
                            type: 'button',
                            className: 'rem-eye',
                            title: t('z.chooseKeyFile'),
                            onClick: () => keyFileRef.current?.click()
                          }, h(Icon, { name: 'file', size: 16 }))
                        ),
                        h('input', {
                          type: 'file',
                          ref: keyFileRef,
                          style: { display: 'none' },
                          onChange: (event) => {
                            const file = event.target.files?.[0]
                            if (file?.path) update({ privateKeyPath: file.path })
                          }
                        }),
                        h(FieldError, { message: errors.privateKey })
                      ),
                      h('label', { className: 'rem-field' },
                        h('span', { className: 'rem-label' }, t('z.passphrase')),
                        h('input', {
                          className: 'rem-input',
                          type: 'password',
                          value: form.passphrase,
                          placeholder: t('z.passphrasePlaceholder'),
                          autoComplete: 'off',
                          onChange: (event) => update({ passphrase: event.target.value })
                        })
                      )
                    )
              ),
              h('div', null,
                h('button', {
                  type: 'button',
                  className: 'rem-adv-toggle',
                  'aria-expanded': advanced ? 'true' : 'false',
                  onClick: () => setAdvanced((old) => !old)
                },
                  h(Icon, { name: 'chevronRight', size: 14 }),
                  t('z.advanced')
                ),
                advanced
                  ? h('div', { className: 'rem-adv-panel' },
                      h('div', { className: 'rem-adv-group' },
                        h('span', { className: 'rem-label', style: { marginBottom: 0 } }, t('z.assetInstallMode')),
                        h('div', { className: 'rem-seg', role: 'group', 'aria-label': t('z.assetInstallMode') },
                          ['local-download-upload', 'remote-download'].map((assetMode) => h('button', {
                            key: assetMode,
                            type: 'button',
                            'aria-pressed': (form.assetInstallMode || 'local-download-upload') === assetMode ? 'true' : 'false',
                            onClick: () => update({ assetInstallMode: assetMode })
                          }, t(`z.assetInstallMode.${assetMode}`)))
                        ),
                        h('p', { className: 'rem-adv-desc' }, t('z.assetInstallModeDescription'))
                      )
                    )
                  : null
              )
            )

              : null,
            form.kind === 'wsl'
              ? h('div', { className: 'rem-fields rem-wsl-form' },
                  h('div', { className: 'rem-field' },
                    h('label', { className: 'rem-field' },
                      h('span', { className: 'rem-label' }, t('z.wslDistro')),
                      h('input', {
                        className: `rem-input${errors.distro ? ' invalid' : ''}`,
                        value: form.distro,
                        placeholder: t('z.wslDefaultDistro'),
                        list: 'rem-wsl-options',
                        autoFocus: true,
                        autoCapitalize: 'none',
                        spellCheck: false,
                        onChange: (event) => update({ distro: event.target.value })
                      }),
                      h('datalist', { id: 'rem-wsl-options' }, (discovery.wsl.distros || []).map((row) => h('option', { key: row.name, value: row.name })))
                    ),
                    h('p', { className: 'rem-hint', style: { margin: 0 } },
                      discovery.wsl.loading
                        ? t('z.wslLoading')
                        : discovery.wsl.error
                          ? t('z.optionsLoadFailed')
                          : (discovery.wsl.distros || []).length > 0
                            ? t('z.wslDetected', { count: String((discovery.wsl.distros || []).length) })
                            : t('z.wslNoDistros')
                    )
                  ),
                  h('div', null,
                    h('label', { className: 'rem-field' },
                      h('span', { className: 'rem-label' }, t('z.wslUser')),
                      h('input', {
                        className: `rem-input${errors.wslUser ? ' invalid' : ''}`,
                        value: form.wslUser,
                        placeholder: t('z.wslDefaultUser'),
                        autoCapitalize: 'none',
                        spellCheck: false,
                        onChange: (event) => update({ wslUser: event.target.value })
                      }),
                      h(FieldError, { message: errors.wslUser })
                    ),
                    errors.wslUser
                      ? null
                      : h('p', { className: 'rem-hint', style: { margin: 0 } }, t('z.wslUserDescription')),
                    form.wslUser.trim().toLowerCase() === 'root'
                      ? h('p', { className: 'rem-hint rem-hint-warning', style: { margin: 0 } }, t('z.wslRootWarning'))
                      : null
                  )
                )
              : null,
            form.kind === 'docker'
              ? h('div', { className: 'rem-fields rem-docker-form' },
                  h('div', { role: 'group', 'aria-label': 'Docker', className: 'rem-seg' },
                    ['select', 'manual'].map((mode) => h('button', {
                      key: mode,
                      type: 'button',
                      'aria-pressed': form.dockerMode === mode ? 'true' : 'false',
                      onClick: () => update({ dockerMode: mode, container: '', manualContainer: '', image: '' })
                    }, t(mode === 'select' ? 'z.dockerInputSelect' : 'z.dockerInputManual')))
                  ),
                  form.dockerMode === 'select'
                    ? h('div', { ref: dockerRef, className: 'rem-docker-picker' },
                        h('label', { className: 'rem-field' },
                          h('span', { className: 'rem-label' }, t('z.dockerContainer')),
                          h('button', {
                            type: 'button',
                            className: `rem-input as-button docker-trigger${errors.container ? ' invalid' : ''}`,
                            'aria-expanded': dockerOpen ? 'true' : 'false',
                            disabled: busy,
                            onClick: () => {
                              const next = !dockerOpen
                              setDockerOpen(next)
                              if (next) void refreshDocker()
                            }
                          },
                            h('span', { className: 'rem-truncate' + (form.container ? '' : ' muted') },
                              form.container || ((discovery.docker.loading || dockerLoading) ? t('z.dockerLoading') : t('z.dockerSelectContainer'))
                            ),
                            (discovery.docker.loading || dockerLoading)
                              ? h(Spinner, { className: 'rem-spin' })
                              : h(Icon, { name: 'chevronDown', size: 14 })
                          ),
                          h(FieldError, { message: errors.container })
                        ),
                        dockerOpen
                          ? h('div', { className: 'rem-docker-menu' },
                              h('input', {
                                className: 'rem-input rem-docker-search',
                                type: 'search',
                                autoFocus: true,
                                value: dockerQuery,
                                placeholder: t('z.dockerSelectContainer'),
                                'aria-label': t('z.dockerSelectContainer'),
                                onChange: (event) => setDockerQuery(event.target.value)
                              }),
                              h('div', { className: 'rem-docker-list' },
                                (discovery.docker.loading || dockerLoading)
                                  ? h('div', { className: 'rem-docker-empty' }, h(Spinner, { className: 'rem-spin' }), h('span', null, t('z.dockerLoading')))
                                  : null,
                                !(discovery.docker.loading || dockerLoading) && (discovery.docker.containers || []).length === 0
                                  ? h('div', { className: 'rem-docker-empty' }, t('z.dockerNoContainers'))
                                  : null,
                                (discovery.docker.containers || [])
                                  .filter((row) => {
                                    const q = dockerQuery.trim().toLowerCase()
                                    return !q || [row.name, row.id, row.image].join(' ').toLowerCase().includes(q)
                                  })
                                  .map((row) => h('button', {
                                    key: row.id,
                                    type: 'button',
                                    className: 'rem-docker-item',
                                    'data-selected': row.name === form.container ? 'true' : 'false',
                                    onClick: () => {
                                      update({ container: row.name, manualContainer: '', image: row.image || '', dockerMode: 'select' })
                                      setDockerOpen(false)
                                      setDockerQuery('')
                                    }
                                  },
                                    h(Icon, { name: 'box', size: 14 }),
                                    h('span', { className: 'rem-docker-item-name' }, row.name),
                                    row.name === form.container ? h(Icon, { name: 'check', size: 14 }) : null
                                  ))
                              )
                            )
                          : null,
                        !(discovery.docker.loading || dockerLoading)
                          ? (!discovery.docker.available || discovery.docker.error
                              ? h('p', { className: 'rem-hint rem-hint-warning', style: { margin: 0 } }, t('z.dockerUnavailable'))
                              : (discovery.docker.containers || []).length === 0
                                ? h('p', { className: 'rem-hint', style: { margin: 0 } }, t('z.dockerNoContainers'))
                                : null)
                          : null
                      )
                    : h('div', null,
                        h('label', { className: 'rem-field' },
                          h('span', { className: 'rem-label' }, t('z.dockerContainer')),
                          h('input', {
                            className: `rem-input${errors.container ? ' invalid' : ''}`,
                            value: form.manualContainer,
                            placeholder: t('z.dockerContainerPlaceholder'),
                            autoFocus: true,
                            onChange: (event) => update({ container: '', manualContainer: event.target.value, image: '' })
                          }),
                          h(FieldError, { message: errors.container })
                        ),
                        !errors.container && !form.manualContainer.trim()
                          ? h('p', { className: 'rem-hint', style: { margin: 0 } }, t('z.dockerManualHint'))
                          : null
                      )
                )
              : null
          ),
          h('div', { className: `rem-form-foot${deviceManagement ? ' end' : ''}` },
            deviceManagement
              ? h('button', {
                  type: 'button',
                  className: 'rem-btn rem-btn-ghost h9',
                  onClick: onClose,
                  disabled: busy
                }, t('common.cancel'))
              : h('button', {
                  type: 'button',
                  className: 'rem-btn rem-btn-ghost h9',
                  onClick: () => { setStep('device'); setImportOpen(false); setDockerOpen(false); setErrors({}); setError('') }
                },
                  h(Icon, { name: 'chevronLeft', size: 16 }),
                  t('z.backToList')
                ),
            h('button', { type: 'submit', className: 'rem-btn rem-btn-default h9', disabled: busy },
              busy ? h(Spinner, { className: 'rem-spin' }) : null,
              busy ? t('z.connecting') : deviceManagement ? t('z.settings.addAndConnect') : t('z.startConnection')
            )
          )
        )
      } else if (step === 'connecting') {
        const failed = Boolean(displayError) || bg.phase === 'failed'
        // A blocked preflight has no error hint of its own: the fix lives on
        // the failing check rows just above, so the block borrows theirs.
        const firstError = checks.find((row) => row.state === 'error')
        const blockedHint = firstError ? checkText(firstError, 'hint') : ''
        const done = bg.phase === 'done'
        const confirmPending = bg.phase === 'confirm-install'
        const statusTone = failed ? 'danger' : (done ? 'success' : (cancelled ? 'neutral' : 'progress'))
        const statusText = failed ? t('z.status.failed')
          : done ? t('z.status.connected')
            : cancelled ? t('z.cancelled')
              : t('z.status.connecting')
        const logLines = String(displayLines || '').split('\n').map((line) => line.trim()).filter(Boolean)
        const tags = parseStageTags(logLines)
        const connectKind = bg.phase === 'idle' ? activeKind : (bg.targetKind || activeKind)
        const confirm = bg.confirm || null
        const subContext = {
          tags,
          kind: connectKind,
          device: bg.device || wizardName,
          confirmPending,
          failed,
          error: displayError || '',
          path: bg.path || ''
        }
        body = h('div', { className: 'rem-connect' },
          h('div', { className: 'rem-connect-scroll' },
            h('div', { className: 'rem-conn-head' },
              h('div', { className: 'rem-conn-title-row' },
                h('h3', { className: 'rem-conn-title' }, wizardName),
                h('span', { className: `rem-badge rem-badge-${connectKind}` },
                  h(Icon, { name: kindIconName(connectKind), size: 12 }),
                  h('span', null, kindLabel(connectKind))
                ),
                h(StatusBadge, { tone: statusTone }, statusText)
              ),
              h('p', { className: 'rem-conn-target' }, deviceLabel)
            ),
            h('ol', { className: 'rem-phases', 'data-testid': 'remote-connection-stages' },
              displayPhases.map((row, index) => {
                const rowSub = stageSubMessage(row, subContext)
                const times = row.times || {}
                const start = times.start || bg.startedAt || connectStartedAt
                const elapsed = times.end
                  ? Math.max(0, Math.floor((times.end - start) / 1000))
                  : row.status === 'active' ? Math.max(0, Math.floor((clock - start) / 1000)) : null
                const percent = row.status === 'active' && row.key === 'deploy' && tags.deploy?.percent
                  ? Number(tags.deploy.percent)
                  : null
                return h('li', {
                  key: row.key,
                  className: 'rem-phase',
                  'data-status': row.status
                },
                  index < displayPhases.length - 1 ? h('span', { className: 'rem-phase-line', 'aria-hidden': 'true' }) : null,
                  h('span', { className: 'rem-phase-dot' },
                    row.status === 'complete' ? h(Icon, { name: 'check', size: 12 })
                      : row.status === 'failed' ? h(Icon, { name: 'x', size: 12 })
                        : row.status === 'active' ? h(Spinner, { className: 'rem-spin' })
                          : h('span', { className: 'rem-dotmark' })
                  ),
                  h('div', { className: 'rem-phase-main' },
                    h('div', { className: 'rem-phase-head' },
                      h('span', { className: 'rem-phase-title' }, row.label),
                      elapsed !== null ? h('span', { className: 'rem-phase-time' }, `${elapsed} s`) : null
                    ),
                    rowSub ? h('p', { className: 'rem-phase-sub' }, rowSub) : null,
                    row.key === 'deploy' && confirmPending && confirm
                      ? h('div', { className: 'rem-install-card' },
                          h('p', { className: 'rem-install-title' }, h(Icon, { name: 'alert', size: 16 }),
                            confirm.mode === 'update' ? t('z.install.updateTitle') : t('z.install.title')),
                          confirm.mode === 'update'
                            ? h('p', { className: 'rem-install-note' }, t('z.install.updateNote', {
                                from: confirm.fromVersion || t('z.install.unknown'),
                                to: confirm.version || t('z.install.unknown')
                              }))
                            : null,
                          h('dl', { className: 'rem-install-grid' },
                            h('dt', null, t('z.install.target')),
                            h('dd', { className: 'mono' }, confirm.target || deviceLabel),
                            h('dt', null, t('z.install.version')),
                            h('dd', { className: 'mono' }, confirm.version || t('z.install.unknown')),
                            h('dt', null, t('z.install.location')),
                            h('dd', { className: 'mono break' }, confirm.installPath || t('z.install.unknown')),
                            h('dt', null, t('z.install.size')),
                            h('dd', { className: 'mono' }, Number.isFinite(confirm.sizeBytes) && confirm.sizeBytes
                              ? `${(confirm.sizeBytes / 1048576).toFixed(1)} MB`
                              : t('z.install.unknown'))
                          ),
                          h('div', { className: 'rem-install-actions' },
                            h('button', {
                              type: 'button',
                              className: 'rem-btn rem-btn-default rem-btn-sm',
                              onClick: () => backgroundFlow.confirmInstall()
                            }, confirm.mode === 'update' ? t('z.install.updateConfirm') : t('z.install.confirm')),
                            h('button', {
                              type: 'button',
                              className: 'rem-btn rem-btn-secondary rem-btn-sm',
                              onClick: () => backgroundFlow.cancelInstall()
                            }, t('z.cancel'))
                          )
                        )
                      : null,
                    percent !== null
                      ? h('div', { className: 'rem-progress' },
                          h('span', { className: 'rem-progress-text' }, `${percent}%`),
                          h('div', { className: 'rem-progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
                            h('div', { className: 'rem-progress-fill', style: { width: `${Math.max(0, Math.min(100, percent))}%` } })
                          )
                        )
                      : null
                  )
                )
              })
            ),
            // Environment checks for this target, run before the deploy. They
            // live in the same scroll area as the stages, so a blocked first
            // run shows why right under the step that stopped.
            checks.length
              ? h('ul', { className: 'rem-checks', 'data-testid': 'remote-preflight' },
                  checks.map((row) => h('li', { key: row.id, className: `rem-check is-${row.state}` },
                    h(Icon, {
                      name: row.state === 'ok' ? 'check' : row.state === 'warn' ? 'info' : row.state === 'skip' ? 'minus' : 'alert',
                      size: 13
                    }),
                    h('span', { className: 'rem-check-main' },
                      h('span', { className: 'rem-check-title' }, checkText(row, 'title')),
                      checkText(row, 'detail') ? h('span', { className: 'rem-check-detail' }, checkText(row, 'detail')) : null,
                      row.state !== 'ok' && row.state !== 'skip' && checkText(row, 'hint')
                        ? h('span', { className: 'rem-check-hint' }, checkText(row, 'hint'))
                        : null
                    )
                  ))
                )
              : null,
            failed
              ? h('div', { className: 'rem-status-block' },
                  h('p', { className: 'rem-status-title' }, h(Icon, { name: 'alert', size: 16 }), t('z.status.failed')),
                  h('p', { className: 'rem-status-reason' }, displayError || t('z.desc.failed')),
                  displayErrorReason ? h('p', { className: 'rem-status-reason' }, displayErrorReason) : null,
                  displayErrorHint || blockedHint
                    ? h('p', { className: 'rem-status-hint', 'data-testid': 'remote-error-hint' },
                        h(Icon, { name: 'info', size: 14 }),
                        h('span', null, displayErrorHint || blockedHint))
                    : null,
                  h('details', { className: 'rem-error-details' },
                    h('summary', null, t('z.errorDetails')),
                    h('pre', { className: 'rem-pre' }, displayError || ''),
                    h('button', {
                      type: 'button',
                      className: 'rem-btn rem-btn-ghost rem-btn-sm',
                      onClick: () => navigator.clipboard?.writeText(String(displayError || ''))
                    }, t('z.copyError'))
                  ),
                  h('div', { className: 'rem-status-actions' },
                    h('button', {
                      type: 'button',
                      className: 'rem-btn rem-btn-default rem-btn-sm',
                      onClick: retryConnection
                    }, t('z.retry')),
                    bg.errorCode === 'remote-host-key-changed'
                      ? h('button', {
                          type: 'button',
                          className: 'rem-btn rem-btn-secondary rem-btn-sm',
                          'data-testid': 'remote-trust-host-key',
                          onClick: trustHostKey
                        }, t('z.hostKeyTrust'))
                      : null,
                    h('button', {
                      type: 'button',
                      className: 'rem-btn rem-btn-secondary rem-btn-sm',
                      onClick: backToConfig
                    }, t('z.backToConnection'))
                  )
                )
              : null,
            h('div', { className: 'rem-log' },
              h('button', {
                type: 'button',
                className: 'rem-log-toggle',
                'aria-expanded': logOpen ? 'true' : 'false',
                onClick: () => setLogOpen((old) => !old)
              },
                h(Icon, { name: 'chevronRight', size: 14 }),
                t('z.connectionLog'),
                h('span', { className: 'rem-log-count' }, t('z.logLines', { count: String(logLines.length) }))
              ),
              logOpen
                ? h('button', {
                    type: 'button',
                    className: 'rem-log-copy',
                    onClick: () => navigator.clipboard?.writeText(String(displayLines || ''))
                  }, t('z.copyLog') || t('job.copyLog'))
                : null,
              logOpen
                ? h('div', { className: 'rem-log-box', 'data-testid': 'remote-connection-log' },
                    logLines.length > 0
                      ? logLines.map((line, index) => h('div', { key: index, className: 'rem-log-line' },
                          h('span', { className: 'rem-log-level' }, '[INFO]'),
                          h('span', null, line)
                        ))
                      : h('div', { className: 'rem-log-empty' }, `[INFO] ${t('z.logEmpty')}`)
                  )
                : null
            )
          ),
          h('div', { className: 'rem-connect-foot' },
            bg.phase === 'running' || bg.phase === 'confirm-install'
              ? h('button', { type: 'button', className: 'rem-btn rem-btn-ghost', onClick: minimizeFlow },
                  h(Icon, { name: 'minus', size: 16 }),
                  t('z.background')
                )
              : h('button', { type: 'button', className: 'rem-btn rem-btn-ghost', onClick: backToConfig },
                  t(deviceManagement ? 'z.settings.newConnection' : 'z.backToList')
                ),
            failed
              ? h('button', { type: 'button', className: 'rem-btn rem-btn-secondary', onClick: closeOrMinimize }, t('common.close'))
              : cancelled
                ? h('button', { type: 'button', className: 'rem-btn rem-btn-secondary', onClick: retryConnection }, t('z.retry'))
                : h('button', { type: 'button', className: 'rem-btn rem-btn-secondary', onClick: cancelAttempt }, t('z.cancelConnection'))
          )
        )
      } else if (step === 'directory') {
        const host = hostOf(dirHostId)
        const recentPaths = [...new Set(workspacesFor(dirHostId).map((row) => row.remotePath).filter(Boolean))].slice(0, 4)
        body = h('div', { className: 'rem-dir' },
          h('div', { className: 'rem-dir-scroll' },
            h('div', { className: 'rem-connected' },
              h('div', { className: 'rem-connected-left' },
                h(Icon, { name: 'check', size: 16 }),
                h('span', null, t('z.status.connected')),
                h('span', null, `· ${kindLabel(host ? kindOfrow(host) : (bg.targetKind || activeKind))}`),
                settings ? h('span', null, `· v${effectiveDshVersion(settings)}`) : null
              )
            ),
            host
              ? h('div', { className: 'rem-rename' },
                  h('span', { className: 'rem-rename-label' }, t('z.renameDevice')),
                  h('input', {
                    className: 'rem-input',
                    value: deviceName,
                    'aria-label': t('z.renameDevice'),
                    onChange: (event) => { setDeviceName(event.target.value); setRenameState('idle') },
                    onBlur: () => void saveRename(),
                    onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void saveRename() } }
                  }),
                  h('span', { className: 'rem-rename-hint', role: 'status' },
                    renameState === 'saved' ? t('settings.saved')
                      : renameState === 'failed' ? t('z.renameFailed')
                        : renameState === 'saving' ? t('z.renameSaving')
                          : t('z.renameHintLong'))
                )
              : null,
            recentPaths.length > 0
              ? h('div', { className: 'rem-recent' },
                  h('span', { className: 'rem-recent-label' }, t('z.recent')),
                  h('div', { className: 'rem-recent-chips' }, recentPaths.map((path) => h('button', {
                    key: path,
                    type: 'button',
                    className: 'rem-recent-chip',
                    'data-selected': path === remotePath ? 'true' : 'false',
                    title: path,
                    onClick: () => { setRemotePath(path); setBrowseRequest({ path, key: Date.now() }) }
                  },
                    h(Icon, { name: 'folder', size: 14 }),
                    h('span', null, path)
                  )))
                )
              : null,
            h('div', { className: 'rem-browser-wrap' },
              h(RemoteBrowser, {
                hostId: dirHostId,
                value: remotePath,
                onChange: (path) => { setDirReady(false); setRemotePath(path) },
                request: browseRequest,
                allowMissing: settings ? settings.createIfMissing !== false : true,
                onNavState: setDirReady
              })
            )
          ),
          h('p', { className: 'rem-willopen', 'data-testid': 'remote-directory-selected-path' }, t('z.willOpen', { path: remotePath || '~' })),
          h('div', { className: 'rem-dir-foot' },
            h('button', {
              type: 'button',
              className: 'rem-btn rem-btn-ghost rem-later',
              onClick: () => { backgroundFlow.minimize(); onClose() }
            }, t('z.chooseLater')),
            h('button', {
              type: 'button',
              className: 'rem-btn rem-btn-secondary big',
              onClick: () => { backgroundFlow.reset(); setStep('settings') }
            }, t('z.back')),
            h('button', {
              type: 'button',
              className: 'rem-btn rem-btn-default big',
              disabled: !dirHostId || !remotePath || !dirReady || connecting || bg.phase === 'running',
              onClick: createWorkspace
            }, t('z.openHere'))
          )
        )
      }
