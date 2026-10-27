import { useStore } from '@nanostores/react'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useEffect, useRef } from 'react'

import { Button } from '../../components/ui/primitives'
import { api, isMac, isWin, osBuild, pathForFile, writePty } from '../../lib/hera'
import { $config, $sessions } from '../../store/app'
import { $terminalPalette, $theme } from '../../store/theme'
import { registerTerminal, unregisterTerminal } from './registry'

/** App-level chords the terminal must hand back to the window (not to the shell). */
export function isAppChord(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey && event.shiftKey
  const key = event.key.toLowerCase()

  if (isMac && event.metaKey && ['k', 't', 'w', 'b', 'u', 'j', ','].includes(key)) return true
  if (!isMac && mod && ['p', 't', 'w', 'b', 'u', 'j', 'e'].includes(key)) return true
  if (event.ctrlKey && key === 'tab') return true
  if (event.altKey && !event.ctrlKey && /^[1-9]$/.test(event.key)) return true

  return false
}

/** Quote a dropped path for the session's shell (PowerShell expands `$` inside "…"). */
function quotePath(p: string, shell: string | undefined) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(p)) return p

  if (shell === 'powershell' || shell === 'pwsh') return `'${p.replace(/['\u2018\u2019\u201A\u201B]/g, quote => quote + quote)}'`
  if (shell === 'cmd') return `"${p.replace(/"/g, '')}"`

  return `'${p.replace(/'/g, "'\\''")}'`
}

/** Agent prompts take a path as a terminal drop types it: bare, or in double quotes. */
function quoteForAgent(p: string) {
  return /^[A-Za-z0-9_./:\\-]+$/.test(p) ? p : `"${p}"`
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

  useEffect(() => {
    const element = host.current

    if (!element || !settings) return

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
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

    /** An image on the clipboard is saved as a file and its path pasted (agent CLIs attach it). */
    const pasteImage = async () => {
      const image = await api.pasteImage().catch(() => null)
      const session = sessionRef.current

      if (image) term.paste(session?.activeAgentId ? quoteForAgent(image) : quotePath(image, session?.shell))

      return Boolean(image)
    }
    // macOS pastes through the Edit menu: xterm takes the text itself, an image is handled here.
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData

      if (!data || data.getData('text/plain') || ![...data.items].some(item => item.type.startsWith('image/'))) return
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
      void api.detach(sessionId)
      unregisterTerminal(sessionId, term)
      webgl?.dispose()
      term.dispose()
      termRef.current = null
    }
    // Recreate on appearance-affecting settings only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, settings?.fontFamily, settings?.fontSize, settings?.lineHeight, settings?.gpu])

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
        const paths = [...event.dataTransfer.files].map(file => pathForFile(file)).filter(Boolean)

        if (paths.length) writePty(sessionId, paths.map(entry => quotePath(entry, session?.shell)).join(' '))
      }}
    >
      <div ref={host} className="absolute inset-0" />
      {exited && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated)/95 px-4 py-2 text-[12.5px]">
          <span className="text-(--ui-text-secondary)">
            {session.dormant ? '이전 실행에서 복원된 세션입니다.' : `세션이 종료되었습니다 (code ${session.exitCode ?? '?'}).`}
          </span>
          <div className="flex gap-2">
            {session.agentId && (
              <Button size="sm" variant="default" onClick={() => void api.revive(sessionId, true)}>
                <IconPlayerPlay /> 이어하기
              </Button>
            )}
            <Button size="sm" onClick={() => void api.revive(sessionId, false)}>
              <IconRefresh /> 다시 시작
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
