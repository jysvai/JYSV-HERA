import { useStore } from '@nanostores/react'
import { IconChevronRight, IconCopy, IconExternalLink, IconEye, IconEyeOff, IconFile, IconFolder, IconFolderOpen, IconRefresh, IconTerminal2 } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import { t } from '../../../shared/i18n'
import type { DirEntry } from '../../../shared/types'
import { formatBytes } from '../../../shared/util'
import { Button, Tip } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { $project, $sessions, $windowVisible, layoutFor, toast } from '../../store/app'
import { insertFiles } from '../terminal/TerminalView'

/** Folders that are big and rarely browsed: listed, but never opened by a refresh on their own. */
const HEAVY = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.venv', 'venv', '__pycache__', '.next', '.turbo', '.cache', 'release'])

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

/** git status code → dot color; folders take the strongest state below them. */
function gitTone(code: string | undefined): string | null {
  if (!code) return null
  if (code === '??') return 'var(--ui-text-tertiary)'
  if (code.includes('D')) return 'var(--status-exited)'
  if (code.includes('A')) return 'var(--status-idle)'
  return 'var(--ui-accent)'
}

const GIT_LABEL: Record<string, string> = { M: t('수정됨'), A: t('추가됨'), D: t('삭제됨'), R: t('이름 바뀜'), '?': t('추적 안 함') }

/** Right panel → 폴더: the project's folder tree, loaded one folder at a time. */
export function FilesPanel() {
  const project = useStore($project)
  const visible = useStore($windowVisible)
  const [listings, setListings] = useState<Record<string, { entries: DirEntry[]; truncated: boolean; error?: string }>>({})
  const [open, setOpen] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(true)
  const [git, setGit] = useState<Record<string, string>>({})
  const projectId = project?.id || null
  const openRef = useRef(open)
  openRef.current = open
  // Answers for a project the user already left are dropped.
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  const load = useCallback(
    async (dirs: string[]) => {
      if (!projectId) return
      const results = await Promise.all(dirs.map(async dir => [dir, await api.listDir(projectId, dir)] as const))
      if (projectRef.current !== projectId) return
      setListings(previous => {
        const next = { ...previous }
        for (const [dir, listing] of results) next[dir] = listing
        return next
      })
    },
    [projectId]
  )

  const refresh = useCallback(() => {
    if (!projectId) return
    void load([...openRef.current])
    void api.gitStatus(projectId).then(next => projectRef.current === projectId && setGit(next))
  }, [load, projectId])

  // A new project starts collapsed to its root.
  useEffect(() => {
    setListings({})
    setOpen(new Set(['']))
    setSelected(null)
    setGit({})
  }, [projectId])

  // Keep what is open current while the panel is on screen (cheap: one readdir per open folder).
  useEffect(() => {
    if (!visible) return
    refresh()
    const timer = setInterval(refresh, 8000)
    return () => clearInterval(timer)
  }, [refresh, visible])

  if (!project) return null

  const toggle = (dir: string) => {
    setOpen(previous => {
      const next = new Set(previous)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        // Collapsed folders are not refreshed, so read again on every expand.
        void load([dir])
      }
      return next
    })
  }

  const dirTone = (dir: string) => {
    let tone: string | null = null
    for (const [file, code] of Object.entries(git)) {
      if (file === dir || file.startsWith(`${dir}/`)) {
        tone = gitTone(code)
        if (code !== '??') break
      }
    }
    return tone
  }

  /** Type the entry's path into the active terminal of this project. */
  const insert = async (rel: string) => {
    const sessionId = layoutFor(project.id).active
    const session = sessionId ? $sessions.get()[sessionId] : null
    const abs = await api.absPath(project.id, rel)
    if (!sessionId || !session || !abs) {
      toast(t('경로를 넣을 터미널이 없습니다. 터미널을 먼저 여세요.'), 'error')
      return
    }
    await insertFiles(sessionId, [abs], ' ')
  }

  const copy = async (rel: string) => {
    const abs = await api.absPath(project.id, rel)
    if (!abs) return
    await api.copy(abs)
    toast(t('경로를 복사했습니다.'))
  }

  const rows: ReactElement[] = []
  const walk = (dir: string, depth: number) => {
    const listing = listings[dir]
    if (!listing) {
      rows.push(
        <div key={`${dir}/…`} className="py-0.5 text-[11.5px] text-(--ui-text-tertiary)" style={{ paddingLeft: 10 + depth * 14 }}>
          {t('불러오는 중…')}
        </div>
      )
      return
    }
    if (listing.error) {
      rows.push(
        <div key={`${dir}/!`} className="py-0.5 text-[11.5px] text-(--ui-text-tertiary)" style={{ paddingLeft: 10 + depth * 14 }}>
          {t('열 수 없음 ({error})', { error: listing.error })}
        </div>
      )
      return
    }

    for (const entry of listing.entries) {
      if (!showHidden && entry.hidden) continue
      const rel = join(dir, entry.name)
      const expanded = entry.dir && open.has(rel)
      const code = entry.dir ? undefined : git[rel]
      const tone = entry.dir ? dirTone(rel) : gitTone(code)

      rows.push(
        <div
          key={rel}
          role="treeitem"
          aria-expanded={entry.dir ? expanded : undefined}
          aria-selected={selected === rel}
          draggable
          onDragStart={event => {
            // Dropped on a terminal, it is typed as an absolute path in the project's own separators.
            const sep = project.path.includes('\\') ? '\\' : '/'
            event.dataTransfer.effectAllowed = 'copy'
            event.dataTransfer.setData('application/x-hera-path', `${project.path.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`)
            event.dataTransfer.setData('text/plain', rel)
          }}
          onClick={() => {
            setSelected(rel)
            if (entry.dir) toggle(rel)
          }}
          onDoubleClick={() => !entry.dir && void api.openPath(project.id, rel, 'open')}
          title={`${rel}${entry.dir ? '' : ` · ${formatBytes(entry.size)}`}${code ? ` · ${GIT_LABEL[code.trim()[0]] || code}` : ''}`}
          className={cn(
            'group flex h-[24px] cursor-default items-center gap-1 rounded-md pr-1 text-[12.5px] select-none hover:bg-(--chrome-action-hover)',
            selected === rel && 'bg-(--ui-bg-elevated) shadow-sm',
            entry.hidden && 'opacity-60'
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <span className={cn('flex w-3.5 shrink-0 justify-center text-(--ui-text-tertiary) transition-transform duration-100', expanded && 'rotate-90', !entry.dir && 'invisible')}>
            <IconChevronRight size={12} />
          </span>
          {entry.dir ? (
            expanded ? (
              <IconFolderOpen size={15} className="shrink-0 text-(--ui-accent-text)" />
            ) : (
              <IconFolder size={15} className={cn('shrink-0', HEAVY.has(entry.name) ? 'text-(--ui-text-tertiary)' : 'text-(--ui-accent-text)')} />
            )
          ) : (
            <IconFile size={15} className="shrink-0 text-(--ui-text-tertiary)" />
          )}
          <span className={cn('min-w-0 flex-1 truncate', entry.link && 'italic')}>{entry.name}</span>
          {tone && <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone }} />}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <Tip label={t('터미널에 경로 넣기')}>
              <button type="button" aria-label={t('터미널에 경로 넣기')} className="rounded p-0.5 text-(--ui-text-tertiary) hover:text-(--ui-text-primary)" onClick={event => (event.stopPropagation(), void insert(rel))}>
                <IconTerminal2 size={13} />
              </button>
            </Tip>
            <Tip label={t('경로 복사')}>
              <button type="button" aria-label={t('경로 복사')} className="rounded p-0.5 text-(--ui-text-tertiary) hover:text-(--ui-text-primary)" onClick={event => (event.stopPropagation(), void copy(rel))}>
                <IconCopy size={13} />
              </button>
            </Tip>
            <Tip label={entry.dir ? t('폴더 열기') : t('파일 위치 열기')}>
              <button
                type="button"
                aria-label={entry.dir ? t('폴더 열기') : t('파일 위치 열기')}
                className="rounded p-0.5 text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
                onClick={event => (event.stopPropagation(), void api.openPath(project.id, rel, entry.dir ? 'open' : 'reveal'))}
              >
                <IconExternalLink size={13} />
              </button>
            </Tip>
          </span>
        </div>
      )

      if (expanded) walk(rel, depth + 1)
    }

    if (listing.truncated) {
      rows.push(
        <div key={`${dir}/+`} className="py-0.5 text-[11.5px] text-(--ui-text-tertiary)" style={{ paddingLeft: 24 + depth * 14 }}>
          {t('항목이 많아 일부만 보입니다.')}
        </div>
      )
    }
  }
  walk('', 0)

  const changed = Object.keys(git).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-(--ui-stroke-tertiary) px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium">{project.name}</div>
          <div className="truncate font-mono text-[10.5px] text-(--ui-text-tertiary)" title={project.path}>
            {project.path}
            {changed ? ` · ${t('변경 {count}', { count: changed })}` : ''}
          </div>
        </div>
        <Tip label={showHidden ? t('숨김 파일 감추기') : t('숨김 파일 보기')}>
          <Button size="icon-xs" variant="ghost" aria-label={t('숨김 파일')} onClick={() => setShowHidden(value => !value)}>
            {showHidden ? <IconEye /> : <IconEyeOff />}
          </Button>
        </Tip>
        <Tip label={t('새로고침')}>
          <Button size="icon-xs" variant="ghost" aria-label={t('새로고침')} onClick={refresh}>
            <IconRefresh />
          </Button>
        </Tip>
        <Tip label={t('탐색기에서 열기')}>
          <Button size="icon-xs" variant="ghost" aria-label={t('탐색기에서 열기')} onClick={() => void api.openPath(project.id, '', 'open')}>
            <IconExternalLink />
          </Button>
        </Tip>
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {rows}
      </div>
      <div className="shrink-0 border-t border-(--ui-stroke-tertiary) px-3 py-1.5 text-[10.5px] leading-snug text-(--ui-text-tertiary)">
        {t('더블클릭으로 열기 · 터미널로 끌어다 놓으면 경로 입력')}
      </div>
    </div>
  )
}
