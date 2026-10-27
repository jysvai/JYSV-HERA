import { atom, computed, map } from 'nanostores'

import type { AgentAvailability, AgentUsage, BusMessage, CreateSessionRequest, HeraConfig, Project, SessionInfo, UpdateInfo } from '../../shared/types'
import { newId } from '../../shared/util'
import { api, on } from '../lib/hera'

export type View = 'workspace' | 'sessions' | 'usage' | 'accounts' | 'agents' | 'shortcuts' | 'settings' | 'history' | 'bus' | 'theme' | 'lanes'
export type RightTab = 'backlog' | 'usage' | 'lanes'

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
export const $windowVisible = atom<boolean>(true)
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
    .catch(error => toast(`설정 저장 실패: ${error.message}`, 'error'))
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
    toast(`실행 실패: ${(error as Error).message}`, 'error')

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
