import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import {
  IconBolt,
  IconCloudDownload,
  IconDeviceMobile,
  IconExternalLink,
  IconPlayerPlay,
  IconPlus,
  IconTerminal2,
  IconUsersGroup
} from '@tabler/icons-react'

import { t } from '../../../shared/i18n'
import { readableOn } from '../../../shared/themes'
import type { AgentDef, Project, RemoteHostStatus } from '../../../shared/types'
import { Button, Switch } from '../../components/ui/primitives'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/menu'
import { api } from '../../lib/hera'
import { $availability, $config, $windowVisible, launch, launchTeam, toast, updateConfig } from '../../store/app'

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
        <Button size="icon-sm" variant="ghost" aria-label={t('새 세션')} onClick={toggle}>
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
            <IconTerminal2 /> {t('새 터미널')}
          </MenuItem>
          {agents.length > 0 && <MenuLabel>{t('AI 에이전트')}</MenuLabel>}
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
                  {t('이어하기')}
                </Button>
              )}
            </div>
          ))}
          {agents.some(agent => agent.id === 'claude') && (
            <MenuItem
              onSelect={() => {
                close()
                void launch({ projectId: project.id, agentId: 'claude', teleport: true }, { split })
              }}
            >
              <IconCloudDownload /> {t('폰 · 웹 세션 가져오기')}
            </MenuItem>
          )}
          {!!config?.teams.length && <MenuLabel>{t('팀 (멀티 에이전트)')}</MenuLabel>}
          {config?.teams.map(team => (
            <MenuItem
              key={team.id}
              onSelect={() => {
                close()
                void launchTeam(project.id, team.id)
              }}
            >
              <IconUsersGroup /> {t(team.name)}
            </MenuItem>
          ))}
          {project.commands.length > 0 && <MenuLabel>{t('프로젝트 명령')}</MenuLabel>}
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
            <IconExternalLink /> {t('외부 터미널에서 열기')}
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
              <div className="text-[13px] font-medium">{t('터미널')}</div>
              <div className="text-[11px] text-(--ui-text-tertiary)">{t('기본 셸')}</div>
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
                  aria-label={t('{name} 이어하기', { name: agent.name })}
                  className="flex items-center px-2.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-(--ui-accent-text)"
                  onClick={() => void launch({ projectId: project.id, agentId: agent.id, resume: true })}
                >
                  <IconPlayerPlay size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        {agents.some(agent => agent.id === 'claude') && <PhonePanel project={project} />}
        {!!config?.teams.length && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('팀으로 시작')}</div>
            <div className="flex flex-wrap gap-2">
              {config.teams.map(team => (
                <Button key={team.id} variant="outline" onClick={() => void launchTeam(project.id, team.id)}>
                  <IconUsersGroup /> {t(team.name)}
                </Button>
              ))}
            </div>
          </div>
        )}
        {project.commands.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('프로젝트 명령')}</div>
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
          {t('▶ 버튼은 마지막 대화를 이어서 엽니다. 에이전트 목록은 PATH 에 설치된 CLI 만 표시됩니다 (에이전트 페이지에서 추가/관리).')}
        </div>
      </div>
    </div>
  )
}

/** The project's Remote Control server, polled while the start screen shows. */
function useRemoteStatus(projectId: string, on: boolean): RemoteHostStatus | null {
  const visible = useStore($windowVisible)
  const [status, setStatus] = useState<RemoteHostStatus | null>(null)

  useEffect(() => {
    if (!on) {
      setStatus(null)
      return
    }
    const read = () =>
      void api
        .remoteStatus()
        .then(list => setStatus(list.find(entry => entry.projectId === projectId) || null))
        .catch(() => undefined)
    read()
    if (!visible) return
    const timer = setInterval(read, 3000)

    return () => clearInterval(timer)
  }, [projectId, on, visible])

  return status
}

/** Phone and web: start sessions here from the Claude app, and bring them (or cloud ones) into a HERA tab. */
function PhonePanel({ project }: { project: Project }) {
  const on = Boolean(project.phoneServer)
  const status = useRemoteStatus(project.id, on)
  const setOn = (next: boolean) =>
    updateConfig(draft => {
      const entry = draft.projects.find(item => item.id === project.id)
      if (entry) entry.phoneServer = next
    })

  const line = !on
    ? t('켜면 Claude 앱의 Code 탭과 claude.ai/code 에서 이 폴더로 새 세션을 시작할 수 있습니다. 세션은 이 컴퓨터에서 돕니다.')
    : !status || status.state === 'starting'
      ? t('연결하는 중…')
      : status.state === 'connected'
        ? t('연결됨: 폰의 Code 탭에서 이 컴퓨터의 {name} 을 고르세요.', { name: status.label || project.name })
        : status.message

  return (
    <div className="mt-6">
      <div className="mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('폰 · 웹에서 이어 하기')}</div>
      <div className="space-y-3 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3">
        <div className="flex items-center gap-3">
          <IconDeviceMobile size={20} className="shrink-0 text-(--ui-text-secondary)" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t('폰에서 이 프로젝트로 새 세션 시작')}</div>
            <div className={status?.state === 'error' ? 'text-[11px] text-(--status-busy)' : 'text-[11px] text-(--ui-text-tertiary)'}>{line}</div>
          </div>
          <Switch checked={on} onChange={setOn} label={t('폰에서 새 세션')} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void launch({ projectId: project.id, agentId: 'claude', teleport: true })}>
            <IconCloudDownload /> {t('폰 · 웹 세션 가져오기')}
          </Button>
          {status?.state === 'error' && (
            <Button variant="ghost" size="sm" onClick={() => void api.retryRemote(project.id)}>
              {t('다시 시도')}
            </Button>
          )}
          {status?.url && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void api
                  .copy(status.url!)
                  .then(() => toast(t('링크를 복사했습니다.')))
                  .catch(() => undefined)
              }
            >
              {t('링크 복사')}
            </Button>
          )}
        </div>
        <div className="text-[11px] text-(--ui-text-tertiary)">
          {t('가져오기는 이 저장소의 폰 · 웹 세션 목록을 엽니다(claude --teleport). 고른 세션은 이 컴퓨터의 HERA 탭에서 이어지고, 설정의 Remote Control 이 켜져 있으면 폰에서도 계속 이어집니다.')}
        </div>
      </div>
    </div>
  )
}
