// JYSV HERA — main process.
// Shell derived from Hermes Desktop (MIT, Nous Research): Electron + node-pty +
// xterm. Everything agent-chat related was dropped; what remains is a project
// launcher, a PTY host with headless screen state, a multi-agent bus, and
// backlog / usage / account tracking — tuned to stay near-idle when hidden.
import fs from 'node:fs'
import path from 'node:path'

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  screen,
  session as electronSession,
  shell,
  Tray
} from 'electron'

import { resolveTheme } from '../shared/themes'
import type { BusMessage, CreateSessionRequest, HeraConfig, LaneTier, SessionInfo, TeamPreset } from '../shared/types'

import { accountStatuses, createProfile, installStatuslineTap, removeProfile, statuslineTapState, uninstallStatuslineTap } from './accounts'
import { claudeLiveSessions } from './agent-data'
import { resolveTarget, sendFromUser, startBus, stopBus } from './bus'
import { openExternalTerminal, scanForProjects } from './external'
import { searchHistory } from './history'
import { invalidateInsight, projectActivityTimes, projectInsight } from './insight'
import { applyLaneAllowlist, laneMainArgs, laneProject, lanesInfo, saveLaneRole, setLaneOptions, setLaneTabs, startLanes, stopLanes } from './lanes'
import { dataPath, findOnPath, isMac, isWin, readJson, writeJsonAtomic } from './paths'
import * as pty from './pty-host'
import { quoteArg, resolveShell, writeShortcutFiles } from './shell'
import {
  addProject,
  busMessages,
  flushConfig,
  getConfig,
  lastLaunchByProject,
  onConfigChange,
  projectById,
  recordLaunch,
  reloadIfChangedOnDisk,
  setConfig
} from './store'
import { runSmoke } from './smoke'
import { availableShells, detectTerminalImport } from './terminal-import'
import { checkForUpdate, updateState } from './update'
import { getUsage } from './usage'

const DEV_URL = process.env.HERA_DEV_SERVER
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let deepSleepTimer: NodeJS.Timeout | null = null
let pendingReveal: { sessionId: string | null; split?: boolean } | null = null

// ---------------------------------------------------------------- startup flags

// A custom HERA_HOME (dev build, portable copy) gets its own Chromium profile and
// single-instance lock, so it can run beside the installed app.
if (process.env.HERA_HOME) {
  app.setPath('userData', process.env.HERA_HOME)
}

function bootSettings() {
  // Read settings straight from disk: the store needs app paths that are fine
  // before `ready`, but keep this path dependency-light.
  const raw = readJson<Partial<HeraConfig>>(path.join(app.getPath('userData'), 'config.json'))

  return { lowMemory: raw?.settings?.lowMemory !== false, gpu: raw?.settings?.gpu === true }
}

const boot = bootSettings()

if (!boot.gpu) {
  app.disableHardwareAcceleration()
}

if (boot.lowMemory) {
  // One renderer, no spare renderer kept warm, network service in-process.
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,DialMediaRouteProvider,HardwareMediaKeyHandling')
  app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2')
  app.commandLine.appendSwitch('disk-cache-size', '1048576')
  app.commandLine.appendSwitch('renderer-process-limit', '1')
  // Measured: 'in-process-gpu' (no separate GPU process) costs ~16 MB more in
  // total than the default software-compositing GPU process, so it is not used.
}

// app.quit() is asynchronous: a second copy must stop before it restores
// sessions or binds the bus, so exit immediately.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.exit(0)
}

app.setAppUserModelId('com.jysvai.hera')

// ---------------------------------------------------------------- window

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

function loadWindowState(): WindowState {
  const saved = readJson<WindowState>(dataPath('window.json'))
  const fallback = { width: 1360, height: 860 }

  if (!saved?.width) return fallback

  const visible = screen.getAllDisplays().some(display => {
    const area = display.workArea

    return (
      saved.x !== undefined &&
      saved.y !== undefined &&
      saved.x < area.x + area.width - 80 &&
      saved.x + saved.width > area.x + 80 &&
      saved.y >= area.y - 10 &&
      saved.y < area.y + area.height - 60
    )
  })

  return visible ? saved : { width: saved.width, height: saved.height }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  writeJsonAtomic(dataPath('window.json'), { ...bounds, maximized: win.isMaximized() })
}

function themeColors() {
  // themeSource stays 'system' so prefers-color-scheme always reports the OS;
  // the renderer paints its own color-scheme from the chosen theme.
  const theme = resolveTheme(getConfig().settings, nativeTheme.shouldUseDarkColors)

  return { bg: theme.colors.chrome, fg: theme.colors.text }
}

let appliedTheme = ''

/** Start with the OS login (installed builds only — never registers a dev/portable copy). */
function applyLoginItem() {
  if (!app.isPackaged || process.env.HERA_HOME) return
  const wanted = getConfig().settings.launchAtLogin

  try {
    if (app.getLoginItemSettings({ args: ['--login'] }).openAtLogin !== wanted) {
      app.setLoginItemSettings({ openAtLogin: wanted, args: ['--login'] })
    }
  } catch {
    // unsupported platform/session
  }
}

/** Repaint the window background and Windows caption buttons after a theme change. */
function applyWindowTheme() {
  const colors = themeColors()
  const key = `${colors.bg}|${colors.fg}`

  if (!win || win.isDestroyed() || key === appliedTheme) return
  appliedTheme = key
  win.setBackgroundColor(colors.bg)

  if (!isMac) {
    try {
      win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: 38 })
    } catch {
      // overlay unsupported on this platform/window
    }
  }
}

function createWindow(show = true) {
  const state = loadWindowState()
  const colors = themeColors()
  appliedTheme = `${colors.bg}|${colors.fg}`

  win = new BrowserWindow({
    ...state,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'JYSV HERA',
    backgroundColor: colors.bg,
    icon: iconPath(),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: 38 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: 'bypassHeatCheck',
      enableWebSQL: false
    }
  })

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (show) win?.show()
  })

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  }

  // Never navigate away from the app; open links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)

    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false

    try {
      allowed = Boolean(DEV_URL) && new URL(url).origin === new URL(DEV_URL!).origin
    } catch {
      allowed = false
    }

    if (!allowed) event.preventDefault()
  })

  win.on('close', event => {
    saveWindowState()

    if (!quitting && getConfig().settings.closeToTray) {
      event.preventDefault()
      hideWindow()
    }
  })
  // Windows logoff/shutdown/reboot: before-quit may never come.
  win.on('session-end', () => {
    try {
      pty.saveSessions()
      flushConfig()
    } catch {
      // shutting down
    }
  })
  win.on('hide', onHidden)
  win.on('minimize', onHidden)
  win.on('show', onShown)
  win.on('restore', onShown)
  win.on('focus', () => {
    if (reloadIfChangedOnDisk()) invalidateInsight()
  })
  win.on('closed', () => {
    win = null
    pty.detachAll()
  })
  win.webContents.on('render-process-gone', () => pty.detachAll())
}

function onHidden() {
  // Hidden window = zero terminal streaming. Screens stay current in the
  // headless terminals and are re-sent as snapshots on show.
  pty.detachAll()
  win?.webContents.send('app:visibility', false)
  scheduleDeepSleep()
}

function onShown() {
  if (deepSleepTimer) {
    clearTimeout(deepSleepTimer)
    deepSleepTimer = null
  }

  win?.webContents.send('app:visibility', true)
}

function scheduleDeepSleep() {
  const minutes = getConfig().settings.deepSleepMinutes

  if (deepSleepTimer) clearTimeout(deepSleepTimer)
  if (!minutes || !getConfig().settings.closeToTray) return

  deepSleepTimer = setTimeout(() => {
    deepSleepTimer = null

    // Drop the whole renderer (and GPU work) while nobody is looking.
    if (win && !win.isVisible()) {
      quitting = true
      win.destroy()
      quitting = false
      win = null
    }
  }, minutes * 60_000)
}

function hideWindow() {
  if (!win) return
  if (isMac) app.hide()
  win.hide()
}

function showWindow() {
  if (!win) {
    createWindow(true)

    return
  }

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) hideWindow()
  else showWindow()
}

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function reveal(sessionId: string | null, opts?: { split?: boolean }) {
  pendingReveal = { sessionId, split: opts?.split }
  showWindow()
  send('app:reveal', pendingReveal)
}

// ---------------------------------------------------------------- tray & hotkey

function resourcePath(name: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), name)
}

function iconPath(): string {
  return resourcePath(isWin ? 'icon.ico' : 'icon.png')
}

function buildTrayMenu() {
  const config = getConfig()
  const last = lastLaunchByProject()
  const recent = [...config.projects].sort((a, b) => (last[b.id] || 0) - (last[a.id] || 0)).slice(0, 10)
  const sessions = pty.listSessions().filter(entry => !entry.dormant)
  const busy = sessions.filter(entry => entry.status === 'busy').length
  const waiting = sessions.filter(entry => entry.status === 'waiting').length

  return Menu.buildFromTemplate([
    { label: 'JYSV HERA 열기', click: showWindow },
    { type: 'separator' },
    { label: `세션 ${sessions.length}개 · 작업중 ${busy} · 승인대기 ${waiting}`, enabled: false },
    {
      label: '프로젝트 터미널',
      submenu: recent.length
        ? recent.map(project => ({
            label: project.name,
            click: () => {
              const info = launch({ projectId: project.id })
              reveal(info.id)
            }
          }))
        : [{ label: '등록된 프로젝트 없음', enabled: false }]
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function createTray() {
  // .ico carries 16/24/32 px frames for every DPI; elsewhere tray-16.png has a @2x sibling.
  tray = new Tray(nativeImage.createFromPath(isWin ? iconPath() : resourcePath('tray-16.png')))
  tray.setToolTip('JYSV HERA')
  tray.on('click', toggleWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()))

  if (isMac) tray.setContextMenu(buildTrayMenu())
}

let registeredHotkey: string | null = null

function registerHotkey() {
  const combo = getConfig().settings.hotkey

  if (combo === registeredHotkey) return

  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = null

  if (combo) {
    try {
      if (globalShortcut.register(combo, toggleWindow)) registeredHotkey = combo
    } catch {
      // invalid accelerator; ignore
    }
  }
}

// ---------------------------------------------------------------- sessions & teams

function launch(request: CreateSessionRequest): SessionInfo {
  const config = getConfig()
  const launched = config.agents.find(entry => entry.id === request.agentId)
  const claudeMain = Boolean(launched && (launched.id === 'claude' || launched.usageProvider === 'claude') && !request.command?.trim() && !request.lane)
  let req = request

  // lanes: start HERA's Claude the way lanes' claude-main does (main model, fallback, effort floor).
  if (launched && claudeMain && !/--model\b/.test(`${launched.command} ${req.extraArgs || ''}`)) {
    const kind = resolveShell(projectById(req.projectId || null)?.shell || config.settings.defaultShell).kind
    const extra = laneMainArgs(value => quoteArg(kind, value))
    if (extra) req = { ...req, extraArgs: [req.extraArgs, extra].filter(Boolean).join(' ') }
  }

  const info = pty.createSession(req)

  if (claudeMain && info.projectId && config.settings.lanes.enabled && config.settings.lanes.autoStart) {
    void startLanes(info.projectId, 'all').catch(() => undefined)
  }

  if (info.projectId) {
    const agent = getConfig().agents.find(entry => entry.id === info.agentId)
    recordLaunch({
      t: Date.now(),
      projectId: info.projectId,
      agentId: info.agentId,
      label: req.command ? req.command : agent ? `${agent.name}${req.resume ? ' (이어하기)' : ''}` : '터미널'
    })
    invalidateInsight(info.projectId)
  }

  return info
}

const laneWhich = (which: unknown): LaneTier | 'all' => (which === 'mid' || which === 'low' ? which : 'all')

// Lanes HERA hosts open as ordinary tabs (not recorded as project launches).
setLaneTabs(
  req => pty.createSession(req),
  () => pty.listSessions(),
  id => pty.kill(id)
)

function teamBrief(team: TeamPreset, helpers: SessionInfo[]): string {
  const agents = getConfig().agents
  const roster = helpers
    .map(helper => `${helper.name} (${agents.find(agent => agent.id === helper.agentId)?.name || helper.agentId})`)
    .join(', ')

  return [
    `너는 JYSV HERA 팀 '${team.name}'의 메인 에이전트다.`,
    `같은 프로젝트에 보조 에이전트 세션이 떠 있다: ${roster}.`,
    '셸에서 hera CLI로 협업한다:',
    "hera list (세션 목록·상태) / hera ask <이름> '작업' (맡기고 끝날 때까지 기다려 화면 결과를 받음) /",
    "hera send <이름> '작업' (비동기로 맡김; 결과는 [HERA reply ...] 메시지로 네 입력창에 도착) /",
    'hera peek <이름> (상대 화면 보기) / hera key <이름> enter (승인 프롬프트 응답) / hera spawn <에이전트> (보조 추가).',
    '서로 독립적인 하위 작업을 각 보조의 강점에 맞게 나눠 맡기고, 돌아온 결과는 직접 검증한 뒤 반영해라.',
    '긴 지시는 파일로 자동 전달되니 그대로 보내도 된다.'
  ].join(' ')
}

function launchTeam(projectId: string, teamId: string): SessionInfo[] {
  const config = getConfig()
  const team = config.teams.find(entry => entry.id === teamId)
  const project = projectById(projectId)

  if (!team || !project) return []

  const helpers: SessionInfo[] = []

  for (const pane of team.panes.filter(entry => entry.role === 'helper')) {
    helpers.push(launch({ projectId, agentId: pane.agentId, role: 'helper', profileId: pane.profileId || null }))
  }

  const mainPane = team.panes.find(entry => entry.role === 'main')
  const out: SessionInfo[] = []

  if (mainPane) {
    const agent = config.agents.find(entry => entry.id === mainPane.agentId)
    let extraArgs: string | undefined

    if (team.brief && agent?.systemPromptFlag) {
      const kind = resolveShell(project.shell || config.settings.defaultShell).kind
      extraArgs = `${agent.systemPromptFlag} ${quoteArg(kind, teamBrief(team, helpers))}`
    }

    out.push(launch({ projectId, agentId: mainPane.agentId, role: 'main', profileId: mainPane.profileId || null, extraArgs }))
  }

  return [...out, ...helpers]
}

// ---------------------------------------------------------------- notifications

function notify(title: string, body: string, sessionId: string) {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body, silent: false, icon: iconPath() })
  note.on('click', () => reveal(sessionId))
  note.show()
}

const visibleSessions = new Set<string>()

pty.ptyEvents.on('status', (info, previous, busyMs) => {
  const settings = getConfig().settings
  const watching = win?.isVisible() && win.isFocused() && visibleSessions.has(info.id)
  const project = projectById(info.projectId)?.name || path.basename(info.cwd)

  if (!watching) {
    if (info.status === 'waiting' && settings.notifyOnApproval) {
      notify(`⏳ ${info.name} 승인 대기`, `${project} — 응답이 필요합니다.`, info.id)
    } else if (previous === 'busy' && info.status === 'idle' && busyMs > 8000 && settings.notifyOnDone) {
      notify(`✅ ${info.name} 작업 완료`, `${project} · ${Math.round(busyMs / 1000)}초 작업`, info.id)
    }
  }

  tray?.setToolTip(trayTooltip())
})

function trayTooltip(): string {
  const sessions = pty.listSessions().filter(entry => !entry.dormant)
  const busy = sessions.filter(entry => entry.status === 'busy').length
  const waiting = sessions.filter(entry => entry.status === 'waiting').length

  return `JYSV HERA · 세션 ${sessions.length} · 작업중 ${busy}${waiting ? ` · 승인대기 ${waiting}` : ''}`
}

pty.ptyEvents.on('data', (id, data) => send('pty:data', id, data))
pty.ptyEvents.on('snapshot', (id, data) => send('pty:snapshot', id, data))
pty.ptyEvents.on('changed', info => send('sessions:changed', info))
pty.ptyEvents.on('removed', id => send('sessions:removed', id))

// ---------------------------------------------------------------- metrics

async function metrics() {
  // Private bytes (Windows) match Task Manager's "memory" column; working set
  // double-counts pages shared between Chromium processes.
  const processes = app.getAppMetrics().map(metric => ({
    type: metric.serviceName ? `${metric.type} · ${metric.serviceName.replace(/^.*\./, '')}` : metric.type,
    kb: metric.memory.privateBytes ?? metric.memory.workingSetSize,
    cpu: Math.round(metric.cpu.percentCPUUsage * 10) / 10
  }))

  return {
    totalKB: processes.reduce((sum, entry) => sum + entry.kb, 0),
    processes,
    ptyCount: pty.liveCount()
  }
}

// ---------------------------------------------------------------- IPC

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function handle(channel: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
}

function registerIpc() {
  handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    dataDir: path.dirname(dataPath('config.json')),
    pendingReveal
  }))
  handle('app:metrics', metrics)
  handle('app:update', (action: 'state' | 'check') => (action === 'check' ? checkForUpdate(true) : updateState()))
  handle('terminal:import', () => detectTerminalImport())
  handle('shells:list', () => availableShells())
  handle('app:quit', () => {
    quitting = true
    app.quit()
  })
  handle('app:hide', hideWindow)
  handle('app:visibleSessions', (ids: string[]) => {
    visibleSessions.clear()
    for (const id of ids) visibleSessions.add(id)
  })
  handle('clipboard:write', (text: string) => clipboard.writeText(String(text)))
  handle('clipboard:read', () => clipboard.readText())

  handle('config:get', () => getConfig())
  handle('config:set', (next: HeraConfig) => {
    setConfig(next)
    writeShortcutFiles(getConfig().shortcuts)
    registerHotkey()

    return getConfig()
  })

  handle('projects:pick', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'], title: '프로젝트 폴더 선택' })

    return result.canceled ? [] : result.filePaths
  })
  handle('projects:add', (paths: string[]) =>
    (Array.isArray(paths) ? paths : [])
      .filter(dir => typeof dir === 'string' && isDirectory(dir))
      .map(dir => addProject(dir))
  )
  handle('projects:scan', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: '프로젝트들이 들어있는 상위 폴더 선택' })

    return result.canceled ? null : { parent: result.filePaths[0], found: scanForProjects(result.filePaths[0]) }
  })
  handle('projects:activity', () => ({ agents: projectActivityTimes(), launches: lastLaunchByProject() }))
  handle('projects:insight', (projectId: string, force?: boolean) => projectInsight(projectId, Boolean(force)))
  handle('projects:openFolder', (projectId: string) => {
    const project = projectById(projectId)
    // Only ever open folders: a registered path that became a file must not be launched.
    if (project && isDirectory(project.path)) void shell.openPath(project.path)
  })
  handle('projects:openExternal', (projectId: string, agentId: string | null) => {
    const project = projectById(projectId)
    const agent = getConfig().agents.find(entry => entry.id === agentId)

    if (!project) return { ok: false, message: 'project not found' }
    recordLaunch({ t: Date.now(), projectId, agentId: agent?.id || null, label: `${agent?.name || '터미널'} (외부)` })

    return openExternalTerminal(project, agent?.command || null)
  })

  handle('sessions:list', () => pty.listSessions())
  handle('sessions:create', (req: CreateSessionRequest) => launch(req))
  handle('sessions:team', (projectId: string, teamId: string) => launchTeam(projectId, teamId))
  handle('sessions:write', (id: string, data: string) => pty.write(id, data))
  // Keystroke hot path: one-way, no reply round-trip.
  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    if (typeof id === 'string' && typeof data === 'string') pty.write(id, data)
  })
  handle('sessions:resize', (id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  handle('sessions:attach', (id: string) => pty.attach(id))
  handle('sessions:detach', (id: string) => pty.detach(id))
  handle('sessions:kill', (id: string) => pty.kill(id))
  handle('sessions:rename', (id: string, title: string) => pty.rename(id, title))
  handle('sessions:revive', (id: string, resume: boolean) => pty.revive(id, resume))
  handle('sessions:screen', (id: string, lines: number) => pty.screenLines(id, lines, true))
  handle('sessions:send', (ids: string[], text: string, raw: boolean) => sendFromUser(ids, text, raw !== false))
  handle('sessions:keys', (id: string, keys: string[]) => pty.sendKeys(id, keys))
  handle('sessions:resolve', (target: string) => {
    try {
      return resolveTarget(target, null)
    } catch {
      return null
    }
  })
  handle('sessions:external', () => claudeLiveSessions())

  handle('bus:list', (limit: number) => busMessages(limit || 300))
  handle('history:search', (query: string) => searchHistory(String(query || '')))
  handle('usage:get', (force: boolean) => getUsage(Boolean(force)))

  handle('lanes:info', () => lanesInfo())
  handle('lanes:setOptions', (patch: Record<string, string | number | boolean | null>) => setLaneOptions(patch || {}))
  handle('lanes:project', (projectId: string) => laneProject(String(projectId)))
  handle('lanes:start', (projectId: string, which: LaneTier | 'all') => startLanes(String(projectId), laneWhich(which)))
  handle('lanes:stop', (projectId: string, which: LaneTier | 'all') => stopLanes(String(projectId), laneWhich(which)))
  handle('lanes:role', (projectId: string, tier: LaneTier, text: string) => saveLaneRole(String(projectId), tier === 'low' ? 'low' : 'mid', String(text || '')))
  handle('lanes:allow', (projectId: string) => applyLaneAllowlist(String(projectId)))
  handle('lanes:openReport', (projectId: string, taskId: string) => {
    const project = projectById(String(projectId))
    if (!project || !/^[A-Z]\d+[a-z]?$/.test(String(taskId))) return false
    const report = path.join(project.path, '.claude', 'lanes', 'out', `${taskId}.md`)
    if (!fs.existsSync(report)) return false
    void shell.openPath(report)
    return true
  })

  handle('accounts:status', () => accountStatuses())
  handle('accounts:create', (agentId: string, label: string, dir?: string) => createProfile(agentId, label, dir))
  handle('accounts:remove', (profileId: string) => removeProfile(profileId))
  handle('accounts:login', (profileId: string) => {
    const profiles = getConfig().profiles
    const profile = profiles.find(entry => entry.id === profileId)
    const agentId = profile?.agentId || profileId.replace(/^default:/, '')
    const agent = getConfig().agents.find(entry => entry.id === agentId)

    if (!agent) return null

    const info = launch({ agentId: agent.id, command: agent.loginCommand || agent.command, profileId: profile?.id || null, title: `${agent.name} 로그인` })
    reveal(info.id)

    return info
  })
  handle('accounts:statusline', (action: 'state' | 'install' | 'uninstall') =>
    action === 'install' ? installStatuslineTap() : action === 'uninstall' ? uninstallStatuslineTap() : statuslineTapState()
  )

  handle('agents:availability', () =>
    getConfig().agents.map(agent => {
      const exe = agent.command.trim().split(/\s+/)[0]
      const found = findOnPath(exe)

      return { agentId: agent.id, installed: Boolean(found), path: found }
    })
  )
}

function scheduleUpdateCheck() {
  const run = () => {
    if (!getConfig().settings.checkUpdates) return
    void checkForUpdate().then(info => send('app:update', info))
  }
  // Off the startup path; afterwards a few times a day (each run skips when the last answer is fresh).
  setTimeout(run, 20_000)
  setInterval(run, 3 * 60 * 60_000).unref()
}

// ---------------------------------------------------------------- lifecycle

app.on('second-instance', () => showWindow())

app.whenReady().then(() => {
  if (!gotLock) return

  electronSession.defaultSession.setSpellCheckerEnabled(false)
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)

  const config = getConfig()
  writeShortcutFiles(config.shortcuts)
  pty.restoreSessions()
  registerIpc()
  onConfigChange(next => {
    send('config:changed', next)
    applyWindowTheme()
    applyLoginItem()
  })
  nativeTheme.on('updated', applyWindowTheme)
  applyLoginItem()
  // Session memory: keep sessions.json current so a crash or forced reboot loses
  // at most a few seconds, and bring the saved terminals back running.
  pty.startAutosave()
  if (config.settings.restoreMode === 'resume') setTimeout(() => pty.resumeRestored(), 600)
  if (!process.env.HERA_SMOKE) scheduleUpdateCheck()
  powerMonitor.on('suspend', () => pty.saveSessions())
  powerMonitor.on('shutdown', () => pty.saveSessions())
  startBus({
    onMessage: (message: BusMessage) => send('bus:message', message),
    reveal,
    metrics,
    launch
  })
  createTray()
  registerHotkey()
  createWindow(!config.settings.startHidden && !process.argv.includes('--hidden'))

  app.on('activate', showWindow)
  if (process.env.HERA_SMOKE) setTimeout(() => void runSmoke(process.env.HERA_SMOKE!), 1500)
})

app.on('before-quit', () => {
  quitting = true
  saveWindowState()
  pty.stopAutosave()

  try {
    pty.saveSessions()
  } catch {
    // never block quitting
  }

  flushConfig()
  stopBus()
  pty.killAll()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Stay alive in the tray; quitting is explicit.
  if (!getConfig().settings.closeToTray && !isMac) app.quit()
})
