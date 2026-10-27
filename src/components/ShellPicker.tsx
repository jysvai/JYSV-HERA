import { useEffect, useState } from 'react'

import { api } from '../lib/hera'
import { Input, Select } from './ui/primitives'

const CUSTOM = '__custom__'
let cached: { value: string; label: string }[] | null = null

/**
 * Shell choice: 'auto', a shell this PC has (PowerShell, pwsh, cmd, Git Bash, WSL,
 * bash, zsh, fish), or a command line typed in full (`wsl.exe -d Ubuntu`,
 * `C:\tools\nu.exe`, a VS developer prompt).
 */
export function ShellPicker({ value, onChange, autoLabel, className }: { value: string; onChange: (next: string) => void; autoLabel: string; className?: string }) {
  const [shells, setShells] = useState(cached || [])
  const known = value === 'auto' || shells.some(shell => shell.value === value)
  const [custom, setCustom] = useState(!known)
  const [text, setText] = useState(known ? '' : value)

  useEffect(() => {
    if (cached) return
    void api
      .shells()
      .then(list => {
        cached = list
        setShells(list)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const isKnown = value === 'auto' || shells.some(shell => shell.value === value)
    if (!isKnown) {
      setCustom(true)
      setText(value)
    }
  }, [value, shells])

  const commit = () => {
    const next = text.trim()
    if (next && next !== value) onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={custom ? CUSTOM : value}
        onChange={event => {
          if (event.target.value === CUSTOM) {
            setCustom(true)
            setText(known ? '' : value)
          } else {
            setCustom(false)
            onChange(event.target.value)
          }
        }}
        className={className}
      >
        <option value="auto">{autoLabel}</option>
        {shells.map(shell => (
          <option key={shell.value} value={shell.value}>
            {shell.label}
          </option>
        ))}
        <option value={CUSTOM}>직접 입력 (명령줄)…</option>
      </Select>
      {custom && (
        <Input
          value={text}
          onChange={event => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={event => event.key === 'Enter' && commit()}
          placeholder="예: wsl.exe -d Ubuntu"
          className={`${className || ''} font-mono text-[12px]`}
          spellCheck={false}
        />
      )}
    </div>
  )
}
