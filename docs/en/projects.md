<!-- lang --><sub>[한국어](../ko/projects.md) · [All docs](README.md) · [README](../../README.md)</sub>

# Projects

<img src="../images/features/projects.jpg" alt="" width="120" align="right">

A project is a folder you registered in HERA. Everything else (terminals, agents, usage, the backlog) hangs off it.

## Add projects

In the sidebar:

- **Add folder** (폴더 추가) registers one folder.
- **Find projects in a parent folder** (상위 폴더에서 프로젝트 찾기) scans the sub-folders of a folder you pick. A dialog lists what it found, with the markers it recognised (for example `.git`) and the last change time. Folders you already registered are greyed out and marked "(등록됨)". Tick the ones you want and press **Register N** ("N개 등록").

With no projects, the workspace shows "Register a project" with both buttons.

## The sidebar list

- Click a project to open its workspace. Double-click to open a new terminal in it right away.
- Pinned projects come first, then the most recently active.
- Each row shows when you last worked in it, today's token count, and a dot for how many sessions are working, waiting for you, or idle.
- With more than five projects, a search box appears.
- The **⋯** menu on a row has: New terminal, Open folder, Pin to top / Unpin, Project settings.

## The start screen

Opening a project with no tabs shows its start screen:

- **Terminal**, using the project's shell or the default one.
- One card for each AI CLI found on your PATH. The **▶** button on a card resumes the agent's last conversation. It only appears for agents that can resume.
- **Start as a team** (팀으로 시작): a preset that opens several agents side by side (see [Agents](agents.md)).
- **Project commands**: the buttons you defined in project settings.

The **+** button in the tab bar has the same choices, plus **Open in external terminal**.

## Project settings

Open them from the **⋯** menu, or the gear in the backlog panel.

| Field | Meaning |
|---|---|
| Name, Path | Shown in the sidebar. Changing the path does not move the folder. |
| Color | One of nine colors for the project's dot. |
| Shell | Overrides the default shell for this project. "Follow default" (기본값 따르기) uses the one from Settings. You can pick a detected shell or type a full command line, for example `wsl.exe -d Ubuntu`. See [Terminal](terminal.md#shells). |
| Project commands | One per line as `name = command`. Lines starting with `#` are comments. Each becomes a button on the start screen, in the **+** menu and in the command palette. |
| Pin to top | Keeps the project at the top of the sidebar. |

Example:

```
dev = npm run dev
test = npm test
claude-yolo = claude --dangerously-skip-permissions
```

**Remove from list** (목록에서 제거) asks twice. It only forgets the project in HERA; your folder is untouched.

## The backlog panel

Press `Ctrl+Shift+B` (`⌘B` on macOS) or use the panel button in the top right. The panel is 340 px wide and also holds the Usage tab and, when lanes are enabled, the Lanes tab.

- **Last run**: when, with what, how many sessions are open or working, and whether one is waiting for approval.
- **Last change**: git branch, commits ahead and behind, number of changed files, the last commit and a sample of changed files. Without git it lists recently modified files.
- **Token usage** for this project.
- **AI work log**: for each agent, the last time it ran, how many sessions, and the last prompt you gave it, with a **Continue** (이어하기) button.
- **To-dos**: a checklist for the project.
- **Notes**: free text, saved automatically about 0.6 seconds after you stop typing.
- **Run history**: the last 12 runs.

If the folder no longer exists, the panel says so.
