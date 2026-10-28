// English UI text, keyed by the Korean source text (see shared/i18n.ts).
import { EN_AGENTS } from './en-agents'
import { EN_MAIN } from './en-main'
import { EN_SETTINGS } from './en-settings'
import { EN_WORKSPACE } from './en-workspace'
import { EN_WORKTREES } from './en-worktrees'

export const EN: Record<string, string> = { ...EN_SETTINGS, ...EN_AGENTS, ...EN_WORKSPACE, ...EN_WORKTREES, ...EN_MAIN }
