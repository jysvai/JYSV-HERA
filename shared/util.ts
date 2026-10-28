import { t } from './i18n'

export function newId(prefix = ''): string {
  // Ids name sessions on the hera bus, so they come from the system CSPRNG.
  const random = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), byte => (byte % 36).toString(36)).join('')
  const time = Date.now().toString(36).slice(-5)

  return `${prefix}${time}${random}`
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Compact relative time, e.g. "3분 전" / "3 min ago", "어제" / "yesterday", "5일 전" / "5 d ago". */
export function relTime(time: number | null | undefined, now = Date.now()): string {
  if (!time) {
    return t('기록 없음')
  }

  const diff = Math.max(0, now - time)
  const min = Math.floor(diff / 60000)

  if (min < 1) {
    return t('방금')
  }

  if (min < 60) {
    return t('{min}분 전', { min })
  }

  const hours = Math.floor(min / 60)

  if (hours < 24) {
    return t('{hours}시간 전', { hours })
  }

  const days = Math.floor(hours / 24)

  if (days === 1) {
    return t('어제')
  }

  if (days < 30) {
    return t('{days}일 전', { days })
  }

  const months = Math.floor(days / 30)

  return months < 12 ? t('{months}개월 전', { months }) : t('{years}년 전', { years: Math.floor(months / 12) })
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(2)}B`
  }

  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }

  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }

  return String(n)
}

export function formatBytesKB(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(0)} MB` : `${kb} KB`
}

export function localDay(t: number): string {
  const d = new Date(t)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')

  return `${d.getFullYear()}-${m}-${day}`
}

export function safeRegex(source: string | undefined, flags = 'i'): RegExp | null {
  if (!source) {
    return null
  }

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/** Normalize a filesystem path for comparisons (case-insensitive on Windows/macOS). */
export function pathKey(
  p: string,
  platform: string = (globalThis as { process?: { platform: string } }).process?.platform ?? 'win32'
): string {
  let out = p.replace(/[\\/]+$/, '')

  if (platform === 'win32') {
    out = out.replace(/\//g, '\\').toLowerCase()
  } else if (platform === 'darwin') {
    out = out.toLowerCase()
  }

  return out
}

/**
 * Windows named-pipe name for a data dir. The default install keeps the plain
 * name; any other HERA_HOME (dev builds, portable copies) gets its own pipe so
 * two instances never answer each other's `hera` calls.
 */
export function heraPipeName(user: string, dataDir: string, defaultDataDir: string): string {
  const safeUser = (user || 'user').replace(/[^A-Za-z0-9_.-]/g, '_')
  const a = dataDir.replace(/[\\/]+$/, '').toLowerCase()
  const b = defaultDataDir.replace(/[\\/]+$/, '').toLowerCase()
  const prefix = String.raw`\\.\pipe\jysvhera-`

  if (a === b) return `${prefix}${safeUser}`

  let hash = 0x811c9dc5

  for (let i = 0; i < a.length; i++) {
    hash ^= a.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `${prefix}${safeUser}-${hash.toString(16)}`
}

/**
 * Environment a tab opened for another session (`hera host`) takes from it: the
 * Claude config dir (lanes register there; a profile's lanes must find their main)
 * and which provider and region it uses. Never a key.
 */
export const HOST_PASSED_ENV =
  /^(CLAUDE_CONFIG_DIR|CLAUDE_CODE_USE_(BEDROCK|MANTLE|VERTEX|FOUNDRY)|AWS_(REGION|DEFAULT_REGION|PROFILE)|ANTHROPIC_(BEDROCK_REGION_PREFIX|VERTEX_PROJECT_ID|FOUNDRY_RESOURCE|BEDROCK_BASE_URL|BEDROCK_MANTLE_BASE_URL|VERTEX_BASE_URL|FOUNDRY_BASE_URL|DEFAULT_(OPUS|SONNET|HAIKU|FABLE)_MODEL)|CLOUD_ML_REGION)$/
