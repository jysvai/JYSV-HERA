import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { heraPipeName } from '../shared/util'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const home = os.homedir()

export function expandHome(p: string): string {
  if (p === '~') {
    return home
  }

  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(home, p.slice(2))
  }

  return p
}

let dataRoot: string | null = null

/** %APPDATA%\JYSV HERA on Windows, ~/Library/Application Support/JYSV HERA on macOS. */
export function dataDir(): string {
  if (!dataRoot) {
    dataRoot = process.env.HERA_HOME || app.getPath('userData')
    fs.mkdirSync(dataRoot, { recursive: true })
  }

  return dataRoot
}

export function dataPath(...parts: string[]): string {
  const target = path.join(dataDir(), ...parts)
  fs.mkdirSync(path.dirname(target), { recursive: true })

  return target
}

export function subDir(name: string): string {
  const dir = path.join(dataDir(), name)
  fs.mkdirSync(dir, { recursive: true })

  return dir
}

/** Directory holding the `hera` CLI and its shims (prepended to PATH in HERA shells). */
export function binDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'dist', 'bin')
}

export function pipePath(): string {
  if (isWin) {
    return heraPipeName(os.userInfo().username, dataDir(), path.join(app.getPath('appData'), 'JYSV HERA'))
  }

  return path.join(dataDir(), 'hera.sock')
}

/** Find an executable on PATH (PATHEXT-aware on Windows). */
export function findOnPath(command: string): string | null {
  if (!command) {
    return null
  }

  if (path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null
  }

  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  const exts = isWin ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';') : ['']
  const hasExt = isWin && path.extname(command) !== ''

  for (const dir of dirs) {
    for (const ext of hasExt ? [''] : exts) {
      const candidate = path.join(dir, command + ext)

      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate
        }
      } catch {
        // keep looking
      }
    }

    // npm installs PowerShell shims (*.ps1) next to *.cmd; either counts as installed.
    if (isWin && !hasExt) {
      const ps1 = path.join(dir, `${command}.ps1`)

      if (fs.existsSync(ps1)) {
        return ps1
      }
    }
  }

  return null
}

/** Atomic-ish JSON write: temp file + rename. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Read the last `bytes` of a file as UTF-8 (drops a possibly cut first line). */
export function readTail(file: string, bytes: number): string {
  let fd: number | null = null

  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const length = size - start
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, start)
    const text = buffer.toString('utf8')

    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      fs.closeSync(fd)
    }
  }
}

/** Read the first `bytes` of a file as UTF-8. */
export function readHead(file: string, bytes: number): string {
  let fd: number | null = null

  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(bytes)
    const read = fs.readSync(fd, buffer, 0, bytes, 0)

    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      fs.closeSync(fd)
    }
  }
}
