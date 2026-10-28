<!-- lang --><sub>[한국어](../ko/getting-started.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Getting started

New to terminals or AI coding tools? This page takes you from the download to your first AI conversation, one step at a time. It takes about ten minutes.

## How HERA works

HERA has no AI of its own. It is a window that opens terminals, and the AI tools you install (Claude Code, Codex and others) run inside those terminals. Every terminal belongs to a **project**: a folder on your computer that you register once. That is why nothing opens until you have registered a folder.

## 1. Install HERA

Download the file for your computer from [Releases](https://github.com/jysvai/JYSV-HERA/releases/latest) and install it. The [Install](../../README.md#install) table says which file to pick.

- **Windows:** the app is not code-signed yet, so a blue "Windows protected your PC" window may appear. Click *More info*, then *Run anyway*. No administrator rights are needed.
- **macOS:** open the `.dmg` and drag HERA to Applications. macOS blocks the first launch. On macOS 15 and later, go to *System Settings → Privacy & Security* and press **Open Anyway**. On macOS 12–14, right-click the app and choose *Open*.

The window follows your computer's language (Korean or English). To change it, open *Settings → Display language* (언어 · Language).

## 2. Install at least one AI tool

HERA finds AI tools that are already installed on your computer. Install one now; you can add more later.

| AI | Install (paste into a terminal) | Account you need |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | `npm i -g @anthropic-ai/claude-code` | Claude Pro or Max, or an API key |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` | A ChatGPT plan, or an API key |

- `npm` comes with [Node.js](https://nodejs.org/). If the terminal says `npm` is not found, install the Node.js **LTS** version first.
- Run the command in any terminal: PowerShell on Windows, Terminal on macOS. After step 3 you can also use a HERA terminal.
- **Then quit HERA completely and start it again.** Closing the window only hides HERA in the tray (next to the clock, or in the menu bar on macOS). Right-click the tray icon and choose *Quit* (종료). HERA reads your PATH when it starts, so it only sees tools installed before that.

HERA knows 32 AI tools. The **Agents** page (에이전트) lists each one with its install command.

## 3. Register a project folder

A project is simply a folder where your work lives. If you do not have one yet, make an empty folder, for example `Documents/my-first-project`.

Then do one of these:

- Drag the folder from Explorer or Finder onto HERA's left sidebar.
- Press **Add folder** (폴더 추가) and pick it.
- Press **Find in a parent folder** (상위 폴더에서 찾기), pick a folder such as `Desktop`, and tick the projects HERA finds there.

The folder appears in the sidebar. HERA only remembers where it is; nothing inside the folder changes.

## 4. Open a terminal or an AI

Click the project in the sidebar. Its start screen shows:

- **Terminal** (터미널): an ordinary command line in that folder.
- One card per installed AI, for example **Claude Code**. Click it to start that AI in the folder.

If the card for your AI is missing, HERA cannot see it yet. Go back to step 2 and restart HERA.

## 5. The first time an AI starts

Each AI tool asks a few things once:

- **Sign in.** Claude Code and Codex open your browser so you can log in. Use the account you pay for, for example Claude Max or ChatGPT Plus. The login belongs to the AI tool; HERA never sees it.
- **Trust this folder?** The AI asks whether it may read and change files in this folder. Answer yes for your own project.
- Then type what you want in plain words, for example *"Make a simple to-do web page in this folder"*, and press Enter.

When the AI needs your permission, for example to run a command or change a file, HERA marks the tab as waiting for approval (승인 대기) and can notify you. Read the question and answer it in the terminal.

## 6. Next steps

- **Several AIs at once:** start a second AI, then press **Split view** (분할 전환) above the terminal to see them side by side.
- **Let them work together:** open the **Backlog** (백로그) on the right, add a to-do and press ▶ → *Multi-agent* (멀티 에이전트로 진행). One AI leads and hands parts to the others. See [Agents](agents.md#multi-agent-work-without-typing-hera).
- **Limits:** the *Usage* tab (사용량) on the right shows how much of each AI's limits you have used. See [Usage](usage.md).
- **Closing:** closing the window keeps everything running in the tray, and after a reboot your tabs come back. See [Session memory](session-memory.md).

## If something does not work

| What you see | What to do |
|---|---|
| The screen only says "Register a project" (프로젝트를 등록하세요) and no terminal opens | Terminals open inside a project. Register a folder (step 3), then click it in the sidebar. |
| There is no card for Claude Code (or another AI) | It is not installed, or it was installed after HERA started. Install it (step 2), quit HERA from the tray and start it again. |
| Typing `claude` in a HERA terminal says it is not recognized | Same cause: quit HERA from the tray and start it again. To check where the tool is, run `where claude` (Windows) or `which claude` (macOS, Linux). |
| `npm` is not recognized | Node.js is not installed. Install the LTS version from [nodejs.org](https://nodejs.org/), then quit and restart HERA. |
| The AI asks you to log in every time | Finish the browser login once. For Codex, see [Troubleshooting](troubleshooting.md#codex-asks-me-to-sign-in-again-after-hera-restarts). |

More fixes: [Troubleshooting](troubleshooting.md).
