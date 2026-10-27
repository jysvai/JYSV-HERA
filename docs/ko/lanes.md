<!-- lang --><sub>[English](../en/lanes.md) · [전체 문서](README.md) · [README](../../README.ko.md)</sub>

# Lanes

<img src="../images/features/lanes.jpg" alt="" width="120" align="right">

[lanes](https://github.com/jysvai/lanes) 는 메인 Claude 세션이 일을 더 저렴한 보조 세션 둘에게 넘기게 해 주는 Claude Code 플러그인입니다. **mid** (판단이 필요한 일) 와 **low** (기계적인 일) 가 있습니다. HERA 는 이 보조 세션을 메인 옆의 탭으로 돌려 주고, 플러그인 설정을 한 페이지에서 관리합니다.

lanes 는 HERA 에 들어 있지 않으니 플러그인을 먼저 설치하세요. 사이드바의 **Lanes 연동** 을 열면, 플러그인이 없을 때 설치 방법이 나옵니다.

```
/plugin install lanes --marketplace jysvai/lanes
```

또는 일반 터미널에서:

```
claude plugin marketplace add jysvai/lanes
claude plugin install lanes@claude-mod --scope user
```

설치한 뒤 “다시 찾기” 를 누르세요. 상태 카드에 “설치됨” 과 Claude Code 에서 lanes 가 켜져 있는지 꺼져 있는지가 표시됩니다.

HERA 에서 연 lane 은 Windows 에서 lanes 버전과 상관없이 HERA 탭으로 열립니다. 메인 Claude 가 스스로 연 lane(닫힌 lane 에 일을 넘길 때, `/lane start`, 죽은 lane 을 다시 열 때)은 lanes 0.3.13 이상이면 모든 OS 에서 HERA 탭이 됩니다. lanes 가 `hera host --lane` 으로 HERA 에 탭을 요청합니다.

## 켜기

**연동** 섹션에서 “HERA 에서 lanes 사용” 을 켜면 모든 프로젝트의 오른쪽 패널에 **Lanes** 탭이 생깁니다.

“설정 방식”:

- **자동 (권장)**: 항목이 잠기고 플러그인 권장값을 씁니다. 자동으로 바꾸면 저장해 둔 옵션을 지우고 권장 허용 규칙을 적용합니다.
- **직접 조정**: 아래 항목을 모두 직접 정합니다.

## 모델 라우팅

**메인**, **mid lane**, **low lane** 한 줄씩 모델, 대체 모델 (과부하 시), effort (`low`, `medium`, `high`, `xhigh`, `max`) 를 정합니다. 모델 이름은 직접 적을 수 있고, 목록에는 `claude-opus-5-5[1m]`, `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5`, `claude-haiku-5-5` 가 추천으로 나옵니다.

- “HERA 가 여는 Claude 에 메인 설정 적용”: HERA 가 여는 Claude 세션에 `--model`, `--fallback-model`, `--effort` 를 붙입니다.
- “넘김 알림 기준 (토큰)”: 메인 대화가 이만큼 길어지면 lanes 가 일을 넘기라고 알려 줍니다. `0` 이면 끕니다.
- “작업 스타일”: 자동 / 개발자 / 기획자 / 입문자. lanes 가 안내문을 쓰는 방식이 달라집니다.

## 실행 방식

- “HERA 에서 lane 을 열 때”: **HERA 탭** 또는 **별도 창**.
- “Claude 가 스스로 lane 을 열 때”: 별도 창(기본값) 또는 백그라운드. 백그라운드 lane 은 `claude attach` 로 볼 수 있습니다. 그 Claude 가 등록된 프로젝트의 HERA 탭에서 돌고 “HERA 에서 lane 을 열 때” 가 **HERA 탭** 이면, 별도 창 대신 HERA 탭으로 열립니다 (lanes 0.3.13 이상).
- “Claude 를 열면 lanes 도 같이 열기”: Claude 를 열 때 보조 세션 둘을 함께 엽니다.
- “쉬는 lane 자동 종료 (분)”: `0` 은 종료 안 함, 최대 1,440.

<p align="center"><img src="../images/lanes-tab.gif" alt="lanes 가 mid lane 을 시작하자 HERA 탭으로 열리는 모습" width="760"></p>

lane 탭의 제목은 “lane · mid”, “lane · low” 입니다. HERA 는 등록된 프로젝트에서만 lane 을 탭으로 엽니다. HERA 에 등록되지 않은 폴더에서 Claude 를 열면 플러그인이 자기 창을 따로 엽니다. 같은 종류의 lane 탭이 이미 끝났거나 쉬는 중이면 새 탭이 열릴 때 정리됩니다.

Claude 가 폴더를 아직 신뢰하지 않으면 “Workspace not trusted” 안내가 나옵니다. 그 폴더에서 Claude 를 한 번 열어 신뢰를 허용하세요.

## 권한

lanes 는 사람이 지켜보지 않아도 일하므로 권한이 중요합니다. 모드:

- **auto** (권장)
- **acceptEdits**
- **dontAsk**
- **manual**: 매번 묻습니다. 답할 수 있는 HERA 탭이나 창에서만 의미가 있습니다.
- **bypassPermissions**: 확인 없이 전부 허용. 위험 표시가 붙어 있습니다.

허용 규칙 입력 상자는 프로젝트의 `.claude/settings.local.json` 에 저장됩니다. 무엇을 허용하든 lanes 는 lane 코드 수정과 `git commit/push/reset` 을 항상 막습니다. 모드가 `dontAsk` 인데 프로젝트에 허용 목록이 없으면 Lanes 패널에 안내와 “허용 목록 적용” 버튼이 나옵니다.

## 프로젝트별 작업 지시

“프로젝트별 작업 지시” 섹션에 mid 용과 low 용 입력 상자가 있습니다. 그 프로젝트의 보조 세션이 알아야 할 내용을 적으세요. “자동 작성” 은 프로젝트를 보고 초안을 만들고, **저장** 하면 프로젝트의 `.claude/lanes/roles/mid.md` 또는 `low.md` 에 저장되어 lanes 의 기본 역할 지시 뒤에 붙습니다. 상자를 비우고 저장하면 파일이 삭제됩니다. 다음에 lane 을 열 때부터 적용됩니다.

## Lanes 패널

오른쪽 패널의 **Lanes** 탭:

- 제목에 프로젝트 이름 (“lanes · <이름>”), **모두 열기 / 모두 닫기**, **Lanes 설정**.
- lane 마다 카드: 상태 (꺼짐 / 여는 중 / 대기 / 작업 중), 모델, “lane 탭 보기” 버튼, 시작 · 정지 버튼, 현재 작업, “대기 중인 일 N개”.
- **비용**: 오늘 lane 비용과 메인에서 했을 때보다 아낀 돈(누적). API 정가 기준 추정치이고 lanes 가 기록한 값입니다.
- **최근 작업**: 최근 15개 (id, lane, 결과 배지, 비용, 경과 시간). 누르면 보고서가 열립니다. 3초마다 갱신됩니다.

## 설정이 저장되는 곳

옵션은 Claude Code 자체 설정에 저장되고 HERA 데이터 폴더에 한 번 백업됩니다. 그 뒤에 여는 Claude 세션과 lane 부터 적용되고, 이미 열린 lane 은 다시 시작해야 바뀝니다. HERA 는 재시작할 때 lane 탭을 다시 열지 않고(메인 세션이 필요할 때 lanes 가 엽니다), lane 의 대화를 메인 탭이 이어갈 대화로 고르지 않습니다. 그래서 lane 의 회신이 계속 올바른 메인 세션에 도착합니다. [세션 기억](session-memory.md) 참고.
