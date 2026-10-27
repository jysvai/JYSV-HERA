import { atom } from 'nanostores'

import { t } from '../../../shared/i18n'
import { api } from '../../lib/hera'
import { $projectId, $view, refreshActivity, toast } from '../../store/app'

export interface ScanResult {
  parent: string
  found: { path: string; name: string; markers: string[]; mtime: number }[]
}

export const $scanResult = atom<ScanResult | null>(null)
export const $editProjectId = atom<string | null>(null)

export async function addProjectsFlow(mode: 'pick' | 'scan') {
  if (mode === 'scan') {
    const result = await api.scanFolder()

    if (result) {
      if (!result.found.length) toast(t('프로젝트로 보이는 하위 폴더가 없습니다.'))
      else $scanResult.set(result)
    }

    return
  }

  const paths = await api.pickFolders()

  if (!paths.length) return

  await addPaths(paths)
}

export async function addPaths(paths: string[]) {
  const added = await api.addProjects(paths)

  if (!added.length) {
    toast(t('폴더만 프로젝트로 등록할 수 있습니다.'), 'error')
    return
  }

  if (added.length) {
    $projectId.set(added[0].id)
    $view.set('workspace')
    toast(added.length === 1 ? t('{name} 등록됨', { name: added[0].name }) : t('프로젝트 {count}개 등록됨', { count: added.length }))
    refreshActivity()
  }
}
