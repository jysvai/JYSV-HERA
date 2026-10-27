import { useStore } from '@nanostores/react'
import { IconChartBar, IconListDetails, IconRoute, IconX } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { Button } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/hera'
import { $config, $project, $rightPanel, $rightTab } from '../../store/app'
import { UsagePanel } from '../pages/UsagePage'
import { BacklogPanel } from '../projects/BacklogPanel'
import { LanesPanel } from '../projects/LanesPanel'

function Tab({ active, disabled, onClick, icon, children, hint }: { active: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode; children: ReactNode; hint: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-100 [&_svg]:size-3.5',
        active ? 'bg-(--ui-bg-elevated) font-medium text-(--ui-text-primary) shadow-sm' : 'text-(--ui-text-secondary) hover:text-(--ui-text-primary)',
        disabled && 'opacity-40'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** Right-hand side panel: project backlog and AI usage, side by side with the terminals. */
export function RightPanel() {
  const tab = useStore($rightTab)
  const project = useStore($project)
  const lanesOn = Boolean(useStore($config)?.settings.lanes.enabled)
  const shown = !project ? 'usage' : tab === 'lanes' && !lanesOn ? 'backlog' : tab
  const chord = (key: string) => (isMac ? `⌘${key}` : `Ctrl+Shift+${key}`)

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-(--ui-stroke-tertiary) bg-(--ui-bg-sidebar)">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-(--ui-stroke-tertiary) px-2">
        <Tab active={shown === 'backlog'} disabled={!project} onClick={() => $rightTab.set('backlog')} icon={<IconListDetails />} hint={`백로그 (${chord('B')})`}>
          백로그
        </Tab>
        <Tab active={shown === 'usage'} onClick={() => $rightTab.set('usage')} icon={<IconChartBar />} hint={`사용량 (${chord('U')})`}>
          사용량
        </Tab>
        {lanesOn && (
          <Tab active={shown === 'lanes'} disabled={!project} onClick={() => $rightTab.set('lanes')} icon={<IconRoute />} hint="lanes (mid · low 보조 세션)">
            Lanes
          </Tab>
        )}
        <div className="flex-1" />
        <Button size="icon-xs" variant="ghost" aria-label="패널 닫기" onClick={() => $rightPanel.set(false)}>
          <IconX />
        </Button>
      </div>
      {/* Backlog stays mounted so a half-typed todo and the loaded insight survive tab switches. */}
      {project && (
        <div className={shown === 'backlog' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <BacklogPanel />
        </div>
      )}
      {shown === 'usage' && <UsagePanel />}
      {shown === 'lanes' && project && <LanesPanel />}
    </aside>
  )
}
