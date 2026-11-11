import { useStore } from '@nanostores/react'
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconEye, IconFileDiff, IconGitBranch, IconPencil } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { ActivityFile, ActivityRun, ProjectActivity } from '../../../shared/types'
import { formatTokens } from '../../../shared/util'
import { cn } from '../../lib/cn'
import { formatUsd } from '../../lib/usage'
import { $config, $liveActivity, $sessions, focusSession } from '../../store/app'

import { ChangesDialog, LineCounts } from './ChangesDialog'

const FILES_SHOWN = 8

export const READ_COLOR = 'var(--activity-read)'
export const EDIT_COLOR = 'var(--activity-edit)'
export const CONFLICT_COLOR = 'var(--status-waiting)'

export const fileColor = (file: Pick<ActivityFile, 'kind' | 'conflict'>) => (file.conflict ? CONFLICT_COLOR : file.kind === 'edit' ? EDIT_COLOR : READ_COLOR)

/** "claude-opus-5-5" → "Opus 5.5"; other models keep their own name. */
export function modelName(model: string | null): string {
  if (!model) return ''
  const claude = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model)
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`

  // A Bedrock inference-profile ARN would fill the row: its last part names it.
  return model.replace(/^arn:.*\//, '').replace(/^claude-/, '')
}

/** A subagent on a cheap model can cost a fraction of a cent: say so instead of "$0.00". */
const formatCost = (usd: number) => (usd < 0.01 ? '<$0.01' : formatUsd(usd))

function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 5) return t('방금')
  if (seconds < 60) return t('{sec}초 전', { sec: seconds })

  return t('{min}분 전', { min: Math.floor(seconds / 60) })
}

function readOpen(): boolean {
  try {
    return localStorage.getItem('hera.liveWork') !== 'closed'
  } catch {
    return true
  }
}

/** The project's live activity, with an empty value when nothing is going on. */
export function useLiveActivity(projectId: string | null): ProjectActivity | null {
  const all = useStore($liveActivity)

  return projectId ? all[projectId] || null : null
}

/** Share of the generated tokens per model, across every run of this work. */
function shares(runs: ActivityRun[], colorOf: (run: ActivityRun) => string) {
  const byModel = new Map<string, { output: number; color: string; agentId: string | null }>()

  for (const run of runs) {
    if (!run.output) continue
    const key = run.model || run.label
    const entry = byModel.get(key) || { output: 0, color: colorOf(run), agentId: run.agentId }
    entry.output += run.output
    byModel.set(key, entry)
  }

  const total = [...byModel.values()].reduce((sum, entry) => sum + entry.output, 0)
  const list = [...byModel.entries()].map(([model, entry]) => ({ model, ...entry, share: total ? entry.output / total : 0 })).sort((a, b) => b.output - a.output)
  // Models of the same agent (a main model and its subagents' cheaper one) share its color in lighter steps.
  const steps = new Map<string | null, number>()

  return list.map(entry => {
    const step = steps.get(entry.agentId) || 0
    steps.set(entry.agentId, step + 1)

    return { ...entry, color: step ? `color-mix(in srgb, ${entry.color} ${Math.max(30, 100 - step * 30)}%, transparent)` : entry.color }
  })
}

function ProgressBar({ run, color }: { run: ActivityRun; color: string }) {
  const plan = run.plan
  const fraction = plan && plan.total ? plan.done / plan.total : run.state === 'done' ? 1 : null

  return (
    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-(--ui-bg-quaternary)" style={{ ['--bar-color' as string]: color }}>
      {fraction === null ? (
        <div className={cn('h-full w-full', run.state === 'working' ? 'activity-indeterminate' : 'opacity-50')} style={run.state === 'working' ? undefined : { background: color }} />
      ) : (
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(4, fraction * 100)}%`, background: run.state === 'done' ? 'var(--status-idle)' : color }} />
      )}
    </div>
  )
}

function RunRow({ run, color, nested, now }: { run: ActivityRun; color: string; nested: boolean; now: number }) {
  const state = run.state === 'working' ? t('작업 중') : run.state === 'waiting' ? t('응답 기다림') : t('완료')
  const plan = run.plan
  const detail = [
    plan?.current ? t('지금: {step}', { step: plan.current }) : null,
    run.edits ? t('파일 {count}개 수정', { count: run.edits }) + (run.added || run.removed ? ` (+${run.added} −${run.removed})` : '') : null,
    run.tools ? t('도구 {count}회', { count: run.tools }) : null,
    run.tokens ? t('{tokens} 토큰', { tokens: formatTokens(run.tokens) }) : null
  ].filter(Boolean)

  return (
    <button
      type="button"
      onClick={() => {
        const session = $sessions.get()[run.sessionId]
        if (session) focusSession(session)
      }}
      title={[run.task || t('이어지는 작업'), ...detail, run.state === 'done' ? ago(run.updatedAt, now) : ''].filter(Boolean).join('\n')}
      className={cn('flex w-full flex-col gap-1 rounded-md py-1 pr-1.5 text-left hover:bg-(--chrome-action-hover)', nested ? 'pl-6' : 'pl-1.5')}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5 text-[12px]">
        <span className={cn('status-dot', run.state === 'working' ? 'status-busy' : run.state === 'waiting' ? 'status-waiting' : 'status-idle')} style={run.state === 'working' ? { background: color } : undefined} />
        <span className="shrink-0 font-medium">{run.label}</span>
        {run.model && <span className="min-w-0 truncate text-(--ui-text-tertiary)">{modelName(run.model)}</span>}
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-(--ui-text-tertiary)">
          {plan && plan.total ? `${plan.done}/${plan.total}` : state}
          {run.costUsd ? ` · ${formatCost(run.costUsd)}` : ''}
        </span>
      </div>
      <div className="flex w-full min-w-0 items-center gap-1.5 pl-[13px]">
        <ProgressBar run={run} color={color} />
      </div>
      <div className={cn('w-full truncate pl-[13px] text-[11px]', nested ? 'text-(--ui-text-tertiary)' : 'text-(--ui-text-secondary)')}>{run.task || t('이어지는 작업')}</div>
      {plan?.current && run.state !== 'done' && <div className="w-full truncate pl-[13px] text-[10.5px] text-(--ui-text-tertiary)">▸ {plan.current}</div>}
    </button>
  )
}

function FileRow({ file, runs, now, onReveal, onDiff }: { file: ActivityFile; runs: Map<string, ActivityRun>; now: number; onReveal: (rel: string) => void; onDiff: (path: string) => void }) {
  const name = file.path.split(/[\\/]/).pop() || file.path
  const where = file.rel ? file.rel.slice(0, Math.max(0, file.rel.length - name.length - 1)) : file.path.slice(0, Math.max(0, file.path.length - name.length - 1))
  const color = fileColor(file)
  const who = file.by.map(id => runs.get(id)?.label || '').filter(Boolean)
  const kind = file.conflict ? t('여러 에이전트가 함께 수정 중') : file.kind === 'edit' ? t('수정 중') : t('보는 중')
  const Icon = file.conflict ? IconAlertTriangle : file.kind === 'edit' ? IconPencil : IconEye
  // A changed file opens what changed and who depends on it; a read one shows where it is.
  const diff = file.kind === 'edit'

  return (
    <button
      type="button"
      disabled={!diff && (!file.rel || Boolean(file.worktree))}
      onClick={() => (diff ? onDiff(file.path) : file.rel && !file.worktree && onReveal(file.rel))}
      title={`${file.path}\n${kind} · ${who.join(', ')}${file.worktree ? `\n${t('작업 공간: {name}', { name: file.worktree })}` : ''}${diff ? `\n${t('누르면 바뀐 내용과 영향 범위를 봅니다.')}` : ''}`}
      className="flex h-[24px] w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] hover:bg-(--chrome-action-hover) disabled:hover:bg-transparent"
    >
      <Icon size={13} className="shrink-0" style={{ color }} />
      <span className="shrink-0 truncate font-medium" style={{ color: file.conflict ? color : undefined, maxWidth: '55%' }}>
        {name}
      </span>
      {file.worktree && <IconGitBranch size={11} className="shrink-0 text-(--ui-text-tertiary)" />}
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-(--ui-text-tertiary)">{where}</span>
      <LineCounts added={file.added} removed={file.removed} />
      <span className="shrink-0 text-[10.5px] text-(--ui-text-tertiary)">
        {who[0] || ''}
        {who.length > 1 ? ` +${who.length - 1}` : ''} · {ago(file.at, now)}
      </span>
    </button>
  )
}

/** Folder panel, above the tree: what the agents are doing in this project right now. */
export function LiveWork({ projectId, onReveal }: { projectId: string; onReveal: (rel: string) => void }) {
  const activity = useLiveActivity(projectId)
  const agents = useStore($config)?.agents || []
  const [open, setOpen] = useState(readOpen)
  const [allFiles, setAllFiles] = useState(false)
  /** The changes dialog: open on this file (null: the newest change). */
  const [changesFor, setChangesFor] = useState<{ file: string | null } | null>(null)
  const [now, setNow] = useState(Date.now())
  const runs = activity?.runs || []
  const files = activity?.files || []
  const busy = runs.some(run => run.state !== 'done')

  // Ages ("12초 전") and fading reads move on their own.
  useEffect(() => {
    if (!runs.length && !files.length) return
    const timer = setInterval(() => setNow(Date.now()), busy ? 2000 : 10_000)
    return () => clearInterval(timer)
  }, [busy, runs.length, files.length])

  const toggle = () => {
    setOpen(value => {
      try {
        localStorage.setItem('hera.liveWork', value ? 'closed' : 'open')
      } catch {
        // private storage: the choice lasts for this window only
      }
      return !value
    })
  }

  const colorOf = (run: ActivityRun) => agents.find(agent => agent.id === run.agentId)?.color || 'var(--ui-accent)'
  const byId = new Map(runs.map(run => [run.id, run]))
  const mains = runs.filter(run => !run.parentId || !byId.has(run.parentId)).sort((a, b) => a.startedAt - b.startedAt)
  const parts = shares(runs, colorOf)
  const cost = runs.reduce((sum, run) => sum + (run.costUsd || 0), 0)
  const planned = runs.filter(run => !run.parentId && run.plan && run.plan.total)
  const overall = planned.length ? planned.reduce((sum, run) => sum + (run.plan?.done || 0), 0) / planned.reduce((sum, run) => sum + (run.plan?.total || 0), 0) : null
  const working = runs.filter(run => run.state === 'working').length
  const waiting = runs.filter(run => run.state === 'waiting').length
  const shownFiles = allFiles ? files : files.slice(0, FILES_SHOWN)
  const changes = activity?.changes

  return (
    <div className="flex max-h-[48%] shrink-0 flex-col border-b border-(--ui-stroke-tertiary)">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-left hover:bg-(--chrome-action-hover)">
        <IconChevronDown size={13} className={cn('shrink-0 text-(--ui-text-tertiary) transition-transform duration-100', !open && '-rotate-90')} />
        <span className="text-[12px] font-medium">{t('진행 중')}</span>
        {(working > 0 || waiting > 0) && <span className={cn('status-dot', waiting ? 'status-waiting' : 'status-busy')} />}
        <span className="ml-auto truncate text-[10.5px] text-(--ui-text-tertiary)">
          {runs.length || files.length
            ? [
                working ? t('에이전트 {count}개 작업 중', { count: working }) : waiting ? null : t('작업 끝남'),
                waiting ? t('응답 기다림 {count}', { count: waiting }) : null,
                overall !== null ? `${Math.round(overall * 100)}%` : null,
                cost ? formatCost(cost) : null
              ]
                .filter(Boolean)
                .join(' · ')
            : t('지금 일하는 에이전트 없음')}
        </span>
      </button>
      {open && (
        <div className="min-h-0 overflow-x-hidden overflow-y-auto px-1.5 pb-2">
          {!runs.length && !files.length && (
            <div className="px-1.5 pb-1 text-[11px] leading-snug text-(--ui-text-tertiary)">{t('AI 에게 일을 맡기면 여기에 진행률, 모델별 작업량, 보고 고치는 파일이 보입니다.')}</div>
          )}
          {parts.length > 0 && (
            <div className="px-1.5 pt-0.5 pb-1.5">
              <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-(--ui-bg-quaternary)" title={t('모델별 작업량 (생성한 토큰 기준)')}>
                {parts.map(part => (
                  <div key={part.model} className="h-full shrink-0 transition-[width] duration-500" style={{ width: `${part.share * 100}%`, background: part.color }} />
                ))}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-(--ui-text-secondary)">
                {parts.map(part => (
                  <span key={part.model} className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: part.color }} />
                    {modelName(part.model)} {Math.round(part.share * 100)}%
                  </span>
                ))}
                {cost > 0 && (
                  <span className="ml-auto text-(--ui-text-tertiary)" title={t('API 정가로 환산한 추정치입니다. 구독 요금제면 실제 청구와 다릅니다.')}>
                    {formatCost(cost)}
                  </span>
                )}
              </div>
            </div>
          )}
          {mains.map(run => (
            <div key={run.id}>
              <RunRow run={run} color={colorOf(run)} nested={false} now={now} />
              {runs
                .filter(sub => sub.parentId === run.id)
                .sort((a, b) => a.startedAt - b.startedAt)
                .map(sub => (
                  <RunRow key={sub.id} run={sub} color={`color-mix(in srgb, ${colorOf(sub)} 70%, transparent)`} nested now={now} />
                ))}
            </div>
          ))}
          {changes && changes.files > 0 && (
            <button
              type="button"
              onClick={() => setChangesFor({ file: null })}
              title={t('이번 작업에서 바뀐 파일, 줄 단위 변경, 영향 받는 파일과 테스트를 봅니다.')}
              className="mx-1.5 mt-1.5 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) px-2 py-1.5 text-left text-[11.5px] hover:bg-(--chrome-action-hover)"
            >
              <IconFileDiff size={13} className="shrink-0" style={{ color: EDIT_COLOR }} />
              <span className="min-w-0 truncate">{t('바뀐 파일 {count}개', { count: changes.files })}</span>
              <LineCounts added={changes.added} removed={changes.removed} />
              <span className="ml-auto flex shrink-0 items-center text-[10.5px] text-(--ui-text-tertiary)">
                {t('변경 · 영향 보기')}
                <IconChevronRight size={12} />
              </span>
            </button>
          )}
          {files.length > 0 && (
            <div className="mt-1.5">
              <div className="flex items-center gap-2 px-1.5 pb-0.5 text-[10.5px] text-(--ui-text-tertiary)">
                <span>{t('파일')}</span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: READ_COLOR }} />
                  {t('보는 중')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: EDIT_COLOR }} />
                  {t('수정 중')}
                </span>
              </div>
              {shownFiles.map(file => (
                <FileRow key={file.path} file={file} runs={byId} now={now} onReveal={onReveal} onDiff={path => setChangesFor({ file: path })} />
              ))}
              {files.length > FILES_SHOWN && (
                <button type="button" onClick={() => setAllFiles(value => !value)} className="px-1.5 pt-0.5 text-[11px] text-(--ui-text-tertiary) hover:text-(--ui-text-primary)">
                  {allFiles ? t('접기') : t('{count}개 더 보기', { count: files.length - FILES_SHOWN })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {changesFor && <ChangesDialog projectId={projectId} initial={changesFor.file} onReveal={onReveal} onClose={() => setChangesFor(null)} />}
    </div>
  )
}
