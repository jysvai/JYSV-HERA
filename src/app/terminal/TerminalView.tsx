import { useStore } from '@nanostores/react'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef } from 'react'

import { t } from '../../../shared/i18n'
import type { PasteResult, SessionInfo } from '../../../shared/types'
import { formatBytes } from '../../../shared/util'
import { Button } from '../../components/ui/primitives'
import { api, isMac, isWin, osBuild, pathForFile, typedSince, writePty } from '../../lib/hera'
import { $config, $sessions, $termZoom, toast, zoomTerminals } from '../../store/app'
import { $terminalPalette, $theme } from '../../store/theme'
import { registerTerminal, unregisterTerminal } from './registry'

/** App-level chords the terminal must hand back to the window (not to the shell). */
export function isAppChord(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey && event.shiftKey
  const key = event.key.toLowerCase()

  if (isMac && event.metaKey && ['k', 't', 'w', 'b', 'u', 'j', 'e', ','].includes(key)) return true
  // Zoom: Ctrl / ⌘ with + (=), - and 0, as in Windows Terminal. Ctrl+Shift+- stays readline's undo.
  if ((isMac ? event.metaKey : event.ctrlKey) && !event.altKey && ['=', '+', '-', '0'].includes(event.key)) return true
  if (!isMac && mod && ['p', 't', 'w', 'b', 'u', 'j', 'e'].includes(key)) return true
  if (event.ctrlKey && key === 'tab') return true
  if (event.altKey && !event.ctrlKey && /^[1-9]$/.test(event.key)) return true

  return false
}

/** Quote a dropped path for the session's shell (PowerShell expands `$` inside "…"). */
export function quotePath(p: string, shell: string | undefined) {
  const native = shell === 'powershell' || shell === 'pwsh' || shell === 'cmd'
  if (native ? /^[A-Za-z0-9_./:\\-]+$/.test(p) : /^[A-Za-z0-9_./:-]+$/.test(p)) return p

  if (shell === 'powershell' || shell === 'pwsh') return `'${p.replace(/['\u2018\u2019\u201A\u201B]/g, quote => quote + quote)}'`
  if (shell === 'cmd') return `"${p.replace(/"/g, '')}"`

  return `'${p.replace(/'/g, "'\\''")}'`
}

/** Agent prompts take a path as a terminal drop types it: bare, or in double quotes. */
export function quoteForAgent(p: string) {
  return /^[A-Za-z0-9_./:\\-]+$/.test(p) ? p : `"${p}"`
}

/** Delivered paths as one line to type, quoted the way the program on the other side reads them. */
export function pasteText(result: PasteResult, session: SessionInfo | undefined): string {
  // A WSL or ssh path goes to a Linux program, whatever shell this computer runs.
  const shell = result.posix ? 'bash' : session?.shell

  return result.paths.map(entry => (session?.activeAgentId ? quoteForAgent(entry) : quotePath(entry, shell))).join(' ')
}

/** Says what a paste did: an image with its preview, where files were copied, or why not. */
export function reportPaste(result: PasteResult, image: boolean) {
  const host = result.host || 'ssh'
  const size = result.bytes ? formatBytes(result.bytes) : ''

  if (result.error) toast(result.where === 'ssh' ? t('{host} 에 올리지 못했습니다: {reason}', { host, reason: result.error }) : result.error, 'error')
  else if (result.where === 'ssh' && image) toast(t('{host} 에 이미지를 올리고 그 경로를 붙여넣었습니다 · {size}', { host, size }), 'info', result.preview)
  else if (result.where === 'ssh') toast(t('{host} 에 파일 {count}개를 올리고 그 경로를 넣었습니다', { host, count: result.paths.length }))
  else if (image) toast(result.where === 'wsl' ? t('이미지를 WSL 경로로 붙여넣었습니다 · {size}', { size }) : t('이미지를 붙여넣었습니다 · {size}', { size }), 'info', result.preview)
}

/** A copy over ssh can take a few seconds: say so when it does. */
async function slowly<T>(work: Promise<T>): Promise<T> {
  const notice = setTimeout(() => toast(t('붙여넣는 중…')), 700)

  try {
    return await work
  } finally {
    clearTimeout(notice)
  }
}

/**
 * Types delivered paths with `type` and says what happened. A copy to a server takes
 * seconds; if the user typed on meanwhile (or pressed Ctrl+C), the paths go to the
 * clipboard instead of into whatever runs there now.
 */
function finishPaste(sessionId: string, result: PasteResult, started: number, image: boolean, type: (text: string) => void) {
  const text = pasteText(result, $sessions.get()[sessionId])

  if (text && result.where === 'ssh' && typedSince(sessionId, started)) {
    void api.copy(text)
    toast(t('올리는 동안 터미널에 입력이 있어서, 경로는 넣지 않고 클립보드에 복사했습니다'))
    return
  }
  if (text) type(text)
  reportPaste(result, image)
}

/** Types local files' paths into a session, as its programs see them (dropped files, the folder tree). */
export async function insertFiles(sessionId: string, files: string[], after = '') {
  const started = Date.now()
  const result = await slowly(api.pasteFiles(sessionId, files)).catch((error: Error): PasteResult => ({ paths: [], where: 'local', posix: false, error: error.message }))

  finishPaste(sessionId, result, started, false, text => writePty(sessionId, text + after))
}

/** The bytes of a `data:image/…;base64,` address (an image dragged out of a page), or null. */
function dataUrlBytes(url: string): Uint8Array | null {
  const match = url.match(/^data:image\/[\w.+-]+;base64,(.+)$/i)

  try {
    return match ? Uint8Array.from(atob(match[1]), char => char.charCodeAt(0)) : null
  } catch {
    return null
  }
}

/** Files dropped on a terminal: from Explorer / Finder, the folder tree, or images out of a browser. */
function dropOn(sessionId: string, data: DataTransfer) {
  // Everything is read now: a DataTransfer is empty once the drop event is over.
  const files = [...data.files]
  const paths = files.map(file => pathForFile(file)).filter(Boolean)
  // An entry dragged from the folder tree (right panel) carries its path as data.
  const fromTree = data.getData('application/x-hera-path')
  if (!paths.length && fromTree) paths.push(fromTree)
  // An image dragged out of a browser has no file on disk: its bytes are saved first.
  const images: Promise<Uint8Array | null>[] = files.filter(file => !pathForFile(file) && file.type.startsWith('image/')).map(async file => new Uint8Array(await file.arrayBuffer()))
  const link = data.getData('text/uri-list').split(/\r?\n/).find(line => line && !line.startsWith('#')) || ''
  if (!paths.length && !images.length && link.startsWith('data:')) images.push(Promise.resolve(dataUrlBytes(link)))

  if (paths.length) void insertFiles(sessionId, paths)
  else if (images.length) {
    const started = Date.now()
    void slowly(Promise.all(images.map(async bytes => {
      const data = await bytes
      return data ? api.pasteImageBytes(sessionId, data).catch(() => null) : null
    }))).then(results => {
      const done = results.filter((result): result is PasteResult => Boolean(result))

      if (done[0]) finishPaste(sessionId, { ...done[0], paths: done.flatMap(result => result.paths), error: done.find(result => result.error)?.error }, started, true, text => writePty(sessionId, text))
    })
  }
  // HERA fetches nothing from the web: an image's address alone is not enough.
  else if (/^https?:/i.test(link)) toast(t('웹 이미지는 복사({shortcut}) 한 뒤 터미널에 붙여넣으세요', { shortcut: isMac ? '⌘C' : 'Ctrl+C' }))
}

export function TerminalView({ sessionId, focused, onFocus }: { sessionId: string; focused: boolean; onFocus?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const config = useStore($config)
  const session = useStore($sessions)[sessionId]
  const sessionRef = useRef(session)
  sessionRef.current = session
  const settings = config?.settings
  const palette = useStore($terminalPalette)
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  // Presets let xterm lift unreadable program colors; a hand-made theme keeps its exact colors (mostly).
  const contrast = useStore($theme)?.custom ? 3 : 4.5
  const contrastRef = useRef(contrast)
  contrastRef.current = contrast
  const zoom = useStore($termZoom)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const refitRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const element = host.current

    if (!element || !settings) return

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize + zoomRef.current,
      lineHeight: settings.lineHeight,
      scrollback: Math.min(settings.scrollback, 5000),
      allowProposedApi: true,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      macOptionIsMeta: true,
      minimumContrastRatio: contrastRef.current,
      theme: paletteRef.current || undefined,
      rightClickSelectsWord: false,
      // The same as the headless copy in main (pty-host.ts), so both reflow alike on resize.
      windowsPty: isWin ? { backend: 'conpty', buildNumber: osBuild || undefined } : undefined
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
    term.open(element)

    let webgl: WebglAddon | null = null
    let unmounted = false

    // Only GPU mode uses the WebGL renderer, so its code loads on demand.
    if (settings.gpu) {
      void import('@xterm/addon-webgl')
        .then(({ WebglAddon: Addon }) => {
          if (unmounted) return
          const addon = new Addon()
          addon.onContextLoss(() => {
            addon.dispose()
            if (webgl === addon) webgl = null
          })
          term.loadAddon(addon)
          webgl = addon
        })
        .catch(() => undefined)
    }

    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      if (isAppChord(event)) return false

      const key = event.key.toLowerCase()

      if (!isMac && event.ctrlKey && key === 'c' && (event.shiftKey || term.hasSelection())) {
        void api.copy(term.getSelection())
        term.clearSelection()

        return false
      }

      if (!isMac && event.ctrlKey && key === 'v') {
        // Pasted here only: left alone, the browser's own paste would type it a second time.
        event.preventDefault()
        void api.paste().then(async text => {
          if (text) return term.paste(text)
          if (await pasteImage()) return
          // Nothing HERA can paste: an agent CLI may read the clipboard itself on Ctrl+V.
          if (!event.shiftKey && sessionRef.current?.activeAgentId) writePty(sessionId, '\x16')
        })

        return false
      }

      return true
    })

    /**
     * An image on the clipboard is saved as a file and its path pasted (agent CLIs attach
     * it); in a WSL or ssh tab, a path the program there can open.
     */
    const pasteImage = async () => {
      const started = Date.now()
      const result = await slowly(api.pasteImage(sessionId)).catch(() => null)

      if (!result) return false

      finishPaste(sessionId, result, started, true, text => term.paste(text))

      return true
    }
    // macOS pastes through the Edit menu: xterm takes the text itself, an image is handled here.
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData

      if (!data || data.getData('text/plain') || ![...data.items].some(item => item.type.startsWith('image/'))) return
      // Stop it here: xterm would send an empty paste, and Claude Code answers that by reading
      // the clipboard image itself, so the image arrived twice ([Image #1] [Image #2]).
      event.preventDefault()
      event.stopImmediatePropagation()
      void pasteImage()
    }

    if (isMac) element.addEventListener('paste', onPaste, true)

    term.onData(data => writePty(sessionId, data))
    registerTerminal(sessionId, term)
    termRef.current = term

    let lastCols = 0
    let lastRows = 0
    let frame = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined

    // The pty follows once the size settles: every ConPTY resize repaints the whole
    // screen, and a dragged divider or window edge would send dozens of them.
    const sendSize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (term.cols === lastCols && term.rows === lastRows) return
        lastCols = term.cols
        lastRows = term.rows
        void api.resize(sessionId, term.cols, term.rows)
      }, 80)
    }

    const refit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!element.offsetWidth || !element.offsetHeight) return

        try {
          fit.fit()
        } catch {
          return
        }

        sendSize()
      })
    }

    const observer = new ResizeObserver(refit)
    observer.observe(element)
    refitRef.current = refit

    // Ctrl / ⌘ + wheel (and a trackpad pinch, which arrives as Ctrl + wheel) zooms instead of scrolling.
    let wheelZoom = 0
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || (isMac && event.metaKey))) return
      event.preventDefault()
      event.stopPropagation()
      wheelZoom += event.deltaY
      if (Math.abs(wheelZoom) < (event.deltaMode === 0 ? 60 : 1)) return
      zoomTerminals(wheelZoom < 0 ? 1 : -1)
      wheelZoom = 0
    }
    element.addEventListener('wheel', onWheel, { capture: true, passive: false })

    // Size first, then attach so the snapshot is serialized at our size.
    let disposed = false
    const attachFrame = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        // not laid out yet
      }

      lastCols = term.cols
      lastRows = term.rows
      void api.resize(sessionId, term.cols, term.rows).then(() => {
        if (!disposed) void api.attach(sessionId)
      })
    })

    return () => {
      disposed = true
      unmounted = true
      cancelAnimationFrame(attachFrame)
      cancelAnimationFrame(frame)
      clearTimeout(resizeTimer)
      observer.disconnect()
      element.removeEventListener('paste', onPaste, true)
      element.removeEventListener('wheel', onWheel, true)
      refitRef.current = null
      void api.detach(sessionId)
      unregisterTerminal(sessionId, term)
      webgl?.dispose()
      term.dispose()
      termRef.current = null
    }
    // Recreate on appearance-affecting settings only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, settings?.fontFamily, settings?.fontSize, settings?.lineHeight, settings?.gpu])

  // Zoom changes the font size in place, then the grid refits and the pty follows.
  useEffect(() => {
    const term = termRef.current
    if (!term || !settings) return
    term.options.fontSize = settings.fontSize + zoom
    refitRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // Colors change in place — no re-attach, no lost scroll position.
  useEffect(() => {
    if (termRef.current && palette) termRef.current.options.theme = palette
  }, [palette])

  useEffect(() => {
    if (termRef.current) termRef.current.options.minimumContrastRatio = contrast
  }, [contrast])

  useEffect(() => {
    if (!termRef.current || !settings) return
    termRef.current.options.cursorStyle = settings.cursorStyle
    termRef.current.options.cursorBlink = settings.cursorBlink
  }, [settings?.cursorStyle, settings?.cursorBlink])

  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  const exited = session && (session.status === 'exited' || session.dormant)

  return (
    <div
      className="relative h-full min-h-0 w-full bg-(--term-bg)"
      onMouseDown={onFocus}
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault()
        dropOn(sessionId, event.dataTransfer)
      }}
    >
      <div ref={host} className="absolute inset-0" />
      {exited && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated)/95 px-4 py-2 text-[12.5px]">
          <span className="text-(--ui-text-secondary)">
            {session.dormant ? t('이전 실행에서 복원된 세션입니다.') : t('세션이 종료되었습니다 (code {code}).', { code: session.exitCode ?? '?' })}
          </span>
          <div className="flex gap-2">
            {session.agentId && (
              <Button size="sm" variant="default" onClick={() => void api.revive(sessionId, true)}>
                <IconPlayerPlay /> {t('이어하기')}
              </Button>
            )}
            <Button size="sm" onClick={() => void api.revive(sessionId, false)}>
              <IconRefresh /> {t('다시 시작')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
