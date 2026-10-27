// hera — command-line bridge between agent sessions running inside JYSV HERA.
// Runs on plain Node or on HERA's own Electron binary (ELECTRON_RUN_AS_NODE).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { WireRequest, WireResponse } from '../shared/types'
import { heraPipeName } from '../shared/util'

const isWin = process.platform === 'win32'

function defaultDataDir(): string {
  if (isWin) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JYSV HERA')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'JYSV HERA')

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'JYSV HERA')
}

function dataDir(): string {
  return process.env.HERA_HOME || defaultDataDir()
}

function pipePath(): string {
  if (isWin) {
    return heraPipeName(os.userInfo().username, dataDir(), defaultDataDir())
  }

  return path.join(dataDir(), 'hera.sock')
}

function out(text: string) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

function fail(message: string, code = 1): never {
  process.stderr.write(`hera: ${message}\n`)
  process.exit(code)
}

function call(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<unknown> {
  let token = ''

  try {
    token = fs.readFileSync(path.join(dataDir(), 'cli-token'), 'utf8').trim()
  } catch {
    fail('JYSV HERA 가 실행 중이 아닙니다 (토큰 파일 없음). 앱을 먼저 켜세요.', 3)
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath())
    let buffer = ''
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            socket.destroy()
            reject(new Error('timeout waiting for HERA'))
          }, timeoutMs)
        : null

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      const request: WireRequest = { id: 1, token, method, caller: process.env.HERA_SESSION_ID || null, params }
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', chunk => {
      buffer += chunk
      const newline = buffer.indexOf('\n')

      if (newline < 0) return

      if (timer) clearTimeout(timer)
      socket.end()

      try {
        const response = JSON.parse(buffer.slice(0, newline)) as WireResponse
        response.ok ? resolve(response.result) : reject(new Error(response.error || 'error'))
      } catch (error) {
        reject(error)
      }
    })
    socket.on('error', error => {
      if (timer) clearTimeout(timer)
      const code = (error as NodeJS.ErrnoException).code
      reject(new Error(code === 'ENOENT' || code === 'ECONNREFUSED' ? 'JYSV HERA 가 실행 중이 아닙니다.' : error.message))
    })
  })
}

// ---- argument parsing

interface Parsed {
  positional: string[]
  flags: Record<string, string | boolean>
  rest: string[]
}

const VALUE_FLAGS = new Set(['n', 'lines', 'idle', 'timeout', 'file', 'project', 'agent', 'cmd', 'name', 'role', 'limit'])

function parse(argv: string[]): Parsed {
  const parsed: Parsed = { positional: [], flags: {}, rest: [] }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--') {
      parsed.rest = argv.slice(index + 1)
      break
    }

    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2 && !/\d/.test(arg[1]))) {
      const [rawKey, inline] = arg.replace(/^-+/, '').split(/=(.*)/s)
      const key = rawKey

      if (inline !== undefined) parsed.flags[key] = inline
      else if (VALUE_FLAGS.has(key) && index + 1 < argv.length) parsed.flags[key] = argv[++index]
      else parsed.flags[key] = true
    } else {
      parsed.positional.push(arg)
    }
  }

  return parsed
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve('')

      return
    }

    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}

async function messageFrom(parsed: Parsed, startIndex: number): Promise<string> {
  if (typeof parsed.flags.file === 'string') {
    return fs.readFileSync(parsed.flags.file, 'utf8')
  }

  const words = parsed.positional.slice(startIndex)

  if (words.length === 1 && words[0] === '-') {
    return readStdin()
  }

  if (!words.length && !process.stdin.isTTY) {
    return readStdin()
  }

  return words.join(' ')
}

function num(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

// ---- output helpers

interface SessionRow {
  name: string
  agent: string | null
  role: string | null
  status: string
  project: string | null
  cwd: string
  pid: number
  me: boolean
  title: string
}

const STATUS_LABEL: Record<string, string> = {
  busy: 'busy',
  idle: 'idle',
  waiting: 'WAITING-APPROVAL',
  starting: 'starting',
  exited: 'exited'
}

function table(rows: SessionRow[]): string {
  if (!rows.length) return '(no sessions — open one in HERA or run `hera spawn <agent>`)'

  const lines = rows.map(row => [
    `${row.me ? '*' : ' '} ${row.name}`,
    row.agent || 'shell',
    row.role || '-',
    STATUS_LABEL[row.status] || row.status,
    row.project || path.basename(row.cwd)
  ])
  const header = ['  NAME', 'AGENT', 'ROLE', 'STATUS', 'PROJECT']
  const widths = header.map((title, column) => Math.max(title.length, ...lines.map(line => line[column].length)))
  const format = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()

  return [format(header), ...lines.map(format)].join('\n')
}

function printScreen(result: { name: string; status: string; lines: string[]; waitedMs?: number }, label: string) {
  const waited = result.waitedMs !== undefined ? ` · waited ${Math.round(result.waitedMs / 1000)}s` : ''
  out(`── ${label} ${result.name} · status=${result.status}${waited} ──`)
  out(result.lines.join('\n'))
  out('── end ──')
}

const GUIDE = `JYSV HERA — multi-agent protocol (hera CLI)

You are running inside a JYSV HERA terminal. Other AI agents (Claude Code, Codex,
Antigravity, ...) may be running in other HERA terminals, often in the
same project folder. Use these commands from your shell to work with them:

  hera list                      sessions in this project (* = you). --all for every project
  hera ask <name> "task"         hand off a task and WAIT until that agent is done;
                                 prints the end of its screen (its answer)
  hera send <name> "task"        hand off without waiting; the agent replies later with
                                 [HERA reply from <name>] typed into your input
  hera reply <name> "result"     answer a [HERA msg from <name>] you received
  hera peek <name> [-n 60]       read another agent's current screen
  hera wait <name>               block until that agent goes idle, then print its screen
  hera key <name> enter|esc|y|1  press keys in another session (e.g. approve a prompt)
  hera spawn <agent>             start a new helper (claude, codex, agy, grok, ...)
                                 in this project; prints its name
  hera projects | hera open <project> [--agent claude]

Names look like claude-1, codex-1, agy-1. You may also use the agent id
("codex") when exactly one such session exists in this project, or "main".
Long messages (>1500 chars) are delivered as a file path automatically.

Good practice for a main agent:
  - split work into independent pieces; give each helper a self-contained task with
    paths, acceptance criteria and what to report back;
  - prefer \`hera ask\` for short tasks and \`hera send\` + continue working for long ones;
  - verify helpers' results yourself before relying on them.
When you receive "[HERA msg from X] ..." do the task, then run: hera reply X "<summary>"
`

const HELP = `hera — JYSV HERA multi-agent CLI

usage: hera <command> [args]

  list [--all] [--json]             list agent/terminal sessions
  ask <target> <message...>         send a task and wait for the result  [--idle 6] [--timeout 1800] [-n 80]
  send <target> <message...>        send a task (no wait)                [--raw] [--no-enter] [--file f] ("-" = stdin)
  reply <target> <message...>       reply to a received message
  peek <target> [-n 40]             print the target's screen
  wait <target>                     wait until target is idle            [--idle 5] [--timeout 1800]
  key <target> <keys...>            press keys: enter esc tab up down left right ctrl-c y n 1 ...
  spawn <agent> [--cmd "..."]       start a helper session in this project [--project p] [--resume] [--no-split]
  projects | add [path] | open <project> [--agent a] [--resume]
  whoami | status | log [-n 30] | guide | --version
  statusline-tap [-- original statusline command]   (Claude Code statusLine integration)
`

async function statuslineTap(parsed: Parsed) {
  const input = await readStdin()

  try {
    const payload = JSON.parse(input || '{}')

    if (payload?.rate_limits && typeof payload.rate_limits === 'object') {
      fs.mkdirSync(dataDir(), { recursive: true })
      fs.writeFileSync(
        path.join(dataDir(), 'claude-caps.json'),
        JSON.stringify({ capturedAt: Date.now(), rate_limits: payload.rate_limits, model: payload?.model?.id || null })
      )
    }
  } catch {
    // not JSON; still forward
  }

  if (parsed.rest.length) {
    const command = parsed.rest.join(' ')
    const child = spawn(command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    child.stdin.end(input)
    child.on('exit', code => process.exit(code ?? 0))

    return
  }

  try {
    const payload = JSON.parse(input || '{}')
    const limits = payload?.rate_limits || {}
    const parts = Object.entries(limits).map(([key, value]) => {
      const pct = (value as { used_percentage?: number })?.used_percentage

      return `${key === 'five_hour' ? '5h' : key === 'seven_day' ? '7d' : key} ${pct ?? '?'}%`
    })
    out(['HERA', payload?.model?.display_name, ...parts].filter(Boolean).join(' · '))
  } catch {
    out('HERA')
  }
}

declare const __HERA_VERSION__: string

async function main() {
  const [command = 'help', ...argv] = process.argv.slice(2)
  const parsed = parse(argv)
  const json = parsed.flags.json === true
  const target = parsed.positional[0]
  const needTarget = () => target || fail(`usage: hera ${command} <target> ...  (see \`hera list\`)`)

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      out(HELP)
      break

    case 'guide':
      out(GUIDE)
      break

    case 'version':
    case '--version':
    case '-v':
      out(`JYSV HERA ${__HERA_VERSION__}`)
      break

    case 'statusline-tap':
      await statuslineTap(parsed)
      break

    case 'ls':
    case 'list': {
      const rows = (await call('list', { all: parsed.flags.all === true })) as SessionRow[]
      out(json ? JSON.stringify(rows, null, 2) : table(rows))
      break
    }

    case 'whoami': {
      const me = await call('whoami')
      out(me ? JSON.stringify(me, null, 2) : 'not inside a HERA session (HERA_SESSION_ID unset)')
      break
    }

    case 'send':
    case 'reply': {
      needTarget()
      const text = await messageFrom(parsed, 1)

      if (!text.trim()) fail('message is empty')

      const result = (await call(command, {
        target,
        text,
        raw: parsed.flags.raw === true,
        enter: parsed.flags['no-enter'] !== true
      })) as { to: string; file: string | null }
      out(`${command === 'send' ? 'sent' : 'replied'} → ${result.to}${result.file ? ` (as file ${result.file})` : ''}`)
      break
    }

    case 'ask': {
      needTarget()
      const text = await messageFrom(parsed, 1)

      if (!text.trim()) fail('message is empty')

      const timeout = num(parsed.flags.timeout, 1800)
      const result = (await call(
        'ask',
        { target, text, idle: num(parsed.flags.idle, 6), timeout, lines: num(parsed.flags.n ?? parsed.flags.lines, 80), raw: parsed.flags.raw === true },
        (timeout + 30) * 1000
      )) as { name: string; status: string; lines: string[]; waitedMs: number }
      json ? out(JSON.stringify(result, null, 2)) : printScreen(result, 'answer from')
      break
    }

    case 'peek': {
      needTarget()
      const result = (await call('peek', { target, lines: num(parsed.flags.n ?? parsed.flags.lines, 40), scrollback: parsed.flags.scrollback === true })) as {
        name: string
        status: string
        lines: string[]
      }
      json ? out(JSON.stringify(result, null, 2)) : printScreen(result, 'screen of')
      break
    }

    case 'wait': {
      needTarget()
      const timeout = num(parsed.flags.timeout, 1800)
      const result = (await call('wait', { target, idle: num(parsed.flags.idle, 5), timeout, lines: num(parsed.flags.n, 60) }, (timeout + 30) * 1000)) as {
        name: string
        status: string
        lines: string[]
        waitedMs: number
      }
      json ? out(JSON.stringify(result, null, 2)) : printScreen(result, 'done:')
      break
    }

    case 'key':
    case 'keys': {
      needTarget()
      const keys = parsed.positional.slice(1)

      if (!keys.length) fail('usage: hera key <target> enter|esc|y|1 ...')

      const result = (await call('key', { target, keys })) as { to: string; unknown: string[] }
      out(`keys → ${result.to}${result.unknown.length ? ` (unknown: ${result.unknown.join(' ')})` : ''}`)
      break
    }

    case 'spawn': {
      const result = (await call('spawn', {
        agent: target || '',
        project: parsed.flags.project,
        command: parsed.flags.cmd,
        role: parsed.flags.role || 'helper',
        resume: parsed.flags.resume === true,
        split: parsed.flags['no-split'] !== true
      })) as { name: string }
      out(`spawned ${result.name} — give it a few seconds to boot, then: hera ask ${result.name} "..."`)
      break
    }

    case 'projects': {
      const rows = (await call('projects')) as { name: string; path: string }[]
      out(json ? JSON.stringify(rows, null, 2) : rows.map(row => `${row.name.padEnd(28)} ${row.path}`).join('\n') || '(no projects)')
      break
    }

    case 'add': {
      const result = (await call('add', { path: target ? path.resolve(target) : process.cwd(), name: parsed.flags.name })) as { name: string; path: string }
      out(`registered ${result.name} → ${result.path}`)
      break
    }

    case 'open': {
      needTarget()
      const result = (await call('open', { project: target, agent: parsed.flags.agent, resume: parsed.flags.resume === true })) as { name: string; project: string }
      out(`opened ${result.name} in ${result.project}`)
      break
    }

    case 'focus': {
      await call('focus', { target })
      break
    }

    case 'log': {
      const rows = (await call('history', { limit: num(parsed.flags.n ?? parsed.flags.limit, 30) })) as {
        t: number
        kind: string
        fromName: string
        toName: string
        text: string
      }[]
      out(
        json
          ? JSON.stringify(rows, null, 2)
          : rows
              .map(row => `${new Date(row.t).toLocaleTimeString()}  ${row.kind.padEnd(5)} ${row.fromName} → ${row.toName}: ${row.text.replace(/\s+/g, ' ').slice(0, 120)}`)
              .join('\n') || '(no messages)'
      )
      break
    }

    case 'status': {
      const result = await call('status')
      out(JSON.stringify(result, null, 2))
      break
    }

    default:
      fail(`unknown command '${command}'. try: hera help`)
  }
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)))
