# Changelog

Full patch notes, one file per release in English and Korean: [docs/patch-notes](docs/patch-notes/README.md).

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
