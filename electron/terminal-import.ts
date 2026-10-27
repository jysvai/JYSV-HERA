// Settings from the terminal the user worked in before HERA. Windows Terminal keeps
// them in one settings.json: the default profile's font, cursor, scrollback, color
// scheme and shell are offered in Settings and applied only when the user says so.
import fs from 'node:fs'
import path from 'node:path'

import { t } from '../shared/i18n'
import type { AnsiPalette } from '../shared/themes'
import type { TerminalImport } from '../shared/types'

import { findOnPath, isWin } from './paths'

const PACKAGES = ['Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'Microsoft.WindowsTerminalCanary_8wekyb3d8bbwe']

function settingsFiles(): string[] {
  const local = process.env.LOCALAPPDATA

  if (!isWin || !local) return []

  return [
    ...PACKAGES.map(name => path.join(local, 'Packages', name, 'LocalState', 'settings.json')),
    // unpackaged (scoop, winget portable)
    path.join(local, 'Microsoft', 'Windows Terminal', 'settings.json')
  ]
}

/** Windows Terminal writes JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]

    if (inString) {
      out += char
      if (char === '\\') out += text[++index] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++
      out += '\n'
    } else if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index++
    } else {
      out += char
    }
  }

  return JSON.parse(out.replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1'))
}

type Scheme = { name: string; background: string; foreground: string; cursorColor?: string; selectionBackground?: string } & Record<string, string>

const SCHEME_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'] as const

function scheme(name: string, background: string, foreground: string, colors: string, extra: Partial<Scheme> = {}): Scheme {
  const values = colors.split(' ')

  return { name, background, foreground, ...Object.fromEntries(SCHEME_KEYS.map((key, index) => [key, values[index]])), ...extra } as Scheme
}

const CAMPBELL = '#0C0C0C #C50F1F #13A10E #C19C00 #0037DA #881798 #3A96DD #CCCCCC #767676 #E74856 #16C60C #F9F1A5 #3B78FF #B4009E #61D6D6 #F2F2F2'
const SOLARIZED = '#002B36 #DC322F #859900 #B58900 #268BD2 #D33682 #2AA198 #EEE8D5 #073642 #CB4B16 #586E75 #657B83 #839496 #6C71C4 #93A1A1 #FDF6E3'
const TANGO = '#000000 #CC0000 #4E9A06 #C4A000 #3465A4 #75507B #06989A #D3D7CF #555753 #EF2929 #8AE234 #FCE94F #729FCF #AD7FA8 #34E2E2 #EEEEEC'

/** Windows Terminal's built-in schemes (src/cascadia/TerminalSettingsModel/defaults.json). */
const BUILTIN_SCHEMES: Scheme[] = [
  scheme('Campbell', '#0C0C0C', '#CCCCCC', CAMPBELL, { cursorColor: '#FFFFFF' }),
  scheme('Campbell Powershell', '#012456', '#CCCCCC', CAMPBELL, { cursorColor: '#FFFFFF' }),
  scheme('One Half Dark', '#282C34', '#DCDFE4', '#282C34 #E06C75 #98C379 #E5C07B #61AFEF #C678DD #56B6C2 #DCDFE4 #5A6374 #E06C75 #98C379 #E5C07B #61AFEF #C678DD #56B6C2 #DCDFE4', { cursorColor: '#FFFFFF' }),
  scheme('One Half Light', '#FAFAFA', '#383A42', '#383A42 #E45649 #50A14F #C18301 #0184BC #A626A4 #0997B3 #FAFAFA #4F525D #DF6C75 #98C379 #E4C07A #61AFEF #C577DD #56B5C1 #FFFFFF', { cursorColor: '#4F525D' }),
  scheme('Solarized Dark', '#002B36', '#839496', SOLARIZED, { cursorColor: '#FFFFFF' }),
  scheme('Solarized Light', '#FDF6E3', '#657B83', SOLARIZED, { cursorColor: '#002B36' }),
  scheme('Tango Dark', '#000000', '#D3D7CF', TANGO, { cursorColor: '#FFFFFF' }),
  scheme('Tango Light', '#FFFFFF', '#555753', TANGO, { cursorColor: '#000000' }),
  scheme('Vintage', '#000000', '#C0C0C0', '#000000 #800000 #008000 #808000 #000080 #800080 #008080 #C0C0C0 #808080 #FF0000 #00FF00 #FFFF00 #0000FF #FF00FF #00FFFF #FFFFFF', { cursorColor: '#FFFFFF' }),
  scheme('Dark+', '#1E1E1E', '#CCCCCC', '#000000 #CD3131 #0DBC79 #E5E510 #2472C8 #BC3FBC #11A8CD #E5E5E5 #666666 #F14C4C #23D18B #F5F543 #3B8EEA #D670D6 #29B8DB #E5E5E5', { cursorColor: '#808080' })
]

const HEX = /^#[0-9a-f]{6}$/i

function toAnsi(found: Scheme): AnsiPalette | null {
  const ansi = {
    black: found.black,
    red: found.red,
    green: found.green,
    yellow: found.yellow,
    blue: found.blue,
    magenta: found.purple,
    cyan: found.cyan,
    white: found.white,
    brightBlack: found.brightBlack,
    brightRed: found.brightRed,
    brightGreen: found.brightGreen,
    brightYellow: found.brightYellow,
    brightBlue: found.brightBlue,
    brightMagenta: found.brightPurple,
    brightCyan: found.brightCyan,
    brightWhite: found.brightWhite
  }

  return Object.values(ansi).every(value => HEX.test(String(value))) ? ansi : null
}

const CURSORS: Record<string, TerminalImport['cursorStyle']> = {
  bar: 'bar',
  filledBox: 'block',
  emptyBox: 'block',
  underscore: 'underline',
  doubleUnderscore: 'underline',
  vintage: 'underline'
}

function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole)
}

/** HERA's shell setting for a Windows Terminal profile (a kind HERA sets up itself, or the command line as written). */
function shellFor(profile: Record<string, unknown>): { shell: string; label: string } | null {
  const source = String(profile.source || '')
  const name = String(profile.name || '')

  if (source === 'Windows.Terminal.PowershellCore') return { shell: 'pwsh', label: 'PowerShell 7 (pwsh)' }
  if (source === 'Windows.Terminal.Wsl' || source === 'Microsoft.WSL' || source === 'CanonicalGroupLimited.Ubuntu') return { shell: `wsl.exe -d ${name.includes(' ') ? `"${name}"` : name}`, label: `WSL · ${name}` }
  if (/^Git$/i.test(source) || /git bash/i.test(name)) return { shell: 'gitbash', label: 'Git Bash' }

  const commandline = expandEnv(String(profile.commandline || '')).trim()
  if (!commandline) return null

  const exe = path.basename(commandline.replace(/^"([^"]+)".*$/, '$1').split(/\s+/)[0]).toLowerCase()

  if (exe === 'powershell.exe' || exe === 'powershell') return { shell: 'powershell', label: 'Windows PowerShell' }
  if (exe === 'pwsh.exe' || exe === 'pwsh') return { shell: 'pwsh', label: 'PowerShell 7 (pwsh)' }
  if (exe === 'cmd.exe' || exe === 'cmd') return { shell: 'cmd', label: t('명령 프롬프트 (cmd)') }

  return { shell: commandline, label: name || commandline }
}

/** What HERA can take over from Windows Terminal's default profile, or null when there is nothing. */
export function detectTerminalImport(): TerminalImport | null {
  for (const file of settingsFiles()) {
    let settings: Record<string, unknown>

    try {
      settings = parseJsonc(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }

    const profiles = settings.profiles as { defaults?: Record<string, unknown>; list?: Record<string, unknown>[] } | Record<string, unknown>[] | undefined
    const list = Array.isArray(profiles) ? profiles : profiles?.list || []
    const defaults = Array.isArray(profiles) ? {} : profiles?.defaults || {}
    const wanted = String(settings.defaultProfile || '').toLowerCase()
    const chosen = list.find(entry => String(entry.guid || '').toLowerCase() === wanted || entry.name === settings.defaultProfile) || list.find(entry => !entry.hidden) || {}
    const profile: Record<string, unknown> = { ...defaults, ...chosen }
    const font = (profile.font || {}) as Record<string, unknown>
    const face = String(font.face || profile.fontFace || 'Cascadia Mono').split(',')[0].trim()
    const points = Number(font.size || profile.fontSize || 12)
    const schemeName = String(profile.colorScheme || 'Campbell')
    const custom = Array.isArray(settings.schemes) ? (settings.schemes as Scheme[]) : []
    const found = custom.find(entry => entry.name === schemeName) || BUILTIN_SCHEMES.find(entry => entry.name === schemeName)
    const ansi = found ? toAnsi(found) : null
    const history = Number(profile.historySize || 9001)
    const shell = shellFor(chosen)

    return {
      source: path.basename(path.dirname(path.dirname(file))).startsWith('Microsoft.WindowsTerminalPreview') ? 'Windows Terminal Preview' : 'Windows Terminal',
      profile: String(chosen.name || ''),
      fontFace: face,
      // Windows Terminal sizes in points, xterm in CSS pixels (96 dpi).
      fontSize: Number.isFinite(points) ? Math.max(8, Math.min(28, Math.round((points * 4) / 3))) : undefined,
      cursorStyle: CURSORS[String(profile.cursorShape || 'bar')] || 'bar',
      scrollback: Number.isFinite(history) ? Math.max(500, Math.min(20000, Math.round(history))) : undefined,
      shell: shell?.shell,
      shellLabel: shell?.label,
      scheme:
        found && ansi && HEX.test(found.background) && HEX.test(found.foreground)
          ? { name: found.name, background: found.background, foreground: found.foreground, cursor: HEX.test(found.cursorColor || '') ? found.cursorColor : undefined, ansi }
          : undefined
    }
  }

  return null
}

/** Shells this PC has, for the shell pickers. */
export function availableShells(): { value: string; label: string }[] {
  if (!isWin) {
    return [
      { value: 'bash', label: 'bash' },
      { value: 'zsh', label: 'zsh' },
      { value: 'fish', label: 'fish' }
    ].filter(entry => findOnPath(entry.value) || fs.existsSync(`/bin/${entry.value}`))
  }

  const shells = [
    { value: 'powershell', label: 'Windows PowerShell 5.1' },
    { value: 'pwsh', label: 'PowerShell 7 (pwsh)', present: Boolean(findOnPath('pwsh.exe')) },
    { value: 'cmd', label: t('명령 프롬프트 (cmd)') },
    {
      value: 'gitbash',
      label: 'Git Bash',
      present: [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')].some(file => fs.existsSync(file))
    },
    { value: 'wsl.exe', label: t('WSL (기본 배포판)'), present: fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')) }
  ]

  return shells.filter(entry => entry.present !== false).map(({ value, label }) => ({ value, label }))
}
