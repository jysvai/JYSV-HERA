// Self-test of token usage (part of HERA_SMOKE): small Claude Code, Codex and
// Antigravity logs in the temp folder, in the shapes the CLIs write, go through
// the parser. Reading only what was appended, an over-long line, a half-written
// last line and a removed log are checked on every OS.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runUsage, type ProviderUsageRaw, type WorkerRequest } from './usage-core'

type Step = (step: string, ok: boolean, detail?: string) => void

function totals(raw: ProviderUsageRaw) {
  const out = { messages: 0, input: 0, output: 0, cacheRead: 0 }

  for (const models of Object.values(raw.days)) {
    for (const tally of Object.values(models)) {
      out.messages += tally.messages
      out.input += tally.input
      out.output += tally.output
      out.cacheRead += tally.cacheRead
    }
  }

  return out
}

function expect(record: Step, step: string, raw: ProviderUsageRaw, want: ReturnType<typeof totals>, folder: string) {
  const got = totals(raw)
  const folders = Object.keys(raw.cwdDays)

  record(step, JSON.stringify(got) === JSON.stringify(want) && folders.length === 1 && folders[0] === folder, `${JSON.stringify(got)} in ${folders.join(', ')}`)
}

export function smokeUsage(record: Step) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hera-usage-'))
  const project = path.join(root, 'work', 'proj')
  const claudeFile = path.join(root, 'claude', 'projects', 'p', 'session.jsonl')
  const forkFile = path.join(root, 'claude', 'projects', 'p', 'session', 'subagents', 'agent-x.jsonl')
  const codexFile = path.join(root, 'codex', 'sessions', '2026', '11', '09', 'rollout-a.jsonl')
  const agyFile = path.join(root, 'agy', 'brain', 'conv-1', '.system_generated', 'logs', 'transcript.jsonl')

  for (const file of [claudeFile, codexFile, agyFile]) fs.mkdirSync(path.dirname(file), { recursive: true })

  const timestamp = new Date().toISOString()
  // Field order as Claude Code writes it: the message comes first, the record's own cwd after it.
  const assistant = (id: string, output: number) =>
    `${JSON.stringify({
      message: { id: `msg_${id}`, model: 'claude-test', content: [{ type: 'tool_use', input: { cwd: path.join(root, 'elsewhere') } }], usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 100 } },
      requestId: `r_${id}`,
      type: 'assistant',
      timestamp,
      cwd: project
    })}\n`
  const longLine = `${JSON.stringify({ type: 'user', timestamp, message: { content: 'é€'.repeat(1_800_000) } })}\n`
  const last = assistant('c', 3)

  // 'p' starts with a placeholder output, as older CLIs wrote it; the fork repeats its parent's 'a'.
  fs.writeFileSync(claudeFile, assistant('a', 5) + assistant('a', 5) + longLine + assistant('b', 7) + assistant('p', 8) + assistant('p', 400) + last.slice(0, 40))
  fs.mkdirSync(path.dirname(forkFile), { recursive: true })
  fs.writeFileSync(forkFile, assistant('a', 5))
  fs.writeFileSync(
    codexFile,
    [
      { timestamp, type: 'session_meta', payload: { cwd: project } },
      { timestamp, type: 'turn_context', payload: { cwd: project, model: 'codex-test' } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } } } },
      { timestamp, type: 'token_usage_record', payload: { thread_token_usage: { input_tokens: 150, cached_input_tokens: 60, output_tokens: 30 } } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 60, output_tokens: 30 } } } },
      // A compaction call: only the record has it, and the next count is still behind.
      { timestamp, type: 'token_usage_record', payload: { thread_token_usage: { input_tokens: 200, cached_input_tokens: 80, output_tokens: 40 } } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 60, output_tokens: 30 } } } }
    ]
      .map(item => JSON.stringify(item))
      .join('\n') + '\n'
  )
  const step = (index: number) => JSON.stringify({ step_index: index, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: timestamp.replace(/\.\d+Z$/, 'Z'), input_tokens: 5, cache_read_tokens: 50, output_tokens: 9 })
  fs.writeFileSync(agyFile, [step(1), step(1), step(2), JSON.stringify({ step_index: 3, type: 'GENERIC', status: 'DONE', created_at: timestamp })].join('\n') + '\n')

  const request: WorkerRequest = {
    cacheFile: path.join(root, 'cache.json'),
    claudeDirs: [path.join(root, 'claude')],
    codexHomes: [path.join(root, 'codex')],
    agyDir: path.join(root, 'agy'),
    agyWorkspaces: { 'conv-1': project },
    maxAgeDays: 31
  }

  try {
    const first = runUsage(request)
    expect(record, 'usage: Claude once per response over all files, highest output, past an over-long line, half-written last line left out', first.claude, { messages: 3, input: 30, output: 412, cacheRead: 300 }, project)
    expect(record, 'usage: Codex growth between running totals, from either kind of record', first.codex, { messages: 3, input: 120, output: 40, cacheRead: 80 }, project)
    expect(record, 'usage: Antigravity turns, folder from its index', first.agy, { messages: 2, input: 10, output: 18, cacheRead: 100 }, project)

    fs.appendFileSync(claudeFile, last.slice(40))
    fs.rmSync(path.join(root, 'agy', 'brain', 'conv-1'), { recursive: true })
    const second = runUsage(request)
    expect(record, 'usage: appended lines counted once', second.claude, { messages: 4, input: 40, output: 415, cacheRead: 400 }, project)
    expect(record, 'usage: a removed Antigravity conversation stays counted', second.agy, { messages: 2, input: 10, output: 18, cacheRead: 100 }, project)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
