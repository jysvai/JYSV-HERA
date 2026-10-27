import { useStore } from '@nanostores/react'
import { IconLogin, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { t } from '../../../shared/i18n'
import type { AccountStatus } from '../../../shared/types'
import { relTime } from '../../../shared/util'
import { Badge, Button, Dialog, Input, PageHeader, Row, Section, Select, Switch } from '../../components/ui/primitives'
import { api } from '../../lib/hera'
import { $config, toast } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

function StatusBadge({ status }: { status: AccountStatus }) {
  if (status.loggedIn === true) return <Badge tone="ok">{t('로그인됨')}</Badge>
  if (status.loggedIn === false) return <Badge tone="danger">{t('로그인 필요')}</Badge>

  return <Badge>{t('알 수 없음')}</Badge>
}

export function AccountsPage() {
  const config = useStore($config)
  const [statuses, setStatuses] = useState<AccountStatus[] | null>(null)
  const [tap, setTap] = useState<{ installed?: boolean; original?: string | null; settingsFile?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ agentId: 'claude', label: '', dir: '' })

  const reload = () => {
    void api.accounts().then(setStatuses)
    void api.statusline('state').then(setTap)
  }

  useEffect(reload, [config?.profiles.length])

  const profileAgents = (config?.agents || []).filter(agent => agent.profileEnv)

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('계정 · 자동 로그인')}
        description={t('AI 별로 계정 프로필을 만들어 두면, HERA 가 그 프로필의 설정 폴더(CLAUDE_CONFIG_DIR / CODEX_HOME)로 CLI 를 띄워 한 번 로그인한 계정으로 계속 자동 로그인됩니다. 회사/개인 계정을 나눠 쓸 때 유용합니다. 토큰 값은 읽지 않고 만료·플랜 정보만 표시합니다.')}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <IconPlus /> {t('프로필 추가')}
          </Button>
        }
      />

      {!statuses ? (
        <div className="py-10 text-center text-[12.5px] text-(--ui-text-tertiary)">{t('확인 중…')}</div>
      ) : (
        <div className="space-y-2">
          {statuses.map(status => {
            const agent = config?.agents.find(entry => entry.id === status.agentId) || null
            const custom = !status.profileId.startsWith('default:')

            return (
              <div key={status.profileId} className="flex items-center gap-4 rounded-lg bg-(--ui-bg-quaternary) px-4 py-3">
                <AgentGlyph agent={agent} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-semibold">{agent?.name || status.agentId}</span>
                    <span className="text-(--ui-text-secondary)">· {status.label}</span>
                    <StatusBadge status={status} />
                    {status.plan && <Badge tone="accent">{status.plan}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-(--ui-text-tertiary)">
                    {[status.email, status.method, status.lastRefresh ? t('토큰 갱신 {time}', { time: relTime(status.lastRefresh) }) : null, status.detail].filter(Boolean).join(' · ') ||
                      t('정보 없음')}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-(--ui-text-tertiary)">{status.configDir}</div>
                </div>
                <Button size="sm" variant={status.loggedIn === false ? 'default' : 'outline'} onClick={() => void api.login(status.profileId)}>
                  <IconLogin /> {status.loggedIn ? t('다시 로그인') : t('로그인')}
                </Button>
                {custom && (
                  <Button size="icon-sm" variant="ghost" aria-label={t('프로필 삭제')} onClick={() => void api.removeProfile(status.profileId).then(reload)}>
                    <IconTrash />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Section title={t('Claude 한도 연동')} className="mt-6">
        <Row
          label={t('Claude Code 상태줄에서 5시간/주간 한도 % 수집')}
          description={
            tap?.installed
              ? t('연동됨 — {file}', { file: tap.settingsFile })
              : t('Claude Code 는 한도 %를 상태줄 명령에만 넘겨 줍니다. 켜면 기존 상태줄 명령을 감싸서(백업 후) 값을 HERA 에 기록하고 원래 상태줄은 그대로 보여 줍니다. claude-token-saver 가 설치돼 있으면 그 캐시를 자동으로 읽으므로 켤 필요가 없습니다.')
          }
        >
          <Switch
            checked={Boolean(tap?.installed)}
            label={t('Claude 한도 연동')}
            onChange={next =>
              void api.statusline(next ? 'install' : 'uninstall').then(result => {
                toast(result.message || t('완료'))
                reload()
              })
            }
          />
        </Row>
      </Section>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t('계정 프로필 추가')}
        footer={
          <>
            <Button variant="text" onClick={() => setCreating(false)}>
              {t('취소')}
            </Button>
            <Button
              variant="default"
              disabled={!form.label.trim()}
              onClick={() =>
                void api.createProfile(form.agentId, form.label, form.dir || undefined).then(profile => {
                  setCreating(false)
                  setForm({ agentId: form.agentId, label: '', dir: '' })
                  toast(t('프로필을 만들었습니다. 로그인 버튼으로 이 프로필에 로그인하세요.'))
                  void api.login(profile.id)
                })
              }
            >
              {t('만들고 로그인')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <div className="mb-1 text-[12px] text-(--ui-text-secondary)">{t('에이전트')}</div>
            <Select value={form.agentId} onChange={event => setForm({ ...form, agentId: event.target.value })}>
              {profileAgents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.profileEnv})
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <div className="mb-1 text-[12px] text-(--ui-text-secondary)">{t('프로필 이름')}</div>
            <Input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder={t('예: 회사, 개인, 팀-공용')} />
          </label>
          <label className="block">
            <div className="mb-1 text-[12px] text-(--ui-text-secondary)">{t('설정 폴더 (비우면 HERA 데이터 폴더 아래 자동 생성)')}</div>
            <Input value={form.dir} onChange={event => setForm({ ...form, dir: event.target.value })} placeholder="~/.claude-work" className="font-mono text-[12px]" />
          </label>
          <p className="text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">
            {t('팀 프리셋이나 새 세션에서 이 프로필을 지정하면 해당 계정으로 실행됩니다. 기본 프로필은 각 CLI 의 원래 폴더(~/.claude, ~/.codex)를 그대로 씁니다.')}
          </p>
        </div>
      </Dialog>
    </div>
  )
}
