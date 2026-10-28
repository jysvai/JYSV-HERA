import { clipboard } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { dataPath } from './paths'

// A terminal can only receive text, so an image on the clipboard is saved as a PNG
// and its path is pasted instead. Agent CLIs (Claude Code, Codex, Gemini, ...) attach
// an image whose path is pasted into their prompt.

const KEEP_MS = 7 * 24 * 60 * 60 * 1000

// Per-user temp folder (on Linux /tmp is shared by every account).
const tempDir = () => path.join(os.tmpdir(), process.platform === 'win32' ? 'jysv-hera-paste' : `jysv-hera-paste-${os.userInfo().uid}`)

/** A folder only this user can use; the data folder when another account owns the temp one. */
function pasteDir(): string {
  const dir = tempDir()

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (process.platform === 'win32') return dir

    const stat = fs.lstatSync(dir)
    if (stat.isDirectory() && stat.uid === process.getuid?.()) {
      fs.chmodSync(dir, 0o700)
      return dir
    }
  } catch {
    // fall back below
  }

  const own = dataPath('paste')
  fs.mkdirSync(own, { recursive: true, mode: 0o700 })

  return own
}

/** Pastes older than a week go; the CLIs have read them long before. */
function sweep(dir: string) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)

    try {
      if (Date.now() - fs.statSync(file).mtimeMs > KEEP_MS) fs.rmSync(file, { force: true })
    } catch {
      // In use or already gone.
    }
  }
}

/** Saves the clipboard image as a PNG and returns its path, or null when there is no image. */
export function saveClipboardImage(): string | null {
  const image = clipboard.readImage()

  if (image.isEmpty()) return null

  const dir = pasteDir()

  sweep(dir)

  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  const file = path.join(dir, `paste-${stamp}-${crypto.randomBytes(4).toString('hex')}.png`)

  // Exclusive create: never write through a file or link that is already there.
  fs.writeFileSync(file, image.toPNG(), { flag: 'wx', mode: 0o600 })

  return file
}
