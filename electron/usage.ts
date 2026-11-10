import path from 'node:path'

import { utilityProcess } from 'electron'

import { locale, t } from '../shared/i18n'
import type { AgentUsage, Project, ProjectUsageEntry, RateWindow, UsageBucket } from '../shared/types'
import { localDay } from '../shared/util'

import { agyConversations, agyDir, agyLoggedIn, claudeConfigDirs, claudeRateLimits, codexHomes, codexRateLimits } from './agent-data'
import { dataDir, dataPath } from './paths'
import { claudeCost } from './prices'
import { getConfig, pathAliases } from './store'
import type { ProviderUsageRaw, TokenTally, WorkerResult } from './usage-core'

function emptyBucket(day: string): UsageBucket {
  return { day, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0, costUsd: 0 }
}

function addToBucket(bucket: UsageBucket, tally: TokenTally, cost: number) {
  bucket.input += tally.input
  bucket.output += tally.output
  bucket.cacheWrite += tally.cacheWrite + tally.cacheWrite1h
  bucket.cacheRead += tally.cacheRead
  bucket.messages += tally.messages
  bucket.costUsd += cost
}

function totalTokens(tally: TokenTally): number {
  return tally.input + tally.output + tally.cacheWrite + tally.cacheWrite1h + tally.cacheRead
}

/** Folder → registered project (deepest match wins, so nested projects count separately). */
function projectMatcher(projects: Project[], aliases: { root: string; projectId: string }[] = []) {
  const norm = (p: string) => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, '')

    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const roots = [
    ...projects.map(project => ({ project, root: norm(project.path) })),
    // A worktree of a project counts as the project.
    ...aliases.flatMap(alias => {
      const project = projects.find(entry => entry.id === alias.projectId)
      return project ? [{ project, root: norm(alias.root) }] : []
    })
  ].sort((a, b) => b.root.length - a.root.length)
  const cache = new Map<string, Project | null>()

  return (cwd: string): Project | null => {
    if (!cwd) return null
    if (cache.has(cwd)) return cache.get(cwd)!
    const target = norm(cwd)
    const found = roots.find(({ root }) => target === root || target.startsWith(root + path.sep))?.project || null
    cache.set(cwd, found)

    return found
  }
}

function summarize(
  agentId: string,
  provider: AgentUsage['provider'],
  raw: ProviderUsageRaw,
  cost: (model: string, tally: TokenTally) => number,
  projectOf: (cwd: string) => Project | null
): AgentUsage {
  const now = Date.now()
  const today = localDay(now)
  const day7 = localDay(now - 6 * 86_400_000)
  const day30 = localDay(now - 29 * 86_400_000)
  const usage: AgentUsage = {
    agentId,
    provider,
    available: raw.files > 0,
    today: emptyBucket(today),
    last7: emptyBucket(day7),
    last30: emptyBucket(day30),
    daily: [],
    byModel: [],
    byProject: [],
    projects: [],
    unassigned30: emptyBucket(day30),
    window5h: { tokens: 0, messages: 0, startedAt: null },
    limits: [],
    updatedAt: now
  }
  const models = new Map<string, { tokens: number; costUsd: number }>()

  for (let offset = 29; offset >= 0; offset--) {
    usage.daily.push(emptyBucket(localDay(now - offset * 86_400_000)))
  }

  for (const [day, byModel] of Object.entries(raw.days)) {
    const daily = usage.daily.find(bucket => bucket.day === day)

    for (const [model, tally] of Object.entries(byModel)) {
      const c = cost(model, tally)

      if (daily) addToBucket(daily, tally, c)
      if (day === today) addToBucket(usage.today, tally, c)
      if (day >= day7) addToBucket(usage.last7, tally, c)
      if (day >= day30) {
        addToBucket(usage.last30, tally, c)
        const entry = models.get(model) || { tokens: 0, costUsd: 0 }
        entry.tokens += totalTokens(tally)
        entry.costUsd += c
        models.set(model, entry)
      }
    }
  }

  usage.byModel = [...models.entries()]
    .map(([model, entry]) => ({ model, ...entry }))
    .sort((a, b) => b.tokens - a.tokens)

  // Per folder → per registered project, by period.
  const perProject = new Map<string, ProjectUsageEntry>()
  const byFolder = new Map<string, { tokens: number; costUsd: number }>()

  for (const [cwd, days] of Object.entries(raw.cwdDays)) {
    const project = projectOf(cwd)
    const entry = project
      ? perProject.get(project.id) || { projectId: project.id, today: emptyBucket(today), last7: emptyBucket(day7), last30: emptyBucket(day30) }
      : null
    if (project && entry) perProject.set(project.id, entry)
    const label = project?.name || cwd || t('(알 수 없는 폴더)')
    const folder = byFolder.get(label) || { tokens: 0, costUsd: 0 }
    byFolder.set(label, folder)

    for (const [day, byModel] of Object.entries(days)) {
      if (day < day30) continue

      for (const [model, tally] of Object.entries(byModel)) {
        const c = cost(model, tally)
        folder.tokens += totalTokens(tally)
        folder.costUsd += c

        if (!entry) {
          addToBucket(usage.unassigned30, tally, c)
          continue
        }

        addToBucket(entry.last30, tally, c)
        if (day >= day7) addToBucket(entry.last7, tally, c)
        if (day === today) addToBucket(entry.today, tally, c)
      }
    }
  }

  usage.projects = [...perProject.values()]
  usage.byProject = [...byFolder.entries()]
    .map(([label, entry]) => ({ path: label, ...entry }))
    .filter(entry => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 12)

  // Rolling 5h window from hourly buckets (approximate to the hour).
  const windowStart = now - 5 * 3_600_000

  for (const [hour, tokens] of Object.entries(raw.hours)) {
    if (Number(hour) + 3_600_000 > windowStart) {
      usage.window5h.tokens += tokens
      usage.window5h.startedAt = Math.min(usage.window5h.startedAt ?? Number(hour), Number(hour))
    }
  }

  return usage
}

let running: Promise<WorkerResult> | null = null
let lastRaw: { at: number; result: WorkerResult } | null = null
let lastResult: { at: number; key: string; usages: AgentUsage[] } | null = null

/** Per-project splits depend on the registered folders, not only on the logs. */
function projectsKey() {
  return getConfig()
    .projects.map(project => `${project.id}=${project.path}`)
    .join('|')
}

function runWorker(): Promise<WorkerResult> {
  if (running) return running

  running = new Promise<WorkerResult>((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'usage-worker.js'), [], {
      serviceName: 'HERA usage',
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('usage worker timeout'))
      // What it had parsed is checkpointed, so the next poll continues from there.
    }, 300_000)

    child.on('message', (message: { ok: boolean; result?: WorkerResult; error?: string }) => {
      clearTimeout(timer)
      message.ok && message.result ? resolve(message.result) : reject(new Error(message.error || 'usage worker failed'))
      // The worker stays alive until its answer has arrived here.
      child.kill()
    })
    child.on('exit', () => {
      clearTimeout(timer)
      reject(new Error('usage worker exited'))
    })
    child.postMessage({
      cacheFile: dataPath('usage-cache.json'),
      claudeDirs: claudeConfigDirs(),
      codexHomes: codexHomes(),
      agyDir: agyDir(),
      // Antigravity's transcripts do not say which folder they ran in; its index does.
      agyWorkspaces: Object.fromEntries(agyConversations().flatMap(row => (row.workspace ? [[row.id, row.workspace]] : []))),
      maxAgeDays: 31
    })
  }).finally(() => {
    running = null
  })

  return running
}

export async function getUsage(force = false): Promise<AgentUsage[]> {
  const key = projectsKey()
  // Each parse is a short-lived ~100 MB worker, so tokens are re-parsed at most every
  // 4 minutes (the refresh button forces one). The status bar asks every minute, and
  // limits are read fresh on every call.
  const fresh = (at: number) => Date.now() - at < 4 * 60_000

  if (!force && lastResult && fresh(lastResult.at) && lastResult.key === key) {
    return withLimits(lastResult.usages)
  }

  const projectOf = projectMatcher(getConfig().projects, pathAliases())
  // A project added/removed only needs a re-split of the parsed logs, not a re-parse.
  const started = Date.now()
  let result: WorkerResult

  try {
    result = !force && lastRaw && fresh(lastRaw.at) ? lastRaw.result : await runWorker()
  } catch (error) {
    // A failed parse keeps the last numbers on screen, and the next poll tries again.
    // Only the refresh button, where someone is waiting for the answer, reports it.
    if (force || !lastResult) throw error

    return withLimits(lastResult.usages)
  }

  // Stamped with the start of the parse: what it read is that old, not the moment it finished.
  if (result !== lastRaw?.result) lastRaw = { at: started, result }
  const usages: AgentUsage[] = []

  usages.push(summarize('claude', 'claude', result.claude, claudeCost, projectOf))

  const codex = summarize('codex', 'codex', result.codex, () => 0, projectOf)
  codex.note = t('비용은 플랜 요금제라 표시하지 않습니다 (토큰만 집계).')
  usages.push(codex)

  const agy = summarize('agy', 'agy', result.agy, () => 0, projectOf)
  agy.available = result.agy.files > 0 || agyConversations().length > 0
  agy.note =
    agyLoggedIn() === false
      ? t('토큰은 로컬 기록에서 집계합니다. 남은 한도(%)와 비용은 로컬 기록에 없습니다 · 현재 로그인되어 있지 않음.')
      : t('토큰은 로컬 기록에서 집계합니다. 남은 한도(%)와 비용은 로컬 기록에 없습니다.')
  usages.push(agy)

  lastResult = { at: lastRaw?.at ?? Date.now(), key, usages }

  return withLimits(usages)
}

// A snapshot can be unreadable for a moment while a CLI rewrites it, which must not blank the bars.
let lastClaudeLimits: ReturnType<typeof claudeRateLimits> = null
let lastCodexLimits: ReturnType<typeof codexRateLimits> = null

/** A window past its reset says nothing about what is used now. */
function unexpired(limits: RateWindow[] | undefined): RateWindow[] {
  const now = Date.now()

  return (limits || []).filter(limit => !limit.resetsAt || limit.resetsAt > now)
}

/** Limits are small files the CLIs keep current, so they are read on every request, not cached with the tokens. */
function withLimits(usages: AgentUsage[]): AgentUsage[] {
  const claude = usages.find(entry => entry.agentId === 'claude')
  const codex = usages.find(entry => entry.agentId === 'codex')

  if (claude) {
    const limits = (lastClaudeLimits = claudeRateLimits(dataDir()) || lastClaudeLimits)

    claude.limits = unexpired(limits?.limits)
    claude.limitsSource = limits ? `${limits.source} · ${new Date(limits.at).toLocaleTimeString(locale())}` : undefined
    claude.note = limits ? undefined : t('한도 %는 Claude Code 상태줄 연동(설정 → Claude 한도 연동)을 켜면 표시됩니다.')
  }

  if (codex) {
    const limits = (lastCodexLimits = codexRateLimits(codexHomes()) || lastCodexLimits)

    codex.limits = unexpired(limits?.limits)
    codex.limitsSource = limits ? `${t('Codex 세션 로그')} · ${new Date(limits.at).toLocaleTimeString(locale())}${limits.plan ? ` · ${limits.plan}` : ''}` : undefined
  }

  return usages
}
