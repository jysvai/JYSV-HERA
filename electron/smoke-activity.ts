// Self-test of live activity (part of HERA_SMOKE): small Claude Code and Codex
// transcripts in the temp folder, in the shapes the CLIs write, go through the
// reader; the files, plan, subagent and tokens it finds are checked on every OS.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { newRun, openConversation, pollConversation, subState, summarize, type Run } from './activity-core'

type Step = (step: string, ok: boolean, detail?: string) => void

const lines = (items: object[]) => items.map(item => JSON.stringify({ timestamp: new Date().toISOString(), ...item })).join('\n') + '\n'

function touched(run: Run): string {
  return [...run.touches.values()]
    .map(item => `${item.kind}:${path.basename(item.path)}`)
    .sort()
    .join(' ')
}

export function smokeActivity(record: Step) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hera-activity-'))
  const project = path.join(root, 'proj')
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })
  for (const name of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) fs.writeFileSync(path.join(project, 'src', name), '//\n')
  const file = (name: string) => path.join(project, 'src', name)
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000 }
  const tool = (id: string, name: string, input: object, model = 'claude-opus-5-5') => ({ type: 'assistant', requestId: `r_${id}`, message: { id: `m_${id}`, model, content: [{ type: 'tool_use', id, name, input }], usage } })

  try {
    // Claude Code: a request, a plan, reads and edits, a background subagent.
    const claude = path.join(root, 'conv.jsonl')
    fs.writeFileSync(
      claude,
      lines([
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>context</system-reminder>' }, { type: 'text', text: 'fix the bug' }] } },
        tool('t1', 'TaskCreate', { subject: 'one' }),
        tool('t2', 'TaskCreate', { subject: 'two' }),
        tool('t3', 'TaskUpdate', { taskId: '1', status: 'completed' }),
        tool('t4', 'Read', { file_path: file('a.ts') }),
        tool('t5', 'Edit', { file_path: file('b.ts') }),
        tool('t6', 'Bash', { command: 'cd src && cat c.ts | head -3' }),
        // A share that is not there must not be looked up (it can block for many seconds), nor anything outside the folder.
        tool('t6b', 'Bash', { command: 'cat \\\\192.0.2.1\\share\\f.txt //192.0.2.1/share/g.txt ../../outside.txt' }),
        { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } },
        { type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } },
        tool('t7', 'Agent', { description: 'look around', subagent_type: 'Explore', prompt: 'Find the callers.' }),
        { type: 'user', toolUseResult: { isAsync: true, status: 'async_launched' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't7', content: 'launched' }] } }
      ])
    )
    const subDir = path.join(root, 'conv', 'subagents')
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(path.join(subDir, 'agent-x1.jsonl'), lines([{ type: 'user', isSidechain: true, message: { role: 'user', content: 'Find the callers.' } }, { ...tool('s1', 'Read', { file_path: file('d.ts') }, 'claude-haiku-5-5'), isSidechain: true }]))
    fs.writeFileSync(path.join(subDir, 'agent-x1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around', toolUseId: 't7', finished: true }))

    const run = newRun('main', 'main', null, 'claude-1', 'claude', project)
    const started = Date.now()
    const conversation = openConversation(claude, 'claude', run)
    pollConversation(conversation, Date.now())
    const took = Date.now() - started
    const summary = summarize(run, 'working')
    const claudeOk = summary.task === 'fix the bug' && summary.plan?.done === 1 && summary.plan.total === 2 && touched(run) === 'edit:b.ts read:a.ts read:c.ts' && summary.model === 'claude-opus-5-5' && (summary.costUsd || 0) > 0 && took < 2000
    record('activity: Claude transcript', claudeOk, `${summary.task} · ${summary.plan?.done}/${summary.plan?.total} · ${touched(run)} · ${summary.model} · ${took} ms`)

    const sub = [...conversation.subs.values()][0]
    const subOk = Boolean(sub) && sub.run.label === 'Explore' && sub.spawnId === 't7' && touched(sub.run) === 'read:d.ts' && subState(conversation, sub, 'working', Date.now()) === 'done'
    record('activity: Claude subagent', subOk, sub ? `${sub.run.label} · ${sub.spawnId} · ${touched(sub.run)}` : 'not found')

    // Codex code mode: a plan, a command that reads, a patch.
    const codex = path.join(root, 'rollout.jsonl')
    const patch = `*** Begin Patch\n*** Update File: ${file('a.ts')}\n@@\n-a\n+b\n*** End Patch`
    fs.writeFileSync(
      codex,
      lines([
        { type: 'session_meta', payload: { id: '00000000-0000-0000-0000-000000000000', cwd: project } },
        { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-test' } } },
        { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'tidy up' }] } } },
        { type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'x', status: 'completed' }, { step: 'y', status: 'in_progress' }] }) } },
        { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: `text(await tools.exec_command({cmd:${JSON.stringify('cat src/c.ts')}}));\ntext(await tools.apply_patch(${JSON.stringify(patch)}));` } },
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 50 } } } }
      ])
    )
    const codexRun = newRun('codex', 'codex', null, 'codex-1', 'codex', project)
    pollConversation(openConversation(codex, 'codex', codexRun), Date.now())
    const codexSummary = summarize(codexRun, 'working')
    const codexOk = codexSummary.task === 'tidy up' && codexSummary.plan?.done === 1 && codexSummary.plan.total === 2 && touched(codexRun) === 'edit:a.ts read:c.ts' && codexSummary.model === 'gpt-test' && codexSummary.output === 50
    record('activity: Codex transcript', codexOk, `${codexSummary.task} · ${codexSummary.plan?.done}/${codexSummary.plan?.total} · ${touched(codexRun)} · ${codexSummary.model} · ${codexSummary.output}`)
  } catch (error) {
    record('activity: exception', false, (error as Error).stack || String(error))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
