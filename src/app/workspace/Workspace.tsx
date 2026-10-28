import { useStore } from '@nanostores/react'
import {
  IconFolderPlus,
  IconLayoutColumns,
  IconLayoutSidebarRight,
  IconSend,
  IconSquare,
  IconUsersGroup,
  IconX
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { SessionInfo } from '../../../shared/types'
import { Button, EmptyState, StatusDot, Tip } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { $config, $layouts, $project, $projectSessions, $rightPanel, closeSession, setLayout, toast } from '../../store/app'
import { addProjectsFlow } from '../projects/flows'
import { TerminalView } from '../terminal/TerminalView'
import { AgentGlyph, LaunchMenu, LaunchPad } from './launch'
import { AddHelpersMenu } from './WorkMenu'

function SessionTab({
  session,
  active,
  inSplit,
  onSelect
}: {
  session: SessionInfo
  active: boolean
  inSplit: boolean
  onSelect: () => void
}) {
  const config = useStore($config)
  const agent = config?.agents.find(entry => entry.id === (session.activeAgentId || session.agentId)) || null
  const [editing, setEditing] = useState(false)

  return (
    <div
      role="tab"
      aria-selected={active}
      onMouseDown={event => {
        if (event.button === 1) {
          event.preventDefault()
          void closeSession(session.id)
        }
      }}
      onClick={onSelect}
      onDoubleClick={() => setEditing(true)}
      className={cn(
        'group relative flex h-8 max-w-56 min-w-0 shrink-0 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 text-[12.5px]',
        active ? 'bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-sm' : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)',
        inSplit && !active && 'text-(--ui-text-primary)'
      )}
    >
      <StatusDot status={session.dormant ? 'exited' : session.status} />
      <AgentGlyph agent={agent} size={14} />
      {editing ? (
        <input
          autoFocus
          defaultValue={session.title}
          className="w-28 bg-transparent outline-none"
          onBlur={event => {
            setEditing(false)
            void api.rename(session.id, event.target.value)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="truncate">
          {session.title}
          <span className="ml-1.5 text-[11px] text-(--ui-text-tertiary)">{session.name}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={t('세션 닫기')}
        className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-(--ui-text-tertiary) opacity-0 group-hover:opacity-100 hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)"
        onClick={event => {
          event.stopPropagation()
          void closeSession(session.id)
        }}
      >
        <IconX size={13} />
      </button>
    </div>
  )
}

function BroadcastBar({ sessions }: { sessions: SessionInfo[] }) {
  const [text, setText] = useState('')
  // Track opt-outs, so panes added to the split later start selected.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const live = sessions.filter(session => !session.dormant && session.status !== 'exited')
  const targets = new Set(live.map(session => session.id).filter(id => !excluded.has(id)))

  const submit = async () => {
    const ids = live.filter(session => targets.has(session.id)).map(session => session.id)

    if (!text.trim() || !ids.length) return

    await api.send(ids, text, true)
    toast(t('{count}개 세션에 보냈습니다.', { count: ids.length }))
    setText('')
  }

  return (
    <div className="flex items-center gap-2 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg-chrome) px-3 py-2">
      <div className="flex shrink-0 gap-1">
        {live.map(session => (
          <button
            key={session.id}
            type="button"
            onClick={() =>
              setExcluded(previous => {
                const next = new Set(previous)
                next.has(session.id) ? next.delete(session.id) : next.add(session.id)

                return next
              })
            }
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px]',
              targets.has(session.id) ? 'bg-(--ui-accent)/18 text-(--ui-accent-text)' : 'bg-(--ui-bg-quaternary) text-(--ui-text-tertiary)'
            )}
          >
            {session.name}
          </button>
        ))}
      </div>
      <input
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={t('선택한 세션들에 동시에 입력 (같은 질문을 여러 AI 에게)…')}
        className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--ui-text-tertiary)"
      />
      <Button size="icon-sm" variant="ghost" aria-label={t('보내기')} onClick={() => void submit()}>
        <IconSend />
      </Button>
    </div>
  )
}

export function Workspace() {
  const project = useStore($project)
  const sessions = useStore($projectSessions)
  const layouts = useStore($layouts)
  const rightPanel = useStore($rightPanel)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const layout = (project && layouts[project.id]) || { mode: 'single' as const, active: null, split: [] }
  const ids = useMemo(() => new Set(sessions.map(session => session.id)), [sessions])
  const active = layout.active && ids.has(layout.active) ? layout.active : sessions[sessions.length - 1]?.id || null
  const split = layout.split.filter(id => ids.has(id))
  const panes = layout.mode === 'split' && split.length > 1 ? split : active ? [active] : []
  const focused = sessions.find(session => session.id === (layout.mode === 'split' ? focusedId || active : active))

  if (!project) {
    return (
      <EmptyState
        icon={<IconFolderPlus />}
        title={t('프로젝트를 등록하세요')}
        description={t('자주 작업하는 폴더를 등록해 두면 클릭 한 번으로 그 폴더의 터미널·AI 세션이 열립니다. 상위 폴더를 고르면 하위 프로젝트들을 한 번에 찾아 줍니다.')}
      >
        <Button variant="default" onClick={() => void addProjectsFlow('pick')}>
          {t('폴더 추가')}
        </Button>
        <Button onClick={() => void addProjectsFlow('scan')}>{t('상위 폴더에서 찾기')}</Button>
      </EmptyState>
    )
  }

  const select = (id: string) => {
    if (layout.mode === 'split' && split.includes(id)) {
      setFocusedId(id)
      setLayout(project.id, { active: id })
    } else if (layout.mode === 'split') {
      // Swap the clicked tab into the focused pane slot.
      const slot = Math.max(0, split.indexOf(focusedId || active || ''))
      const next = [...split]
      next[slot] = id
      setLayout(project.id, { active: id, split: [...new Set(next)] })
      setFocusedId(id)
    } else {
      setLayout(project.id, { active: id })
      setFocusedId(id)
    }
  }

  const toggleSplit = () => {
    if (layout.mode === 'split') {
      setLayout(project.id, { mode: 'single' })
    } else {
      const initial = split.length > 1 ? split : [active, ...sessions.map(session => session.id).filter(id => id !== active)].filter(Boolean).slice(0, 2)
      setLayout(project.id, { mode: 'split', split: initial as string[] })
    }
  }

  const gridClass =
    panes.length <= 1 ? 'grid-cols-1' : panes.length === 2 ? 'grid-cols-2' : panes.length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2 grid-rows-2'

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-(--ui-stroke-tertiary) px-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map(session => (
            <SessionTab
              key={session.id}
              session={session}
              active={session.id === (layout.mode === 'split' ? focusedId || active : active)}
              inSplit={layout.mode === 'split' && split.includes(session.id)}
              onSelect={() => select(session.id)}
            />
          ))}
          <LaunchMenu project={project} split={layout.mode === 'split'} />
        </div>
        {focused?.activeAgentId && !focused.lane && !focused.dormant && focused.projectId && (
          <AddHelpersMenu
            lead={focused}
            trigger={toggle => (
              <Tip label={t('멀티 에이전트: {name} 에 보조 붙이기', { name: focused.name })}>
                <Button size="icon-sm" variant="ghost" aria-label={t('보조 붙이기')} onClick={toggle}>
                  <IconUsersGroup />
                </Button>
              </Tip>
            )}
          />
        )}
        {sessions.length > 1 && (
          <Tip label={layout.mode === 'split' ? t('한 화면 보기') : t('분할 보기 (최대 4개)')}>
            <Button size="icon-sm" variant="ghost" aria-label={t('분할 전환')} onClick={toggleSplit}>
              {layout.mode === 'split' ? <IconSquare /> : <IconLayoutColumns />}
            </Button>
          </Tip>
        )}
        <Tip label={t('백로그 패널')}>
          <Button size="icon-sm" variant="ghost" aria-label={t('백로그 패널')} onClick={() => $rightPanel.set(!rightPanel)}>
            <IconLayoutSidebarRight />
          </Button>
        </Tip>
      </div>
      {panes.length === 0 ? (
        <LaunchPad project={project} />
      ) : (
        <div className={cn('grid min-h-0 flex-1 gap-px bg-(--ui-stroke-tertiary)', gridClass)}>
          {panes.map((id, index) => (
            <div key={id} className={cn('relative min-h-0 min-w-0', panes.length === 3 && index === 0 && 'row-span-2')}>
              {layout.mode === 'split' && <PaneLabel session={sessions.find(session => session.id === id)!} focused={(focusedId || active) === id} />}
              <div className={cn('absolute inset-0', layout.mode === 'split' && 'top-6')}>
                <TerminalView
                  sessionId={id}
                  focused={(layout.mode === 'split' ? focusedId || active : active) === id}
                  onFocus={() => {
                    setFocusedId(id)
                    if (layout.active !== id) setLayout(project.id, { active: id })
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {layout.mode === 'split' && panes.length > 1 && <BroadcastBar sessions={sessions.filter(session => panes.includes(session.id))} />}
    </div>
  )
}

function PaneLabel({ session, focused }: { session: SessionInfo; focused: boolean }) {
  const config = useStore($config)
  const agent = config?.agents.find(entry => entry.id === (session.activeAgentId || session.agentId)) || null

  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 flex h-6 items-center gap-2 bg-(--ui-bg-chrome) px-2.5 text-[11.5px]',
        focused ? 'text-(--ui-text-primary)' : 'text-(--ui-text-tertiary)'
      )}
    >
      <StatusDot status={session.status} />
      <AgentGlyph agent={agent} size={12} />
      <span className="truncate">{session.title}</span>
      <span className="text-(--ui-text-tertiary)">{session.name}</span>
      {session.role && <span className="rounded bg-(--ui-bg-quaternary) px-1 text-[10px]">{session.role === 'main' ? t('메인') : t('보조')}</span>}
    </div>
  )
}
