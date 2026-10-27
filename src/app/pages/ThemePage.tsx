import { useStore } from '@nanostores/react'
import { IconCheck, IconCopy, IconDeviceDesktop, IconMinus, IconMoon, IconPlus, IconSun, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ACCENT_SWATCHES, allThemes, ANSI_KEYS, COLOR_KEYS, isHexColor, type AnsiKey, type ThemeColors, type ThemeDef } from '../../../shared/themes'
import type { Settings } from '../../../shared/types'
import { newId } from '../../../shared/util'
import { Badge, Button, Input, PageHeader, Row, Section, Switch } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { $config, updateConfig } from '../../store/app'
import { $systemDark, $theme, $themePreview } from '../../store/theme'

const COLOR_LABELS: Record<keyof ThemeColors, { label: string; hint: string }> = {
  accent: { label: '강조색', hint: '버튼 · 선택 · 커서' },
  text: { label: '글자', hint: '흐린 글자와 구분선도 이 색에서 만들어집니다' },
  chrome: { label: '상단 · 하단 바', hint: '제목 표시줄, 상태 표시줄' },
  sidebar: { label: '사이드바 · 패널', hint: '프로젝트 목록, 오른쪽 패널' },
  editor: { label: '본문 배경', hint: '페이지 바탕' },
  elevated: { label: '카드 · 메뉴', hint: '선택된 줄, 메뉴, 대화상자' },
  input: { label: '입력칸', hint: '' },
  terminal: { label: '터미널 배경', hint: '' },
  terminalText: { label: '터미널 글자', hint: '' }
}

const ANSI_LABELS: Record<AnsiKey, string> = {
  black: '검정',
  red: '빨강',
  green: '초록',
  yellow: '노랑',
  blue: '파랑',
  magenta: '자주',
  cyan: '청록',
  white: '흰색',
  brightBlack: '회색',
  brightRed: '밝은 빨강',
  brightGreen: '밝은 초록',
  brightYellow: '밝은 노랑',
  brightBlue: '밝은 파랑',
  brightMagenta: '밝은 자주',
  brightCyan: '밝은 청록',
  brightWhite: '밝은 흰색'
}

function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  updateConfig(draft => void (draft.settings[key] = value))
}

/** A miniature of the app painted with the theme's own colors. */
function ThemePreview({ theme }: { theme: ThemeDef }) {
  const { colors, ansi } = theme
  const line = (width: string, opacity: number) => <div className="h-[3px] rounded-full" style={{ width, background: colors.text, opacity }} />

  return (
    <div className="flex h-[92px] flex-col overflow-hidden rounded-md" style={{ background: colors.chrome }}>
      <div className="flex h-3.5 shrink-0 items-center gap-1 px-1.5">
        <span className="size-1.5 rounded-full" style={{ background: colors.accent }} />
        <div className="h-[3px] w-6 rounded-full" style={{ background: colors.text, opacity: 0.35 }} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[26%] space-y-1.5 p-1.5" style={{ background: colors.sidebar }}>
          <div className="rounded-sm px-1 py-1" style={{ background: colors.elevated }}>
            {line('80%', 0.8)}
          </div>
          <div className="px-1">{line('70%', 0.45)}</div>
          <div className="px-1">{line('55%', 0.45)}</div>
        </div>
        <div className="min-w-0 flex-1 px-2 py-1.5 font-mono text-[9px] leading-[1.45] whitespace-nowrap" style={{ background: colors.terminal, color: colors.terminalText }}>
          <div>
            <span style={{ color: ansi.green }}>➜</span> <span style={{ color: ansi.cyan }}>~/hera</span> <span style={{ color: ansi.blue }}>git:(</span>
            <span style={{ color: ansi.red }}>main</span>
            <span style={{ color: ansi.blue }}>)</span>
          </div>
          <div>
            claude <span style={{ color: ansi.yellow }}>"리팩터링"</span>
          </div>
          <div style={{ color: ansi.brightBlack }}>● 작업 중…</div>
          <div>
            <span style={{ color: ansi.magenta }}>✓</span> 완료 <span style={{ color: colors.accent }}>▍</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeCard({ theme, selected, onSelect }: { theme: ThemeDef; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group rounded-lg p-1.5 text-left ring-1 transition-shadow duration-100',
        selected ? 'ring-2 ring-(--ui-accent)' : 'ring-(--ui-stroke-tertiary) hover:ring-(--ui-stroke-primary)'
      )}
    >
      <ThemePreview theme={theme} />
      <div className="flex items-center gap-1.5 px-1 pt-1.5 pb-0.5">
        <span className="truncate text-[12.5px] font-medium">{theme.name}</span>
        {theme.custom && <Badge>내 테마</Badge>}
        {selected && <IconCheck size={14} className="ml-auto shrink-0 text-(--ui-accent-text)" />}
      </div>
    </button>
  )
}

function ModeButton({ active, icon, label, hint, onClick }: { active: boolean; icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left ring-1 transition-shadow duration-100',
        active ? 'bg-(--ui-bg-elevated) ring-2 ring-(--ui-accent)' : 'ring-(--ui-stroke-tertiary) hover:ring-(--ui-stroke-primary)'
      )}
    >
      <span className={cn('[&_svg]:size-5', active ? 'text-(--ui-accent-text)' : 'text-(--ui-text-secondary)')}>{icon}</span>
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11.5px] text-(--ui-text-tertiary)">{hint}</span>
      </span>
    </button>
  )
}

function ColorInput({ value, onChange, label, size = 'md' }: { value: string; onChange: (next: string) => void; label: string; size?: 'md' | 'sm' }) {
  return (
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden rounded-md ring-1 ring-(--ui-stroke-secondary)', size === 'md' ? 'size-8' : 'size-6')}
      style={{ background: value }}
    >
      <input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
    </span>
  )
}

function HexInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  const commit = () => {
    const next = text.trim().startsWith('#') ? text.trim() : `#${text.trim()}`

    if (isHexColor(next)) onCommit(next.toLowerCase())
    else setText(value)
  }

  return (
    <Input
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => event.key === 'Enter' && commit()}
      className="h-7 w-[84px] font-mono text-[12px]"
      spellCheck={false}
    />
  )
}

function AccentPicker({ accent, themeAccent }: { accent: string; themeAccent: string }) {
  const current = accent || themeAccent

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setSetting('accent', '')}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] ring-1',
          !accent ? 'ring-2 ring-(--ui-accent)' : 'ring-(--ui-stroke-secondary) text-(--ui-text-secondary) hover:text-(--ui-text-primary)'
        )}
      >
        <span className="size-3.5 rounded-full" style={{ background: themeAccent }} />
        테마 기본
      </button>
      {ACCENT_SWATCHES.map(color => (
        <button
          key={color}
          type="button"
          aria-label={color}
          onClick={() => setSetting('accent', color)}
          className={cn('size-7 rounded-full ring-offset-2 ring-offset-(--ui-bg-editor)', accent.toLowerCase() === color ? 'ring-2 ring-(--ui-text-primary)' : 'hover:scale-110')}
          style={{ background: color }}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-(--ui-stroke-secondary)" />
      <ColorInput value={current} label="강조색 직접 고르기" onChange={next => setSetting('accent', next)} size="sm" />
      <HexInput value={current} onCommit={next => setSetting('accent', next)} />
    </div>
  )
}

/** Edits the active custom theme; drags preview instantly and save once settled. */
function CustomThemeEditor({ theme }: { theme: ThemeDef }) {
  const preview = useStore($themePreview)
  const accentOverride = useStore($config)?.settings.accent || ''
  const shown = preview && preview.id === theme.id ? preview : theme
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<ThemeDef | null>(null)

  const commit = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null

    if (!next) return
    updateConfig(draft => {
      const index = draft.settings.customThemes.findIndex(entry => entry.id === next.id)
      if (index >= 0) draft.settings.customThemes[index] = next
    })
    $themePreview.set(null)
  }

  // Never leave an unsaved preview behind when the page closes.
  useEffect(() => commit, [])

  const edit = (mutate: (draft: ThemeDef) => void) => {
    const next = structuredClone(pending.current || shown)
    mutate(next)
    pending.current = next
    $themePreview.set(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(commit, 350)
  }

  const remove = () => {
    // Drop the pending edit instead of saving it: one config write, no flicker.
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    $themePreview.set(null)
    updateConfig(draft => {
      draft.settings.customThemes = draft.settings.customThemes.filter(entry => entry.id !== theme.id)
      if (draft.settings.darkTheme === theme.id) draft.settings.darkTheme = 'hera-dark'
      if (draft.settings.lightTheme === theme.id) draft.settings.lightTheme = 'hera-light'
    })
  }

  return (
    <div className="rounded-xl bg-(--ui-bg-quaternary) p-4">
      <div className="mb-3 flex items-center gap-2">
        <Input
          key={theme.id}
          defaultValue={theme.name}
          onBlur={event => {
            const name = event.target.value.trim().slice(0, 40)
            if (name && name !== theme.name) edit(draft => void (draft.name = name))
          }}
          onKeyDown={event => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
          className="h-7 w-56"
        />
        <Badge>{theme.mode === 'dark' ? '다크' : '라이트'}</Badge>
        <Button size="sm" variant="destructive" className="ml-auto" onClick={remove}>
          <IconTrash /> 삭제
        </Button>
      </div>

      {accentOverride && (
        <div className="mb-3 text-[11.5px] text-(--ui-text-tertiary)">
          위의 강조색 설정이 우선 적용 중입니다. 이 테마의 강조색을 쓰려면 강조색을 “테마 기본”으로 두세요.
        </div>
      )}

      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {COLOR_KEYS.map(key => (
          <div key={key} className="flex items-center gap-2.5">
            <ColorInput value={shown.colors[key]} label={COLOR_LABELS[key].label} onChange={next => edit(draft => void (draft.colors[key] = next))} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px]">{COLOR_LABELS[key].label}</div>
              {COLOR_LABELS[key].hint && <div className="truncate text-[11px] text-(--ui-text-tertiary)">{COLOR_LABELS[key].hint}</div>}
            </div>
            <HexInput value={shown.colors[key]} onCommit={next => edit(draft => void (draft.colors[key] = next))} />
          </div>
        ))}
      </div>

      <div className="mt-5 mb-2 text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary)">터미널 16색 (프로그램 출력 색)</div>
      <div className="grid grid-cols-8 gap-2">
        {ANSI_KEYS.map(key => (
          <label key={key} className="flex flex-col items-center gap-1">
            <ColorInput value={shown.ansi[key]} label={ANSI_LABELS[key]} onChange={next => edit(draft => void (draft.ansi[key] = next))} size="sm" />
            <span className="text-center text-[10px] leading-tight text-(--ui-text-tertiary)">{ANSI_LABELS[key]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function ThemePage() {
  const config = useStore($config)
  const current = useStore($theme)
  const systemDark = useStore($systemDark)

  if (!config || !current) return null

  const settings = config.settings
  const themes = allThemes(settings)
  const activeDef = themes.find(entry => entry.id === current.id && entry.mode === current.mode) || current
  const customs = settings.customThemes

  const choose = (theme: ThemeDef) =>
    updateConfig(draft => {
      if (theme.mode === 'dark') draft.settings.darkTheme = theme.id
      else draft.settings.lightTheme = theme.id
      // An explicit mode follows the pick so the change is visible right away.
      if (draft.settings.theme !== 'system') draft.settings.theme = theme.mode
    })

  const createFromCurrent = () => {
    // Copy the theme's own colors (plus any unsaved drag), not the global accent override.
    const preview = $themePreview.get()
    const source = preview && preview.id === activeDef.id ? preview : activeDef
    const copy: ThemeDef = {
      ...structuredClone(source),
      id: newId('theme_'),
      name: `${activeDef.name.replace(/ 사본( \d+)?$/, '')} 사본`,
      custom: true
    }

    updateConfig(draft => {
      draft.settings.customThemes = [...draft.settings.customThemes, copy]
      if (copy.mode === 'dark') draft.settings.darkTheme = copy.id
      else draft.settings.lightTheme = copy.id
      if (draft.settings.theme !== 'system') draft.settings.theme = copy.mode
    })
  }

  const slotHint = (mode: 'dark' | 'light') => {
    if (settings.theme === 'system') return systemDark === (mode === 'dark') ? '지금 사용 중 (시스템 설정)' : `윈도우/맥이 ${mode === 'dark' ? '다크' : '라이트'}일 때 사용`

    return settings.theme === mode ? '지금 사용 중' : '고르면 이 모드로 바뀝니다'
  }

  const grid = (mode: 'dark' | 'light') => (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
      {themes
        .filter(entry => entry.mode === mode)
        .map(entry => (
          <ThemeCard key={entry.id} theme={entry} selected={(mode === 'dark' ? settings.darkTheme : settings.lightTheme) === entry.id} onSelect={() => choose(entry)} />
        ))}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-5xl">
        <PageHeader title="테마 · 색상" description="고르는 즉시 화면 전체와 터미널 색에 적용됩니다. 제목 표시줄의 ☀/☾ 버튼으로도 바로 바꿀 수 있습니다." />

        <Section title="밝기">
          <div className="flex gap-3">
            <ModeButton active={settings.theme === 'dark'} icon={<IconMoon />} label="다크" hint="어두운 바탕" onClick={() => setSetting('theme', 'dark')} />
            <ModeButton active={settings.theme === 'light'} icon={<IconSun />} label="라이트" hint="밝은 바탕" onClick={() => setSetting('theme', 'light')} />
            <ModeButton
              active={settings.theme === 'system'}
              icon={<IconDeviceDesktop />}
              label="시스템 따라가기"
              hint={`지금은 ${systemDark ? '다크' : '라이트'}`}
              onClick={() => setSetting('theme', 'system')}
            />
          </div>
        </Section>

        <Section title={`라이트 테마 · ${slotHint('light')}`}>{grid('light')}</Section>
        <Section title={`다크 테마 · ${slotHint('dark')}`}>{grid('dark')}</Section>

        <Section title="강조색">
          <AccentPicker accent={settings.accent} themeAccent={activeDef.colors.accent} />
        </Section>

        <Section title="읽기 편하게">
          <Row label="글자 선명하게" description="흐린 글자(설명, 시간, 경로)와 구분선을 더 진하게 표시합니다.">
            <Switch checked={settings.highContrast} onChange={next => setSetting('highContrast', next)} label="글자 선명하게" />
          </Row>
          <Row label="터미널 글자 크기" description="설정 페이지의 글꼴 설정과 같은 값입니다.">
            <Button size="icon-sm" variant="outline" aria-label="작게" onClick={() => setSetting('fontSize', Math.max(8, settings.fontSize - 1))}>
              <IconMinus />
            </Button>
            <span className="w-8 text-center text-[13px] tabular-nums">{settings.fontSize}</span>
            <Button size="icon-sm" variant="outline" aria-label="크게" onClick={() => setSetting('fontSize', Math.min(28, settings.fontSize + 1))}>
              <IconPlus />
            </Button>
          </Row>
        </Section>

        <Section
          title="내 색상 만들기"
          action={
            <Button size="sm" onClick={createFromCurrent}>
              <IconCopy /> 지금 테마를 복제해서 만들기
            </Button>
          }
        >
          {activeDef.custom ? (
            <CustomThemeEditor key={activeDef.id} theme={activeDef} />
          ) : (
            <div className="rounded-xl bg-(--ui-bg-quaternary) px-4 py-3 text-[12.5px] leading-relaxed text-(--ui-text-secondary)">
              지금 쓰는 “{activeDef.name}”을 복제하면 배경 · 글자 · 강조색 · 터미널 16색을 하나하나 바꿀 수 있습니다. 바꾸는 동안 화면에 바로 미리 보입니다.
              {customs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {customs.map(entry => (
                    <Button key={entry.id} size="sm" variant="outline" onClick={() => choose(entry)}>
                      {entry.name} 편집
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
