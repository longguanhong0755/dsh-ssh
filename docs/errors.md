# Error codes

Generated from `lib/errors.js` — run `npm run docs:errors` after changing the catalog.

Every failed API response carries `code`, `error`, `hint` and `retryable`. The
wizard and the diagnostics page show `hint` under the failure, so a red line
always comes with the next action.

## 中文

| 代码 | 处理方式 | 可重试 |
| --- | --- | --- |
| `preflight-failed` | 按上面的检查项处理后再试：换 Linux 目标、清理磁盘、确认主目录可写，或改用「本机下载后上传」。 | 是 |
| `remote-authentication-failed` | 检查用户名、密码或私钥；确认服务器允许这种登录方式（PasswordAuthentication / PubkeyAuthentication）。 | 是 |
| `remote-authentication-key-missing` | 这台设备的凭据没有读到（系统凭据库可能已锁定），重新输入一次密码或私钥口令。 | 是 |
| `remote-authentication-unsupported` | 服务器只接受交互式二次验证，改用私钥登录，或在服务器上关闭该验证方式。 | 否 |
| `remote-connection-closed` | 连接在握手完成前被关闭：多半是端口写错、被防火墙重置，或服务器拒绝了该客户端。 | 是 |
| `remote-connection-timeout` | 确认地址和端口正确、sshd 正在监听，并检查本机或云安全组的防火墙。 | 是 |
| `remote-host-key-changed` | 主机密钥与上次记录不一致。确认这台机器确实重装过，再在设备详情里更新指纹。 | 否 |
| `remote-host-not-found` | 主机名解析失败，检查拼写，或直接填 IP 地址。 | 是 |
| `remote-host-unreachable` | 网络不通或端口未开放：先在终端试一次 ssh，再检查防火墙和 SSH 服务。 | 是 |
| `runtime-disk-low` | 远端主目录剩余空间不足（需要约 300 MB）。清理后重试。 | 是 |
| `runtime-install-failed` | 安装 npm 包失败，展开日志看最后几行；常见原因是镜像不可达或磁盘满。 | 是 |
| `runtime-no-service-manager` | 这台机器没有 systemd，服务会用 setsid + crontab 常驻；如果也没装 crontab，重启后需要手动重连。 | 是 |
| `runtime-node-engine` | 远端 Node 版本低于这个 dsh 版本的要求。允许插件安装便携 Node，或先升级远端 Node。 | 是 |
| `runtime-permission` | 远端目录不可写。确认登录用户对主目录有写权限。 | 否 |
| `runtime-port-in-use` | 目标端口已被占用。删掉这个项目后重新创建，插件会换一个空闲端口。 | 是 |
| `runtime-registry-unreachable` | 远端访问不了 npm 镜像。把安装方式改成「本机下载后上传」，或换一个镜像地址。 | 是 |
| `runtime-sudo-required` | 安装系统服务需要 root 或 sudo。换用 root 账号，或让插件退回 setsid 方式运行。 | 是 |
| `runtime-unsupported-platform` | 远端服务依赖 Linux 的 systemd/setsid；请使用 Linux 主机、WSL 或 Docker。 | 否 |
| `source-server-update-in-progress` | 另一台桌面正在更新这台设备的远端服务，等它完成后再重试。 | 是 |
| `view-docker-port-unpublished` | 这个容器没有发布 Web 端口，无法在本地打开远程界面。重建容器时加 `-p 127.0.0.1:<端口>:<端口>`。 | 否 |
| `view-port-conflict` | 本机转发端口被占用。换一个项目端口或关闭占用该端口的程序后重试。 | 是 |
| `view-target-offline` | 远端服务没有运行。先启动项目，或点「重启服务」。 | 是 |
| `view-token-missing` | 没有在服务日志里找到启动令牌。点「重启服务」会生成新的令牌。 | 是 |
| `view-unsupported` | 这个目标类型暂不支持在本地打开远程界面。 | 否 |

## English

| Code | What to do | Retryable |
| --- | --- | --- |
| `preflight-failed` | Fix the failing checks first: a Linux target, free disk, a writable home, or download-locally mode. | Yes |
| `remote-authentication-failed` | Check the user, password or key, and that the server allows this login method. | Yes |
| `remote-authentication-key-missing` | The stored credential could not be read; enter the password or passphrase again. | Yes |
| `remote-authentication-unsupported` | The server only offers interactive verification; use a private key or disable it on the server. | No |
| `remote-connection-closed` | The connection closed before the handshake finished; usually a wrong port, a firewall reset, or a refused client. | Yes |
| `remote-connection-timeout` | Check the address and port, that sshd is listening, and any firewall or security group. | Yes |
| `remote-host-key-changed` | The host key changed. Confirm the machine was reinstalled, then update the fingerprint in the device details. | No |
| `remote-host-not-found` | The host name did not resolve; check the spelling or use an IP address. | Yes |
| `remote-host-unreachable` | The host is unreachable: try ssh in a terminal, then check the firewall and SSH service. | Yes |
| `runtime-disk-low` | The remote home is low on space (about 300 MB needed). Free space and retry. | Yes |
| `runtime-install-failed` | Installing the npm package failed; expand the log for the last lines (registry or disk). | Yes |
| `runtime-no-service-manager` | No systemd here; the service runs under setsid + crontab. Without crontab it must be reconnected after a reboot. | Yes |
| `runtime-node-engine` | The remote Node is older than this dsh build requires. Allow the portable Node, or upgrade Node on the host. | Yes |
| `runtime-permission` | The remote directory is not writable for this user. | No |
| `runtime-port-in-use` | The port is already in use. Recreate the project so the plugin picks a free port. | Yes |
| `runtime-registry-unreachable` | The host cannot reach the npm registry. Switch to download-locally-then-upload, or change the mirror. | Yes |
| `runtime-sudo-required` | Installing the system service needs root or sudo. Use root, or let the plugin fall back to setsid. | Yes |
| `runtime-unsupported-platform` | The remote service needs Linux systemd/setsid; use a Linux host, WSL or Docker. | No |
| `source-server-update-in-progress` | Another desktop is updating this device; retry when it finishes. | Yes |
| `view-docker-port-unpublished` | This container publishes no web port. Recreate it with `-p 127.0.0.1:<port>:<port>`. | No |
| `view-port-conflict` | The local forwarding port is busy. Free it or use another project port. | Yes |
| `view-target-offline` | The remote service is not running. Start the project or restart the service. | Yes |
| `view-token-missing` | No launch token in the service log. Restarting the service mints a new one. | Yes |
| `view-unsupported` | Opening the remote UI locally is not supported for this target type yet. | No |
