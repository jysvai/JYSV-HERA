import { atom, computed, map } from 'nanostores'

import { t } from '../../shared/i18n'
import type {
  AgentAvailability,
  AgentUsage,
  BusMessage,
  CreateSessionRequest,
  HeraConfig,
  Project,
  SessionInfo,
  StartRaceRequest,
  StartWorkRequest,
  StartWorkResult,
  UpdateInfo,
  WorktreeInfo
} from '../../shared/types'
import { newId } from '../../shared/util'
import { api, on } from '../lib/hera'

export type View = 'workspace' | 'sessions' | 'usage' | 'accounts' | 'agents' | 'shortcuts' | 'settings' | 'history' | 'bus' | 'theme' | 'lanes' | 'extensions'
export type RightTab = 'backlog' | 'files' | 'worktrees' | 'usage' | 'lanes'

export interface Layout {
  mode: 'single' | 'split'
  active: string | null
  split: string[]
}

export const $config = atom<HeraConfig | null>(null)
/** Installed version vs the latest GitHub release. */
export const $update = atom<UpdateInfo | null>(null)
export const $info = atom<{ platform: string; version: string; dataDir: string } | null>(null)
export const $sessions = map<Record<string, SessionInfo>>({})
export const $view = atom<View>('workspace')
export const $projectId = atom<string | null>(readLocal('hera.project', null))
export const $layouts = map<Record<string, Layout>>(readLocal('hera.layouts', {}))
export const $activity = atom<{ agents: Record<string, number>; launches: Record<string, number> }>({ agents: {}, launches: {} })
export const $availability = atom<Record<string, AgentAvailability>>({})
export const $rightPanel = atom<boolean>(readLocal('hera.rightPanel', true))
export const $rightTab = atom<RightTab>(readLocal('hera.rightTab', 'backlog'))
export const $palette = atom<boolean>(false)
export const $bus = atom<BusMessage[]>([])
export const $worktrees = atom<WorktreeInfo[]>([])
/** The "try with several AIs" dialog, open for this project and task. */
export const $raceDraft = atom<{ projectId: string; task: string } | null>(null)
export const $windowVisible = atom<boolean>(true)
/** Terminal zoom: points added to the font size setting (Ctrl/⌘ +, -, 0 and Ctrl/⌘ + wheel). */
export const $termZoom = atom<number>(readLocal('hera.termZoom', 0))
export const $toast = atom<{ id: string; text: string; tone: 'info' | 'error' } | null>(null)
export const $insightTick = atom(0)
/** Last usage summary; shared by the status bar, the usage panel and the usage page. */
export const $usage = atom<AgentUsage[] | null>(null)

// Re-split usage when projects are added/removed/moved (main re-uses its parse).
let usageProjectsKey = ''
$config.subscribe(config => {
  const key = config?.projects.map(project => `${project.id}=${project.path}`).join('|') || ''
  const changed = usageProjectsKey && key !== usageProjectsKey
  usageProjectsKey = key
  if (changed && $usage.get()) void loadUsage(false).catch(() => undefined)
})

let usageRequest = 0
let usageApplied = 0

export function loadUsage(force = false) {
  const mine = ++usageRequest

  return api.usage(force).then(result => {
    // A slow older answer must not overwrite a newer one.
    if (mine > usageApplied) {
      usageApplied = mine
      $usage.set(result)
    }

    return result
  })
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)

    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable
  }
}

$projectId.subscribe(value => writeLocal('hera.project', value))
$layouts.subscribe(value => writeLocal('hera.layouts', value))
$rightPanel.subscribe(value => writeLocal('hera.rightPanel', value))
$rightTab.subscribe(value => writeLocal('hera.rightTab', value))
$termZoom.subscribe(value => writeLocal('hera.termZoom', value))

/** Zoom every terminal in or out by `step` points, or back to the font size setting. */
export function zoomTerminals(step: number | 'reset') {
  const base = $config.get()?.settings.fontSize || 13
  const next = step === 'reset' ? 0 : Math.max(6 - base, Math.min(40 - base, $termZoom.get() + step))
  if (next === $termZoom.get() && step !== 'reset') return
  $termZoom.set(next)
  toast(next ? t('터미널 글자 크기 {size} (기본 {base}) · {shortcut} 으로 되돌리기', { size: base + next, base, shortcut: isMacPlatform() ? '⌘0' : 'Ctrl+0' }) : t('터미널 글자 크기 {size} (기본)', { size: base }))
}

function isMacPlatform() {
  return navigator.platform.toLowerCase().includes('mac')
}

/** Show the right-hand panel on a tab (workspace view), or hide it when that tab is already showing. */
export function toggleRightTab(tab: RightTab, forceOpen = false) {
  // Without a project the panel can only show usage, whatever the stored tab says.
  const shownTab = $project.get() ? $rightTab.get() : 'usage'
  const showing = $view.get() === 'workspace' && $rightPanel.get() && shownTab === tab

  if (showing && !forceOpen) {
    $rightPanel.set(false)

    return
  }

  $rightTab.set(tab)
  $rightPanel.set(true)
  $view.set('workspace')
}

export const $project = computed([$config, $projectId], (config, id) => config?.projects.find(project => project.id === id) || null)

export const $projectSessions = computed([$sessions, $projectId], (sessions, projectId) =>
  Object.values(sessions)
    .filter(session => session.projectId === projectId)
    .sort((a, b) => a.createdAt - b.createdAt)
)

/** Status counts per project for sidebar badges (coarse derived fact). */
export const $projectBadges = computed($sessions, sessions => {
  const out: Record<string, { live: number; busy: number; waiting: number }> = {}

  for (const session of Object.values(sessions)) {
    if (!session.projectId || session.dormant || session.status === 'exited') continue
    const entry = (out[session.projectId] ||= { live: 0, busy: 0, waiting: 0 })
    entry.live++
    if (session.status === 'busy') entry.busy++
    if (session.status === 'waiting') entry.waiting++
  }

  return out
})

/** Short label of the in-app update for buttons, or null when there is nothing to do. */
export function updateLabel(update: UpdateInfo | null): string | null {
  if (!update?.newer || !update.latest) return null
  const progress = update.progress
  if (progress?.phase === 'downloading') return t('내려받는 중 {percent}%', { percent: progress.total ? Math.floor((progress.received / progress.total) * 100) : 0 })
  if (progress?.phase === 'ready') return t('다시 시작해서 v{version} 설치', { version: update.latest })
  if (progress?.phase === 'installing') return t('설치하는 중…')

  return t('v{version} 업데이트', { version: update.latest })
}

/**
 * The update button: first download and verify, then (second press) restart into the
 * installer. Builds that cannot update themselves open the release page instead.
 */
export async function runUpdate() {
  const update = $update.get()
  if (!update?.newer) return
  if (!update.installable) {
    window.open(update.url, '_blank')
    return
  }
  const phase = update.progress?.phase
  if (phase === 'downloading' || phase === 'installing') return

  if (phase === 'ready') {
    const ok = window.confirm(t('HERA 를 다시 시작해서 업데이트를 설치합니다.\n열려 있는 터미널은 세션 기억으로 다시 열리지만, 실행 중인 작업은 멈춥니다. 계속할까요?'))
    if (!ok) return
  }

  try {
    const next = await api.update(phase === 'ready' ? 'install' : 'download')
    $update.set(next)
    if (next.progress?.phase === 'error') toast(t('업데이트 실패: {error}', { error: next.progress.error || '' }), 'error')
    else if (next.progress?.phase === 'ready' && phase !== 'ready') toast(t('업데이트를 내려받았습니다. 버튼을 한 번 더 누르면 다시 시작해서 설치합니다.'))
  } catch (error) {
    toast(t('업데이트 실패: {error}', { error: (error as Error).message }), 'error')
  }
}

export function toast(text: string, tone: 'info' | 'error' = 'info') {
  const id = newId()
  $toast.set({ id, text, tone })
  setTimeout(() => {
    if ($toast.get()?.id === id) $toast.set(null)
  }, 3200)
}

// ---- config mutations (optimistic, then persisted by main)

export function updateConfig(mutate: (draft: HeraConfig) => void) {
  const current = $config.get()

  if (!current) return

  const draft = structuredClone(current)
  mutate(draft)
  $config.set(draft)
  configInFlight++
  void api
    .setConfig(draft)
    .then(saved => {
      // Main's normalized copy wins once our last edit has landed.
      if (configInFlight === 1 && saved) $config.set(saved)
    })
    .catch(error => toast(t('설정 저장 실패: {error}', { error: error.message }), 'error'))
    .finally(() => configInFlight--)
}

/** Echoes of our own edits arrive while saves are in flight; applying them would roll back newer edits. */
let configInFlight = 0

function onConfigChanged(next: HeraConfig) {
  if (configInFlight === 0) $config.set(next)
}

export function updateProject(id: string, mutate: (project: Project) => void) {
  updateConfig(draft => {
    const project = draft.projects.find(entry => entry.id === id)
    if (project) mutate(project)
  })
}

// ---- layouts

export function layoutFor(projectId: string | null): Layout {
  return (projectId && $layouts.get()[projectId]) || { mode: 'single', active: null, split: [] }
}

export function setLayout(projectId: string, patch: Partial<Layout>) {
  $layouts.setKey(projectId, { ...layoutFor(projectId), ...patch })
}

export function focusSession(session: SessionInfo, opts: { split?: boolean } = {}) {
  if (session.projectId) {
    $projectId.set(session.projectId)
    const layout = layoutFor(session.projectId)
    const split = opts.split && layout.mode === 'split' ? [...new Set([...layout.split, session.id])].slice(-4) : layout.split
    setLayout(session.projectId, { active: session.id, split })
  } else {
    $projectId.set(null)
    setLayout('__none__', { active: session.id })
  }

  $view.set('workspace')
}

// ---- session actions

export async function launch(req: CreateSessionRequest, opts: { split?: boolean } = {}) {
  try {
    const session = await api.createSession(req)
    $sessions.setKey(session.id, session)

    if (req.projectId) {
      const layout = layoutFor(req.projectId)
      const split = opts.split ? [...new Set([...(layout.mode === 'split' ? layout.split : layout.active ? [layout.active] : []), session.id])].slice(-4) : layout.split
      setLayout(req.projectId, { active: session.id, mode: opts.split ? 'split' : layout.mode, split })
    }

    $view.set('workspace')
    refreshActivity()

    return session
  } catch (error) {
    toast(t('실행 실패: {error}', { error: (error as Error).message }), 'error')

    return null
  }
}

export async function launchTeam(projectId: string, teamId: string) {
  const sessions = await api.launchTeam(projectId, teamId)

  for (const session of sessions) $sessions.setKey(session.id, session)

  if (sessions.length) {
    setLayout(projectId, { mode: 'split', active: sessions[0].id, split: sessions.map(session => session.id).slice(0, 4) })
  }

  $view.set('workspace')
  refreshActivity()
}

/** Hand a task (or, without one, helpers) to a lead; the panes open side by side. */
export async function startWork(req: StartWorkRequest): Promise<StartWorkResult | null> {
  try {
    const result = await api.startWork(req)
    const all = [result.lead, ...result.helpers]

    for (const session of all) $sessions.setKey(session.id, session)

    if (result.helpers.length) {
      setLayout(req.projectId, { mode: 'split', active: result.lead.id, split: all.map(session => session.id).slice(0, 4) })
    } else {
      setLayout(req.projectId, { active: result.lead.id })
    }

    $view.set('workspace')
    refreshActivity()
    toast(
      req.task
        ? t('{name} 에게 맡겼습니다. 에이전트가 준비되면 바로 시작합니다.', { name: result.lead.name })
        : t('{name} 에 보조 {count}개를 붙였습니다.', { name: result.lead.name, count: result.helpers.length })
    )

    return result
  } catch (error) {
    toast(t('시작하지 못했습니다: {error}', { error: (error as Error).message }), 'error')

    return null
  }
}

/** The same task for several agents, each in a worktree of its own; their panes open side by side. */
export async function startRace(req: StartRaceRequest): Promise<boolean> {
  try {
    const result = await api.startRace(req)

    for (const session of result.sessions) $sessions.setKey(session.id, session)
    setLayout(req.projectId, { mode: 'split', active: result.sessions[0]?.id || null, split: result.sessions.map(session => session.id).slice(0, 4) })
    $rightTab.set('worktrees')
    $rightPanel.set(true)
    $view.set('workspace')
    refreshActivity()
    toast(t('AI {count}개가 각자 작업 공간에서 시작합니다. 끝나면 작업 공간 탭에서 비교하세요.', { count: result.sessions.length }))

    return true
  } catch (error) {
    toast(t('시작하지 못했습니다: {error}', { error: (error as Error).message }), 'error')

    return false
  }
}

export async function closeSession(id: string) {
  await api.kill(id)
}

export function refreshActivity() {
  void api.activity().then(activity => $activity.set(activity))
}

// ---- boot: initial fetch + event wiring

export async function bootStore() {
  const [config, info, sessions, availability, bus] = await Promise.all([
    api.getConfig(),
    api.info(),
    api.sessions(),
    api.availability(),
    api.bus(200)
  ])
  $config.set(config)
  $info.set(info)
  $sessions.set(Object.fromEntries(sessions.map(session => [session.id, session])))
  $availability.set(Object.fromEntries(availability.map(entry => [entry.agentId, entry])))
  $bus.set(bus)
  void api
    .worktrees()
    .then(list => $worktrees.set(list))
    .catch(() => undefined)

  if (!$projectId.get() && config.projects.length) {
    $projectId.set(config.projects[0].id)
  }

  refreshActivity()

  on('config:changed', onConfigChanged)
  on('app:update', (update: UpdateInfo) => $update.set(update))
  void api
    .update('state')
    .then(update => $update.set(update))
    .catch(() => undefined)
  let activityTimer: ReturnType<typeof setTimeout> | null = null
  // A late status event for a just-closed session must not resurrect its tab.
  const removed = new Set<string>()
  on('sessions:changed', (session: SessionInfo) => {
    if (removed.has(session.id)) return
    const isNew = !$sessions.get()[session.id]
    $sessions.setKey(session.id, session)

    // Sessions opened by `hera open/spawn` or the tray: refresh "last run" views.
    if (isNew) {
      if (activityTimer) clearTimeout(activityTimer)
      activityTimer = setTimeout(() => {
        refreshActivity()
        $insightTick.set($insightTick.get() + 1)
      }, 400)
    }
  })
  on('sessions:removed', (id: string) => {
    removed.add(id)
    const next = { ...$sessions.get() }
    delete next[id]
    $sessions.set(next)

    for (const [projectId, layout] of Object.entries($layouts.get())) {
      if (layout.active === id || layout.split.includes(id)) {
        const remaining = Object.values(next).filter(session => session.projectId === projectId)
        setLayout(projectId, {
          active: layout.active === id ? remaining[remaining.length - 1]?.id || null : layout.active,
          split: layout.split.filter(entry => entry !== id)
        })
      }
    }
  })
  on('bus:message', (message: BusMessage) => $bus.set([...$bus.get().slice(-299), message]))
  on('worktrees:changed', (list: WorktreeInfo[]) => $worktrees.set(list))
  on('app:visibility', (visible: boolean) => $windowVisible.set(visible))
  on('app:reveal', (payload: { sessionId: string | null; split?: boolean }) => {
    const session = payload.sessionId ? $sessions.get()[payload.sessionId] : null

    if (session) focusSession(session, { split: payload.split })
  })

  if (info.pendingReveal?.sessionId) {
    const session = $sessions.get()[info.pendingReveal.sessionId]
    if (session) focusSession(session)
  }
}
