// The folder tree of a project (right panel → 폴더). Lists one directory at a time,
// only inside a registered project, and never follows a path out of it.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { shell } from 'electron'

import { t } from '../shared/i18n'
import type { DirEntry, DirListing } from '../shared/types'
import { findOnPath } from './paths'
import { projectById } from './store'

/** More entries than this in one folder are cut (a folder of build output, say). */
const MAX_ENTRIES = 2000
/** Opening these runs a program; the tree only shows them in the file manager. */
const RUNNABLE =
  /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|msix|appx|application|scr|pif|cpl|msc|hta|inf|url|lnk|reg|sh|bash|zsh|fish|command|tool|workflow|scpt|terminal|pkg|mpkg|dmg|app|jar|appimage|run|desktop|py|pl|rb)$/i

function resolveInside(projectId: string, rel: string): { root: string; target: string } | null {
  const project = projectById(projectId)
  if (!project) return null

  const root = path.resolve(project.path)
  const target = path.resolve(root, rel || '.')
  const back = path.relative(root, target)
  if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) return null

  return { root, target }
}

export function listProjectDir(projectId: string, rel: string): DirListing {
  const inside = resolveInside(projectId, String(rel || ''))
  if (!inside) return { entries: [], truncated: false, error: t('프로젝트 밖의 경로입니다.') }

  try {
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    // Sorted before the cut, so a huge folder always shows the same first entries.
    const dirents = fs.readdirSync(inside.target, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || byName(a.name, b.name))
    const entries: DirEntry[] = []

    for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
      let dir = dirent.isDirectory()
      let size = 0
      const link = dirent.isSymbolicLink()

      try {
        const stat = fs.statSync(path.join(inside.target, dirent.name))
        dir = stat.isDirectory()
        size = dir ? 0 : stat.size
      } catch {
        // a broken link or a file that vanished: list it as a file
      }

      entries.push({ name: dirent.name, dir, size, hidden: dirent.name.startsWith('.'), link })
    }

    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || byName(a.name, b.name))

    return { entries, truncated: dirents.length > MAX_ENTRIES }
  } catch (error) {
    return { entries: [], truncated: false, error: (error as NodeJS.ErrnoException).code || (error as Error).message }
  }
}

/** Open a file with its app, or show it in Explorer / Finder ('reveal', and always for programs). */
export function openProjectPath(projectId: string, rel: string, mode: 'open' | 'reveal'): boolean {
  const inside = resolveInside(projectId, String(rel || ''))
  if (!inside || !fs.existsSync(inside.target)) return false

  const stat = fs.statSync(inside.target)
  // An .app bundle is a folder, and on macOS / Linux an extensionless file with an exec bit runs
  // when opened (only extensionless: on exFAT / NTFS mounts every file has the bit).
  const execBit = !stat.isDirectory() && process.platform !== 'win32' && !path.extname(inside.target) && (stat.mode & 0o111) !== 0
  const runnable = RUNNABLE.test(inside.target) || execBit
  if (mode === 'open' && !runnable) void shell.openPath(inside.target)
  else shell.showItemInFolder(inside.target)

  return true
}

/** The absolute path of an entry, for copying and for typing into a terminal. */
export function projectAbsPath(projectId: string, rel: string): string | null {
  return resolveInside(projectId, String(rel || ''))?.target || null
}

function git(args: string[], cwd: string): Promise<string | null> {
  const exe = findOnPath('git')
  if (!exe) return Promise.resolve(null)

  return new Promise(resolve =>
    // --no-optional-locks: a status every few seconds must not take index.lock from an agent's commit.
    execFile(exe, ['--no-optional-locks', ...args], { cwd, timeout: 8000, maxBuffer: 8 << 20, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)))
  )
}

const statusRuns = new Map<string, Promise<Record<string, string>>>()

/**
 * `git status` of the project as path relative to the project → two-letter code (`M `, `??`, …);
 * empty outside a repo. A project inside a bigger repo sees only its own files.
 */
export function projectGitStatus(projectId: string): Promise<Record<string, string>> {
  const project = projectById(projectId)
  if (!project) return Promise.resolve({})
  const running = statusRuns.get(project.id)
  if (running) return running

  const run = (async () => {
    const prefix = (await git(['rev-parse', '--show-prefix'], project.path))?.trim()
    if (prefix === undefined) return {}
    const stdout = await git(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.'], project.path)
    if (stdout === null) return {}

    const out: Record<string, string> = {}
    const parts = stdout.split('\0')

    for (let index = 0; index < parts.length; index++) {
      const row = parts[index]
      if (row.length < 4) continue
      const code = row.slice(0, 2)
      const file = row.slice(3).replace(/\/$/, '')
      if (file.startsWith(prefix)) out[file.slice(prefix.length)] = code
      // A rename or copy is followed by its old path, which is not a separate entry.
      if ('RC'.includes(code[0]) || 'RC'.includes(code[1])) index++
    }

    return out
  })().finally(() => statusRuns.delete(project.id))
  statusRuns.set(project.id, run)

  return run
}
