// part: 30-styles -- injected CSS for the sshR surfaces and the ZCode clones
    // ── styles ─────────────────────────────────────────────────────────────
    const CSS = `
.sshR-root{--ssh-bg:var(--dsw-alias-bg-base,#fff);--ssh-layer:var(--dsw-alias-bg-layer-1,#f7f7f8);--ssh-label:var(--dsw-alias-label-primary,#1f2328);--ssh-muted:var(--dsw-alias-label-secondary,#6b7280);--ssh-tertiary:var(--dsw-alias-label-tertiary,#9ca3af);--ssh-border:var(--dsw-alias-border-l1,rgba(0,0,0,.1));--ssh-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));--ssh-accent:var(--dsw-alias-state-business-primary,#3b82f6);--ssh-danger:var(--dsw-alias-state-error-primary,#dc2626);--ssh-ok:#16a34a;--ssh-warn:#d97706;--ssh-radius:var(--dsw-radius-md,8px);color:var(--ssh-label);font-family:inherit}
.sshR-panel{box-sizing:border-box;height:100%;overflow:auto;padding:28px 32px 48px}
.sshR-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:20px}
.sshR-head h2{font-size:20px;line-height:1.3;margin:0 0 6px;font-weight:650}
.sshR-sub{color:var(--ssh-muted);font-size:13px;line-height:1.5;margin:0;max-width:760px}
.sshR-headActions{margin-left:auto;display:flex;gap:8px;flex:none}
.sshR-btn{appearance:none;border:1px solid var(--ssh-border);background:var(--ssh-layer);color:var(--ssh-label);border-radius:var(--ssh-radius);padding:7px 12px;font:inherit;font-size:13px;line-height:1.2;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.sshR-btn:hover:not(:disabled){background:var(--ssh-hover)}
.sshR-btn:disabled{opacity:.5;cursor:default}
.sshR-btn.primary{background:var(--ssh-accent);border-color:var(--ssh-accent);color:#fff}
.sshR-btn.primary:hover:not(:disabled){filter:brightness(.96)}
.sshR-btn.danger{color:var(--ssh-danger)}
.sshR-btn.small{padding:4px 8px;font-size:12px}
.sshR-btn.ghost{background:transparent;border-color:transparent}
.sshR-card{border:1px solid var(--ssh-border);background:var(--ssh-bg);border-radius:var(--ssh-radius);padding:16px;margin-bottom:12px}
.sshR-cardTop{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sshR-cardTitle{font-weight:600;font-size:14px}
.sshR-cardPath{color:var(--ssh-muted);font-size:12px;margin-top:4px;word-break:break-all}
.sshR-meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--ssh-muted);font-size:12px;margin-top:10px}
.sshR-meta b{color:var(--ssh-label);font-weight:550}
.sshR-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.sshR-dot{width:8px;height:8px;border-radius:50%;background:var(--ssh-tertiary);flex:none;display:inline-block}
.sshR-dot.running{background:var(--ssh-ok);box-shadow:0 0 0 3px rgba(22,163,74,.14)}
.sshR-dot.starting{background:var(--ssh-warn);box-shadow:0 0 0 3px rgba(217,119,6,.14)}
.sshR-dot.error,.sshR-dot.unreachable{background:var(--ssh-danger);box-shadow:0 0 0 3px rgba(220,38,38,.12)}
.sshR-dot.stopped{background:var(--ssh-tertiary)}
.sshR-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--ssh-layer);border:1px solid var(--ssh-border);color:var(--ssh-muted)}
.sshR-badge.running{color:var(--ssh-ok);border-color:rgba(22,163,74,.3);background:rgba(22,163,74,.08)}
.sshR-badge.error,.sshR-badge.unreachable{color:var(--ssh-danger);border-color:rgba(220,38,38,.25);background:rgba(220,38,38,.06)}
.sshR-empty{border:1px dashed var(--ssh-border);border-radius:var(--ssh-radius);padding:32px;text-align:center;color:var(--ssh-muted);font-size:13px;line-height:1.6}
.sshR-err{color:var(--ssh-danger);font-size:12px;margin-top:8px;white-space:pre-wrap;word-break:break-word}
.sshR-errorBox{border:1px solid rgba(220,38,38,.3);background:rgba(220,38,38,.05);border-radius:var(--ssh-radius);padding:12px;margin-bottom:12px;font-size:12px;white-space:pre-wrap;word-break:break-word}
.sshR-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px}
.sshR-modal{background:var(--ssh-bg);color:var(--ssh-label);border:1px solid var(--ssh-border);border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.28);width:min(720px,96vw);max-height:min(84vh,900px);display:flex;flex-direction:column;overflow:hidden}
.sshR-modal.wide{width:min(900px,96vw)}
.sshR-modalHead{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--ssh-border);flex:none}
.sshR-modalHead h3{font-size:15px;margin:0;font-weight:600}
.sshR-modalBody{padding:16px 18px;overflow:auto;min-height:0}
.sshR-modalFoot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--ssh-border);flex:none}
.sshR-tabs{display:flex;gap:4px;padding:4px;background:var(--ssh-layer);border-radius:var(--ssh-radius);margin-bottom:16px}
.sshR-tab{flex:1;text-align:center;padding:7px 10px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--ssh-muted);border:1px solid transparent}
.sshR-tab.active{background:var(--ssh-bg);border-color:var(--ssh-border);color:var(--ssh-label);font-weight:550}
.sshR-field{margin-bottom:12px}
.sshR-field>label{display:block;font-size:12px;color:var(--ssh-muted);margin-bottom:5px}
.sshR-input,.sshR-select{box-sizing:border-box;width:100%;border:1px solid var(--ssh-border);background:var(--ssh-bg);color:var(--ssh-label);border-radius:7px;padding:7px 9px;font:inherit;font-size:13px;outline:none}
.sshR-input:focus,.sshR-select:focus{border-color:var(--ssh-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ssh-accent) 18%,transparent)}
.sshR-row{display:flex;gap:10px;align-items:flex-end}
.sshR-row>.sshR-field{flex:1;margin-bottom:0}
.sshR-check{display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0}
.sshR-check input{width:15px;height:15px}
.sshR-hint{font-size:12px;color:var(--ssh-muted);line-height:1.5;margin:4px 0 0}
.sshR-list{border:1px solid var(--ssh-border);border-radius:var(--ssh-radius);max-height:260px;overflow:auto;background:var(--ssh-bg)}
.sshR-listRow{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--ssh-border)}
.sshR-listRow:last-child{border-bottom:none}
.sshR-listRow:hover{background:var(--ssh-hover)}
.sshR-listRow .sshR-dir{color:var(--ssh-muted);font-size:11px}
.sshR-crumbs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--ssh-muted);margin:8px 0}
.sshR-crumbs span.path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}
.sshR-log{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;background:#0f1115;color:#d6deeb;border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
.sshR-statusLine{display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap}
.sshR-sectionTitle{font-size:13px;font-weight:600;margin:18px 0 8px;padding-top:14px;border-top:1px solid var(--ssh-border)}
.sshR-sectionTitle:first-child{margin-top:0;padding-top:0;border-top:none}
.sshR-hostRow{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--ssh-border);border-radius:var(--ssh-radius);margin-bottom:8px;font-size:13px;flex-wrap:wrap}
.sshR-hostRow .grow{flex:1;min-width:0}
.sshR-hostRow .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--ssh-muted);word-break:break-all}
.sshR-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sshR-inline>.sshR-input,.sshR-inline>.sshR-select{flex:1 1 12rem;width:auto;min-width:0}
.sshR-hostPick{display:flex;flex-direction:column;gap:6px}
.sshR-hostOption{appearance:none;text-align:left;border:1px solid var(--ssh-border);background:var(--ssh-bg);color:var(--ssh-label);border-radius:var(--ssh-radius);padding:9px 11px;font:inherit;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:10px}
.sshR-hostOption:hover{background:var(--ssh-hover)}
.sshR-hostOption.active{border-color:var(--ssh-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ssh-accent) 16%,transparent)}
.sshR-hostName{font-weight:600}
.sshR-hostAddr{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--ssh-muted);flex:1;word-break:break-all}
.sshR-hostMeta{font-size:10.5px;color:var(--ssh-muted);border:1px solid var(--ssh-border);border-radius:999px;padding:1px 6px}
.sshR-link{color:var(--ssh-accent);cursor:pointer;text-decoration:underline;font-size:12px;word-break:break-all}
.sshR-tag{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--ssh-border);color:var(--ssh-muted);background:var(--ssh-layer)}
.sshR-spin{width:13px;height:13px;border:2px solid var(--ssh-border);border-top-color:var(--ssh-accent);border-radius:50%;animation:sshRspin .8s linear infinite;display:inline-block;vertical-align:-2px}
@keyframes sshRspin{to{transform:rotate(360deg)}}
@media (max-width:720px){.sshR-panel{padding:18px 14px 40px}.sshR-head{flex-direction:column}.sshR-headActions{margin-left:0}}
/* ZCode-style connect dialog */
.sshR-zdOverlay{position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px 16px}
.sshR-zd{box-sizing:border-box;width:min(42rem,calc(100vw - 2rem));max-height:calc(90vh - 1rem);display:flex;flex-direction:column;overflow:hidden;background:var(--ssh-bg);color:var(--ssh-label);border:1px solid var(--ssh-border);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.32)}
.sshR-zdHead{display:flex;align-items:flex-start;gap:12px;padding:20px 24px 0;flex:none}
.sshR-zdTitles{min-width:0;flex:1}
.sshR-zdTitles h3{margin:0;font-size:15px;line-height:1.35;font-weight:600}
.sshR-zdTitles p{margin:3px 0 0;font-size:12px;line-height:1.45;color:var(--ssh-muted);word-break:break-all}
.sshR-zdIcons{display:flex;gap:2px;flex:none;margin-left:auto}
.sshR-iconBtn{appearance:none;border:none;background:transparent;color:var(--ssh-muted);width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:15px;line-height:1;cursor:pointer}
.sshR-iconBtn:hover{background:var(--ssh-hover);color:var(--ssh-label)}
.sshR-zdBody{padding:16px 24px 20px;overflow:auto;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:14px}
.sshR-zdInlineError{margin:10px 24px 0;padding:8px 11px;border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.08);color:var(--ssh-danger);border-radius:8px;font-size:12.5px;word-break:break-word}
.sshR-zdFoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 24px;border-top:1px solid var(--ssh-border);flex:none}
.sshR-zdFoot .spacer{flex:1}
.sshR-zdSearch{position:relative}
.sshR-zdSearch .sshR-input{height:36px;padding-left:32px}
.sshR-zdSearch svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--ssh-muted)}
.sshR-zdSection{font-size:12px;color:var(--ssh-muted);margin:0 0 6px}
.sshR-zdList{display:flex;flex-direction:column;gap:2px;overflow:auto;min-height:0}
.sshR-zdHostRow{appearance:none;display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:var(--ssh-label);border-radius:8px;padding:9px 10px;font:inherit;cursor:pointer}
.sshR-zdHostRow:hover,.sshR-zdHostRow:focus-visible{background:var(--ssh-hover);border-color:var(--ssh-border);outline:none}
.sshR-zdHostIcon{width:26px;height:26px;border-radius:7px;border:1px solid var(--ssh-border);display:flex;align-items:center;justify-content:center;color:var(--ssh-muted);font-size:12px;flex:none}
.sshR-zdHostMain{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.sshR-zdHostName{font-size:13px;font-weight:600}
.sshR-zdHostDesc{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--ssh-muted);word-break:break-all}
.sshR-zdNew{display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--ssh-border);padding-top:12px}
.sshR-zdKeyHint{font-size:11px;color:var(--ssh-tertiary);margin:0;border-top:1px solid var(--ssh-border);padding-top:10px}
.sshR-zdTypeRow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.sshR-zdSeg{display:inline-flex;gap:2px;padding:2px;background:var(--ssh-layer);border:1px solid var(--ssh-border);border-radius:9px}
.sshR-zdSegBtn{appearance:none;border:1px solid transparent;background:transparent;color:var(--ssh-muted);border-radius:7px;padding:5px 12px;font:inherit;font-size:13px;line-height:1.2;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sshR-zdSegBtn.active{background:var(--ssh-bg);border-color:var(--ssh-border);color:var(--ssh-label);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.sshR-zdSegBtn:disabled{cursor:default;opacity:.55}
.sshR-zdImport{position:relative}
.sshR-zdImportMenu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:260px;max-height:240px;overflow:auto;background:var(--ssh-bg);border:1px solid var(--ssh-border);border-radius:9px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:4px}
.sshR-zdImportItem{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--ssh-label);border-radius:6px;padding:7px 9px;font:inherit;font-size:12.5px;cursor:pointer}
.sshR-zdImportItem:hover{background:var(--ssh-hover)}
.sshR-zdImportItem span{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--ssh-muted)}
.sshR-zdGrid{display:grid;grid-template-columns:minmax(0,1fr) 6rem;gap:12px}
.sshR-zdField{display:flex;flex-direction:column;gap:5px;min-width:0}
.sshR-zdField>label{font-size:12px;color:var(--ssh-muted)}
.sshR-zdField .sshR-input{height:36px}
.sshR-zdField .sshR-input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sshR-zdField .sshR-input.invalid{border-color:var(--ssh-danger)}
.sshR-zdErr{font-size:11.5px;color:var(--ssh-danger);margin:0}
.sshR-zdAuth{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.sshR-zdAuth>span{font-size:12px;color:var(--ssh-muted)}
.sshR-zdPwd{position:relative}
.sshR-zdPwd .sshR-input{padding-right:38px}
.sshR-zdEye{position:absolute;right:4px;top:50%;transform:translateY(-50%);appearance:none;border:none;background:transparent;color:var(--ssh-muted);width:30px;height:30px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.sshR-zdEye:hover{background:var(--ssh-hover)}
.sshR-zdAdvToggle{appearance:none;border:none;background:transparent;color:var(--ssh-muted);font:inherit;font-size:12.5px;display:inline-flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;align-self:flex-start}
.sshR-zdAdvToggle:hover{color:var(--ssh-label)}
.sshR-zdAdvPanel{display:flex;flex-direction:column;gap:10px;border:1px solid var(--ssh-border);border-radius:8px;padding:12px;background:var(--ssh-layer)}
.sshR-zdPhases{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.sshR-zdPhase{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;font-size:13px;color:var(--ssh-muted)}
.sshR-zdPhase.active{background:var(--ssh-layer);color:var(--ssh-label);font-weight:600}
.sshR-zdPhase.complete{color:var(--ssh-label)}
.sshR-zdPhase.failed{color:var(--ssh-danger)}
.sshR-zdPhaseDot{width:20px;height:20px;border-radius:50%;border:1px solid var(--ssh-border);display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}
.sshR-zdPhase.complete .sshR-zdPhaseDot{border-color:rgba(22,163,74,.5);background:rgba(22,163,74,.12);color:var(--ssh-ok)}
.sshR-zdPhase.failed .sshR-zdPhaseDot{border-color:rgba(220,38,38,.45);background:rgba(220,38,38,.08);color:var(--ssh-danger)}
.sshR-zdSuccess{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ssh-muted)}
.sshR-zdSuccess b{color:var(--ssh-label)}
.sshR-zdStepDevice{display:flex;flex-direction:column;gap:12px;min-height:0;flex:1 1 auto}
.sshR-zdScroll{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding-right:2px}
.sshR-zdDevice{display:flex;flex-direction:column;gap:5px;margin-bottom:4px}
.sshR-zdDeviceTop{display:flex;align-items:stretch;gap:2px}
.sshR-zdDeviceMain{flex:1;min-width:0;appearance:none;display:flex;align-items:center;gap:10px;text-align:left;border:1px solid transparent;background:transparent;color:var(--ssh-label);border-radius:8px;padding:8px 10px;font:inherit;cursor:pointer}
.sshR-zdDeviceMain:hover,.sshR-zdDeviceMain:focus-visible{background:var(--ssh-hover);border-color:var(--ssh-border);outline:none}
.sshR-zdEditBtn{appearance:none;flex:none;width:30px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--ssh-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.55}
.sshR-zdDevice:hover .sshR-zdEditBtn{opacity:1}
.sshR-zdEditBtn:hover{background:var(--ssh-hover);border-color:var(--ssh-border);color:var(--ssh-label)}
.sshR-zdStatus{font-size:11px;color:var(--ssh-muted);flex:none;white-space:nowrap}
.sshR-zdStatus.online{color:var(--ssh-ok)}
.sshR-zdStatus.online::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:5px;vertical-align:1px}
.sshR-zdChevron{color:var(--ssh-tertiary);font-size:16px;line-height:1;flex:none}
.sshR-zdChips{display:flex;flex-wrap:wrap;gap:6px;margin-left:36px}
.sshR-zdChip{appearance:none;display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--ssh-border);background:var(--ssh-bg);color:var(--ssh-muted);border-radius:6px;padding:3px 8px;font:inherit;font-size:11.5px;cursor:pointer}
.sshR-zdChip:hover:not(:disabled){background:var(--ssh-hover);color:var(--ssh-label)}
.sshR-zdChip.active{border-color:var(--ssh-accent);color:var(--ssh-label);background:var(--ssh-layer)}
.sshR-zdChipText{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:21rem}
.sshR-zdChipIcon{display:inline-flex;flex:none;align-items:center}
.sshR-zdNewSticky{position:sticky;bottom:0;padding-top:10px;background:var(--ssh-bg);border-top:1px solid var(--ssh-border);z-index:2}
.sshR-zdNewBtn{appearance:none;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;height:34px;border:1px solid var(--ssh-border);border-radius:8px;background:var(--ssh-bg);color:var(--ssh-label);font:inherit;font-size:13px;cursor:pointer}
.sshR-zdNewBtn:hover{background:var(--ssh-hover)}
.sshR-zdConnected{display:flex;align-items:center;gap:10px;border:1px solid rgba(22,163,74,.28);background:rgba(22,163,74,.08);border-radius:8px;padding:9px 12px}
.sshR-zdConnectedCheck{width:20px;height:20px;border-radius:50%;background:rgba(22,163,74,.16);color:var(--ssh-ok);display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.sshR-zdConnectedMain{display:flex;flex-direction:column;gap:1px;min-width:0}
.sshR-zdConnectedTitle{font-size:12.5px;font-weight:600;color:var(--ssh-label);word-break:break-all}
.sshR-zdConnectedSub{font-size:11.5px;color:var(--ssh-muted)}
.sshR-zdRename{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sshR-zdLabel{font-size:12px;color:var(--ssh-muted)}
.sshR-zdRename .sshR-input{height:30px;max-width:16rem}
.sshR-zdRenameHint{font-size:11px;color:var(--ssh-tertiary)}
.sshR-zdRecent{display:flex;flex-direction:column;gap:6px}
.sshR-zdRecent .sshR-zdChips{margin-left:0}
.sshR-zdWillOpen{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--ssh-muted);word-break:break-all}
.sshR-zdBgHint{margin:0;font-size:11px;color:var(--ssh-tertiary)}
.sshR-zdStepDirectory{display:flex;flex-direction:column;gap:12px;min-height:0}
.sshR-bgPill{position:fixed;right:24px;bottom:24px;z-index:1250;display:flex;align-items:center;gap:10px;max-width:min(24rem,calc(100vw - 32px));background:var(--ssh-bg);color:var(--ssh-label);border:1px solid var(--ssh-border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.24);padding:10px 12px}
.sshR-bgText{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.sshR-bgTitle{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sshR-bgSub{font-size:11px;color:var(--ssh-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sshR-bgAction{appearance:none;flex:none;border:1px solid var(--ssh-border);background:var(--ssh-bg);color:var(--ssh-label);border-radius:7px;padding:4px 9px;font:inherit;font-size:11.5px;cursor:pointer}
.sshR-bgAction:hover{background:var(--ssh-hover)}
.sshR-bgClose{appearance:none;flex:none;border:none;background:transparent;color:var(--ssh-muted);width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;line-height:1}
.sshR-bgClose:hover{background:var(--ssh-hover);color:var(--ssh-label)}
.sshR-bgDot{width:8px;height:8px;border-radius:50%;flex:none}
.sshR-bgDot.done{background:var(--ssh-ok)}
.sshR-bgDot.failed{background:var(--ssh-danger)}

/* ── ZCode SSH surfaces, reproduced 1:1 from ZCode 3.16.2 ───────────────
   Tokens are ZCode's own light palette; body[data-ds-dark-theme] switches
   to ZCode's dark palette so the dialog follows the host app theme. */
.zc-ui{--zc-font:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";--zc-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",monospace;--zc-bg:oklch(98.5% 0 0);--zc-dialog:oklch(100% 0 0);--zc-fg:oklch(37.1% 0 0);--zc-fg-subtle:#40404099;--zc-fg-subtlest:#40404066;--zc-muted:#595959;--zc-border:#0a0a0a1a;--zc-border-hover:#0a0a0a33;--zc-surface:#0a0a0a08;--zc-hover:oklch(92.2% 0 0);--zc-surface-hover:#0a0a0a0d;--zc-selected:#0a0a0a1a;--zc-input:#fff;--zc-input-focused:oklch(98.5% 0 0);--zc-input-border:#0a0a0a1a;--zc-input-border-hover:#0a0a0a33;--zc-input-border-focus:oklch(74.6% .16 232.661);--zc-primary:oklch(14.5% 0 0);--zc-primary-fg:oklch(98.5% 0 0);--zc-secondary:oklch(87% 0 0);--zc-menu:#fff;--zc-menu-hover:oklch(97% 0 0);--zc-success:oklch(62.7% .194 149.214);--zc-success-surface:oklch(98.2% .018 155.826);--zc-success-fg:oklch(52.7% .154 150.069);--zc-warning:oklch(68.1% .162 75.834);--zc-warning-surface:#cd89001f;--zc-warning-fg:oklch(47.6% .114 61.907);--zc-danger:oklch(57.7% .245 27.325);--zc-danger-surface:#e400141a;--zc-danger-fg:oklch(44.4% .177 26.899);--zc-progress:oklch(48.8% .243 264.376);--zc-progress-surface:oklch(97% .014 254.604);--zc-ssh-surface:oklch(97.7% .013 236.62);--zc-ssh-border:#bad9ff;--zc-ssh-fg:#0867ce;--zc-wsl-surface:#eaf7ee;--zc-wsl-border:#b7e0c2;--zc-wsl-fg:#166b32;--zc-docker-surface:#f2efff;--zc-docker-border:#d4caff;--zc-docker-fg:#6047b4;font-family:var(--zc-font);font-size:14px;line-height:1.625;color:var(--zc-fg)}
body[data-ds-dark-theme] .zc-ui{--zc-bg:oklch(20.5% 0 0);--zc-dialog:oklch(26.9% 0 0);--zc-fg:oklch(92.2% 0 0);--zc-fg-subtle:#e5e5e599;--zc-fg-subtlest:#e5e5e54d;--zc-muted:#b3b3b3;--zc-border:#fafafa1a;--zc-border-hover:#fafafa4d;--zc-surface:#ffffff0d;--zc-hover:#ffffff1a;--zc-surface-hover:#ffffff1a;--zc-selected:#ffffff1a;--zc-input:oklch(26.9% 0 0);--zc-input-focused:oklch(14.5% 0 0);--zc-input-border:#fafafa1a;--zc-input-border-hover:#fafafa4d;--zc-input-border-focus:oklch(74.6% .16 232.661);--zc-primary:oklch(98.5% 0 0);--zc-primary-fg:oklch(14.5% 0 0);--zc-secondary:oklch(37.1% 0 0);--zc-menu:oklch(14.5% 0 0);--zc-menu-hover:oklch(20.5% 0 0);--zc-success:oklch(72.3% .219 149.579);--zc-success-surface:#032e1573;--zc-success-fg:oklch(87.1% .15 154.449);--zc-warning:oklch(79.5% .184 86.047);--zc-warning-surface:#cd890029;--zc-warning-fg:oklch(85.2% .199 91.936);--zc-danger:oklch(63.7% .237 25.331);--zc-danger-surface:#e4001429;--zc-danger-fg:oklch(80.8% .114 19.571);--zc-progress:oklch(80.9% .105 251.813);--zc-progress-surface:#4682f029;--zc-ssh-surface:#00a5ef2e;--zc-ssh-border:#4099ff6b;--zc-ssh-fg:#8fc0ff;--zc-wsl-surface:#00c7582e;--zc-wsl-border:#46bf726b;--zc-wsl-fg:#87d9a4;--zc-docker-surface:#9f84ff29;--zc-docker-border:#9f84ff6b;--zc-docker-fg:#bfaaff}
.zc-ui *,.zc-ui *::before,.zc-ui *::after{box-sizing:border-box}
.zc-overlay{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.zc-dialog{position:fixed;top:10vh;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;width:calc(100vw - 2rem);max-width:42rem;max-height:calc(90dvh - 1rem);overflow:hidden;border-radius:16px;border:1px solid var(--zc-border);background:var(--zc-dialog);color:var(--zc-fg);box-shadow:0 4px 6px -1px #0000001a,0 2px 4px -2px #0000001a;outline:none;font-family:var(--zc-font);font-size:14px;line-height:1.625}
.zc-body{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;gap:12px;overflow:hidden;padding:16px}
@media (min-width:40rem){.zc-body{gap:16px;padding:24px}}
.zc-head{display:flex;flex-direction:column;gap:16px}
.zc-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.zc-head-titles{display:flex;min-width:0;flex-direction:column;gap:4px}
.zc-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.zc-title{margin:0;font-size:16px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-desc{margin:0;font-size:14px;line-height:1.625;color:var(--zc-fg-subtle);text-wrap:pretty}
.zc-preview{margin:0;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);word-break:break-all}
.zc-head-actions{display:flex;flex-shrink:0;align-items:center;gap:4px}
.zc-wizard-nav{display:flex;align-items:center;gap:8px;font-size:12px}
.zc-wizard{display:flex;align-items:center;gap:8px;list-style:none;margin:0;padding:0}
.zc-wizard li{display:flex;min-width:0;align-items:center;gap:8px;color:var(--zc-muted)}
.zc-wizard li[data-current]{font-weight:500;color:var(--zc-fg)}
.zc-wizard-sep{width:20px;height:1px;background:var(--zc-border)}
.zc-wizard-dot{display:flex;width:16px;height:16px;flex-shrink:0;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--zc-border);font-size:10px;line-height:1}
.zc-wizard li[data-current] .zc-wizard-dot{border-color:var(--zc-primary);background:var(--zc-primary);color:var(--zc-primary-fg)}
.zc-wizard-dot svg{width:10px;height:10px}
.zc-btn{display:inline-flex;height:28px;flex-shrink:0;align-items:center;justify-content:center;gap:4px;white-space:nowrap;border-radius:6px;border:1px solid transparent;background-clip:padding-box;padding:0 8px;font-family:inherit;font-size:14px;line-height:1.625;color:var(--zc-fg);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;outline:none;user-select:none}
.zc-btn:disabled{pointer-events:none;opacity:.5}
.zc-btn svg{pointer-events:none;flex-shrink:0;width:14px;height:14px}
.zc-btn-default{background:var(--zc-primary);color:var(--zc-primary-fg)}
.zc-btn-default:hover{background:color-mix(in oklab,var(--zc-primary) 80%,transparent)}
.zc-btn-outline{border-color:var(--zc-border);background:transparent;color:var(--zc-fg)}
.zc-btn-outline:hover{border-color:var(--zc-border-hover);background:color-mix(in oklab,var(--zc-input) 50%,transparent)}
.zc-btn-secondary{background:var(--zc-secondary);color:var(--zc-fg)}
.zc-btn-secondary:hover{background:color-mix(in oklab,var(--zc-secondary) 80%,transparent)}
.zc-btn-ghost{background:transparent;color:var(--zc-fg)}
.zc-btn-ghost:hover{background:var(--zc-hover);color:var(--zc-fg)}
.zc-btn-lg{height:32px;border-radius:8px;padding:0 10px}
.zc-btn-sm{height:24px}
.zc-btn-icon{width:24px;height:24px;padding:0}
.zc-btn-icon svg{width:12px;height:12px}
.zc-btn-icon-lg{width:32px;height:32px;padding:0;border-radius:8px}
.zc-btn.h9{height:36px;padding:0 16px}
.zc-btn.muted{color:var(--zc-muted)}
.zc-btn.muted:hover{color:var(--zc-fg)}
.zc-btn.big{height:40px;min-width:0;padding:0 20px}
.zc-input{width:100%;height:36px;min-width:0;border:1px solid var(--zc-input-border);border-radius:8px;background:var(--zc-input);padding:0 12px;font-family:var(--zc-font);font-size:14px;line-height:1.625;color:var(--zc-fg);outline:none;transition:border-color .15s,background-color .15s;-webkit-appearance:none;appearance:none}
.zc-input::placeholder{color:var(--zc-fg-subtlest)}
.zc-input:hover{border-color:var(--zc-input-border-hover)}
.zc-input:focus{border-color:var(--zc-input-border-focus);background:var(--zc-input-focused)}
.zc-input.mono{font-family:var(--zc-mono)}
.zc-input.mono::placeholder{font-family:var(--zc-font)}
.zc-input.invalid{border-color:var(--zc-danger)}
.zc-input.as-button{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;text-align:left;overflow:hidden}
.zc-input.as-button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-input.as-button svg{width:14px;height:14px;flex-shrink:0;color:var(--zc-muted)}
.zc-input.as-button:disabled{cursor:not-allowed;opacity:.5}
.zc-alias-btn{max-width:20rem}
.zc-input.h7{height:28px}
.zc-input.h8{height:32px}
.zc-seg{display:flex;width:fit-content;max-width:100%;overflow:hidden;border-radius:8px;border:1px solid var(--zc-input-border)}
.zc-seg button{display:inline-flex;min-height:32px;min-width:0;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:0;background:transparent;color:var(--zc-muted);font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;transition:color .15s,background-color .15s}
.zc-seg button+button{border-left:1px solid var(--zc-input-border)}
.zc-seg button[aria-pressed=true]{font-weight:500;background:var(--zc-selected);color:var(--zc-fg)}
.zc-seg button:not([aria-pressed=true]):not(:disabled):hover{color:var(--zc-fg)}
.zc-seg button:disabled{cursor:not-allowed;opacity:.5}
.zc-step-device{display:flex;min-height:0;flex:1;flex-direction:column;gap:16px}
.zc-search-wrap{position:relative}
.zc-search-icon{position:absolute;left:12px;top:50%;width:16px;height:16px;transform:translateY(-50%);color:var(--zc-muted);pointer-events:none}
.zc-search-icon svg{width:16px;height:16px}
.zc-search-input{height:36px;padding-left:36px}
.zc-scroll{min-height:0;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.zc-section-title{margin:0 0 8px;font-size:12px;color:var(--zc-muted);text-wrap:pretty}
.zc-section-mono{margin-left:8px;font-family:var(--zc-mono);font-size:10px;color:var(--zc-muted)}
.zc-device-item{margin-bottom:8px}
.zc-device{display:flex;width:100%;align-items:center;gap:12px;border-radius:8px;padding:8px;text-align:left;background:transparent;border:0;color:var(--zc-fg);font:inherit;cursor:pointer}
.zc-device:hover,.zc-device:focus-visible{background:var(--zc-hover);outline:none}
.zc-device:disabled{opacity:.5;pointer-events:none}
.zc-device-icon{display:flex;width:32px;height:32px;flex-shrink:0;align-items:center;justify-content:center;border-radius:6px;background:var(--zc-surface);color:var(--zc-muted)}
.zc-device-icon-ssh{background:var(--zc-ssh-surface);color:var(--zc-ssh-fg)}
.zc-device-icon-wsl{background:var(--zc-wsl-surface);color:var(--zc-wsl-fg)}
.zc-device-icon-docker{background:var(--zc-docker-surface);color:var(--zc-docker-fg)}
.zc-device-icon svg{width:16px;height:16px}
.zc-device-main{min-width:0;flex:1}
.zc-device-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}
.zc-device-desc{display:block;word-break:break-all;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted)}
.zc-chips{margin-left:52px;display:flex;flex-wrap:wrap;gap:4px}
.zc-chip{display:flex;max-width:100%;align-items:center;gap:4px;border-radius:6px;border:1px solid var(--zc-border);background:var(--zc-surface);padding:2px 8px;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);cursor:pointer;line-height:1.625}
.zc-chip:hover{background:var(--zc-hover)}
.zc-chip svg{width:12px;height:12px;flex-shrink:0}
.zc-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-new-row{display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--zc-border);padding-top:12px}
.zc-kbd-hint{margin:0;border-top:1px solid var(--zc-border);padding-top:12px;font-size:10px;color:var(--zc-muted);text-wrap:pretty}
.zc-badge{display:inline-flex;height:24px;width:fit-content;flex-shrink:0;align-items:center;gap:6px;white-space:nowrap;border-radius:6px;border:1px solid var(--zc-border);padding:0 8px;font-size:10px;font-weight:600;line-height:1.625}
.zc-badge svg{width:12px;height:12px}
.zc-badge-dot{width:6px;height:6px;border-radius:50%;flex:none}
.zc-badge-neutral{color:var(--zc-muted);background:var(--zc-surface);border-color:var(--zc-border)}
.zc-badge-neutral .zc-badge-dot{border:1px solid var(--zc-fg-subtlest)}
.zc-badge-success{color:var(--zc-success-fg);background:var(--zc-success-surface);border-color:var(--zc-success)}
.zc-badge-success .zc-badge-dot{background:var(--zc-success)}
.zc-badge-progress{color:var(--zc-progress);background:var(--zc-progress-surface);border-color:var(--zc-progress)}
.zc-badge-progress .zc-badge-dot{background:var(--zc-progress);animation:zc-pulse 2s cubic-bezier(.4,0,.6,1) infinite}
.zc-badge-warning{color:var(--zc-warning-fg);background:var(--zc-warning-surface);border-color:var(--zc-warning)}
.zc-badge-warning .zc-badge-dot{background:var(--zc-warning)}
.zc-badge-danger{color:var(--zc-danger-fg);background:var(--zc-danger-surface);border-color:var(--zc-danger)}
.zc-badge-danger .zc-badge-dot{background:var(--zc-danger)}
.zc-badge-ssh{color:var(--zc-ssh-fg);background:var(--zc-ssh-surface);border-color:var(--zc-ssh-border)}
.zc-badge-wsl{color:var(--zc-wsl-fg);background:var(--zc-wsl-surface);border-color:var(--zc-wsl-border)}
.zc-badge-docker{color:var(--zc-docker-fg);background:var(--zc-docker-surface);border-color:var(--zc-docker-border)}
.zc-form{display:flex;min-height:0;flex:1;flex-direction:column}
.zc-form-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:16px;padding-right:4px}
.zc-type-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.zc-fields{display:flex;flex-direction:column;gap:16px}
.zc-field{display:block;min-width:0}
.zc-label{display:block;margin-bottom:6px;font-size:12px;color:var(--zc-muted)}
.zc-grid-host{display:grid;grid-template-columns:minmax(0,1fr) 6rem;gap:12px}
.zc-grid-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.zc-auth-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.zc-auth-label{font-size:12px;color:var(--zc-muted)}
.zc-field-err{margin:6px 0 0;display:flex;align-items:flex-start;gap:4px;font-size:12px;color:var(--zc-danger)}
.zc-field-err svg{width:14px;height:14px;margin-top:2px;flex-shrink:0}
.zc-hint{margin:6px 0 0;font-size:12px;display:flex;align-items:flex-start;gap:6px;color:var(--zc-muted);text-wrap:pretty}
.zc-hint-warning{color:var(--zc-warning-fg)}
.zc-hint-success{color:var(--zc-success-fg)}
.zc-truncate.muted{color:var(--zc-muted)}
.zc-adv-toggle{display:inline-flex;height:24px;align-items:center;gap:4px;margin-left:-4px;padding:0 4px;border:0;border-radius:6px;background:transparent;color:var(--zc-muted);font:inherit;font-size:14px;cursor:pointer}
.zc-adv-toggle:hover{background:var(--zc-hover);color:var(--zc-fg)}
.zc-adv-toggle svg{width:14px;height:14px;transition:transform .15s}
.zc-adv-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
.zc-adv-panel{display:flex;flex-direction:column;gap:12px;padding-top:8px}
.zc-pwd{position:relative}
.zc-pwd .zc-input{padding-right:40px}
.zc-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--zc-fg);cursor:pointer}
.zc-eye:hover{background:var(--zc-hover)}
.zc-eye svg{width:16px;height:16px}
.zc-form-foot{margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--zc-border);padding-top:16px}
.zc-form-foot.end{justify-content:flex-end}
.zc-spacer{flex:1}
.zc-import-wrap{position:relative}
.zc-docker-picker{position:relative}
.zc-input.as-button.docker-trigger{width:100%;height:36px;font-weight:400}
.zc-docker-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:6;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--zc-border);background:var(--zc-menu);padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.zc-docker-search{height:32px;width:calc(100% - 8px);margin:2px 4px}
.zc-docker-list{display:flex;max-height:14rem;flex-direction:column;gap:1px;overflow:auto;scroll-padding-block:4px}
.zc-docker-empty{display:flex;min-height:32px;align-items:center;gap:8px;padding:16px 12px;border-radius:8px;font-size:14px;color:var(--zc-muted)}
.zc-docker-item{display:flex;min-height:32px;align-items:center;gap:8px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--zc-fg);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.zc-docker-item:hover,.zc-docker-item[data-selected=true]{background:var(--zc-menu-hover)}
.zc-docker-item-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-docker-item svg{flex-shrink:0;color:var(--zc-muted)}
.zc-import-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;display:flex;max-height:15rem;width:20rem;max-width:calc(100vw - 2rem);flex-direction:column;gap:2px;overflow:auto;border-radius:12px;border:1px solid var(--zc-border);background:var(--zc-menu);padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.zc-import-item{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--zc-fg);font:inherit;text-align:left;cursor:pointer}
.zc-import-item:hover{background:var(--zc-menu-hover)}
.zc-import-item span{font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted)}
.zc-connect{display:flex;min-height:0;flex:1;flex-direction:column;gap:24px}
.zc-connect-scroll{display:flex;min-height:0;flex:1;flex-direction:column;gap:16px;overflow-y:auto}
.zc-conn-head{display:flex;flex-shrink:0;flex-direction:column;gap:4px}
.zc-conn-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.zc-conn-title{margin:0;font-size:14px;font-weight:600}
.zc-conn-target{margin:0;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);word-break:break-all}
.zc-phases{list-style:none;margin:0;padding:4px 0;display:flex;flex-shrink:0;flex-direction:column;gap:2px}
.zc-phase{position:relative;display:flex;min-width:0;flex-shrink:0;align-items:flex-start;gap:12px;border-radius:6px;padding:8px 10px;font-size:12px}
.zc-phase[data-status=active]{background:var(--zc-surface)}
.zc-phase-line{position:absolute;left:20px;top:32px;bottom:0;border-left:1px solid var(--zc-border)}
.zc-phase-dot{position:relative;z-index:1;margin-top:2px;display:flex;width:20px;height:20px;flex-shrink:0;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--zc-border);color:var(--zc-muted)}
.zc-phase-dot svg{width:12px;height:12px}
.zc-phase[data-status=complete] .zc-phase-dot{border-color:var(--zc-success);background:var(--zc-success-surface);color:var(--zc-success-fg)}
.zc-phase[data-status=active] .zc-phase-dot{border-color:var(--zc-progress);color:var(--zc-progress)}
.zc-phase[data-status=failed] .zc-phase-dot{border-color:var(--zc-danger);color:var(--zc-danger)}
.zc-dotmark{width:6px;height:6px;border-radius:50%;background:currentColor}
.zc-phase-main{min-width:0;flex:1}
.zc-phase-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.zc-phase-title{color:var(--zc-fg)}
.zc-phase[data-status=pending] .zc-phase-title{color:var(--zc-muted)}
.zc-phase[data-status=active] .zc-phase-title{font-weight:600}
.zc-phase-time{font-size:10px;color:var(--zc-muted);font-variant-numeric:tabular-nums}
.zc-phase-sub{margin:2px 0 0;font-size:10px;color:var(--zc-muted);word-break:break-word}
.zc-log{display:flex;flex-direction:column}
.zc-log-toggle{display:inline-flex;height:24px;align-self:flex-start;align-items:center;gap:4px;border:0;background:transparent;padding:0;color:var(--zc-fg);font:inherit;font-size:14px;cursor:pointer}
.zc-log-toggle svg{width:14px;height:14px;transition:transform .15s}
.zc-log-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
.zc-log-count{color:var(--zc-muted)}
.zc-log-box{margin-top:4px;display:flex;max-height:12rem;flex-direction:column;gap:4px;overflow-y:auto;border-radius:8px;border:1px solid var(--zc-border);background:var(--zc-bg);padding:8px 12px;font-family:var(--zc-mono);font-size:10px;line-height:24px}
.zc-log-line{display:flex;min-width:0;width:100%;color:var(--zc-fg)}
.zc-log-time{color:var(--zc-muted)}
.zc-log-level{margin:0 8px}
.zc-log-empty{display:flex;align-items:center;justify-content:center;padding:8px 0;color:var(--zc-muted)}
.zc-connect-foot{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--zc-border);padding-top:12px}
.zc-status-block{display:flex;flex-direction:column;gap:8px;border-radius:4px;border:1px solid var(--zc-danger);background:var(--zc-danger-surface);padding:12px 14px;color:var(--zc-danger-fg)}
.zc-status-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.zc-status-title svg{width:16px;height:16px;flex-shrink:0}
.zc-status-reason{margin:0;font-size:10px;color:var(--zc-muted)}
.zc-error-details{font-size:10px;color:var(--zc-muted)}
.zc-error-details summary{cursor:pointer;font-size:10px}
.zc-error-details pre{margin:6px 0;max-height:8rem;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-word}
.zc-status-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:2px}
.zc-install-card{margin-top:8px;display:flex;flex-direction:column;gap:8px;border-radius:4px;border:1px solid var(--zc-border);background:var(--zc-bg);padding:12px 14px;font-size:12px}
.zc-install-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.zc-install-title svg{width:16px;height:16px;flex-shrink:0}
.zc-install-grid{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:16px;row-gap:4px;margin:0;font-size:10px}
.zc-install-grid dt{color:var(--zc-muted)}
.zc-install-grid dd{margin:0;font-family:var(--zc-mono);word-break:break-word}
.zc-install-grid dd.break{word-break:break-all}
.zc-install-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:2px}
.zc-progress{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.zc-progress-text{font-size:10px;color:var(--zc-muted);font-variant-numeric:tabular-nums}
.zc-progress-bar{height:4px;max-width:24rem;overflow:hidden;border-radius:999px;background:var(--zc-surface)}
.zc-progress-fill{height:100%;border-radius:999px;background:var(--zc-progress)}
.zc-log-copy{align-self:flex-end;border:0;background:transparent;color:var(--zc-fg);font:inherit;font-size:10px;cursor:pointer;padding:2px 4px}
.zc-log-copy:hover{text-decoration:underline}
.zc-dir{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px}
.zc-dir-scroll{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;overflow-y:auto}
.zc-connected{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-radius:6px;background:var(--zc-success-surface);padding:8px 12px;font-size:12px;color:var(--zc-success-fg)}
.zc-connected-left{display:flex;min-width:0;align-items:center;gap:8px}
.zc-connected-left svg{width:16px;height:16px;flex-shrink:0}
.zc-rename{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.zc-rename-label{font-size:12px;color:var(--zc-muted)}
.zc-rename .zc-input{height:28px;max-width:16rem;font-family:var(--zc-mono);font-size:12px}
.zc-rename-hint{font-size:10px;color:var(--zc-muted)}
.zc-recent{display:flex;min-width:0;flex-direction:column;gap:6px}
.zc-recent-label{display:block;font-size:10px;color:var(--zc-muted)}
.zc-recent-chips{display:flex;min-width:0;flex-wrap:wrap;gap:8px}
.zc-recent-chip{display:inline-flex;max-width:100%;height:auto;align-items:center;gap:4px;border-radius:6px;border:1px solid var(--zc-border);background:transparent;padding:4px 8px;font-family:var(--zc-mono);font-size:12px;line-height:1.625;color:var(--zc-fg);text-align:left;cursor:pointer;transition:background-color .15s,border-color .15s}
.zc-recent-chip:hover{border-color:var(--zc-border-hover);background:color-mix(in oklab,var(--zc-input) 50%,transparent)}
.zc-recent-chip[data-selected=true]{background:var(--zc-secondary);border-color:transparent}
.zc-recent-chip svg{width:14px;height:14px;flex-shrink:0;color:var(--zc-muted)}
.zc-recent-chip span{word-break:break-all;white-space:normal;text-align:left}
.zc-browser-wrap{display:flex;min-height:12rem;flex-shrink:0;overflow:hidden}
.zc-willopen{margin:0;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);word-break:break-all}
.zc-dir-foot{display:flex;align-items:center;justify-content:flex-end;gap:12px;border-top:1px solid var(--zc-border);padding-top:12px}
.zc-dir-foot .zc-later{margin-right:auto}
.zc-browser{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;border-radius:6px;border:1px solid var(--zc-border);background:var(--zc-surface);padding:12px}
.zc-browser-form{display:flex;flex-direction:column;gap:8px}
@media (min-width:40rem){.zc-browser-form{flex-direction:row}}
.zc-browser-form .zc-input{height:36px;flex:1;min-width:0}
.zc-browser-actions{display:flex;gap:8px}
.zc-browser-actions .zc-btn{height:36px;min-width:0;padding:0 12px}
.zc-browser-list{display:flex;min-height:6rem;max-height:16rem;flex:1;flex-direction:column;overflow-y:auto;border-radius:6px;background:var(--zc-bg)}
.zc-browser-row{display:flex;width:100%;flex-shrink:0;cursor:pointer;align-items:center;gap:8px;padding:8px 12px;border:0;background:transparent;color:var(--zc-fg);font:inherit;font-size:14px;text-align:left;transition:background-color .15s}
.zc-browser-row:hover{background:color-mix(in oklab,var(--zc-hover) 50%,transparent)}
.zc-browser-row svg{width:16px;height:16px;flex-shrink:0;color:var(--zc-fg-subtle)}
.zc-browser-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-browser-up{height:40px;padding:0 12px}
.zc-browser-empty{padding:16px;text-align:center;font-size:14px;color:var(--zc-fg-subtle)}
.zc-browser-error{font-size:14px;color:var(--zc-danger)}
.zc-error{display:flex;align-items:flex-start;gap:12px;border-radius:6px;background:var(--zc-danger-surface);padding:12px;font-size:12px;color:var(--zc-danger-fg)}
.zc-error svg{width:16px;height:16px;margin-top:2px;flex-shrink:0}
.zc-pill{position:fixed;left:16px;bottom:64px;z-index:55;display:flex;width:272px;flex-direction:column;gap:4px;font-family:var(--zc-font);font-size:14px;line-height:1.625;color:var(--zc-fg)}
.zc-pill-card{display:flex;width:100%;flex-direction:column;border-radius:8px;border:1px solid var(--zc-border);background:var(--zc-surface);padding:8px;text-align:left;color:var(--zc-fg);font:inherit;cursor:pointer}
.zc-pill-card.progress{background:var(--zc-progress-surface);color:var(--zc-progress)}
.zc-pill-card.danger{background:var(--zc-danger-surface);color:var(--zc-danger-fg)}
.zc-pill-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.zc-pill-title .zc-truncate{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-pill-title svg{width:14px;height:14px;flex-shrink:0}
.zc-pill-sub{display:block;margin-top:4px;font-size:10px;word-break:break-word}
.zc-pill-bar{display:block;margin-top:8px;height:4px;overflow:hidden;border-radius:999px;background:var(--zc-border)}
.zc-pill-bar span{display:block;height:100%;background:var(--zc-progress)}
.zc-pill-action{display:block;margin-top:4px;font-size:14px;text-decoration:underline}
.zc-pill-cancel{align-self:flex-start;border:0;background:transparent;padding:0;color:var(--zc-fg-subtle);font:inherit;font-size:14px;text-decoration:underline;cursor:pointer}
.zc-pill-cancel:hover{color:var(--zc-fg)}
.zc-scroll::-webkit-scrollbar,.zc-form-scroll::-webkit-scrollbar,.zc-connect-scroll::-webkit-scrollbar,.zc-dir-scroll::-webkit-scrollbar,.zc-browser-list::-webkit-scrollbar,.zc-log-box::-webkit-scrollbar{width:8px;height:8px}
.zc-scroll::-webkit-scrollbar-track,.zc-form-scroll::-webkit-scrollbar-track,.zc-connect-scroll::-webkit-scrollbar-track,.zc-dir-scroll::-webkit-scrollbar-track,.zc-browser-list::-webkit-scrollbar-track,.zc-log-box::-webkit-scrollbar-track{background:transparent}
.zc-scroll::-webkit-scrollbar-thumb,.zc-form-scroll::-webkit-scrollbar-thumb,.zc-connect-scroll::-webkit-scrollbar-thumb,.zc-dir-scroll::-webkit-scrollbar-thumb,.zc-browser-list::-webkit-scrollbar-thumb,.zc-log-box::-webkit-scrollbar-thumb{background:var(--zc-border);border-radius:999px}
.zc-scroll::-webkit-scrollbar-thumb:hover,.zc-form-scroll::-webkit-scrollbar-thumb:hover,.zc-connect-scroll::-webkit-scrollbar-thumb:hover,.zc-dir-scroll::-webkit-scrollbar-thumb:hover,.zc-browser-list::-webkit-scrollbar-thumb:hover,.zc-log-box::-webkit-scrollbar-thumb:hover{background:var(--zc-border-hover)}
.zc-scroll::-webkit-scrollbar-button,.zc-form-scroll::-webkit-scrollbar-button,.zc-connect-scroll::-webkit-scrollbar-button,.zc-dir-scroll::-webkit-scrollbar-button,.zc-browser-list::-webkit-scrollbar-button,.zc-log-box::-webkit-scrollbar-button{display:none}

.zc-panel{padding:16px 12px 40px;color:var(--zc-fg)}
.zc-panel-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;margin-bottom:16px}
.zc-panel-title{margin:0 0 4px;font-size:16px;line-height:1.4;font-weight:500}
.zc-panel-sub{margin:0;max-width:760px;font-size:12px;line-height:1.5;color:var(--zc-muted)}
.zc-panel-actions{margin-left:auto;display:flex;flex:none;gap:8px}
.zc-card{border:1px solid var(--zc-border);background:var(--zc-dialog);border-radius:12px;padding:16px;margin-bottom:12px}
.zc-card-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.zc-card-title{font-size:14px;font-weight:600}
.zc-card-device{font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted)}
.zc-card-path{margin-top:4px;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);word-break:break-all}
.zc-card-meta{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;font-size:12px;color:var(--zc-muted)}
.zc-card-meta b{color:var(--zc-fg);font-weight:500;font-variant-numeric:tabular-nums}
.zc-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
/* ZCode device page (zYn): bordered list, 48px single-line rows, 32px tile,
   project count / last-online meta, badge always visible, chevron 90°. */
.zc-device-list{display:flex;flex-direction:column;border:1px solid var(--zc-border);border-radius:12px;background:var(--zc-dialog);overflow:hidden}
.zc-device-head{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:14px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-device-count{display:inline-flex;min-width:18px;align-items:center;justify-content:center;border-radius:999px;background:var(--zc-surface);padding:0 6px;font-size:11px;font-weight:400;color:var(--zc-muted)}
.zc-device-head .zc-panel-actions{margin-left:auto}
.zc-device-card{border-top:1px solid var(--zc-border)}
.zc-device-card:first-child{border-top:0}
.zc-device-row2{position:relative;display:flex;min-height:48px;cursor:pointer;align-items:center;gap:10px;padding:8px 8px 8px 16px}
.zc-device-row2:hover{background:var(--zc-hover)}
.zc-device-toggle{display:flex;min-width:0;flex:1;align-items:center;gap:10px;border:0;border-radius:6px;background:transparent;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}
.zc-device-toggle:focus-visible{outline:2px solid var(--zc-input-border-focus);outline-offset:2px}
.zc-device-icon{display:flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;border-radius:6px;background:var(--zc-surface);color:var(--zc-muted)}
.zc-device-identity{display:flex;min-width:0;flex:1;flex-direction:column}
.zc-device-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-device-address{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--zc-mono);font-size:12px;line-height:1.5;color:var(--zc-muted)}
.zc-device-main{display:flex;min-width:0;flex:1;flex-direction:column}
.zc-device-desc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--zc-mono);font-size:12px;line-height:1.5;color:var(--zc-muted)}
.zc-device-row-meta{display:none;flex:none;align-items:center;gap:4px;font-size:12px;color:var(--zc-muted)}
@media (min-width:576px){.zc-device-row-meta{display:inline-flex}}
.zc-device-row-actions{display:flex;flex:none;align-items:center;gap:4px}
.zc-device-chevron{flex:none;color:var(--zc-muted);transition:transform .12s ease}
.zc-device-chevron.open{transform:rotate(90deg)}
.zc-device-more{width:24px;height:24px;border-radius:6px}
.zc-device-details{display:flex;flex-direction:column;gap:12px;padding:16px}
.zc-device-connection{display:flex;min-width:0;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--zc-muted)}
.zc-device-tag{border-radius:6px;background:var(--zc-surface);padding:1px 6px;font-size:11px;color:var(--zc-muted)}
.zc-device-version{flex:none;white-space:nowrap;font-size:12px;color:var(--zc-muted)}
.zc-device-link{border:0;background:transparent;padding:0;color:var(--zc-muted);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.zc-device-link:hover{color:var(--zc-fg)}
.zc-device-link:disabled{opacity:.5;cursor:not-allowed}
.zc-device-projects{display:flex;min-width:0;flex-direction:column;gap:2px}
.zc-device-projects-head{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px}
.zc-device-projects-head p{margin:0;font-size:12px;font-weight:500;color:var(--zc-muted)}
.zc-device-project-empty{margin:0;font-size:12px;color:var(--zc-muted)}
.zc-device-project{display:flex;width:calc(100% + 16px);min-width:0;margin:0 -8px;align-items:center;gap:8px;border:0;border-radius:6px;background:transparent;padding:6px 8px;color:var(--zc-fg);font:inherit;text-align:left;cursor:pointer}
.zc-device-project:hover{background:var(--zc-hover)}
.zc-device-project:disabled{opacity:.5;cursor:not-allowed}
.zc-device-project>svg:first-child{flex:none;color:var(--zc-muted)}
.zc-device-project-name{max-width:12rem;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}
.zc-device-project-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted);text-align:left}
.zc-device-project-time{flex:none;font-size:12px;color:var(--zc-muted)}
.zc-device-project-arrow{flex:none;color:var(--zc-muted);opacity:0}
.zc-device-project:hover .zc-device-project-arrow,.zc-device-project:focus-visible .zc-device-project-arrow{opacity:1}
.zc-device-log-toggle{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;height:24px;padding:0;border:0;background:transparent;color:var(--zc-muted);font:inherit;font-size:12px;cursor:pointer}
.zc-device-log-toggle:hover{color:var(--zc-fg)}
.zc-device-log-count{display:inline-flex;min-width:16px;justify-content:center;border-radius:999px;background:var(--zc-surface);padding:0 5px;font-size:10px}
.zc-device-log{display:flex;max-height:9rem;flex-direction:column;gap:4px;overflow-y:auto;border-radius:8px;background:var(--zc-surface);padding:8px 12px;font-family:var(--zc-mono);font-size:12px;line-height:20px;color:var(--zc-muted)}
.zc-device-log-row{display:flex;min-width:0;gap:8px}
.zc-device-log-row.warn{color:var(--zc-warning-fg,var(--zc-muted))}
.zc-device-log-row.error{color:var(--zc-danger)}
.zc-device-log-time{flex:none;color:var(--zc-fg-subtlest)}
.zc-device-log-msg{min-width:0;word-break:break-word}
.zc-device-log-empty{margin:0}
.zc-device-menu{max-height:32rem}
.zc-import-menu.zc-device-menu,.zc-floating-menu.zc-import-menu.zc-device-menu{max-height:min(32rem,calc(100vh - 2rem))}
.zc-menu-sep{height:1px;margin:4px 0;background:var(--zc-border)}
.zc-device-info{display:flex;max-width:20rem;flex-direction:column;gap:2px;padding:6px 8px;font-size:12px;color:var(--zc-muted)}
.zc-device-info-row{margin:0;word-break:break-all;white-space:normal}
.zc-device-info-missing{color:var(--zc-fg-subtlest)}
.zc-device-prefs-section{margin-top:16px;border-top:1px solid var(--zc-border);padding-top:16px}
.zc-device-prefs-title{margin:0;font-size:14px;font-weight:500}
.zc-device-prefs{display:flex;flex-direction:column;gap:16px;margin-top:12px}
.zc-device-pref{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.zc-device-pref-copy p{margin:0}
.zc-device-pref-title{font-size:14px}
.zc-device-pref-desc{font-size:12px;color:var(--zc-muted)}
.zc-switch{position:relative;display:inline-flex;width:32px;height:18px;flex:none;align-items:center;border:0;border-radius:999px;background:var(--zc-input-border);padding:2px;cursor:pointer;transition:background .15s ease}
.zc-switch[aria-checked=true]{background:var(--zc-primary)}
.zc-switch span{display:block;width:14px;height:14px;border-radius:50%;background:#fff;transform:translateX(0);transition:transform .15s ease}
.zc-switch[aria-checked=true] span{transform:translateX(14px)}
.zc-switch:disabled{opacity:.5;cursor:not-allowed}
.zc-search{position:relative;display:flex;align-items:center;margin:0 0 8px}
.zc-search svg{position:absolute;left:10px;color:var(--zc-muted);pointer-events:none}
.zc-search input{width:100%;height:32px;border:1px solid var(--zc-input-border);border-radius:8px;background:var(--zc-input);padding:0 10px 0 32px;color:var(--zc-fg);font:inherit;font-size:13px;outline:none}
.zc-search input:focus{border-color:var(--zc-input-border-focus);background:var(--zc-input-focused)}
.zc-btn-danger{background:var(--zc-danger);color:#fff}
.zc-btn-danger:hover{background:color-mix(in oklab,var(--zc-danger) 85%,transparent)}
.zc-import-item.danger{color:var(--zc-danger)}
.zc-import-item:disabled{opacity:.5;cursor:not-allowed}
.zc-device-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:24px 12px;text-align:center;font-size:13px;color:var(--zc-muted)}
.zc-device-empty svg{color:var(--zc-fg-subtlest)}
.zc-device-loading{display:flex;align-items:center;gap:8px;padding:8px;font-size:12px;color:var(--zc-muted)}
.zc-btn.danger{color:var(--zc-danger)}
.zc-empty{border:1px dashed var(--zc-border);border-radius:12px;padding:24px;text-align:center;font-size:13px;color:var(--zc-muted);margin-bottom:12px}
.zc-notice{margin:0 0 10px;font-size:12px;color:var(--zc-success-fg)}
.zc-dialog.zc-modal{top:50%;transform:translate(-50%,-50%);max-width:32rem;max-height:calc(100vh - 4rem)}
.zc-dialog.zc-modal.wide{max-width:42rem}
.zc-modal-body{min-height:0;flex:1;overflow:auto}
.zc-modal-foot{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--zc-border);padding-top:12px}
.zc-pre{margin:0;max-height:24rem;overflow:auto;border-radius:8px;border:1px solid var(--zc-border);background:var(--zc-bg);padding:8px 12px;font-family:var(--zc-mono);font-size:10px;line-height:24px;color:var(--zc-fg);white-space:pre-wrap;word-break:break-word}
.zc-settings{font-size:13px;color:var(--zc-fg)}
.zc-settings .sshR-sub{font-size:12px;color:var(--zc-muted)}
.zc-settings .sshR-sectionTitle{margin:18px 0 8px;font-size:12px;font-weight:600;color:var(--zc-muted)}
.zc-settings .sshR-hostRow{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--zc-border)}
.zc-settings .sshR-card{background:var(--zc-dialog);border:1px solid var(--zc-border);border-radius:12px;padding:16px;margin-top:12px}
.zc-settings .sshR-input,.zc-settings .sshR-select{height:32px;border:1px solid var(--zc-input-border);border-radius:8px;background:var(--zc-input);color:var(--zc-fg);font-family:var(--zc-font);font-size:13px;padding:0 10px;outline:none}
.zc-settings .sshR-input:focus,.zc-settings .sshR-select:focus{border-color:var(--zc-input-border-focus);background:var(--zc-input-focused)}
.zc-settings .sshR-btn{height:28px;border:1px solid var(--zc-border);border-radius:6px;background:transparent;color:var(--zc-fg);font-family:var(--zc-font);font-size:13px;padding:0 10px;cursor:pointer}
.zc-settings .sshR-btn:hover:not(:disabled){background:var(--zc-hover)}
.zc-settings .sshR-btn.primary{background:var(--zc-primary);color:var(--zc-primary-fg);border-color:transparent}
.zc-settings .sshR-btn.danger{color:var(--zc-danger)}
.zc-settings .sshR-tag{border:1px solid var(--zc-border);background:var(--zc-surface);border-radius:6px;padding:1px 6px;font-size:10px;color:var(--zc-muted)}
.zc-settings .sshR-hint{font-size:12px;color:var(--zc-muted)}
.zc-settings .sshR-errorBox{border-radius:6px;background:var(--zc-danger-surface);color:var(--zc-danger-fg);padding:10px 12px;font-size:12px}
.zc-settings .sshR-field label{font-size:12px;color:var(--zc-muted)}
.zc-settings .mono{font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted)}
@keyframes zc-spin{to{transform:rotate(360deg)}}
@keyframes zc-pulse{50%{opacity:.5}}
.zc-ui .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* ── ZCode 3.17.2: device-management wizard header ─────────────────────── */
.zc-type-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.zc-import-btn{display:inline-flex;height:32px;flex-shrink:0;align-items:center;gap:6px;border:0;border-radius:6px;background:transparent;padding:0 8px;font:inherit;font-size:14px;color:var(--zc-muted);cursor:pointer}
.zc-import-btn:hover{background:var(--zc-hover);color:var(--zc-fg)}
.zc-import-btn:disabled{cursor:not-allowed;opacity:.5}
.zc-import-btn svg{width:14px;height:14px;flex-shrink:0}
.zc-import-btn .zc-chev{width:14px;height:14px;transition:transform .15s}
.zc-import-btn[aria-expanded=true] .zc-chev{transform:rotate(180deg)}
.zc-import-search{height:32px;margin:2px 4px;width:calc(100% - 8px)}
.zc-import-menu{max-height:15rem;overscroll-behavior:contain}
.zc-import-item{flex-direction:row;align-items:center;gap:8px;min-height:32px;padding:4px 8px}
.zc-import-item-main{display:flex;min-width:0;flex:1;flex-direction:column;text-align:left}
.zc-import-item-main span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--zc-fg)}
.zc-import-item-main span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--zc-mono);font-size:12px;color:var(--zc-muted)}
.zc-import-item[data-checked=true]{background:var(--zc-menu-hover)}
.zc-import-item>svg{width:16px;height:16px;flex-shrink:0;color:var(--zc-muted)}
.zc-alias-row{display:flex;flex-wrap:wrap;align-items:center;gap:1px 12px}
.zc-alias-chip{display:inline-flex;height:28px;align-items:center;gap:6px;border:1px solid var(--zc-ssh-border);border-radius:6px;background:var(--zc-ssh-surface);padding:0 2px 0 8px;font-size:12px;color:var(--zc-ssh-fg)}
.zc-alias-chip>span{max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-alias-chip svg{width:14px;height:14px;flex-shrink:0}
.zc-alias-chip button{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.zc-alias-chip button:hover{background:var(--zc-hover)}
.zc-alias-hint{font-size:12px;color:var(--zc-muted)}
.zc-adv-group{display:flex;flex-direction:column;gap:6px}
.zc-adv-group .zc-seg{flex-wrap:wrap;width:auto}
.zc-adv-group .zc-seg button{white-space:normal;text-align:center;padding:4px 12px}
.zc-adv-desc{margin:0;font-size:12px;color:var(--zc-muted);text-wrap:pretty}
/* ── ZCode 3.17.2: create-project dialog ───────────────────────────────── */
.zc-create-center{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:none}
.zc-create-center .zc-dialog{pointer-events:auto}
.zc-dialog.zc-create{position:relative;top:auto;left:auto;transform:none;width:100%;max-width:32rem;max-height:calc(100vh - 4rem);gap:20px;padding:16px}
.zc-floating-menu{position:fixed;max-height:min(70vh,20rem);overflow-y:auto}
.zc-floating-menu.zc-import-menu{max-height:15rem}
.zc-create-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.zc-create-title{margin:0;font-size:16px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-create-close{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--zc-fg);cursor:pointer}
.zc-create-close:hover{background:var(--zc-surface-hover)}
.zc-create-close svg{width:16px;height:16px}
.zc-create-body{display:flex;min-height:0;flex-direction:column;gap:20px;overflow-y:auto}
.zc-create-field{display:grid;min-width:0;gap:6px}
.zc-create-label{font-size:12px;font-weight:500;color:var(--zc-fg)}
.zc-create-input{height:36px;border-radius:8px}
.zc-select-wrap{position:relative;min-width:0}
.zc-select-trigger{display:flex;width:100%;min-width:0;height:36px;align-items:center;gap:8px;border:1px solid var(--zc-input-border);border-radius:8px;background:var(--zc-input);padding:0 12px;font:inherit;font-size:14px;color:var(--zc-fg);text-align:left;cursor:pointer}
.zc-select-trigger:hover{border-color:var(--zc-input-border-hover);background:var(--zc-input)}
.zc-select-trigger[aria-expanded=true]{border-color:var(--zc-input-border-focus);background:var(--zc-input-focused)}
.zc-select-trigger:disabled{cursor:not-allowed;opacity:.5}
.zc-select-trigger>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-select-trigger>svg{width:14px;height:14px;flex-shrink:0;margin-left:auto;color:var(--zc-muted)}
.zc-select-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:9;display:flex;flex-direction:column;max-height:18rem;overflow-y:auto;border:1px solid var(--zc-border);border-radius:12px;background:var(--zc-popover,var(--zc-menu));padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.zc-select-item{display:flex;min-height:32px;width:100%;align-items:center;gap:8px;border:0;border-radius:6px;background:transparent;padding:4px 8px 4px 28px;position:relative;font:inherit;font-size:14px;color:var(--zc-fg);text-align:left;cursor:pointer}
.zc-select-item:hover,.zc-select-item[data-selected=true]{background:var(--zc-menu-hover)}
.zc-select-check{position:absolute;left:6px;display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;color:var(--zc-fg)}
.zc-select-check svg{width:14px;height:14px}
.zc-select-sep{height:1px;margin:4px -4px;background:var(--zc-border)}
.zc-select-add{gap:8px;padding-left:8px;color:var(--zc-fg)}
.zc-select-add svg{width:16px;height:16px;color:var(--zc-fg-subtle)}
.zc-device-label{display:flex;width:100%;min-width:0;align-items:center;gap:8px}
.zc-device-label>svg{width:16px;height:16px;flex-shrink:0;color:var(--zc-fg-subtle)}
.zc-device-label-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zc-device-status{display:flex;flex-shrink:0;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--zc-fg-subtle)}
.zc-device-status-dot{width:8px;height:8px;border-radius:999px}
.zc-device-status[data-status=online] .zc-device-status-dot{background:var(--zc-success)}
.zc-device-status[data-status=offline] .zc-device-status-dot{border:1px solid var(--zc-fg-subtlest)}
.zc-device-status[data-status=connecting] .zc-device-status-dot{background:var(--zc-progress);animation:zc-pulse 2s cubic-bezier(.4,0,.6,1) infinite}
.zc-device-status[data-status=pending] .zc-device-status-dot{background:var(--zc-warning)}
.zc-device-status[data-status=failed] .zc-device-status-dot{background:var(--zc-danger)}
.zc-existing-hint{display:flex;flex-wrap:wrap;align-items:center;gap:0 4px;margin:0;font-size:12px;color:var(--zc-fg-subtle)}
.zc-link{display:inline-flex;align-items:center;gap:2px;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--zc-brand,#2563eb);text-decoration:underline;text-underline-offset:4px;cursor:pointer}
.zc-link:hover{text-decoration-thickness:2px}
.zc-link:disabled{opacity:.5;cursor:not-allowed}
.zc-link svg{width:14px;height:14px}
.zc-folders{display:flex;min-width:0;flex-direction:column;gap:6px}
.zc-folder-list{overflow:hidden;border:1px solid var(--zc-border);border-radius:8px}
.zc-folder-row{display:flex;min-height:48px;min-width:0;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--zc-border)}
.zc-folder-row:first-child{border-top:0}
.zc-folder-row>svg{width:16px;height:16px;flex-shrink:0;color:var(--zc-fg-subtle)}
.zc-folder-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.zc-folder-name.break{white-space:normal;word-break:break-all}
.zc-primary-badge{display:inline-flex;height:28px;flex-shrink:0;align-items:center;border:1px solid var(--zc-border);border-radius:6px;padding:0 8px;font-size:14px;color:var(--zc-fg-subtle)}
.zc-folder-add{display:flex;min-height:48px;width:100%;align-items:center;gap:8px;border:0;border-top:1px solid var(--zc-border);background:transparent;padding:8px 12px;font:inherit;font-size:14px;color:var(--zc-fg);text-align:left;cursor:pointer}
.zc-folder-add:hover{background:var(--zc-surface-hover)}
.zc-folder-add svg{width:16px;height:16px;flex-shrink:0;color:var(--zc-fg-subtle)}
.zc-folder-remove svg{width:16px;height:16px}
.zc-folder-empty{display:flex;min-height:128px;width:100%;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px dashed var(--zc-border);border-radius:8px;background:transparent;padding:20px 16px;font:inherit;color:var(--zc-fg);text-align:center;cursor:pointer}
.zc-folder-empty:hover{border-color:var(--zc-border-hover)}
.zc-folder-empty:disabled{opacity:.6;cursor:default}
.zc-folder-empty-icon{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:999px;background:var(--zc-surface);color:var(--zc-fg-subtle)}
.zc-folder-empty-icon svg{width:16px;height:16px}
.zc-folder-empty-title{font-weight:500}
.zc-folder-empty-hint{font-size:12px;color:var(--zc-fg-subtle)}
.zc-create-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;border-top:0;padding-top:0}
.zc-create-foot .zc-btn{height:32px;padding:0 12px;border-radius:8px}
.zc-create-error{margin:0;font-size:12px;color:var(--zc-danger)}
/* ZCode's folder-trust confirmation (hyt) is a second dialog over the project
   dialog: title, device label, monospace path list, description, two actions. */
.zc-dialog.zc-trust{position:relative;top:auto;left:auto;transform:none;width:100%;max-width:28rem;gap:12px;padding:20px}
.zc-trust-title{margin:0;font-size:18px;font-weight:600;line-height:1.4;color:var(--zc-fg)}
.zc-trust-meta{display:grid;min-width:0;gap:8px}
.zc-trust-device{margin:0;font-size:14px;color:var(--zc-fg-subtle)}
.zc-trust-list{margin:0;max-height:12rem;overflow-y:auto;padding-left:20px;font-family:var(--zc-mono);font-size:12px;color:var(--zc-fg)}
.zc-trust-path{word-break:break-all}
.zc-trust-desc{margin:0;font-size:14px;color:var(--zc-fg-subtle)}
.zc-trust-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.zc-trust-foot .zc-btn{height:32px;padding:0 12px;border-radius:8px}
/* ── ZCode 3.17.2: folder modal ───────────────────────────────────────── */
/* ZCode's create-project dialog inlines the embedded folder browser (fI)
   inside a 24rem column (jI: flex h-96 min-h-0 flex-col gap-2). The bordered
   surface card is the browser itself; the listing is a borderless
   bg-background pane capped at 16rem. Keep both picking surfaces on that
   frame. */
.zc-folder-modal{display:flex;height:24rem;min-height:0;flex-direction:column;gap:0}
.zc-folder-modal .zc-browser{flex:1;height:auto;min-height:0}
.zc-folder-modal .zc-browser-list{flex:1;min-height:6rem;max-height:16rem}
.zc-folder-foot{display:flex;flex-shrink:0;justify-content:flex-end;gap:8px;margin-top:12px}
.zc-folder-foot .zc-btn{height:40px;padding:0 20px;border-radius:8px}
.zc-hidden-input{display:none}
@media (max-width:640px){.zc-folder-modal .zc-browser-actions{width:100%}.zc-folder-modal .zc-browser-actions .zc-btn{flex:1}}
.zc-spin{animation:zc-spin 1s linear infinite}
/* ── native remote workspace row (ZCode 3.17.2 virtual-project-row) ────── */
[data-dsh-ssh-row]{gap:8px!important}
[data-dsh-ssh-row] .dsh-ssh-cloud-slot,[data-dsh-ssh-row]:hover .dsh-ssh-cloud-slot{display:inline-flex!important;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#61666b)!important}
/* The native folder icon is React-managed: hide it instead of replacing it,
   otherwise the next commit's removeChild throws and the whole slot crashes. */
[data-dsh-ssh-row] .dsh-ssh-cloud-slot>svg:not([data-dsh-ssh-cloud]){display:none!important}
[data-dsh-ssh-row] .dsh-ssh-cloud-slot svg{width:16px;height:16px;flex:none}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="starting"]{color:var(--dsw-alias-state-business-primary,#4d6bfe)!important}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="error"]{color:var(--dsw-alias-state-error-primary,#dc2626)!important}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="offline"]{color:var(--dsw-alias-label-secondary,#61666b)!important}
.dsh-ssh-spin{animation:zc-spin 1s linear infinite}
[data-dsh-ssh-row] .dsh-ssh-chevron{display:none!important}
[data-dsh-ssh-row] .dsh-ssh-native-actions{display:none!important}
[data-dsh-ssh-row] .dsh-ssh-project-text{display:flex!important;flex-direction:row!important;align-items:baseline!important;gap:8px!important;min-width:0;overflow:hidden}
[data-dsh-ssh-row] .dsh-ssh-row-title{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;color:var(--dsw-alias-label-tertiary,#81858c)}
[data-dsh-ssh-row] .dsh-ssh-device{max-width:96px;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#61666b)}
[data-dsh-ssh-row] .dsh-ssh-status{flex:0 0 auto;font-size:12px;line-height:20px;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#81858c)}
[data-dsh-ssh-row] .dsh-ssh-row-actions{display:inline-flex;flex:none;align-items:center;gap:4px;opacity:0;pointer-events:none;transition:opacity .12s ease}
[data-dsh-ssh-row]:hover .dsh-ssh-row-actions,[data-dsh-ssh-row]:focus-within .dsh-ssh-row-actions{opacity:1;pointer-events:auto}
@media (hover:none){[data-dsh-ssh-row] .dsh-ssh-row-actions{opacity:1;pointer-events:auto}}
.dsh-ssh-row-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}
.dsh-ssh-row-btn:hover{color:var(--dsw-alias-label-primary,#0f1114);background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-ssh-row-btn svg{width:14px;height:14px}
.dsh-ssh-row-menu{position:fixed;z-index:1200;min-width:168px;padding:4px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 8px 24px rgba(0,0,0,.12);display:flex;flex-direction:column;gap:2px}
.dsh-ssh-menu-item{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#0f1114);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer}
.dsh-ssh-menu-item svg{width:14px;height:14px;flex:none}
.dsh-ssh-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-ssh-menu-item.danger{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-ssh-menu-sep{height:1px;margin:4px -4px;background:var(--dsw-alias-border-l1,#e5e7eb);flex:none}
.dsh-ssh-files{display:flex;flex-direction:column;height:100%;min-height:0;overflow:auto;padding:6px 6px 12px;font-size:13px;color:var(--dsw-alias-label-primary,#0f1114)}
.dsh-ssh-files-row{display:flex;align-items:center;gap:6px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;line-height:20px;text-align:left;white-space:nowrap;overflow:hidden;cursor:pointer}
.dsh-ssh-files-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-ssh-files-caret{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:none;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-ssh-files-caret svg{transition:transform .12s ease}
.dsh-ssh-files-row[aria-expanded="true"] .dsh-ssh-files-caret svg{transform:rotate(90deg)}
.dsh-ssh-files-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-ssh-files-name{overflow:hidden;text-overflow:ellipsis}
.dsh-ssh-files-note{margin:0;padding:8px;color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;line-height:18px}
.dsh-ssh-files-failed{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:4px 0}
.dsh-ssh-files-retry{align-self:flex-start;margin:0 8px 4px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#0f1114);font:inherit;font-size:12px;cursor:pointer}
.dsh-ssh-files-retry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dsh-ssh-file-preview{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}
.dsh-ssh-file-head{display:flex;align-items:center;gap:8px;flex:none;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden}
.dsh-ssh-file-path{overflow:hidden;text-overflow:ellipsis}
.dsh-ssh-file-note{flex:none;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-ssh-file-code{flex:1;min-height:0;margin:0;padding:10px 12px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:12px;line-height:1.55;white-space:pre;tab-size:2}
`
    function ensureCss() {
      let style = document.getElementById('dsh-ssh-remote-css')
      if (!style) {
        style = document.createElement('style')
        style.id = 'dsh-ssh-remote-css'
        document.head.appendChild(style)
      }
      // Always rewrite: plugin code can be hot-reloaded while the page keeps
      // the old <style> node, and a skipped update leaves stale rules behind.
      if (style.textContent !== CSS) style.textContent = CSS
    }

