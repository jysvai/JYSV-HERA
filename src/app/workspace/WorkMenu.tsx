import { useStore } from '@nanostores/react'
import { IconPlus, IconUsersGroup } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { t } from '../../../shared/i18n'
import type { AgentDef, Project, SessionInfo, StartWorkResult, WorkAgent } from '../../../shared/types'
import { Menu, MenuItem, MenuLabel } from '../../components/ui/menu'
import { $config, $sessions, startWork } from '../../store/app'
import { AgentGlyph, useInstalledAgents } from './launch'

const agentOf = (session: SessionInfo) => session.activeAgentId || session.agentId

/** Open sessions in the project that run an AI agent (lanes excluded). */
export function useOpenAgents(projectId: string): SessionInfo[] {
  const sessions = useStore($sessions)

  return Object.values(sessions)
    .filter(session => session.projectId === projectId && !session.dormant && session.status !== 'exited' && !session.lane && session.activeAgentId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Helpers for `lead`: the other agents already open in the project, else the first team's helpers. */
function helpersFor(lead: SessionInfo, open: SessionInfo[], fallback: WorkAgent[], installed: AgentDef[]): WorkAgent[] {
  const others = open.filter(session => session.id !== lead.id).map(session => ({ agentId: agentOf(session)! }))
  if (others.length) return others.slice(0, 3)

  const team = fallback.filter(entry => entry.agentId !== agentOf(lead))
  if (team.length) return team

  const other = installed.find(agent => agent.id !== agentOf(lead))
  return other ? [{ agentId: other.id }] : []
}

function names(helpers: WorkAgent[], open: SessionInfo[], agents: AgentDef[]) {
  return helpers.map(helper => open.find(session => agentOf(session) === helper.agentId)?.name || agents.find(agent => agent.id === helper.agentId)?.name || helper.agentId).join(', ')
}

/**
 * Hand a task to agents: an open session leads (keeping its conversation) with helpers
 * next to it, a team starts fresh, or one agent takes it alone.
 */
export function WorkMenu({
  project,
  task,
  trigger,
  onStarted
}: {
  project: Project
  task: () => string
  trigger: (toggle: () => void) => ReactNode
  onStarted?: (result: StartWorkResult) => void
}) {
  const config = useStore($config)
  const installed = useInstalledAgents()
  const open = useOpenAgents(project.id)
  const agents = config?.agents || []
  const ready = new Set(installed.map(agent => agent.id))
  const teams = (config?.teams || []).filter(team => team.panes.every(pane => ready.has(pane.agentId)))
  const fallback = (teams[0]?.panes || []).filter(pane => pane.role === 'helper').map(pane => ({ agentId: pane.agentId, profileId: pane.profileId }))

  const run = async (req: Omit<Parameters<typeof startWork>[0], 'projectId' | 'task'>) => {
    const text = task().trim()
    if (!text) return
    const result = await startWork({ projectId: project.id, task: text, ...req })
    if (result) onStarted?.(result)
  }

  return (
    <Menu width={320} align="end" trigger={({ toggle }) => trigger(toggle)}>
      {close => (
        <>
          <MenuLabel>{t('멀티 에이전트로 진행')}</MenuLabel>
          {open.map(session => {
            const helpers = helpersFor(session, open, fallback, installed)

            return (
              <MenuItem
                key={`lead-${session.id}`}
                disabled={!helpers.length}
                hint={helpers.length ? `+ ${names(helpers, open, agents)}` : undefined}
                onSelect={() => {
                  close()
                  void run({ leadId: session.id, helpers })
                }}
              >
                <AgentGlyph agent={agents.find(agent => agent.id === agentOf(session)) || null} /> {t('{name} 이(가) 이끌기', { name: session.name })}
              </MenuItem>
            )
          })}
          {teams.map(team => {
            const main = team.panes.find(pane => pane.role === 'main')

            return (
              <MenuItem
                key={team.id}
                disabled={!main}
                hint={t('새로 시작')}
                onSelect={() => {
                  close()
                  void run({
                    lead: main ? { agentId: main.agentId, profileId: main.profileId } : null,
                    helpers: team.panes.filter(pane => pane.role === 'helper').map(pane => ({ agentId: pane.agentId, profileId: pane.profileId })),
                    teamName: t(team.name)
                  })
                }}
              >
                <IconUsersGroup /> {t(team.name)}
              </MenuItem>
            )
          })}
          {!open.length && !teams.length && <div className="px-2 py-1.5 text-[12px] text-(--ui-text-tertiary)">{t('에이전트 페이지에서 팀을 만들거나 AI 세션을 먼저 여세요.')}</div>}
          <MenuLabel>{t('한 에이전트에게 맡기기')}</MenuLabel>
          {open.map(session => (
            <MenuItem
              key={`solo-${session.id}`}
              hint={t('지금 열린 세션')}
              onSelect={() => {
                close()
                void run({ leadId: session.id })
              }}
            >
              <AgentGlyph agent={agents.find(agent => agent.id === agentOf(session)) || null} /> {session.name}
            </MenuItem>
          ))}
          {installed.map(agent => (
            <MenuItem
              key={`new-${agent.id}`}
              hint={t('새 세션')}
              onSelect={() => {
                close()
                void run({ lead: { agentId: agent.id } })
              }}
            >
              <AgentGlyph agent={agent} /> {agent.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

/** Turn an open agent session into the lead of a team: helpers open next to it and it is briefed. */
export function AddHelpersMenu({ lead, trigger }: { lead: SessionInfo; trigger: (toggle: () => void) => ReactNode }) {
  const config = useStore($config)
  const installed = useInstalledAgents()
  const ready = new Set(installed.map(agent => agent.id))
  const teams = (config?.teams || []).filter(team => team.panes.some(pane => pane.role === 'helper') && team.panes.every(pane => ready.has(pane.agentId)))
  const add = (helpers: WorkAgent[]) => void startWork({ projectId: lead.projectId!, leadId: lead.id, helpers })

  return (
    <Menu width={300} align="end" trigger={({ toggle }) => trigger(toggle)}>
      {close => (
        <>
          <MenuLabel>{t('{name} 에 보조 붙이기 (멀티 에이전트)', { name: lead.name })}</MenuLabel>
          {installed.map(agent => (
            <MenuItem
              key={agent.id}
              onSelect={() => {
                close()
                add([{ agentId: agent.id }])
              }}
            >
              <IconPlus /> <AgentGlyph agent={agent} /> {agent.name}
            </MenuItem>
          ))}
          {teams.length > 0 && <MenuLabel>{t('팀의 보조 구성으로')}</MenuLabel>}
          {teams.map(team => {
            const helpers = team.panes.filter(pane => pane.role === 'helper').map(pane => ({ agentId: pane.agentId, profileId: pane.profileId }))

            return (
              <MenuItem
                key={team.id}
                hint={helpers.map(helper => config?.agents.find(agent => agent.id === helper.agentId)?.name || helper.agentId).join(', ')}
                onSelect={() => {
                  close()
                  add(helpers)
                }}
              >
                <IconUsersGroup /> {t(team.name)}
              </MenuItem>
            )
          })}
          <div className="px-2 pt-1.5 pb-1 text-[11px] leading-relaxed text-(--ui-text-tertiary)">
            {t('지금 대화는 그대로 두고, 보조를 옆에 열어 이 세션에 협업 방법을 알려 줍니다. 이후 일을 나누고 결과를 받는 것은 에이전트끼리 합니다.')}
          </div>
        </>
      )}
    </Menu>
  )
}
