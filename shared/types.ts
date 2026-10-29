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
  /** Session the item was handed to from the backlog. */
  sessionId?: string | null
  startedAt?: number
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
  /** Runs in a terminal tab of every new worktree (`npm install`, say). Stored here, never read from the repository. */
  worktreeSetup?: string
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

export interface WorkAgent {
  agentId: string
  profileId?: string | null
}

/** Multi-agent work started from the window (backlog item, typed request, or an open session). */
export interface StartWorkRequest {
  projectId: string
  /** What to do. Empty: brief an open lead to hand off parts of what it is already doing. */
  task?: string
  /** Open session that leads (keeps its conversation). */
  leadId?: string | null
  /** Agent for a new lead when `leadId` is not given. */
  lead?: WorkAgent | null
  /** Helpers. An open session of the same agent in the project is reused. */
  helpers?: WorkAgent[]
  teamName?: string | null
  /** New helpers work in worktrees of their own (git projects only). */
  isolate?: boolean
}

/** The same task for several agents, each in a worktree of its own, to compare and keep one. */
export interface StartRaceRequest {
  projectId: string
  task: string
  /** 2–4 agents (the same agent twice is fine). */
  agents: WorkAgent[]
}

/**
 * An isolated copy of a project: a git worktree on a `hera/…` branch, outside the project
 * folder. HERA only ever deletes worktrees and branches it made itself.
 */
export interface WorktreeInfo {
  id: string
  projectId: string
  /** What the user (or HERA) called it; the folder and branch use a cleaned-up form. */
  label: string
  name: string
  branch: string
  /** Root of the worktree. */
  path: string
  /** Where the project's folder is inside the worktree (the root, or a subfolder for a project inside a bigger repo). */
  cwd: string
  /** Branch the project folder was on when the copy was made (null on a detached HEAD). */
  baseBranch: string | null
  /** Commit the copy started from: changes are counted against it. */
  baseSha: string
  createdAt: number
  /** Copies of one comparison share this id. */
  raceId?: string | null
  /** The task of a comparison or of a helper. */
  task?: string | null
  agentId?: string | null
  /** Set once HERA merged it into the project folder. */
  mergedAt?: number | null
  /** The copy's tip at that merge: changes and commits are counted from here on, so work done after a merge is never taken for merged. */
  mergedSha?: string | null
  /** The repository's top folder, to clean up after the project is gone. */
  repoRoot?: string
}

/** What deleting a copy would lose. */
export interface WorktreeLoss {
  uncommitted: number
  /** Commits on its branch the project never got (counted in the repository, so also when the folder is gone). */
  unmergedCommits: number
  /** git could not tell (an error, or the repository is gone): treat it as "something may be lost". */
  unknown: boolean
}

export interface WorktreeStatus {
  id: string
  exists: boolean
  /** Files not yet in the project: changed since the start or the last merge (committed or not, new files included). */
  files: number
  added: number
  deleted: number
  /** Not yet committed in the copy. */
  uncommitted: number
  /** Commits on the copy's branch since the start or the last merge. */
  commits: number
  error?: string
}

/** Whether a project can get worktrees, and what the user should know first. */
export interface WorktreeSupport {
  ok: boolean
  /** Why not (no git, not a repo, no commits yet, WSL shell). */
  reason?: string
  /** The project is a folder without git: HERA can make it a repository. */
  canInit?: boolean
  branch: string | null
  head: string | null
  /** Uncommitted files in the project folder (not carried into a new copy). */
  dirty: number
}

export interface WorktreeFileDiff {
  path: string
  /** A added, M modified, D deleted, R renamed, ? new and not yet added. */
  status: string
  added: number
  deleted: number
  binary: boolean
  /** Unified diff hunks ('' for binary files). */
  patch: string
}

export interface WorktreeDiff {
  files: WorktreeFileDiff[]
  /** The diff was cut to keep the window responsive. */
  truncated: boolean
}

export interface WorktreeActionResult {
  ok: boolean
  message?: string
  /** Files that conflicted (the merge was undone). */
  conflicts?: string[]
  /** Removing needs the user's confirmation: this much would be lost. */
  confirm?: WorktreeLoss
}

export interface StartWorkResult {
  lead: SessionInfo
  helpers: SessionInfo[]
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
  /** Start Codex tabs with `--no-daemon`, so a stale shared Codex daemon cannot sign them out. */
  codexOwnServer: boolean
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
  /** UI language; 'auto' follows the OS (Korean on a Korean system, English elsewhere). */
  uiLanguage: 'auto' | 'ko' | 'en'
  /** Multi-agent work: new helpers get worktrees of their own. */
  isolateHelpers: boolean
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
  /** HERA can download and install the newer release itself (installed builds). */
  installable?: boolean
  /** The in-app update, once the user started it. */
  progress?: UpdateProgress | null
}

/** One entry of a project folder (right panel → 폴더). */
export interface DirEntry {
  name: string
  dir: boolean
  /** Bytes, 0 for folders. */
  size: number
  hidden: boolean
  link?: boolean
}

export interface DirListing {
  entries: DirEntry[]
  /** The folder had more entries than HERA lists. */
  truncated: boolean
  error?: string
}

/** An installed CLI tool or global package HERA can update (Agents → Extensions & updates). */
export interface ToolPackage {
  /** Update id passed back to `tools:update`. */
  id: string
  manager: 'npm' | 'brew' | 'uv' | 'pipx' | 'self'
  name: string
  /** The HERA agent this package provides. */
  agentId?: string
  current?: string
  /** Unknown when the manager has no cheap way to ask (uv, pipx, a CLI's own updater). */
  latest?: string
  outdated: boolean
  /** What the update runs, shown before running it. */
  command: string
}

export interface ExtensionItem {
  name: string
  detail?: string
  version?: string
  enabled?: boolean
  scope?: 'user' | 'project' | 'local'
  /** Set when HERA can update this one item. */
  updateId?: string
  command?: string
}

export interface ExtensionGroup {
  kind: 'plugins' | 'mcp' | 'skills' | 'extensions'
  /** Where it was read from (home shortened to ~). */
  source: string
  items: ExtensionItem[]
  /** Set when one command updates the whole group. */
  updateId?: string
  command?: string
}

/** What one AI CLI has plugged in, read from its own config files. */
export interface CliExtensions {
  id: string
  name: string
  agentId?: string
  groups: ExtensionGroup[]
}

export interface ToolPackages {
  packages: ToolPackage[]
  checkedAt: number
  /** A package manager that could not be asked (offline, say). */
  errors: string[]
}

export interface UpdateProgress {
  phase: 'downloading' | 'ready' | 'installing' | 'error'
  /** Bytes so far / in total (0 when unknown). */
  received: number
  total: number
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
  /** The worktree the session works in. */
  worktreeId?: string | null
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
  /** Run in this worktree of the project (its folder becomes the cwd). */
  worktreeId?: string | null
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
