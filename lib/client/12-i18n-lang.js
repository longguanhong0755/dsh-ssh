// part: 12-i18n-lang -- language selection (readLang/setLang) and t()
    const LANG_KEY = 'dsh-ssh-remote.lang'
    function readLang() {
      try {
        const saved = window.localStorage.getItem(LANG_KEY)
        if (saved === 'zh' || saved === 'en') return saved
      } catch {
        // ignore
      }
      return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }
    let LANG = readLang()
    function setLang(next) {
      LANG = next === 'en' ? 'en' : 'zh'
      try {
        window.localStorage.setItem(LANG_KEY, LANG)
      } catch {
        // ignore
      }
      window.location.reload()
    }
    function t(key, vars) {
      const dict = DICT[LANG] || DICT.en
      let text = dict[key] ?? DICT.en[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
      }
      return text
    }

