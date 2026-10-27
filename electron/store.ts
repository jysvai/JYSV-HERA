import fs from 'node:fs'
import path from 'node:path'

import { normalizeConfig } from '../shared/defaults'
import type { BusMessage, HeraConfig, LaunchRecord, Project } from '../shared/types'
import { newId } from '../shared/util'

import { dataPath, readJson, writeJsonAtomic } from './paths'

type Listener = (config: HeraConfig) => void

let config: HeraConfig | null = null
let saveTimer: NodeJS.Timeout | null = null
let lastWrittenMtime = 0
const listeners = new Set<Listener>()

const configFile = () => dataPath('config.json')

export function getConfig(): HeraConfig {
  if (!config) {
    config = normalizeConfig(readJson<HeraConfig>(configFile()), process.platform)
    try {
      lastWrittenMtime = fs.statSync(configFile()).mtimeMs
    } catch {
      saveNow()
    }
  }

  return config
}

export function onConfigChange(listener: Listener): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

function emit() {
  for (const listener of listeners) {
    listener(getConfig())
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  writeJsonAtomic(configFile(), getConfig())
  try {
    lastWrittenMtime = fs.statSync(configFile()).mtimeMs
  } catch {
    // ignore
  }
}

export function flushConfig() {
  if (saveTimer) {
    saveNow()
  }
}

/** Replace the config (renderer edits) and persist shortly after. */
export function setConfig(next: HeraConfig, persistDelay = 250) {
  config = normalizeConfig(next, process.platform)
  emit()

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(saveNow, persistDelay)
}

export function updateConfig(mutate: (draft: HeraConfig) => void, persistDelay = 250) {
  const draft = structuredClone(getConfig())
  mutate(draft)
  setConfig(draft, persistDelay)
}

/** Pick up edits made by the CLI (`hera add`) or by hand while the app runs. */
export function reloadIfChangedOnDisk(): boolean {
  try {
    const mtime = fs.statSync(configFile()).mtimeMs

    if (mtime > lastWrittenMtime + 1 && !saveTimer) {
      config = normalizeConfig(readJson<HeraConfig>(configFile()), process.platform)
      lastWrittenMtime = mtime
      emit()

      return true
    }
  } catch {
    // ignore
  }

  return false
}

export function projectById(id: string | null | undefined): Project | null {
  if (!id) {
    return null
  }

  return getConfig().projects.find(project => project.id === id) || null
}

export function addProject(dir: string, name?: string): Project {
  const resolved = path.resolve(dir)
  const existing = getConfig().projects.find(project => samePath(project.path, resolved))

  if (existing) {
    return existing
  }

  const project: Project = {
    id: newId('p_'),
    name: name || path.basename(resolved) || resolved,
    path: resolved,
    notes: '',
    todos: [],
    commands: [],
    pinned: false,
    createdAt: Date.now()
  }

  updateConfig(draft => {
    draft.projects.push(project)
  }, 0)

  return project
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const out = path.resolve(p).replace(/[\\/]+$/, '')

    return process.platform === 'linux' ? out : out.toLowerCase()
  }

  return norm(a) === norm(b)
}

export function projectForPath(dir: string): Project | null {
  const target = path.resolve(dir)
  let best: Project | null = null

  for (const project of getConfig().projects) {
    const root = path.resolve(project.path)
    const rel = path.relative(root, target)
    const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))

    if (inside && (!best || root.length > path.resolve(best.path).length)) {
      best = project
    }
  }

  return best
}

// ---- append-only logs (JSON lines), compacted when they grow

function appendLine(file: string, value: unknown, maxLines: number) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')

  try {
    const size = fs.statSync(file).size

    // Cheap check first: only count lines when the file is big enough to matter.
    if (size > maxLines * 220) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)

      if (lines.length > maxLines) {
        fs.writeFileSync(file, `${lines.slice(-Math.floor(maxLines * 0.7)).join('\n')}\n`, 'utf8')
      }
    }
  } catch {
    // ignore
  }
}

function readLines<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line) as T]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

const launchFile = () => dataPath('launches.jsonl')
let launchCache: LaunchRecord[] | null = null

export function recordLaunch(record: LaunchRecord) {
  appendLine(launchFile(), record, 4000)
  launchCache?.push(record)
}

export function launches(): LaunchRecord[] {
  if (!launchCache) {
    launchCache = readLines<LaunchRecord>(launchFile())
  }

  return launchCache
}

export function lastLaunchByProject(): Record<string, number> {
  const out: Record<string, number> = {}

  for (const record of launches()) {
    out[record.projectId] = Math.max(out[record.projectId] || 0, record.t)
  }

  return out
}

const busFile = () => dataPath('bus.jsonl')
let busCache: BusMessage[] | null = null

export function recordBus(message: BusMessage) {
  appendLine(busFile(), message, 3000)
  busCache?.push(message)
}

export function busMessages(limit = 300): BusMessage[] {
  if (!busCache) {
    busCache = readLines<BusMessage>(busFile())
  }

  return busCache.slice(-limit)
}
