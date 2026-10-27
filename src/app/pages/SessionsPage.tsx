import { useStore } from '@nanostores/react'
import { IconArrowRight, IconEye, IconSend, IconX } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'

import type { SessionInfo } from '../../../shared/types'
import { relTime } from '../../../shared/util'
import { Badge, Button, Dialog, Input, PageHeader, Section, StatusDot } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, $sessions, closeSession, focusSession, toast } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

const STATUS_TEXT: Record<string, string> = {
  busy: '작업중',
  idle: '대기',
  waiting: '승인 대기',
  starting: '시작중',
  exited: '종료됨'
}

function PeekDialog({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    const load = () => void api.screen(session.id, 60).then(next => alive && setLines(next))
    load()
    const timer = setInterval(load, 1500)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [session.id])

  return (
    <Dialog open onClose={onClose} width={860} title={`${session.name} 화면 · ${STATUS_TEXT[session.status] || session.status}`}>
      <pre className="max-h-[56vh] overflow-auto rounded-md bg-(--term-bg) p-3 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-(--ui-text-secondary) select-text">
        {lines.join('\n') || '(빈 화면)'}
      </pre>
    </Dialog>
  )
}

function SessionRow({ session, selected, onToggle }: { session: SessionInfo; selected: boolean; onToggle: () => void }) {
  const config = useStore($config)
  const [message, setMessage] = useState('')
  const [peek, setPeek] = useState(false)
  const agent = config?.agents.find(entry => entry.id === (session.activeAgentId || session.agentId)) || null
  const project = config?.projects.find(entry => entry.id === session.projectId)

  const send = async () => {
    if (!message.trim()) return
    await api.send([session.id], message, true)
    setMessage('')
    toast(`${session.name} 에 보냈습니다.`)
  }

  return (
    <div className="group grid grid-cols-[20px_minmax(180px,1.2fr)_minmax(160px,1fr)_minmax(220px,1.4fr)_auto] items-center gap-3 border-b border-(--ui-stroke-tertiary) py-2.5">
      <input type="checkbox" checked={selected} onChange={onToggle} className="accent-(--ui-accent)" aria-label="선택" />
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={session.dormant ? 'exited' : session.status} />
        <AgentGlyph agent={agent} size={16} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">
            {session.name} {session.role && <Badge tone={session.role === 'main' ? 'accent' : 'muted'}>{session.role === 'main' ? '메인' : '보조'}</Badge>}
          </div>
          <div className="truncate text-[11px] text-(--ui-text-tertiary)">
            {STATUS_TEXT[session.dormant ? 'exited' : session.status]} · 출력 {relTime(session.lastOutputAt)}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12.5px]">{project?.name || '—'}</div>
        <div className="truncate text-[11px] text-(--ui-text-tertiary)">{session.title}</div>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <Input
          value={message}
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void send()
          }}
          placeholder="메시지 입력 후 Enter"
          className="h-7 text-[12px]"
          disabled={session.dormant || session.status === 'exited'}
        />
        <Button size="icon-sm" variant="ghost" aria-label="보내기" onClick={() => void send()}>
          <IconSend />
        </Button>
      </div>
      <div className="flex items-center gap-0.5">
        {session.status === 'waiting' && (
          <>
            <Button size="xs" variant="outline" onClick={() => void api.keys(session.id, ['enter'])}>
              Enter
            </Button>
            <Button size="xs" variant="outline" onClick={() => void api.keys(session.id, ['esc'])}>
              Esc
            </Button>
          </>
        )}
        <Button size="icon-sm" variant="ghost" aria-label="화면 보기" onClick={() => setPeek(true)}>
          <IconEye />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="열기" onClick={() => focusSession(session)}>
          <IconArrowRight />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="종료" onClick={() => void closeSession(session.id)}>
          <IconX />
        </Button>
      </div>
      {peek && <PeekDialog session={session} onClose={() => setPeek(false)} />}
    </div>
  )
}

export function SessionsPage() {
  const sessions = useStore($sessions)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [broadcast, setBroadcast] = useState('')
  const [external, setExternal] = useState<Awaited<ReturnType<typeof api.externalClaude>>>([])

  const list = useMemo(() => Object.values(sessions).sort((a, b) => b.lastStatusChangeAt - a.lastStatusChangeAt), [sessions])
  const live = list.filter(session => !session.dormant && session.status !== 'exited')

  useEffect(() => {
    void api.externalClaude().then(setExternal)
    const timer = setInterval(() => void api.externalClaude().then(setExternal), 10_000)

    return () => clearInterval(timer)
  }, [])

  const counts = {
    busy: live.filter(session => session.status === 'busy').length,
    waiting: live.filter(session => session.status === 'waiting').length,
    idle: live.filter(session => session.status === 'idle').length
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title="세션 현황"
        description={`열린 세션 ${live.length}개 · 작업중 ${counts.busy} · 승인 대기 ${counts.waiting} · 대기 ${counts.idle}`}
      />
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-(--ui-bg-quaternary) px-3 py-2">
          <span className="shrink-0 text-[12px] text-(--ui-text-secondary)">{selected.size}개 선택</span>
          <Input
            value={broadcast}
            onChange={event => setBroadcast(event.target.value)}
            placeholder="선택한 세션 모두에게 같은 메시지 보내기"
            className="h-7"
            onKeyDown={event => {
              if (event.key === 'Enter' && broadcast.trim() && !event.nativeEvent.isComposing) {
                void api.send([...selected], broadcast, true).then(() => {
                  toast(`${selected.size}개 세션에 보냈습니다.`)
                  setBroadcast('')
                })
              }
            }}
          />
          <Button size="sm" variant="text" onClick={() => setSelected(new Set())}>
            선택 해제
          </Button>
        </div>
      )}
      {list.length ? (
        list.map(session => (
          <SessionRow
            key={session.id}
            session={session}
            selected={selected.has(session.id)}
            onToggle={() =>
              setSelected(previous => {
                const next = new Set(previous)
                next.has(session.id) ? next.delete(session.id) : next.add(session.id)

                return next
              })
            }
          />
        ))
      ) : (
        <div className="py-10 text-center text-[12.5px] text-(--ui-text-tertiary)">열린 세션이 없습니다.</div>
      )}

      <Section title="이 PC 의 모든 Claude Code 세션 (Claude 레지스트리 기준, HERA 밖 포함)" className="mt-6">
        {external.length ? (
          <div className="space-y-1">
            {external.map(entry => (
                <div key={entry.pid} className="flex items-center gap-3 text-[12.5px]">
                  <StatusDot status={entry.status === 'busy' ? 'busy' : 'idle'} />
                  <span className="w-40 truncate">{entry.name || `pid ${entry.pid}`}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-(--ui-text-tertiary)">{entry.cwd}</span>
                  <span className="shrink-0 text-[11px] text-(--ui-text-tertiary)">
                    {entry.status} · {relTime(entry.updatedAt)}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-[12px] text-(--ui-text-tertiary)">없음 (Claude Code 의 세션 레지스트리 기준).</div>
        )}
      </Section>
    </div>
  )
}
