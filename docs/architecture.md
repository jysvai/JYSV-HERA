# JYSV HERA architecture

```
┌──────────────────────────── Electron main (Node 24) ────────────────────────────┐
│ store.ts      config.json · launches.jsonl · bus.jsonl (atomic writes, debounced)   │
│ pty-host.ts   session = node-pty (ConPTY) + @xterm/headless screen + SerializeAddon │
│               status (working / idle / waiting), agent detection, save / restore    │
│ resume.ts     session memory: shell folder tracking, agent conversation ids         │
│ bus.ts        \\.\pipe\jysvhera-<user> (macOS/Linux: <data>/hera.sock), JSON lines,  │
│               cli-token auth → hera CLI requests (list/ask/send/reply/peek/…)       │
│ lanes.ts      lanes plugin: find, options, start/stop (HERA tabs), project state     │
│ shell.ts      shell choice · boot script (UTF-8, PATH, aliases) · per-shell quoting  │
│ insight.ts    project backlog: git, recent files, each AI's last prompt (15 s cache) │
│ accounts.ts   account profiles (config-folder env), non-secret auth state           │
│ usage.ts ──fork──▶ usage-worker (utilityProcess, one-shot): incremental log parse   │
└───────────────▲──────────────────────────────────────────────▲──────────────────┘
                │ IPC (allow-listed preload, keystrokes one-way)  │ named pipe
┌───────────────┴──────────── renderer (React 19) ┐   ┌─────────┴──────────┐
│ nanostores · Tailwind 4 · xterm 6 (visible only) │   │ hera CLI (Node)     │
│ sidebar · workspace (tabs/split) · right panel   │   │ called by shells    │
│ (backlog · usage · lanes) · pages                │   │ and AIs in HERA     │
└──────────────────────────────────────────────────┘   └────────────────────┘
```

## Terminal pipeline (why HERA stays light)

1. PTY output is always written to a headless xterm in the main process, so main holds the exact screen of every session.
2. Only sessions the renderer has **attached** get output, collected in `pending` and sent once every 8 ms.
3. Switching tabs or pages disposes the renderer's xterm (detach). Coming back, main waits until its parser has caught up (`term.write('', cb)`), sends a `serialize()` snapshot, then streams. `attachSeq` settles attach/detach races.
4. A hidden window detaches everything. After the deep-sleep delay the BrowserWindow itself is destroyed. PTYs keep running.
5. Boot switches: GPU off by default, one renderer process, no spare renderer, network service in-process, small disk cache. (`in-process-gpu` was measured and rejected: about 16 MB more in total.)
6. On Windows node-pty copies each terminal's ConPTY output through a worker thread, a whole V8 isolate. HERA wraps `worker_threads.Worker` so that worker gets a small heap (`resourceLimits`). Together with loading the WebGL renderer only in GPU mode, this saves about 23 MB at 4 terminals. A 300,000-line output test passed.
7. Packaging keeps only the target platform's node-pty prebuilds and drops its sources, tests, the bundled ConPTY DLL copies (unused with `useConptyDll: false`) and source maps.

## Session memory (reboot recovery)

- `pty-host.ts` writes `sessions.json` atomically on tab create, close and rename (1.5 s debounce), and every 45 s when there was output. It also writes immediately on Windows `session-end` and on `powerMonitor` suspend / shutdown. A normal quit calls `stopAutosave()` before the final save, so session teardown cannot overwrite it with an empty list.
- Saved per session: the screen snapshot (200 lines of scrollback), the last folder, the agent's conversation id, and whether an agent was running at save time.
  - The last folder (`liveCwd`) comes from OSC 7, OSC 9;9, or the Windows prompt read as one logical line across wraps.
- Conversation ids (`resume.ts`):
  - **Claude:** a new session gets `--session-id <uuid>` from HERA, so its id is known from the start. At save time HERA refreshes it to the newest `~/.claude/projects/<encoded cwd>/*.jsonl` created after that terminal started, which covers `/clear`.
  - **Codex:** matched by the rollout file's timestamp and cwd.
  - The latest-started terminal picks first, so several agents in one folder get different conversations.
- On boot, `resumeRestored()` revives sessions 400 ms apart.
  - Shells reopen in their last folder; agents use `--resume <id>` / `resume <id>`.
  - Without a known id, an agent that supports exact resume starts a new conversation, so it never takes another tab's latest one. Other agents use their continue option.
  - Raw-command sessions stay dormant.
- Launch at login uses `setLoginItemSettings` only in installed builds (`app.isPackaged` and no `HERA_HOME`).

## Themes

- `shared/themes.ts` holds 9 presets plus user themes, resolved by `resolveTheme(settings, systemDark)`.
  - The renderer overrides only CSS tokens (`--ui-*`, `--term-bg`) inline; every other color is derived with `color-mix`.
  - `--ui-accent-fg` is the text colour on accent fills. `--ui-accent-text` is the accent nudged to at least 3.2:1 contrast against the background.
- Terminals are not recreated: only `term.options.theme` changes, which keeps the scroll position and the attachment. An unchanged palette returns the same object, so nothing redraws.
- Main never sets `nativeTheme.themeSource`, which would skew system detection. It updates the window background and the Windows caption buttons (`setTitleBarOverlay`). The last theme is painted from localStorage before boot, so the window does not flash.

## Status detection

- Status is re-checked on output at most every 650 ms (throttled, so a spinner that keeps redrawing cannot starve it), and periodically while an agent works.
- The bottom 14 screen lines (blank lines collapsed) are matched: approval patterns → `waiting`, work patterns → `busy`, otherwise `idle`.
- Agents are detected by case-sensitive signatures (`Claude Code`, `OpenAI Codex`, …). A plain shell prompt on the cursor line (`PS C:\…>`, `C:\…>`, `user@host$`) means the agent has exited.
- Built-in patterns follow new presets on app updates. Patterns the user edited (`customPatterns`) are kept.

## Message delivery (hera send / ask / reply)

- An AI target gets the envelope `[HERA msg from X] … — when done, hera reply X "<summary>"`. A shell target gets the raw text.
- When the app has bracketed paste on, the body is sent as `ESC[200~ … ESC[201~` and Enter follows separately (250–900 ms later), so the Claude and Codex TUIs treat it as a paste and keep line breaks. ESC sequences inside the body are stripped.
- Messages over 1,500 characters are saved under `mail/` and only the path is sent.
- A `reply` to a shell is logged, not typed, so prose never runs as a command.
- `ask` = send, then wait until the target has worked and gone idle, then print the end of its screen.

## Usage

- **Claude:** `message.usage` from `~/.claude/projects/**/*.jsonl` assistant records, de-duplicated by `message.id:requestId`, priced at API list prices.
- **Codex:** deltas of the cumulative `total_token_usage` in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. `rate_limits.primary/secondary` give the 5-hour and weekly %.
- **Claude limits:** claude-token-saver's `last-caps.json` or HERA's status-line tap `claude-caps.json`.
- **Antigravity:** conversation counts from `conversation_summaries.db` (no token data).
- **Cache:** per-file offsets and per-day, per-model totals are kept in `usage-cache.json`, so each run reads only appended bytes. Files untouched for 31 days are skipped. A fresh parse runs at most every 5 minutes; the refresh button forces one.
- **Per project:** each file's working folder (`cwd`, read once from the start of the log) is stored and totals are kept per `cwd × day × model`. Main splits them over registered projects (sub-folders included, deepest project wins) into today / 7-day / 30-day tokens and cost. A changed project list re-splits the totals without re-parsing.

## lanes integration

[lanes](https://github.com/jysvai/lanes) is a Claude Code plugin with no daemon or API: everything it does runs inside Claude sessions, and it keeps its state in files. `electron/lanes.ts` works only with those files and with lanes' own launcher.

- **Finding it.** `~/.claude/plugins/installed_plugins.json` gives the `lanes@<marketplace>` entry. For a folder marketplace (`known_marketplaces.json`, source `directory`) the plugin runs from that folder; otherwise from `installPath`. The option schema comes from the plugin's `.claude-plugin/plugin.json` `userConfig`.
- **Options.** Read from and written to `~/.claude/settings.json` → `pluginConfigs["lanes@…"].options`.
  - Only that key is touched. Values are checked against the schema (type and enum). `null` removes a value (back to the plugin default), and empty objects are pruned.
  - The first write keeps a copy of the original file as `claude-settings.backup.json` in HERA's data folder. A file that does not parse is not rewritten.
  - *Auto* mode clears every stored value (plugin defaults) and lets HERA pick the launch host, main flags and allow-list.
- **Project state.** For each lane:
  - **Name:** `<slug>-<tier>`, where slug = folder name plus the first 4 hex digits of the FNV-1a hash of the path, computed the way lanes does.
  - **Running:** a live `~/.claude/sessions/<pid>.json` with that name (pid checked).
  - **Live state:** `<project>/.claude/lanes/state/<tier>.json`.
  - **Tasks and verdicts:** `<tier>.tasks.json`.
  - **Cost and savings:** `<tier>.spend.json` (`onMain - cost`).
  - **Queued work:** `~/.claude/lanes/<slug>/<tier>.queue.json`.
  - **Reports:** `out/<id>.md`.
- **Starting a lane in a HERA tab (Windows).** HERA writes a small script and runs it in a new tab of the project.
  - The script removes inherited Claude session markers, defines a `Start-Process` function, then runs `lanes.ps1 start <tier>` with the effective options as parameters.
  - `lanes.ps1` opens a lane with `Start-Process powershell.exe -Command "<launch>" | Out-Null`. The function takes that call and starts the same command with `System.Diagnostics.Process.Start` on the tab's console.
  - It must not run the command through the pipeline: the redirected stdout would make Claude fall back to `--print`.
  - The role prompt, flags and the lane's hard denials are exactly what lanes.ps1 produces.
  - The tab carries `lane: 'mid' | 'low'` so the panel can link to it. Stopping a lane runs `lanes.ps1 stop` (it kills the lane's process tree and removes its registry entry) and closes the tab.
- **Separate windows (any OS).** `lanes.ps1` / `lanes.sh` run hidden with the same parameters (`LANES_*` env on macOS/Linux). `Workspace not trusted` in the output counts as a failure, because the script still exits 0.
- **Permissions.** For `dontAsk` lanes, the allow-list (default: `Read`, `Grep`, `Glob`, `Edit(./.claude/lanes/**)`, `SendMessage`, `ListAgents`, `WebSearch`, `WebFetch`, read-only git) is merged into `<project>/.claude/settings.local.json`. Auto mode does this when HERA starts a lane; the panel can also do it.
- **Main session (opt-in).** With *apply main settings* on, when HERA starts Claude without its own `--model` it appends `--model <main_model> --fallback-model <main_fallback> --effort <main_effort>`, what lanes' `claude-main` does. It is off by default so the user's own model choice is never overridden. Optionally both lanes start with Claude.
- Verified end to end: main Claude in a HERA tab → `/lane low …` → the low lane in another HERA tab answered → the reply arrived in main. The panel showed the task, its cost and the savings; `lanes:stop` closed the lane and its tab.

## Version check

- `electron/update.ts` asks `api.github.com/repos/jysvai/JYSV-HERA/releases/latest` 20 s after start and then every few hours, at most once per 6 hours (the Settings button forces it). The answer is kept in `update.json`; a failed attempt keeps the last good answer.
- Versions compare as x.y.z. The sidebar shows `vX.Y.Z` and turns into an update button when a newer one exists. `settings.checkUpdates = false` stops the background check; it is HERA's only traffic of its own.
- In-app update (only on the user's press): `installKind()` tells an NSIS install (an `Uninstall *.exe` beside the exe), a macOS bundle in a writable folder, `$APPIMAGE`, or a deb / rpm package (with `pkexec`) from portable copies. `downloadUpdate` streams the matching release asset to the temp folder, hashing as it goes, and refuses it unless the SHA-256 equals the asset's GitHub `digest` (or `SHA256SUMS.txt`). `installUpdate` then runs the NSIS installer with `/S --updated --force-run /allusers|/currentuser` (mode from the HKLM `InstallLocation` of the app GUID), swaps the `.app` / AppImage from a detached script that waits for HERA's pid, or runs `pkexec dpkg -i` / `rpm -U`, and quits through the normal `before-quit` path so sessions are saved.
- `hera --version` prints the version baked into the CLI at build time.

## Release pipeline

- `.github/workflows/release.yml` runs on a `v*` tag. Windows, macOS and Linux each build on their own GitHub runner. Each job then runs the packaged app in self-test mode before uploading:
  - `HERA_SMOKE=<file>` (`electron/smoke.ts`) opens a real terminal with the default shell, checks that a command runs and that the bundled `hera` CLI answers `--version`, checks that the window rendered, writes the result and exits 0 or 1.
  - `scripts/smoke.sh` runs that on each runner, under `xvfb-run` on Linux.
- **Windows:** NSIS installer and a zip, x64.
- **macOS:** dmg and zip for x64 and arm64, ad-hoc signed. No Developer ID yet; hardened runtime is off because ad-hoc signing would fail Electron's library validation. Minimum macOS 12.
- **Linux:** AppImage, deb, rpm and tar.gz, x64. node-pty has no Linux prebuild, so it is compiled in a `node:22-bullseye` container (glibc 2.31) and placed in `prebuilds/linux-x64`. The result loads on Ubuntu 20.04+, Debian 11+, Fedora and Rocky / Alma / RHEL 9+.
- Packaging keeps only the target platform's node-pty binaries (`win.files`, `mac.files`, `linux.files` excludes).
- A final job collects every file, writes `SHA256SUMS.txt` and publishes the GitHub release with the notes from `.github/release-notes/<tag>.md`.

## Security boundaries

- **Renderer:** sandboxed, `contextIsolation`, fixed IPC allow-list, CSP `script-src 'self'`, and navigation to external URLs blocked (origin check).
- **CLI:** requests are served only with the `cli-token` (mode 0600) from the data folder. This assumes a local tool running as the same user, which is equivalent to being able to type into the terminal.
- **Auth files:** only fields such as expiry, plan and email are read. Token values are never read or returned.
- **Shell quoting:** PowerShell doubles `'` and the curly quotes `‘ ’ ‚ ‛`. `aliases.ps1` carries a BOM so 5.1 does not read it as ANSI. External cmd launches go through a `.cmd` launcher that is safe with spaces in paths.
- **Inherited markers:** Claude / Codex / Gemini session markers (`CLAUDECODE`, `CLAUDE_CODE_*` session fields, `CLAUDE_PID`, `CLAUDE_LANE`, …) do not leak into new terminals when HERA itself was started from an agent.
- **Python on Windows:** `PYTHONUTF8=1` keeps Python's Korean output intact.
- **Network:** the only request is the optional GitHub release check above; no telemetry.

## File map

| Path | Role |
|---|---|
| `electron/main.ts` | boot switches, window, tray, global hotkey, notifications, IPC registration |
| `electron/pty-host.ts` | session lifecycle, attach protocol, status detection, key/message input, autosave/restore, conout worker cap |
| `electron/resume.ts` | session memory: shell folder tracking, agent conversation ids |
| `electron/lanes.ts` | lanes integration |
| `electron/update.ts`, `smoke.ts` | release check, in-app download / install, self-test mode for CI |
| `electron/extensions.ts` | Extensions & updates page: CLI / global package versions (npm, Homebrew, uv, pipx, self-updaters) and each CLI's plugins, MCP servers and skills; update commands run in a terminal tab, built here from ids |
| `electron/files.ts` | folder tree of a project (listing, open / reveal, git status) |
| `electron/codex.ts` | `--no-daemon` for HERA's Codex tabs |
| `shared/i18n.ts`, `shared/i18n/` | UI language: Korean source strings as keys, English dictionaries |
| `electron/bus.ts` | hera pipe server and handlers; answers for a helper that finishes a `hera send` without replying |
| `electron/teamwork.ts` | multi-agent work from the window: reuse or open helpers, wait until the agents are ready, brief the lead and hand over the task |
| `electron/shell.ts` | shell discovery, boot script, alias files |
| `electron/insight.ts`, `agent-data.ts` | backlog data (git, Claude/Codex/agy activity) |
| `electron/usage*.ts` | usage worker and summaries |
| `electron/accounts.ts`, `history.ts`, `external.ts` | accounts, prompt history search, external terminal, folder scan |
| `cli/hera.ts` | hera CLI (runs on Node or on the HERA executable as RunAsNode) |
| `shared/` | types, defaults, utilities, themes (shared by main, renderer and CLI) |
| `src/` | React UI (`app/` screens, `store/` state, `components/ui/` primitives) |
