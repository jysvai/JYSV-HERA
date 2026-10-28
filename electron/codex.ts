// Codex keeps one shared background app-server (its "daemon") and the TUI attaches
// to it. The daemon holds its own copy of the ChatGPT login and does not reload
// auth.json when the account in it changed ("Skipping auth reload due to account id
// mismatch"). Once it holds a revoked or signed-out login, every Codex tab opened
// after a HERA restart or update asks to sign in again, although auth.json is fine.
// `--no-daemon` gives each HERA tab its own server, which reads auth.json when it
// starts. Builds before the daemon don't know the flag, so `codex --help` decides.
import { exec, execFile } from 'node:child_process'
import path from 'node:path'

import { findOnPath, hydrateLoginPath, isWin } from './paths'

const FLAG = '--no-daemon'
/** Re-ask after this long, so updating Codex while HERA runs is picked up. */
const FRESH_MS = 30 * 60_000

const known = new Map<string, { supported: boolean; at: number }>()
const pending = new Map<string, Promise<boolean>>()

/** Does this Codex executable accept `--no-daemon`? Cached per executable. */
export function codexSupportsNoDaemon(command = 'codex'): Promise<boolean> {
  const exe = findOnPath(command)
  if (!exe) return Promise.resolve(false)

  const hit = known.get(exe)
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.supported)

  const running = pending.get(exe)
  if (running) return running

  const probe = new Promise<boolean>(resolve => {
    const done = (error: Error | null, stdout: string) => resolve(!error && String(stdout).includes(FLAG))
    const options = { timeout: 15_000, windowsHide: true, maxBuffer: 4 << 20 }
    // npm installs a .cmd shim on Windows, which only runs through the shell.
    // The path comes from PATH; one that could break out of the quotes is not run.
    if (isWin && /\.(cmd|bat)$/i.test(exe)) {
      if (/["%\r\n]/.test(exe)) resolve(false)
      else exec(`"${exe}" --help`, options, done)
    }
    else execFile(exe, ['--help'], options, done)
  }).then(supported => {
    known.set(exe, { supported, at: Date.now() })
    pending.delete(exe)

    return supported
  })
  pending.set(exe, probe)

  return probe
}

/** Subcommands that open the TUI and take `--no-daemon`; `login`, `exec`, `mcp`… reject it. */
const TUI_SUBCOMMANDS = new Set(['resume', 'fork'])
/** Top-level options followed by a value (`codex -m gpt-5`): the value is not a subcommand. */
const VALUE_OPTIONS = new Set(['-m', '--model', '-c', '--config', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '-C', '--cd', '-i', '--image', '--add-dir', '--enable', '--disable', '--local-provider'])

/**
 * The command line HERA types for a Codex tab, with `--no-daemon` added when this
 * Codex supports it. Only the TUI gets it (bare `codex`, `codex resume`, `codex fork`);
 * commands that pick a server themselves are left alone.
 */
export async function codexBootCommand(command: string): Promise<string> {
  const exe = command.trim().match(/^"([^"]+)"|^\S+/)
  const program = exe ? exe[1] || exe[0] : ''

  if (!/^codex(\.(cmd|exe|ps1))?$/i.test(path.basename(program))) return command
  if (/(^|\s)--(no-daemon|remote)\b/.test(command)) return command

  // The first word after the program that is neither an option nor an option's value: a
  // subcommand, or the prompt. A bare word other than the TUI ones is taken for a subcommand
  // and left alone, so a subcommand Codex adds later never breaks; a quoted prompt is the TUI.
  const parts = command.trim().slice(exe![0].length).trim().split(/\s+/).filter(Boolean)
  let word: string | undefined
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part.startsWith('-')) {
      if (!part.includes('=') && VALUE_OPTIONS.has(part)) index++
      continue
    }
    word = part
    break
  }
  if (word && /^[a-z][a-z0-9-]*$/.test(word) && !TUI_SUBCOMMANDS.has(word)) return command

  await hydrateLoginPath()
  const supported = await Promise.race([codexSupportsNoDaemon(program), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000))])

  return supported ? `${command} ${FLAG}` : command
}
