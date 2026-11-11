# 发布清单

本插件以 npm 包加 dsh bundle patch 的形式分发。发布前逐项打勾，任何一步失败就停下，不要带着已知红灯发版。

## 0. 准备

- 工作树干净：`git status --short` 无输出；未提交的实验代码先移出分支。
- `CHANGELOG.md` 的 `## Unreleased` 下已写清本次改动（工具 / 修复 / 安全），没有「待补」。
- `docs/zcode-ssh-parity.md` 的状态列与代码一致：只有跑过真机或截图比对的才能写「实机验证」。
- 版本号只在决定发版时改 `package.json`；`lib/client.js` 由 `npm run build:client` 生成，不要手改。

## 1. 自动门禁

```bash
npm ci
npm run verify
```

`verify` 依次完成：模块语法校验、全部单测、`lib/client.js` 重建后逐字节比对、`npm pack --dry-run` 内容审计（拒绝 `analysis/`、`state.json`、`known_hosts.json`、`lib/client/`）。CI（`.github/workflows/ci.yml`）在 Ubuntu Node 22/24 与 Windows Node 22 上跑同一条命令。

## 2. 真机验证

测试主机放在 `130~133`（Linux + sshd），使用临时 DSH home，不碰用户工作区：

```bash
npm run e2e:live -- --hosts home130,home132
npm run e2e:lock -- --hosts home130,home132
npm run e2e:bridge -- --host home130
```

- `e2e:live`：连接 → 创建 → 连续探测 ×5 → health → 按主机批量状态 → SSH 掉线 → 停止/启动/重启 → 日志 → 删除。期望全 PASS（两台主机 22 项）。
- `e2e:lock`：双桌面并发安装锁、竞争失败方的 typed error、stale 接管、串行竞争。
- `e2e:bridge`：真实远端 dsh + 假本地 Agent 的首轮、追问、排队、取消、回合中掉线。

日志与 report 写在 `analysis/e2e/<stamp>/`（gitignore，不打包）。

## 3. 凭据与隐私

- `git grep -n "password"` 只应出现在表单/协议/测试假数据里，不应出现真实密码。
- 发布包内不得含 `state.json`、`known_hosts.json`、`analysis/`、`lib/client/`（`verify` 已强制）。
- 凭据存储：系统凭据库（Windows 凭据管理器 / macOS 钥匙串 / libsecret）为默认；没有凭据库的机器退回 0600 的 `state.json`。发布说明里保持这条描述与实际一致。

## 4. 打包与冒烟

```bash
npm pack --dry-run --json   # 与 verify 相同，确认文件清单
npm pack                    # 产物 dsh-ssh-remote-<version>.tgz
```

在干净目录安装产物，启动一次 dsh，确认：

1. 设置页出现「远程设备」，设备列表可编辑；
2. 新建连接能完成安装/复用远端服务；
3. `GET /ssh-remote/health` 返回 `ok: true` 且 `checks` 含 `store/anchor/bridge/ssh/secrets`；
4. 侧栏远程项目行可打开，首轮消息能流式返回。

## 5. 标记与回滚

- 打 tag 前再跑一次 `npm run verify`；tag 形如 `v0.3.2`，与 `package.json` 一致。
- 推送到远端使用仓库配置的凭据助手（`~/.git-credentials`），不要把 token 写进仓库或命令输出。
- 回滚：`git revert` 或回退 tag 后重新发版；远端运行时不需要跟着回滚——设备页「重新安装远端服务」会按桌面端版本重装，项目与任务保留。

## 6. 发布说明

`CHANGELOG.md` 的 `Unreleased` 改成版本号段落；`README.md` / `README.en.md` 的新增能力与截图同步更新（zh 默认 + en 镜像，演示截图放在正文前部）。发布说明里点明：没有 WSL/Docker 的环境未验证这两条链路，避免用户误判。
