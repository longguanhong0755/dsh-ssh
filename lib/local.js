// Local remote targets: WSL distributions and Docker containers.
//
// Both were written against the behaviour of another desktop app's local
// backends (`out/main/chunk-DMITVDCT.js`, `out/main/chunk-EHXYYQDR.js`), which
// is why the quirks below are documented rather than guessed at:
//   - `wsl.exe` output is UTF-16LE when it carries NUL bytes; `--status` is
//     the availability probe, `-l -v --all` the distro list.
//   - a WSL target without a distro means the default distribution; the real
//     distro/user/home are resolved inside the distribution
//     (`$WSL_DISTRO_NAME`, `id -un`, `$HOME`).
//   - WSL uploads prefer \\wsl.localhost\<distro>\... / \\wsl$\<distro>\...
//     and fall back to `cat >` inside the distribution.
//   - Docker uploads always stream through `docker exec -i ... cat >`.
//   - Docker containers are addressed by name, full id or id prefix and must
//     be running.

import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, createReadStream } from 'node:fs'

export * from './local/process.js'
export * from './local/wsl.js'
export * from './local/docker.js'
