// `npm run verify`: the checks CI runs, in one command.
//
// Four gates, cheapest first:
//   1. every shipped module parses (`scripts/check.mjs`);
//   2. the unit/regression suite passes (`node --test`);
//   3. `lib/client.js` is exactly what `scripts/build-client.mjs` produces —
//      a stale bundle is restored and the run fails, so a part edit can never
//      ship without its generated entry;
//   4. the npm tarball contains no local state, analysis notes or client parts.
//
// Kept dependency-free and cross-platform: Windows cannot `execFile` npm.cmd
// without a shell, so npm is invoked through a shell only there.
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(label, command, args, options = {}) {
  process.stdout.write(`\n${label}\n`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`verify: ${label} failed (exit ${result.status})`)
    process.exit(result.status || 1)
  }
}

run('check: parsing every shipped module', process.execPath, ['scripts/check.mjs'])
run('test: unit and regression suite', process.execPath, ['--test'])

const bundle = path.join(root, 'lib', 'client.js')
const before = readFileSync(bundle, 'utf8')
run('build: regenerating the client bundle', process.execPath, ['scripts/build-client.mjs'])
const after = readFileSync(bundle, 'utf8')
if (before !== after) {
  writeFileSync(bundle, before, 'utf8')
  console.error('verify: lib/client.js was stale (the build changed it). Run `npm run build:client` and commit the bundle.')
  process.exit(1)
}
console.log('client bundle: up to date')

// A tarball must never carry machine state or the reverse-engineering notes
// that `.gitignore` keeps out of the repository.
const packed = execSync('npm pack --dry-run --json', {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit']
})
const manifest = JSON.parse(packed)[0]
const forbidden = [
  /(^|\/)analysis\//u,
  /(^|\/)lib\/client\//u,
  /(^|\/)state\.json/u,
  /(^|\/)known_hosts\.json/u,
  /(^|\/)bridge\.json/u,
  /\.credentials/u,
  /(^|\/)\.git\//u
]
const leaked = (manifest.files || []).map((file) => file.path).filter((file) => forbidden.some((rule) => rule.test(file)))
if (leaked.length) {
  console.error(`verify: the npm tarball would include local-only files:\n  ${leaked.join('\n  ')}`)
  process.exit(1)
}
console.log(`package: ${manifest.files.length} file(s), no local state or analysis notes`)

console.log('\nverify: all gates passed')
