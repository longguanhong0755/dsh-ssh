// part: 36-job-polling -- polling a long-running job (useJob)
    // ── polling a long job ─────────────────────────────────────────────────
    function useJob(jobId, onDone) {
      const [job, setJob] = useState(null)
      const [error, setError] = useState('')
      useEffect(() => {
        if (!jobId) { setJob(null); return undefined }
        let stopped = false
        let timer = null
        let failures = 0
        const schedule = (delay) => {
          if (!stopped) timer = setTimeout(tick, delay)
        }
        const tick = async () => {
          if (stopped) return
          // A hidden window does not need job progress; check back later
          // instead of issuing one request per second forever.
          if (typeof document !== 'undefined' && document.hidden) {
            schedule(5000)
            return
          }
          try {
            const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`)
            if (stopped) return
            setJob(data.job)
            setError('')
            failures = 0
            if (data.job.state === 'succeeded' || data.job.state === 'failed' || data.job.state === 'cancelled') {
              if (onDone) onDone(data.job)
              return
            }
          } catch (err) {
            if (stopped) return
            setError(errorMessage(err))
            failures += 1
          }
          // Back off while the backend is unreachable instead of hammering it.
          schedule(Math.min(5000, 900 * (2 ** Math.min(failures, 3))))
        }
        const onVisible = () => {
          if (typeof document === 'undefined' || document.hidden) return
          if (timer) { clearTimeout(timer); timer = null }
          void tick()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        void tick()
        return () => {
          stopped = true
          if (timer) clearTimeout(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        }
      }, [jobId])
      return { job, error }
    }

