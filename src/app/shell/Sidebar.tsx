import { useStore } from '@nanostores/react'
import { IconActivityHeartbeat, IconChartBar, IconFolderPlus, IconFolderSearch, IconHistory, IconKeyboard, IconMessages, IconPalette, IconPin, IconRobot, IconRoute, IconSettings, IconUserCircle } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import type { Project } from '../../../shared/types'
import { formatTokens, relTime } from '../../../shared/util'
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/menu'
import { Button, SearchField, Tip } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { projectTotals } from '../../lib/usage'
import { $activity, $config, $info, $projectBadges, $projectId, $update, $usage, $view, launch, updateProject, type View } from '../../store/app'
import { $editProjectId, addProjectsFlow } from '../projects/flows'

const NAV: { view: View; label: string; icon: typeof IconChartBar }[] = [
  { view: 'sessions', label: '세션 현황', icon: IconActivityHeartbeat },
  { view: 'bus', label: '에이전트 대화', icon: IconMessages },
  { view: 'usage', label: '사용량', icon: IconChartBar },
  { view: 'accounts', label: '계정', icon: IconUserCircle },
  { view: 'history', label: '프롬프트 기록', icon: IconHistory },
  { view: 'agents', label: '에이전트', icon: IconRobot },
  { view: 'shortcuts', label: '단축어', icon: IconKeyboard },
  { view: 'theme', label: '테마 · 색상', icon: IconPalette },
  { view: 'lanes', label: 'Lanes 연동', icon: IconRoute },
  { view: 'settings', label: '설정', icon: IconSettings }
]

function ProjectRow({ project, lastAt }: { project: Project; lastAt: number }) {
  const selectedId = useStore($projectId)
  const view = useStore($view)
  const badges = useStore($projectBadges)[project.id]
  const usages = useStore($usage)
  const todayTokens = usages ? projectTotals(usages, project.id).today : 0
  const selected = selectedId === project.id && view === 'workspace'

  return (
    <div
      className={cn(
        'group flex h-11 cursor-default items-center gap-2.5 rounded-md px-2',
        selected ? 'bg-(--ui-bg-elevated) shadow-sm' : 'hover:bg-(--chrome-action-hover)'
      )}
      onClick={() => {
        $projectId.set(project.id)
        $view.set('workspace')
      }}
      onDoubleClick={() => void launch({ projectId: project.id })}
    >
      <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: project.color || 'var(--ui-stroke-secondary)' }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{project.name}</span>
          {project.pinned && <IconPin size={11} className="shrink-0 text-(--ui-text-tertiary)" />}
        </div>
        <div className="truncate text-[11px] text-(--ui-text-tertiary)">
          {relTime(lastAt)}
          {todayTokens > 0 && <span className="tabular-nums"> · 오늘 {formatTokens(todayTokens)}</span>}
        </div>
      </div>
      {badges && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-(--ui-text-tertiary)">
          {badges.waiting > 0 && <span className="status-dot status-waiting" />}
          {badges.busy > 0 && <span className="status-dot status-busy" />}
          {badges.waiting + badges.busy === 0 && <span className="status-dot status-idle" />}
          {badges.live}
        </span>
      )}
      <Menu
        width={200}
        align="end"
        trigger={({ toggle }) => (
          <button
            type="button"
            aria-label="프로젝트 메뉴"
            onClick={event => {
              event.stopPropagation()
              toggle()
            }}
            className="hidden size-6 items-center justify-center rounded text-(--ui-text-tertiary) group-hover:flex hover:bg-(--chrome-action-hover)"
          >
            ⋯
          </button>
        )}
      >
        {close => (
          <>
            <MenuItem
              onSelect={() => {
                close()
                void launch({ projectId: project.id })
              }}
            >
              새 터미널
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close()
                void api.openFolder(project.id)
              }}
            >
              폴더 열기
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close()
                updateProject(project.id, draft => {
                  draft.pinned = !draft.pinned
                })
              }}
            >
              {project.pinned ? '고정 해제' : '상단 고정'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                close()
                $editProjectId.set(project.id)
              }}
            >
              프로젝트 설정…
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  )
}

/** Installed version, and whether GitHub has a newer release. */
function VersionTag() {
  const info = useStore($info)
  const update = useStore($update)
  if (!info) return null

  const newer = update?.newer && update.latest
  const tip = newer
    ? `새 버전 v${update.latest} 이 나왔습니다. 눌러서 릴리스 페이지를 엽니다.`
    : update?.checkedAt
      ? `최신 버전입니다 · ${relTime(update.checkedAt)} 확인`
      : '설정 → 업데이트에서 새 버전을 확인할 수 있습니다.'

  return (
    <div className="flex items-center gap-1.5 border-t border-(--ui-stroke-tertiary) px-3 py-1.5 text-[10.5px] text-(--ui-text-tertiary)">
      <Tip label={tip} side="top">
        {newer ? (
          <a
            href={update.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-full bg-(--ui-accent) px-2 py-0.5 font-medium text-(--ui-accent-fg)"
          >
            v{info.version} → v{update.latest} 업데이트
          </a>
        ) : (
          <button type="button" onClick={() => $view.set('settings')} className="rounded-full border border-(--ui-stroke-tertiary) px-2 py-0.5 font-mono tabular-nums hover:text-(--ui-text-primary)">
            v{info.version}
          </button>
        )}
      </Tip>
      {!newer && update?.latest && !update.error ? <span>최신</span> : null}
    </div>
  )
}

export function Sidebar() {
  const config = useStore($config)
  const activity = useStore($activity)
  const view = useStore($view)
  const [query, setQuery] = useState('')

  const lastAt = (project: Project) => Math.max(activity.launches[project.id] || 0, activity.agents[project.id] || 0)

  const projects = useMemo(() => {
    const list = [...(config?.projects || [])]
    const needle = query.trim().toLowerCase()
    const filtered = needle ? list.filter(project => project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle)) : list

    return filtered.sort((a, b) => Number(b.pinned) - Number(a.pinned) || lastAt(b) - lastAt(a) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.projects, activity, query])

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-(--ui-stroke-tertiary) bg-(--ui-bg-sidebar)">
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        {(config?.projects.length || 0) > 5 && (
          <SearchField value={query} onChange={event => setQuery(event.target.value)} placeholder="프로젝트 검색" />
        )}
        {(config?.projects.length || 0) <= 5 && <div className="flex-1 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">프로젝트</div>}
        <Tip label="폴더 추가">
          <Button size="icon-xs" variant="ghost" aria-label="폴더 추가" onClick={() => void addProjectsFlow('pick')}>
            <IconFolderPlus />
          </Button>
        </Tip>
        <Tip label="상위 폴더에서 프로젝트 찾기">
          <Button size="icon-xs" variant="ghost" aria-label="상위 폴더에서 찾기" onClick={() => void addProjectsFlow('scan')}>
            <IconFolderSearch />
          </Button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {projects.map(project => (
          <ProjectRow key={project.id} project={project} lastAt={lastAt(project)} />
        ))}
        {!config?.projects.length && (
          <div className="px-2 py-6 text-center text-[12px] leading-relaxed text-(--ui-text-tertiary)">
            아직 등록된 프로젝트가 없습니다.
            <br />
            위 버튼으로 폴더를 추가하세요.
          </div>
        )}
      </div>
      <nav className="grid grid-cols-5 gap-0.5 border-t border-(--ui-stroke-tertiary) p-2">
        {NAV.map(item => (
          <Tip key={item.view} label={item.label} side="top">
            <button
              type="button"
              aria-label={item.label}
              onClick={() => $view.set(view === item.view ? 'workspace' : item.view)}
              className={cn(
                'flex h-8 w-full items-center justify-center rounded-md text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
                view === item.view && 'bg-(--ui-bg-elevated) text-(--ui-accent-text) shadow-sm'
              )}
            >
              <item.icon size={17} />
            </button>
          </Tip>
        ))}
      </nav>
      <VersionTag />
    </aside>
  )
}
