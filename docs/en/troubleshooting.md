<!-- lang --><sub>[한국어](../ko/troubleshooting.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Troubleshooting

## The installer is blocked

- **Windows SmartScreen** ("Windows protected your PC"): HERA is not code-signed yet. Choose *More info*, then *Run anyway*. The installer is per user and needs no administrator rights.
- **macOS Gatekeeper**: the app is not notarized yet, so the first launch is blocked. On macOS 15 and later, try to open it once, then go to *System Settings → Privacy & Security* and press **Open Anyway** (right-click → *Open* no longer works there). On macOS 13–14, right-click it in Applications and choose *Open*. Or run:

  ```
  xattr -dr com.apple.quarantine "/Applications/JYSV HERA.app"
  ```
- **Linux AppImage** will not start: `chmod +x JYSV-HERA-*.AppImage`, then run it.

## No terminal opens: the screen only says "Register a project"

Terminals open inside a project, and a project is a folder you registered. Drag a folder onto the left sidebar, or press **Add folder** (폴더 추가), then click the project. The start screen offers *Terminal* and one card per installed AI. Step by step: [Getting started](getting-started.md).

## I installed an AI CLI, but HERA does not show it

HERA reads your PATH when it starts. Quit it completely (closing the window only hides it in the tray: right-click the tray icon → *Quit*) and start it again. If it is still missing, see [An AI CLI does not appear in the launch menus](#an-ai-cli-does-not-appear-in-the-launch-menus).

## The mouse wheel does nothing (or sends arrow keys) in Claude Code, vim or htop

On Windows this is the ConPTY difference described in [Terminal](terminal.md#conpty-bundled-or-system-windows). Since 0.2.1 HERA uses Windows Terminal's engine by default. Check Settings, Terminal, **Use the latest ConPTY** (최신 ConPTY 사용) is on, then open a *new* terminal: the setting only affects terminals started after you change it. If you turned it off to work around another problem, that is the cause.

## The screen looks garbled after resizing or switching tabs

Fixed in 0.2.1 (screens rebuilt after a tab switch lost cursor and scroll state, and emoji widths differed). If you are on an older version, update. If it still happens on 0.2.1, note the program and your Windows version and report it.

## Pasting inserts the text twice

This was a bug before 0.2.1: `Ctrl+V` pasted once through HERA and once through the browser. Update to 0.2.1 or later.

## A lane opens in its own window instead of a HERA tab

HERA only takes the lane when all of these hold:

1. "Use lanes in HERA" is on and the launch mode is **HERA tab** (see [Lanes](lanes.md)).
2. The folder belongs to a project registered in HERA. Start Claude from a registered project, or add the folder.
3. The lanes plugin is version 0.3.13 or newer. Older versions open a lane in a HERA tab only when you start it from HERA on Windows; a lane the main Claude opens by itself gets its own window.

Otherwise lanes opens its own window by design.

## An AI CLI does not appear in the launch menus

The tool must be found on the PATH that HERA sees. On macOS and Linux, a HERA started from the Dock, Finder or a desktop launcher asks your login shell (`zsh -il`, `bash -il`, fish) for its PATH since 0.2.3, and adds the usual install folders (Homebrew, npm, bun, `~/.local/bin`). Check in a HERA terminal: `where claude` (Windows) or `which claude`. If it is installed in a folder that only your shell profile adds to PATH, make sure **Load shell profile** is on (Settings, Terminal), or add the folder to the system PATH and restart HERA. If the command is installed under a different name, add it as a custom agent with the exact command ([Agents](agents.md#add-your-own-agent)). Tools that are not installed are listed under "N other supported AI CLIs" with an install hint.

## The status dot is wrong (stuck on working, or never shows waiting)

Status comes from patterns matched on the bottom of the screen. Open the agent's row on the Agents page and adjust the working or approval patterns, or report the tool's new prompt text.

## Korean (or other) text is garbled in a Python script's output

On Windows HERA sets `PYTHONUTF8=1` for the terminals it starts, and starts PowerShell and cmd in UTF-8. If you still see broken text, check the program is not running in an old code page of its own, and that the file you read is UTF-8. A Python started from a terminal that already had `PYTHONUTF8` set to something else keeps your value.

## A shell I typed (WSL, a custom command) does not start

Run the same command line by hand in a HERA terminal. A command line is split on spaces; wrap paths that contain spaces in double quotes. If HERA cannot find the program, it opens your default shell instead. For WSL, `wsl.exe -d <name>` needs the exact distribution name from `wsl -l`.

## Codex asks me to sign in again after HERA restarts

Check that *Settings → Terminal → Keep Codex signed in* is on (it is by default): HERA then starts Codex tabs with `--no-daemon`. If the login screen still appears, `auth.json` itself is signed out; sign in once and it stays across restarts. See [Agents → Keeping the Codex login](agents.md#keeping-the-codex-login).

## The in-app update fails

Settings, Version · Update shows the reason. A checksum mismatch or a broken download installs nothing; press the button again or download from the **Release page**. An all-users Windows install needs you to allow the admin prompt, and on macOS the folder holding the app must be writable.

## Reset settings

Quit HERA first, then in the [data folder](updates-and-privacy.md#where-data-is-stored):

- Rename `config.json` to reset settings, projects, themes and agents to the defaults. HERA creates a new one on the next start.
- Rename `sessions.json` to forget open tabs.
- Rename the whole folder to start completely fresh.

Renaming rather than deleting lets you move things back.
