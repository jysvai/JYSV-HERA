<!-- lang --><sub>[English](../en/terminal.md) · [전체 문서](README.md) · [README](../../README.ko.md)</sub>

# 터미널

<img src="../images/features/terminal.jpg" alt="" width="120" align="right">

HERA 는 쓰던 셸을 그대로 두고, 그 주변에 프로젝트 탭, 분할 화면, 에이전트에 필요한 기능을 더합니다.

## 탭과 분할

- `Ctrl+Shift+T` 새 터미널, `Ctrl+Shift+W` 닫기, `Ctrl+Tab` 다음 탭, `Alt+1` ~ `Alt+9` 해당 탭으로 이동. macOS 는 `⌘T`, `⌘W`.
- 탭을 더블클릭하면 이름을 바꾸고, 가운데 버튼으로 클릭하면 닫습니다.
- 탭에는 상태 점, 에이전트 아이콘, 제목, 그리고 `claude-1` 같은 짧은 이름이 보입니다. 이 짧은 이름이 [`hera` CLI](hera-cli.md) 에서 쓰는 이름입니다.
- 세션이 둘 이상이면 분할 전환 버튼으로 최대 4개를 동시에 보여 줍니다. 2개는 좌우로, 4개는 2×2, 3개는 첫 화면이 두 줄을 차지합니다. 팀에서는 각 화면에 메인 / 보조 표시가 붙습니다.

### 한 질문을 여러 AI 에게 한꺼번에

분할 화면 아래의 입력 줄에 세션이 칩으로 나열됩니다. 보낼 세션을 켜고 입력한 뒤 `Enter` (`Shift+Enter` 는 줄바꿈) 를 누르면 선택한 모든 세션에 같은 글이 들어가고, 몇 곳에 보냈는지 알림이 뜹니다.

## 복사와 붙여넣기

| 동작 | Windows / Linux | macOS |
|---|---|---|
| 선택 복사 | 글자를 선택했을 때 `Ctrl+C`, 또는 `Ctrl+Shift+C` | `⌘C` |
| 붙여넣기 | `Ctrl+V` | `⌘V` |

선택한 글자가 없으면 `Ctrl+C` 는 평소처럼 프로그램에 전달됩니다 (중단). 클립보드에 글자 없이 이미지만 있고 그 탭에서 AI 에이전트가 실행 중이면 `Ctrl+V` 를 에이전트에 그대로 넘겨 에이전트가 이미지를 읽게 합니다.

## 끌어다 놓기

파일이나 폴더를 터미널에 끌어다 놓으면 경로가 입력됩니다. 공백이나 특수문자가 있으면 그 탭의 셸에 맞게 따옴표가 붙습니다: PowerShell · pwsh 는 작은따옴표, cmd 는 큰따옴표, 나머지는 POSIX 방식.

## 스크롤백

설정의 성능 · 메모리에서 줄 수를 정합니다 (500 ~ 20,000, 기본 3,000). 터미널 화면에는 더 크게 설정해도 최대 5,000줄까지만 보입니다. 탭을 바꾸거나 터미널을 숨겨도 기록은 사라지지 않습니다. HERA 가 세션마다 화면을 뒤에서 따로 들고 있다가 돌아오면 다시 그려 줍니다.

## 글꼴

HERA 에 **Cascadia Mono** 가 들어 있어서 어느 PC 에서나 기본 모양이 같습니다. 기본 글꼴 목록은 `"Cascadia Mono", "D2Coding", Consolas, "Malgun Gothic", monospace` 입니다 (macOS 는 `"SF Mono", Menlo, "D2Coding", "Apple SD Gothic Neo", monospace`). 설정 → 터미널 → 글꼴에서 목록을 고칩니다. 글자 크기 (8 ~ 28) 와 줄 간격 (1.0 ~ 2.0) 도 옆에 있습니다. 바꾸면 터미널 화면이 다시 열리지만 실행 중인 프로그램은 그대로 돕니다.

## 커서

설정 → 터미널 → 커서에서 막대 · 블록 · 밑줄과 깜빡임을 고릅니다. 열려 있는 터미널에 바로 적용됩니다.

## GPU 가속

설정 → 성능 · 메모리 → GPU 가속 (WebGL 터미널). 기본은 꺼짐이며, 켜면 일부 PC 에서 더 빨리 그립니다. 바꾼 뒤 HERA 를 다시 시작하세요.

## ConPTY: HERA 에 넣은 것과 Windows 기본 (Windows)

ConPTY 는 Windows 에서 터미널 프로그램과 셸을 이어 주는 부분입니다. HERA 는 Windows Terminal 이 쓰는 최신 ConPTY 를 함께 넣어 기본으로 사용합니다 (**최신 ConPTY 사용**). Windows 에 들어 있는 엔진은 마우스와 휠 신호를 삼켜 버려서, Claude Code 전체 화면 모드 · vim · htop 같은 전체 화면 프로그램에서 휠 스크롤이 안 되기 때문입니다. HERA 에 넣은 엔진에서는 잘 동작합니다.

<p align="center"><img src="../images/tui-wheel.gif" alt="HERA 에서 전체 화면 프로그램을 마우스 휠로 스크롤하는 모습" width="680"></p>

끄면 Windows 기본 엔진을 씁니다. 그 뒤에 여는 터미널부터 적용됩니다. HERA 에 넣은 엔진으로 터미널이 시작되지 않으면 HERA 가 알아서 시스템 엔진으로 다시 시도합니다.

## 셸

기본 셸은 설정 → 터미널 → 기본 셸에서 정하고, 프로젝트마다 [프로젝트 설정](projects.md#프로젝트-설정) 에서 따로 정할 수 있습니다.

목록에는 PC 에 있는 것만 나옵니다.

- Windows PowerShell 5.1 (Windows 에서 “자동” 일 때 쓰임)
- PowerShell 7 (`pwsh`)
- 명령 프롬프트 (`cmd`)
- Git Bash
- WSL (기본 배포판)
- macOS · Linux: `bash`, `zsh`, `fish`. “자동” 은 로그인 셸 (`$SHELL`) 입니다.

그 밖의 것은 **직접 입력** 을 골라 평소 실행하듯 명령줄을 적습니다. 적은 그대로 실행됩니다.

```
wsl.exe -d Ubuntu
"C:\Program Files\Nushell\nu.exe"
```

공백이 든 경로는 따옴표로 감싸세요. PATH 에서 프로그램을 못 찾으면 HERA 가 기본 셸을 대신 엽니다.

HERA 는 사용자의 프로필 파일을 건드리지 않고, 시작할 때 `hera` 명령과 단축어만 셸마다 알맞은 방식으로 더합니다.

### 셸 프로필 불러오기

**셸 프로필 불러오기** 는 기본으로 켜져 있어서 `$PROFILE`, `.bashrc` 같은 파일이 평소처럼 실행됩니다. 끄면 터미널이 더 빨리 열립니다 (PowerShell 은 `-NoProfile` 로 시작). 어느 쪽이든 단축어와 `hera` 는 동작합니다.

## Windows Terminal 에서 가져오기

HERA 가 Windows Terminal (정식, Preview, 또는 설치 없이 쓰는 버전) 을 찾으면 설정 → 터미널에 **Windows Terminal 에서 가져오기** 카드가 나옵니다. 기본 프로필을 읽어서 다음을 가져올 수 있습니다.

<p align="center"><img src="../images/wt-import.gif" alt="Windows Terminal 설정 가져오기: 터미널이 One Half Dark 색, 15px 글꼴, 블록 커서로 바뀌는 모습" width="760"></p>

- 글꼴 (이름과 크기. 포인트를 픽셀로 환산)
- 커서 모양
- 스크롤백
- 기본 셸 (PowerShell 7, WSL, Git Bash, cmd, 또는 적힌 명령줄 그대로)
- 터미널 색 (색 구성)

글꼴 · 커서 · 스크롤백 · 셸은 기본으로 체크되어 있고 색은 꺼져 있습니다. **선택한 항목 가져오기** 를 누르면 적용됩니다. 가져온 글꼴은 목록 맨 앞에 들어가고 한글 대체 글꼴은 그대로 남습니다. 색 구성은 “<구성 이름> (WT)” 라는 내 색상으로 추가되어, 배경 밝기에 따라 다크 또는 라이트 테마로 선택됩니다. 버튼을 누르기 전에는 아무것도 바뀌지 않고, 그 뒤에 여는 터미널부터 적용됩니다. 이 카드는 Windows 에서 Windows Terminal 설정 파일이 있을 때만 나옵니다.

## 외부 터미널에서 열기

**+** 메뉴의 **외부 터미널에서 열기** 로 HERA 밖의 터미널에서 프로젝트를 엽니다. 어떤 터미널을 쓸지는 설정 → 터미널 → 외부 터미널에서 고릅니다: 자동, macOS 는 Terminal.app / iTerm, Windows 는 Windows Terminal / 콘솔 창.
