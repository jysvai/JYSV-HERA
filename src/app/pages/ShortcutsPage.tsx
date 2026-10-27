import { useStore } from '@nanostores/react'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { Shortcut } from '../../../shared/types'
import { Button, Input, PageHeader, Section } from '../../components/ui/primitives'
import { $config, updateConfig } from '../../store/app'

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function ShortcutsPage() {
  const config = useStore($config)
  const [rows, setRows] = useState<Shortcut[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setRows(config?.shortcuts.map(entry => ({ ...entry })) || [])
  }, [config?.shortcuts, dirty])

  const patch = (index: number, change: Partial<Shortcut>) => {
    setRows(previous => previous.map((row, i) => (i === index ? { ...row, ...change } : row)))
    setDirty(true)
  }

  const invalid = rows.filter(row => row.name && !NAME.test(row.name)).map(row => row.name)
  const duplicates = rows.map(row => row.name).filter((name, index, all) => name && all.indexOf(name) !== index)

  const save = () => {
    const cleaned = rows.filter(row => row.name.trim() && row.command.trim()).map(row => ({ ...row, name: row.name.trim(), command: row.command.trim() }))
    updateConfig(draft => void (draft.shortcuts = cleaned))
    setDirty(false)
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('단축어')}
        description={t('모든 HERA 터미널(PowerShell · cmd · bash · zsh · fish)에서 바로 쓸 수 있는 명령 별칭입니다. 뒤에 붙인 인자는 그대로 전달됩니다 (예: cc --model opus). 저장하면 새로 여는 터미널부터 적용됩니다.')}
        actions={
          <>
            {dirty && (
              <Button size="sm" variant="text" onClick={() => setDirty(false)}>
                {t('되돌리기')}
              </Button>
            )}
            <Button size="sm" variant="default" disabled={!dirty || invalid.length > 0 || duplicates.length > 0} onClick={save}>
              {t('저장')}
            </Button>
          </>
        }
      />
      {(invalid.length > 0 || duplicates.length > 0) && (
        <div className="mb-3 rounded-md bg-(--status-waiting)/12 px-3 py-2 text-[12px] text-(--status-waiting)">
          {invalid.length > 0 && <div>{t('이름은 영문/숫자/_/- 만 쓸 수 있습니다: {names}', { names: invalid.join(', ') })}</div>}
          {duplicates.length > 0 && <div>{t('중복된 이름: {names}', { names: [...new Set(duplicates)].join(', ') })}</div>}
        </div>
      )}
      <div className="grid grid-cols-[160px_1fr_1fr_32px] gap-x-2 gap-y-1.5">
        <div className="text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('이름')}</div>
        <div className="text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('명령')}</div>
        <div className="text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{t('설명')}</div>
        <div />
        {rows.map((row, index) => (
          <div key={index} className="contents">
            <Input value={row.name} onChange={event => patch(index, { name: event.target.value })} className="font-mono text-[12px]" placeholder="cc" />
            <Input value={row.command} onChange={event => patch(index, { command: event.target.value })} className="font-mono text-[12px]" placeholder="claude" />
            <Input value={row.description || ''} onChange={event => patch(index, { description: event.target.value })} placeholder={t('(선택)')} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('삭제')}
              onClick={() => {
                setRows(previous => previous.filter((_, i) => i !== index))
                setDirty(true)
              }}
            >
              <IconTrash />
            </Button>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={() => {
          setRows(previous => [...previous, { name: '', command: '' }])
          setDirty(true)
        }}
      >
        <IconPlus /> {t('단축어 추가')}
      </Button>

      <Section title={t('참고')} className="mt-6">
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-(--ui-text-secondary)">
          <li>{t('PowerShell 에서는 같은 이름의 기본 별칭(예: gl, gp)을 덮어씁니다.')}</li>
          <li>{t('프로젝트마다 다른 명령은 프로젝트 설정의 “프로젝트 명령”에 등록하면 실행 메뉴·팔레트에 버튼으로 나옵니다.')}</li>
          <li>
            {t('에이전트 협업 명령')} <code className="font-mono">hera</code> {t('는 항상 PATH 에 있습니다.')} <code className="font-mono">hera help</code> {t('로 확인하세요.')}
          </li>
        </ul>
      </Section>
    </div>
  )
}
