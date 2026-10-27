// Agents → Extensions & updates. Two lists:
//  - the AI CLIs and other global tools with the version on hand and the latest
//    (npm / Homebrew / uv / pipx, or the CLI's own updater), and
//  - what each CLI has plugged in (plugins, MCP servers, skills), read from its own config files.
// Updates run in a HERA terminal tab, so a password prompt or an error stays in front of the
// user. Only commands HERA built here can run: the renderer sends ids, never command lines.
import { exec, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { t } from '../shared/i18n'
import type { AgentDef, CliExtensions, ExtensionGroup, ExtensionItem, ToolPackage, ToolPackages } from '../shared/types'
import { findOnPath, hydrateLoginPath, isWin } from './paths'
import { quoteArg, type ShellSpec } from './shell'
import { getConfig } from './store'

type ShellKind = ShellSpec['kind']
type Json = Record<string, unknown>

const home = os.homedir()
const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config')
/** Package names, plugin ids, formulas: nothing a shell reads specially gets into a command. */
const SAFE_NAME = /^[@\w][\w@./:+~-]*$/
/** How long a package check stays fresh. */
const FRESH_MS = 10 * 60_000

// ---------------------------------------------------------------- helpers

const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
const tilde = (file: string) => (file.startsWith(home) ? `~${file.slice(home.length)}` : file).replace(/\\/g, '/')
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const oneLine = (text: string | undefined, max = 160) => {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || undefined
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
  } catch {
    return null
  }
}

/** JSON, or JSON with comments and trailing commas (opencode.jsonc, VS Code style settings). */
function readJsonc(file: string): Json | null {
  const text = readText(file)
  if (text === null) return null
  try {
    return obj(JSON.parse(text))
  } catch {
    // fall through to the comment-tolerant parse
  }

  let out = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++
      out += '\n'
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end < 0 ? text.length : end + 1
    } else {
      out += char
    }
  }

  try {
    return obj(JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')))
  } catch {
    return null
  }
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort(byName)
  } catch {
    return []
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (value: string) => path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return isWin || process.platform === 'darwin' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

function run(file: string, args: string[], timeout: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolve => {
    const options = {
      timeout,
      maxBuffer: 16 << 20,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', npm_config_update_notifier: 'false', HOMEBREW_NO_AUTO_UPDATE: '1' }
    }
    const done = (error: Error | null, stdout: string | Buffer) => resolve({ ok: !error, stdout: String(stdout || '') })
    // .cmd shims (npm, CLIs installed by npm on Windows) need a shell; the args are this file's own.
    if (/\.(cmd|bat)$/i.test(file)) exec([file, ...args].map(part => `"${part}"`).join(' '), options, done)
    else execFile(file, args, options, done)
  })
}

function parseJson(text: string): Json | null {
  try {
    return obj(JSON.parse(text))
  } catch {
    return null
  }
}

/** a > b for dotted versions (1.10.0 > 1.9.3); pre-release tags are ignored. */
function newer(a: string, b: string): boolean {
  const parts = (value: string) => (/\d+(\.\d+)*/.exec(value)?.[0] || '0').split('.').map(Number)
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff) return diff > 0
  }
  return false
}

// ---------------------------------------------------------------- update actions

/** Update id → the command lines it runs. Filled by the scans, so only ids HERA listed can run. */
const actions = new Map<string, { label: string; argv: string[][] }>()

/** One command line for the given shell; plain words stay unquoted so the tab reads naturally. */
function commandLine(kind: ShellKind, argv: string[]): string {
  return argv.map(part => (/^[\w./:=+-]+$/.test(part) ? part : quoteArg(kind, part))).join(' ')
}

function action(id: string, label: string, argv: string[][]): { updateId: string; command: string } {
  actions.set(id, { label, argv })

  return { updateId: id, command: argv.map(line => line.join(' ')).join(' ; ') }
}

/** What `tools:update` types into a new tab for these ids, or null when none is known. */
export function toolUpdateLine(ids: string[], kind: ShellKind): { line: string; label: string } | null {
  const picked = ids.map(id => actions.get(String(id))).filter((entry): entry is { label: string; argv: string[][] } => Boolean(entry))
  if (!picked.length) return null

  // Versions change once this runs: the next visit asks again.
  packagesCache = null
  const lines = [...new Set(picked.flatMap(entry => entry.argv.map(argv => commandLine(kind, argv))))]

  return {
    line: lines.join(kind === 'cmd' ? ' & ' : ' ; '),
    label: picked.length === 1 ? picked[0].label : t('{count}개', { count: picked.length })
  }
}

// ---------------------------------------------------------------- packages

function hinted(agents: AgentDef[], pattern: RegExp): Map<string, string> {
  const out = new Map<string, string>()
  for (const agent of agents) {
    const match = pattern.exec(agent.installHint || '')
    if (match) out.set(match[1], agent.id)
  }
  return out
}

async function npmPackages(agents: AgentDef[], errors: string[]): Promise<ToolPackage[]> {
  const npm = findOnPath('npm')
  if (!npm) return []

  const [listed, outdated] = await Promise.all([run(npm, ['ls', '-g', '--depth=0', '--json'], 30_000), run(npm, ['outdated', '-g', '--json'], 90_000)])
  const deps = obj(parseJson(listed.stdout)?.dependencies)
  // `npm outdated` exits 1 when something is outdated; only unreadable output means it failed.
  const late = parseJson(outdated.stdout)
  if (!late) errors.push(t('npm: 최신 버전을 확인하지 못했습니다 (인터넷 연결을 확인하세요).'))
  const agentOf = hinted(agents, /\bnpm\s+(?:i|install)\s+(?:-g|--global)\s+(@?[\w./-]+)/)

  return Object.entries(deps)
    .map(([name, value]) => ({ name, version: str(obj(value).version) }))
    .filter((entry): entry is { name: string; version: string } => Boolean(entry.version) && SAFE_NAME.test(entry.name))
    .map(({ name, version }) => {
      const latest = late ? str(obj(late[name]).latest) || version : undefined

      return {
        id: `npm:${name}`,
        manager: 'npm' as const,
        name,
        agentId: agentOf.get(name),
        current: version,
        latest,
        outdated: Boolean(latest && newer(latest, version)),
        command: action(`npm:${name}`, name, [['npm', 'install', '-g', `${name}@latest`]]).command
      }
    })
}

/** Homebrew: only the formulas / casks an AI CLI on PATH comes from (not everything brew has). */
async function brewPackages(agents: AgentDef[]): Promise<ToolPackage[]> {
  const brew = isWin ? null : findOnPath('brew')
  if (!brew) return []

  const found = new Map<string, { agentId: string; cask: boolean; version: string }>()
  for (const agent of agents) {
    const exe = findOnPath(agent.command.trim().split(/\s+/)[0])
    if (!exe) continue
    let real = exe
    try {
      real = fs.realpathSync(exe)
    } catch {
      // keep the PATH entry
    }
    const match = /\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)\//.exec(real)
    if (match && SAFE_NAME.test(match[2])) found.set(match[2], { agentId: agent.id, cask: match[1] === 'Caskroom', version: match[3].replace(/_\d+$/, '') })
  }
  if (!found.size) return []

  const report = parseJson((await run(brew, ['outdated', '--json=v2', ...found.keys()], 60_000)).stdout)
  const late = new Map<string, string>()
  for (const entry of [...(Array.isArray(report?.formulae) ? report.formulae : []), ...(Array.isArray(report?.casks) ? report.casks : [])]) {
    const name = str(obj(entry).name)
    const current = str(obj(entry).current_version)
    if (name && current) late.set(name, current)
  }

  return [...found].map(([name, info]) => ({
    id: `brew:${name}`,
    manager: 'brew' as const,
    name,
    agentId: info.agentId,
    current: info.version,
    latest: report ? late.get(name) || info.version : undefined,
    outdated: late.has(name),
    command: action(`brew:${name}`, name, [['brew', 'upgrade', ...(info.cask ? ['--cask'] : []), name]]).command
  }))
}

/** uv / pipx tools: listed with their version; the latest is only known by upgrading. */
async function pythonTools(agents: AgentDef[], manager: 'uv' | 'pipx'): Promise<ToolPackage[]> {
  const exe = findOnPath(manager)
  if (!exe) return []

  const listing = await run(exe, manager === 'uv' ? ['tool', 'list'] : ['list', '--short'], 20_000)
  const pattern = manager === 'uv' ? /^([A-Za-z0-9][\w.-]*) v(\S+)/ : /^([A-Za-z0-9][\w.-]*) (\S+)/
  const agentOf = hinted(agents, manager === 'uv' ? /\buv\s+tool\s+install\s+([\w.-]+)/ : /\bpipx\s+install\s+([\w.-]+)/)
  const out: ToolPackage[] = []

  for (const row of listing.stdout.split(/\r?\n/)) {
    const match = pattern.exec(row)
    if (!match || !SAFE_NAME.test(match[1])) continue
    const name = match[1]
    out.push({
      id: `${manager}:${name}`,
      manager,
      name,
      agentId: agentOf.get(name),
      current: match[2],
      outdated: false,
      command: action(`${manager}:${name}`, name, [manager === 'uv' ? ['uv', 'tool', 'upgrade', name] : ['pipx', 'upgrade', name]]).command
    })
  }

  return out
}

/** CLIs that update themselves, used when no package manager above provides them. */
const SELF_UPDATE: Record<string, string[]> = {
  claude: ['update'],
  codex: ['update'],
  agy: ['update'],
  hermes: ['update'],
  opencode: ['upgrade']
}

async function selfUpdaters(agents: AgentDef[], covered: ToolPackage[]): Promise<ToolPackage[]> {
  const taken = new Set(covered.map(entry => entry.agentId).filter(Boolean))
  const found = await Promise.all(
    agents
      .filter(agent => agent.enabled && SELF_UPDATE[agent.id] && !taken.has(agent.id))
      .map(async (agent): Promise<ToolPackage | null> => {
        const program = agent.command.trim().split(/\s+/)[0]
        const exe = findOnPath(program)
        if (!exe || !SAFE_NAME.test(program)) return null
        const version = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec((await run(exe, ['--version'], 15_000)).stdout)?.[0]

        return {
          id: `self:${agent.id}`,
          manager: 'self',
          name: program,
          agentId: agent.id,
          current: version,
          outdated: false,
          command: action(`self:${agent.id}`, agent.name, [[program, ...SELF_UPDATE[agent.id]]]).command
        }
      })
  )

  return found.filter((entry): entry is ToolPackage => Boolean(entry))
}

let packagesCache: ToolPackages | null = null
let packagesRun: Promise<ToolPackages> | null = null

/** The tools with their versions; asks the package managers at most every few minutes unless forced. */
export function toolPackages(force = false): Promise<ToolPackages> {
  if (!force && packagesCache && Date.now() - packagesCache.checkedAt < FRESH_MS) return Promise.resolve(packagesCache)
  if (packagesRun) return packagesRun

  packagesRun = (async () => {
    await hydrateLoginPath()
    const agents = getConfig().agents
    const errors: string[] = []
    const lists = await Promise.all([npmPackages(agents, errors), brewPackages(agents), pythonTools(agents, 'uv'), pythonTools(agents, 'pipx')])
    const packages = lists.flat()
    packages.push(...(await selfUpdaters(agents, packages)))
    // Outdated first, then the AI CLIs, then the rest by name.
    packages.sort((a, b) => Number(b.outdated) - Number(a.outdated) || Number(Boolean(b.agentId)) - Number(Boolean(a.agentId)) || byName(a.name, b.name))
    packagesCache = { packages, checkedAt: Date.now(), errors }

    return packagesCache
  })().finally(() => {
    packagesRun = null
  })

  return packagesRun
}

// ---------------------------------------------------------------- what each CLI has plugged in

const RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'uvx', 'pipx', 'pnpm', 'bun', 'uv', 'yarn', 'docker'])

/** A short, secret-free description of an MCP server: the package or program it runs, or the host. */
function describeServer(value: unknown): string | undefined {
  const server = obj(value)
  const url = str(server.url) || str(server.httpUrl) || str(server.serverUrl)
  if (url) {
    try {
      return new URL(url).host
    } catch {
      return 'http'
    }
  }

  const argv = Array.isArray(server.command)
    ? server.command.map(String)
    : [str(server.command) || '', ...(Array.isArray(server.args) ? server.args.map(String) : [])]
  const program = path.basename(argv[0] || '').replace(/\.(cmd|exe|bat|ps1)$/i, '')
  if (!program) return undefined
  if (!RUNNERS.has(program)) return program

  const target = argv.slice(1).find(part => !part.startsWith('-') && !['run', 'dlx', 'x', 'exec', 'tool'].includes(part))
  if (!target) return program

  return `${program} ${/[\\/]/.test(target) && !target.startsWith('@') ? path.basename(target) : target}`
}

function mcpGroup(source: string, servers: unknown, scope: ExtensionItem['scope']): ExtensionGroup | null {
  const items = Object.entries(obj(servers))
    .sort(([a], [b]) => byName(a, b))
    .map(([name, value]) => ({
      name,
      detail: describeServer(value),
      enabled: !(obj(value).disabled === true || obj(value).enabled === false),
      scope
    }))

  return items.length ? { kind: 'mcp', source: tilde(source), items } : null
}

/** `---` front matter of a SKILL.md: name and description (a folded `>` value too). */
function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}

  const out: Record<string, string> = {}
  let key = ''
  for (const row of match[1].split(/\r?\n/)) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(row)
    if (pair) {
      key = pair[1]
      out[key] = pair[2].replace(/^[>|][-+]?\s*$/, '').replace(/^(["'])(.*)\1$/, '$2')
    } else if (key && /^\s+\S/.test(row)) {
      out[key] = `${out[key]} ${row.trim()}`.trim()
    }
  }

  return out
}

/** Skills that `npx skills` installed (its lock file), by name → source repo. */
function skillsLock(): Map<string, string> {
  const lock = obj(readJsonc(path.join(home, '.agents', '.skill-lock.json'))?.skills)

  return new Map(Object.entries(lock).map(([name, value]) => [name, str(obj(value).source) || '']))
}

function skillGroup(dir: string, scope: ExtensionItem['scope'], lock: Map<string, string>): ExtensionGroup | null {
  const items: ExtensionItem[] = []

  for (const name of listDir(dir)) {
    if (name.startsWith('.')) continue
    const folder = path.join(dir, name)
    const file = ['SKILL.md', 'skill.md'].map(entry => path.join(folder, entry)).find(entry => fs.existsSync(entry))
    if (!file) continue

    const meta = frontMatter(readText(file)?.slice(0, 16_384) || '')
    const item: ExtensionItem = { name: meta.name || name, detail: oneLine(meta.description) || lock.get(name) || undefined, scope }
    // A skill cloned with git updates with a pull.
    if (fs.existsSync(path.join(folder, '.git'))) Object.assign(item, action(`skill-git:${folder}`, item.name, [['git', '-C', folder, 'pull', '--ff-only']]))
    items.push(item)
  }
  if (!items.length) return null

  const group: ExtensionGroup = { kind: 'skills', source: tilde(dir), items }
  // Skills from `npx skills add` update together.
  if (items.some(item => lock.has(item.name))) Object.assign(group, action('skills-cli', t('스킬 (npx skills)'), [['npx', '-y', 'skills', 'update']]))

  return group
}

/** What a Claude Code plugin brings: skills, commands, agents, MCP servers. */
function pluginContents(installPath: string | undefined): string | undefined {
  if (!installPath) return undefined
  const count = (sub: string) => listDir(path.join(installPath, sub)).filter(name => !name.startsWith('.')).length
  const mcp = Object.keys(obj(readJsonc(path.join(installPath, '.mcp.json'))?.mcpServers)).length
  const skills = count('skills')
  const commands = count('commands')
  const agents = count('agents')
  const parts = [
    skills && t('스킬 {count}', { count: skills }),
    commands && t('명령 {count}', { count: commands }),
    agents && t('에이전트 {count}', { count: agents }),
    mcp && t('MCP {count}', { count: mcp })
  ].filter(Boolean)

  return parts.join(' · ') || undefined
}

function scopeOf(value: unknown): ExtensionItem['scope'] {
  return value === 'project' || value === 'local' || value === 'user' ? value : undefined
}

function claudeCode(project: string | null, lock: Map<string, string>): CliExtensions {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const groups: (ExtensionGroup | null)[] = []

  const installed = obj(readJsonc(path.join(dir, 'plugins', 'installed_plugins.json'))?.plugins)
  const enabled = obj(readJsonc(path.join(dir, 'settings.json'))?.enabledPlugins)
  const ids = Object.keys(installed).filter(id => SAFE_NAME.test(id)).sort(byName)
  if (ids.length) {
    groups.push({
      kind: 'plugins',
      source: tilde(path.join(dir, 'plugins')),
      items: ids.map(id => {
        const raw = installed[id]
        const entry = obj(Array.isArray(raw) ? raw[0] : raw)
        return {
          name: id,
          version: str(entry.version),
          scope: scopeOf(entry.scope),
          enabled: id in enabled ? enabled[id] === true : undefined,
          detail: pluginContents(str(entry.installPath)),
          ...action(`claude-plugin:${id}`, id, [['claude', 'plugin', 'update', id]])
        }
      }),
      // Refresh the marketplaces first so `update` sees their newest versions.
      ...action('claude-plugins', t('Claude Code 플러그인'), [['claude', 'plugin', 'marketplace', 'update'], ...ids.map(id => ['claude', 'plugin', 'update', id])])
    })
  }

  const statePath = process.env.CLAUDE_CONFIG_DIR ? path.join(dir, '.claude.json') : path.join(home, '.claude.json')
  const state = readJsonc(statePath) || {}
  groups.push(mcpGroup(statePath, state.mcpServers, 'user'))
  if (project) {
    const projects = obj(state.projects)
    const key = Object.keys(projects).find(entry => samePath(entry, project))
    if (key) groups.push(mcpGroup(statePath, obj(projects[key]).mcpServers, 'local'))
    groups.push(mcpGroup(path.join(project, '.mcp.json'), readJsonc(path.join(project, '.mcp.json'))?.mcpServers, 'project'))
    groups.push(skillGroup(path.join(project, '.claude', 'skills'), 'project', lock))
  }
  groups.push(skillGroup(path.join(dir, 'skills'), 'user', lock))

  return { id: 'claude', name: 'Claude Code', agentId: 'claude', groups: groups.filter((group): group is ExtensionGroup => Boolean(group)) }
}

/** The tables of a TOML file, enough for Codex's config.toml: `[a."b c".d]` → ['a', 'b c', 'd'] with its raw values. */
function tomlTables(text: string): { path: string[]; values: Record<string, string> }[] {
  const unquote = (value: string) => value.replace(/^"(.*)"$|^'(.*)'$/, (_all, a, b) => a ?? b)
  const tables: { path: string[]; values: Record<string, string> }[] = [{ path: [], values: {} }]

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[[')) {
      tables.push({ path: ['\u0000'], values: {} })
      continue
    }
    if (line.startsWith('[')) {
      const parts: string[] = []
      const pattern = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^."'\s\]]+)\s*(\.|\])/y
      pattern.lastIndex = 1
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        parts.push(unquote(match[1]))
        if (match[2] === ']') break
      }
      tables.push({ path: parts, values: {} })
      continue
    }
    const pair = /^("[^"]*"|'[^']*'|[\w-]+)\s*=\s*(.*)$/.exec(line)
    if (pair) tables[tables.length - 1].values[unquote(pair[1])] = pair[2].trim()
  }

  return tables
}

function tomlStrings(raw: string | undefined): string[] {
  const out: string[] = []
  for (const match of (raw || '').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    if (match[2] !== undefined) out.push(match[2])
    else {
      try {
        out.push(JSON.parse(`"${match[1]}"`) as string)
      } catch {
        out.push(match[1])
      }
    }
  }
  return out
}

function codex(lock: Map<string, string>): CliExtensions {
  const dir = process.env.CODEX_HOME || path.join(home, '.codex')
  const file = path.join(dir, 'config.toml')
  const tables = tomlTables(readText(file) || '')
  const groups: (ExtensionGroup | null)[] = []

  const plugins = tables
    .filter(table => table.path[0] === 'plugins' && table.path.length === 2)
    .map(table => ({ name: table.path[1], enabled: table.values.enabled !== 'false' }))
    .sort((a, b) => byName(a.name, b.name))
  if (plugins.length) {
    groups.push({ kind: 'plugins', source: tilde(file), items: plugins, ...action('codex-plugins', t('Codex 플러그인'), [['codex', 'plugin', 'marketplace', 'upgrade']]) })
  }

  const servers: Json = {}
  for (const table of tables) {
    if (table.path[0] !== 'mcp_servers' || table.path.length !== 2) continue
    servers[table.path[1]] = {
      command: tomlStrings(table.values.command)[0],
      args: tomlStrings(table.values.args),
      url: tomlStrings(table.values.url)[0],
      enabled: table.values.enabled !== 'false'
    }
  }
  groups.push(mcpGroup(file, servers, 'user'))
  groups.push(skillGroup(path.join(dir, 'skills'), 'user', lock))

  return { id: 'codex', name: 'Codex', agentId: 'codex', groups: groups.filter((group): group is ExtensionGroup => Boolean(group)) }
}

/** Extension folders of the Gemini CLI family: `<dir>/<name>/<manifest>` with name and version. */
function extensionGroup(dir: string, manifest: string, updateAll: string[][], updateOne: (name: string) => string[]): ExtensionGroup | null {
  const items: ExtensionItem[] = []
  for (const folder of listDir(dir)) {
    const info = readJsonc(path.join(dir, folder, manifest))
    if (!info) continue
    const name = str(info.name) || folder
    items.push({ name, version: str(info.version), detail: oneLine(str(info.description)), ...(SAFE_NAME.test(name) ? action(`ext:${dir}:${name}`, name, [updateOne(name)]) : {}) })
  }

  return items.length ? { kind: 'extensions', source: tilde(dir), items, ...action(`ext-all:${dir}`, tilde(dir), updateAll) } : null
}

function opencode(project: string | null, lock: Map<string, string>): CliExtensions {
  const dir = path.join(xdg, 'opencode')
  const groups: (ExtensionGroup | null)[] = []
  const configs = [...['opencode.json', 'opencode.jsonc', 'config.json'].map(name => path.join(dir, name)), ...(project ? ['opencode.json', 'opencode.jsonc'].map(name => path.join(project, name)) : [])]

  for (const file of configs) {
    const config = readJsonc(file)
    if (!config) continue
    const scope: ExtensionItem['scope'] = project && file.startsWith(project) ? 'project' : 'user'
    const plugins = (Array.isArray(config.plugin) ? config.plugin : []).map(String).filter(Boolean)
    if (plugins.length) groups.push({ kind: 'plugins', source: tilde(file), items: plugins.map(name => ({ name, scope, detail: t('OpenCode 가 시작할 때 설치합니다') })) })
    groups.push(mcpGroup(file, config.mcp, scope))
  }
  groups.push(skillGroup(path.join(dir, 'skill'), 'user', lock), skillGroup(path.join(dir, 'skills'), 'user', lock))

  return { id: 'opencode', name: 'OpenCode', agentId: 'opencode', groups: groups.filter((group): group is ExtensionGroup => Boolean(group)) }
}

/** CLIs whose MCP servers and skills sit in plain JSON files and folders. */
const SIMPLE: { id: string; name: string; agentId?: string; mcp: [string, string][]; projectMcp?: [string, string][]; skills?: string[]; extensions?: () => ExtensionGroup | null }[] = [
  {
    id: 'gemini',
    name: 'Gemini CLI',
    agentId: 'gemini',
    mcp: [[path.join(home, '.gemini', 'settings.json'), 'mcpServers']],
    projectMcp: [[path.join('.gemini', 'settings.json'), 'mcpServers']],
    skills: [path.join(home, '.gemini', 'skills')],
    extensions: () =>
      extensionGroup(path.join(home, '.gemini', 'extensions'), 'gemini-extension.json', [['gemini', 'extensions', 'update', '--all']], name => ['gemini', 'extensions', 'update', name])
  },
  {
    id: 'agy',
    name: 'Antigravity',
    agentId: 'agy',
    mcp: [
      [path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'mcpServers'],
      [path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'), 'mcpServers']
    ],
    skills: [path.join(home, '.gemini', 'antigravity-cli', 'skills')]
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    agentId: 'qwen',
    mcp: [[path.join(home, '.qwen', 'settings.json'), 'mcpServers']],
    projectMcp: [[path.join('.qwen', 'settings.json'), 'mcpServers']],
    skills: [path.join(home, '.qwen', 'skills')],
    extensions: () => extensionGroup(path.join(home, '.qwen', 'extensions'), 'qwen-extension.json', [['qwen', 'extensions', 'update', '--all']], name => ['qwen', 'extensions', 'update', name])
  },
  { id: 'copilot', name: 'Copilot CLI', agentId: 'copilot', mcp: [[path.join(home, '.copilot', 'mcp-config.json'), 'mcpServers']], skills: [path.join(home, '.copilot', 'skills')] },
  { id: 'cursor', name: 'Cursor CLI', agentId: 'cursor', mcp: [[path.join(home, '.cursor', 'mcp.json'), 'mcpServers']], projectMcp: [[path.join('.cursor', 'mcp.json'), 'mcpServers']] },
  { id: 'kiro', name: 'Kiro', agentId: 'kiro', mcp: [[path.join(home, '.kiro', 'settings', 'mcp.json'), 'mcpServers']], projectMcp: [[path.join('.kiro', 'settings', 'mcp.json'), 'mcpServers']] },
  { id: 'droid', name: 'Droid', agentId: 'droid', mcp: [[path.join(home, '.factory', 'mcp.json'), 'mcpServers']] },
  { id: 'kimi', name: 'Kimi CLI', agentId: 'kimi', mcp: [[path.join(home, '.kimi', 'mcp.json'), 'mcpServers']] },
  { id: 'amp', name: 'Amp', agentId: 'amp', mcp: [[path.join(xdg, 'amp', 'settings.json'), 'amp.mcpServers']] },
  { id: 'crush', name: 'Crush', agentId: 'crush', mcp: [[path.join(xdg, 'crush', 'crush.json'), 'mcp']], projectMcp: [['crush.json', 'mcp']] },
  { id: 'hermes', name: 'Hermes Agent', agentId: 'hermes', mcp: [], skills: [path.join(home, '.hermes', 'skills')] }
]

/** Plugins, MCP servers and skills of every AI CLI that has any, for the given project folder. */
export function scanExtensions(project: string | null): CliExtensions[] {
  const lock = skillsLock()
  const agents = getConfig().agents
  const clis: CliExtensions[] = [claudeCode(project, lock), codex(lock), opencode(project, lock)]

  for (const spec of SIMPLE) {
    const groups: (ExtensionGroup | null)[] = []
    for (const [file, key] of spec.mcp) groups.push(mcpGroup(file, readJsonc(file)?.[key], 'user'))
    if (project) for (const [rel, key] of spec.projectMcp || []) groups.push(mcpGroup(path.join(project, rel), readJsonc(path.join(project, rel))?.[key], 'project'))
    groups.push(spec.extensions?.() || null)
    for (const dir of spec.skills || []) groups.push(skillGroup(dir, 'user', lock))
    clis.push({ id: spec.id, name: spec.name, agentId: spec.agentId, groups: groups.filter((group): group is ExtensionGroup => Boolean(group)) })
  }

  // Agent Skills shared by several CLIs (~/.agents/skills, and a project's .agents/skills).
  const shared = [skillGroup(path.join(home, '.agents', 'skills'), 'user', lock), project ? skillGroup(path.join(project, '.agents', 'skills'), 'project', lock) : null]
  clis.push({ id: 'agents', name: t('공용 스킬 (여러 CLI 가 함께 씀)'), groups: shared.filter((group): group is ExtensionGroup => Boolean(group)) })

  const known = new Set(agents.map(agent => agent.id))
  const installedFirst = (cli: CliExtensions) => (cli.agentId && known.has(cli.agentId) && agents.find(agent => agent.id === cli.agentId)?.enabled ? 0 : 1)

  return clis
    .filter(cli => cli.groups.length)
    .map(cli => ({ ...cli, agentId: cli.agentId && known.has(cli.agentId) ? cli.agentId : undefined }))
    .sort((a, b) => installedFirst(a) - installedFirst(b))
}
