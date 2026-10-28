import { useStore } from '@nanostores/react'
import {
  IconArrowsSplit2,
  IconChevronDown,
  IconDots,
  IconFileDiff,
  IconFolderOpen,
  IconGitBranch,
  IconGitMerge,
  IconPlus,
  IconSend,
  IconTerminal2,
  IconTrash,
  IconTrophy
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { Project, SessionInfo, WorktreeDiff, WorktreeInfo, WorktreeStatus, WorktreeSupport } from '../../../shared/types'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/menu'
import { Badge, Button, Dialog, Input, StatusDot, Textarea } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { $config, $project, $raceDraft, $sessions, $windowVisible, $worktrees, focusSession, launch, startRace, toast } from '../../store/app'
import { AgentGlyph, useInstalledAgents } from '../workspace/launch'

const live = (session: SessionInfo) => !session.dormant && session.status !== 'exited'

/** Open tabs working in the worktree, agents first. */
function useCopySessions(worktreeId: string): SessionInfo[] {
  const sessions = useStore($sessions)

  return Object.values(sessions)
    .filter(session => session.worktreeId === worktreeId && live(session))
    .sort((a, b) => Number(Boolean(b.activeAgentId)) - Number(Boolean(a.activeAgentId)) || a.createdAt - b.createdAt)
}

export function useWorktreeSupport(projectId: string | null): WorktreeSupport | null {
  const [support, setSupport] = useState<WorktreeSupport | null>(null)
  const worktrees = useStore($worktrees)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    void api
      .worktreeSupport(projectId)
      .then(next => alive && setSupport(next))
      .catch(() => undefined)

    return () => {
      alive = false
    }
    // A merge or a new copy changes the project folder's state too.
  }, [projectId, worktrees])

  return support
}

function summary(status: WorktreeStatus | undefined): string {
  if (!status) return ''
  if (!status.exists) return t('폴더가 없습니다')
  if (!status.files && !status.commits) return t('아직 변경 없음')

  return [
    t('파일 {count}개', { count: status.files }),
    `+${status.added} −${status.deleted}`,
    status.commits ? t('커밋 {count}개', { count: status.commits }) : '',
    status.uncommitted ? t('커밋 안 함 {count}', { count: status.uncommitted }) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

function conflictTask(branch: string, files: string[]): string {
  return t('이 작업 공간의 변경이 프로젝트의 {branch} 브랜치와 충돌합니다 (충돌 파일: {files}). 여기서 git merge {branch} 를 실행해 충돌을 해결하고 커밋한 뒤 알려 줘.', {
    branch,
    files: files.join(', ')
  })
}

/** Merge a copy into the project folder; on a conflict, offer to hand it to the copy's agent. */
async function mergeCopy(worktree: WorktreeInfo, mode: 'merge' | 'squash', projectBranch: string | null, agent: SessionInfo | undefined): Promise<boolean> {
  const result = await api.mergeWorktree(worktree.id, mode)

  if (result.ok) {
    toast(result.message || t('합쳤습니다.'))

    return true
  }

  if (result.conflicts?.length) {
    const files = result.conflicts.slice(0, 6).join(', ')
    const branch = projectBranch || worktree.baseBranch || 'main'

    if (agent && window.confirm(t('{files} 에서 충돌이 나서 합치지 않았습니다. 프로젝트 폴더는 그대로입니다.\n\n{name} 에게 이 작업 공간에서 충돌을 해결하라고 맡길까요? 끝나면 다시 합치면 됩니다.', { files, name: agent.name }))) {
      await api.send([agent.id], conflictTask(branch, result.conflicts), false)
      focusSession(agent)
    } else {
      toast(t('충돌이 나서 합치지 않았습니다: {files}', { files }), 'error')
    }

    return false
  }

  toast(result.message || t('합치지 못했습니다.'), 'error')

  return false
}

/** Delete a copy (and its tabs), after the user saw what would be lost. */
async function removeCopy(worktree: WorktreeInfo, status: WorktreeStatus | undefined, openTabs: number, ask = true): Promise<boolean> {
  if (ask) {
    const uncommitted = status?.uncommitted || 0
    const unmerged = status?.commits || 0
    const lost = [
      uncommitted ? t('커밋하지 않은 파일 {count}개', { count: uncommitted }) : '',
      unmerged ? t('합치지 않은 커밋 {count}개', { count: unmerged }) : ''
    ]
      .filter(Boolean)
      .join(', ')
    const lines = [
      lost ? t("작업 공간 '{label}' 을(를) 버릴까요? {lost} 이(가) 사라집니다.", { label: worktree.label, lost }) : t("작업 공간 '{label}' 을(를) 지울까요?", { label: worktree.label }),
      openTabs ? t('이 작업 공간에서 열린 탭 {count}개도 닫힙니다.', { count: openTabs }) : ''
    ]
    if (!window.confirm(lines.filter(Boolean).join(' '))) return false
  }

  const result = await api.removeWorktree(worktree.id, true)
  if (!result.ok) toast(result.message || t('지우지 못했습니다.'), 'error')

  return result.ok
}

function OpenMenu({ project, worktree, sessions }: { project: Project; worktree: WorktreeInfo; sessions: SessionInfo[] }) {
  const agents = useInstalledAgents()
  const open = (agentId: string | null) => void launch({ projectId: project.id, agentId, cwd: worktree.cwd, worktreeId: worktree.id })

  return (
    <Menu
      width={250}
      align="start"
      trigger={({ toggle }) => (
        <Button size="xs" variant="ghost" onClick={toggle}>
          <IconTerminal2 /> {t('열기')} <IconChevronDown />
        </Button>
      )}
    >
      {close => (
        <>
          {sessions.length > 0 && <MenuLabel>{t('열린 탭')}</MenuLabel>}
          {sessions.map(session => (
            <MenuItem
              key={session.id}
              onSelect={() => {
                close()
                focusSession(session)
              }}
            >
              <StatusDot status={session.status} /> {session.title} <span className="text-(--ui-text-tertiary)">{session.name}</span>
            </MenuItem>
          ))}
          <MenuLabel>{t('이 작업 공간에서 새로')}</MenuLabel>
          <MenuItem
            onSelect={() => {
              close()
              open(null)
            }}
          >
            <IconTerminal2 /> {t('터미널')}
          </MenuItem>
          {agents.map(agent => (
            <MenuItem
              key={agent.id}
              onSelect={() => {
                close()
                open(agent.id)
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

function CopyCard({
  project,
  worktree,
  status,
  support,
  onDiff,
  onPick
}: {
  project: Project
  worktree: WorktreeInfo
  status: WorktreeStatus | undefined
  support: WorktreeSupport | null
  onDiff: () => void
  onPick?: () => void
}) {
  const config = useStore($config)
  const sessions = useCopySessions(worktree.id)
  const agent = sessions.find(session => session.activeAgentId)
  const agentDef = config?.agents.find(entry => entry.id === (agent?.activeAgentId || worktree.agentId)) || null
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }
  const changed = Boolean(status && (status.files || status.commits))
  const mergeThenTidy = async (mode: 'merge' | 'squash') => {
    if (!(await mergeCopy(worktree, mode, support?.branch || null, agent))) return
    const question = t("합쳤습니다. 작업 공간 '{label}' 을(를) 지울까요? 계속 쓰려면 취소를 누르세요. 이어서 한 일도 나중에 다시 합칠 수 있습니다.", { label: worktree.label })
    if (window.confirm(question)) await removeCopy(worktree, undefined, 0, false)
  }

  return (
    <div className="rounded-lg bg-(--ui-bg-quaternary) px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {agent ? <StatusDot status={agent.status} /> : <IconGitBranch size={13} className="shrink-0 text-(--ui-text-tertiary)" />}
        {agentDef && <AgentGlyph agent={agentDef} size={14} />}
        <span className="truncate text-[12.5px] font-medium">{worktree.label}</span>
        {worktree.mergedAt && !changed && <Badge tone="ok">{t('합침')}</Badge>}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10.5px] text-(--ui-text-tertiary)" title={worktree.cwd}>
        {worktree.branch}
      </div>
      <div className={cn('mt-0.5 text-[11px]', changed ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-tertiary)')}>{summary(status)}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
        <OpenMenu project={project} worktree={worktree} sessions={sessions} />
        <Button size="xs" variant="ghost" disabled={!changed} onClick={onDiff}>
          <IconFileDiff /> {t('변경 보기')}
        </Button>
        {onPick ? (
          <Button size="xs" variant="ghost" disabled={!changed || busy} onClick={() => void run(async () => onPick())}>
            <IconTrophy /> {t('이걸로 고르기')}
          </Button>
        ) : (
          <Menu
            width={260}
            align="start"
            trigger={({ toggle }) => (
              <Button size="xs" variant="ghost" disabled={!changed || busy || !status?.exists} onClick={toggle}>
                <IconGitMerge /> {t('합치기')} <IconChevronDown />
              </Button>
            )}
          >
            {close => (
              <>
                <MenuLabel>
                  {/* Branch names are case-sensitive: not upper-cased like the other labels. */}
                  <span className="normal-case">{t('{branch} 브랜치에 합치기', { branch: support?.branch || worktree.baseBranch || '?' })}</span>
                </MenuLabel>
                <MenuItem
                  hint={t('커밋 기록 유지')}
                  onSelect={() => {
                    close()
                    void run(() => mergeThenTidy('merge'))
                  }}
                >
                  <IconGitMerge /> {t('합치기 (merge)')}
                </MenuItem>
                <MenuItem
                  hint={t('커밋 하나로')}
                  onSelect={() => {
                    close()
                    void run(() => mergeThenTidy('squash'))
                  }}
                >
                  <IconArrowsSplit2 /> {t('하나로 합치기 (squash)')}
                </MenuItem>
                <div className="px-2 pt-1 pb-1.5 text-[11px] leading-relaxed text-(--ui-text-tertiary)">
                  {t('커밋하지 않은 변경은 먼저 이 작업 공간에 커밋됩니다. 충돌이 나면 아무것도 바꾸지 않고 되돌립니다.')}
                </div>
              </>
            )}
          </Menu>
        )}
        <Menu
          width={220}
          align="end"
          trigger={({ toggle }) => (
            <Button size="icon-xs" variant="ghost" aria-label={t('더 보기')} className="ml-auto" onClick={toggle}>
              <IconDots />
            </Button>
          )}
        >
          {close => (
            <>
              <MenuItem
                onSelect={() => {
                  close()
                  void api.openWorktreeFolder(worktree.id)
                }}
              >
                <IconFolderOpen /> {t('폴더 열기')}
              </MenuItem>
              <MenuItem
                disabled={!status?.uncommitted}
                onSelect={() => {
                  close()
                  void run(async () => {
                    const result = await api.commitWorktree(worktree.id, worktree.task || worktree.label)
                    toast(result.message || (result.ok ? t('커밋했습니다.') : t('커밋하지 못했습니다.')), result.ok ? 'info' : 'error')
                  })
                }}
              >
                <IconGitBranch /> {t('변경을 커밋으로 저장')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => {
                  close()
                  void run(async () => {
                    const ok = await removeCopy(worktree, status, sessions.length)
                    if (ok) toast(t("작업 공간 '{label}' 을(를) 지웠습니다.", { label: worktree.label }))
                  })
                }}
              >
                <IconTrash /> {changed ? t('버리기') : t('지우기')}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  )
}

function NewCopy({ project }: { project: Project }) {
  const agents = useInstalledAgents()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (agentId: string | null) => {
    setBusy(true)
    try {
      const agent = agents.find(entry => entry.id === agentId)
      const result = await api.createWorktree(project.id, label.trim() || agent?.name || t('작업 공간'), agentId)
      $sessions.setKey(result.session.id, result.session)
      focusSession(result.session)
      setLabel('')
    } catch (error) {
      toast(t('작업 공간을 만들지 못했습니다: {error}', { error: (error as Error).message }), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input value={label} onChange={event => setLabel(event.target.value)} placeholder={t('이름 (예: 로그인 버그 수정)')} className="h-7 min-w-0 flex-1 text-[12px]" />
      <Menu
        width={240}
        align="end"
        trigger={({ toggle }) => (
          <Button size="sm" variant="default" disabled={busy} onClick={toggle}>
            <IconPlus /> {t('만들기')}
          </Button>
        )}
      >
        {close => (
          <>
            <MenuLabel>{t('만들고 그 안에서 열기')}</MenuLabel>
            {agents.map(agent => (
              <MenuItem
                key={agent.id}
                onSelect={() => {
                  close()
                  void create(agent.id)
                }}
              >
                <AgentGlyph agent={agent} /> {agent.name}
              </MenuItem>
            ))}
            <MenuItem
              onSelect={() => {
                close()
                void create(null)
              }}
            >
              <IconTerminal2 /> {t('터미널')}
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  )
}

function NoGit({ project, support }: { project: Project; support: WorktreeSupport }) {
  const [busy, setBusy] = useState(false)

  const init = async () => {
    const question = t("'{name}' 폴더를 git 저장소로 만들고 지금 파일을 첫 커밋으로 저장합니다. .gitignore 가 없으면 node_modules, .env 같은 것을 빼는 기본 .gitignore 를 만듭니다. 계속할까요?", { name: project.name })
    if (!window.confirm(question)) return
    setBusy(true)
    const result = await api.initRepository(project.id).catch(error => ({ ok: false, message: (error as Error).message }))
    setBusy(false)
    toast(result.ok ? t('git 저장소로 만들었습니다. 이제 작업 공간을 만들 수 있습니다.') : result.message || t('만들지 못했습니다.'), result.ok ? 'info' : 'error')
    $worktrees.set([...$worktrees.get()])
  }

  return (
    <div className="rounded-lg bg-(--ui-bg-quaternary) px-3 py-3 text-[12px] leading-relaxed text-(--ui-text-secondary)">
      <div>{support.reason}</div>
      {support.canInit && (
        <Button size="sm" className="mt-2" disabled={busy} onClick={() => void init()}>
          <IconGitBranch /> {t('git 저장소로 만들기')}
        </Button>
      )}
    </div>
  )
}

/** Right panel → 작업 공간: the project's worktrees, comparisons first. */
export function WorktreesPanel() {
  const project = useStore($project)
  const worktrees = useStore($worktrees)
  const visible = useStore($windowVisible)
  const support = useWorktreeSupport(project?.id || null)
  const [statuses, setStatuses] = useState<Record<string, WorktreeStatus>>({})
  const [diffFor, setDiffFor] = useState<WorktreeInfo | null>(null)
  const mine = useMemo(() => worktrees.filter(entry => entry.projectId === project?.id).sort((a, b) => b.createdAt - a.createdAt), [worktrees, project?.id])
  const ids = mine.map(entry => entry.id).join(',')

  const refresh = useCallback(() => {
    if (!ids) return
    void api
      .worktreeStatus(ids.split(','))
      .then(list => setStatuses(Object.fromEntries(list.map(status => [status.id, status]))))
      .catch(() => undefined)
  }, [ids])

  useEffect(() => {
    if (!visible) return
    refresh()
    const timer = setInterval(refresh, 4000)

    return () => clearInterval(timer)
  }, [refresh, visible])

  if (!project) return null

  const races = new Map<string, WorktreeInfo[]>()
  for (const entry of mine) if (entry.raceId) races.set(entry.raceId, [...(races.get(entry.raceId) || []), entry])
  const singles = mine.filter(entry => !entry.raceId)

  const pick = async (winner: WorktreeInfo, group: WorktreeInfo[]) => {
    const agent = Object.values($sessions.get()).find(session => session.worktreeId === winner.id && live(session) && session.activeAgentId)
    if (!(await mergeCopy(winner, 'squash', support?.branch || null, agent))) return
    const others = group.filter(entry => entry.id !== winner.id)
    if (!window.confirm(t('{label} 의 결과를 합쳤습니다. 이 비교의 작업 공간 {count}개(나머지 결과 포함)를 모두 지울까요?', { label: winner.label, count: group.length }))) return
    for (const entry of [...others, winner]) await removeCopy(entry, undefined, 0, false)
    toast(t('비교를 정리했습니다.'))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
      <div className="text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">
        {t('작업 공간은 프로젝트의 격리된 복사본(git worktree)입니다. AI 가 자기 브랜치에서 일하니 프로젝트 폴더는 그대로이고, 결과를 보고 합치거나 버립니다.')}
      </div>
      {!support ? null : !support.ok ? (
        <NoGit project={project} support={support} />
      ) : (
        <>
          <NewCopy project={project} />
          <Button size="sm" variant="outline" onClick={() => $raceDraft.set({ projectId: project.id, task: '' })}>
            <IconTrophy /> {t('여러 AI 에게 같은 일 시키고 고르기…')}
          </Button>
          {support.dirty > 0 && (
            <div className="text-[11px] leading-relaxed text-(--ui-text-tertiary)">
              {t('프로젝트 폴더의 커밋하지 않은 변경 {count}개는 새 작업 공간에 들어가지 않습니다. 작업 공간은 마지막 커밋에서 시작합니다.', { count: support.dirty })}
            </div>
          )}
        </>
      )}
      {[...races.entries()].map(([raceId, group]) => (
        <div key={raceId} className="flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-tertiary) p-1.5">
          <div className="flex items-center gap-1.5 px-1 text-[11.5px] text-(--ui-text-secondary)">
            <IconTrophy size={13} className="shrink-0" />
            <span className="truncate" title={group[0].task || ''}>
              {t('비교: {task}', { task: group[0].task || raceId })}
            </span>
          </div>
          {group.map(entry => (
            <CopyCard
              key={entry.id}
              project={project}
              worktree={entry}
              status={statuses[entry.id]}
              support={support}
              onDiff={() => setDiffFor(entry)}
              onPick={() => void pick(entry, group)}
            />
          ))}
        </div>
      ))}
      {singles.map(entry => (
        <CopyCard key={entry.id} project={project} worktree={entry} status={statuses[entry.id]} support={support} onDiff={() => setDiffFor(entry)} />
      ))}
      {support?.ok && !mine.length && <div className="px-1 py-2 text-[12px] text-(--ui-text-tertiary)">{t('아직 작업 공간이 없습니다.')}</div>}
      {diffFor && <DiffDialog worktree={diffFor} onClose={() => setDiffFor(null)} />}
    </div>
  )
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-(--ui-accent-text)'
  if (line.startsWith('+')) return 'bg-[color-mix(in_srgb,var(--status-idle)_14%,transparent)]'
  if (line.startsWith('-')) return 'bg-[color-mix(in_srgb,var(--status-waiting)_14%,transparent)]'

  return 'text-(--ui-text-secondary)'
}

/** Changes of a copy against where it started, with a note box that goes to its agent. */
export function DiffDialog({ worktree, onClose }: { worktree: WorktreeInfo; onClose: () => void }) {
  const [diff, setDiff] = useState<WorktreeDiff | null>(null)
  const [selected, setSelected] = useState(0)
  const [note, setNote] = useState('')
  const sessions = useCopySessions(worktree.id)
  const agent = sessions.find(session => session.activeAgentId)

  useEffect(() => {
    void api
      .worktreeDiff(worktree.id)
      .then(setDiff)
      .catch(() => setDiff({ files: [], truncated: false }))
  }, [worktree.id])

  const file = diff?.files[selected]

  const send = async () => {
    if (!agent || !note.trim()) return
    await api.send([agent.id], t('변경 내용을 검토한 메모입니다 ({file}):\n{note}', { file: file?.path || '-', note: note.trim() }), false)
    toast(t('{name} 에게 보냈습니다.', { name: agent.name }))
    setNote('')
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={980}
      title={
        <span className="flex items-center gap-2">
          <IconFileDiff size={16} /> {worktree.label} <span className="font-mono text-[11px] font-normal text-(--ui-text-tertiary)">{worktree.branch}</span>
        </span>
      }
      footer={
        <div className="flex w-full items-end gap-2">
          <Textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            rows={2}
            disabled={!agent}
            placeholder={agent ? t('{name} 에게 보낼 메모 (고칠 점, 질문)…', { name: agent.name }) : t('이 작업 공간에 열린 AI 가 없습니다.')}
            className="min-w-0 flex-1 text-[12px]"
          />
          <Button variant="default" disabled={!agent || !note.trim()} onClick={() => void send()}>
            <IconSend /> {t('보내기')}
          </Button>
          <Button onClick={onClose}>{t('닫기')}</Button>
        </div>
      }
    >
      {!diff ? (
        <div className="p-4 text-[12px] text-(--ui-text-tertiary)">{t('불러오는 중…')}</div>
      ) : !diff.files.length ? (
        <div className="p-4 text-[12px] text-(--ui-text-tertiary)">{t('아직 변경 없음')}</div>
      ) : (
        <div className="flex h-[56vh] min-h-0 gap-2">
          <div className="w-60 shrink-0 overflow-y-auto">
            {diff.files.map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => setSelected(index)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px]',
                  index === selected ? 'bg-(--chrome-action-hover) text-(--ui-text-primary)' : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
                )}
              >
                <span className="w-3 shrink-0 font-mono text-(--ui-text-tertiary)">{entry.status === '?' ? 'A' : entry.status}</span>
                <span className="min-w-0 flex-1 truncate" title={entry.path}>
                  {entry.path}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-(--ui-text-tertiary)">
                  +{entry.added} −{entry.deleted}
                </span>
              </button>
            ))}
            {diff.truncated && <div className="px-1.5 py-1 text-[11px] text-(--ui-text-tertiary)">{t('변경이 많아 일부만 보여 줍니다.')}</div>}
          </div>
          <div className="min-w-0 flex-1 overflow-auto rounded bg-(--ui-bg-quaternary) font-mono text-[11.5px] leading-[1.45]">
            {file?.binary ? (
              <div className="p-3 text-(--ui-text-tertiary)">{t('바이너리이거나 너무 큰 파일이라 내용을 보여 주지 않습니다.')}</div>
            ) : (
              <pre className="min-w-max p-2">
                {(file?.patch || '').split('\n').map((line, index) => (
                  <div key={index} className={cn('px-1 whitespace-pre', lineClass(line))}>
                    {line || ' '}
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** "Try with several AIs": the same task for 2–4 agents, each in a worktree of its own. */
export function RaceDialog() {
  const draft = useStore($raceDraft)
  const agents = useInstalledAgents()
  const [task, setTask] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!draft) return
    setTask(draft.task)
    setChosen(agents.slice(0, 2).map(agent => agent.id))
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  if (!draft) return null
  const close = () => $raceDraft.set(null)

  const start = async () => {
    setBusy(true)
    const ok = await startRace({ projectId: draft.projectId, task: task.trim(), agents: chosen.map(agentId => ({ agentId })) })
    setBusy(false)
    if (ok) close()
  }

  return (
    <Dialog
      open
      onClose={close}
      width={560}
      title={t('여러 AI 에게 같은 일 시키고 고르기')}
      footer={
        <>
          <Button onClick={close}>{t('취소')}</Button>
          <Button variant="default" disabled={busy || chosen.length < 2 || !task.trim()} onClick={() => void start()}>
            <IconTrophy /> {t('AI {count}개로 시작', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <div className="leading-relaxed text-(--ui-text-secondary)">
          {t('고른 AI 마다 작업 공간을 하나씩 만들어 같은 일을 맡깁니다. 끝나면 작업 공간 탭에서 변경을 비교하고, 마음에 드는 결과 하나를 프로젝트에 합칩니다.')}
        </div>
        <Textarea value={task} onChange={event => setTask(event.target.value)} rows={4} placeholder={t('맡길 일 (예: 로그인 화면에 비밀번호 보기 버튼 추가)')} />
        <div className="flex flex-wrap gap-1.5">
          {agents.map(agent => {
            const on = chosen.includes(agent.id)

            return (
              <button
                key={agent.id}
                type="button"
                disabled={!on && chosen.length >= 4}
                onClick={() => setChosen(previous => (on ? previous.filter(id => id !== agent.id) : [...previous, agent.id]))}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]',
                  on ? 'bg-(--ui-accent)/18 text-(--ui-accent-text)' : 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary) disabled:opacity-40'
                )}
              >
                <AgentGlyph agent={agent} size={14} /> {agent.name}
              </button>
            )
          })}
        </div>
        <div className="text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">
          {t('AI 는 2~4개 고릅니다. 각 AI 가 자기 사용량을 씁니다 (한 번 시킬 때의 AI 수만큼). 작업 공간 폴더에서 AI 가 처음 열리면 폴더를 믿을지 물을 수 있습니다.')}
        </div>
      </div>
    </Dialog>
  )
}
