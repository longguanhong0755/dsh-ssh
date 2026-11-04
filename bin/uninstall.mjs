#!/usr/bin/env node
// Remove dsh-ssh-remote from a DeepSeek Harness profile (local only).
//
//   node bin/uninstall.mjs [--profile desktop]
//
// Remote services are not touched; remove workspaces in the UI first if needed.

import { readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}

const profileName = arg('--profile', 'desktop')
const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`Profile not found: ${manifestPath}`)
  process.exit(1)
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.dependencies) delete manifest.dependencies['dsh-ssh-remote']
if (manifest.dsh?.profile?.bundles) {
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((value) => value !== 'dsh-ssh-remote')
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await rm(join(profileDir, 'node_modules', 'dsh-ssh-remote'), { recursive: true, force: true })
console.log(`Removed dsh-ssh-remote from profile "${profileName}".`)
console.log('Restart DeepSeek Harness. Remote services are untouched.')
