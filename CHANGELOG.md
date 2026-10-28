# Changelog

Full patch notes, one file per release in English and Korean: [docs/patch-notes](docs/patch-notes/README.md).

## 0.2.6 — 2026-10-28

### Fixed

- Dates and times follow the window language (`locale()` in shared/i18n), not the OS locale.
- Team preset names on the Agents page go through `t()`.
- Menus open upwards when they do not fit below their button.

### Docs

- Picture-led Getting started (annotated demo screenshots and three drawings, en and ko).

## 0.2.5 — 2026-10-28

### Security

- Electron 40.10.2 → 44.10.0 (Chromium 152): closes 14 Electron advisories. The clipboard image paste moved to the async `clipboard.read()` API.
- CodeQL fixes now ship in the app: CSPRNG ids, private paste folder with exclusive file creation, lanes settings race, refused `.cmd` arguments with shell-breaking characters.
- Dev tooling: Vite 8.3.5; `extract-zip` and `launch-editor` gone from the tree.

### Fixed

- macOS: pasting a screenshot attached it twice (HERA's file path plus the agent reading the clipboard after xterm's empty paste).

### Changed

- macOS 13+ (Electron 44 dropped macOS 12).
- `npm run dev` downloads the Electron binary on first run (Electron 42+ no longer does it on install).

## 0.2.4 — 2026-10-28

### Added

- Multi-agent work from the backlog (▶ on a to-do, or the team button by the input) and from an open session (team button in the tab bar): HERA opens or reuses helpers, waits until the agents are ready, briefs the lead and hands over the task.
- Automatic reply: a helper that finishes a `hera send` without `hera reply` has its last screen sent to the sender after 20 quiet seconds; a helper waiting for approval is reported to the lead.
- Sigstore build-provenance attestation for every release file (`gh attestation verify`).
- Electron fuses: no `NODE_OPTIONS`, no `--inspect`, code only from the integrity-checked `app.asar`.
- Code signing wired into the release workflow (Windows SignPath, macOS Developer ID and notarization), active once the secrets exist.
- CodeQL workflow, `npm audit` of shipped dependencies in CI, SECURITY.md, security docs.

### Fixed

- Right-panel tab labels wrapping.
- Windows desktop and Start menu icons kept the old picture after an update (installer refreshes the icon cache).

## 0.2.3 — 2026-10-27

### Fixed

- **Codex login lost after a HERA restart or update:** Codex tabs start with `--no-daemon` (when the installed Codex supports it), so a shared Codex daemon holding a stale login cannot sign them out. Setting: *Keep Codex signed in*.
- **macOS / Linux launcher PATH:** HERA takes the login shell's PATH, so CLIs installed with Homebrew, npm, bun or the Claude installer are found and lanes can start `claude`.
- lanes "open all" reports the failure instead of saying it opens.

### Added

- In-app update: download, SHA-256 check against GitHub's asset digest, restart into the installer (NSIS per user / all users, macOS app, AppImage, deb, rpm).
- Extensions & updates page: AI CLIs and global npm / Homebrew / uv / pipx tools with installed and latest versions, plus each CLI's plugins, MCP servers and skills (Claude Code, Codex, Gemini CLI, Qwen, OpenCode, Copilot, Cursor, Kiro, Droid, Kimi, Amp, Crush, Hermes, `~/.agents/skills`); updates run in a terminal tab.
- English UI with an Auto / 한국어 / English setting.
- Prompt history grouped by folder.
- Folder tree in the right panel (`Ctrl+Shift+E` / `⌘E`) with git status, open, reveal, copy path, insert or drag a path into a terminal.
- Drop folders on the sidebar to add projects.
- Terminal zoom: `Ctrl`/`⌘` `+` `-` `0` and `Ctrl`/`⌘` + wheel.
- New app icon (gold `>_` under a crown).

## 0.2.2 — 2026-10-27

### Fixed

- Usage refreshed only every 10 minutes: the 5-minute poll always landed inside the 5-minute cache. Tokens are re-parsed at most every 4 minutes now.
- Claude Code and Codex limits are read on every request instead of being cached with the tokens.

## 0.2.1 — 2026-10-27

### Fixed

- **Mouse wheel in full-screen programs** (Claude Code's full-screen mode, vim, htop): HERA ships Windows Terminal's ConPTY, which passes mouse modes through; the built-in one swallowed them.
- **Scrolling after a tab switch:** restored screens keep the SGR mouse encoding, cursor visibility and shape, and the scroll region.
- **Broken screens after a tab switch or resize:** the background copy uses the same Unicode 11 widths and ConPTY rules as the visible terminal; snapshots keep the full scrollback.
- **Stale rows until scrolling**, **double paste**, **resize storms** and **background tabs that never started** with the new ConPTY.
- **lanes replies lost after a restart:** a lane's conversation is never resumed in a main tab; lane tabs are not restored by HERA.

### Added

- lanes open as HERA tabs whoever opens them (lanes 0.3.13+, registered projects only), through the new `hera host`.
- Windows Terminal import (font, cursor, scrollback, shell, color scheme), any shell or command line (WSL, custom), cursor settings, bundled Cascadia Mono.
- Image paste: a clipboard image is saved as a PNG and its path pasted, for agent CLIs to attach.
- Patch notes in `docs/patch-notes/{en,ko}`; releases are written from them and updated when they change.

## 0.2.0 — 2026-10-27

First public release.

### Added

- **Builds for every OS.** Windows 10/11 (installer and zip), macOS 12+ for Intel and Apple Silicon (dmg, zip), and Linux x64 (AppImage, deb, rpm, tar.gz). Every build is self-tested on its own OS in CI before release.
- **32 built-in agent CLIs.** New: Grok Build (xAI), Muse Code (Meta), Mistral Vibe, Kiro CLI, Goose, Cline, Continue, Auggie, Junie, Devin, Kilo Code, Qoder, Rovo Dev, Jules, Letta Code, Codebuff, Codewhale, Hermes Agent, LM Studio and `llm`. Agents that are not installed are folded away with their install command and homepage.
- **lanes integration.** Lanes page, Lanes panel, lanes run in HERA tabs, model routing, permissions and per-project instructions.
- **Version tag and update check.** Shown in the sidebar and in Settings; also `hera --version`. The check can be turned off.
- **Usage.** Usage tab and per-project usage.
- **Themes.** Dark / light / system, presets and a custom theme editor.
- **Session memory.** Exact Claude Code / Codex conversation resume after a reboot.
- **Self-test mode.** `HERA_SMOKE=<file>`.

### Changed

- **Gemini CLI no longer built in.** It was replaced by Antigravity for Google accounts; it can still be added on the Agents page.
- **lanes main-session flags are opt-in.** HERA no longer adds a `--model` to Claude unless you turn it on.
- **Lighter.** node-pty's per-terminal output worker gets a small heap, WebGL loads only in GPU mode, and installers carry only their own platform's native files.

### Fixed

- **Antigravity sign-in.** Detected correctly with agy 1.4+, which logs "not logged in" while it loads the token from the keyring.
- **Linux terminals.** No longer told they run on ConPTY, which broke line reflow there.
- **Settings on Linux.** The shell and external-terminal options no longer show Windows choices.

## 0.1.0

Private build. Project launcher, multi-agent workspace, the `hera` CLI and the message bus.
