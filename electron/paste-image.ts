import { clipboard } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A terminal can only receive text, so an image on the clipboard is saved as a PNG
// and its path is pasted instead. Agent CLIs (Claude Code, Codex, Gemini, ...) attach
// an image whose path is pasted into their prompt.

const KEEP_MS = 7 * 24 * 60 * 60 * 1000

const pasteDir = () => path.join(os.tmpdir(), 'jysv-hera-paste')

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

  fs.mkdirSync(dir, { recursive: true })
  sweep(dir)

  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  const file = path.join(dir, `paste-${stamp}-${Math.random().toString(36).slice(2, 6)}.png`)

  fs.writeFileSync(file, image.toPNG())

  return file
}
