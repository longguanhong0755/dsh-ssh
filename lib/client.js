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

    // ── i18n ───────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'panel.title': 'SSH 远程',
        'panel.heading': '远程设备',
        'panel.sub': '管理已连接的服务器、WSL 发行版和 Docker 容器。',
        'panel.empty': '还没有远程设备。点击「新建连接」添加第一台机器。',
        'panel.new': '新建连接',
        'panel.refresh': '刷新',
        'panel.loading': '加载中…',
        'panel.error': '错误',
        'panel.host': '主机',
        'panel.path': '远程目录',
        'panel.state.running': '运行中',
        'panel.state.starting': '启动中',
        'panel.state.stopped': '已停止',
        'panel.state.error': '异常',
        'panel.state.unreachable': '主机不可达',
        'panel.state.unknown': '未知',
        'panel.uptime': '运行',
        'panel.mem': '内存',
        'panel.cpu': 'CPU',
        'panel.service': '服务',
        'panel.start': '启动',
        'panel.stop': '停止',
        'panel.restart': '重启',
        'panel.logs': '日志',
        'panel.remove': '删除',
        'panel.removeConfirm': '删除远程工作区「{name}」？会停止并移除远程服务，但保留远程项目目录。',
        'panel.copied': '已复制',
        'panel.auto': '自动刷新',
        'panel.noHosts': '还没有 SSH 主机。点击「新建连接」添加第一台机器。',
        'row.newSession': '新建会话',
        'row.more': '更多操作',
        'row.connecting': '连接中',
        'row.offline': '离线',
        'row.failed': '连接失败',
        'row.edit': '编辑',
        'row.delete': '删除项目',
        'row.renameTitle': '编辑项目',
        'row.name': '项目名称',
        'row.deleteTitle': '删除项目',
        'row.deleteBody': '只从本机移除，{device} 上的项目及其他文件不受影响。',
        'row.deleting': '正在移除…',
        'row.renameFailed': '重命名失败',
        'row.removeFailed': '删除失败',
        'panel.defaultPort': '端口',
        'panel.http': 'HTTP',
        'panel.lastCheck': '检测于',
        // ZCode-style connect flow
        'z.title.device': '连接远程',
        'z.desc.device': '选择保存过的连接，或添加一个新的连接。',
        'z.search': '搜索设备、Host 或容器',
        'z.saved': '已保存的设备',
        'z.sshHosts': 'SSH config 中的 Host',
        'z.empty': '没有匹配的设备，可从下面新建连接。',
        'z.newSsh': '新建 SSH 连接',
        'z.keyboard': 'Tab / ↑↓ 选择 · Enter 连接 · 点击最近目录直接打开',
        'z.title.settings': '新建连接',
        'z.type': '连接方式',
        'z.ssh': 'SSH',
        'z.wsl': 'WSL',
        'z.docker': 'Docker',
        'z.onlySsh': '当前插件仅支持 SSH 连接',
        'z.newWsl': '手动输入 WSL',
        'z.newDocker': '手动输入 Docker',
        'z.wslSection': 'WSL 发行版',
        'z.dockerSection': '运行中的容器',
        'z.wslDistro': '发行版',
        'z.wslDefaultDistro': '默认发行版',
        'z.wslUser': 'Linux 用户',
        'z.wslDefaultUser': '默认用户',
        'z.wslUserDescription': '留空使用 发行版 默认用户；填写 root 或其他已存在的 Linux 用户后，将以该用户运行 WSL 命令。',
        'z.wslRootWarning': 'Root 模式会以 root 运行远程 host、agent 和终端；本次会话创建的文件可能归 root 所有。',
        'z.wslInvalidUser': 'Linux 用户名不能包含控制字符、冒号、斜杠或反斜杠，且长度不能超过 64 个字符。',
        'z.wslLoading': '正在检测 WSL 发行版...',
        'z.wslDetected': '当前设备检测到 {count} 个发行版。',
        'z.wslNoDistros': '暂未检测到 WSL 发行版；如果本机已安装 WSL，仍可继续连接默认发行版。',
        'z.dockerContainer': '容器',
        'z.dockerContainerPlaceholder': '输入容器名或 ID，例如 my-container',
        'z.dockerManualHint': '如果运行中的容器列表不完整，可以手动输入容器名或 ID 连接。',
        'z.dockerSelectContainer': '选择正在运行的容器',
        'z.dockerLoading': '正在检测运行中的容器...',
        'z.dockerUnavailable': 'Docker 不可用',
        'z.dockerNoContainers': '没有运行中的容器',
        'z.dockerInputSelect': '选择运行中的容器',
        'z.dockerInputManual': '手动输入容器',
        'z.dockerRequired': '容器名或 ID 不能为空',
        'z.optionsLoadFailed': '加载本机运行环境列表失败，你仍然可以手动输入连接目标。',
        'z.phase.wsl': '正在启动并连接发行版',
        'z.phase.docker': '正在连接容器',
        'z.phaseSub.ssh': '已连接 SSH 主机',
        'z.phaseSub.wsl': '已连接发行版',
        'z.phaseSub.docker': '已连接容器',
        'z.wslDesc': 'WSL',
        'z.import': '从 SSH config 导入',
        'z.importEmpty': '未发现 SSH config Host',
        'z.host': '主机',
        'z.hostPlaceholder': '输入主机地址或 IP，例如 192.168.1.100',
        'z.port': '端口',
        'z.username': '用户名',
        'z.usernamePlaceholder': '输入用户名，例如 root',
        'z.auth': '认证方式',
        'z.password': '密码',
        'z.privateKey': '私钥',
        'z.passwordPlaceholder': '输入 SSH 密码',
        'z.keyPlaceholder': '选择或输入私钥文件路径',
        'z.passphrase': '私钥口令（可选）',
        'z.passphrasePlaceholder': '输入私钥口令',
        'z.showPassword': '显示密码',
        'z.hidePassword': '隐藏密码',
        'z.advanced': '高级选项',
        'z.advancedAlias': 'SSH config 别名',
        'z.advancedHint': '从 ~/.ssh/config 填充主机、端口、用户名和私钥路径；手动修改任一字段将解除关联。',
        'z.validation.host': '请输入主机',
        'z.validation.username': '请输入用户名',
        'z.validation.port': '端口须为 1–65535 的整数',
        'z.validation.password': '密码不能为空',
        'z.validation.key': '私钥路径不能为空',
        'z.cancel': '取消',
        'z.addAndConnect': '添加并连接',
        'z.startConnection': '建立连接',
        'z.title.connecting': '建立连接',
        'z.desc.connecting': '正在通过 SSH 连接…',
        'z.desc.connected': '已连接到 {device} · 可以选择目录了',
        'z.desc.failed': '连接失败 · 可重试，或调整配置后再试',
        'z.connectingVia': '正在通过 {method} 连接…',
        'z.backToList': '返回列表',
        'z.renameFailed': '保存失败，请重试',
        'z.chooseKeyFile': '选择私钥文件',
        'z.phase.ssh': '正在连接 SSH 主机',
        'z.phase.env': '校验远程环境',
        'z.phase.deploy': '部署 dsh 运行时',
        'z.saving': '保存连接',
        'z.minimize': '收起 — 连接将继续进行',
        'z.title.directory': '选择目录',
        'z.desc.directory': '在 {method} 上选择一个目录作为工作区。',
        'z.back': '上一步',
        'z.openHere': '在此目录打开工作区',
        'z.wizard': '远程连接',
        'z.wizard.device': '选择设备',
        'z.wizard.connect': '连接',
        'z.wizard.directory': '选择目录',
        'z.connectionLog': '连接日志',
        'z.copyLog': '复制日志',
        'z.logLines': '{count} 行',
        'z.logEmpty': '等待连接日志输出...',
        'z.cancelConnection': '取消连接',
        'z.phase.identify': '识别设备',
        'z.phase.handshake': '启动并检查兼容性',
        'z.phase.workspace': '打开项目文件夹',
        'z.phaseSub.identifyExisting': '已连接到设备 {device}',
        'z.phaseSub.identifyNew': '新设备 · dsh 运行时未安装',
        'z.phaseSub.uploadFailed': '安装失败：{reason}',
        'z.phaseSub.downloading': '正在下载安装包',
        'z.phaseSub.uploading': '正在上传安装包',
        'z.phaseSub.extracting': '正在解压安装包',
        'z.phaseSub.verifyingArchive': '正在校验安装包',
        'z.phaseSub.verifyingFiles': '正在校验服务端文件',
        'z.phaseSub.installed': '已安装；正在启动连接',
        'z.phaseSub.deployWaitingConfirm': '等待安装确认…',
        'z.phaseSub.restarting': '正在重启远端服务',
        'z.phaseSub.readyOnline': '设备在线；工作区历史就绪',
        'z.phaseSub.workspaceReading': '正在读取 {path}',
        'z.install.title': '需要安装 dsh 运行时',
        'z.install.target': '目标账号',
        'z.install.version': '安装版本',
        'z.install.location': '安装位置',
        'z.install.size': '安装包占用空间',
        'z.install.confirm': '安装并继续',
        'z.install.unknown': '暂无法获取',
        'z.errorDetails': '错误详情',
        'z.copyError': '复制错误',
        'z.backToConnection': '返回连接',
        'z.pasteRecognized': '已识别 {target}',
        'z.closeWindow': '关闭',
        'z.connectedTo': '已连接到 {device} · 可以选择目录了',
        'z.renameHintLong': '首次连接建议改个好记的名字，随时可在 设置 · 远程设备 修改',
        'z.connectionType': '连接类型',
        'z.search': '搜索设备、Host 或容器',
        'z.browserGo': '跳转',
        'z.browserShowHidden': '显示隐藏目录',
        'z.browserHideHidden': '收起隐藏目录',
        'z.browserNoSubdirs': '无子目录',
        'z.browserLoading': '加载中...',
        'z.browserUnavailable': '无法读取该目录',
        'z.browserParent': '..',
        'z.newFolder': '新建目录',
        'z.folderName': '目录名称',
        'z.createFolder': '创建',
        'z.refreshList': '刷新',
        'z.name': '工作区名称（可选）',
        'z.title.success': '完成',
        'z.desc.success': '远程工作区已就绪，远端任务会继续运行。',
        'z.done': '完成',
        'z.openPanel': '查看状态面板',
        'z.connecting': '正在连接…',
        'z.status.connected': '已连接',
        'z.status.offline': '未连接',
        'z.status.starting': '启动中',
        'z.status.connecting': '连接中',
        'z.status.failed': '连接失败',
        'z.recent': '最近',
        'z.editConnection': '编辑连接',
        'z.connect': '连接',
        'z.connectingDevice': '正在连接 {device}…',
        'z.phase.create': '启动远程工作区',
        'z.background': '在后台继续',
        'z.backgroundHint': '收起后连接会在后台继续',
        'z.backgroundContinue': '继续',
        'z.backgroundReview': '查看或处理',
        'z.backgroundCancel': '取消此连接',
        'z.resume': '点击恢复连接向导',
        'z.paused.device': '继续选择设备',
        'z.paused.settings': '继续配置远程连接',
        'z.paused.directory': '为 {device} 选择目录',
        'z.bgConnecting': '正在连接 {device}…',
        'z.bgFailed': '连接 {device} 失败',
        'z.bgReady': '连接已完成 · {name}',
        'z.bgPrepared': '已连接到 {device} · 选择目录',
        'z.openWorkspace': '打开工作区',
        'z.view': '查看',
        'z.renameDevice': '设备名称',
        'z.renameHint': '首次连接建议改个好记的名字',
        'z.willOpen': '将打开 {path}',
        'z.chooseLater': '稍后选择',
        'z.retry': '重试',
        'z.backToConfig': '返回配置',
        'z.openFailed': '无法打开原生工作区，请从左侧工作区列表打开。',
        'z.opening': '正在打开…',
        'z.dshVersion': 'dsh v{version}',
        'z.dirMissing': '该目录不存在；打开工作区时会自动创建。',
        // ZCode 3.17.2 connection wizard (source: remote.*/ssh.*/wsl.*/docker.*)
        'z.typeLabel': '连接类型',
        'z.importFromConfig': '从 SSH config 导入',
        'z.importLoading': '加载中...',
        'z.configAlias': 'SSH 配置别名（可选）',
        'z.configAliasPlaceholder': '不使用别名',
        'z.configAliasSearch': '搜索 SSH 配置别名',
        'z.configAliasEmpty': '当前机器未发现可用的 SSH 配置别名。',
        'z.configAliasLinked': '已关联 Host {alias}',
        'z.configAliasLinkedHint': '修改任一字段会自动解除关联',
        'z.configAliasUnlink': '解除关联',
        'z.configAliasLoadFailed': 'SSH 配置别名读取失败，仍可手动输入连接信息。',
        'z.assetInstallMode': '资源下载方式',
        'z.assetInstallMode.local-download-upload': '本地下载后上传',
        'z.assetInstallMode.remote-download': '远端服务器下载',
        'z.assetInstallModeDescription': '远端服务器下载可减少上传等待，但服务器需要能访问 ZCode CDN，并具备下载、解压和校验工具。',
        'z.dockerInputMode': 'Docker',
        'z.stopConnecting': '停止连接',
        // ZCode 3.17.2 project creation dialog (source: project.*)
        'z.project.create': '创建项目',
        'z.project.edit': '编辑项目',
        'z.project.name': '项目名称',
        'z.project.new': '新项目',
        'z.project.device': '设备',
        'z.project.thisComputer': '此电脑',
        'z.project.addRemoteDevice': '添加远程设备…',
        'z.project.existingHint': '这台设备上已有项目？',
        'z.project.existingAction': '添加到侧栏',
        'z.project.folders': '源文件夹',
        'z.project.browseHint': 'ZCode 可读取和编辑这些文件夹',
        'z.project.connectAndBrowse': '连接并选择文件夹',
        'z.project.connectAndBrowseHint': '设备当前{status}，点击后先连接',
        'z.project.addSourceFolder': '添加文件夹',
        'z.project.primary': '主要',
        'z.project.setPrimary': '设为主要',
        'z.project.removeFolder': '移除文件夹',
        'z.project.cancel': '取消',
        'z.project.save': '保存',
        'z.project.description': '组织同一主机上的文件夹。已有任务保留原工作目录。',
        'z.project.switchDevice': '切换设备？',
        'z.project.switchDeviceDescription': '将清除已选文件夹，项目名称保留。',
        'z.project.noExisting': '此设备上没有已有项目',
        'z.project.legacy': '该设备上的旧版单目录项目需要先在远程升级。',
        'z.project.deviceStatus.online': '在线',
        'z.project.deviceStatus.offline': '离线',
        'z.project.deviceStatus.connecting': '连接中',
        'z.project.deviceStatus.pending': '需要处理',
        'z.project.deviceStatus.failed': '连接失败',
        'z.project.createFailed': '创建项目失败',
        // ZCode 3.17.2 folder picker (source: directoryBrowser.*)
        'z.folder.title': '选择文件夹',
        'z.folder.pathPlaceholder': '输入路径',
        'z.folder.go': '跳转',
        'z.folder.showHidden': '显示隐藏目录',
        'z.folder.hideHidden': '收起隐藏目录',
        'z.folder.noSubdirs': '无子目录',
        'z.folder.select': '选择文件夹',
        'z.folder.opening': '正在打开…',
        'z.folder.loading': '加载中...',
        'z.folder.parent': '..',
        'z.folder.errorUnavailable': '无法打开此目录，请检查目录是否存在以及是否有访问权限，或选择其他目录。',
        'z.settings.newConnection': '新建连接',
        'z.settings.addAndConnect': '添加并连接',
        'settings.title': '远程设备',
        'settings.intro': '维护 SSH 主机。创建远程工作区时会在服务器上部署 dsh Web 运行时，并注册为系统服务；本机关闭后远程继续运行。',
        'settings.hosts': 'SSH 主机',
        'settings.devicesHeading': '设备',
        'settings.emptyDevices': '还没有远程设备连接。',
        'settings.editConnectionTitle': '编辑连接',
        'settings.editConnectionDescription': '连接信息将在下次连接时生效，不会改变已有项目和任务。',
        'settings.removeConnection': '移除连接',
        'settings.removeConnectionTitle': '移除这条连接？',
        'settings.removeConnectionDescription': '将从当前设备移除 {name} 及其保存的凭据。',
        'device.status.online': '已连接',
        'device.status.connecting': '连接中',
        'device.status.offline': '未连接',
        'device.status.failed': '连接失败',
        'settings.noHosts': '还没有主机。在下方添加。',
        'settings.add': '添加主机',
        'settings.edit': '编辑',
        'settings.delete': '删除',
        'settings.deleteConfirm': '删除主机「{name}」？',
        'settings.test': '测试连接',
        'settings.testing': '测试中…',
        'settings.testOk': '连接成功 · {latency}ms · {platform} {arch} · Node {node}',
        'settings.name': '名称',
        'settings.host': '主机名 / IP',
        'settings.port': '端口',
        'settings.username': '用户名',
        'settings.auth': '认证方式',
        'settings.password': '密码',
        'settings.passwordSaved': '已保存；留空表示不修改',
        'settings.keyPath': '私钥路径',
        'settings.passphrase': '私钥口令（可选）',
        'settings.defaultPath': '默认远程目录',
        'settings.hostKey': '主机密钥校验',
        'settings.hostKeyAcceptNew': '首次信任（accept-new）',
        'settings.hostKeyVerify': '严格校验（verify）',
        'settings.hostKeyOff': '关闭校验（off）',
        'settings.save': '保存',
        'settings.saved': '已保存',
        'settings.cancel': '取消',
        'settings.runtime': '部署默认值',
        'settings.dshVersion': '远程 dsh 版本',
        'settings.nodeVersion': '便携 Node 版本（无 Node 时）',
        'settings.registry': 'npm 镜像',
        'settings.poll': '状态刷新间隔（毫秒）',
        'settings.syncCredentials': '默认同步本地模型凭证（.credentials.yaml）',
        'settings.createIfMissing': '默认自动创建不存在的远程目录',
        'settings.language': '界面语言',
        'settings.zh': '中文',
        'settings.en': 'English',
        'settings.dataDir': '数据目录',
        'settings.note': '密码以 0600 权限保存在本机数据目录；不会回显已保存的密码。',
        'picker.title': '选择工作区目录',
        'picker.local': '本机',
        'picker.remote': 'SSH 远程',
        'picker.localIntro': '选择本机目录作为普通 DSH 工作区。',
        'picker.remoteIntro': '选择一个 SSH 主机上的远程目录；dsh 将部署到服务器并以服务方式持续运行。',
        'picker.host': '主机',
        'picker.path': '目录',
        'picker.browse': '浏览…',
        'picker.up': '上一级',
        'picker.use': '使用此目录',
        'picker.cancel': '取消',
        'picker.create': '创建远程工作区',
        'picker.newFolder': '新建目录',
        'picker.folderName': '目录名称',
        'picker.createFolder': '创建',
        'picker.name': '工作区名称',
        'picker.syncCredentials': '同步本地模型凭证',
        'picker.createIfMissing': '目录不存在时自动创建',
        'picker.creating': '正在部署远程 dsh…',
        'picker.created': '远程工作区已创建',
        'picker.openPanel': '打开状态面板',
        'picker.close': '关闭',
        'picker.localUnavailable': '当前宿主没有可用的目录选择器，请直接输入本机路径。',
        'picker.pickNative': '打开系统文件夹选择器',
        'picker.pathRequired': '请输入目录路径',
        'picker.hostRequired': '请选择主机',
        'picker.loading': '加载中…',
        'picker.retry': '重试',
        'picker.error': '加载失败',
        'job.title': '远程操作',
        'job.running': '执行中…',
        'job.succeeded': '完成',
        'job.failed': '失败',
        'job.close': '关闭',
        'job.copyLog': '复制日志',
        'common.ok': '确定',
        'common.cancel': '取消',
        'common.back': '返回',
        'common.close': '关闭',
        'common.save': '保存',
        'common.delete': '删除',
        'common.edit': '编辑',
        'common.test': '测试',
        'common.loading': '加载中…',
        'common.none': '无',
        'common.refresh': '刷新'
      },
      en: {
        'panel.title': 'SSH Remote',
        'panel.heading': 'Remote devices',
        'panel.sub': 'Manage your servers, WSL distributions, and Docker containers.',
        'panel.empty': 'No remote device yet. Click "New connection" to add the first machine.',
        'panel.new': 'New connection',
        'panel.refresh': 'Refresh',
        'panel.loading': 'Loading…',
        'panel.error': 'Error',
        'panel.host': 'Host',
        'panel.path': 'Remote path',
        'panel.state.running': 'Running',
        'panel.state.starting': 'Starting',
        'panel.state.stopped': 'Stopped',
        'panel.state.error': 'Error',
        'panel.state.unreachable': 'Unreachable',
        'panel.state.unknown': 'Unknown',
        'panel.uptime': 'Uptime',
        'panel.mem': 'Memory',
        'panel.cpu': 'CPU',
        'panel.service': 'Service',
        'panel.start': 'Start',
        'panel.stop': 'Stop',
        'panel.restart': 'Restart',
        'panel.logs': 'Logs',
        'panel.remove': 'Remove',
        'panel.removeConfirm': 'Remove remote workspace "{name}"? It stops and removes the remote service but keeps the remote project directory.',
        'panel.copied': 'Copied',
        'panel.auto': 'Auto refresh',
        'panel.noHosts': 'No SSH host yet. Click "New connection" to add the first machine.',
        'row.newSession': 'New session',
        'row.more': 'More actions',
        'row.connecting': 'Connecting',
        'row.offline': 'Offline',
        'row.failed': 'Connection failed',
        'row.edit': 'Edit',
        'row.delete': 'Delete project',
        'row.renameTitle': 'Edit project',
        'row.name': 'Project name',
        'row.deleteTitle': 'Delete project',
        'row.deleteBody': 'Removed from this machine only. The project and other files on {device} are unaffected.',
        'row.deleting': 'Removing…',
        'row.renameFailed': 'Rename failed',
        'row.removeFailed': 'Delete failed',
        'panel.defaultPort': 'Port',
        'panel.http': 'HTTP',
        'panel.lastCheck': 'Checked',
        // ZCode-style connect flow
        'z.title.device': 'Connect to remote',
        'z.desc.device': 'Pick a saved connection, or add a new one.',
        'z.search': 'Search devices, Hosts or containers',
        'z.saved': 'Saved devices',
        'z.sshHosts': 'Hosts in SSH config',
        'z.empty': 'No matching device. Add a new connection below.',
        'z.newSsh': 'New SSH connection',
        'z.keyboard': 'Tab / ↑↓ select · Enter connect · click a recent directory to open it',
        'z.title.settings': 'New connection',
        'z.type': 'Connection type',
        'z.ssh': 'SSH',
        'z.wsl': 'WSL',
        'z.docker': 'Docker',
        'z.onlySsh': 'This plugin only supports SSH connections',
        'z.newWsl': 'Enter WSL manually',
        'z.newDocker': 'Enter Docker manually',
        'z.wslSection': 'WSL distributions',
        'z.dockerSection': 'Running containers',
        'z.wslDistro': 'Distribution',
        'z.wslDefaultDistro': 'Default distribution',
        'z.wslUser': 'Linux user',
        'z.wslDefaultUser': 'Default user',
        'z.wslUserDescription': 'Leave empty to use the distribution default user. Enter root or another existing Linux user to run WSL commands as that user.',
        'z.wslRootWarning': 'Root mode runs the remote host, agent and terminal as root; files created by this session may be owned by root.',
        'z.wslInvalidUser': 'Linux user names cannot contain control characters, colons, slashes or backslashes, and must be at most 64 characters.',
        'z.wslLoading': 'Detecting WSL distribution...',
        'z.wslDetected': '{count} distribution detected on this device.',
        'z.wslNoDistros': 'No WSL distribution were detected. You can still connect to the default distribution if WSL is installed.',
        'z.dockerContainer': 'Container',
        'z.dockerContainerPlaceholder': 'Enter container name or ID, e.g. my-container',
        'z.dockerManualHint': 'If the running container list is incomplete, enter a container name or ID manually to connect.',
        'z.dockerSelectContainer': 'Choose a running container',
        'z.dockerLoading': 'Detecting running containers...',
        'z.dockerUnavailable': 'Docker is unavailable',
        'z.dockerNoContainers': 'No running containers',
        'z.dockerInputSelect': 'Select a running container',
        'z.dockerInputManual': 'Enter a container manually',
        'z.dockerRequired': 'Container name or ID is required',
        'z.optionsLoadFailed': 'Failed to load local runtime options. You can still enter values manually.',
        'z.phase.wsl': 'Starting and connecting to distribution',
        'z.phase.docker': 'Connecting to container',
        'z.phaseSub.ssh': 'Connected to the SSH host',
        'z.phaseSub.wsl': 'Connected to the distribution',
        'z.phaseSub.docker': 'Connected to the container',
        'z.wslDesc': 'WSL',
        'z.import': 'Import from SSH config',
        'z.importEmpty': 'No Host found in SSH config',
        'z.host': 'Host',
        'z.hostPlaceholder': 'Enter a host name or IP, e.g. 192.168.1.100',
        'z.port': 'Port',
        'z.username': 'Username',
        'z.usernamePlaceholder': 'Enter a username, e.g. root',
        'z.auth': 'Authentication',
        'z.password': 'Password',
        'z.privateKey': 'Private key',
        'z.passwordPlaceholder': 'Enter the SSH password',
        'z.keyPlaceholder': 'Select or enter a private key path',
        'z.passphrase': 'Key passphrase (optional)',
        'z.passphrasePlaceholder': 'Enter the key passphrase',
        'z.showPassword': 'Show password',
        'z.hidePassword': 'Hide password',
        'z.advanced': 'Advanced options',
        'z.advancedAlias': 'SSH config alias',
        'z.advancedHint': 'Fills host, port, username and key path from ~/.ssh/config; editing any field unlinks it.',
        'z.validation.host': 'Host is required',
        'z.validation.username': 'Username is required',
        'z.validation.port': 'Port must be an integer between 1 and 65535',
        'z.validation.password': 'Password cannot be empty',
        'z.validation.key': 'Private key path is required',
        'z.cancel': 'Cancel',
        'z.addAndConnect': 'Add and connect',
        'z.startConnection': 'Establish link',
        'z.title.connecting': 'Connecting',
        'z.desc.connecting': 'Connecting over SSH…',
        'z.desc.connected': 'Connected to {device} · you can pick a directory',
        'z.desc.failed': 'Connection failed · retry, or adjust the settings',
        'z.connectingVia': 'Connecting via {method}…',
        'z.backToList': 'Back to devices',
        'z.renameFailed': 'Save failed, try again',
        'z.chooseKeyFile': 'Choose private key file',
        'z.phase.ssh': 'Connecting to the SSH host',
        'z.phase.env': 'Checking the remote environment',
        'z.phase.deploy': 'Deploying the dsh runtime',
        'z.saving': 'Save connection',
        'z.minimize': 'Minimize — the connection keeps running',
        'z.title.directory': 'Choose a directory',
        'z.desc.directory': 'Pick a directory on {method} as the workspace.',
        'z.back': 'Back',
        'z.openHere': 'Open workspace here',
        'z.wizard': 'Remote connection',
        'z.wizard.device': 'Device',
        'z.wizard.connect': 'Connect',
        'z.wizard.directory': 'Directory',
        'z.connectionLog': 'Connection log',
        'z.copyLog': 'Copy log',
        'z.logLines': '{count} lines',
        'z.logEmpty': 'Waiting for connection output...',
        'z.phase.identify': 'Identify device',
        'z.phase.handshake': 'Start and check compatibility',
        'z.phase.workspace': 'Open project folder',
        'z.phaseSub.identifyExisting': 'Connected to device {device}',
        'z.phaseSub.identifyNew': 'New device · dsh runtime not installed',
        'z.phaseSub.uploadFailed': 'Install failed: {reason}',
        'z.phaseSub.downloading': 'Downloading the package',
        'z.phaseSub.uploading': 'Uploading the package',
        'z.phaseSub.extracting': 'Extracting the package',
        'z.phaseSub.verifyingArchive': 'Verifying the package',
        'z.phaseSub.verifyingFiles': 'Verifying server files',
        'z.phaseSub.installed': 'Installed; starting the connection',
        'z.phaseSub.deployWaitingConfirm': 'Waiting for install confirmation…',
        'z.phaseSub.restarting': 'Restarting the remote service',
        'z.phaseSub.readyOnline': 'Device online; workspace history ready',
        'z.phaseSub.workspaceReading': 'Reading {path}',
        'z.install.title': 'dsh runtime install required',
        'z.install.target': 'Target account',
        'z.install.version': 'Install version',
        'z.install.location': 'Install location',
        'z.install.size': 'Package size',
        'z.install.confirm': 'Install and continue',
        'z.install.unknown': 'Unavailable',
        'z.errorDetails': 'Error details',
        'z.copyError': 'Copy error',
        'z.backToConnection': 'Back to connection',
        'z.pasteRecognized': 'Recognized {target}',
        'z.cancelConnection': 'Cancel connection',
        'z.closeWindow': 'Close',
        'z.connectedTo': 'Connected to {device} · choose a directory',
        'z.renameHintLong': 'A short name is easier to recognise; change it later in Settings · Remote devices',
        'z.connectionType': 'Connection type',
        'z.search': 'Search devices, hosts or containers',
        'z.browserGo': 'Go',
        'z.browserShowHidden': 'Show hidden folders',
        'z.browserHideHidden': 'Hide hidden folders',
        'z.browserNoSubdirs': 'No subfolders',
        'z.browserLoading': 'Loading...',
        'z.browserUnavailable': 'Cannot read this directory',
        'z.browserParent': '..',
        'z.newFolder': 'New folder',
        'z.folderName': 'Folder name',
        'z.createFolder': 'Create',
        'z.refreshList': 'Refresh',
        'z.name': 'Workspace name (optional)',
        'z.title.success': 'Done',
        'z.desc.success': 'The remote workspace is ready; remote work keeps running.',
        'z.done': 'Done',
        'z.openPanel': 'Open status panel',
        'z.connecting': 'Connecting…',
        'z.status.connected': 'Connected',
        'z.status.offline': 'Disconnected',
        'z.status.starting': 'Starting',
        'z.status.connecting': 'Connecting',
        'z.status.failed': 'Connection failed',
        'z.recent': 'Recent',
        'z.editConnection': 'Edit connection',
        'z.connect': 'Connect',
        'z.connectingDevice': 'Connecting to {device}…',
        'z.phase.create': 'Starting the remote workspace',
        'z.background': 'Continue in background',
        'z.backgroundHint': 'The connection keeps running if you close this window',
        'z.backgroundContinue': 'Continue',
        'z.backgroundReview': 'Review or handle',
        'z.backgroundCancel': 'Cancel this connection',
        'z.resume': 'Click to resume the connection wizard',
        'z.paused.device': 'Continue choosing a device',
        'z.paused.settings': 'Continue configuring the connection',
        'z.paused.directory': 'Choose a directory for {device}',
        'z.bgConnecting': 'Connecting to {device}…',
        'z.bgFailed': 'Could not connect to {device}',
        'z.bgReady': 'Connection complete · {name}',
        'z.bgPrepared': 'Connected to {device} · choose a directory',
        'z.openWorkspace': 'Open workspace',
        'z.view': 'View',
        'z.renameDevice': 'Device name',
        'z.renameHint': 'Give it a memorable name; you can change it later',
        'z.willOpen': 'Will open {path}',
        'z.chooseLater': 'Choose later',
        'z.retry': 'Retry',
        'z.backToConfig': 'Back to settings',
        'z.openFailed': 'Could not open the native workspace; open it from the sidebar list.',
        'z.opening': 'Opening…',
        'z.dshVersion': 'dsh v{version}',
        'z.dirMissing': 'This directory does not exist yet; it will be created when the workspace opens.',
        'z.typeLabel': 'Connection type',
        'z.importFromConfig': 'Import from SSH config',
        'z.importLoading': 'Loading...',
        'z.configAlias': 'SSH config alias (optional)',
        'z.configAliasPlaceholder': 'No alias',
        'z.configAliasSearch': 'Search SSH config aliases',
        'z.configAliasEmpty': 'No usable SSH config alias was found on this machine.',
        'z.configAliasLinked': 'Linked to Host {alias}',
        'z.configAliasLinkedHint': 'Editing any field removes the link',
        'z.configAliasUnlink': 'Unlink',
        'z.configAliasLoadFailed': 'Could not read SSH config aliases; you can still enter the connection manually.',
        'z.assetInstallMode': 'Resource download',
        'z.assetInstallMode.local-download-upload': 'Download locally, then upload',
        'z.assetInstallMode.remote-download': 'Download on the remote server',
        'z.assetInstallModeDescription': 'Remote download avoids upload waits, but the server must reach the ZCode CDN and provide download, extraction and verification tools.',
        'z.dockerInputMode': 'Docker',
        'z.stopConnecting': 'Stop connecting',
        'z.project.create': 'Create project',
        'z.project.edit': 'Edit project',
        'z.project.name': 'Project name',
        'z.project.new': 'New project',
        'z.project.device': 'Device',
        'z.project.thisComputer': 'This computer',
        'z.project.addRemoteDevice': 'Add remote device…',
        'z.project.existingHint': 'Project already on this device?',
        'z.project.existingAction': 'Add to sidebar',
        'z.project.folders': 'Source folders',
        'z.project.browseHint': 'ZCode can read and edit these folders',
        'z.project.connectAndBrowse': 'Connect and choose folder',
        'z.project.connectAndBrowseHint': 'Device is {status}; it will connect first',
        'z.project.addSourceFolder': 'Add folder',
        'z.project.primary': 'Primary',
        'z.project.setPrimary': 'Set as primary',
        'z.project.removeFolder': 'Remove folder',
        'z.project.cancel': 'Cancel',
        'z.project.save': 'Save',
        'z.project.description': 'Organize folders on the same host. Existing tasks keep their working directory.',
        'z.project.switchDevice': 'Switch device?',
        'z.project.switchDeviceDescription': 'Selected folders will be cleared; the project name is kept.',
        'z.project.noExisting': 'No existing project on this device',
        'z.project.legacy': 'Legacy single-root projects on this device must be upgraded remotely first.',
        'z.project.deviceStatus.online': 'Online',
        'z.project.deviceStatus.offline': 'Offline',
        'z.project.deviceStatus.connecting': 'Connecting',
        'z.project.deviceStatus.pending': 'Needs attention',
        'z.project.deviceStatus.failed': 'Connection failed',
        'z.project.createFailed': 'Could not create the project',
        'z.folder.title': 'Choose folder',
        'z.folder.pathPlaceholder': 'Enter a path',
        'z.folder.go': 'Go',
        'z.folder.showHidden': 'Show hidden folders',
        'z.folder.hideHidden': 'Hide hidden folders',
        'z.folder.noSubdirs': 'No subfolders',
        'z.folder.select': 'Choose folder',
        'z.folder.opening': 'Opening…',
        'z.folder.loading': 'Loading...',
        'z.folder.parent': '..',
        'z.folder.errorUnavailable': 'Could not open this folder. Check that it exists and is accessible, or choose another folder.',
        'z.settings.newConnection': 'New connection',
        'z.settings.addAndConnect': 'Add and connect',
        'settings.title': 'Remote devices',
        'settings.intro': 'Manage SSH hosts. Creating a remote workspace deploys the dsh Web runtime on the server and registers it as a service; it keeps running after this app closes.',
        'settings.hosts': 'SSH hosts',
        'settings.devicesHeading': 'Devices',
        'settings.emptyDevices': 'No remote device connections yet.',
        'settings.editConnectionTitle': 'Edit connection',
        'settings.editConnectionDescription': 'Connection changes apply the next time you connect; existing projects and tasks are not affected.',
        'settings.removeConnection': 'Remove connection',
        'settings.removeConnectionTitle': 'Remove this connection?',
        'settings.removeConnectionDescription': 'This removes {name} and its saved credentials from this device.',
        'device.status.online': 'Connected',
        'device.status.connecting': 'Connecting',
        'device.status.offline': 'Not connected',
        'device.status.failed': 'Connection failed',
        'settings.noHosts': 'No host yet. Add one below.',
        'settings.add': 'Add host',
        'settings.edit': 'Edit',
        'settings.delete': 'Delete',
        'settings.deleteConfirm': 'Delete host "{name}"?',
        'settings.test': 'Test connection',
        'settings.testing': 'Testing…',
        'settings.testOk': 'Connected · {latency}ms · {platform} {arch} · Node {node}',
        'settings.name': 'Name',
        'settings.host': 'Host / IP',
        'settings.port': 'Port',
        'settings.username': 'Username',
        'settings.auth': 'Authentication',
        'settings.password': 'Password',
        'settings.passwordSaved': 'Saved; leave blank to keep',
        'settings.keyPath': 'Private key path',
        'settings.passphrase': 'Key passphrase (optional)',
        'settings.defaultPath': 'Default remote path',
        'settings.hostKey': 'Host key check',
        'settings.hostKeyAcceptNew': 'Trust on first use (accept-new)',
        'settings.hostKeyVerify': 'Strict (verify)',
        'settings.hostKeyOff': 'Off',
        'settings.save': 'Save',
        'settings.saved': 'Saved',
        'settings.cancel': 'Cancel',
        'settings.runtime': 'Deployment defaults',
        'settings.dshVersion': 'Remote dsh version',
        'settings.nodeVersion': 'Portable Node version (when absent)',
        'settings.registry': 'npm registry',
        'settings.poll': 'Status poll interval (ms)',
        'settings.syncCredentials': 'Sync local model credentials by default (.credentials.yaml)',
        'settings.createIfMissing': 'Create missing remote directory by default',
        'settings.language': 'Language',
        'settings.zh': '中文',
        'settings.en': 'English',
        'settings.dataDir': 'Data directory',
        'settings.note': 'Passwords are stored with mode 0600 in the local data directory and never echoed back.',
        'picker.title': 'Select workspace directory',
        'picker.local': 'Local',
        'picker.remote': 'SSH Remote',
        'picker.localIntro': 'Pick a local directory as a normal DSH workspace.',
        'picker.remoteIntro': 'Pick a directory on an SSH host; dsh is deployed there and kept running as a service.',
        'picker.host': 'Host',
        'picker.path': 'Directory',
        'picker.browse': 'Browse…',
        'picker.up': 'Up',
        'picker.use': 'Use this directory',
        'picker.cancel': 'Cancel',
        'picker.create': 'Create remote workspace',
        'picker.newFolder': 'New folder',
        'picker.folderName': 'Folder name',
        'picker.createFolder': 'Create',
        'picker.name': 'Workspace name',
        'picker.syncCredentials': 'Sync local model credentials',
        'picker.createIfMissing': 'Create directory if missing',
        'picker.creating': 'Deploying remote dsh…',
        'picker.created': 'Remote workspace created',
        'picker.openPanel': 'Open status panel',
        'picker.close': 'Close',
        'picker.localUnavailable': 'No directory picker on this host; type a local path.',
        'picker.pickNative': 'Open system folder picker',
        'picker.pathRequired': 'Enter a directory path',
        'picker.hostRequired': 'Select a host',
        'picker.loading': 'Loading…',
        'picker.retry': 'Retry',
        'picker.error': 'Failed to load',
        'job.title': 'Remote operation',
        'job.running': 'Running…',
        'job.succeeded': 'Completed',
        'job.failed': 'Failed',
        'job.close': 'Close',
        'job.copyLog': 'Copy log',
        'common.ok': 'OK',
        'common.cancel': 'Cancel',
        'common.back': 'Back',
        'common.close': 'Close',
        'common.save': 'Save',
        'common.delete': 'Delete',
        'common.edit': 'Edit',
        'common.test': 'Test',
        'common.loading': 'Loading…',
        'common.none': 'None',
        'common.refresh': 'Refresh'
      }
    }
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

    // ── API ────────────────────────────────────────────────────────────────
    function apiPath(path) {
      return window.location && window.location.protocol === 'dsh-app:' ? `/api${path}` : path
    }
    async function api(method, path, body) {
      const options = { method, headers: {} }
      if (body !== undefined) {
        options.headers['content-type'] = 'application/json'
        options.body = JSON.stringify(body)
      }
      const response = await fetch(apiPath(path), options)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        throw new Error((data && (data.error || data.message)) || `HTTP ${response.status}`)
      }
      return data
    }

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
.zc-panel-title{margin:0 0 4px;font-size:16px;line-height:1.4;font-weight:600}
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
/* ZCode device row (e7): 32px icon tile, 14px medium name, 12px mono
   target, status badge on the right; edit/remove appear on hover. */
.zc-device-list{display:flex;flex-direction:column;gap:2px}
.zc-device-head{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:14px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-device-count{font-size:10px;font-weight:400;color:var(--zc-muted)}
.zc-device-head .zc-panel-actions{margin-left:auto}
.zc-device-item{position:relative;display:flex;align-items:center;border-radius:8px}
.zc-device-item:hover{background:var(--zc-surface-hover)}
.zc-device-row{appearance:none;display:flex;width:100%;min-width:0;align-items:center;gap:12px;border:0;border-radius:8px;background:transparent;color:var(--zc-fg);padding:8px;text-align:left;font-family:inherit;cursor:pointer}
.zc-device-row:focus-visible{outline:2px solid var(--zc-input-border-focus);outline-offset:-2px}
.zc-device-icon{display:flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;border-radius:6px;background:var(--zc-surface);color:var(--zc-muted)}
.zc-device-main{display:flex;min-width:0;flex:1;flex-direction:column}
.zc-device-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:1.625;color:var(--zc-fg)}
.zc-device-desc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--zc-mono);font-size:12px;line-height:1.5;color:var(--zc-muted)}
.zc-device-meta{display:flex;flex:none;align-items:center;min-height:24px;margin-left:4px}
.zc-device-status{transition:opacity .12s ease}
.zc-device-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:inline-flex;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s ease}
.zc-device-item:hover .zc-device-status,.zc-device-item:focus-within .zc-device-status{opacity:0}
.zc-device-item:hover .zc-device-actions,.zc-device-item:focus-within .zc-device-actions{opacity:1;pointer-events:auto}
@media (hover:none){.zc-device-status{display:none}.zc-device-actions{position:static;transform:none;opacity:1;pointer-events:auto}.zc-device-row{padding-right:0}}
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
/* ── ZCode 3.17.2: folder modal ───────────────────────────────────────── */
.zc-folder-modal{display:flex;min-height:0;flex-direction:column;gap:12px}
.zc-folder-modal .zc-browser{height:384px;min-height:0;border:0;background:transparent;padding:0;gap:12px}
.zc-folder-modal .zc-browser-form{display:flex;flex-direction:row;gap:8px}
.zc-folder-modal .zc-browser-form .zc-input{height:36px;flex:1}
.zc-folder-modal .zc-browser-actions{display:flex;gap:8px}
.zc-folder-modal .zc-browser-actions .zc-btn{height:36px;padding:0 12px;border-radius:8px}
.zc-folder-modal .zc-browser-list{flex:1;max-height:none;min-height:0;border:1px solid var(--zc-border);border-radius:8px;background:var(--zc-bg)}
.zc-folder-modal .zc-browser-row{padding:8px 12px}
.zc-folder-modal .zc-browser-empty{padding:16px;text-align:center;font-size:14px;color:var(--zc-fg-subtle)}
.zc-folder-foot{display:flex;flex-shrink:0;justify-content:flex-end;gap:8px;margin-top:12px}
.zc-folder-foot .zc-btn{height:40px;padding:0 20px;border-radius:8px}
.zc-hidden-input{display:none}
@media (max-width:640px){.zc-folder-modal .zc-browser{height:320px}.zc-folder-modal .zc-browser-form{flex-direction:column}.zc-folder-modal .zc-browser-actions{width:100%}.zc-folder-modal .zc-browser-actions .zc-btn{flex:1}}
.zc-spin{animation:zc-spin 1s linear infinite}
/* ── native remote workspace row (ZCode 3.17.2 virtual-project-row) ────── */
[data-dsh-ssh-row]{gap:8px!important}
[data-dsh-ssh-row] .dsh-ssh-cloud-slot,[data-dsh-ssh-row]:hover .dsh-ssh-cloud-slot{display:inline-flex!important;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#61666b)!important}
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

    // ── tiny UI primitives ─────────────────────────────────────────────────
    function Btn(props) {
      const cls = ['sshR-btn', props.kind || '', props.className || ''].filter(Boolean).join(' ')
      return h('button', {
        type: 'button',
        className: cls,
        disabled: Boolean(props.disabled),
        title: props.title || undefined,
        onClick: props.onClick
      }, props.children)
    }
    function Modal(props) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && props.onClose) props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.onClose])
      return h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && props.onClose) props.onClose() }
      },
        h('div', { className: `zc-dialog zc-modal${props.wide ? ' wide' : ''}` },
          h('div', { className: 'zc-body' },
            h('div', { className: 'zc-head' },
              h('div', { className: 'zc-head-top' },
                h('h2', { className: 'zc-title' }, props.title),
                h('div', { className: 'zc-head-actions' },
                  props.onClose
                    ? h('button', {
                        type: 'button',
                        className: 'zc-btn zc-btn-ghost zc-btn-icon',
                        title: t('common.close'),
                        onClick: props.onClose
                      }, h(Icon, { name: 'x', size: 12 }))
                    : null
                )
              ),
              props.headRight || null
            ),
            h('div', { className: 'zc-modal-body' }, props.children),
            props.footer ? h('div', { className: 'zc-modal-foot' }, props.footer) : null
          )
        )
      )
    }
    function Field(props) {
      return h('div', { className: 'sshR-field', style: props.style },
        props.label ? h('label', null, props.label) : null,
        props.children,
        props.hint ? h('p', { className: 'sshR-hint' }, props.hint) : null
      )
    }
    function Input(props) {
      return h('input', {
        className: 'sshR-input',
        type: props.type || 'text',
        value: props.value ?? '',
        placeholder: props.placeholder || '',
        disabled: Boolean(props.disabled),
        autoComplete: props.autoComplete || 'off',
        spellCheck: false,
        onChange: (event) => props.onChange ? props.onChange(event.target.value) : undefined,
        onKeyDown: props.onKeyDown
      })
    }
    function Select(props) {
      return h('select', {
        className: 'sshR-select',
        style: props.style,
        value: props.value,
        disabled: Boolean(props.disabled),
        onChange: (event) => props.onChange ? props.onChange(event.target.value) : undefined
      }, props.children)
    }
    function HostPicker({ hosts, value, onChange }) {
      return h('div', { className: 'sshR-hostPick' },
        hosts.map((host) => h('button', {
          key: host.id,
          type: 'button',
          className: `sshR-hostOption ${host.id === value ? 'active' : ''}`.trim(),
          onClick: () => onChange(host.id)
        },
          h('span', { className: 'sshR-hostName' }, host.name),
          h('span', { className: 'sshR-hostAddr' }, `${host.username}@${host.host}:${host.port}`),
          h('span', { className: 'sshR-hostMeta' }, host.auth?.kind === 'key' ? 'key' : 'password')
        ))
      )
    }
    function Check(props) {
      return h('label', { className: 'sshR-check' },
        h('input', { type: 'checkbox', checked: Boolean(props.checked), disabled: Boolean(props.disabled), onChange: (event) => props.onChange ? props.onChange(event.target.checked) : undefined }),
        h('span', null, props.children)
      )
    }
    function stateLabel(state) {
      const key = `panel.state.${state || 'unknown'}`
      return t(key)
    }
    function fmtBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
      return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
    }
    function fmtUptime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '—'
      const total = Math.floor(seconds)
      const days = Math.floor(total / 86400)
      const hours = Math.floor((total % 86400) / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = total % 60
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m ${secs}s`
      return `${secs}s`
    }
    function errorMessage(error) {
      return String((error && error.message) || error || 'unknown error')
    }

    // ── polling a long job ─────────────────────────────────────────────────
    function useJob(jobId, onDone) {
      const [job, setJob] = useState(null)
      const [error, setError] = useState('')
      useEffect(() => {
        if (!jobId) { setJob(null); return undefined }
        let stopped = false
        let timer = null
        const tick = async () => {
          try {
            const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`)
            if (stopped) return
            setJob(data.job)
            setError('')
            if (data.job.state === 'succeeded' || data.job.state === 'failed') {
              if (onDone) onDone(data.job)
              return
            }
          } catch (err) {
            if (!stopped) setError(errorMessage(err))
          }
          if (!stopped) timer = setTimeout(tick, 900)
        }
        void tick()
        return () => {
          stopped = true
          if (timer) clearTimeout(timer)
        }
      }, [jobId])
      return { job, error }
    }

    // ── background connection flow ─────────────────────────────────────────
    // ZCode keeps "connect" alive when the wizard is minimized: the dialog is
    // only a view over this module-level flow, and a shell pill resumes it.
    const backgroundFlow = (() => {
      const listeners = new Set()
      const state = {
        phase: 'idle',
        kind: '',
        targetKind: 'ssh',
        title: '',
        device: '',
        hostId: '',
        path: '',
        name: '',
        jobId: '',
        lines: [],
        confirm: null,
        phases: [],
        result: null,
        workspace: null,
        error: '',
        minimized: false,
        startedAt: 0,
        endedAt: 0
      }
      let runToken = 0
      let timer = null
      const emit = () => {
        for (const fn of [...listeners]) {
          try { fn() } catch { /* a stale subscriber must not break the flow */ }
        }
      }
      const update = (patch) => { Object.assign(state, patch); emit() }
      const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null } }
      const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms) })
      const setPhase = (key, status) => {
        const now = Date.now()
        update({
          phases: state.phases.map((row) => {
            if (row.key !== key || row.status === status) return row
            const times = row.times || {}
            if (status === 'active') times.start = times.start || now
            if (status === 'complete' || status === 'failed') times.end = times.end || now
            return { ...row, status, times }
          })
        })
      }
      const fail = (token, error) => {
        if (token !== runToken) return
        const message = errorMessage(error)
        update({
          phase: 'failed',
          error: message,
          lines: [...state.lines, message],
          phases: state.phases.map((row) => (row.status === 'active' ? { ...row, status: 'failed' } : row)),
          endedAt: Date.now()
        })
      }
      const pollJob = async (token, jobId) => {
        while (token === runToken) {
          const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`)
          if (token !== runToken) return
          const job = data.job
          update({ lines: (job.lines || []).slice(-240) })
          if (job.state === 'succeeded') {
            update({
              phase: 'done',
              result: job.result || null,
              workspace: job.result && job.result.id ? job.result : state.workspace,
              phases: state.phases.map((row) => ({ ...row, status: 'complete' })),
              endedAt: Date.now()
            })
            return
          }
          if (job.state === 'failed' || job.state === 'cancelled') {
            throw new Error(job.error || t('job.failed'))
          }
          await sleep(700)
        }
      }
      const begin = (kind, options) => {
        runToken += 1
        stopTimer()
        const channelLabel = phaseChannelLabel(options.targetKind || 'ssh')
        const stages = [
          { key: 'channel', label: channelLabel, status: 'active' },
          { key: 'identify', label: t('z.phase.identify'), status: 'pending' },
          { key: 'deploy', label: t('z.phase.deploy'), status: 'pending' },
          { key: 'handshake', label: t('z.phase.handshake'), status: 'pending' },
          { key: 'workspace', label: t('z.phase.workspace'), status: 'pending' }
        ]
        // The connect phase stops at deploy; the create phase starts with the
        // channel already established and deploy being re-verified.
        const phases = kind === 'prepare'
          ? stages.slice(0, 3)
          : stages.map((row, index) => {
              if (index === 0 || index === 1) return { ...row, status: 'complete', times: { start: Date.now() - 1000, end: Date.now() } }
              if (index === 2) return { ...row, status: 'active', times: { start: Date.now() } }
              return row
            })
        update({
          phase: 'running',
          kind,
          targetKind: options.targetKind || 'ssh',
          title: kind === 'prepare' ? t('z.phase.deploy') : t('z.phase.create'),
          device: options.device || '',
          hostId: options.hostId || '',
          path: options.path || '',
          name: options.name || '',
          jobId: '',
          lines: [],
          confirm: null,
          phases,
          result: null,
          workspace: null,
          error: '',
          minimized: false,
          startedAt: Date.now(),
          endedAt: 0
        })
        return runToken
      }
      return {
        get snapshot() { return state },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        update,
        reset() {
          runToken += 1
          stopTimer()
          this.continuation = null
          update({
            phase: 'idle', kind: '', targetKind: 'ssh', title: '', device: '', hostId: '', path: '', name: '',
            jobId: '', lines: [], confirm: null, phases: [], result: null, workspace: null, error: '',
            minimized: false, startedAt: 0, endedAt: 0
          })
        },
        minimize() { update({ minimized: true }) },
        restore() { update({ minimized: false }) },
        async startPrepare(host, options = {}) {
          const token = begin('prepare', {
            device: targetLabelFor(host),
            targetKind: kindOfrow(host),
            hostId: host.id,
            path: options.path || host.defaultPath || '~'
          })
          try {
            this.update({ title: t('z.phase.deploy') })
            let probe = options.probe
            if (!probe) {
              const data = await api('POST', '/ssh-remote/hosts/test', { host: { id: host.id } })
              if (token !== runToken) return
              probe = data.probe || {}
            }
            update({
              lines: [
                `${t('z.connect')} ${targetLabelFor(host)}`,
                `${probe.platform || ''} ${probe.arch || ''} · Node ${probe.node || '—'} · ${probe.latencyMs ?? '?'}ms`
              ]
            })
            setPhase('channel', 'complete')
            setPhase('identify', 'active')
            const runtime = await this.gateInstallIfNeeded(token, host)
            if (runtime === 'gated') return
            await this.runPrepareJob(token, host)
          } catch (error) {
            fail(token, error)
          }
        },
        // ZCode 3.17.2 shows an install-confirmation card inside the deploy
        // stage before touching the remote: target, version, path and size.
        async gateInstallIfNeeded(token, host) {
          const data = await api('POST', '/ssh-remote/hosts/runtime-check', { hostId: host.id })
          if (token !== runToken) return 'gated'
          const runtime = data.runtime || {}
          setPhase('identify', 'complete')
          if (runtime.present) return runtime
          setPhase('deploy', 'active')
          update({
            phase: 'confirm-install',
            confirm: {
              target: targetLabelFor(host),
              version: runtime.version || '',
              installPath: runtime.installPath || '',
              sizeBytes: runtime.sizeBytes ?? null
            }
          })
          this.continuation = { token, host, run: () => this.runPrepareJob(token, host) }
          return 'gated'
        },
        runPrepareJob(token, host) {
          setPhase('deploy', 'active')
          void (async () => {
            const data = await api('POST', '/ssh-remote/hosts/prepare', { hostId: host.id })
            if (token !== runToken) return
            update({ jobId: data.jobId })
            await pollJob(token, data.jobId)
          })().catch((error) => fail(token, error))
        },
        confirmInstall() {
          const pending = this.continuation
          if (!pending || pending.token !== runToken) return
          this.continuation = null
          update({ phase: 'running', confirm: null })
          pending.run()
        },
        cancelInstall() {
          this.continuation = null
          this.reset()
        },
        async startCreate(options = {}) {
          const token = begin('create', options)
          try {
            const host = options.host || null
            if (!host) throw new Error('host not found')
            const runtime = await this.gateInstallIfNeeded(token, host)
            if (runtime === 'gated') {
              // The create job includes the runtime install itself.
              this.continuation = {
                token,
                host,
                run: () => {
                  void (async () => {
                    const data = await api('POST', '/ssh-remote/workspaces/create', {
                      hostId: options.hostId,
                      remotePath: options.path,
                      name: options.name || undefined,
                      syncCredentials: options.syncCredentials !== false,
                      createIfMissing: options.createIfMissing !== false
                    })
                    if (token !== runToken) return
                    update({ jobId: data.jobId })
                    await pollJob(token, data.jobId)
                  })().catch((error) => fail(token, error))
                }
              }
              return
            }
            const data = await api('POST', '/ssh-remote/workspaces/create', {
              hostId: options.hostId,
              remotePath: options.path,
              name: options.name || undefined,
              syncCredentials: options.syncCredentials !== false,
              createIfMissing: options.createIfMissing !== false
            })
            if (token !== runToken) return
            update({ jobId: data.jobId })
            await pollJob(token, data.jobId)
          } catch (error) {
            fail(token, error)
          }
        }
      }
    })()

    function useBackgroundFlow() {
      const [snapshot, setSnapshot] = useState(backgroundFlow.snapshot)
      useEffect(() => backgroundFlow.subscribe(() => setSnapshot({ ...backgroundFlow.snapshot })), [])
      return snapshot
    }

    // A single dialog opener is enough: the wizard lives either in the status
    // panel or in the workspace directory flow, and the shell pill asks
    // whichever one is mounted to reopen it.
    let dialogOpener = null
    let dialogPending = false
    function setDialogOpener(opener) {
      dialogOpener = typeof opener === 'function' ? opener : null
      if (dialogOpener && dialogPending) {
        dialogPending = false
        dialogOpener()
      }
    }
    function requestRemoteDialog(openPanel) {
      if (dialogOpener) {
        dialogOpener()
        return
      }
      dialogPending = true
      openPanel?.()
    }

    function JobModal({ jobId, title, onClose, onDone }) {
      const { job, error } = useJob(jobId, onDone)
      const log = job ? job.lines.join('\n') : ''
      const state = job?.state || 'running'
      return h(Modal, {
        title: title || t('job.title'),
        onClose,
        wide: true,
        footer: h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-default',
          onClick: onClose,
          disabled: state === 'running'
        }, t('job.close'))
      },
        h('div', { className: 'zc-conn-title-row' },
          state === 'running' ? h(Spinner, { size: 14 }) : null,
          h('span', null, state === 'running' ? t('job.running') : state === 'succeeded' ? t('job.succeeded') : t('job.failed'))
        ),
        error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        job?.error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, job.error)) : null,
        h('pre', { className: 'zc-pre' }, log || t('panel.loading')),
        h('div', { style: { marginTop: 10, display: 'flex', gap: 8 } },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-ghost zc-btn-sm',
            onClick: () => navigator.clipboard?.writeText(log)
          }, t('job.copyLog'))
        )
      )
    }

    // ZCode's minimized connection pill: the flow keeps running above, and
    // this is the only surface while the wizard is closed.
    // A wizard minimized before it started a job (device/settings/directory)
    // is parked here so the shell pill can offer "continue configuration".
    let pausedWizard = null
    const pausedListeners = new Set()
    function setPausedWizard(value) {
      pausedWizard = value
      for (const fn of [...pausedListeners]) {
        try { fn() } catch { /* keep other subscribers alive */ }
      }
    }
    function usePausedWizard() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        pausedListeners.add(listener)
        return () => pausedListeners.delete(listener)
      }, [])
      return pausedWizard
    }

    function BackgroundPill({ openPanel, openNativeWorkspace }) {
      const bg = useBackgroundFlow()
      const paused = usePausedWizard()
      const flowVisible = bg.minimized && (bg.phase === 'running' || bg.phase === 'failed' || bg.phase === 'done' || bg.phase === 'prepared')
      if (!flowVisible && !paused) return null
      if (!flowVisible) {
        const title = paused.step === 'settings'
          ? t('z.paused.settings')
          : paused.step === 'directory'
            ? t('z.paused.directory', { device: paused.device || '' })
            : t('z.paused.device')
        return h('div', { className: 'zc-ui zc-pill', role: 'status' },
          h('button', {
            type: 'button',
            className: 'zc-pill-card',
            onClick: () => requestRemoteDialog(openPanel)
          },
            h('span', { className: 'zc-pill-title' }, h('span', { className: 'zc-truncate' }, title)),
            h('span', { className: 'zc-pill-sub' }, t('z.resume')),
            h('span', { className: 'zc-pill-action' }, t('z.backgroundReview'))
          ),
          h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => setPausedWizard(null) }, t('common.close'))
        )
      }
      const running = bg.phase === 'running'
      const failed = bg.phase === 'failed'
      const prepared = bg.phase === 'done' && bg.kind === 'prepare'
      const done = bg.phase === 'done' && bg.kind === 'create' && bg.workspace
      if (!running && !failed && !prepared && !done) return null
      const phases = bg.phases || []
      const completed = phases.filter((row) => row.status === 'complete').length
      const percent = phases.length > 0 ? Math.round((completed / phases.length) * 100) : 0
      const title = running
        ? t('z.bgConnecting', { device: bg.device })
        : failed
          ? t('z.bgFailed', { device: bg.device })
          : prepared
            ? t('z.bgPrepared', { device: bg.device })
            : t('z.bgReady', { name: bg.workspace?.name || bg.path })
      const sub = running
        ? t('z.resume')
        : failed
          ? `${bg.error || ''}`
          : prepared
            ? t('z.title.directory')
            : (bg.workspace?.remotePath || bg.path || '')
      const act = () => {
        if (done) {
          const opened = bg.workspace.nativeWorkspaceId ? openNativeWorkspace?.(bg.workspace.nativeWorkspaceId) : false
          backgroundFlow.reset()
          if (!opened) openPanel?.()
          return
        }
        if (prepared) {
          backgroundFlow.restore()
          requestRemoteDialog(openPanel)
          return
        }
        backgroundFlow.restore()
        requestRemoteDialog(openPanel)
      }
      const cardClass = failed ? 'zc-pill-card danger' : (running ? 'zc-pill-card progress' : 'zc-pill-card')
      return h('div', { className: 'zc-ui zc-pill', role: 'status' },
        h('button', { type: 'button', className: cardClass, 'data-testid': 'remote-connection-minimized', onClick: act },
          h('span', { className: 'zc-pill-title' },
            failed ? h(Icon, { name: 'alert', size: 14 })
              : running ? h(Spinner, { size: 14 })
                : null,
            h('span', { className: 'zc-truncate' }, title),
            running ? h('span', null, `${percent}%`) : null
          ),
          h('span', { className: 'zc-pill-sub' }, sub),
          running
            ? h('span', { className: 'zc-pill-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
                h('span', { style: { width: `${percent}%` } })
              )
            : null,
          h('span', { className: 'zc-pill-action' }, done ? t('z.openWorkspace') : running ? t('z.backgroundReview') : t('z.backgroundContinue'))
        ),
        running
          ? h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => backgroundFlow.reset() }, t('z.backgroundCancel'))
          : h('button', { type: 'button', className: 'zc-pill-cancel', onClick: () => backgroundFlow.reset() }, t('common.close'))
      )
    }

    // ── Settings section ───────────────────────────────────────────────────
    function emptyHostForm() {
      return {
        id: '',
        kind: 'ssh',
        name: '',
        host: '',
        port: 22,
        username: 'root',
        authKind: 'password',
        password: '',
        privateKeyPath: '',
        passphrase: '',
        distro: '',
        wslUser: '',
        container: '',
        manualContainer: '',
        dockerMode: 'manual',
        image: '',
        defaultPath: '~',
        hostKeyMode: 'accept-new',
        assetInstallMode: 'local-download-upload'
      }
    }
    function hostToForm(host) {
      return {
        id: host.id,
        kind: host.kind === 'wsl' || host.kind === 'docker' ? host.kind : 'ssh',
        name: host.name || '',
        host: host.host || '',
        port: host.port || 22,
        username: host.username || 'root',
        authKind: host.auth?.kind === 'key' ? 'key' : 'password',
        password: '',
        privateKeyPath: host.auth?.privateKeyPath || '',
        passphrase: '',
        distro: host.distro || '',
        wslUser: host.user || '',
        container: host.container || '',
        manualContainer: host.container || '',
        dockerMode: host.container ? 'select' : 'manual',
        image: host.image || '',
        defaultPath: host.defaultPath || '~',
        hostKeyMode: host.hostKeyMode || 'accept-new',
        assetInstallMode: host.assetInstallMode || 'local-download-upload'
      }
    }
    // Aggregate the workspace runner state per device, mirroring ZCode's
    // online / connecting / offline / failed device status.
    function hostStatusFor(host, workspaces) {
      const related = workspaces.filter((workspace) => workspace.hostId === host.id)
      if (related.some((workspace) => workspace.status?.state === 'running')) {
        return { tone: 'success', label: t('device.status.online') }
      }
      if (related.some((workspace) => workspace.status?.state === 'starting')) {
        return { tone: 'progress', label: t('device.status.connecting') }
      }
      if (related.some((workspace) => workspace.status?.state === 'error')) {
        return { tone: 'danger', label: t('device.status.failed') }
      }
      return { tone: 'neutral', label: t('device.status.offline') }
    }

    function HostsPane({ refreshToken = 0, onChanged, createOpen: controlledCreateOpen, onCloseCreate } = {}) {
      const [hosts, setHosts] = useState([])
      const [workspaces, setWorkspaces] = useState([])
      const [form, setForm] = useState(null)
      const [createOpenLocal, setCreateOpenLocal] = useState(false)
      const [confirmHost, setConfirmHost] = useState(null)
      const [showPassword, setShowPassword] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const uncontrolled = controlledCreateOpen === undefined
      const createOpen = uncontrolled ? createOpenLocal : controlledCreateOpen
      const closeCreate = () => {
        if (uncontrolled) setCreateOpenLocal(false)
        else onCloseCreate?.()
      }
      const openCreate = () => setCreateOpenLocal(true)

      const load = useCallback(async () => {
        try {
          const [hostData, workspaceData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0').catch(() => ({ workspaces: [] }))
          ])
          setHosts(hostData.hosts || [])
          setWorkspaces(workspaceData.workspaces || [])
          setError('')
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { void load() }, [load, refreshToken])

      const update = (patch) => setForm((old) => ({ ...(old || emptyHostForm()), ...patch }))
      const openForm = (host) => {
        setShowPassword(false)
        setError('')
        setForm(hostToForm(host))
      }
      const save = async () => {
        if (!form) return
        setBusy(true); setError('')
        try {
          const kind = form.kind
          const host = {
            id: form.id || undefined,
            kind,
            name: form.name || form.host || form.distro || form.container,
            host: kind === 'wsl' ? form.distro : kind === 'docker' ? form.container : form.host,
            port: Number(form.port) || 22,
            username: kind === 'wsl' ? form.wslUser : form.username,
            user: kind === 'docker' ? form.username : form.wslUser,
            distro: form.distro,
            container: form.container,
            image: form.image,
            auth: form.authKind === 'key'
              ? { kind: 'key', privateKeyPath: form.privateKeyPath, passphrase: form.passphrase || undefined }
              : { kind: 'password', password: form.password || undefined },
            defaultPath: form.defaultPath || '~',
            hostKeyMode: form.hostKeyMode
          }
          await api('POST', '/ssh-remote/hosts/save', { host })
          setForm(null)
          await load()
          onChanged?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      const remove = async () => {
        if (!confirmHost) return
        setBusy(true); setError('')
        try {
          await api('POST', '/ssh-remote/hosts/delete', { id: confirmHost.id })
          setConfirmHost(null)
          await load()
          onChanged?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }

      // Small builders keep the modal readable and reuse the ZCode form
      // primitives (`zc-field` / `zc-label`) already used by the connect dialog.
      const field = (label, control, hint) => h('label', { className: 'zc-field' },
        h('span', { className: 'zc-label' }, label),
        control,
        hint ? h('span', { className: 'zc-hint' }, hint) : null
      )
      const formModal = form ? h(Modal, {
        title: t('settings.editConnectionTitle'),
        onClose: () => { if (!busy) { setForm(null); setError('') } },
        footer: [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'zc-btn zc-btn-outline',
            disabled: busy,
            onClick: () => { setForm(null); setError('') }
          }, t('settings.cancel')),
          h('button', {
            key: 'save',
            type: 'button',
            className: 'zc-btn zc-btn-default',
            disabled: busy,
            onClick: () => void save()
          }, t('settings.save'))
        ]
      },
        h('p', { className: 'zc-desc', style: { margin: '0 0 16px' } }, t('settings.editConnectionDescription')),
        error ? h('div', { className: 'zc-error', style: { marginBottom: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        h('div', { className: 'zc-fields' },
          field(t('settings.name'), h('input', {
            className: 'zc-input',
            value: form.name,
            placeholder: 'my-server',
            onChange: (event) => update({ name: event.target.value })
          })),
          form.kind === 'ssh' ? h('div', { className: 'zc-grid-host' },
            field(t('settings.host'), h('input', {
              className: 'zc-input mono',
              value: form.host,
              placeholder: '203.0.113.10',
              spellCheck: false,
              onChange: (event) => update({ host: event.target.value })
            })),
            field(t('settings.port'), h('input', {
              className: 'zc-input mono',
              value: form.port,
              inputMode: 'numeric',
              placeholder: '22',
              onChange: (event) => update({ port: event.target.value })
            }))
          ) : null,
          form.kind === 'wsl' ? h('div', { className: 'zc-grid-2' },
            field(t('z.wslDistro'), h('input', {
              className: 'zc-input mono',
              value: form.distro,
              placeholder: t('z.wslDefaultDistro'),
              onChange: (event) => update({ distro: event.target.value })
            })),
            field(t('z.wslUser'), h('input', {
              className: 'zc-input mono',
              value: form.wslUser,
              placeholder: t('z.wslDefaultUser'),
              onChange: (event) => update({ wslUser: event.target.value })
            }))
          ) : null,
          form.kind === 'docker' ? h('div', { className: 'zc-grid-2' },
            field(t('z.dockerContainer'), h('input', {
              className: 'zc-input mono',
              value: form.container,
              placeholder: t('z.dockerContainerPlaceholder'),
              onChange: (event) => update({ container: event.target.value })
            })),
            field(t('settings.name'), h('input', {
              className: 'zc-input mono',
              value: form.image,
              placeholder: 'image:tag',
              onChange: (event) => update({ image: event.target.value })
            }))
          ) : null,
          form.kind === 'ssh' ? field(t('settings.username'), h('input', {
            className: 'zc-input mono',
            value: form.username,
            placeholder: t('z.usernamePlaceholder'),
            spellCheck: false,
            autoCapitalize: 'none',
            onChange: (event) => update({ username: event.target.value })
          })) : null,
          form.kind === 'ssh' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'zc-auth-row' },
              h('span', { className: 'zc-auth-label' }, t('z.auth')),
              h('div', { className: 'zc-seg' },
                h('button', {
                  type: 'button',
                  'aria-pressed': form.authKind === 'password' ? 'true' : 'false',
                  onClick: () => update({ authKind: 'password' })
                }, t('z.password')),
                h('button', {
                  type: 'button',
                  'aria-pressed': form.authKind === 'key' ? 'true' : 'false',
                  onClick: () => update({ authKind: 'key' })
                }, t('z.privateKey'))
              )
            ),
            form.authKind === 'password'
              ? h('div', null,
                  h('div', { className: 'zc-pwd' },
                    h('input', {
                      className: 'zc-input',
                      type: showPassword ? 'text' : 'password',
                      value: form.password,
                      placeholder: t('z.passwordPlaceholder'),
                      autoComplete: 'off',
                      onChange: (event) => update({ password: event.target.value })
                    }),
                    h('button', {
                      type: 'button',
                      className: 'zc-eye',
                      title: showPassword ? t('z.hidePassword') : t('z.showPassword'),
                      'aria-label': showPassword ? t('z.hidePassword') : t('z.showPassword'),
                      onClick: () => setShowPassword((old) => !old)
                    }, h(EyeIcon, { off: showPassword }))
                  ),
                  form.id ? h('span', { className: 'zc-hint' }, t('settings.passwordSaved')) : null
                )
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                  field(t('settings.keyPath'), h('input', {
                    className: 'zc-input mono',
                    value: form.privateKeyPath,
                    placeholder: '~/.ssh/id_ed25519',
                    spellCheck: false,
                    onChange: (event) => update({ privateKeyPath: event.target.value })
                  })),
                  field(t('settings.passphrase'), h('input', {
                    className: 'zc-input',
                    type: 'password',
                    value: form.passphrase,
                    autoComplete: 'off',
                    onChange: (event) => update({ passphrase: event.target.value })
                  }))
                )
          ) : null,
          field(t('settings.defaultPath'), h('input', {
            className: 'zc-input mono',
            value: form.defaultPath,
            placeholder: '~',
            spellCheck: false,
            onChange: (event) => update({ defaultPath: event.target.value })
          })),
          form.kind === 'ssh' ? field(t('settings.hostKey'), h('select', {
            className: 'zc-input',
            value: form.hostKeyMode,
            onChange: (event) => update({ hostKeyMode: event.target.value })
          },
            h('option', { value: 'accept-new' }, t('settings.hostKeyAcceptNew')),
            h('option', { value: 'verify' }, t('settings.hostKeyVerify')),
            h('option', { value: 'off' }, t('settings.hostKeyOff'))
          )) : null
        )
      ) : null
      const removeModal = confirmHost ? h(Modal, {
        title: t('settings.removeConnectionTitle'),
        onClose: () => { if (!busy) setConfirmHost(null) },
        footer: [
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'zc-btn zc-btn-outline',
            disabled: busy,
            onClick: () => setConfirmHost(null)
          }, t('settings.cancel')),
          h('button', {
            key: 'remove',
            type: 'button',
            className: 'zc-btn zc-btn-default',
            disabled: busy,
            onClick: () => void remove()
          }, t('settings.removeConnection'))
        ]
      },
        h('p', { className: 'zc-desc', style: { margin: 0 } }, t('settings.removeConnectionDescription', { name: confirmHost.name })),
        error ? h('div', { className: 'zc-error', style: { marginTop: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null
      ) : null

      return h('div', null,
        error ? h('div', { className: 'zc-error', style: { marginBottom: 12 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error)) : null,
        loading ? h('div', { className: 'zc-device-loading' }, h(Spinner), h('span', null, t('common.loading'))) : null,
        !loading && hosts.length === 0
          ? h('div', { className: 'zc-device-empty' },
              h(Icon, { name: 'server', size: 20 }),
              h('span', null, t('settings.emptyDevices')),
              uncontrolled
                ? h('button', {
                    type: 'button',
                    className: 'zc-btn zc-btn-default',
                    style: { marginTop: 8 },
                    onClick: openCreate
                  }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
                : null
            )
          : null,
        hosts.length > 0 || uncontrolled ? h('div', { className: 'zc-device-list' },
          h('div', { className: 'zc-device-head' },
            h('span', null, t('settings.devicesHeading')),
            h('span', { className: 'zc-device-count' }, hosts.length),
            uncontrolled
              ? h('div', { className: 'zc-panel-actions' },
                  h('button', {
                    type: 'button',
                    className: 'zc-btn zc-btn-default',
                    onClick: openCreate
                  }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
                )
              : null
          ),
          hosts.map((host) => {
            const status = hostStatusFor(host, workspaces)
            return h('div', { key: host.id, className: 'zc-device-item' },
              h('button', {
                type: 'button',
                className: 'zc-device-row',
                title: host.name,
                onClick: () => openForm(host)
              },
                h('span', { className: 'zc-device-icon' }, h(Icon, { name: kindIconName(kindOfrow(host)), size: 16 })),
                h('span', { className: 'zc-device-main' },
                  h('span', { className: 'zc-device-name' }, host.name),
                  h('span', { className: 'zc-device-desc' }, targetLabelFor(host))
                ),
                h('span', { className: 'zc-device-meta' },
                  h('span', { className: `zc-badge zc-badge-${status.tone} zc-device-status` },
                    h('span', { className: 'zc-badge-dot' }),
                    h('span', null, status.label)
                  )
                )
              ),
              h('span', { className: 'zc-device-actions' },
                h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-ghost zc-btn-icon',
                  title: t('settings.edit'),
                  'aria-label': t('settings.edit'),
                  onClick: () => openForm(host)
                }, h(Icon, { name: 'edit', size: 14 })),
                h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-ghost zc-btn-icon',
                  title: t('settings.removeConnection'),
                  'aria-label': t('settings.removeConnection'),
                  onClick: () => { setError(''); setConfirmHost(host) }
                }, h(Icon, { name: 'trash', size: 14 }))
              )
            )
          })
        ) : null,
        formModal,
        removeModal,
        createOpen ? h(ZcodeRemoteDialog, {
          mode: 'device-management',
          onClose: closeCreate,
          onManaged: () => { closeCreate(); void load(); onChanged?.() }
        }) : null
      )
    }

    function SettingsSection() {
      const [settings, setSettings] = useState(null)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)

      const load = useCallback(async () => {
        try {
          const settingsData = await api('GET', '/ssh-remote/settings')
          setSettings(settingsData.settings || null)
          setError('')
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { void load() }, [load])

      const saveSettings = async (patch) => {
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/settings', { settings: { ...(settings || {}), ...patch } })
          setSettings(data.settings)
          setMsg(t('settings.saved'))
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'zc-ui zc-settings' },
        h('div', null,
          h('h3', { style: { margin: '0 0 6px', fontSize: 16 } }, t('settings.title')),
          h('p', { className: 'sshR-sub' }, t('settings.intro'))
        ),
        error ? h('div', { className: 'sshR-errorBox', style: { marginTop: 12 } }, error) : null,
        msg ? h('div', { className: 'sshR-hint', style: { color: 'var(--ssh-ok)' } }, msg) : null,
        loading ? h('p', { className: 'sshR-hint' }, t('common.loading')) : null,

        h('div', { style: { marginTop: 18 } }, h(HostsPane)),

        settings ? h('div', null,
          h('div', { className: 'sshR-sectionTitle' }, t('settings.runtime')),
          h('div', { className: 'sshR-row' },
            h(Field, { label: t('settings.dshVersion') }, h(Input, { value: settings.dshVersion, onChange: (value) => setSettings({ ...settings, dshVersion: value }) })),
            h(Field, { label: t('settings.nodeVersion') }, h(Input, { value: settings.nodeVersion, onChange: (value) => setSettings({ ...settings, nodeVersion: value }) })),
            h(Field, { label: t('settings.poll') }, h(Input, { value: settings.pollIntervalMs, onChange: (value) => setSettings({ ...settings, pollIntervalMs: value }) }))
          ),
          h(Field, { label: t('settings.registry'), style: { marginTop: 10 } }, h(Input, { value: settings.npmRegistry, onChange: (value) => setSettings({ ...settings, npmRegistry: value }) })),
          h(Check, { checked: settings.syncCredentials, onChange: (value) => setSettings({ ...settings, syncCredentials: value }) }, t('settings.syncCredentials')),
          h(Check, { checked: settings.createIfMissing, onChange: (value) => setSettings({ ...settings, createIfMissing: value }) }, t('settings.createIfMissing')),
          h('div', { className: 'sshR-inline', style: { marginTop: 10 } },
            h(Btn, { kind: 'primary', disabled: busy, onClick: () => void saveSettings({ dshVersion: settings.dshVersion, nodeVersion: settings.nodeVersion, npmRegistry: settings.npmRegistry, pollIntervalMs: Number(settings.pollIntervalMs) || 5000, syncCredentials: settings.syncCredentials, createIfMissing: settings.createIfMissing }) }, t('settings.save')),
            h('span', { className: 'sshR-hint' }, `${t('settings.language')}: `),
            h(Select, { value: LANG, onChange: (value) => setLang(value), style: { width: 120 } },
              h('option', { value: 'zh' }, t('settings.zh')),
              h('option', { value: 'en' }, t('settings.en'))
            )
          ),
          h('p', { className: 'sshR-hint', style: { marginTop: 12 } }, t('settings.note'))
        ) : null
      )
    }

    // ── Main status panel ──────────────────────────────────────────────────
    function StatusDot({ state }) {
      return h('span', { className: `sshR-dot ${state || 'stopped'}` })
    }
    function WorkspaceCard({ workspace, busy, onAction, onLogs, onRemove, onOpen }) {
      const status = workspace.status || {}
      const state = status.state || (workspace.desiredState === 'running' ? 'starting' : 'stopped')
      const tone = state === 'running' ? 'success'
        : state === 'starting' ? 'progress'
          : (state === 'error' || state === 'unreachable') ? 'danger' : 'neutral'
      const start = state === 'running'
        ? { label: t('panel.stop'), op: 'stop' }
        : { label: t('panel.start'), op: 'start' }
      const kind = workspace.targetKind === 'wsl' || workspace.targetKind === 'docker' ? workspace.targetKind : 'ssh'
      const deviceLabel = kind === 'wsl'
        ? `WSL · ${workspace.host || 'default'}`
        : kind === 'docker'
          ? `Docker · ${workspace.host || 'container'}`
          : `${workspace.username}@${workspace.host}:${workspace.targetPort || 22}`
      return h('div', { className: 'zc-card' },
        h('div', { className: 'zc-card-top' },
          h('span', { className: 'zc-card-title' }, workspace.name),
          h(StatusBadge, { tone }, stateLabel(state)),
          h('span', { className: 'zc-card-device' }, deviceLabel),
          workspace.serviceKind ? h('span', { className: 'zc-badge zc-badge-neutral' }, workspace.serviceKind) : null
        ),
        h('div', { className: 'zc-card-path' }, workspace.remotePath),
        h('div', { className: 'zc-card-meta' },
          h('span', null, t('panel.uptime'), ' ', h('b', null, fmtUptime(status.uptimeSec))),
          h('span', null, t('panel.mem'), ' ', h('b', null, fmtBytes(status.rssBytes))),
          h('span', null, t('panel.cpu'), ' ', h('b', null, status.cpuPercent != null ? `${status.cpuPercent.toFixed(1)}%` : '—')),
          h('span', null, t('panel.http'), ' ', h('b', null, status.httpStatus || '—')),
          h('span', null, t('panel.defaultPort'), ' ', h('b', null, workspace.port)),
          h('span', null, 'PID ', h('b', null, status.pid || '—')),
          h('span', null, t('panel.lastCheck'), ' ', h('b', null, status.checkedAt ? new Date(status.checkedAt).toLocaleTimeString() : '—'))
        ),
        status.error ? h('div', { className: 'zc-error', style: { marginTop: 10 } }, h(Icon, { name: 'alert', size: 16 }), h('span', null, status.error)) : null,
        h('div', { className: 'zc-card-actions' },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-default zc-btn-sm',
            disabled: busy || !workspace.nativeWorkspaceId,
            title: !workspace.nativeWorkspaceId ? t('z.openFailed') : undefined,
            onClick: () => onOpen(workspace)
          }, t('z.openWorkspace')),
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-outline zc-btn-sm',
            disabled: busy,
            onClick: () => onAction(start.op, workspace)
          }, start.label),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm', disabled: busy, onClick: () => onAction('restart', workspace) }, t('panel.restart')),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm', disabled: busy, onClick: () => onLogs(workspace) }, t('panel.logs')),
          h('button', { type: 'button', className: 'zc-btn zc-btn-ghost zc-btn-sm danger', disabled: busy, onClick: () => onRemove(workspace) }, t('panel.remove'))
        )
      )
    }

    // The left-sidebar SSH surface is device management only. Creating or
    // opening a workspace happens in the main directory flow, exactly like
    // ZCode's device panel, which never creates projects.
    function MainPanel() {
      const [createOpen, setCreateOpen] = useState(false)
      const [refreshToken, setRefreshToken] = useState(0)
      return h('div', { className: 'zc-ui zc-panel' },
        h('div', { className: 'zc-panel-head' },
          h('div', null,
            h('h2', { className: 'zc-panel-title' }, t('panel.heading')),
            h('p', { className: 'zc-panel-sub' }, t('panel.sub'))
          ),
          h('div', { className: 'zc-panel-actions' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-default',
              onClick: () => setCreateOpen(true)
            }, h(Icon, { name: 'plus', size: 14 }), t('z.settings.newConnection'))
          )
        ),
        h('div', { style: { marginTop: 16 } },
          h(HostsPane, {
            createOpen,
            onCloseCreate: () => setCreateOpen(false),
            refreshToken,
            onChanged: () => setRefreshToken((value) => value + 1)
          })
        )
      )
    }

    // ── Remote directory browser (shared by create modal/picker) ───────────
    // Mirrors ZCode's FP embedded browser: path form, go/hidden toggles and a
    // plain list with a ".." row.
    function RemoteBrowser({ hostId, value, onChange, request, allowMissing = false, onNavState }) {
      const [listing, setListing] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [draft, setDraft] = useState(value || '~')
      const [showHidden, setShowHidden] = useState(false)

      const load = useCallback(async (path) => {
        if (!hostId) return
        setLoading(true); setError('')
        try {
          const data = await api('GET', `/ssh-remote/remote/list?hostId=${encodeURIComponent(hostId)}&path=${encodeURIComponent(path || '~')}`)
          setListing(data)
          setDraft(data.path)
          onChange(data.path)
          onNavState?.(true)
        } catch (err) {
          setError(errorMessage(err))
          onNavState?.(false)
        } finally {
          setLoading(false)
        }
      }, [hostId])

      useEffect(() => {
        if (hostId) void load(value || '~')
      }, [hostId])

      // A quick-open chip changes the controlled path from outside; navigate
      // the listing to it without turning every keystroke into a request.
      useEffect(() => {
        if (hostId && request?.path) void load(request.path)
      }, [request?.key])

      const entries = (listing?.entries || []).filter((entry) => entry.dir && (showHidden || !entry.hidden))
      const missing = allowMissing && /no such file|enoent|not found/iu.test(error)

      return h('div', { className: 'zc-browser' },
        h('div', { className: 'zc-browser-form' },
          h('input', {
            className: 'zc-input mono',
            value: draft,
            placeholder: '~',
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void load(draft.trim() || '~')
            }
          }),
          h('div', { className: 'zc-browser-actions' },
            h('button', { type: 'button', className: 'zc-btn zc-btn-secondary', disabled: loading || !draft.trim(), onClick: () => void load(draft.trim() || '~') }, t('z.browserGo')),
            h('button', {
              type: 'button',
              className: `zc-btn ${showHidden ? 'zc-btn-secondary' : 'zc-btn-ghost'}`,
              'aria-pressed': showHidden ? 'true' : 'false',
              onClick: () => setShowHidden((old) => !old)
            }, showHidden ? t('z.browserHideHidden') : t('z.browserShowHidden'))
          )
        ),
        error
          ? (missing
              ? h('p', { className: 'zc-hint', style: { margin: 0 } }, t('z.dirMissing'))
              : h('div', { className: 'zc-browser-error' }, error))
          : null,
        h('div', { className: 'zc-browser-list' },
          listing?.parent ? h('button', { type: 'button', className: 'zc-browser-row zc-browser-up', onClick: () => void load(listing.parent) },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, t('z.browserParent'))
          ) : null,
          loading ? h('div', { className: 'zc-browser-empty' }, t('z.browserLoading')) : null,
          !loading && entries.length === 0 ? h('div', { className: 'zc-browser-empty' }, t('z.browserNoSubdirs')) : null,
          entries.map((entry) => h('button', {
            key: entry.path,
            type: 'button',
            className: 'zc-browser-row',
            onClick: () => void load(entry.path)
          },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, entry.name)
          ))
        )
      )
    }

    // Lucide icon set used by ZCode's dialog (stroke 2, 24px viewBox).
    const ICONS = {
      search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
      terminal: [['path', { d: 'm4 17 6-6-6-6' }], ['path', { d: 'M12 19h8' }]],
      plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
      folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
      folderPlus: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }], ['path', { d: 'M12 10v6' }], ['path', { d: 'M9 13h6' }]],
      monitor: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
      desktop: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }], ['path', { d: 'M8 21h8' }], ['path', { d: 'M12 17v4' }]],
      check: [['path', { d: 'M20 6 9 17l-5-5' }]],
      x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
      minus: [['path', { d: 'M5 12h14' }]],
      loader: [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
      alert: [['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }], ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]],
      eye: [['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
      gitBranch: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
      eyeOff: [['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' }], ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }], ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' }], ['path', { d: 'm2 2 20 20' }]],
      chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
      chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
      chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
      server: [['rect', { x: 2, y: 2, width: 20, height: 8, rx: 2, ry: 2 }], ['rect', { x: 2, y: 14, width: 20, height: 8, rx: 2, ry: 2 }], ['path', { d: 'M6 6h.01' }], ['path', { d: 'M6 18h.01' }]],
      squareTerminal: [['path', { d: 'm7 11 2-2-2-2' }], ['path', { d: 'M11 13h4' }], ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2 }]],
      box: [['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }], ['path', { d: 'm3.3 7 8.7 5 8.7-5' }], ['path', { d: 'M12 22V12' }]],
      file: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }]],
      edit: [['path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }], ['path', { d: 'm15 5 4 4' }]],
      trash: [['path', { d: 'M3 6h18' }], ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }], ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }]]
    }
    function Icon({ name, size = 14, className }) {
      const children = (ICONS[name] || []).map(([tag, attrs], index) => h(tag, { key: index, ...attrs }))
      return h('svg', {
        className,
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, children)
    }

    function Spinner({ className = 'zc-spin' }) {
      return h(Icon, { name: 'loader', size: 14, className })
    }

    // ZCode's Bj status badge.
    function StatusBadge({ tone = 'neutral', children, dot = true, icon }) {
      return h('span', { className: `zc-badge zc-badge-${tone}` },
        icon ? h(Icon, { name: icon, size: 12 }) : (dot ? h('span', { className: 'zc-badge-dot' }) : null),
        h('span', null, children)
      )
    }

    // ZCode's yVn wizard indicator.
    function WizardSteps({ step }) {
      const current = step === 'directory' ? 2 : (step === 'device' ? 0 : 1)
      const labels = [t('z.wizard.device'), t('z.wizard.connect'), t('z.wizard.directory')]
      return h('nav', { className: 'zc-wizard-nav', 'aria-label': t('z.wizard') },
        h('ol', { className: 'zc-wizard' }, labels.map((label, index) =>
          h('li', { key: label, 'data-current': index === current ? 'true' : undefined },
            index > 0 ? h('span', { className: 'zc-wizard-sep' }) : null,
            h('span', { className: 'zc-wizard-dot' }, index < current ? h(Icon, { name: 'check', size: 10 }) : String(index + 1)),
            h('span', null, label)
          )))
      )
    }

    function FieldError({ message }) {
      if (!message) return null
      return h('p', { className: 'zc-field-err' }, h(Icon, { name: 'alert', size: 14 }), h('span', null, message))
    }

    function EyeIcon({ off }) {
      return h(Icon, { name: off ? 'eyeOff' : 'eye', size: 16 })
    }

    function FolderIcon({ size = 14 }) {
      return h(Icon, { name: 'folder', size })
    }

    function emptyConnectForm() {
      return { ...emptyHostForm(), username: '', password: '' }
    }

    // ZCode's `dd` validation rule for `wsl.user`.
    function isValidWslUserClient(value) {
      const text = String(value ?? '').trim()
      if (text.length === 0 || text.length > 64) return false
      if (text.includes(':') || text.includes('/') || text.includes('\\')) return false
      for (const character of text) {
        const codePoint = character.codePointAt(0) ?? 0
        if (codePoint < 32 || codePoint === 127) return false
      }
      return true
    }

    function kindOfrow(row) {
      return row?.kind === 'wsl' || row?.kind === 'docker' ? row.kind : 'ssh'
    }

    // ZCode `gmt` target label.
    function targetLabelFor(row) {
      if (!row) return ''
      const kind = kindOfrow(row)
      if (kind === 'wsl') {
        const distro = row.distro === undefined ? row.wslDistro : row.distro
        const user = row.user === undefined ? row.wslUser : row.user
        return ['WSL', String(distro || '').trim() || 'default', String(user || '').trim()].filter(Boolean).join(' · ')
      }
      if (kind === 'docker') {
        const container = row.dockerMode === 'manual' ? row.manualContainer : (row.container || row.manualContainer)
        return `Docker · ${String(container || '').trim() || 'container'}`
      }
      return `${row.username || 'user'}@${row.host || 'host'}:${row.port || 22}`
    }

    function kindLabel(kind) {
      return kind === 'wsl' ? t('z.wsl') : kind === 'docker' ? t('z.docker') : t('z.ssh')
    }

    function kindIconName(kind) {
      return kind === 'wsl' ? 'squareTerminal' : kind === 'docker' ? 'box' : 'server'
    }

    // ZCode `availableKinds`: WSL only on Windows desktops, Docker always.
    function isWindowsClient() {
      return typeof navigator !== 'undefined' && /Windows/iu.test(navigator.userAgent || '')
    }

    // ZCode `Vvt`/`Hvt`: parse `ssh [-p port] target` commands and plain
    // user@host:port targets pasted into the host field.
    function parseSshPaste(text) {
      const value = String(text ?? '').trim()
      if (!value) return null
      const commandMatch = /^ssh\s+(.+)$/u.exec(value)
      if (commandMatch) {
        const tokens = commandMatch[1].split(/\s+/u)
        let target = ''
        let port = ''
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index]
          if (token === '-p') {
            port = tokens[index + 1] ?? ''
            if (!port) return null
            index += 1
          } else if (token.startsWith('-') || target) return null
          else target = token
        }
        if (!target) return null
        const parsed = parseSshPasteTarget(target)
        if (!parsed) return null
        if (port && !/^\d+$/u.test(port)) return null
        return port ? { ...parsed, port } : parsed
      }
      const parsed = parseSshPasteTarget(value)
      return parsed && (parsed.username || parsed.port) ? parsed : null
    }

    function parseSshPasteTarget(value) {
      const match = /^(?:([^@\s:/]+)@)?(\[[^\]\s]+\]|[^:@\s[\]/]+)(?::([^:\s]+))?$/u.exec(value)
      if (!match) return null
      const [, username, rawHost = '', port] = match
      if (port && !/^\d+$/u.test(port)) return null
      if (port && !(Number(port) >= 1 && Number(port) <= 65535)) return null
      return {
        host: rawHost.startsWith('[') ? rawHost.slice(1, -1) : rawHost,
        ...(username ? { username } : {}),
        ...(port ? { port } : {})
      }
    }

    // ZCode `remote.phase.channel.<kind>`.
    function phaseChannelLabel(kind) {
      return kind === 'wsl' ? t('z.phase.wsl') : kind === 'docker' ? t('z.phase.docker') : t('z.phase.ssh')
    }

    // ZCode 3.17.2 log tags ([source-server:*] → [ssh-remote:*]) mapped onto
    // the five wizard stages; percent lines drive the transfer progress bar.
    const STAGE_TAG_MAP = {
      probe: 'channel',
      channel: 'channel',
      'directory-record': 'identify',
      preflight: 'deploy',
      download: 'deploy',
      upload: 'deploy',
      extract: 'deploy',
      'verify-archive': 'deploy',
      verify: 'deploy',
      install: 'deploy',
      daemon: 'handshake',
      restart: 'handshake',
      'protocol-handshake': 'handshake',
      'publish-online': 'handshake',
      workspace: 'workspace'
    }
    const TAGGED_LINE_RE = /^\[ssh-remote:([a-z-]+)\]\s*/u

    function parseStageTags(lines) {
      const info = {}
      for (const raw of lines) {
        const match = TAGGED_LINE_RE.exec(raw)
        if (!match) continue
        const stage = STAGE_TAG_MAP[match[1]]
        if (!stage) continue
        const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/u)
        info[stage] = {
          rawPhase: match[1],
          line: raw.replace(TAGGED_LINE_RE, ''),
          percent: percentMatch ? percentMatch[1] : null
        }
      }
      return info
    }

    // ZCode `iyt`: per-stage sub-messages from the flow state machine.
    function stageSubMessage(row, ctx) {
      const tagInfo = ctx.tags[row.key]
      if (row.key === 'channel' && row.status === 'complete') {
        const kind = ctx.kind === 'server' ? '' : ctx.kind
        return kind ? t(`z.phaseSub.${kind}`) : t('z.status.connected')
      }
      if (row.key === 'identify') {
        if (ctx.device) return t('z.phaseSub.identifyExisting', { device: ctx.device })
        if (ctx.confirmPending) return t('z.phaseSub.identifyNew')
        return ''
      }
      if (row.key === 'deploy') {
        if (ctx.failed) return t('z.phaseSub.uploadFailed', { reason: ctx.error || '' })
        if (ctx.confirmPending) return t('z.phaseSub.deployWaitingConfirm')
        if (row.status === 'active' && tagInfo) {
          const map = {
            extract: 'z.phaseSub.extracting',
            'verify-archive': 'z.phaseSub.verifyingArchive',
            verify: 'z.phaseSub.verifyingFiles',
            install: 'z.phaseSub.installed'
          }
          if (tagInfo.rawPhase === 'download') return t('z.phaseSub.downloading')
          if (tagInfo.rawPhase === 'upload') return t('z.phaseSub.uploading')
          if (map[tagInfo.rawPhase]) return t(map[tagInfo.rawPhase])
          return tagInfo.line || ''
        }
        return ''
      }
      if (row.key === 'handshake' && row.status === 'active' && tagInfo?.rawPhase === 'restart') {
        return t('z.phaseSub.restarting')
      }
      if (row.key === 'handshake' && row.status === 'complete') {
        return t('z.phaseSub.readyOnline')
      }
      if (row.key === 'workspace' && row.status === 'active' && ctx.path) {
        return t('z.phaseSub.workspaceReading', { path: ctx.path })
      }
      return ''
    }

    // ZCode's "新建连接" flow, rebuilt from its renderer components:
    // nVn (device list) -> Smt/rmt (SSH form) -> hmt (connection log) ->
    // directory picker. The dialog shell mirrors OVn (max-w-2xl, top 10vh,
    // rounded-2xl, p-4/p-6, footer 取消 / 添加并连接).
    // ZCode 3.17.2 `jI`/`fI`: the create-project dialog doubles as the remote
    // folder picker. `project.browse` is the title while the embedded browser
    // is open; the footer belongs to the browser in that mode.
    // ZCode uses Radix popovers (portaled). DSH's dialog has overflow:hidden and
    // a transform, so menus are rendered as fixed siblings of the dialog and
    // flipped upward when they would leave the viewport.
    function AnchoredMenu({ open, anchorRef, width, align = 'start', className, onClose, children }) {
      const [box, setBox] = useState(null)
      useEffect(() => {
        if (!open) { setBox(null); return undefined }
        const update = () => {
          const rect = anchorRef.current?.getBoundingClientRect()
          if (!rect) return
          const menuWidth = width || rect.width
          let left = align === 'end' ? rect.right - menuWidth : rect.left
          left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))
          let top = rect.bottom + 6
          if (top + 280 > window.innerHeight - 8) top = Math.max(8, rect.top - 280 - 6)
          setBox({ position: 'fixed', left, top, width: menuWidth, zIndex: 72 })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open, anchorRef, width, align])
      if (!open || !box) return null
      return h('div', {
        className: `zc-floating-menu${className ? ` ${className}` : ''}`,
        style: box,
        'data-zc-popover': 'true',
        onMouseDown: (event) => event.stopPropagation()
      }, children)
    }

    function DeviceLabel({ label, status, local = false }) {
      return h('span', { className: 'zc-device-label' },
        h(Icon, { name: local ? 'desktop' : 'server', size: 16 }),
        h('span', { className: 'zc-device-label-name' }, label),
        status
          ? h('span', { className: 'zc-device-status', 'data-status': status },
              h('span', { className: 'zc-device-status-dot' }),
              h('span', { className: status === 'online' ? 'sr-only' : '' }, t(`z.project.deviceStatus.${status}`)))
          : null
      )
    }

    function projectBaseName(path) {
      const parts = String(path || '').split(/[\\/]/u).filter(Boolean)
      return parts[parts.length - 1] || String(path || '')
    }

    function CreateProjectDialog({
      onClose,
      onCreated,
      onLocalCreate,
      openNativeWorkspace,
      localAvailable = false,
      defaultDeviceId = 'local',
      initialHosts = null
    }) {
      const [hosts, setHosts] = useState(initialHosts || [])
      const [workspaces, setWorkspaces] = useState([])
      const [settings, setSettings] = useState(null)
      const [name, setName] = useState('')
      const [deviceId, setDeviceId] = useState(defaultDeviceId || 'local')
      const [roots, setRoots] = useState([])
      const [menuOpen, setMenuOpen] = useState(false)
      const [browseOpen, setBrowseOpen] = useState(false)
      const [localBrowseOpen, setLocalBrowseOpen] = useState(false)
      const [localPath, setLocalPath] = useState('')
      const [browsePath, setBrowsePath] = useState('~')
      const [dirReady, setDirReady] = useState(false)
      const [showExisting, setShowExisting] = useState(false)
      const [addOpen, setAddOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [connecting, setConnecting] = useState(false)
      const [error, setError] = useState('')
      const [jobId, setJobId] = useState('')
      const menuRef = useRef(null)
      const deviceButtonRef = useRef(null)
      const mounted = useRef(true)

      useEffect(() => () => { mounted.current = false }, [])

      const load = useCallback(async (selectId) => {
        try {
          const [hostData, workspaceData, settingsData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0'),
            api('GET', '/ssh-remote/settings').catch(() => ({ settings: null }))
          ])
          if (!mounted.current) return
          const list = hostData.hosts || []
          setHosts(list)
          setWorkspaces(workspaceData.workspaces || [])
          setSettings(settingsData.settings || null)
          if (selectId) setDeviceId(selectId)
          else if (list.length > 0 && !localAvailable && (deviceId === 'local' || !list.some((row) => row.id === deviceId))) setDeviceId(list[0].id)
          else if (deviceId !== 'local' && !list.some((row) => row.id === deviceId)) setDeviceId(localAvailable ? 'local' : (list[0]?.id || 'local'))
        } catch (err) {
          if (mounted.current) setError(errorMessage(err))
        }
      }, [deviceId])

      useEffect(() => { void load() }, [])

      useEffect(() => {
        if (!menuOpen) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-zc-popover="true"]')) return
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [menuOpen])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (browseOpen) { setBrowseOpen(false); return }
          if (localBrowseOpen) { setLocalBrowseOpen(false); return }
          if (menuOpen) { setMenuOpen(false); return }
          onClose?.()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [browseOpen, localBrowseOpen, menuOpen, onClose])

      const host = hosts.find((row) => row.id === deviceId) || null
      const isLocal = deviceId === 'local' || !host

      const statusOf = (row) => {
        if (!row) return 'offline'
        const rows = workspaces.filter((item) => item.hostId === row.id)
        if (rows.some((item) => item.status?.state === 'running')) return 'online'
        if (row.connectionStatus === 'connecting' || rows.some((item) => item.status?.state === 'starting')) return 'connecting'
        if (row.connectionStatus === 'failed' || rows.some((item) => item.status?.state === 'error' || item.status?.state === 'unreachable')) return 'failed'
        if (row.connectionStatus === 'pending') return 'pending'
        return 'offline'
      }
      const hostStatus = host ? statusOf(host) : 'offline'
      const existing = host ? workspaces.filter((row) => row.hostId === host.id) : []

      const chooseDevice = (nextId) => {
        setMenuOpen(false)
        if (nextId === deviceId) return
        if (roots.length > 0 && !window.confirm(`${t('z.project.switchDevice')}\n${t('z.project.switchDeviceDescription')}`)) return
        setRoots([])
        setShowExisting(false)
        setError('')
        setDeviceId(nextId)
      }

      const pickLocal = async () => {
        if (!localAvailable) return
        setBusy(true); setError('')
        try {
          // Prefer the renderer's own OS dialog (Electron preload), then the
          // Host's native picker, and only then the plugin's HTTP fallback.
          const native = await pickNativeLocalDirectory()
          if (native.kind === 'picked') {
            setRoots([native.path])
            setShowExisting(false)
            return
          }
          if (native.kind === 'cancelled') return
          const data = await api('POST', '/ssh-remote/local/pick', {})
          if (data?.path) {
            setRoots([data.path])
            setShowExisting(false)
          } else if (data?.cancelled) {
            return
          } else {
            // No OS chooser on this Host (browse backend) — keep the flow
            // alive with the in-app folder browser instead of a dead end.
            setLocalPath(roots[0] || '')
            setLocalBrowseOpen(true)
          }
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const openRemoteBrowser = async () => {
        if (!host) return
        setError('')
        const recent = workspaces.find((row) => row.hostId === host.id)
        const startPath = roots[0] || recent?.remotePath || host.defaultPath || '~'
        if (hostStatus === 'online') {
          setBrowsePath(startPath)
          setDirReady(false)
          setBrowseOpen(true)
          return
        }
        // ZCode `project.connectAndBrowse`: non-online devices connect before
        // the picker opens.
        setConnecting(true)
        try {
          await api('POST', '/ssh-remote/hosts/test', { host: { id: host.id } })
          if (!mounted.current) return
          setBrowsePath(startPath)
          setDirReady(false)
          setBrowseOpen(true)
          void load()
        } catch (err) {
          if (mounted.current) setError(errorMessage(err))
        } finally {
          if (mounted.current) setConnecting(false)
        }
      }

      const pickFolder = () => {
        if (busy || connecting) return
        if (isLocal) void pickLocal()
        else void openRemoteBrowser()
      }

      const openWorkspace = async (workspace) => {
        if (!workspace) return
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/open', { id: workspace.id })
          const target = data.workspace || workspace
          const opened = target.nativeWorkspaceId ? openNativeWorkspace?.(target.nativeWorkspaceId) : false
          onCreated?.(target)
          if (!opened) {
            setError(t('z.openFailed'))
            return
          }
          onClose?.()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const create = async () => {
        if (roots.length !== 1) return
        if (isLocal) {
          if (!onLocalCreate) {
            setError(t('z.project.createFailed'))
            return
          }
          onLocalCreate(roots[0])
          return
        }
        const path = roots[0]
        const duplicate = workspaces.find((row) => row.hostId === host.id && row.remotePath === path)
        if (duplicate) {
          void openWorkspace(duplicate)
          return
        }
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/create', {
            hostId: host.id,
            remotePath: path,
            name: name.trim() || undefined,
            syncCredentials: settings ? settings.syncCredentials !== false : true,
            createIfMissing: settings ? settings.createIfMissing !== false : true
          })
          if (!mounted.current) return
          setJobId(data.jobId)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const folderMode = browseOpen || localBrowseOpen
      const title = folderMode ? t('z.folder.title') : t('z.project.create')
      const canCreate = roots.length === 1 && !busy && !connecting && !jobId

      const headerRow = h('div', { className: 'zc-create-head' },
        h('h2', { className: 'zc-create-title', id: 'zc-project-title' }, title),
        h('button', {
          type: 'button',
          className: 'zc-create-close',
          title: t('common.close'),
          'aria-label': t('common.close'),
          onClick: () => {
            if (browseOpen) setBrowseOpen(false)
            else if (localBrowseOpen) setLocalBrowseOpen(false)
            else onClose?.()
          }
        }, h(Icon, { name: 'x', size: 16 }))
      )

      const deviceMenuItems = [
        localAvailable ? h('button', {
          key: 'local',
          type: 'button',
          role: 'option',
          className: 'zc-select-item',
          'data-selected': isLocal ? 'true' : 'false',
          onClick: () => chooseDevice('local')
        },
          isLocal ? h('span', { className: 'zc-select-check' }, h(Icon, { name: 'check', size: 14 })) : null,
          h(DeviceLabel, { label: t('z.project.thisComputer'), local: true })
        ) : null,
        ...hosts.map((row) => h('button', {
          key: row.id,
          type: 'button',
          role: 'option',
          className: 'zc-select-item',
          'data-device-id': row.id,
          'data-selected': deviceId === row.id ? 'true' : 'false',
          onClick: () => chooseDevice(row.id)
        },
          deviceId === row.id ? h('span', { className: 'zc-select-check' }, h(Icon, { name: 'check', size: 14 })) : null,
          h(DeviceLabel, { label: row.name, status: statusOf(row) })
        )),
        hosts.length > 0 ? h('div', { key: 'sep', className: 'zc-select-sep' }) : null,
        h('button', {
          key: 'add',
          type: 'button',
          className: 'zc-select-item zc-select-add',
          onClick: () => { setMenuOpen(false); setAddOpen(true) }
        }, h(Icon, { name: 'plus', size: 16 }), t('z.project.addRemoteDevice'))
      ].filter(Boolean)

      const existingBlock = !isLocal && host
        ? showExisting
          ? h('div', { className: 'zc-folder-list' },
              existing.length > 0
                ? existing.map((row) => h('button', {
                    key: row.id,
                    type: 'button',
                    className: 'zc-folder-add',
                    onClick: () => void openWorkspace(row)
                  },
                    h(Icon, { name: 'folder', size: 16 }),
                    h('span', { className: 'zc-folder-name', title: row.remotePath }, row.name || projectBaseName(row.remotePath)),
                    h('span', { className: 'zc-folder-empty-hint', style: { marginLeft: 'auto' } }, row.remotePath)
                  ))
                : h('p', { className: 'zc-existing-hint', style: { padding: '12px' } }, t('z.project.noExisting')),
              h('button', {
                type: 'button',
                className: 'zc-folder-add',
                onClick: () => setShowExisting(false)
              }, h(Icon, { name: 'chevronLeft', size: 16 }), t('common.back'))
            )
          : h('p', { className: 'zc-existing-hint' },
              t('z.project.existingHint'),
              h('button', {
                type: 'button',
                className: 'zc-link',
                'data-testid': 'virtual-project-existing',
                onClick: () => setShowExisting(true)
              }, t('z.project.existingAction'), h(Icon, { name: 'chevronRight', size: 14 }))
            )
        : null

      const browseButtonLabel = busy
        ? t('common.loading')
        : connecting
          ? t('z.connecting')
          : isLocal
            ? t('z.folder.select')
            : hostStatus === 'online' ? t('z.folder.select') : t('z.project.connectAndBrowse')
      const browseHint = isLocal
        ? t('z.project.browseHint')
        : hostStatus === 'online'
          ? t('z.project.browseHint')
          : t('z.project.connectAndBrowseHint', { status: t(`z.project.deviceStatus.${hostStatus}`) })

      const createBody = h('div', { className: 'zc-create-body' },
        h('div', { className: 'zc-create-field' },
          h('label', { className: 'zc-create-label', htmlFor: 'zc-project-name' }, t('z.project.name')),
          h('input', {
            id: 'zc-project-name',
            className: 'zc-input zc-create-input',
            'data-testid': 'virtual-project-name',
            autoFocus: true,
            value: name,
            placeholder: t('z.project.new'),
            disabled: busy || Boolean(jobId),
            onChange: (event) => setName(event.target.value)
          })
        ),
        h('div', { className: 'zc-create-field' },
          h('span', { className: 'zc-create-label' }, t('z.project.device')),
          h('div', { className: 'zc-select-wrap', ref: menuRef },
            h('button', {
              type: 'button',
              id: 'zc-project-device',
              ref: deviceButtonRef,
              className: 'zc-select-trigger',
              'data-testid': 'virtual-project-device',
              'aria-expanded': menuOpen ? 'true' : 'false',
              disabled: busy || Boolean(jobId),
              onClick: () => setMenuOpen((old) => !old)
            },
              h(DeviceLabel, {
                label: isLocal ? t('z.project.thisComputer') : (host?.name || deviceId),
                status: isLocal ? null : hostStatus,
                local: isLocal
              }),
              h(Icon, { name: 'chevronDown', size: 14 })
            )
          )
        ),
        existingBlock,
        h('div', { className: 'zc-folders' },
          h('span', { className: 'zc-create-label' }, t('z.project.folders')),
          roots.length > 0
            ? h('div', { className: 'zc-folder-list', 'data-testid': 'virtual-project-roots' },
                roots.map((path) => h('div', { key: path, className: 'zc-folder-row', 'data-testid': 'virtual-project-root-row' },
                  h(Icon, { name: 'folder', size: 16 }),
                  h('span', {
                    className: `zc-folder-name${isLocal ? ' break' : ''}`,
                    title: path,
                    'data-testid': 'virtual-project-root-name'
                  }, isLocal ? path : projectBaseName(path)),
                  h('span', { className: 'zc-primary-badge', 'data-testid': 'virtual-project-primary' }, t('z.project.primary')),
                  localAvailable && isLocal
                    ? h('button', {
                        type: 'button',
                        className: 'zc-btn zc-btn-ghost zc-btn-icon zc-folder-remove',
                        title: t('z.project.removeFolder'),
                        'aria-label': t('z.project.removeFolder'),
                        'data-testid': 'virtual-project-remove-folder',
                        disabled: busy,
                        onClick: () => setRoots([])
                      }, h(Icon, { name: 'x', size: 16 }))
                    : null
                )),
                h('button', {
                  type: 'button',
                  className: 'zc-folder-add',
                  'data-testid': 'virtual-project-browse',
                  disabled: busy || connecting,
                  onClick: pickFolder
                }, h(Icon, { name: 'folderPlus', size: 16 }), t('z.project.addSourceFolder'))
              )
            : h('button', {
                type: 'button',
                className: 'zc-folder-empty',
                'data-testid': 'virtual-project-browse',
                disabled: busy || connecting || (isLocal && !localAvailable),
                onClick: pickFolder
              },
                h('span', { className: 'zc-folder-empty-icon' }, h(Icon, { name: 'folderPlus', size: 16 })),
                h('span', { className: 'zc-folder-empty-title' }, browseButtonLabel),
                h('span', { className: 'zc-folder-empty-hint' }, browseHint)
              )
        ),
        error ? h('p', { className: 'zc-create-error', role: 'alert' }, error) : null
      )

      const createFooter = h('div', { className: 'zc-create-foot' },
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost',
          onClick: onClose,
          disabled: busy
        }, t('z.project.cancel')),
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-default',
          'data-testid': 'virtual-project-save',
          disabled: !canCreate,
          onClick: () => void create()
        }, busy ? h(Spinner, { className: 'zc-spin' }) : null, t('z.project.create'))
      )

      const browseBody = host
        ? h('div', { className: 'zc-folder-modal', 'data-testid': 'virtual-project-directory-browser' },
            h(RemoteBrowser, {
              hostId: host.id,
              value: browsePath,
              onChange: setBrowsePath,
              allowMissing: true,
              onNavState: setDirReady
            }),
            h('div', { className: 'zc-folder-foot' },
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-secondary',
                onClick: () => setBrowseOpen(false)
              }, t('common.cancel')),
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-default',
                'data-testid': 'directory-browser-confirm',
                disabled: !browsePath.trim() || !dirReady,
                onClick: () => {
                  setRoots([browsePath])
                  setBrowseOpen(false)
                }
              }, t('z.folder.select'))
            )
          )
        : null

      const localBrowseBody = h('div', { className: 'zc-folder-modal', 'data-testid': 'virtual-project-directory-browser' },
        h(LocalBrowser, {
          value: localPath,
          onChange: setLocalPath
        }),
        h('div', { className: 'zc-folder-foot' },
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-secondary',
            onClick: () => setLocalBrowseOpen(false)
          }, t('common.cancel')),
          h('button', {
            type: 'button',
            className: 'zc-btn zc-btn-default',
            'data-testid': 'directory-browser-confirm',
            disabled: !localPath.trim(),
            onClick: () => {
              setRoots([localPath])
              setLocalBrowseOpen(false)
            }
          }, t('z.folder.select'))
        )
      )

      return h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose?.() }
      },
        h('div', { className: 'zc-create-center' },
          h('div', {
            className: 'zc-dialog zc-create',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'zc-project-title'
          },
            headerRow,
            folderMode ? (browseOpen ? browseBody : localBrowseBody) : createBody,
            folderMode ? null : createFooter
          )
        ),
        h(AnchoredMenu, {
          open: menuOpen,
          anchorRef: deviceButtonRef,
          className: 'zc-select-menu',
          children: deviceMenuItems
        }),
        jobId ? h(JobModal, {
          jobId,
          title: t('z.project.create'),
          onClose: () => setJobId(''),
          onDone: (job) => {
            if (job.state === 'succeeded') {
              setJobId('')
              void openWorkspace(job.result)
            }
          }
        }) : null,
        addOpen ? h(ZcodeRemoteDialog, {
          mode: 'device-management',
          onClose: () => setAddOpen(false),
          onManaged: (createdHost) => {
            setAddOpen(false)
            void load(createdHost?.id)
          }
        }) : null
      )
    }

    function ZcodeRemoteDialog({ onClose, onCreated, openPanel, openNativeWorkspace, mode = 'wizard', onManaged }) {
      const deviceManagement = mode === 'device-management'
      const previous = pausedWizard
      const [step, setStep] = useState(previous?.step || (deviceManagement ? 'settings' : 'device'))
      const [hosts, setHosts] = useState([])
      const [workspaces, setWorkspaces] = useState([])
      const [settings, setSettings] = useState(null)
      const [aliases, setAliases] = useState([])
      const [discovery, setDiscovery] = useState({
        wsl: { available: false, distros: [], error: '', loading: true },
        docker: { available: false, containers: [], error: '', loading: true }
      })
      const [dockerOpen, setDockerOpen] = useState(false)
      const [dockerQuery, setDockerQuery] = useState('')
      const [dockerLoading, setDockerLoading] = useState(false)
      const [query, setQuery] = useState(previous?.query || '')
      const [form, setForm] = useState(previous?.form || emptyConnectForm())
      const [editingId, setEditingId] = useState(previous?.editingId || '')
      const [errors, setErrors] = useState({})
      const [showPassword, setShowPassword] = useState(false)
      const [advanced, setAdvanced] = useState(false)
      const [importOpen, setImportOpen] = useState(false)
      const [importQuery, setImportQuery] = useState('')
      const [selectedAlias, setSelectedAlias] = useState(previous?.selectedAlias || '')
      const [aliasesLoading, setAliasesLoading] = useState(false)
      const [aliasesError, setAliasesError] = useState('')
      const [phases, setPhases] = useState([])
      const [connectLog, setConnectLog] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [dirHostId, setDirHostId] = useState(previous?.dirHostId || '')
      const [remotePath, setRemotePath] = useState(previous?.remotePath || '~')
      const [deviceName, setDeviceName] = useState(previous?.deviceName || '')
      const [renameState, setRenameState] = useState('idle')
      const [openingId, setOpeningId] = useState('')
      const [browseRequest, setBrowseRequest] = useState(null)
      const [logOpen, setLogOpen] = useState(false)
      const [pasteInfo, setPasteInfo] = useState(null)
      const [dirReady, setDirReady] = useState(false)
      const [clock, setClock] = useState(Date.now())
      const keyFileRef = useRef(null)
      const dockerRef = useRef(null)
      const importButtonRef = useRef(null)
      const probeToken = useRef(0)
      const bg = useBackgroundFlow()

      const load = useCallback(async () => {
        setAliasesLoading(true)
        try {
          const [hostData, workspaceData, settingsData, aliasData, discoveryData] = await Promise.all([
            api('GET', '/ssh-remote/hosts'),
            api('GET', '/ssh-remote/workspaces?refresh=0'),
            api('GET', '/ssh-remote/settings'),
            api('GET', '/ssh-remote/ssh-config').catch((err) => ({ aliases: [], error: errorMessage(err) })),
            api('GET', '/ssh-remote/discover').catch(() => null)
          ])
          setHosts(hostData.hosts || [])
          setWorkspaces(workspaceData.workspaces || [])
          setSettings(settingsData.settings || null)
          setAliases(aliasData.aliases || [])
          setAliasesError(aliasData.error || '')
          if (discoveryData?.ok) {
            setDiscovery({
              wsl: {
                available: Boolean(discoveryData.wsl?.available),
                distros: discoveryData.wsl?.distros || [],
                error: discoveryData.wsl?.error || '',
                loading: false
              },
              docker: {
                available: Boolean(discoveryData.docker?.available),
                containers: discoveryData.docker?.containers || [],
                error: discoveryData.docker?.error || '',
                loading: false
              }
            })
          }
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setAliasesLoading(false)
        }
      }, [])
      useEffect(() => { void load() }, [load])

      // ZCode renders the Docker picker as a popover; close it on an outside
      // press the same way Radix does.
      useEffect(() => {
        if (!dockerOpen) return undefined
        const onPointerDown = (event) => {
          if (dockerRef.current && !dockerRef.current.contains(event.target)) setDockerOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [dockerOpen])

      useEffect(() => {
        if (!importOpen) return undefined
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-zc-popover="true"]')) return
          if (importButtonRef.current && !importButtonRef.current.contains(event.target)) setImportOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
      }, [importOpen])

      // Phase durations in ZCode's connecting list tick every second.
      useEffect(() => {
        if (step !== 'connecting') return undefined
        const timer = setInterval(() => setClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [step])

      // The wizard is a view over the module-level flow: reopening it after a
      // minimize lands on the live step instead of resetting to the device list.
      useEffect(() => {
        if (previous) {
          setPausedWizard(null)
          return
        }
        // Device management always starts a fresh 新建连接 form; a minimized
        // workspace flow belongs to the wizard surface, not this dialog.
        if (deviceManagement) return
        backgroundFlow.restore()
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' || snapshot.phase === 'failed') setStep('connecting')
        if (snapshot.phase === 'done' && snapshot.kind === 'prepare') {
          setEditingId(snapshot.hostId)
          setDirHostId(snapshot.hostId)
          setRemotePath(snapshot.path || '~')
          setStep('directory')
        }
        if (snapshot.phase === 'done' && snapshot.kind === 'create') {
          // The workspace already exists in the native list; a fresh wizard
          // should not reopen the old completion.
          backgroundFlow.reset()
        }
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          const phase = backgroundFlow.snapshot.phase
          if (phase === 'running' || phase === 'failed') backgroundFlow.minimize()
          onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      useEffect(() => {
        if (!bg.hostId || hosts.length === 0) return
        const host = hosts.find((row) => row.id === bg.hostId)
        if (!host) return
        setEditingId((current) => current || host.id)
        setForm((current) => (current.host ? current : hostToForm(host)))
      }, [bg.hostId, hosts])

      const sortWorkspaces = (rows) => [...rows].sort((a, b) => {
        const left = String(a.lastOpenedAt || a.updatedAt || '')
        const right = String(b.lastOpenedAt || b.updatedAt || '')
        return right.localeCompare(left)
      })
      const workspacesFor = (hostId) => sortWorkspaces(workspaces.filter((row) => row.hostId === hostId))
      const hostOf = (hostId) => hosts.find((row) => row.id === hostId) || null

      const finishCreate = useCallback((workspace) => {
        backgroundFlow.reset()
        if (!workspace) {
          onClose()
          return
        }
        onCreated?.(workspace)
        const opened = workspace.nativeWorkspaceId ? openNativeWorkspace?.(workspace.nativeWorkspaceId) : false
        onClose()
        if (!opened) openPanel?.()
      }, [onClose, onCreated, openPanel, openNativeWorkspace])

      useEffect(() => {
        if (bg.phase !== 'done') return
        if (bg.kind === 'prepare' && step === 'connecting') {
          if (deviceManagement) {
            if (!editingId || bg.hostId !== editingId) return
            onManaged?.(hostOf(bg.hostId))
            onClose()
            return
          }
          setEditingId(bg.hostId)
          setDirHostId(bg.hostId)
          setRemotePath(bg.path || '~')
          setStep('directory')
          return
        }
        if (bg.kind === 'create' && step === 'connecting') finishCreate(bg.workspace)
      }, [bg.phase, bg.kind, bg.startedAt, bg.workspace, step, finishCreate, deviceManagement, editingId, onManaged, onClose])

      useEffect(() => {
        if (step !== 'directory') return
        const host = hostOf(dirHostId)
        if (host) setDeviceName(host.name)
      }, [step, dirHostId, hosts])

      const update = (patch) => {
        // ZCode `Kvt`: editing any connection field unlinks the SSH config alias.
        if (['host', 'port', 'username', 'privateKeyPath', 'authKind'].some((key) => key in patch)) {
          setSelectedAlias('')
        }
        setForm((old) => ({ ...old, ...patch }))
      }
      const applyAlias = (alias) => {
        setForm((old) => ({
          ...old,
          name: old.name || alias.alias,
          host: alias.host || alias.alias,
          port: alias.port || 22,
          username: alias.username || old.username,
          authKind: alias.privateKeyPath ? 'key' : old.authKind,
          privateKeyPath: alias.privateKeyPath || old.privateKeyPath
        }))
        setSelectedAlias(alias.alias)
        setImportOpen(false)
        setImportQuery('')
        setErrors({})
      }
      const openHost = (host) => {
        setForm(hostToForm(host))
        setEditingId(host.id)
        setSelectedAlias('')
        setErrors({}); setError(''); setImportOpen(false)
        setStep('settings')
      }
      const openNew = (kind = 'ssh') => {
        setForm({ ...emptyConnectForm(), kind })
        setEditingId('')
        setDirHostId('')
        setRemotePath('~')
        setDeviceName('')
        setSelectedAlias('')
        setErrors({}); setError(''); setImportOpen(false); setAdvanced(false); setDockerOpen(false)
        setStep('settings')
      }
      // nVn's WSL distribution / Docker container rows select that target and
      // land on the settings step with the value prefilled.
      const openDiscovered = (kind, row) => {
        if (kind === 'wsl') {
          setForm({ ...emptyConnectForm(), kind: 'wsl', distro: row.name })
        } else {
          setForm({
            ...emptyConnectForm(),
            kind: 'docker',
            container: row.name,
            manualContainer: row.name,
            dockerMode: 'select',
            image: row.image || ''
          })
        }
        setEditingId(''); setDirHostId(''); setRemotePath('~'); setDeviceName('')
        setErrors({}); setError(''); setImportOpen(false); setAdvanced(false); setDockerOpen(false)
        setStep('settings')
      }

      const refreshDocker = useCallback(async () => {
        setDockerLoading(true)
        try {
          const data = await api('GET', '/ssh-remote/discover?kind=docker')
          setDiscovery((old) => ({
            ...old,
            docker: {
              available: Boolean(data.docker?.available),
              containers: data.docker?.containers || [],
              error: data.docker?.error || '',
              loading: false
            }
          }))
        } catch (err) {
          setDiscovery((old) => ({
            ...old,
            docker: { ...old.docker, error: errorMessage(err), loading: false }
          }))
        } finally {
          setDockerLoading(false)
        }
      }, [])

      const hostPayload = () => {
        if (form.kind === 'wsl') {
          return {
            id: editingId || undefined,
            kind: 'wsl',
            name: form.name || form.distro.trim() || 'WSL',
            distro: form.distro.trim(),
            user: form.wslUser.trim(),
            defaultPath: form.defaultPath || '~'
          }
        }
        if (form.kind === 'docker') {
          const container = (form.dockerMode === 'manual' ? form.manualContainer : form.container).trim()
          return {
            id: editingId || undefined,
            kind: 'docker',
            name: form.name || container || 'Docker',
            container,
            image: form.image || '',
            defaultPath: form.defaultPath || '~'
          }
        }
        const auth = form.authKind === 'key'
          ? { kind: 'key', privateKeyPath: form.privateKeyPath.trim(), ...(form.passphrase ? { passphrase: form.passphrase } : {}) }
          : { kind: 'password', ...(form.password ? { password: form.password } : {}) }
        return {
          id: editingId || undefined,
          kind: 'ssh',
          name: form.name || form.host.trim(),
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username.trim(),
          auth,
          defaultPath: form.defaultPath || '~',
          hostKeyMode: form.hostKeyMode || 'accept-new',
          assetInstallMode: form.assetInstallMode || 'local-download-upload'
        }
      }

      const submitSettings = async () => {
        setImportOpen(false)
        const next = {}
        if (form.kind === 'wsl') {
          if (form.wslUser.trim() && !isValidWslUserClient(form.wslUser)) next.wslUser = t('z.wslInvalidUser')
        } else if (form.kind === 'docker') {
          const container = (form.dockerMode === 'manual' ? form.manualContainer : form.container).trim()
          if (!container) next.container = t('z.dockerRequired')
        } else {
          if (!form.host.trim()) next.host = t('z.validation.host')
          const port = Number(form.port)
          if (!Number.isInteger(port) || port < 1 || port > 65535) next.port = t('z.validation.port')
          if (!form.username.trim()) next.username = t('z.validation.username')
          if (form.authKind === 'key') {
            if (!form.privateKeyPath.trim()) next.privateKey = t('z.validation.key')
          } else if (!editingId && !form.password) {
            next.password = t('z.validation.password')
          }
        }
        setErrors(next)
        if (Object.keys(next).length > 0) return

        setStep('connecting'); setBusy(true); setError(''); setConnectLog('')
        setPhases([
          { key: 'channel', label: phaseChannelLabel(form.kind), status: 'active' },
          { key: 'identify', label: t('z.phase.identify'), status: 'pending' },
          { key: 'deploy', label: t('z.phase.deploy'), status: 'pending' }
        ])
        const payload = hostPayload()
        const token = probeToken.current + 1
        probeToken.current = token
        try {
          // Probe before saving so a typo does not leave a broken device behind,
          // and reuse an existing record with the same target.
          const probeData = await api('POST', '/ssh-remote/hosts/test', { host: payload })
          if (probeToken.current !== token) return
          const probe = probeData.probe || {}
          setConnectLog([
            `${t('z.connect')} ${targetLabelFor(payload)}`,
            `${probe.platform || ''} ${probe.arch || ''} · Node ${probe.node || '—'} · ${probe.latencyMs ?? '?'}ms`
          ].join('\n'))
          setPhases((old) => old.map((row) => ({ ...row, status: 'complete' })))
          const existing = hosts.find((row) => {
            if (row.id === editingId || kindOfrow(row) !== form.kind) return false
            if (form.kind === 'wsl') {
              return (String(row.distro || '').trim()) === String(payload.distro || '').trim()
                && (String(row.user || '').trim()) === String(payload.user || '').trim()
            }
            if (form.kind === 'docker') return String(row.container || '') === String(payload.container || '')
            return row.host === payload.host
              && Number(row.port) === Number(payload.port)
              && row.username === payload.username
          })
          const saved = await api('POST', '/ssh-remote/hosts/save', { host: { ...payload, id: payload.id || existing?.id } })
          if (probeToken.current !== token) return
          const host = saved.host
          setEditingId(host.id)
          setDirHostId(host.id)
          const recent = workspacesFor(host.id)[0]
          const path = recent?.remotePath || host.defaultPath || '~'
          setRemotePath(path)
          setBusy(false)
          void backgroundFlow.startPrepare(host, { path, probe })
        } catch (err) {
          if (probeToken.current !== token) return
          setBusy(false)
          setError(errorMessage(err))
          setConnectLog((old) => `${old}${old ? '\n' : ''}${errorMessage(err)}`)
          setPhases((old) => old.map((row) => (row.status === 'active' ? { ...row, status: 'failed' } : row)))
        }
      }

      const connectSaved = (host) => {
        setEditingId(host.id)
        setForm(hostToForm(host))
        setErrors({}); setError(''); setConnectLog(''); setRenameState('idle')
        const recent = workspacesFor(host.id)[0]
        const path = recent?.remotePath || host.defaultPath || '~'
        setDirHostId(host.id)
        setRemotePath(path)
        setStep('connecting')
        void backgroundFlow.startPrepare(host, { path })
      }

      const createWorkspace = () => {
        if (!dirHostId) return
        const host = hostOf(dirHostId)
        const path = String(remotePath || '~').trim() || '~'
        // ZCode reuses the existing workspace when the directory already has
        // one instead of failing the create job.
        const existing = workspaces.find((row) => row.hostId === dirHostId && row.remotePath === path)
        if (existing) {
          void openExisting(existing)
          return
        }
        setError('')
        setStep('connecting')
        void backgroundFlow.startCreate({
          hostId: dirHostId,
          host,
          targetKind: host ? kindOfrow(host) : 'ssh',
          path,
          name: '',
          device: host ? targetLabelFor(host) : deviceLabel,
          syncCredentials: settings ? settings.syncCredentials !== false : true,
          createIfMissing: settings ? settings.createIfMissing !== false : true
        })
      }

      const openExisting = async (workspace) => {
        setOpeningId(workspace.id)
        setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/open', { id: workspace.id })
          const ws = data.workspace || workspace
          const opened = ws.nativeWorkspaceId ? openNativeWorkspace?.(ws.nativeWorkspaceId) : false
          if (!opened) {
            setError(t('z.openFailed'))
            return
          }
          onCreated?.(ws)
          onClose()
          // ZCode reconnects the device after opening a project. Probe the
          // real service (the cached badge can be stale) and start it in the
          // background when needed; navigation never blocks on the probe.
          void api('GET', `/ssh-remote/workspaces/status?id=${encodeURIComponent(ws.id)}`)
            .then((data) => {
              if (data?.ok && data.status?.state !== 'running') {
                return api('POST', '/ssh-remote/workspaces/action', { op: 'start', id: ws.id })
              }
              return null
            })
            .catch(() => {})
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setOpeningId('')
        }
      }

      const retryConnection = () => {
        const snapshot = backgroundFlow.snapshot
        const wasIdle = snapshot.phase === 'idle'
        const kind = snapshot.kind
        backgroundFlow.reset()
        setError(''); setConnectLog('')
        // A validation/probe failure never reached the background job: repeat
        // the form submission so edited credentials are used.
        if (wasIdle) {
          void submitSettings()
          return
        }
        if (kind === 'create' && dirHostId) {
          createWorkspace()
          return
        }
        const host = editingId ? hostOf(editingId) : null
        if (host) {
          void backgroundFlow.startPrepare(host, { path: remotePath })
          return
        }
        setStep('settings')
      }

      const backToConfig = () => {
        probeToken.current += 1
        const wasCreate = backgroundFlow.snapshot.kind === 'create'
        backgroundFlow.reset()
        setBusy(false)
        setError(''); setConnectLog('')
        if (wasCreate) {
          setStep('directory')
          return
        }
        const host = editingId ? hostOf(editingId) : null
        if (host) setForm(hostToForm(host))
        setStep('settings')
      }

      const minimizeFlow = () => {
        backgroundFlow.minimize()
        onClose()
      }

      // ZCode's header offers minimize on every step. Before a job exists we
      // park the wizard state so the pill can resume configuration.
      const minimizeWizard = () => {
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' || snapshot.phase === 'failed') {
          minimizeFlow()
          return
        }
        setPausedWizard({
          step,
          form,
          editingId,
          dirHostId,
          remotePath,
          query,
          deviceName,
          device: wizardName
        })
        onClose()
      }

      const closeOrMinimize = () => {
        const phase = backgroundFlow.snapshot.phase
        if (phase === 'running' || phase === 'failed') minimizeFlow()
        else onClose()
      }

      // ZCode's cancel button aborts the wizard. Preparing the runtime is
      // side-effect-free, so dropping the flow is safe; a workspace creation
      // that already started keeps running and stays visible in the pill.
      const cancelOrMinimize = () => {
        probeToken.current += 1
        const snapshot = backgroundFlow.snapshot
        if (snapshot.phase === 'running' && snapshot.kind === 'create') {
          minimizeFlow()
          return
        }
        backgroundFlow.reset()
        setBusy(false); setError(''); setConnectLog(''); setPhases([])
        setStep('device')
      }

      const saveRename = async () => {
        const host = hostOf(dirHostId)
        const name = deviceName.trim()
        if (!host || !name || name === host.name) return
        setRenameState('saving')
        try {
          const data = await api('POST', '/ssh-remote/hosts/rename', { id: dirHostId, name })
          setHosts((old) => old.map((row) => (row.id === data.host.id ? data.host : row)))
          setRenameState('saved')
        } catch {
          setRenameState('failed')
        }
      }

      const needle = query.trim().toLowerCase()
      const matches = (...parts) => !needle || parts.filter(Boolean).join(' ').toLowerCase().includes(needle)
      const filteredHosts = hosts.filter((host) => matches(host.name, host.host, host.username, host.distro, host.user, host.container, host.image))
      const filteredAliases = aliases.filter((alias) => matches(alias.alias, alias.host, alias.username))
      const importNeedle = importQuery.trim().toLowerCase()
      const importAliases = aliases.filter((alias) => !importNeedle
        || [alias.alias, alias.host, alias.username].filter(Boolean).join(' ').toLowerCase().includes(importNeedle))
      const filteredDistros = (discovery.wsl.distros || []).filter((row) => matches(row.name))
      const filteredContainers = (discovery.docker.containers || []).filter((row) => matches(row.name, row.id, row.image))
      const activeHost = hostOf(dirHostId) || (editingId ? hostOf(editingId) : null)
      const activeKind = activeHost ? kindOfrow(activeHost) : kindOfrow(form)
      const deviceLabel = activeHost ? targetLabelFor(activeHost) : targetLabelFor(form)
      const flowIdle = bg.phase === 'idle'
      const displayPhases = flowIdle ? phases : bg.phases
      const displayLines = flowIdle ? connectLog : bg.lines.join('\n')
      const displayError = flowIdle ? error : (bg.error || error)
      const deployActive = displayPhases.some((row) => row.key === 'deploy' && row.status === 'active')
      const createActive = displayPhases.some((row) => row.key === 'create' && row.status === 'active')
      const wizardName = activeHost?.name || form.name || deviceLabel
      // ZCode `qpt`: SSH user@host:port, WSL distribution, Docker container.
      const previewTarget = (kind, row) => {
        if (kind === 'wsl') return String(row.distro ?? row.wslDistro ?? '').trim() || null
        if (kind === 'docker') return String(row.dockerMode === 'manual' ? row.manualContainer : (row.container || row.manualContainer) || '').trim() || null
        return row.host ? `${row.username || 'user'}@${row.host}:${row.port || 22}` : null
      }
      const header = step === 'device'
        ? { title: t('z.title.device'), desc: t('z.desc.device') }
        : step === 'settings'
          ? deviceManagement
            ? { title: t('z.settings.newConnection'), desc: '' }
            : { title: t('z.title.settings'), preview: previewTarget(activeKind, form), kind: activeKind }
          : step === 'directory'
            ? { title: t('z.title.directory'), desc: t('z.desc.directory', { method: wizardName }), kind: activeKind }
            : {
                title: t('z.title.connecting'),
                kind: bg.phase === 'idle' ? activeKind : (bg.targetKind || activeKind),
                desc: displayError
                  ? t('z.desc.failed')
                  : bg.phase === 'done'
                    ? t('z.connectedTo', { device: wizardName })
                    : t('z.connectingVia', { method: deviceLabel })
              }

      const importMenuNode = h(AnchoredMenu, {
        open: importOpen && form.kind === 'ssh',
        anchorRef: importButtonRef,
        width: 320,
        align: 'end',
        className: 'zc-import-menu',
        children: [
          h('input', {
            key: 'search',
            className: 'zc-input zc-import-search',
            type: 'search',
            autoFocus: true,
            placeholder: t('z.configAliasSearch'),
            'aria-label': t('z.configAliasSearch'),
            value: importQuery,
            onChange: (event) => setImportQuery(event.target.value)
          }),
          ...importAliases.map((alias) => h('button', {
            key: alias.alias,
            type: 'button',
            className: 'zc-import-item',
            'data-checked': selectedAlias === alias.alias ? 'true' : 'false',
            onClick: () => applyAlias(alias)
          },
            h(Icon, { name: 'server', size: 16 }),
            h('span', { className: 'zc-import-item-main' },
              h('span', null, alias.alias),
              h('span', null, `${alias.username ? `${alias.username}@` : ''}${alias.host || alias.alias}:${alias.port || 22}`)
            )
          )),
          importAliases.length === 0
            ? h('div', { key: 'empty', className: 'zc-docker-empty' }, t('z.configAliasEmpty'))
            : null
        ].filter(Boolean)
      })

      let body = null
      if (step === 'device') {
        body = h('div', { className: 'zc-step-device' },
          h('div', { className: 'zc-search-wrap' },
            h('span', { className: 'zc-search-icon' }, h(Icon, { name: 'search', size: 16 })),
            h('input', {
              type: 'search',
              className: 'zc-input zc-search-input',
              autoFocus: true,
              placeholder: t('z.search'),
              'aria-label': t('z.search'),
              value: query,
              onChange: (event) => setQuery(event.target.value)
            })
          ),
          h('div', {
            className: 'zc-scroll',
            onKeyDown: (event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'))
              if (buttons.length === 0) return
              const index = buttons.indexOf(document.activeElement)
              const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              buttons[next]?.focus()
              event.preventDefault()
            }
          },
            filteredHosts.length > 0
              ? h('section', { key: 'hosts', 'aria-label': t('z.saved') },
                  h('p', { className: 'zc-section-title' }, t('z.saved')),
                  filteredHosts.map((host) => {
                    const rows = workspacesFor(host.id)
                    const online = rows.some((row) => row.status?.state === 'running')
                    return h('div', { key: host.id, className: 'zc-device-item', 'data-remote-source-server-id': host.id },
                      h('button', {
                        type: 'button',
                        className: 'zc-device',
                        title: `${t('z.connect')} ${targetLabelFor(host)}`,
                        onClick: () => connectSaved(host)
                      },
                        h('span', { className: `zc-device-icon zc-device-icon-${kindOfrow(host)}` }, h(Icon, { name: kindIconName(kindOfrow(host)), size: 16 })),
                        h('span', { className: 'zc-device-main' },
                          h('span', { className: 'zc-device-name' }, host.name),
                          h('span', { className: 'zc-device-desc' }, targetLabelFor(host))
                        ),
                        h(StatusBadge, { tone: online ? 'success' : 'neutral' }, online ? t('z.status.connected') : t('z.status.offline'))
                      ),
                      rows.length > 0
                        ? h('div', { className: 'zc-chips' }, rows.slice(0, 3).map((row) => h('button', {
                            key: row.id,
                            type: 'button',
                            className: 'zc-chip',
                            title: row.remotePath,
                            disabled: Boolean(openingId),
                            onClick: () => void openExisting(row)
                          },
                            openingId === row.id ? h(Spinner, { className: 'zc-spin' }) : h(Icon, { name: 'folder', size: 12 }),
                            h('span', null, row.remotePath)
                          )))
                        : null
                    )
                  })
                )
              : null,
            filteredAliases.length > 0
              ? h('section', { key: 'aliases', 'aria-label': t('z.sshHosts') },
                  h('p', { className: 'zc-section-title' }, t('z.sshHosts'), h('span', { className: 'zc-section-mono' }, '~/.ssh/config')),
                  filteredAliases.map((alias) => h('button', {
                    key: alias.alias,
                    type: 'button',
                    className: 'zc-device',
                    onClick: () => { applyAlias(alias); setStep('settings') }
                  },
                    h('span', { className: 'zc-device-icon zc-device-icon-ssh' }, h(Icon, { name: 'server', size: 16 })),
                    h('span', { className: 'zc-device-main' },
                      h('span', { className: 'zc-device-name' }, alias.alias),
                      h('span', { className: 'zc-device-desc' }, `${alias.username ? `${alias.username}@` : ''}${alias.host || alias.alias}${alias.port ? `:${alias.port}` : ''}`)
                    )
                  ))
                )
              : null,
            filteredDistros.length > 0
              ? h('section', { key: 'wsl', 'aria-label': t('z.wslSection') },
                  h('p', { className: 'zc-section-title' }, t('z.wslSection')),
                  filteredDistros.map((row) => h('button', {
                    key: row.name,
                    type: 'button',
                    className: 'zc-device',
                    onClick: () => openDiscovered('wsl', row)
                  },
                    h('span', { className: 'zc-device-icon zc-device-icon-wsl' }, h(Icon, { name: 'squareTerminal', size: 16 })),
                    h('span', { className: 'zc-device-main' },
                      h('span', { className: 'zc-device-name' }, row.name),
                      h('span', { className: 'zc-device-desc' }, t('z.wslDesc'))
                    )
                  ))
                )
              : null,
            filteredContainers.length > 0
              ? h('section', { key: 'docker', 'aria-label': t('z.dockerSection') },
                  h('p', { className: 'zc-section-title' }, t('z.dockerSection')),
                  filteredContainers.map((row) => h('button', {
                    key: row.id,
                    type: 'button',
                    className: 'zc-device',
                    onClick: () => openDiscovered('docker', row)
                  },
                    h('span', { className: 'zc-device-icon zc-device-icon-docker' }, h(Icon, { name: 'box', size: 16 })),
                    h('span', { className: 'zc-device-main' },
                      h('span', { className: 'zc-device-name' }, row.name),
                      h('span', { className: 'zc-device-desc' }, row.image)
                    )
                  ))
                )
              : null,
            discovery.wsl.loading || discovery.docker.loading
              ? h('p', { key: 'discovering', role: 'status', className: 'zc-section-title', style: { margin: 0 } }, t('common.loading'))
              : null,
            filteredHosts.length === 0 && filteredAliases.length === 0
              && filteredDistros.length === 0 && filteredContainers.length === 0
              && !discovery.wsl.loading && !discovery.docker.loading
              ? h('p', { key: 'empty', className: 'zc-section-title', style: { margin: 0 } }, t('z.empty'))
              : null,
            discovery.wsl.error || discovery.docker.error
              ? h('p', { key: 'discover-error', role: 'status', className: 'zc-hint', style: { margin: 0, color: 'var(--zc-warning-fg)' } }, t('z.optionsLoadFailed'))
              : null,
            h('div', { key: 'new', className: 'zc-new-row' },
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-outline',
                'data-testid': 'remote-kind-ssh',
                onClick: () => openNew('ssh')
              },
                h(Icon, { name: 'plus', size: 14 }),
                t('z.newSsh')
              ),
              isWindowsClient()
                ? h('button', {
                    type: 'button',
                    className: 'zc-btn zc-btn-outline',
                    'data-testid': 'remote-kind-wsl',
                    onClick: () => openNew('wsl')
                  },
                    h(Icon, { name: 'plus', size: 14 }),
                    t('z.newWsl')
                  )
                : null,
              h('button', {
                type: 'button',
                className: 'zc-btn zc-btn-outline',
                'data-testid': 'remote-kind-docker',
                onClick: () => openNew('docker')
              },
                h(Icon, { name: 'plus', size: 14 }),
                t('z.newDocker')
              )
            )
          ),
          h('p', { className: 'zc-kbd-hint' }, t('z.keyboard'))
        )
      } else if (step === 'settings') {
        body = h('form', {
          className: 'zc-form',
          noValidate: true,
          onSubmit: (event) => { event.preventDefault(); void submitSettings() }
        },
          h('div', { className: 'zc-form-scroll' },
            deviceManagement ? h('div', { className: 'zc-type-row' },
              h('div', { className: 'zc-seg', role: 'group', 'aria-label': t('z.typeLabel') },
                ['ssh', ...(isWindowsClient() ? ['wsl'] : []), 'docker'].map((kind) => h('button', {
                  key: kind,
                  type: 'button',
                  'data-testid': `remote-kind-${kind}`,
                  'aria-pressed': form.kind === kind ? 'true' : 'false',
                  disabled: busy,
                  onClick: () => { if (kind !== form.kind) openNew(kind) }
                }, h(Icon, { name: kindIconName(kind), size: 14 }), kindLabel(kind)))
              ),
              form.kind === 'ssh'
                ? h('div', { className: 'zc-import-wrap' },
                    h('button', {
                      type: 'button',
                      ref: importButtonRef,
                      className: 'zc-import-btn',
                      'aria-expanded': importOpen ? 'true' : 'false',
                      disabled: busy || aliasesLoading || aliases.length === 0,
                      onClick: () => setImportOpen((old) => !old)
                    },
                      h(Icon, { name: 'gitBranch', size: 14 }),
                      t(aliasesLoading ? 'z.importLoading' : aliases.length === 0 ? 'z.importEmpty' : 'z.importFromConfig'),
                      h(Icon, { name: 'chevronDown', size: 14, className: 'zc-chev' })
                    )
                  )
                : null
            ) : null,
            deviceManagement && form.kind === 'ssh' && aliasesError
              ? h('div', { className: 'zc-hint zc-hint-warning', style: { margin: 0 } },
                  h(Icon, { name: 'alert', size: 14 }),
                  h('span', null, t('z.configAliasLoadFailed')))
              : null,
            form.kind === 'ssh'
              ? h('div', { className: 'zc-fields' },
              selectedAlias
                ? h('div', { className: 'zc-alias-row' },
                    h('span', { className: 'zc-alias-chip' },
                      h(Icon, { name: 'server', size: 14 }),
                      h('span', null, t('z.configAliasLinked', { alias: selectedAlias })),
                      h('button', {
                        type: 'button',
                        title: t('z.configAliasUnlink'),
                        'aria-label': t('z.configAliasUnlink'),
                        onClick: () => setSelectedAlias('')
                      }, h(Icon, { name: 'x', size: 12 }))
                    ),
                    h('span', { className: 'zc-alias-hint' }, t('z.configAliasLinkedHint'))
                  )
                : null,
              h('div', { className: 'zc-grid-host' },
                h('label', { className: 'zc-field' },
                  h('span', { className: 'zc-label' }, t('z.host')),
                  h('input', {
                    className: `zc-input mono${errors.host ? ' invalid' : ''}`,
                    value: form.host,
                    placeholder: t('z.hostPlaceholder'),
                    spellCheck: false,
                    autoCapitalize: 'none',
                    autoFocus: true,
                    onChange: (event) => { setPasteInfo(null); update({ host: event.target.value }) },
                    onPaste: (event) => {
                      // ZCode `Hvt`/`Vvt`: recognize `ssh …` command lines and
                      // user@host:port targets, then fill all three fields.
                      const text = String(event.clipboardData?.getData('text') || '').trim()
                      const parsed = parseSshPaste(text)
                      if (!parsed) return
                      event.preventDefault()
                      setPasteInfo(`${parsed.username ? `${parsed.username}@` : ''}${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`)
                      update({
                        host: parsed.host,
                        ...(parsed.username ? { username: parsed.username } : {}),
                        ...(parsed.port ? { port: parsed.port } : {})
                      })
                    }
                  }),
                  h(FieldError, { message: errors.host })
                ),
                h('label', { className: 'zc-field' },
                  h('span', { className: 'zc-label' }, t('z.port')),
                  h('input', {
                    className: `zc-input mono${errors.port ? ' invalid' : ''}`,
                    value: form.port,
                    inputMode: 'numeric',
                    placeholder: '22',
                    onChange: (event) => update({ port: event.target.value })
                  }),
                  h(FieldError, { message: errors.port })
                )
              ),
              pasteInfo && !errors.host
                ? h('p', { className: 'zc-hint zc-hint-success' }, t('z.pasteRecognized', { target: pasteInfo }))
                : null,
              h('label', { className: 'zc-field' },
                h('span', { className: 'zc-label' }, t('z.username')),
                h('input', {
                  className: `zc-input mono${errors.username ? ' invalid' : ''}`,
                  value: form.username,
                  placeholder: t('z.usernamePlaceholder'),
                  spellCheck: false,
                  autoCapitalize: 'none',
                  onChange: (event) => update({ username: event.target.value })
                }),
                h(FieldError, { message: errors.username })
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { className: 'zc-auth-row' },
                  h('span', { className: 'zc-auth-label' }, t('z.auth')),
                  h('div', { className: 'zc-seg' },
                    h('button', {
                      type: 'button',
                      'aria-pressed': form.authKind === 'password' ? 'true' : 'false',
                      onClick: () => update({ authKind: 'password' })
                    }, t('z.password')),
                    h('button', {
                      type: 'button',
                      'aria-pressed': form.authKind === 'key' ? 'true' : 'false',
                      onClick: () => update({ authKind: 'key' })
                    }, t('z.privateKey'))
                  )
                ),
                form.authKind === 'password'
                  ? h('div', null,
                      h('div', { className: 'zc-pwd' },
                        h('input', {
                          className: `zc-input${errors.password ? ' invalid' : ''}`,
                          type: showPassword ? 'text' : 'password',
                          value: form.password,
                          placeholder: t('z.passwordPlaceholder'),
                          autoComplete: 'off',
                          'aria-label': t('z.password'),
                          onChange: (event) => update({ password: event.target.value })
                        }),
                        h('button', {
                          type: 'button',
                          className: 'zc-eye',
                          title: showPassword ? t('z.hidePassword') : t('z.showPassword'),
                          'aria-label': showPassword ? t('z.hidePassword') : t('z.showPassword'),
                          onClick: () => setShowPassword((old) => !old)
                        }, h(EyeIcon, { off: showPassword }))
                      ),
                      h(FieldError, { message: errors.password })
                    )
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                      h('div', null,
                        h('div', { className: 'zc-pwd' },
                          h('input', {
                            className: `zc-input mono${errors.privateKey ? ' invalid' : ''}`,
                            value: form.privateKeyPath,
                            placeholder: t('z.keyPlaceholder'),
                            spellCheck: false,
                            'aria-label': t('z.privateKey'),
                            onChange: (event) => update({ privateKeyPath: event.target.value })
                          }),
                          h('button', {
                            type: 'button',
                            className: 'zc-eye',
                            title: t('z.chooseKeyFile'),
                            onClick: () => keyFileRef.current?.click()
                          }, h(Icon, { name: 'file', size: 16 }))
                        ),
                        h('input', {
                          type: 'file',
                          ref: keyFileRef,
                          style: { display: 'none' },
                          onChange: (event) => {
                            const file = event.target.files?.[0]
                            if (file?.path) update({ privateKeyPath: file.path })
                          }
                        }),
                        h(FieldError, { message: errors.privateKey })
                      ),
                      h('label', { className: 'zc-field' },
                        h('span', { className: 'zc-label' }, t('z.passphrase')),
                        h('input', {
                          className: 'zc-input',
                          type: 'password',
                          value: form.passphrase,
                          placeholder: t('z.passphrasePlaceholder'),
                          autoComplete: 'off',
                          onChange: (event) => update({ passphrase: event.target.value })
                        })
                      )
                    )
              ),
              h('div', null,
                h('button', {
                  type: 'button',
                  className: 'zc-adv-toggle',
                  'aria-expanded': advanced ? 'true' : 'false',
                  onClick: () => setAdvanced((old) => !old)
                },
                  h(Icon, { name: 'chevronRight', size: 14 }),
                  t('z.advanced')
                ),
                advanced
                  ? h('div', { className: 'zc-adv-panel' },
                      h('div', { className: 'zc-adv-group' },
                        h('span', { className: 'zc-label', style: { marginBottom: 0 } }, t('z.assetInstallMode')),
                        h('div', { className: 'zc-seg', role: 'group', 'aria-label': t('z.assetInstallMode') },
                          ['local-download-upload', 'remote-download'].map((assetMode) => h('button', {
                            key: assetMode,
                            type: 'button',
                            'aria-pressed': (form.assetInstallMode || 'local-download-upload') === assetMode ? 'true' : 'false',
                            onClick: () => update({ assetInstallMode: assetMode })
                          }, t(`z.assetInstallMode.${assetMode}`)))
                        ),
                        h('p', { className: 'zc-adv-desc' }, t('z.assetInstallModeDescription'))
                      )
                    )
                  : null
              )
            )

              : null,
            form.kind === 'wsl'
              ? h('div', { className: 'zc-fields zc-wsl-form' },
                  h('div', { className: 'zc-field' },
                    h('label', { className: 'zc-field' },
                      h('span', { className: 'zc-label' }, t('z.wslDistro')),
                      h('input', {
                        className: `zc-input${errors.distro ? ' invalid' : ''}`,
                        value: form.distro,
                        placeholder: t('z.wslDefaultDistro'),
                        list: 'zc-wsl-options',
                        autoFocus: true,
                        autoCapitalize: 'none',
                        spellCheck: false,
                        onChange: (event) => update({ distro: event.target.value })
                      }),
                      h('datalist', { id: 'zc-wsl-options' }, (discovery.wsl.distros || []).map((row) => h('option', { key: row.name, value: row.name })))
                    ),
                    h('p', { className: 'zc-hint', style: { margin: 0 } },
                      discovery.wsl.loading
                        ? t('z.wslLoading')
                        : discovery.wsl.error
                          ? t('z.optionsLoadFailed')
                          : (discovery.wsl.distros || []).length > 0
                            ? t('z.wslDetected', { count: String((discovery.wsl.distros || []).length) })
                            : t('z.wslNoDistros')
                    )
                  ),
                  h('div', null,
                    h('label', { className: 'zc-field' },
                      h('span', { className: 'zc-label' }, t('z.wslUser')),
                      h('input', {
                        className: `zc-input${errors.wslUser ? ' invalid' : ''}`,
                        value: form.wslUser,
                        placeholder: t('z.wslDefaultUser'),
                        autoCapitalize: 'none',
                        spellCheck: false,
                        onChange: (event) => update({ wslUser: event.target.value })
                      }),
                      h(FieldError, { message: errors.wslUser })
                    ),
                    errors.wslUser
                      ? null
                      : h('p', { className: 'zc-hint', style: { margin: 0 } }, t('z.wslUserDescription')),
                    form.wslUser.trim().toLowerCase() === 'root'
                      ? h('p', { className: 'zc-hint zc-hint-warning', style: { margin: 0 } }, t('z.wslRootWarning'))
                      : null
                  )
                )
              : null,
            form.kind === 'docker'
              ? h('div', { className: 'zc-fields zc-docker-form' },
                  h('div', { role: 'group', 'aria-label': 'Docker', className: 'zc-seg' },
                    ['select', 'manual'].map((mode) => h('button', {
                      key: mode,
                      type: 'button',
                      'aria-pressed': form.dockerMode === mode ? 'true' : 'false',
                      onClick: () => update({ dockerMode: mode, container: '', manualContainer: '', image: '' })
                    }, t(mode === 'select' ? 'z.dockerInputSelect' : 'z.dockerInputManual')))
                  ),
                  form.dockerMode === 'select'
                    ? h('div', { ref: dockerRef, className: 'zc-docker-picker' },
                        h('label', { className: 'zc-field' },
                          h('span', { className: 'zc-label' }, t('z.dockerContainer')),
                          h('button', {
                            type: 'button',
                            className: `zc-input as-button docker-trigger${errors.container ? ' invalid' : ''}`,
                            'aria-expanded': dockerOpen ? 'true' : 'false',
                            disabled: busy,
                            onClick: () => {
                              const next = !dockerOpen
                              setDockerOpen(next)
                              if (next) void refreshDocker()
                            }
                          },
                            h('span', { className: 'zc-truncate' + (form.container ? '' : ' muted') },
                              form.container || ((discovery.docker.loading || dockerLoading) ? t('z.dockerLoading') : t('z.dockerSelectContainer'))
                            ),
                            (discovery.docker.loading || dockerLoading)
                              ? h(Spinner, { className: 'zc-spin' })
                              : h(Icon, { name: 'chevronDown', size: 14 })
                          ),
                          h(FieldError, { message: errors.container })
                        ),
                        dockerOpen
                          ? h('div', { className: 'zc-docker-menu' },
                              h('input', {
                                className: 'zc-input zc-docker-search',
                                type: 'search',
                                autoFocus: true,
                                value: dockerQuery,
                                placeholder: t('z.dockerSelectContainer'),
                                'aria-label': t('z.dockerSelectContainer'),
                                onChange: (event) => setDockerQuery(event.target.value)
                              }),
                              h('div', { className: 'zc-docker-list' },
                                (discovery.docker.loading || dockerLoading)
                                  ? h('div', { className: 'zc-docker-empty' }, h(Spinner, { className: 'zc-spin' }), h('span', null, t('z.dockerLoading')))
                                  : null,
                                !(discovery.docker.loading || dockerLoading) && (discovery.docker.containers || []).length === 0
                                  ? h('div', { className: 'zc-docker-empty' }, t('z.dockerNoContainers'))
                                  : null,
                                (discovery.docker.containers || [])
                                  .filter((row) => {
                                    const q = dockerQuery.trim().toLowerCase()
                                    return !q || [row.name, row.id, row.image].join(' ').toLowerCase().includes(q)
                                  })
                                  .map((row) => h('button', {
                                    key: row.id,
                                    type: 'button',
                                    className: 'zc-docker-item',
                                    'data-selected': row.name === form.container ? 'true' : 'false',
                                    onClick: () => {
                                      update({ container: row.name, manualContainer: '', image: row.image || '', dockerMode: 'select' })
                                      setDockerOpen(false)
                                      setDockerQuery('')
                                    }
                                  },
                                    h(Icon, { name: 'box', size: 14 }),
                                    h('span', { className: 'zc-docker-item-name' }, row.name),
                                    row.name === form.container ? h(Icon, { name: 'check', size: 14 }) : null
                                  ))
                              )
                            )
                          : null,
                        !(discovery.docker.loading || dockerLoading)
                          ? (!discovery.docker.available || discovery.docker.error
                              ? h('p', { className: 'zc-hint zc-hint-warning', style: { margin: 0 } }, t('z.dockerUnavailable'))
                              : (discovery.docker.containers || []).length === 0
                                ? h('p', { className: 'zc-hint', style: { margin: 0 } }, t('z.dockerNoContainers'))
                                : null)
                          : null
                      )
                    : h('div', null,
                        h('label', { className: 'zc-field' },
                          h('span', { className: 'zc-label' }, t('z.dockerContainer')),
                          h('input', {
                            className: `zc-input${errors.container ? ' invalid' : ''}`,
                            value: form.manualContainer,
                            placeholder: t('z.dockerContainerPlaceholder'),
                            autoFocus: true,
                            onChange: (event) => update({ container: '', manualContainer: event.target.value, image: '' })
                          }),
                          h(FieldError, { message: errors.container })
                        ),
                        !errors.container && !form.manualContainer.trim()
                          ? h('p', { className: 'zc-hint', style: { margin: 0 } }, t('z.dockerManualHint'))
                          : null
                      )
                )
              : null
          ),
          h('div', { className: `zc-form-foot${deviceManagement ? ' end' : ''}` },
            deviceManagement
              ? h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-ghost h9',
                  onClick: onClose,
                  disabled: busy
                }, t('common.cancel'))
              : h('button', {
                  type: 'button',
                  className: 'zc-btn zc-btn-ghost h9',
                  onClick: () => { setStep('device'); setImportOpen(false); setDockerOpen(false); setErrors({}); setError('') }
                },
                  h(Icon, { name: 'chevronLeft', size: 16 }),
                  t('z.backToList')
                ),
            h('button', { type: 'submit', className: 'zc-btn zc-btn-default h9', disabled: busy },
              busy ? h(Spinner, { className: 'zc-spin' }) : null,
              busy ? t('z.connecting') : deviceManagement ? t('z.settings.addAndConnect') : t('z.startConnection')
            )
          )
        )
      } else if (step === 'connecting') {
        const failed = Boolean(displayError) || bg.phase === 'failed'
        const done = bg.phase === 'done'
        const confirmPending = bg.phase === 'confirm-install'
        const statusTone = failed ? 'danger' : (done ? 'success' : 'progress')
        const statusText = failed ? t('z.status.failed') : (done ? t('z.status.connected') : t('z.status.connecting'))
        const logLines = String(displayLines || '').split('\n').map((line) => line.trim()).filter(Boolean)
        const tags = parseStageTags(logLines)
        const connectKind = bg.phase === 'idle' ? activeKind : (bg.targetKind || activeKind)
        const confirm = bg.confirm || null
        const subContext = {
          tags,
          kind: connectKind,
          device: bg.device || wizardName,
          confirmPending,
          failed,
          error: displayError || '',
          path: bg.path || ''
        }
        body = h('div', { className: 'zc-connect' },
          h('div', { className: 'zc-connect-scroll' },
            h('div', { className: 'zc-conn-head' },
              h('div', { className: 'zc-conn-title-row' },
                h('h3', { className: 'zc-conn-title' }, wizardName),
                h('span', { className: `zc-badge zc-badge-${connectKind}` },
                  h(Icon, { name: kindIconName(connectKind), size: 12 }),
                  h('span', null, kindLabel(connectKind))
                ),
                h(StatusBadge, { tone: statusTone }, statusText)
              ),
              h('p', { className: 'zc-conn-target' }, deviceLabel)
            ),
            h('ol', { className: 'zc-phases', 'data-testid': 'remote-connection-stages' },
              displayPhases.map((row, index) => {
                const rowSub = stageSubMessage(row, subContext)
                const times = row.times || {}
                const start = times.start || bg.startedAt
                const elapsed = times.end
                  ? Math.max(0, Math.floor((times.end - start) / 1000))
                  : row.status === 'active' ? Math.max(0, Math.floor((clock - start) / 1000)) : null
                const percent = row.status === 'active' && row.key === 'deploy' && tags.deploy?.percent
                  ? Number(tags.deploy.percent)
                  : null
                return h('li', {
                  key: row.key,
                  className: 'zc-phase',
                  'data-status': row.status
                },
                  index < displayPhases.length - 1 ? h('span', { className: 'zc-phase-line', 'aria-hidden': 'true' }) : null,
                  h('span', { className: 'zc-phase-dot' },
                    row.status === 'complete' ? h(Icon, { name: 'check', size: 12 })
                      : row.status === 'failed' ? h(Icon, { name: 'x', size: 12 })
                        : row.status === 'active' ? h(Spinner, { className: 'zc-spin' })
                          : h('span', { className: 'zc-dotmark' })
                  ),
                  h('div', { className: 'zc-phase-main' },
                    h('div', { className: 'zc-phase-head' },
                      h('span', { className: 'zc-phase-title' }, row.label),
                      elapsed !== null ? h('span', { className: 'zc-phase-time' }, `${elapsed} s`) : null
                    ),
                    rowSub ? h('p', { className: 'zc-phase-sub' }, rowSub) : null,
                    row.key === 'deploy' && confirmPending && confirm
                      ? h('div', { className: 'zc-install-card' },
                          h('p', { className: 'zc-install-title' }, h(Icon, { name: 'alert', size: 16 }), t('z.install.title')),
                          h('dl', { className: 'zc-install-grid' },
                            h('dt', null, t('z.install.target')),
                            h('dd', { className: 'mono' }, confirm.target || deviceLabel),
                            h('dt', null, t('z.install.version')),
                            h('dd', { className: 'mono' }, confirm.version || t('z.install.unknown')),
                            h('dt', null, t('z.install.location')),
                            h('dd', { className: 'mono break' }, confirm.installPath || t('z.install.unknown')),
                            h('dt', null, t('z.install.size')),
                            h('dd', { className: 'mono' }, Number.isFinite(confirm.sizeBytes) && confirm.sizeBytes
                              ? `${(confirm.sizeBytes / 1048576).toFixed(1)} MB`
                              : t('z.install.unknown'))
                          ),
                          h('div', { className: 'zc-install-actions' },
                            h('button', {
                              type: 'button',
                              className: 'zc-btn zc-btn-default zc-btn-sm',
                              onClick: () => backgroundFlow.confirmInstall()
                            }, t('z.install.confirm')),
                            h('button', {
                              type: 'button',
                              className: 'zc-btn zc-btn-secondary zc-btn-sm',
                              onClick: () => backgroundFlow.cancelInstall()
                            }, t('z.cancel'))
                          )
                        )
                      : null,
                    percent !== null
                      ? h('div', { className: 'zc-progress' },
                          h('span', { className: 'zc-progress-text' }, `${percent}%`),
                          h('div', { className: 'zc-progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
                            h('div', { className: 'zc-progress-fill', style: { width: `${Math.max(0, Math.min(100, percent))}%` } })
                          )
                        )
                      : null
                  )
                )
              })
            ),
            failed
              ? h('div', { className: 'zc-status-block' },
                  h('p', { className: 'zc-status-title' }, h(Icon, { name: 'alert', size: 16 }), t('z.status.failed')),
                  h('p', { className: 'zc-status-reason' }, displayError || t('z.desc.failed')),
                  h('details', { className: 'zc-error-details' },
                    h('summary', null, t('z.errorDetails')),
                    h('pre', { className: 'zc-pre' }, displayError || ''),
                    h('button', {
                      type: 'button',
                      className: 'zc-btn zc-btn-ghost zc-btn-sm',
                      onClick: () => navigator.clipboard?.writeText(String(displayError || ''))
                    }, t('z.copyError'))
                  ),
                  h('div', { className: 'zc-status-actions' },
                    h('button', {
                      type: 'button',
                      className: 'zc-btn zc-btn-default zc-btn-sm',
                      onClick: retryConnection
                    }, t('z.retry')),
                    h('button', {
                      type: 'button',
                      className: 'zc-btn zc-btn-secondary zc-btn-sm',
                      onClick: backToConfig
                    }, t('z.backToConnection'))
                  )
                )
              : null,
            h('div', { className: 'zc-log' },
              h('button', {
                type: 'button',
                className: 'zc-log-toggle',
                'aria-expanded': logOpen ? 'true' : 'false',
                onClick: () => setLogOpen((old) => !old)
              },
                h(Icon, { name: 'chevronRight', size: 14 }),
                t('z.connectionLog'),
                h('span', { className: 'zc-log-count' }, t('z.logLines', { count: String(logLines.length) }))
              ),
              logOpen
                ? h('button', {
                    type: 'button',
                    className: 'zc-log-copy',
                    onClick: () => navigator.clipboard?.writeText(String(displayLines || ''))
                  }, t('z.copyLog') || t('job.copyLog'))
                : null,
              logOpen
                ? h('div', { className: 'zc-log-box', 'data-testid': 'remote-connection-log' },
                    logLines.length > 0
                      ? logLines.map((line, index) => h('div', { key: index, className: 'zc-log-line' },
                          h('span', { className: 'zc-log-level' }, '[INFO]'),
                          h('span', null, line)
                        ))
                      : h('div', { className: 'zc-log-empty' }, `[INFO] ${t('z.logEmpty')}`)
                  )
                : null
            )
          ),
          h('div', { className: 'zc-connect-foot' },
            bg.phase === 'running' || bg.phase === 'confirm-install'
              ? h('button', { type: 'button', className: 'zc-btn zc-btn-ghost', onClick: minimizeFlow },
                  h(Icon, { name: 'minus', size: 16 }),
                  t('z.background')
                )
              : h('button', { type: 'button', className: 'zc-btn zc-btn-ghost', onClick: backToConfig },
                  t('z.backToList')
                ),
            failed
              ? h('button', { type: 'button', className: 'zc-btn zc-btn-secondary', onClick: closeOrMinimize }, t('common.close'))
              : h('button', { type: 'button', className: 'zc-btn zc-btn-secondary', onClick: cancelOrMinimize }, t('z.cancelConnection'))
          )
        )
      } else if (step === 'directory') {
        const host = hostOf(dirHostId)
        const recentPaths = [...new Set(workspacesFor(dirHostId).map((row) => row.remotePath).filter(Boolean))].slice(0, 4)
        body = h('div', { className: 'zc-dir' },
          h('div', { className: 'zc-dir-scroll' },
            h('div', { className: 'zc-connected' },
              h('div', { className: 'zc-connected-left' },
                h(Icon, { name: 'check', size: 16 }),
                h('span', null, t('z.status.connected')),
                h('span', null, `· ${kindLabel(host ? kindOfrow(host) : (bg.targetKind || activeKind))}`),
                settings?.dshVersion ? h('span', null, `· v${settings.dshVersion}`) : null
              )
            ),
            host
              ? h('div', { className: 'zc-rename' },
                  h('span', { className: 'zc-rename-label' }, t('z.renameDevice')),
                  h('input', {
                    className: 'zc-input',
                    value: deviceName,
                    'aria-label': t('z.renameDevice'),
                    onChange: (event) => { setDeviceName(event.target.value); setRenameState('idle') },
                    onBlur: () => void saveRename(),
                    onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void saveRename() } }
                  }),
                  h('span', { className: 'zc-rename-hint', role: 'status' },
                    renameState === 'saved' ? t('settings.saved')
                      : renameState === 'failed' ? t('z.renameFailed')
                        : renameState === 'saving' ? t('z.browserLoading')
                          : t('z.renameHintLong'))
                )
              : null,
            recentPaths.length > 0
              ? h('div', { className: 'zc-recent' },
                  h('span', { className: 'zc-recent-label' }, t('z.recent')),
                  h('div', { className: 'zc-recent-chips' }, recentPaths.map((path) => h('button', {
                    key: path,
                    type: 'button',
                    className: 'zc-recent-chip',
                    'data-selected': path === remotePath ? 'true' : 'false',
                    title: path,
                    onClick: () => { setRemotePath(path); setBrowseRequest({ path, key: Date.now() }) }
                  },
                    h(Icon, { name: 'folder', size: 14 }),
                    h('span', null, path)
                  )))
                )
              : null,
            h('div', { className: 'zc-browser-wrap' },
              h(RemoteBrowser, {
                hostId: dirHostId,
                value: remotePath,
                onChange: (path) => { setDirReady(false); setRemotePath(path) },
                request: browseRequest,
                allowMissing: settings ? settings.createIfMissing !== false : true,
                onNavState: setDirReady
              })
            )
          ),
          h('p', { className: 'zc-willopen', 'data-testid': 'remote-directory-selected-path' }, t('z.willOpen', { path: remotePath || '~' })),
          h('div', { className: 'zc-dir-foot' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-ghost zc-later',
              onClick: () => { backgroundFlow.minimize(); onClose() }
            }, t('z.chooseLater')),
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-secondary big',
              onClick: () => { backgroundFlow.reset(); setStep('settings') }
            }, t('z.back')),
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-default big',
              disabled: !dirHostId || !remotePath || !dirReady,
              onClick: createWorkspace
            }, t('z.openHere'))
          )
        )
      }

      const headTitles = h('div', { className: 'zc-head-titles' },
        h('div', { className: 'zc-title-row' },
          h('h2', { className: 'zc-title' }, header.title),
          header.kind
            ? h('span', { className: `zc-badge zc-badge-${header.kind}` },
                h(Icon, { name: kindIconName(header.kind), size: 12 }),
                h('span', null, kindLabel(header.kind))
              )
            : null
        ),
        header.preview
          ? h('p', { className: 'zc-preview' }, header.preview)
          : header.desc ? h('p', { className: 'zc-desc' }, header.desc) : null
      )
      const headActions = h('div', { className: 'zc-head-actions' },
        deviceManagement ? null : h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost zc-btn-icon',
          title: t('z.minimize'),
          onClick: minimizeWizard
        }, h(Icon, { name: 'minus', size: 12 })),
        h('button', {
          type: 'button',
          className: 'zc-btn zc-btn-ghost zc-btn-icon',
          title: t('common.close'),
          onClick: closeOrMinimize
        }, h(Icon, { name: 'x', size: 12 }))
      )

      return h('div', {
        className: 'zc-ui zc-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) closeOrMinimize() }
      },
        h('div', { className: 'zc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': header.title },
          h('div', { className: 'zc-body' },
            h('div', { className: 'zc-head' },
              h('div', { className: 'zc-head-top' },
                deviceManagement ? headTitles : h(WizardSteps, { step }),
                headActions
              ),
              deviceManagement ? null : headTitles
            ),
            step !== 'connecting' && error
              ? h('div', { className: 'zc-error' }, h(Icon, { name: 'alert', size: 16 }), h('span', null, error))
              : null,
            body
          )
        ),
        importMenuNode
      )
    }

    // ── Local folder browser (fallback when the Host has no OS chooser) ─────
    // Same ZCode folder-modal frame as `RemoteBrowser`; only the listing
    // endpoint differs, so the two picking surfaces stay visually identical.
    function LocalBrowser({ value, onChange }) {
      const [listing, setListing] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(false)
      const [draft, setDraft] = useState(value || '')
      const load = useCallback(async (path) => {
        setLoading(true); setError('')
        try {
          const data = await api('GET', `/ssh-remote/local/list?path=${encodeURIComponent(path || '')}`)
          setListing(data)
          setDraft(data.path || '')
          onChange(data.path || '')
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setLoading(false)
        }
      }, [])
      useEffect(() => { void load(value || '') }, [])
      const entries = (listing?.entries || []).filter((entry) => entry.dir && !entry.hidden)
      return h('div', { className: 'zc-browser' },
        h('div', { className: 'zc-browser-form' },
          h('input', {
            className: 'zc-input mono',
            value: draft,
            placeholder: 'C:\\Users\\me\\project',
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void load(draft.trim())
            }
          }),
          h('div', { className: 'zc-browser-actions' },
            h('button', {
              type: 'button',
              className: 'zc-btn zc-btn-secondary',
              disabled: loading || !draft.trim(),
              onClick: () => void load(draft.trim())
            }, t('z.browserGo'))
          )
        ),
        error ? h('div', { className: 'zc-browser-error' }, error) : null,
        h('div', { className: 'zc-browser-list' },
          listing?.parent ? h('button', { type: 'button', className: 'zc-browser-row zc-browser-up', onClick: () => void load(listing.parent) },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, t('z.browserParent'))
          ) : null,
          loading ? h('div', { className: 'zc-browser-empty' }, t('z.browserLoading')) : null,
          !loading && entries.length === 0 ? h('div', { className: 'zc-browser-empty' }, t('z.browserNoSubdirs')) : null,
          entries.map((entry) => h('button', {
            key: entry.path,
            type: 'button',
            className: 'zc-browser-row',
            onClick: () => void load(entry.path)
          },
            h(Icon, { name: 'folder', size: 16 }),
            h('span', null, entry.name)
          ))
        )
      )
    }

    // ── Native sidebar row projection (ZCode-style) ─────────────────────────
    // DSH workspace rows expose no icon/badge field, so remote rows are
    // decorated in place: cloud status glyph + device label + row menu. The
    // native row menu is hidden because it would rename/delete only the local
    // projection and drift away from the plugin's state.
    let runtimeCtx = null
    const rowMeta = { at: 0, workspaces: [], hosts: [] }
    let rowMetaPromise = null

    async function loadRowMeta(force = false) {
      if (!force && Date.now() - rowMeta.at < 4000) return rowMeta
      if (rowMetaPromise) return rowMetaPromise
      rowMetaPromise = Promise.all([
        api('GET', '/ssh-remote/workspaces?refresh=0'),
        api('GET', '/ssh-remote/hosts')
      ]).then(([workspaceData, hostData]) => {
        rowMeta.workspaces = workspaceData.workspaces || []
        rowMeta.hosts = hostData.hosts || []
        rowMeta.at = Date.now()
        return rowMeta
      }).catch(() => rowMeta).finally(() => { rowMetaPromise = null })
      return rowMetaPromise
    }

    const rowMenuFlow = {
      snapshot: { open: false, mode: 'menu', workspace: null, rect: null },
      listeners: new Set(),
      set(patch) {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of [...this.listeners]) {
          try { listener() } catch { /* keep other subscribers alive */ }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      open(workspace, rect) {
        this.set({ open: true, mode: 'menu', workspace, rect })
      },
      close() {
        this.set({ open: false, mode: 'menu', workspace: null, rect: null })
      }
    }

    function rowIconState(workspace) {
      const state = workspace?.status?.state
      if (state === 'running') return 'online'
      if (state === 'starting') return 'starting'
      if (state === 'error') return 'error'
      return 'offline'
    }

    function cloudIcon(state) {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      const set = (name, value) => svg.setAttribute(name, value)
      set('viewBox', '0 0 24 24')
      set('width', '16')
      set('height', '16')
      set('fill', 'none')
      set('stroke', 'currentColor')
      set('stroke-width', '2')
      set('stroke-linecap', 'round')
      set('stroke-linejoin', 'round')
      set('aria-hidden', 'true')
      svg.dataset.dshSshCloud = state
      const path = (d) => {
        const node = document.createElementNS(NS, 'path')
        node.setAttribute('d', d)
        svg.appendChild(node)
      }
      if (state === 'starting') {
        svg.classList.add('dsh-ssh-spin')
        path('M21 12a9 9 0 1 1-6.219-8.56')
      } else if (state === 'offline') {
        path('M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057')
        path('M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78')
        path('m2 2 20 20')
      } else {
        path('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z')
        if (state === 'error') path('M15.5 14.5l4 4M19.5 14.5l-4 4')
      }
      return svg
    }

    function rowStatusLabel(workspace) {
      const state = workspace?.status?.state
      if (state === 'running') return ''
      if (state === 'starting') return t('row.connecting')
      if (state === 'error') return t('row.failed')
      return t('row.offline')
    }

    function rowActionButton(kind, label) {
      const NS = 'http://www.w3.org/2000/svg'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-ssh-row-btn'
      button.title = label
      button.setAttribute('aria-label', label)
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '14')
      svg.setAttribute('height', '14')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '2')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      const paths = kind === 'more'
        ? ['M5 12h.01', 'M12 12h.01', 'M19 12h.01']
        : ['M12 5v14', 'M5 12h14']
      for (const d of paths) {
        const node = document.createElementNS(NS, 'path')
        node.setAttribute('d', d)
        svg.appendChild(node)
      }
      button.appendChild(svg)
      return button
    }

    function startNativeSession(nativeWorkspaceId) {
      try {
        const workspace = runtimeCtx?.get?.('uiWorkspace')
        if (!workspace) return false
        if (typeof workspace.startSession === 'function') {
          workspace.startSession(String(nativeWorkspaceId))
          return true
        }
        if (typeof workspace.openWorkspace === 'function') {
          workspace.openWorkspace(String(nativeWorkspaceId))
          return true
        }
      } catch {
        // fall back below
      }
      return false
    }

    function openRowMenu(workspace, anchor) {
      const rect = anchor.getBoundingClientRect()
      rowMenuFlow.open(workspace, {
        x: Math.max(8, Math.min(window.innerWidth - 176, rect.right - 168)),
        y: Math.max(8, Math.min(window.innerHeight - 96, rect.bottom + 4))
      })
    }

    function decorateRemoteRow(row, workspace) {
      const children = Array.from(row.children)
      const folderSlot = children[0]
      let projectText = children[2]
      if (!projectText || !projectText.querySelector('span')) {
        projectText = children.find((node) => node.tagName === 'SPAN'
          && node.querySelector('span')
          && node.textContent === workspace.name) || null
      }
      if (!folderSlot || !projectText) return
      row.setAttribute('data-dsh-ssh-row', workspace.id)
      folderSlot.classList.add('dsh-ssh-cloud-slot')
      const chevronSlot = children[1]
      if (chevronSlot) chevronSlot.classList.add('dsh-ssh-chevron')
      projectText.classList.add('dsh-ssh-project-text')
      const nativeActions = children[3]
      if (nativeActions) nativeActions.classList.add('dsh-ssh-native-actions')

      const state = rowIconState(workspace)
      const current = folderSlot.querySelector('svg[data-dsh-ssh-cloud]')
      if (!current || current.dataset.dshSshCloud !== state) {
        const icon = cloudIcon(state)
        if (current) current.replaceWith(icon)
        else {
          const folder = folderSlot.querySelector('svg')
          if (folder) folder.replaceWith(icon)
          else folderSlot.appendChild(icon)
        }
      }

      const title = projectText.firstElementChild
      if (title) title.classList.add('dsh-ssh-row-title')
      let device = projectText.querySelector(':scope > .dsh-ssh-device')
      if (!device) {
        device = document.createElement('span')
        device.className = 'dsh-ssh-device'
        projectText.appendChild(device)
      }
      const label = workspace.hostName || workspace.host || ''
      if (device.textContent !== label) device.textContent = label

      let status = projectText.querySelector(':scope > .dsh-ssh-status')
      if (!status) {
        status = document.createElement('span')
        status.className = 'dsh-ssh-status'
        projectText.appendChild(status)
      }
      const statusText = rowStatusLabel(workspace)
      if (status.textContent !== statusText) status.textContent = statusText
      status.hidden = statusText === ''

      let actions = row.querySelector(':scope > .dsh-ssh-row-actions')
      if (!actions) {
        actions = document.createElement('span')
        actions.className = 'dsh-ssh-row-actions'
        // ZCode order is menu, files, create-task; the file action has no DSH
        // equivalent, so the row keeps the menu and the create-task button.
        const moreButton = rowActionButton('more', t('row.more'))
        const newButton = rowActionButton('new', t('row.newSession'))
        moreButton.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const currentWorkspace = row.__dshSshWorkspace
          if (currentWorkspace) openRowMenu(currentWorkspace, moreButton)
        })
        newButton.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const currentWorkspace = row.__dshSshWorkspace
          if (currentWorkspace) startNativeSession(currentWorkspace.nativeWorkspaceId)
        })
        actions.appendChild(moreButton)
        actions.appendChild(newButton)
        actions.__dshSshNewButton = newButton
        row.appendChild(actions)
      }
      if (actions.__dshSshNewButton) {
        actions.__dshSshNewButton.hidden = workspace.status?.state !== 'running'
      }
      row.__dshSshWorkspace = workspace
    }

    function decorateRemoteRows() {
      const remote = rowMeta.workspaces.filter((workspace) => workspace.nativeWorkspaceId)
      if (remote.length === 0) return
      const byNativeId = new Map(remote.map((workspace) => [String(workspace.nativeWorkspaceId), workspace]))
      for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        const key = row.getAttribute('data-row-key') || ''
        const workspace = byNativeId.get(key.slice('workspace:'.length))
        if (!workspace) continue
        try {
          decorateRemoteRow(row, workspace)
        } catch {
          // decoration is best-effort; never break the native row
        }
      }
    }

    let decorateScheduled = false
    function scheduleRowDecorate(force = false) {
      if (decorateScheduled) return
      decorateScheduled = true
      const run = () => {
        decorateScheduled = false
        void loadRowMeta(force).then(() => {
          try { decorateRemoteRows() } catch { /* ignore */ }
        })
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }

    function installRemoteRowDecorator() {
      let lastMutation = 0
      const observer = new MutationObserver(() => {
        const now = Date.now()
        if (now - lastMutation < 250) return
        lastMutation = now
        scheduleRowDecorate(false)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      const timer = setInterval(() => scheduleRowDecorate(true), 5000)
      scheduleRowDecorate(true)
      return () => {
        observer.disconnect()
        clearInterval(timer)
      }
    }

    async function waitForJob(jobId) {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const data = await api('GET', `/ssh-remote/jobs?id=${encodeURIComponent(jobId)}`)
        const job = data.job || data
        if (job && job.state && job.state !== 'running') {
          if (job.state !== 'succeeded') throw new Error(job.error || t('row.removeFailed'))
          return job
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
      }
      throw new Error(t('row.removeFailed'))
    }

    function RenameRemoteDialog({ workspace, onClose }) {
      const [name, setName] = useState(workspace.name || '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const save = async () => {
        const value = name.trim()
        if (!value || busy) return
        setBusy(true); setError('')
        try {
          await api('POST', '/ssh-remote/workspaces/rename', { id: workspace.id, name: value })
          onClose()
          scheduleRowDecorate(true)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, {
        title: t('row.renameTitle'),
        onClose: busy ? undefined : onClose,
        footer: h('div', { className: 'sshR-inline', style: { justifyContent: 'flex-end' } },
          h(Btn, { onClick: onClose, disabled: busy }, t('common.cancel')),
          h(Btn, { kind: 'primary', onClick: () => void save(), disabled: busy || !name.trim() }, t('common.save'))
        )
      },
        h(Field, { label: t('row.name') },
          h(Input, {
            value: name,
            onChange: setName,
            onKeyDown: (event) => { if (event.key === 'Enter') void save() }
          })
        ),
        error ? h('div', { className: 'sshR-errorBox', style: { marginTop: 12 } }, error) : null
      )
    }

    function RemoveRemoteDialog({ workspace, onClose }) {
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const device = workspace.hostName || workspace.host || t('panel.title')
      const remove = async () => {
        if (busy) return
        setBusy(true); setError('')
        try {
          const data = await api('POST', '/ssh-remote/workspaces/action', { op: 'remove', id: workspace.id })
          if (data.jobId) await waitForJob(data.jobId)
          onClose()
          scheduleRowDecorate(true)
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, {
        title: t('row.deleteTitle'),
        onClose: busy ? undefined : onClose,
        footer: h('div', { className: 'sshR-inline', style: { justifyContent: 'flex-end' } },
          h(Btn, { onClick: onClose, disabled: busy }, t('common.cancel')),
          h(Btn, { kind: 'danger', onClick: () => void remove(), disabled: busy }, busy ? t('row.deleting') : t('common.delete'))
        )
      },
        h('p', { className: 'sshR-sub', style: { margin: '0 0 10px' } }, t('row.deleteBody', { device })),
        h('p', { className: 'sshR-sub', style: { margin: 0 } }, workspace.name),
        error ? h('div', { className: 'sshR-errorBox', style: { marginTop: 12 } }, error) : null
      )
    }

    function RemoteRowMenu() {
      const [state, setState] = useState({ ...rowMenuFlow.snapshot })
      useEffect(() => rowMenuFlow.subscribe(() => setState({ ...rowMenuFlow.snapshot })), [])
      useEffect(() => {
        if (!state.open) return undefined
        const onDown = (event) => {
          if (event.target?.closest?.('.dsh-ssh-row-menu, .zc-overlay')) return
          rowMenuFlow.close()
        }
        const onKey = (event) => { if (event.key === 'Escape') rowMenuFlow.close() }
        document.addEventListener('mousedown', onDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          window.removeEventListener('keydown', onKey)
        }
      }, [state.open])
      if (!state.open || !state.workspace) return null
      if (state.mode === 'rename') {
        return h(RenameRemoteDialog, { workspace: state.workspace, onClose: () => rowMenuFlow.close() })
      }
      if (state.mode === 'remove') {
        return h(RemoveRemoteDialog, { workspace: state.workspace, onClose: () => rowMenuFlow.close() })
      }
      return h('div', {
        className: 'zc-ui dsh-ssh-row-menu',
        style: { left: state.rect?.x ?? 120, top: state.rect?.y ?? 120 },
        onMouseDown: (event) => event.stopPropagation()
      },
        h('button', {
          type: 'button',
          className: 'dsh-ssh-menu-item',
          onClick: () => rowMenuFlow.set({ mode: 'rename' })
        }, h(Icon, { name: 'edit', size: 14 }), t('row.edit')),
        h('button', {
          type: 'button',
          className: 'dsh-ssh-menu-item danger',
          onClick: () => rowMenuFlow.set({ mode: 'remove' })
        }, h(Icon, { name: 'trash', size: 14 }), t('row.delete'))
      )
    }

    async function pickNativeLocalDirectory() {
      try {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__
        if (desktop && typeof desktop.pick === 'function') {
          const path = await desktop.pick()
          return path ? { kind: 'picked', path } : { kind: 'cancelled' }
        }
      } catch (error) {
        return { kind: 'error', error: errorMessage(error) }
      }
      try {
        const workspace = runtimeCtx?.get?.('uiWorkspace')
        if (workspace && typeof workspace.pickDirectory === 'function') {
          const path = await workspace.pickDirectory()
          return path ? { kind: 'picked', path } : { kind: 'cancelled' }
        }
      } catch (error) {
        return { kind: 'error', error: errorMessage(error) }
      }
      return { kind: 'unavailable' }
    }

    function DirectoryFlow(props) {
      const { open, onPicked, onCancel, openNativeWorkspace, defaultDeviceId } = props
      if (!open) return null
      return h(CreateProjectDialog, {
        onClose: onCancel,
        onLocalCreate: typeof onPicked === 'function' ? onPicked : null,
        localAvailable: typeof onPicked === 'function',
        openNativeWorkspace,
        defaultDeviceId: defaultDeviceId || 'local'
      })
    }

    function PanelIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 4, width: 18, height: 6, rx: 2 }),
        h('rect', { x: 3, y: 14, width: 18, height: 6, rx: 2 }),
        h('path', { d: 'M7 7h.01M7 17h.01' }),
        h('path', { d: 'M12 7h5M12 17h5' })
      )
    }

    function apply(ctx) {
      ensureCss()
      runtimeCtx = ctx
      const slots = ctx.get('slots')
      const openPanel = () => {
        try {
          ctx.get('layout')?.selectPanel('ssh-remote')
        } catch {
          // layout may not be ready yet
        }
      }
      // Host service that selects a workspace row and opens its blank session.
      // This is what makes "click a recent remote directory" land in the
      // native workspace instead of stopping at a status dialog.
      const openNativeWorkspace = (workspaceId) => {
        try {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace && typeof uiWorkspace.openWorkspace === 'function') {
            uiWorkspace.openWorkspace(String(workspaceId))
            return true
          }
        } catch {
          // fall back to the status panel
        }
        return false
      }
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'ssh-remote',
        order: 41,
        label: () => t('settings.title')
      }, SettingsSection))
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: 'ssh-remote',
        order: 45,
        label: () => t('panel.title')
      }, PanelIcon))
      slots.inject('main', function* () {
        yield slots.register({
          name: 'main',
          key: 'ssh-remote',
          inject: () => ({ openPanel, openNativeWorkspace })
        }, MainPanel)
      })
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'ssh-remote-background',
        inject: () => ({ openPanel, openNativeWorkspace })
      }, BackgroundPill))
      slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'ssh-remote-row-menu'
      }, RemoteRowMenu))
      for (const slot of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) {
        slots.inject(slot, () => slots.register({
          name: slot,
          id: 'ssh-remote',
          priority: -100,
          inject: () => ({ openPanel, openNativeWorkspace })
        }, DirectoryFlow))
      }
      const stopRowDecorator = installRemoteRowDecorator()
      if (typeof ctx.effect === 'function') ctx.effect(() => stopRowDecorator, 'dsh-ssh-remote.rows')
    }

    exports.name = name
    exports.NS = NS
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})
