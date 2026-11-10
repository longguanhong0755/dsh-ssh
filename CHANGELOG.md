# Changelog

## Unreleased

### 修复

- 修复桥接会话里 `/compact`（上下文压缩）报 `Remote compaction failed: no model selection resolved for this bridged chat`：压缩是空闲时执行的命令，此时没有任何回合跑过 `applyModel`，SDK 握手拿不到路由就先失败了。现在转发远端命令前先「采纳」锚点会话的模型选择（新增 `adoptModel()`：只解析、不 retire，因为 `launchSdk` 可能刚启动运行时，`applyModel` 的 retire 会把它杀掉），`sdkHandshake` 也做同样的兜底；profile 里的 `agent-default-model` 因此在启动前就有正确路由。加了 8 个测试（`test/bridge-adopt-model.test.mjs` 6 个 + `test/bridge-compact-route.test.mjs` 2 个，后者走真实入口 `runRemoteCompact`：无路由启动 → 采纳 → `initialize(model)` → `session/query`）。另新增 `POST /ssh-remote/bridge/probe`（`{sessionId}`，也支持 `GET ?sessionId=`）：把指定桥接会话推进到「能执行命令」的状态（重定向运行时 → 解析路由 → 启动/接管 SDK → 握手）并回报 `model/provider/sdkReady`，用于在不发送任何消息、不压缩任何上下文的前提下自检。
- 修复远程会话历史再次打不开、报 `stored session "…" is corrupt: SessionFormatError: turn/start does not open the expected turn`：一次失败的发送会先写下 `turn/end`，而重试沿用了同一个回合号，于是日志里出现两个 `turn/start 48`，之后每个回合都错开一位。现在重试只在「该回合还开着」时复用编号（继续往同一回合里追加步骤），否则取下一个编号；编号决策抽成 `planTurnNumber()`（`lib/bridge/turns.js`）并加了 5 个回归测试。已用 `npm run doctor -- repair --write` 把受影响的 anchor（`session-3628add6`）按位置平移回合号修好：194/194 份日志重新通过 harness 自身的恢复校验，真机再发一条消息后日志依旧 `before: OK / rewrites=0`。
- `npm run doctor` 的扫描模式不再对「能加载但需要修」的日志报成功：只要某份日志存在归一化改写（回合/步骤平移、丢弃未结算的 tool/call、补 `request/header.reason`）或帧布局问题，扫描就以退出码 1 结束，方便放进 CI 或开机自检。
- 修复远程会话发不出去、报 `远程会话发送失败：session/prompt: SDK server is not initialized`（以及伴随的 `session "…" is already owned by an active write handle`、`Session already exists`）：同一个 SDK 运行时目录可能被启动两次（应用重启、插件热重载后上一次的异步 boot 仍在跑），两个进程共读同一条 FIFO，内核把每一行只投递给其中一个读者——`initialize` 落到 A、`session/prompt` 落到还没初始化的 B，于是报「未初始化」。现在启动脚本用 `flock` 独占 `runner.lock`（抢不到就以 `sdk-owned` 退出，由调用方接管已有运行时），启动前按 `/proc/<pid>/fd` 找出所有持有该 FIFO 的进程并清理（带 `-TERM`→`-KILL` 升级，绝不把非数字当成 pid），`kill` 时连同 `runner.pid` 记录一起清干净；握手 `initialize` 做成幂等步骤，接管一个已在跑的运行时会重新握手。
- 新增 SDK 运行时自愈阶梯（`lib/bridge/sdk-heal.js`）：`session/prompt`、`session/query`、`session/resume` 等请求遇到「请求肯定没有被接受」的错误（`SDK server is not initialized`、`SDK server is shutting down`、`sdk runtime is not running`、`sdk-dead`、`sdk-write-blocked`、`sdk-owned`、`sdk request failed (exit 9)`、`sdk-pid-missing`）时，先诊断再修一次（单活则只重握手，多活或已死则换新运行时）后重发一次；超时**故意不重放**（提示词可能已经入队）。同一个会话的修复是单飞的，失败后退避 60 秒，避免雪崩。journal 里记录的 runner 也不再被盲信：只有本进程亲自验证过才直接复用，否则先看进程与 FIFO 持有者，不可用就重建。
- 修复远端已经答完、本地却报 `the remote dsh SDK runtime exited before finishing this turn: …/out.jsonl: file truncated`：运行时重启会 `rm -f out.jsonl` 重建，而 `tail` 仍从旧的字节偏移续读，GNU tail 判「文件被截断」后退出，桥接当成运行时崩溃。现在 `tail` 启动前先比较日志大小，小于偏移就从头读并发出一条 `{"__bridge":"tail-reset"}` 哨兵（消费者据此清零偏移与残留半行）；万一大小的判断被绕过（tail 自己报 `file truncated`），桥接会重新挂一次 tail 而不是判失败，最多重试 2 次。
- 继续拆分大文件（手写文件现在最大的 607 行）：`lib/routes.js`（1,019 行）→ `lib/routes/`（`support.js` + 5 组路由模块，路由表 31 条 before/after 完全一致）；`lib/local.js`（956 行）→ `lib/local/`（`process.js` + `wsl.js` + `docker.js`，导出与运行结果逐项一致）；`lib/ssh.js`（690 行）→ `lib/ssh/helpers.js` + 类本体（18 个原型方法逐一 `String(fn)` 相同）；`lib/bridge/sdk.js`（718 行）→ `lib/bridge/sdk-core.js` + `lib/bridge/sdk-io.js`（22 个方法逐一相同）。
- 修复远程会话历史「全部消失」（侧边栏里所有远程项目都没有对话，但日志仍在磁盘上）：DSH 只从 Zstandard 日志的**第一个帧**读取会话头，并要求该帧恰好只有一行 header（`first frame is not exactly one header line`），否则 `list()` 静默跳过该会话。上一版 `npm run doctor` 写回时把整份日志压成了 2~9 个大帧，于是 4 个 anchor 会话既列不出来也打不开，而「解压所有帧再拼接」的校验仍然是绿的。现在所有写日志的路径（doctor、新增的 `npm run repack`）都通过 `scripts/log-frames.mjs` 的 `packLog()` 落盘：首帧只有 header、其余按 64 KiB 行对齐分块，并在写前断言往返一致、首帧单行；doctor 扫描时会单独报告 `header-frame` 状态，`real-verify` 也加了同一条不变式，避免再次"假绿"。
- 修复远程会话修好后跑到「未分组」：DSH 的 workspace 注册表把记录的 `sessionIds` 当作可重新校验的缓存——某次读不到会话头，该会话就会被投影过滤掉，并在下一次写入时从记录里剪除，日志却完好无损。现在插件的原生投影（`lib/native.js`）在每次同步时按会话头里的 cwd 把属于 anchor 目录的会话重新挂回对应项目（最旧的先挂，保持侧边栏新到旧顺序），并刷新注册表的路径索引避免误剪；插件启动后 8s/30s 各再做一次，`POST /ssh-remote/native/sync` 也可手动触发，返回 `attached` 计数。`GET /ssh-remote/health` 增加 `native` 版本探针。
- 修复 `ssh-remote` 主机连不上就立刻失败（`无法连接 root@127.0.0.1:2222: connect ECONNREFUSED`）：连接级失败按 600/1200/1800/2400ms 退避重试最多 5 次，认证失败、主机密钥、解析失败不重试；`/ssh-remote/health` 的 `transport` 字段名为 `2026-11-10 connect-retry` 的代码。
- 修复桥接把远端会话的步骤编号直接写进本地 anchor 日志、导致整份会话历史打不开（`step/end does not match an open turn and step`、`step/start does not match the open turn and next step`、`seed request/header at index N has an invalid reason`）：远端按会话累计步骤号（回合中途接管的会话可能已经从 51 开始），锚点却按回合从 1 编号。现在桥接只用远端编号识别「重复的状态帧」与「远端已经走到下一步」，步骤号一律由本地计数器推导（每次 +1，且绝不复用刚关闭的编号），回合号也取本地编号，不再把远端回合号写进 `turn/end`。
- 新增 `npm run repack`（`scripts/anchor-repack.mjs`）：只修 Zstandard 帧布局而不改任何事件内容，`node scripts/anchor-repack.mjs <file-or-dir> [...] [--write] [--chunk <bytes>]`，写前备份 `.bak-frames-<ms>`；`npm run doctor` 与它都接受目录（递归找 `session.v4.jsonl.zstd`，共用 `scripts/log-targets.mjs`），不再对目录报 `EISDIR`。
- 新增 `npm run doctor`（`scripts/anchor-doctor.mjs`）：扫描并修复已经被写坏的 v4 anchor 日志——步骤编号错位、`step/end` 前没有结算的 tool/call、缺失的 `request/header.reason`、压缩影子区间引用错位的 seq；写入前自动备份为 `.bak-doctor-<ms>`，写完重新读盘校验。本机 25 个桥接会话中 4 个已被写坏，修复后 193/193 个存储会话都能被 harness 自身的 `validateStoredEvents` + `Session.fromRestore` 恢复。
- 拆分大文件：`lib/bridge.js`（4,575 行）按职责拆到 `lib/bridge/`；`lib/client.js`（7,239 行）拆成 `lib/client/` 下的源文件，由 `npm run build:client` 生成仍需单文件注册的入口（产物与拆分前逐字节一致）；`npm run check` 改为递归校验 `lib/`、`bin/`、`scripts/` 下所有模块。
- 修复远程会话思考内容有时不可见、长度被截断：headless 的 `--json` 投影对每个字符串有 8 KiB 上限，桥接又只把 `reasoning`/`text` 拼成两个标量。现在 headless profile 额外转发提交后的完整 `assistant/message`（不受投影上限影响），桥接优先使用这份权威内容，并按原生顺序保留 reasoning/text 块、usage 与流式记录；取消、失败或重连导致回合中途结束时，先把已流出的思考/正文落成持久 assistant 行再结束，不再被临时预览直接撤掉。步骤切换时用旧步骤坐标关闭上一步，失败回合只写一行 assistant 消息。
- 修复桥接会话在远端运行的模型与本地选择不一致：桥接现在解析当前锚点会话的模型选择（provider/model/reasoningEffort），用本机 `resolveCallConfig`/`resolveModelInfo` 校验并补全 maxTokens 与上下文窗口，再据此初始化 SDK 运行时、生成 headless profile 的 `llm-pi-ai` provider 与 `agent-default-model` 配置，并按同一路由镜像本地 `request/header`/`request/context`（含完整配置去重，重启后从 anchor 日志恢复去重键）。模型变化会停用旧 runner 并用新 profile 重建；选中的路由在远端不可用时本回合明确失败，不再静默回退到远端默认模型。`/compact` 也跟随该会话的模型。

- 修复远程会话长回合（超过 30 分钟）被误杀后报 `the remote dsh runner exited before finishing this turn; the remote log has no error line`：SDK 运行时的空闲看门狗只在提交提示词时重置，回合中途的长时间工具调用/抓取会被当作空闲进程清掉。现在回合进行期间会周期性续期看门狗（默认每 1/3 TTL），看门狗真正触发时也会把原因写进远端错误日志并在界面上展示，便于区分空闲回收与真实崩溃。
- 修复远端排队回合（远端 inbox 中等待的提示词在上一回合结束后自动开始）时本地桥接仍认为空闲：这类回合没有看门狗续期，长回合仍会被当作空闲运行时清掉；字节偏移不落盘，重载后会重复回放整段回合；界面也一直显示空闲。现在远端自行开始的回合会被桥接接管，续期看门狗、持久化偏移并显示为运行中。回合中途恢复（journal 偏移已经落在本回合内部、没有 `turn/start` 可读）同样会被接管：新开的本地回合把远端步骤重新编号为 1 起，已打开的 anchor 回合则原地续写，不重复写 `turn/start`；附着时从本地日志恢复当前步骤、未闭合步骤与未完成的工具调用，空闲时收到的 `turn/end` 不再补写一个重复的 `turn/start`（这正是此前 anchor 日志被写坏的原因）。
- 修复 `/compact` 遇到瞬时错误就直接失败（本地与远程）：手动压缩只有一次摘要请求、没有重试。现在压缩流遇到超时、限流、5xx、连接中断等瞬时错误会从头发起重试（本地默认 3 次、远端命令默认 2 次，指数退避，可取消），失败尝试的部分输出不会混入重试结果；远端失败时读取 `compaction/end` 的真实原因并展示，而不是只报 “could not produce a useful summary”。插件热重载后压缩路由包装由新版本替换，不会叠加。
- 修复远程会话 `/compact` 在旧运行时工作区上直接失败：会话附载、每轮开始和压缩前都会把工作区切到设置中的目标运行时（目标版本已安装时），并停掉用旧 dsh 启动的 SDK/warm runner 后重新启动；不再因为 journal 里记录的旧 dsh 路径而一直提示 `still runs dsh 0.2.1-rc.5`。目标版本尚未安装时，错误信息会明确要求先在设备页重新安装远端服务。
- 修复远端 runner 异常退出时把普通 info 日志（如 `[llm-deepseek-api-key] model listing ...`）当作失败原因显示：现在只保留真正的错误行，没有错误行时明确说明 runner 已退出并提示重试/查看远端日志。
- 修复启动远程会话偶发「SFTP 写入超时（30s）」后每次都失败：这台设备的 SFTP 往返实测 1–6 秒，单个小文件写入就要 7–14 秒，原来 30 秒的总预算过紧；现在 SFTP 子系统打开（30s）与写入（60s）分开计时，超时会销毁已经失效的连接；写入是幂等操作，连接级失败会换一条新连接重试一次。上传超时也改为丢弃坏连接，不再让死 socket 留在池里毒化后续调用。
- 界面文案中的 ZCode 改为 dsh：文件夹信任提示、文件夹浏览提示、远端下载方式说明；远端下载说明同时改为「配置的 npm 源」，不再提 ZCode CDN。
- 修复创建项目偶尔永久卡在「执行中… / 正在读取 …」：SSH 握手在服务器 banner 之后被断开时，ssh2 只发 `close` 不发 `error` 并清掉自己的 `readyTimeout`，连接池的 `ready` promise 永不 settle；现在握手结束/关闭/超时都会结算，失效的池化连接不再复用，连接获取、通道打开与 SFTP 上传/写入全部有独立超时。
- 长任务增加看门狗：创建/准备/启动/重启/移除任务在整任务超时或长时间没有新日志时明确失败（并中止信号），客户端遇到已被插件重载丢弃的 job 会提示重新执行，不再无限轮询。
- 桥接步骤结束前补齐未收到结果的 tool/call：写入与原生一致的 `ToolOutcomeUnknownError` 结果（`TOOL_OUTCOME_UNKNOWN`），并丢弃没有对应调用记录的迟到 `tool/result`，避免 anchor 在 `step/end` 处留下无法解析的工具调用。
- 远程会话的 `/compact` 现在真正在远端执行：命令转发给远端 agent 压缩其自身上下文，再把握手产生的 `compaction/*` 记录与 checkpoint 镜像回本地 anchor；本地会话仍走原有命令。
- 远程 dsh 默认版本升级到 `0.2.2-rc.1`（`0.2.1-rc.5` 缺少 `session/query`，无法转发命令），旧默认值自动迁移；工作区启动/重启时若目标版本已安装则自动切换运行时、启动脚本与 systemd unit，否则沿用当前版本并提示在设备页重新安装。
- 修复跨平台本地打包缺少 libc 原生绑定导致远程 dsh 启动失败（`No usable native binding found`）：探测远端 glibc/musl 并通过 npm `--libc` 选择对应依赖，打包前校验原生绑定存在，缺失时回退远端安装。
- 修复本地下载安装包期间没有进度：按 `node_modules` 体积每 2.5 秒报告已获取大小，长时间无新增时报告已用时长。
- 设备页在没有任何项目时也显示实时连接状态：后台轮询直接探测 SSH，连上为「已连接」、探测中为「连接中」、失败为「无连接」。
- 远程会话每步的 assistant 消息现在携带该步全部 tool-call 块（与原生会话一致），修复工具调用与结果配对不完整导致的上下文压缩失败。
- 修复远程会话执行 `/compact` 时提示 `Request timed out.`：压缩请求此前沿用了指向远端网关的模型选择，本机无法连接；现在只把远程会话的压缩请求改走本机可达的路由，本地会话模型不变。
- 修复远程会话底部统计只剩「轮/步」：桥接时补传每步的 usage 与流式记录，并镜像 `request/header`、`request/context`，tok/s、总 token、缓存命中率与上下文占用与本地会话一致。
- 修复桥接镜像的 `request/header` 缺少原生必需的 `reason`、导致 anchor 会话在重新加载时整份日志判定损坏：现在首个请求写 `initial`、之后配置变化写 `change`，远端显式给出的 `resume`/`series` 原样沿用，且只有 `startsSeries` 为真时才携带该字段。
- 修复 SELinux 强制模式主机上创建项目失败（`status=203/EXEC`）：便携 Node 解压在家目录下带有 `admin_home_t` 标签，systemd 的 `initrc_t` 无法执行；安装或复用运行时前统一 `chcon -t bin_t`。
- 修复本地凭证文档与远端 dsh 运行时不兼容导致的启动失败：上传前把 `version: "1"` 规范为数字，并跳过远端不支持的记录（模型密钥 `refs` 保留）。
- 修复健康检查在 dsh 尚未监听端口时立即判定失败的问题；状态探测补回进程运行时长，启动中的工作区不再显示为异常，HTTP 状态码也不会再被日志尾部污染。

## 0.3.1 — 2026-11-06

### 稳定性

- `state.json` 损坏时先备份为 `state.json.corrupt-<timestamp>`，不再用空状态覆盖；读取失败（权限/IO）时拒绝所有写入。
- 旧版 ZCode 设备导入只执行一次，删除设备后重启不会再次导入。
- `bridge.json` 改为同步加载，插件重载/移除设备时不会再写入空 journal。
- SSH 命令超时后关闭远端 channel；UTF-8 输出不再因分块解码而错位；测试连接结束后释放连接。
- 冷启动期间取消会话会终止已启动的远端进程，不再留下孤儿任务。
- 移除项目/停用插件时统一清理 tail、warm、SDK 与 idle promise。

### 性能

- 后台状态轮询改为快速探测：不再获取日志，也不再执行 `sleep 0.5` 采 CPU/内存；详情页仍按需采集。
- 轮询支持 in-flight 去重、按工作区跳过忙碌会话、并发上限 2，修改轮询间隔即时生效。
- SDK 运行时失败后进入冷却并自动重试；冷却期间复用预热 runner，不再每轮冷启动。
- 轮询回退间隔 300ms → 1s，并把文件大小与进程存活合并为一次 SSH 命令。
- Docker 容器列表缓存 5 秒，减少每条命令前的 `docker ps -a`。

### 界面

- 最小化的连接 pill 可以重新打开设备对话框并恢复连接进度；打不开时保留 pill，不再静默丢失。
- 创建项目、保存/删除设备、打开工作区增加重复提交保护。
- API 请求 15 秒超时；窗口隐藏时暂停 job / 行状态轮询，恢复可见后立即刷新。
- 行装饰器按签名跳过无变化的 DOM 写入；修正“保存中”和错误提示文案。

### 发布

- `package.json` 补充 `engines`、`bin`、`scripts`、`author`；npm 包不再包含逆向文档和 `architecture.svg`。
- README 补充 macOS/Linux 安装命令，并说明 0600 仅在 POSIX 上生效。

## 0.3.0

- 完成设备页 1:1、助手流增量修订与 `dsh-plugin` 关键词。
