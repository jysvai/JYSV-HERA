<!-- lang --><sub>[한국어](../ko/usage.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Usage

<img src="../images/features/usage.jpg" alt="" width="120" align="right">

HERA shows how much of your AI plans you are using: limits, tokens, and an estimated cost, per agent and per project. Everything is computed on your PC from the log files each tool already writes. HERA sends nothing anywhere to do this, and it works in a separate process so the terminals stay responsive.

## The Usage page

Open **Usage** (사용량) from the sidebar. **Refresh** (새로고침) recomputes now; otherwise the page refreshes every 90 seconds while the window is visible. Limits are read fresh every time; token totals are re-counted at most every 4 minutes.

The first time, HERA has to read all existing logs, which can take from tens of seconds to a few minutes (the page says so). After that it only reads what is new.

### Overall and per project

Totals for today, the last 7 days and the last 30 days with tokens and cost, then a ranking of your registered projects.

### One card per agent

- **Limit bars** (Claude Code only, see below), each with a reset time: "resets in 40 minutes", "resets in 2 h 10 min" or a date. A bar is the accent color normally, turns to the *working* color at or above the warning threshold, and to the *waiting* color at 95% or more.
- **Source** of the numbers.
- Tokens for today, 7 days and 30 days, with the number of responses. An estimated cost (`≈$`) is shown for Claude only.
- A chart of tokens per day over the last 30 days, and the tokens of the last 5 hours.
- Top 6 **models** and top 6 **folders** over 30 days.
- "No local records" (로컬 기록 없음) when the tool has left no logs.
- Antigravity shows only a short note, no token statistics.

Costs are estimates at the public API list price. They are not your bill: a subscription plan costs what it costs. They are useful to compare projects and models.

### Warning threshold

Settings, Window and notifications, "Usage warning threshold" (사용량 경고 기준), default 80%. The limit bars change color above it.

## Limits (the 5-hour and weekly bars)

Claude Code only hands its limit percentages to its status line command. To see them in HERA, open **Accounts** (계정 · 자동 로그인) and switch on "Collect 5-hour/weekly limit % from the Claude Code status line" (Claude 한도 연동). HERA then wraps your current status line command, after backing up the Claude settings file, records the numbers in its data folder, and still shows your original status line. Switch it off to restore the original. If the claude-token-saver plugin is installed, HERA reads its cache automatically and you do not need to switch anything on.

## Usage in the side panel

In a project, the right-hand panel has a **Usage** tab: "Limits · tokens · by project (updates every 5 minutes, ↻ now)" with a **Details** button that opens the full page. It refreshes every 60 seconds.

## Per-project numbers

Each project row in the sidebar shows today's tokens, and the backlog panel shows the project's usage, based on the folder the agent was run in.
