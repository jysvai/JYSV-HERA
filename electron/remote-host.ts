// Remote Control hosts: for each project with "start sessions from the phone" on, HERA keeps a
// `claude remote-control` server running in that folder. The Claude app's Code tab and
// claude.ai/code can then start new sessions there that run on this computer. HERA's Claude tabs
// pick those sessions up again with `claude --teleport` (the "bring a phone or web session" launch).
//
// The server runs in a hidden pty: it draws a status screen and asks first-run questions, which
// `--spawn same-dir` answers up front. Claude Code refuses server mode whenever ANTHROPIC_API_KEY is
// set, even for someone signed in with claude.ai who turned that key down for their sessions, so the
// server gets an environment without it when there is a claude.ai sign-in.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as nodePty from 'node-pty'

import { t } from '../shared/i18n'
import type { Project, RemoteHostStatus } from '../shared/types'
import { remoteName } from '../shared/util'

import { hydrateLoginPath, isWin, readJson } from './paths'
import { agentEnv } from './pty-host'
import { getConfig } from './store'

interface Host {
  project: Project
  pty: nodePty.IPty | null
  status: RemoteHostStatus
  output: string
  failures: number
  /** Tries while Anthropic still holds this folder for an earlier server (409). */
  held: number
  /** It was connected once: a later failure is the network or an update, worth trying again for as long as HERA runs. */
  everConnected: boolean
  restartTimer: ReturnType<typeof setTimeout> | null
  stopping: boolean
}

const hosts = new Map<string, Host>()
/** Servers still stopping (Ctrl+C), by project: a new one in the same folder waits for them. */
const stopping = new Map<string, Promise<void>>()
// HERA is quitting: nothing starts again.
let shuttingDown = false
const RETRY_MS = [5_000, 30_000, 120_000]
// A server that stayed up this long before it died starts its retries afresh.
const HEALTHY_MS = 10 * 60_000
// Server mode gives up after about 10 minutes without a network, and an update of Claude Code can
// take its binary away: a server that worked before keeps being tried this often.
const SLOW_RETRY_MS = 10 * 60_000
// A server stopped without Ctrl+C (a crash, a killed HERA) leaves the folder registered on
// Anthropic's side for a while: "already served by another Claude Code on this device".
const HELD_RETRY_MS = 20_000
const HELD_TRIES = 30
// Ctrl+C lets the server unregister the folder; a server that has not exited by then is killed.
const STOP_GRACE_MS = 4_000
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const CSI = new RegExp(`${ESC}\\[[0-9;?<>=]*[ -/]*[@-~]`, 'g')
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g')

// Cursor moves to another line (CUP, VPA, CNL / CPL, down / up) are where a redraw starts a new line.
const LINE_MOVE = /[HfdEFAB]$/

function plain(text: string): string {
  return text
    .replace(OSC, '')
    .replace(CSI, code => (LINE_MOVE.test(code) ? '\n' : ' '))
    .replace(/[ \t]+/g, ' ')
}

/** Signed in with claude.ai (Remote Control needs that sign-in, never an API key). */
function claudeAiSignIn(): boolean {
  const dir = process.env.CLAUDE_CONFIG_DIR
  const file = dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json')
  const global = readJson<{ oauthAccount?: { accountUuid?: string } }>(file)

  return Boolean(global?.oauthAccount?.accountUuid)
}

/** What the phone shows before a session has a title of its own: the project's name, kept shell-safe. */
function command(project: Project): { file: string; args: string[] } {
  const line = `claude remote-control --spawn same-dir --no-create-session-in-dir --remote-control-session-name-prefix ${remoteName(project.name)}`

  if (isWin) return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line] }

  return { file: process.env.SHELL || '/bin/bash', args: ['-lc', `exec ${line}`] }
}

function lastLine(text: string, pattern: RegExp): string | null {
  const lines = plain(text)
    .split(/\r?\n|\r/)
    .map(line => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i])) return lines[i]

  return null
}

function onOutput(host: Host, data: string) {
  host.output = (host.output + data).slice(-12_000)
  const text = plain(host.output)
  const url = /https:\/\/claude\.ai\/code\?environment=[\w-]+/.exec(text)?.[0]

  if (url) host.status.url = url
  // "·✔︎· Ready · lanes · main": the folder (or repo and branch) as the phone lists it.
  // Up to the end of its line, or the next line the server prints should a redraw have joined them.
  const label = /(?:Ready|Connected)[ \t]+·[ \t]+(.+?)[ \t]*(?=[\r\n]|Capacity\b|New sessions\b|Code anywhere\b|Continue\b|Or ask\b|https?:|$)/.exec(text)?.[1]?.trim()
  if (label) host.status.label = label.slice(0, 120)
  // "✔ Ready" with no session yet, "✔ Connected" once one is open.
  if (/\b(?:Ready|Connected)\b/.test(text) && host.status.state !== 'connected') {
    host.status = { ...host.status, state: 'connected', message: '', since: Date.now() }
    host.held = 0
    host.everConnected = true
  }
}

function start(host: Host) {
  if (shuttingDown) return
  const { file, args } = command(host.project)
  const env = agentEnv()

  // Server mode refuses to start while this is set (Windows spells environment names in any case).
  if (claudeAiSignIn()) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'ANTHROPIC_API_KEY') delete env[key]
  }
  host.output = ''
  host.stopping = false
  host.status = { projectId: host.project.id, state: 'starting', message: '', since: Date.now(), url: host.status.url || null, label: host.status.label || null }
  if (!fs.existsSync(host.project.path)) {
    host.status = { ...host.status, state: 'error', message: t('프로젝트 폴더가 없습니다: {path}', { path: host.project.path }) }
    return
  }

  let pty: nodePty.IPty
  try {
    pty = nodePty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 40, cwd: host.project.path, env, ...(isWin ? { useConptyDll: false } : {}) })
  } catch (error) {
    host.status = { ...host.status, state: 'error', message: (error as Error).message }
    return
  }

  const startedAt = Date.now()
  host.pty = pty
  pty.onData(data => onOutput(host, data))
  pty.onExit(({ exitCode }) => {
    if (host.pty !== pty) return
    host.pty = null
    if (host.stopping) return

    // Why it stopped, in Claude Code's own words where it gave one.
    const reason = lastLine(host.output, /error|refus|requires|not (?:trusted|available|signed)|login|expired|denied|already served/i) || t('Remote Control 서버가 멈췄습니다 (종료 코드 {code}).', { code: exitCode })
    host.status = { ...host.status, state: 'error', message: reason, since: Date.now() }

    // Held for an earlier server: that lets go by itself, so wait for it rather than give up.
    if (/already served/i.test(reason) && host.held < HELD_TRIES) {
      host.held++
      host.restartTimer = setTimeout(() => start(host), HELD_RETRY_MS)
      return
    }

    if (Date.now() - startedAt > HEALTHY_MS) host.failures = 0
    host.failures++
    const delay = RETRY_MS[host.failures - 1]
    const wait = delay ?? (host.everConnected ? SLOW_RETRY_MS : undefined)
    if (wait !== undefined) host.restartTimer = setTimeout(() => start(host), wait)
  })
}

/** Ctrl+C first, so the server unregisters the folder; killed if it is still there after the grace time. */
function stop(host: Host): Promise<void> {
  host.stopping = true
  if (host.restartTimer) clearTimeout(host.restartTimer)
  host.restartTimer = null

  const pty = host.pty
  host.pty = null
  if (!pty) return Promise.resolve()

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      // On Windows the server runs under cmd.exe (claude.cmd): the whole tree goes, not just the console.
      if (isWin && pty.pid) execFile('taskkill', ['/pid', String(pty.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
      try {
        pty.kill()
      } catch {
        // already gone
      }
      resolve()
    }, STOP_GRACE_MS)

    pty.onExit(() => {
      clearTimeout(timer)
      resolve()
    })

    try {
      pty.write('\x03')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

/** Start the servers projects ask for and stop the rest (at startup and after every config change). */
const wantedNow = () => new Map(getConfig().projects.filter(project => project.phoneServer).map(project => [project.id, project]))

export async function syncRemoteHosts(): Promise<void> {
  if (shuttingDown) return
  let wanted = wantedNow()

  for (const [id, host] of hosts) {
    const project = wanted.get(id)
    // A project moved to another folder needs its server there.
    if (!project || project.path !== host.project.path) {
      hosts.delete(id)
      const done = stop(host).finally(() => {
        if (stopping.get(id) === done) stopping.delete(id)
      })
      stopping.set(id, done)
    } else {
      host.project = project
    }
  }

  if (![...wanted.keys()].some(id => !hosts.has(id))) return
  // A Dock / Finder start has no login-shell PATH yet, and `claude` lives on it.
  await hydrateLoginPath()
  // Switched off again meanwhile, or the same folder's old server still letting go of it.
  await Promise.all([...wanted.keys()].map(id => stopping.get(id)))
  if (shuttingDown) return
  wanted = wantedNow()

  for (const [id, project] of wanted) {
    if (hosts.has(id)) continue
    const host: Host = {
      project,
      pty: null,
      status: { projectId: id, state: 'starting', message: '', since: Date.now(), url: null, label: null },
      output: '',
      failures: 0,
      held: 0,
      everConnected: false,
      restartTimer: null,
      stopping: false
    }
    hosts.set(id, host)
    start(host)
  }
}

/** Try a server that gave up again (the switch is still on). */
export function retryRemoteHost(projectId: string): void {
  const host = hosts.get(projectId)
  if (!host || host.pty) return

  if (host.restartTimer) clearTimeout(host.restartTimer)
  host.restartTimer = null
  host.failures = 0
  host.held = 0
  start(host)
}

export function remoteHostStatus(): RemoteHostStatus[] {
  return [...hosts.values()].map(host => ({ ...host.status }))
}

export function remoteHostsRunning(): boolean {
  return [...hosts.values()].some(host => host.pty)
}

/** Stop every server (Ctrl+C, then kill); resolves once all have exited or the grace time ran out. */
export async function stopRemoteHosts(): Promise<void> {
  shuttingDown = true
  const all = [...hosts.values()]
  hosts.clear()
  await Promise.all([...all.map(stop), ...stopping.values()])
}
