<!-- lang --><sub>[한국어](../ko/terminal.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Terminal

<img src="../images/features/terminal.jpg" alt="" width="120" align="right">

HERA keeps your usual shell and adds project tabs, split view and the things agents need around it.

## Tabs and split view

- `Ctrl+Shift+T` opens a terminal, `Ctrl+Shift+W` closes it. `Ctrl+Tab` goes to the next tab, `Alt+1` to `Alt+9` jump to a tab. On macOS use `⌘T`, `⌘W`.
- Double-click a tab to rename it. Middle-click closes it.
- Each tab shows a status dot, the agent icon, its title and a short name such as `claude-1`. That short name is what you use with the [`hera` CLI](hera-cli.md).
- With more than one session, the split button (분할 전환) shows up to four terminals at once: two side by side, or a 2×2 grid. With three, the first one spans two rows. In a team, panes are labelled Main and Helper (메인 / 보조).

### Send one question to several agents

In split view a bar at the bottom lists the sessions as chips. Switch on the ones you want, type, and press `Enter` (not `Shift+Enter`). The text goes to every selected session. A toast confirms how many received it.

## Copy and paste

| Action | Windows / Linux | macOS |
|---|---|---|
| Copy selection | `Ctrl+C` when text is selected, or `Ctrl+Shift+C` | `⌘C` |
| Paste | `Ctrl+V` | `⌘V` |

With nothing selected, `Ctrl+C` is sent to the program as usual (interrupt). ### Paste an image

A terminal can only receive text, so when the clipboard holds an image (a screenshot, say) and no text, `Ctrl+V` (`⌘V` on macOS) saves it as a PNG and pastes the file's path. Claude Code, Codex and other agent CLIs attach an image whose path is pasted into their prompt; in a plain shell you get a path you can pass to any command. The files go to `jysv-hera-paste` in your temp folder and are removed after a week.

## Drag and drop

Drop files or folders on a terminal to type their paths. Paths with spaces or special characters are quoted for the tab's shell: single quotes for PowerShell and pwsh, double quotes for cmd, POSIX quoting for the others.

## Scrollback

Set the number of lines in Settings, Performance and memory (500 to 20,000, default 3,000). The terminal view shows at most 5,000 lines even if you set more. Changing tabs or hiding a terminal does not lose the history: HERA keeps each session's screen in the background and redraws it when you come back.

## Fonts

HERA ships **Cascadia Mono**, so the default look is the same on every PC. The default font list is `"Cascadia Mono", "D2Coding", Consolas, "Malgun Gothic", monospace` (on macOS `"SF Mono", Menlo, "D2Coding", "Apple SD Gothic Neo", monospace`). Edit the list in Settings, Terminal, Font. Font size (8 to 28) and line spacing (1.0 to 2.0) are next to it. Changing any of these reopens the terminal view; running programs keep running.

## Cursor

Settings, Terminal, Cursor: choose bar, block or underline, and whether it blinks. This applies at once to open terminals.

## GPU acceleration

Settings, Performance and memory, GPU acceleration (WebGL terminal). Off by default. It can draw faster on some machines. Restart HERA after changing it.

## ConPTY: bundled or system (Windows)

ConPTY is the part of Windows that connects a terminal program to a shell. HERA ships the newer ConPTY that Windows Terminal uses, and uses it by default (**Use the latest ConPTY**, 최신 ConPTY 사용). Reason: the engine built into Windows swallows mouse and wheel events, so full-screen programs such as Claude Code's fullscreen mode, vim or htop cannot scroll with the wheel. With the bundled one they work.

<p align="center"><img src="../images/tui-wheel.gif" alt="The mouse wheel scrolling inside a full-screen program in HERA" width="680"></p>

If you switch it off, HERA uses the Windows engine. This applies to terminals you open afterwards. If a terminal fails to start with the bundled engine, HERA falls back to the system one by itself.

## Shells

Set the default in Settings, Terminal, Default shell. Each project can override it in [project settings](projects.md#project-settings).

The list shows what your PC has:

- Windows PowerShell 5.1 (the "auto" choice on Windows)
- PowerShell 7 (`pwsh`)
- Command Prompt (`cmd`)
- Git Bash
- WSL (default distribution)
- On macOS and Linux: `bash`, `zsh`, `fish`. "Auto" uses your login shell (`$SHELL`).

For anything else choose **Type a command line…** (직접 입력) and type it exactly as you would run it. It runs as written:

```
wsl.exe -d Ubuntu
"C:\Program Files\Nushell\nu.exe"
```

Quote paths that contain spaces. If the program cannot be found on PATH, HERA starts your default shell instead.

HERA adds its `hera` command and your shortcuts to every shell without editing your own profile files.

### Loading your shell profile

**Load shell profile** (셸 프로필 불러오기) is on by default, so `$PROFILE`, `.bashrc` and similar files run as usual. Turn it off for faster-opening terminals: PowerShell then starts with `-NoProfile`. Your shortcuts and `hera` keep working either way.

## Import from Windows Terminal

If HERA finds Windows Terminal (stable, Preview or an unpackaged install), Settings, Terminal shows an **Import from Windows Terminal** card. It reads the default profile and offers:

<p align="center"><img src="../images/wt-import.gif" alt="Importing Windows Terminal settings: the terminal takes the One Half Dark colors, 15px font and block cursor" width="760"></p>

- Font (face and size; points are converted to pixels)
- Cursor shape
- Scrollback
- Default shell (PowerShell 7, WSL, Git Bash, cmd, or the command line as written)
- Terminal colors (the color scheme)

Font, cursor, scrollback and shell are ticked by default; colors are not. Press **Import selected** (선택한 항목 가져오기). The imported font is put in front of your list and the Korean fallbacks stay. A color scheme is added as a custom theme named "<scheme> (WT)" and selected for dark or light depending on its background. Nothing is changed until you press the button, and it applies to terminals you open afterwards. The card only appears on Windows, and only when a Windows Terminal settings file is found.

## Open in an external terminal

The **+** menu has **Open in external terminal**. Settings, Terminal, External terminal picks which one: automatic, Terminal.app or iTerm on macOS, Windows Terminal or a console window on Windows.
