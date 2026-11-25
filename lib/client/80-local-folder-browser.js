// part: 80-local-folder-browser -- local folder browser fallback
    // ── Local folder browser (fallback when the Host has no OS chooser) ─────
    // Reuses the folder-modal frame of `RemoteBrowser`; only the listing endpoint
    // differs, so both picking surfaces stay visually identical.
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
      return h('div', { className: 'rem-browser' },
        h('div', { className: 'rem-browser-form' },
          h('input', {
            className: 'rem-input mono',
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
          h('div', { className: 'rem-browser-actions' },
            h('button', {
              type: 'button',
              className: 'rem-btn rem-btn-secondary',
              disabled: loading || !draft.trim(),
              onClick: () => void load(draft.trim())
            }, t('z.browserGo')),
            h('button', {
              type: 'button',
              className: `rem-btn ${showHidden ? 'rem-btn-secondary' : 'rem-btn-ghost'}`,
              'aria-pressed': showHidden ? 'true' : 'false',
              onClick: () => setShowHidden((old) => !old)
            }, showHidden ? t('z.browserHideHidden') : t('z.browserShowHidden'))
          )
        ),
        error ? h('div', { className: 'rem-browser-error' }, t('z.folder.errorUnavailable')) : null,
        h('div', { className: 'rem-browser-list' },
          listing?.parent ? h('button', { type: 'button', className: 'rem-browser-row rem-browser-up', onClick: () => void load(listing.parent) },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, t('z.browserParent'))
          ) : null,
          loading ? h('div', { className: 'rem-browser-empty' }, t('z.browserLoading')) : null,
          !loading && entries.length === 0 ? h('div', { className: 'rem-browser-empty' }, t('z.browserNoSubdirs')) : null,
          entries.map((entry) => h('button', {
            key: entry.path,
            type: 'button',
            className: 'rem-browser-row',
            onClick: () => void load(entry.path)
          },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, entry.name)
          ))
        )
      )
    }

