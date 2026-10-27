// New-version check against the project's GitHub releases. This is HERA's only
// network request, and the setting `checkUpdates` turns it off.

import fs from 'node:fs'

import { app, net } from 'electron'

import type { UpdateInfo } from '../shared/types'
import { dataPath, writeJsonAtomic } from './paths'

export const RELEASES_URL = 'https://github.com/jysvai/JYSV-HERA/releases'
const LATEST_API = 'https://api.github.com/repos/jysvai/JYSV-HERA/releases/latest'
/** Automatic checks run at most this often; the button forces one. */
const EVERY_MS = 6 * 60 * 60_000

let current: UpdateInfo | null = null
let running: Promise<UpdateInfo> | null = null

function parse(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())

  return match ? match.slice(1, 4).map(Number) : null
}

/** True when `latest` is a higher x.y.z than `installed`. */
export function isNewer(latest: string, installed: string): boolean {
  const a = parse(latest)
  const b = parse(installed)
  if (!a || !b) return false

  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }

  return false
}

function stored(): UpdateInfo | null {
  try {
    const value = JSON.parse(fs.readFileSync(dataPath('update.json'), 'utf8')) as UpdateInfo

    return { ...value, current: app.getVersion(), newer: value.latest ? isNewer(value.latest, app.getVersion()) : false }
  } catch {
    return null
  }
}

/** Last known result without touching the network. */
export function updateState(): UpdateInfo {
  current ??= stored()

  return current || { current: app.getVersion(), latest: null, newer: false, url: RELEASES_URL, checkedAt: 0 }
}

/** Ask GitHub for the latest release (deduplicated; skipped when the last check is recent unless forced). */
export function checkForUpdate(force = false): Promise<UpdateInfo> {
  const known = updateState()
  if (!force && known.checkedAt && Date.now() - known.checkedAt < EVERY_MS && !known.error) return Promise.resolve(known)
  if (running) return running

  running = (async () => {
    const installed = app.getVersion()
    let next: UpdateInfo

    try {
      const response = await net.fetch(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `JYSV-HERA/${installed}` },
        signal: AbortSignal.timeout(15_000)
      })
      if (response.status === 404) {
        next = { current: installed, latest: null, newer: false, url: RELEASES_URL, checkedAt: Date.now() }
      } else {
        if (!response.ok) throw new Error(`GitHub ${response.status}`)
        const body = (await response.json()) as { tag_name?: string; html_url?: string; published_at?: string }
        const latest = String(body.tag_name || '').replace(/^v/, '') || null
        next = {
          current: installed,
          latest,
          newer: latest ? isNewer(latest, installed) : false,
          url: typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/') ? body.html_url : RELEASES_URL,
          publishedAt: body.published_at ? Date.parse(body.published_at) || undefined : undefined,
          checkedAt: Date.now()
        }
      }
      writeJsonAtomic(dataPath('update.json'), next)
    } catch (error) {
      // Keep the last good answer; only note that this attempt failed.
      next = { ...updateState(), current: installed, error: (error as Error).message || 'network error', checkedAt: Date.now() }
    }

    current = next

    return next
  })().finally(() => {
    running = null
  })

  return running
}
