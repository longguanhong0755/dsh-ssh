// Local remote targets: WSL distributions and Docker containers.
//
// This is a direct port of ZCode Desktop 3.16.2's own backends:
//   * out/main/chunk-DMITVDCT.js  -> WSLBackend / buildWslArgs / listWSLDistros
//   * out/main/chunk-EHXYYQDR.js  -> DockerBackend / listDockerContainers
//
// Both expose the same surface the plugin already needs from SSHPool
// (exec/upload/writeFile/exists/readFile/listDirs/detect), so the deployment,
// status polling, directory browser and headless bridge work unchanged.
//
// Notes from the original implementation that are intentionally preserved:
//   - wsl.exe output is UTF-16LE when it carries NUL bytes; `--status` is the
//     availability probe, `-l -v --all` the distro list.
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
