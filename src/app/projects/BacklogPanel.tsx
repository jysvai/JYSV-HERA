import { useStore } from '@nanostores/react'
import {
  IconCheck,
  IconFolder,
  IconGitBranch,
  IconGitCommit,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrash
} from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { ProjectInsight } from '../../../shared/types'
import { newId, relTime } from '../../../shared/util'
import { Badge, Button, Section, Tip } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, $insightTick, $project, $sessions, launch, updateProject } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'
import { ProjectUsageSection } from '../pages/usage-parts'
import { $editProjectId } from './flows'

function useInsight(projectId: string | null) {
  const [insight, setInsight] = useState<ProjectInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const tick = useStore($insightTick)

  const request = useRef(0)

  const load = (force = false) => {
    if (!projectId) return
    // Drop answers that arrive after the user switched project.
    const mine = ++request.current
    setLoading(true)
    void api
      .insight(projectId, force)
      .then(result => mine === request.current && setInsight(result))
      .finally(() => mine === request.current && setLoading(false))
  }

  useEffect(() => {
    setInsight(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tick])

  return { insight, loading, reload: () => load(true) }
}

function NotesEditor({ projectId, value }: { projectId: string; value: string }) {
  const [text, setText] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setText(value), [projectId, value])

  return (
    <textarea
      value={text}
      spellCheck={false}
      placeholder={t('이 프로젝트 메모 (자동 저장)')}
      onChange={event => {
        const next = event.target.value
        setText(next)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => updateProject(projectId, draft => void (draft.notes = next)), 600)
      }}
      className="min-h-24 w-full resize-y rounded-md bg-(--ui-bg-quaternary) px-2.5 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-(--ui-text-tertiary) focus:ring-1 focus:ring-(--ui-accent)/50"
    />
  )
}

export function BacklogPanel() {
  const project = useStore($project)
  const config = useStore($config)
  const sessions = useStore($sessions)
  const { insight, loading, reload } = useInsight(project?.id || null)
  const [todo, setTodo] = useState('')

  if (!project) return null

  const agentOf = (id: string) => config?.agents.find(agent => agent.id === id) || null
  const live = Object.values(sessions).filter(session => session.projectId === project.id && !session.dormant)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{project.name}</div>
          <button
            type="button"
            onClick={() => void api.openFolder(project.id)}
            className="mt-0.5 flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)"
          >
            <IconFolder size={12} className="shrink-0" />
            <span className="truncate">{project.path}</span>
          </button>
        </div>
        <Tip label={t('새로고침')}>
          <Button size="icon-xs" variant="ghost" aria-label={t('새로고침')} onClick={reload} disabled={loading}>
            <IconRefresh className={loading ? 'animate-spin' : undefined} />
          </Button>
        </Tip>
        <Tip label={t('프로젝트 설정')}>
          <Button size="icon-xs" variant="ghost" aria-label={t('프로젝트 설정')} onClick={() => $editProjectId.set(project.id)}>
            <IconSettings />
          </Button>
        </Tip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {insight && !insight.exists && <div className="mb-2 rounded-md bg-(--status-waiting)/12 px-3 py-2 text-[12px] text-(--status-waiting)">{t('폴더를 찾을 수 없습니다.')}</div>}

        <Section title={t('마지막 실행')}>
          {insight?.lastLaunch ? (
            <div className="text-[12.5px]">
              <span className="font-medium">{relTime(insight.lastLaunch.t)}</span>
              <span className="text-(--ui-text-tertiary)"> · {insight.lastLaunch.label}</span>
              <div className="mt-0.5 text-[11px] text-(--ui-text-tertiary)">{new Date(insight.lastLaunch.t).toLocaleString()}</div>
            </div>
          ) : (
            <div className="text-[12px] text-(--ui-text-tertiary)">{t('HERA 에서 아직 실행한 적이 없습니다.')}</div>
          )}
          {live.length > 0 && (
            <div className="mt-2 text-[11.5px] text-(--ui-text-secondary)">
              {t('지금 열린 세션 {count}개 · 작업중 {busy}', { count: live.length, busy: live.filter(session => session.status === 'busy').length })}
              {live.some(session => session.status === 'waiting') && <span className="text-(--status-waiting)"> · {t('승인 대기 있음')}</span>}
            </div>
          )}
        </Section>

        <Section title={t('마지막 변경')}>
          {insight?.git ? (
            <div className="space-y-2 text-[12.5px]">
              <div className="flex items-center gap-1.5 text-(--ui-text-secondary)">
                <IconGitBranch size={13} />
                <span className="font-mono text-[12px]">{insight.git.branch || '?'}</span>
                {insight.git.ahead > 0 && <Badge tone="accent">↑{insight.git.ahead}</Badge>}
                {insight.git.behind > 0 && <Badge tone="warn">↓{insight.git.behind}</Badge>}
                {insight.git.changed > 0 ? <Badge tone="warn">{t('변경 {count}', { count: insight.git.changed })}</Badge> : <Badge tone="ok">{t('깨끗함')}</Badge>}
              </div>
              {insight.git.lastCommit && (
                <div className="flex gap-1.5">
                  <IconGitCommit size={14} className="mt-0.5 shrink-0 text-(--ui-text-tertiary)" />
                  <div className="min-w-0">
                    <div className="leading-snug">{insight.git.lastCommit.subject}</div>
                    <div className="mt-0.5 text-[11px] text-(--ui-text-tertiary)">
                      {insight.git.lastCommit.hash} · {insight.git.lastCommit.author} · {relTime(insight.git.lastCommit.when)}
                    </div>
                  </div>
                </div>
              )}
              {insight.git.changedSample.length > 0 && (
                <ul className="space-y-0.5 font-mono text-[11.5px]">
                  {insight.git.changedSample.map(file => (
                    <li key={file.path} className="flex gap-2 truncate">
                      <span className="w-4 shrink-0 text-(--status-busy)">{file.status}</span>
                      <span className="truncate text-(--ui-text-secondary)">{file.path}</span>
                    </li>
                  ))}
                  {insight.git.changed > insight.git.changedSample.length && (
                    <li className="text-(--ui-text-tertiary)">{t('… 외 {count}개', { count: insight.git.changed - insight.git.changedSample.length })}</li>
                  )}
                </ul>
              )}
            </div>
          ) : insight?.recentFiles.length ? (
            <ul className="space-y-0.5 text-[11.5px]">
              {insight.recentFiles.map(file => (
                <li key={file.path} className="flex justify-between gap-2">
                  <span className="truncate font-mono text-(--ui-text-secondary)">{file.path}</span>
                  <span className="shrink-0 text-(--ui-text-tertiary)">{relTime(file.mtime)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12px] text-(--ui-text-tertiary)">{insight ? t('변경 기록이 없습니다.') : t('불러오는 중…')}</div>
          )}
        </Section>

        <Section title={t('토큰 사용량')}>
          <ProjectUsageSection projectId={project.id} />
        </Section>

        <Section title={t('AI 작업 기록')}>
          {insight?.activity.length ? (
            <div className="space-y-3">
              {insight.activity.map(entry => {
                const agent = agentOf(entry.agentId)

                return (
                  <div key={entry.agentId} className="group">
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <AgentGlyph agent={agent} size={15} />
                      <span className="font-medium">{agent?.name || entry.agentId}</span>
                      <span className="text-[11px] text-(--ui-text-tertiary)">
                        {relTime(entry.lastAt)} · {t('세션 {count}', { count: entry.sessions })}
                      </span>
                      {agent?.continueArgs && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="ml-auto opacity-0 group-hover:opacity-100"
                          onClick={() => void launch({ projectId: project.id, agentId: entry.agentId, resume: true })}
                        >
                          <IconPlayerPlay /> {t('이어하기')}
                        </Button>
                      )}
                    </div>
                    {entry.lastPrompt && <div className="mt-1 line-clamp-3 pl-[23px] text-[12px] leading-relaxed text-(--ui-text-secondary)">“{entry.lastPrompt}”</div>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[12px] text-(--ui-text-tertiary)">{insight ? t('Claude · Codex · Antigravity 기록이 없습니다.') : t('불러오는 중…')}</div>
          )}
        </Section>

        <Section title={`${t('할 일')} ${project.todos.filter(item => !item.done).length || ''}`}>
          <div className="space-y-1">
            {project.todos.map(item => (
              <div key={item.id} className="group flex items-start gap-2 text-[12.5px]">
                <button
                  type="button"
                  aria-label={item.done ? t('완료 취소') : t('완료')}
                  onClick={() =>
                    updateProject(project.id, draft => {
                      const target = draft.todos.find(entry => entry.id === item.id)
                      if (target) target.done = !target.done
                    })
                  }
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${item.done ? 'border-(--ui-accent) bg-(--ui-accent) text-(--ui-accent-fg)' : 'border-(--ui-stroke-primary)'}`}
                >
                  {item.done && <IconCheck size={11} />}
                </button>
                <span className={`flex-1 leading-snug ${item.done ? 'text-(--ui-text-tertiary) line-through' : ''}`}>{item.text}</span>
                <button
                  type="button"
                  aria-label={t('삭제')}
                  onClick={() => updateProject(project.id, draft => void (draft.todos = draft.todos.filter(entry => entry.id !== item.id)))}
                  className="opacity-0 group-hover:opacity-100 text-(--ui-text-tertiary) hover:text-(--status-waiting)"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
            <form
              className="flex items-center gap-2"
              onSubmit={event => {
                event.preventDefault()
                const text = todo.trim()
                if (!text) return
                updateProject(project.id, draft => void draft.todos.push({ id: newId('t_'), text, done: false, createdAt: Date.now() }))
                setTodo('')
              }}
            >
              <IconPlus size={14} className="shrink-0 text-(--ui-text-tertiary)" />
              <input
                value={todo}
                onChange={event => setTodo(event.target.value)}
                placeholder={t('할 일 추가')}
                className="h-7 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--ui-text-tertiary)"
              />
            </form>
          </div>
        </Section>

        <Section title={t('메모')}>
          <NotesEditor projectId={project.id} value={project.notes} />
        </Section>

        {insight && insight.launches.length > 1 && (
          <Section title={t('실행 기록')}>
            <ul className="space-y-1 text-[11.5px]">
              {insight.launches.slice(0, 12).map(record => (
                <li key={record.t} className="flex justify-between gap-2">
                  <span className="truncate text-(--ui-text-secondary)">{record.label}</span>
                  <span className="shrink-0 text-(--ui-text-tertiary)">{relTime(record.t)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  )
}
