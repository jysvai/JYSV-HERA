// Project backlog: what happened in a project and when. Everything is computed
// on demand (when a project is selected) and cached briefly — no watchers, no
// polling. Sources: HERA's own launch log, git, file mtimes, and the session
// logs the agent CLIs already write (Claude Code, Codex, Gemini/Antigravity).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { AgentActivity, GitInfo, ProjectInsight } from '../shared/types'
import { clip } from '../shared/util'

import { agyConversations, claudeConfigDirs, codexHomes, codexSessionIndex, readCodexLastPrompt } from './agent-data'
import { readTail } from './paths'
import { getConfig, launches, projectById } from './store'

const cache = new Map<string, ProjectInsight>()
const TTL_MS = 15_000

function run(command: string, args: string[], cwd: string, timeoutMs = 4000): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C.UTF-8' } },
      (error, stdout) => resolve(error ? null : String(stdout))
    )
  })
}

function findGitRoot(dir: string): string | null {
  let current = path.resolve(dir)

  for (let depth = 0; depth < 40; depth++) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current
    }

    const parent = path.dirname(current)

    if (parent === current) {
      return null
    }

    current = parent
  }

  return null
}

export async function gitInfo(dir: string): Promise<GitInfo | null> {
  const root = findGitRoot(dir)

  if (!root) {
    return null
  }

  const [status, log] = await Promise.all([
    run('git', ['status', '--porcelain=v1', '-b', '--untracked-files=normal'], dir),
    run('git', ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%ct'], dir)
  ])

  const info: GitInfo = {
    root,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    changed: 0,
    changedSample: []
  }

  if (status) {
    const lines = status.split(/\r?\n/).filter(Boolean)
    const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : ''
    const match = /^(?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.+)\])?/.exec(head)

    if (match) {
      info.branch = match[1] === 'HEAD' ? 'HEAD (detached)' : match[1]
      info.upstream = match[2] || null
      info.ahead = Number(/ahead (\d+)/.exec(match[3] || '')?.[1] || 0)
      info.behind = Number(/behind (\d+)/.exec(match[3] || '')?.[1] || 0)
    }

    info.changed = lines.length
    info.changedSample = lines.slice(0, 10).map(line => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }))
  }

  if (log?.trim()) {
    const [hash, subject, author, ct] = log.trim().split('\x1f')
    info.lastCommit = { hash, subject, author, when: Number(ct) * 1000 }
  }

  return info
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'venv',
  '.venv',
  '__pycache__',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.idea',
  '.vs',
  '.vscode',
  'coverage',
  'packages',
  'release',
  'Library',
  'Pods'
])

export function recentFiles(dir: string, limit = 8, budget = 4000): { path: string; mtime: number }[] {
  const out: { path: string; mtime: number }[] = []
  const queue: { dir: string; depth: number }[] = [{ dir, depth: 0 }]
  let seen = 0

  while (queue.length && seen < budget) {
    const current = queue.shift()!
    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (++seen > budget) break

      const full = path.join(current.dir, entry.name)

      if (entry.isDirectory()) {
        if (current.depth < 5 && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ dir: full, depth: current.depth + 1 })
        }

        continue
      }

      if (!entry.isFile()) continue

      try {
        out.push({ path: path.relative(dir, full), mtime: fs.statSync(full).mtimeMs })
      } catch {
        // vanished
      }
    }
  }

  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

/** Claude Code stores sessions under projects/<path with non-alphanumerics → '-'>. */
export function claudeProjectDirName(projectPath: string): string {
  return path.resolve(projectPath).replace(/[^A-Za-z0-9]/g, '-')
}

function claudeActivity(projectPath: string): AgentActivity | null {
  const dirName = claudeProjectDirName(projectPath)
  let best: { file: string; mtime: number } | null = null
  let sessions = 0

  for (const configDir of claudeConfigDirs()) {
    const dir = path.join(configDir, 'projects', dirName)
    let files: string[]

    try {
      files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'))
    } catch {
      continue
    }

    sessions += files.length

    for (const name of files) {
      try {
        const mtime = fs.statSync(path.join(dir, name)).mtimeMs

        if (!best || mtime > best.mtime) {
          best = { file: path.join(dir, name), mtime }
        }
      } catch {
        // ignore
      }
    }
  }

  if (!best) {
    return null
  }

  let lastPrompt: string | null = null

  for (const bytes of [96 * 1024, 1024 * 1024]) {
    const lines = readTail(best.file, bytes).split('\n')

    for (let index = lines.length - 1; index >= 0 && !lastPrompt; index--) {
      const line = lines[index]

      if (line.includes('"type":"last-prompt"')) {
        try {
          lastPrompt = clip(String(JSON.parse(line).lastPrompt || ''), 240) || null
        } catch {
          // partial line
        }
      } else if (line.includes('"type":"user"') && line.includes('"role":"user"') && !line.includes('tool_result')) {
        try {
          const content = JSON.parse(line).message?.content
          const text = typeof content === 'string' ? content : Array.isArray(content) ? content.find((part: { type?: string }) => part?.type === 'text')?.text : null

          if (text && !String(text).startsWith('<')) {
            lastPrompt = clip(String(text), 240)
          }
        } catch {
          // partial line
        }
      }
    }

    if (lastPrompt) break
  }

  return {
    agentId: 'claude',
    lastAt: best.mtime,
    lastPrompt,
    sessions,
    sessionId: path.basename(best.file, '.jsonl')
  }
}

function insideProject(cwd: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(cwd))

  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function codexActivity(projectPath: string): AgentActivity | null {
  const matches = codexSessionIndex(codexHomes()).filter(entry => entry.cwd && insideProject(entry.cwd, projectPath))

  if (!matches.length) {
    return null
  }

  const newest = matches.reduce((a, b) => (b.mtime > a.mtime ? b : a))

  return {
    agentId: 'codex',
    lastAt: newest.mtime,
    lastPrompt: readCodexLastPrompt(newest.file),
    sessions: matches.length,
    sessionId: newest.sessionId
  }
}

function agyActivity(projectPath: string): AgentActivity | null {
  const matches = agyConversations().filter(row => row.workspace && insideProject(row.workspace, projectPath))

  if (!matches.length) {
    return null
  }

  const newest = matches[0]

  return {
    agentId: 'agy',
    lastAt: newest.lastAt,
    lastPrompt: clip(newest.title || newest.preview || '', 240) || null,
    sessions: matches.length,
    sessionId: newest.id
  }
}

export async function projectInsight(projectId: string, force = false): Promise<ProjectInsight | null> {
  const project = projectById(projectId)

  if (!project) {
    return null
  }

  const cached = cache.get(projectId)

  if (cached && !force && Date.now() - cached.computedAt < TTL_MS) {
    return cached
  }

  const exists = fs.existsSync(project.path)
  const git = exists ? await gitInfo(project.path) : null
  const projectLaunches = launches()
    .filter(record => record.projectId === projectId)
    .slice(-30)
    .reverse()
  const activity: AgentActivity[] = []

  if (exists) {
    for (const reader of [claudeActivity, codexActivity, agyActivity]) {
      try {
        const entry = reader(project.path)

        if (entry) activity.push(entry)
      } catch {
        // a broken log must not break the panel
      }
    }
  }

  activity.sort((a, b) => b.lastAt - a.lastAt)

  const insight: ProjectInsight = {
    projectId,
    exists,
    git,
    recentFiles: exists && (!git || git.changed === 0) ? recentFiles(project.path) : [],
    activity,
    launches: projectLaunches,
    lastLaunch: projectLaunches[0] || null,
    computedAt: Date.now()
  }

  cache.set(projectId, insight)

  return insight
}

/** Last-activity timestamp per project for sorting the sidebar (cheap: mtimes only). */
export function projectActivityTimes(): Record<string, number> {
  const out: Record<string, number> = {}
  const config = getConfig()
  const codex = codexSessionIndex(codexHomes())

  for (const project of config.projects) {
    let latest = 0

    for (const configDir of claudeConfigDirs()) {
      try {
        latest = Math.max(latest, fs.statSync(path.join(configDir, 'projects', claudeProjectDirName(project.path))).mtimeMs)
      } catch {
        // none
      }
    }

    for (const entry of codex) {
      if (entry.cwd && entry.mtime > latest && insideProject(entry.cwd, project.path)) {
        latest = entry.mtime
      }
    }

    out[project.id] = latest
  }

  return out
}

export function invalidateInsight(projectId?: string) {
  if (projectId) {
    cache.delete(projectId)
  } else {
    cache.clear()
  }
}
