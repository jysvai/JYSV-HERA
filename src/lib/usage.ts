import type { AgentUsage, Project, UsageBucket } from '../../shared/types'

export function bucketTokens(bucket: UsageBucket | null | undefined) {
  return bucket ? bucket.input + bucket.output + bucket.cacheWrite + bucket.cacheRead : 0
}

export interface PeriodTotals {
  today: number
  last7: number
  last30: number
  /** Claude only — plan-billed CLIs have no per-token price. */
  costToday: number
  cost30: number
}

function emptyTotals(): PeriodTotals {
  return { today: 0, last7: 0, last30: 0, costToday: 0, cost30: 0 }
}

/** Every AI combined. */
export function overallTotals(usages: AgentUsage[]): PeriodTotals {
  const out = emptyTotals()

  for (const usage of usages) {
    out.today += bucketTokens(usage.today)
    out.last7 += bucketTokens(usage.last7)
    out.last30 += bucketTokens(usage.last30)
    out.costToday += usage.today.costUsd
    out.cost30 += usage.last30.costUsd
  }

  return out
}

export interface ProjectTotals extends PeriodTotals {
  projectId: string
  byAgent: { agentId: string; today: number; last7: number; last30: number; cost30: number }[]
}

/** One project's usage per AI and combined. */
export function projectTotals(usages: AgentUsage[], projectId: string): ProjectTotals {
  const out: ProjectTotals = { projectId, ...emptyTotals(), byAgent: [] }

  for (const usage of usages) {
    const entry = usage.projects?.find(item => item.projectId === projectId)
    if (!entry) continue
    const row = {
      agentId: usage.agentId,
      today: bucketTokens(entry.today),
      last7: bucketTokens(entry.last7),
      last30: bucketTokens(entry.last30),
      cost30: entry.last30.costUsd
    }

    if (!row.last30) continue
    out.byAgent.push(row)
    out.today += row.today
    out.last7 += row.last7
    out.last30 += row.last30
    out.costToday += entry.today.costUsd
    out.cost30 += row.cost30
  }

  return out
}

/** Registered projects with any usage in 30 days, busiest first. */
export function rankedProjects(usages: AgentUsage[], projects: Project[]) {
  return projects
    .map(project => ({ project, totals: projectTotals(usages, project.id) }))
    .filter(entry => entry.totals.last30 > 0)
    .sort((a, b) => b.totals.last30 - a.totals.last30)
}

/** Usage outside every registered project (30 days). */
export function unassignedTotal(usages: AgentUsage[]) {
  return usages.reduce((sum, usage) => sum + bucketTokens(usage.unassigned30), 0)
}

export function formatUsd(value: number) {
  if (!value) return ''

  return value >= 100 ? `≈$${Math.round(value).toLocaleString()}` : `≈$${value.toFixed(2)}`
}
