// part: 30-styles -- injected CSS for the ssh-remote surfaces
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
/* connect dialog: 42rem card, 16px radius, 10vh top offset */
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

/* ── SSH remote dialog surfaces ──────────────────────────────────────────────────────
   Tokens define the light palette; body[data-ds-dark-theme] swaps in the dark
   palette so the dialog follows the host app theme. */
.rem-ui{--rem-font:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";--rem-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",monospace;--rem-bg:oklch(98.5% 0 0);--rem-dialog:oklch(100% 0 0);--rem-fg:oklch(37.1% 0 0);--rem-fg-subtle:#40404099;--rem-fg-subtlest:#40404066;--rem-muted:#595959;--rem-border:#0a0a0a1a;--rem-border-hover:#0a0a0a33;--rem-surface:#0a0a0a08;--rem-hover:oklch(92.2% 0 0);--rem-surface-hover:#0a0a0a0d;--rem-selected:#0a0a0a1a;--rem-input:#fff;--rem-input-focused:oklch(98.5% 0 0);--rem-input-border:#0a0a0a1a;--rem-input-border-hover:#0a0a0a33;--rem-input-border-focus:oklch(74.6% .16 232.661);--rem-primary:oklch(14.5% 0 0);--rem-primary-fg:oklch(98.5% 0 0);--rem-secondary:oklch(87% 0 0);--rem-menu:#fff;--rem-menu-hover:oklch(97% 0 0);--rem-success:oklch(62.7% .194 149.214);--rem-success-surface:oklch(98.2% .018 155.826);--rem-success-fg:oklch(52.7% .154 150.069);--rem-warning:oklch(68.1% .162 75.834);--rem-warning-surface:#cd89001f;--rem-warning-fg:oklch(47.6% .114 61.907);--rem-danger:oklch(57.7% .245 27.325);--rem-danger-surface:#e400141a;--rem-danger-fg:oklch(44.4% .177 26.899);--rem-progress:oklch(48.8% .243 264.376);--rem-progress-surface:oklch(97% .014 254.604);--rem-ssh-surface:oklch(97.7% .013 236.62);--rem-ssh-border:#bad9ff;--rem-ssh-fg:#0867ce;--rem-wsl-surface:#eaf7ee;--rem-wsl-border:#b7e0c2;--rem-wsl-fg:#166b32;--rem-docker-surface:#f2efff;--rem-docker-border:#d4caff;--rem-docker-fg:#6047b4;font-family:var(--rem-font);font-size:14px;line-height:1.625;color:var(--rem-fg)}
body[data-ds-dark-theme] .rem-ui{--rem-bg:oklch(20.5% 0 0);--rem-dialog:oklch(26.9% 0 0);--rem-fg:oklch(92.2% 0 0);--rem-fg-subtle:#e5e5e599;--rem-fg-subtlest:#e5e5e54d;--rem-muted:#b3b3b3;--rem-border:#fafafa1a;--rem-border-hover:#fafafa4d;--rem-surface:#ffffff0d;--rem-hover:#ffffff1a;--rem-surface-hover:#ffffff1a;--rem-selected:#ffffff1a;--rem-input:oklch(26.9% 0 0);--rem-input-focused:oklch(14.5% 0 0);--rem-input-border:#fafafa1a;--rem-input-border-hover:#fafafa4d;--rem-input-border-focus:oklch(74.6% .16 232.661);--rem-primary:oklch(98.5% 0 0);--rem-primary-fg:oklch(14.5% 0 0);--rem-secondary:oklch(37.1% 0 0);--rem-menu:oklch(14.5% 0 0);--rem-menu-hover:oklch(20.5% 0 0);--rem-success:oklch(72.3% .219 149.579);--rem-success-surface:#032e1573;--rem-success-fg:oklch(87.1% .15 154.449);--rem-warning:oklch(79.5% .184 86.047);--rem-warning-surface:#cd890029;--rem-warning-fg:oklch(85.2% .199 91.936);--rem-danger:oklch(63.7% .237 25.331);--rem-danger-surface:#e4001429;--rem-danger-fg:oklch(80.8% .114 19.571);--rem-progress:oklch(80.9% .105 251.813);--rem-progress-surface:#4682f029;--rem-ssh-surface:#00a5ef2e;--rem-ssh-border:#4099ff6b;--rem-ssh-fg:#8fc0ff;--rem-wsl-surface:#00c7582e;--rem-wsl-border:#46bf726b;--rem-wsl-fg:#87d9a4;--rem-docker-surface:#9f84ff29;--rem-docker-border:#9f84ff6b;--rem-docker-fg:#bfaaff}
.rem-ui *,.rem-ui *::before,.rem-ui *::after{box-sizing:border-box}
.rem-overlay{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.rem-dialog{position:fixed;top:10vh;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;width:calc(100vw - 2rem);max-width:42rem;max-height:calc(90dvh - 1rem);overflow:hidden;border-radius:16px;border:1px solid var(--rem-border);background:var(--rem-dialog);color:var(--rem-fg);box-shadow:0 4px 6px -1px #0000001a,0 2px 4px -2px #0000001a;outline:none;font-family:var(--rem-font);font-size:14px;line-height:1.625}
.rem-body{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;gap:12px;overflow:hidden;padding:16px}
@media (min-width:40rem){.rem-body{gap:16px;padding:24px}}
.rem-head{display:flex;flex-direction:column;gap:16px}
.rem-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.rem-head-titles{display:flex;min-width:0;flex-direction:column;gap:4px}
.rem-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.rem-title{margin:0;font-size:16px;font-weight:500;line-height:1.625;color:var(--rem-fg)}
.rem-desc{margin:0;font-size:14px;line-height:1.625;color:var(--rem-fg-subtle);text-wrap:pretty}
.rem-preview{margin:0;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);word-break:break-all}
.rem-head-actions{display:flex;flex-shrink:0;align-items:center;gap:4px}
.rem-wizard-nav{display:flex;align-items:center;gap:8px;font-size:12px}
.rem-wizard{display:flex;align-items:center;gap:8px;list-style:none;margin:0;padding:0}
.rem-wizard li{display:flex;min-width:0;align-items:center;gap:8px;color:var(--rem-muted)}
.rem-wizard li[data-current]{font-weight:500;color:var(--rem-fg)}
.rem-wizard-sep{width:20px;height:1px;background:var(--rem-border)}
.rem-wizard-dot{display:flex;width:16px;height:16px;flex-shrink:0;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--rem-border);font-size:10px;line-height:1}
.rem-wizard li[data-current] .rem-wizard-dot{border-color:var(--rem-primary);background:var(--rem-primary);color:var(--rem-primary-fg)}
.rem-wizard-dot svg{width:10px;height:10px}
.rem-btn{display:inline-flex;height:28px;flex-shrink:0;align-items:center;justify-content:center;gap:4px;white-space:nowrap;border-radius:6px;border:1px solid transparent;background-clip:padding-box;padding:0 8px;font-family:inherit;font-size:14px;line-height:1.625;color:var(--rem-fg);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;outline:none;user-select:none}
.rem-btn:disabled{pointer-events:none;opacity:.5}
.rem-btn svg{pointer-events:none;flex-shrink:0;width:14px;height:14px}
.rem-btn-default{background:var(--rem-primary);color:var(--rem-primary-fg)}
.rem-btn-default:hover{background:color-mix(in oklab,var(--rem-primary) 80%,transparent)}
.rem-btn-outline{border-color:var(--rem-border);background:transparent;color:var(--rem-fg)}
.rem-btn-outline:hover{border-color:var(--rem-border-hover);background:color-mix(in oklab,var(--rem-input) 50%,transparent)}
.rem-btn-secondary{background:var(--rem-secondary);color:var(--rem-fg)}
.rem-btn-secondary:hover{background:color-mix(in oklab,var(--rem-secondary) 80%,transparent)}
.rem-btn-ghost{background:transparent;color:var(--rem-fg)}
.rem-btn-ghost:hover{background:var(--rem-hover);color:var(--rem-fg)}
.rem-btn-lg{height:32px;border-radius:8px;padding:0 10px}
.rem-btn-sm{height:24px}
.rem-btn-icon{width:24px;height:24px;padding:0}
.rem-btn-icon svg{width:12px;height:12px}
.rem-btn-icon-lg{width:32px;height:32px;padding:0;border-radius:8px}
.rem-btn.h9{height:36px;padding:0 16px}
.rem-btn.muted{color:var(--rem-muted)}
.rem-btn.muted:hover{color:var(--rem-fg)}
.rem-btn.big{height:40px;min-width:0;padding:0 20px}
.rem-input{width:100%;height:36px;min-width:0;border:1px solid var(--rem-input-border);border-radius:8px;background:var(--rem-input);padding:0 12px;font-family:var(--rem-font);font-size:14px;line-height:1.625;color:var(--rem-fg);outline:none;transition:border-color .15s,background-color .15s;-webkit-appearance:none;appearance:none}
.rem-input::placeholder{color:var(--rem-fg-subtlest)}
.rem-input:hover{border-color:var(--rem-input-border-hover)}
.rem-input:focus{border-color:var(--rem-input-border-focus);background:var(--rem-input-focused)}
.rem-input.mono{font-family:var(--rem-mono)}
.rem-input.mono::placeholder{font-family:var(--rem-font)}
.rem-input.invalid{border-color:var(--rem-danger)}
.rem-input.as-button{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;text-align:left;overflow:hidden}
.rem-input.as-button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-input.as-button svg{width:14px;height:14px;flex-shrink:0;color:var(--rem-muted)}
.rem-input.as-button:disabled{cursor:not-allowed;opacity:.5}
.rem-alias-btn{max-width:20rem}
.rem-input.h7{height:28px}
.rem-input.h8{height:32px}
.rem-seg{display:flex;width:fit-content;max-width:100%;overflow:hidden;border-radius:8px;border:1px solid var(--rem-input-border)}
.rem-seg button{display:inline-flex;min-height:32px;min-width:0;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:0;background:transparent;color:var(--rem-muted);font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;transition:color .15s,background-color .15s}
.rem-seg button+button{border-left:1px solid var(--rem-input-border)}
.rem-seg button[aria-pressed=true]{font-weight:500;background:var(--rem-selected);color:var(--rem-fg)}
.rem-seg button:not([aria-pressed=true]):not(:disabled):hover{color:var(--rem-fg)}
.rem-seg button:disabled{cursor:not-allowed;opacity:.5}
.rem-step-device{display:flex;min-height:0;flex:1;flex-direction:column;gap:16px}
.rem-search-wrap{position:relative}
.rem-search-icon{position:absolute;left:12px;top:50%;width:16px;height:16px;transform:translateY(-50%);color:var(--rem-muted);pointer-events:none}
.rem-search-icon svg{width:16px;height:16px}
.rem-search-input{height:36px;padding-left:36px}
.rem-scroll{min-height:0;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.rem-section-title{margin:0 0 8px;font-size:12px;color:var(--rem-muted);text-wrap:pretty}
.rem-section-mono{margin-left:8px;font-family:var(--rem-mono);font-size:10px;color:var(--rem-muted)}
.rem-device-item{margin-bottom:8px}
.rem-device{display:flex;width:100%;align-items:center;gap:12px;border-radius:8px;padding:8px;text-align:left;background:transparent;border:0;color:var(--rem-fg);font:inherit;cursor:pointer}
.rem-device:hover,.rem-device:focus-visible{background:var(--rem-hover);outline:none}
.rem-device:disabled{opacity:.5;pointer-events:none}
.rem-device-icon{display:flex;width:32px;height:32px;flex-shrink:0;align-items:center;justify-content:center;border-radius:6px;background:var(--rem-surface);color:var(--rem-muted)}
.rem-device-icon-ssh{background:var(--rem-ssh-surface);color:var(--rem-ssh-fg)}
.rem-device-icon-wsl{background:var(--rem-wsl-surface);color:var(--rem-wsl-fg)}
.rem-device-icon-docker{background:var(--rem-docker-surface);color:var(--rem-docker-fg)}
.rem-device-icon svg{width:16px;height:16px}
.rem-device-main{min-width:0;flex:1}
.rem-device-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}
.rem-device-desc{display:block;word-break:break-all;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted)}
.rem-chips{margin-left:52px;display:flex;flex-wrap:wrap;gap:4px}
.rem-chip{display:flex;max-width:100%;align-items:center;gap:4px;border-radius:6px;border:1px solid var(--rem-border);background:var(--rem-surface);padding:2px 8px;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);cursor:pointer;line-height:1.625}
.rem-chip:hover{background:var(--rem-hover)}
.rem-chip svg{width:12px;height:12px;flex-shrink:0}
.rem-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-new-row{display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--rem-border);padding-top:12px}
.rem-kbd-hint{margin:0;border-top:1px solid var(--rem-border);padding-top:12px;font-size:10px;color:var(--rem-muted);text-wrap:pretty}
.rem-badge{display:inline-flex;height:24px;width:fit-content;flex-shrink:0;align-items:center;gap:6px;white-space:nowrap;border-radius:6px;border:1px solid var(--rem-border);padding:0 8px;font-size:10px;font-weight:600;line-height:1.625}
.rem-badge svg{width:12px;height:12px}
.rem-badge-dot{width:6px;height:6px;border-radius:50%;flex:none}
.rem-badge-neutral{color:var(--rem-muted);background:var(--rem-surface);border-color:var(--rem-border)}
.rem-badge-neutral .rem-badge-dot{border:1px solid var(--rem-fg-subtlest)}
.rem-badge-success{color:var(--rem-success-fg);background:var(--rem-success-surface);border-color:var(--rem-success)}
.rem-badge-success .rem-badge-dot{background:var(--rem-success)}
.rem-badge-progress{color:var(--rem-progress);background:var(--rem-progress-surface);border-color:var(--rem-progress)}
.rem-badge-progress .rem-badge-dot{background:var(--rem-progress);animation:rem-pulse 2s cubic-bezier(.4,0,.6,1) infinite}
.rem-badge-warning{color:var(--rem-warning-fg);background:var(--rem-warning-surface);border-color:var(--rem-warning)}
.rem-badge-warning .rem-badge-dot{background:var(--rem-warning)}
.rem-badge-danger{color:var(--rem-danger-fg);background:var(--rem-danger-surface);border-color:var(--rem-danger)}
.rem-badge-danger .rem-badge-dot{background:var(--rem-danger)}
.rem-badge-ssh{color:var(--rem-ssh-fg);background:var(--rem-ssh-surface);border-color:var(--rem-ssh-border)}
.rem-badge-wsl{color:var(--rem-wsl-fg);background:var(--rem-wsl-surface);border-color:var(--rem-wsl-border)}
.rem-badge-docker{color:var(--rem-docker-fg);background:var(--rem-docker-surface);border-color:var(--rem-docker-border)}
.rem-form{display:flex;min-height:0;flex:1;flex-direction:column}
.rem-form-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:16px;padding-right:4px}
.rem-type-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.rem-fields{display:flex;flex-direction:column;gap:16px}
.rem-field{display:block;min-width:0}
.rem-label{display:block;margin-bottom:6px;font-size:12px;color:var(--rem-muted)}
.rem-grid-host{display:grid;grid-template-columns:minmax(0,1fr) 6rem;gap:12px}
.rem-grid-2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.rem-auth-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.rem-auth-label{font-size:12px;color:var(--rem-muted)}
.rem-field-err{margin:6px 0 0;display:flex;align-items:flex-start;gap:4px;font-size:12px;color:var(--rem-danger)}
.rem-field-err svg{width:14px;height:14px;margin-top:2px;flex-shrink:0}
.rem-hint{margin:6px 0 0;font-size:12px;display:flex;align-items:flex-start;gap:6px;color:var(--rem-muted);text-wrap:pretty}
.rem-hint-warning{color:var(--rem-warning-fg)}
.rem-hint-success{color:var(--rem-success-fg)}
.rem-truncate.muted{color:var(--rem-muted)}
.rem-adv-toggle{display:inline-flex;height:24px;align-items:center;gap:4px;margin-left:-4px;padding:0 4px;border:0;border-radius:6px;background:transparent;color:var(--rem-muted);font:inherit;font-size:14px;cursor:pointer}
.rem-adv-toggle:hover{background:var(--rem-hover);color:var(--rem-fg)}
.rem-adv-toggle svg{width:14px;height:14px;transition:transform .15s}
.rem-adv-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
.rem-adv-panel{display:flex;flex-direction:column;gap:12px;padding-top:8px}
.rem-pwd{position:relative}
.rem-pwd .rem-input{padding-right:40px}
.rem-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--rem-fg);cursor:pointer}
.rem-eye:hover{background:var(--rem-hover)}
.rem-eye svg{width:16px;height:16px}
.rem-form-foot{margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--rem-border);padding-top:16px}
.rem-form-foot.end{justify-content:flex-end}
.rem-spacer{flex:1}
.rem-import-wrap{position:relative}
.rem-docker-picker{position:relative}
.rem-input.as-button.docker-trigger{width:100%;height:36px;font-weight:400}
.rem-docker-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:6;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--rem-border);background:var(--rem-menu);padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.rem-docker-search{height:32px;width:calc(100% - 8px);margin:2px 4px}
.rem-docker-list{display:flex;max-height:14rem;flex-direction:column;gap:1px;overflow:auto;scroll-padding-block:4px}
.rem-docker-empty{display:flex;min-height:32px;align-items:center;gap:8px;padding:16px 12px;border-radius:8px;font-size:14px;color:var(--rem-muted)}
.rem-docker-item{display:flex;min-height:32px;align-items:center;gap:8px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--rem-fg);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.rem-docker-item:hover,.rem-docker-item[data-selected=true]{background:var(--rem-menu-hover)}
.rem-docker-item-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-docker-item svg{flex-shrink:0;color:var(--rem-muted)}
.rem-import-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;display:flex;max-height:15rem;width:20rem;max-width:calc(100vw - 2rem);flex-direction:column;gap:2px;overflow:auto;border-radius:12px;border:1px solid var(--rem-border);background:var(--rem-menu);padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.rem-import-item{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--rem-fg);font:inherit;text-align:left;cursor:pointer}
.rem-import-item:hover{background:var(--rem-menu-hover)}
.rem-import-item span{font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted)}
.rem-connect{display:flex;min-height:0;flex:1;flex-direction:column;gap:24px}
.rem-connect-scroll{display:flex;min-height:0;flex:1;flex-direction:column;gap:16px;overflow-y:auto}
.rem-conn-head{display:flex;flex-shrink:0;flex-direction:column;gap:4px}
.rem-conn-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.rem-conn-title{margin:0;font-size:14px;font-weight:600}
.rem-conn-target{margin:0;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);word-break:break-all}
.rem-phases{list-style:none;margin:0;padding:4px 0;display:flex;flex-shrink:0;flex-direction:column;gap:2px}
.rem-phase{position:relative;display:flex;min-width:0;flex-shrink:0;align-items:flex-start;gap:12px;border-radius:6px;padding:8px 10px;font-size:12px}
.rem-phase[data-status=active]{background:var(--rem-surface)}
.rem-phase-line{position:absolute;left:20px;top:32px;bottom:0;border-left:1px solid var(--rem-border)}
.rem-phase-dot{position:relative;z-index:1;margin-top:2px;display:flex;width:20px;height:20px;flex-shrink:0;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--rem-border);color:var(--rem-muted)}
.rem-phase-dot svg{width:12px;height:12px}
.rem-phase[data-status=complete] .rem-phase-dot{border-color:var(--rem-success);background:var(--rem-success-surface);color:var(--rem-success-fg)}
.rem-phase[data-status=active] .rem-phase-dot{border-color:var(--rem-progress);color:var(--rem-progress)}
.rem-phase[data-status=failed] .rem-phase-dot{border-color:var(--rem-danger);color:var(--rem-danger)}
.rem-dotmark{width:6px;height:6px;border-radius:50%;background:currentColor}
.rem-phase-main{min-width:0;flex:1}
.rem-phase-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rem-phase-title{color:var(--rem-fg)}
.rem-phase[data-status=pending] .rem-phase-title{color:var(--rem-muted)}
.rem-phase[data-status=active] .rem-phase-title{font-weight:600}
.rem-phase-time{font-size:10px;color:var(--rem-muted);font-variant-numeric:tabular-nums}
.rem-phase-sub{margin:2px 0 0;font-size:10px;color:var(--rem-muted);word-break:break-word}
.rem-log{display:flex;flex-direction:column}
.rem-log-toggle{display:inline-flex;height:24px;align-self:flex-start;align-items:center;gap:4px;border:0;background:transparent;padding:0;color:var(--rem-fg);font:inherit;font-size:14px;cursor:pointer}
.rem-log-toggle svg{width:14px;height:14px;transition:transform .15s}
.rem-log-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
.rem-log-count{color:var(--rem-muted)}
.rem-log-box{margin-top:4px;display:flex;max-height:12rem;flex-direction:column;gap:4px;overflow-y:auto;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-bg);padding:8px 12px;font-family:var(--rem-mono);font-size:10px;line-height:24px}
.rem-log-line{display:flex;min-width:0;width:100%;color:var(--rem-fg)}
.rem-log-time{color:var(--rem-muted)}
.rem-log-level{margin:0 8px}
.rem-log-empty{display:flex;align-items:center;justify-content:center;padding:8px 0;color:var(--rem-muted)}
.rem-connect-foot{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--rem-border);padding-top:12px}
.rem-status-block{display:flex;flex-direction:column;gap:8px;border-radius:4px;border:1px solid var(--rem-danger);background:var(--rem-danger-surface);padding:12px 14px;color:var(--rem-danger-fg)}
.rem-status-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.rem-status-title svg{width:16px;height:16px;flex-shrink:0}
.rem-status-reason{margin:0;font-size:10px;color:var(--rem-muted)}
.rem-status-hint{display:flex;align-items:flex-start;gap:6px;margin:0;font-size:11px;line-height:1.45;color:var(--rem-fg)}
.rem-status-hint svg{width:14px;height:14px;flex-shrink:0;margin-top:1px;opacity:.7}
.rem-error-details{font-size:10px;color:var(--rem-muted)}
.rem-error-details summary{cursor:pointer;font-size:10px}
.rem-error-details pre{margin:6px 0;max-height:8rem;overflow:auto;font-size:10px;white-space:pre-wrap;word-break:break-word}
.rem-status-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:2px}
.rem-install-card{margin-top:8px;display:flex;flex-direction:column;gap:8px;border-radius:4px;border:1px solid var(--rem-border);background:var(--rem-bg);padding:12px 14px;font-size:12px}
.rem-install-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.rem-install-title svg{width:16px;height:16px;flex-shrink:0}
.rem-install-note{margin:0;color:var(--rem-muted);font-size:11px;line-height:1.5}
.rem-install-grid{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:16px;row-gap:4px;margin:0;font-size:10px}
.rem-install-grid dt{color:var(--rem-muted)}
.rem-install-grid dd{margin:0;font-family:var(--rem-mono);word-break:break-word}
.rem-install-grid dd.break{word-break:break-all}
.rem-install-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:2px}
.rem-progress{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.rem-progress-text{font-size:10px;color:var(--rem-muted);font-variant-numeric:tabular-nums}
.rem-progress-bar{height:4px;max-width:24rem;overflow:hidden;border-radius:999px;background:var(--rem-surface)}
.rem-progress-fill{height:100%;border-radius:999px;background:var(--rem-progress)}
.rem-log-copy{align-self:flex-end;border:0;background:transparent;color:var(--rem-fg);font:inherit;font-size:10px;cursor:pointer;padding:2px 4px}
.rem-log-copy:hover{text-decoration:underline}
.rem-view-toast{position:fixed;right:16px;bottom:16px;z-index:60;display:flex;width:min(340px,calc(100vw - 32px));flex-direction:column;gap:8px;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-surface);padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:12px}
.rem-view-toast-head{display:flex;align-items:center;gap:8px}
.rem-view-toast-head svg{flex-shrink:0;opacity:.85}
.rem-view-toast.is-done .rem-view-toast-head svg{color:var(--rem-success-fg)}
.rem-view-toast.is-failed .rem-view-toast-head svg{color:var(--rem-danger-fg)}
.rem-view-toast-title{flex:1;min-width:0;font-weight:500}
.rem-view-toast-close{margin-left:auto;border:0;background:transparent;color:var(--rem-muted);cursor:pointer;padding:2px;display:flex;align-items:center;border-radius:4px}
.rem-view-toast-close:hover{color:var(--rem-fg);background:var(--rem-hover)}
.rem-view-toast-body{display:flex;flex-direction:column;gap:4px}
.rem-view-toast-text{margin:0;line-height:1.5;color:var(--rem-fg)}
.rem-view-toast-detail{margin:0;font-size:11px;line-height:1.45;color:var(--rem-muted);word-break:break-all}
.rem-view-toast-actions{display:flex;flex-wrap:wrap;gap:8px}
.rem-view-toast-actions:empty{display:none}
.rem-dir{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px}
.rem-dir-scroll{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;overflow-y:auto}
.rem-connected{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-radius:6px;background:var(--rem-success-surface);padding:8px 12px;font-size:12px;color:var(--rem-success-fg)}
.rem-connected-left{display:flex;min-width:0;align-items:center;gap:8px}
.rem-connected-left svg{width:16px;height:16px;flex-shrink:0}
.rem-rename{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.rem-rename-label{font-size:12px;color:var(--rem-muted)}
.rem-rename .rem-input{height:28px;max-width:16rem;font-family:var(--rem-mono);font-size:12px}
.rem-rename-hint{font-size:10px;color:var(--rem-muted)}
.rem-recent{display:flex;min-width:0;flex-direction:column;gap:6px}
.rem-recent-label{display:block;font-size:10px;color:var(--rem-muted)}
.rem-recent-chips{display:flex;min-width:0;flex-wrap:wrap;gap:8px}
.rem-recent-chip{display:inline-flex;max-width:100%;height:auto;align-items:center;gap:4px;border-radius:6px;border:1px solid var(--rem-border);background:transparent;padding:4px 8px;font-family:var(--rem-mono);font-size:12px;line-height:1.625;color:var(--rem-fg);text-align:left;cursor:pointer;transition:background-color .15s,border-color .15s}
.rem-recent-chip:hover{border-color:var(--rem-border-hover);background:color-mix(in oklab,var(--rem-input) 50%,transparent)}
.rem-recent-chip[data-selected=true]{background:var(--rem-secondary);border-color:transparent}
.rem-recent-chip svg{width:14px;height:14px;flex-shrink:0;color:var(--rem-muted)}
.rem-recent-chip span{word-break:break-all;white-space:normal;text-align:left}
.rem-browser-wrap{display:flex;min-height:12rem;flex-shrink:0;overflow:hidden}
.rem-willopen{margin:0;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);word-break:break-all}
.rem-dir-foot{display:flex;align-items:center;justify-content:flex-end;gap:12px;border-top:1px solid var(--rem-border);padding-top:12px}
.rem-dir-foot .rem-later{margin-right:auto}
.rem-browser{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;border-radius:6px;border:1px solid var(--rem-border);background:var(--rem-surface);padding:12px}
.rem-browser-form{display:flex;flex-direction:column;gap:8px}
@media (min-width:40rem){.rem-browser-form{flex-direction:row}}
.rem-browser-form .rem-input{height:36px;flex:1;min-width:0}
.rem-browser-actions{display:flex;gap:8px}
.rem-browser-actions .rem-btn{height:36px;min-width:0;padding:0 12px}
.rem-browser-list{display:flex;min-height:6rem;max-height:16rem;flex:1;flex-direction:column;overflow-y:auto;border-radius:6px;background:var(--rem-bg)}
.rem-browser-row{display:flex;width:100%;flex-shrink:0;cursor:pointer;align-items:center;gap:8px;padding:8px 12px;border:0;background:transparent;color:var(--rem-fg);font:inherit;font-size:14px;text-align:left;transition:background-color .15s}
.rem-browser-row:hover{background:color-mix(in oklab,var(--rem-hover) 50%,transparent)}
.rem-browser-row svg{width:16px;height:16px;flex-shrink:0;color:var(--rem-fg-subtle)}
.rem-browser-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-browser-up{height:40px;padding:0 12px}
.rem-browser-empty{padding:16px;text-align:center;font-size:14px;color:var(--rem-fg-subtle)}
.rem-browser-error{font-size:14px;color:var(--rem-danger)}
.rem-error{display:flex;align-items:flex-start;gap:12px;border-radius:6px;background:var(--rem-danger-surface);padding:12px;font-size:12px;color:var(--rem-danger-fg)}
.rem-error svg{width:16px;height:16px;margin-top:2px;flex-shrink:0}
.rem-pill{position:fixed;left:16px;bottom:64px;z-index:55;display:flex;width:272px;flex-direction:column;gap:4px;font-family:var(--rem-font);font-size:14px;line-height:1.625;color:var(--rem-fg)}
.rem-pill-card{display:flex;width:100%;flex-direction:column;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-surface);padding:8px;text-align:left;color:var(--rem-fg);font:inherit;cursor:pointer}
.rem-pill-card.progress{background:var(--rem-progress-surface);color:var(--rem-progress)}
.rem-pill-card.danger{background:var(--rem-danger-surface);color:var(--rem-danger-fg)}
.rem-pill-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:500}
.rem-pill-title .rem-truncate{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-pill-title svg{width:14px;height:14px;flex-shrink:0}
.rem-pill-sub{display:block;margin-top:4px;font-size:10px;word-break:break-word}
.rem-pill-bar{display:block;margin-top:8px;height:4px;overflow:hidden;border-radius:999px;background:var(--rem-border)}
.rem-pill-bar span{display:block;height:100%;background:var(--rem-progress)}
.rem-pill-action{display:block;margin-top:4px;font-size:14px;text-decoration:underline}
.rem-pill-cancel{align-self:flex-start;border:0;background:transparent;padding:0;color:var(--rem-fg-subtle);font:inherit;font-size:14px;text-decoration:underline;cursor:pointer}
.rem-pill-cancel:hover{color:var(--rem-fg)}
.rem-scroll::-webkit-scrollbar,.rem-form-scroll::-webkit-scrollbar,.rem-connect-scroll::-webkit-scrollbar,.rem-dir-scroll::-webkit-scrollbar,.rem-browser-list::-webkit-scrollbar,.rem-log-box::-webkit-scrollbar{width:8px;height:8px}
.rem-scroll::-webkit-scrollbar-track,.rem-form-scroll::-webkit-scrollbar-track,.rem-connect-scroll::-webkit-scrollbar-track,.rem-dir-scroll::-webkit-scrollbar-track,.rem-browser-list::-webkit-scrollbar-track,.rem-log-box::-webkit-scrollbar-track{background:transparent}
.rem-scroll::-webkit-scrollbar-thumb,.rem-form-scroll::-webkit-scrollbar-thumb,.rem-connect-scroll::-webkit-scrollbar-thumb,.rem-dir-scroll::-webkit-scrollbar-thumb,.rem-browser-list::-webkit-scrollbar-thumb,.rem-log-box::-webkit-scrollbar-thumb{background:var(--rem-border);border-radius:999px}
.rem-scroll::-webkit-scrollbar-thumb:hover,.rem-form-scroll::-webkit-scrollbar-thumb:hover,.rem-connect-scroll::-webkit-scrollbar-thumb:hover,.rem-dir-scroll::-webkit-scrollbar-thumb:hover,.rem-browser-list::-webkit-scrollbar-thumb:hover,.rem-log-box::-webkit-scrollbar-thumb:hover{background:var(--rem-border-hover)}
.rem-scroll::-webkit-scrollbar-button,.rem-form-scroll::-webkit-scrollbar-button,.rem-connect-scroll::-webkit-scrollbar-button,.rem-dir-scroll::-webkit-scrollbar-button,.rem-browser-list::-webkit-scrollbar-button,.rem-log-box::-webkit-scrollbar-button{display:none}

.rem-panel{padding:16px 12px 40px;color:var(--rem-fg)}
.rem-panel-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;margin-bottom:16px}
.rem-panel-title{margin:0 0 4px;font-size:16px;line-height:1.4;font-weight:500}
.rem-panel-sub{margin:0;max-width:760px;font-size:12px;line-height:1.5;color:var(--rem-muted)}
.rem-panel-actions{margin-left:auto;display:flex;flex:none;gap:8px}
.rem-card{border:1px solid var(--rem-border);background:var(--rem-dialog);border-radius:12px;padding:16px;margin-bottom:12px}
.rem-card-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.rem-card-title{font-size:14px;font-weight:600}
.rem-card-device{font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted)}
.rem-card-path{margin-top:4px;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);word-break:break-all}
.rem-card-meta{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;font-size:12px;color:var(--rem-muted)}
.rem-card-meta b{color:var(--rem-fg);font-weight:500;font-variant-numeric:tabular-nums}
.rem-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
/* device page: bordered list, 48px single-line rows, 32px icon tile,
   project count / last-online meta, badge always visible, chevron 90°. */
.rem-device-list{display:flex;flex-direction:column;border:1px solid var(--rem-border);border-radius:12px;background:var(--rem-dialog);overflow:hidden}
.rem-device-head{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:14px;font-weight:500;line-height:1.625;color:var(--rem-fg)}
.rem-device-count{display:inline-flex;min-width:18px;align-items:center;justify-content:center;border-radius:999px;background:var(--rem-surface);padding:0 6px;font-size:11px;font-weight:400;color:var(--rem-muted)}
.rem-device-head .rem-panel-actions{margin-left:auto}
.rem-device-card{border-top:1px solid var(--rem-border)}
.rem-device-card:first-child{border-top:0}
.rem-device-row2{position:relative;display:flex;min-height:48px;cursor:pointer;align-items:center;gap:10px;padding:8px 8px 8px 16px}
.rem-device-row2:hover{background:var(--rem-hover)}
.rem-device-toggle{display:flex;min-width:0;flex:1;align-items:center;gap:10px;border:0;border-radius:6px;background:transparent;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}
.rem-device-toggle:focus-visible{outline:2px solid var(--rem-input-border-focus);outline-offset:2px}
.rem-device-icon{display:flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;border-radius:6px;background:var(--rem-surface);color:var(--rem-muted)}
.rem-device-identity{display:flex;min-width:0;flex:1;flex-direction:column}
.rem-device-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:1.625;color:var(--rem-fg)}
.rem-device-address{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--rem-mono);font-size:12px;line-height:1.5;color:var(--rem-muted)}
.rem-device-main{display:flex;min-width:0;flex:1;flex-direction:column}
.rem-device-desc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--rem-mono);font-size:12px;line-height:1.5;color:var(--rem-muted)}
.rem-device-row-meta{display:none;flex:none;align-items:center;gap:4px;font-size:12px;color:var(--rem-muted)}
@media (min-width:576px){.rem-device-row-meta{display:inline-flex}}
.rem-device-row-actions{display:flex;flex:none;align-items:center;gap:4px}
.rem-device-chevron{flex:none;color:var(--rem-muted);transition:transform .12s ease}
.rem-device-chevron.open{transform:rotate(90deg)}
.rem-device-more{width:24px;height:24px;border-radius:6px}
.rem-device-details{display:flex;flex-direction:column;gap:12px;padding:16px}
.rem-device-connection{display:flex;min-width:0;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--rem-muted)}
.rem-device-tag{border-radius:6px;background:var(--rem-surface);padding:1px 6px;font-size:11px;color:var(--rem-muted)}
.rem-device-version{flex:none;white-space:nowrap;font-size:12px;color:var(--rem-muted)}
.rem-device-link{border:0;background:transparent;padding:0;color:var(--rem-muted);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.rem-device-link:hover{color:var(--rem-fg)}
.rem-device-link:disabled{opacity:.5;cursor:not-allowed}
.rem-device-projects{display:flex;min-width:0;flex-direction:column;gap:2px}
.rem-device-projects-head{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px}
.rem-device-projects-head p{margin:0;font-size:12px;font-weight:500;color:var(--rem-muted)}
.rem-device-project-empty{margin:0;font-size:12px;color:var(--rem-muted)}
.rem-device-project{display:flex;width:calc(100% + 16px);min-width:0;margin:0 -8px;align-items:center;gap:8px;border-radius:6px;padding:6px 8px;color:var(--rem-fg);font:inherit;text-align:left}
.rem-device-project:hover{background:var(--rem-hover)}
.rem-device-project-main{display:flex;min-width:0;flex:1;align-items:center;gap:8px;border:0;border-radius:4px;background:transparent;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.rem-device-project-main:focus-visible{outline:2px solid var(--rem-input-border-focus);outline-offset:2px}
.rem-device-project-actions{display:flex;flex:none;align-items:center;gap:2px;opacity:0;transition:opacity .12s ease}
.rem-device-project:hover .rem-device-project-actions,.rem-device-project:focus-within .rem-device-project-actions{opacity:1}
.rem-device-project-action{display:flex;height:24px;width:24px;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;color:var(--rem-muted);cursor:pointer;padding:0}
.rem-device-project-action:hover{background:var(--rem-surface-hover);color:var(--rem-fg)}
.rem-device-project>svg:first-child{flex:none;color:var(--rem-muted)}
.rem-device-project-name{max-width:12rem;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}
.rem-device-project-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted);text-align:left}
.rem-device-project-time{flex:none;font-size:12px;color:var(--rem-muted)}
.rem-device-project-arrow{flex:none;color:var(--rem-muted);opacity:0}
.rem-device-project:hover .rem-device-project-arrow,.rem-device-project:focus-visible .rem-device-project-arrow{opacity:1}
.rem-device-log-toggle{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;height:24px;padding:0;border:0;background:transparent;color:var(--rem-muted);font:inherit;font-size:12px;cursor:pointer}
.rem-device-log-toggle:hover{color:var(--rem-fg)}
.rem-device-log-count{display:inline-flex;min-width:16px;justify-content:center;border-radius:999px;background:var(--rem-surface);padding:0 5px;font-size:10px}
.rem-device-log{display:flex;max-height:9rem;flex-direction:column;gap:4px;overflow-y:auto;border-radius:8px;background:var(--rem-surface);padding:8px 12px;font-family:var(--rem-mono);font-size:12px;line-height:20px;color:var(--rem-muted)}
.rem-device-log-row{display:flex;min-width:0;gap:8px}
.rem-device-log-row.warn{color:var(--rem-warning-fg,var(--rem-muted))}
.rem-device-log-row.error{color:var(--rem-danger)}
.rem-device-log-time{flex:none;color:var(--rem-fg-subtlest)}
.rem-device-log-msg{min-width:0;word-break:break-word}
.rem-device-log-empty{margin:0}
.rem-device-menu{max-height:32rem}
.rem-import-menu.rem-device-menu,.rem-floating-menu.rem-import-menu.rem-device-menu{max-height:min(32rem,calc(100vh - 2rem))}
.rem-menu-sep{height:1px;margin:4px 0;background:var(--rem-border)}
.rem-device-info{display:flex;max-width:20rem;flex-direction:column;gap:2px;padding:6px 8px;font-size:12px;color:var(--rem-muted)}
.rem-device-info-row{margin:0;word-break:break-all;white-space:normal}
.rem-device-info-missing{color:var(--rem-fg-subtlest)}
.rem-device-prefs-section{margin-top:16px;border-top:1px solid var(--rem-border);padding-top:16px}
.rem-device-prefs-title{margin:0;font-size:14px;font-weight:500}
.rem-device-prefs{display:flex;flex-direction:column;gap:16px;margin-top:12px}
.rem-device-pref{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.rem-device-pref-copy p{margin:0}
.rem-device-pref-title{font-size:14px}
.rem-device-pref-desc{font-size:12px;color:var(--rem-muted)}
.rem-switch{position:relative;display:inline-flex;width:32px;height:18px;flex:none;align-items:center;border:0;border-radius:999px;background:var(--rem-input-border);padding:2px;cursor:pointer;transition:background .15s ease}
.rem-switch[aria-checked=true]{background:var(--rem-primary)}
.rem-switch span{display:block;width:14px;height:14px;border-radius:50%;background:#fff;transform:translateX(0);transition:transform .15s ease}
.rem-switch[aria-checked=true] span{transform:translateX(14px)}
.rem-switch:disabled{opacity:.5;cursor:not-allowed}
.rem-search{position:relative;display:flex;align-items:center;margin:0 0 8px}
.rem-search svg{position:absolute;left:10px;color:var(--rem-muted);pointer-events:none}
.rem-search input{width:100%;height:32px;border:1px solid var(--rem-input-border);border-radius:8px;background:var(--rem-input);padding:0 10px 0 32px;color:var(--rem-fg);font:inherit;font-size:13px;outline:none}
.rem-search input:focus{border-color:var(--rem-input-border-focus);background:var(--rem-input-focused)}
.rem-btn-danger{background:var(--rem-danger);color:#fff}
.rem-btn-danger:hover{background:color-mix(in oklab,var(--rem-danger) 85%,transparent)}
.rem-import-item.danger{color:var(--rem-danger)}
.rem-import-item:disabled{opacity:.5;cursor:not-allowed}
.rem-device-empty{display:flex;flex-direction:column;align-items:center;gap:4px;padding:24px 12px;text-align:center;font-size:13px;color:var(--rem-muted)}
.rem-device-empty svg{color:var(--rem-fg-subtlest)}
.rem-device-loading{display:flex;align-items:center;gap:8px;padding:8px;font-size:12px;color:var(--rem-muted)}
.rem-btn.danger{color:var(--rem-danger)}
.rem-empty{border:1px dashed var(--rem-border);border-radius:12px;padding:24px;text-align:center;font-size:13px;color:var(--rem-muted);margin-bottom:12px}
.rem-notice{margin:0 0 10px;font-size:12px;color:var(--rem-success-fg)}
.rem-dialog.rem-modal{top:50%;transform:translate(-50%,-50%);max-width:32rem;max-height:calc(100vh - 4rem)}
.rem-dialog.rem-modal.wide{max-width:42rem}
.rem-modal-body{min-height:0;flex:1;overflow:auto}
.rem-modal-foot{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--rem-border);padding-top:12px}
.rem-pre{margin:0;max-height:24rem;overflow:auto;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-bg);padding:8px 12px;font-family:var(--rem-mono);font-size:10px;line-height:24px;color:var(--rem-fg);white-space:pre-wrap;word-break:break-word}
.rem-diag-lead{margin:0 0 12px;font-size:12px;color:var(--rem-muted)}
.rem-diag-loading{display:flex;align-items:center;gap:8px;padding:24px 4px;font-size:13px;color:var(--rem-muted)}
.rem-diag-verdict{display:flex;align-items:center;gap:8px;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-bg);padding:10px 12px;font-size:13px;font-weight:500}
.rem-diag-verdict.is-ok{color:var(--rem-success-fg)}
.rem-diag-verdict.is-warn{color:var(--rem-warning-fg)}
.rem-diag-verdict.is-error{color:var(--rem-danger)}
.rem-diag-section{margin-top:16px}
.rem-diag-title{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--rem-muted)}
.rem-diag-checks{display:flex;margin:0;padding:0;list-style:none;flex-direction:column;gap:8px}
.rem-diag-check{display:flex;align-items:flex-start;gap:8px;font-size:13px}
.rem-diag-check>svg{flex:none;margin-top:2px;color:var(--rem-muted)}
.rem-diag-check.is-ok>svg{color:var(--rem-success-fg)}
.rem-diag-check.is-warn>svg{color:var(--rem-warning-fg)}
.rem-diag-check.is-error>svg{color:var(--rem-danger)}
.rem-diag-check-main{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}
.rem-diag-check-title{font-weight:500}
.rem-diag-check-detail{font-size:12px;color:var(--rem-muted);word-break:break-word}
.rem-diag-check-hint{font-size:12px;color:var(--rem-fg-subtle)}
.rem-diag-check-state{flex:none;font-size:11px;color:var(--rem-muted);text-transform:uppercase;letter-spacing:.04em}
.rem-diag-grid{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0;font-size:13px}
.rem-diag-grid dt{color:var(--rem-muted)}
.rem-diag-grid dd{margin:0;min-width:0;word-break:break-word}
.rem-diag-log{margin:0;max-height:12rem;overflow:auto;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-bg);padding:8px 12px;font-family:var(--rem-mono);font-size:11px;line-height:1.6;color:var(--rem-fg);white-space:pre-wrap;word-break:break-word}
.rem-diag-foot{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px}
.rem-diag-foot-right{display:flex;align-items:center;gap:8px}
.rem-onboarding{border:1px solid var(--rem-border);border-radius:12px;background:var(--rem-dialog);padding:16px}
.rem-onboarding-head{display:flex;align-items:flex-start;gap:10px}
.rem-onboarding-icon{display:flex;height:32px;width:32px;flex:none;align-items:center;justify-content:center;border-radius:8px;background:var(--rem-hover);color:var(--rem-fg)}
.rem-onboarding-title{margin:0;font-size:14px;font-weight:600}
.rem-onboarding-lead{margin:2px 0 0;font-size:12px;line-height:1.6;color:var(--rem-muted)}
.rem-onboarding-steps{display:flex;margin:14px 0 0;padding:0;list-style:none;flex-direction:column;gap:10px}
.rem-onboarding-step{display:flex;gap:10px}
.rem-onboarding-index{display:flex;height:20px;width:20px;flex:none;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--rem-border);font-size:11px;color:var(--rem-muted)}
.rem-onboarding-step-title{margin:0;font-size:13px;font-weight:500}
.rem-onboarding-step-detail{margin:2px 0 0;font-size:12px;line-height:1.6;color:var(--rem-muted)}
.rem-onboarding-note{margin:14px 0 0;font-size:12px;color:var(--rem-muted)}
.rem-onboarding-actions{display:flex;margin-top:12px;align-items:center;gap:12px}
.rem-device-update{display:inline-flex;flex:none;align-items:center;gap:4px;border:1px solid var(--rem-border);border-radius:999px;background:var(--rem-hover);padding:2px 8px;font-size:11px;font-weight:500;color:var(--rem-warning-fg);cursor:pointer}
.rem-device-update:hover{border-color:var(--rem-warning-fg)}
.rem-device-update:disabled{opacity:.5;cursor:not-allowed}
.rem-reconnect-banner{position:fixed;left:16px;bottom:16px;z-index:60;display:flex;width:min(400px,calc(100vw - 32px));align-items:flex-start;gap:10px;border-radius:8px;border:1px solid var(--rem-border);background:var(--rem-surface);padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:12px}
.rem-reconnect-banner>svg{flex:none;margin-top:2px;color:var(--rem-warning-fg)}
.rem-reconnect-main{min-width:0;flex:1}
.rem-reconnect-title{margin:0;font-weight:500}
.rem-reconnect-detail{margin:2px 0 0;color:var(--rem-muted);line-height:1.6}
.rem-reconnect-actions{display:flex;flex:none;flex-direction:column;align-items:flex-end;gap:4px}
.rem-settings{font-size:13px;color:var(--rem-fg)}
.rem-settings .sshR-sub{font-size:12px;color:var(--rem-muted)}
.rem-settings .sshR-sectionTitle{margin:18px 0 8px;font-size:12px;font-weight:600;color:var(--rem-muted)}
.rem-settings .sshR-hostRow{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--rem-border)}
.rem-settings .sshR-card{background:var(--rem-dialog);border:1px solid var(--rem-border);border-radius:12px;padding:16px;margin-top:12px}
.rem-settings .sshR-input,.rem-settings .sshR-select{height:32px;border:1px solid var(--rem-input-border);border-radius:8px;background:var(--rem-input);color:var(--rem-fg);font-family:var(--rem-font);font-size:13px;padding:0 10px;outline:none}
.rem-settings .sshR-input:focus,.rem-settings .sshR-select:focus{border-color:var(--rem-input-border-focus);background:var(--rem-input-focused)}
.rem-settings .sshR-btn{height:28px;border:1px solid var(--rem-border);border-radius:6px;background:transparent;color:var(--rem-fg);font-family:var(--rem-font);font-size:13px;padding:0 10px;cursor:pointer}
.rem-settings .sshR-btn:hover:not(:disabled){background:var(--rem-hover)}
.rem-settings .sshR-btn.primary{background:var(--rem-primary);color:var(--rem-primary-fg);border-color:transparent}
.rem-settings .sshR-btn.danger{color:var(--rem-danger)}
.rem-settings .sshR-tag{border:1px solid var(--rem-border);background:var(--rem-surface);border-radius:6px;padding:1px 6px;font-size:10px;color:var(--rem-muted)}
.rem-settings .sshR-hint{font-size:12px;color:var(--rem-muted)}
.rem-settings .sshR-errorBox{border-radius:6px;background:var(--rem-danger-surface);color:var(--rem-danger-fg);padding:10px 12px;font-size:12px}
.rem-settings .sshR-field label{font-size:12px;color:var(--rem-muted)}
.rem-settings .mono{font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted)}
@keyframes rem-spin{to{transform:rotate(360deg)}}
@keyframes rem-pulse{50%{opacity:.5}}
.rem-ui .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* ── device-management wizard header ───────────────────────────────────────── */
.rem-type-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.rem-import-btn{display:inline-flex;height:32px;flex-shrink:0;align-items:center;gap:6px;border:0;border-radius:6px;background:transparent;padding:0 8px;font:inherit;font-size:14px;color:var(--rem-muted);cursor:pointer}
.rem-import-btn:hover{background:var(--rem-hover);color:var(--rem-fg)}
.rem-import-btn:disabled{cursor:not-allowed;opacity:.5}
.rem-import-btn svg{width:14px;height:14px;flex-shrink:0}
.rem-import-btn .rem-chev{width:14px;height:14px;transition:transform .15s}
.rem-import-btn[aria-expanded=true] .rem-chev{transform:rotate(180deg)}
.rem-import-search{height:32px;margin:2px 4px;width:calc(100% - 8px)}
.rem-import-menu{max-height:15rem;overscroll-behavior:contain}
.rem-import-item{flex-direction:row;align-items:center;gap:8px;min-height:32px;padding:4px 8px}
.rem-import-item-main{display:flex;min-width:0;flex:1;flex-direction:column;text-align:left}
.rem-import-item-main span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--rem-fg)}
.rem-import-item-main span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--rem-mono);font-size:12px;color:var(--rem-muted)}
.rem-import-item[data-checked=true]{background:var(--rem-menu-hover)}
.rem-import-item>svg{width:16px;height:16px;flex-shrink:0;color:var(--rem-muted)}
.rem-alias-row{display:flex;flex-wrap:wrap;align-items:center;gap:1px 12px}
.rem-alias-chip{display:inline-flex;height:28px;align-items:center;gap:6px;border:1px solid var(--rem-ssh-border);border-radius:6px;background:var(--rem-ssh-surface);padding:0 2px 0 8px;font-size:12px;color:var(--rem-ssh-fg)}
.rem-alias-chip>span{max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-alias-chip svg{width:14px;height:14px;flex-shrink:0}
.rem-alias-chip button{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.rem-alias-chip button:hover{background:var(--rem-hover)}
.rem-alias-hint{font-size:12px;color:var(--rem-muted)}
.rem-adv-group{display:flex;flex-direction:column;gap:6px}
.rem-adv-group .rem-seg{flex-wrap:wrap;width:auto}
.rem-adv-group .rem-seg button{white-space:normal;text-align:center;padding:4px 12px}
.rem-adv-desc{margin:0;font-size:12px;color:var(--rem-muted);text-wrap:pretty}
/* ── create-project dialog ─────────────────────────────────────────────────── */
.rem-create-center{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:none}
.rem-create-center .rem-dialog{pointer-events:auto}
.rem-dialog.rem-create{position:relative;top:auto;left:auto;transform:none;width:100%;max-width:32rem;max-height:calc(100vh - 4rem);gap:20px;padding:16px}
.rem-floating-menu{position:fixed;max-height:min(70vh,20rem);overflow-y:auto}
.rem-floating-menu.rem-import-menu{max-height:15rem}
.rem-create-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.rem-create-title{margin:0;font-size:16px;font-weight:500;line-height:1.625;color:var(--rem-fg)}
.rem-create-close{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--rem-fg);cursor:pointer}
.rem-create-close:hover{background:var(--rem-surface-hover)}
.rem-create-close svg{width:16px;height:16px}
.rem-create-body{display:flex;min-height:0;flex-direction:column;gap:20px;overflow-y:auto}
.rem-create-field{display:grid;min-width:0;gap:6px}
.rem-create-label{font-size:12px;font-weight:500;color:var(--rem-fg)}
.rem-create-input{height:36px;border-radius:8px}
.rem-select-wrap{position:relative;min-width:0}
.rem-select-trigger{display:flex;width:100%;min-width:0;height:36px;align-items:center;gap:8px;border:1px solid var(--rem-input-border);border-radius:8px;background:var(--rem-input);padding:0 12px;font:inherit;font-size:14px;color:var(--rem-fg);text-align:left;cursor:pointer}
.rem-select-trigger:hover{border-color:var(--rem-input-border-hover);background:var(--rem-input)}
.rem-select-trigger[aria-expanded=true]{border-color:var(--rem-input-border-focus);background:var(--rem-input-focused)}
.rem-select-trigger:disabled{cursor:not-allowed;opacity:.5}
.rem-select-trigger>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-select-trigger>svg{width:14px;height:14px;flex-shrink:0;margin-left:auto;color:var(--rem-muted)}
.rem-select-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:9;display:flex;flex-direction:column;max-height:18rem;overflow-y:auto;border:1px solid var(--rem-border);border-radius:12px;background:var(--rem-popover,var(--rem-menu));padding:4px;box-shadow:0 10px 15px -3px #0000001a,0 4px 6px -4px #0000001a}
.rem-select-item{display:flex;min-height:32px;width:100%;align-items:center;gap:8px;border:0;border-radius:6px;background:transparent;padding:4px 8px 4px 28px;position:relative;font:inherit;font-size:14px;color:var(--rem-fg);text-align:left;cursor:pointer}
.rem-select-item:hover,.rem-select-item[data-selected=true]{background:var(--rem-menu-hover)}
.rem-select-check{position:absolute;left:6px;display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;color:var(--rem-fg)}
.rem-select-check svg{width:14px;height:14px}
.rem-select-sep{height:1px;margin:4px -4px;background:var(--rem-border)}
.rem-select-add{gap:8px;padding-left:8px;color:var(--rem-fg)}
.rem-select-add svg{width:16px;height:16px;color:var(--rem-fg-subtle)}
.rem-device-label{display:flex;width:100%;min-width:0;align-items:center;gap:8px}
.rem-device-label>svg{width:16px;height:16px;flex-shrink:0;color:var(--rem-fg-subtle)}
.rem-device-label-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rem-device-status{display:flex;flex-shrink:0;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--rem-fg-subtle)}
.rem-device-status-dot{width:8px;height:8px;border-radius:999px}
.rem-device-status[data-status=online] .rem-device-status-dot{background:var(--rem-success)}
.rem-device-status[data-status=offline] .rem-device-status-dot{border:1px solid var(--rem-fg-subtlest)}
.rem-device-status[data-status=connecting] .rem-device-status-dot{background:var(--rem-progress);animation:rem-pulse 2s cubic-bezier(.4,0,.6,1) infinite}
.rem-device-status[data-status=pending] .rem-device-status-dot{background:var(--rem-warning)}
.rem-device-status[data-status=failed] .rem-device-status-dot{background:var(--rem-danger)}
.rem-existing-hint{display:flex;flex-wrap:wrap;align-items:center;gap:0 4px;margin:0;font-size:12px;color:var(--rem-fg-subtle)}
.rem-link{display:inline-flex;align-items:center;gap:2px;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--rem-brand,#2563eb);text-decoration:underline;text-underline-offset:4px;cursor:pointer}
.rem-link:hover{text-decoration-thickness:2px}
.rem-link:disabled{opacity:.5;cursor:not-allowed}
.rem-link svg{width:14px;height:14px}
.rem-folders{display:flex;min-width:0;flex-direction:column;gap:6px}
.rem-folder-list{overflow:hidden;border:1px solid var(--rem-border);border-radius:8px}
.rem-folder-row{display:flex;min-height:48px;min-width:0;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--rem-border)}
.rem-folder-row:first-child{border-top:0}
.rem-folder-row>svg{width:16px;height:16px;flex-shrink:0;color:var(--rem-fg-subtle)}
.rem-folder-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.rem-folder-name.break{white-space:normal;word-break:break-all}
.rem-primary-badge{display:inline-flex;height:28px;flex-shrink:0;align-items:center;border:1px solid var(--rem-border);border-radius:6px;padding:0 8px;font-size:14px;color:var(--rem-fg-subtle)}
.rem-folder-add{display:flex;min-height:48px;width:100%;align-items:center;gap:8px;border:0;border-top:1px solid var(--rem-border);background:transparent;padding:8px 12px;font:inherit;font-size:14px;color:var(--rem-fg);text-align:left;cursor:pointer}
.rem-folder-add:hover{background:var(--rem-surface-hover)}
.rem-folder-add svg{width:16px;height:16px;flex-shrink:0;color:var(--rem-fg-subtle)}
.rem-folder-remove svg{width:16px;height:16px}
.rem-folder-empty{display:flex;min-height:128px;width:100%;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px dashed var(--rem-border);border-radius:8px;background:transparent;padding:20px 16px;font:inherit;color:var(--rem-fg);text-align:center;cursor:pointer}
.rem-folder-empty:hover{border-color:var(--rem-border-hover)}
.rem-folder-empty:disabled{opacity:.6;cursor:default}
.rem-folder-empty-icon{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:999px;background:var(--rem-surface);color:var(--rem-fg-subtle)}
.rem-folder-empty-icon svg{width:16px;height:16px}
.rem-folder-empty-title{font-weight:500}
.rem-folder-empty-hint{font-size:12px;color:var(--rem-fg-subtle)}
.rem-create-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;border-top:0;padding-top:0}
.rem-create-foot .rem-btn{height:32px;padding:0 12px;border-radius:8px}
.rem-create-error{margin:0;font-size:12px;color:var(--rem-danger)}
/* folder-trust confirmation: a second dialog over the project dialog,
   with title, device label, monospace path list, description and two actions. */
.rem-dialog.rem-trust{position:relative;top:auto;left:auto;transform:none;width:100%;max-width:28rem;gap:12px;padding:20px}
.rem-trust-title{margin:0;font-size:18px;font-weight:600;line-height:1.4;color:var(--rem-fg)}
.rem-trust-meta{display:grid;min-width:0;gap:8px}
.rem-trust-device{margin:0;font-size:14px;color:var(--rem-fg-subtle)}
.rem-trust-list{margin:0;max-height:12rem;overflow-y:auto;padding-left:20px;font-family:var(--rem-mono);font-size:12px;color:var(--rem-fg)}
.rem-trust-path{word-break:break-all}
.rem-trust-desc{margin:0;font-size:14px;color:var(--rem-fg-subtle)}
.rem-trust-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.rem-trust-foot .rem-btn{height:32px;padding:0 12px;border-radius:8px}
/* ── folder modal ──────────────────────────────────────────────────────────── */
/* the create-project dialog inlines the embedded folder browser in a
   24rem column (height 24rem, min-height 0, flex column). The bordered
   surface card is the browser itself; the listing is a borderless
   background pane capped at 16rem. Keep both picking surfaces on this
   frame. */
.rem-folder-modal{display:flex;height:24rem;min-height:0;flex-direction:column;gap:0}
.rem-folder-modal .rem-browser{flex:1;height:auto;min-height:0}
.rem-folder-modal .rem-browser-list{flex:1;min-height:6rem;max-height:16rem}
.rem-folder-foot{display:flex;flex-shrink:0;justify-content:flex-end;gap:8px;margin-top:12px}
.rem-folder-foot .rem-btn{height:40px;padding:0 20px;border-radius:8px}
.rem-hidden-input{display:none}
@media (max-width:640px){.rem-folder-modal .rem-browser-actions{width:100%}.rem-folder-modal .rem-browser-actions .rem-btn{flex:1}}
.rem-spin{animation:rem-spin 1s linear infinite}
/* ── native remote workspace row: cloud icon, title, device and status ─────── */
[data-dsh-ssh-row]{gap:8px!important}
[data-dsh-ssh-row] .dsh-ssh-cloud-slot,[data-dsh-ssh-row]:hover .dsh-ssh-cloud-slot{display:inline-flex!important;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#61666b)!important}
/* The native folder icon is React-managed: hide it instead of replacing it,
   otherwise the next commit's removeChild throws and the whole slot crashes. */
[data-dsh-ssh-row] .dsh-ssh-cloud-slot>svg:not([data-dsh-ssh-cloud]){display:none!important}
[data-dsh-ssh-row] .dsh-ssh-cloud-slot svg{width:16px;height:16px;flex:none}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="starting"]{color:var(--dsw-alias-state-business-primary,#4d6bfe)!important}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="error"]{color:var(--dsw-alias-state-error-primary,#dc2626)!important}
[data-dsh-ssh-row] svg[data-dsh-ssh-cloud="offline"]{color:var(--dsw-alias-label-secondary,#61666b)!important}
.dsh-ssh-spin{animation:rem-spin 1s linear infinite}
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

