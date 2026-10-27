import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { language, t } from '../../../shared/i18n'
import type { AppMetrics, Settings } from '../../../shared/types'
import { formatBytesKB } from '../../../shared/util'
import { ShellPicker } from '../../components/ShellPicker'
import { Button, Input, PageHeader, Row, Section, SegmentedControl, Select, Switch } from '../../components/ui/primitives'
import { api, isMac, isWin } from '../../lib/hera'
import { $config, $info, $update, $view, runUpdate, toast, updateConfig, updateLabel } from '../../store/app'
import { TerminalImportCard } from '../settings/TerminalImportCard'

function useSetting<K extends keyof Settings>(key: K): [Settings[K] | undefined, (value: Settings[K]) => void] {
  const config = useStore($config)

  return [config?.settings[key], value => updateConfig(draft => void (draft.settings[key] = value))]
}

function NumberInput({ value, onCommit, min, max, step = 1 }: { value: number; onCommit: (next: number) => void; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(value))

  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const parsed = Number(text)

    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)))
    else setText(String(value))
  }

  return (
    <Input
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => event.key === 'Enter' && commit()}
      className="w-20 text-right tabular-nums"
      inputMode="decimal"
      step={step}
    />
  )
}

function MemoryPanel() {
  const [metrics, setMetrics] = useState<AppMetrics | null>(null)

  useEffect(() => {
    const load = () => void api.metrics().then(setMetrics)
    load()
    const timer = setInterval(load, 3000)

    return () => clearInterval(timer)
  }, [])

  if (!metrics) return null

  return (
    <div className="rounded-lg bg-(--ui-bg-quaternary) px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{t('HERA 메모리 합계')}</span>
        <span className="text-[17px] font-semibold tabular-nums">{formatBytesKB(metrics.totalKB)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11.5px] text-(--ui-text-secondary)">
        {metrics.processes.map((entry, index) => (
          <div key={index} className="flex justify-between">
            <span>{entry.type}</span>
            <span className="tabular-nums">
              {formatBytesKB(entry.kb)} · CPU {entry.cpu.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-(--ui-text-tertiary)">
        {t('터미널 {count}개 실행 중 · 셸/AI 프로세스 자체 메모리는 포함하지 않습니다 (HERA 앱 오버헤드만).', { count: metrics.ptyCount })}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const info = useStore($info)
  const [theme, setTheme] = useSetting('theme')
  const [defaultShell, setDefaultShell] = useSetting('defaultShell')
  const [loadProfile, setLoadProfile] = useSetting('loadShellProfile')
  const [fontFamily, setFontFamily] = useSetting('fontFamily')
  const [fontSize, setFontSize] = useSetting('fontSize')
  const [lineHeight, setLineHeight] = useSetting('lineHeight')
  const [scrollback, setScrollback] = useSetting('scrollback')
  const [gpu, setGpu] = useSetting('gpu')
  const [conptyDll, setConptyDll] = useSetting('conptyDll')
  const [codexOwnServer, setCodexOwnServer] = useSetting('codexOwnServer')
  const [cursorStyle, setCursorStyle] = useSetting('cursorStyle')
  const [cursorBlink, setCursorBlink] = useSetting('cursorBlink')
  const [lowMemory, setLowMemory] = useSetting('lowMemory')
  const [deepSleep, setDeepSleep] = useSetting('deepSleepMinutes')
  const [hotkey, setHotkey] = useSetting('hotkey')
  const [closeToTray, setCloseToTray] = useSetting('closeToTray')
  const [startHidden, setStartHidden] = useSetting('startHidden')
  const [notifyDone, setNotifyDone] = useSetting('notifyOnDone')
  const [notifyApproval, setNotifyApproval] = useSetting('notifyOnApproval')
  const [externalTerminal, setExternalTerminal] = useSetting('externalTerminal')
  const [warn, setWarn] = useSetting('usageWarnPercent')
  const [launchAtLogin, setLaunchAtLogin] = useSetting('launchAtLogin')
  const [restoreMode, setRestoreMode] = useSetting('restoreMode')
  const [checkUpdates, setCheckUpdates] = useSetting('checkUpdates')
  const [uiLanguage, setUiLanguage] = useSetting('uiLanguage')
  const update = useStore($update)
  const [checking, setChecking] = useState(false)
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkey || '')

  useEffect(() => setHotkeyDraft(hotkey || ''), [hotkey])

  if (theme === undefined) return null

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-3xl">
        <PageHeader title={t('설정')} description={info ? t('JYSV HERA {version} · 데이터 {dir}', { version: info.version, dir: info.dataDir }) : undefined} />

        <Section /* i18n-ignore */ title="언어 · Language">
          <Row /* i18n-ignore */ label="화면 언어 · Display language" description="자동은 운영체제 언어를 따릅니다. 바꾸면 창을 다시 그립니다(터미널은 그대로). · Auto follows your OS. Changing it redraws the window; terminals keep running.">
            <Select value={uiLanguage || 'auto'} onChange={event => setUiLanguage(event.target.value as Settings['uiLanguage'])} className="w-44">
              <option value="auto">자동 · Auto</option>{/* i18n-ignore */}
              <option value="ko">한국어</option>{/* i18n-ignore */}
              <option value="en">English</option>
            </Select>
          </Row>
        </Section>

        <Section title={t('버전 · 업데이트')}>
          <Row
            label={`JYSV HERA v${info?.version || ''}`}
            description={
              update?.newer && update.latest
                ? update.progress?.phase === 'error'
                  ? t('새 버전 v{latest} · 업데이트 실패: {error}', { latest: update.latest, error: update.progress.error || '' })
                  : update.installable
                    ? t('새 버전 v{latest} 이 나왔습니다. 앱 안에서 내려받아 설치하고, 체크섬을 확인한 뒤 다시 시작합니다.', { latest: update.latest })
                    : t('새 버전 v{latest} 이 나왔습니다. 이 설치 방식(휴대용 · 개발 빌드)은 릴리스 페이지에서 받아 주세요.', { latest: update.latest })
                : update?.latest
                  ? t('최신 버전입니다 (GitHub 최신 릴리스 v{latest}).', { latest: update.latest })
                  : update?.checkedAt
                    ? t('아직 공개된 릴리스가 없습니다.')
                    : t('아직 확인하지 않았습니다.')
            }
          >
            {update?.newer && update.installable && (
              <Button
                size="sm"
                variant="default"
                disabled={update.progress?.phase === 'downloading' || update.progress?.phase === 'installing'}
                onClick={() => void runUpdate()}
              >
                {updateLabel(update)}
              </Button>
            )}
            {update?.newer && (
              <a href={update.url} target="_blank" rel="noreferrer">
                <Button size="sm">{t('릴리스 페이지')}</Button>
              </a>
            )}
            {/* docs/patch-notes holds one file per release; the newer one when there is one. */}
            <a href={`https://github.com/jysvai/JYSV-HERA/blob/main/docs/patch-notes/${language()}/v${update?.newer && update.latest ? update.latest : info?.version || ''}.md`} target="_blank" rel="noreferrer">
              <Button size="sm">{t('패치노트')}</Button>
            </a>
            <Button
              size="sm"
              disabled={checking}
              onClick={() => {
                setChecking(true)
                void api
                  .update('check')
                  .then(next => {
                    $update.set(next)
                    if (next.error) toast(t('확인 실패: {error}', { error: next.error }), 'error')
                  })
                  .finally(() => setChecking(false))
              }}
            >
              {checking ? t('확인 중…') : t('지금 확인')}
            </Button>
          </Row>
          <Row label={t('새 버전 자동 확인')} description={t('몇 시간에 한 번 GitHub 릴리스 목록만 조회합니다. 업데이트 파일은 버튼을 눌렀을 때만 내려받습니다. 끄면 HERA 는 스스로 아무 데도 접속하지 않습니다.')}>
            <Switch checked={checkUpdates !== false} onChange={setCheckUpdates} label={t('새 버전 자동 확인')} />
          </Row>
          <Row
            label={t('AI CLI · 플러그인 · MCP · 스킬 업데이트')}
            description={t('Claude Code · Codex 같은 CLI 와 npm 전역 패키지의 새 버전, 각 CLI 에 설치된 플러그인 · MCP 서버 · 스킬을 한곳에서 보고 업데이트합니다.')}
          >
            <Button size="sm" onClick={() => $view.set('extensions')}>
              {t('확장 · 업데이트 열기')}
            </Button>
          </Row>
        </Section>

        <Section title={t('성능 · 메모리')}>
          <MemoryPanel />
          <Row label={t('저메모리 모드')} description={t('Chromium 보조 프로세스를 줄이고 네트워크 서비스를 메인에 합칩니다. 재시작 후 적용.')}>
            <Switch checked={Boolean(lowMemory)} onChange={setLowMemory} label={t('저메모리 모드')} />
          </Row>
          <Row
            label={t('GPU 가속 (WebGL 터미널)')}
            description={t('출력이 아주 많은 작업에서 부드럽지만 GPU 프로세스(수십 MB)가 생깁니다. 끄면 GPU 프로세스 자체를 띄우지 않습니다. 재시작 후 적용.')}
          >
            <Switch checked={Boolean(gpu)} onChange={setGpu} label={t('GPU 가속')} />
          </Row>
          <Row label={t('깊은 절전')} description={t('창을 숨긴 뒤 이 시간이 지나면 화면(렌더러)을 완전히 내려 메모리를 반납합니다. 터미널은 계속 돌아갑니다. 0 = 끔')}>
            <NumberInput value={deepSleep || 0} min={0} max={240} onCommit={setDeepSleep} />
            <span className="text-[12px] text-(--ui-text-tertiary)">{t('분')}</span>
          </Row>
          <Row label={t('스크롤백')} description={t('화면에 보이는 터미널 한 개당 보관 줄 수 (백그라운드 세션은 메인에서 동일 길이로 보관)')}>
            <NumberInput value={scrollback || 3000} min={500} max={20000} step={500} onCommit={setScrollback} />
            <span className="text-[12px] text-(--ui-text-tertiary)">{t('줄')}</span>
          </Row>
        </Section>

        <Section title={t('터미널')}>
          <TerminalImportCard />
          <Row label={t('기본 셸')} description={t('이 PC 에 있는 셸, 또는 명령줄을 그대로 적을 수 있습니다 (예: wsl.exe -d Ubuntu).')}>
            <ShellPicker value={defaultShell || 'auto'} onChange={setDefaultShell} autoLabel={t('자동 ({shell})', { shell: isWin ? 'Windows PowerShell' : t('로그인 셸 ($SHELL)') })} className="w-56" />
          </Row>
          {isWin && (
            <Row
              label={t('최신 ConPTY 사용 (권장)')}
              description={t('Windows Terminal 과 같은 콘솔 엔진입니다. Claude Code 전체 화면 모드의 휠 스크롤, vim · htop 같은 프로그램의 마우스가 동작합니다. 끄면 Windows 내장 엔진을 씁니다. 새로 여는 터미널부터 적용.')}
            >
              <Switch checked={conptyDll !== false} onChange={setConptyDll} label={t('최신 ConPTY')} />
            </Row>
          )}
          <Row label={t('셸 프로필 불러오기')} description={t('끄면 $PROFILE / .bashrc 등을 건너뛰어 더 빨리 열립니다 (단축어와 hera 는 항상 동작).')}>
            <Switch checked={Boolean(loadProfile)} onChange={setLoadProfile} label={t('셸 프로필')} />
          </Row>
          <Row
            label={t('Codex 로그인 유지 (권장)')}
            description={t('HERA 가 여는 Codex 탭마다 자기 서버를 씁니다(--no-daemon). Codex 공유 데몬이 예전 로그인을 들고 있어도, HERA 를 재시작 · 업데이트한 뒤 Codex 가 다시 로그인을 요구하지 않습니다.')}
          >
            <Switch checked={codexOwnServer !== false} onChange={setCodexOwnServer} label={t('Codex 로그인 유지')} />
          </Row>
          <Row label={t('글꼴')}>
            <Input value={fontFamily} onChange={event => setFontFamily(event.target.value)} className="w-72 font-mono text-[12px]" />
          </Row>
          <Row label={t('커서')}>
            <Select value={cursorStyle || 'bar'} onChange={event => setCursorStyle(event.target.value as Settings['cursorStyle'])} className="w-32">
              <option value="bar">{t('세로 막대')}</option>
              <option value="block">{t('블록')}</option>
              <option value="underline">{t('밑줄')}</option>
            </Select>
            <Switch checked={Boolean(cursorBlink)} onChange={setCursorBlink} label={t('깜빡임')} />
          </Row>
          <Row label={t('글자 크기 / 줄 간격')}>
            <NumberInput value={fontSize || 13} min={8} max={28} onCommit={setFontSize} />
            <NumberInput value={lineHeight || 1.2} min={1} max={2} step={0.05} onCommit={setLineHeight} />
          </Row>
          <Row label={t('외부 터미널')}>
            <Select value={externalTerminal} onChange={event => setExternalTerminal(event.target.value as Settings['externalTerminal'])} className="w-56">
              <option value="auto">{t('자동')}</option>
              {isMac && (
                <>
                  <option value="terminal">Terminal.app</option>
                  <option value="iterm">iTerm</option>
                </>
              )}
              {isWin && (
                <>
                  <option value="wt">Windows Terminal</option>
                  <option value="conhost">{t('콘솔 창')}</option>
                </>
              )}
            </Select>
          </Row>
        </Section>

        <Section title={t('세션 기억 · 재부팅 복구')}>
          <div className="mb-1 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3 text-[12px] leading-relaxed text-(--ui-text-secondary)">
            {t('열려 있는 터미널은 탭을 열고 닫을 때와 45초마다 자동 저장됩니다 (컴퓨터가 갑자기 꺼져도 직전 상태가 남습니다). 다시 켜면 셸은 마지막에 있던 폴더에서,')}{' '}
            {t('Claude · Codex 는')} <b>{t('그 터미널이 하던 대화 그대로')}</b>{t(' 이어서 열립니다. 개발 서버 같은 프로젝트 명령은 자동으로 다시 실행하지 않고 “다시 시작” 버튼으로 재개합니다.')}
          </div>
          <Row label={t('다시 켜질 때')} description={t('HERA 를 껐다 켜거나 재부팅한 뒤 이전 터미널을 어떻게 되살릴지')}>
            <SegmentedControl
              value={restoreMode || 'resume'}
              onChange={setRestoreMode}
              options={[
                { value: 'resume', label: t('자동으로 이어서 실행') },
                { value: 'manual', label: t('화면만 복원') }
              ]}
            />
          </Row>
          <Row label={t('컴퓨터를 켜면 HERA 자동 실행')} description={t('로그인할 때 HERA 가 켜지고 위 설정대로 세션을 되살립니다. (설치한 HERA 에만 적용)')}>
            <Switch checked={launchAtLogin !== false} onChange={setLaunchAtLogin} label={t('자동 실행')} />
          </Row>
        </Section>

        <Section title={t('창 · 알림')}>
          <Row label={t('테마')}>
            <SegmentedControl
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: t('다크') },
                { value: 'light', label: t('라이트') },
                { value: 'system', label: t('시스템') }
              ]}
            />
          </Row>
          <Row label={t('전역 단축키')} description={t('어디서든 HERA 창을 보이기/숨기기. Electron accelerator 형식 (예: Control+Alt+Space)')}>
            <Input
              value={hotkeyDraft}
              onChange={event => setHotkeyDraft(event.target.value)}
              onBlur={() => hotkeyDraft !== hotkey && setHotkey(hotkeyDraft)}
              onKeyDown={event => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
              className="w-56 font-mono text-[12px]"
            />
          </Row>
          <Row label={t('닫으면 트레이로')} description={t('창을 닫아도 터미널과 AI 세션은 계속 실행됩니다.')}>
            <Switch checked={Boolean(closeToTray)} onChange={setCloseToTray} label={t('트레이로')} />
          </Row>
          <Row label={t('숨긴 채로 시작')}>
            <Switch checked={Boolean(startHidden)} onChange={setStartHidden} label={t('숨긴 채로 시작')} />
          </Row>
          <Row label={t('AI 작업 완료 알림')} description={t('보고 있지 않은 세션의 AI 가 8초 이상 작업 후 멈추면 알림')}>
            <Switch checked={Boolean(notifyDone)} onChange={setNotifyDone} label={t('완료 알림')} />
          </Row>
          <Row label={t('승인 대기 알림')} description={t('AI 가 권한/확인을 묻고 기다릴 때 알림')}>
            <Switch checked={Boolean(notifyApproval)} onChange={setNotifyApproval} label={t('승인 알림')} />
          </Row>
          <Row label={t('사용량 경고 기준')} description={t('한도 막대가 이 % 를 넘으면 경고 색으로 표시')}>
            <NumberInput value={warn || 80} min={10} max={100} onCommit={setWarn} />
            <span className="text-[12px] text-(--ui-text-tertiary)">%</span>
          </Row>
        </Section>
      </div>
    </div>
  )
}
