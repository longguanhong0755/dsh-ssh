// `npm run check`: syntax-check every shipped ES module without a test run.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

for (const dir of ['lib', 'bin', 'scripts']) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    continue
  }
  for (const file of entries) {
    if (!/\.(?:m?js)$/u.test(file)) continue
    execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' })
  }
}
