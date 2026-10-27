import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { formatTokens } from '../../../shared/util'
import { cn } from '../../lib/cn'
import { formatUsd, overallTotals, projectTotals, rankedProjects, unassignedTotal, type PeriodTotals } from '../../lib/usage'
import { $config, $projectId, $rightTab, $usage, $view, loadUsage } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

function Cell({ label, value, sub, strong }: { label: string; value: number; sub?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-(--ui-text-tertiary)">{label}</div>
      <div className={cn('tabular-nums', strong ? 'text-[17px] font-semibold' : 'text-[13px] font-medium')}>{formatTokens(value)}</div>
      {sub && <div className="truncate text-[10.5px] text-(--ui-text-tertiary) tabular-nums">{sub}</div>}
    </div>
  )
}

/** All AIs combined: today / 7 days / 30 days. */
export function OverallTotals({ className }: { className?: string }) {
  const usages = useStore($usage)

  if (!usages) return null
  const totals: PeriodTotals = overallTotals(usages)

  return (
    <div className={cn('rounded-lg bg-(--ui-bg-quaternary) px-3 py-3', className)}>
      <div className="mb-2 text-[12.5px] font-semibold">전체 합계 · 모든 AI</div>
      <div className="grid grid-cols-3 gap-2">
        <Cell label="오늘" value={totals.today} sub={formatUsd(totals.costToday)} strong />
        <Cell label="7일" value={totals.last7} strong />
        <Cell label="30일" value={totals.last30} sub={formatUsd(totals.cost30)} strong />
      </div>
    </div>
  )
}

/** Registered projects by 30-day usage, with today and a share bar. */
export function ProjectRanking({ limit, className }: { limit?: number; className?: string }) {
  const usages = useStore($usage)
  const config = useStore($config)

  if (!usages || !config) return null
  const ranked = rankedProjects(usages, config.projects)
  const shown = limit ? ranked.slice(0, limit) : ranked
  const total = overallTotals(usages).last30 || 1
  const outside = unassignedTotal(usages)

  return (
    <div className={cn('rounded-lg bg-(--ui-bg-quaternary) px-3 py-3', className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12.5px] font-semibold">프로젝트별 (30일)</span>
        <span className="text-[10.5px] text-(--ui-text-tertiary)">오늘 · 30일 · 전체 대비</span>
      </div>
      {!shown.length && <div className="py-2 text-[11.5px] text-(--ui-text-tertiary)">등록된 프로젝트에서 쓴 기록이 아직 없습니다.</div>}
      <ul className="space-y-2">
        {shown.map(({ project, totals }) => {
          const share = Math.round((totals.last30 / total) * 100)

          return (
            <li key={project.id}>
              <button
                type="button"
                className="group w-full text-left"
                onClick={() => {
                  $projectId.set(project.id)
                  $rightTab.set('backlog')
                  $view.set('workspace')
                }}
              >
                <div className="flex items-baseline gap-2 text-[12px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color || 'var(--ui-stroke-primary)' }} />
                  <span className="min-w-0 flex-1 truncate font-medium group-hover:text-(--ui-accent-text)">{project.name}</span>
                  <span className="shrink-0 text-(--ui-text-tertiary) tabular-nums">{totals.today ? formatTokens(totals.today) : '–'}</span>
                  <span className="w-14 shrink-0 text-right tabular-nums">{formatTokens(totals.last30)}</span>
                  <span className="w-8 shrink-0 text-right text-(--ui-text-tertiary) tabular-nums">{share}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-(--ui-bg-quaternary)">
                  <div className="h-full rounded-full bg-(--ui-accent)" style={{ width: `${Math.max(2, share)}%` }} />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {ranked.length > shown.length && <div className="mt-2 text-[11px] text-(--ui-text-tertiary)">외 {ranked.length - shown.length}개 프로젝트 — “자세히”에서 전체 보기</div>}
      {outside > 0 && <div className="mt-2 text-[11px] text-(--ui-text-tertiary)">등록 안 된 폴더: {formatTokens(outside)} (30일)</div>}
    </div>
  )
}

/** This project's usage per AI, for the backlog panel. */
export function ProjectUsageSection({ projectId }: { projectId: string }) {
  const usages = useStore($usage)
  const config = useStore($config)

  useEffect(() => {
    if (!$usage.get()) void loadUsage(false).catch(() => undefined)
  }, [])

  if (!usages) return <div className="text-[12px] text-(--ui-text-tertiary)">사용량을 집계하는 중…</div>

  const totals = projectTotals(usages, projectId)
  const all = overallTotals(usages).last30 || 1
  const agentOf = (id: string) => config?.agents.find(agent => agent.id === id) || null

  if (!totals.last30) return <div className="text-[12px] text-(--ui-text-tertiary)">최근 30일 동안 이 프로젝트에서 AI 토큰 사용 기록이 없습니다.</div>

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Cell label="오늘" value={totals.today} sub={formatUsd(totals.costToday)} strong />
        <Cell label="7일" value={totals.last7} strong />
        <Cell label="30일" value={totals.last30} sub={formatUsd(totals.cost30)} strong />
      </div>
      <table className="w-full text-[11.5px] tabular-nums">
        <thead>
          <tr className="text-(--ui-text-tertiary)">
            <th className="py-0.5 text-left font-normal">AI</th>
            <th className="py-0.5 text-right font-normal">오늘</th>
            <th className="py-0.5 text-right font-normal">7일</th>
            <th className="py-0.5 text-right font-normal">30일</th>
          </tr>
        </thead>
        <tbody>
          {totals.byAgent.map(row => (
            <tr key={row.agentId}>
              <td className="py-0.5">
                <span className="flex items-center gap-1.5">
                  <AgentGlyph agent={agentOf(row.agentId)} size={13} />
                  {agentOf(row.agentId)?.name || row.agentId}
                </span>
              </td>
              <td className="py-0.5 text-right">{row.today ? formatTokens(row.today) : '–'}</td>
              <td className="py-0.5 text-right">{formatTokens(row.last7)}</td>
              <td className="py-0.5 text-right">{formatTokens(row.last30)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-(--ui-text-tertiary)">
        전체 AI 사용량(30일)의 {Math.round((totals.last30 / all) * 100)}% · 하위 폴더 포함 · 토큰은 캐시 읽기 포함
      </div>
    </div>
  )
}
