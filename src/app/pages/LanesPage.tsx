import { useStore } from '@nanostores/react'
import { IconBrandGithub, IconCheck, IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { LanesInfo, LanesSettings, LaneTier } from '../../../shared/types'
import { Badge, Button, Input, PageHeader, Row, Section, SegmentedControl, Select, Switch, Textarea } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, $projectId, toast, updateConfig } from '../../store/app'
import { $lanesInfo, loadLanesInfo, setLaneOptions } from '../../store/lanes'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const MODEL_SUGGESTIONS = ['claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5']

const PERMISSION_LABELS: Record<string, string> = {
  auto: t('auto — Claude 가 위험도를 보고 판단 (권장)'),
  acceptEdits: t('acceptEdits — 파일 편집만 자동 허용'),
  dontAsk: t('dontAsk — 허용 목록에 있는 것만, 나머지는 거절'),
  manual: t('manual — 매번 묻기 (HERA 탭 · 창에서만)'),
  bypassPermissions: t('bypassPermissions — 모두 허용 (위험)')
}

const STYLE_LABELS: Record<string, string> = {
  auto: t('자동 — 메인이 내 작업 방식을 보고 정함'),
  developer: t('개발자 — 코드 · 테스트 · diff 중심'),
  planner: t('기획자 — 조사 · 선택지 · 초안 중심'),
  beginner: t('입문자 — 쉬운 말로, 한 단계씩, lane 이 검토')
}

const TIER_INFO: { key: 'main' | LaneTier; label: string; description: string }[] = [
  { key: 'main', label: t('메인'), description: t('내가 직접 대화하는 Claude. 판단과 코드 작성, 결정을 맡습니다.') },
  { key: 'mid', label: 'mid lane', description: t('조사 · 계획 · 리뷰 · 테스트처럼 판단이 필요한 곁일.') },
  { key: 'low', label: 'low lane', description: t('검색 · 목록 · 스크립트 실행 · 크롤링 같은 반복 작업.') }
]

function useLanesSettings(): [LanesSettings | undefined, (patch: Partial<LanesSettings>) => void] {
  const config = useStore($config)

  return [config?.settings.lanes, patch => updateConfig(draft => void Object.assign(draft.settings.lanes, patch))]
}

/** Text input that commits on blur / Enter. */
function CommitInput({ value, onCommit, disabled, list, className }: { value: string; onCommit: (next: string) => void; disabled?: boolean; list?: string; className?: string }) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim())
  }

  return (
    <Input
      value={text}
      disabled={disabled}
      list={list}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => event.key === 'Enter' && commit()}
      className={className}
    />
  )
}

function option(info: LanesInfo, key: string): string {
  return String(info.effective[key] ?? '')
}

function InstallGuide({ repo }: { repo: string }) {
  return (
    <div className="space-y-2 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3 text-[12.5px] leading-relaxed">
      <div className="font-medium">{t('lanes 가 설치되어 있지 않습니다.')}</div>
      <div className="text-(--ui-text-secondary)">{t('Claude Code 프롬프트에서 한 번 설치하면 HERA 가 자동으로 찾습니다.')}</div>
      <pre className="overflow-x-auto rounded-md bg-(--ui-bg-input) px-3 py-2 font-mono text-[12px]">/plugin install lanes --marketplace jysvai/lanes</pre>
      <div className="text-(--ui-text-secondary)">{t('또는 터미널에서:')}</div>
      <pre className="overflow-x-auto rounded-md bg-(--ui-bg-input) px-3 py-2 font-mono text-[12px]">
        {'claude plugin marketplace add jysvai/lanes\nclaude plugin install lanes@claude-mod --scope user'}
      </pre>
      <Button size="sm" onClick={() => window.open(repo, '_blank')}>
        <IconBrandGithub /> lanes GitHub
      </Button>
    </div>
  )
}

function StatusCard({ info }: { info: LanesInfo }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3">
      <div className="min-w-0 space-y-1 text-[12.5px]">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">lanes {info.version ? `v${info.version}` : ''}</span>
          <Badge tone="ok">{t('설치됨')}</Badge>
          {info.enabledInClaude ? <Badge tone="ok">{t('Claude Code 에서 켜짐')}</Badge> : <Badge tone="warn">{t('Claude Code 에서 꺼짐')}</Badge>}
        </div>
        <div className="truncate text-(--ui-text-tertiary)" title={info.root || ''}>
          {info.pluginKey} · {info.rootLabel}
        </div>
        {!info.enabledInClaude && <div className="text-(--ui-text-secondary)">{t('Claude Code 에서 /plugin 으로 lanes 를 켜야 메인 세션이 lane 에 일을 넘깁니다.')}</div>}
      </div>
      <Button size="sm" variant="ghost" onClick={() => window.open(info.repo, '_blank')}>
        <IconBrandGithub /> GitHub
      </Button>
    </div>
  )
}

function ModelRouting({ info, locked }: { info: LanesInfo; locked: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-(--ui-stroke-tertiary)">
      <datalist id="lane-models">
        {MODEL_SUGGESTIONS.map(model => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <div className="grid grid-cols-[1.1fr_1.3fr_1.3fr_0.8fr] gap-2 bg-(--ui-bg-quaternary) px-3 py-1.5 text-[11px] text-(--ui-text-tertiary)">
        <span>{t('누가')}</span>
        <span>{t('모델')}</span>
        <span>{t('대체 모델 (과부하 시)')}</span>
        <span>effort</span>
      </div>
      {TIER_INFO.map(tier => (
        <div key={tier.key} className="grid grid-cols-[1.1fr_1.3fr_1.3fr_0.8fr] items-center gap-2 border-t border-(--ui-stroke-tertiary) px-3 py-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{tier.label}</div>
            <div className="text-[11px] leading-snug text-(--ui-text-tertiary)">{tier.description}</div>
          </div>
          <CommitInput value={option(info, `${tier.key}_model`)} list="lane-models" disabled={locked} onCommit={value => void setLaneOptions({ [`${tier.key}_model`]: value || null })} />
          <CommitInput
            value={option(info, `${tier.key}_fallback`)}
            list="lane-models"
            disabled={locked}
            onCommit={value => void setLaneOptions({ [`${tier.key}_fallback`]: value })}
          />
          <Select value={option(info, `${tier.key}_effort`)} disabled={locked} onChange={event => void setLaneOptions({ [`${tier.key}_effort`]: event.target.value })}>
            {EFFORTS.map(effort => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  )
}

function NumberOption({ info, name, locked, min = 0, max = 1_000_000 }: { info: LanesInfo; name: string; locked: boolean; min?: number; max?: number }) {
  return (
    <CommitInput
      value={option(info, name)}
      disabled={locked}
      className="w-28 text-right tabular-nums"
      onCommit={value => {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) void setLaneOptions({ [name]: Math.min(max, Math.max(min, Math.round(parsed))) })
      }}
    />
  )
}

function AllowRules({ settings, locked, onChange }: { settings: LanesSettings; locked: boolean; onChange: (rules: string[]) => void }) {
  const [text, setText] = useState(settings.allowRules.join('\n'))

  useEffect(() => setText(settings.allowRules.join('\n')), [settings.allowRules])

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        disabled={locked}
        rows={8}
        className="font-mono text-[12px]"
        onChange={event => setText(event.target.value)}
        onBlur={() => {
          const rules = text
            .split('\n')
            .map(rule => rule.trim())
            .filter(Boolean)
          if (rules.join('\n') !== settings.allowRules.join('\n')) onChange(rules)
        }}
      />
      <div className="text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">
        {t('dontAsk 모드의 lane 은 여기 있는 것만 할 수 있습니다. 프로젝트의')} <code>.claude/settings.local.json</code>{' '}
        {t('에 들어가며, 자동 모드에서는 lane 을 열 때 HERA 가 넣어 줍니다. lanes 는 모드와 상관없이 lane 의 코드 편집(Edit)과 git commit · push · reset 같은 명령을 항상 막습니다.')}
      </div>
    </div>
  )
}

function ProjectRoles() {
  const config = useStore($config)
  const projects = config?.projects || []
  const [projectId, setProjectId] = useState<string>(() => (projects.some(entry => entry.id === $projectId.get()) ? $projectId.get() || '' : projects[0]?.id || ''))
  const [roles, setRoles] = useState<Record<LaneTier, string>>({ mid: '', low: '' })
  const [saved, setSaved] = useState<Record<LaneTier, string>>({ mid: '', low: '' })

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projectId, projects])

  useEffect(() => {
    if (!projectId) return
    void api.laneProject(projectId).then(state => {
      const next = state?.roles || { mid: '', low: '' }
      setRoles(next)
      setSaved(next)
    })
  }, [projectId])

  const project = projects.find(entry => entry.id === projectId)

  const draft = () => {
    if (!project) return
    const commands = project.commands.map(command => `- ${command.name}: \`${command.command}\``).join('\n')
    setRoles({
      mid: [`이 프로젝트: ${project.name} (${project.path})`, commands ? `검증할 때 쓰는 명령:\n${commands}` : '', '리뷰와 테스트 결과는 실패한 줄과 원인을 먼저 적어 주세요.'].filter(Boolean).join('\n\n'), // i18n-ignore
      low: [`이 프로젝트: ${project.name}`, '검색에서 node_modules, dist, release, .git 은 빼 주세요.', commands ? `실행해도 되는 명령:\n${commands}` : ''].filter(Boolean).join('\n\n') // i18n-ignore
    })
  }

  const save = async (tier: LaneTier) => {
    if (!projectId) return
    try {
      await api.saveLaneRole(projectId, tier, roles[tier])
      setSaved(current => ({ ...current, [tier]: roles[tier] }))
      toast(t('{tier} lane 지시를 저장했습니다. 다음에 lane 을 열 때부터 적용됩니다.', { tier }))
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  if (!projects.length) return <div className="text-[12.5px] text-(--ui-text-tertiary)">{t('등록된 프로젝트가 없습니다.')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={projectId} onChange={event => setProjectId(event.target.value)} className="w-64">
          {projects.map(entry => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" onClick={draft}>
          {t('자동 작성')}
        </Button>
      </div>
      {(['mid', 'low'] as LaneTier[]).map(tier => (
        <div key={tier} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium">{tier === 'mid' ? t('mid lane 에게') : t('low lane 에게')}</span>
            <Button size="xs" disabled={roles[tier] === saved[tier]} onClick={() => void save(tier)}>
              <IconCheck /> {t('저장')}
            </Button>
          </div>
          <Textarea
            value={roles[tier]}
            rows={4}
            className="text-[12.5px]"
            placeholder={tier === 'mid' ? t('예: 테스트는 npm test, 타입 검사는 npm run typecheck. 리뷰 기준은 docs/architecture.md.') : t('예: 로그는 logs/ 에 있음. 검색에서 dist 와 node_modules 는 제외.')}
            onChange={event => setRoles(current => ({ ...current, [tier]: event.target.value }))}
          />
        </div>
      ))}
      <div className="text-[11.5px] text-(--ui-text-tertiary)">
        <code>.claude/lanes/roles/mid.md · low.md</code> {t('로 저장되어 lane 이 열릴 때 역할 지시 뒤에 붙습니다. 비우면 파일을 지웁니다.')}
      </div>
    </div>
  )
}

export function LanesPage() {
  const info = useStore($lanesInfo)
  const [settings, setSettings] = useLanesSettings()

  useEffect(() => {
    void loadLanesInfo()
  }, [])

  if (!settings) return null

  const installed = Boolean(info?.installed)
  const locked = settings.mode === 'auto'

  const switchMode = async (mode: 'auto' | 'custom') => {
    if (mode === settings.mode) return
    if (mode === 'auto' && info) {
      // Auto = the plugin's own recommended values plus HERA's choices for launch and permissions.
      const reset = Object.fromEntries(Object.keys(info.stored).map(key => [key, null]))
      if (Object.keys(reset).length) await setLaneOptions(reset)
      setSettings({ mode, host: info.canHost ? 'hera' : 'window', allowRules: [...info.recommendedRules] })
      return
    }
    setSettings({ mode })
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={t('Lanes 연동')}
          description={t('lanes 는 메인 Claude 옆에 mid · low 보조 세션을 두고, 곁일을 더 싼 모델에 넘겨 비용을 아끼는 Claude Code 플러그인입니다.')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => void loadLanesInfo()}>
              <IconRefresh /> {t('다시 찾기')}
            </Button>
          }
        />

        <Section title={t('상태')}>{info ? installed ? <StatusCard info={info} /> : <InstallGuide repo={info.repo} /> : <div className="text-[12.5px] text-(--ui-text-tertiary)">{t('찾는 중…')}</div>}</Section>

        <Section title={t('연동')}>
          <Row label={t('HERA 에서 lanes 사용')} description={t('켜면 오른쪽 패널에 Lanes 탭이 생기고, 아래 설정이 HERA 가 여는 Claude 와 lane 에 적용됩니다.')}>
            <Switch checked={settings.enabled && installed} onChange={enabled => installed && setSettings({ enabled })} label={t('lanes 연동')} />
          </Row>
          {settings.enabled && installed && (
            <Row label={t('설정 방식')} description={locked ? t('자동: lanes 권장값을 쓰고, 실행 방식과 권한은 HERA 가 맞춥니다.') : t('직접 조정: 아래 값을 모두 바꿀 수 있습니다. 자동으로 돌아가면 권장값으로 되돌립니다.')}>
              <SegmentedControl
                value={settings.mode}
                options={[
                  { value: 'auto', label: t('자동 (권장)') },
                  { value: 'custom', label: t('직접 조정') }
                ]}
                onChange={mode => void switchMode(mode)}
              />
            </Row>
          )}
        </Section>

        {settings.enabled && installed && info && (
          <>
            <Section title={t('모델 라우팅')}>
              <ModelRouting info={info} locked={locked} />
              <Row label={t('HERA 가 여는 Claude 에 메인 설정 적용')} description={t('Claude 를 열 때 --model · --fallback-model · --effort 를 붙입니다 (lanes 의 claude-main 과 같은 효과). 대체 모델은 시작할 때만 정할 수 있습니다.')}>
                <Switch checked={settings.applyMain} onChange={applyMain => setSettings({ applyMain })} label={t('메인 설정 적용')} />
              </Row>
              <Row label={t('넘김 알림 기준 (토큰)')} description={t('메인이 직접 읽은 조회 · 명령 출력이 이만큼 쌓이면 lane 에 넘기라고 알려 줍니다. 0 = 알리지 않음.')}>
                <NumberOption info={info} name="nudge_tokens" locked={locked} />
              </Row>
              <Row label={t('작업 스타일')} description={t('메인이 일을 나누는 방식과 lane 의 보고 방식.')}>
                <Select value={option(info, 'work_style')} disabled={locked} onChange={event => void setLaneOptions({ work_style: event.target.value })} className="w-80">
                  {Object.entries(STYLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Row>
            </Section>

            <Section title={t('실행 방식')}>
              <Row label={t('HERA 에서 lane 을 열 때')} description={info.canHost ? t('HERA 탭: lane 이 이 창 안의 탭으로 열려 바로 보고 입력할 수 있습니다.') : t('이 운영체제에서는 lane 이 별도 창으로 열립니다.')}>
                <SegmentedControl
                  value={info.canHost ? settings.host : 'window'}
                  options={[
                    ...(info.canHost ? [{ value: 'hera' as const, label: t('HERA 탭') }] : []),
                    { value: 'window' as const, label: t('별도 창') }
                  ]}
                  onChange={host => setSettings({ host })}
                />
              </Row>
              <Row label={t('Claude 가 스스로 lane 을 열 때')} description={t('메인 Claude 가 일을 넘기다 lane 이 꺼져 있으면 직접 엽니다. 백그라운드는 claude attach 로 봅니다.')}>
                <SegmentedControl
                  value={option(info, 'launch') === 'background' ? 'background' : 'window'}
                  options={[
                    { value: 'window', label: t('별도 창') },
                    { value: 'background', label: t('백그라운드') }
                  ]}
                  onChange={launch => !locked && void setLaneOptions({ launch })}
                />
              </Row>
              <Row label={t('Claude 를 열면 lanes 도 같이 열기')} description={t('HERA 에서 Claude 를 열 때 그 프로젝트의 mid · low lane 을 함께 엽니다.')}>
                <Switch checked={settings.autoStart} onChange={autoStart => setSettings({ autoStart })} label={t('lanes 같이 열기')} />
              </Row>
              <Row label={t('쉬는 lane 자동 종료 (분)')} description={t('할 일이 없는 lane 은 이만큼 지나면 스스로 닫힙니다. 0 = 닫지 않음.')}>
                <NumberOption info={info} name="idle_minutes" locked={locked} max={1440} />
              </Row>
            </Section>

            <Section title={t('권한')}>
              <Row label={t('lane 권한 모드')} description={t('lane 에 --permission-mode 로 전달됩니다. 백그라운드 lane 은 물어볼 사람이 없으니 auto 나 dontAsk 를 쓰세요.')}>
                <Select value={option(info, 'permission_mode')} disabled={locked} onChange={event => void setLaneOptions({ permission_mode: event.target.value })} className="w-80">
                  {Object.entries(PERMISSION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Row>
              <AllowRules settings={settings} locked={locked} onChange={allowRules => setSettings({ allowRules })} />
            </Section>

            <Section title={t('프로젝트별 작업 지시')}>
              <div className="mb-2 text-[12px] text-(--ui-text-secondary)">{t('프로젝트마다 mid · low 에게 무엇을, 어떻게 맡길지 적어 둡니다 (테스트 명령, 검색 범위, 검증 기준).')}</div>
              <ProjectRoles />
            </Section>

            <div className="mt-2 mb-6 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3 text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">
              {t('모델 · 권한 · 스타일은 Claude Code 설정(')}<code>{info.settingsLabel}</code>
              {t(')의 lanes 항목에 저장됩니다 (처음 바꿀 때 HERA 데이터 폴더에 원본을 백업). 새로 여는 Claude 세션과 lane 부터 적용되고, 이미 열린 lane 은 다시 시작해야 바뀝니다.')}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
