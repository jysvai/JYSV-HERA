import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

// Narrow bridge: a fixed allow-list of invoke channels and event channels.
const INVOKE = new Set([
  'app:info',
  'app:metrics',
  'app:quit',
  'app:hide',
  'app:visibleSessions',
  'clipboard:write',
  'clipboard:read',
  'clipboard:image',
  'config:get',
  'config:set',
  'projects:pick',
  'projects:add',
  'projects:scan',
  'projects:activity',
  'projects:insight',
  'projects:openFolder',
  'projects:openExternal',
  'sessions:list',
  'sessions:create',
  'sessions:team',
  'work:start',
  'work:race',
  'worktrees:list',
  'worktrees:support',
  'worktrees:init',
  'worktrees:create',
  'worktrees:status',
  'worktrees:diff',
  'worktrees:commit',
  'worktrees:merge',
  'worktrees:loss',
  'worktrees:remove',
  'worktrees:openFolder',
  'sessions:write',
  'sessions:resize',
  'sessions:attach',
  'sessions:detach',
  'sessions:kill',
  'sessions:rename',
  'sessions:revive',
  'sessions:screen',
  'sessions:send',
  'sessions:keys',
  'sessions:resolve',
  'sessions:external',
  'bus:list',
  'history:search',
  'usage:get',
  'lanes:info',
  'lanes:setOptions',
  'lanes:project',
  'lanes:start',
  'lanes:stop',
  'lanes:role',
  'lanes:allow',
  'lanes:openReport',
  'accounts:status',
  'accounts:create',
  'accounts:remove',
  'accounts:login',
  'accounts:statusline',
  'agents:availability',
  'app:update',
  'files:list',
  'files:open',
  'files:path',
  'files:git',
  'tools:packages',
  'tools:extensions',
  'tools:update',
  'terminal:import',
  'shells:list'
])

const EVENTS = new Set([
  'pty:data',
  'pty:snapshot',
  'sessions:changed',
  'sessions:removed',
  'config:changed',
  'bus:message',
  'app:visibility',
  'app:reveal',
  'app:update',
  'worktrees:changed'
])

contextBridge.exposeInMainWorld('hera', {
  invoke(channel: string, ...args: unknown[]) {
    if (!INVOKE.has(channel)) {
      return Promise.reject(new Error(`blocked channel ${channel}`))
    }

    return ipcRenderer.invoke(channel, ...args)
  },
  // Fire-and-forget for the hot path (keystrokes / resize) — no reply needed.
  write(id: string, data: string) {
    ipcRenderer.send('pty:write', id, data)
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    if (!EVENTS.has(channel)) {
      throw new Error(`blocked event ${channel}`)
    }

    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)

    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  /** Absolute path of a dropped file (File.path no longer exists in Electron). */
  pathForFile(file: File) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  platform: process.platform,
  /** Windows build (26100, 19045, ...): xterm reflows only on a ConPTY new enough to reflow too. */
  osBuild: process.platform === 'win32' ? Number(process.getSystemVersion().split('.')[2]) || 0 : 0
})
