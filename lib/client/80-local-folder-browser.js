// part: 80-local-folder-browser -- local folder browser fallback
    // ── Local folder browser (fallback when the Host has no OS chooser) ─────
    // Same ZCode folder-modal frame as `RemoteBrowser`; only the listing
    // endpoint differs, so the two picking surfaces stay visually identical.
    function LocalBrowser({ value, onChange }) {
      const [listing, setListing] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(false)
      const [draft, setDraft] = useState(value || '')
      const [showHidden, setShowHidden] = useState(false)
      const load = useCallback(async (path) => {
        setLoading(true); setError('')
        try {
          const data = await api('GET', `/ssh-remote/local/list?path=${encodeURIComponent(path || '')}`)
          setListing(data)
          setDraft(data.path || '')
          onChange(data.path || '')
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { void load(value || '') }, [])
      const entries = (listing?.entries || []).filter((entry) => entry.dir && (showHidden || !entry.hidden))
      return h('div', { className: 'zc-browser' },
        h('div', { className: 'zc-browser-form' },
          h('input', {
            className: 'zc-input mono',
            value: draft,
            placeholder: t('z.folder.pathPlaceholder'),
            'aria-label': t('z.folder.pathPlaceholder'),
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void load(draft.trim())
            }
          }),
          h('div', { className: 'zc-browser-actions' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-secondary',
              disabled: loading || !draft.trim(),
              onClick: () => void load(draft.trim())
            }, t('z.browserGo')),
            h('button', {
              type: 'button',
              className: `zc-btn ${showHidden ? 'zc-btn-secondary' : 'zc-btn-ghost'}`,
              'aria-pressed': showHidden ? 'true' : 'false',
              onClick: () => setShowHidden((old) => !old)
            }, showHidden ? t('z.browserHideHidden') : t('z.browserShowHidden'))
          )
        ),
        error ? h('div', { className: 'zc-browser-error' }, t('z.folder.errorUnavailable')) : null,
        h('div', { className: 'zc-browser-list' },
          listing?.parent ? h('button', { type: 'button', className: 'zc-browser-row zc-browser-up', onClick: () => void load(listing.parent) },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, t('z.browserParent'))
          ) : null,
          loading ? h('div', { className: 'zc-browser-empty' }, t('z.browserLoading')) : null,
          !loading && entries.length === 0 ? h('div', { className: 'zc-browser-empty' }, t('z.browserNoSubdirs')) : null,
          entries.map((entry) => h('button', {
            key: entry.path,
            type: 'button',
            className: 'zc-browser-row',
            onClick: () => void load(entry.path)
          },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, entry.name)
          ))
        )
      )
    }

