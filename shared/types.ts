// Shared contract between the Electron main process, the renderer and the
// `hera` CLI. Keep this file dependency-free: it is bundled into all three.

import type { ThemeDef } from './themes'

export type Platform = 'win32' | 'darwin' | 'linux'

export interface Shortcut {
  name: string
  command: string
  description?: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  createdAt: number
}

export interface Project {
  id: string
  name: string
  path: string
  color?: string
  /** Shell override for this project ('auto' or a key from ShellKind / an absolute path). */
  shell?: string
  notes: string
  todos: TodoItem[]
  /** Per-project quick commands, shown as buttons and in the palette. */
  commands: Shortcut[]
  pinned: boolean
  createdAt: number
  tags?: string[]
}

export type UsageProvider = 'claude' | 'codex' | 'agy'

export interface AgentDef {
  id: string
  name: string
  /** Command line typed into the shell to start the agent. */
  command: string
  /** Extra args appended when resuming the most recent conversation. */
  continueArgs?: string
  /** Start a conversation with an id HERA picks (`--session-id {id}`), so it can be resumed exactly. */
  sessionIdArgs?: string
  /** Resume one specific conversation (`--resume {id}`, `resume {id}`). */
  resumeIdArgs?: string
  color: string
  builtin?: boolean
  enabled: boolean
  /** Env var that points the CLI at an alternate config/auth dir (account profiles). */
  profileEnv?: string
  /** Default config dir (supports ~). */
  defaultConfigDir?: string
  /** Flag that appends a system prompt (used to brief a team's main agent). */
  systemPromptFlag?: string
  /** Regex (case-insensitive) that means "working" when visible near the bottom of the screen. */
  busyPattern?: string
  /** Regex that means "waiting for the user's approval/answer". */
  approvalPattern?: string
  /** Builtin agents only: the user edited the patterns, so keep them over the shipped preset. */
  customPatterns?: boolean
  /** Regex that identifies this agent's TUI on screen (auto-detection). */
  signature?: string
  usageProvider?: UsageProvider
  loginCommand?: string
  installHint?: string
  homepage?: string
}

export interface AccountProfile {
  id: string
  agentId: string
  label: string
  /** null = the CLI's default config dir. */
  configDir: string | null
}

export interface TeamPane {
  agentId: string
  role: 'main' | 'helper'
  profileId?: string
}

export interface TeamPreset {
  id: string
  name: string
  panes: TeamPane[]
  /** Brief the main agent about its helpers and the hera protocol. */
  brief: boolean
}

export type ShellKind = 'auto' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'gitbash'

export interface Settings {
  defaultShell: string
  loadShellProfile: boolean
  fontFamily: string
  fontSize: number
  lineHeight: number
  scrollback: number
  /** WebGL renderer for visible terminals (faster under heavy output, costs GPU memory). */
  gpu: boolean
  /** Windows: the ConPTY that ships with HERA (as Windows Terminal does) instead of the system one. */
  conptyDll: boolean
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
  /** Fewer Chromium processes + aggressive trimming. Applies on restart. */
  lowMemory: boolean
  /** Destroy the window after it has been hidden this many minutes (0 = never). */
  deepSleepMinutes: number
  hotkey: string
  closeToTray: boolean
  startHidden: boolean
  notifyOnDone: boolean
  notifyOnApproval: boolean
  theme: 'dark' | 'light' | 'system'
  /** Theme ids used in dark / light mode (presets or customThemes). */
  darkTheme: string
  lightTheme: string
  /** Global accent override; '' = the theme's own accent. */
  accent: string
  customThemes: ThemeDef[]
  /** Stronger secondary text and hairlines. */
  highContrast: boolean
  /** Start HERA when the user logs in (installed builds only). */
  launchAtLogin: boolean
  /** After a restart/reboot: bring terminals back running ('resume') or only show their last screen ('manual'). */
  restoreMode: 'resume' | 'manual'
  externalTerminal: 'auto' | 'wt' | 'conhost' | 'terminal' | 'iterm'
  /** Integration with the lanes Claude Code plugin. */
  lanes: LanesSettings
  /** Ask GitHub for a newer release (HERA's only network request). */
  checkUpdates: boolean
  /** Monthly budget hints for the usage page (tokens, 0 = off). */
  usageWarnPercent: number
  language: 'ko' | 'en'
}

/** What HERA can take over from the terminal used before it (Windows Terminal's default profile). */
export interface TerminalImport {
  source: string
  profile: string
  fontFace?: string
  /** CSS pixels. */
  fontSize?: number
  cursorStyle?: 'bar' | 'block' | 'underline'
  scrollback?: number
  /** A HERA shell setting: a kind ('pwsh', 'gitbash') or a command line ('wsl.exe -d Ubuntu'). */
  shell?: string
  shellLabel?: string
  scheme?: { name: string; background: string; foreground: string; cursor?: string; ansi: import('./themes').AnsiPalette }
}

export interface UpdateInfo {
  current: string
  /** Latest published release (x.y.z), null when unknown. */
  latest: string | null
  newer: boolean
  /** Release page to open. */
  url: string
  publishedAt?: number
  /** 0 = never checked. */
  checkedAt: number
  /** The last attempt failed (the rest is the previous good answer). */
  error?: string
}

export interface HeraConfig {
  version: 1
  projects: Project[]
  agents: AgentDef[]
  shortcuts: Shortcut[]
  profiles: AccountProfile[]
  teams: TeamPreset[]
  settings: Settings
}

export type SessionStatus = 'starting' | 'idle' | 'busy' | 'waiting' | 'exited'

export interface SessionInfo {
  id: string
  /** Short, human/agent-friendly handle, e.g. "claude-1". */
  name: string
  title: string
  projectId: string | null
  cwd: string
  shell: string
  pid: number
  /** Agent the session was launched with. */
  agentId: string | null
  /** Agent currently detected on screen (may differ, e.g. user typed `codex`). */
  activeAgentId: string | null
  role: 'main' | 'helper' | null
  profileId: string | null
  status: SessionStatus
  createdAt: number
  lastOutputAt: number
  lastStatusChangeAt: number
  exitCode: number | null
  cols: number
  rows: number
  /** Dormant = restored from a previous run, not yet re-spawned. */
  dormant?: boolean
  /** A lanes lane HERA hosts in this tab. */
  lane?: LaneTier | null
}

export interface CreateSessionRequest {
  projectId?: string | null
  cwd?: string
  agentId?: string | null
  /** Raw command to type once the shell is ready (overrides agent command). */
  command?: string
  /** Append the agent's continueArgs. */
  resume?: boolean
  profileId?: string | null
  role?: 'main' | 'helper' | null
  title?: string
  cols?: number
  rows?: number
  /** Extra text appended to the agent command (e.g. a system prompt flag). */
  extraArgs?: string
  /** The tab hosts this lanes lane. */
  lane?: LaneTier | null
  /** Extra environment for the shell (the config dir and provider of the session that asked for it). */
  env?: Record<string, string>
  /** Session this one was spawned from (team / hera spawn). */
  parentId?: string | null
}

export interface BusMessage {
  id: string
  t: number
  kind: 'send' | 'reply' | 'key' | 'spawn' | 'system'
  from: string | null
  fromName: string
  to: string
  toName: string
  text: string
  file?: string
  projectId: string | null
}

export interface LaunchRecord {
  t: number
  projectId: string
  label: string
  agentId: string | null
}

export interface GitInfo {
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  lastCommit: { hash: string; subject: string; author: string; when: number } | null
  changed: number
  changedSample: { status: string; path: string }[]
}

export interface AgentActivity {
  agentId: string
  lastAt: number
  lastPrompt: string | null
  sessions: number
  sessionId?: string | null
}

export interface ProjectInsight {
  projectId: string
  exists: boolean
  git: GitInfo | null
  recentFiles: { path: string; mtime: number }[]
  activity: AgentActivity[]
  launches: LaunchRecord[]
  lastLaunch: LaunchRecord | null
  computedAt: number
}

export interface RateWindow {
  label: string
  usedPercent: number
  resetsAt: number | null
  windowMinutes: number | null
}

export interface UsageBucket {
  /** Local date YYYY-MM-DD. */
  day: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  messages: number
  costUsd: number
}

export interface ProjectUsageEntry {
  projectId: string
  today: UsageBucket
  last7: UsageBucket
  last30: UsageBucket
}

export interface AgentUsage {
  agentId: string
  provider: UsageProvider
  available: boolean
  note?: string
  today: UsageBucket
  last7: UsageBucket
  last30: UsageBucket
  daily: UsageBucket[]
  byModel: { model: string; tokens: number; costUsd: number }[]
  byProject: { path: string; tokens: number; costUsd: number }[]
  /** Registered projects (their folder and subfolders): today / last 7 / last 30 days. */
  projects: ProjectUsageEntry[]
  /** Last 30 days spent in folders that are not registered projects. */
  unassigned30: UsageBucket
  /** Rolling 5h window consumption from local logs. */
  window5h: { tokens: number; messages: number; startedAt: number | null }
  limits: RateWindow[]
  limitsSource?: string
  updatedAt: number
}

export interface AccountStatus {
  profileId: string
  agentId: string
  label: string
  configDir: string
  exists: boolean
  loggedIn: boolean | null
  method?: string
  email?: string | null
  plan?: string | null
  expiresAt?: number | null
  lastRefresh?: number | null
  detail?: string
}

export interface AgentAvailability {
  agentId: string
  installed: boolean
  path: string | null
}

export interface AppMetrics {
  /** Sum of working set across HERA's own processes (KB). */
  totalKB: number
  processes: { type: string; kb: number; cpu: number }[]
  ptyCount: number
}

export interface HistoryHit {
  agentId: string
  t: number
  text: string
  project: string | null
}

// ---- hera CLI <-> app wire protocol (JSON lines over a named pipe / unix socket)

export interface WireRequest {
  id: number
  token: string
  method: string
  /** HERA_SESSION_ID of the calling shell, when the CLI runs inside HERA. */
  caller?: string | null
  params?: Record<string, unknown>
}

export interface WireResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

// ---------------------------------------------------------------- lanes

/** A lane of the lanes plugin: mid (judgement work) or low (search, scripts). */
export type LaneTier = 'mid' | 'low'

export interface LanesSettings {
  /** HERA-side integration switch (needs the lanes plugin installed). */
  enabled: boolean
  /** auto: lanes' recommended options and HERA-chosen launch and permissions. custom: every option editable. */
  mode: 'auto' | 'custom'
  /** Where a lane HERA starts opens: a HERA tab or its own window. */
  host: 'hera' | 'window'
  /** Start both lanes when HERA opens Claude in a project. */
  autoStart: boolean
  /** Start HERA's Claude with the lanes main model, fallback and effort. */
  applyMain: boolean
  /** Allow rules for lanes in dontAsk mode (written to a project's .claude/settings.local.json). */
  allowRules: string[]
}

/** One option from the plugin's userConfig. */
export interface LaneOptionSpec {
  key: string
  title: string
  description: string
  type: 'string' | 'number' | 'boolean'
  default: string | number | boolean
  options?: string[]
}

export interface LanesInfo {
  installed: boolean
  /** Key in Claude Code's plugin registry, e.g. lanes@claude-mod. */
  pluginKey: string | null
  enabledInClaude: boolean
  version: string | null
  root: string | null
  /** root and settingsFile with the home folder shown as ~. */
  rootLabel: string
  settingsLabel: string
  /** Claude Code settings file that holds the options. */
  settingsFile: string
  schema: LaneOptionSpec[]
  /** Options the user set (missing = plugin default). */
  stored: Record<string, string | number | boolean>
  /** Defaults overlaid with the stored options. */
  effective: Record<string, string | number | boolean>
  repo: string
  /** HERA can host lanes in its own tabs on this platform. */
  canHost: boolean
  recommendedRules: string[]
}

export interface LaneLive {
  tier: LaneTier
  name: string
  state: 'off' | 'opening' | 'idle' | 'busy'
  pid: number | null
  model: string
  /** Current task text ("[T7] ..."), '' when none. */
  task: string
  taskId: string | null
  queued: number
  since: number
  /** HERA tab hosting the lane, if any. */
  sessionId: string | null
}

export interface LaneTask {
  id: string
  lane: LaneTier
  goal: string
  verdict: string | null
  started: number
  ended: number | null
  cost: number
  onMain: number
  report: string | null
}

export interface LaneProjectState {
  projectId: string
  slug: string
  lanes: LaneLive[]
  tasks: LaneTask[]
  today: { cost: number; onMain: number }
  total: { cost: number; onMain: number }
  /** Project instructions appended to each lane's role (.claude/lanes/roles/<tier>.md). */
  roles: Record<LaneTier, string>
  /** Every allow rule is already in the project's settings.local.json. */
  allowApplied: boolean
}
