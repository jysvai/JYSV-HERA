import { useStore } from '@nanostores/react'
import {
  IconBolt,
  IconExternalLink,
  IconPlayerPlay,
  IconPlus,
  IconTerminal2,
  IconUsersGroup
} from '@tabler/icons-react'

import { readableOn } from '../../../shared/themes'
import type { AgentDef, Project } from '../../../shared/types'
import { Button } from '../../components/ui/primitives'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/menu'
import { api } from '../../lib/hera'
import { $availability, $config, launch, launchTeam, toast } from '../../store/app'

export function AgentGlyph({ agent, size = 16 }: { agent: Pick<AgentDef, 'name' | 'color'> | null; size?: number }) {
  if (!agent) {
    return <IconTerminal2 size={size} className="text-(--ui-text-tertiary)" />
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded font-bold"
      style={{ width: size, height: size, background: agent.color, color: readableOn(agent.color), fontSize: Math.round(size * 0.55) }}
    >
      {agent.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function useInstalledAgents(): AgentDef[] {
  const config = useStore($config)
  const availability = useStore($availability)

  return (config?.agents || []).filter(agent => agent.enabled && availability[agent.id]?.installed)
}

export function LaunchMenu({ project, split = false }: { project: Project; split?: boolean }) {
  const config = useStore($config)
  const agents = useInstalledAgents()

  return (
    <Menu
      width={300}
      align="end"
      trigger={({ toggle }) => (
        <Button size="icon-sm" variant="ghost" aria-label="새 세션" onClick={toggle}>
          <IconPlus />
        </Button>
      )}
    >
      {close => (
        <>
          <MenuItem
            hint="Ctrl+Shift+T"
            onSelect={() => {
              close()
              void launch({ projectId: project.id }, { split })
            }}
          >
            <IconTerminal2 /> 새 터미널
          </MenuItem>
          {agents.length > 0 && <MenuLabel>AI 에이전트</MenuLabel>}
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-1">
              <MenuItem
                className="flex-1"
                onSelect={() => {
                  close()
                  void launch({ projectId: project.id, agentId: agent.id }, { split })
                }}
              >
                <AgentGlyph agent={agent} /> {agent.name}
              </MenuItem>
              {agent.continueArgs && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    close()
                    void launch({ projectId: project.id, agentId: agent.id, resume: true }, { split })
                  }}
                >
                  이어하기
                </Button>
              )}
            </div>
          ))}
          {!!config?.teams.length && <MenuLabel>팀 (멀티 에이전트)</MenuLabel>}
          {config?.teams.map(team => (
            <MenuItem
              key={team.id}
              onSelect={() => {
                close()
                void launchTeam(project.id, team.id)
              }}
            >
              <IconUsersGroup /> {team.name}
            </MenuItem>
          ))}
          {project.commands.length > 0 && <MenuLabel>프로젝트 명령</MenuLabel>}
          {project.commands.map(command => (
            <MenuItem
              key={command.name}
              hint={command.command.length > 28 ? `${command.command.slice(0, 26)}…` : command.command}
              onSelect={() => {
                close()
                void launch({ projectId: project.id, command: command.command, title: command.name }, { split })
              }}
            >
              <IconBolt /> {command.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              close()
              void api.openExternal(project.id, null).then(result => toast(result.message, result.ok ? 'info' : 'error'))
            }}
          >
            <IconExternalLink /> 외부 터미널에서 열기
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

export function LaunchPad({ project }: { project: Project }) {
  const config = useStore($config)
  const agents = useInstalledAgents()

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-1 text-[20px] font-semibold tracking-tight">{project.name}</div>
        <div className="mb-6 truncate font-mono text-[12px] text-(--ui-text-tertiary)">{project.path}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            className="flex items-center gap-3 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3 text-left hover:bg-(--chrome-action-hover)"
            onClick={() => void launch({ projectId: project.id })}
          >
            <IconTerminal2 size={20} className="text-(--ui-text-secondary)" />
            <div>
              <div className="text-[13px] font-medium">터미널</div>
              <div className="text-[11px] text-(--ui-text-tertiary)">기본 셸</div>
            </div>
          </button>
          {agents.map(agent => (
            <div key={agent.id} className="group flex items-stretch overflow-hidden rounded-lg bg-(--ui-bg-quaternary)">
              <button
                type="button"
                className="flex flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-(--chrome-action-hover)"
                onClick={() => void launch({ projectId: project.id, agentId: agent.id })}
              >
                <AgentGlyph agent={agent} size={20} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{agent.name}</div>
                  <div className="truncate text-[11px] text-(--ui-text-tertiary)">{agent.command}</div>
                </div>
              </button>
              {agent.continueArgs && (
                <button
                  type="button"
                  aria-label={`${agent.name} 이어하기`}
                  className="flex items-center px-2.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-(--ui-accent-text)"
                  onClick={() => void launch({ projectId: project.id, agentId: agent.id, resume: true })}
                >
                  <IconPlayerPlay size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        {!!config?.teams.length && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">팀으로 시작</div>
            <div className="flex flex-wrap gap-2">
              {config.teams.map(team => (
                <Button key={team.id} variant="outline" onClick={() => void launchTeam(project.id, team.id)}>
                  <IconUsersGroup /> {team.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        {project.commands.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">프로젝트 명령</div>
            <div className="flex flex-wrap gap-2">
              {project.commands.map(command => (
                <Button key={command.name} variant="secondary" onClick={() => void launch({ projectId: project.id, command: command.command, title: command.name })}>
                  <IconBolt /> {command.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 text-[11.5px] text-(--ui-text-tertiary)">
          ▶ 버튼은 마지막 대화를 이어서 엽니다. 에이전트 목록은 PATH 에 설치된 CLI 만 표시됩니다 (에이전트 페이지에서 추가/관리).
        </div>
      </div>
    </div>
  )
}
