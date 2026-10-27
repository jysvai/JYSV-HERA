import { useStore } from '@nanostores/react'
import { IconFileImport } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { DEFAULT_THEME, THEME_PRESETS, luminance, type ThemeDef } from '../../../shared/themes'
import type { TerminalImport } from '../../../shared/types'
import { Button } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, toast, updateConfig } from '../../store/app'

type Part = 'font' | 'cursor' | 'scrollback' | 'shell' | 'colors'

const SHELL_LABEL: Record<string, string> = { auto: '자동', powershell: 'Windows PowerShell', pwsh: 'PowerShell 7', cmd: 'cmd', gitbash: 'Git Bash' }
const CURSOR_LABEL = { bar: '세로 막대', block: '블록', underline: '밑줄' }

/** The face first, then the fonts already in the list (Korean and the rest stay as fallbacks). */
function withFace(list: string, face: string): string {
  const rest = list
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry && entry.replace(/["']/g, '').toLowerCase() !== face.toLowerCase())

  return [`"${face}"`, ...rest].join(', ')
}

function schemeTheme(found: NonNullable<TerminalImport['scheme']>): ThemeDef {
  const mode = luminance(found.background) < 0.35 ? 'dark' : 'light'
  const base = THEME_PRESETS.find(preset => preset.id === DEFAULT_THEME[mode])!

  return {
    id: `wt-${found.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: `${found.name} (WT)`.slice(0, 40),
    mode,
    colors: { ...base.colors, terminal: found.background, terminalText: found.foreground },
    ansi: found.ansi,
    custom: true
  }
}

/** Offers the settings of the terminal used before HERA (Windows Terminal), each one opt-in. */
export function TerminalImportCard() {
  const settings = useStore($config)?.settings
  const [found, setFound] = useState<TerminalImport | null>(null)
  const [pick, setPick] = useState<Record<Part, boolean>>({ font: true, cursor: true, scrollback: true, shell: true, colors: false })

  useEffect(() => {
    void api
      .terminalImport()
      .then(setFound)
      .catch(() => setFound(null))
  }, [])

  if (!found || !settings) return null

  const rows: { part: Part; label: string; value: string; current: string }[] = []

  if (found.fontFace) rows.push({ part: 'font', label: '글꼴', value: `${found.fontFace}${found.fontSize ? ` · ${found.fontSize}px` : ''}`, current: `${settings.fontFamily.split(',')[0].replace(/"/g, '')} · ${settings.fontSize}px` })
  if (found.cursorStyle) rows.push({ part: 'cursor', label: '커서', value: CURSOR_LABEL[found.cursorStyle], current: CURSOR_LABEL[settings.cursorStyle] })
  if (found.scrollback) rows.push({ part: 'scrollback', label: '스크롤백', value: `${found.scrollback.toLocaleString()}줄`, current: `${settings.scrollback.toLocaleString()}줄` })
  if (found.shell) rows.push({ part: 'shell', label: '기본 셸', value: found.shellLabel || found.shell, current: SHELL_LABEL[settings.defaultShell] || settings.defaultShell })
  if (found.scheme) {
    const mode = luminance(found.scheme.background) < 0.35 ? 'dark' : 'light'
    const id = mode === 'dark' ? settings.darkTheme : settings.lightTheme
    const active = [...THEME_PRESETS, ...settings.customThemes].find(theme => theme.id === id)

    rows.push({ part: 'colors', label: '터미널 색', value: `${found.scheme.name} (테마로 추가)`, current: active?.name || id })
  }

  const apply = () => {
    updateConfig(draft => {
      const next = draft.settings

      if (pick.font && found.fontFace) next.fontFamily = withFace(next.fontFamily, found.fontFace)
      if (pick.font && found.fontSize) next.fontSize = found.fontSize
      if (pick.cursor && found.cursorStyle) next.cursorStyle = found.cursorStyle
      if (pick.scrollback && found.scrollback) next.scrollback = found.scrollback
      if (pick.shell && found.shell) next.defaultShell = found.shell

      if (pick.colors && found.scheme) {
        const theme = schemeTheme(found.scheme)
        next.customThemes = [...next.customThemes.filter(entry => entry.id !== theme.id), theme]
        if (theme.mode === 'dark') next.darkTheme = theme.id
        else next.lightTheme = theme.id
      }
    })
    toast(`${found.source} 설정을 가져왔습니다. 새로 여는 터미널부터 적용됩니다.`)
  }

  return (
    <div className="mb-3 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-(--ui-text-primary)">
        <IconFileImport size={16} className="text-(--ui-accent-text)" />
        {found.source} 설정 가져오기
        {found.profile && <span className="text-[12px] font-normal text-(--ui-text-tertiary)">· 기본 프로필 “{found.profile}”</span>}
      </div>
      <div className="grid gap-1">
        {rows.map(row => (
          <label key={row.part} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={pick[row.part]} onChange={event => setPick(prev => ({ ...prev, [row.part]: event.target.checked }))} className="accent-(--ui-accent)" />
            <span className="w-16 shrink-0 text-(--ui-text-secondary)">{row.label}</span>
            <span className="text-(--ui-text-primary)">{row.value}</span>
            <span className="truncate text-(--ui-text-tertiary)">(지금: {row.current})</span>
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex justify-end">
        <Button size="sm" variant="default" onClick={apply} disabled={!rows.some(row => pick[row.part])}>
          선택한 항목 가져오기
        </Button>
      </div>
    </div>
  )
}
