import { useStore } from '@nanostores/react'
import { IconChartBar, IconCommand, IconMoon, IconSearch, IconSun } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import type { AgentUsage, AppMetrics } from '../../../shared/types'
import { formatBytesKB } from '../../../shared/util'
import { Button, Kbd, Tip } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api, isMac, isWin } from '../../lib/hera'
import { $config, $palette, $project, $sessions, $usage, $view, $windowVisible, loadUsage, toggleRightTab } from '../../store/app'
import { $theme, toggleThemeMode } from '../../store/theme'

export function Titlebar() {
  const project = useStore($project)
  const view = useStore($view)
  const mode = useStore($theme)?.mode || 'dark'

  return (
    <header className={cn('drag flex h-[38px] shrink-0 items-center gap-3 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-chrome)', isMac ? 'pl-[84px]' : 'pl-3', isWin ? 'pr-[140px]' : 'pr-3')}>
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight text-(--ui-accent-text)">HERA</span>
        <span className="text-[11px] text-(--ui-text-tertiary)">JYSV</span>
      </div>
      <div className="min-w-0 truncate text-[12.5px] text-(--ui-text-secondary)">{view === 'workspace' && project ? project.name : ''}</div>
      <button
        type="button"
        onClick={() => $palette.set(true)}
        className="no-drag mx-auto flex h-6 w-80 max-w-[40vw] items-center gap-2 rounded-md bg-(--ui-bg-quaternary) px-2.5 text-[12px] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)"
      >
        <IconSearch size={13} />
        <span className="flex-1 text-left">검색 · 실행</span>
        <Kbd>{isMac ? '⌘K' : 'Ctrl+K'}</Kbd>
      </button>
      <div className="no-drag flex w-24 items-center justify-end gap-0.5">
        <Tip label="사용량 패널">
          <Button size="icon-sm" variant="ghost" aria-label="사용량 패널" onClick={() => toggleRightTab('usage')}>
            <IconChartBar />
          </Button>
        </Tip>
        <Tip label={mode === 'dark' ? '라이트 모드로' : '다크 모드로'}>
          <Button size="icon-sm" variant="ghost" aria-label="다크/라이트 전환" onClick={toggleThemeMode}>
            {mode === 'dark' ? <IconSun /> : <IconMoon />}
          </Button>
        </Tip>
      </div>
    </header>
  )
}

/** The most constrained window (highest %) is the one worth a glance. */
function tightest(usage: AgentUsage) {
  return [...usage.limits].sort((a, b) => b.usedPercent - a.usedPercent)[0]
}

export function Statusbar() {
  const sessions = useStore($sessions)
  const config = useStore($config)
  const visible = useStore($windowVisible)
  const [metrics, setMetrics] = useState<AppMetrics | null>(null)
  const usage = useStore($usage) || []

  useEffect(() => {
    if (!visible) return
    const loadMetrics = () => void api.metrics().then(setMetrics)
    // Main re-parses tokens at most every 4 minutes, so each poll here gets fresh numbers.
    const refreshUsage = () => void loadUsage(false).catch(() => undefined)
    loadMetrics()
    const usageDelay = setTimeout(refreshUsage, 4000)
    const metricsTimer = setInterval(loadMetrics, 15_000)
    const usageTimer = setInterval(refreshUsage, 5 * 60_000)

    return () => {
      clearTimeout(usageDelay)
      clearInterval(metricsTimer)
      clearInterval(usageTimer)
    }
  }, [visible])

  const live = Object.values(sessions).filter(session => !session.dormant && session.status !== 'exited')
  const busy = live.filter(session => session.status === 'busy').length
  const waiting = live.filter(session => session.status === 'waiting').length
  const warnAt = config?.settings.usageWarnPercent ?? 80
  const limits = usage
    .filter(entry => entry.limits.length)
    .map(entry => ({ entry, name: config?.agents.find(agent => agent.id === entry.agentId)?.name || entry.agentId, limit: tightest(entry) }))

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg-chrome) px-3 text-[11px] text-(--ui-text-tertiary)">
      <button type="button" className="flex items-center gap-1.5 hover:text-(--ui-text-secondary)" onClick={() => $view.set('sessions')}>
        <span className="status-dot status-idle" /> 세션 {live.length}
        {busy > 0 && (
          <>
            <span className="status-dot status-busy ml-1" /> 작업중 {busy}
          </>
        )}
        {waiting > 0 && (
          <span className="flex items-center gap-1.5 text-(--status-waiting)">
            <span className="status-dot status-waiting ml-1" /> 승인 대기 {waiting}
          </span>
        )}
      </button>
      {limits.map(item => (
        <button
          key={item.entry.agentId}
          type="button"
          className={cn('hover:text-(--ui-text-secondary)', item.limit.usedPercent >= warnAt && 'text-(--status-busy)')}
          onClick={() => toggleRightTab('usage', true)}
        >
          {item.name} {item.limit.label} {Math.round(item.limit.usedPercent)}%
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">
        <IconCommand size={11} />
        {metrics ? `HERA ${formatBytesKB(metrics.totalKB)}` : ''}
      </div>
    </footer>
  )
}
