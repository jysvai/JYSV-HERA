// HERA bus: a local JSON-lines server (named pipe on Windows, unix socket on
// macOS/Linux) that the `hera` CLI talks to. Agents running inside HERA
// terminals use it to list each other, hand off work, read each other's screens
// and wait for results. Every hand-off is logged so the user can audit the
// conversation between agents in the app.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { t } from '../shared/i18n'
import type { BusMessage, CreateSessionRequest, SessionInfo, WireRequest, WireResponse } from '../shared/types'
import { HOST_PASSED_ENV, newId } from '../shared/util'

import { hostLane } from './lanes'
import { dataPath, isWin, pipePath, subDir } from './paths'
import { createSession, getSession, listSessions, screenLines, sendKeys, typeMessage } from './pty-host'
import { addProject, busMessages, getConfig, projectById, projectForPath, recordBus } from './store'

type Handler = (params: Record<string, unknown>, caller: SessionInfo | null) => Promise<unknown> | unknown

export interface BusHooks {
  onMessage: (message: BusMessage) => void
  reveal: (sessionId: string | null, opts?: { split?: boolean }) => void
  /** Create a session the same way the window does (records the launch for the backlog). */
  launch: (req: CreateSessionRequest) => SessionInfo
  metrics: () => Promise<unknown>
}

const INLINE_LIMIT = 1500
let server: net.Server | null = null
let token = ''

export function tokenFile(): string {
  return dataPath('cli-token')
}

function ensureToken(): string {
  const file = tokenFile()

  try {
    const existing = fs.readFileSync(file, 'utf8').trim()

    if (/^[a-f0-9]{32,}$/.test(existing)) {
      return existing
    }
  } catch {
    // create below
  }

  const fresh = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(file, fresh, { encoding: 'utf8', mode: 0o600 })

  return fresh
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value)
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(str(value))

  return Number.isFinite(parsed) ? parsed : fallback
}

function liveSessions(): SessionInfo[] {
  return listSessions().filter(session => !session.dormant)
}

export function resolveTarget(target: string, caller: SessionInfo | null): SessionInfo {
  const key = target.trim().replace(/^@/, '')
  const all = liveSessions()

  if (!key) {
    throw new Error(t('대상(target)이 비어 있습니다. `hera list` 로 이름을 확인하세요.'))
  }

  const exact = all.find(session => session.id === key || session.name.toLowerCase() === key.toLowerCase())

  if (exact) {
    return exact
  }

  if (/^\d+$/.test(key)) {
    const byPid = all.find(session => String(session.pid) === key)

    if (byPid) {
      return byPid
    }
  }

  const others = all.filter(session => session.id !== caller?.id)
  const sameProject = (session: SessionInfo) =>
    caller ? (caller.projectId ? session.projectId === caller.projectId : session.cwd === caller.cwd) : true
  let candidates: SessionInfo[]

  if (key === 'main' || key === 'helper') {
    candidates = others.filter(session => session.role === key)
  } else {
    candidates = others.filter(
      session => session.activeAgentId === key || session.agentId === key || session.shell === key
    )
  }

  const local = candidates.filter(sameProject)
  const pool = local.length ? local : candidates

  if (pool.length === 1) {
    return pool[0]
  }

  if (!pool.length) {
    throw new Error(t("'{key}' 세션을 찾지 못했습니다. `hera list` 로 확인하거나 `hera spawn {key}` 로 새로 띄우세요.", { key }))
  }

  throw new Error(t("'{key}' 후보가 여러 개입니다: {names} — 이름으로 지정하세요.", { key, names: pool.map(session => session.name).join(', ') }))
}

function displayName(session: SessionInfo | null): string {
  return session ? session.name : 'user'
}

function deliver(
  kind: 'send' | 'reply',
  target: SessionInfo,
  text: string,
  caller: SessionInfo | null,
  opts: { raw?: boolean; enter?: boolean }
): BusMessage {
  const from = displayName(caller)
  let body = text.trim()
  let file: string | undefined

  if (!body) {
    throw new Error(t('보낼 메시지가 비어 있습니다.'))
  }

  if (body.length > INLINE_LIMIT) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    file = path.join(subDir('mail'), `${stamp}-${from}-to-${target.name}.md`)
    fs.writeFileSync(file, `# HERA ${kind} · ${from} → ${target.name}\n\n${body}\n`, 'utf8')
  }

  // A plain shell would try to execute the envelope; only agents get one.
  const raw = opts.raw || !target.activeAgentId

  if (!raw) {
    if (kind === 'send') {
      const content = file ? `내용이 길어 파일로 전달합니다: ${file} (읽고 수행하세요)` : body // i18n-ignore
      const replyHint = caller ? ` — 끝나면 \`hera reply ${from} "<결과 요약>"\` 로 회신해 주세요.` : '' // i18n-ignore
      body = `[HERA msg from ${from}] ${content}${replyHint}`
    } else {
      body = `[HERA reply from ${from}] ${file ? `결과가 길어 파일로 전달합니다: ${file}` : body}` // i18n-ignore
    }
  } else if (file) {
    body = `${file}`
  }

  // A reply addressed to a plain shell is logged only: typing prose into a
  // prompt would run it (`hera ask` already prints the result to its caller).
  const typeIt = !(kind === 'reply' && !target.activeAgentId)

  if (typeIt && !typeMessage(target.id, body, { enter: opts.enter !== false })) {
    throw new Error(t('{name} 세션이 종료되어 있어 보낼 수 없습니다.', { name: target.name }))
  }

  const message: BusMessage = {
    id: newId('m_'),
    t: Date.now(),
    kind,
    from: caller?.id || null,
    fromName: from,
    to: target.id,
    toName: target.name,
    text: text.trim().slice(0, 4000),
    file,
    projectId: target.projectId
  }

  recordBus(message)
  hooks?.onMessage(message)

  return message
}

/** Send from the HERA window (the user), optionally to several sessions at once. */
export function sendFromUser(targetIds: string[], text: string, raw = true): BusMessage[] {
  const out: BusMessage[] = []

  for (const id of targetIds) {
    const target = getSession(id)

    if (target && !target.dormant) {
      out.push(deliver('send', target, text, null, { raw }))
    }
  }

  return out
}

/** Wait until a session has been non-busy for `idle` seconds (after starting work). */
async function waitIdle(sessionId: string, idleSec: number, timeoutSec: number, requireBusy: boolean) {
  const started = Date.now()
  let sawBusy = !requireBusy
  let quietSince = 0

  for (;;) {
    const session = getSession(sessionId)

    if (!session) {
      return { status: 'gone', waitedMs: Date.now() - started }
    }

    if (session.status === 'exited') {
      return { status: 'exited', waitedMs: Date.now() - started }
    }

    const busy = session.status === 'busy' || Date.now() - session.lastOutputAt < 1200

    if (busy) {
      sawBusy = true
      quietSince = 0
    } else if (!quietSince) {
      quietSince = Date.now()
    }

    // An agent that never shows a busy marker still counts once it has been
    // quiet for a while after the hand-off.
    const graceOver = Date.now() - started > Math.max(15_000, idleSec * 3000)

    if (session.status === 'waiting' && sawBusy) {
      return { status: 'waiting', waitedMs: Date.now() - started }
    }

    if (quietSince && Date.now() - quietSince >= idleSec * 1000 && (sawBusy || graceOver)) {
      return { status: session.status, waitedMs: Date.now() - started }
    }

    if (Date.now() - started > timeoutSec * 1000) {
      return { status: 'timeout', waitedMs: Date.now() - started }
    }

    await new Promise(resolve => setTimeout(resolve, 400))
  }
}

function describe(session: SessionInfo, caller: SessionInfo | null) {
  const project = projectById(session.projectId)

  return {
    name: session.name,
    id: session.id,
    agent: session.activeAgentId || session.agentId,
    role: session.role,
    status: session.status,
    project: project?.name || null,
    cwd: session.cwd,
    pid: session.pid,
    title: session.title,
    me: caller?.id === session.id,
    sameProject: caller ? session.projectId === caller.projectId : null
  }
}

let hooks: BusHooks | null = null

function launchSession(req: CreateSessionRequest): SessionInfo {
  return hooks ? hooks.launch(req) : createSession(req)
}

const handlers: Record<string, Handler> = {
  ping: () => ({ pong: true, version: 1 }),

  whoami: (_params, caller) => (caller ? describe(caller, caller) : null),

  list: (params, caller) => {
    const all = params.all === true
    const sessions = liveSessions().filter(session => {
      if (all || !caller) return true

      return session.projectId === caller.projectId || session.cwd === caller.cwd
    })

    return sessions.map(session => describe(session, caller))
  },

  send: (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    const message = deliver('send', target, str(params.text), caller, {
      raw: params.raw === true,
      enter: params.enter !== false
    })

    return { delivered: true, to: target.name, file: message.file || null }
  },

  reply: (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    const message = deliver('reply', target, str(params.text), caller, { raw: params.raw === true })

    return { delivered: true, to: target.name, file: message.file || null }
  },

  peek: (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    const count = Math.min(2000, Math.max(1, num(params.lines, 40)))

    return {
      name: target.name,
      status: target.status,
      lines: screenLines(target.id, count, params.scrollback === true)
    }
  },

  wait: async (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    const result = await waitIdle(target.id, num(params.idle, 5), num(params.timeout, 1800), false)

    return { name: target.name, ...result, lines: screenLines(target.id, num(params.lines, 60), true) }
  },

  ask: async (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    deliver('send', target, str(params.text), caller, { raw: params.raw === true })
    const result = await waitIdle(target.id, num(params.idle, 6), num(params.timeout, 1800), true)

    return { name: target.name, ...result, lines: screenLines(target.id, num(params.lines, 80), true) }
  },

  key: (params, caller) => {
    const target = resolveTarget(str(params.target), caller)
    const keys = Array.isArray(params.keys) ? params.keys.map(key => str(key)) : []
    const unknown = sendKeys(target.id, keys)
    recordBus({
      id: newId('m_'),
      t: Date.now(),
      kind: 'key',
      from: caller?.id || null,
      fromName: displayName(caller),
      to: target.id,
      toName: target.name,
      text: keys.join(' '),
      projectId: target.projectId
    })

    return { to: target.name, unknown }
  },

  spawn: (params, caller) => {
    const agentId = str(params.agent)
    const config = getConfig()
    const agent = config.agents.find(entry => entry.id === agentId)

    if (agentId && !agent) {
      throw new Error(t("알 수 없는 에이전트 '{agentId}'. 등록된 것: {known}", { agentId, known: config.agents.map(entry => entry.id).join(', ') }))
    }

    const projectId = str(params.project) ? findProject(str(params.project))?.id || null : caller?.projectId || null
    const info = launchSession({
      projectId,
      cwd: projectId ? undefined : caller?.cwd,
      agentId: agent?.id || null,
      command: str(params.command) || undefined,
      role: (str(params.role) as 'main' | 'helper') || 'helper',
      resume: params.resume === true,
      parentId: caller?.id || null
    })
    const message: BusMessage = {
      id: newId('m_'),
      t: Date.now(),
      kind: 'spawn',
      from: caller?.id || null,
      fromName: displayName(caller),
      to: info.id,
      toName: info.name,
      text: t('{agent} 세션 생성', { agent: agent?.name || 'shell' }),
      projectId: info.projectId
    }
    recordBus(message)
    hooks?.onMessage(message)
    hooks?.reveal(info.id, { split: params.split !== false })

    return { name: info.name, id: info.id, agent: info.agentId }
  },

  // Something that would open a terminal window for a project folder (the lanes plugin,
  // a script) opens a HERA tab instead. Registered projects only: elsewhere it is refused
  // and the caller opens its own window as before.
  host: params => {
    const lane = str(params.lane)
    const cwd = str(params.cwd)
    const env: Record<string, string> = {}
    const given = params.env && typeof params.env === 'object' ? (params.env as Record<string, unknown>) : {}

    for (const [key, value] of Object.entries(given)) if (HOST_PASSED_ENV.test(key) && typeof value === 'string') env[key] = value

    if (lane === 'mid' || lane === 'low') {
      return hostLane({ cwd, lane, run: str(params.run), env, check: params.check === true })
    }

    if (lane) throw new Error(t("알 수 없는 lane '{lane}'", { lane }))

    const project = cwd ? projectForPath(path.resolve(cwd)) : null
    if (!project) throw new Error(t('HERA 에 등록된 프로젝트가 아닙니다: {cwd}', { cwd: cwd || t('(폴더 없음)') }))
    if (params.check === true) return { id: null, name: '', project: project.name }

    const command = str(params.command).trim()
    const info = launchSession({ projectId: project.id, cwd: path.resolve(cwd), command: command || undefined, title: str(params.title) || undefined, env })
    hooks?.reveal(info.id, { split: false })

    return { id: info.id, name: info.name, project: project.name }
  },

  projects: () => getConfig().projects.map(project => ({ id: project.id, name: project.name, path: project.path })),

  add: params => {
    const dir = path.resolve(str(params.path) || process.cwd())

    if (!fs.existsSync(dir)) {
      throw new Error(t('폴더가 없습니다: {dir}', { dir }))
    }

    const project = addProject(dir, str(params.name) || undefined)

    return { id: project.id, name: project.name, path: project.path }
  },

  open: params => {
    const project = findProject(str(params.project))

    if (!project) {
      throw new Error(t("프로젝트 '{project}' 를 찾지 못했습니다. `hera projects` 로 확인하세요.", { project: str(params.project) }))
    }

    const agentId = str(params.agent) || null
    const info = launchSession({ projectId: project.id, agentId, resume: params.resume === true })
    hooks?.reveal(info.id)

    return { name: info.name, project: project.name }
  },

  focus: (params, caller) => {
    const target = params.target ? resolveTarget(str(params.target), caller) : null
    hooks?.reveal(target?.id || null)

    return { focused: target?.name || 'window' }
  },

  history: params => busMessages(Math.min(500, num(params.limit, 30))),

  status: async () => ({
    sessions: liveSessions().length,
    busy: liveSessions().filter(session => session.status === 'busy').length,
    waiting: liveSessions().filter(session => session.status === 'waiting').length,
    metrics: await hooks?.metrics()
  })
}

function findProject(query: string) {
  const key = query.trim().toLowerCase()

  if (!key) {
    return null
  }

  const projects = getConfig().projects

  return (
    projects.find(project => project.id === query) ||
    projects.find(project => project.name.toLowerCase() === key) ||
    (fs.existsSync(query) ? projectForPath(query) : null) ||
    projects.find(project => project.name.toLowerCase().includes(key)) ||
    null
  )
}

async function handle(request: WireRequest): Promise<WireResponse> {
  if (request.token !== token) {
    return { id: request.id, ok: false, error: t('unauthorized (HERA 토큰 불일치)') }
  }

  const handler = handlers[request.method]

  if (!handler) {
    return { id: request.id, ok: false, error: `unknown method '${request.method}'` }
  }

  const caller = request.caller ? getSession(request.caller) : null

  try {
    return { id: request.id, ok: true, result: await handler(request.params || {}, caller) }
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function startBus(nextHooks: BusHooks): void {
  hooks = nextHooks
  token = ensureToken()
  const address = pipePath()

  if (!isWin) {
    try {
      fs.unlinkSync(address)
    } catch {
      // no stale socket
    }
  }

  server = net.createServer(socket => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += chunk

      if (buffer.length > 4_000_000) {
        socket.destroy()

        return
      }

      let newline = buffer.indexOf('\n')

      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        if (!line) continue

        let request: WireRequest

        try {
          request = JSON.parse(line) as WireRequest
        } catch {
          socket.write(`${JSON.stringify({ id: 0, ok: false, error: 'bad json' })}\n`)
          continue
        }

        void handle(request).then(response => {
          if (!socket.destroyed) {
            socket.write(`${JSON.stringify(response)}\n`)
          }
        })
      }
    })
    socket.on('error', () => socket.destroy())
  })

  server.on('error', error => {
    console.error('[hera bus]', error)
  })
  server.listen(address, () => {
    if (!isWin) {
      try {
        fs.chmodSync(address, 0o600)
      } catch {
        // best effort
      }
    }
  })
}

export function stopBus() {
  server?.close()
  server = null
}
