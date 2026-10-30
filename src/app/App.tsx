import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { cn } from '../lib/cn'
import { isMac } from '../lib/hera'
import { $config, $palette, $project, $projectSessions, $rightPanel, $toast, $view, closeSession, launch, layoutFor, setLayout, toggleRightTab, zoomTerminals } from '../store/app'
import { $theme, applyTheme } from '../store/theme'
import { AccountsPage } from './pages/AccountsPage'
import { AgentsPage } from './pages/AgentsPage'
import { BusPage } from './pages/BusPage'
import { ExtensionsPage } from './pages/ExtensionsPage'
import { HistoryPage } from './pages/HistoryPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShortcutsPage } from './pages/ShortcutsPage'
import { LanesPage } from './pages/LanesPage'
import { ThemePage } from './pages/ThemePage'
import { UsagePage } from './pages/UsagePage'
import { ProjectDialog, ScanDialog } from './projects/dialogs'
import { Statusbar, Titlebar } from './shell/Chrome'
import { Palette } from './shell/Palette'
import { RightPanel } from './shell/RightPanel'
import { Sidebar } from './shell/Sidebar'
import { Workspace } from './workspace/Workspace'

function useTheme() {
  const theme = useStore($theme)
  const highContrast = useStore($config)?.settings.highContrast ?? false

  useEffect(() => {
    if (theme) applyTheme(theme, highContrast)
  }, [theme, highContrast])
}

function inTerminal(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('.xterm'))
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const mod = isMac ? event.metaKey : event.ctrlKey && event.shiftKey
      const project = $project.get()
      const sessions = $projectSessions.get()

      // Palette: Cmd+K (mac) / Ctrl+Shift+P anywhere / Ctrl+K outside a terminal.
      if ((isMac && event.metaKey && key === 'k') || (!isMac && mod && key === 'p') || (!isMac && event.ctrlKey && !event.shiftKey && key === 'k' && !inTerminal(event.target))) {
        event.preventDefault()
        $palette.set(!$palette.get())

        return
      }

      if (mod && key === 't' && project) {
        event.preventDefault()
        void launch({ projectId: project.id })

        return
      }

      if (mod && key === 'w' && project) {
        const active = layoutFor(project.id).active
        if (active) {
          event.preventDefault()
          void closeSession(active)
        }

        return
      }

      if ((isMac ? event.metaKey : event.ctrlKey) && !event.altKey && ['=', '+', '-', '0'].includes(event.key) && $view.get() === 'workspace') {
        event.preventDefault()
        zoomTerminals(event.key === '0' ? 'reset' : event.key === '-' ? -1 : 1)

        return
      }

      if (mod && (key === 'b' || key === 'u' || key === 'e')) {
        event.preventDefault()
        toggleRightTab(key === 'u' || !project ? 'usage' : key === 'e' ? 'files' : 'backlog')

        return
      }

      if (mod && key === 'j') {
        event.preventDefault()
        $view.set($view.get() === 'sessions' ? 'workspace' : 'sessions')

        return
      }

      if (isMac && event.metaKey && key === ',') {
        event.preventDefault()
        $view.set('settings')

        return
      }

      if (event.ctrlKey && key === 'tab' && project && sessions.length > 1) {
        event.preventDefault()
        const active = layoutFor(project.id).active
        const index = Math.max(0, sessions.findIndex(session => session.id === active))
        const next = sessions[(index + (event.shiftKey ? sessions.length - 1 : 1)) % sessions.length]
        setLayout(project.id, { active: next.id })
        $view.set('workspace')

        return
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key) && project) {
        const target = sessions[Number(event.key) - 1]
        if (target) {
          event.preventDefault()
          setLayout(project.id, { active: target.id })
          $view.set('workspace')
        }

        return
      }

      if (event.key === 'Escape' && $view.get() !== 'workspace' && !document.querySelector('[role="dialog"]') && !$palette.get()) {
        $view.set('workspace')
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Toast() {
  const toast = useStore($toast)

  if (!toast) return null

  return (
    <div
      className={cn(
        'fixed bottom-9 left-1/2 z-(--z-over-modal) flex max-w-[min(640px,90vw)] -translate-x-1/2 items-center gap-3 rounded-lg border border-(--stroke-nous) px-4 py-2 text-[12.5px] shadow-nous',
        toast.tone === 'error' ? 'bg-(--ui-bg-elevated) text-(--status-waiting) ring-1 ring-(--status-waiting)/50' : 'bg-(--ui-bg-elevated)'
      )}
    >
      {toast.image && <img src={toast.image} alt="" className="h-12 max-w-24 shrink-0 rounded border border-(--ui-stroke-tertiary) object-contain" />}
      <span>{toast.text}</span>
    </div>
  )
}

function Page() {
  const view = useStore($view)

  switch (view) {
    case 'sessions':
      return <SessionsPage />
    case 'bus':
      return <BusPage />
    case 'usage':
      return <UsagePage />
    case 'accounts':
      return <AccountsPage />
    case 'history':
      return <HistoryPage />
    case 'agents':
      return <AgentsPage />
    case 'extensions':
      return <ExtensionsPage />
    case 'shortcuts':
      return <ShortcutsPage />
    case 'settings':
      return <SettingsPage />
    case 'theme':
      return <ThemePage />
    case 'lanes':
      return <LanesPage />
    default:
      return null
  }
}

export function App() {
  const view = useStore($view)
  const rightPanel = useStore($rightPanel)

  useTheme()
  useHotkeys()

  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1 bg-(--ui-bg-editor)">
          {/* Off-screen terminals unmount entirely; main keeps their exact screen
              in a headless buffer and replays a snapshot when they come back. */}
          {view === 'workspace' ? <Workspace /> : <Page />}
        </main>
        {view === 'workspace' && rightPanel && <RightPanel />}
      </div>
      <Statusbar />
      <Palette />
      <ProjectDialog />
      <ScanDialog />
      <Toast />
    </div>
  )
}
