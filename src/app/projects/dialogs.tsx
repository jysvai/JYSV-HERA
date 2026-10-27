import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import type { Shortcut } from '../../../shared/types'
import { relTime } from '../../../shared/util'
import { Button, Dialog, Input, Select, Switch, Textarea } from '../../components/ui/primitives'
import { $config, $projectId, updateConfig } from '../../store/app'
import { $editProjectId, $scanResult, addPaths } from './flows'

const COLORS = ['#d4a72c', '#2bb3a3', '#5aa2f0', '#c084fc', '#f0625a', '#3fbf86', '#e0a526', '#ef6c00', '#8e8e93']

export function parseCommandLines(text: string): Shortcut[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .flatMap(line => {
      const index = line.indexOf('=')

      if (index <= 0) return []

      const name = line.slice(0, index).trim()
      const command = line.slice(index + 1).trim()

      return name && command ? [{ name, command }] : []
    })
}

export function formatCommandLines(items: Shortcut[]): string {
  return items.map(item => `${item.name} = ${item.command}`).join('\n')
}

export function ProjectDialog() {
  const id = useStore($editProjectId)
  const config = useStore($config)
  const project = config?.projects.find(entry => entry.id === id) || null
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [color, setColor] = useState<string | undefined>()
  const [shell, setShell] = useState('auto')
  const [commands, setCommands] = useState('')
  const [pinned, setPinned] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!project) return
    setName(project.name)
    setDir(project.path)
    setColor(project.color)
    setShell(project.shell || 'auto')
    setCommands(formatCommandLines(project.commands))
    setPinned(project.pinned)
    setConfirmDelete(false)
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null

  const close = () => $editProjectId.set(null)

  const save = () => {
    updateConfig(draft => {
      const target = draft.projects.find(entry => entry.id === project.id)
      if (!target) return
      target.name = name.trim() || target.name
      target.path = dir.trim() || target.path
      target.color = color
      target.shell = shell === 'auto' ? undefined : shell
      target.commands = parseCommandLines(commands)
      target.pinned = pinned
    })
    close()
  }

  const remove = () => {
    updateConfig(draft => {
      draft.projects = draft.projects.filter(entry => entry.id !== project.id)
    })
    if ($projectId.get() === project.id) $projectId.set(config?.projects.find(entry => entry.id !== project.id)?.id || null)
    close()
  }

  return (
    <Dialog
      open
      onClose={close}
      title="프로젝트 설정"
      footer={
        <>
          {confirmDelete ? (
            <Button variant="destructive" onClick={remove} className="mr-auto">
              정말 목록에서 제거 (폴더는 그대로)
            </Button>
          ) : (
            <Button variant="text" onClick={() => setConfirmDelete(true)} className="mr-auto">
              목록에서 제거
            </Button>
          )}
          <Button variant="text" onClick={close}>
            취소
          </Button>
          <Button variant="default" onClick={save}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">이름</div>
          <Input value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="block">
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">경로</div>
          <Input value={dir} onChange={event => setDir(event.target.value)} className="font-mono text-[12px]" />
        </label>
        <div>
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">색상</div>
          <div className="flex gap-1.5">
            {COLORS.map(entry => (
              <button
                key={entry}
                type="button"
                aria-label={entry}
                onClick={() => setColor(entry === color ? undefined : entry)}
                className={`size-6 rounded-full ${entry === color ? 'ring-2 ring-(--ui-text-primary) ring-offset-2 ring-offset-(--ui-bg-elevated)' : ''}`}
                style={{ background: entry }}
              />
            ))}
          </div>
        </div>
        <label className="block">
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">셸</div>
          <Select value={shell} onChange={event => setShell(event.target.value)}>
            <option value="auto">기본값 따르기</option>
            <option value="powershell">PowerShell</option>
            <option value="pwsh">PowerShell 7 (pwsh)</option>
            <option value="cmd">명령 프롬프트 (cmd)</option>
            <option value="gitbash">Git Bash</option>
            <option value="bash">bash</option>
            <option value="zsh">zsh</option>
            <option value="fish">fish</option>
          </Select>
        </label>
        <label className="block">
          <div className="mb-1 text-[12px] text-(--ui-text-secondary)">프로젝트 명령 (한 줄에 하나: 이름 = 명령)</div>
          <Textarea
            value={commands}
            onChange={event => setCommands(event.target.value)}
            placeholder={'dev = npm run dev\ntest = npm test\nclaude-yolo = claude --dangerously-skip-permissions'}
            className="font-mono text-[12px]"
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-[13px]">사이드바 상단 고정</span>
          <Switch checked={pinned} onChange={setPinned} label="상단 고정" />
        </div>
      </div>
    </Dialog>
  )
}

export function ScanDialog() {
  const result = useStore($scanResult)
  const config = useStore($config)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const existing = new Set((config?.projects || []).map(project => project.path.toLowerCase()))

  useEffect(() => {
    if (result) setSelected(new Set(result.found.filter(entry => !existing.has(entry.path.toLowerCase())).map(entry => entry.path)))
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null

  const close = () => $scanResult.set(null)

  return (
    <Dialog
      open
      onClose={close}
      width={600}
      title={`프로젝트 찾기 · ${result.parent}`}
      footer={
        <>
          <Button variant="text" onClick={close}>
            취소
          </Button>
          <Button
            variant="default"
            disabled={!selected.size}
            onClick={() => {
              void addPaths([...selected])
              close()
            }}
          >
            {selected.size}개 등록
          </Button>
        </>
      }
    >
      <div className="space-y-0.5">
        {result.found.map(entry => {
          const already = existing.has(entry.path.toLowerCase())

          return (
            <label key={entry.path} className={`flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-(--chrome-action-hover) ${already ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                disabled={already}
                checked={selected.has(entry.path)}
                onChange={() =>
                  setSelected(previous => {
                    const next = new Set(previous)
                    next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path)

                    return next
                  })
                }
                className="accent-(--ui-accent)"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">
                  {entry.name} {already && <span className="text-[11px] text-(--ui-text-tertiary)">(등록됨)</span>}
                </div>
                <div className="truncate text-[11px] text-(--ui-text-tertiary)">{entry.markers.join(' · ')}</div>
              </div>
              <span className="shrink-0 text-[11px] text-(--ui-text-tertiary)">{relTime(entry.mtime)}</span>
            </label>
          )
        })}
      </div>
    </Dialog>
  )
}
