import { clipboard, nativeImage } from 'electron'
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

/** The clipboard image as PNG bytes, or null when the clipboard holds no image. */
async function clipboardPng(): Promise<Buffer | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.includes('image/png') ? 'image/png' : item.types.find(type => type.startsWith('image/'))

    if (!type) continue

    const blob = (await item.getType(type)) as Blob
    const bytes = Buffer.from(await blob.arrayBuffer())

    if (type === 'image/png') return bytes.length ? bytes : null

    // Other formats (JPEG, ...) go through nativeImage to become a PNG.
    const image = nativeImage.createFromBuffer(bytes)

    return image.isEmpty() ? null : image.toPNG()
  }

  return null
}

/** Writes `bytes` to a new paste-<time>-<random>.<ext> in the paste folder and returns its path. */
function writePaste(bytes: Buffer, ext: string): string {
  const dir = pasteDir()

  sweep(dir)

  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  const file = path.join(dir, `paste-${stamp}-${crypto.randomBytes(4).toString('hex')}.${ext}`)

  // Exclusive create: never write through a file or link that is already there.
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 })

  return file
}

/** Saves the clipboard image as a PNG and returns its path, or null when there is no image. */
export async function saveClipboardImage(): Promise<string | null> {
  const png = await clipboardPng()

  return png ? writePaste(png, 'png') : null
}

/** Largest image accepted without a file of its own (one dragged out of a browser). */
const MAX_DROPPED = 32 << 20

/** The formats agent CLIs attach, told by their first bytes (the declared type can lie). */
function imageExt(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif'
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'

  return null
}

/** Saves a dropped image that has no file of its own and returns its path; null when it is not an image. */
export function saveDroppedImage(bytes: Buffer): string | null {
  const ext = bytes.length <= MAX_DROPPED ? imageExt(bytes) : null

  return ext ? writePaste(bytes, ext) : null
}

/** A small preview of an image file for the paste notice (data: URL), '' when it cannot be read. */
export function imagePreview(file: string): string {
  const image = nativeImage.createFromPath(file)

  if (image.isEmpty()) return ''

  return (image.getSize().height > 96 ? image.resize({ height: 96, quality: 'good' }) : image).toDataURL()
}
