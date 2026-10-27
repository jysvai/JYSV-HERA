<!-- lang --><sub>[한국어](../ko/lanes.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Lanes

<img src="../images/features/lanes.jpg" alt="" width="120" align="right">

[lanes](https://github.com/jysvai/lanes) is a Claude Code plugin that lets your main Claude session hand side work to two cheaper helper sessions: **mid** (work that needs judgement) and **low** (mechanical work). HERA can run those helpers as tabs next to your main session and manages the plugin's settings from one page.

HERA does not include lanes. Install the plugin first. Open **Lanes** (Lanes 연동) in the sidebar; if the plugin is missing, the page shows the install steps:

```
/plugin install lanes --marketplace jysvai/lanes
```

or from a normal terminal:

```
claude plugin marketplace add jysvai/lanes
claude plugin install lanes@claude-mod --scope user
```

Press "Find again" (다시 찾기) after installing. The status card shows "Installed" (설치됨) and whether lanes is on or off in Claude Code.

A lane you start from HERA opens as a HERA tab with any lanes version on Windows. A lane the main Claude opens by itself (a task sent to a closed lane, `/lane start`, a lane restarted after it died) becomes a HERA tab with lanes 0.3.13 or newer, on every OS: lanes asks HERA for the tab with `hera host --lane`.

## Turn it on

In the **Integration** (연동) section switch on "Use lanes in HERA". A **Lanes** tab appears in the right-hand panel of every project.

"Setup mode" (설정 방식):

- **Automatic (recommended)**: fields are locked and use the plugin's recommended values. Switching to automatic resets the options you stored and applies the recommended permission rules.
- **Manual** (직접 조정): you set everything below.

## Model routing

A table with one row each for **Main**, **mid lane** and **low lane**: model, fallback model (used when the first is overloaded) and effort (`low`, `medium`, `high`, `xhigh`, `max`). Model names are free text; the list suggests `claude-opus-5-5[1m]`, `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-5-5`.

- "Apply main settings to Claude opened by HERA" adds `--model`, `--fallback-model` and `--effort` to Claude sessions HERA starts.
- "Hand-off nudge (tokens)" is how large the main conversation may grow before lanes suggests handing work off. `0` turns the nudge off.
- "Work style" (작업 스타일): Auto, Developer, Planner or Beginner. It changes how lanes words its prompts.

## How lanes run

- "When HERA opens a lane": in a **HERA tab** or a **separate window**.
- "When Claude opens a lane itself": a separate window (the default) or in the background. A background lane can be viewed with `claude attach`. When that Claude runs in a HERA tab of a registered project and "When HERA opens a lane" is **HERA tab**, the window choice becomes a HERA tab instead (lanes 0.3.13+).
- "Open lanes together with Claude" starts both helpers whenever you open Claude.
- "Close idle lanes automatically (minutes)": `0` means never; the maximum is 1,440.

<p align="center"><img src="../images/lanes-tab.gif" alt="lanes starting a mid lane, which opens as a HERA tab" width="760"></p>

Lane tabs are titled "lane · mid" and "lane · low". HERA only opens a lane in a project you registered. If you start Claude in a folder that is not a HERA project, the plugin opens its own window instead. Closed or finished lane tabs of the same kind are replaced when a new one opens.

If Claude does not trust the folder yet, HERA shows "Workspace not trusted"; open Claude there once and accept.

## Permissions

Lanes work unattended, so permissions matter. Pick a mode:

- **auto** (recommended)
- **acceptEdits**
- **dontAsk**
- **manual**: asks every time; only usable when the lane is in a HERA tab or window you can answer.
- **bypassPermissions**: no checks at all. Marked dangerous.

The allow-rules box writes to the project's `.claude/settings.local.json`. Lanes always blocks lane code edits and `git commit/push/reset` regardless of what you allow. When the mode is `dontAsk` and a project has no allow list, the Lanes panel shows a notice with an "Apply allow list" button.

## Instructions for each project

The "Per-project instructions" (프로젝트별 작업 지시) section has a box for mid and one for low. Write what that project's helpers should know. "Write automatically" (자동 작성) drafts text from the project; **Save** stores it in `.claude/lanes/roles/mid.md` or `low.md` in the project, appended after lanes' own role prompt. Emptying a box and saving deletes the file. Changes apply the next time the lane opens.

## The Lanes panel

In the right-hand panel, **Lanes** shows:

- The project slug in the title, **Open all / Close all** and **Lanes settings**.
- One card per lane: state (off, starting, idle, working), model, a button to show its tab, a start/stop button, the current task and "N waiting".
- **Cost**: today's lane cost and the money saved compared with doing the same work in the main session. These are estimates at API list price, as recorded by lanes.
- **Recent tasks**: the last 15 (id, lane, result badge, cost, age). Click one to read its report. The list refreshes every 3 seconds.

## Where settings go

Options are stored in Claude Code's own settings, with a one-time backup in HERA's data folder. They apply to Claude sessions and lanes you open afterwards, not to ones already running. HERA does not reopen lane tabs after a restart (lanes reopens a lane when the main session needs it), and a lane's conversation is never picked as the conversation to resume for your main tab, so lane replies keep reaching the right main session. See [session memory](session-memory.md).
