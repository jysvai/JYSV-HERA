import { atom, computed } from 'nanostores'

import { isHexColor, resolveTheme, terminalPalette, themeVars, type ThemeDef } from '../../shared/themes'
import { $config, updateConfig } from './app'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export const $systemDark = atom(media.matches)
media.addEventListener('change', event => $systemDark.set(event.matches))

/** Unsaved theme shown while a color picker is being dragged. */
export const $themePreview = atom<ThemeDef | null>(null)

let lastTheme: { key: string; theme: ThemeDef } | null = null

/** Same colors → same object, so config edits elsewhere don't repaint terminals. */
function stable(theme: ThemeDef) {
  const key = JSON.stringify(theme)

  if (lastTheme?.key !== key) lastTheme = { key, theme }

  return lastTheme.theme
}

export const $theme = computed([$config, $systemDark, $themePreview], (config, systemDark, preview) => {
  if (!config) return null
  const resolved = resolveTheme(config.settings, systemDark)

  // A pending color drag only shows while its theme is still the active one.
  if (preview && preview.id === resolved.id) {
    return stable(isHexColor(config.settings.accent) ? { ...preview, colors: { ...preview.colors, accent: config.settings.accent } } : preview)
  }

  return stable(resolved)
})

export const $terminalPalette = computed($theme, theme => (theme ? terminalPalette(theme) : null))

const CACHE_KEY = 'hera.theme'

let appliedKey = ''

/** Write the theme onto <html> and remember it so the next start paints it before config loads. */
export function applyTheme(theme: ThemeDef, highContrast: boolean) {
  const root = document.documentElement
  const vars = themeVars(theme)
  const dark = theme.mode === 'dark'
  const key = JSON.stringify([vars, dark, highContrast])

  if (key === appliedKey) return
  appliedKey = key

  root.classList.toggle('dark', dark)
  root.classList.toggle('contrast-high', highContrast)

  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ dark, highContrast, vars }))
  } catch {
    // storage unavailable
  }
}

export function restoreCachedTheme() {
  const root = document.documentElement

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as { dark: boolean; highContrast: boolean; vars: Record<string, string> } | null

    if (cached && typeof cached.vars === 'object') {
      root.classList.toggle('dark', Boolean(cached.dark))
      root.classList.toggle('contrast-high', Boolean(cached.highContrast))
      for (const [name, value] of Object.entries(cached.vars)) if (name.startsWith('--') && typeof value === 'string') root.style.setProperty(name, value)

      return
    }
  } catch {
    // fall through to the default
  }

  root.classList.add('dark')
}

/** Quick dark ⇄ light flip (from 'system' it flips away from what is showing now). */
export function toggleThemeMode() {
  const mode = $theme.get()?.mode || 'dark'
  updateConfig(draft => void (draft.settings.theme = mode === 'dark' ? 'light' : 'dark'))
}
