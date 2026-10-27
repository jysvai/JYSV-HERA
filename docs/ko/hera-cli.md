<!-- lang --><sub>[English](../en/hera-cli.md) · [전체 문서](README.md) · [README](../../README.ko.md)</sub>

# `hera` CLI

<img src="../images/features/hera-cli.jpg" alt="" width="120" align="right">

HERA 에서 연 모든 터미널에는 PATH 에 `hera` 명령이 있습니다. 에이전트끼리 일을 넘길 때 쓰고, 사용자가 직접 써도 됩니다. 실행 중인 HERA 앱과 로컬 named pipe (macOS · Linux 는 Unix 소켓) 로 대화하며, 데이터 폴더의 토큰 파일로 보호됩니다. HERA 밖의 터미널에서는 동작하지 않고, 네트워크 요청도 하지 않습니다.

## 세션 이름

세션마다 에이전트 이름과 번호로 된 짧은 이름이 있습니다: `claude-1`, `codex-1`, `agy-1`. 탭에서 볼 수 있습니다. 아래 명령의 `<대상>` 은 다음 중 하나입니다.

- 세션 이름 (대소문자 무시) 또는 id
- `main` 또는 `helper` (팀에서 맡은 역할)
- 에이전트 id (예: `codex`) — 그 에이전트 세션이 정확히 하나일 때. 호출한 쪽과 같은 프로젝트의 세션을 먼저 봅니다. 여러 개라 모호하면 오류에 후보 이름이 나옵니다.

살아 있는 세션에만 보낼 수 있습니다. 종료된 세션에 보내면 오류입니다.

## 명령

### 둘러보기

| 명령 | 설명 |
|---|---|
| `hera list [--all] [--json]` | 현재 프로젝트의 세션. `--all` 은 모든 프로젝트. 별칭 `ls`. |
| `hera projects` | 등록된 프로젝트. |
| `hera whoami` | 지금 내가 어느 세션인지. |
| `hera status` | 실행 중인 것의 요약. |
| `hera log [-n 30]` | 최근 메시지 기록 (에이전트 대화 페이지와 같은 기록). |
| `hera peek <대상> [-n 40] [--scrollback] [--json]` | 세션 화면의 마지막 줄들. |
| `hera guide` | 에이전트가 읽는 협업 안내를 출력. |
| `hera --version` | `JYSV HERA <버전>` 출력. `version`, `-v` 도 같습니다. |

### 세션과 대화

| 명령 | 설명 |
|---|---|
| `hera ask <대상> <메시지…> [--idle 6] [--timeout 1800] [-n 80]` | 메시지를 보내고, 세션이 `--idle` 초 동안 조용해질 때까지 기다린 뒤 화면을 출력. 짧은 작업에 적합. |
| `hera send <대상> <메시지…> [--raw] [--no-enter] [--file f]` | 보내고 바로 돌아옴. 긴 작업에 적합. `--raw` 는 감싸지 않고 글자 그대로, `--no-enter` 는 입력만 하고 Enter 는 누르지 않음, `--file` 은 파일에서 메시지를 읽음. 메시지 자리에 `-` 를 쓰거나, 말 없이 파이프로 넣으면 표준 입력을 읽음. |
| `hera reply <대상> <메시지…>` | 받은 메시지에 회신. |
| `hera wait <대상> [--idle 5] [--timeout 1800] [-n 60]` | 세션이 조용해질 때까지 기다린 뒤 화면 출력. |
| `hera key <대상> <키…>` | 키 입력: `enter esc tab up down left right ctrl-c y n 1 …`. 모르는 키 이름은 알려 줍니다. 별칭 `keys`. 승인 질문에 답할 때 씁니다. |

`ask` 와 `peek` 는 스크립트용 `--json` 을, `ask` 는 `--raw` 도 받습니다.

### 열기와 배치

| 명령 | 설명 |
|---|---|
| `hera spawn <에이전트> [--cmd "…"] [--project p] [--resume] [--no-split] [--role helper]` | 새 세션에서 에이전트를 실행. 역할 기본값은 `helper`. `--cmd` 는 에이전트의 기본 명령을 대신함. |
| `hera add [경로] [--name n]` | 폴더를 프로젝트로 등록. |
| `hera open <프로젝트> [--agent a] [--resume]` | 프로젝트를 열고 필요하면 에이전트도 실행. |
| `hera focus <대상>` | 세션을 앞으로 가져옴. |
| `hera host [--cwd 폴더] [--title t] [--check] [-- 명령]` | 명령을 탭으로 열어 줌. [lanes](lanes.md) 같은 도구가 씁니다. 폴더가 등록된 프로젝트에 속하지 않으면 거절됩니다. |

### 상태줄 도우미

`hera statusline-tap [-- 원래 명령]` 은 계정 페이지에서 “Claude 한도 연동” 을 켜면 Claude Code 상태줄에 끼워집니다. Claude 의 5시간 · 주간 한도와 모델을 데이터 폴더에 기록해서 [사용량](usage.md) 화면에 쓰고, 입력은 원래 상태줄 명령에 그대로 넘깁니다. 원래 명령이 없으면 “HERA · model · 5h 12% · 7d 40%” 같은 짧은 줄을 출력합니다.

## 예시

Codex 에게 짧은 일을 맡기고 답을 읽기:

```
hera ask codex "src/api 에서 export 된 함수와 인자를 정리해 줘"
```

도우미를 열어 긴 일을 맡기고 나중에 확인:

```
hera spawn codex
hera send codex-1 "src/auth 테스트를 작성하고 실행해서 실패를 고쳐 줘"
hera wait codex-1
```

파일이나 파이프로 메시지 보내기:

```
hera send claude-2 --file brief.md
git diff | hera send claude-2 "이 diff 를 검토해 줘:"
```

다른 세션의 권한 질문에 답하기:

```
hera peek claude-2
hera key claude-2 y enter
```

## 메시지가 도착하는 모양

AI 에이전트에게 가는 메시지는 보낸 곳을 알 수 있게 감싸집니다.

```
[HERA msg from claude-1] <내용> …
```

끝나면 `hera reply claude-1 "<결과 요약>"` 로 회신해 달라는 안내도 붙습니다. 회신은 `[HERA reply from codex-1] …` 로 도착합니다. 1,500자를 넘는 메시지는 데이터 폴더의 파일(`mail/…`)로 저장하고 에이전트에게 경로를 알려 줍니다. 대상이 에이전트가 아닌 일반 셸이면 글자 그대로 입력되고, 일반 셸로 보낸 회신은 기록만 하고 입력하지 않습니다.

`hera` 로 오간 모든 것은 **에이전트 대화** 페이지에 남습니다.

## 메인 에이전트를 위한 팁

`hera guide` 의 권고: 일을 서로 독립적인 조각으로 나누고, 짧은 일은 `ask`, 긴 일은 `send` 로 맡기고, 도우미가 보고한 결과는 믿기 전에 확인하세요. “[HERA msg from X] …” 를 받으면 일을 하고 `hera reply X "<요약>"` 로 회신합니다.

## 환경변수

HERA 는 모든 세션에 `HERA_SESSION_ID`, `HERA_SESSION_NAME`, `HERA_PROJECT`, `HERA_HOME` (데이터 폴더) 을 설정합니다. HERA 를 켜기 전에 `HERA_HOME` 을 다른 폴더로 지정하면 그 폴더를 데이터 폴더로 쓰는 별개의 인스턴스로 실행됩니다.
