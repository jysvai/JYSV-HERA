import { atom } from 'nanostores'

import type { LanesInfo } from '../../shared/types'
import { api } from '../lib/hera'
import { toast } from './app'

/** The lanes plugin as Claude Code has it installed (null until first loaded). */
export const $lanesInfo = atom<LanesInfo | null>(null)

export async function loadLanesInfo() {
  try {
    $lanesInfo.set(await api.lanesInfo())
  } catch (error) {
    toast(`lanes 정보를 읽지 못했습니다: ${(error as Error).message}`, 'error')
  }
}

/** Write lane options to Claude Code's settings (null = back to the plugin default). */
export async function setLaneOptions(patch: Record<string, string | number | boolean | null>) {
  try {
    $lanesInfo.set(await api.setLaneOptions(patch))
  } catch (error) {
    toast(`lanes 설정을 저장하지 못했습니다: ${(error as Error).message}`, 'error')
  }
}
