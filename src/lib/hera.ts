import type {
  StartRaceRequest,
  WorktreeActionResult,
  WorktreeDiff,
  WorktreeInfo,
  WorktreeStatus,
  WorktreeSupport,
  AccountProfile,
  AccountStatus,
  AgentAvailability,
  AgentUsage,
  AppMetrics,
  BusMessage,
  CliExtensions,
  CreateSessionRequest,
  DirListing,
  HeraConfig,
  HistoryHit,
  LaneProjectState,
  LanesInfo,
  LaneTier,
  Project,
  ProjectInsight,
  SessionInfo,
  StartWorkRequest,
  StartWorkResult,
  TerminalImport,
  ToolPackages,
  UpdateInfo
} from '../../shared/types'

interface Bridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  write: (id: string, data: string) => void
  on: (channel: string, listener: (...args: never[]) => void) => () => void
  pathForFile: (file: File) => string
  platform: string
  osBuild: number
}

declare global {
  interface Window {
    hera: Bridge
  }
}

const bridge = window.hera

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return bridge.invoke(channel, ...args) as Promise<T>
}

export const platform = bridge.platform
export const isMac = platform === 'darwin'
export const isWin = platform === 'win32'
export const osBuild = bridge.osBuild || 0
export const on = bridge.on
export const writePty = bridge.write
export const pathForFile = bridge.pathForFile

export const api = {
  update: (action: 'state' | 'check' | 'download' | 'install') => call<UpdateInfo>('app:update', action),
  terminalImport: () => call<TerminalImport | null>('terminal:import'),
  listDir: (projectId: string, rel: string) => call<DirListing>('files:list', projectId, rel),
  openPath: (projectId: string, rel: string, mode: 'open' | 'reveal') => call<boolean>('files:open', projectId, rel, mode),
  absPath: (projectId: string, rel: string) => call<string | null>('files:path', projectId, rel),
  gitStatus: (projectId: string) => call<Record<string, string>>('files:git', projectId),
  toolPackages: (force?: boolean) => call<ToolPackages>('tools:packages', Boolean(force)),
  toolExtensions: (projectId: string | null) => call<CliExtensions[]>('tools:extensions', projectId),
  updateTools: (ids: string[], projectId: string | null) => call<SessionInfo | null>('tools:update', ids, projectId),
  shells: () => call<{ value: string; label: string }[]>('shells:list'),
  info: () => call<{ platform: string; version: string; dataDir: string; pendingReveal: { sessionId: string | null } | null }>('app:info'),
  metrics: () => call<AppMetrics>('app:metrics'),
  quit: () => call<void>('app:quit'),
  hide: () => call<void>('app:hide'),
  setVisibleSessions: (ids: string[]) => call<void>('app:visibleSessions', ids),
  copy: (text: string) => call<void>('clipboard:write', text),
  paste: () => call<string>('clipboard:read'),
  /** Saves a clipboard image as a PNG; its path, or null when there is none. */
  pasteImage: () => call<string | null>('clipboard:image'),

  getConfig: () => call<HeraConfig>('config:get'),
  setConfig: (config: HeraConfig) => call<HeraConfig>('config:set', config),

  pickFolders: () => call<string[]>('projects:pick'),
  addProjects: (paths: string[]) => call<Project[]>('projects:add', paths),
  scanFolder: () => call<{ parent: string; found: { path: string; name: string; markers: string[]; mtime: number }[] } | null>('projects:scan'),
  activity: () => call<{ agents: Record<string, number>; launches: Record<string, number> }>('projects:activity'),
  insight: (projectId: string, force = false) => call<ProjectInsight | null>('projects:insight', projectId, force),
  openFolder: (projectId: string) => call<void>('projects:openFolder', projectId),
  openExternal: (projectId: string, agentId: string | null) => call<{ ok: boolean; message: string }>('projects:openExternal', projectId, agentId),

  sessions: () => call<SessionInfo[]>('sessions:list'),
  createSession: (req: CreateSessionRequest) => call<SessionInfo>('sessions:create', req),
  launchTeam: (projectId: string, teamId: string) => call<SessionInfo[]>('sessions:team', projectId, teamId),
  startWork: (req: StartWorkRequest) => call<StartWorkResult>('work:start', req),
  startRace: (req: StartRaceRequest) => call<{ raceId: string; sessions: SessionInfo[] }>('work:race', req),
  worktrees: () => call<WorktreeInfo[]>('worktrees:list'),
  worktreeSupport: (projectId: string) => call<WorktreeSupport>('worktrees:support', projectId),
  initRepository: (projectId: string) => call<WorktreeActionResult>('worktrees:init', projectId),
  createWorktree: (projectId: string, label: string, agentId: string | null) => call<{ worktree: WorktreeInfo; session: SessionInfo }>('worktrees:create', projectId, label, agentId),
  worktreeStatus: (ids: string[]) => call<WorktreeStatus[]>('worktrees:status', ids),
  worktreeDiff: (id: string) => call<WorktreeDiff>('worktrees:diff', id),
  commitWorktree: (id: string, message: string) => call<WorktreeActionResult>('worktrees:commit', id, message),
  mergeWorktree: (id: string, mode: 'merge' | 'squash') => call<WorktreeActionResult>('worktrees:merge', id, mode),
  removeWorktree: (id: string, force: boolean) => call<WorktreeActionResult>('worktrees:remove', id, force),
  openWorktreeFolder: (id: string) => call<void>('worktrees:openFolder', id),
  resize: (id: string, cols: number, rows: number) => call<void>('sessions:resize', id, cols, rows),
  attach: (id: string) => call<void>('sessions:attach', id),
  detach: (id: string) => call<void>('sessions:detach', id),
  kill: (id: string) => call<void>('sessions:kill', id),
  rename: (id: string, title: string) => call<void>('sessions:rename', id, title),
  revive: (id: string, resume: boolean) => call<SessionInfo | null>('sessions:revive', id, resume),
  screen: (id: string, lines: number) => call<string[]>('sessions:screen', id, lines),
  send: (ids: string[], text: string, raw = true) => call<BusMessage[]>('sessions:send', ids, text, raw),
  keys: (id: string, keys: string[]) => call<string[]>('sessions:keys', id, keys),
  externalClaude: () =>
    call<{ pid: number; sessionId: string; cwd: string; status: string; updatedAt: number; name: string | null }[]>('sessions:external'),

  bus: (limit = 300) => call<BusMessage[]>('bus:list', limit),
  history: (query: string) => call<HistoryHit[]>('history:search', query),
  usage: (force = false) => call<AgentUsage[]>('usage:get', force),

  accounts: () => call<AccountStatus[]>('accounts:status'),
  createProfile: (agentId: string, label: string, dir?: string) => call<AccountProfile>('accounts:create', agentId, label, dir),
  removeProfile: (profileId: string) => call<void>('accounts:remove', profileId),
  login: (profileId: string) => call<SessionInfo | null>('accounts:login', profileId),
  statusline: (action: 'state' | 'install' | 'uninstall') =>
    call<{ installed?: boolean; original?: string | null; settingsFile?: string; ok?: boolean; message?: string }>('accounts:statusline', action),

  availability: () => call<AgentAvailability[]>('agents:availability'),

  lanesInfo: () => call<LanesInfo>('lanes:info'),
  setLaneOptions: (patch: Record<string, string | number | boolean | null>) => call<LanesInfo>('lanes:setOptions', patch),
  laneProject: (projectId: string) => call<LaneProjectState | null>('lanes:project', projectId),
  startLanes: (projectId: string, which: LaneTier | 'all') => call<{ ok: boolean; message: string }>('lanes:start', projectId, which),
  stopLanes: (projectId: string, which: LaneTier | 'all') => call<{ ok: boolean; message: string }>('lanes:stop', projectId, which),
  saveLaneRole: (projectId: string, tier: LaneTier, text: string) => call<void>('lanes:role', projectId, tier, text),
  applyLaneAllow: (projectId: string) => call<{ added: number; file: string }>('lanes:allow', projectId),
  openLaneReport: (projectId: string, taskId: string) => call<boolean>('lanes:openReport', projectId, taskId)
}
