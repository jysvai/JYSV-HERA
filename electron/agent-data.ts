// Readers for the data agent CLIs keep on disk. Read-only, defensive (formats
// change between CLI versions), and cheap: small head/tail reads, mtime-keyed
// caches, SQLite opened read-only when the CLI keeps an index there.
import fs from 'node:fs'
import path from 'node:path'

import type { RateWindow } from '../shared/types'
import { clip } from '../shared/util'

import { expandHome, home, isWin, readHead, readJson, readTail } from './paths'
import { getConfig } from './store'

type SqliteDb = {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] }
  close: () => void
}

let sqliteCtor: (new (file: string, options?: { readOnly?: boolean }) => SqliteDb) | null | undefined

function openSqlite(file: string): SqliteDb | null {
  if (sqliteCtor === undefined) {
    try {
      // node:sqlite ships with the Node runtime inside Electron 40.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sqliteCtor = require('node:sqlite').DatabaseSync
    } catch {
      sqliteCtor = null
    }
  }

  if (!sqliteCtor || !fs.existsSync(file)) {
    return null
  }

  try {
    return new sqliteCtor(file, { readOnly: true })
  } catch {
    return null
  }
}

function uniqueDirs(dirs: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const dir of dirs) {
    if (!dir) continue
    const resolved = path.resolve(expandHome(dir))
    const key = isWin ? resolved.toLowerCase() : resolved

    if (!seen.has(key) && fs.existsSync(resolved)) {
      seen.add(key)
      out.push(resolved)
    }
  }

  return out
}

function profileDirs(agentId: string): string[] {
  return getConfig()
    .profiles.filter(profile => profile.agentId === agentId && profile.configDir)
    .map(profile => profile.configDir as string)
}

export function claudeConfigDirs(): string[] {
  return uniqueDirs([path.join(home, '.claude'), process.env.CLAUDE_CONFIG_DIR, ...profileDirs('claude')])
}

export function codexHomes(): string[] {
  return uniqueDirs([path.join(home, '.codex'), process.env.CODEX_HOME, ...profileDirs('codex')])
}

export function agyDir(): string {
  return path.join(home, '.gemini', 'antigravity-cli')
}

// ---------------------------------------------------------------- Codex

export interface CodexSessionEntry {
  file: string
  cwd: string | null
  mtime: number
  sessionId: string | null
  title?: string | null
  firstMessage?: string | null
  tokensUsed?: number | null
}

let codexIndexCache: { at: number; key: string; entries: CodexSessionEntry[] } | null = null

function stripLongPrefix(p: string | null): string | null {
  return p ? p.replace(/^\\\\\?\\/, '') : p
}

function newestStateDb(codexHome: string): string | null {
  try {
    const dbs = fs
      .readdirSync(codexHome)
      .filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))

    return dbs[0] ? path.join(codexHome, dbs[0]) : null
  } catch {
    return null
  }
}

function codexIndexFromDb(codexHome: string): CodexSessionEntry[] | null {
  const dbFile = newestStateDb(codexHome)
  const db = dbFile ? openSqlite(dbFile) : null

  if (!db) {
    return null
  }

  try {
    const rows = db
      .prepare(
        `SELECT id, rollout_path, cwd, COALESCE(updated_at_ms, updated_at * 1000) AS updated, title, first_user_message, tokens_used
         FROM threads WHERE archived IS NULL OR archived = 0 ORDER BY updated DESC LIMIT 4000`
      )
      .all() as Record<string, unknown>[]

    return rows.map(row => ({
      file: String(row.rollout_path || ''),
      cwd: stripLongPrefix((row.cwd as string) || null),
      mtime: Number(row.updated) || 0,
      sessionId: String(row.id || ''),
      title: (row.title as string) || null,
      firstMessage: (row.first_user_message as string) || null,
      tokensUsed: row.tokens_used === null || row.tokens_used === undefined ? null : Number(row.tokens_used)
    }))
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** Plain rollout files (newest first) under sessions/YYYY/MM/DD, limited by age. */
export function codexRolloutFiles(codexHome: string, maxAgeDays = 60): { file: string; mtime: number; size: number }[] {
  const root = path.join(codexHome, 'sessions')
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  const out: { file: string; mtime: number; size: number }[] = []
  const list = (dir: string) => {
    try {
      return fs.readdirSync(dir)
    } catch {
      return []
    }
  }

  for (const year of list(root).sort().reverse()) {
    for (const month of list(path.join(root, year)).sort().reverse()) {
      // Month folders entirely before the cutoff can be skipped by name.
      if (new Date(Number(year), Number(month), 1).getTime() < cutoff) continue

      for (const day of list(path.join(root, year, month))) {
        const dir = path.join(root, year, month, day)

        for (const name of list(dir)) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          const file = path.join(dir, name)

          try {
            const stat = fs.statSync(file)

            if (stat.mtimeMs >= cutoff) {
              out.push({ file, mtime: stat.mtimeMs, size: stat.size })
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return out.sort((a, b) => b.mtime - a.mtime)
}

function codexIndexFromRollouts(codexHome: string): CodexSessionEntry[] {
  return codexRolloutFiles(codexHome).map(({ file, mtime }) => {
    const head = readHead(file, 12 * 1024)
    const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1]
    const id = /"(?:session_id|id)":"([0-9a-f-]{20,})"/.exec(head)?.[1] || null

    return {
      file,
      cwd: cwd ? stripLongPrefix(JSON.parse(`"${cwd}"`) as string) : null,
      mtime,
      sessionId: id
    }
  })
}

export function codexSessionIndex(homes: string[]): CodexSessionEntry[] {
  const key = homes.join('|')

  if (codexIndexCache && codexIndexCache.key === key && Date.now() - codexIndexCache.at < 30_000) {
    return codexIndexCache.entries
  }

  const entries: CodexSessionEntry[] = []

  for (const codexHome of homes) {
    entries.push(...(codexIndexFromDb(codexHome) ?? codexIndexFromRollouts(codexHome)))
  }

  codexIndexCache = { at: Date.now(), key, entries }

  return entries
}

function isInjectedCodexText(text: string): boolean {
  const start = text.trimStart()

  return (
    start.startsWith('<environment_context') ||
    start.startsWith('<user_instructions') ||
    start.startsWith('# AGENTS.md') ||
    start.startsWith('<permissions') ||
    start.startsWith('<turn_aborted')
  )
}

export function readCodexLastPrompt(file: string): string | null {
  if (!file || !fs.existsSync(file)) {
    return null
  }

  for (const bytes of [128 * 1024, 2 * 1024 * 1024]) {
    const lines = readTail(file, bytes).split('\n')

    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]

      if (!line.includes('"role":"user"') && !line.includes('"user_message"')) continue

      try {
        const record = JSON.parse(line)
        const payload = record.payload || {}
        let text: string | null = null

        if (payload.type === 'user_message' && typeof payload.message === 'string') {
          text = payload.message
        } else if (payload.role === 'user' && Array.isArray(payload.content)) {
          text = payload.content
            .filter((part: { type?: string }) => part?.type === 'input_text')
            .map((part: { text?: string }) => part.text || '')
            .join(' ')
        }

        if (text && !isInjectedCodexText(text)) {
          return clip(text, 240)
        }
      } catch {
        // partial line
      }
    }
  }

  return null
}

function windowLabel(minutes: number | null, fallback: string): string {
  if (!minutes) return fallback
  if (minutes <= 300) return `${Math.round(minutes / 60)}시간`
  if (minutes >= 10_000 && minutes <= 10_200) return '주간'

  return `${Math.round(minutes / 1440)}일`
}

/** Latest Codex rate-limit snapshot (written by Codex into its rollout logs). */
export function codexRateLimits(homes: string[]): { limits: RateWindow[]; at: number; plan: string | null } | null {
  let best: { limits: RateWindow[]; at: number; plan: string | null } | null = null

  for (const codexHome of homes) {
    for (const { file, mtime } of codexRolloutFiles(codexHome, 14).slice(0, 6)) {
      if (best && mtime < best.at) break

      const lines = readTail(file, 256 * 1024).split('\n')

      for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index]

        if (!line.includes('"rate_limits"')) continue

        try {
          const record = JSON.parse(line)
          const limits = record.payload?.rate_limits

          if (!limits || typeof limits !== 'object') continue

          const at = Date.parse(record.timestamp) || mtime
          const windows: RateWindow[] = []

          for (const [key, fallback] of [
            ['primary', '5시간'],
            ['secondary', '주간']
          ] as const) {
            const entry = limits[key]

            if (entry && typeof entry.used_percent === 'number') {
              const resetsAt =
                typeof entry.resets_at === 'number'
                  ? entry.resets_at * 1000
                  : typeof entry.resets_in_seconds === 'number'
                    ? at + entry.resets_in_seconds * 1000
                    : null
              windows.push({
                label: windowLabel(entry.window_minutes ?? null, fallback),
                usedPercent: entry.used_percent,
                resetsAt,
                windowMinutes: entry.window_minutes ?? null
              })
            }
          }

          if (windows.length && (!best || at > best.at)) {
            best = { limits: windows, at, plan: typeof limits.plan_type === 'string' ? limits.plan_type : null }
          }

          break
        } catch {
          // partial line
        }
      }
    }
  }

  return best
}

// ---------------------------------------------------------------- Claude

export interface ClaudeLiveSession {
  pid: number
  sessionId: string
  cwd: string
  status: string
  updatedAt: number
  name: string | null
  configDir: string
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Claude Code keeps a live registry of running sessions in <config>/sessions/<pid>.json. */
export function claudeLiveSessions(): ClaudeLiveSession[] {
  const out: ClaudeLiveSession[] = []

  for (const configDir of claudeConfigDirs()) {
    const dir = path.join(configDir, 'sessions')
    let names: string[]

    try {
      names = fs.readdirSync(dir).filter(name => name.endsWith('.json'))
    } catch {
      continue
    }

    for (const name of names) {
      const data = readJson<Record<string, unknown>>(path.join(dir, name))
      const pid = Number(data?.pid)

      if (!data || !pid || !pidAlive(pid)) continue

      out.push({
        pid,
        sessionId: String(data.sessionId || ''),
        cwd: String(data.cwd || ''),
        status: String(data.status || 'unknown'),
        updatedAt: Number(data.updatedAt || data.statusUpdatedAt || data.startedAt || 0),
        name: typeof data.name === 'string' ? data.name : null,
        configDir
      })
    }
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function heraCapsFile(dataDirPath: string): string {
  return path.join(dataDirPath, 'claude-caps.json')
}

function tokenSaverCapsFile(): string {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude-token-saver', 'last-caps.json')
  if (isWin && process.env.APPDATA) return path.join(process.env.APPDATA, 'claude-token-saver', 'last-caps.json')
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'claude-token-saver', 'last-caps.json')

  return path.join(home, '.config', 'claude-token-saver', 'last-caps.json')
}

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5시간',
  seven_day: '주간',
  seven_day_opus: '주간 (Opus)',
  seven_day_sonnet: '주간 (Sonnet)'
}

/**
 * Claude Code only exposes rate-limit utilisation through the statusline stdin
 * contract. HERA reads it from its own statusline tap (opt-in) or from
 * claude-token-saver's cache when that tool is installed.
 */
export function claudeRateLimits(dataDirPath: string): { limits: RateWindow[]; at: number; source: string } | null {
  const candidates: { file: string; source: string }[] = [
    { file: heraCapsFile(dataDirPath), source: 'HERA statusline tap' },
    { file: tokenSaverCapsFile(), source: 'claude-token-saver' }
  ]
  let best: { limits: RateWindow[]; at: number; source: string } | null = null

  for (const { file, source } of candidates) {
    const data = readJson<{ capturedAt?: number; caps?: { windows?: { key: string; usedPct: number; resetsAt?: number | null }[] }; rate_limits?: Record<string, { used_percentage?: number; resets_at?: number }> }>(file)

    if (!data?.capturedAt) continue

    const limits: RateWindow[] = []

    if (data.caps?.windows) {
      for (const window of data.caps.windows) {
        limits.push({
          label: CLAUDE_WINDOW_LABELS[window.key] || window.key,
          usedPercent: Number(window.usedPct) || 0,
          resetsAt: window.resetsAt ? window.resetsAt * 1000 : null,
          windowMinutes: window.key === 'five_hour' ? 300 : window.key.startsWith('seven_day') ? 10080 : null
        })
      }
    } else if (data.rate_limits) {
      for (const [key, window] of Object.entries(data.rate_limits)) {
        limits.push({
          label: CLAUDE_WINDOW_LABELS[key] || key,
          usedPercent: Number(window.used_percentage) || 0,
          resetsAt: window.resets_at ? window.resets_at * 1000 : null,
          windowMinutes: key === 'five_hour' ? 300 : key.startsWith('seven_day') ? 10080 : null
        })
      }
    }

    if (limits.length && (!best || data.capturedAt > best.at)) {
      best = { limits, at: data.capturedAt, source }
    }
  }

  return best
}

// ---------------------------------------------------------------- Antigravity

export interface AgyConversation {
  id: string
  title: string | null
  preview: string | null
  workspace: string | null
  lastAt: number
  lastInputAt: number | null
}

function uriToPath(uri: string): string {
  try {
    if (uri.startsWith('file://')) {
      const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''))

      return isWin ? decoded.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\') : decoded
    }
  } catch {
    // fall through
  }

  return uri
}

let agyCache: { at: number; rows: AgyConversation[] } | null = null

export function agyConversations(): AgyConversation[] {
  if (agyCache && Date.now() - agyCache.at < 30_000) {
    return agyCache.rows
  }

  const db = openSqlite(path.join(agyDir(), 'conversation_summaries.db'))
  let rows: AgyConversation[] = []

  if (db) {
    try {
      const raw = db
        .prepare(
          `SELECT conversation_id, title, preview, workspace_uris, last_modified_time, last_user_input_time
           FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 2000`
        )
        .all() as Record<string, unknown>[]
      rows = raw.map(row => {
        let workspace: string | null = null
        const uris = String(row.workspace_uris || '')

        try {
          const parsed = JSON.parse(uris)
          workspace = Array.isArray(parsed) && parsed[0] ? uriToPath(String(parsed[0])) : null
        } catch {
          workspace = uris ? uriToPath(uris.split(/[,\s]+/)[0]) : null
        }

        const toMs = (value: unknown) => {
          if (typeof value === 'number') return value > 1e12 ? value : value * 1000
          const parsed = Date.parse(String(value || ''))

          return Number.isFinite(parsed) ? parsed : 0
        }

        return {
          id: String(row.conversation_id || ''),
          title: (row.title as string) || null,
          preview: (row.preview as string) || null,
          workspace,
          lastAt: toMs(row.last_modified_time),
          lastInputAt: toMs(row.last_user_input_time) || null
        }
      })
    } catch {
      rows = []
    } finally {
      db.close()
    }
  }

  agyCache = { at: Date.now(), rows }

  return rows
}

export function agyLoggedIn(): boolean | null {
  const log = readTail(path.join(agyDir(), 'cli.log'), 64 * 1024)

  if (!log) return null

  // Every start logs "not logged into Antigravity" while the token still loads from the
  // keyring, then (agy 1.4+) "authenticated successfully as …": the later one wins.
  const lastOut = log.lastIndexOf('not logged into Antigravity')
  const lastIn = Math.max(...['authenticated successfully as', 'authenticated via', 'logged in as', 'Logged in'].map(marker => log.lastIndexOf(marker)))

  if (lastOut < 0 && lastIn < 0) return null

  return lastIn > lastOut
}
