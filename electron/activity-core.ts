// Live activity, the reading half: follows one agent conversation's transcript
// (and the transcripts of the subagents it starts) and keeps what activity.ts
// shows: files read and changed (and what changed in them), the agent's own plan, tokens per model.
// Plain Node, no Electron, so it can be run against real transcripts on its own.
import fs from 'node:fs'
import path from 'node:path'

import type { ActivityPlan, ActivityRun, DiffHunk, FileTouchKind } from '../shared/types'
import { clip } from '../shared/util'

import { claudeCost } from './prices'

const isWin = process.platform === 'win32'

/** A read shows as "looking at it" this long. */
export const READ_LIVE_MS = 90_000
/** A change stays listed this long after the work that made it is over. */
export const EDIT_LIVE_MS = 5 * 60_000
/** A finished piece of work stays on screen this long. */
export const DONE_KEEP_MS = 30 * 60_000
/** A subagent whose transcript has been quiet this long (and whose result came back) is done. */
export const SUB_QUIET_MS = 30_000
/** On first sight of a long conversation, only its end is read. */
const CATCH_UP_BYTES = 2 * 1024 * 1024
/** Most bytes read from one transcript per tick; the rest waits for the next one. */
const CHUNK_BYTES = 4 * 1024 * 1024

interface Tally {
  input: number
  output: number
  cacheWrite: number
  cacheWrite1h: number
  cacheRead: number
  messages: number
}

const emptyTally = (): Tally => ({ input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 0 })

interface Touch {
  kind: FileTouchKind
  at: number
}

/** What one piece of work changed in one file, from the CLI's own patch. */
export interface Change {
  path: string
  added: number
  removed: number
  /** The work made the file (Claude Write of a new file, Codex "Add File"). */
  created: boolean
  deleted: boolean
  hunks: DiffHunk[]
  /** Hunks past CHANGE_LINES were counted but not kept. */
  truncated: boolean
  at: number
}

// Diff lines and characters kept per file and piece of work; the counts go on past them.
const CHANGE_LINES = 4000
const CHANGE_CHARS = 400_000
// A minified file or a data blob is one huge line: shown clipped.
const LINE_CHARS = 2000

interface Spawn {
  prompt: string
  label: string
  task: string
  at: number
  done: boolean
}

export interface Run {
  id: string
  sessionId: string
  parentId: string | null
  label: string
  agentId: string | null
  /** Tab or subagent folder, for paths a CLI writes relative to it. */
  cwd: string
  task: string
  startedAt: number
  updatedAt: number
  plan: ActivityPlan | null
  /** Claude Code task tools (TaskCreate / TaskUpdate), by task id. */
  tasks: Map<string, { status: string; subject: string }>
  /** Last task id handed out. */
  taskSeq: number
  byModel: Map<string, Tally>
  tools: number
  edited: Set<string>
  touches: Map<string, Touch & { path: string }>
  /** What this piece of work changed, per file. */
  changes: Map<string, Change>
  /** Claude: message ids already counted (each content block repeats the usage). */
  seen: Set<string>
  /** Claude: subagents this run started, by tool_use id. */
  spawns: Map<string, Spawn>
  /** Codex: cumulative token totals now, and when this work began. */
  codexNow: { input: number; cached: number; output: number } | null
  codexBase: { input: number; cached: number; output: number } | null
  codexModel: string | null
  /** The transcript was read from its first line (so totals before the first count are zero). */
  fromStart: boolean
}

interface Tail {
  file: string
  offset: number
  /** Inside a line longer than one chunk: drop bytes until its end. */
  skipping: boolean
}

export interface Sub {
  tail: Tail
  run: Run
  /** tool_use id of the parent's Task / Agent call, once matched. */
  spawnId: string | null
  mtime: number
  /** From Claude Code's `agent-<id>.meta.json`, when it writes one. */
  finished: boolean | null
}

/** One conversation followed: the tab's own run and its subagents'. */
export interface Conversation {
  provider: 'claude' | 'codex'
  tail: Tail
  run: Run
  subs: Map<string, Sub>
  subsCheckedAt: number
}

export function newRun(id: string, sessionId: string, parentId: string | null, label: string, agentId: string | null, cwd: string): Run {
  return {
    id,
    sessionId,
    parentId,
    label,
    agentId,
    cwd,
    task: '',
    startedAt: 0,
    updatedAt: 0,
    plan: null,
    tasks: new Map(),
    taskSeq: 0,
    byModel: new Map(),
    tools: 0,
    edited: new Set(),
    touches: new Map(),
    changes: new Map(),
    seen: new Set(),
    spawns: new Map(),
    codexNow: null,
    codexBase: null,
    codexModel: null,
    fromStart: false
  }
}

/** A new request: what came before belongs to the previous piece of work. */
function beginWork(run: Run, task: string, at: number) {
  run.task = clip(task.replace(/\s+/g, ' ').trim(), 160)
  run.startedAt = at
  run.updatedAt = at
  run.plan = null
  run.tasks.clear()
  run.taskSeq = 0
  run.byModel.clear()
  run.tools = 0
  run.edited.clear()
  run.changes.clear()
  run.spawns.clear()
  run.codexBase = run.codexNow || (run.fromStart ? { input: 0, cached: 0, output: 0 } : null)
}

// ---- paths

const keyOf = (file: string) => (isWin ? file.toLowerCase() : file)

function touch(run: Run, file: string, kind: FileTouchKind, at: number) {
  if (!file || file.length > 1024) return
  const abs = path.resolve(run.cwd, file)
  const key = keyOf(abs)
  const previous = run.touches.get(key)
  // A read right after a change does not make the file "only looked at" again.
  const strongest = previous && previous.kind === 'edit' && kind === 'read' && at - previous.at < READ_LIVE_MS ? 'edit' : kind
  run.touches.set(key, { path: abs, kind: strongest, at: Math.max(at, previous?.at || 0) })
  if (kind === 'edit') run.edited.add(key)
  if (run.touches.size > 400) {
    const oldest = [...run.touches.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100)
    for (const [entry] of oldest) run.touches.delete(entry)
  }
}

function recordChange(run: Run, file: string, at: number, hunks: DiffHunk[], flags: { created?: boolean; deleted?: boolean } = {}) {
  if (!file || file.length > 1024) return
  const abs = path.resolve(run.cwd, file)
  const key = keyOf(abs)
  const fresh = !run.changes.has(key)
  const change = run.changes.get(key) || { path: abs, added: 0, removed: 0, created: false, deleted: false, hunks: [], truncated: false, at }
  let kept = change.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  let chars = change.hunks.reduce((sum, hunk) => hunk.lines.reduce((total, line) => total + line.length, sum), 0)

  for (const hunk of hunks) {
    let size = 0
    for (const line of hunk.lines) {
      if (line.startsWith('+')) change.added++
      else if (line.startsWith('-')) change.removed++
      size += Math.min(line.length, LINE_CHARS + 1)
    }
    if (kept + hunk.lines.length <= CHANGE_LINES && chars + size <= CHANGE_CHARS) {
      change.hunks.push({ ...hunk, lines: hunk.lines.map(line => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line)) })
      kept += hunk.lines.length
      chars += size
    } else change.truncated = true
  }

  // Made and changed again in the same work is still a new file; deleted afterwards is gone.
  if (flags.created && fresh) change.created = true
  if (flags.deleted) change.deleted = true
  change.at = at
  run.changes.set(key, change)
  if (run.changes.size > 200) {
    const oldest = [...run.changes.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) run.changes.delete(oldest[0])
  }
}

// ---- shell commands (Codex reads files through the shell, and so does Claude now and then)

const SHELLS = /^(?:bash|sh|zsh|fish|pwsh|powershell|cmd)(?:\.exe)?$/i
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'sed', 'awk', 'grep', 'rg', 'wc', 'bat', 'type', 'get-content', 'gc', 'select-string', 'diff', 'jq'])
const WRITERS = new Set(['touch', 'tee', 'set-content', 'add-content', 'out-file'])

/** Words of one shell command line, quotes removed (good enough to find file arguments). */
function words(line: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let match = re.exec(line)

  while (match && out.length < 40) {
    out.push(match[1] ?? match[2] ?? match[3])
    match = re.exec(line)
  }

  return out
}

/** `file` is `root` or below it (path text only, nothing touched on disk). */
function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file)

  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** A network or device path (`\\host\share`, `//host/x`, `\\?\…`): asking the disk about it can block for many seconds. */
const REMOTE = /^(?:\\\\|\/\/)/

/**
 * Paths in a transcript are only text an agent wrote. Only a local file inside
 * the tab's folder is looked up: a share or a drive that went away must never
 * stall the app, and nothing outside the folder is shown anyway.
 */
function isFileIn(file: string, root: string): boolean {
  if (REMOTE.test(file) || REMOTE.test(root) || !inside(file, root)) return false

  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function shellTouches(run: Run, script: string, cwd: string, at: number) {
  if (!script || script.length > 8000) return
  const root = run.cwd

  for (const segment of script.split(/&&|\|\||;|\||\n/)) {
    const parts = words(segment.trim())
    if (!parts.length) continue
    const command = path.basename(parts[0]).toLowerCase().replace(/\.exe$/, '')

    // `cd app && sed -n 1,80p src/x.ts`: later paths are relative to the new folder.
    if ((command === 'cd' || command === 'set-location' || command === 'pushd') && parts[1] && !parts[1].startsWith('-')) {
      cwd = path.resolve(cwd, parts[1].replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'))
      continue
    }

    const inPlace = (command === 'sed' && parts.some(part => /^-i/.test(part))) || (command === 'perl' && parts.some(part => /^-\w*i/.test(part)))
    const kind: FileTouchKind | null = inPlace || WRITERS.has(command) ? 'edit' : READERS.has(command) ? 'read' : null

    for (let index = 1; index < parts.length; index++) {
      const part = parts[index]
      const redirect = /^>>?$/.test(part) ? parts[index + 1] : /^>>?(.+)/.exec(part)?.[1]

      // The line is read when the call is made, maybe before the command ran: a file it writes may not exist yet.
      if (redirect && !/^&|^\/dev\/null$|^nul$|[*?$`]/i.test(redirect)) {
        const target = path.resolve(cwd, redirect)
        if (!REMOTE.test(target) && inside(target, root)) touch(run, target, 'edit', at)
        continue
      }

      if (!kind || part.startsWith('-') || /[*?$`]/.test(part)) continue
      const target = path.resolve(cwd, part)
      if (kind === 'edit' ? !REMOTE.test(target) && inside(target, root) && /\.\w+$/.test(target) : isFileIn(target, root)) touch(run, target, kind, at)
    }
  }
}

/** `*** Update File: x` headers of an apply_patch body. */
function patchTouches(run: Run, patch: string, cwd: string, at: number) {
  const re = /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm
  let match = re.exec(patch)

  while (match) {
    touch(run, path.resolve(cwd, (match[1] || match[2]).trim()), 'edit', at)
    match = re.exec(patch)
  }

  patchChanges(run, patch, cwd, at)
}

/**
 * A Codex patch (`*** Update File: x`, `@@`, then `+` / `-` / ` ` lines). It names no line
 * numbers, so its hunks carry none (0).
 */
function patchChanges(run: Run, patch: string, cwd: string, at: number) {
  let file: string | null = null
  let mode: 'add' | 'update' | 'delete' = 'update'
  let hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  const flush = () => {
    if (file) recordChange(run, path.resolve(cwd, file), at, hunks, { created: mode === 'add', deleted: mode === 'delete' })
    hunks = []
    hunk = null
  }

  for (const raw of patch.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line)
    if (header) {
      flush()
      file = header[2].trim()
      mode = header[1] === 'Add' ? 'add' : header[1] === 'Delete' ? 'delete' : 'update'
      continue
    }
    const moved = /^\*\*\* Move to: (.+)$/.exec(line)
    if (moved) {
      file = moved[1].trim()
      continue
    }
    if (!file || line.startsWith('***')) continue
    if (line.startsWith('@@')) {
      hunk = { oldStart: 0, newStart: 0, lines: [] }
      hunks.push(hunk)
    } else if (/^[+\- ]/.test(line)) {
      if (!hunk) {
        hunk = { oldStart: 0, newStart: mode === 'add' ? 1 : 0, lines: [] }
        hunks.push(hunk)
      }
      hunk.lines.push(line)
    }
  }
  flush()
}

// ---- Claude Code

type Json = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const timeOf = (line: Json) => Date.parse(str(line.timestamp)) || Date.now()

/** Context the CLI adds around a prompt, not something the user asked. */
const ADDED_CONTEXT = /<system-reminder>[\s\S]*?<\/system-reminder>/g

function userText(content: unknown): string | null {
  const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((part: Json) => part && (part.type === 'text' || part.type === 'input_text')).map((part: Json) => str(part.text)) : []
  const texts = parts.map(text => text.replace(ADDED_CONTEXT, '').trim()).filter(Boolean)

  return texts.length ? texts.join('\n') : null
}

/** Claude Code's own notes in the user role are not requests. */
const NOT_A_REQUEST = /^\s*<(?:local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification|environment_context)>|^\s*Caveat: |^\s*\[Request interrupted by user/

/** A slash command with arguments is a request (`/plan add login`); a bare one (`/clear`) is not. */
function requestText(text: string | null): string | null {
  if (!text || !text.trim() || NOT_A_REQUEST.test(text)) return null
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (!command) return /^\s*<command-message>/.test(text) ? null : text
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()

  return args ? `${command[1].trim()} ${args}` : null
}

function todoPlan(todos: unknown): ActivityPlan | null {
  if (!Array.isArray(todos) || !todos.length) return null
  const done = todos.filter((todo: Json) => todo?.status === 'completed').length
  const current = todos.find((todo: Json) => todo?.status === 'in_progress') as Json | undefined

  return { done, total: todos.length, current: current ? clip(str(current.activeForm) || str(current.content), 120) : null }
}

function taskPlan(run: Run): ActivityPlan | null {
  const tasks = [...run.tasks.values()]
  if (!tasks.length) return null
  const current = tasks.find(task => task.status === 'in_progress')

  return { done: tasks.filter(task => task.status === 'completed').length, total: tasks.length, current: current ? clip(current.subject, 120) : null }
}

function claudeTool(run: Run, tool: Json, at: number) {
  const name = str(tool.name)
  const input = (tool.input || {}) as Json
  run.tools++

  if (name === 'Read' || name === 'NotebookRead') touch(run, str(input.file_path) || str(input.notebook_path), 'read', at)
  else if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') touch(run, str(input.file_path) || str(input.notebook_path), 'edit', at)
  else if (name === 'Grep' && input.path && isFileIn(path.resolve(run.cwd, str(input.path)), run.cwd)) touch(run, str(input.path), 'read', at)
  else if (name === 'Bash' || name === 'PowerShell') shellTouches(run, str(input.command), run.cwd, at)
  else if (name === 'TodoWrite') run.plan = todoPlan(input.todos)
  else if (name === 'TaskCreate') {
    // Claude Code numbers tasks 1, 2, 3… and never reuses a number after a delete.
    run.tasks.set(String(++run.taskSeq), { status: 'pending', subject: str(input.activeForm) || str(input.subject) })
    run.plan = taskPlan(run)
  } else if (name === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    const task = run.tasks.get(id)
    if (task && input.status === 'deleted') run.tasks.delete(id)
    else if (task && typeof input.status === 'string') task.status = input.status
    run.plan = taskPlan(run)
  } else if ((name === 'Task' || name === 'Agent') && typeof tool.id === 'string') {
    run.spawns.set(tool.id, {
      prompt: str(input.prompt),
      label: str(input.subagent_type) || str(input.name) || 'subagent',
      task: str(input.description) || str(input.prompt),
      at,
      done: false
    })
  }
}

/**
 * What an Edit / MultiEdit / Write did, from its result: `structuredPatch` hunks (lines
 * prefixed ' ', '-', '+'), or a new file's whole content.
 */
function claudeChange(run: Run, result: Json, at: number) {
  const file = str(result.filePath)
  if (!file) return

  if (result.type === 'create' && typeof result.content === 'string') {
    const lines = result.content.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    recordChange(run, file, at, [{ oldStart: 0, newStart: 1, lines: lines.map(line => `+${line}`) }], { created: true })
    return
  }

  if (!Array.isArray(result.structuredPatch)) return
  const hunks = (result.structuredPatch as Json[]).map(hunk => ({
    oldStart: Number(hunk?.oldStart) || 0,
    newStart: Number(hunk?.newStart) || 0,
    lines: Array.isArray(hunk?.lines) ? (hunk.lines as unknown[]).filter((line): line is string => typeof line === 'string') : []
  }))
  if (hunks.length) recordChange(run, file, at, hunks)
}

function claudeLine(run: Run, line: Json, sub: boolean) {
  if (!sub && line.isSidechain === true) return
  const at = timeOf(line)
  const message = (line.message || {}) as Json

  if (line.type === 'user') {
    const content = message.content

    if (Array.isArray(content) && content.some((part: Json) => part?.type === 'tool_result')) {
      // A background subagent answers at once ("async_launched"); its own transcript tells when it really ends.
      const result = (line.toolUseResult || {}) as Json
      const launched = result.isAsync === true || result.status === 'async_launched'

      for (const part of content as Json[]) {
        const spawn = part?.type === 'tool_result' ? run.spawns.get(str(part.tool_use_id)) : undefined
        if (spawn && !launched) spawn.done = true
      }
      claudeChange(run, result, at)
      run.updatedAt = at
      return
    }

    // The summary written after a /compact continues the work, it does not start one.
    if (line.isMeta === true || line.isCompactSummary === true || sub) return
    const text = userText(content)
    const request = requestText(text)
    if (request) beginWork(run, request, at)
    return
  }

  if (line.type !== 'assistant') return
  if (!run.startedAt) beginWork(run, sub ? run.task : '', at)
  run.updatedAt = at
  const model = str(message.model)
  const key = `${str(message.id)}:${str(line.requestId)}`

  if (model && model !== '<synthetic>' && message.usage && !run.seen.has(key)) {
    run.seen.add(key)
    // Forget the oldest half, not all: a message seen again after a clear would be counted twice.
    if (run.seen.size > 5000) [...run.seen].slice(0, 2500).forEach(entry => run.seen.delete(entry))
    const usage = message.usage as Json
    const creation = (usage.cache_creation || {}) as Json
    const write1h = Number(creation.ephemeral_1h_input_tokens) || 0
    const tally = run.byModel.get(model) || emptyTally()
    tally.input += Number(usage.input_tokens) || 0
    tally.output += Number(usage.output_tokens) || 0
    tally.cacheWrite += Math.max(0, (Number(usage.cache_creation_input_tokens) || 0) - write1h)
    tally.cacheWrite1h += write1h
    tally.cacheRead += Number(usage.cache_read_input_tokens) || 0
    tally.messages++
    run.byModel.set(model, tally)
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content as Json[]) {
      if (part?.type === 'tool_use') claudeTool(run, part, at)
    }
  }
}

// ---- Codex

function codexArgs(payload: Json): Json {
  if (typeof payload.arguments === 'string') {
    try {
      return JSON.parse(payload.arguments) as Json
    } catch {
      return {}
    }
  }

  return (payload.arguments || {}) as Json
}

/** The script a Codex shell call runs (`["bash", "-lc", "…"]`, a plain string, or `cmd`). */
function codexScript(args: Json): string {
  const command = args.command ?? args.cmd

  if (typeof command === 'string') return command
  if (!Array.isArray(command)) return ''
  const parts = command.map(String)

  return parts.length >= 3 && SHELLS.test(path.basename(parts[0])) ? parts[parts.length - 1] : parts.join(' ')
}

/** The JS string literal that starts at `at` ('"', "'" or '`'), unescaped. */
function jsString(code: string, at: number): string | null {
  const quote = code[at]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  let out = ''

  for (let index = at + 1; index < code.length; index++) {
    const char = code[index]
    if (char === quote) return out
    if (char !== '\\') {
      out += char
      continue
    }

    const next = code[++index]
    if (next === 'n') out += '\n'
    else if (next === 't') out += '\t'
    else if (next === 'r') out += '\r'
    else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(code.slice(index + 1, index + 5))) {
      out += String.fromCharCode(parseInt(code.slice(index + 1, index + 5), 16))
      index += 4
    } else out += next ?? ''
  }

  return null
}

/** The string value of `key: "…"` inside the call that starts at `from`. */
function jsKey(code: string, from: number, to: number, key: string): string | null {
  const match = new RegExp(`["']?\\b${key}["']?\\s*:\\s*`).exec(code.slice(from, Math.min(to, from + 20_000)))

  return match ? jsString(code, from + match.index + match[0].length) : null
}

/**
 * Codex's code mode: one `exec` call runs JavaScript that calls the real tools,
 * `tools.exec_command({cmd})`, `tools.apply_patch("*** Begin Patch…")`, `tools.view_image({path})`.
 */
function codexCode(run: Run, code: string, at: number) {
  const calls = [...code.matchAll(/tools\.([A-Za-z_]\w*)\(\s*/g)]

  calls.forEach((match, index) => {
    const name = match[1]
    const start = (match.index ?? 0) + match[0].length
    // A call's arguments end where the next call begins (keys of the next one are not this one's).
    const end = calls[index + 1]?.index ?? code.length
    run.tools++

    if (name === 'apply_patch') patchTouches(run, jsString(code, start) || '', run.cwd, at)
    else if (name === 'exec_command' || name === 'shell') {
      const workdir = jsKey(code, start, end, 'workdir')
      shellTouches(run, jsKey(code, start, end, 'cmd') || jsKey(code, start, end, 'command') || '', workdir ? path.resolve(run.cwd, workdir) : run.cwd, at)
    } else if (name === 'view_image' || name === 'read_file') {
      const file = jsKey(code, start, end, 'path') || jsKey(code, start, end, 'file_path')
      if (file) touch(run, file, 'read', at)
    }
  })
}

function codexLine(run: Run, line: Json) {
  const at = timeOf(line)
  const payload = (line.payload || {}) as Json
  const type = str(payload.type)

  if (line.type === 'turn_context' || line.type === 'session_meta') {
    if (str(payload.model)) run.codexModel = str(payload.model)
    if (str(payload.cwd)) run.cwd = str(payload.cwd)
    return
  }

  if (line.type === 'event_msg') {
    const item = (payload.item || {}) as Json
    if (type === 'user_message' && str(payload.message).trim()) beginWork(run, str(payload.message), at)
    else if (type === 'item_completed' && item.type === 'UserMessage') {
      const text = userText(item.content)
      if (text?.trim()) beginWork(run, text, at)
    } else if (type === 'thread_settings_applied') {
      const model = str(((payload.thread_settings || {}) as Json).model)
      if (model) run.codexModel = model
    } else if (type === 'token_count') {
      const total = ((payload.info || {}) as Json).total_token_usage as Json | undefined
      if (!total) return
      run.codexNow = { input: Number(total.input_tokens) || 0, cached: Number(total.cached_input_tokens) || 0, output: Number(total.output_tokens) || 0 }
      // Joined mid-conversation: count from the first total seen.
      run.codexBase ||= run.codexNow
      run.updatedAt = at
    }
    return
  }

  if (line.type !== 'response_item') return

  if (type === 'function_call' || type === 'custom_tool_call' || type === 'local_shell_call') {
    const name = str(payload.name)
    // Polling a running cell is not another step of the work.
    if (name === 'wait') return
    if (!run.startedAt) beginWork(run, '', at)
    run.updatedAt = at

    if (type === 'custom_tool_call' && name === 'exec') {
      codexCode(run, str(payload.input), at)
      return
    }

    run.tools++
    const args = type === 'local_shell_call' ? ((payload.action || {}) as Json) : codexArgs(payload)
    const cwd = str(args.workdir) || run.cwd

    if (name === 'apply_patch') patchTouches(run, str(payload.input) || str(args.input) || str(args.patch), cwd, at)
    else if (name === 'update_plan' && Array.isArray(args.plan)) {
      const plan = args.plan as Json[]
      const current = plan.find(step => step?.status === 'in_progress')
      run.plan = plan.length ? { done: plan.filter(step => step?.status === 'completed').length, total: plan.length, current: current ? clip(str(current.step), 120) : null } : null
    } else {
      const script = codexScript(args)
      if (/^\s*apply_patch\b/.test(script) || script.includes('*** Begin Patch')) patchTouches(run, script, cwd, at)
      else shellTouches(run, script, cwd, at)
    }
  }
}

// ---- reading

function openTail(file: string): Tail {
  let offset = 0

  try {
    const size = fs.statSync(file).size
    if (size > CATCH_UP_BYTES) offset = size - CATCH_UP_BYTES
    return { file, offset, skipping: offset > 0 }
  } catch {
    return { file, offset, skipping: false }
  }
}

/** New complete lines since the last call. */
function readLines(tail: Tail): string[] {
  let size = 0

  try {
    size = fs.statSync(tail.file).size
  } catch {
    return []
  }

  // Rewritten from scratch (compacted, replaced): start over.
  if (size < tail.offset) {
    tail.offset = 0
    tail.skipping = false
  }

  if (size === tail.offset) return []

  const length = Math.min(size - tail.offset, CHUNK_BYTES)
  const buffer = Buffer.alloc(length)
  let read = 0

  try {
    const fd = fs.openSync(tail.file, 'r')
    try {
      read = fs.readSync(fd, buffer, 0, length, tail.offset)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }

  const chunk = buffer.subarray(0, read)
  let start = 0

  if (tail.skipping) {
    const newline = chunk.indexOf(0x0a)
    if (newline < 0) {
      tail.offset += read
      return []
    }
    start = newline + 1
    tail.skipping = false
  }

  const end = chunk.lastIndexOf(0x0a)

  if (end < start) {
    // One line longer than a chunk (a huge tool result): nothing in it is needed.
    if (read === CHUNK_BYTES) {
      tail.offset += read
      tail.skipping = true
    }
    return []
  }

  tail.offset += end + 1

  return chunk.subarray(start, end).toString('utf8').split('\n')
}

function feed(run: Run, lines: string[], provider: 'claude' | 'codex', sub: boolean) {
  for (const raw of lines) {
    if (!raw || raw.length < 20) continue
    // Tool results (file contents, command output) are most of a transcript and carry nothing needed past their ids.
    if (provider === 'claude' && raw.length > 200_000 && raw.includes('"tool_use_id"') && !raw.includes('"type":"assistant"')) {
      const re = /"tool_use_id":"([^"]+)"/g
      let match = re.exec(raw)
      while (match) {
        const spawn = run.spawns.get(match[1])
        if (spawn) spawn.done = true
        match = re.exec(raw)
      }
      continue
    }
    if (provider === 'codex' && raw.length > 200_000 && !raw.includes('"type":"custom_tool_call",') && !raw.includes('"type":"function_call",')) continue

    let line: Json

    try {
      line = JSON.parse(raw) as Json
    } catch {
      continue
    }

    if (provider === 'claude') claudeLine(run, line, sub)
    else codexLine(run, line)
  }
}

// ---- Claude subagents: <conversation>/subagents/agent-<id>.jsonl next to the main transcript

function firstPrompt(file: string): string {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const head = Buffer.alloc(65_536)
      const text = head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)).toString('utf8')
      const first = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : undefined)
      const line = JSON.parse(first) as Json

      return userText(((line.message || {}) as Json).content) || ''
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function followSubagents(entry: Conversation, now: number) {
  if (entry.provider !== 'claude' || !entry.run.startedAt) return
  const run = entry.run
  const open =
    [...run.spawns.values()].some(spawn => !spawn.done && now - spawn.at < 10 * 60_000) ||
    [...entry.subs.values()].some(sub => (sub.finished === false && now - sub.mtime < 10 * 60_000) || now - sub.mtime < SUB_QUIET_MS)
  // Looked for while one is expected or running, and now and then in case one was missed.
  if (!open && now - entry.subsCheckedAt < 15_000) return
  if (now - entry.subsCheckedAt < 1500) return
  entry.subsCheckedAt = now

  const dir = path.join(entry.tail.file.replace(/\.jsonl$/, ''), 'subagents')
  let names: string[] = []

  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'))
  } catch {
    return
  }

  for (const name of names) {
    const file = path.join(dir, name)
    let mtime = 0
    let size = 0

    try {
      const stat = fs.statSync(file)
      mtime = stat.mtimeMs
      size = stat.size
    } catch {
      continue
    }

    let sub = entry.subs.get(name)
    if (!sub && mtime < run.startedAt - 5000) continue // a subagent of earlier work
    const meta = sub?.finished ? null : readMeta(file)

    if (!sub) {
      const prompt = firstPrompt(file)
      const taken = new Set([...entry.subs.values()].map(other => other.spawnId))
      const byMeta = meta?.toolUseId ? run.spawns.get(meta.toolUseId) : undefined
      const match: [string, Spawn] | undefined =
        meta?.toolUseId && byMeta
          ? [meta.toolUseId, byMeta]
          : [...run.spawns.entries()].find(([id, spawn]) => !taken.has(id) && spawn.prompt && prompt && (spawn.prompt === prompt || prompt.startsWith(spawn.prompt.slice(0, 200))))
      const spawn = match?.[1]
      const id = `${run.id}/${name.replace(/^agent-|\.jsonl$/g, '')}`
      const subRun = newRun(id, run.sessionId, run.id, meta?.agentType || spawn?.label || 'subagent', run.agentId, run.cwd)
      subRun.task = clip((meta?.description || spawn?.task || prompt).replace(/\s+/g, ' ').trim(), 160)
      subRun.startedAt = spawn?.at || mtime
      sub = { tail: { file, offset: 0, skipping: false }, run: subRun, spawnId: match?.[0] || meta?.toolUseId || null, mtime, finished: null }
      entry.subs.set(name, sub)
    }

    if (meta && typeof meta.finished === 'boolean') sub.finished = meta.finished
    const spawn = sub.spawnId ? run.spawns.get(sub.spawnId) : undefined
    if (spawn && sub.finished) spawn.done = true

    // Also while unread bytes are left: one read takes at most a chunk, and a finished subagent's file no longer changes.
    if (mtime !== sub.mtime || sub.tail.offset < size) {
      sub.mtime = mtime
      feed(sub.run, readLines(sub.tail), 'claude', true)
    }
  }
}

interface SubMeta {
  agentType?: string
  description?: string
  toolUseId?: string
  finished?: boolean
}

function readMeta(file: string): SubMeta | null {
  try {
    return JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as SubMeta
  } catch {
    return null
  }
}

// ---- summaries

function tokensOf(tally: Tally) {
  return tally.input + tally.output + tally.cacheWrite + tally.cacheWrite1h + tally.cacheRead
}

export function summarize(run: Run, state: ActivityRun['state']): ActivityRun {
  let tokens = 0
  let output = 0
  let cost: number | null = null
  let model: string | null = null
  let most = -1

  for (const [name, tally] of run.byModel) {
    tokens += tokensOf(tally)
    output += tally.output
    const price = claudeCost(name, tally)
    if (price > 0) cost = (cost || 0) + price
    if (tally.output > most) {
      most = tally.output
      model = name
    }
  }

  if (run.codexNow) {
    const base = run.codexBase || { input: 0, cached: 0, output: 0 }
    tokens += Math.max(0, run.codexNow.input - base.input) + Math.max(0, run.codexNow.output - base.output)
    output += Math.max(0, run.codexNow.output - base.output)
    model ||= run.codexModel
  }

  return {
    id: run.id,
    sessionId: run.sessionId,
    parentId: run.parentId,
    label: run.label,
    agentId: run.agentId,
    model: model || run.codexModel,
    task: run.task,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    state,
    plan: run.plan,
    tokens,
    output,
    costUsd: cost,
    tools: run.tools,
    edits: run.edited.size,
    added: [...run.changes.values()].reduce((sum, change) => sum + change.added, 0),
    removed: [...run.changes.values()].reduce((sum, change) => sum + change.removed, 0)
  }
}

/** Start following a transcript; a long one is read from near its end. */
export function openConversation(file: string, provider: Conversation['provider'], run: Run): Conversation {
  const tail = openTail(file)
  run.fromStart = tail.offset === 0

  if (tail.offset > 0) {
    // Joined mid-conversation: the request being worked on is further up.
    const request = lastRequest(file, tail.offset, provider)
    if (request) beginWork(run, request.text, request.at)
  }

  return { provider, tail, run, subs: new Map(), subsCheckedAt: 0 }
}

/** The newest real request before `before`, read backwards a block at a time (a few MB at most). */
function lastRequest(file: string, before: number, provider: Conversation['provider']): { text: string; at: number } | null {
  const block = 1024 * 1024
  let end = before
  let carry = Buffer.alloc(0)
  let fd: number

  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return null
  }

  try {
    for (let scanned = 0; end > 0 && scanned < 24 * block; scanned += block) {
      const start = Math.max(0, end - block)
      const buffer = Buffer.alloc(end - start)
      fs.readSync(fd, buffer, 0, buffer.length, start)
      const chunk = Buffer.concat([buffer, carry])
      // The first line may begin in the block before this one: keep it for the next round.
      const cut = start === 0 ? -1 : chunk.indexOf(0x0a)
      carry = cut < 0 ? Buffer.alloc(0) : chunk.subarray(0, cut + 1)
      const lines = chunk
        .subarray(cut + 1)
        .toString('utf8')
        .split('\n')

      for (let index = lines.length - 1; index >= 0; index--) {
        const raw = lines[index]
        const found = provider === 'claude' ? claudeRequest(raw) : codexRequest(raw)
        if (found) return found
      }

      end = start
    }
  } catch {
    // unreadable: no request known
  } finally {
    fs.closeSync(fd)
  }

  return null
}

function claudeRequest(raw: string): { text: string; at: number } | null {
  if (!raw.includes('"type":"user"') || raw.includes('"tool_use_id"') || raw.includes('"isSidechain":true') || raw.includes('"isCompactSummary":true')) return null

  try {
    const line = JSON.parse(raw) as Json
    if (line.type !== 'user' || line.isMeta === true || line.isCompactSummary === true) return null
    const text = userText(((line.message || {}) as Json).content)

    const request = requestText(text)

    return request ? { text: request, at: timeOf(line) } : null
  } catch {
    return null
  }
}

function codexRequest(raw: string): { text: string; at: number } | null {
  if (!raw.includes('"user_message"') && !raw.includes('"UserMessage"')) return null

  try {
    const line = JSON.parse(raw) as Json
    const payload = (line.payload || {}) as Json
    const item = (payload.item || {}) as Json
    const text = payload.type === 'user_message' ? str(payload.message) : item.type === 'UserMessage' ? userText(item.content) || '' : ''

    return text.trim() ? { text, at: timeOf(line) } : null
  } catch {
    return null
  }
}

/** Read what was written since the last call. */
export function pollConversation(conversation: Conversation, now: number) {
  feed(conversation.run, readLines(conversation.tail), conversation.provider, false)
  followSubagents(conversation, now)
}

/** A subagent is done once its result is back (or nobody waits on it) and it went quiet; long silence settles it either way. */
export function subState(conversation: Conversation, sub: Sub, parent: ActivityRun['state'], now: number): ActivityRun['state'] {
  if (sub.finished === true) return 'done'
  if (sub.finished === false) return now - sub.mtime > 10 * 60_000 ? 'done' : 'working'
  const spawn = sub.spawnId ? conversation.run.spawns.get(sub.spawnId) : undefined
  const quiet = now - sub.mtime > SUB_QUIET_MS
  const finished = (quiet && (spawn?.done ?? true)) || (quiet && parent === 'done') || now - sub.mtime > 3 * 60_000

  return finished ? 'done' : 'working'
}
