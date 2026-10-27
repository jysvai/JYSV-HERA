import { useStore } from '@nanostores/react'
import {
  IconBolt,
  IconChartBar,
  IconFolder,
  IconListDetails,
  IconPalette,
  IconPlayerPlay,
  IconSearch,
  IconSettings,
  IconSunMoon,
  IconTerminal2,
  IconUsersGroup
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { allThemes } from '../../../shared/themes'
import { cn } from '../../lib/cn'
import { $availability, $config, $palette, $projectId, $sessions, $view, focusSession, launch, launchTeam, toggleRightTab, updateConfig, type View } from '../../store/app'
import { toggleThemeMode } from '../../store/theme'
import { addProjectsFlow } from '../projects/flows'
import { AgentGlyph } from '../workspace/launch'

interface Item {
  id: string
  label: string
  hint?: string
  group: string
  icon: ReactNode
  keywords?: string
  run: () => void
}

const PAGES: { view: View; label: string }[] = [
  { view: 'sessions', label: '세션 현황' },
  { view: 'bus', label: '에이전트 대화' },
  { view: 'usage', label: '사용량' },
  { view: 'accounts', label: '계정 · 자동 로그인' },
  { view: 'history', label: '프롬프트 기록' },
  { view: 'agents', label: '에이전트 · 팀' },
  { view: 'shortcuts', label: '단축어' },
  { view: 'theme', label: '테마 · 색상' },
  { view: 'lanes', label: 'Lanes 연동 설정' },
  { view: 'settings', label: '설정' }
]

/** Subsequence match score: lower is better, -1 = no match. */
function score(text: string, query: string): number {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const index = haystack.indexOf(query)

  if (index >= 0) return index

  let position = 0
  let gaps = 0

  for (const char of query) {
    const found = haystack.indexOf(char, position)
    if (found < 0) return -1
    gaps += found - position
    position = found + 1
  }

  return 100 + gaps
}

export function Palette() {
  const open = useStore($palette)
  const config = useStore($config)
  const sessions = useStore($sessions)
  const availability = useStore($availability)
  const currentProject = useStore($projectId)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    if (!config) return []
    const out: Item[] = []
    const project = config.projects.find(entry => entry.id === currentProject)
    const agents = config.agents.filter(agent => agent.enabled && availability[agent.id]?.installed)

    for (const session of Object.values(sessions)) {
      const owner = config.projects.find(entry => entry.id === session.projectId)
      out.push({
        id: `s:${session.id}`,
        group: '열린 세션',
        label: `${session.title} · ${session.name}`,
        hint: owner?.name,
        keywords: session.status,
        icon: <IconTerminal2 />,
        run: () => focusSession(session)
      })
    }

    if (project) {
      out.push({ id: 'new-shell', group: project.name, label: '새 터미널', icon: <IconTerminal2 />, run: () => void launch({ projectId: project.id }) })

      for (const agent of agents) {
        out.push({
          id: `a:${agent.id}`,
          group: project.name,
          label: `${agent.name} 시작`,
          keywords: agent.command,
          icon: <AgentGlyph agent={agent} />,
          run: () => void launch({ projectId: project.id, agentId: agent.id })
        })
        if (agent.continueArgs) {
          out.push({
            id: `r:${agent.id}`,
            group: project.name,
            label: `${agent.name} 이어하기`,
            keywords: 'resume continue',
            icon: <IconPlayerPlay />,
            run: () => void launch({ projectId: project.id, agentId: agent.id, resume: true })
          })
        }
      }

      for (const team of config.teams) {
        out.push({ id: `t:${team.id}`, group: project.name, label: `팀: ${team.name}`, icon: <IconUsersGroup />, run: () => void launchTeam(project.id, team.id) })
      }

      for (const command of project.commands) {
        out.push({
          id: `c:${command.name}`,
          group: project.name,
          label: command.name,
          hint: command.command,
          icon: <IconBolt />,
          run: () => void launch({ projectId: project.id, command: command.command, title: command.name })
        })
      }
    }

    for (const entry of config.projects) {
      out.push({
        id: `p:${entry.id}`,
        group: '프로젝트',
        label: entry.name,
        hint: entry.path,
        icon: <IconFolder />,
        run: () => {
          $projectId.set(entry.id)
          $view.set('workspace')
        }
      })
      out.push({
        id: `pt:${entry.id}`,
        group: '프로젝트',
        label: `${entry.name} 에서 터미널 열기`,
        icon: <IconTerminal2 />,
        run: () => void launch({ projectId: entry.id })
      })
    }

    for (const page of PAGES) {
      out.push({ id: `v:${page.view}`, group: '이동', label: page.label, icon: <IconSettings />, run: () => $view.set(page.view) })
    }

    out.push({ id: 'usage-panel', group: '이동', label: '사용량 패널 (오른쪽)', icon: <IconChartBar />, keywords: 'usage limit 한도 토큰', run: () => toggleRightTab('usage', true) })
    if (currentProject) {
      out.push({ id: 'backlog-panel', group: '이동', label: '백로그 패널 (오른쪽)', icon: <IconListDetails />, keywords: 'backlog', run: () => toggleRightTab('backlog', true) })
      if (config.settings.lanes.enabled) {
        out.push({ id: 'lanes-panel', group: '이동', label: 'Lanes 패널 (오른쪽)', icon: <IconListDetails />, keywords: 'lanes lane mid low 보조', run: () => toggleRightTab('lanes', true) })
      }
    }
    out.push({ id: 'theme-toggle', group: '화면', label: '다크 ⇄ 라이트 전환', icon: <IconSunMoon />, keywords: 'theme dark light 테마 밝게 어둡게', run: toggleThemeMode })
    for (const theme of allThemes(config.settings)) {
      out.push({
        id: `theme:${theme.id}`,
        group: '화면',
        label: `테마: ${theme.name}`,
        hint: theme.mode === 'dark' ? '다크' : '라이트',
        icon: <IconPalette />,
        keywords: 'theme color 색상',
        run: () =>
          updateConfig(draft => {
            if (theme.mode === 'dark') draft.settings.darkTheme = theme.id
            else draft.settings.lightTheme = theme.id
            if (draft.settings.theme !== 'system') draft.settings.theme = theme.mode
          })
      })
    }
    out.push({ id: 'add', group: '이동', label: '프로젝트 폴더 추가', icon: <IconFolder />, run: () => void addProjectsFlow('pick') })
    out.push({ id: 'scan', group: '이동', label: '상위 폴더에서 프로젝트 찾기', icon: <IconSearch />, run: () => void addProjectsFlow('scan') })

    return out
  }, [config, sessions, availability, currentProject])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (!needle) return items

    return items
      .map(item => ({ item, rank: score(`${item.label} ${item.hint || ''} ${item.keywords || ''}`, needle) }))
      .filter(entry => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map(entry => entry.item)
  }, [items, query])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const close = () => $palette.set(false)
  const choose = (item: Item | undefined) => {
    if (!item) return
    close()
    item.run()
  }

  let lastGroup = ''

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal-backdrop) flex items-start justify-center bg-black/30 pt-[14vh]" onMouseDown={close}>
      <div
        className="z-(--z-modal) flex max-h-[60vh] w-[600px] flex-col overflow-hidden rounded-xl border border-(--stroke-nous) bg-(--ui-bg-elevated) shadow-nous"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) px-4">
          <IconSearch size={16} className="text-(--ui-text-tertiary)" />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') close()
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex(value => Math.min(filtered.length - 1, value + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex(value => Math.max(0, value - 1))
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                choose(filtered[index])
              }
            }}
            placeholder="프로젝트, 세션, 에이전트, 명령 검색…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-(--ui-text-tertiary)"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.map((item, i) => {
            const header = item.group !== lastGroup && !query ? item.group : null
            lastGroup = item.group

            return (
              <div key={item.id}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{header}</div>}
                <button
                  type="button"
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-(--ui-text-tertiary)',
                    i === index && 'bg-(--chrome-action-hover)'
                  )}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="ml-auto max-w-[45%] shrink-0 truncate font-mono text-[11px] text-(--ui-text-tertiary)">{item.hint}</span>}
                </button>
              </div>
            )
          })}
          {!filtered.length && <div className="py-8 text-center text-[12.5px] text-(--ui-text-tertiary)">결과 없음</div>}
        </div>
      </div>
    </div>,
    document.body
  )
}
