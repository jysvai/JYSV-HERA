import { useStore } from '@nanostores/react'
import { IconExternalLink, IconPlayerPlay, IconPlayerStop, IconSettings, IconTerminal2 } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'

import type { LaneLive, LaneProjectState, LaneTier } from '../../../shared/types'
import { Badge, Button, Section } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { formatUsd } from '../../lib/usage'
import { $project, $sessions, $view, $windowVisible, focusSession, toast } from '../../store/app'
import { $lanesInfo, loadLanesInfo } from '../../store/lanes'

const STATE_LABEL: Record<LaneLive['state'], string> = { off: '꺼짐', opening: '여는 중', idle: '대기', busy: '작업 중' }
const STATE_TONE: Record<LaneLive['state'], 'muted' | 'warn' | 'ok' | 'accent'> = { off: 'muted', opening: 'warn', idle: 'ok', busy: 'accent' }

function verdictTone(verdict: string | null): 'ok' | 'danger' | 'warn' | 'muted' {
  if (!verdict) return 'muted'
  if (/^(DONE|PASS)$/.test(verdict)) return 'ok'
  if (/^(FAIL|BLOCKED|STOPPED)$/.test(verdict)) return 'danger'

  return 'warn'
}

function ago(time: number): string {
  if (!time) return ''
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)

  return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`
}

function LaneCard({ lane, busy, onStart, onStop }: { lane: LaneLive; busy: boolean; onStart: () => void; onStop: () => void }) {
  const sessions = useStore($sessions)
  const tab = lane.sessionId ? sessions[lane.sessionId] : null

  return (
    <div className="rounded-lg bg-(--ui-bg-quaternary) px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{lane.tier}</span>
        <Badge tone={STATE_TONE[lane.state]}>{STATE_LABEL[lane.state]}</Badge>
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--ui-text-tertiary)">{lane.model}</span>
        {tab && (
          <Button size="icon-xs" variant="ghost" aria-label="lane 탭 보기" onClick={() => focusSession(tab)}>
            <IconTerminal2 />
          </Button>
        )}
        {lane.state === 'off' ? (
          <Button size="icon-xs" variant="ghost" aria-label={`${lane.tier} lane 열기`} disabled={busy} onClick={onStart}>
            <IconPlayerPlay />
          </Button>
        ) : (
          <Button size="icon-xs" variant="ghost" aria-label={`${lane.tier} lane 닫기`} disabled={busy || lane.state === 'opening'} onClick={onStop}>
            <IconPlayerStop />
          </Button>
        )}
      </div>
      {lane.task && <div className="mt-1 line-clamp-2 text-[11.5px] text-(--ui-text-secondary)">{lane.task}</div>}
      {lane.queued > 0 && <div className="mt-1 text-[11px] text-(--ui-text-tertiary)">대기 중인 일 {lane.queued}개</div>}
    </div>
  )
}

/** One project's lanes: live state, start/stop, savings and the task ledger. */
export function LanesPanel() {
  const project = useStore($project)
  const info = useStore($lanesInfo)
  const visible = useStore($windowVisible)
  const [state, setState] = useState<LaneProjectState | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    if (!project) return
    void api
      .laneProject(project.id)
      .then(setState)
      .catch(() => undefined)
  }, [project])

  useEffect(() => {
    if (!info) void loadLanesInfo()
  }, [info])

  useEffect(() => {
    setState(null)
    refresh()
    if (!visible) return
    const timer = setInterval(refresh, 3000)

    return () => clearInterval(timer)
  }, [refresh, visible])

  if (!project) return null

  if (info && !info.installed) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[12.5px] text-(--ui-text-secondary)">
        lanes 플러그인을 찾지 못했습니다.{' '}
        <button type="button" className="text-(--ui-accent-text) underline" onClick={() => $view.set('lanes')}>
          Lanes 설정
        </button>
        에서 설치 방법을 볼 수 있습니다.
      </div>
    )
  }

  const act = async (verb: 'start' | 'stop', which: LaneTier | 'all') => {
    setBusy(true)
    try {
      const result = verb === 'start' ? await api.startLanes(project.id, which) : await api.stopLanes(project.id, which)
      toast(result.message.split('\n').slice(-2).join(' '), result.ok ? 'info' : 'error')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const allowNeeded = info?.effective.permission_mode === 'dontAsk' && state && !state.allowApplied
  const anyOn = state?.lanes.some(lane => lane.state !== 'off')
  const saved = state ? state.total.onMain - state.total.cost : 0

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-2">
      <Section
        title={<span className="normal-case">{state ? `lanes · ${state.slug}` : 'lanes'}</span>}
        action={
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act(anyOn ? 'stop' : 'start', 'all')}>
              {anyOn ? <IconPlayerStop /> : <IconPlayerPlay />}
              {anyOn ? '모두 닫기' : '모두 열기'}
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Lanes 설정" onClick={() => $view.set('lanes')}>
              <IconSettings />
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          {(state?.lanes || []).map(lane => (
            <LaneCard key={lane.tier} lane={lane} busy={busy} onStart={() => void act('start', lane.tier)} onStop={() => void act('stop', lane.tier)} />
          ))}
          {!state && <div className="text-[12px] text-(--ui-text-tertiary)">읽는 중…</div>}
        </div>
        {allowNeeded && (
          <div className="mt-2 rounded-lg border border-(--ui-stroke-tertiary) px-3 py-2 text-[11.5px] text-(--ui-text-secondary)">
            권한 모드가 dontAsk 인데 이 프로젝트에 lane 허용 목록이 없습니다.
            <Button
              size="xs"
              className="mt-1.5"
              onClick={() =>
                void api.applyLaneAllow(project.id).then(result => {
                  toast(`허용 규칙 ${result.added}개를 추가했습니다.`)
                  refresh()
                })
              }
            >
              허용 목록 적용
            </Button>
          </div>
        )}
      </Section>

      {state && (
        <Section title="비용">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-(--ui-bg-quaternary) px-3 py-2.5 text-[12px]">
            <div>
              <div className="text-[11px] text-(--ui-text-tertiary)">오늘 lane 비용</div>
              <div className="font-semibold tabular-nums">{formatUsd(state.today.cost) || '$0'}</div>
            </div>
            <div>
              <div className="text-[11px] text-(--ui-text-tertiary)">메인에서 했을 때보다 아낀 돈 (누적)</div>
              <div className="font-semibold text-(--ui-accent-text) tabular-nums">{formatUsd(saved) || '$0'}</div>
            </div>
          </div>
          <div className="mt-1 text-[10.5px] text-(--ui-text-tertiary)">lanes 가 기록한 API 정가 기준 추정치</div>
        </Section>
      )}

      {state && (
        <Section title="최근 작업">
          {!state.tasks.length && <div className="text-[12px] text-(--ui-text-tertiary)">아직 lane 에 넘긴 일이 없습니다. 메인 Claude 에서 /lane 으로 넘기거나 메인이 알아서 넘깁니다.</div>}
          <ul className="space-y-1">
            {state.tasks.slice(0, 15).map(task => (
              <li key={`${task.lane}-${task.id}`}>
                <button
                  type="button"
                  disabled={!task.report}
                  onClick={() => void api.openLaneReport(project.id, task.id)}
                  className={cn('group w-full rounded-md px-2 py-1.5 text-left', task.report && 'hover:bg-(--chrome-action-hover)')}
                >
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="font-mono font-medium">{task.id}</span>
                    <span className="text-(--ui-text-tertiary)">{task.lane}</span>
                    <Badge tone={verdictTone(task.verdict)}>{task.verdict || (task.ended ? '끝' : '진행 중')}</Badge>
                    <span className="flex-1" />
                    <span className="text-(--ui-text-tertiary) tabular-nums">{formatUsd(task.cost)}</span>
                    <span className="text-(--ui-text-tertiary)">{ago(task.started)}</span>
                    {task.report && <IconExternalLink size={12} className="text-(--ui-text-tertiary) opacity-0 group-hover:opacity-100" />}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-(--ui-text-secondary)">{task.goal}</div>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
