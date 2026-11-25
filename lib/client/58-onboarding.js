// part: 58-onboarding -- the empty device list teaches the three steps
    // ── 第一次使用 ──────────────────────────────────────────────────────────
    // Nobody arrives here knowing what "远端工作区" means. Instead of an empty
    // box with a plus button, the empty state says what is needed, what the
    // plugin does on that machine, and what the payoff is. Dismissal is stored
    // in settings.onboarded, so it appears once per install, not once per visit.
    function OnboardingCard({ onCreate, onDismiss }) {
      const steps = [
        { title: t('onboarding.step1'), detail: t('onboarding.step1Hint') },
        { title: t('onboarding.step2'), detail: t('onboarding.step2Hint') },
        { title: t('onboarding.step3'), detail: t('onboarding.step3Hint') }
      ]
      return h('div', { className: 'rem-onboarding', 'data-testid': 'ssh-remote-onboarding' },
        h('div', { className: 'rem-onboarding-head' },
          h('span', { className: 'rem-onboarding-icon' }, h(Icon, { name: 'cloud', size: 18 })),
          h('div', null,
            h('h3', { className: 'rem-onboarding-title' }, t('onboarding.title')),
            h('p', { className: 'rem-onboarding-lead' }, t('onboarding.lead'))
          )
        ),
        h('ol', { className: 'rem-onboarding-steps' },
          steps.map((step, index) => h('li', { key: step.title, className: 'rem-onboarding-step' },
            h('span', { className: 'rem-onboarding-index' }, String(index + 1)),
            h('div', null,
              h('p', { className: 'rem-onboarding-step-title' }, step.title),
              h('p', { className: 'rem-onboarding-step-detail' }, step.detail)
            )
          ))
        ),
        h('p', { className: 'rem-onboarding-note' }, t('onboarding.note')),
        h('div', { className: 'rem-onboarding-actions' },
          h('button', {
            type: 'button',
            className: 'rem-btn rem-btn-default',
            onClick: onCreate
          }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection')),
          h('button', {
            type: 'button',
            className: 'rem-device-link',
            onClick: onDismiss
          }, t('onboarding.dismiss'))
        )
      )
    }