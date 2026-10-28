// Self-test for release builds: `HERA_SMOKE=<result.json> <app>` opens a real
// terminal with the default shell, checks that it runs a command and that the
// bundled `hera` CLI is on its PATH, runs the worktree checks (smoke-worktrees.ts),
// writes the result and exits (0 = pass).
// CI runs it on every OS before publishing installers.

import fs from 'node:fs'
import os from 'node:os'

import { app, BrowserWindow } from 'electron'

import * as pty from './pty-host'
import { smokeWorktrees } from './smoke-worktrees'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(id: string, text: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs

  while (Date.now() < end) {
    if (pty.screenLines(id, 200, true).join('\n').includes(text)) return true
    await sleep(250)
  }

  return false
}

export async function runSmoke(resultFile: string) {
  const steps: { step: string; ok: boolean; detail?: string }[] = []
  const record = (step: string, ok: boolean, detail?: string) => steps.push({ step, ok, detail })
  let sessionId: string | null = null

  try {
    const session = pty.createSession({ cwd: os.tmpdir(), title: 'smoke', cols: 120, rows: 30 })
    sessionId = session.id
    record('pty', true, `${process.platform}-${process.arch} ${session.shell || ''}`.trim())
    await sleep(2500)

    // Quoting splits the marker, so only the shell's output can contain it whole.
    pty.write(session.id, 'echo HERA_"SMOKE"_OK\r')
    record('shell runs a command', await waitFor(session.id, 'HERA_SMOKE_OK', 20_000))

    pty.write(session.id, 'hera --version\r')
    const version = `JYSV HERA ${app.getVersion()}`
    record('hera CLI on PATH', await waitFor(session.id, version, 30_000), version)

    const win = BrowserWindow.getAllWindows()[0]
    const rendered = win ? await win.webContents.executeJavaScript('document.getElementById("root")?.childElementCount || 0').catch(() => 0) : 0
    record('window rendered', Number(rendered) > 0)

    await smokeWorktrees(record)
  } catch (error) {
    record('exception', false, (error as Error).stack || String(error))
  }

  const ok = steps.length > 0 && steps.every(step => step.ok)
  const screen = sessionId ? pty.screenLines(sessionId, 40, true).join('\n') : ''
  fs.writeFileSync(resultFile, JSON.stringify({ ok, version: app.getVersion(), platform: process.platform, arch: process.arch, steps, screen }, null, 2))
  pty.killAll()
  await sleep(800)
  app.exit(ok ? 0 : 1)
}
