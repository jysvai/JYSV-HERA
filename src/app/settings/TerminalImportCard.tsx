import { useStore } from '@nanostores/react'
import { IconFileImport } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import { DEFAULT_THEME, THEME_PRESETS, luminance, type ThemeDef } from '../../../shared/themes'
import type { TerminalImport } from '../../../shared/types'
import { Button } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, toast, updateConfig } from '../../store/app'

type Part = 'font' | 'cursor' | 'scrollback' | 'shell' | 'colors'

const SHELL_LABEL = (): Record<string, string> => ({ auto: t('자동'), powershell: 'Windows PowerShell', pwsh: 'PowerShell 7', cmd: 'cmd', gitbash: 'Git Bash' })
const CURSOR_LABEL = () => ({ bar: t('세로 막대'), block: t('블록'), underline: t('밑줄') })

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

  if (found.fontFace) rows.push({ part: 'font', label: t('글꼴'), value: `${found.fontFace}${found.fontSize ? ` · ${found.fontSize}px` : ''}`, current: `${settings.fontFamily.split(',')[0].replace(/"/g, '')} · ${settings.fontSize}px` })
  if (found.cursorStyle) rows.push({ part: 'cursor', label: t('커서'), value: CURSOR_LABEL()[found.cursorStyle], current: CURSOR_LABEL()[settings.cursorStyle] })
  if (found.scrollback) rows.push({ part: 'scrollback', label: t('스크롤백'), value: t('{count}줄', { count: found.scrollback.toLocaleString() }), current: t('{count}줄', { count: settings.scrollback.toLocaleString() }) })
  if (found.shell) rows.push({ part: 'shell', label: t('기본 셸'), value: found.shellLabel || found.shell, current: SHELL_LABEL()[settings.defaultShell] || settings.defaultShell })
  if (found.scheme) {
    const mode = luminance(found.scheme.background) < 0.35 ? 'dark' : 'light'
    const id = mode === 'dark' ? settings.darkTheme : settings.lightTheme
    const active = [...THEME_PRESETS, ...settings.customThemes].find(theme => theme.id === id)

    rows.push({ part: 'colors', label: t('터미널 색'), value: t('{name} (테마로 추가)', { name: found.scheme.name }), current: active?.name || id })
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
    toast(t('{source} 설정을 가져왔습니다. 새로 여는 터미널부터 적용됩니다.', { source: found.source }))
  }

  return (
    <div className="mb-3 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-(--ui-text-primary)">
        <IconFileImport size={16} className="text-(--ui-accent-text)" />
        {t('{source} 설정 가져오기', { source: found.source })}
        {found.profile && <span className="text-[12px] font-normal text-(--ui-text-tertiary)">· {t('기본 프로필 “{name}”', { name: found.profile })}</span>}
      </div>
      <div className="grid gap-1">
        {rows.map(row => (
          <label key={row.part} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={pick[row.part]} onChange={event => setPick(prev => ({ ...prev, [row.part]: event.target.checked }))} className="accent-(--ui-accent)" />
            <span className="w-16 shrink-0 text-(--ui-text-secondary)">{row.label}</span>
            <span className="text-(--ui-text-primary)">{row.value}</span>
            <span className="truncate text-(--ui-text-tertiary)">{t('(지금: {current})', { current: row.current })}</span>
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex justify-end">
        <Button size="sm" variant="default" onClick={apply} disabled={!rows.some(row => pick[row.part])}>
          {t('선택한 항목 가져오기')}
        </Button>
      </div>
    </div>
  )
}
