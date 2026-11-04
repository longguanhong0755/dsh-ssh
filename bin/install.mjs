#!/usr/bin/env node
// Register dsh-ssh-remote in a DeepSeek Harness profile.
//
//   node bin/install.mjs [--profile desktop] [--package <path>]
//
// It only edits the profile manifest and its node_modules link; it never
// touches the remote servers. Restart DeepSeek Harness afterwards.

import { readFile, writeFile, mkdir, lstat, symlink, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}

const profileName = arg('--profile', 'desktop')
const packagePath = resolve(arg('--package', packageDir))
const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

if (!existsSync(manifestPath)) {
  console.error(`Profile not found: ${manifestPath}`)
  console.error('Start DeepSeek Harness once so the profile is created, then retry.')
  process.exit(1)
}
if (!existsSync(join(packagePath, 'package.json'))) {
  console.error(`Plugin package not found: ${packagePath}`)
  process.exit(1)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dependencies = manifest.dependencies || {}
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
manifest.dsh.profile.bundles = manifest.dsh.profile.bundles || []
manifest.dependencies['dsh-ssh-remote'] = `link:${packagePath.replace(/\\/g, '/')}`
if (!manifest.dsh.profile.bundles.includes('dsh-ssh-remote')) {
  manifest.dsh.profile.bundles.push('dsh-ssh-remote')
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const linkPath = join(profileDir, 'node_modules', 'dsh-ssh-remote')
await mkdir(dirname(linkPath), { recursive: true })
try {
  const current = await lstat(linkPath)
  if (current.isSymbolicLink()) {
    await unlink(linkPath)
  } else if (current.isDirectory()) {
    console.error(`Refusing to replace a real directory at ${linkPath}.`)
    console.error('Remove it with the DSH plugin manager or by hand, then retry.')
    process.exit(1)
  } else {
    await unlink(linkPath)
  }
} catch {
  // absent
}
if (process.platform === 'win32') {
  execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, packagePath], { stdio: 'ignore' })
} else {
  await symlink(packagePath, linkPath, 'dir')
}

console.log(`Installed dsh-ssh-remote into profile "${profileName}".`)
console.log(`  manifest: ${manifestPath}`)
console.log(`  link:     ${linkPath} -> ${packagePath}`)
console.log('Fully quit and restart DeepSeek Harness to load the plugin.')
