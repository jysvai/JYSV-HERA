// Token usage aggregation from the agent CLIs' own logs. Runs inside a
// short-lived Electron utility process (usage-worker.ts) so parsing tens of GB
// of transcripts never blocks the UI and all of its memory is returned to the
// OS when it exits. Parsing is incremental: a per-file byte offset is kept in a
// cache so only appended lines are read on the next run.
import fs from 'node:fs'
import path from 'node:path'

export interface TokenTally {
  input: number
  output: number
  cacheWrite: number
  cacheWrite1h: number
  cacheRead: number
  messages: number
}

export type UsageKind = 'claude' | 'codex' | 'agy'

interface FileState {
  kind: UsageKind
  size: number
  offset: number
  /** day -> model -> tally */
  days: Record<string, Record<string, TokenTally>>
  /** hour start (ms) -> tokens, last 48h only */
  hours: Record<string, number>
  /** Claude: each API response this file counted -> the highest output_tokens seen for it. */
  ids: Record<string, number>
  group: string
  /** Codex: running cumulative totals for delta computation. */
  cumulative?: { input: number; cached: number; output: number; reasoning: number }
  model?: string
  /** Working folder the session ran in ('' = not found yet). */
  cwd: string
}

const CACHE_VERSION = 3

export interface UsageCache {
  version: typeof CACHE_VERSION
  files: Record<string, FileState>
}

export interface WorkerRequest {
  cacheFile: string
  claudeDirs: string[]
  codexHomes: string[]
  agyDir: string
  /** Antigravity conversation id -> working folder (its transcripts do not carry one). */
  agyWorkspaces: Record<string, string>
  maxAgeDays: number
}

export interface ProviderUsageRaw {
  days: Record<string, Record<string, TokenTally>>
  hours: Record<string, number>
  groups: Record<string, Record<string, TokenTally>>
  /** cwd -> day -> model -> tally (per-folder usage over time). */
  cwdDays: Record<string, Record<string, Record<string, TokenTally>>>
  files: number
}

export interface WorkerResult {
  claude: ProviderUsageRaw
  codex: ProviderUsageRaw
  agy: ProviderUsageRaw
  elapsedMs: number
}

export function emptyTally(): TokenTally {
  return { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, messages: 0 }
}

function addTally(target: TokenTally, source: TokenTally) {
  target.input += source.input
  target.output += source.output
  target.cacheWrite += source.cacheWrite
  target.cacheWrite1h += source.cacheWrite1h
  target.cacheRead += source.cacheRead
  target.messages += source.messages
}

function localDay(t: number): string {
  const d = new Date(t)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function bucket(state: FileState, t: number, model: string): TokenTally {
  const day = localDay(t)
  const byModel = (state.days[day] ||= {})

  return (byModel[model] ||= emptyTally())
}

function addHour(state: FileState, t: number, tokens: number) {
  if (Date.now() - t > 48 * 3_600_000) return
  const hour = String(Math.floor(t / 3_600_000) * 3_600_000)
  state.hours[hour] = (state.hours[hour] || 0) + tokens
}

/** Extract the balanced JSON object that starts at `start` (a '{'). */
function objectAt(text: string, start: number): string | null {
  let depth = 0
  let inString = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]

    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return null
}

function lastMatch(re: RegExp, text: string): string | null {
  let found: string | null = null
  re.lastIndex = 0
  let match = re.exec(text)

  while (match) {
    found = match[1]
    match = re.exec(text)
  }

  return found
}

const TS_RE = /"timestamp":"([^"]+)"/g
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/g

/** The session's working folder. The last match is the record's own: tool inputs come earlier in a line. */
function noteCwd(state: FileState, line: string) {
  if (state.cwd) return

  const raw = lastMatch(CWD_RE, line)

  if (!raw) return

  try {
    state.cwd = (JSON.parse(`"${raw}"`) as string).replace(/^\\\\\?\\/, '')
  } catch {
    // the next record has it too
  }
}

function parseClaudeLine(state: FileState, line: string, counted: Map<string, FileState>) {
  if (!line.includes('"type":"assistant"')) return

  noteCwd(state, line)

  const usageAt = line.indexOf('"usage":{')

  if (usageAt < 0) return

  const raw = objectAt(line, usageAt + 8)

  if (!raw) return

  let usage: Record<string, unknown>

  try {
    usage = JSON.parse(raw)
  } catch {
    return
  }

  const t = Date.parse(lastMatch(TS_RE, line) || '') || 0

  if (!t) return

  const model = /"model":"([^"]+)"/.exec(line)?.[1] || 'unknown'

  if (model === '<synthetic>') return

  const id = /"id":"(msg_[^"]+)"/.exec(line)?.[1] || null
  const output = Number(usage.output_tokens) || 0
  const owner = id ? counted.get(id) : undefined

  if (id && owner) {
    // The same response again: a later streamed line, or a copy in a forked
    // transcript. Only more output counts (older CLIs start with a placeholder).
    const extra = output - owner.ids[id]

    if (extra > 0) {
      owner.ids[id] = output
      bucket(owner, t, model).output += extra
      addHour(owner, t, extra)
    }

    return
  }

  if (id) {
    state.ids[id] = output
    counted.set(id, state)
  }

  const creation = (usage.cache_creation || {}) as Record<string, number>
  const write1h = Number(creation.ephemeral_1h_input_tokens) || 0
  const writeTotal = Number(usage.cache_creation_input_tokens) || 0
  const tally = bucket(state, t, model)
  const input = Number(usage.input_tokens) || 0
  const read = Number(usage.cache_read_input_tokens) || 0
  tally.input += input
  tally.output += output
  tally.cacheWrite += Math.max(0, writeTotal - write1h)
  tally.cacheWrite1h += write1h
  tally.cacheRead += read
  tally.messages += 1
  addHour(state, t, input + output + writeTotal + read)
}

function parseCodexLine(state: FileState, line: string) {
  if (line.includes('"turn_context"') || line.includes('"session_meta"')) {
    const model = /"model":"([^"]+)"/.exec(line)?.[1]

    if (model) state.model = model
    noteCwd(state, line)

    return
  }

  // Both kinds of record carry the session's running total, and a response can be
  // in only one of them (a compaction call, an interrupted last turn). The total
  // only moves forward, so each response counts once, whichever record comes first.
  const field = line.includes('"token_usage_record"') ? '"thread_token_usage":{' : line.includes('"token_count"') ? '"total_token_usage":{' : ''
  const at = field ? line.indexOf(field) : -1
  const raw = at >= 0 ? objectAt(line, at + field.length - 1) : null

  if (!raw) return

  let total: Record<string, number>

  try {
    total = JSON.parse(raw)
  } catch {
    return
  }

  const t = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] || '') || 0

  if (!t) return

  const prev = state.cumulative || { input: 0, cached: 0, output: 0, reasoning: 0 }
  const now = {
    input: Math.max(prev.input, Number(total.input_tokens) || 0),
    cached: Math.max(prev.cached, Number(total.cached_input_tokens) || 0),
    output: Math.max(prev.output, Number(total.output_tokens) || 0),
    reasoning: Math.max(prev.reasoning, Number(total.reasoning_output_tokens) || 0)
  }
  // Cumulative per session: count only the growth since the previous event.
  const delta = { input: now.input - prev.input, cached: now.cached - prev.cached, output: now.output - prev.output }
  state.cumulative = now

  if (!delta.input && !delta.output) return

  const tally = bucket(state, t, state.model || 'codex')
  // Codex reports cached tokens as a subset of input tokens.
  tally.input += Math.max(0, delta.input - delta.cached)
  tally.cacheRead += delta.cached
  tally.output += delta.output
  tally.messages += 1
  addHour(state, t, delta.input + delta.output)
}

const AGY_MODEL = 'Antigravity'

/** One model turn of an Antigravity transcript. Its cached tokens are not part of input_tokens. */
function parseAgyLine(state: FileState, line: string, seen: Set<number>) {
  if (!line.includes('"PLANNER_RESPONSE"')) return

  let record: { type?: string; step_index?: number; created_at?: string; input_tokens?: number; cache_read_tokens?: number; output_tokens?: number }

  try {
    record = JSON.parse(line)
  } catch {
    return // still being written
  }

  if (record.type !== 'PLANNER_RESPONSE') return

  if (typeof record.step_index === 'number') {
    if (seen.has(record.step_index)) return
    seen.add(record.step_index)
  }

  const t = Date.parse(record.created_at || '') || 0
  const input = Number(record.input_tokens) || 0
  const read = Number(record.cache_read_tokens) || 0
  const output = Number(record.output_tokens) || 0

  if (!t || (!input && !read && !output)) return

  const tally = bucket(state, t, AGY_MODEL)
  tally.input += input
  tally.cacheRead += read
  tally.output += output
  tally.messages += 1
  addHour(state, t, input + read + output)
}

function readRange(file: string, start: number, end: number): string {
  const length = end - start

  if (length <= 0) return ''

  const fd = fs.openSync(file, 'r')

  try {
    const buffer = Buffer.alloc(length)
    const got = fs.readSync(fd, buffer, 0, length, start)

    return buffer.toString('utf8', 0, got)
  } finally {
    fs.closeSync(fd)
  }
}

const CHUNK = 8 * 1024 * 1024
const CLAUDE_LINES = [Buffer.from('"type":"assistant"')]
const CODEX_LINES = [Buffer.from('"token_count"'), Buffer.from('"token_usage_record"'), Buffer.from('"turn_context"'), Buffer.from('"session_meta"')]
// One buffer for every read: a first run goes through tens of GB.
let readBuffer: Buffer | null = null

/**
 * Hands over the complete lines in [start, size) that contain one of `wanted`
 * and returns the offset just after the last complete line. Lines are matched
 * as bytes because most of a transcript (tool output, file contents) never has
 * to become a string. A line longer than the buffer is skipped: the records
 * that carry usage are small.
 */
function readLines(file: string, start: number, size: number, wanted: Buffer[], visit: (line: string) => void): number {
  const buffer = (readBuffer ||= Buffer.allocUnsafe(CHUNK))
  const fd = fs.openSync(file, 'r')
  let position = start
  let filled = 0
  let skipping = false
  let done = start

  try {
    while (position + filled < size) {
      const got = fs.readSync(fd, buffer, filled, Math.min(CHUNK - filled, size - position - filled), position + filled)

      if (got <= 0) break
      filled += got

      const view = buffer.subarray(0, filled)
      let at = 0

      for (let newline = view.indexOf(10, at); newline >= 0; newline = view.indexOf(10, at)) {
        if (skipping) {
          skipping = false
        } else {
          const line = view.subarray(at, newline)

          if (wanted.some(needle => line.includes(needle))) visit(line.toString('utf8'))
        }

        at = newline + 1
        done = position + at
      }

      if (at === 0 && filled === CHUNK) {
        skipping = true
        position += filled
        filled = 0
        continue
      }

      // The unfinished line moves to the front and the next read continues it.
      if (at > 0) view.copy(buffer, 0, at, filled)
      position += at
      filled -= at
    }
  } finally {
    fs.closeSync(fd)
  }

  return done
}

function processFile(cache: UsageCache, counted: Map<string, FileState>, file: string, size: number, group: string, kind: 'claude' | 'codex') {
  let state = cache.files[file]

  if (!state || size < state.offset) {
    // A file that shrank is read again from the start, so what it counted is open again.
    if (state) for (const id of Object.keys(state.ids)) counted.delete(id)
    state = { kind, size: 0, offset: 0, days: {}, hours: {}, ids: {}, group, cwd: '' }
    cache.files[file] = state
  }

  if (size === state.offset) {
    return
  }

  const current = state

  state.offset = readLines(file, state.offset, size, kind === 'claude' ? CLAUDE_LINES : CODEX_LINES, line => {
    if (kind === 'claude') parseClaudeLine(current, line, counted)
    else parseCodexLine(current, line)
  })
  state.size = size
}

/** Antigravity transcripts are small and a running step can be rewritten, so a changed file is read whole. */
function processAgyFile(cache: UsageCache, file: string, size: number, cwd: string) {
  const known = cache.files[file]

  if (known?.size === size) {
    if (cwd && !known.cwd) known.cwd = cwd

    return
  }

  const state: FileState = { kind: 'agy', size, offset: size, days: {}, hours: {}, ids: {}, group: 'agy', cwd: cwd || known?.cwd || '' }
  const seen = new Set<number>()

  for (const line of readRange(file, 0, size).split('\n')) parseAgyLine(state, line, seen)

  cache.files[file] = state
}

function walkJsonl(dir: string, cutoff: number, out: { file: string; size: number; group: string }[], group: string, depth = 0) {
  let entries: fs.Dirent[]

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (depth < 4) walkJsonl(full, cutoff, out, group, depth + 1)
    } else if (entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(full)

        if (stat.mtimeMs >= cutoff) out.push({ file: full, size: stat.size, group })
      } catch {
        // vanished
      }
    }
  }
}

function agyTranscripts(agyDir: string, cutoff: number): { id: string; file: string; size: number }[] {
  const brain = path.join(agyDir, 'brain')
  const out: { id: string; file: string; size: number }[] = []
  let ids: string[] = []

  try {
    ids = fs.readdirSync(brain)
  } catch {
    return out
  }

  for (const id of ids) {
    const file = path.join(brain, id, '.system_generated', 'logs', 'transcript.jsonl')

    try {
      const stat = fs.statSync(file)

      if (stat.mtimeMs >= cutoff) out.push({ id, file, size: stat.size })
    } catch {
      // no transcript for this conversation
    }
  }

  return out
}

function aggregate(cache: UsageCache, kind: UsageKind, cutoffDay: string): ProviderUsageRaw {
  const states = Object.values(cache.files).filter(state => state.kind === kind)
  const raw: ProviderUsageRaw = { days: {}, hours: {}, groups: {}, cwdDays: {}, files: states.length }

  for (const state of states) {
    for (const [day, models] of Object.entries(state.days)) {
      if (day < cutoffDay) continue

      const byCwd = ((raw.cwdDays[state.cwd || ''] ||= {})[day] ||= {})

      for (const [model, tally] of Object.entries(models)) {
        addTally(((raw.days[day] ||= {})[model] ||= emptyTally()), tally)
        addTally(((raw.groups[state.group] ||= {})[model] ||= emptyTally()), tally)
        addTally((byCwd[model] ||= emptyTally()), tally)
      }
    }

    for (const [hour, tokens] of Object.entries(state.hours)) {
      raw.hours[hour] = (raw.hours[hour] || 0) + tokens
    }
  }

  return raw
}

function saveCache(cacheFile: string, cache: UsageCache) {
  try {
    const tmp = `${cacheFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, cacheFile)
  } catch {
    // cache is an optimisation only
  }
}

export function runUsage(request: WorkerRequest): WorkerResult {
  const started = Date.now()
  let cache: UsageCache = { version: CACHE_VERSION, files: {} }

  try {
    const loaded = JSON.parse(fs.readFileSync(request.cacheFile, 'utf8')) as UsageCache

    if (loaded?.version === CACHE_VERSION && loaded.files) cache = loaded
  } catch {
    // fresh cache
  }

  const cutoff = Date.now() - request.maxAgeDays * 86_400_000
  const cutoffDay = localDay(cutoff)

  const claudeFiles: { file: string; size: number; group: string }[] = []

  for (const dir of request.claudeDirs) {
    const projectsDir = path.join(dir, 'projects')
    let projects: string[] = []

    try {
      projects = fs.readdirSync(projectsDir)
    } catch {
      continue
    }

    for (const project of projects) {
      walkJsonl(path.join(projectsDir, project), cutoff, claudeFiles, project)
    }
  }

  const codexFiles: { file: string; size: number; group: string }[] = []

  for (const codexHome of request.codexHomes) {
    walkJsonl(path.join(codexHome, 'sessions'), cutoff, codexFiles, 'codex')
  }

  // A response counts once over all files: a forked subagent's transcript starts
  // with a copy of its parent's.
  const counted = new Map<string, FileState>()

  for (const state of Object.values(cache.files)) {
    for (const id of Object.keys(state.ids)) counted.set(id, state)
  }

  // A first run can take minutes. If it is cut off, the next one continues from here.
  let savedAt = Date.now()
  const checkpoint = () => {
    if (Date.now() - savedAt < 15_000) return
    saveCache(request.cacheFile, cache)
    savedAt = Date.now()
  }

  for (const entry of claudeFiles) {
    processFile(cache, counted, entry.file, entry.size, entry.group, 'claude')
    checkpoint()
  }

  for (const entry of codexFiles) {
    // Group codex sessions by cwd (read once, from the head of the rollout).
    if (!cache.files[entry.file]) {
      const head = readRange(entry.file, 0, Math.min(entry.size, 12 * 1024))
      const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1]
      let group = 'codex'

      try {
        group = cwd ? (JSON.parse(`"${cwd}"`) as string).replace(/^\\\\\?\\/, '') : 'codex'
      } catch {
        // keep default
      }

      entry.group = group
    } else {
      entry.group = cache.files[entry.file].group
    }

    processFile(cache, counted, entry.file, entry.size, entry.group, 'codex')
    checkpoint()
  }

  const agyFiles = agyTranscripts(request.agyDir, cutoff)

  for (const entry of agyFiles) processAgyFile(cache, entry.file, entry.size, request.agyWorkspaces[entry.id] || '')

  // What was counted stays counted when its file goes away (Antigravity keeps
  // only its newest 500 conversations): an entry leaves once all its days aged out.
  const live = new Set([...claudeFiles, ...codexFiles, ...agyFiles].map(entry => entry.file))

  for (const [file, state] of Object.entries(cache.files)) {
    if (!live.has(file) && !Object.keys(state.days).some(day => day >= cutoffDay)) delete cache.files[file]
  }

  // Trim hourly buckets older than 48h.
  const hourCutoff = Date.now() - 48 * 3_600_000

  for (const state of Object.values(cache.files)) {
    for (const hour of Object.keys(state.hours)) {
      if (Number(hour) < hourCutoff) delete state.hours[hour]
    }
  }

  saveCache(request.cacheFile, cache)

  return {
    claude: aggregate(cache, 'claude', cutoffDay),
    codex: aggregate(cache, 'codex', cutoffDay),
    agy: aggregate(cache, 'agy', cutoffDay),
    elapsedMs: Date.now() - started
  }
}
