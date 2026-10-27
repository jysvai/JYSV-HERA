import { useStore } from '@nanostores/react'
import { IconCopy } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import type { HistoryHit } from '../../../shared/types'
import { relTime } from '../../../shared/util'
import { Button, PageHeader, SearchField } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, toast } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

export function HistoryPage() {
  const config = useStore($config)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HistoryHit[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef(0)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const mine = ++request.current
    timer.current = setTimeout(() => void api.history(query).then(next => mine === request.current && setHits(next)), query ? 180 : 0)
  }, [query])

  return (
    <div className="flex h-full flex-col px-8 py-6">
      <PageHeader title="프롬프트 기록" description="Claude · Codex · Antigravity 에 보냈던 프롬프트를 한 곳에서 검색합니다." />
      <SearchField autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="검색어 (예: 로그인, 버그, 프로젝트 이름)" className="mb-3 h-9 text-[14px]" />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {hits.map((hit, index) => {
          const agent = config?.agents.find(entry => entry.id === hit.agentId) || null

          return (
            <div key={`${hit.t}-${index}`} className="group flex gap-3 rounded-md px-2 py-2 hover:bg-(--chrome-action-hover)">
              <AgentGlyph agent={agent} size={16} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap select-text">{hit.text}</div>
                <div className="mt-0.5 truncate text-[11px] text-(--ui-text-tertiary)">
                  {relTime(hit.t)} · {new Date(hit.t).toLocaleString()}
                  {hit.project ? ` · ${hit.project}` : ''}
                </div>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="복사"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void api.copy(hit.text).then(() => toast('복사했습니다'))}
              >
                <IconCopy />
              </Button>
            </div>
          )
        })}
        {!hits.length && <div className="py-10 text-center text-[12.5px] text-(--ui-text-tertiary)">결과 없음</div>}
      </div>
    </div>
  )
}
