// Multi-agent work started from the window: a backlog item, a typed request, or an
// open session that should start leading helpers. HERA opens (or reuses) the helpers,
// waits until every agent is on screen, then briefs the lead and hands it the task.
// The lead hands work off with the hera CLI by itself, and bus.ts answers for a helper
// that finishes without replying, so the user does not relay anything.
import { t } from '../shared/i18n'
import type { CreateSessionRequest, SessionInfo, StartWorkRequest, StartWorkResult } from '../shared/types'

import { sendFromUser } from './bus'
import { getSession, isReady, listSessions, setRole } from './pty-host'
import { quoteArg, resolveShell } from './shell'
import { getConfig, projectById } from './store'

/** A lead that is busy or answering a prompt gets the task when it is free, for this long. */
const LEAD_WAIT_MS = 10 * 60_000
/** Helpers that never show up do not hold the task back longer than this. */
const HELPER_WAIT_MS = 2 * 60_000
const MAX_HELPERS = 3

/** What a team's lead is told about its helpers and the hera protocol. */
export function teamBrief(teamName: string | null | undefined, helpers: SessionInfo[]): string {
  const agents = getConfig().agents
  const roster = helpers.map(helper => `${helper.name} (${agents.find(agent => agent.id === (helper.activeAgentId || helper.agentId))?.name || helper.agentId})`).join(', ')

  return [
    teamName ? t("너는 JYSV HERA 팀 '{team}'의 메인 에이전트다.", { team: teamName }) : t('너는 JYSV HERA 멀티 에이전트 작업의 메인 에이전트다.'),
    t('같은 프로젝트에 보조 에이전트 세션이 떠 있다: {roster}.', { roster }),
    t('셸에서 hera CLI 로 일을 나눈다:'),
    t("hera send <이름> '작업' (맡기고 바로 돌아옴. 결과는 [HERA reply ...] 메시지로 네 입력창에 도착하고, 보조가 회신하지 않아도 끝나면 HERA 가 마지막 화면을 대신 보낸다) /"),
    t("hera ask <이름> '작업' (끝날 때까지 기다렸다가 화면 결과를 받음) / hera peek <이름> (상대 화면 보기) / hera key <이름> enter (승인 질문에 답함) / hera list (세션 상태)."),
    t('서로 독립적인 하위 작업을 각 보조의 강점에 맞게 나눠 맡기고, 그동안 네 몫을 진행해라. 돌아온 결과는 직접 확인한 뒤 반영하고, 끝나면 무엇을 했는지 사용자에게 요약해라.'),
    t('긴 지시는 파일로 자동 전달되니 그대로 보내도 된다.')
  ].join(' ')
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Type `text` into the lead once it and its helpers are ready for it. */
async function handOver(leadId: string, helperIds: string[], text: string) {
  const started = Date.now()

  for (;;) {
    const lead = getSession(leadId)
    if (!lead || lead.status === 'exited') return

    const helpersReady = helperIds.every(id => isReady(id) || !getSession(id)) || Date.now() - started > HELPER_WAIT_MS
    if (isReady(leadId) && helpersReady) break
    // Never type into a prompt the lead is answering (a trust or approval question).
    if (Date.now() - started > LEAD_WAIT_MS) return

    await sleep(500)
  }

  try {
    sendFromUser([leadId], text, false)
  } catch {
    // closed in the meantime
  }
}

export function startWork(req: StartWorkRequest, launch: (req: CreateSessionRequest) => SessionInfo): StartWorkResult {
  const config = getConfig()
  const project = projectById(req.projectId)
  if (!project) throw new Error(t('프로젝트를 찾지 못했습니다.'))

  const task = (req.task || '').trim()
  const known = (agentId: string) => config.agents.some(agent => agent.id === agentId)
  const open = listSessions().filter(session => session.projectId === project.id && !session.dormant && session.status !== 'exited' && !session.lane)
  let lead: SessionInfo | null = null

  if (req.leadId) {
    lead = open.find(session => session.id === req.leadId) || null
    if (!lead) throw new Error(t('그 세션은 이미 닫혔습니다.'))
    if (!lead.activeAgentId) throw new Error(t('{name} 에는 AI 에이전트가 실행 중이 아닙니다.', { name: lead.name }))
  } else if (!req.lead || !known(req.lead.agentId)) {
    throw new Error(t('이끌 에이전트를 고르세요.'))
  }

  const used = new Set<string>(lead ? [lead.id] : [])
  const helpers: SessionInfo[] = []

  for (const want of (req.helpers || []).filter(entry => known(entry.agentId)).slice(0, MAX_HELPERS)) {
    const reuse = open.find(session => !used.has(session.id) && session.role !== 'main' && (session.activeAgentId || session.agentId) === want.agentId)

    if (reuse) {
      setRole(reuse.id, 'helper')
      used.add(reuse.id)
      helpers.push(getSession(reuse.id) || reuse)
    } else {
      const helper = launch({ projectId: project.id, agentId: want.agentId, profileId: want.profileId || null, role: 'helper', parentId: lead?.id || null })
      used.add(helper.id)
      helpers.push(helper)
    }
  }

  // A new lead whose CLI takes a system prompt gets the brief there; anyone else reads it in the message.
  let briefInPrompt = false

  if (!lead) {
    const agent = config.agents.find(entry => entry.id === req.lead!.agentId)!
    let extraArgs: string | undefined

    if (helpers.length && agent.systemPromptFlag) {
      const kind = resolveShell(project.shell || config.settings.defaultShell).kind
      extraArgs = `${agent.systemPromptFlag} ${quoteArg(kind, teamBrief(req.teamName, helpers))}`
      briefInPrompt = true
    }

    lead = launch({ projectId: project.id, agentId: agent.id, profileId: req.lead!.profileId || null, role: helpers.length ? 'main' : null, extraArgs })
  } else if (helpers.length) {
    setRole(lead.id, 'main')
  }

  const parts: string[] = []
  if (helpers.length && !briefInPrompt) parts.push(teamBrief(req.teamName, helpers))
  if (task) parts.push(t('작업: {task}', { task }))
  else if (helpers.length) parts.push(t('지금 하던 작업에서 따로 떼어 맡길 수 있는 부분이 있으면 보조에게 맡기고, 없으면 다음 요청부터 그렇게 진행해라.'))

  if (parts.length) void handOver(lead.id, helpers.map(helper => helper.id), parts.join('\n\n'))

  return { lead: getSession(lead.id) || lead, helpers: helpers.map(helper => getSession(helper.id) || helper) }
}
