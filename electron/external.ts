// Open a project in the OS terminal instead of inside HERA (lightest possible
// mode: no HERA renderer involved at all), and bulk-discover projects.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { Project } from '../shared/types'

import { binDir, findOnPath, isMac, isWin } from './paths'
import { buildShellSpec } from './shell'
import { getConfig } from './store'

function detached(command: string, args: string[], cwd?: string) {
  const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => undefined)
  child.unref()
}

function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function openExternalTerminal(project: Project, command: string | null): { ok: boolean; message: string } {
  const config = getConfig()
  const pref = config.settings.externalTerminal
  const dir = project.path

  if (!fs.existsSync(dir)) {
    return { ok: false, message: `폴더가 없습니다: ${dir}` }
  }

  if (isWin) {
    const spec = buildShellSpec(project.shell || config.settings.defaultShell, config.settings.loadShellProfile)
    const wt = pref === 'conhost' ? null : findOnPath('wt.exe')
    let shellArgs = spec.args

    if (command && (spec.kind === 'powershell' || spec.kind === 'pwsh')) {
      // Re-encode the boot script with the command appended.
      const index = shellArgs.indexOf('-EncodedCommand')
      const boot = Buffer.from(shellArgs[index + 1], 'base64').toString('utf16le')
      shellArgs = [...shellArgs]
      shellArgs[index + 1] = Buffer.from(`${boot}; ${command}`, 'utf16le').toString('base64')
    } else if (command && spec.kind === 'cmd') {
      // The boot script lives under "...\JYSV HERA\..." (a space), and `cmd /k`
      // only keeps quotes around a lone executable path. A launcher .cmd that
      // calls boot then runs the command keeps the /k argument to one quoted path.
      const launcher = path.join(path.dirname(shellArgs[1]), `external-${project.id}.cmd`)
      fs.writeFileSync(launcher, `@echo off\r\ncall "${shellArgs[1]}"\r\n${command}\r\n`, 'utf8')
      shellArgs = ['/k', launcher]
    }

    if (wt) {
      // `;` separates wt sub-commands; escape any inside arguments.
      const escape = (arg: string) => arg.replace(/;/g, '\\;')
      detached(wt, ['-w', 'jysvhera', 'new-tab', '--title', escape(project.name), '-d', escape(dir), spec.command, ...shellArgs.map(escape)])
    } else {
      detached('conhost.exe', [spec.command, ...shellArgs], dir)
    }

    return { ok: true, message: wt ? 'Windows Terminal 에서 열었습니다.' : '콘솔 창에서 열었습니다.' }
  }

  if (isMac) {
    const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
    const script = [`cd ${sh(dir)}`, `export PATH=${sh(binDir())}:"$PATH"`, command].filter(Boolean).join('; ')

    if (pref === 'iterm' && fs.existsSync('/Applications/iTerm.app')) {
      const login = `/bin/zsh -lc ${sh(`${script}; exec $SHELL -l`)}`
      detached('osascript', ['-e', `tell application "iTerm" to create window with default profile command ${appleScriptString(login)}`])
    } else {
      detached('osascript', ['-e', `tell application "Terminal" to do script ${appleScriptString(script)}`, '-e', 'tell application "Terminal" to activate'])
    }

    return { ok: true, message: '터미널 앱에서 열었습니다.' }
  }

  const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].map(findOnPath).find(Boolean)

  if (!term) return { ok: false, message: '터미널 앱을 찾지 못했습니다.' }

  const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const script = [`export PATH=${sh(binDir())}:"$PATH"`, command, 'exec "${SHELL:-sh}"'].filter(Boolean).join('; ')
  // gnome-terminal takes the command after `--`; the others accept `-e`.
  const args = path.basename(term).startsWith('gnome-terminal') ? ['--', 'sh', '-c', script] : ['-e', 'sh', '-c', script]
  detached(term, args, dir)

  return { ok: true, message: '터미널을 열었습니다.' }
}

const MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'composer.json',
  'Gemfile',
  'pubspec.yaml',
  'project.godot',
  'Package.swift',
  '.claude'
]

/** Subfolders of `parent` that look like projects (marker files), newest first. */
export function scanForProjects(parent: string): { path: string; name: string; markers: string[]; mtime: number }[] {
  const out: { path: string; name: string; markers: string[]; mtime: number }[] = []
  let entries: fs.Dirent[]

  try {
    entries = fs.readdirSync(parent, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const dir = path.join(parent, entry.name)
    let names: string[]

    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }

    const markers = MARKERS.filter(marker => names.includes(marker))
    const hasSln = names.some(name => name.endsWith('.sln') || name.endsWith('.csproj'))

    if (markers.length || hasSln) {
      let mtime = 0

      try {
        mtime = fs.statSync(dir).mtimeMs
      } catch {
        // ignore
      }

      out.push({ path: dir, name: entry.name, markers: hasSln ? [...markers, '.sln'] : markers, mtime })
    }
  }

  return out.sort((a, b) => b.mtime - a.mtime)
}
