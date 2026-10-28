// One primitive per concern (Hermes DESIGN.md): Button, Badge, Input, Textarea,
// Switch, SegmentedControl, Dialog, Tip, EmptyState, Section, Kbd.
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/cn'

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'text' | 'destructive'
type ButtonSize = 'default' | 'sm' | 'xs' | 'icon' | 'icon-sm' | 'icon-xs'

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-(--ui-accent) text-(--ui-accent-fg) hover:brightness-110 font-medium',
  secondary: 'bg-(--ui-bg-quaternary) text-(--ui-text-primary) hover:bg-(--chrome-action-hover)',
  ghost: 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)',
  outline: 'ring-1 ring-inset ring-(--ui-stroke-secondary) text-(--ui-text-primary) hover:bg-(--chrome-action-hover)',
  text: 'text-(--ui-text-secondary) hover:text-(--ui-text-primary)',
  destructive: 'bg-(--status-waiting)/15 text-(--status-waiting) hover:bg-(--status-waiting)/25'
}

const SIZES: Record<ButtonSize, string> = {
  default: 'h-8 px-3 gap-1.5 rounded-md text-[13px] [&_svg]:size-4',
  sm: 'h-7 px-2.5 gap-1.5 rounded-md text-[12px] [&_svg]:size-3.5',
  xs: 'h-6 px-2 gap-1 rounded text-[11.5px] [&_svg]:size-3.5',
  icon: 'size-8 rounded-md [&_svg]:size-4',
  'icon-sm': 'size-7 rounded [&_svg]:size-4',
  'icon-xs': 'size-6 rounded [&_svg]:size-3.5'
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'secondary', size = 'default', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-100 disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
}

export function Badge({ className, tone = 'muted', ...props }: ComponentProps<'span'> & { tone?: 'muted' | 'accent' | 'warn' | 'danger' | 'ok' }) {
  const tones = {
    muted: 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary)',
    accent: 'bg-(--ui-accent)/15 text-(--ui-accent-text)',
    warn: 'bg-(--status-busy)/15 text-(--status-busy)',
    danger: 'bg-(--status-waiting)/15 text-(--status-waiting)',
    ok: 'bg-(--status-idle)/15 text-(--status-idle)'
  }

  return <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] leading-4 font-medium', tones[tone], className)} {...props} />
}

const CONTROL = 'w-full rounded-md bg-(--ui-bg-input) px-2.5 text-[13px] text-(--ui-text-primary) ring-1 ring-inset ring-(--ui-stroke-secondary) placeholder:text-(--ui-text-tertiary) focus:ring-(--ui-accent)/60 focus:outline-none disabled:cursor-not-allowed disabled:bg-(--ui-bg-quaternary) disabled:text-(--ui-text-secondary)'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'h-8', className)} spellCheck={false} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-20 resize-y py-2 leading-relaxed', className)} spellCheck={false} {...props} />
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(CONTROL, 'h-8 pr-6', className)} {...props}>
      {children}
    </select>
  )
}

/** Borderless, underline-on-focus search (the only search field). */
export function SearchField({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-7 w-full border-b border-transparent bg-transparent px-1 text-[13px] text-(--ui-text-primary) placeholder:text-(--ui-text-tertiary) focus:border-(--ui-accent)/60 focus:outline-none',
        className
      )}
      spellCheck={false}
      {...props}
    />
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-100', checked ? 'bg-(--ui-accent)' : 'bg-(--ui-stroke-primary)')}
    >
      <span className={cn('absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-[left] duration-100', checked ? 'left-[16px]' : 'left-[2px]')} />
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="inline-flex rounded-md bg-(--ui-bg-quaternary) p-0.5">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'h-6 rounded px-2.5 text-[12px] transition-colors duration-100',
            option.value === value ? 'bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-sm' : 'text-(--ui-text-secondary) hover:text-(--ui-text-primary)'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus()

    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal-backdrop) flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="z-(--z-modal) flex max-h-[76vh] flex-col rounded-xl border border-(--stroke-nous) bg-(--ui-bg-elevated) shadow-nous"
        style={{ width }}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2 text-[15px] font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-(--ui-stroke-tertiary) px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/** Tooltip only where hover teaches something new. */
export function Tip({ label, children, side = 'bottom' }: { label: ReactNode; children: ReactNode; side?: 'bottom' | 'top' | 'right' | 'left' }) {
  const position = {
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5'
  }[side]

  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-(--z-over-modal) whitespace-nowrap rounded-md border border-(--stroke-nous) bg-(--ui-bg-elevated) px-2 py-1 text-[11.5px] text-(--ui-text-primary) opacity-0 shadow-nous transition-opacity delay-300 duration-100 group-hover/tip:opacity-100',
          position
        )}
      >
        {label}
      </span>
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-(--ui-stroke-secondary) px-1 font-mono text-[10.5px] text-(--ui-text-tertiary)">{children}</kbd>
}

export function EmptyState({ icon, title, description, children }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {icon && <div className="text-(--ui-text-tertiary) [&_svg]:size-9">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {description && <div className="max-w-md text-[12.5px] leading-relaxed text-(--ui-text-secondary)">{description}</div>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('py-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-(--ui-text-tertiary) uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-4">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[12.5px] text-(--ui-text-secondary)">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span className={cn('status-dot', `status-${status}`, className)} aria-label={status} />
}

export function Row({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {description && <div className="mt-0.5 text-[11.5px] leading-relaxed text-(--ui-text-tertiary)">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
