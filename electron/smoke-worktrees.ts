// Self-test of worktrees (part of HERA_SMOKE): a throwaway repository in the temp folder
// goes through make a copy → change it → see the changes → merge → a conflict that is
// undone → delete, with the real git on PATH. Skipped when the machine has no git.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findOnPath } from './paths'
import * as pty from './pty-host'
import { addProject, updateConfig } from './store'
import { createWorktree, initRepository, mergeWorktree, removeWorktree, worktreeDiff, worktreeStatus } from './worktrees'

type Step = (step: string, ok: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function smokeWorktrees(record: Step) {
  if (!findOnPath('git')) {
    record('worktrees (skipped: no git)', true)
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hera-smoke-'))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  process.env.HERA_WORKTREES = path.join(root, 'copies')
  // CI machines have no git identity.
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[key] ||= 'HERA smoke'
  for (const key of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[key] ||= 'smoke@hera.invalid'
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })

  const project = addProject(repo, 'smoke-repo')

  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n')
    const init = await initRepository(project.id)
    record('worktrees: make the folder a repository', init.ok && git('log', '--oneline').trim().split('\n').length === 1, init.message)

    // A Korean name (escaped here): folders and branches keep letters of any language.
    const copy = await createWorktree(project.id, { label: '\u{c2a4}\u{baa8}\u{d06c} test', task: 'smoke' })
    record(
      'worktrees: create a copy',
      fs.existsSync(path.join(copy.path, 'a.txt')) && copy.branch === 'hera/\u{c2a4}\u{baa8}\u{d06c}-test',
      `${copy.branch} ${copy.path}`
    )
    record('worktrees: .env copied into the copy', fs.readFileSync(path.join(copy.path, '.env'), 'utf8').includes('SECRET'))

    const session = pty.createSession({ projectId: project.id, cwd: copy.cwd, worktreeId: copy.id, title: 'smoke copy' })
    record('worktrees: a tab opens in the copy', path.resolve(session.cwd) === path.resolve(copy.cwd) && session.worktreeId === copy.id, session.cwd)

    fs.writeFileSync(path.join(copy.path, 'a.txt'), 'one\nTWO\nthree\n')
    fs.writeFileSync(path.join(copy.path, 'b.txt'), 'new\n')
    const status = await worktreeStatus(copy.id)
    record('worktrees: changes are counted', status.files === 2 && status.uncommitted === 2 && status.added === 2 && status.deleted === 1, JSON.stringify(status))
    const diff = await worktreeDiff(copy.id)
    record(
      'worktrees: diff lists both files',
      diff.files.length === 2 && diff.files.some(file => file.path === 'b.txt' && file.status === '?' && file.patch.includes('+new')),
      diff.files.map(file => `${file.status} ${file.path}`).join(', ')
    )

    const merged = await mergeWorktree(copy.id, 'squash')
    record(
      'worktrees: squash merge into the project folder',
      // trim: git may check the file out with CRLF (core.autocrlf on Windows).
      merged.ok && fs.readFileSync(path.join(repo, 'b.txt'), 'utf8').trim() === 'new' && git('status', '--porcelain').trim() === '',
      `${merged.message} | ${git('status', '--porcelain').trim()}`
    )

    // A second copy and the project folder change the same line: the merge is undone whole.
    const rival = await createWorktree(project.id, { label: 'rival' })
    fs.writeFileSync(path.join(rival.path, 'a.txt'), 'one\nRIVAL\nthree\n')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nMAIN\nthree\n')
    git('commit', '-am', 'main edit')
    const conflict = await mergeWorktree(rival.id, 'merge')
    record(
      'worktrees: a conflict is reported and undone',
      !conflict.ok && (conflict.conflicts || []).includes('a.txt') && git('status', '--porcelain').trim() === '' && fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').includes('MAIN'),
      JSON.stringify(conflict)
    )

    const ask = await removeWorktree(rival.id)
    record('worktrees: deleting unmerged work asks first', !ask.ok && Boolean(ask.confirm?.unmergedCommits), JSON.stringify(ask))
    const removed = await removeWorktree(rival.id, true)
    const branches = git('branch', '--list', 'hera/*')
    record('worktrees: delete a copy and its branch', removed.ok && !fs.existsSync(rival.path) && !branches.includes('rival'), removed.message || branches.trim())

    const after = await worktreeStatus(copy.id)
    record('worktrees: after a merge nothing is left to merge', after.files === 0 && after.commits === 0 && after.uncommitted === 0, JSON.stringify(after))

    // Work committed in the copy after a merge is not merged: deleting must still ask.
    fs.writeFileSync(path.join(copy.path, 'c.txt'), 'later\n')
    execFileSync('git', ['add', '-A'], { cwd: copy.path, windowsHide: true })
    execFileSync('git', ['commit', '-m', 'later work'], { cwd: copy.path, windowsHide: true })
    const later = await removeWorktree(copy.id)
    record('worktrees: work after a merge is not taken for merged', !later.ok && later.confirm?.unmergedCommits === 1, JSON.stringify(later))

    const done = await removeWorktree(copy.id, true)
    record('worktrees: delete after confirming (its tab closes)', done.ok && !fs.existsSync(copy.path) && !pty.getSession(session.id), done.message)
  } catch (error) {
    record('worktrees: exception', false, (error as Error).stack || String(error))
  } finally {
    updateConfig(draft => {
      draft.projects = draft.projects.filter(entry => entry.id !== project.id)
    })
    await sleep(300)
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      // the temp folder is cleaned by the OS
    }
  }
}
