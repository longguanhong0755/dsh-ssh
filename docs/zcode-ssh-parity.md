# ZCode 远程设备 parity 矩阵

对照对象：ZCode 3.17.2 / 3.18.0 安装版的 SSH/WSL/Docker 远程工作区界面与后端语义（证据见 [zcode-ssh-reverse-engineering.md](zcode-ssh-reverse-engineering.md)）。
目标：功能与交互 1:1；图标视觉等价，不复刻专有 SVG 资产。

状态口径：

- **实机验证**：在 home130/home132 真实 SSH 主机上跑通，或用截图比对通过。
- **已实现**：代码与单测完成，UI 尚未逐项复验。
- **部分**：目标行为存在，但有明确差异。
- **未覆盖**：当前环境无法验证（本机没有 WSL/Docker）。

| 界面 / 行为 | ZCode 依据 | 本插件实现 | 状态 |
|---|---|---|---|
| 设置页「远程设备」列表 | §5.3 设备行 `e7`、`zYn` 页面 | `lib/client/54-device-page.js`；分组「设备」、空态、编辑/移除/设为默认 | 实机验证（`docs/demo-devices.png`） |
| 设备行信息层级 | 名称 + `user@host:port`、状态徽标 | `52-hosts-pane.js`、`50-settings-section.js` | 实机验证 |
| 新增连接向导（选择类型） | §2.4 三步向导 | `68-dialog-view.js`/`69-dialog-body.js` | 实机验证（`docs/demo-new-connection.png`） |
| SSH 表单：别名、地址、端口、用户、认证 | §2.5.1 | 同上；密钥/密码/agent、~/.ssh/config 别名带出 | 实机验证 |
| WSL 表单：发行版选择 | §2.1 `WSLBackend`、`listWSLDistros` | `lib/local.js` + 表单分支 | 未覆盖（本机无 WSL；单测覆盖） |
| Docker 表单：容器选择 | §2.2 `DockerBackend`、`docker ps -a` | `lib/local.js` + 表单分支 | 未覆盖（本机无 Docker；单测覆盖） |
| 连接阶段：安装/复用远端服务、逐阶段日志 | §2.4、`[source-server:*]` 标记 | `40-background-flow.js` 轮询 job、阶段子消息 | 实机验证（`docs/demo-streaming.png`） |
| 设备页状态：已连接/未连接/连接中 | §5.3 状态徽标 | `hostStatusFor` 的 online/offline/progress | 实机验证 |
| 设备页状态：更新中 | 3.18.0 `remote.status.updating`；`host.updating` | `installing` map → `updating` → `更新中` + spinner | 已实现（锁已实机验证，徽标未截图复验） |
| 设备页状态：需要更新 | 3.18.0 `remote.status.needsUpdate` | 部署版本 ≠ 本机 `dshVersion` → warning `需要更新` | 已实现 |
| 更新远端服务确认 | 3.18.0 `remote.action.update-server`、`remote.error.sourceServerUpdateInProgress` | 确认卡片显示 `from → to`，按钮 `更新远端`，`mode:'update'`；失败态显示 reason | 已实现（错误链路单测 + 锁实机验证） |
| 双桌面并发安装 | 3.18.0 错误码 `source-server-update-in-progress` | 远端 `mkdir` 锁 + 30 分钟 stale 接管；竞争失败方收到同码同文案 | 实机验证（home130/132，`scripts/e2e-lock.mjs` 16 步） |
| 创建项目对话框 | §2.5.2 | `64-create-dialog.js`、`67-dialog-flow.js` | 实机验证（`docs/demo-create-project.png`） |
| 选择远程文件夹 | §2.5.3 目录浏览器 | `62-remote-browser.js`（SFTP 列目录、新建目录、面包屑） | 实机验证（`docs/demo-folder-picker.png`） |
| 本地文件夹选择（WSL/Docker） | `FP` 目录浏览器 | `80-local-folder-browser.js` | 未覆盖（无 WSL/Docker） |
| 项目行：名称 + 设备名 | §5.3 `virtual-project-row` | `82-row-projection.js` | 实机验证（`docs/demo-workspace-row.png`） |
| 项目行图标状态：online/connecting/failed | `Aj` 云朵 + `tA` 映射 | 等价图标（云/云-x/旋转），online 用 muted 灰非品牌蓝 | 实机验证 |
| 行内操作：悬停淡入、菜单/文件/新建任务 | `virtual-project-actions`，online 才渲染新建任务 | `82-row-projection.js` + `86-row-decoration.js` | 实机验证（`docs/demo-workspace-menu.png`） |
| 行菜单文案与顺序 | `新建任务/查看文件/远程设备设置/编辑项目/删除项目` | i18n `row.*` 同名同序 | 实机验证（`docs/demo-device-menu.png`） |
| 查看文件：真实远程目录树 | host 侧文件树 | `84-remote-files.js` + `/ssh-remote/files` | 实机验证 |
| 流式会话 / 工具调用 / 思考过程 | §4、§5.2 | SDK runner + bridge 保真转发 | 实机验证（`docs/demo-streaming.png`） |
| 流式 revision 连续性 | §5.2 `assistantStreamRevision` | `nextStreamRevision()`，跨轮次单调 | 实机验证 |
| 错误卡片：标题 + reason 两行 | §2.5.1 失败态 | `68/69` 的 `zc-status-reason` 第二行 | 已实现（错误链路单测） |
| 文案表（zh/en） | `IntlProvider` | `10-i18n-zh.js` / `11-i18n-en.js`，zh 默认 | 实机验证 |
| 图标集 | Tailwind/lucide 等价图形 | 自绘 SVG，视觉等价、非逐字节复制 | 实机验证 |

## 已知差距

1. **WSL / Docker 全链路**：实现与单测在，但本机（Windows，无 WSL/Docker）无法实机验证；需要一台装了 WSL2 或 Docker Desktop 的机器补跑。
2. **更新中 / 需要更新的视觉**：状态计算与锁行为已验证，徽标样式与 ZCode 的对照截图还没采。
3. **健康自检**：ZCode 没有对应界面；本插件计划在 `/ssh-remote/health` 暴露桥接/anchor/插件自检（P1-3）。
4. **轮询成本**：设备页当前按主机逐个探测，P3 计划合并成单次 overview + 可见性感知轮询。
5. **凭据存放**：仍在 `state.json`（0600、gitignore）；P4 迁移到系统钥匙串。

## 维护方式

新增或修改远程界面时，先在本表加一行并写清 ZCode 依据（§ 或字符串 key），实现后再把状态改成「已实现」，有截图或实机证据才改成「实机验证」。
