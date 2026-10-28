<!-- lang --><sub>[English](../en/security.md) · [전체 문서](README.md) · [README](../../README.ko.md)</sub>

# 보안

HERA 는 셸과 AI CLI 를 실행하므로 HERA 자체가 믿을 수 있어야 합니다. 이 페이지에는 직접 확인할 수 있는 것과 앱이 사용자를 보호하는 방법을 적었습니다. 문제를 발견하면 [SECURITY.md](../../SECURITY.md) 를 보세요.

## 받은 파일 확인하기

모든 릴리스는 태그된 소스에서 GitHub Actions 가 공개적으로 빌드합니다: [릴리스 빌드 기록](https://github.com/jysvai/JYSV-HERA/actions/workflows/release.yml). 개인 컴퓨터에서 빌드한 파일은 없습니다.

**1. 빌드 출처 증명 (서명됨).** 릴리스 파일마다 [빌드 출처 증명(attestation)](https://github.com/jysvai/JYSV-HERA/attestations)이 있습니다. 어느 워크플로 · 커밋 · 태그가 그 파일을 만들었는지를 Sigstore 로 서명한 기록입니다. [GitHub CLI](https://cli.github.com/) 로 확인합니다:

```bash
gh attestation verify JYSV-HERA-0.2.4-win-x64.exe --repo jysvai/JYSV-HERA
```

`Verification succeeded!` 가 나오면 이 저장소의 워크플로가 만든 파일과 한 바이트도 다르지 않다는 뜻입니다. 나중에 누군가 바꾼 파일은 실패합니다.

**2. 체크섬.** 릴리스의 `SHA256SUMS.txt` 에 모든 파일의 SHA-256 이 있고, GitHub 도 파일마다 같은 값을 보여 줍니다.

```powershell
Get-FileHash .\JYSV-HERA-0.2.4-win-x64.exe -Algorithm SHA256   # Windows
```
```bash
shasum -a 256 JYSV-HERA-0.2.4-mac-arm64.dmg                     # macOS / Linux
```

[앱 안의 업데이트](updates-and-privacy.md)는 이 확인을 스스로 하고, 맞지 않으면 설치하지 않습니다.

## 코드 서명

| OS | 지금 | 예정 |
|---|---|---|
| Windows | 아직 서명 없음: 처음 실행할 때 SmartScreen 에서 *추가 정보 → 실행*. | SignPath Foundation(오픈소스 무료)의 Authenticode 서명. 릴리스 워크플로는 준비돼 있어서 계정이 생기면 바로 서명합니다. |
| macOS | 애드혹 서명, 공증 없음: 처음 한 번 *시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기* (macOS 12–14 는 우클릭 → *열기*). | Developer ID 서명과 Apple 공증. 인증서를 넣으면 릴리스 워크플로가 둘 다 합니다. |
| Linux | 체크섬과 출처 증명 (Linux 패키지는 보통 서명하지 않음). | — |

그때까지는 위의 출처 증명이 파일이 진짜인지 확인하는 방법입니다.

## 앱을 단단하게 만든 방법

- **격리된 화면.** 창은 `sandbox`, `contextIsolation`, Node 통합 끔 상태로, 콘텐츠 보안 정책(CSP) 아래에서 돕니다. 다른 사이트를 열 수 없습니다. 링크는 브라우저로 열리고, 앱 밖으로 이동하는 것은 막힙니다.
- **좁은 통로.** 화면은 정해진 이름의 호출 목록(preload 허용 목록)으로만 앱에 닿습니다. 임의의 명령은 실행할 수 없습니다. 예를 들어 *확장 · 업데이트* 페이지는 업데이트할 항목의 id 만 보내고, 명령은 앱이 직접 만들어 보이는 터미널 탭에서 실행합니다.
- **잠긴 런타임 (Electron fuses).** 설치된 앱은 `NODE_OPTIONS` 와 `--inspect` 를 무시하고, 코드는 자기 `app.asar` 에서만 읽으며, 시작할 때 그 파일의 무결성을 확인합니다. 그래서 설치된 파일을 고치면 앱이 실행을 거부합니다. `RunAsNode` 는 켜 둡니다. Node.js 가 없는 PC 에서 `hera` CLI 가 이것을 쓰기 때문입니다.
- **로컬 전용 버스.** `hera` CLI 는 named pipe(Windows) 또는 소유자만 쓸 수 있는 Unix 소켓(macOS · Linux)으로 앱과 대화하고, 네트워크는 쓰지 않습니다. 요청마다 데이터 폴더에 있는 무작위 토큰이 맞아야 합니다. `hera host` 는 등록한 폴더에서만 탭을 엽니다.
- **비밀 값 없음.** 계정 · 확장 화면은 이름 · 플랜 · 패키지 이름만 보여 줍니다. 토큰, API 키, MCP 서버 헤더, 환경 변수는 읽지도 표시하지도 않습니다.

## 네트워크와 데이터

HERA 에는 서버도, 계정도, 원격 수집도 없습니다. 사용자가 누르지 않았는데 하는 요청은 GitHub 공개 릴리스 API 로 하는 업데이트 확인 하나이고, 끌 수 있습니다. 자세한 내용: [업데이트와 개인정보](updates-and-privacy.md).

## 자동 검사

| 검사 | 언제 |
|---|---|
| TypeScript 소스와 워크플로에 대한 [CodeQL](https://github.com/jysvai/JYSV-HERA/actions/workflows/codeql.yml) 보안 검사 | 푸시 · 풀 리퀘스트마다, 매주 |
| 앱에 들어가는 의존성의 `npm audit` (높음 · 심각이면 실패) | 푸시마다 |
| 설치 파일 자체 테스트 (Windows · macOS · Linux): 실제 터미널, `hera` CLI, 창 | 릴리스마다, 올리기 전에 |
