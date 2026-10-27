<!-- lang --><sub>[한국어](../ko/updates-and-privacy.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Updates and privacy

## Version

The installed version is shown at the bottom of the sidebar and at the top of Settings ("JYSV HERA v0.2.1"). In a terminal: `hera --version`.

## Update check

- About 20 seconds after startup, and then every few hours, HERA asks GitHub for the latest release of `jysvai/JYSV-HERA` (one request to the public releases API). It does not repeat the request if the last answer is less than 6 hours old.
- If a newer version exists, the version label in the sidebar becomes an update button, and Settings shows the same button next to **Release page**.
- **Check now** (지금 확인) forces a check. A failed check keeps the last good answer and shows the error.
- Switch **Check for new versions** off in Settings to stop it. It is the only network request HERA makes on its own. With it off, HERA contacts nothing until you press an update button.
- Opening *Agents → Extensions & updates* runs `npm outdated -g` (and `brew outdated` for the formulas your AI CLIs come from), which ask the npm registry and Homebrew for the latest versions. Nothing else from that page goes online until you press an update button.

## Updating from inside the app

1. Press **Update**. HERA downloads this OS's package from the GitHub release; the button shows the progress.
2. The file's SHA-256 is compared with the digest GitHub publishes for it (or the release's `SHA256SUMS.txt`). If they differ, nothing is installed.
3. The button becomes **Restart to install**. Pressing it saves your sessions, closes HERA, installs the new version and starts it again. Terminals come back through [session memory](session-memory.md), but running work stops, so pick your moment.

| Installed as | Update |
|---|---|
| Windows installer (per user or all users) | Runs the installer silently. For an all-users install Windows asks once for admin rights. Same folder, data kept. |
| macOS app | Replaces `JYSV HERA.app` and opens it again. The folder holding the app must be writable. |
| AppImage | Replaces that AppImage file. |
| deb, rpm | Installs the package through `pkexec` (asks for your password). |
| Windows portable zip, tar.gz, dev build | Opens the release page. |

The **Patch notes** (패치노트) button opens the notes of your version (or of the newer one, if there is one) on GitHub. The files are in `docs/patch-notes/en` and `docs/patch-notes/ko` of the repository.

## What HERA sends

Nothing about you. The update check sends a standard HTTP request with the user agent `JYSV-HERA/<version>`. There is no telemetry, no account, and no analytics. Agents you run (Claude Code, Codex and the others) talk to their own services as they always do; that traffic is theirs, not HERA's. The `hera` command and the lanes integration work over local pipes only.

## Where data is stored

HERA's data folder:

| System | Location |
|---|---|
| Windows | `%APPDATA%\JYSV HERA` |
| macOS | `~/Library/Application Support/JYSV HERA` |
| Linux | `~/.config/JYSV HERA` |

Settings shows the exact path under the page title. Setting the environment variable `HERA_HOME` to another folder before starting makes HERA use that folder and run as a separate instance.

What is in it:

| File or folder | Contents |
|---|---|
| `config.json` | Your settings, projects, custom agents, themes, teams, account profiles. |
| `sessions.json` | The open terminals and their last screens, for [session memory](session-memory.md). |
| `launches.jsonl` | When each project was last run, with what. |
| `bus.jsonl` | The log of `hera` messages (Agent chat page). |
| `mail/` | Long `hera` messages, saved as files. |
| `usage-cache.json` | The aggregated [usage](usage.md) numbers. |
| `claude-caps.json` | The latest Claude limit percentages, if you switched the status line integration on. |
| `claude-settings.backup.json` | A one-time backup of Claude Code's settings, made before HERA changes them. |
| `cli-token` | A random token that lets the `hera` command talk to the app. Readable only by you. |
| `update.json` | The last update check result. |
| `window.json` | Window size and position. |
| `shell/` | The generated shortcut and start-up files for your shells. |

Logs from the AI tools themselves (read for usage and history) stay where those tools keep them. HERA reads them and does not copy them. The prompts shown on the Prompt history page come from those logs.

To start fresh, quit HERA and delete (or rename) the data folder.
