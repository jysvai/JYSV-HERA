// Token usage aggregation from the agent CLIs' own logs. Runs inside a
// short-lived Electron utility process (usage-worker.ts) so parsing hundreds of
// MB of transcripts never blocks the UI and all of its memory is returned to
// the OS when it exits. Parsing is incremental: a per-file byte offset is kept
// in a cache so only appended lines are read on the next run.
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

interface FileState {
  size: number
  offset: number
  /** day -> model -> tally */
  days: Record<string, Record<string, TokenTally>>
  /** hour start (ms) -> tokens, last 48h only */
  hours: Record<string, number>
  recentIds: string[]
  group: string
  /** Codex: running cumulative totals for delta computation. */
  cumulative?: { input: number; cached: number; output: number; reasoning: number }
  model?: string
  /** Working folder the session ran in ('' = not found). */
  cwd?: string
}

export interface UsageCache {
  version: 2
  files: Record<string, FileState>
}

export interface WorkerRequest {
  cacheFile: string
  claudeDirs: string[]
  codexHomes: string[]
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

function parseClaudeLine(state: FileState, line: string, seen: Set<string>) {
  if (!line.includes('"type":"assistant"')) return

  const usageAt = line.indexOf('"usage":{')

  if (usageAt < 0) return

  const id = /"id":"(msg_[^"]+)"/.exec(line)?.[1] || null
  const requestId = /"requestId":"([^"]+)"/.exec(line)?.[1] || ''
  const key = id ? `${id}:${requestId}` : null

  if (key) {
    if (seen.has(key)) return
    seen.add(key)
    state.recentIds.push(key)
  }

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

  const creation = (usage.cache_creation || {}) as Record<string, number>
  const write1h = Number(creation.ephemeral_1h_input_tokens) || 0
  const writeTotal = Number(usage.cache_creation_input_tokens) || 0
  const tally = bucket(state, t, model)
  const input = Number(usage.input_tokens) || 0
  const output = Number(usage.output_tokens) || 0
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

    return
  }

  if (!line.includes('"token_count"') || !line.includes('"total_token_usage"')) return

  const at = line.indexOf('"total_token_usage":{')
  const raw = at >= 0 ? objectAt(line, at + 20) : null

  if (!raw) return

  let total: Record<string, number>

  try {
    total = JSON.parse(raw)
  } catch {
    return
  }

  const t = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] || '') || 0

  if (!t) return

  const now = {
    input: Number(total.input_tokens) || 0,
    cached: Number(total.cached_input_tokens) || 0,
    output: Number(total.output_tokens) || 0,
    reasoning: Number(total.reasoning_output_tokens) || 0
  }
  const prev = state.cumulative || { input: 0, cached: 0, output: 0, reasoning: 0 }
  // Cumulative per session: count only the growth since the previous event.
  const delta = {
    input: Math.max(0, now.input - prev.input),
    cached: Math.max(0, now.cached - prev.cached),
    output: Math.max(0, now.output - prev.output)
  }
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

function readRange(file: string, start: number, end: number): string {
  const length = end - start

  if (length <= 0) return ''

  const fd = fs.openSync(file, 'r')

  try {
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, start)

    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/

/** The session's working folder, from the first record that carries one. */
function readCwd(file: string, size: number): string {
  try {
    const raw = CWD_RE.exec(readRange(file, 0, Math.min(size, 64 * 1024)))?.[1]

    return raw ? (JSON.parse(`"${raw}"`) as string).replace(/^\\\\\?\\/, '') : ''
  } catch {
    return ''
  }
}

function processFile(cache: UsageCache, file: string, size: number, group: string, kind: 'claude' | 'codex') {
  let state = cache.files[file]

  if (!state || size < state.offset) {
    state = { size: 0, offset: 0, days: {}, hours: {}, recentIds: [], group }
    cache.files[file] = state
  }

  // Older caches lack the folder; look it up once.
  if (state.cwd === undefined) state.cwd = kind === 'codex' && group !== 'codex' ? group : readCwd(file, size)

  if (size === state.offset) {
    return
  }

  // Read appended bytes in chunks; carry the trailing partial line over.
  const CHUNK = 8 * 1024 * 1024
  const seen = new Set(state.recentIds)
  let position = state.offset

  while (position < size) {
    const end = Math.min(size, position + CHUNK)
    const text = readRange(file, position, end)
    const lastNewline = text.lastIndexOf('\n')

    if (lastNewline < 0) {
      if (end === size) break // incomplete last line; wait for more
      // A single line longer than CHUNK: extend the window.
      const extended = readRange(file, position, size)
      const extNewline = extended.lastIndexOf('\n')

      if (extNewline < 0) break

      for (const line of extended.slice(0, extNewline).split('\n')) {
        kind === 'claude' ? parseClaudeLine(state, line, seen) : parseCodexLine(state, line)
      }

      position += Buffer.byteLength(extended.slice(0, extNewline + 1), 'utf8')
      continue
    }

    const complete = text.slice(0, lastNewline)

    for (const line of complete.split('\n')) {
      kind === 'claude' ? parseClaudeLine(state, line, seen) : parseCodexLine(state, line)
    }

    position += Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8')
  }

  state.offset = position
  state.size = size
  state.recentIds = state.recentIds.slice(-400)
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

function aggregate(cache: UsageCache, files: string[], cutoffDay: string): ProviderUsageRaw {
  const raw: ProviderUsageRaw = { days: {}, hours: {}, groups: {}, cwdDays: {}, files: files.length }

  for (const file of files) {
    const state = cache.files[file]

    if (!state) continue

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

export function runUsage(request: WorkerRequest): WorkerResult {
  const started = Date.now()
  let cache: UsageCache = { version: 2, files: {} }

  try {
    const loaded = JSON.parse(fs.readFileSync(request.cacheFile, 'utf8')) as UsageCache

    if (loaded?.version === 2 && loaded.files) cache = loaded
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

  for (const entry of claudeFiles) processFile(cache, entry.file, entry.size, entry.group, 'claude')

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

    processFile(cache, entry.file, entry.size, entry.group, 'codex')
  }

  // Drop cache entries for files that aged out or disappeared.
  const live = new Set([...claudeFiles, ...codexFiles].map(entry => entry.file))

  for (const file of Object.keys(cache.files)) {
    if (!live.has(file)) delete cache.files[file]
  }

  // Trim hourly buckets older than 48h.
  const hourCutoff = Date.now() - 48 * 3_600_000

  for (const state of Object.values(cache.files)) {
    for (const hour of Object.keys(state.hours)) {
      if (Number(hour) < hourCutoff) delete state.hours[hour]
    }
  }

  try {
    const tmp = `${request.cacheFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, request.cacheFile)
  } catch {
    // cache is an optimisation only
  }

  return {
    claude: aggregate(
      cache,
      claudeFiles.map(entry => entry.file),
      cutoffDay
    ),
    codex: aggregate(
      cache,
      codexFiles.map(entry => entry.file),
      cutoffDay
    ),
    elapsedMs: Date.now() - started
  }
}
