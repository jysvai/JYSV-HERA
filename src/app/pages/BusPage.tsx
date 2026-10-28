import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { locale, t } from '../../../shared/i18n'
import { Badge, EmptyState, PageHeader } from '../../components/ui/primitives'
import { $bus, $config, $projectId } from '../../store/app'

const KIND: Record<string, { label: string; tone: 'accent' | 'ok' | 'muted' | 'warn' }> = {
  send: { label: t('지시'), tone: 'accent' },
  reply: { label: t('회신'), tone: 'ok' },
  key: { label: t('키 입력'), tone: 'muted' },
  spawn: { label: t('생성'), tone: 'warn' },
  system: { label: t('시스템'), tone: 'muted' }
}

export function BusPage() {
  const messages = useStore($bus)
  const config = useStore($config)
  const projectId = useStore($projectId)
  const list = useMemo(() => [...messages].reverse(), [messages])

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('에이전트 대화')}
        description={t('hera CLI 로 오간 지시·회신 기록입니다. 메인 에이전트가 보조에게 일을 나눠 준 흐름을 그대로 확인할 수 있습니다.')}
      />
      {!list.length ? (
        <EmptyState
          title={t('아직 오간 메시지가 없습니다')}
          description={t('팀으로 시작하거나(예: Claude 메인 + Codex 보조), 아무 HERA 터미널에서 `hera guide` 를 실행해 보세요. 에이전트는 hera ask / send / reply 로 서로 일을 주고받습니다.')}
        />
      ) : (
        <div className="space-y-3">
          {list.map(message => {
            const project = config?.projects.find(entry => entry.id === message.projectId)
            const kind = KIND[message.kind] || KIND.system

            return (
              <div key={message.id} className={`rounded-lg px-4 py-3 ${message.projectId === projectId ? 'bg-(--ui-bg-quaternary)' : 'bg-(--ui-bg-quaternary)/50'}`}>
                <div className="flex items-center gap-2 text-[12px]">
                  <Badge tone={kind.tone}>{kind.label}</Badge>
                  <span className="font-medium">{message.fromName}</span>
                  <span className="text-(--ui-text-tertiary)">→</span>
                  <span className="font-medium">{message.toName}</span>
                  <span className="ml-auto text-[11px] text-(--ui-text-tertiary)">
                    {project?.name ? `${project.name} · ` : ''}
                    {new Date(message.t).toLocaleString(locale())}
                  </span>
                </div>
                <div className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-(--ui-text-secondary) select-text">
                  {message.text.length > 1200 ? `${message.text.slice(0, 1200)}…` : message.text}
                </div>
                {message.file && <div className="mt-1 truncate font-mono text-[11px] text-(--ui-text-tertiary)">📎 {message.file}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
