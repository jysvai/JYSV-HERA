// PTY host: owns every terminal session. Each session pairs a node-pty process
// with a headless xterm that always holds the exact screen state, so that:
//  - the renderer only renders what is visible (hidden tabs are unmounted and
//    rebuilt from a serialized snapshot when shown again),
//  - agents can read each other's screens (`hera peek`) even when HERA is
//    minimised or the tab was never opened,
//  - busy / idle / waiting-for-approval status is derived in the main process
//    and drives badges and notifications without any renderer work.
// Output to the renderer is coalesced per ~8ms instead of one IPC per chunk.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import workerThreads from 'node:worker_threads'

import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import * as nodePty from 'node-pty'

import { GENERIC_APPROVAL, GENERIC_BUSY } from '../shared/defaults'
import { locale, t } from '../shared/i18n'
import type { AgentDef, CreateSessionRequest, SessionInfo, SessionStatus } from '../shared/types'
import { newId, safeRegex } from '../shared/util'

import { codexBootCommand } from './codex'
import { binDir, dataPath, expandHome, home, isWin, readJson, writeJsonAtomic } from './paths'
import { cwdFromOsc, cwdFromPrompt, detectConversations, isDir, newConversationId, withId, type ConversationClaim, type ConversationRef } from './resume'
import { buildShellSpec, type ShellSpec } from './shell'
import { getConfig, projectById } from './store'

// On Windows node-pty copies each terminal's ConPTY output through a worker
// thread of its own: a whole V8 isolate per terminal that only moves bytes.
// Give that worker a small heap instead of the default limits.
function capConoutWorkers() {
  const Base = workerThreads.Worker

  class ConoutWorker extends Base {
    constructor(filename: string | URL, options?: workerThreads.WorkerOptions) {
      const conout = String(filename).includes('conoutSocketWorker')

      super(filename, conout ? { ...options, resourceLimits: { maxYoungGenerationSizeMb: 1, maxOldGenerationSizeMb: 16, codeRangeSizeMb: 2, stackSizeMb: 1 } } : options)
    }
  }

  ;(workerThreads as { Worker: typeof Base }).Worker = ConoutWorker
}

if (isWin) capConoutWorkers()

interface Session extends SessionInfo {
  pty: nodePty.IPty | null
  term: HeadlessTerminal
  serializer: SerializeAddon
  shellKind: ShellSpec['kind']
  attached: boolean
  attaching: boolean
  /** Bumped by attach/detach so a stale attach callback can tell it lost the race. */
  attachSeq: number
  pending: string[]
  flushTimer: NodeJS.Timeout | null
  statusTimer: NodeJS.Timeout | null
  bootCommand: string | null
  bootTimer: NodeJS.Timeout | null
  busySince: number
  launchReq: CreateSessionRequest
  revive?: string
  /** Screen text restored from disk, saved again as-is while the session stays dormant. */
  restoredSnapshot?: string
  /** Agent conversation this terminal holds (exact resume after a restart). */
  conversation: ConversationRef | null
  /** When the current agent started here (for matching its transcript). */
  agentStartedAt: number
  /** An agent was on screen when the session was last saved. */
  agentWasActive: boolean
  /** Folder the shell last reported (OSC 7 / 9;9 or a Windows prompt line). */
  liveCwd: string | null
  /** The shell's executable, arguments and environment as started (a WSL tab is `wsl.exe -d …`). */
  shellLine?: { command: string; args: string[]; env: Record<string, string> }
}

export interface PtyEvents {
  data: (id: string, data: string) => void
  snapshot: (id: string, data: string) => void
  changed: (info: SessionInfo) => void
  removed: (id: string) => void
  status: (info: SessionInfo, previous: SessionStatus, busyMs: number) => void
}

class TypedEmitter extends EventEmitter {
  override on<K extends keyof PtyEvents>(event: K, listener: PtyEvents[K]): this {
    return super.on(event, listener)
  }

  override emit<K extends keyof PtyEvents>(event: K, ...args: Parameters<PtyEvents[K]>): boolean {
    return super.emit(event, ...args)
  }
}

export const ptyEvents = new TypedEmitter()

const sessions = new Map<string, Session>()
const FLUSH_MS = 8
const STATUS_DEBOUNCE_MS = 650

// The renderer's xterm uses Unicode 11 widths and knows it runs on ConPTY (which
// changes how a resize reflows and grows the screen). The headless copy has to
// measure and resize exactly the same way: a snapshot taken from it (tab shown
// again, window restored) otherwise redraws a different, broken screen.
const WINDOWS_PTY = isWin ? { backend: 'conpty' as const, buildNumber: Number(os.release().split('.')[2]) || undefined } : undefined

function headlessTerminal(cols: number, rows: number, scrollback: number): { term: HeadlessTerminal; serializer: SerializeAddon } {
  const term = new HeadlessTerminal({ cols, rows, scrollback, allowProposedApi: true, windowsPty: WINDOWS_PTY })
  const serializer = new SerializeAddon()
  term.loadAddon(serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0])
  term.loadAddon(new Unicode11Addon() as unknown as Parameters<HeadlessTerminal['loadAddon']>[0])
  term.unicode.activeVersion = '11'

  return { term, serializer }
}

/** Scrollback a snapshot carries: as much as the renderer keeps, so a tab switch loses none of it. */
function snapshotLines(): number {
  return Math.min(getConfig().settings.scrollback, 5000)
}

interface HeadlessCore {
  coreMouseService?: { activeEncoding?: string }
  coreService?: { isCursorHidden?: boolean; decPrivateModes?: { cursorStyle?: string; cursorBlink?: boolean } }
  _bufferService?: { buffer?: { scrollTop: number; scrollBottom: number } }
}

const CURSOR_STYLE: Record<string, number> = { block: 1, underline: 3, bar: 5 }

/**
 * Terminal state SerializeAddon leaves out but a running program relies on: the
 * mouse encoding (full-screen TUIs such as Claude Code's read SGR wheel events
 * to scroll, and legacy encoding after a tab switch reads as no scrolling at all),
 * the cursor's visibility and shape, and the scroll region.
 */
function liveState(term: HeadlessTerminal): string {
  const core = (term as unknown as { _core?: HeadlessCore })._core
  let out = ''

  const encoding = core?.coreMouseService?.activeEncoding
  if (encoding === 'SGR') out += '\x1b[?1006h'
  else if (encoding === 'SGR_PIXELS') out += '\x1b[?1016h'

  const dec = core?.coreService?.decPrivateModes
  const style = dec?.cursorStyle ? CURSOR_STYLE[dec.cursorStyle] : undefined
  if (style) out += `\x1b[${style + (dec?.cursorBlink ? 0 : 1)} q`

  const buffer = core?._bufferService?.buffer
  // DECSTBM homes the cursor: keep it where the snapshot left it.
  if (buffer && (buffer.scrollTop !== 0 || buffer.scrollBottom !== term.rows - 1)) out += `\x1b7\x1b[${buffer.scrollTop + 1};${buffer.scrollBottom + 1}r\x1b8`

  if (core?.coreService?.isCursorHidden) out += '\x1b[?25l'

  return out
}

function snapshotOf(session: Session): string {
  return session.serializer.serialize({ scrollback: snapshotLines() }) + liveState(session.term)
}

function agentById(id: string | null | undefined): AgentDef | null {
  if (!id) {
    return null
  }

  return getConfig().agents.find(agent => agent.id === id) || null
}

function info(session: Session): SessionInfo {
  return {
    id: session.id,
    name: session.name,
    title: session.title,
    projectId: session.projectId,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pid,
    agentId: session.agentId,
    activeAgentId: session.activeAgentId,
    role: session.role,
    profileId: session.profileId,
    status: session.status,
    createdAt: session.createdAt,
    lastOutputAt: session.lastOutputAt,
    lastStatusChangeAt: session.lastStatusChangeAt,
    exitCode: session.exitCode,
    cols: session.cols,
    rows: session.rows,
    dormant: session.dormant,
    lane: session.lane || null,
    worktreeId: session.launchReq.worktreeId || null
  }
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].map(info).sort((a, b) => a.createdAt - b.createdAt)
}

export function getSession(id: string): SessionInfo | null {
  const session = sessions.get(id)

  return session ? info(session) : null
}

/** The running shell of a session (process id, command line, environment, folder), for paste-target.ts. */
export function sessionShell(id: string): { pid: number; command: string; args: string[]; env: Record<string, string>; cwd: string } | null {
  const session = sessions.get(id)

  return session?.pty && session.shellLine ? { pid: session.pty.pid, ...session.shellLine, cwd: session.liveCwd || session.cwd } : null
}

function uniqueName(base: string): string {
  const taken = new Set([...sessions.values()].map(session => session.name))

  for (let index = 1; ; index++) {
    const candidate = `${base}-${index}`

    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

function safeCwd(cwd: string | undefined): string {
  const candidate = path.resolve(expandHome(cwd || home))

  try {
    return fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate)
  } catch {
    return home
  }
}

function profileEnv(agent: AgentDef | null, profileId: string | null | undefined): Record<string, string> {
  if (!agent?.profileEnv || !profileId) {
    return {}
  }

  const profile = getConfig().profiles.find(entry => entry.id === profileId)

  return profile?.configDir ? { [agent.profileEnv]: expandHome(profile.configDir) } : {}
}

const INHERITED_AGENT_MARKERS =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_LANE|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|SSE_PORT|SESSION_ID|SESSION_ATTENDED|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|PARENT_.*)|CODEX_(SANDBOX.*|THREAD_ID|SESSION_ID)|GEMINI_CLI)$/

function shellEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('npm_config_') || key.startsWith('npm_package_')) continue
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_NO_ATTACH_CONSOLE' || key === 'ELECTRON_ENABLE_LOGGING') continue
    // HERA_LANES_HOST is the lanes setting's to give (spawn), not something to inherit.
    if (key === 'HERA_DEV_SERVER' || key === 'HERA_SESSION_ID' || key === 'HERA_SESSION_NAME' || key === 'HERA_LANES_HOST') continue
    // Session markers of an agent that happened to launch HERA must not leak
    // into fresh agents (Claude Code disables transcripts for child sessions).
    if (INHERITED_AGENT_MARKERS.test(key)) continue
    env[key] = value
  }

  delete env.NO_COLOR
  delete env.FORCE_COLOR
  delete env.COLORFGBG
  env.COLORTERM = 'truecolor'
  env.TERM = 'xterm-256color'
  env.TERM_PROGRAM = 'JYSV-HERA'
  env.LC_CTYPE = env.LC_CTYPE || 'UTF-8'
  // Python writes piped output in the ANSI code page (cp949) on Windows, which
  // agents then decode as UTF-8 — Korean turns into mojibake. UTF-8 mode fixes it.
  if (process.platform === 'win32' && !env.PYTHONUTF8) env.PYTHONUTF8 = '1'
  // `hera` resolves even if the user's profile rewrites PATH.
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
  env[pathKey] = `${binDir()}${path.delimiter}${env[pathKey] || ''}`

  return { ...env, ...extra }
}

function buildAgentCommand(req: CreateSessionRequest, agent: AgentDef | null, ids: { resumeId?: string | null; newId?: string | null } = {}): string | null {
  if (req.command?.trim()) {
    return req.command.trim()
  }

  if (!agent) {
    return null
  }

  const parts = [agent.command.trim()]

  if (ids.resumeId && agent.resumeIdArgs) {
    parts.push(withId(agent.resumeIdArgs, ids.resumeId))
  } else if (req.resume && agent.continueArgs) {
    parts.push(agent.continueArgs)
  } else if (ids.newId && agent.sessionIdArgs) {
    parts.push(withId(agent.sessionIdArgs, ids.newId))
  }

  if (req.extraArgs) {
    parts.push(req.extraArgs)
  }

  return parts.join(' ')
}

export function createSession(req: CreateSessionRequest): SessionInfo {
  const config = getConfig()
  // A worktree that was deleted in the meantime (a restored tab): a plain terminal in the
  // project folder instead, never the agent, which would edit the real project unasked.
  const lostCopy = Boolean(req.worktreeId && req.cwd && !isDir(req.cwd))
  if (lostCopy) req = { ...req, cwd: undefined, worktreeId: null, agentId: null, command: undefined, resume: undefined }
  const project = projectById(req.projectId || null)
  const agent = agentById(req.agentId || null)
  const cwd = safeCwd(req.cwd || project?.path)
  const spec = buildShellSpec(project?.shell || config.settings.defaultShell, config.settings.loadShellProfile)
  const [cols, rows] = clampSize(req.cols || 120, req.rows || 32)
  const id = newId('s_')
  const name = uniqueName(agent?.id || spec.kind)
  const { term, serializer } = headlessTerminal(cols, rows, config.settings.scrollback)
  // A fresh agent conversation gets an id HERA knows, so it can be resumed exactly.
  const conversationId = agent && !req.command?.trim() && !req.resume && agent.sessionIdArgs ? newConversationId() : null

  const session: Session = {
    id,
    name,
    title: req.title || (agent ? `${agent.name}` : spec.name.replace(/\.exe$/i, '')),
    projectId: project?.id || null,
    cwd,
    shell: spec.kind,
    pid: 0,
    agentId: agent?.id || null,
    activeAgentId: agent?.id || null,
    role: req.role || null,
    profileId: req.profileId || null,
    status: 'starting',
    createdAt: Date.now(),
    lastOutputAt: 0,
    lastStatusChangeAt: Date.now(),
    exitCode: null,
    cols,
    rows,
    pty: null,
    term,
    serializer,
    shellKind: spec.kind,
    attached: false,
    attaching: false,
    attachSeq: 0,
    pending: [],
    flushTimer: null,
    statusTimer: null,
    bootCommand: buildAgentCommand(req, agent, { newId: conversationId }),
    bootTimer: null,
    busySince: 0,
    launchReq: { ...req, cols, rows },
    conversation: agent && conversationId ? { agentId: agent.id, id: conversationId } : null,
    agentStartedAt: 0,
    agentWasActive: false,
    liveCwd: null,
    lane: req.lane || null
  }

  trackCwd(session)
  answerQueries(session)
  sessions.set(id, session)
  if (lostCopy) session.term.write(`\x1b[33m[HERA] ${t('이 탭의 작업 공간 폴더가 없어서, AI 없이 프로젝트 폴더에서 열었습니다.')}\x1b[0m\r\n`)
  spawn(session, spec)
  ptyEvents.emit('changed', info(session))

  return info(session)
}

/**
 * Answers to the program's queries (device attributes, cursor position) come from
 * the renderer's xterm while a tab is on screen, and from the headless copy while
 * it is not: ConPTY waits for its device-attributes answer before the shell starts,
 * so a tab opened in the background would otherwise hang.
 */
function answerQueries(session: Session) {
  session.term.onData(data => {
    if (session.attached || session.attaching || !session.pty) return

    try {
      session.pty.write(data)
    } catch {
      // exiting
    }
  })
}

function trackCwd(session: Session) {
  const remember = (value: string | null) => {
    if (value) session.liveCwd = value

    return false
  }

  session.term.parser.registerOscHandler(7, data => remember(cwdFromOsc(7, data)))
  session.term.parser.registerOscHandler(9, data => remember(cwdFromOsc(9, data)))
}

function spawn(session: Session, spec: ShellSpec) {
  const agent = agentById(session.agentId)
  const lanes = getConfig().settings.lanes
  const env = shellEnv({
    ...spec.env,
    ...profileEnv(agent, session.profileId),
    ...(session.launchReq.env || {}),
    // Tells the lanes plugin to open its lanes as HERA tabs (`hera host`) instead of new windows.
    // Not tied to "Use lanes in HERA": a fresh install has that off, and a lane still belongs in a tab.
    ...(lanes.host === 'hera' ? { HERA_LANES_HOST: '1' } : {}),
    HERA_SESSION_ID: session.id,
    HERA_SESSION_NAME: session.name,
    HERA_PROJECT: projectById(session.projectId)?.name || '',
    HERA_HOME: path.dirname(dataPath('config.json'))
  })

  let pty: nodePty.IPty
  const options = { cols: session.cols, rows: session.rows, cwd: session.cwd, env, name: 'xterm-256color' }
  session.shellLine = { command: spec.command, args: spec.args, env }

  try {
    // The ConPTY HERA ships (Windows Terminal's) passes mouse modes, focus and the
    // like through to the terminal; the system one swallows mouse modes, so the wheel
    // in a full-screen TUI (Claude Code, vim) arrives as arrow keys. The system one
    // stays the fallback when that DLL is missing or refuses to start.
    if (isWin && getConfig().settings.conptyDll) {
      try {
        pty = nodePty.spawn(spec.command, spec.args, { ...options, useConptyDll: true })
      } catch {
        pty = nodePty.spawn(spec.command, spec.args, { ...options, useConptyDll: false })
      }
    } else {
      pty = nodePty.spawn(spec.command, spec.args, isWin ? { ...options, useConptyDll: false } : options)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    session.term.write(`\r\n\x1b[31m[HERA] ${t('셸을 시작하지 못했습니다: {reason}', { reason: message })}\x1b[0m\r\n`)
    session.status = 'exited'
    session.exitCode = -1

    return
  }

  session.pty = pty
  session.pid = pty.pid
  session.dormant = false

  // Ignore a pty that was replaced (revive) or a session that was closed: a
  // late exit would otherwise resurrect a removed tab in the renderer.
  const current = () => sessions.get(session.id) === session && session.pty === pty
  pty.onData(data => {
    if (current()) onPtyData(session, data)
  })
  pty.onExit(({ exitCode }) => {
    if (!current()) return
    session.pty = null
    session.exitCode = exitCode
    clearTimeout(session.bootTimer ?? undefined)
    setStatus(session, 'exited')
    session.term.write(`\r\n\x1b[2m[${t('프로세스 종료 · code {code}', { code: exitCode })}]\x1b[0m\r\n`, () => flushNow(session))
  })

  if (session.bootCommand) {
    // Type the agent command once the shell has printed something (its prompt),
    // with a fallback so a silent shell still gets it.
    session.bootTimer = setTimeout(() => runBoot(session), 2500)
  }
}

function runBoot(session: Session) {
  if (!session.bootCommand || !session.pty) {
    return
  }

  const command = session.bootCommand
  session.bootCommand = null
  clearTimeout(session.bootTimer ?? undefined)
  session.bootTimer = null
  if (session.agentId) session.agentStartedAt = Date.now()

  const { codexOwnServer, codexInline } = getConfig().settings
  const codexFlags = [codexOwnServer && '--no-daemon', codexInline && '--no-alt-screen'].filter((flag): flag is string => Boolean(flag))

  if (session.agentId === 'codex' && codexFlags.length) {
    // See codex.ts: a server of its own keeps the login the tab already had, and the inline
    // screen leaves the wheel to the terminal's scrollback.
    // The probe can take seconds: type only into the same pty, never one a revive started meanwhile.
    const target = session.pty
    void codexBootCommand(command, codexFlags)
      .catch(() => command)
      .then(line => {
        if (session.pty === target && sessions.get(session.id) === session) target.write(`${line}\r`)
      })
    return
  }

  session.pty.write(`${command}\r`)
}

function onPtyData(session: Session, data: string) {
  session.term.write(data)
  session.lastOutputAt = Date.now()
  memoryDirty = true

  if (session.bootCommand) {
    clearTimeout(session.bootTimer ?? undefined)
    // Shell printed its first output; give the profile a moment to settle.
    session.bootTimer = setTimeout(() => runBoot(session), 350)
  }

  if (session.attached || session.attaching) {
    session.pending.push(data)

    if (session.attached && !session.flushTimer) {
      session.flushTimer = setTimeout(() => flushNow(session), FLUSH_MS)
    }
  }

  scheduleStatus(session)
}

function flushNow(session: Session) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }

  if (!session.attached || !session.pending.length) {
    return
  }

  const chunk = session.pending.join('')
  session.pending = []
  ptyEvents.emit('data', session.id, chunk)
}

// ---- status detection

// Throttle, not debounce: agent spinners repaint every ~100 ms, and a debounce
// that restarts on each chunk would never fire while an agent is working.
function scheduleStatus(session: Session) {
  if (session.statusTimer) {
    return
  }

  session.statusTimer = setTimeout(() => {
    session.statusTimer = null
    evaluateStatus(session)
  }, STATUS_DEBOUNCE_MS)
}

export function screenLines(id: string, count?: number, includeScrollback = false): string[] {
  const session = sessions.get(id)

  if (!session) {
    return []
  }

  return readScreen(session, count, includeScrollback)
}

function readScreen(session: Session, count?: number, includeScrollback = false): string[] {
  const buffer = session.term.buffer.active
  const end = buffer.baseY + session.term.rows
  const start = includeScrollback ? Math.max(0, end - (count || end)) : buffer.baseY
  const lines: string[] = []

  for (let y = start; y < end; y++) {
    // ConPTY pads repainted rows with real spaces, not empty cells.
    lines.push((buffer.getLine(y)?.translateToString(true) ?? '').trimEnd())
  }

  // Agent TUIs pad the gap between the transcript and their input box with
  // blank rows; collapse runs so `peek -n` / `ask` show content, not padding.
  const compact: string[] = []

  for (const line of lines) {
    if (!line.trim() && compact.length && !compact[compact.length - 1].trim()) continue
    compact.push(line)
  }

  while (compact.length && !compact[compact.length - 1].trim()) {
    compact.pop()
  }

  while (compact.length && !compact[0].trim()) {
    compact.shift()
  }

  return count ? compact.slice(-count) : compact
}

// Only unmistakable shell prompts clear the detected agent (agent TUIs draw
// their own `>`/`❯` input lines, which must not count).
const PROMPT_LINE = /^(PS [A-Za-z]:\\[^>]*>|[A-Za-z]:\\[^>]*>|\S+@\S+[^$%#]*[$%#])\s*$/

/** The cursor's logical line: a long prompt (deep folder) wraps over several rows. */
function cursorLogicalLine(session: Session): string {
  const buffer = session.term.buffer.active
  let y = buffer.baseY + buffer.cursorY
  const parts: string[] = []

  for (let guard = 0; guard < 12; guard++) {
    const line = buffer.getLine(y)
    if (!line) break
    parts.unshift(line.translateToString(true))
    if (!line.isWrapped || y === 0) break
    y--
  }

  return parts.join('')
}

function evaluateStatus(session: Session) {
  if (session.status === 'exited') {
    return
  }

  const config = getConfig()
  const lines = readScreen(session)
  const tail = lines.slice(-14).join('\n')
  const cursorLine = lines[lines.length - 1] || ''

  // Detect which agent is on screen (user may have typed `codex` in a shell tab).
  let active = session.activeAgentId ? agentById(session.activeAgentId) : null
  const screen = lines.join('\n')

  // A shell prompt on the cursor line wins: the agent's banner can linger in
  // the viewport after it exits.
  const promptLine = cursorLogicalLine(session).trim() || cursorLine.trim()

  if (PROMPT_LINE.test(promptLine) && Date.now() - session.lastOutputAt > 400) {
    active = null
    const promptCwd = cwdFromPrompt(promptLine)
    if (promptCwd) session.liveCwd = promptCwd
  } else if (!active || !safeRegex(active.signature, '')?.test(screen)) {
    const found = config.agents.find(agent => agent.enabled && safeRegex(agent.signature, '')?.test(screen))

    if (found) {
      active = found
    }
  }

  const activeId = active?.id || null

  if (activeId !== session.activeAgentId) {
    session.activeAgentId = activeId

    // An agent typed by hand (or a different one): its conversation is new.
    if (activeId && session.conversation?.agentId !== activeId) {
      session.conversation = null
      session.agentStartedAt = Date.now() - 5000
    }

    if (activeId && session.name.startsWith(`${session.shellKind}-`)) {
      session.name = uniqueName(activeId)
    }

    ptyEvents.emit('changed', info(session))
  }

  const busyRe = safeRegex([active?.busyPattern, GENERIC_BUSY].filter(Boolean).join('|'))
  const approvalRe = safeRegex([active?.approvalPattern, GENERIC_APPROVAL].filter(Boolean).join('|'))
  let next: SessionStatus = 'idle'

  if (approvalRe?.test(tail)) {
    next = 'waiting'
  } else if (busyRe?.test(tail)) {
    next = 'busy'
  }

  setStatus(session, next)

  // Spinners keep emitting output while busy; re-check periodically so a quiet
  // stall still settles to idle.
  if (next === 'busy') {
    scheduleStatus(session)
  }
}

function setStatus(session: Session, next: SessionStatus) {
  const previous = session.status

  if (previous === next) {
    return
  }

  const busyMs = previous === 'busy' && session.busySince ? Date.now() - session.busySince : 0

  if (next === 'busy') {
    session.busySince = Date.now()
  }

  session.status = next
  session.lastStatusChangeAt = Date.now()
  ptyEvents.emit('status', info(session), previous, busyMs)
  ptyEvents.emit('changed', info(session))
}

// ---- renderer attachment (only visible terminals stream)

export function attach(id: string) {
  const session = sessions.get(id)

  if (!session || session.attached || session.attaching) {
    if (session?.attached) {
      // Re-attach requested (renderer remounted): resend a fresh snapshot.
      session.attached = false
      attach(id)
    }

    return
  }

  session.attaching = true
  session.pending = []
  const seq = ++session.attachSeq
  // The empty write's callback fires once everything queued before it has been
  // parsed, so the snapshot and the pending stream line up without gaps.
  session.term.write('', () => {
    if (!session.attaching || session.attachSeq !== seq) {
      return
    }

    const snapshot = session.revive && !session.pty ? session.revive : snapshotOf(session)
    ptyEvents.emit('snapshot', id, snapshot)
    session.attaching = false
    session.attached = true
    flushNow(session)
  })
}

export function detach(id: string) {
  const session = sessions.get(id)

  if (!session) {
    return
  }

  session.attached = false
  session.attaching = false
  session.attachSeq++
  session.pending = []

  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
}

export function detachAll() {
  for (const id of sessions.keys()) {
    detach(id)
  }
}

// ---- input / control

export function write(id: string, data: string): boolean {
  const session = sessions.get(id)

  if (!session?.pty) {
    return false
  }

  session.pty.write(data)

  return true
}

function clampSize(cols: number, rows: number): [number, number] {
  return [Math.min(1000, Math.max(20, Math.floor(cols))), Math.min(500, Math.max(4, Math.floor(rows)))]
}

export function resize(id: string, cols: number, rows: number) {
  const session = sessions.get(id)

  // A zero-size or hidden container can report NaN; node-pty throws on it.
  if (!session || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return
  }

  const [c, r] = clampSize(cols, rows)

  if (c === session.cols && r === session.rows) {
    return
  }

  session.cols = c
  session.rows = r
  session.term.resize(c, r)

  try {
    session.pty?.resize(c, r)
  } catch {
    // process may be exiting
  }
}

/**
 * Type a message into a session as if the user pasted it and pressed Enter.
 * Uses bracketed paste when the app enabled it (keeps newlines intact for agent
 * TUIs); otherwise newlines are flattened so they don't submit early.
 */
export function typeMessage(id: string, text: string, opts: { enter?: boolean; delayMs?: number } = {}): boolean {
  const session = sessions.get(id)

  if (!session?.pty) {
    return false
  }

  const enter = opts.enter !== false
  const bracketed = Boolean((session.term as unknown as { modes?: { bracketedPasteMode?: boolean } }).modes?.bracketedPasteMode)
  // Strip escapes so a message cannot end the paste early and inject keystrokes.
  const clean = text.replace(/\x1b\[20[01]~/g, '').replace(/\x1b/g, '')
  const body = bracketed ? `\x1b[200~${clean}\x1b[201~` : clean.replace(/\r?\n/g, ' ')
  const pty = session.pty
  pty.write(body)

  if (enter) {
    // Agent TUIs treat a burst ending in CR as part of a paste; send Enter apart.
    setTimeout(() => {
      try {
        pty.write('\r')
      } catch {
        // gone
      }

      // A TUI that still took that Enter as a newline leaves the message in its input and
      // stays quiet: press Enter once more. An empty agent input ignores a second Enter.
      if (!session.activeAgentId) return
      const sentAt = Date.now()

      setTimeout(() => {
        if (session.pty !== pty || session.status === 'busy' || session.status === 'waiting' || session.lastOutputAt > sentAt + 800) return

        try {
          pty.write('\r')
        } catch {
          // gone
        }
      }, 4000)
    }, opts.delayMs ?? Math.min(900, 250 + Math.floor(text.length / 8)))
  }

  return true
}

const KEYS: Record<string, string> = {
  enter: '\r',
  esc: '\x1b',
  escape: '\x1b',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  backspace: '\x7f',
  space: ' ',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'ctrl-l': '\x0c',
  'ctrl-r': '\x12',
  'ctrl-u': '\x15'
}

export function sendKeys(id: string, keys: string[]): string[] {
  const session = sessions.get(id)
  const unknown: string[] = []

  if (!session?.pty) {
    return keys
  }

  let sequence = ''

  for (const key of keys) {
    const mapped = KEYS[key.toLowerCase()]

    if (mapped !== undefined) {
      sequence += mapped
    } else if (key.length === 1) {
      sequence += key
    } else {
      unknown.push(key)
    }
  }

  if (sequence) {
    session.pty.write(sequence)
  }

  return unknown
}

export function kill(id: string) {
  const session = sessions.get(id)

  if (!session) {
    return
  }

  sessions.delete(id)
  clearTimeout(session.flushTimer ?? undefined)
  clearTimeout(session.statusTimer ?? undefined)
  clearTimeout(session.bootTimer ?? undefined)

  try {
    session.pty?.kill()
  } catch {
    // already gone
  }

  session.term.dispose()
  ptyEvents.emit('removed', id)
}

export function killAll() {
  for (const id of [...sessions.keys()]) {
    kill(id)
  }
}

/** An open session joins (or leaves) a multi-agent team. */
export function setRole(id: string, role: 'main' | 'helper' | null) {
  const session = sessions.get(id)

  if (session && session.role !== role) {
    session.role = role
    ptyEvents.emit('changed', info(session))
  }
}

/** The session's agent is on screen and quiet at its prompt: a typed message lands in its input. */
export function isReady(id: string): boolean {
  const session = sessions.get(id)

  if (!session?.pty || session.bootCommand || session.dormant || session.status !== 'idle') return false
  if (Date.now() - session.lastOutputAt < 1500) return false

  const agent = agentById(session.activeAgentId)
  if (!agent) return false
  const signature = safeRegex(agent.signature, '')

  return signature ? signature.test(readScreen(session).join('\n')) : Date.now() - session.createdAt > 8000
}

export function rename(id: string, title: string) {
  const session = sessions.get(id)

  if (session && title.trim()) {
    session.title = title.trim().slice(0, 80)
    ptyEvents.emit('changed', info(session))
  }
}

/**
 * Restart a dormant/exited session with the same launch parameters. `resume`
 * reopens the exact conversation when HERA knows it (else the agent's
 * "continue latest"); `auto` is the boot-time restore, which brings an agent
 * back only if one was running when the session was saved.
 */
export function revive(id: string, resume = true, auto = false): SessionInfo | null {
  const session = sessions.get(id)

  if (!session) {
    return null
  }

  if (session.pty) {
    return info(session)
  }

  const config = getConfig()
  const project = projectById(session.projectId)
  const spec = buildShellSpec(project?.shell || config.settings.defaultShell, config.settings.loadShellProfile)
  // A hand-typed agent (shell tab) comes back through its recorded conversation.
  const agent = agentById(session.agentId) || (resume ? agentById(session.conversation?.agentId) : null)
  // Its worktree is gone: a plain terminal in the project folder, never the agent (it would edit the real project).
  const lostCopy = Boolean(session.launchReq.worktreeId) && !isDir(session.cwd)
  if (lostCopy) session.launchReq = { ...session.launchReq, worktreeId: null, cwd: undefined }
  const runAgent = !lostCopy && Boolean(agent) && (!auto || session.agentWasActive) && !(auto && session.launchReq.command?.trim())
  const resumeId = resume && session.conversation?.agentId === agent?.id ? session.conversation?.id || null : null
  // Without a recorded conversation, an agent that supports exact ids starts fresh on
  // auto-restore rather than grabbing whatever conversation in that folder is newest.
  const useContinue = resume && !resumeId && Boolean(agent?.continueArgs) && !(auto && agent?.resumeIdArgs)
  const newId = runAgent && !resumeId && !useContinue && agent?.sessionIdArgs && !session.launchReq.command?.trim() ? newConversationId() : null
  const request = session.agentId ? session.launchReq : { ...session.launchReq, agentId: agent?.id || null, command: undefined }
  session.bootCommand = runAgent ? buildAgentCommand({ ...request, resume: useContinue }, agent, { resumeId, newId }) : null
  if (newId && agent) session.conversation = { agentId: agent.id, id: newId }
  session.revive = undefined
  session.restoredSnapshot = undefined
  session.exitCode = null
  session.status = 'starting'
  session.shell = spec.kind
  session.shellKind = spec.kind
  if (!isDir(session.cwd)) session.cwd = safeCwd(projectById(session.projectId)?.path)
  // Keep the previous screen above; the restarted shell continues below it.
  session.term.write(`\r\n\x1b[2m── ${auto ? t('재부팅/재시작 후 이어서 실행') : t('다시 시작함')} · ${new Date().toLocaleString(locale())} ──\x1b[0m\r\n`)
  if (lostCopy) session.term.write(`\x1b[33m[HERA] ${t('이 탭의 작업 공간 폴더가 없어서, AI 없이 프로젝트 폴더에서 열었습니다.')}\x1b[0m\r\n`)
  spawn(session, spec)

  if (session.attached) {
    session.attached = false
    attach(id)
  }

  ptyEvents.emit('changed', info(session))

  return info(session)
}

// ---- persistence across app restarts

interface SavedSession {
  name: string
  title: string
  projectId: string | null
  cwd: string
  agentId: string | null
  profileId: string | null
  role: 'main' | 'helper' | null
  createdAt: number
  snapshot: string
  launchReq: CreateSessionRequest
  conversation?: ConversationRef | null
  agentWasActive?: boolean
  savedAt?: number
}

const savedFile = () => dataPath('sessions.json')

function profileDir(session: Session): string | null {
  const profile = session.profileId ? getConfig().profiles.find(entry => entry.id === session.profileId) : null

  return profile?.configDir || null
}

/** Refresh which conversation each running agent terminal holds. */
function refreshConversations() {
  const claims: ConversationClaim[] = []

  for (const session of sessions.values()) {
    const agent = session.pty ? agentById(session.activeAgentId) : null
    if (!agent || !agent.resumeIdArgs || !session.agentStartedAt || session.lane) continue
    claims.push({
      key: session.id,
      agent,
      cwd: session.liveCwd && isDir(session.liveCwd) ? session.liveCwd : session.cwd,
      startedAt: session.agentStartedAt,
      configDir: profileDir(session),
      known: session.conversation?.agentId === agent.id ? session.conversation.id : null
    })
  }

  if (!claims.length) return

  try {
    for (const [key, id] of detectConversations(claims)) {
      const session = sessions.get(key)
      // No transcript yet (nothing typed) means there is nothing to resume.
      if (session?.activeAgentId) session.conversation = id ? { agentId: session.activeAgentId, id } : null
    }
  } catch {
    // detection is best effort; keep what we had
  }
}

export function saveSessions() {
  const saved: SavedSession[] = []
  refreshConversations()

  for (const session of sessions.values()) {
    // A lane is the lanes plugin's to reopen (with its name, role and limits); resumed
    // here it would come back as a plain Claude holding the lane's conversation.
    if (session.lane) continue

    let snapshot = session.restoredSnapshot ?? ''

    if (session.restoredSnapshot === undefined) {
      try {
        snapshot = session.serializer.serialize({ scrollback: 200 })
      } catch {
        snapshot = session.revive || ''
      }
    }

    const live = Boolean(session.pty)

    saved.push({
      name: session.name,
      title: session.title,
      projectId: session.projectId,
      cwd: live && session.liveCwd && isDir(session.liveCwd) ? session.liveCwd : session.cwd,
      agentId: session.agentId,
      profileId: session.profileId,
      role: session.role,
      createdAt: session.createdAt,
      snapshot: snapshot.slice(-60_000),
      launchReq: session.launchReq,
      conversation: session.conversation,
      agentWasActive: live ? Boolean(session.activeAgentId) : session.agentWasActive,
      savedAt: Date.now()
    })
  }

  writeJsonAtomic(savedFile(), saved)
  memoryDirty = false
}

// Saved continuously, not only on quit: a crash, power loss or forced reboot
// skips `before-quit`, and the user expects their terminals back anyway.
let memoryDirty = false
let memoryTimer: NodeJS.Timeout | null = null
let memoryDebounce: NodeJS.Timeout | null = null

function saveSoon() {
  memoryDirty = true
  if (memoryDebounce) clearTimeout(memoryDebounce)
  memoryDebounce = setTimeout(() => {
    memoryDebounce = null
    safeSave()
  }, 1500)
}

function safeSave() {
  try {
    saveSessions()
  } catch {
    // disk full / locked: try again on the next tick
  }
}

export function startAutosave(intervalMs = 45_000) {
  stopAutosave()
  ptyEvents.on('changed', saveSoon)
  ptyEvents.on('removed', saveSoon)
  memoryTimer = setInterval(() => memoryDirty && safeSave(), intervalMs)
}

/** Before quitting: tearing sessions down must not overwrite the saved set with an empty one. */
export function stopAutosave() {
  ptyEvents.off('changed', saveSoon)
  ptyEvents.off('removed', saveSoon)
  if (memoryTimer) clearInterval(memoryTimer)
  if (memoryDebounce) clearTimeout(memoryDebounce)
  memoryTimer = null
  memoryDebounce = null
}

export function restoreSessions() {
  const saved = readJson<SavedSession[]>(savedFile()) || []
  const config = getConfig()

  for (const entry of saved) {
    const id = newId('s_')
    const { term, serializer } = headlessTerminal(120, 32, config.settings.scrollback)
    const when = entry.savedAt ? ` · ${t('{when} 저장', { when: new Date(entry.savedAt).toLocaleString(locale()) })}` : ''
    const revive = `${entry.snapshot}\r\n\x1b[2m── ${t('이전 실행에서 복원된 화면')}${when} ──\x1b[0m\r\n`
    term.write(revive)
    const projectId = entry.projectId && config.projects.some(project => project.id === entry.projectId) ? entry.projectId : null
    const session: Session = {
      id,
      // Keep the old handle so agents' `hera send <name>` habits survive a restart.
      name: entry.name && ![...sessions.values()].some(other => other.name === entry.name) ? entry.name : uniqueName(entry.agentId || 'shell'),
      title: entry.title,
      projectId,
      cwd: isDir(entry.cwd) ? entry.cwd : safeCwd(projectById(projectId)?.path),
      shell: 'restored',
      pid: 0,
      agentId: entry.agentId,
      activeAgentId: null,
      role: entry.role,
      profileId: entry.profileId,
      status: 'exited',
      createdAt: entry.createdAt,
      lastOutputAt: 0,
      lastStatusChangeAt: Date.now(),
      exitCode: null,
      cols: 120,
      rows: 32,
      dormant: true,
      pty: null,
      term,
      serializer,
      shellKind: 'other',
      attached: false,
      attaching: false,
      attachSeq: 0,
      pending: [],
      flushTimer: null,
      statusTimer: null,
      bootCommand: null,
      bootTimer: null,
      busySince: 0,
      launchReq: entry.launchReq,
      revive,
      restoredSnapshot: entry.snapshot,
      conversation: entry.conversation || null,
      agentStartedAt: 0,
      agentWasActive: Boolean(entry.agentWasActive),
      liveCwd: null
    }
    trackCwd(session)
    answerQueries(session)
    sessions.set(id, session)
  }
}

/**
 * Boot-time restore: bring saved terminals back running, a few at a time.
 * Shells reopen in their last folder; agents reopen their own conversation.
 * Project commands (dev servers, scripts) are left for the user to restart.
 */
export function resumeRestored(staggerMs = 400) {
  const dormant = [...sessions.values()].filter(session => session.dormant && !session.pty && !session.launchReq.command?.trim())

  dormant.forEach((session, index) => {
    setTimeout(() => {
      if (sessions.get(session.id) === session && !session.pty) revive(session.id, true, true)
    }, index * staggerMs)
  })

  return dormant.length
}

export function liveCount(): number {
  let count = 0

  for (const session of sessions.values()) {
    if (session.pty) count++
  }

  return count
}
