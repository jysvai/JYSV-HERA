// Account profiles ("auto-login"): each profile is a separate config dir that
// the agent CLI is pointed at through its own env var (CLAUDE_CONFIG_DIR,
// CODEX_HOME). Log in once per profile; every session HERA launches with that
// profile is then already signed in, and the CLIs refresh their own tokens.
// Status readers only look at non-secret fields (expiry, plan, email).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { AccountProfile, AccountStatus } from '../shared/types'
import { newId } from '../shared/util'

import { agyDir, agyLoggedIn } from './agent-data'
import { binDir, dataDir, expandHome, home, isMac, isWin, readJson, subDir, writeJsonAtomic } from './paths'
import { getConfig, updateConfig } from './store'

function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null
  const part = token.split('.')[1]

  if (!part) return null

  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function claudeKeychainHasCredentials(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { timeout: 3000 }, error =>
      resolve(!error)
    )
  })
}

async function claudeStatus(profile: AccountProfile, dir: string): Promise<AccountStatus> {
  const status: AccountStatus = {
    profileId: profile.id,
    agentId: 'claude',
    label: profile.label,
    configDir: dir,
    exists: fs.existsSync(dir),
    loggedIn: null
  }
  const creds = readJson<{ claudeAiOauth?: Record<string, unknown> }>(path.join(dir, '.credentials.json'))
  const oauth = creds?.claudeAiOauth

  if (oauth) {
    status.method = 'Claude 계정 (OAuth)'
    status.plan = [oauth.subscriptionType, oauth.rateLimitTier].filter(Boolean).join(' · ') || null
    status.expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
    const refreshExpiry = typeof oauth.refreshTokenExpiresAt === 'number' ? oauth.refreshTokenExpiresAt : null
    // The CLI refreshes access tokens itself; only an expired refresh token needs a re-login.
    status.loggedIn = refreshExpiry ? refreshExpiry > Date.now() : true
    status.detail = refreshExpiry ? `재로그인 필요 시점: ${new Date(refreshExpiry).toLocaleDateString()}` : undefined
  } else if (isMac && profile.configDir === null) {
    status.loggedIn = await claudeKeychainHasCredentials()
    status.method = status.loggedIn ? 'macOS 키체인' : undefined
  } else {
    status.loggedIn = false
  }

  // Account identity lives in ~/.claude.json (default) or <dir>/.claude.json.
  const identityFile = profile.configDir ? path.join(dir, '.claude.json') : path.join(home, '.claude.json')
  const identity = readJson<{ oauthAccount?: { emailAddress?: string; organizationName?: string } }>(identityFile)

  if (identity?.oauthAccount) {
    status.email = identity.oauthAccount.emailAddress || null
    if (identity.oauthAccount.organizationName) {
      status.detail = [identity.oauthAccount.organizationName, status.detail].filter(Boolean).join(' · ')
    }
  }

  if (process.env.ANTHROPIC_API_KEY && profile.configDir === null && !oauth) {
    status.loggedIn = true
    status.method = 'ANTHROPIC_API_KEY 환경변수'
  }

  return status
}

function codexStatus(profile: AccountProfile, dir: string): AccountStatus {
  const status: AccountStatus = {
    profileId: profile.id,
    agentId: 'codex',
    label: profile.label,
    configDir: dir,
    exists: fs.existsSync(dir),
    loggedIn: false
  }
  const auth = readJson<{ auth_mode?: string; OPENAI_API_KEY?: string | null; tokens?: Record<string, unknown>; last_refresh?: string }>(
    path.join(dir, 'auth.json')
  )

  if (!auth) return status

  if (auth.tokens?.id_token) {
    const claims = decodeJwtPayload(auth.tokens.id_token)
    const openai = (claims?.['https://api.openai.com/auth'] || {}) as Record<string, unknown>
    status.loggedIn = true
    status.method = 'ChatGPT 계정'
    status.email = typeof claims?.email === 'string' ? claims.email : null
    status.plan = typeof openai.chatgpt_plan_type === 'string' ? openai.chatgpt_plan_type : null
    status.lastRefresh = auth.last_refresh ? Date.parse(auth.last_refresh) || null : null
  } else if (auth.OPENAI_API_KEY) {
    status.loggedIn = true
    status.method = 'OpenAI API 키'
  }

  if (auth.auth_mode && !status.method) status.method = auth.auth_mode

  return status
}

/** Default profile per agent plus user-created ones. */
export function allProfiles(): AccountProfile[] {
  const config = getConfig()
  const defaults: AccountProfile[] = config.agents
    .filter(agent => agent.enabled && (agent.profileEnv || agent.id === 'agy'))
    .map(agent => ({ id: `default:${agent.id}`, agentId: agent.id, label: '기본', configDir: null }))

  return [...defaults, ...config.profiles]
}

export async function accountStatuses(): Promise<AccountStatus[]> {
  const config = getConfig()
  const out: AccountStatus[] = []

  for (const profile of allProfiles()) {
    const agent = config.agents.find(entry => entry.id === profile.agentId)

    if (!agent) continue

    const dir = path.resolve(expandHome(profile.configDir || agent.defaultConfigDir || home))

    try {
      if (agent.id === 'claude') out.push(await claudeStatus(profile, dir))
      else if (agent.id === 'codex') out.push(codexStatus(profile, dir))
      else if (agent.id === 'agy') {
        const loggedIn = agyLoggedIn()
        out.push({
          profileId: profile.id,
          agentId: 'agy',
          label: profile.label,
          configDir: agyDir(),
          exists: fs.existsSync(agyDir()),
          loggedIn,
          method: loggedIn ? 'Google 계정' : undefined,
          detail: loggedIn === false ? 'cli.log 기준 로그인되어 있지 않음 — agy 를 실행해 로그인하세요.' : undefined
        })
      } else {
        out.push({ profileId: profile.id, agentId: agent.id, label: profile.label, configDir: dir, exists: fs.existsSync(dir), loggedIn: null })
      }
    } catch (error) {
      out.push({
        profileId: profile.id,
        agentId: agent.id,
        label: profile.label,
        configDir: dir,
        exists: false,
        loggedIn: null,
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return out
}

export function createProfile(agentId: string, label: string, configDir?: string): AccountProfile {
  const safe = label.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'profile'
  const dir = configDir?.trim() ? path.resolve(expandHome(configDir.trim())) : path.join(subDir('profiles'), `${agentId}-${safe}`)
  fs.mkdirSync(dir, { recursive: true })
  const profile: AccountProfile = { id: newId('acct_'), agentId, label: label.trim() || safe, configDir: dir }
  updateConfig(draft => {
    draft.profiles.push(profile)
  }, 0)

  return profile
}

export function removeProfile(profileId: string) {
  updateConfig(draft => {
    draft.profiles = draft.profiles.filter(profile => profile.id !== profileId)
  }, 0)
}

// ---- Claude statusline tap (opt-in): captures rate_limits from Claude Code's
// statusline stdin into HERA's data dir, then runs the user's original command.

function claudeSettingsFile(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR ? expandHome(process.env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude'), 'settings.json')
}

function heraCommand(): string {
  const shim = isWin ? path.join(binDir(), 'hera.cmd') : path.join(binDir(), 'hera')

  return isWin ? `"${shim}"` : `'${shim.replace(/'/g, `'\\''`)}'`
}

export function statuslineTapState(): { installed: boolean; original: string | null; settingsFile: string } {
  const file = claudeSettingsFile()
  const settings = readJson<{ statusLine?: { command?: string } }>(file)
  const command = settings?.statusLine?.command || ''

  return { installed: command.includes('statusline-tap'), original: command || null, settingsFile: file }
}

export function installStatuslineTap(): { ok: boolean; message: string } {
  const file = claudeSettingsFile()
  const settings = readJson<Record<string, unknown>>(file) || {}
  const statusLine = (settings.statusLine || {}) as { type?: string; command?: string; refreshInterval?: number }

  if (statusLine.command?.includes('statusline-tap')) {
    return { ok: true, message: '이미 연동되어 있습니다.' }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true })

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.hera-backup`)
  }

  const original = statusLine.command || ''
  settings.statusLine = {
    ...statusLine,
    type: 'command',
    command: `${heraCommand()} statusline-tap${original ? ` -- ${original}` : ''}`
  }
  writeJsonAtomic(file, settings)
  writeJsonAtomic(path.join(dataDir(), 'statusline-original.json'), { command: original })

  return { ok: true, message: `연동 완료 (백업: ${file}.hera-backup)` }
}

export function uninstallStatuslineTap(): { ok: boolean; message: string } {
  const file = claudeSettingsFile()
  const settings = readJson<Record<string, unknown>>(file)
  const statusLine = settings?.statusLine as { command?: string } | undefined

  if (!settings || !statusLine?.command?.includes('statusline-tap')) {
    return { ok: true, message: '연동되어 있지 않습니다.' }
  }

  const original = statusLine.command.split(' -- ').slice(1).join(' -- ').trim()

  if (original) {
    settings.statusLine = { ...statusLine, command: original }
  } else {
    delete settings.statusLine
  }

  writeJsonAtomic(file, settings)

  return { ok: true, message: '연동을 해제했습니다.' }
}
