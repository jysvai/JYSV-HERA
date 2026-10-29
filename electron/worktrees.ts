// Worktrees: isolated copies of a project, one git worktree on a `hera/…` branch each,
// outside the project folder (~/hera-worktrees/<project>/<name>). An agent works in its
// copy, and the user reviews the changes, merges them into the project folder or throws
// them away. HERA only ever deletes worktrees and branches it made itself.
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { t } from '../shared/i18n'
import type { WorktreeActionResult, WorktreeDiff, WorktreeFileDiff, WorktreeInfo, WorktreeLoss, WorktreeStatus, WorktreeSupport } from '../shared/types'
import { newId } from '../shared/util'
import { dataPath, findOnPath, readJson, writeJsonAtomic } from './paths'
import { createSession, kill, listSessions } from './pty-host'
import { getConfig, projectById, setPathAliases } from './store'

export const worktreeEvents = new EventEmitter()

/** Untracked files shown in a diff, and their size, before the rest is left out. */
const MAX_UNTRACKED = 200
const MAX_UNTRACKED_BYTES = 256 << 10
/** A diff this long is cut, so a generated file cannot freeze the window. */
const MAX_PATCH_CHARS = 1_500_000

interface GitResult {
  ok: boolean
  out: string
  err: string
}

function git(cwd: string, args: string[], timeout = 60_000): Promise<GitResult> {
  const exe = findOnPath('git')
  if (!exe) return Promise.resolve({ ok: false, out: '', err: t('git 을 찾지 못했습니다. git 을 설치한 뒤 HERA 를 다시 켜세요.') })
  // Long paths on Windows (a worktree's node_modules), and paths printed as they are, not quoted.
  const pre = ['-c', 'core.quotePath=false', ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [])]

  return new Promise(resolve =>
    execFile(
      exe,
      [...pre, ...args],
      // English messages: HERA reads some of them (counts, the identity error).
      { cwd, timeout, maxBuffer: 64 << 20, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANGUAGE: '' } },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: error ? failure(error, String(stdout), String(stderr)) : String(stderr).trim() })
    )
  )
}

/** git's own words for a failure (some go to stdout), never the command line Node puts in the error. */
function failure(error: Error & { killed?: boolean; code?: unknown }, stdout: string, stderr: string): string {
  if (error.killed) return t('git 이 제시간에 끝나지 않았습니다.')

  return stderr.trim() || stdout.trim() || t('git 이 실패했습니다 (code {code}).', { code: String(error.code ?? '?') })
}

const firstLine = (text: string) => text.split(/\r?\n/).find(line => line.trim())?.replace(/^(fatal|error): /, '') || text

// ---------------------------------------------------------------- store

let entries: WorktreeInfo[] | null = null
const storeFile = () => dataPath('worktrees.json')

function all(): WorktreeInfo[] {
  if (!entries) {
    const saved = readJson<WorktreeInfo[]>(storeFile())
    entries = Array.isArray(saved) ? saved.filter(entry => entry && entry.id && entry.path && entry.branch && entry.baseSha) : []
  }

  return entries
}

function save() {
  writeJsonAtomic(storeFile(), all())
  worktreeEvents.emit('changed')
}

export function listWorktrees(): WorktreeInfo[] {
  return all()
}

export function worktreeById(id: string | null | undefined): WorktreeInfo | null {
  return (id && all().find(entry => entry.id === id)) || null
}

// A folder inside a worktree belongs to the worktree's project (usage, `hera host`, lanes).
setPathAliases(() => all().map(entry => ({ root: entry.path, projectId: entry.projectId })))

// ---------------------------------------------------------------- names and places

/** Folder and branch name from what the user typed: letters of any language, digits, `.`, `_`, `-`. */
export function cleanName(label: string): string {
  const name = label
    .normalize('NFC')
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 40)
    .replace(/[.-]+$/, '')
    .replace(/\.lock$/i, '-lock')

  if (!name) return 'copy'

  // Device names Windows will not take as a folder (con, nul, com1, …, also with an extension).
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? `hera-${name}` : name
}

function worktreesRoot(): string {
  return process.env.HERA_WORKTREES || path.join(os.homedir(), 'hera-worktrees')
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))

  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

interface Repo {
  root: string
  /** The project folder inside the repo ('' at the top). */
  prefix: string
  head: string | null
  branch: string | null
}

async function repoOf(dir: string): Promise<Repo | null> {
  const top = await git(dir, ['rev-parse', '--show-toplevel'])
  if (!top.ok || !top.out.trim()) return null
  const [prefix, head, branch] = await Promise.all([
    git(dir, ['rev-parse', '--show-prefix']),
    git(dir, ['rev-parse', '--verify', '-q', 'HEAD']),
    git(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  ])

  return {
    root: path.resolve(top.out.trim()),
    prefix: prefix.out.trim(),
    head: head.ok ? head.out.trim() || null : null,
    branch: branch.ok ? branch.out.trim() || null : null
  }
}

/** Entries of `git status --porcelain=v1 -z` (a rename's old path is not an entry of its own). */
function statusRows(out: string): { code: string; file: string }[] {
  const rows: { code: string; file: string }[] = []
  const parts = out.split('\0')

  for (let index = 0; index < parts.length; index++) {
    const row = parts[index]
    if (row.length < 4) continue
    const code = row.slice(0, 2)
    rows.push({ code, file: row.slice(3) })
    if ('RC'.includes(code[0]) || 'RC'.includes(code[1])) index++
  }

  return rows
}

function usesWsl(shell: string | undefined): boolean {
  return /\bwsl(\.exe)?\b/i.test(shell || '')
}

// ---------------------------------------------------------------- support and setup

export async function worktreeSupport(projectId: string): Promise<WorktreeSupport> {
  const project = projectById(projectId)
  const none = { ok: false, branch: null, head: null, dirty: 0 }
  if (!project) return { ...none, reason: t('프로젝트를 찾지 못했습니다.') }
  if (!findOnPath('git')) return { ...none, reason: t('git 이 설치되어 있지 않습니다. 작업 공간은 git 으로 만듭니다.') }
  if (usesWsl(project.shell || getConfig().settings.defaultShell)) return { ...none, reason: t('WSL 셸을 쓰는 프로젝트는 아직 작업 공간을 지원하지 않습니다.') }

  const repo = await repoOf(project.path)
  if (!repo) return { ...none, canInit: true, reason: t('이 폴더는 git 저장소가 아닙니다.') }
  if (!repo.head) return { ...none, canInit: true, branch: repo.branch, reason: t('아직 커밋이 없습니다. 작업 공간은 마지막 커밋에서 시작합니다.') }

  const status = await git(project.path, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.'])

  return { ok: true, branch: repo.branch, head: repo.head, dirty: statusRows(status.out).length }
}

/** Common things a first commit must not take in. */
const STARTER_IGNORE = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.env', '.env.*', '.DS_Store', 'Thumbs.db']

/** Make the project a git repository with a first commit (the user confirmed it). */
export async function initRepository(projectId: string): Promise<WorktreeActionResult> {
  const project = projectById(projectId)
  if (!project) return { ok: false, message: t('프로젝트를 찾지 못했습니다.') }

  let repo = await repoOf(project.path)

  if (!repo) {
    const init = await git(project.path, ['init'])
    if (!init.ok) return { ok: false, message: firstLine(init.err) }
    repo = await repoOf(project.path)
    if (!repo) return { ok: false, message: t('git 저장소를 만들지 못했습니다.') }
  }

  if (repo.head) return { ok: true }

  try {
    // 'wx': only when there is none, without a check that could go stale before the write.
    fs.writeFileSync(path.join(repo.root, '.gitignore'), `${STARTER_IGNORE.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch {
    // the project has its own
  }

  const add = await git(repo.root, ['add', '-A'], 180_000)
  if (!add.ok) return { ok: false, message: firstLine(add.err) }
  const commit = await git(repo.root, ['commit', '-m', 'Initial commit'])
  if (!commit.ok) return { ok: false, message: commitHint(commit.err) }

  return { ok: true }
}

/** git's "who are you" error, in words a beginner can act on. */
function commitHint(err: string): string {
  if (/user\.(name|email)|Author identity unknown|tell me who you are/i.test(err)) {
    return t('git 에 이름과 이메일이 설정되어 있지 않습니다. 터미널에서 git config --global user.name "이름" 과 git config --global user.email "메일" 을 실행한 뒤 다시 하세요.')
  }

  return firstLine(err)
}

// ---------------------------------------------------------------- create

const creating = new Map<string, Promise<unknown>>()

/** One creation at a time per project: parallel `git worktree add` calls fight over the repo's locks. */
function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = creating.get(key) || Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  creating.set(
    key,
    next.catch(() => undefined)
  )

  return next
}

export interface CreateWorktreeOptions {
  label: string
  /** Folder and branch name, when it should differ from the label. */
  name?: string
  raceId?: string | null
  task?: string | null
  agentId?: string | null
}

export function createWorktree(projectId: string, options: CreateWorktreeOptions): Promise<WorktreeInfo> {
  return serial(projectId, () => create(projectId, options))
}

async function create(projectId: string, options: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const project = projectById(projectId)
  if (!project) throw new Error(t('프로젝트를 찾지 못했습니다.'))
  const support = await worktreeSupport(projectId)
  if (!support.ok) throw new Error(support.reason)
  const repo = (await repoOf(project.path))!

  const label = options.label.trim() || t('새 작업 공간')
  const base = cleanName(options.name || label)
  const parent = path.join(worktreesRoot(), cleanName(project.name))
  const taken = new Set(all().filter(entry => entry.projectId === projectId).map(entry => entry.name.toLowerCase()))
  const refs = await git(repo.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/hera/'])
  const branches = new Set(refs.out.split(/\r?\n/).map(line => line.trim().toLowerCase()))
  let name = ''

  for (let attempt = 1; attempt <= 30 && !name; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    // Case-insensitive: Windows and macOS folders (and branch files) do not tell `Fix` from `fix`.
    if (taken.has(candidate.toLowerCase()) || branches.has(`refs/heads/hera/${candidate}`.toLowerCase()) || fs.existsSync(path.join(parent, candidate))) continue
    name = candidate
  }

  if (!name) throw new Error(t("'{name}' 이름의 작업 공간이 이미 많습니다. 다른 이름을 쓰세요.", { name: base }))

  const branch = `hera/${name}`
  const target = path.join(parent, name)
  fs.mkdirSync(parent, { recursive: true })

  const add = await git(repo.root, ['worktree', 'add', '--no-track', '-b', branch, target, repo.head!], 300_000)

  if (!add.ok) {
    // Leave nothing half-made behind, but never touch a branch or folder that was there before.
    if (!/already exists/i.test(add.err)) {
      await git(repo.root, ['worktree', 'remove', '--force', target])
      await git(repo.root, ['branch', '-D', branch])
      await git(repo.root, ['worktree', 'prune'])
    }
    throw new Error(firstLine(add.err))
  }

  await copyIgnored(repo.root, target)

  const entry: WorktreeInfo = {
    id: newId('w_'),
    projectId,
    label,
    name,
    branch,
    path: target,
    cwd: repo.prefix ? path.join(target, repo.prefix) : target,
    baseBranch: repo.branch,
    baseSha: repo.head!,
    createdAt: Date.now(),
    raceId: options.raceId || null,
    task: options.task || null,
    agentId: options.agentId || null,
    mergedAt: null,
    repoRoot: repo.root
  }
  all().push(entry)
  save()

  // The project's setup command (dependencies are not copied), in a tab the user can watch.
  const setup = project.worktreeSetup?.trim()
  if (setup) createSession({ projectId, cwd: entry.cwd, worktreeId: entry.id, command: setup, title: t('준비: {command}', { command: setup.length > 24 ? `${setup.slice(0, 23)}…` : setup }) })

  return entry
}

/**
 * Files git ignores but the project needs to run: `.env` files at the top, and the paths
 * listed in `.worktreeinclude` (one per line, the same file and rules as Orca).
 */
async function copyIgnored(repoRoot: string, target: string) {
  const wanted = new Set<string>()

  try {
    for (const dirent of fs.readdirSync(repoRoot, { withFileTypes: true })) {
      if (dirent.isFile() && /^\.env(\..+)?$/i.test(dirent.name)) wanted.add(dirent.name)
    }
  } catch {
    return
  }

  const include = readCapped(path.join(repoRoot, '.worktreeinclude'), 256 << 10)

  if (Buffer.isBuffer(include)) {
    for (const raw of include.toString('utf8').split(/\r?\n/).slice(0, 1000)) {
      const line = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
      const parts = line.split('/')
      // Literal relative paths inside the repo only: no patterns, no way out, never .git.
      if (!line || line.startsWith('#') || /[*?!]/.test(line) || path.isAbsolute(line) || parts.includes('..') || parts[0] === '.git') continue
      wanted.add(line)
    }
  }

  const existing = [...wanted].filter(rel => fs.existsSync(path.join(repoRoot, rel)))
  if (!existing.length) return

  // Only ignored paths: a tracked file is in the copy already, and an untracked one would show up as a change.
  const ignored = await git(repoRoot, ['check-ignore', '--', ...existing])

  for (const rel of ignored.out.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    try {
      // Async: a big folder in .worktreeinclude must not freeze every terminal while it copies.
      await fs.promises.cp(path.join(repoRoot, rel), path.join(target, rel), { recursive: true, force: false, errorOnExist: false })
    } catch {
      // a locked or vanished file: the agent can manage without it
    }
  }
}

// ---------------------------------------------------------------- status and diff

/** Changes and commits count from here: the start, or the copy's tip when HERA last merged it. */
const since = (entry: WorktreeInfo) => entry.mergedSha || entry.baseSha

/**
 * A file's bytes, 'large' when it is over `max`, null when it cannot be read. The size is
 * checked on the open file, so it is the same file that is read.
 */
function readCapped(file: string, max: number): Buffer | 'large' | null {
  let fd: number | null = null

  try {
    fd = fs.openSync(file, 'r')
    if (fs.fstatSync(fd).size > max) return 'large'

    return fs.readFileSync(fd)
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** Lines of a new (untracked) text file, 0 for a large or binary one. */
function newFileLines(file: string): number {
  const bytes = readCapped(file, MAX_UNTRACKED_BYTES)
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 8000).includes(0)) return 0
  const text = bytes.toString('utf8')

  return text ? text.replace(/\r?\n$/, '').split(/\r?\n/).length : 0
}

export async function worktreeStatus(id: string): Promise<WorktreeStatus> {
  const entry = worktreeById(id)
  const empty = { id, exists: false, files: 0, added: 0, deleted: 0, uncommitted: 0, commits: 0 }
  if (!entry) return { ...empty, error: t('작업 공간을 찾지 못했습니다.') }
  if (!fs.existsSync(entry.path)) return empty

  const [status, short, count] = await Promise.all([
    git(entry.path, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(entry.path, ['--no-optional-locks', 'diff', '--shortstat', since(entry)]),
    git(entry.path, ['rev-list', '--count', `${since(entry)}..HEAD`])
  ])
  const rows = statusRows(status.out)
  const number = (pattern: RegExp) => Number(short.out.match(pattern)?.[1] || 0)
  const untracked = rows.filter(row => row.code === '??')
  // New files count in the +/− too, as in the diff.
  const newLines = untracked.slice(0, MAX_UNTRACKED).reduce((sum, row) => sum + newFileLines(path.join(entry.path, row.file)), 0)

  return {
    id,
    exists: true,
    files: number(/(\d+) files? changed/) + untracked.length,
    added: number(/(\d+) insertions?/) + newLines,
    deleted: number(/(\d+) deletions?/),
    uncommitted: rows.length,
    commits: Number(count.out.trim()) || 0,
    error: status.ok ? undefined : firstLine(status.err)
  }
}

function parsePatch(text: string): WorktreeFileDiff[] {
  const files: WorktreeFileDiff[] = []

  for (const chunk of text.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.split('\n')
    const header = lines[0].slice('diff --git '.length)
    const plus = lines.find(line => line.startsWith('+++ b/'))?.slice(6)
    const minus = lines.find(line => line.startsWith('--- a/'))?.slice(6)
    const renamed = lines.find(line => line.startsWith('rename to '))?.slice(10)
    const file = plus || renamed || minus || header.slice(header.lastIndexOf(' b/') + 3)
    const status = lines.some(line => line.startsWith('new file mode')) ? 'A' : lines.some(line => line.startsWith('deleted file mode')) ? 'D' : renamed ? 'R' : 'M'
    const hunkStart = lines.findIndex(line => line.startsWith('@@'))
    const body = hunkStart >= 0 ? lines.slice(hunkStart) : []

    files.push({
      path: file.trim(),
      status,
      added: body.filter(line => line.startsWith('+')).length,
      deleted: body.filter(line => line.startsWith('-')).length,
      binary: lines.some(line => /^Binary files /.test(line)),
      patch: body.join('\n').replace(/\n$/, '')
    })
  }

  return files
}

/** Everything changed against the start: commits, uncommitted edits and new files. */
export async function worktreeDiff(id: string): Promise<WorktreeDiff> {
  const entry = worktreeById(id)
  if (!entry || !fs.existsSync(entry.path)) return { files: [], truncated: false }

  const tracked = await git(entry.path, ['--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--find-renames', since(entry)])
  const files = parsePatch(tracked.out)
  let size = tracked.out.length
  let truncated = false

  const untracked = await git(entry.path, ['ls-files', '--others', '--exclude-standard', '-z'])

  for (const rel of untracked.out.split('\0').filter(Boolean)) {
    if (files.length >= MAX_UNTRACKED + 400 || size > MAX_PATCH_CHARS) {
      truncated = true
      break
    }

    const diff: WorktreeFileDiff = { path: rel, status: '?', added: 0, deleted: 0, binary: false, patch: '' }

    const bytes = readCapped(path.join(entry.path, rel), MAX_UNTRACKED_BYTES)
    if (!bytes) continue

    if (bytes === 'large' || bytes.subarray(0, 8000).includes(0)) {
      diff.binary = true
    } else {
      const lines = bytes.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/)
      diff.added = lines.length
      diff.patch = `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}`
      size += diff.patch.length
    }

    files.push(diff)
  }

  // Cut the longest patches first, so every file stays listed.
  if (size > MAX_PATCH_CHARS) {
    truncated = true
    for (const file of [...files].sort((a, b) => b.patch.length - a.patch.length)) {
      if (size <= MAX_PATCH_CHARS) break
      size -= file.patch.length
      file.patch = ''
      file.binary = true
    }
  }

  return { files, truncated }
}

// ---------------------------------------------------------------- commit, merge, remove

async function commitAll(entry: WorktreeInfo, message: string): Promise<WorktreeActionResult> {
  const add = await git(entry.path, ['add', '-A'], 180_000)
  if (!add.ok) return { ok: false, message: firstLine(add.err) }
  const staged = await git(entry.path, ['diff', '--cached', '--quiet'])
  if (staged.ok) return { ok: true, message: t('커밋할 변경이 없습니다.') }
  // No hooks: a snapshot of the agent's work in the copy, where hooks often cannot run (no node_modules).
  const commit = await git(entry.path, ['commit', '--no-verify', '-m', message], 120_000)

  return commit.ok ? { ok: true } : { ok: false, message: commitHint(commit.err) }
}

/** Save what the agent left uncommitted in the copy as a commit on its branch. */
export async function commitWorktree(id: string, message: string): Promise<WorktreeActionResult> {
  const entry = worktreeById(id)
  if (!entry || !fs.existsSync(entry.path)) return { ok: false, message: t('작업 공간을 찾지 못했습니다.') }

  return commitAll(entry, message.trim() || entry.label)
}

/**
 * Bring the copy's work into the project folder: a merge commit, or one squashed commit.
 * The project folder must be on a branch and have no uncommitted changes, so a conflict
 * can always be undone completely.
 */
export async function mergeWorktree(id: string, mode: 'merge' | 'squash'): Promise<WorktreeActionResult> {
  const entry = worktreeById(id)
  const project = projectById(entry?.projectId)
  if (!entry || !project) return { ok: false, message: t('작업 공간을 찾지 못했습니다.') }
  if (!fs.existsSync(entry.path)) return { ok: false, message: t('작업 공간 폴더가 없습니다.') }

  const repo = await repoOf(project.path)
  if (!repo) return { ok: false, message: t('이 폴더는 git 저장소가 아닙니다.') }
  if (!repo.branch) return { ok: false, message: t('프로젝트 폴더가 브랜치에 있지 않습니다 (detached HEAD). 브랜치로 돌아간 뒤 다시 하세요.') }

  const [mergeHead, rebaseMerge, rebaseApply] = await Promise.all([
    git(repo.root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']),
    git(repo.root, ['rev-parse', '--git-path', 'rebase-merge']),
    git(repo.root, ['rev-parse', '--git-path', 'rebase-apply'])
  ])
  const busy = [rebaseMerge, rebaseApply].some(result => result.ok && fs.existsSync(path.resolve(repo.root, result.out.trim())))
  if (mergeHead.ok || busy) return { ok: false, message: t('프로젝트 폴더에서 merge 나 rebase 가 진행 중입니다. 먼저 끝내세요.') }

  const dirty = await git(repo.root, ['--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=no'])
  if (dirty.out.trim()) return { ok: false, message: t('프로젝트 폴더에 커밋하지 않은 변경이 있습니다. 커밋하거나 정리한 뒤 합치세요.') }

  // Only the copy's own branch: the agent may have switched to another one in there.
  const current = (await git(entry.path, ['symbolic-ref', '--short', '-q', 'HEAD'])).out.trim()
  if (current !== entry.branch) {
    return { ok: false, message: t('작업 공간이 {branch} 가 아닌 {current} 에 있습니다. 작업 공간에서 git checkout {branch} 로 돌아간 뒤 합치세요.', { branch: entry.branch, current: current || 'detached HEAD' }) }
  }

  // What the agent did not commit goes in too.
  const saved = await commitAll(entry, entry.task ? clipLine(entry.task) : entry.label)
  if (!saved.ok) return saved

  const tip = (await git(entry.path, ['rev-parse', 'HEAD'])).out.trim()
  const ahead = await git(repo.root, ['rev-list', '--count', `${since(entry)}..${entry.branch}`])
  if (!tip || Number(ahead.out.trim()) === 0) return { ok: false, message: t('합칠 변경이 없습니다.') }

  const subject = entry.task ? clipLine(entry.task) : entry.label
  const result =
    mode === 'squash'
      ? await git(repo.root, ['merge', '--squash', entry.branch], 180_000)
      : await git(repo.root, ['merge', '--no-ff', '--no-edit', '-m', `Merge ${entry.branch}: ${subject}`, entry.branch], 180_000)

  if (result.ok && mode === 'squash') {
    if ((await git(repo.root, ['diff', '--cached', '--quiet'])).ok) {
      // The project has all of it already.
      await git(repo.root, ['reset', '--merge'])
      return { ok: false, message: t('합칠 변경이 없습니다.') }
    }

    const commit = await git(repo.root, ['commit', '-m', subject], 120_000)

    if (!commit.ok) {
      await git(repo.root, ['reset', '--merge'])
      return { ok: false, message: commitHint(commit.err) }
    }
  }

  if (!result.ok) {
    const unmerged = await git(repo.root, ['diff', '--name-only', '--diff-filter=U'])
    const conflicts = unmerged.out.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    // Undo it whole: the project folder is back exactly as it was.
    if (mode === 'squash') await git(repo.root, ['reset', '--merge'])
    else await git(repo.root, ['merge', '--abort'])

    return conflicts.length
      ? { ok: false, conflicts, message: t('충돌이 나서 합치지 않았습니다. 프로젝트 폴더는 그대로입니다.') }
      : { ok: false, message: firstLine(result.err) }
  }

  let mergedSha = tip

  if (mode === 'squash') {
    // A squash leaves no trace on the copy's branch, so merging later work would replay what
    // is in the project already and conflict. Bring the project's branch into the copy (a real
    // merge, so the copy also gets what others committed there; "ours" would make the next
    // merge take those out again): the next merge starts from here.
    const head = (await git(repo.root, ['rev-parse', 'HEAD'])).out.trim()
    const sync = await git(entry.path, ['merge', '--no-verify', '--no-edit', '-m', `Merge ${repo.branch} after squashing into it`, head], 180_000)
    if (sync.ok) mergedSha = (await git(entry.path, ['rev-parse', 'HEAD'])).out.trim() || tip
    else await git(entry.path, ['merge', '--abort'])
  }

  entry.mergedAt = Date.now()
  entry.mergedSha = mergedSha
  save()

  return { ok: true, message: t('{branch} 을(를) {target} 에 합쳤습니다.', { branch: entry.branch, target: repo.branch }) }
}

function clipLine(text: string): string {
  const line = text.split(/\r?\n/).find(part => part.trim())?.trim() || text.trim()

  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The repository the copy belongs to: the project's, else the one recorded or the one the copy points at. */
async function repoRootOf(entry: WorktreeInfo): Promise<string | null> {
  const project = projectById(entry.projectId)
  const repo = project && fs.existsSync(project.path) ? await repoOf(project.path) : null
  if (repo) return repo.root
  if (entry.repoRoot && fs.existsSync(entry.repoRoot)) return entry.repoRoot
  if (!fs.existsSync(entry.path)) return null

  const common = await git(entry.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])

  return common.ok && common.out.trim() ? path.dirname(path.resolve(common.out.trim())) : null
}

/**
 * What deleting a copy would lose: uncommitted files in it, and commits on its branch the
 * project never got. The commits are counted in the repository, so a copy whose folder was
 * deleted by hand still shows them.
 */
export async function worktreeLoss(id: string): Promise<WorktreeLoss> {
  const entry = worktreeById(id)
  if (!entry) return { uncommitted: 0, unmergedCommits: 0, unknown: false }

  const root = await repoRootOf(entry)
  let unknown = !root
  let unmergedCommits = 0

  if (root && (await git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${entry.branch}`])).ok) {
    const ahead = await git(root, ['rev-list', '--count', `${since(entry)}..${entry.branch}`])
    if (ahead.ok) unmergedCommits = Number(ahead.out.trim()) || 0
    else unknown = true
  }

  let uncommitted = 0

  if (fs.existsSync(entry.path)) {
    const status = await git(entry.path, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'])
    if (status.ok) uncommitted = statusRows(status.out).length
    else unknown = true
  }

  return { uncommitted, unmergedCommits, unknown }
}

/**
 * Delete the copy and its branch. Without `force`, a copy that would lose uncommitted files
 * or unmerged commits (or one git cannot tell about) is kept, and the numbers come back for
 * the user to confirm.
 */
export async function removeWorktree(id: string, force = false): Promise<WorktreeActionResult> {
  const entry = worktreeById(id)
  if (!entry) return { ok: true }

  if (!force) {
    const loss = await worktreeLoss(id)
    if (loss.uncommitted || loss.unmergedCommits || loss.unknown) return { ok: false, confirm: loss }
  }

  // Before the folder goes: a copy can be the only way left to its repository.
  const repoDir = await repoRootOf(entry)

  // A shell or agent keeps its folder open, and Windows will not delete an open folder.
  const inCopy = listSessions().filter(session => session.worktreeId === id || inside(entry.path, session.cwd))
  for (const session of inCopy) kill(session.id)
  if (inCopy.length) await sleep(700)

  if (repoDir) await git(repoDir, ['worktree', 'remove', '--force', entry.path], 120_000)

  // git can leave folders behind (files an editor or indexer held): delete what is left.
  if (fs.existsSync(entry.path)) {
    try {
      fs.rmSync(entry.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch (error) {
      return { ok: false, message: t('폴더를 지우지 못했습니다: {error}. 그 폴더를 쓰는 프로그램을 닫고 다시 하세요.', { error: (error as Error).message }) }
    }
  }

  if (repoDir) {
    await git(repoDir, ['worktree', 'prune'])
    // Safe: either nothing would be lost, the work was merged, or the user confirmed.
    await git(repoDir, ['branch', '-D', entry.branch])
  }

  entries = all().filter(other => other.id !== id)
  save()

  return { ok: true }
}

/** Forget copies whose folder and branch are both gone (deleted outside HERA). */
export async function pruneMissingWorktrees() {
  const gone: string[] = []

  for (const entry of all()) {
    if (fs.existsSync(entry.path)) continue
    const project = projectById(entry.projectId)
    if (!project) {
      gone.push(entry.id)
      continue
    }
    const branch = await git(project.path, ['show-ref', '--verify', '--quiet', `refs/heads/${entry.branch}`])
    if (!branch.ok) gone.push(entry.id)
  }

  if (gone.length) {
    entries = all().filter(entry => !gone.includes(entry.id))
    save()
  }
}

/** Short id for a comparison: its copies are named `race-<id>-<agent>`. */
export function newRaceId(): string {
  return newId('').slice(-5).toLowerCase()
}
