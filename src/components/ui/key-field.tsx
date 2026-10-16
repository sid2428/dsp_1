import { Eye, EyeOff } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './primitives'

interface KeyFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  trailing?: ReactNode
}

/** Passphrase input with a show/hide toggle. Never autocompleted, autocorrected or spell-checked. */
export function KeyField({ id, label, value, onChange, placeholder, invalid, describedBy, onKeyDown, autoFocus, trailing }: KeyFieldProps) {
  const [shown, setShown] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">
        {label}
      </label>
      <div className="flex flex-wrap items-stretch gap-2">
        <div className={cn('flex min-w-0 grow items-center border-b bg-transparent transition-colors focus-within:border-teal', invalid ? 'border-err' : 'border-line-2')}>
          <input
            id={id}
            type={shown ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={autoFocus}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-11 min-w-0 grow bg-transparent font-mono text-[15px] tracking-wide text-fg outline-none placeholder:text-fg-3/70"
          />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-pressed={shown}
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            title={shown ? 'Hide' : 'Show'}
            className="grid size-9 shrink-0 place-items-center text-fg-3 transition-colors hover:text-fg"
          >
            {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        {trailing}
      </div>
    </div>
  )
}
