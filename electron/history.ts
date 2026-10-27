// Unified prompt history: "what did I ask, where, and when" across agents.
import fs from 'node:fs'
import path from 'node:path'

import type { HistoryHit } from '../shared/types'
import { clip } from '../shared/util'

import { agyDir, claudeConfigDirs, codexHomes, codexSessionIndex } from './agent-data'
import { home, readTail } from './paths'

interface Source {
  agentId: string
  file: string
  map: (row: Record<string, unknown>) => HistoryHit | null
}

function sources(): Source[] {
  const out: Source[] = []
  // Codex's history.jsonl has no folder, only the session id; its session files know the cwd.
  let codexCwd: Map<string, string> | null = null
  const cwdOfCodexSession = (id: unknown): string | null => {
    codexCwd ??= new Map(codexSessionIndex(codexHomes()).flatMap(entry => (entry.sessionId && entry.cwd ? [[entry.sessionId, entry.cwd] as [string, string]] : [])))

    return typeof id === 'string' ? codexCwd.get(id) || null : null
  }

  for (const dir of claudeConfigDirs()) {
    out.push({
      agentId: 'claude',
      file: path.join(dir, 'history.jsonl'),
      map: row =>
        typeof row.display === 'string'
          ? { agentId: 'claude', t: Number(row.timestamp) || 0, text: row.display, project: (row.project as string) || null }
          : null
    })
  }

  // Claude also keeps ~/.claude.json-adjacent history when CLAUDE_CONFIG_DIR is unset.
  if (!claudeConfigDirs().some(dir => dir === path.join(home, '.claude'))) {
    out.push({
      agentId: 'claude',
      file: path.join(home, '.claude', 'history.jsonl'),
      map: row => (typeof row.display === 'string' ? { agentId: 'claude', t: Number(row.timestamp) || 0, text: row.display, project: (row.project as string) || null } : null)
    })
  }

  for (const dir of codexHomes()) {
    out.push({
      agentId: 'codex',
      file: path.join(dir, 'history.jsonl'),
      map: row =>
        typeof row.text === 'string'
          ? { agentId: 'codex', t: (Number(row.ts) || 0) * (Number(row.ts) > 1e12 ? 1 : 1000), text: row.text, project: cwdOfCodexSession(row.session_id) }
          : null
    })
  }

  out.push({
    agentId: 'agy',
    file: path.join(agyDir(), 'history.jsonl'),
    map: row =>
      typeof row.display === 'string'
        ? {
            agentId: 'agy',
            t: typeof row.timestamp === 'number' ? row.timestamp : Date.parse(String(row.timestamp)) || 0,
            text: row.display,
            project: (row.workspace as string) || null
          }
        : null
  })

  return out
}

/** Newest first. The page groups them by folder, so it asks for a long list. */
export function searchHistory(query: string, limit = 1500): HistoryHit[] {
  const needle = query.trim().toLowerCase()
  const hits: HistoryHit[] = []

  for (const source of sources()) {
    if (!fs.existsSync(source.file)) continue

    // Recent history is what people search for; cap the read at 6MB per source.
    for (const line of readTail(source.file, 6 * 1024 * 1024).split('\n')) {
      if (!line || (needle && !line.toLowerCase().includes(needle))) continue

      try {
        const hit = source.map(JSON.parse(line))

        if (hit && (!needle || hit.text.toLowerCase().includes(needle) || hit.project?.toLowerCase().includes(needle))) {
          hits.push({ ...hit, text: clip(hit.text, 400) })
        }
      } catch {
        // skip partial lines
      }
    }
  }

  return hits.sort((a, b) => b.t - a.t).slice(0, limit)
}
