import { useStore } from '@nanostores/react'
import { IconCopy, IconFolder, IconFolderQuestion, IconStack2 } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { t } from '../../../shared/i18n'
import type { HistoryHit, Project } from '../../../shared/types'
import { relTime } from '../../../shared/util'
import { Button, PageHeader, SearchField } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api, isWin } from '../../lib/hera'
import { $config, $projectId, toast } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

const ALL = '*'
const UNKNOWN = '?'

interface Folder {
  key: string
  name: string
  path: string | null
  hits: HistoryHit[]
  lastAt: number
}

/** Comparable form of a path: one separator, no trailing one, case-folded on Windows. */
function norm(p: string): string {
  const flat = p.replace(/^\\\\\?\\/, '').replace(/[\\/]+/g, '/').replace(/\/$/, '')

  return isWin ? flat.toLowerCase() : flat
}

/** Prompts grouped by folder: a registered project takes every prompt sent anywhere inside it. */
function groupByFolder(hits: HistoryHit[], projects: Project[]): Folder[] {
  const roots = projects.map(project => ({ project, root: norm(project.path) })).sort((a, b) => b.root.length - a.root.length)
  const folders = new Map<string, Folder>()

  for (const hit of hits) {
    const where = hit.project ? norm(hit.project) : null
    const owner = where ? roots.find(({ root }) => where === root || where.startsWith(`${root}/`)) : undefined
    const key = owner ? `p:${owner.project.id}` : where || UNKNOWN
    let folder = folders.get(key)

    if (!folder) {
      const base = hit.project ? hit.project.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || hit.project : ''
      folder = {
        key,
        name: owner ? owner.project.name : hit.project ? base : t('폴더 모름'),
        path: owner ? owner.project.path : hit.project,
        hits: [],
        lastAt: 0
      }
      folders.set(key, folder)
    }

    folder.hits.push(hit)
    folder.lastAt = Math.max(folder.lastAt, hit.t)
  }

  // Newest folder first; prompts without a folder go last.
  return [...folders.values()].sort((a, b) => Number(a.key === UNKNOWN) - Number(b.key === UNKNOWN) || b.lastAt - a.lastAt)
}

export function HistoryPage() {
  const config = useStore($config)
  const projectId = useStore($projectId)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HistoryHit[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef(0)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const mine = ++request.current
    timer.current = setTimeout(() => void api.history(query).then(next => mine === request.current && setHits(next)), query ? 180 : 0)
  }, [query])

  const folders = useMemo(() => groupByFolder(hits, config?.projects || []), [hits, config?.projects])
  // Start on the project open in the workspace when it has prompts, otherwise on everything.
  const current = selected ?? (projectId && folders.some(folder => folder.key === `p:${projectId}`) ? `p:${projectId}` : ALL)
  const folder = folders.find(entry => entry.key === current) || null
  const shown = current === ALL || !folder ? hits : folder.hits

  return (
    <div className="flex h-full flex-col px-8 py-6">
      <PageHeader title={t('프롬프트 기록')} description={t('Claude · Codex · Antigravity 에 보냈던 프롬프트를 폴더별로 모아 보고 검색합니다.')} />
      <SearchField autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('검색어 (예: 로그인, 버그, 프로젝트 이름)')} className="mb-3 h-9 text-[14px]" />
      <div className="flex min-h-0 flex-1 gap-3">
        <nav aria-label={t('폴더')} className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-(--ui-stroke-tertiary) pr-2">
          <FolderButton active={current === ALL} onClick={() => setSelected(ALL)} icon={<IconStack2 size={15} />} name={t('전체')} count={hits.length} />
          {folders.map(entry => (
            <FolderButton
              key={entry.key}
              active={current === entry.key}
              onClick={() => setSelected(entry.key)}
              icon={entry.key === UNKNOWN ? <IconFolderQuestion size={15} /> : <IconFolder size={15} className={entry.key.startsWith('p:') ? 'text-(--ui-accent-text)' : undefined} />}
              name={entry.name}
              detail={entry.path ? entry.path : t('폴더가 기록되지 않은 프롬프트')}
              count={entry.hits.length}
              lastAt={entry.lastAt}
            />
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {folder && current !== ALL && (
            <div className="sticky top-0 z-10 mb-1 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-editor) px-2 pb-2">
              <div className="text-[13px] font-medium">{folder.name}</div>
              {folder.path && <div className="truncate font-mono text-[11px] text-(--ui-text-tertiary)">{folder.path}</div>}
            </div>
          )}
          <div className="space-y-1">
            {shown.map((hit, index) => {
              const agent = config?.agents.find(entry => entry.id === hit.agentId) || null

              return (
                <div key={`${hit.t}-${index}`} className="group flex gap-3 rounded-md px-2 py-2 hover:bg-(--chrome-action-hover)">
                  <AgentGlyph agent={agent} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap select-text">{hit.text}</div>
                    <div className="mt-0.5 truncate text-[11px] text-(--ui-text-tertiary)">
                      {relTime(hit.t)} · {new Date(hit.t).toLocaleString()}
                      {current === ALL && hit.project ? ` · ${hit.project}` : ''}
                    </div>
                  </div>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('복사')}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => void api.copy(hit.text).then(() => toast(t('복사했습니다')))}
                  >
                    <IconCopy />
                  </Button>
                </div>
              )
            })}
            {!shown.length && <div className="py-10 text-center text-[12.5px] text-(--ui-text-tertiary)">{t('결과 없음')}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function FolderButton({ active, onClick, icon, name, detail, count, lastAt }: { active: boolean; onClick: () => void; icon: ReactNode; name: string; detail?: string; count: number; lastAt?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={detail}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-(--chrome-action-hover)',
        active && 'bg-(--ui-bg-elevated) shadow-sm'
      )}
    >
      <span className="mt-0.5 shrink-0 text-(--ui-text-tertiary)">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[12.5px]', active && 'font-medium')}>{name}</span>
        {lastAt ? <span className="block truncate text-[10.5px] text-(--ui-text-tertiary)">{relTime(lastAt)}</span> : null}
      </span>
      <span className="shrink-0 rounded-full bg-(--ui-bg-elevated) px-1.5 text-[10.5px] text-(--ui-text-secondary) tabular-nums">{count}</span>
    </button>
  )
}
