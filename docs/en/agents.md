<!-- lang --><sub>[한국어](../ko/agents.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Agents

<img src="../images/features/agents.jpg" alt="" width="120" align="right">

An agent is any AI command-line tool that runs in a terminal. HERA knows 32 of them out of the box and lets you add your own. Open the **Agents** (에이전트) page from the sidebar.

## The built-in list

Only the tools HERA finds on your PATH show up in launch menus and on the start screen. On the Agents page, installed and custom agents come first. The rest are folded under "N other supported AI CLIs" (지원하는 다른 AI CLI N개). They move up by themselves once you install them.

Each row shows:

- Installed / not installed (설치됨 / 미설치).
- Badges: usage tracking (사용량 추적) when HERA can read that tool's local logs, and account profile (계정 프로필) when it supports separate login folders.
- The path or command, an install hint ("설치: …") for tools you do not have yet, a link to the tool's home page, and a switch to enable or hide it.

## Status detection

HERA reads each session's screen and shows one of: **working**, **waiting for approval**, **idle**. The dot on the tab, the sidebar counters and the Sessions page all use it. Detection is pattern based. Every agent has two regular expressions that are matched against the bottom of the screen:

- Working pattern (작업중 감지 정규식)
- Approval-waiting pattern (승인 대기 감지 정규식)

If a tool's status is wrong, click its row, edit the patterns and save. For a built-in agent this stores your own patterns without touching the defaults.

## Notifications

HERA raises a desktop notification in two cases. Each has a switch in Settings, Window and notifications (창 · 알림):

- **AI work finished** (AI 작업 완료 알림): an agent in a session you are not looking at stops after working for 8 seconds or more.
- **Waiting for approval** (승인 대기 알림): an agent asks for permission or confirmation and waits.

## Add your own agent

Press **Add agent** (에이전트 추가). Fields:

| Field | Meaning |
|---|---|
| Name | Shown in menus. |
| Run command (실행 명령) | Typed into the shell as is, so it can include flags: `ollama run llama3`. |
| Resume arguments (이어하기 인자) | Added to resume the last conversation, if the tool has such a flag. Leave empty if not. |
| Color | The dot and icon color. |
| Working / approval patterns | Regular expressions for status detection (see above). |
| Screen-identification pattern (optional) | Lets HERA recognise the tool when you started it by hand inside a plain terminal. |
| Account folder variable (optional) | The environment variable the tool uses for its config folder, such as `CLAUDE_CONFIG_DIR`. Needed for account profiles. |
| System-prompt flag (optional) | The flag that adds text to the system prompt. Used to brief the main agent of a team. |

Custom agents can be deleted from the same dialog.

## Account profiles

An account profile is a separate configuration folder for an agent, so you can keep a work and a personal login side by side. Create them on the **Accounts · auto login** (계정 · 자동 로그인) page: give the profile a label (for example "work") and a folder (for example `~/.claude-work`), then press the login button for that profile. HERA starts the tool with the folder set (`CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex), and later sessions with that profile are already logged in. HERA does not read the tokens; it only shows expiry and plan information.

Profiles can be chosen in a team's pane settings ("default account" means no profile) and when launching an agent.

## Teams

A team preset opens several agents in one folder. Create one on the Agents page under "Team presets" (팀 프리셋), with **Add team**.

- A name and up to four panes.
- Each pane has a role (**Main** or **Helper**), an agent and an account profile.
- Switch on "Brief the main agent on the team and `hera`" (메인 에이전트에게 팀 구성·hera 사용법 브리핑) to give the main agent the team layout and the [hera](hera-cli.md) commands when it starts. This only works for agents that have a system-prompt flag (Claude Code does).
- Saving needs a name and at least one Main pane.

Teams appear as **Start as a team** on a project's start screen.

## See also

- [The hera CLI](hera-cli.md) for how agents talk to each other.
- The **Sessions** (세션 현황) page lists every open session with status counts, a peek at its screen, a box to send a message, and a way to send the same message to several sessions. It also lists Claude Code sessions on the PC that were started outside HERA.
- The **Agent chat** (에이전트 대화) page logs the instructions and replies sent with `hera`.
- The **Prompt history** (프롬프트 기록) page searches the prompts you sent to Claude, Codex and Antigravity, with a copy button.
