import { t } from './i18n'

// Color themes shared by main (window background, caption buttons) and the
// renderer (CSS tokens, xterm palette). A theme only seeds the base colors;
// text/stroke tints are derived in styles.css by mixing `text` over the surface.

export type ThemeMode = 'dark' | 'light'

export interface ThemeColors {
  /** Buttons, selection, focus rings, cursor. */
  accent: string
  /** Base foreground; secondary/tertiary text and hairlines are mixed from it. */
  text: string
  /** Title bar, status bar and window background. */
  chrome: string
  /** Project sidebar and the right-hand panel. */
  sidebar: string
  /** Main content area behind pages. */
  editor: string
  /** Menus, dialogs, cards, the selected row. */
  elevated: string
  input: string
  terminal: string
  terminalText: string
}

export const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

export type AnsiKey = (typeof ANSI_KEYS)[number]
export type AnsiPalette = Record<AnsiKey, string>

export interface ThemeDef {
  id: string
  name: string
  mode: ThemeMode
  colors: ThemeColors
  ansi: AnsiPalette
  /** User-made (editable, deletable). */
  custom?: boolean
}

export const COLOR_KEYS: (keyof ThemeColors)[] = ['accent', 'text', 'chrome', 'sidebar', 'editor', 'elevated', 'input', 'terminal', 'terminalText']

const DARK_ANSI: AnsiPalette = {
  black: '#1b1c20',
  red: '#f0625a',
  green: '#3fbf86',
  yellow: '#e0a526',
  blue: '#5aa2f0',
  magenta: '#c084fc',
  cyan: '#2bb3a3',
  white: '#d8d4ca',
  brightBlack: '#6b6e78',
  brightRed: '#ff7b72',
  brightGreen: '#56d39b',
  brightYellow: '#f2c14e',
  brightBlue: '#79b8ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#4fd1c1',
  brightWhite: '#f5f2ea'
}

const LIGHT_ANSI: AnsiPalette = {
  black: '#24231f',
  red: '#c9362d',
  green: '#1f8a5b',
  yellow: '#9a6a00',
  blue: '#2463c7',
  magenta: '#8a3fc7',
  cyan: '#0f8a7e',
  white: '#d9d5cb',
  brightBlack: '#77746b',
  brightRed: '#e0453b',
  brightGreen: '#25a36b',
  brightYellow: '#b8860b',
  brightBlue: '#3b7be0',
  brightMagenta: '#a35ae0',
  brightCyan: '#14a596',
  brightWhite: '#ffffff'
}

export const THEME_PRESETS: ThemeDef[] = [
  {
    id: 'hera-dark',
    get name() {
      return t('HERA 다크')
    },
    mode: 'dark',
    colors: {
      accent: '#d4a72c',
      text: '#ece8de',
      chrome: '#111215',
      sidebar: '#15161a',
      editor: '#0e0f12',
      elevated: '#1d1e23',
      input: '#18191d',
      terminal: '#0e0f12',
      terminalText: '#e3dfd4'
    },
    ansi: DARK_ANSI
  },
  {
    id: 'hera-dim',
    get name() {
      return t('HERA 딤 (밝은 다크)')
    },
    mode: 'dark',
    colors: {
      accent: '#e2b648',
      text: '#f0ece4',
      chrome: '#25272c',
      sidebar: '#2b2d33',
      editor: '#212328',
      elevated: '#363941',
      input: '#2e3137',
      terminal: '#1f2126',
      terminalText: '#ebe7de'
    },
    ansi: { ...DARK_ANSI, black: '#2c2f36', brightBlack: '#7c808b' }
  },
  {
    id: 'midnight',
    get name() {
      return t('미드나잇')
    },
    mode: 'dark',
    colors: {
      accent: '#6ea8fe',
      text: '#e4e9f3',
      chrome: '#0f1522',
      sidebar: '#141b2a',
      editor: '#0d1320',
      elevated: '#1c2538',
      input: '#172033',
      terminal: '#0d1320',
      terminalText: '#d8e0ee'
    },
    ansi: { ...DARK_ANSI, black: '#1a2233', brightBlack: '#64708a', blue: '#6ea8fe', brightBlue: '#9cc4ff' }
  },
  {
    id: 'graphite',
    get name() {
      return t('그라파이트')
    },
    mode: 'dark',
    colors: {
      accent: '#fb923c',
      text: '#ececec',
      chrome: '#1c1c1c',
      sidebar: '#202020',
      editor: '#181818',
      elevated: '#2a2a2a',
      input: '#242424',
      terminal: '#181818',
      terminalText: '#e4e4e4'
    },
    ansi: { ...DARK_ANSI, black: '#262626', brightBlack: '#737373' }
  },
  {
    id: 'aurora',
    get name() {
      return t('오로라')
    },
    mode: 'dark',
    colors: {
      accent: '#c792ff',
      text: '#ebe6f5',
      chrome: '#17141f',
      sidebar: '#1c1826',
      editor: '#14111c',
      elevated: '#262133',
      input: '#201b2b',
      terminal: '#14111c',
      terminalText: '#e2dcef'
    },
    ansi: { ...DARK_ANSI, black: '#221d2e', brightBlack: '#6f6880', magenta: '#c792ff', brightMagenta: '#ddb8ff' }
  },
  {
    id: 'hera-light',
    get name() {
      return t('HERA 라이트')
    },
    mode: 'light',
    colors: {
      accent: '#b8860b',
      text: '#1d1c19',
      chrome: '#f4f2ed',
      sidebar: '#ece9e2',
      editor: '#fbfaf7',
      elevated: '#ffffff',
      input: '#ffffff',
      terminal: '#fbfaf7',
      terminalText: '#24231f'
    },
    ansi: LIGHT_ANSI
  },
  {
    id: 'white',
    get name() {
      return t('화이트')
    },
    mode: 'light',
    colors: {
      accent: '#2563eb',
      text: '#18181b',
      chrome: '#f4f4f6',
      sidebar: '#ededf0',
      editor: '#ffffff',
      elevated: '#ffffff',
      input: '#ffffff',
      terminal: '#ffffff',
      terminalText: '#1f2328'
    },
    ansi: { ...LIGHT_ANSI, white: '#d4d4d8' }
  },
  {
    id: 'sepia',
    get name() {
      return t('세피아 (눈 편한)')
    },
    mode: 'light',
    colors: {
      accent: '#a0522d',
      text: '#3a2e21',
      chrome: '#eee4d2',
      sidebar: '#e7dbc4',
      editor: '#f6efe1',
      elevated: '#fcf7ee',
      input: '#fffaf1',
      terminal: '#f6efe1',
      terminalText: '#3a2e21'
    },
    ansi: { ...LIGHT_ANSI, white: '#d8ccb6', brightWhite: '#fffaf1' }
  },
  {
    id: 'sky',
    get name() {
      return t('스카이')
    },
    mode: 'light',
    colors: {
      accent: '#0e7490',
      text: '#17202c',
      chrome: '#e8eef5',
      sidebar: '#dfe7f0',
      editor: '#f6f9fc',
      elevated: '#ffffff',
      input: '#ffffff',
      terminal: '#f7f9fc',
      terminalText: '#1b2430'
    },
    ansi: { ...LIGHT_ANSI, white: '#cfd8e3' }
  }
]

export const DEFAULT_THEME: Record<ThemeMode, string> = { dark: 'hera-dark', light: 'hera-light' }

/** Accent swatches offered on the theme page ('' = the theme's own accent). */
export const ACCENT_SWATCHES = ['#d4a72c', '#f59e0b', '#fb923c', '#ef4444', '#ec4899', '#c084fc', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e']

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function channel(hex: string, index: number) {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255

  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string) {
  if (!isHexColor(hex)) return 0

  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)
}

/** Black or white, whichever reads better on `hex` (WCAG contrast). */
export function readableOn(hex: string) {
  const l = luminance(hex)

  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff'
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)

  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function mixHex(a: string, b: string, weightB: number) {
  const part = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)

  return `#${[0, 1, 2].map(i => Math.round(part(a, i) * (1 - weightB) + part(b, i) * weightB).toString(16).padStart(2, '0')).join('')}`
}

/** The accent used as text/icon color, nudged toward the text color until it reads on the page. */
export function accentText(colors: ThemeColors) {
  let out = colors.accent

  for (let step = 1; step <= 6 && contrastRatio(out, colors.editor) < 3.2; step++) out = mixHex(colors.accent, colors.text, step * 0.12)

  return out
}

export interface ThemeSettings {
  theme: 'dark' | 'light' | 'system'
  darkTheme: string
  lightTheme: string
  accent: string
  customThemes: ThemeDef[]
}

export function allThemes(settings: Pick<ThemeSettings, 'customThemes'>) {
  return [...THEME_PRESETS, ...(settings.customThemes || [])]
}

export function themeMode(settings: Pick<ThemeSettings, 'theme'>, systemDark: boolean): ThemeMode {
  if (settings.theme === 'light') return 'light'
  if (settings.theme === 'dark') return 'dark'

  return systemDark ? 'dark' : 'light'
}

/** The theme in effect, with the global accent override applied. */
export function resolveTheme(settings: ThemeSettings, systemDark: boolean): ThemeDef {
  const mode = themeMode(settings, systemDark)
  const wanted = mode === 'dark' ? settings.darkTheme : settings.lightTheme
  const themes = allThemes(settings)
  const found = themes.find(entry => entry.id === wanted && entry.mode === mode) || themes.find(entry => entry.id === DEFAULT_THEME[mode])!

  return isHexColor(settings.accent) ? { ...found, colors: { ...found.colors, accent: settings.accent } } : found
}

/** CSS custom properties for the renderer's design tokens. */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const { colors } = theme

  return {
    '--ui-accent': colors.accent,
    '--ui-accent-fg': readableOn(colors.accent),
    '--ui-accent-text': accentText(colors),
    '--ui-base': colors.text,
    '--ui-bg-chrome': colors.chrome,
    '--ui-bg-sidebar': colors.sidebar,
    '--ui-bg-editor': colors.editor,
    '--ui-bg-elevated': colors.elevated,
    '--ui-bg-input': colors.input,
    '--term-bg': colors.terminal
  }
}

/** xterm ITheme-compatible palette. */
export function terminalPalette(theme: ThemeDef) {
  const { colors } = theme

  return {
    background: colors.terminal,
    foreground: colors.terminalText,
    cursor: colors.accent,
    cursorAccent: colors.terminal,
    selectionBackground: `${colors.accent}55`,
    selectionInactiveBackground: `${colors.accent}30`,
    ...theme.ansi
  }
}

/** Keep only well-formed user themes (config.json is hand-editable). */
export function sanitizeCustomThemes(raw: unknown): ThemeDef[] {
  if (!Array.isArray(raw)) return []

  const out: ThemeDef[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const theme = entry as Partial<ThemeDef>
    if (typeof theme.id !== 'string' || !theme.id || THEME_PRESETS.some(preset => preset.id === theme.id)) continue
    const mode: ThemeMode = theme.mode === 'light' ? 'light' : 'dark'
    const base = THEME_PRESETS.find(preset => preset.id === DEFAULT_THEME[mode])!
    const colors = { ...base.colors }
    const ansi = { ...base.ansi }

    for (const key of COLOR_KEYS) if (isHexColor(theme.colors?.[key])) colors[key] = theme.colors![key]
    for (const key of ANSI_KEYS) if (isHexColor(theme.ansi?.[key])) ansi[key] = theme.ansi![key]

    out.push({ id: theme.id, name: typeof theme.name === 'string' && theme.name.trim() ? theme.name.slice(0, 40) : t('내 테마'), mode, colors, ansi, custom: true })
  }

  return out
}
