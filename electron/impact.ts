// Impact of a change: which files of the project use a file, from their imports. TS / JS
// (relative paths, tsconfig / jsconfig `paths` and `baseUrl` with `extends` and `references`,
// workspace packages by their package.json name) and Python (relative and package imports).
// The index is built on demand, kept for a little while, and rebuilt when asked for again later:
// agents change files all the time, and a stale answer of a few seconds is fine here.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { FileImpact } from '../shared/types'

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']
const PY_EXT = ['.py']
const SOURCE = new Set([...JS_EXT, ...PY_EXT])
// Only for a folder walked by hand: `git ls-files` already leaves out what the project ignores.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.turbo', '.cache'])
const MAX_FILES = 30_000
const MAX_BYTES = 1024 * 1024
// An index younger than this answers again without a rebuild.
const FRESH_MS = 15_000
// Indexes kept (projects and worktree copies), the most recently built ones.
const KEEP_INDEXES = 3
const LIST_MAX = 60
const TEST = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.py$/
const CONFIG = /(^|\/)(?:tsconfig|jsconfig)\.json$/

interface Index {
  root: string
  builtAt: number
  /** Source files, project-relative with '/' separators. */
  files: string[]
  /** More sources than MAX_FILES: the rest were not read. */
  capped: boolean
  /** file → files that import it. */
  importers: Map<string, Set<string>>
}

const indexes = new Map<string, Index>()
const building = new Map<string, Promise<Index>>()

const slash = (file: string) => file.split(path.sep).join('/')
const keyOf = (rel: string) => (process.platform === 'win32' ? rel.toLowerCase() : rel)
const isSource = (file: string) => SOURCE.has(path.posix.extname(file).toLowerCase())
/** 'src/a/../b' → 'src/b'; the root is ''. */
const norm = (rel: string) => path.posix.normalize(rel).replace(/^\.\/?$|^\.\//, '')

function gitFiles(root: string): Promise<string[] | null> {
  return new Promise(resolve => {
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15_000 }, (error, stdout) => {
      if (error) return resolve(null)
      resolve(stdout.split('\0').filter(Boolean))
    })
  })
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  const queue = ['']

  while (queue.length && out.length < MAX_FILES * 4) {
    const dir = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(path.join(root, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(rel)
      } else if (entry.isFile()) out.push(rel)
    }
  }

  return out
}

/** JSON with comments and trailing commas (tsconfig), read loosely. */
function readJsonc(full: string): Record<string, unknown> | null {
  try {
    const text = fs.readFileSync(full, 'utf8')
    // Strings first, so "@/*" or "**/*.ts" is never taken for the start of a comment.
    const clean = text.replace(/("(?:[^"\\\n]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (all, string: string | undefined) => string ?? '').replace(/,(\s*[}\]])/g, '$1')
    const json = JSON.parse(clean)
    return json && typeof json === 'object' ? json : null
  } catch {
    return null
  }
}

interface AliasConfig {
  /** Folder `paths` resolve against: baseUrl, else the config that has them. */
  base: string
  baseUrl: string | null
  paths: [string, string[]][] | null
}

/** One tsconfig with what it extends (relative `extends` only: a package's config names no project folders). */
function loadConfig(root: string, rel: string, depth = 0): AliasConfig | null {
  const json = depth < 6 ? readJsonc(path.join(root, rel)) : null
  if (!json) return null
  const dir = norm(path.posix.dirname(rel))
  let merged: AliasConfig = { base: dir, baseUrl: null, paths: null }
  const parents = Array.isArray(json.extends) ? json.extends : typeof json.extends === 'string' ? [json.extends] : []

  for (const parent of parents) {
    if (typeof parent !== 'string' || !parent.startsWith('.')) continue
    let target = norm(path.posix.join(dir, parent))
    if (!target.endsWith('.json')) target += '.json'
    const inherited = loadConfig(root, target, depth + 1)
    if (inherited) merged = { base: inherited.paths ? inherited.base : merged.base, baseUrl: inherited.baseUrl ?? merged.baseUrl, paths: inherited.paths ?? merged.paths }
  }

  const options = (json.compilerOptions || {}) as Record<string, unknown>
  if (typeof options.baseUrl === 'string') merged.baseUrl = norm(path.posix.join(dir, options.baseUrl))
  if (options.paths && typeof options.paths === 'object') {
    merged.paths = Object.entries(options.paths as Record<string, unknown>).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
    merged.base = dir
  }

  return { ...merged, base: merged.baseUrl ?? merged.base }
}

interface Scope {
  /** Folder the tsconfig / jsconfig is in ('' for the root): it covers the files below. */
  dir: string
  configs: AliasConfig[]
}

/** Each tsconfig / jsconfig with the configs it references (a Vite app keeps its paths in tsconfig.app.json). */
function scopes(root: string, listed: string[]): Scope[] {
  const out: Scope[] = []

  for (const rel of listed.filter(file => CONFIG.test(file))) {
    const dir = norm(path.posix.dirname(rel))
    const configs: AliasConfig[] = []
    const own = loadConfig(root, rel)
    if (own) configs.push(own)
    const json = readJsonc(path.join(root, rel))
    const references = Array.isArray(json?.references) ? (json!.references as Record<string, unknown>[]) : []

    for (const reference of references) {
      if (typeof reference?.path !== 'string') continue
      let target = norm(path.posix.join(dir, reference.path))
      if (!target.endsWith('.json')) target = norm(`${target}/tsconfig.json`)
      const config = loadConfig(root, target)
      if (config) configs.push(config)
    }

    if (configs.some(config => config.paths || config.baseUrl)) out.push({ dir, configs })
  }

  // The nearest config above a file is the one that counts.
  return out.sort((a, b) => b.dir.length - a.dir.length)
}

/** Workspace packages (package.json `name`) → their folder and the file they start from. */
async function packages(root: string, listed: string[]): Promise<Map<string, { dir: string; entry: string | null }>> {
  const out = new Map<string, { dir: string; entry: string | null }>()

  for (const rel of listed.filter(file => /(^|\/)package\.json$/.test(file)).slice(0, 500)) {
    try {
      const json = JSON.parse(await fs.promises.readFile(path.join(root, rel), 'utf8'))
      if (typeof json?.name !== 'string' || !json.name) continue
      const entry = typeof json.source === 'string' ? json.source : typeof json.main === 'string' ? json.main : null
      out.set(json.name, { dir: norm(path.posix.dirname(rel)), entry })
    } catch {
      // not readable: that package is not resolved
    }
  }

  return out
}

/** A match in a line that starts as a comment is not an import. */
function inComment(text: string, at: number): boolean {
  const start = text.lastIndexOf('\n', at) + 1
  const before = text.slice(start, at).trimStart()

  return before.startsWith('//') || before.startsWith('*') || before.startsWith('/*')
}

function jsSpecifiers(text: string): string[] {
  const out: string[] = []
  // `… from 'x'`, `import 'x'`, `import('x')`, `require('x')`: each anchored on its keyword, so one pass.
  const re = /(?:^|[^\w$.])(?:from|import|require)\s*\(?\s*['"]([^'"\n]{1,300})['"]/g
  let match = re.exec(text)

  while (match) {
    if (!inComment(text, match.index)) out.push(match[1])
    match = re.exec(text)
  }

  return out
}

function pySpecifiers(text: string): string[] {
  const out: string[] = []
  // `from x import a, b`, also over several lines in parentheses.
  const fromRe = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm
  let match = fromRe.exec(text)

  while (match) {
    const module = match[1]
    // `from . import a, b` names modules; `from .x import y` names x (y may be a module too).
    const names = match[2]
      .replace(/#[^\n]*/g, '')
      .replace(/[()\\]/g, '')
      .split(',')
      .map(name => name.trim().split(/\s+as\s+/)[0])
      .filter(name => /^[\w]+$/.test(name))
    if (/^\.+$/.test(module)) for (const name of names) out.push(`${module}${name}`)
    else {
      out.push(module)
      for (const name of names) out.push(`${module}.${name}`)
    }
    match = fromRe.exec(text)
  }

  const importRe = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm
  match = importRe.exec(text)
  while (match) {
    for (const name of match[1].split(',')) out.push(name.trim())
    match = importRe.exec(text)
  }

  return out
}

function resolver(files: string[], scopeList: Scope[], workspace: Map<string, { dir: string; entry: string | null }>) {
  const known = new Map(files.map(file => [keyOf(file), file]))
  const has = (rel: string) => known.get(keyOf(norm(rel)))

  const jsTarget = (rel: string): string | undefined => {
    const direct = has(rel)
    if (direct) return direct
    // TypeScript ESM writes `./x.js` for `./x.ts`.
    const stem = rel.replace(/\.(?:js|jsx|mjs|cjs)$/, '')
    for (const ext of JS_EXT) {
      const hit = has(`${stem}${ext}`) || has(`${rel}${ext}`) || has(`${rel}/index${ext}`)
      if (hit) return hit
    }
    return undefined
  }

  const scopeOf = (importer: string) => scopeList.find(scope => !scope.dir || importer.startsWith(`${scope.dir}/`))

  const alias = (importer: string, spec: string): string | undefined => {
    for (const config of scopeOf(importer)?.configs || []) {
      for (const [pattern, targets] of config.paths || []) {
        const star = pattern.indexOf('*')
        const prefix = star < 0 ? pattern : pattern.slice(0, star)
        const suffix = star < 0 ? '' : pattern.slice(star + 1)
        if (star < 0 ? spec !== pattern : !(spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length)) continue
        const middle = star < 0 ? '' : spec.slice(prefix.length, spec.length - suffix.length)
        for (const target of targets) {
          const hit = typeof target === 'string' ? jsTarget(path.posix.join(config.base, target.replace('*', middle))) : undefined
          if (hit) return hit
        }
      }
      // `baseUrl` alone: `import 'lib/a'` is `<baseUrl>/lib/a`.
      const hit = config.baseUrl !== null ? jsTarget(path.posix.join(config.baseUrl, spec)) : undefined
      if (hit) return hit
    }
    return undefined
  }

  const pkg = (spec: string): string | undefined => {
    const parts = spec.split('/')
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    const found = workspace.get(name)
    if (!found) return undefined
    const sub = spec.slice(name.length + 1)
    if (sub) return jsTarget(path.posix.join(found.dir, sub)) || jsTarget(path.posix.join(found.dir, 'src', sub))
    // The package's own source, not its build output.
    const entry = found.entry ? path.posix.join(found.dir, found.entry).replace(/(^|\/)(?:dist|build|lib|out)\//, '$1src/') : null
    return (entry && jsTarget(entry)) || jsTarget(path.posix.join(found.dir, 'src/index')) || jsTarget(path.posix.join(found.dir, 'index'))
  }

  const js = (importer: string, spec: string): string | undefined => {
    if (spec.startsWith('.')) return jsTarget(path.posix.join(path.posix.dirname(importer), spec))
    if (spec.startsWith('/')) return jsTarget(spec.slice(1))
    return alias(importer, spec) || pkg(spec)
  }

  const py = (importer: string, spec: string): string | undefined => {
    const dots = /^\.*/.exec(spec)![0].length
    const rest = spec.slice(dots).replace(/\./g, '/')
    const roots = dots ? [path.posix.join(path.posix.dirname(importer), ...Array(dots - 1).fill('..'))] : ['', 'src']
    for (const dir of roots) {
      const rel = path.posix.join(dir, rest)
      const hit = (rest && has(`${rel}.py`)) || has(`${rel}/__init__.py`)
      if (hit) return hit
    }
    return undefined
  }

  return { js, py }
}

async function build(root: string): Promise<Index> {
  const listed = ((await gitFiles(root)) || (await walk(root))).map(slash)
  const sources = listed.filter(isSource)
  const files = sources.slice(0, MAX_FILES)
  const resolve = resolver(files, scopes(root, listed), await packages(root, listed))
  const importers = new Map<string, Set<string>>()
  let next = 0

  const work = async () => {
    while (next < files.length) {
      const file = files[next++]
      let text: string
      try {
        const full = path.join(root, file)
        if ((await fs.promises.stat(full)).size > MAX_BYTES) continue
        text = await fs.promises.readFile(full, 'utf8')
      } catch {
        continue
      }
      const python = path.posix.extname(file).toLowerCase() === '.py'
      for (const spec of python ? pySpecifiers(text) : jsSpecifiers(text)) {
        const target = python ? resolve.py(file, spec) : resolve.js(file, spec)
        if (!target || target === file) continue
        const key = keyOf(target)
        const set = importers.get(key) || new Set<string>()
        set.add(file)
        importers.set(key, set)
      }
    }
  }

  await Promise.all(Array.from({ length: 16 }, work))

  return { root, builtAt: Date.now(), files, capped: sources.length > files.length, importers }
}

async function indexFor(root: string): Promise<Index> {
  const cached = indexes.get(root)
  if (cached && Date.now() - cached.builtAt < FRESH_MS) return cached

  let pending = building.get(root)
  if (!pending) {
    pending = build(root).finally(() => building.delete(root))
    building.set(root, pending)
  }
  const index = await pending
  indexes.delete(root)
  indexes.set(root, index)
  // Map order is insertion order: the first one is the least recently built.
  while (indexes.size > KEEP_INDEXES) indexes.delete(indexes.keys().next().value!)

  return index
}

/** Tests named after the file even when they do not import it (foo.ts → foo.test.ts, test_foo.py). */
function namedTests(index: Index, rel: string): string[] {
  const ext = path.posix.extname(rel)
  const stem = path.posix.basename(rel, ext)
  const names = new Set([`${stem}.test${ext}`, `${stem}.spec${ext}`, `test_${stem}.py`, `${stem}_test.py`].map(name => name.toLowerCase()))

  return index.files.filter(file => names.has(path.posix.basename(file).toLowerCase()))
}

/** What depends on one file of the project (root: the project or worktree folder holding it). */
export async function fileImpact(root: string, file: string): Promise<FileImpact> {
  const rel = slash(path.relative(root, file))
  const supported = SOURCE.has(path.extname(file).toLowerCase())
  if (!supported || rel.startsWith('..') || path.isAbsolute(rel)) return { path: file, dependents: [], indirect: [], tests: [], supported, scanned: 0, capped: false }

  const index = await indexFor(root)
  const direct = [...(index.importers.get(keyOf(rel)) || [])].sort()
  const seen = new Set([keyOf(rel), ...direct.map(keyOf)])
  const indirect: string[] = []
  let frontier = direct

  for (let depth = 0; depth < 2 && frontier.length && indirect.length < 500; depth++) {
    const next: string[] = []
    for (const item of frontier) {
      for (const importer of index.importers.get(keyOf(item)) || []) {
        if (seen.has(keyOf(importer))) continue
        seen.add(keyOf(importer))
        indirect.push(importer)
        next.push(importer)
      }
    }
    frontier = next
  }

  const tests = [...new Set([...direct, ...indirect].filter(item => TEST.test(item)).concat(namedTests(index, rel)))].sort()

  return {
    path: file,
    dependents: direct.slice(0, LIST_MAX),
    indirect: indirect.sort().slice(0, LIST_MAX),
    tests: tests.slice(0, LIST_MAX),
    supported,
    scanned: index.files.length,
    capped: index.capped
  }
}
