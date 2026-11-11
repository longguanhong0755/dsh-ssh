// part: 20-api -- HTTP API helper (apiPath/api)
    // ── API ────────────────────────────────────────────────────────────────
    function apiPath(path) {
      return window.location && window.location.protocol === 'dsh-app:' ? `/api${path}` : path
    }
    async function api(method, path, body) {
      const options = { method, headers: {} }
      let controller = null
      let timer = null
      if (typeof AbortController === 'function') {
        controller = new AbortController()
        options.signal = controller.signal
        // A wedged SSH host must not leave the UI waiting forever; 15 s is
        // longer than any healthy status/probe call.
        timer = setTimeout(() => controller.abort(), 15000)
      }
      if (body !== undefined) {
        options.headers['content-type'] = 'application/json'
        options.body = JSON.stringify(body)
      }
      try {
        const response = await fetch(apiPath(path), options)
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.ok === false) {
          const failure = new Error((data && (data.error || data.message)) || `HTTP ${response.status}`)
          // Routes hand back ZCode-style codes (remote-authentication-failed,
          // source-server-update-in-progress, …) and an optional reason line.
          failure.code = data?.code || ''
          failure.reason = data?.reason || ''
          throw failure
        }
        return data
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error(t('api.timeout'))
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

