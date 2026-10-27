import { execFile } from 'node:child_process'
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

// ---------------------------------------------------------------- login PATH

/** Folders agent CLIs are commonly installed to, for when the login shell cannot be asked. */
const USUAL_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/home/linuxbrew/.linuxbrew/bin',
  '~/.local/bin',
  '~/.npm-global/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '~/.cargo/bin',
  '~/.deno/bin',
  '~/.claude/local',
  '~/bin'
]

let loginPath: Promise<void> | null = null

function mergePath(dirs: string[]) {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    merged.push(dir)
  }

  process.env.PATH = merged.join(path.delimiter)
}

/**
 * macOS / Linux: an app started from the Dock, Finder or a desktop launcher gets the
 * session's minimal PATH (/usr/bin:/bin:...), not the one the shell profile builds.
 * Agent CLIs installed with Homebrew, npm, bun or the Claude installer then look
 * missing, and lanes.sh cannot find `claude`. Ask the login shell once for its PATH
 * and add it (and the usual install folders that exist) in front of ours.
 */
export function hydrateLoginPath(): Promise<void> {
  if (loginPath) return loginPath
  if (isWin) return (loginPath = Promise.resolve())

  const current = (process.env.PATH || '').split(path.delimiter)
  const usual = USUAL_BIN_DIRS.map(expandHome).filter(dir => fs.existsSync(dir))
  // Usable right away; the login shell's answer refines the order when it arrives.
  mergePath([...current, ...usual])

  loginPath = new Promise<void>(resolve => {
    const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : isMac ? '/bin/zsh' : '/bin/bash'
    const fish = path.basename(shell) === 'fish'
    const mark = '__HERA_PATH__'
    const script = fish ? `printf '${mark}%s${mark}' (string join : $PATH)` : `printf '${mark}%s${mark}' "$PATH"`

    // -i so ~/.zshrc / ~/.bashrc run too (nvm, Homebrew shellenv and npm prefixes often live there).
    execFile(
      shell,
      ['-ilc', script],
      { timeout: 8000, maxBuffer: 1 << 20, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' } },
      (_error, stdout) => {
        const found = new RegExp(`${mark}(.*?)${mark}`, 's').exec(String(stdout || ''))?.[1]?.trim()
        if (found) mergePath([...found.split(':'), ...current, ...usual])
        resolve()
      }
    )
  })

  return loginPath
}
