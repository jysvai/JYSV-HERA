// lanes integration. The lanes Claude Code plugin (https://github.com/jysvai/lanes)
// runs a mid and a low "lane" session beside a main Claude session. HERA finds
// the plugin, edits its options in Claude Code's settings.json, starts and
// stops lanes (in HERA tabs on Windows) and shows what they do from the files
// they keep under <project>/.claude/lanes. The plugin itself is not changed.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { LANE_ALLOW_RULES } from '../shared/defaults'
import { t } from '../shared/i18n'
import type { CreateSessionRequest, LaneLive, LaneOptionSpec, LaneProjectState, LanesInfo, LaneTask, LaneTier, Project, SessionInfo } from '../shared/types'
import { HOST_PASSED_ENV } from '../shared/util'

import { binDir, dataPath, hydrateLoginPath, isWin, readJson, writeJsonAtomic } from './paths'
import { getConfig, projectById, projectForPath } from './store'

const REPO = 'https://github.com/jysvai/lanes'
const TIERS: LaneTier[] = ['mid', 'low']
// A lane opened less than this ago and not registered yet is still opening (the plugin uses the same window).
const OPENING_MS = 45_000

// Session markers a lane must not inherit: a Claude Code session started under
// another one's markers never becomes a peer that can be messaged.
export const CLAUDE_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_LANE'
]

type OpenTab = (req: CreateSessionRequest) => SessionInfo
type ListTabs = () => SessionInfo[]
type CloseTab = (id: string) => void

let tabs: { open: OpenTab; list: ListTabs; close: CloseTab } | null = null

/** main.ts hands over how to open, list and close HERA tabs. */
export function setLaneTabs(open: OpenTab, list: ListTabs, close: CloseTab) {
  tabs = { open, list, close }
}

const opening = new Map<string, number>()

function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function settingsFile(): string {
  return path.join(claudeHome(), 'settings.json')
}

function tilde(file: string): string {
  const home = os.homedir()

  return file.toLowerCase().startsWith(home.toLowerCase()) ? `~${file.slice(home.length)}` : file
}

// ---------------------------------------------------------------- the plugin

interface Located {
  key: string
  root: string
}

function marketplaceDirs(marketDir: string, name: string): string[] {
  const manifest = readJson<{ plugins?: { name?: string; source?: unknown }[] }>(path.join(marketDir, '.claude-plugin', 'marketplace.json'))
  const entry = manifest?.plugins?.find(plugin => plugin.name === name)

  return typeof entry?.source === 'string' ? [path.resolve(marketDir, entry.source)] : []
}

function hasScript(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'bin', isWin ? 'lanes.ps1' : 'lanes.sh'))
}

/** lanes 0.3.13+ asks HERA for a tab itself (`hera host --lane`) whenever HERA_LANES_HOST is set. */
function hasHostSeam(root: string): boolean {
  try {
    return fs.readFileSync(path.join(root, 'bin', isWin ? 'lanes.ps1' : 'lanes.sh'), 'utf8').includes('HERA_LANES_HOST')
  } catch {
    return false
  }
}

/** Where the installed lanes plugin lives, from Claude Code's plugin registry. */
function locate(): Located | null {
  const pluginsDir = path.join(claudeHome(), 'plugins')
  const installed = readJson<{ plugins?: Record<string, { installPath?: string }[]> }>(path.join(pluginsDir, 'installed_plugins.json'))
  const markets = readJson<Record<string, { source?: { source?: string; path?: string } }>>(path.join(pluginsDir, 'known_marketplaces.json')) || {}

  for (const [key, entries] of Object.entries(installed?.plugins || {})) {
    const [name, market] = key.split('@')
    if (name !== 'lanes') continue

    const candidates: string[] = []
    const source = markets[market || '']?.source

    // A folder marketplace runs the plugin straight from that folder.
    if (source?.source === 'directory' && source.path) candidates.push(...marketplaceDirs(source.path, name))
    for (const entry of Array.isArray(entries) ? entries : []) if (entry.installPath) candidates.push(entry.installPath)

    const root = candidates.find(hasScript)
    if (root) return { key, root }
  }

  return null
}

function readSchema(root: string): { version: string | null; schema: LaneOptionSpec[] } {
  const manifest = readJson<{ version?: string; userConfig?: Record<string, Record<string, unknown>> }>(path.join(root, '.claude-plugin', 'plugin.json'))
  const schema: LaneOptionSpec[] = []

  for (const [key, spec] of Object.entries(manifest?.userConfig || {})) {
    const type = spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : 'string'
    const fallback = type === 'number' ? 0 : type === 'boolean' ? false : ''
    const value = spec.default

    schema.push({
      key,
      title: typeof spec.title === 'string' ? spec.title : key,
      description: typeof spec.description === 'string' ? spec.description : '',
      type,
      default: typeof value === typeof fallback ? (value as string | number | boolean) : fallback,
      options: Array.isArray(spec.options) ? spec.options.filter((option): option is string => typeof option === 'string') : undefined
    })
  }

  return { version: typeof manifest?.version === 'string' ? manifest.version : null, schema }
}

type ClaudeSettings = {
  enabledPlugins?: Record<string, boolean>
  pluginConfigs?: Record<string, { options?: Record<string, unknown> } & Record<string, unknown>>
} & Record<string, unknown>

function validOption(spec: LaneOptionSpec, value: unknown): value is string | number | boolean {
  if (spec.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (spec.type === 'boolean') return typeof value === 'boolean'
  if (typeof value !== 'string') return false

  return !spec.options || spec.options.includes(value)
}

export function lanesInfo(): LanesInfo {
  const where = locate()
  const settings = readJson<ClaudeSettings>(settingsFile()) || {}
  const { version, schema } = where ? readSchema(where.root) : { version: null, schema: [] }
  const raw = (where && settings.pluginConfigs?.[where.key]?.options) || {}
  const stored: Record<string, string | number | boolean> = {}
  const effective: Record<string, string | number | boolean> = {}

  for (const spec of schema) {
    const value = raw[spec.key]
    effective[spec.key] = spec.default
    if (validOption(spec, value)) {
      stored[spec.key] = value
      effective[spec.key] = value
    }
  }

  return {
    installed: Boolean(where),
    pluginKey: where?.key || null,
    enabledInClaude: Boolean(where && settings.enabledPlugins?.[where.key]),
    version,
    root: where?.root || null,
    rootLabel: tilde(where?.root || ''),
    settingsLabel: tilde(settingsFile()),
    settingsFile: settingsFile(),
    schema,
    stored,
    effective,
    repo: REPO,
    canHost: isWin || Boolean(where && hasHostSeam(where.root)),
    recommendedRules: [...LANE_ALLOW_RULES]
  }
}

/**
 * Change lane options in Claude Code's settings.json (null removes one, back to
 * the plugin default). Only pluginConfigs[<lanes key>].options is touched.
 */
export function setLaneOptions(patch: Record<string, string | number | boolean | null>): LanesInfo {
  const where = locate()
  if (!where) throw new Error(t('lanes 플러그인이 설치되어 있지 않습니다.'))

  const { schema } = readSchema(where.root)
  const file = settingsFile()
  let text = '{}'

  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // A file we cannot parse is not ours to rewrite.
  const settings = JSON.parse(text.replace(/^\uFEFF/, '')) as ClaudeSettings
  const backup = dataPath('claude-settings.backup.json')

  try {
    // The first backup is the user's original; never overwrite it.
    fs.writeFileSync(backup, text, { encoding: 'utf8', flag: 'wx' })
  } catch {
    // already there
  }

  const configs = (settings.pluginConfigs ||= {})
  const entry = (configs[where.key] ||= {})
  const options: Record<string, unknown> = { ...(entry.options || {}) }

  for (const [key, value] of Object.entries(patch)) {
    const spec = schema.find(item => item.key === key)
    if (!spec) continue
    if (value === null) delete options[key]
    else if (validOption(spec, value)) options[key] = value
  }

  if (Object.keys(options).length) entry.options = options
  else delete entry.options
  if (!Object.keys(entry).length) delete configs[where.key]
  if (!Object.keys(configs).length) delete settings.pluginConfigs

  writeJsonAtomic(file, settings)

  return lanesInfo()
}

// ---------------------------------------------------------------- one project

/** The name lanes gives a project's lanes: folder name plus an FNV-1a tag of the path (as lanes.ps1 / register.ts). */
export function laneSlug(dir: string): string {
  const key = dir.replace(/\\/g, '/').replace(/\/+$/, '').replace(/[A-Z]/g, c => c.toLowerCase())
  let hash = 0x811c9dc5

  for (const byte of Buffer.from(key, 'utf8')) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  const leaf = dir.split(/[\\/]/).filter(Boolean).pop() || ''
  const base = leaf.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'

  return `${base}-${hash.toString(16).padStart(8, '0').slice(0, 4)}`
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface Peer {
  name: string
  pid: number
  status: string
}

/** Claude Code sessions registered on this machine (~/.claude/sessions/<pid>.json). */
function peers(): Peer[] {
  const dir = path.join(claudeHome(), 'sessions')
  const out: Peer[] = []

  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const entry = readJson<{ name?: string; pid?: number; status?: string }>(path.join(dir, file))
      if (entry?.name && typeof entry.pid === 'number' && alive(entry.pid)) out.push({ name: entry.name, pid: entry.pid, status: entry.status || '' })
    }
  } catch {
    // no sessions yet
  }

  return out
}

function lanesDir(project: Project): string {
  return path.join(project.path, '.claude', 'lanes')
}

interface LaneStateFile {
  state?: string
  since?: number
  model?: string
  task?: string
  open?: boolean
  next?: unknown[]
}

interface LedgerEntry {
  lane?: string
  goal?: string
  started?: number
  ended?: number
  verdict?: string
  cost?: number
  onMain?: number
}

type SpendFile = Record<string, { cost?: number; onMain?: number }>

function localDay(time = Date.now()): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function queueLength(slug: string, tier: LaneTier): number {
  const queue = readJson<unknown[]>(path.join(claudeHome(), 'lanes', slug, `${tier}.queue.json`))

  return Array.isArray(queue) ? queue.length : 0
}

function readRole(project: Project, tier: LaneTier): string {
  try {
    return fs.readFileSync(path.join(lanesDir(project), 'roles', `${tier}.md`), 'utf8')
  } catch {
    return ''
  }
}

function allowFile(project: Project): string {
  return path.join(project.path, '.claude', 'settings.local.json')
}

function allowList(project: Project): string[] {
  const settings = readJson<{ permissions?: { allow?: unknown[] } }>(allowFile(project))
  const allow = settings?.permissions?.allow

  return Array.isArray(allow) ? allow.filter((rule): rule is string => typeof rule === 'string') : []
}

export function laneProject(projectId: string): LaneProjectState | null {
  const project = projectById(projectId)
  if (!project) return null

  const slug = laneSlug(project.path)
  const dir = lanesDir(project)
  const live = peers()
  const hosted = tabs?.list().filter(session => session.projectId === project.id && session.lane && !session.dormant) || []
  const info = lanesInfo()
  const lanes: LaneLive[] = []
  const tasks: LaneTask[] = []
  const today = { cost: 0, onMain: 0 }
  const total = { cost: 0, onMain: 0 }
  const day = localDay()

  for (const tier of TIERS) {
    const name = `${slug}-${tier}`
    const peer = live.find(entry => entry.name === name)
    const state = readJson<LaneStateFile>(path.join(dir, 'state', `${tier}.json`)) || {}
    const task = state.open && typeof state.task === 'string' ? state.task : ''
    const openedAt = opening.get(name) || 0
    const tab = hosted.find(session => session.lane === tier)

    if (peer) opening.delete(name)

    lanes.push({
      tier,
      name,
      state: peer ? (state.state === 'busy' || peer.status === 'busy' ? 'busy' : 'idle') : Date.now() - openedAt < OPENING_MS ? 'opening' : 'off',
      pid: peer?.pid || null,
      model: (peer && state.model) || String(info.effective[`${tier}_model`] || ''),
      task: task.split('\n')[0] || '',
      taskId: /^\[([A-Z]\d+[a-z]?)\]/.exec(task)?.[1] || null,
      queued: (Array.isArray(state.next) ? state.next.length : 0) + queueLength(slug, tier),
      since: typeof state.since === 'number' ? state.since : 0,
      sessionId: tab?.id || null
    })

    const ledger = readJson<Record<string, LedgerEntry>>(path.join(dir, 'state', `${tier}.tasks.json`)) || {}

    for (const [id, entry] of Object.entries(ledger)) {
      const report = path.join(dir, 'out', `${id}.md`)
      tasks.push({
        id,
        lane: tier,
        goal: String(entry.goal || '').split('\n')[0] || '',
        verdict: entry.verdict || null,
        started: Number(entry.started) || 0,
        ended: Number(entry.ended) || null,
        cost: Number(entry.cost) || 0,
        onMain: Number(entry.onMain) || 0,
        report: fs.existsSync(report) ? report : null
      })
    }

    const spend = readJson<SpendFile>(path.join(dir, 'state', `${tier}.spend.json`)) || {}

    for (const [key, entry] of Object.entries(spend)) {
      const cost = Number(entry.cost) || 0
      const onMain = Number(entry.onMain) || 0
      total.cost += cost
      total.onMain += onMain
      if (key === day) {
        today.cost += cost
        today.onMain += onMain
      }
    }
  }

  tasks.sort((a, b) => b.started - a.started)
  const allow = allowList(project)
  const rules = getConfig().settings.lanes.allowRules

  return {
    projectId: project.id,
    slug,
    lanes,
    tasks: tasks.slice(0, 30),
    today,
    total,
    roles: { mid: readRole(project, 'mid'), low: readRole(project, 'low') },
    allowApplied: rules.every(rule => allow.includes(rule))
  }
}

// ---------------------------------------------------------------- start / stop

/** A path inside .claude/lanes that is a link turns the lanes off (lanes refuses to write through it). */
function linkedUnder(project: Project): string | null {
  for (const dir of [path.join(project.path, '.claude'), lanesDir(project), path.join(lanesDir(project), 'roles')]) {
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) return dir
    } catch {
      // missing is fine
    }
  }

  return null
}

const psQuote = (value: string) => `'${value.replace(/['\u2018-\u201B]/g, c => c + c)}'`

/** The parameters lanes.ps1 takes, from the effective plugin options. */
function scriptArgs(info: LanesInfo, project: Project, slug: string, launch: 'window' | 'background'): Record<string, string> {
  const option = (key: string) => String(info.effective[key] ?? '')
  const none = (value: string) => value.trim() || 'none'

  return {
    PluginRoot: info.root || '',
    Project: project.path,
    Name: slug,
    Launch: launch,
    PermissionMode: option('permission_mode') || 'auto',
    Style: option('work_style') || 'auto',
    MidModel: option('mid_model'),
    MidFallback: none(option('mid_fallback')),
    MidEffort: option('mid_effort'),
    LowModel: option('low_model'),
    LowFallback: none(option('low_fallback')),
    LowEffort: option('low_effort')
  }
}

function scriptCall(info: LanesInfo, verb: string, which: string, args: Record<string, string>): string {
  const named = Object.entries(args)
    .filter(([, value]) => value)
    .map(([key, value]) => `-${key} ${psQuote(value)}`)
  // Run the script's text as a script block: an execution policy can refuse .ps1 files, not script blocks.
  const script = path.join(info.root || '', 'bin', 'lanes.ps1')

  return `& ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(script)}, [Text.Encoding]::UTF8))) ${psQuote(verb)} ${psQuote(which)} ${named.join(' ')}`
}

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }

  for (const key of CLAUDE_SESSION_MARKERS) delete env[key]
  delete env.ELECTRON_RUN_AS_NODE

  return env
}

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(file, args, { env, windowsHide: true, timeout: 120_000, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 1) : 0

      resolve({ code, out: `${stdout || ''}${stderr || ''}`.trim() })
    })
  })
}

/** What lets lanes.ps1 / lanes.sh reach this HERA: the host switch and the `hera` CLI on PATH. */
function hostEnv(): Record<string, string> {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'

  return { HERA_LANES_HOST: '1', [pathKey]: `${binDir()}${path.delimiter}${process.env[pathKey] || ''}` }
}

/** Run lanes.ps1 / lanes.sh hidden, the way the plugin itself does. */
async function runScript(info: LanesInfo, project: Project, verb: 'start' | 'stop', which: LaneTier | 'all', launch: 'window' | 'background', extra: Record<string, string> = {}) {
  // lanes.sh looks for `claude` on PATH; a Dock / Finder launch needs the login shell's PATH first.
  await hydrateLoginPath()
  const slug = laneSlug(project.path)
  const args = scriptArgs(info, project, slug, launch)

  if (isWin) {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptCall(info, verb, which, args)], cleanEnv(extra))
  }

  return run('/bin/bash', [path.join(info.root || '', 'bin', 'lanes.sh'), verb, which], cleanEnv({
    ...extra,
    LANES_PROJECT: project.path,
    LANES_SLUG: slug,
    LANES_LAUNCH: launch,
    LANES_PERMISSION_MODE: args.PermissionMode,
    LANES_STYLE: args.Style,
    LANES_MID_MODEL: args.MidModel,
    LANES_MID_FALLBACK: args.MidFallback,
    LANES_MID_EFFORT: args.MidEffort,
    LANES_LOW_MODEL: args.LowModel,
    LANES_LOW_FALLBACK: args.LowFallback,
    LANES_LOW_EFFORT: args.LowEffort
  }))
}

/**
 * The script a HERA tab runs to host a lane. lanes.ps1 opens a lane with
 * `Start-Process powershell.exe -Command "<launch>"`; the function below takes
 * that call and runs the launch in this tab, so everything else (role prompt,
 * flags, checks) stays exactly what lanes.ps1 does.
 */
function hostScript(info: LanesInfo, project: Project, tier: LaneTier): string {
  const slug = laneSlug(project.path)

  return [
    `# JYSV HERA: runs the lanes lane ${slug}-${tier} in this tab instead of a new window.`,
    `foreach ($name in @(${[...CLAUDE_SESSION_MARKERS, 'HERA_LANES_HOST'].map(psQuote).join(', ')})) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }`,
    // lanes.ps1 pipes Start-Process into Out-Null: a launch run through that pipeline gets a
    // redirected stdout and claude falls back to --print. Process.Start keeps this tab's console.
    'function Start-Process {',
    '  param([string]$FilePath, [string]$WorkingDirectory, [string]$ArgumentList)',
    '  $info = New-Object System.Diagnostics.ProcessStartInfo $FilePath, $ArgumentList',
    '  $info.UseShellExecute = $false',
    '  if ($WorkingDirectory) { $info.WorkingDirectory = $WorkingDirectory }',
    '  [System.Diagnostics.Process]::Start($info).WaitForExit()',
    '}',
    scriptCall(info, 'start', tier, scriptArgs(info, project, slug, 'window')),
    ''
  ].join('\r\n')
}

function hostInTab(info: LanesInfo, project: Project, tier: LaneTier): SessionInfo | null {
  if (!tabs) return null

  const slug = laneSlug(project.path)
  const file = dataPath('lanes', `${slug}-${tier}.ps1`)

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, hostScript(info, project, tier), 'utf8')

  // Typed into the project's shell, so it has to read the same in PowerShell and cmd.
  const command = `powershell.exe -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(file)}, [Text.Encoding]::UTF8)))"`

  return tabs.open({ projectId: project.id, command, title: `lane · ${tier}`, lane: tier })
}

export interface HostRequest {
  cwd: string
  lane: LaneTier
  /** The lane's run script lanes.ps1 / lanes.sh wrote (<project>/.claude/lanes/state/<tier>.run.ps1|.command). */
  run: string
  env?: Record<string, string>
  /** Only say whether HERA would host it. */
  check?: boolean
}

/**
 * The lanes plugin asks for a tab (`hera host --lane`) instead of opening a window.
 * Only for a project registered in HERA and while HERA hosts lanes; the plugin opens
 * its own window when this refuses.
 */
export function hostLane(req: HostRequest): { id: string | null; name: string; project: string } {
  const settings = getConfig().settings.lanes
  if (!settings.enabled || settings.host !== 'hera') throw new Error(t('HERA 가 lanes 를 탭으로 열지 않도록 설정되어 있습니다.'))
  if (!tabs) throw new Error(t('HERA 창이 아직 준비되지 않았습니다.'))

  const cwd = path.resolve(req.cwd || '')
  const project = req.cwd ? projectForPath(cwd) : null
  if (!project) throw new Error(t('HERA 에 등록된 프로젝트가 아닙니다: {cwd}', { cwd }))

  const run = path.resolve(req.run || '')
  const expected = path.join(cwd, '.claude', 'lanes', 'state', `${req.lane}.run.${isWin ? 'ps1' : 'command'}`)
  const same = isWin ? run.toLowerCase() === expected.toLowerCase() : run === expected
  if (!req.check && (!same || !fs.existsSync(run))) throw new Error(t('lane 실행 파일이 아닙니다: {run}', { run }))

  const name = `${laneSlug(cwd)}-${req.lane}`
  if (req.check) return { id: null, name, project: project.name }

  // A lane that closed leaves its tab behind; the new one takes its place.
  for (const session of tabs.list()) {
    if (session.lane === req.lane && session.projectId === project.id && (session.status === 'exited' || session.dormant)) tabs.close(session.id)
  }

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.env || {})) if (HOST_PASSED_ENV.test(key) && typeof value === 'string') env[key] = value

  // Typed into the project's shell, so it has to read the same in PowerShell, cmd and POSIX shells.
  const command = isWin ? `powershell.exe -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(run)}, [Text.Encoding]::UTF8)))"` : `/bin/bash '${run.replace(/'/g, `'\\''`)}'`
  const info = tabs.open({ projectId: project.id, cwd, command, title: `lane · ${req.lane}`, lane: req.lane, env })
  opening.set(name, Date.now())

  return { id: info.id, name, project: project.name }
}

function applyAllowFor(project: Project, rules: string[]): number {
  const file = allowFile(project)
  const settings = readJson<Record<string, unknown> & { permissions?: { allow?: unknown[] } & Record<string, unknown> }>(file) || {}
  const permissions = (settings.permissions ||= {})
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule): rule is string => typeof rule === 'string') : []
  const added = rules.filter(rule => !allow.includes(rule))

  if (!added.length) return 0
  permissions.allow = [...allow, ...added]
  writeJsonAtomic(file, settings)

  return added.length
}

/** Add the lane allow rules to a project's .claude/settings.local.json (for dontAsk lanes). */
export function applyLaneAllowlist(projectId: string): { added: number; file: string } {
  const project = projectById(projectId)
  if (!project) throw new Error(t('프로젝트를 찾을 수 없습니다.'))

  return { added: applyAllowFor(project, getConfig().settings.lanes.allowRules), file: allowFile(project) }
}

export async function startLanes(projectId: string, which: LaneTier | 'all'): Promise<{ ok: boolean; message: string }> {
  const project = projectById(projectId)
  const info = lanesInfo()
  const settings = getConfig().settings.lanes

  if (!project) return { ok: false, message: t('프로젝트를 찾을 수 없습니다.') }
  if (!info.installed) return { ok: false, message: t('lanes 플러그인이 설치되어 있지 않습니다.') }

  const linked = linkedUnder(project)
  if (linked) return { ok: false, message: t('{linked} 가 링크라서 lanes 가 이 프로젝트에서 꺼져 있습니다.', { linked }) }

  // dontAsk denies every call that is not allowed in advance; in auto mode HERA adds what a lane needs.
  if (info.effective.permission_mode === 'dontAsk' && settings.mode === 'auto') applyAllowFor(project, settings.allowRules)

  const slug = laneSlug(project.path)
  const state = laneProject(projectId)
  const tiers = (which === 'all' ? TIERS : [which]).filter(tier => {
    const lane = state?.lanes.find(entry => entry.tier === tier)
    return !lane || lane.state === 'off'
  })

  if (!tiers.length) return { ok: true, message: t('이미 열려 있습니다.') }

  const scope = tiers.length === 2 ? 'all' : tiers[0]

  // lanes asks HERA for its tabs itself (`hera host`), the same way a lane the main session opens does.
  if (settings.host === 'hera' && info.root && hasHostSeam(info.root)) {
    const result = await runScript(info, project, 'start', scope, 'window', hostEnv())
    const untrusted = /Workspace not trusted/i.test(result.out)

    if (result.code === 0 && !untrusted) for (const tier of tiers) opening.set(`${slug}-${tier}`, Date.now())

    const failure = result.out.split('\n').filter(Boolean).slice(-2).join(' ') || `exit ${result.code}`

    return {
      ok: result.code === 0 && !untrusted,
      message: untrusted
        ? t('이 폴더를 Claude Code 가 아직 신뢰하지 않습니다. 이 프로젝트에서 claude 를 한 번 열어 신뢰를 허용한 뒤 다시 시도하세요.')
        : result.code === 0
          ? t('{tiers} lane 을 HERA 탭에서 엽니다.', { tiers: tiers.join(', ') })
          : t('lane 을 열지 못했습니다: {reason}', { reason: failure })
    }
  }

  if (settings.host === 'hera' && isWin) {
    for (const tier of tiers) {
      hostInTab(info, project, tier)
      opening.set(`${slug}-${tier}`, Date.now())
    }

    return { ok: true, message: t('{tiers} lane 을 HERA 탭에서 엽니다.', { tiers: tiers.join(', ') }) }
  }

  const result = await runScript(info, project, 'start', scope, 'window')
  // claude refuses an untrusted folder but lanes.ps1 still exits 0.
  const untrusted = /Workspace not trusted/i.test(result.out)

  if (result.code === 0 && !untrusted) for (const tier of tiers) opening.set(`${slug}-${tier}`, Date.now())

  return {
    ok: result.code === 0 && !untrusted,
    message: untrusted ? t('이 폴더를 Claude Code 가 아직 신뢰하지 않습니다. 이 프로젝트에서 claude 를 한 번 열어 신뢰를 허용한 뒤 다시 시도하세요.') : result.out || `exit ${result.code}`
  }
}

export async function stopLanes(projectId: string, which: LaneTier | 'all'): Promise<{ ok: boolean; message: string }> {
  const project = projectById(projectId)
  const info = lanesInfo()

  if (!project || !info.installed) return { ok: false, message: t('lanes 를 찾을 수 없습니다.') }

  const result = await runScript(info, project, 'stop', which, 'window')
  const slug = laneSlug(project.path)

  for (const tier of which === 'all' ? TIERS : [which]) {
    opening.delete(`${slug}-${tier}`)
    for (const session of tabs?.list() || []) {
      if (session.projectId === project.id && session.lane === tier) tabs?.close(session.id)
    }
  }

  return { ok: result.code === 0, message: result.out || `exit ${result.code}` }
}

/** Save a project's instructions for one lane (.claude/lanes/roles/<tier>.md, read when the lane starts). */
export function saveLaneRole(projectId: string, tier: LaneTier, text: string): void {
  const project = projectById(projectId)
  if (!project) throw new Error(t('프로젝트를 찾을 수 없습니다.'))
  if (linkedUnder(project)) throw new Error(t('.claude/lanes 경로에 링크가 있어 쓸 수 없습니다.'))

  const file = path.join(lanesDir(project), 'roles', `${tier}.md`)

  if (!text.trim()) {
    fs.rmSync(file, { force: true })
    return
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8')
}

/** Extra Claude flags for a main session HERA starts (what lanes' claude-main does). */
export function laneMainArgs(quote: (value: string) => string): string | null {
  const settings = getConfig().settings.lanes
  if (!settings.enabled || !settings.applyMain) return null

  const info = lanesInfo()
  if (!info.installed || !info.enabledInClaude) return null

  const model = String(info.effective.main_model || '').trim()
  const fallback = String(info.effective.main_fallback || '').trim()
  const effort = String(info.effective.main_effort || '').trim()
  const parts: string[] = []

  if (model) parts.push('--model', quote(model))
  if (fallback && fallback !== model) parts.push('--fallback-model', quote(fallback))
  if (effort) parts.push('--effort', quote(effort))

  return parts.length ? parts.join(' ') : null
}
