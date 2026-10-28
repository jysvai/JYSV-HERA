import { useStore } from '@nanostores/react'
import { IconChartBar, IconFolders, IconGitBranch, IconListDetails, IconRoute, IconX } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { t } from '../../../shared/i18n'
import { Button } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/hera'
import { $config, $project, $rightPanel, $rightTab } from '../../store/app'
import { UsagePanel } from '../pages/UsagePage'
import { BacklogPanel } from '../projects/BacklogPanel'
import { FilesPanel } from '../projects/FilesPanel'
import { LanesPanel } from '../projects/LanesPanel'
import { WorktreesPanel } from '../projects/WorktreesPanel'

function Tab({ active, disabled, onClick, icon, children, hint }: { active: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode; children: ReactNode; hint: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[12px] transition-colors duration-100 [&_svg]:size-3.5 [&_svg]:shrink-0',
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
        {/* Labels never wrap; if a language's labels outgrow the panel, the tabs scroll instead. */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          <Tab active={shown === 'backlog'} disabled={!project} onClick={() => $rightTab.set('backlog')} icon={<IconListDetails />} hint={t('백로그 ({shortcut})', { shortcut: chord('B') })}>
            {t('백로그')}
          </Tab>
          <Tab active={shown === 'files'} disabled={!project} onClick={() => $rightTab.set('files')} icon={<IconFolders />} hint={t('폴더 구조 ({shortcut})', { shortcut: chord('E') })}>
            {t('폴더')}
          </Tab>
          <Tab active={shown === 'worktrees'} disabled={!project} onClick={() => $rightTab.set('worktrees')} icon={<IconGitBranch />} hint={t('작업 공간 (프로젝트의 격리된 복사본, git worktree)')}>
            {t('작업 공간')}
          </Tab>
          <Tab active={shown === 'usage'} onClick={() => $rightTab.set('usage')} icon={<IconChartBar />} hint={t('사용량 ({shortcut})', { shortcut: chord('U') })}>
            {t('사용량')}
          </Tab>
          {lanesOn && (
            <Tab active={shown === 'lanes'} disabled={!project} onClick={() => $rightTab.set('lanes')} icon={<IconRoute />} hint={t('lanes (mid · low 보조 세션)')}>
              Lanes
            </Tab>
          )}
        </div>
        <Button size="icon-xs" variant="ghost" aria-label={t('패널 닫기')} onClick={() => $rightPanel.set(false)}>
          <IconX />
        </Button>
      </div>
      {/* Backlog stays mounted so a half-typed todo and the loaded insight survive tab switches. */}
      {project && (
        <div className={shown === 'backlog' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <BacklogPanel />
        </div>
      )}
      {shown === 'files' && project && <FilesPanel />}
      {shown === 'worktrees' && project && <WorktreesPanel />}
      {shown === 'usage' && <UsagePanel />}
      {shown === 'lanes' && project && <LanesPanel />}
    </aside>
  )
}
