// Expand command-line targets into stored session logs.
//
// Every maintenance script accepts either a log file or a directory tree
// (`...\.dsh\sessions` and `...\.dsh\ssh-remote\anchors` both nest logs two or
// three levels deep), so the walk lives here instead of being copy-pasted.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The one file name a stored session log has. */
export const LOG_FILE = 'session.v4.jsonl.zstd'

/**
 * @param {string[]} inputs - file or directory paths
 * @returns {string[]} every `session.v4.jsonl.zstd` under the directories, plus the files given
 */
export function expandTargets(inputs) {
  const files = []
  for (const input of inputs) {
    if (!statSync(input).isDirectory()) {
      files.push(input)
      continue
    }
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name === LOG_FILE) files.push(path)
      }
    }
    walk(input)
  }
  return files
}
