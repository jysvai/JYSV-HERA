import { useStore } from '@nanostores/react'
import { IconArrowLeft, IconArrowUp, IconChevronRight, IconPackage, IconPlug, IconPuzzle, IconRefresh, IconServer, IconSparkles } from '@tabler/icons-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'

import { t } from '../../../shared/i18n'
import type { AgentDef, CliExtensions, ExtensionGroup, ExtensionItem, ToolPackage, ToolPackages } from '../../../shared/types'
import { Badge, Button, Input, PageHeader, Section } from '../../components/ui/primitives'
import { api, isWin } from '../../lib/hera'
import { $config, $projectId, $view, toast } from '../../store/app'
import { AgentGlyph } from '../workspace/launch'

const MANAGER: Record<ToolPackage['manager'], string> = { npm: 'npm', brew: 'Homebrew', uv: 'uv', pipx: 'pipx', self: t('자체 업데이트') }
const KIND: Record<ExtensionGroup['kind'], { label: string; icon: typeof IconPlug }> = {
  plugins: { label: t('플러그인'), icon: IconPlug },
  extensions: { label: t('확장'), icon: IconPuzzle },
  mcp: { label: t('MCP 서버'), icon: IconServer },
  skills: { label: t('스킬'), icon: IconSparkles }
}
const SCOPE: Record<string, string> = { project: t('프로젝트'), local: t('이 프로젝트만') }
/** Longer groups fold after this many rows. */
const FOLD = 6

const matches = (query: string, ...texts: (string | undefined)[]) => !query || texts.some(text => text?.toLowerCase().includes(query))

function PackageRow({ pkg, agent, onUpdate }: { pkg: ToolPackage; agent: AgentDef | null; onUpdate: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-(--chrome-action-hover)">
      {agent ? <AgentGlyph agent={agent} size={18} /> : <IconPackage size={18} className="shrink-0 text-(--ui-text-tertiary)" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{agent?.name || pkg.name}</span>
          <Badge>{MANAGER[pkg.manager]}</Badge>
        </div>
        <div className="truncate font-mono text-[11px] text-(--ui-text-tertiary)">
          {agent && pkg.manager !== 'self' ? `${pkg.name} · ` : ''}
          {pkg.current || '?'}
          {pkg.outdated && pkg.latest ? ` → ${pkg.latest}` : ''}
        </div>
      </div>
      {pkg.outdated ? (
        <Badge tone="warn">{t('새 버전 {version}', { version: pkg.latest || '' })}</Badge>
      ) : pkg.latest ? (
        <Badge tone="ok">{t('최신')}</Badge>
      ) : (
        <Badge title={t('이 방식은 업데이트를 실행해 봐야 최신 버전을 알 수 있습니다.')}>{t('버전 확인 불가')}</Badge>
      )}
      <Button size="xs" variant={pkg.outdated ? 'default' : 'ghost'} title={pkg.command} onClick={onUpdate}>
        {t('업데이트')}
      </Button>
    </div>
  )
}

function ItemRow({ item, onUpdate }: { item: ExtensionItem; onUpdate: (id: string) => void }) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-(--chrome-action-hover)">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px]">
          <span className={item.enabled === false ? 'truncate text-(--ui-text-tertiary) line-through' : 'truncate font-medium'}>{item.name}</span>
          {item.version && <span className="shrink-0 font-mono text-[11px] text-(--ui-text-tertiary)">{item.version}</span>}
          {item.scope && SCOPE[item.scope] && <Badge>{SCOPE[item.scope]}</Badge>}
          {item.enabled === false && <Badge>{t('꺼짐')}</Badge>}
        </div>
        {item.detail && <div className="truncate text-[11.5px] text-(--ui-text-tertiary)">{item.detail}</div>}
      </div>
      {item.updateId && (
        <Button size="xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title={item.command} onClick={() => onUpdate(item.updateId!)}>
          <IconArrowUp /> {t('업데이트')}
        </Button>
      )}
    </div>
  )
}

function GroupBlock({ group, query, onUpdate }: { group: ExtensionGroup; query: string; onUpdate: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const kind = KIND[group.kind]
  const items = group.items.filter(item => matches(query, item.name, item.detail))
  if (!items.length) return null
  const shown = open || query ? items : items.slice(0, FOLD)

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 px-2 pb-1">
        <kind.icon size={14} className="shrink-0 text-(--ui-text-tertiary)" />
        <span className="text-[12px] font-semibold text-(--ui-text-secondary)">{kind.label}</span>
        <span className="text-[11.5px] text-(--ui-text-tertiary)">{items.length}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-(--ui-text-tertiary)" title={group.source}>
          {group.source}
        </span>
        {group.updateId && (
          <Button size="xs" variant="ghost" title={group.command} onClick={() => onUpdate(group.updateId!)}>
            <IconArrowUp /> {t('모두 업데이트')}
          </Button>
        )}
      </div>
      {shown.map(item => (
        <ItemRow key={`${item.scope || ''}:${item.name}`} item={item} onUpdate={onUpdate} />
      ))}
      {!query && items.length > FOLD && (
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 px-2 py-1 text-[11.5px] text-(--ui-text-secondary) hover:text-(--ui-text-primary)">
          <IconChevronRight size={12} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
          {open ? t('접기') : t('{count}개 더 보기', { count: items.length - FOLD })}
        </button>
      )}
    </div>
  )
}

function CliCard({ cli, agent, query, onUpdate }: { cli: CliExtensions; agent: AgentDef | null; query: string; onUpdate: (id: string) => void }) {
  const blocks = cli.groups.map(group => <GroupBlock key={`${group.kind}:${group.source}`} group={group} query={query} onUpdate={onUpdate} />)
  const counts = (['plugins', 'extensions', 'mcp', 'skills'] as const)
    .map(kind => [kind, cli.groups.filter(group => group.kind === kind).reduce((sum, group) => sum + group.items.length, 0)] as const)
    .filter(([, count]) => count > 0)
  if (query && !cli.groups.some(group => group.items.some(item => matches(query, item.name, item.detail)))) return null

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-(--ui-stroke-tertiary)">
      <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) px-3 py-2">
        {agent ? <AgentGlyph agent={agent} size={18} /> : <IconPuzzle size={18} className="text-(--ui-text-tertiary)" />}
        <span className="text-[13px] font-semibold">{cli.name}</span>
        <span className="truncate text-[11.5px] text-(--ui-text-tertiary)">{counts.map(([kind, count]) => `${KIND[kind].label} ${count}`).join(' · ')}</span>
      </div>
      <div className="divide-y divide-(--ui-stroke-tertiary)">{blocks}</div>
    </div>
  )
}

export function ExtensionsPage() {
  const config = useStore($config)
  const projectId = useStore($projectId)
  const [packages, setPackages] = useState<ToolPackages | null>(null)
  const [checking, setChecking] = useState(false)
  const [clis, setClis] = useState<CliExtensions[] | null>(null)
  const [query, setQuery] = useState('')

  const check = useCallback(async (force: boolean) => {
    setChecking(true)
    try {
      setPackages(await api.toolPackages(force))
    } catch (error) {
      toast((error as Error).message || String(error), 'error')
    } finally {
      setChecking(false)
    }
  }, [])
  const scan = useCallback(() => {
    void api
      .toolExtensions(projectId)
      .then(setClis)
      .catch(() => setClis([]))
  }, [projectId])

  useEffect(() => void check(false), [check])
  useEffect(scan, [scan])

  const agents = config?.agents || []
  const agentOf = (id: string | undefined) => (id ? agents.find(agent => agent.id === id) || null : null)
  const q = query.trim().toLowerCase()
  const outdated = packages?.packages.filter(pkg => pkg.outdated) || []
  const shownPackages = (packages?.packages || []).filter(pkg => matches(q, pkg.name, agentOf(pkg.agentId)?.name))

  const run = async (ids: string[]) => {
    if (!ids.length) return
    try {
      const info = await api.updateTools(ids, projectId)
      if (info) toast(t('터미널 탭에서 업데이트를 실행합니다. 끝나면 이 화면에서 「다시 확인」을 누르세요.'))
      else toast(t('목록이 바뀌었습니다. 다시 확인한 뒤 눌러 주세요.'), 'error')
    } catch (error) {
      toast((error as Error).message || String(error), 'error')
    }
  }

  let extensions: ReactElement | ReactElement[]
  if (clis === null) extensions = <div className="px-2 py-2 text-[12.5px] text-(--ui-text-tertiary)">{t('읽는 중…')}</div>
  else if (!clis.length) extensions = <div className="px-2 py-2 text-[12.5px] text-(--ui-text-tertiary)">{t('설치된 플러그인 · MCP 서버 · 스킬을 찾지 못했습니다.')}</div>
  else extensions = clis.map(cli => <CliCard key={cli.id} cli={cli} agent={agentOf(cli.agentId)} query={q} onUpdate={id => void run([id])} />)

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageHeader
        title={t('확장 · 업데이트')}
        description={t('AI CLI 와 그 안에 설치된 플러그인 · MCP 서버 · 스킬을 한곳에서 보고, 업데이트도 여기서 실행합니다. 목록은 각 CLI 의 설정 파일에서 읽습니다.')}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => $view.set('agents')}>
              <IconArrowLeft /> {t('에이전트')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={checking}
              onClick={() => {
                void check(true)
                scan()
              }}
            >
              <IconRefresh className={checking ? 'animate-spin' : undefined} /> {t('다시 확인')}
            </Button>
            <Button size="sm" variant="default" disabled={!outdated.length} onClick={() => void run(outdated.map(pkg => pkg.id))}>
              <IconArrowUp /> {outdated.length ? t('새 버전 {count}개 모두 업데이트', { count: outdated.length }) : t('모두 최신')}
            </Button>
          </>
        }
      />

      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('이름으로 찾기 (예: context7, codex, design)')} className="mb-2 h-8" />

      <Section
        title={t('CLI · 전역 패키지')}
        action={checking ? <span className="text-[11.5px] text-(--ui-text-tertiary)">{t('최신 버전 확인 중…')}</span> : undefined}
      >
        <div className="space-y-0.5">
          {shownPackages.map(pkg => (
            <PackageRow key={pkg.id} pkg={pkg} agent={agentOf(pkg.agentId)} onUpdate={() => void run([pkg.id])} />
          ))}
          {packages && !packages.packages.length && (
            <div className="px-2 py-2 text-[12.5px] text-(--ui-text-tertiary)">{t('npm · Homebrew · uv · pipx 로 설치한 도구를 찾지 못했습니다.')}</div>
          )}
          {!packages && checking && <div className="px-2 py-2 text-[12.5px] text-(--ui-text-tertiary)">{t('설치된 도구와 최신 버전을 확인하는 중입니다… (몇 초 걸립니다)')}</div>}
        </div>
        {packages?.errors.map(error => (
          <div key={error} className="mt-1 px-2 text-[11.5px] text-(--status-waiting)">
            {error}
          </div>
        ))}
        <p className="mt-2 px-2 text-[11.5px] text-(--ui-text-tertiary)">
          {t('업데이트는 터미널 탭에서 실행되어 진행 상황과 오류(권한 · 비밀번호 요청 포함)를 그대로 볼 수 있습니다.')}
          {isWin ? ` ${t('Windows 에서는 실행 중인 CLI 를 업데이트하면 실패할 수 있습니다. 그 CLI 의 탭을 닫고 다시 시도하세요.')}` : ''}
        </p>
      </Section>

      <Section title={t('플러그인 · MCP · 스킬')} className="mt-4">
        {extensions}
        <p className="px-2 text-[11.5px] text-(--ui-text-tertiary)">
          {t('MCP 서버는 이름과 실행하는 패키지만 보여 줍니다(토큰 · 환경 변수는 표시하지 않음). 플러그인을 업데이트한 뒤에는 그 CLI 를 다시 시작해야 적용됩니다.')}
        </p>
      </Section>
    </div>
  )
}
