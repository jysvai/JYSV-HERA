// New-version check against the project's GitHub releases, and the in-app update.
// The check is HERA's only background network request (the setting `checkUpdates`
// turns it off). Downloading happens only when the user presses the update button:
// HERA fetches this OS's package from the release, checks its SHA-256 against the
// digest GitHub publishes, and on "restart to install" hands over to the installer.

import { execFile, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { app, net } from 'electron'

import { t } from '../shared/i18n'
import type { UpdateInfo, UpdateProgress } from '../shared/types'
import { dataPath, findOnPath, isMac, isWin, writeJsonAtomic } from './paths'

export const RELEASES_URL = 'https://github.com/jysvai/JYSV-HERA/releases'
const LATEST_API = 'https://api.github.com/repos/jysvai/JYSV-HERA/releases/latest'
/** Automatic checks run at most this often; the button forces one. */
const EVERY_MS = 6 * 60 * 60_000
/** Downloads live in HERA's own data folder: /tmp is shared on Linux, and pkexec installs what is there. */
const downloadsDir = () => dataPath('update')
/** A download that receives nothing for this long is given up. */
const STALL_MS = 60_000

interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** `sha256:<hex>` as GitHub reports it. */
  digest?: string
}

/** How this copy of HERA was installed, which decides what to download and how to install it. */
type InstallKind = 'nsis' | 'mac-app' | 'appimage' | 'deb' | 'rpm'

let current: UpdateInfo | null = null
let running: Promise<UpdateInfo> | null = null
/** Assets of the latest release, from the last successful check of this run. */
let assets: ReleaseAsset[] = []
let progress: UpdateProgress | null = null
let downloaded: { version: string; file: string; kind: InstallKind } | null = null
let downloading: Promise<UpdateInfo> | null = null

function parse(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())

  return match ? match.slice(1, 4).map(Number) : null
}

/** True when `latest` is a higher x.y.z than `installed`. */
export function isNewer(latest: string, installed: string): boolean {
  const a = parse(latest)
  const b = parse(installed)
  if (!a || !b) return false

  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }

  return false
}

function quietly(run: () => void) {
  try {
    run()
  } catch {
    // best effort
  }
}

function succeeds(file: string, args: string[]): boolean {
  try {
    return spawnSync(file, args, { stdio: 'ignore', timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

/** The key the NSIS installer keeps its install folder under: UUID v5 of the appId `com.jysvai.hera`. */
const APP_GUID = 'f9fa82da-ecff-5b6c-9ad7-8dab25310956'

/** Windows: was this copy installed for all users (the HKLM entry points at our folder)? */
function installedForAllUsers(): boolean {
  try {
    const out = spawnSync('reg', ['query', `HKLM\\Software\\${APP_GUID}`, '/v', 'InstallLocation'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).stdout || ''
    const location = /InstallLocation\s+REG_\w+\s+(.+)/.exec(out)?.[1]?.trim()

    return Boolean(location) && path.resolve(location!).toLowerCase() === path.dirname(process.execPath).toLowerCase()
  } catch {
    return false
  }
}

let kindCache: InstallKind | null | undefined

/** null = a portable copy or a dev build: those update from the release page. */
export function installKind(): InstallKind | null {
  if (kindCache !== undefined) return kindCache
  kindCache = null
  if (!app.isPackaged) return kindCache

  const exeDir = path.dirname(process.execPath)

  if (isWin) {
    // The NSIS installer leaves "Uninstall <exe>.exe" next to the app; the portable zip does not.
    quietly(() => {
      if (fs.readdirSync(exeDir).some(name => /^Uninstall .+\.exe$/i.test(name))) kindCache = 'nsis'
    })
  } else if (isMac) {
    const bundle = macBundle()
    if (bundle) {
      quietly(() => {
        fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
        fs.accessSync(bundle, fs.constants.W_OK)
        kindCache = 'mac-app'
      })
    }
  } else if (process.arch === 'x64') {
    if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) {
      quietly(() => {
        fs.accessSync(path.dirname(process.env.APPIMAGE!), fs.constants.W_OK)
        kindCache = 'appimage'
      })
    }
    else if (findOnPath('pkexec') && fs.existsSync('/var/lib/dpkg/info/jysv-hera.list')) kindCache = 'deb'
    else if (findOnPath('pkexec') && findOnPath('rpm') && succeeds('rpm', ['-q', 'jysv-hera'])) kindCache = 'rpm'
  }

  return kindCache
}

function macBundle(): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\//.exec(process.execPath)

  return match ? match[1] : null
}

/** The release file for this install kind, by the names electron-builder gives them. */
export function pickAsset(kind: InstallKind, names: string[], arch: string = process.arch): string | null {
  const ends: Record<InstallKind, string> = {
    nsis: '-win-x64.exe',
    'mac-app': `-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`,
    appimage: '-linux-x86_64.AppImage',
    deb: '-linux-amd64.deb',
    rpm: '-linux-x86_64.rpm'
  }

  return names.find(name => name.startsWith('JYSV-HERA-') && name.endsWith(ends[kind])) || null
}

function withState(info: UpdateInfo): UpdateInfo {
  const kind = installKind()

  return {
    ...info,
    installable: Boolean(info.newer && kind),
    progress: progress && downloaded?.version !== info.latest && progress.phase === 'ready' ? null : progress
  }
}

function stored(): UpdateInfo | null {
  try {
    const value = JSON.parse(fs.readFileSync(dataPath('update.json'), 'utf8')) as UpdateInfo

    return { ...value, current: app.getVersion(), newer: value.latest ? isNewer(value.latest, app.getVersion()) : false }
  } catch {
    return null
  }
}

/** Last known result without touching the network. */
export function updateState(): UpdateInfo {
  current ??= stored()

  return withState(current || { current: app.getVersion(), latest: null, newer: false, url: RELEASES_URL, checkedAt: 0 })
}

/** Ask GitHub for the latest release (deduplicated; skipped when the last check is recent unless forced). */
export function checkForUpdate(force = false): Promise<UpdateInfo> {
  const known = updateState()
  if (!force && known.checkedAt && Date.now() - known.checkedAt < EVERY_MS && !known.error) return Promise.resolve(known)
  if (running) return running

  running = (async () => {
    const installed = app.getVersion()
    let next: UpdateInfo

    try {
      const response = await net.fetch(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `JYSV-HERA/${installed}` },
        signal: AbortSignal.timeout(15_000)
      })
      if (response.status === 404) {
        next = { current: installed, latest: null, newer: false, url: RELEASES_URL, checkedAt: Date.now() }
      } else {
        if (!response.ok) throw new Error(`GitHub ${response.status}`)
        const body = (await response.json()) as {
          tag_name?: string
          html_url?: string
          published_at?: string
          assets?: { name?: string; browser_download_url?: string; size?: number; digest?: string | null }[]
        }
        const latest = String(body.tag_name || '').replace(/^v/, '') || null
        assets = (body.assets || [])
          .filter(asset => typeof asset.name === 'string' && String(asset.browser_download_url || '').startsWith('https://github.com/jysvai/JYSV-HERA/releases/download/'))
          .map(asset => ({ name: asset.name!, url: asset.browser_download_url!, size: Number(asset.size) || 0, digest: asset.digest || undefined }))
        next = {
          current: installed,
          latest,
          newer: latest ? isNewer(latest, installed) : false,
          url: typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/') ? body.html_url : RELEASES_URL,
          publishedAt: body.published_at ? Date.parse(body.published_at) || undefined : undefined,
          checkedAt: Date.now()
        }
      }
      writeJsonAtomic(dataPath('update.json'), next)
    } catch (error) {
      // Keep the last good answer; only note that this attempt failed.
      next = { ...(current || stored() || { latest: null, newer: false, url: RELEASES_URL }), current: installed, error: (error as Error).message || 'network error', checkedAt: Date.now() }
    }

    if (!next.error && progress?.phase === 'error') progress = null
    current = next

    return withState(next)
  })().finally(() => {
    running = null
  })

  return running
}

/** SHA-256 the release lists for `name`: GitHub's asset digest, or the release's SHA256SUMS.txt. */
async function expectedSha256(name: string): Promise<string | null> {
  const asset = assets.find(entry => entry.name === name)
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest || '')
  if (digest) return digest[1].toLowerCase()

  const sums = assets.find(entry => entry.name === 'SHA256SUMS.txt')
  if (!sums) return null
  const text = await (await net.fetch(sums.url, { signal: AbortSignal.timeout(30_000) })).text()
  const line = text.split(/\r?\n/).find(row => row.trim().endsWith(` ${name}`) || row.trim().endsWith(`*${name}`))

  return line ? line.trim().split(/\s+/)[0].toLowerCase() : null
}

/** Download this OS's package of the latest release and verify it. `notify` gets progress. */
export function downloadUpdate(notify: (info: UpdateInfo) => void): Promise<UpdateInfo> {
  if (downloading) return downloading

  downloading = (async () => {
    let partial: string | null = null
    const report = (next: UpdateProgress) => {
      progress = next
      notify(updateState())
    }

    try {
      const kind = installKind()
      if (!kind) throw new Error(t('이 설치 방식은 앱 안에서 업데이트할 수 없습니다. 릴리스 페이지에서 받아 주세요.'))

      // Assets are kept in memory only, so ask GitHub again when this run has none.
      if (!assets.length || !updateState().newer) await checkForUpdate(true)
      const state = updateState()
      if (!assets.length && state.error) throw new Error(state.error)
      if (!state.newer || !state.latest) throw new Error(t('새 버전이 없습니다.'))
      if (downloaded?.version === state.latest && fs.existsSync(downloaded.file)) {
        report({ phase: 'ready', received: 1, total: 1 })
        return updateState()
      }

      const name = pickAsset(kind, assets.map(asset => asset.name))
      const asset = assets.find(entry => entry.name === name)
      if (!asset) throw new Error(t('이 OS 용 파일이 릴리스에 없습니다.'))
      const sha256 = await expectedSha256(asset.name)
      if (!sha256) throw new Error(t('릴리스에 체크섬이 없어 설치하지 않습니다.'))

      fs.rmSync(downloadsDir(), { recursive: true, force: true })
      fs.mkdirSync(downloadsDir(), { recursive: true, mode: 0o700 })
      const file = path.join(downloadsDir(), asset.name)
      partial = `${file}.part`

      report({ phase: 'downloading', received: 0, total: asset.size })
      // Given up when nothing arrives for a minute, so the button never hangs.
      const controller = new AbortController()
      let stall = setTimeout(() => controller.abort(), STALL_MS)
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(partial, { mode: 0o600 })
      let writeError: Error | null = null
      out.on('error', error => (writeError = error))
      let received = 0
      let lastReport = 0

      try {
        const response = await net.fetch(asset.url, { headers: { 'User-Agent': `JYSV-HERA/${app.getVersion()}` }, signal: controller.signal })
        if (!response.ok || !response.body) throw new Error(t('내려받기 실패 (HTTP {status})', { status: response.status }))
        const reader = response.body.getReader()

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          clearTimeout(stall)
          stall = setTimeout(() => controller.abort(), STALL_MS)
          if (writeError) throw writeError
          hash.update(value)
          received += value.byteLength
          if (!out.write(value)) await new Promise<void>(resolve => (out.once('drain', () => resolve()), out.once('error', () => resolve())))
          if (Date.now() - lastReport > 250) {
            lastReport = Date.now()
            report({ phase: 'downloading', received, total: asset.size })
          }
        }
      } catch (error) {
        throw controller.signal.aborted ? new Error(t('내려받기가 1분 동안 멈춰서 그만두었습니다. 다시 눌러 주세요.')) : error
      } finally {
        clearTimeout(stall)
        await new Promise<void>(resolve => (out.writableFinished || out.destroyed ? resolve() : out.end(() => resolve())))
      }
      if (writeError) throw writeError

      if (asset.size && received !== asset.size) throw new Error(t('내려받은 크기가 다릅니다 ({received} / {expected} 바이트).', { received, expected: asset.size }))
      if (hash.digest('hex') !== sha256) throw new Error(t('체크섬이 맞지 않아 설치하지 않습니다.'))

      // Windows: an antivirus may still hold the fresh file for a moment.
      for (let attempt = 0; ; attempt++) {
        try {
          fs.renameSync(partial, file)
          break
        } catch (error) {
          if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
      partial = null
      if (kind === 'appimage') fs.chmodSync(file, 0o755)
      downloaded = { version: state.latest, file, kind }
      report({ phase: 'ready', received, total: asset.size })
    } catch (error) {
      const leftover = partial
      if (leftover) quietly(() => fs.rmSync(leftover, { force: true }))
      report({ phase: 'error', received: 0, total: 0, error: (error as Error).message || String(error) })
    }

    return updateState()
  })().finally(() => {
    downloading = null
  })

  return downloading
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Write a script that waits for this process to end, swaps in the new build and starts it. */
function detachedScript(lines: string[]): void {
  const script = path.join(downloadsDir(), 'install.sh')
  const wait = `n=0; while kill -0 ${process.pid} 2>/dev/null && [ $n -lt 300 ]; do sleep 0.2; n=$((n + 1)); done`
  // HERA never quit (a minute passed): swapping files under a running app is worse than not updating.
  const stillRunning = `kill -0 ${process.pid} 2>/dev/null && exit 1`
  fs.writeFileSync(script, ['#!/bin/sh', wait, stillRunning, ...lines, ''].join('\n'), { mode: 0o700 })
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 10 * 60_000, maxBuffer: 8 << 20 }, (error, _stdout, stderr) =>
      error ? reject(new Error(String(stderr || error.message).trim().split('\n').slice(-3).join(' '))) : resolve()
    )
  )
}

/**
 * Install the downloaded update and restart into it. `quit` ends HERA (sessions are
 * saved first and come back after the restart).
 */
export async function installUpdate(quit: () => void, notify: (info: UpdateInfo) => void): Promise<UpdateInfo> {
  if (progress?.phase === 'installing') return updateState()
  const ready = downloaded && fs.existsSync(downloaded.file) ? downloaded : null
  if (!ready) {
    progress = { phase: 'error', received: 0, total: 0, error: t('먼저 업데이트를 내려받아 주세요.') }
    return updateState()
  }

  progress = { phase: 'installing', received: 1, total: 1 }
  notify(updateState())

  try {
    if (ready.kind === 'nsis') {
      // Silent update of the existing install: same folder, same all-users / per-user mode,
      // the installer asks for admin rights itself when needed and starts HERA afterwards.
      // The mode is passed explicitly: with both an HKLM and an HKCU entry the installer would pick per-user.
      const args = ['/S', '--updated', '--force-run', installedForAllUsers() ? '/allusers' : '/currentuser']
      // Quit only once the installer really started; a blocked one leaves HERA running with the error.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ready.file, args, { detached: true, stdio: 'ignore', windowsHide: true })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    } else if (ready.kind === 'mac-app') {
      const bundle = macBundle()!
      const unpacked = path.join(downloadsDir(), 'unpacked')
      fs.rmSync(unpacked, { recursive: true, force: true })
      await run('/usr/bin/ditto', ['-x', '-k', ready.file, unpacked])
      const fresh = fs.readdirSync(unpacked).find(name => name.endsWith('.app'))
      if (!fresh) throw new Error(t('내려받은 파일에 앱이 없습니다.'))
      const next = path.join(unpacked, fresh)
      const old = `${bundle}.old`
      detachedScript([
        `rm -rf ${shellQuote(old)}`,
        `if mv ${shellQuote(bundle)} ${shellQuote(old)}; then`,
        `  if mv ${shellQuote(next)} ${shellQuote(bundle)}; then rm -rf ${shellQuote(old)}; else rm -rf ${shellQuote(bundle)}; mv ${shellQuote(old)} ${shellQuote(bundle)}; fi`,
        'fi',
        `xattr -dr com.apple.quarantine ${shellQuote(bundle)} 2>/dev/null`,
        `open ${shellQuote(bundle)}`
      ])
    } else if (ready.kind === 'appimage') {
      const target = process.env.APPIMAGE!
      // Start the AppImage either way: the new one, or the old one when the move failed.
      detachedScript([`if mv -f ${shellQuote(ready.file)} ${shellQuote(target)}; then chmod +x ${shellQuote(target)}; fi`, `nohup ${shellQuote(target)} >/dev/null 2>&1 &`])
    } else {
      // deb / rpm: the package manager replaces the files (pkexec asks for the password), then HERA restarts.
      await run('pkexec', ready.kind === 'deb' ? ['dpkg', '-i', ready.file] : ['rpm', '-U', '--replacepkgs', ready.file])
      app.relaunch()
    }
  } catch (error) {
    progress = { phase: 'error', received: 0, total: 0, error: (error as Error).message || String(error) }
    return updateState()
  }

  setTimeout(quit, 300)

  return updateState()
}

/** Remove what an earlier update left behind (the installer may still have been running then). */
export function cleanUpdateDownloads(): void {
  if (downloading || downloaded || progress?.phase === 'installing') return
  quietly(() => fs.rmSync(downloadsDir(), { recursive: true, force: true }))
}
