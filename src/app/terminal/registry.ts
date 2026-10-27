// One IPC listener for all terminals: routes pty data/snapshots to the mounted
// xterm instance. Only mounted (visible) terminals are attached in main, so
// hidden tabs cost nothing in the renderer.
import type { Terminal } from '@xterm/xterm'

import { api, on } from '../../lib/hera'
import { $windowVisible } from '../../store/app'

interface Instance {
  term: Terminal
  /** False until the attach snapshot arrives; earlier data is already in it. */
  ready: boolean
}

const instances = new Map<string, Instance>()

// Self-tests and bug reports read the live terminals (localStorage 'hera.debug' = '1').
try {
  if (localStorage.getItem('hera.debug') === '1') (window as unknown as { heraTerminals: unknown }).heraTerminals = instances
} catch {
  // storage blocked
}

on('pty:snapshot', (id: string, snapshot: string) => {
  const instance = instances.get(id)

  if (!instance) return

  const term = instance.term
  term.reset()
  // Repaint every row once the snapshot is in: rows drawn mid-way would otherwise
  // stay stale until something scrolls them.
  term.write(snapshot, () => term.refresh(0, term.rows - 1))
  instance.ready = true
})

on('pty:data', (id: string, data: string) => {
  const instance = instances.get(id)

  if (instance?.ready) instance.term.write(data)
})

let visibleTimer: ReturnType<typeof setTimeout> | null = null

function publishVisible() {
  if (visibleTimer) clearTimeout(visibleTimer)
  visibleTimer = setTimeout(() => void api.setVisibleSessions([...instances.keys()]), 150)
}

export function registerTerminal(id: string, term: Terminal) {
  instances.set(id, { term, ready: false })
  publishVisible()
}

export function unregisterTerminal(id: string, term: Terminal) {
  if (instances.get(id)?.term === term) {
    instances.delete(id)
    publishVisible()
  }
}

export function terminalFor(id: string): Terminal | null {
  return instances.get(id)?.term || null
}

// Main detaches everything while the window is hidden; re-attach on show.
$windowVisible.listen(visible => {
  if (!visible) return

  for (const [id, instance] of instances) {
    instance.ready = false
    void api.attach(id)
  }
})
