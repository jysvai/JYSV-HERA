<!-- lang --><sub>[한국어](../ko/session-memory.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Session memory

<img src="../images/features/session-memory.jpg" alt="" width="120" align="right">

HERA remembers which tabs you had open, so a crash, an update or a reboot does not cost you your setup.

## What is saved

The open terminals of every project: name, shell, the agent running in it, its last known folder, the conversation it was in, and the last screen contents. HERA saves

- every 45 seconds, and
- right after you open, close or rename a tab.

So even a sudden power-off leaves the state from a moment before. Running programs themselves are not kept alive; HERA starts them again.

## Restore modes

Settings, "Session memory and reboot recovery" (세션 기억 · 재부팅 복구), setting "When started again" (다시 켜질 때):

- **Resume automatically** (자동으로 이어서 실행, the default): terminals reopen a few at a time. Shells start in the last folder they were in; agents continue their own conversation. Project commands (a dev server, a script) are **not** restarted by themselves.
- **Restore screen only** (화면만 복원): tabs come back showing their saved screen with the bar "This session was restored from a previous run" (이전 실행에서 복원된 세션입니다). Nothing runs until you press a button on the bar:
  - **Resume** (이어하기), for tabs that ran an agent: continues the conversation.
  - **Restart** (다시 시작): starts the same command again.

The same bar, with the exit code, appears when a program exits.

## Exact conversation resume

For two agents HERA tracks the conversation, not just the tool:

- **Claude Code**: started with `--session-id <id>` and restored with `--resume <id>`.
- **Codex**: restored with `resume <id>`.

A tab therefore returns to its own conversation, not "the latest one in that folder". If you run `/clear` in a tab, HERA follows the new conversation from then on. Conversations belonging to [lanes](lanes.md) helpers are never picked for a main tab.

Other agents use their own "resume last conversation" flag (the **Resume arguments** field in [Agents](agents.md)), or start fresh in the folder.

## The shell's folder

HERA tracks the folder a shell is in. It reads the standard directory reports (OSC 7 and 9;9) that the shell sends, and on Windows also recognises the folder in a PowerShell or cmd prompt. A restored shell opens in that folder, and falls back to the project folder if it no longer exists.

## Launch at login

Settings has **Start HERA when the computer starts** (컴퓨터를 켜면 HERA 자동 실행). HERA then starts when you log in and restores sessions as above. It only applies to an installed HERA, not a portable or development copy. Combine it with "Start hidden" (숨긴 채로 시작) and "Close to tray" (트레이로) under Window and notifications to have it wait quietly in the tray.

## Where it lives

In HERA's data folder (`sessions.json`), see [Updates and privacy](updates-and-privacy.md#where-data-is-stored).
