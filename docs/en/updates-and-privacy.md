<!-- lang --><sub>[한국어](../ko/updates-and-privacy.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Updates and privacy

## Version

The installed version is shown at the bottom of the sidebar and at the top of Settings ("JYSV HERA v0.2.1"). In a terminal: `hera --version`.

## Update check

HERA never updates itself. It only tells you that a newer release exists.

- About 20 seconds after startup, and then every few hours, HERA asks GitHub for the latest release of `jysvai/JYSV-HERA` (one request to the public releases API). It does not repeat the request if the last answer is less than 6 hours old.
- If a newer version exists, the version label in the sidebar becomes an update button, and Settings shows "A new version vX.Y.Z is out" with **Open release page** (릴리스 페이지 열기). You download and install it yourself.
- **Check now** (지금 확인) forces a check. A failed check keeps the last good answer and shows the error.
- Switch **Automatic update check** (새 버전 자동 확인) off in Settings to stop it. It is the only network request HERA makes. With it off, HERA contacts nothing.

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
