import { t } from './i18n'
import { DEFAULT_THEME, THEME_PRESETS, isHexColor, sanitizeCustomThemes } from './themes'
import type { AgentDef, HeraConfig, LanesSettings, Settings, Shortcut, TeamPreset } from './types'

// Generic heuristics shared by most agent TUIs. Per-agent patterns extend them.
export const GENERIC_BUSY =
  'esc to (interrupt|cancel|stop)|ctrl\\+c to (interrupt|stop|cancel)|press esc to stop|\\(esc to|thinking…|working…'
export const GENERIC_APPROVAL =
  'do you want to (proceed|allow|make|create|run|edit)|allow (this|once|always|command)|approve (this|command)|\\[y/n\\]|\\(y/n\\)|yes, (and )?(don.?t|always) ask|waiting for (your )?(approval|confirmation)|press enter to (confirm|continue)|enter to confirm|do you trust|trust this folder|trust the (files|folder|authors)'

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    continueArgs: '--continue',
    sessionIdArgs: '--session-id {id}',
    resumeIdArgs: '--resume {id}',
    color: '#d97757',
    builtin: true,
    enabled: true,
    profileEnv: 'CLAUDE_CONFIG_DIR',
    defaultConfigDir: '~/.claude',
    systemPromptFlag: '--append-system-prompt',
    // "✻ Baking… (4s · thinking)" — newer builds dropped the esc hint.
    busyPattern: 'esc to interrupt|\\S… \\(\\d+(\\.\\d+)?[smh]\\b',
    approvalPattern: 'do you want to|❯ 1\\. yes',
    signature: 'Claude Code|✻ Welcome to Claude',
    usageProvider: 'claude',
    loginCommand: 'claude /login',
    installHint: 'npm i -g @anthropic-ai/claude-code',
    homepage: 'https://claude.com/claude-code'
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    continueArgs: 'resume --last',
    resumeIdArgs: 'resume {id}',
    color: '#10a37f',
    builtin: true,
    enabled: true,
    profileEnv: 'CODEX_HOME',
    defaultConfigDir: '~/.codex',
    busyPattern: 'esc to interrupt|Working \\(',
    approvalPattern: 'allow command|approve|would you like to (run|make)|▌ ?1\\. yes',
    signature: 'OpenAI Codex|>_ Codex',
    usageProvider: 'codex',
    loginCommand: 'codex login',
    installHint: 'npm i -g @openai/codex',
    homepage: 'https://github.com/openai/codex'
  },
  {
    id: 'agy',
    name: 'Antigravity',
    command: 'agy',
    continueArgs: '--continue',
    color: '#4285f4',
    builtin: true,
    enabled: true,
    defaultConfigDir: '~/.gemini/antigravity-cli',
    busyPattern: 'esc to (interrupt|cancel)',
    signature: 'Antigravity',
    usageProvider: 'agy',
    installHint: 'https://antigravity.google',
    homepage: 'https://antigravity.google'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    command: 'qwen',
    color: '#615ced',
    builtin: true,
    enabled: true,
    busyPattern: 'esc to cancel',
    signature: 'Qwen Code',
    installHint: 'npm i -g @qwen-code/qwen-code',
    homepage: 'https://github.com/QwenLM/qwen-code'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    continueArgs: '--continue',
    color: '#f0b429',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g opencode-ai',
    homepage: 'https://opencode.ai'
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    command: 'copilot',
    continueArgs: '--continue',
    color: '#6e40c9',
    builtin: true,
    enabled: true,
    signature: 'GitHub Copilot',
    installHint: 'npm i -g @github/copilot',
    homepage: 'https://github.com/github/copilot-cli'
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    continueArgs: 'resume',
    color: '#7f7f7f',
    builtin: true,
    enabled: true,
    signature: 'Cursor Agent',
    installHint: 'https://cursor.com/cli',
    homepage: 'https://cursor.com/cli'
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    continueArgs: '--restore-chat-history',
    color: '#14b014',
    builtin: true,
    enabled: true,
    signature: 'Aider v',
    installHint: 'pip install aider-install && aider-install',
    homepage: 'https://aider.chat'
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    color: '#ff5543',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @sourcegraph/amp',
    homepage: 'https://ampcode.com'
  },
  {
    id: 'crush',
    name: 'Crush',
    command: 'crush',
    color: '#ff60ff',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @charmland/crush',
    homepage: 'https://github.com/charmbracelet/crush'
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    command: 'droid',
    color: '#ef6c00',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'https://factory.ai',
    homepage: 'https://factory.ai'
  },
  {
    id: 'kimi',
    name: 'Kimi CLI',
    command: 'kimi',
    color: '#1f6feb',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'uv tool install kimi-cli',
    homepage: 'https://github.com/MoonshotAI/kimi-cli'
  },
  {
    id: 'grok',
    name: 'Grok Build (xAI)',
    command: 'grok',
    continueArgs: '--continue',
    color: '#8a8f98',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'curl -fsSL https://x.ai/cli/install.sh | bash  ·  Windows: irm https://x.ai/cli/install.ps1 | iex',
    homepage: 'https://x.ai/cli'
  },
  {
    id: 'muse',
    name: 'Muse Code (Meta)',
    command: 'muse',
    color: '#0866ff',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'curl -fsSL https://dev.meta.ai/install.sh | sh  ·  Windows: irm https://dev.meta.ai/install.ps1 | iex',
    homepage: 'https://dev.meta.ai/products/muse-code/'
  },
  {
    id: 'vibe',
    name: 'Mistral Vibe',
    command: 'vibe',
    continueArgs: '--continue',
    color: '#fa520f',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'uv tool install mistral-vibe',
    homepage: 'https://github.com/mistralai/mistral-vibe'
  },
  {
    id: 'kiro',
    name: 'Kiro CLI (Amazon)',
    command: 'kiro-cli',
    continueArgs: '--resume',
    color: '#9046ff',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'curl -fsSL https://cli.kiro.dev/install | bash',
    homepage: 'https://kiro.dev/docs/cli/'
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose session',
    continueArgs: '-r',
    color: '#c2a26b',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'https://goose-docs.ai',
    homepage: 'https://goose-docs.ai'
  },
  {
    id: 'cline',
    name: 'Cline CLI',
    command: 'cline',
    color: '#5a67d8',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g cline',
    homepage: 'https://docs.cline.bot/cline-cli/overview'
  },
  {
    id: 'continue',
    name: 'Continue CLI',
    command: 'cn',
    continueArgs: '--resume',
    color: '#2f80ed',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @continuedev/cli',
    homepage: 'https://github.com/continuedev/continue'
  },
  {
    id: 'auggie',
    name: 'Auggie (Augment)',
    command: 'auggie',
    continueArgs: '--continue',
    color: '#29a36a',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @augmentcode/auggie',
    homepage: 'https://docs.augmentcode.com/cli/overview'
  },
  {
    id: 'junie',
    name: 'Junie (JetBrains)',
    command: 'junie',
    color: '#ff2e88',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @jetbrains/junie',
    homepage: 'https://junie.jetbrains.com'
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    command: 'devin',
    color: '#3a9ad9',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'curl -fsSL https://cli.devin.ai/install.sh | bash  ·  Windows: irm https://static.devin.ai/cli/setup.ps1 | iex',
    homepage: 'https://docs.devin.ai/cli'
  },
  {
    id: 'kilo',
    name: 'Kilo Code CLI',
    command: 'kilo',
    continueArgs: '--continue',
    color: '#d4cf2a',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @kilocode/cli',
    homepage: 'https://kilo.ai/docs/cli'
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    command: 'qoder',
    color: '#2ec27e',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @qoder-ai/qodercli',
    homepage: 'https://docs.qoder.com/cli'
  },
  {
    id: 'rovodev',
    name: 'Rovo Dev (Atlassian)',
    command: 'acli rovodev run',
    continueArgs: '--restore',
    color: '#0c66e4',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'https://developer.atlassian.com/cloud/acli/',
    homepage: 'https://support.atlassian.com/rovo/docs/rovo-dev-cli-quickstart-guide/'
  },
  {
    id: 'jules',
    name: 'Jules Tools (Google)',
    command: 'jules',
    color: '#715cd7',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @google/jules',
    homepage: 'https://jules.google'
  },
  {
    id: 'letta',
    name: 'Letta Code',
    command: 'letta',
    color: '#7c5cff',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g @letta-ai/letta-code',
    homepage: 'https://github.com/letta-ai/letta-code'
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    command: 'codebuff',
    color: '#00c875',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g codebuff',
    homepage: 'https://www.codebuff.com'
  },
  {
    id: 'codewhale',
    name: 'Codewhale (DeepSeek)',
    command: 'codewhale',
    color: '#4d6bfe',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'npm i -g codewhale',
    homepage: 'https://codewhale.net'
  },
  {
    id: 'hermes',
    name: 'Hermes Agent (Nous)',
    command: 'hermes',
    continueArgs: '--continue',
    color: '#c9a227',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'https://github.com/NousResearch/hermes-agent',
    homepage: 'https://github.com/NousResearch/hermes-agent'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local models)',
    command: 'lms chat',
    color: '#6b4ce6',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'https://lmstudio.ai (lms ships with the app)',
    homepage: 'https://lmstudio.ai/docs/cli'
  },
  {
    id: 'llm',
    name: 'LLM (local or any API)',
    command: 'llm chat',
    continueArgs: '-c',
    color: '#888888',
    builtin: true,
    enabled: true,
    signature: '',
    installHint: 'pipx install llm',
    homepage: 'https://llm.datasette.io'
  }
]

export const defaultShortcuts = (): Shortcut[] => [
  { name: 'cc', command: 'claude', description: 'Claude Code' },
  { name: 'ccr', command: 'claude --continue', description: t('마지막 Claude 대화 이어하기') },
  { name: 'cx', command: 'codex', description: 'Codex' },
  { name: 'cxr', command: 'codex resume --last', description: t('마지막 Codex 세션 이어하기') },
  { name: 'gst', command: 'git status -sb', description: t('git 상태 요약') },
  { name: 'glog', command: 'git log --oneline -15', description: t('최근 커밋 15개') },
  { name: 'hl', command: 'hera list', description: t('실행 중인 AI 세션 목록') }
]

export const defaultTeams = (): TeamPreset[] => [
  {
    id: 'claude-codex',
    name: t('Claude 메인 + Codex 보조'),
    brief: true,
    panes: [
      { agentId: 'claude', role: 'main' },
      { agentId: 'codex', role: 'helper' }
    ]
  },
  {
    id: 'claude-codex-agy',
    name: t('Claude 메인 + Codex·Antigravity 보조'),
    brief: true,
    panes: [
      { agentId: 'claude', role: 'main' },
      { agentId: 'codex', role: 'helper' },
      { agentId: 'agy', role: 'helper' }
    ]
  }
]

export function defaultSettings(platform: string): Settings {
  const mac = platform === 'darwin'

  return {
    defaultShell: 'auto',
    loadShellProfile: true,
    fontFamily: mac
      ? '"SF Mono", Menlo, "D2Coding", "Apple SD Gothic Neo", monospace'
      : '"Cascadia Mono", "D2Coding", Consolas, "Malgun Gothic", monospace',
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 3000,
    gpu: false,
    conptyDll: true,
    codexOwnServer: true,
    cursorStyle: 'bar',
    cursorBlink: false,
    lowMemory: true,
    deepSleepMinutes: 10,
    hotkey: mac ? 'Command+Shift+Space' : 'Control+Alt+Space',
    closeToTray: true,
    startHidden: false,
    notifyOnDone: true,
    notifyOnApproval: true,
    theme: 'dark',
    darkTheme: DEFAULT_THEME.dark,
    lightTheme: DEFAULT_THEME.light,
    accent: '',
    customThemes: [],
    highContrast: false,
    launchAtLogin: true,
    checkUpdates: true,
    restoreMode: 'resume',
    externalTerminal: 'auto',
    lanes: { ...DEFAULT_LANES, allowRules: [...DEFAULT_LANES.allowRules] },
    usageWarnPercent: 80,
    uiLanguage: 'auto'
  }
}

export function defaultConfig(platform: string): HeraConfig {
  return {
    version: 1,
    projects: [],
    agents: BUILTIN_AGENTS.map(agent => ({ ...agent })),
    shortcuts: defaultShortcuts(),
    profiles: [],
    teams: defaultTeams(),
    settings: defaultSettings(platform)
  }
}

/** Merge a stored config with defaults so new fields/builtin agents appear after upgrades. */
export function normalizeConfig(raw: Partial<HeraConfig> | null | undefined, platform: string): HeraConfig {
  const base = defaultConfig(platform)

  if (!raw || typeof raw !== 'object') {
    return base
  }

  const agents: AgentDef[] = []
  const stored = Array.isArray(raw.agents) ? raw.agents : []

  for (const builtin of BUILTIN_AGENTS) {
    const saved = stored.find(agent => agent?.id === builtin.id)
    // Builtin patterns/flags follow the shipped preset; user-editable fields stick.
    agents.push(
      saved
        ? {
            ...builtin,
            command: saved.command || builtin.command,
            continueArgs: saved.continueArgs ?? builtin.continueArgs,
            color: saved.color || builtin.color,
            enabled: saved.enabled !== false,
            // Patterns follow the shipped preset unless the user edited them.
            customPatterns: saved.customPatterns === true,
            busyPattern: saved.customPatterns ? saved.busyPattern || builtin.busyPattern : builtin.busyPattern,
            approvalPattern: saved.customPatterns ? saved.approvalPattern || builtin.approvalPattern : builtin.approvalPattern
          }
        : { ...builtin }
    )
  }

  for (const agent of stored) {
    if (agent && !agent.builtin && agent.id && !agents.some(existing => existing.id === agent.id)) {
      agents.push({ ...agent, builtin: false })
    }
  }

  return {
    version: 1,
    projects: Array.isArray(raw.projects)
      ? raw.projects.map(project => ({
          ...project,
          notes: project.notes ?? '',
          todos: Array.isArray(project.todos) ? project.todos : [],
          commands: Array.isArray(project.commands) ? project.commands : [],
          pinned: Boolean(project.pinned),
          createdAt: project.createdAt || Date.now()
        }))
      : [],
    agents,
    shortcuts: Array.isArray(raw.shortcuts) ? raw.shortcuts : base.shortcuts,
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    teams: Array.isArray(raw.teams) && raw.teams.length ? raw.teams : base.teams,
    settings: normalizeSettings(base.settings, raw.settings)
  }
}

function normalizeSettings(base: Settings, raw: Partial<Settings> | undefined): Settings {
  const settings: Settings = { ...base, ...(raw || {}) }
  settings.customThemes = sanitizeCustomThemes(settings.customThemes)
  const known = (id: unknown, mode: 'dark' | 'light') =>
    [...THEME_PRESETS, ...settings.customThemes].some(theme => theme.id === id && theme.mode === mode)

  if (!['dark', 'light', 'system'].includes(settings.theme)) settings.theme = base.theme
  if (!known(settings.darkTheme, 'dark')) settings.darkTheme = DEFAULT_THEME.dark
  if (!known(settings.lightTheme, 'light')) settings.lightTheme = DEFAULT_THEME.light
  // 0.1.0 stored its gold default as an explicit accent; treat it as "theme accent".
  if (!isHexColor(settings.accent) || settings.accent.toLowerCase() === '#c9a227') settings.accent = ''
  settings.highContrast = Boolean(settings.highContrast)
  settings.launchAtLogin = settings.launchAtLogin !== false
  settings.checkUpdates = settings.checkUpdates !== false
  settings.conptyDll = settings.conptyDll !== false
  settings.codexOwnServer = settings.codexOwnServer !== false
  if (!['auto', 'ko', 'en'].includes(settings.uiLanguage)) settings.uiLanguage = 'auto'
  if (!['bar', 'block', 'underline'].includes(settings.cursorStyle)) settings.cursorStyle = 'bar'
  settings.cursorBlink = settings.cursorBlink === true
  if (settings.restoreMode !== 'manual') settings.restoreMode = 'resume'
  settings.lanes = normalizeLanes(settings.lanes)

  return settings
}

/** What a lane in dontAsk mode needs to read, report and message main. */
export const LANE_ALLOW_RULES = [
  'Read',
  'Grep',
  'Glob',
  'Edit(./.claude/lanes/**)',
  'SendMessage',
  'ListAgents',
  'WebSearch',
  'WebFetch',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'PowerShell(git status:*)',
  'PowerShell(git diff:*)',
  'PowerShell(git log:*)',
  'PowerShell(git show:*)'
]

export const DEFAULT_LANES: LanesSettings = {
  enabled: false,
  mode: 'auto',
  host: 'hera',
  autoStart: false,
  applyMain: false,
  allowRules: LANE_ALLOW_RULES
}

function normalizeLanes(raw: Partial<LanesSettings> | undefined): LanesSettings {
  const value = raw && typeof raw === 'object' ? raw : {}
  const rules = Array.isArray(value.allowRules) ? value.allowRules.filter(rule => typeof rule === 'string' && rule.trim()).map(rule => rule.trim()) : null

  return {
    enabled: value.enabled === true,
    mode: value.mode === 'custom' ? 'custom' : 'auto',
    host: value.host === 'window' ? 'window' : 'hera',
    autoStart: value.autoStart === true,
    applyMain: value.applyMain === true,
    allowRules: rules && rules.length ? rules : [...LANE_ALLOW_RULES]
  }
}
