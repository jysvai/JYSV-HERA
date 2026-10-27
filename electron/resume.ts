// Session memory: which folder each shell was last in and which agent
// conversation each terminal was holding, so a restart (or a sudden reboot)
// can bring back exactly that — not just "the most recent conversation here".
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { AgentDef } from '../shared/types'

import { codexHomes, codexSessionIndex } from './agent-data'
import { expandHome, home, isWin } from './paths'

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
}

function samePath(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '')

  return isWin ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

function claudeTranscripts(cwd: string, configDir: string | null): Transcript[] {
  const root = configDir ? expandHome(configDir) : process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  // Claude Code keys project folders by the cwd with every non-alphanumeric replaced by '-'.
  const dir = path.join(root, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
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
      const stat = fs.statSync(path.join(dir, name))
      out.push({ id: name.slice(0, -'.jsonl'.length), born: stat.birthtimeMs || stat.mtimeMs, touched: stat.mtimeMs })
    } catch {
      // vanished
    }
  }

  return out
}

const ROLLOUT_TIME = /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/

function codexTranscripts(cwd: string): Transcript[] {
  const out: Transcript[] = []

  for (const entry of codexSessionIndex(codexHomes())) {
    if (!entry.sessionId || !samePath(entry.cwd, cwd)) continue
    const time = ROLLOUT_TIME.exec(path.basename(entry.file || ''))
    const born = time ? new Date(+time[1], +time[2] - 1, +time[3], +time[4], +time[5], +time[6]).getTime() : entry.mtime
    out.push({ id: entry.sessionId, born, touched: entry.mtime })
  }

  return out
}

/** Agents whose transcripts HERA can find, keyed by their usage provider. */
function transcriptsFor(claim: ConversationClaim): Transcript[] | null {
  if (claim.agent.usageProvider === 'claude') return claudeTranscripts(claim.cwd, claim.configDir)
  if (claim.agent.usageProvider === 'codex') return codexTranscripts(claim.cwd)

  return null
}

/**
 * Match each terminal to the conversation it is holding. Latest-started terminals
 * pick first, each taking the most recently written transcript that was created
 * after it started and that no other terminal took (covers `/clear` and several
 * agents of the same kind in one folder).
 */
export function detectConversations(claims: ConversationClaim[]): Map<string, string | null> {
  const result = new Map<string, string | null>()
  const taken = new Set<string>()
  const cache = new Map<string, Transcript[] | null>()

  for (const claim of [...claims].sort((a, b) => b.startedAt - a.startedAt)) {
    const cacheKey = `${claim.agent.usageProvider}|${claim.configDir || ''}|${claim.cwd}`
    if (!cache.has(cacheKey)) cache.set(cacheKey, transcriptsFor(claim))
    const transcripts = cache.get(cacheKey)

    if (!transcripts) {
      result.set(claim.key, null)
      continue
    }

    const best = transcripts
      .filter(entry => entry.born >= claim.startedAt - 10_000 && !taken.has(entry.id))
      .sort((a, b) => b.touched - a.touched)[0]
    const id = best?.id || (claim.known && transcripts.some(entry => entry.id === claim.known) ? claim.known : null)

    if (id) taken.add(id)
    result.set(claim.key, id)
  }

  return result
}
