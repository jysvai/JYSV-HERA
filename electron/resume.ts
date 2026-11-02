// Session memory: which folder each shell was last in and which agent
// conversation each terminal was holding, so a restart (or a sudden reboot)
// can bring back exactly that — not just "the most recent conversation here".
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { AgentDef } from '../shared/types'

import { codexHomes, codexSessionIndex } from './agent-data'
import { expandHome, home, isWin, readHead } from './paths'

export interface ConversationRef {
  agentId: string
  id: string
}

export function newConversationId(): string {
  return crypto.randomUUID()
}

/** Fill `{id}` in an agent's arg template (`--resume {id}`). */
export function withId(template: string, id: string): string {
  return template.split('{id}').join(id)
}

export function isDir(p: string | null | undefined): p is string {
  if (!p) return false

  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// ---- shell folder tracking

/** Default Windows prompts: `PS C:\path>` (PowerShell) and `C:\path>` (cmd). */
const WIN_PROMPT = /^(?:PS )?([A-Za-z]:\\[^>]*)>\s*$/

export function cwdFromPrompt(line: string): string | null {
  const match = WIN_PROMPT.exec(line.trim())

  return match ? match[1] : null
}

/** OSC 7 (`file://host/path`, bash/zsh/fish integrations) and OSC 9;9 (`C:\path`, Windows Terminal style). */
export function cwdFromOsc(code: 7 | 9, data: string): string | null {
  try {
    if (code === 9) {
      if (!data.startsWith('9;')) return null
      const value = data.slice(2).replace(/^"|"$/g, '')

      return value || null
    }

    const url = new URL(data)
    if (url.protocol !== 'file:') return null
    let value = decodeURIComponent(url.pathname)
    if (isWin) value = value.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\')

    return value || null
  } catch {
    return null
  }
}

// ---- conversation detection

export interface ConversationClaim {
  /** HERA session id. */
  key: string
  agent: AgentDef
  cwd: string
  /** When the agent started in this terminal. */
  startedAt: number
  /** Profile config dir (CLAUDE_CONFIG_DIR / CODEX_HOME), null = default. */
  configDir: string | null
  /** Id HERA itself chose at launch (`--session-id`), if any. */
  known: string | null
}

interface Transcript {
  id: string
  born: number
  touched: number
  /** Claude transcript file, read lazily to tell a lanes lane's conversation apart. */
  file?: string
}

// A lanes lane runs as `claude -n <folder>-<4 hex>-mid|low`; Claude Code records that name near the top.
const LANE_NAME = /"agentName":"[^"]*-[0-9a-f]{4}-(?:mid|low)"/
const laneCache = new Map<string, boolean>()

function isLaneTranscript(entry: Transcript): boolean {
  if (!entry.file) return false
  const key = `${entry.file}|${entry.born}`
  const known = laneCache.get(key)
  if (known !== undefined) return known

  let lane = false

  try {
    const fd = fs.openSync(entry.file, 'r')

    try {
      const head = Buffer.alloc(16_384)
      lane = LANE_NAME.test(head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)).toString('utf8'))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }

  if (laneCache.size > 2000) laneCache.clear()
  laneCache.set(key, lane)

  return lane
}

function samePath(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '')

  return isWin ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

function claudeProjectDir(cwd: string, configDir: string | null): string {
  const root = configDir ? expandHome(configDir) : process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')

  // Claude Code keys project folders by the cwd with every non-alphanumeric replaced by '-'.
  return path.join(root, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
}

function claudeTranscripts(cwd: string, configDir: string | null): Transcript[] {
  const dir = claudeProjectDir(cwd, configDir)
  const out: Transcript[] = []

  let names: string[] = []

  try {
    names = fs.readdirSync(dir)
  } catch {
    return out
  }

  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue

    try {
      const file = path.join(dir, name)
      const stat = fs.statSync(file)
      out.push({ id: name.slice(0, -'.jsonl'.length), born: stat.birthtimeMs || stat.mtimeMs, touched: stat.mtimeMs, file })
    } catch {
      // vanished
    }
  }

  return out
}

const ROLLOUT_TIME = /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/

function rolloutBorn(file: string, fallback: number): number {
  const time = ROLLOUT_TIME.exec(path.basename(file))

  return time ? new Date(+time[1], +time[2] - 1, +time[3], +time[4], +time[5], +time[6]).getTime() : fallback
}

const rolloutHeads = new Map<string, { id: string | null; cwd: string | null }>()

/**
 * Rollouts of today and yesterday, read straight from their folders: the session
 * index is cached for half a minute, too long to notice a Codex tab that just started.
 */
function recentRollouts(): (Transcript & { cwd: string | null; file: string })[] {
  const out: (Transcript & { cwd: string | null; file: string })[] = []
  const pad = (n: number) => String(n).padStart(2, '0')

  for (const codexHome of codexHomes()) {
    for (const daysAgo of [0, 1]) {
      const day = new Date(Date.now() - daysAgo * 86_400_000)
      const dir = path.join(codexHome, 'sessions', String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()))
      let names: string[] = []

      try {
        names = fs.readdirSync(dir).filter(name => name.startsWith('rollout-') && name.endsWith('.jsonl'))
      } catch {
        continue
      }

      for (const name of names) {
        const file = path.join(dir, name)

        try {
          const stat = fs.statSync(file)
          let head = rolloutHeads.get(file)

          // A head without an id is read again only while the file is still being started (a few KB).
          if (!head || (!head.id && stat.size < 16 * 1024)) {
            const text = readHead(file, 12 * 1024)
            const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1]
            head = { id: /"(?:session_id|id)":"([0-9a-f-]{20,})"/.exec(text)?.[1] || null, cwd: cwd ? (JSON.parse(`"${cwd}"`) as string).replace(/^\\\\\?\\/, '') : null }
            if (rolloutHeads.size > 4000) rolloutHeads.clear()
            rolloutHeads.set(file, head)
          }

          if (head.id) out.push({ id: head.id, born: rolloutBorn(file, stat.mtimeMs), touched: stat.mtimeMs, cwd: head.cwd, file })
        } catch {
          // vanished
        }
      }
    }
  }

  return out
}

function codexTranscripts(cwd: string): Transcript[] {
  const out = new Map<string, Transcript>()

  for (const entry of codexSessionIndex(codexHomes())) {
    if (!entry.sessionId || !samePath(entry.cwd, cwd)) continue
    out.set(entry.sessionId, { id: entry.sessionId, born: rolloutBorn(entry.file || '', entry.mtime), touched: entry.mtime })
  }

  for (const entry of recentRollouts()) {
    if (samePath(entry.cwd, cwd)) out.set(entry.id, { id: entry.id, born: entry.born, touched: entry.touched })
  }

  return [...out.values()]
}

/** Agents whose transcripts HERA can find, keyed by their usage provider. */
function transcriptsFor(claim: ConversationClaim): Transcript[] | null {
  if (claim.agent.usageProvider === 'claude') return claudeTranscripts(claim.cwd, claim.configDir)
  if (claim.agent.usageProvider === 'codex') return codexTranscripts(claim.cwd)

  return null
}

// ---- transcript files (live activity)

/** The file of a conversation a terminal holds, if it is on disk. */
export function transcriptFile(provider: AgentDef['usageProvider'], cwd: string, configDir: string | null, id: string): string | null {
  if (provider === 'claude') {
    const file = path.join(claudeProjectDir(cwd, configDir), `${id}.jsonl`)

    return fs.existsSync(file) ? file : null
  }

  if (provider === 'codex') return recentRollouts().find(entry => entry.id === id)?.file || codexSessionIndex(codexHomes()).find(entry => entry.sessionId === id)?.file || null

  return null
}

/** A lanes lane's conversation: the newest transcript here, begun after the tab started, that carries the lane's name. */
export function laneTranscriptFile(cwd: string, configDir: string | null, tier: 'mid' | 'low', startedAt: number, taken: Set<string> = new Set()): string | null {
  const name = new RegExp(`"agentName":"[^"]*-[0-9a-f]{4}-${tier}"`)
  const candidates = claudeTranscripts(cwd, configDir)
    .filter(entry => entry.touched >= startedAt - 10_000 && !(entry.file && taken.has(entry.file)))
    .sort((a, b) => b.touched - a.touched)

  for (const entry of candidates.slice(0, 12)) {
    if (!entry.file || !isLaneTranscript(entry)) continue

    try {
      const fd = fs.openSync(entry.file, 'r')

      try {
        const head = Buffer.alloc(16_384)
        if (name.test(head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)).toString('utf8'))) return entry.file
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // vanished
    }
  }

  return null
}

/**
 * Match each terminal to the conversation it is holding. Latest-started terminals
 * pick first. A terminal keeps the conversation HERA started it with unless a
 * newer one began after that one went quiet (`/clear`); otherwise it takes the
 * most recently written transcript created after it started that no other
 * terminal took (several agents of the same kind in one folder). A terminal that
 * continued an older conversation (`claude --continue`, `codex resume --last`)
 * goes on writing its old file: once every other terminal has picked, it takes
 * the transcript written since it started. A lanes lane's conversation is never
 * a candidate: resumed in a main tab it would replace main.
 */
export function detectConversations(claims: ConversationClaim[]): Map<string, string | null> {
  const result = new Map<string, string | null>()
  const taken = new Set<string>()
  const cache = new Map<string, Transcript[] | null>()
  const ordered = [...claims].sort((a, b) => b.startedAt - a.startedAt)
  const transcriptsOf = (claim: ConversationClaim) => {
    const cacheKey = `${claim.agent.usageProvider}|${claim.configDir || ''}|${claim.cwd}`
    if (!cache.has(cacheKey)) cache.set(cacheKey, transcriptsFor(claim))

    return cache.get(cacheKey)
  }

  for (const claim of ordered) {
    const transcripts = transcriptsOf(claim)

    if (!transcripts) {
      result.set(claim.key, null)
      continue
    }

    const own = claim.known ? transcripts.find(entry => entry.id === claim.known && !taken.has(entry.id)) : undefined
    const candidates = transcripts
      .filter(entry => entry.born >= claim.startedAt - 10_000 && !taken.has(entry.id) && entry !== own && !isLaneTranscript(entry))
      .sort((a, b) => b.touched - a.touched)
    // Another conversation counts only if it began after HERA's own one stopped being written.
    const newer = own ? candidates.find(entry => entry.born > own.touched - 2000) : candidates[0]
    const id = newer?.id || own?.id || null

    if (id) taken.add(id)
    result.set(claim.key, id)
  }

  for (const claim of ordered) {
    if (result.get(claim.key)) continue
    const continued = transcriptsOf(claim)
      ?.filter(entry => entry.touched >= claim.startedAt && !taken.has(entry.id) && !isLaneTranscript(entry))
      .sort((a, b) => b.touched - a.touched)[0]
    if (!continued) continue

    taken.add(continued.id)
    result.set(claim.key, continued.id)
  }

  return result
}
