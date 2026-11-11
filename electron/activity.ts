// Live activity: which files each running agent is reading and changing right
// now, how far through its own plan it is, and how much each model has done.
// Read from the transcripts the agent CLIs already write (no hooks, nothing
// installed): only the open agent tabs' files, from where the last read stopped
// (activity-core.ts). This half matches tabs to transcripts and sums it up per project.
import path from 'node:path'

import type { ActivityFile, ActivityRun, ChangedFile, FileChangeDetail, ProjectActivity } from '../shared/types'

import { DONE_KEEP_MS, EDIT_LIVE_MS, newRun, openConversation, pollConversation, READ_LIVE_MS, subState, summarize, type Conversation, type Run } from './activity-core'
import { agentSources, type AgentSource } from './pty-host'
import { laneTranscriptFile, transcriptFile } from './resume'
import { projectById } from './store'
import { worktreeById } from './worktrees'

interface Tracked {
  source: AgentSource
  run: Run
  conversation: Conversation | null
  /** Last time the transcript file was looked for (it appears with the first prompt). */
  lookedAt: number
}

const tracked = new Map<string, Tracked>()

/** Transcript files other tabs follow: a lane must not take another lane's. */
function claimed(except: string): Set<string> {
  const files = new Set<string>()

  for (const [id, entry] of tracked) {
    if (id !== except && entry.conversation) files.add(entry.conversation.tail.file)
  }

  return files
}

function resolveFile(source: AgentSource): string | null {
  if (source.lane) return laneTranscriptFile(source.cwd, source.configDir, source.lane, source.startedAt, claimed(source.sessionId))
  if (!source.conversationId) return null

  return transcriptFile(source.agent.usageProvider, source.cwd, source.configDir, source.conversationId)
}

function sync(now: number) {
  // Only tabs of a project are shown, so only theirs are read.
  const sources = agentSources().filter(source => source.projectId && (source.agent.usageProvider === 'claude' || source.agent.usageProvider === 'codex'))
  const live = new Set(sources.map(source => source.sessionId))

  for (const id of tracked.keys()) {
    if (!live.has(id)) tracked.delete(id)
  }

  for (const source of sources) {
    let entry = tracked.get(source.sessionId)

    // Another agent (or another conversation, after `/clear`) in the same tab starts over.
    if (entry && (entry.source.agent.id !== source.agent.id || (!source.lane && entry.source.conversationId && source.conversationId !== entry.source.conversationId))) {
      tracked.delete(source.sessionId)
      entry = undefined
    }

    // A lane has no conversation id to compare: now and then, see whether a newer lane transcript took over (`/clear`, a restart).
    if (entry?.conversation && source.lane && now - entry.lookedAt > 20_000) {
      entry.lookedAt = now
      const file = resolveFile(source)
      if (file && file !== entry.conversation.tail.file) {
        tracked.delete(source.sessionId)
        entry = undefined
      }
    }

    if (!entry) {
      const label = source.lane ? `lane ${source.lane}` : source.name
      entry = { source, run: newRun(source.sessionId, source.sessionId, null, label, source.agent.id, source.cwd), conversation: null, lookedAt: 0 }
      tracked.set(source.sessionId, entry)
    }

    entry.source = source

    if (!entry.conversation && now - entry.lookedAt > 3000) {
      entry.lookedAt = now
      const file = resolveFile(source)
      if (file) entry.conversation = openConversation(file, source.agent.usageProvider as Conversation['provider'], entry.run)
    }

    if (entry.conversation) pollConversation(entry.conversation, now)
  }
}

// ---- summaries

function within(file: string, root: string | null | undefined): string | null {
  if (!root) return null
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null

  return relative.split(path.sep).join('/')
}

const stateOf = (entry: Tracked): ActivityRun['state'] => (entry.source.status === 'busy' ? 'working' : entry.source.status === 'waiting' ? 'waiting' : 'done')

/** The runs a project shows (its tabs' current work and their subagents'), as long as they are kept. */
function shownRuns(projectId: string, now: number): { run: Run; worktreeId: string | null }[] {
  const out: { run: Run; worktreeId: string | null }[] = []

  for (const entry of tracked.values()) {
    const run = entry.run
    if (entry.source.projectId !== projectId || !run.startedAt) continue
    if (stateOf(entry) === 'done' && now - run.updatedAt > DONE_KEEP_MS) continue
    out.push({ run, worktreeId: entry.source.worktreeId })

    for (const sub of entry.conversation?.subs.values() || []) {
      if (sub.run.startedAt >= run.startedAt - 5000) out.push({ run: sub.run, worktreeId: entry.source.worktreeId })
    }
  }

  return out
}

function projectActivity(projectId: string, entries: Tracked[], now: number): ProjectActivity {
  const runs: ActivityRun[] = []
  const files = new Map<string, ActivityFile & { editors: Set<string>; times: Map<string, number> }>()
  const project = projectById(projectId)

  const collect = (run: Run, state: ActivityRun['state'], worktreeId: string | null) => {
    const working = state !== 'done'
    const worktree = worktreeId ? worktreeById(worktreeId) : null

    for (const [key, item] of run.touches) {
      const age = now - item.at
      const current = item.at >= run.startedAt
      const live = item.kind === 'read' ? age < READ_LIVE_MS : (working && current) || age < EDIT_LIVE_MS
      if (!live) continue

      const inWorktree = worktree ? within(item.path, worktree.path) : null
      const file = files.get(key) || {
        path: item.path,
        rel: inWorktree ?? within(item.path, project?.path),
        worktree: inWorktree !== null && worktree ? worktree.label : null,
        kind: item.kind,
        at: item.at,
        by: [],
        conflict: false,
        added: 0,
        removed: 0,
        editors: new Set<string>(),
        times: new Map<string, number>()
      }
      const change = current ? run.changes.get(key) : undefined
      if (change && !file.times.has(run.id)) {
        file.added += change.added
        file.removed += change.removed
      }
      if (item.kind === 'edit') {
        file.kind = 'edit'
        if (current) file.editors.add(run.id)
      }
      file.at = Math.max(file.at, item.at)
      file.times.set(run.id, item.at)
      files.set(key, file)
    }
  }

  for (const entry of entries) {
    const run = entry.run
    if (!run.startedAt) continue
    const state = stateOf(entry)
    if (state === 'done' && now - run.updatedAt > DONE_KEEP_MS) continue
    const main = summarize(run, state)
    runs.push(main)
    collect(run, state, entry.source.worktreeId)
    let subs = 0
    let subsDone = 0

    for (const sub of entry.conversation?.subs.values() || []) {
      if (sub.run.startedAt < run.startedAt - 5000) continue
      const subRunState = subState(entry.conversation!, sub, state, now)
      runs.push(summarize(sub.run, subRunState))
      collect(sub.run, subRunState, entry.source.worktreeId)
      subs++
      if (subRunState === 'done') subsDone++
    }

    // No plan of its own, but work handed to subagents: how many of them are done is the progress there is.
    if (!main.plan && subs) main.plan = { done: subsDone, total: subs, current: null }
  }

  const changes = { files: 0, added: 0, removed: 0 }
  const changed = new Set<string>()
  for (const { run } of shownRuns(projectId, now)) {
    for (const [key, change] of run.changes) {
      changed.add(key)
      changes.added += change.added
      changes.removed += change.removed
    }
  }
  changes.files = changed.size

  const list = [...files.values()]
    .map(({ editors, times, ...file }) => ({
      ...file,
      by: [...times.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      conflict: editors.size > 1
    }))
    .sort((a, b) => Number(b.conflict) - Number(a.conflict) || b.at - a.at)
    .slice(0, 60)

  return { projectId, runs, files: list, changes, updatedAt: now }
}

// ---- driver

let timer: NodeJS.Timeout | null = null
let visible = true
const lastSent = new Map<string, string>()
let latest = new Map<string, ProjectActivity>()

function tick(notify: (activity: ProjectActivity) => void) {
  const now = Date.now()

  try {
    sync(now)

    const byProject = new Map<string, Tracked[]>()
    for (const entry of tracked.values()) {
      const projectId = entry.source.projectId
      if (projectId) byProject.set(projectId, [...(byProject.get(projectId) || []), entry])
    }

    const next = new Map<string, ProjectActivity>()
    for (const projectId of new Set([...byProject.keys(), ...lastSent.keys()])) {
      const activity = projectActivity(projectId, byProject.get(projectId) || [], now)
      next.set(projectId, activity)
      // Ages are redrawn by the renderer; a file only needs sending again when it changes.
      const signature = JSON.stringify({ runs: activity.runs, changes: activity.changes, files: activity.files.map(file => [file.path, file.kind, file.by, file.conflict, file.at, file.added, file.removed]) })

      if (lastSent.get(projectId) !== signature) {
        lastSent.set(projectId, signature)
        notify(activity)
      }

      // Forgotten only once its tabs are gone and the empty state went out: an idle project is not sent again and again.
      if (!byProject.has(projectId) && !activity.runs.length && !activity.files.length) lastSent.delete(projectId)
    }
    latest = next
  } catch {
    // best effort: a transcript format change must never break the app
  }

  timer = setTimeout(() => tick(notify), visible ? 1500 : 6000)
}

export function startActivity(notify: (activity: ProjectActivity) => void) {
  if (timer) return
  timer = setTimeout(() => tick(notify), 2000)
}

export function stopActivity() {
  if (timer) clearTimeout(timer)
  timer = null
}

/** The window is on screen: follow closely; hidden: just keep up. */
export function setActivityVisible(value: boolean) {
  visible = value
}

const keyOf = (file: string) => (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file))

/** Every file the project's shown work changed, all agents together, newest first. */
export function changedFiles(projectId: string): ChangedFile[] {
  const project = projectById(projectId)
  const files = new Map<string, ChangedFile>()

  for (const { run, worktreeId } of shownRuns(projectId, Date.now())) {
    const worktree = worktreeId ? worktreeById(worktreeId) : null

    for (const [key, change] of run.changes) {
      const inWorktree = worktree ? within(change.path, worktree.path) : null
      const file = files.get(key) || {
        path: change.path,
        rel: inWorktree ?? within(change.path, project?.path),
        worktree: inWorktree !== null && worktree ? worktree.label : null,
        added: 0,
        removed: 0,
        created: false,
        deleted: false,
        by: [],
        at: 0
      }
      file.added += change.added
      file.removed += change.removed
      file.created ||= change.created
      // The newest change says whether the file is still there.
      if (change.at >= file.at) file.deleted = change.deleted
      file.by = [run.id, ...file.by.filter(id => id !== run.id)]
      file.at = Math.max(file.at, change.at)
      files.set(key, file)
    }
  }

  return [...files.values()].sort((a, b) => b.at - a.at)
}

/** What each agent's shown work changed in one file, newest first. */
export function fileChanges(projectId: string, file: string): FileChangeDetail[] {
  const key = keyOf(file)
  const out: FileChangeDetail[] = []

  for (const { run } of shownRuns(projectId, Date.now())) {
    const change = run.changes.get(key)
    if (!change) continue
    out.push({
      runId: run.id,
      label: run.label,
      agentId: run.agentId,
      path: change.path,
      added: change.added,
      removed: change.removed,
      created: change.created,
      deleted: change.deleted,
      hunks: change.hunks,
      truncated: change.truncated,
      at: change.at
    })
  }

  return out.sort((a, b) => b.at - a.at)
}

export function currentActivity(): ProjectActivity[] {
  return [...latest.values()]
}
