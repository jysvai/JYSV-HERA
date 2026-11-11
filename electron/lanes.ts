// lanes integration. The lanes Claude Code plugin (https://github.com/jysvai/lanes)
// runs a mid and a low "lane" beside a main Claude session. HERA finds the
// plugin, edits its options in Claude Code's settings.json, hosts in a HERA tab
// a lane the main session opens (`hera host --lane`), stops lane sessions and
// shows what lanes do from the files they keep under <project>/.claude/lanes.
// HERA never opens a lane itself: main opens one when it hands work over, and an
// inline lane is a teammate inside main's own session that nothing else can start.
// The plugin itself is not changed.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { LANE_ALLOW_RULES } from '../shared/defaults'
import { t } from '../shared/i18n'
import type { CreateSessionRequest, LaneLive, LaneOptionSpec, LaneProjectState, LanesInfo, LaneTask, LaneTier, Project, SessionInfo } from '../shared/types'
import { HOST_PASSED_ENV } from '../shared/util'

import { dataPath, hydrateLoginPath, isWin, readJson, writeJsonAtomic } from './paths'
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
type Notice = (text: string) => void

let tabs: { open: OpenTab; list: ListTabs; close: CloseTab; notice: Notice } | null = null

/** main.ts hands over how to open, list and close HERA tabs, and how to show a notice in the window. */
export function setLaneTabs(open: OpenTab, list: ListTabs, close: CloseTab, notice: Notice) {
  tabs = { open, list, close, notice }
}

let lastRefusal = { text: '', at: 0 }

/** The plugin opens its own window when HERA says no, silently: say why in HERA, once for both lanes. */
function refuse(reason: string, hint: string): never {
  const text = t('lane 을 HERA 탭 대신 별도 창으로 엽니다: {reason}. {hint}', { reason, hint })

  if (text !== lastRefusal.text || Date.now() - lastRefusal.at > 30_000) tabs?.notice(text)
  lastRefusal = { text, at: Date.now() }

  throw new Error(reason)
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
  env?: Record<string, unknown>
} & Record<string, unknown>

/** An env switch as lanes reads one (register.ts isOn). */
const isOn = (value: unknown) => typeof value === 'string' && /^(1|true|yes)$/i.test(value.trim())

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

  // A session has a team only when agent teams were on as it started; settings.json env reaches every Claude.
  const agentTeams = isOn(settings.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) || isOn(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)

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
    // Only lanes itself can ask for a tab now (HERA starts no lanes), so that takes lanes 0.3.13+ on every OS.
    canHost: Boolean(where && hasHostSeam(where.root)),
    hostSeam: Boolean(where && hasHostSeam(where.root)),
    agentTeams,
    inline: effective.launch === 'inline' && agentTeams,
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
  sessionId: string
}

/** Live Claude Code sessions registered on this machine (~/.claude/sessions/<pid>.json). */
function peers(): Peer[] {
  const dir = path.join(claudeHome(), 'sessions')
  const out: Peer[] = []

  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const entry = readJson<{ name?: string; pid?: number; status?: string; sessionId?: string }>(path.join(dir, file))
      if (!entry || typeof entry.pid !== 'number' || !alive(entry.pid)) continue
      out.push({ name: entry.name || '', pid: entry.pid, status: entry.status || '', sessionId: entry.sessionId || '' })
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
  /** An inline lane: the main session whose teammate it is. */
  lead?: string
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
    // An inline lane is no session of its own: it lives while its state is on and the main session that leads it runs
    // (as lanes' leadElsewhere sees it from another session).
    const lead = !peer && state.lead && state.state !== 'off' ? live.find(entry => entry.sessionId === state.lead) : undefined
    const task = state.open && typeof state.task === 'string' ? state.task : ''
    const openedAt = opening.get(name) || 0
    const tab = hosted.find(session => session.lane === tier)

    if (peer) opening.delete(name)

    lanes.push({
      tier,
      name,
      state: peer
        ? state.state === 'busy' || peer.status === 'busy'
          ? 'busy'
          : 'idle'
        : lead
          ? state.state === 'busy'
            ? 'busy'
            : 'idle'
          : Date.now() - openedAt < OPENING_MS
            ? 'opening'
            : 'off',
      pid: peer?.pid || null,
      model: ((peer || lead) && state.model) || String(info.effective[`${tier}_model`] || ''),
      task: task.split('\n')[0] || '',
      taskId: /^\[([A-Z]\d+[a-z]?)\]/.exec(task)?.[1] || null,
      queued: (Array.isArray(state.next) ? state.next.length : 0) + queueLength(slug, tier),
      since: typeof state.since === 'number' ? state.since : 0,
      sessionId: tab?.id || null,
      teammate: Boolean(lead)
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

// ---------------------------------------------------------------- stop and host

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

/** Run lanes.ps1 / lanes.sh hidden, the way the plugin itself does (only `stop`: HERA opens no lanes). */
async function runScript(info: LanesInfo, project: Project, verb: 'stop', which: LaneTier | 'all') {
  // lanes.sh looks for `claude` on PATH; a Dock / Finder launch needs the login shell's PATH first.
  await hydrateLoginPath()
  const slug = laneSlug(project.path)
  // The launch only shapes how a lane starts; stopping is the same for every launch.
  const args = scriptArgs(info, project, slug, 'window')

  if (isWin) {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptCall(info, verb, which, args)], cleanEnv())
  }

  return run('/bin/bash', [path.join(info.root || '', 'bin', 'lanes.sh'), verb, which], cleanEnv({
    LANES_PROJECT: project.path,
    LANES_SLUG: slug,
    LANES_LAUNCH: 'window',
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
  // Not tied to "Use lanes in HERA" (off on a fresh install): only the launch choice says no.
  if (settings.host !== 'hera') throw new Error(t('HERA 가 lanes 를 탭으로 열지 않도록 설정되어 있습니다.'))
  if (!tabs) throw new Error(t('HERA 창이 아직 준비되지 않았습니다.'))

  const cwd = path.resolve(req.cwd || '')
  const project = req.cwd ? projectForPath(cwd) : null
  if (!project) refuse(t('HERA 에 등록된 프로젝트가 아닙니다: {cwd}', { cwd }), t('이 폴더를 프로젝트로 추가하면 다음부터 탭으로 열립니다.'))

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
  const parsed = readJson<Record<string, unknown> & { permissions?: { allow?: unknown[] } & Record<string, unknown> }>(file)
  // A settings file that does not parse is the user's to fix, not ours to replace.
  if (!parsed && fs.existsSync(file)) throw new Error(t('{file} 을 읽지 못해 허용 규칙을 넣지 않았습니다.', { file }))
  const settings = parsed || {}
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

/**
 * Auto mode with dontAsk lanes: add the lane allow rules before HERA starts a main Claude in the
 * project, so the lanes it opens (or its inline teammates) start with them. HERA opens no lane
 * itself any more, so this is where auto mode applies the list.
 */
export function autoLaneAllowlist(projectId: string): void {
  const settings = getConfig().settings.lanes
  if (!settings.enabled || settings.mode !== 'auto') return

  const project = projectById(projectId)
  const info = lanesInfo()
  if (!project || !info.installed || !info.enabledInClaude || info.effective.permission_mode !== 'dontAsk' || linkedUnder(project)) return

  applyAllowFor(project, settings.allowRules)
}

/**
 * Stop lane sessions (window / background). An inline lane is a teammate in main's own
 * process: nothing outside that session can stop it, so that is left to `/lane stop` there.
 */
export async function stopLanes(projectId: string, which: LaneTier | 'all'): Promise<{ ok: boolean; message: string }> {
  const project = projectById(projectId)
  const info = lanesInfo()

  if (!project || !info.installed) return { ok: false, message: t('lanes 를 찾을 수 없습니다.') }

  const teammates = new Set(laneProject(projectId)?.lanes.filter(lane => lane.teammate).map(lane => lane.tier))
  const tiers = (which === 'all' ? TIERS : [which]).filter(tier => !teammates.has(tier))
  const inlineNote = t('inline lane 은 메인 Claude 의 팀원이라 HERA 에서 닫을 수 없습니다. 메인 Claude 에서 /lane stop 으로 닫으세요.')

  if (!tiers.length) return { ok: false, message: inlineNote }

  const result = await runScript(info, project, 'stop', tiers.length === TIERS.length ? 'all' : tiers[0])
  const slug = laneSlug(project.path)

  for (const tier of tiers) {
    opening.delete(`${slug}-${tier}`)
    for (const session of tabs?.list() || []) {
      if (session.projectId === project.id && session.lane === tier) tabs?.close(session.id)
    }
  }

  const message = result.out || `exit ${result.code}`

  return { ok: result.code === 0, message: teammates.size ? [message, inlineNote].join('\n') : message }
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
