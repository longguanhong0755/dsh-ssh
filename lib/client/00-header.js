// part: 00-header -- loader registration, module/exports preamble, React requires, identity consts
// Client half of dsh-ssh-remote.
//
// Three surfaces:
//   * Settings → SSH 远程: manage hosts and deployment defaults.
//   * Sidebar → SSH 远程: live status of remote workspaces and their controls.
//   * Add/Select workspace → SSH 远程 tab: pick a remote directory and create a
//     persistent remote dsh workspace.
//
// Client entries are classic scripts registered through window.__ModuleLoader__;
// the factory receives a synchronous `require`.
window.__ModuleLoader__.load({
  id: 'dsh-ssh-remote',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React
    const name = 'dsh-ssh-remote'
    const NS = 'dsh-ssh-remote'

