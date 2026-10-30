// Codex keeps one shared background app-server (its "daemon") and the TUI attaches
// to it. The daemon holds its own copy of the ChatGPT login and does not reload
// auth.json when the account in it changed ("Skipping auth reload due to account id
// mismatch"). Once it holds a revoked or signed-out login, every Codex tab opened
// after a HERA restart or update asks to sign in again, although auth.json is fine.
// `--no-daemon` gives each HERA tab its own server, which reads auth.json when it
// starts.
//
// Codex also draws in the alternate screen and reports every mouse event (?1049h,
// ?1003h), so the wheel scrolls its own transcript: each step is a round trip to
// Codex and a full redraw, and xterm sends one report per wheel event, which a macOS
// trackpad barely moves. `--no-alt-screen` runs it inline: the conversation stays in
// the terminal's scrollback and scrolls, and selects, like any other output.
//
// Older builds don't know these flags, so `codex --help` decides.
import { exec, execFile } from 'node:child_process'
import path from 'node:path'

import { findOnPath, hydrateLoginPath, isWin } from './paths'

/** Re-ask after this long, so updating Codex while HERA runs is picked up. */
const FRESH_MS = 30 * 60_000

const known = new Map<string, { help: string; at: number }>()
const pending = new Map<string, Promise<string>>()

/** `--help` of this Codex executable, '' when it does not run. Cached per executable. */
function codexHelp(exe: string): Promise<string> {
  const hit = known.get(exe)
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.help)

  const running = pending.get(exe)
  if (running) return running

  const probe = new Promise<string>(resolve => {
    const done = (error: Error | null, stdout: string) => resolve(error ? '' : String(stdout))
    const options = { timeout: 15_000, windowsHide: true, maxBuffer: 4 << 20 }
    // npm installs a .cmd shim on Windows, which only runs through the shell.
    // The path comes from PATH; one that could break out of the quotes is not run.
    if (isWin && /\.(cmd|bat)$/i.test(exe)) {
      if (/["%\r\n]/.test(exe)) resolve('')
      else exec(`"${exe}" --help`, options, done)
    }
    else execFile(exe, ['--help'], options, done)
  }).then(help => {
    known.set(exe, { help, at: Date.now() })
    pending.delete(exe)

    return help
  })
  pending.set(exe, probe)

  return probe
}

/** Subcommands that open the TUI and take the flags; `login`, `exec`, `mcp`… reject them. */
const TUI_SUBCOMMANDS = new Set(['resume', 'fork'])
/** Top-level options followed by a value (`codex -m gpt-5`): the value is not a subcommand. */
const VALUE_OPTIONS = new Set(['-m', '--model', '-c', '--config', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '-C', '--cd', '-i', '--image', '--add-dir', '--enable', '--disable', '--local-provider'])

/**
 * The command line HERA types for a Codex tab, with those of `flags` this Codex
 * supports added. Only the TUI gets them (bare `codex`, `codex resume`, `codex fork`);
 * other commands are left alone, and so is the server of a `--remote` command.
 */
export async function codexBootCommand(command: string, flags: string[]): Promise<string> {
  const exe = command.trim().match(/^"([^"]+)"|^\S+/)
  const program = exe ? exe[1] || exe[0] : ''

  if (!/^codex(\.(cmd|exe|ps1))?$/i.test(path.basename(program))) return command

  const has = (flag: string) => new RegExp(`(^|\\s)${flag}\\b`).test(command)
  const wanted = flags.filter(flag => !has(flag) && !(flag === '--no-daemon' && has('--remote')))
  if (!wanted.length) return command

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
  const file = findOnPath(program)
  const help = file ? await Promise.race([codexHelp(file), new Promise<string>(resolve => setTimeout(() => resolve(''), 8000))]) : ''
  const supported = wanted.filter(flag => help.includes(flag))

  return supported.length ? `${command} ${supported.join(' ')}` : command
}
