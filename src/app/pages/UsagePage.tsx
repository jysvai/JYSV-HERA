import { useStore } from '@nanostores/react'
import { IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { AgentUsage, RateWindow, UsageBucket } from '../../../shared/types'
import { formatTokens } from '../../../shared/util'
import { Button, PageHeader, Section } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { $config, $usage, $view, $windowVisible, loadUsage } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'
import { OverallTotals, ProjectRanking } from './usage-parts'

function bucketTokens(bucket: UsageBucket) {
  return bucket.input + bucket.output + bucket.cacheWrite + bucket.cacheRead
}

function resetText(at: number | null) {
  if (!at) return ''
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60000))

  if (minutes < 60) return t('{minutes}분 후 초기화', { minutes })
  if (minutes < 60 * 24) return t('{hours}시간 {minutes}분 후 초기화', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })

  return t('{date} 초기화', { date: new Date(at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
}

export function LimitBar({ limit, warn = 80, compact = false }: { limit: RateWindow; warn?: number; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, limit.usedPercent))
  const tone = pct >= 95 ? 'bg-(--status-waiting)' : pct >= warn ? 'bg-(--status-busy)' : 'bg-(--ui-accent)'

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium">{limit.label}</span>
        <span className="tabular-nums">
          {pct.toFixed(0)}%{!compact && <span className="ml-2 text-[11px] text-(--ui-text-tertiary)">{resetText(limit.resetsAt)}</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-(--ui-bg-quaternary)">
        <div className={cn('h-full rounded-full transition-[width] duration-300', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function DailyChart({ daily, height = 'h-24' }: { daily: UsageBucket[]; height?: string }) {
  const max = Math.max(1, ...daily.map(bucketTokens))

  return (
    <div className={cn('flex items-end gap-[3px]', height)}>
      {daily.map(bucket => {
        const value = bucketTokens(bucket)

        return (
          <div key={bucket.day} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-sm bg-(--ui-accent)/70 group-hover:bg-(--ui-accent)"
              style={{ height: `${value ? Math.max(3, (value / max) * 100) : 0}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded bg-(--ui-bg-elevated) px-2 py-1 text-[11px] whitespace-nowrap opacity-0 shadow-nous group-hover:opacity-100">
              {bucket.day} · {t('{tokens} 토큰', { tokens: formatTokens(value) })}{bucket.costUsd ? ` · $${bucket.costUsd.toFixed(2)}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, bucket, showCost }: { label: string; bucket: UsageBucket; showCost: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-(--ui-text-tertiary)">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{formatTokens(bucketTokens(bucket))}</div>
      <div className="text-[11px] text-(--ui-text-tertiary) tabular-nums">
        {t('{count} 응답', { count: bucket.messages.toLocaleString() })}{showCost && bucket.costUsd > 0 ? ` · ≈$${bucket.costUsd.toFixed(2)}` : ''}
      </div>
    </div>
  )
}

function AgentCard({ usage }: { usage: AgentUsage }) {
  const config = useStore($config)
  const agent = config?.agents.find(entry => entry.id === usage.agentId) || null
  const showCost = usage.provider === 'claude'

  return (
    <div className="rounded-xl bg-(--ui-bg-quaternary) p-5">
      <div className="mb-4 flex items-center gap-2">
        <AgentGlyph agent={agent} size={20} />
        <div className="text-[15px] font-semibold">{agent?.name || usage.agentId}</div>
        {!usage.available && <span className="text-[11.5px] text-(--ui-text-tertiary)">· {t('로컬 기록 없음')}</span>}
      </div>

      {usage.limits.length > 0 && (
        <div className="mb-5 space-y-3">
          {usage.limits.map(limit => (
            <LimitBar key={limit.label} limit={limit} warn={config?.settings.usageWarnPercent} />
          ))}
          {usage.limitsSource && <div className="text-[10.5px] text-(--ui-text-tertiary)">{t('출처: {source}', { source: usage.limitsSource })}</div>}
        </div>
      )}

      {usage.available && usage.provider !== 'agy' && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label={t('오늘')} bucket={usage.today} showCost={showCost} />
            <Stat label={t('최근 7일')} bucket={usage.last7} showCost={showCost} />
            <Stat label={t('최근 30일')} bucket={usage.last30} showCost={showCost} />
          </div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-(--ui-text-tertiary)">
            <span>{t('최근 30일 일별 토큰')}</span>
            <span>{t('최근 5시간 {tokens}', { tokens: formatTokens(usage.window5h.tokens) })}</span>
          </div>
          <DailyChart daily={usage.daily} />
          <div className="mt-4 grid grid-cols-2 gap-5">
            <Section title={t('모델별 (30일)')} className="py-0">
              <ul className="space-y-1 text-[12px]">
                {usage.byModel.slice(0, 6).map(entry => (
                  <li key={entry.model} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-[11.5px] text-(--ui-text-secondary)">{entry.model}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatTokens(entry.tokens)}
                      {showCost && entry.costUsd > 0 && <span className="ml-1.5 text-(--ui-text-tertiary)">${entry.costUsd.toFixed(1)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title={t('폴더별 (30일)')} className="py-0">
              <ul className="space-y-1 text-[12px]">
                {usage.byProject.slice(0, 6).map(entry => (
                  <li key={entry.path} className="flex justify-between gap-2">
                    <span className="truncate text-(--ui-text-secondary)">{entry.path}</span>
                    <span className="shrink-0 tabular-nums">{formatTokens(entry.tokens)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}
      {usage.note && <div className="mt-4 text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">{usage.note}</div>}
    </div>
  )
}

function useUsage(refreshMs: number) {
  const usages = useStore($usage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (force = false) => {
    setLoading(true)
    setError(null)
    void loadUsage(force)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // Refresh only while this view is open (limits are fresh each time; tokens every 4 minutes).
    const timer = setInterval(() => $windowVisible.get() && load(), refreshMs)

    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { usages, loading, error, load }
}

const FIRST_RUN = t('기록을 집계하는 중… 처음 한 번은 기록 양에 따라 수십 초~수 분 걸립니다 (별도 프로세스라 터미널 작업에는 영향 없음). 이후에는 새로 추가된 부분만 읽어 바로 열립니다.')

export function UsagePage() {
  const { usages, loading, error, load } = useUsage(90_000)

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('사용량')}
        description={t('각 AI CLI 가 로컬에 남긴 기록을 별도 프로세스에서 증분 집계합니다 (네트워크 호출 없음). 비용은 API 정가 환산 추정치입니다.')}
        actions={
          <Button size="sm" onClick={() => load(true)} disabled={loading}>
            <IconRefresh className={loading ? 'animate-spin' : undefined} /> {t('새로고침')}
          </Button>
        }
      />
      {error && <div className="mb-4 rounded-md bg-(--status-waiting)/12 px-3 py-2 text-[12px] text-(--status-waiting)">{error}</div>}
      {!usages ? (
        <div className="py-16 text-center text-[12.5px] text-(--ui-text-tertiary)">{FIRST_RUN}</div>
      ) : (
        <>
          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <OverallTotals className="rounded-xl p-5" />
            <ProjectRanking className="rounded-xl p-5 xl:row-span-2" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {usages.map(usage => (
              <AgentCard key={usage.agentId} usage={usage} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Compact usage for the right-hand panel: limits first, then today/7d/30d and a 14-day strip. */
function UsageMini({ usage }: { usage: AgentUsage }) {
  const config = useStore($config)
  const agent = config?.agents.find(entry => entry.id === usage.agentId) || null
  const tokens = usage.provider !== 'agy' && usage.available
  const showCost = usage.provider === 'claude'

  return (
    <div className="rounded-lg bg-(--ui-bg-quaternary) px-3 py-3">
      <div className="mb-2.5 flex items-center gap-2">
        <AgentGlyph agent={agent} size={16} />
        <span className="truncate text-[13px] font-semibold">{agent?.name || usage.agentId}</span>
        {tokens && (
          <span className="ml-auto shrink-0 text-[11.5px] text-(--ui-text-secondary) tabular-nums">
            {t('오늘 {tokens}', { tokens: formatTokens(bucketTokens(usage.today)) })}
            {showCost && usage.today.costUsd > 0 ? ` · ≈$${usage.today.costUsd.toFixed(2)}` : ''}
          </span>
        )}
      </div>

      {usage.limits.length > 0 && (
        <div className="space-y-2.5">
          {usage.limits.map(limit => (
            <LimitBar key={limit.label} limit={limit} warn={config?.settings.usageWarnPercent} />
          ))}
        </div>
      )}

      {tokens && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-(--ui-text-tertiary)">
            <div>
              {t('최근 5시간')}
              <div className="text-[13px] font-medium text-(--ui-text-primary) tabular-nums">{formatTokens(usage.window5h.tokens)}</div>
            </div>
            <div>
              {t('7일')}
              <div className="text-[13px] font-medium text-(--ui-text-primary) tabular-nums">{formatTokens(bucketTokens(usage.last7))}</div>
            </div>
            <div>
              {t('30일')}
              <div className="text-[13px] font-medium text-(--ui-text-primary) tabular-nums">{formatTokens(bucketTokens(usage.last30))}</div>
            </div>
          </div>
          <div className="mt-2.5">
            <DailyChart daily={usage.daily.slice(-14)} height="h-10" />
          </div>
        </>
      )}

      {!tokens && !usage.limits.length && usage.note && <div className="text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">{usage.note}</div>}
    </div>
  )
}

export function UsagePanel() {
  const { usages, loading, error, load } = useUsage(60_000)
  const config = useStore($config)
  const nameOf = (id: string) => config?.agents.find(agent => agent.id === id)?.name || id
  const shown = usages?.filter(usage => usage.available || usage.limits.length) || []
  const idle = usages?.filter(usage => !usage.available && !usage.limits.length) || []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{t('AI 사용량')}</div>
          <div className="text-[11px] text-(--ui-text-tertiary)">{t('한도 · 토큰 · 프로젝트별 (5분마다 갱신, ↻ 즉시)')}</div>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label={t('새로고침')} onClick={() => load(true)} disabled={loading}>
          <IconRefresh className={loading ? 'animate-spin' : undefined} />
        </Button>
        <Button size="xs" variant="outline" onClick={() => $view.set('usage')}>
          {t('자세히')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-x-hidden overflow-y-auto px-4 pb-6">
        {error && <div className="rounded-md bg-(--status-waiting)/12 px-3 py-2 text-[12px] text-(--status-waiting)">{error}</div>}
        {!usages ? (
          <div className="py-10 text-center text-[12px] leading-relaxed text-(--ui-text-tertiary)">{FIRST_RUN}</div>
        ) : (
          <>
            <OverallTotals />
            <ProjectRanking limit={6} />
            {shown.map(usage => (
              <UsageMini key={usage.agentId} usage={usage} />
            ))}
          </>
        )}
        {idle.length > 0 && <div className="px-1 pt-1 text-[11px] text-(--ui-text-tertiary)">{t('기록 없음: {names}', { names: idle.map(usage => nameOf(usage.agentId)).join(', ') })}</div>}
      </div>
    </div>
  )
}
