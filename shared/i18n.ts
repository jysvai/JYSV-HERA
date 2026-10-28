// UI language. HERA's text is written in Korean in the source, and the Korean text
// is the key: t('설정') returns '설정' in Korean and 'Settings' in English. Text with
// values uses {name} placeholders: t('새 버전 v{version}', { version }).
// The renderer sets the language once before the app loads (a change reloads the
// window); the main process follows the setting live.
import { EN } from './i18n/en'

export type Lang = 'ko' | 'en'
export type LanguageSetting = 'auto' | Lang

let current: Lang = 'ko'

/** 'auto' follows the OS: Korean on a Korean system, English everywhere else. */
export function resolveLanguage(setting: LanguageSetting | undefined, locale: string): Lang {
  if (setting === 'ko' || setting === 'en') return setting

  return /^ko\b/i.test(locale || '') ? 'ko' : 'en'
}

export function setLanguage(lang: Lang): void {
  current = lang
}

export function language(): Lang {
  return current
}

/** Dates and numbers follow the window language, not the OS locale (an English window on a Korean PC). */
export function locale(): string {
  return current === 'ko' ? 'ko-KR' : 'en-US'
}

function fill(text: string, vars?: Record<string, string | number | null | undefined>): string {
  if (!vars) return text

  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key] ?? '') : match))
}

/** The Korean text in the current language, with {placeholders} filled in. */
export function t(ko: string, vars?: Record<string, string | number | null | undefined>): string {
  return fill(current === 'ko' ? ko : (EN[ko] ?? ko), vars)
}
