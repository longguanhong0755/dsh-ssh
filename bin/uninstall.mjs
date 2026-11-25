#!/usr/bin/env node
// Remove @looooong/dsh-ssh from a DeepSeek Harness profile (local only).
//
//   node bin/uninstall.mjs [--profile desktop]
//
// Remote services are not touched; remove workspaces in the UI first if needed.

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const PLUGIN_ID = '@looooong/dsh-ssh'
// The package was published under a plain name first; remove that id too so a
// machine that ran the older installer ends up clean.
const LEGACY_IDS = ['dsh-ssh-remote']

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}

// Remove a link without ever following it: only a link is ever touched here.
function dropLink(id) {
  const linkPath = join(profileDir, 'node_modules', id)
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return
    if (process.platform === 'win32') execFileSync('cmd', ['/c', 'rmdir', linkPath], { stdio: 'ignore' })
    else unlinkSync(linkPath)
  } catch {
    // absent, which is the normal case
  }
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
for (const id of [PLUGIN_ID, ...LEGACY_IDS]) {
  if (manifest.dependencies) delete manifest.dependencies[id]
  if (manifest.dsh?.profile?.bundles) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((value) => value !== id)
  }
  dropLink(id)
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Removed ${PLUGIN_ID} from profile "${profileName}".`)
console.log('Restart DeepSeek Harness. Remote services are untouched.')