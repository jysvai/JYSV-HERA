import { useStore } from '@nanostores/react'
import { IconExternalLink, IconFileDiff, IconFileMinus, IconFilePlus, IconFolderSearch, IconHierarchy2, IconSend, IconTestPipe } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'

import { t } from '../../../shared/i18n'
import type { ChangedFile, DiffHunk, FileChangeDetail, FileImpact } from '../../../shared/types'
import { Button, Dialog, Textarea } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { api } from '../../lib/hera'
import { $sessions, toast } from '../../store/app'

import { useLiveActivity } from './LiveWork'
import { lineClass } from './WorktreesPanel'

const same = (a: string | null, b: string | null) => Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase()
const baseName = (file: string) => file.split(/[\\/]/).pop() || file

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return t('방금')
  if (seconds < 3600) return t('{min}분 전', { min: Math.floor(seconds / 60) })

  return t('{hour}시간 전', { hour: Math.floor(seconds / 3600) })
}

export function LineCounts({ added, removed, className }: { added: number; removed: number; className?: string }) {
  if (!added && !removed) return null

  return (
    <span className={cn('shrink-0 font-mono text-[10.5px]', className)}>
      <span className="text-(--status-idle)">+{added}</span> <span className="text-(--status-waiting)">−{removed}</span>
    </span>
  )
}

function Hunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <div className={cn('px-1 whitespace-pre', lineClass('@@'))}>{hunk.oldStart || hunk.newStart ? `@@ -${hunk.oldStart} +${hunk.newStart} @@` : '@@'}</div>
      {hunk.lines.map((line, index) => (
        <div key={index} className={cn('px-1 whitespace-pre', lineClass(line))}>
          {line || ' '}
        </div>
      ))}
    </>
  )
}

function ImpactList({ title, icon, items, onPick }: { title: string; icon: ReactNode; items: string[]; onPick: ((rel: string) => void) | null }) {
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 8)

  return (
    <div className="mb-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-(--ui-text-secondary)">
        {icon} {title}
      </div>
      {shown.map(item => (
        <button
          key={item}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(item)}
          title={item}
          className="flex w-full min-w-0 items-baseline gap-1.5 rounded px-1.5 py-0.5 text-left text-[11.5px] hover:bg-(--chrome-action-hover) disabled:hover:bg-transparent"
        >
          <span className="shrink-0">{baseName(item)}</span>
          <span className="min-w-0 truncate font-mono text-[10px] text-(--ui-text-tertiary)">{item.slice(0, Math.max(0, item.length - baseName(item).length - 1))}</span>
        </button>
      ))}
      {items.length > 8 && (
        <button type="button" onClick={() => setAll(value => !value)} className="px-1.5 text-[11px] text-(--ui-text-tertiary) hover:text-(--ui-text-primary)">
          {all ? t('접기') : t('{count}개 더 보기', { count: items.length - 8 })}
        </button>
      )}
    </div>
  )
}

/** What the agents' work changed in a project: the files, each agent's diff of one, and who depends on it. */
export function ChangesDialog({ projectId, initial, onReveal, onClose }: { projectId: string; initial: string | null; onReveal: (rel: string) => void; onClose: () => void }) {
  const activity = useLiveActivity(projectId)
  const sessions = useStore($sessions)
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [selected, setSelected] = useState<string | null>(initial)
  const [details, setDetails] = useState<FileChangeDetail[] | null>(null)
  const [impact, setImpact] = useState<FileImpact | null>(null)
  const [note, setNote] = useState('')
  const totals = activity?.changes
  // New changes come in while the dialog is open: the list and the diff follow them.
  const changesKey = totals ? `${totals.files}:${totals.added}:${totals.removed}` : ''

  useEffect(() => {
    let live = true
    void api
      .changedFiles(projectId)
      .then(list => {
        if (!live) return
        setFiles(list)
        setSelected(current => current || list[0]?.path || null)
      })
      .catch(() => live && setFiles([]))
    return () => {
      live = false
    }
  }, [projectId, changesKey])

  useEffect(() => {
    if (!selected) return
    let live = true
    void api
      .fileChanges(projectId, selected)
      .then(list => live && setDetails(list))
      .catch(() => live && setDetails([]))
    return () => {
      live = false
    }
  }, [projectId, selected, changesKey])

  useEffect(() => {
    if (!selected) return
    let live = true
    void api
      .fileImpact(projectId, selected)
      .then(result => live && setImpact(result))
      .catch(() => live && setImpact({ path: selected, dependents: [], indirect: [], tests: [], supported: false, scanned: 0, capped: false }))
    return () => {
      live = false
    }
  }, [projectId, selected])

  const current = files?.find(file => same(file.path, selected)) || null
  const rel = current?.rel ?? activity?.files.find(file => same(file.path, selected))?.rel ?? null
  const inWorktree = Boolean(current?.worktree)
  const name = selected ? baseName(selected) : ''
  // The note goes to the tab whose agent changed the file last.
  const runId = details?.[0]?.runId
  const sessionId = activity?.runs.find(run => run.id === runId)?.sessionId
  const session = sessionId ? sessions[sessionId] : undefined

  // Another file: its own diff and impact, never the last file's for a frame.
  const choose = (file: string) => {
    if (same(file, selected)) return
    setDetails(null)
    setImpact(null)
    setSelected(file)
  }

  const reveal = (path: string) => {
    onClose()
    onReveal(path)
  }

  const ask = () => {
    if (!impact) return
    setNote(
      [
        impact.tests.length ? t('관련 테스트를 돌려 주세요: {tests}', { tests: impact.tests.slice(0, 12).join(', ') }) : null,
        impact.dependents.length ? t('이 변경이 다음 파일에 문제를 일으키지 않는지 확인해 주세요: {files}', { files: impact.dependents.slice(0, 12).join(', ') }) : null
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  const send = async () => {
    if (!session || !note.trim()) return
    try {
      await api.send([session.id], t('{file} 변경에 대한 메모입니다:\n{note}', { file: rel || selected || '-', note: note.trim() }), false)
      toast(t('{name} 에게 보냈습니다.', { name: session.name }))
      setNote('')
    } catch {
      toast(t('보내지 못했습니다. 그 탭이 닫혔는지 확인하세요.'))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={Math.min(1120, window.innerWidth - 48)}
      title={
        <span className="flex items-center gap-2">
          <IconFileDiff size={16} /> {t('바뀐 파일')}
          {totals && totals.files > 0 && (
            <span className="text-[11.5px] font-normal text-(--ui-text-tertiary)">
              {t('{count}개', { count: totals.files })} · <LineCounts added={totals.added} removed={totals.removed} className="text-[11.5px]" />
            </span>
          )}
        </span>
      }
      footer={
        <div className="flex w-full items-end gap-2">
          <Textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            rows={2}
            disabled={!session}
            placeholder={session ? t('{name} 에게 보낼 메모 (고칠 점, 질문)…', { name: session.name }) : t('이 파일을 바꾼 탭이 닫혀 있습니다.')}
            className="min-w-0 flex-1 text-[12px]"
          />
          {impact && (impact.tests.length > 0 || impact.dependents.length > 0) && (
            <Button disabled={!session} onClick={ask} title={t('관련 테스트와 이 파일을 쓰는 파일을 확인해 달라는 메모를 채웁니다.')}>
              <IconTestPipe /> {t('확인 요청')}
            </Button>
          )}
          <Button variant="default" disabled={!session || !note.trim()} onClick={() => void send()}>
            <IconSend /> {t('보내기')}
          </Button>
          <Button onClick={onClose}>{t('닫기')}</Button>
        </div>
      }
    >
      <div className="flex h-[58vh] min-h-0 gap-3">
        <div className="w-44 shrink-0 overflow-y-auto xl:w-56">
          {!files ? (
            <div className="p-1.5 text-[12px] text-(--ui-text-tertiary)">{t('불러오는 중…')}</div>
          ) : !files.length ? (
            <div className="p-1.5 text-[11.5px] leading-snug text-(--ui-text-tertiary)">{t('지금 보이는 작업에서 HERA 가 내용을 본 변경이 없습니다.')}</div>
          ) : (
            files.map(file => {
              const Icon = file.created ? IconFilePlus : file.deleted ? IconFileMinus : IconFileDiff
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => choose(file.path)}
                  title={file.path}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px]',
                    same(file.path, selected) ? 'bg-(--chrome-action-hover) text-(--ui-text-primary)' : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
                  )}
                >
                  <Icon size={13} className="shrink-0 text-(--ui-text-tertiary)" />
                  <span className="min-w-0 flex-1 truncate">{baseName(file.path)}</span>
                  <LineCounts added={file.added} removed={file.removed} />
                </button>
              )
            })
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {selected && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--ui-text-secondary)" title={selected}>
                {current?.worktree ? `[${current.worktree}] ` : ''}
                {rel || selected}
              </span>
              {rel && !inWorktree && (
                <>
                  <Button size="xs" variant="ghost" onClick={() => reveal(rel)}>
                    <IconFolderSearch /> {t('트리에서 보기')}
                  </Button>
                  <Button size="xs" variant="ghost" disabled={current?.deleted} onClick={() => void api.openPath(projectId, rel, 'open')}>
                    <IconExternalLink /> {t('열기')}
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto rounded bg-(--ui-bg-quaternary) font-mono text-[11.5px] leading-[1.45]">
            {!selected ? null : !details ? (
              <div className="p-3 text-(--ui-text-tertiary)">{t('불러오는 중…')}</div>
            ) : !details.length ? (
              <div className="p-3 font-sans text-[12px] leading-snug text-(--ui-text-tertiary)">
                {t('HERA 가 이 변경의 내용을 보지 못했습니다. 셸 명령이나 다른 프로그램으로 바뀐 파일은 목록에만 나옵니다.')}
              </div>
            ) : (
              <div className="min-w-max pb-2">
                {details.map(detail => (
                  <div key={detail.runId}>
                    <div className="sticky top-0 flex items-center gap-2 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) px-2 py-1 font-sans text-[11px] text-(--ui-text-secondary)">
                      <span className="font-medium text-(--ui-text-primary)">{detail.label}</span>
                      <span>{ago(detail.at)}</span>
                      <LineCounts added={detail.added} removed={detail.removed} />
                      {detail.created && <span>{t('새 파일')}</span>}
                      {detail.deleted && <span>{t('삭제됨')}</span>}
                    </div>
                    <div className="py-1">
                      {!detail.hunks.length && (
                        <div className="px-2 py-1 font-sans text-[11.5px] text-(--ui-text-tertiary)">{detail.deleted ? t('파일을 지웠습니다.') : detail.created ? t('빈 파일을 만들었습니다.') : t('줄 단위 내용이 기록되지 않은 변경입니다.')}</div>
                      )}
                      {detail.hunks.map((hunk, index) => (
                        <Hunk key={index} hunk={hunk} />
                      ))}
                      {detail.truncated && <div className="px-2 py-1 font-sans text-[11px] text-(--ui-text-tertiary)">{t('변경이 많아 일부만 보여 줍니다.')}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="w-48 shrink-0 overflow-y-auto xl:w-60">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
            <IconHierarchy2 size={14} /> {t('영향 범위')}
            {name && <span className="min-w-0 truncate font-normal text-(--ui-text-tertiary)">{name}</span>}
          </div>
          {!selected ? null : !impact ? (
            <div className="text-[11.5px] text-(--ui-text-tertiary)">{t('import 를 읽는 중…')}</div>
          ) : !impact.supported ? (
            <div className="text-[11.5px] leading-snug text-(--ui-text-tertiary)">{t('이 형식의 파일은 import 를 읽지 않습니다. TS · JS · Python 파일만 봅니다.')}</div>
          ) : (
            <>
              {!impact.dependents.length && !impact.tests.length && (
                <div className="mb-3 text-[11.5px] leading-snug text-(--ui-text-tertiary)">{t('이 파일을 import 하는 파일이 없습니다.')}</div>
              )}
              <ImpactList
                key={`direct:${selected}`}
                title={t('직접 쓰는 파일 {count}개', { count: impact.dependents.length })}
                icon={<IconHierarchy2 size={12} />}
                items={impact.dependents}
                onPick={inWorktree ? null : reveal}
              />
              <ImpactList key={`indirect:${selected}`} title={t('거쳐서 닿는 파일 {count}개', { count: impact.indirect.length })} icon={<IconHierarchy2 size={12} className="opacity-60" />} items={impact.indirect} onPick={inWorktree ? null : reveal} />
              <ImpactList key={`tests:${selected}`} title={t('관련 테스트 {count}개', { count: impact.tests.length })} icon={<IconTestPipe size={12} />} items={impact.tests} onPick={inWorktree ? null : reveal} />
              <div className="text-[10.5px] leading-snug text-(--ui-text-tertiary)">
                {t('import 문으로 찾았습니다 (소스 파일 {count}개). 문자열로 불러오는 코드나 설정 파일은 빠질 수 있습니다.', { count: impact.scanned })}
                {impact.capped ? ` ${t('파일이 많아 일부만 읽었습니다.')}` : ''}
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
