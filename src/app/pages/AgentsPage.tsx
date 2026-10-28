import { useStore } from '@nanostores/react'
import { IconArrowUp, IconChevronRight, IconExternalLink, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'

import { t } from '../../../shared/i18n'
import type { AgentDef, TeamPreset } from '../../../shared/types'
import { newId } from '../../../shared/util'
import { Badge, Button, Dialog, Input, PageHeader, Section, Select, Switch } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $availability, $config, $view, updateConfig } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

function AgentEditor({ agent, onClose }: { agent: AgentDef; onClose: () => void }) {
  const [draft, setDraft] = useState<AgentDef>(agent)
  const field = (key: keyof AgentDef, label: string, placeholder?: string, mono = true) => (
    <label className="block">
      <div className="mb-1 text-[12px] text-(--ui-text-secondary)">{label}</div>
      <Input
        value={(draft[key] as string) || ''}
        placeholder={placeholder}
        className={mono ? 'font-mono text-[12px]' : undefined}
        onChange={event => setDraft({ ...draft, [key]: event.target.value })}
      />
    </label>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title={agent.builtin ? t('{name} 설정', { name: agent.name }) : agent.name ? t('{name} 편집', { name: agent.name }) : t('에이전트 추가')}
      footer={
        <>
          {!agent.builtin && agent.name && (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => {
                updateConfig(config => void (config.agents = config.agents.filter(entry => entry.id !== agent.id)))
                onClose()
              }}
            >
              <IconTrash /> {t('삭제')}
            </Button>
          )}
          <Button variant="text" onClick={onClose}>
            {t('취소')}
          </Button>
          <Button
            variant="default"
            disabled={!draft.name.trim() || !draft.command.trim()}
            onClick={() => {
              const edited = draft.busyPattern !== agent.busyPattern || draft.approvalPattern !== agent.approvalPattern
              const next = edited && agent.builtin ? { ...draft, customPatterns: true } : draft
              updateConfig(config => {
                const index = config.agents.findIndex(entry => entry.id === next.id)
                if (index >= 0) config.agents[index] = next
                else config.agents.push(next)
              })
              onClose()
              void api.availability().then(list => $availability.set(Object.fromEntries(list.map(entry => [entry.agentId, entry]))))
            }}
          >
            {t('저장')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!agent.builtin && field('name', t('이름'), 'My Agent', false)}
        {field('command', t('실행 명령 (셸에 그대로 입력됨)'), 'my-agent --flag')}
        {field('continueArgs', t('이어하기 인자 (마지막 대화 재개)'), '--continue')}
        <label className="block">
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">{t('색상')}</div>
          <input type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} className="h-8 w-14 rounded bg-transparent" />
        </label>
        {field('busyPattern', t('작업중 감지 정규식 (화면 하단)'), 'esc to interrupt')}
        {field('approvalPattern', t('승인 대기 감지 정규식'), 'do you want to|\\[y/n\\]')}
        {!agent.builtin && field('signature', t('화면 식별 정규식 (자동 감지용, 선택)'), 'My Agent v')}
        {!agent.builtin && field('profileEnv', t('계정 폴더 환경변수 (선택)'), 'MY_AGENT_HOME')}
        {!agent.builtin && field('systemPromptFlag', t('시스템 프롬프트 추가 플래그 (팀 메인용, 선택)'), '--system-prompt')}
      </div>
    </Dialog>
  )
}

function TeamEditor({ team, onClose }: { team: TeamPreset; onClose: () => void }) {
  const config = useStore($config)
  const [draft, setDraft] = useState<TeamPreset>(structuredClone(team))
  const agents = config?.agents.filter(agent => agent.enabled) || []

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('팀 프리셋')}
      footer={
        <>
          <Button
            variant="destructive"
            className="mr-auto"
            onClick={() => {
              updateConfig(next => void (next.teams = next.teams.filter(entry => entry.id !== team.id)))
              onClose()
            }}
          >
            <IconTrash /> {t('삭제')}
          </Button>
          <Button variant="text" onClick={onClose}>
            {t('취소')}
          </Button>
          <Button
            variant="default"
            disabled={!draft.name.trim() || !draft.panes.some(pane => pane.role === 'main')}
            onClick={() => {
              updateConfig(next => {
                const index = next.teams.findIndex(entry => entry.id === draft.id)
                if (index >= 0) next.teams[index] = draft
                else next.teams.push(draft)
              })
              onClose()
            }}
          >
            {t('저장')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t('팀 이름')} />
        {draft.panes.map((pane, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={pane.role}
              className="w-24"
              onChange={event => {
                const panes = draft.panes.map((entry, i) => (i === index ? { ...entry, role: event.target.value as 'main' | 'helper' } : entry))
                setDraft({ ...draft, panes })
              }}
            >
              <option value="main">{t('메인')}</option>
              <option value="helper">{t('보조')}</option>
            </Select>
            <Select
              value={pane.agentId}
              onChange={event => {
                const panes = draft.panes.map((entry, i) => (i === index ? { ...entry, agentId: event.target.value } : entry))
                setDraft({ ...draft, panes })
              }}
            >
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
            <Select
              value={pane.profileId || ''}
              className="w-36"
              onChange={event => {
                const panes = draft.panes.map((entry, i) => (i === index ? { ...entry, profileId: event.target.value || undefined } : entry))
                setDraft({ ...draft, panes })
              }}
            >
              <option value="">{t('기본 계정')}</option>
              {config?.profiles
                .filter(profile => profile.agentId === pane.agentId)
                .map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
            </Select>
            <Button size="icon-sm" variant="ghost" aria-label={t('제거')} onClick={() => setDraft({ ...draft, panes: draft.panes.filter((_, i) => i !== index) })}>
              <IconTrash />
            </Button>
          </div>
        ))}
        {draft.panes.length < 4 && (
          <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, panes: [...draft.panes, { agentId: agents[0]?.id || 'claude', role: 'helper' }] })}>
            <IconPlus /> {t('세션 추가')}
          </Button>
        )}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-[13px]">{t('메인 에이전트에게 팀 구성·hera 사용법 브리핑')}</div>
            <div className="text-[11.5px] text-(--ui-text-tertiary)">{t('시스템 프롬프트 플래그를 지원하는 에이전트(Claude Code)에 적용됩니다.')}</div>
          </div>
          <Switch checked={draft.brief} onChange={brief => setDraft({ ...draft, brief })} label={t('브리핑')} />
        </div>
      </div>
    </Dialog>
  )
}

export function AgentsPage() {
  const config = useStore($config)
  const availability = useStore($availability)
  const [editing, setEditing] = useState<AgentDef | null>(null)
  const [editingTeam, setEditingTeam] = useState<TeamPreset | null>(null)

  const [showMore, setShowMore] = useState(false)

  const agents = config?.agents || []
  // Installed CLIs and the user's own come first; the rest of the catalog folds away.
  const listed = agents.filter(agent => availability[agent.id]?.installed || !agent.builtin)
  const more = agents.filter(agent => !listed.includes(agent))

  const row = (agent: AgentDef) => {
    const found = availability[agent.id]

    return (
      <div key={agent.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-(--chrome-action-hover)">
        <AgentGlyph agent={agent} size={20} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(agent)}>
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {agent.name}
            {found?.installed ? <Badge tone="ok">{t('설치됨')}</Badge> : <Badge>{t('미설치')}</Badge>}
            {agent.usageProvider && <Badge tone="accent">{t('사용량 추적')}</Badge>}
            {agent.profileEnv && <Badge>{t('계정 프로필')}</Badge>}
          </div>
          <div className="truncate font-mono text-[11px] text-(--ui-text-tertiary)">
            {found?.path || agent.command}
            {!found?.installed && agent.installHint ? ` — ${t('설치: {hint}', { hint: agent.installHint })}` : ''}
          </div>
        </button>
        {agent.homepage && (
          <a href={agent.homepage} target="_blank" rel="noreferrer" aria-label={t('{name} 홈페이지', { name: agent.name })} className="rounded p-1 text-(--ui-text-tertiary) hover:text-(--ui-text-primary)">
            <IconExternalLink size={14} />
          </a>
        )}
        <Switch
          checked={agent.enabled}
          label={t('{name} 사용', { name: agent.name })}
          onChange={enabled => updateConfig(next => void (next.agents.find(entry => entry.id === agent.id)!.enabled = enabled))}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('에이전트')}
        description={t('터미널에서 도는 AI CLI 라면 무엇이든 등록할 수 있습니다. PATH 에서 찾은 것만 실행 메뉴에 나타납니다.')}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => $view.set('extensions')}>
              <IconArrowUp /> {t('확장 · 업데이트')}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setEditing({ id: newId('agent_'), name: '', command: '', color: '#8e8e93', enabled: true, builtin: false })
              }
            >
              <IconPlus /> {t('에이전트 추가')}
            </Button>
          </>
        }
      />
      <div className="space-y-1">
        {listed.map(row)}
        {!listed.length && <div className="px-2 py-2 text-[12.5px] text-(--ui-text-tertiary)">{t('PATH 에서 찾은 AI CLI 가 없습니다. 아래 목록에서 설치 방법을 볼 수 있습니다.')}</div>}
      </div>

      {more.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)"
          >
            <IconChevronRight size={14} className={showMore ? 'rotate-90 transition-transform' : 'transition-transform'} />
            {t('지원하는 다른 AI CLI {count}개 (설치하면 자동으로 위로 올라옵니다)', { count: more.length })}
          </button>
          {showMore && <div className="mt-1 space-y-1">{more.map(row)}</div>}
        </div>
      )}

      <Section
        title={t('팀 프리셋 (한 폴더에 여러 AI 동시 실행)')}
        className="mt-6"
        action={
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditingTeam({ id: newId('team_'), name: t('새 팀'), brief: true, panes: [{ agentId: 'claude', role: 'main' }, { agentId: 'codex', role: 'helper' }] })}
          >
            <IconPlus /> {t('팀 추가')}
          </Button>
        }
      >
        <div className="space-y-1">
          {config?.teams.map(team => (
            <button
              key={team.id}
              type="button"
              onClick={() => setEditingTeam(team)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-(--chrome-action-hover)"
            >
              <div className="flex -space-x-1">
                {team.panes.map((pane, index) => (
                  <AgentGlyph key={index} agent={config.agents.find(agent => agent.id === pane.agentId) || null} size={18} />
                ))}
              </div>
              <span className="text-[13px]">{t(team.name)}</span>
              <span className="text-[11px] text-(--ui-text-tertiary)">
                {team.panes.map(pane => `${pane.role === 'main' ? t('메인') : t('보조')}:${pane.agentId}`).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {editing && <AgentEditor agent={editing} onClose={() => setEditing(null)} />}
      {editingTeam && <TeamEditor team={editingTeam} onClose={() => setEditingTeam(null)} />}
    </div>
  )
}
