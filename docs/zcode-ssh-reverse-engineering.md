# ZCode SSH 模块逆向记录

目标：`ZCode Desktop 3.17.2`（`@zcode/desktop`，Electron，`app.asar` 374 MB；2026-11-04 从本机
`%LOCALAPPDATA%\Programs\ZCode\resources\app.asar` 重新解包；此前 3.16.2 的结论除下文修订外仍然成立）。
方法：`rea` 静态分析 + 手工阅读 Vite/Rollup 产物（`app_extracted/out`）。

## 1. rea 分析

```bash
rea analyze-javascript-application "%LOCALAPPDATA%/Programs/ZCode/resources/app_extracted" \
  --artifact-format directory \
  --source-path out/main/chunk-HTC2L73Y.js \
  --source-path out/main/chunk-YQKAE4PN.js \
  --source-path out/host/chunk-D4ZBCI2G.js \
  --source-path out/host/index.js \
  --detail summary \
  --evidence_output analysis/zcode-ssh-rea.json
```

结果：

- Evidence bundle（本地分析产物，未随仓库发布）：`analysis/zcode-ssh-rea.json.gz`，331,584,889 bytes；
- 命中 `SSHBackend` 21 次、`remoteWrapperPath` 14 次；
- 四个源文件均触发 `max_semantic_nodes_per_file = 20000` 上限（默认值），所以静态图是
  「高召回但非完备」；关键控制流通过手工阅读同一批文件补全。

## 2. SSH 传输层（`SSHBackend`）

实现位于：

- `out/main/chunk-HTC2L73Y.js`（主进程侧）
- `out/host/chunk-D4ZBCI2G.js`（host 进程侧，导出 `SSHBackend`）

要点：

```js
// 连接参数（原文重建）
{
  host, port: port ?? 22, username,
  privateKey, passphrase,
  password: password?.length ? password : undefined,
  agent: password ? undefined : process.env.SSH_AUTH_SOCK,
  readyTimeout: 60_000,
  keepaliveInterval: 15_000,
  keepaliveCountMax: 3,
  tryKeyboard: Boolean(password)
}
```

- `ssh2` 的 `Client`；密码登录额外注册 `keyboard-interactive` 应答器（OTP/二次验证）。
- 错误归一化：
  - `client-authentication` → `SSH 认证失败：请检查用户名、密码或私钥配置`
  - `client-timeout` → `SSH 连接握手超时…`
  - `encrypted private key detected, but no passphrase given` → 需要私钥口令
  - `bad passphrase / key integrity check failed` → 私钥口令错误
  - 统一错误码 `remote-authentication-failed` / `remote-connection-timeout` /
    `remote-host-key-changed` / `remote-host-unreachable` / `remote-host-not-found` 等
- `detect()`：`uname -s`、`uname -m`、`/proc/sys/kernel/ostype` 判定 platform/arch。
- 上传：
  - 优先 SFTP（`fastPut` 语义的流式写入 + 进度回调）；
  - SFTP session/write 失败时自动回退到 `exec` 管道：`mkdir -p <dir> && cat > <file>`；
  - 失败标记 `uploadFailureKind = sftp-session | sftp-write | local-read | aborted`。
- 执行：`exec` 返回 `{stdin, stdout, stderr, onClose}`；另有 `execSimple` 收集输出并检查退出码。
- 端口转发：`client.forwardOut('127.0.0.1', 0, '127.0.0.1', port)`，用于远程服务直连通道。

## 2.1 本地 WSL 后端（`WSLBackend`）

来源：本机 3.17.2 `out/main/chunk-VRJQY4BA.js`（3.16.2 为 `chunk-DMITVDCT.js`）。

- target：`{ kind: “wsl”, distro?: string, user?: string }`，两项都可省略；省略 distro 表示默认发行版。
- 可用性：仅 `process.platform === “win32”`；`wsl.exe --status` 成功即可用（结果缓存 5 秒）。
- 发行版列表：`wsl.exe -l -v --all`；输出含 NUL 时按 UTF-16LE 解码；每行按 2+ 空格切分，
  末列为版本、倒数第二列为状态，名称前的 `*` 表示默认发行版。
- 命令：`wsl.exe [-d distro] [-u user] --exec bash -lc <command>`（参数数组，不经过本地 shell）。
- 身份解析（3.17.2 精化）：在发行版内执行
  `bash --noprofile --norc -c “printf '%s\n' '__ZCODE_WSL_IDENTITY__' \”$WSL_DISTRO_NAME\” \”$(id -un)\” \”$HOME\””`，
  取**最后一个**标记行之后的 distro/user/HOME（免疫 motd/profile 噪声）。
- distro 匹配大小写不敏感；指定 distro 且列表非空但无匹配时抛出「未找到名为 X 的 WSL distro」；
  列表为空时回退默认发行版。
- 上传：优先复制到 `\\wsl.localhost\<distro>\...` / `\\wsl$\<distro>\...`，失败回退
  `mkdir -p <dir> && cat > <file>`；错误消息附退出码（退出码 N）。

## 2.2 本地 Docker 后端（`DockerBackend`）

来源：本机 3.17.2 `out/main/chunk-ZHR5V36R.js`（3.16.2 为 `chunk-EHXYYQDR.js`）。

- target：`{ kind: "docker", container: string }`；container 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_.-]*$`。
- Docker 可执行文件：按 PATH 查找 `docker.exe` / `docker.cmd` / `docker.bat` / `docker`
  （Windows），否则 `docker`；再尝试平台固定路径（Docker Desktop、`/usr/local/bin/docker`、
  OrbStack 等）。
- 可用性：`docker version --format {{.Server.Version}}`。
- 容器列表：`docker ps [-a] --format {{json .}}`；只保留含 `ID` 与 `Names` 的行，
  字段为 `{ id, image, name, state, status }`。
- 容器解析（3.17.2）：`docker ps -a` 全量列出后按名称/完整 id/前缀匹配（不再只列运行中的容器）；状态不是 `running` 时抛出
  “Docker 容器 X 当前未运行（state=…）”。
- 命令：`docker exec -i <container> sh -lc <command>`。
- HOME：`printf %s ~`；路径 `~` / `~/x` 会展开到容器 HOME。
- 上传：`cat > <path>` 通过 stdin 流式写入；上传前 `mkdir -p` 父目录。
- 读取/存在性：`cat` / `test -f`。
- 渲染层 `availableKinds` 始终包含 `docker`；命令阶段文案 `remote.phase.channel.docker`
  = 正在连接容器，`connected` 子状态 = 已连接容器。

## 2.3 渲染层的目标校验

- `BP()`：SSH 校验 host/port/username/password 或 privateKey；Docker 只校验“容器名或 ID 不能为空”；
  WSL 只校验 Linux 用户名（长度 ≤ 64，不含控制字符、冒号、斜杠、反斜杠）。
- `Jpt()` 生成 target：SSH 带可选 `sshConfigAlias` 与 `assetInstallMode`；WSL 的 distro/user 为空时
  不写入字段；Docker 取 `manualDockerContainer` 优先。
- `qpt()` 生成设置页副标题：SSH `user@host:port`；WSL 发行版名（可为空）；Docker 容器名。
- `gmt()` 生成连接页目标文本：`SSH` 为 `user@host:port`，WSL 为 `WSL · distro · user`，
  Docker 为 `Docker · container`。
- 设备列表 `nVn` 分组顺序：已保存设备 → SSH config Host → WSL 发行版 → 运行中的容器；
  底部按钮按 `availableKinds` 渲染（Windows 才有 WSL）。
- 设置页在普通连接流程中 **不显示连接类型分段控件和 SSH config 导入**；类型由设备页的
  “新建 SSH 连接 / 手动输入 WSL / 手动输入 Docker”决定，底部为 `返回列表` + `建立连接`。


## 2.4 连接向导（3.17.2）

渲染层位于 `out/renderer/assets/styles-Dv5E6Odo.js`（2.08M–2.15M 与 5.97M–6.0M 两个区域）。
3.17.2 相对 3.16.2 的交互变化：

- **步骤条**：`nav > ol` 三步 `选择设备 / 连接 / 选择目录`，当前步 `size-4` 数字圆角方块
  （当前 `border-primary bg-primary`，完成显示对勾，连接器 `h-px w-5 bg-border`）。
- **设备页**：标题 `连接远程` + 描述；搜索框 `h-9 pl-9`（搜索设备、Host 或容器）；
  分组 已保存的设备 / SSH config 中的 Host（含 `~/.ssh/config` mono 后缀）/ WSL 发行版 / 运行中的容器；
  设备行 32px 图标块 + 名称 14/500 + mono 描述 + 右侧状态徽标；最近目录 chips 容器 `ml-13`（52px）；
  底部按钮 outline + plus 图标（新建 SSH 连接 / 手动输入 WSL / 手动输入 Docker）；
  最底部键盘提示 `Tab / ↑↓ 选择 · Enter 连接 · 点击最近目录直接打开`。
- **连接页（核心）**：标题 建立连接 + 副标题状态机
  （已取消/正在更新/连接失败 · 可重试，或调整配置后再试/已连接到 {device} · 可以选择目录了/正在通过 {method} 连接…）；
  五个阶段 `连接设备 → 识别设备 → 安装 ZCode Server → 启动并检查兼容性 → 打开项目文件夹`
  （`DI` 表 + `nyt` 状态推导），日志行 `[source-server:<tag>]` 标签映射阶段
  （probe→channel、directory-record→identify、download/preflight/upload/extract/verify-archive/verify/install→deploy、
  daemon/restart/publish-online/protocol-handshake→handshake、workspace→workspace）；
  每阶段右侧显示耗时 `N s`（complete/active）；每阶段子消息状态机（`iyt`）：
  channel complete → 已连接 SSH 主机/发行版/容器；identify → 已连接到设备 {device}/新设备 · ZCode Server 未安装；
  deploy → 安装失败：{reason}/等待安装确认…/正在下载安装包/正在上传安装包/正在解压安装包/正在校验安装包/正在校验服务端文件/已安装；正在启动连接；
  handshake restart → 正在重启远端服务；workspace → 正在读取 {path}。
- **安装确认卡**（deploy 阶段内）：`需要安装 ZCode Server` + dl 网格
  （目标账号 user@host:port / 安装版本 / 安装位置 / 安装包占用空间 MB）+ `安装并继续` / `取消`。
  插件对应实现：`/ssh-remote/hosts/runtime-check`（present/version/installPath/npm dist.unpackedSize）。
- **错误卡**：标题 + 原因 + 降级提示 + `<details>` 错误详情（pre + 复制）+ 操作按钮
  （状态机 primary：重试/修改认证/返回连接/检查更新…；凭据缺失时内联密码/口令输入）。
- **传输进度**：日志出现 `NN%` 或 `x MB, y MB/s` 时显示进度条 `h-1 max-w-sm` + 预计剩余 {seconds} 秒。
- **连接日志面板**：`连接日志 {count} 行`（可折叠）+ `复制日志` + 日志框 max-h-48 mono，
  行格式 `[INFO] msg`，空态 `[INFO] 等待连接日志输出...`；进度行按 key 去重（`uGn`）。
- **页脚状态机**：进行中 [在后台继续(带图标)] [取消连接]；失败 [返回列表(无图标)] [关闭]；
  已取消 [在后台继续] [重试]。
- **最小化卡片**（`b7`，侧边栏内 `data-background-connection`）：标题 + 百分比 + 进度条 h-1
  + 阶段名/点击恢复连接向导 + 下划线 继续/查看或处理 + 取消此连接/关闭。
- **设置页**：标题 新建连接（`device-management` 模式，见 §2.5.1）；SSH：已关联 Host chip（解除关联 + 修改任一字段自动解除关联提示）、
  主机+端口两列（粘贴识别 `ssh -p N user@host` / `user@host:port`，成功提示 已识别 {target}）、
  用户名、认证分段、密码眼睛、私钥选择文件、口令；高级选项（chevron 折叠）内含
  资源下载方式分段（本地下载后上传 / 远端服务器下载）；SSH config 导入位于类型行的右侧下拉
  （搜索 + alias/user@host:port 两行列表，仅 device-management 模式）；
  WSL：发行版 datalist + 检测计数提示链；Docker：选择/手动分段 + 容器浮层（搜索+图标+对勾）。
  页脚 取消 + 添加并连接（busy 时 spinner + 正在连接）。
- **目录页**：已连接横幅（已连接 · {profile/kind} · v{version}）、设备名称重命名行（hint/已保存/保存失败，请重试）、
  最近 + 远端记录 两组快捷 chips、内嵌浏览器、`将打开 {path}`、页脚
  [稍后选择(mr-auto)] [上一步] [在此目录打开工作区（浏览器确认目录存在前禁用）]。
- **新流程语义**：保存的 SSH 设备点击直连；SSH config Host 点击 → 设置页预填；WSL 发行版 / Docker 容器
  点击 → 设置页预填；目录已是工作区时"在此目录打开工作区"复用现有工作区而不是报错。

## 2.5 三个 1:1 界面（3.17.2 渲染层）

3.17.2 的「新建连接」「创建项目」「选择文件夹」不是三个独立弹窗组件，而是两套外壳的三种模式。
组件名均为压缩后的局部名，位置以 `styles-Dv5E6Odo.js` 的字节偏移标注。

### 2.5.1 新建连接（设置 → 远程设备）

- 外壳：`FGn` @6035100（`PGn` 向导 hook 的渲染层）。
  `Hb` 弹窗：`top-[10vh] max-w-2xl max-h-[calc(90dvh-1rem)] rounded-2xl p-0`，内容 `p-4 sm:p-6 gap-3 sm:gap-4`。
- 模式：`completion === 'device-management'`。此时 `OGn` @5999711 的表头为
  `flex items-start justify-between gap-4`：左侧标题（`Gb`，`text-ui-lg font-medium`）+ 可选描述，
  右侧仅关闭按钮；没有 stepper，也没有最小化。
- 表单：`fyt` @2133776，字段实现在 `Kvt` @2094437。
  - 首行 `flex flex-wrap items-center justify-between gap-2`：
    左 `xI` 分段（`remote.connectionType`，SSH/WSL/Docker，选中 `bg-selected`，32px 高）；
    右 SSH 专用 `Gvt` @2091519 下拉（`w-80`、搜索框 `h-8`、alias 两行 `alias` + mono `user@host:port`）。
  - SSH 已关联时显示 `已关联 Host {alias}` chip（h-7、圆角 6、SSH 配色）+ 解除关联图标钮 +
    `修改任一字段会自动解除关联`；任一连接字段变更即清除关联。
  - SSH 字段：主机 | 端口 `grid-cols-[minmax(0,1fr)_6rem] gap-3`；用户名；认证方式分段；
    密码（眼睛）或私钥（文件选择 + 口令）；高级选项折叠（chevron 右→下）。
  - 高级选项内容 `space-y-3 pt-2`：资源下载方式 `xI`（可换行）：
    `本地下载后上传` / `远端服务器下载`，下方 `ssh.assetInstallModeDescription` 原文。
  - WSL：发行版 datalist（placeholder 默认发行版）+ `暂未检测到 WSL 发行版…`/检测数量提示；
    Linux 用户（placeholder 默认用户）+ 说明 + root 警告。
  - Docker：选择运行中的容器 | 手动输入容器 分段；选择模式为 outline 触发器 + 弹出层
    （搜索框 + 容器行 + 对勾）；手动模式为输入框 + 列表不完整提示。
  - 页脚：`mt-5 flex items-center gap-2 border-t border-border pt-4 justify-end`，
    `取消`（ghost, h-9 px-4）+ `添加并连接`（default, h-9 px-4）；busy 时 spinner + 正在连接。

### 2.5.2 创建项目

- 组件：`Jyt` @2182283 → `jI` @2149184；弹窗 `Hb` `max-w-lg gap-5`，内容 padding 16。
- 标题 `Gb` = `project.create`；描述仅 sr-only。
- 字段：
  - 项目名称：label `text-ui-sm font-medium`，input `h-9 rounded-lg`，placeholder `新项目`，autoFocus。
  - 设备：自绘 Select（触发器 h-9 圆角 8、`AI` 设备标签：图标 + 名称 + 右侧状态点/文字）。
    菜单项：此电脑、已保存设备（状态点）、分隔线、`＋ 添加远程设备…`。
  - 设备状态映射 `kA` @1684945：online（绿点）/offline（空心点）/connecting（转圈）/pending（黄点）/
    failed（红点）；online 的文字仅 sr-only。
  - 远程设备始终显示 `这台设备上已有项目？ 添加到侧栏 >`（`project.existingOnDeviceHint/Action`），
    点击后列出现有项目；无项目时显示 `此设备上没有已有项目`。
  - 源文件夹：legend `源文件夹`；已有根目录为 `border divide-y` 列表（48px 行、主要徽标/设为主要、移除）；
    空态为 `min-h-32` 虚线框 + 36px 圆形 folder-plus 图标 + 标题 + 提示。
    离线设备标题为 `连接并选择文件夹`，提示 `设备当前{status}，点击后先连接`。
  - 页脚：取消 + 创建项目（本地/远程都要求恰好 1 个根目录；远程根目录多于/少于 1 时禁用）。

### 2.5.3 选择文件夹

- 同一 `jI` 弹窗切到 browse 模式：标题 `project.browse`（选择文件夹），正文
  `flex h-96 min-h-0 flex-col gap-2`，内嵌 `fI` @2075240。
- `fI` 结构：
  - 路径表单：输入框 `h-9 font-mono` + `跳转`（secondary h-9）+ `显示隐藏目录/收起隐藏目录`
    （ghost/secondary，`aria-pressed`）。
  - 列表：`rounded-lg border border-border bg-background`，`..` 行 h-10，目录行 px-3 py-2，
    空态 `无子目录`，读取失败显示错误文案。
  - 内嵌页脚：`mt-3 flex justify-end gap-2`，取消（secondary）+ 选择文件夹（default），
    均 `h-10 px-5`；目录未就绪或读取失败时禁用。
- 根目录选定后回到创建项目视图，显示主要徽标与项目名。

### 2.5.4 资源下载方式（后端语义）

- 主机字段 `assetInstallMode`：`local-download-upload`（默认）/ `remote-download`，随 host 持久化。
- 本地模式：Node 官方 tarball 在本机下载并按 10% 粒度打 `[ssh-remote:download]` 日志，
  SFTP 上传（同样 10% 粒度 `[ssh-remote:upload]`），远端解压；
  dsh 运行时在本机 `npm install --os=<linux|darwin> --cpu=<arch>` 打包后上传解压。
- 远端模式：保留服务器 `curl/wget/node` 下载与远端 npm 安装。
- 本机缺少 npm/tar 时回落到远端安装，并在连接日志写入原因，不静默改变用户选择。

## 3. 远程资产部署

实现位于 `out/main/chunk-YQKAE4PN.js`。

- 远程根：`${ZCODE_SERVER_RUNTIME_ROOT:-$HOME/.zcode/server}`。
- 部署内容：
  - Node 运行时：`<root>/node`
  - 远程 agent bundle：`<root>/agents/<agentId>/zcode.cjs`
  - wrapper：`<root>/agents/<agentId>/zcode`（即 `remoteWrapperPath`）
  - 版本文件、官方插件资产、SHA256 校验
- wrapper 原文：

```sh
#!/bin/sh
set -eu
runtime_root="${ZCODE_SERVER_RUNTIME_ROOT:-$HOME/.zcode/server}"
exec "$runtime_root/node" "$HOME/.zcode/server/agents/${agentId}/zcode.cjs" "$@"
```

- 安装/更新判定：
  - 远程 `node` 版本与本地运行时资源目录比对；
  - `zcode.cjs` 存在且 SHA256 与本地一致；
  - 官方插件资产完整；
  - 否则上传/解包并重启远程 agent。
- 资产打包：内置 tar 写入/解包（含路径穿越防护、symlink 目标校验、权限与 mtime 保留）。

## 4. 远程工作区会话

主进程与 host 进程通过消息协议协作（`out/host/index.js`、`out/main/index.js`）：

- 消息类型：`connect-remote-workspace`、`cancel-remote-workspace-connect`、
  `bind-remote-workspace-context`、`dispose-remote-workspace-session`。
- 事件：`remote-workspace-connection-log`、`remote-workspace-connected`、
  `remote-workspace-context-bound`、`remote-workspace-context-bind-failed`、
  `remote-workspace-reconnected`、`remote-workspace-connect-failed`、
  `remote-workspace-closed`、`remote-workspace-acquired`。
- target 类型：`ssh | wsl | docker | server`；`server` 表示连接已有服务器，不部署。
- 错误码集合（节选）：
  `remote-authentication-failed`、`remote-host-unreachable`、`remote-connection-timeout`、
  `remote-host-not-found`、`remote-host-key-changed`、`remote-download-failed`、
  `remote-upload-failed`、`remote-preflight-failed`、`remote-install-failed`、
  `remote-space-insufficient`、`remote-permission-denied`、`remote-connection-canceled`、
  `remote-connection-unknown`。
- 本地窗口重载后：`reattachRemoteWorkspaceSessionsForWindow(window, reason)`，把已有远程
  会话重新挂回渲染进程；窗口关闭时 `disposeRemoteWorkspaceSessionsForWindow`。
- 本地只保留会话描述与状态；真正的 agent、文件系统、终端都在远端运行。

## 5. 与本插件的映射

| ZCode 概念 | dsh-ssh-remote 实现 |
|---|---|
| `SSHBackend`（ssh2 + keyboard-interactive + keepalive） | `lib/ssh.js`：同样的连接参数、错误归类、TOFU 主机密钥、SFTP 上传 |
| `WSLBackend`（`wsl.exe --exec bash -lc`、UNC 上传、身份解析） | `lib/local.js` 的 `WSLBackend`：同样的参数顺序、UTF-16LE 解码、发行版解析、UNC/cat 回退 |
| `DockerBackend`（`docker exec -i ... sh -lc`、`docker ps --format {{json .}}`） | `lib/local.js` 的 `DockerBackend`：同样的可执行文件解析、容器匹配与状态检查、stdin 上传 |
| `createRemoteBackend` 按 kind 分派 | `lib/targets.js` 的 `TargetPool`：SSH/WSL/Docker 统一 `exec/run/upload/writeFile/listDirs/probe` |
| 远程 Node 运行时 + `zcode.cjs` | 远程 `~/.dsh-remote/runtime/dsh-<version>`（npm 安装 `@deepseek-ai/dsh`） |
| wrapper + 远程 agent 启动 | `~/.dsh-remote/workspaces/<id>/run/start.sh` + systemd unit / setsid |
| 远程资产 SHA/版本校验 | dsh package.json 版本 + `lib/bin.js` 存在性校验 |
| 远程会话事件 / 重连 | 本地 `state.json` + 周期性 `systemctl show` / `ps` / HTTP / journal 状态轮询 |
| 远程 agent 协议 | `lib/bridge.js` 在远端用 `dsh --profile headless --json` 执行每个本地会话，事件流回本地原生对话 |
| 远程 token + SSH 通道 | 不再使用：控制台代理和 `forwardOut` 隧道已删除 |
| 原生工作区列表 | `lib/native.js` 用本地 anchor 目录把远程工作区投影成原生行；`uiWorkspace.openWorkspace` 负责选中 |
| 本地窗口重载重挂 | 插件重启后从 `state.json` 恢复工作区、重新轮询，并清理无主 anchor 行 |
| 多类型 target | 当前只实现 `ssh`（Linux 远程） |

### 差异

- ZCode 把自研远程 agent 的协议跑在 SSH 通道上，本地 UI 直接消费远程会话；
- 本插件按需求选择「远程常驻 + 本地原生对话」的形态：
  - 远程用官方 `dsh --profile web` 作为常驻服务，`dsh --profile headless --json` 执行会话；
  - 本地通过原生工作区行和原生对话消费远程事件，不镜像文件；
  - 本地只负责选择目录、监控状态和触发生命周期操作；
  - 没有控制台代理、端口转发或 token 缓存。

## 5.1 UI 交互逆向

除后台协议外，`rea` + 手工阅读还原了 ZCode 的连接向导弹窗（`OVn`/`DVn`/`Gpt` 外壳）：

| 组件 | 位置 | 交互结论 |
|---|---|---|
| `nVn` | 设备选择 | 搜索；已保存设备行可**直接点击连接**，行下挂最近 3 个 `workspaceHistory` 目录（点击直接打开）；`~/.ssh/config` Host 单独分组；底部按 `availableKinds` 渲染「新建 SSH 连接」；支持 ↑↓ 在按钮间移动 |
| `fyt` / `Kvt` | 新建连接 | 普通向导由设备页决定类型（设置页无类型分段）；`device-management` 模式额外显示 SSH/WSL/Docker 分段 + `从 SSH config 导入` 下拉，页脚 取消 / 添加并连接（§2.5.1）。SSH：主机/端口两列、用户名、密码/私钥分段、高级选项（资源下载方式）；WSL：发行版 datalist + Linux 用户提示/root 警告；Docker：选择运行中的容器 / 手动输入容器分段 + 容器搜索浮层 |
| `hmt` | 建立连接 | 阶段 + 实时日志；可收起，后台继续；失败可重试；标题副文案随已连接/失败/更新中变化 |
| `Cmt` | 选择目录 | 顶部绿色「已连接」+ 版本；设备重命名；「最近」和「远端记录」快捷目录；内嵌目录浏览器；底部「将打开 {path}」；稍后选择 / 上一步 / 在此目录打开工作区 |
| `xVn` / 浮层 | 最小化 | 收起后连接继续，侧边栏底部浮层显示 `正在连接…` / `连接已完成`，点击恢复向导 |

视觉层同样取自 ZCode 自身：

| 视觉令牌 / 原子组件 | ZCode 来源 | 复刻方式 |
|---|---|---|
| 弹窗实测 | `OVn`：`top-[10vh] max-w-2xl max-h-[calc(90dvh-1rem)] rounded-2xl border bg-popover shadow-md`，内容 `p-4 sm:p-6 gap-3 sm:gap-4` | `.zc-dialog` / `.zc-body` 使用相同数值 |
| 设计令牌 | `styles-CDRCIIoN.css`：`--color-popover/-border/-surface/-hover/-input/-primary/-secondary/-selected/-success-surface/-warning-surface/-destructive-surface/-remote-ssh-*`、`--remote-foreground-muted`、`--text-ui-*`、`--radius-*` | `.zc-ui` 内逐项定义；默认浅色，`body[data-ds-dark-theme] .zc-ui` 下切换为 ZCode `.dark` 值 |
| 字体 | `--font-sans` / `--font-mono`（含 CJK 回退） | `.zc-ui` 使用相同字体栈；`--ui-font-size: 14px` |
| 按钮 | `button-CPX3QH28.js` 的 variant/size（default/outline/secondary/ghost，h-7/h-6/h-8/icon-sm） | `.zc-btn` + `zc-btn-*`，主按钮为 ZCode 的单色 `primary`（深色主题白底黑字） |
| 状态徽标 | `qot` + `Bj` + 状态色表（success/progress/neutral/warning/danger） | `.zc-badge` + `zc-badge-*`，含 6px 圆点与 24px 高度 |
| 设备行 | `e7`：32px 图标块、名称 14/500、mono 12 描述、右侧状态徽标 | `.zc-device` 系列 |
| 分段控件 | `UP`：`rounded-lg border-input-border`，选中 `bg-selected` | `.zc-seg` |
| 阶段列表 | `hmt`：20px 圆圈、连接线、active `bg-surface`、时长 10px | `.zc-phase` 系列 |
| 目录浏览器 | `FP` 内嵌模式：路径表单 + 前往/隐藏文件 + `..` 行 | `.zc-browser` 系列 |
| 最小化浮层 | `Q5`：标题、百分比、进度条、下划线操作、取消链接 | `.zc-pill` 系列 |

本插件的对应实现：

- `nVn` → 设备列表 + `workspacesFor(host)` 最近目录 chips + 铅笔编辑 + 固定底部新建按钮；
- `hmt` → 模块级 `backgroundFlow` + `shell.overlay` 浮层（关闭向导不丢连接）；
- `Cmt` → 已连接横幅、设备重命名、最近目录、`将打开`、`RemoteBrowser`；
- 打开动作直接调用 DSH 的 `uiWorkspace.openWorkspace(nativeWorkspaceId)`，落到原生工作区，而不是再造一个成功弹窗。

## 5.2 项目行与流式会话

ZCode 的项目行（`styles-Dv5E6Odo.js` 的 `virtual-project-row`）是「图标 + 名称 + 设备名」的横排：

```js
<div data-testid="virtual-project-row" class="... flex h-8 items-center gap-1 ...">
  <span class="flex size-4 ...">              // 图标位
    <oM presentation={remoteStatus} project /> // cloud/cloud-off/cloud-alert/cloud-x/spinner
  </span>
  <span class="flex min-w-0 items-baseline gap-2">
    <span class="truncate text-ui-base ...">{project.name}</span>
    <span data-testid="project-device" class="max-w-24 truncate text-ui-sm text-remote-foreground-muted">
      {deviceName}
    </span>
  </span>
  ...actions (menu/edit/pin/delete, new task)
</div>
```

- 云朵状态来自 `kA`：online → `cloud`；starting/reconnecting → `loader-circle`（`animate-spin`）；offline/stopped → `cloud-off`；failed → `cloud-x`（云 + 右下角 x）。项目行里 online 云朵用 `text-remote-foreground-muted`。
- 悬停操作由 `virtual-project-actions` 渲染：`device-settings`、`edit`、`pin/unpin`、`delete`（危险色）。删除文案强调「只从本机移除，{device} 上的项目及其他客户端不受影响」。
- ZCode 没有按工作区的「启动/停止/日志」按钮；生命周期自动管理，日志在设备管理里查看。

DSH 侧有两个约束：

1. 原生 workspace row 没有 icon/badge 字段（`workspaceView()` 只有 path/title/sessionIds/时间），行由 `@deepseek-ai/dsh-client-ui-workspace` 渲染。插件只能按 `data-row-key="workspace:<id>"` 做幂等 DOM 装饰：替换 folder SVG、追加 device span、隐藏原生 rowActions 并注入自己的菜单。
2. `dsh --profile headless --json` 的 `text`/`thinking` 只在 step 的 `assistant/message` 提交时写出（`dsh-headless/lib/json-stream` 的 `projectJsonRun`），本身不产生 token 增量。真正的流式需要 profile 内投影插件监听 `agent/assistant-stream`，把帧写到 stdout；本地 bridge 再把帧转成原生 `SessionAssistantStreamFrame`（`start`/`chunk`/`end`），并在 step 结束时用 durable `assistant/message` 的 `seq` 结算。

DSH 的帧形状（`dsh-api-session-controller`）：

```ts
type SessionAssistantStreamFrame =
  | { type: 'start'; attemptId: LlmAttemptId; revision: number; startedAfterSeq: number; turn: number; step: number }
  | { type: 'chunk'; attemptId: LlmAttemptId; revision: number; index: number; time: number; chunk: JsonValue }
  | { type: 'end'; attemptId: LlmAttemptId; revision: number; index: number;
      outcome: { kind: 'committed'; eventType: 'assistant/message' | 'assistant/attempt'; seq: number } | { kind: 'abandoned' } }
```

`revision` 必须从 1 连续递增，`chunk.index` 是帧序号（块下标在 `chunk.index` 里），`end.index` 必须等于已发 chunk 数；`end.outcome.seq` 指向本地 `assistant/message` 的 durable seq，否则客户端会 rebaseline。

### 5.3 3.17.2 源码级还原（2026-11 安装版）

本次直接从未打包的渲染层源码（`out/renderer/assets/styles-n-UNIiNg.js`，含 JSX 与组件定义）和编译后的 `styles-CDRCIIoN.css` 取值，不再依赖截图推断。

**项目行 `virtual-project-row`（`ProjectRowItem`）**

```jsx
<div data-testid="virtual-project-row" tabIndex={0}
     className="group/project-row ml-2 flex h-8 min-w-0 items-center gap-1 rounded-lg pr-1 hover:bg-surface-hover">
  <span className="flex min-w-0 flex-1 shrink-0">
    <button data-testid="virtual-project-toggle"
            className="... flex h-8 min-w-0 flex-1 justify-start gap-2 rounded-lg pl-2.5 pr-1 ...">
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {/* remote: <Aj presentation={status} project />, local: folder icon */}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-ui-base text-foreground-subtle">{project.name}</span>
        <span data-testid="project-device"
              className="max-w-24 truncate text-ui-sm text-remote-foreground-muted">{deviceName}</span>
      </span>
      {/* 非 online 时追加 <span data-testid="project-status-label" class="text-ui-sm ...">离线/连接中</span> */}
    </button>
  </span>
  <div data-testid="virtual-project-actions"
       className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity
                  group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100
                  [&:has([data-state=open])]:opacity-100 [@media(hover:none)]:opacity-100">
    ...menu（MoreHorizontal）→ 设备设置/编辑/置顶/删除/移除条目
    ...files（仅多根目录时下拉，否则直接打开文件树）
    ...create-task（仅在 online 时渲染）
  </div>
</div>
```

关键取值（浅色 / 深色）：

| 元素 | 类 | 计算值 |
|---|---|---|
| 行 | `h-8` `gap-1` `rounded-lg` `ml-2` `pr-1` | 32px 高、4px 间距、8px 圆角、左外 8px、右内 4px |
| 图标位 | `size-4` | 16×16，图标 16px |
| 名称 | `text-ui-base text-foreground-subtle` | 14px / `#40404099`（60% 透明）→ 白底约 `#8c8c8c` |
| 设备 | `text-ui-sm text-remote-foreground-muted` `max-w-24` | 12px / `#595959`（深色 `#b3b3b3`），最宽 96px |
| 图标色（online） | `text-remote-foreground-muted` | `#595959` / `#b3b3b3`，**不是蓝色** |
| 图标色（connecting） | `text-progress-surface-foreground` | 蓝色 + `animate-spin` |
| 图标色（failed） | `text-destructive` | 红色 `cloud-x`（云 + 右下角 x） |
| 操作区 | `gap-1` `opacity-0` → hover `opacity-100` | 4px 间距，悬停淡入（不是 display 切换） |
| 操作按钮 | `size: icon-sm` + 图标 `size-3.5` | 24×24 按钮、14px 图标 |

`text-ui-base` 来自 `--ui-font-size:14px`；`--spacing:.25rem`。

**状态模型（`tA`）**：`online → cloud`；`bootstrapping/retrying/connecting/updating → spinner`；`needs-install/needs-upgrade/needs-identity/pending → cloud-alert`；`failed/error → cloud-x`；其余 → `cloud-off`。在线项目行的云朵强制 `text-remote-foreground-muted`。

**设备行（连接向导「已保存的设备」，`e7`）**

```jsx
<button class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover">
  <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-remote-foreground-muted">
    {/* ssh: cloud / wsl: monitor / docker: box */}
  </span>
  <span class="min-w-0 flex-1">
    <span class="block truncate text-ui-base font-medium">{displayName}</span>
    <span class="block break-all font-mono text-ui-sm text-remote-foreground-muted">{target}</span>
  </span>
  {/* 状态徽标：h-6 rounded-md border px-2 text-ui-xs font-semibold + 6px 圆点 */}
</button>
```

状态徽标文案（`remote.status.*`）：`已连接` / `未连接` / `连接中`。

**设置页「远程设备」文案**：标题 `远程设备`；说明 `管理已连接的服务器、WSL 发行版和 Docker 容器。`；分组标题 `设备`；空态 `还没有远程设备连接。`；操作 `编辑` / `移除连接` / `设为默认连接`；时间 `上次成功 {time}`、`最近在线 {time}`。

**行菜单文案**：`新建任务`、`查看文件`、`远程设备设置`、`编辑项目`、`删除项目`。

> 旧版本（`styles-Dv5E6Odo.js`）的结论仍然成立，但颜色值以 3.17.2 安装版为准：项目名是 subtle 灰、设备名是 remote muted 灰、云朵 online 是 muted 灰而不是品牌蓝。

## 6. 关键源码位置

| 文件 | 内容 |
|---|---|
| `out/main/chunk-SDG2IUX5.js`（3.17.2） | `SSHBackend`、SFTP/exec 上传、detect、错误归一化 |
| `out/main/chunk-VRJQY4BA.js`（3.17.2） | `WSLBackend`、`buildWslArgs`、`listWSLDistros`、WSL 身份标记探测 |
| `out/main/chunk-ZHR5V36R.js`（3.17.2） | `DockerBackend`、Docker 可执行文件解析、`docker ps -a` 容器列表 |
| `out/host/chunk-IVUCKMN5.js`（3.17.2） | host 进程侧 `SSHBackend` 导出 |
| `out/host/chunk-RLEO6HKG.js`（3.17.2） | host 进程侧 Docker backend |
| `out/main/chunk-EWG2DB7O.js`（3.17.2） | 远程资产、tar 打包/解包、wrapper、版本/SHA 校验、`assetInstallMode` |
| `out/main/index.js` | `RemoteWorkspaceSession`、连接/绑定/释放、窗口重挂 |
| `out/host/index.js` | 远程会话消息处理、SSH backend 选择、remote workspace service |
| `out/renderer/assets/styles-n-UNIiNg.js`（3.17.2 安装版） | 渲染层主 bundle（含未拆分的 JSX 源码）：`ProjectRowItem`/`virtual-project-row`、`Aj` 云朵、`tA` 状态映射、`e7` 设备行、`zYn` 远程设备设置页、`$P` 项目编辑器、`FP` 目录浏览器 |
| `out/renderer/assets/styles-CDRCIIoN.css`（3.17.2 安装版） | 实际 Tailwind 产物：`--ui-font-size:14px`、`--spacing:.25rem`、`--color-remote-foreground-muted`、`--color-foreground-subtle`、`--color-surface-hover` 等令牌 |
| `out/renderer/assets/IntlProvider-C2IbGUkl.js`（3.17.2 安装版） | `remote.*` / `ssh.*` / `project.*` / `settings.source.*` / `directoryBrowser.*` 交互文案 |
