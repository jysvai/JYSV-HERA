<!-- lang --><sub>[한국어](../ko/hera-cli.md) · [All docs](README.md) · [README](../../README.md)</sub>

# The `hera` CLI

<img src="../images/features/hera-cli.jpg" alt="">

Every terminal opened in HERA has a `hera` command on its PATH. Agents use it to hand work to each other; you can use it too. It talks to the running HERA app over a local named pipe (a Unix socket on macOS and Linux), protected by a token file in the data folder. It does not work from a terminal outside HERA, and it makes no network requests.

## Naming sessions

Every session has a short name made of its agent and a number: `claude-1`, `codex-1`, `agy-1`. The name is on the tab. A `<target>` in the commands below can be:

- a session name (case-insensitive) or its id,
- `main` or `helper` (the role the session has in its team),
- an agent id such as `codex`, when exactly one such session exists. HERA prefers sessions of the caller's own project. If the name is ambiguous the error lists the candidates.

Only live sessions can be addressed. Sending to an exited session is an error.

## Commands

### Look around

| Command | What it does |
|---|---|
| `hera list [--all] [--json]` | Sessions in the current project. `--all` lists every project. Alias `ls`. |
| `hera projects` | Registered projects. |
| `hera whoami` | Which session you are. |
| `hera status` | A summary of what is running. |
| `hera log [-n 30]` | The recent message log (the same one as the Agent chat page). |
| `hera peek <target> [-n 40] [--scrollback] [--json]` | The last lines of a session's screen. |
| `hera guide` | Prints the collaboration guide agents read. |
| `hera --version` | Prints `JYSV HERA <version>`. Also `version` and `-v`. |

### Talk to a session

| Command | What it does |
|---|---|
| `hera ask <target> <message…> [--idle 6] [--timeout 1800] [-n 80]` | Sends the message, waits until the session has been quiet for `--idle` seconds, then prints the screen. Good for short tasks. |
| `hera send <target> <message…> [--raw] [--no-enter] [--file f]` | Sends and returns at once. Good for long tasks. `--raw` sends the text exactly, with no wrapper. `--no-enter` types it without pressing Enter. `--file` reads the message from a file. `-` as the message, or piping text in with no words given, reads standard input. |
| `hera reply <target> <message…>` | Answers a message you received. |
| `hera wait <target> [--idle 5] [--timeout 1800] [-n 60]` | Waits for a session to go quiet, then prints its screen. |
| `hera key <target> <keys…>` | Presses keys: `enter esc tab up down left right ctrl-c y n 1 …`. Unknown key names are reported. Alias `keys`. Use it to answer an approval prompt. |

`ask` and `peek` also accept `--json` for scripts, and `ask` accepts `--raw`.

### Open and arrange

| Command | What it does |
|---|---|
| `hera spawn <agent> [--cmd "…"] [--project p] [--resume] [--no-split] [--role helper]` | Opens a new session running an agent. The role defaults to `helper`. `--cmd` replaces the agent's command. |
| `hera add [path] [--name n]` | Registers a folder as a project. |
| `hera open <project> [--agent a] [--resume]` | Opens a project, optionally starting an agent. |
| `hera focus <target>` | Brings a session to the front. |
| `hera host [--cwd dir] [--title t] [--check] [-- command]` | Opens a tab running a command, for tools such as [lanes](lanes.md). It is refused when the folder does not belong to a registered project. |

### Statusline helper

`hera statusline-tap [-- original command]` is installed in Claude Code's status line when you switch on "Claude limit integration" on the Accounts page. It records Claude's 5-hour and weekly limits (and model) in the data folder for the [usage](usage.md) views, and passes the input on to your original status line command unchanged. Without an original command it prints a short line such as "HERA · model · 5h 12% · 7d 40%".

## Examples

Hand a short job to Codex and read the answer:

```
hera ask codex "List the exported functions in src/api and their parameters"
```

Start a helper, give it a long task, and come back later:

```
hera spawn codex
hera send codex-1 "Write tests for src/auth, run them, fix failures"
hera wait codex-1
```

Send a message from a file, or from a pipe:

```
hera send claude-2 --file brief.md
git diff | hera send claude-2 "Review this diff:"
```

Answer a permission prompt in another session:

```
hera peek claude-2
hera key claude-2 y enter
```

## How messages arrive

Messages to an AI agent are wrapped so it knows where they came from:

```
[HERA msg from claude-1] <your text> …
```

The wrapper also asks the agent to run `hera reply claude-1 "<summary>"` when it is done. A reply arrives as `[HERA reply from codex-1] …`. If the agent that got a `hera send` finishes without replying, HERA replies for it after 20 quiet seconds with its last screen ("(automatic reply) …"), and tells the sender when it waits for an approval. Messages longer than 1,500 characters are saved as a file in the data folder (`mail/…`) and the agent is given its path. A target that is a plain shell (not an agent) receives the raw text; a reply sent to a plain shell is only logged, never typed.

Everything sent through `hera` is listed on the **Agent chat** (에이전트 대화) page.

## Tips for a main agent

`hera guide` suggests: split work into independent pieces; use `ask` for short tasks and `send` for long ones; and check what helpers report before relying on it. When you see "[HERA msg from X] …", do the task and run `hera reply X "<summary>"`.

## Environment

HERA sets these in every session: `HERA_SESSION_ID`, `HERA_SESSION_NAME`, `HERA_PROJECT` and `HERA_HOME` (the data folder). `HERA_HOME` set before starting HERA makes it use another data folder and run as a separate instance.
