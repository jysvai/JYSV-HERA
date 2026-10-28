import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/cn'

/** Anchored popover menu (portal). Closes on outside click and Escape. */
export function Menu({
  trigger,
  children,
  align = 'start',
  width = 260
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const rect = anchor.current.getBoundingClientRect()
    const left = align === 'end' ? rect.right - width : rect.left
    // Open upwards when it does not fit below (a to-do near the bottom of the window).
    const height = panel.current?.offsetHeight ?? 0
    const below = rect.bottom + 4
    const above = rect.top - 4 - height
    const top = below + height > window.innerHeight - 8 && above >= 8 ? above : Math.max(8, Math.min(below, window.innerHeight - 8 - height))
    setPosition({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) })
  }, [open, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)

    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger({ open, toggle: () => setOpen(value => !value) })}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="fixed z-(--z-over-modal) max-h-[70vh] overflow-auto rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-1 shadow-md"
            style={{ top: position.top, left: position.left, width }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{children}</div>
}

export function MenuItem({
  children,
  onSelect,
  hint,
  disabled,
  className
}: {
  children: ReactNode
  onSelect: () => void
  hint?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-(--ui-text-primary) hover:bg-(--chrome-action-hover) disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-(--ui-text-tertiary)">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-(--ui-stroke-tertiary)" />
}
