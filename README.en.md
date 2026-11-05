# dsh-ssh-remote

**ZCode-style remote workspaces for DeepSeek Harness (dsh): SSH, WSL and Docker.**

[简体中文](README.md) · [English](README.en.md)

The remote dsh runs as a persistent systemd service (or `setsid` session) inside the SSH host, WSL distribution or Docker container, and remote sessions are executed by a detached, persistent `dsh --profile sdk` process there (falling back to `--profile headless` when unavailable). The local app selects the workspace, shows the native chat, and monitors status; there is no local console proxy. Closing the local app does **not** stop the remote dsh.

> Target: DeepSeek Harness Desktop `0.2.1-rc.5`. Validated end-to-end against `203.0.113.10` (AlmaLinux 9.5).

---

## Demo

All eight screenshots below come from a real DeepSeek Harness Desktop `0.2.1-rc.5` session connected to a real SSH host — no mockups or composited UI. Device names, hostnames, IPs and the device ID were replaced with documentation ranges (`192.0.2.0/24`, `203.0.113.0/24`); statuses, project counts and chat content are real.

### 1. Remote device management at a glance

![Remote devices](docs/demo-devices.png)

Settings → **Remote devices** rebuilds ZCode's device-management page: one row per machine with a status cloud on the left and a connection string such as `root@203.0.113.11:22` underneath; on the right, the last-seen time, a status pill (`未连接` / `已连接`), the project count, a **Connect** button and the `...` menu. The search box filters by device name, address or project. The two preference switches — **Hide device name on project rows** and **Reconnect on startup** — persist to `state.json` and take effect on the next launch. Online state, project counts and last-seen times all come from real background polling, not placeholders.

### 2. Device row menu: disconnecting is not stopping

![Device row menu](docs/demo-device-menu.png)

The `...` menu matches ZCode: **Edit**, **Disconnect** (with the note "断开后，远程任务会继续运行。" — remote tasks keep running after disconnecting), device details (version, hostname, system user, copyable device ID), **Reinstall remote service**, **Restart remote service**, **Stop remote service** (red) and **Remove device** (red). Disconnecting only drops the local connection; the systemd service, the persistent runner and any running turn keep going. Stop and remove are destructive, hence the red labels. Reinstalling keeps projects, tasks and credentials and only replaces the remote runtime.

### 3. New connection: SSH, WSL and Docker in one dialog

![New connection](docs/demo-new-connection.png)

The dialog is a 1:1 rebuild of ZCode's wizard: `SSH` / `WSL` / `Docker` segments and **Import from SSH config** at the top; host, port, username, password/key authentication and advanced options below; **Cancel** / **Add and connect** at the bottom. The placeholder copy, the default port `22` and the password reveal button are all kept from ZCode. On macOS neither the WSL segment nor any WSL entry is rendered, matching ZCode's platform gate (the backend's `process.platform`, not the browser UA).

### 4. Create project: remote devices and This computer in one picker

![Create project: device picker](docs/demo-create-project.png)

**Create project** on the main surface is a single form: project name, device, folder. The device dropdown lists **This computer** first, then every saved remote device with an online dot or an `离线` (offline) hint, plus **Add remote device…** at the bottom so a new connection does not require leaving the dialog. Selecting an offline device shows "设备当前离线，点击后先连接" (the device is offline; it will connect first); creating connects automatically. Remote devices open the SFTP folder browser, while This computer opens the operating system's native folder dialog.

### 5. Remote folder browser: pick a project root on the host

![Remote folder browser](docs/demo-folder-picker.png)

A remote host has no local path to browse, so this is ZCode's embedded picker rather than a system dialog: an editable path (`/root/dsh-ui-test`) with **Go** and **Show hidden directories**, a list of the current directory's subdirectories (`..` goes up), and **Cancel** / **Choose folder** at the bottom. The listing is read live over SFTP — changing directories, jumping by path and toggling hidden files all re-fetch. The chosen directory becomes the remote workspace's project root and is never deleted when the workspace is removed.

### 6. Native sidebar row: cloud + project name + device name

![Remote workspace row](docs/demo-workspace-row.png)

Remote workspaces are projected into DSH's native sidebar with the structure of ZCode's `virtual-project-row`: a status cloud (online, spinning while starting, offline, error), the project name, then the device name in a muted color. On hover, three action icons appear on the right: the `...` menu, view files and new session.

![Remote workspace row menu](docs/demo-workspace-menu.png)

The `...` menu offers **New task**, **View files**, **Remote device settings**, **Edit project**, **Pin** and **Delete project**. Deleting removes only the local projection, the remote service and the plugin runtime directory — **the remote project folder is kept** — and the confirmation names the device and path explicitly.

### 7. Streaming remote session: generated remotely, rendered locally

![Streaming remote session](docs/demo-streaming.png)

This is a real frame captured mid-answer: the text stops in the middle of a sentence ("坐在岸边看人来") and the expanded **Thinking** row is still above it, showing that text arrives incrementally instead of appearing all at once when the turn ends. The sidebar still shows `dsh-ui-test` + `dev-a`; the local app only renders and monitors. The agent process, tool calls and file access all happen on the SSH host. Internally, a projection plugin in the remote profile writes `agent/assistant-stream` frames to JSONL, the bridge carries them over a single `tail -f` SSH channel, the local renderer follows the native streaming frames, and the step is settled by the durable `assistant/message`. Closing the local app does not interrupt the turn.

---

## Features

| Area | What it does |
|---|---|
| Targets | SSH (password / private key / passphrase / agent / keyboard-interactive), WSL distributions on Windows (`wsl.exe --exec bash -lc`, default or named distro/user) and Docker containers (`docker exec -i ... sh -lc`, name/id/prefix, must be running) |
| SSH hosts | TOFU host-key check; connection test with latency and remote Node detection |
| Add connection | 1:1 ZCode device flow: wizard steps 选择设备 / 连接 / 选择目录, `已保存的设备`, `SSH config 中的 Host`, `WSL 发行版` and `运行中的容器` sections, plus `新建 SSH 连接` / `手动输入 WSL` / `手动输入 Docker`; the settings step uses ZCode's exact per-kind forms (WSL distribution datalist + Linux user hints/root warning; Docker select/manual picker); minimize is available on every step and parks the wizard in a ZCode-style background card |
| Recent workspaces | the create dialog lists existing remote workspaces under the selected device; the native row is always one click away |
| Background connect | connecting and workspace creation can continue in the background; a bottom-right pill shows progress and opens the workspace on completion |
| SSH config import | parses `~/.ssh/config` Host blocks and fills host, port, username and IdentityFile |
| One-click create | the connect phase installs/reuses the shared dsh runtime; the directory step then only starts the service. Full chain: channel (SSH/WSL/Docker) → Node ≥ 22 (portable download when absent) → `@deepseek-ai/dsh` → credentials → launcher → systemd/setsid → health check |
| Persistence | systemd `Restart=always` (system unit, or user unit + linger) or `setsid nohup` + `@reboot` cron. Survives SSH disconnect and local app exit |
| Status monitor | running / starting / stopped / error / unreachable; PID, uptime, RSS, CPU, HTTP status, port, last check. CPU is sampled from `/proc/<pid>/stat` and RSS from `/proc/<pid>/status` (no lifetime-average or fabricated values) |
| Native workspace | each remote workspace is projected into the native sidebar as a ZCode-style row: cloud status glyph + project name + device name; its agent is bridged to a detached, persistent remote SDK session |
| Row menu | hover `...` on a remote row → **Edit** (rename the project and native row) or **Delete project** (remove the local projection and service, keep the remote project directory) |
| Live streaming | the remote runner projects `agent/assistant-stream` frames over a single `tail -f` SSH channel, so reasoning and answer text appear incrementally instead of at step end |
| Persistent runner | one detached `dsh --profile sdk` JSON-RPC process per session, fed over a FIFO and streaming events through one tail channel. The first prompt pays a ~3 s boot; every later prompt reaches `step/start` in ~0.15 s and first text in ~1.0-1.3 s. Session context, tool calls and cancel all run in the same process. Idle runtimes are reaped after 30 min (`DSH_SSH_SDK_TTL`); a local restart reattaches the live runtime from the journal offset. `DSH_SSH_NO_SDK=1` disables it; `DSH_SSH_SDK_PROVIDER` / `DSH_SSH_SDK_MODEL` override the remote model |
| Warm fallback | if the SDK profile cannot start (older remote build, unsupported host), the bridge falls back to `dsh --profile headless --json` with the prewarmed FIFO runner: measured `step/start` 0.20 s / first text 0.7 s when warm, 4.96 s / 5.40 s cold. At most two runners (~200 MB RSS each), refreshed every 5 min and bounded by a TTL. `DSH_SSH_NO_PREWARM=1` disables prewarming; `DSH_SSH_MAX_WARM` changes the cap |
| Lifecycle | automatic start on create/open; no per-workspace start/stop buttons. Remove from the row menu (service + runtime dir only; project dir kept) |
| Credentials | optionally copies local `$DSH_HOME/.credentials.yaml` (0600) into each remote workspace's own DSH home |
| Legacy import | imports hosts from ZCode's `~/.dsh/dsh-ssh.json` on first load |

The local side stays a monitor and chat surface: the agent process, tools and files live on the server.

---

## Architecture

![architecture](docs/architecture.svg)

The remote Web listener binds `127.0.0.1` only; the local app reaches it through an SSH direct-tcpip tunnel, so no port is exposed to the LAN.

---

## Install

After DeepSeek Harness has started at least once:

```powershell
node C:\work\dsh-ssh-remote\bin\install.mjs --profile desktop
```

The script adds a `link:` dependency and the bundle to `~/.dsh/profiles/desktop/package.json`, then creates a junction in the profile's `node_modules`. Fully restart DeepSeek Harness afterwards.

Manual install: add

```json
"dsh-ssh-remote": "link:C:/work/dsh-ssh-remote"
```

to `dependencies`, append `"dsh-ssh-remote"` to `dsh.profile.bundles`, and create

```powershell
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ssh-remote" "C:\work\dsh-ssh-remote"
```

## Use

1. **Add a machine** — open **Settings → Remote devices** or the left **SSH Remote** panel, click **New connection**, fill host/port/user/password or key, **Test connection**, **Save**. Importing `~/.ssh/config` Hosts is available in the same dialog. This panel only manages machines; it does not create workspaces.
2. **Create a workspace from the main interface** — click **Create project** in the conversation hero, or **Add workspace** in the sidebar. Pick **This computer** or a saved remote device, type a project name, then **Choose folder**.
   - **This computer** opens the operating system's folder dialog (falling back to the same ZCode folder dialog when the host has no native chooser).
   - A remote device opens the 1:1 ZCode folder browser (SFTP listing) after connecting.
3. **Trust this folder?** — **Create project** first opens ZCode's folder-trust confirmation (device name, monospace path list, permission description). **Trust folders and create** starts the deploy; **Cancel** returns to the form without closing the dialog.
4. **Create** deploys/reuses the remote runtime and adds the workspace to the native sidebar. The first create installs dsh on the host (about 1 minute, ~844 MB); later creates reuse the runtime. An empty project name falls back to the selected folder's basename, as in ZCode.
5. **Remote rows** in the native sidebar show a cloud status glyph, the project name and the device name. Hover the row for **New session** and `...`; the menu offers **Edit** (rename) and **Delete project**.
6. **Chat** runs on the remote host and streams live: reasoning and answer text arrive incrementally over one SSH tail channel; the next turn reuses the already running remote runtime, so the first token appears in about a second. Closing the local app does not stop the remote turn.
7. **Close DeepSeek Harness.** The remote runner keeps running. Reopen; the bridge resumes from its journal and the row reattaches to the same workspace.

## Data

Local: `$DSH_HOME/ssh-remote/state.json` (hosts, workspaces, settings; mode 0600), `known_hosts.json`.

Remote: `~/.dsh-remote/runtime/dsh-<version>/`, `~/.dsh-remote/workspaces/<id>/{home,logs,run}/`.

The remote Web listener binds `127.0.0.1` only; no LAN port is opened.

## Verified on 203.0.113.10

- AlmaLinux 9.5, x86_64, 8 vCPU, 31 GB RAM, Node v22.23.2, systemd 252.
- Remote install of `@deepseek-ai/dsh@0.2.1-rc.5` in ~1 minute.
- Service prints `dsh web: ...?token=...`; an unauthenticated HTTP request without the token returns `401` (used as readiness evidence only).
- Real metrics verified against `ps`: RSS matches `VmRSS` in `/proc/<pid>/status`; CPU is a fresh `/proc/<pid>/stat` delta, not the misleading lifetime `pcpu` average.
- Interaction chain verified end-to-end: saved-device connect → runtime prepare hits cache → folder picker → trust confirmation → create → the new native workspace opens automatically.
- Folder-trust dialog verified: **Cancel** closes only the confirmation and keeps the form and chosen root; **Trust folders and create** completes the job and registers the native workspace.
- macOS simulation verified by rewriting `/ssh-remote/discover`'s `platform` to `darwin`: the panel subtitle, connection-type segment, WSL section of the device list and **Enter WSL manually** all disappear.
- Remote rows render the cloud glyph, project name and device name; the hover menu renames/deletes the same workspace record and native row.
- Live streaming verified end-to-end with the real remote runner: `start` / `text-delta` / `reasoning-delta` frames reach the local bridge before the durable `assistant/message`. The renderer follows one strictly increasing `revision` sequence per agent, so the bridge mirrors `agent.assistantStreamRevision` instead of restarting at 1 per attempt. A 587-character answer grew through `16 → 26 → 56 → 68 → 95 → 138 → 199 → 328 → 406 → 458 → 587` in about 1.9 s with a mid-sentence screenshot, the global probe saw every emitted frame (897 frames in that turn on top of 1687 cumulative), and revisions stayed continuous across turns (`1247 → 1687 → 2584`).
- Persistent runner verified end-to-end: the first turn paid one ~3 s SDK boot, an immediate second turn reached `step/start` 148 ms after send (first text 1.02 s), and a follow-up asking for a previously given number returned it from the live session. Tool calls streamed through the same runtime; cancel ended a turn in ~2.8 s with no ghost output, and a later turn booted and resumed cleanly.
- Local restart verified both ways: disposing the bridge mid-turn and reattaching consumed the rest of the turn from the journal offset (one assistant message, 554 chars, no duplicates); disposing while idle and reattaching reused the live runtime (363 ms to reattach) and answered the follow-up with exactly one message.
- TTL watchdog verified with a 30 s TTL: the idle runtime was reaped between turns, the next prompt booted a fresh one, resumed the session, and answered correctly; replaced watchdogs now reap their whole process group (no leaked `sleep` children).
- SDK failure fallback verified: forcing an invalid provider made the SDK boot fail, and both turns still completed through the headless warm path.
- Headless warm fallback measured against the same host: cold launch `step/start` 4.96 s and first text 5.40 s after send; prewarmed launch `step/start` 0.20 s and first text 0.7 s; a follow-up sent the instant the previous turn ended still takes the cold path (~3.3 s) because the next runner boots only after the previous process exits. Runners also set Node's `NODE_COMPILE_CACHE` inside the workspace DSH home, which trimmed cold boots by ~0.5 s.
- Resume verified: dispose the local bridge while the remote turn is running, attach a new bridge to the same session id → it restarts from the journal offset, drains the remaining JSONL and appends the final message/turn end without duplicates.
- Local **Choose folder** opens the system dialog in the desktop app; the harness also verifies the HTTP fallback when no native picker is exposed.
- After a workspace is removed from the row menu, the native projection drops the anchor row (no ghost remote project).
- After closing the local app for 10 s: same remote PID, uptime kept increasing, `systemctl is-active = active`.
- Reopening the local app restored the same PID and continuous uptime.
- Logs and remote model listing (`loaded 2 model(s)`) still work through the device-management routes.
- root services log to journal, not a file under `/root`, to avoid SELinux `209/STDOUT` on RHEL-family hosts.
- SSH/WSL/Docker share one command layer; on the development machine (no WSL optional feature, no Docker daemon) the WSL/Docker discovery and error paths were verified end-to-end in the UI (`当前系统未检测到可用的 WSL 环境` / `当前系统未检测到可用的 Docker 环境`), including the per-kind forms and badges. Full deploy inside a live WSL distribution or container still needs a host that provides one.

## Limitations

- Linux remotes only: WSL distributions and Docker containers must provide a Linux `bash`/`sh`, Node ≥ 22 or a way to download the portable runtime (curl, wget or an existing Node).
- WSL requires a Windows desktop with the WSL optional feature installed; Docker requires a running daemon and a running container.
- macOS has no WSL, matching ZCode: the backend rejects WSL targets and the UI renders no WSL entry at all (panel subtitle, connection-type segment, device list, **Enter WSL manually**). Platform comes from the DSH backend's `process.platform`, not the browser UA.
- The remote host needs access to an npm registry (default npmmirror).
- The first prompt in a session pays one remote runtime boot (~3 s), and an idle runtime is reaped after 30 min, so the next prompt boots again. A local restart reuses a live runtime, or resumes a fresh one from the remote session store. Hosts where the SDK profile cannot start fall back to the headless warm runner; there an immediate follow-up still pays ~3 s. Targets without `mkfifo` (some minimal containers) fall back to cold starts automatically.
- Credentials are synced, but local model selection/settings are not yet mapped to the remote runner; it defaults to `deepseek-official` / `deepseek-chat`, overridable with `DSH_SSH_SDK_PROVIDER` / `DSH_SSH_SDK_MODEL`.
- Background connect progress is in-memory: restarting the local app drops the pill (created workspaces are restored from `state.json`); there is no cancel button for an in-flight install/create.
- No local mirror of remote project files; the agent and tools run inside the target.
- Docker workspaces do not survive removal of their container; WSL workspaces survive until the distribution is terminated/unregistered.
- WSL2 HTTP proxy auto-rewriting (ZCode maps a loopback proxy to the Windows host gateway) is not implemented; use a reachable registry/proxy inside the distribution.

## Uninstall

```powershell
node C:\work\dsh-ssh-remote\bin\uninstall.mjs --profile desktop
```

This removes the local link/dependency selection only. Delete remote workspaces from the UI to stop their services.

## Reverse-engineering notes

See [`docs/zcode-ssh-reverse-engineering.md`](docs/zcode-ssh-reverse-engineering.md) for the ZCode 3.17.2 SSHBackend / WSL / Docker backends, remote asset deployment, the 3.17.2 connect wizard (stages, install confirmation, error card, log panel), the device-management "新建连接" dialog, the "创建项目" dialog and the embedded "选择文件夹" picker, plus the `rea` evidence summary.

## License

MIT

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
