import * as RadixSlider from '@radix-ui/react-slider'
import * as RadixSwitch from '@radix-ui/react-switch'
import * as RadixTabs from '@radix-ui/react-tabs'
import { clsx, type ClassValue } from 'clsx'
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-teal text-ink hover:bg-[#3fe3d5] disabled:bg-line-2 disabled:text-fg-3',
  secondary: 'border border-line-2 text-fg hover:border-fg-3 hover:bg-panel disabled:text-fg-3 disabled:hover:border-line-2 disabled:hover:bg-transparent',
  ghost: 'text-fg-2 hover:bg-panel hover:text-fg disabled:text-fg-3 disabled:hover:bg-transparent',
  danger: 'border border-err/60 text-err hover:bg-err/10',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'primary', loading, icon, size = 'md', className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-[3px] font-mono font-medium uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed',
        size === 'sm' && 'h-8 px-3 text-[11px]',
        size === 'md' && 'h-10 px-4 text-[12px]',
        size === 'lg' && 'h-12 px-6 text-[13px]',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

/** Small mono label with an optional index, e.g. "01.A  CARRIER". */
export function Eyebrow({ index, children, tone = 'fg-3', className }: { index?: string; children: ReactNode; tone?: 'fg-3' | 'teal' | 'blue' | 'ok' | 'warn' | 'err'; className?: string }) {
  const tones = { 'fg-3': 'text-fg-3', teal: 'text-teal', blue: 'text-blue', ok: 'text-ok', warn: 'text-warn', err: 'text-err' }
  return (
    <div className={cn('flex items-baseline gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em]', tones[tone], className)}>
      {index && <span className="text-fg-3">{index}</span>}
      <span>{children}</span>
    </div>
  )
}

/** A hairline-topped section — the basic unit of hierarchy instead of a boxed card. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('border-t border-line pt-5', className)} {...rest} />
}

export function CardTitle({ icon, title, hint, right }: { icon?: ReactNode; title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-medium text-fg">
          {icon && <span className="text-teal">{icon}</span>}
          {title}
        </h3>
        {hint && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

export function Badge({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center gap-1 rounded-[2px] border border-line-2 px-1.5 py-px font-mono text-[11px] text-fg-2', className)} {...rest} />
}

interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  label: string
  format?: (v: number) => string
  disabled?: boolean
}

export function Slider({ value, min, max, step = 1, onChange, label, format, disabled }: SliderProps) {
  return (
    <div className={cn('space-y-2', disabled && 'opacity-45')}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-fg-2">{label}</span>
        <span className="font-mono text-teal">{format ? format(value) : value}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
      >
        <RadixSlider.Track className="relative h-px grow bg-line-2">
          <RadixSlider.Range className="absolute h-full bg-teal" />
        </RadixSlider.Track>
        <RadixSlider.Thumb aria-label={label} className="block h-4 w-2 rounded-[1px] bg-fg outline-offset-4 transition-colors hover:bg-teal" />
      </RadixSlider.Root>
    </div>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', disabled && 'cursor-not-allowed opacity-45')}>
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-fg-3">{hint}</span>}
      </span>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-[2px] border border-line-2 bg-bg transition-colors data-[state=checked]:border-teal data-[state=checked]:bg-teal/15"
      >
        <RadixSwitch.Thumb className="block size-3 translate-x-[3px] rounded-[1px] bg-fg-3 transition-transform data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-teal" />
      </RadixSwitch.Root>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex border border-line-2', disabled && 'opacity-45')}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors',
            i > 0 && 'border-l border-line-2',
            value === o.value ? 'bg-teal/15 text-teal' : 'text-fg-2 hover:bg-panel hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const Tabs = RadixTabs.Root

export function TabsList({ tabs, label }: { tabs: { value: string; label: string; icon?: ReactNode }[]; label?: string }) {
  return (
    <RadixTabs.List aria-label={label} className="mb-6 flex gap-6 border-b border-line">
      {tabs.map((t) => (
        <RadixTabs.Trigger
          key={t.value}
          value={t.value}
          className="-mb-px inline-flex items-center gap-2 border-b-2 border-transparent pb-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-fg-3 transition-colors hover:text-fg data-[state=active]:border-teal data-[state=active]:text-fg"
        >
          {t.icon}
          {t.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  )
}

export const TabsContent = RadixTabs.Content

type Tone = 'teal' | 'blue' | 'ok' | 'warn' | 'err' | 'fg'
const TONE_TEXT: Record<Tone, string> = { teal: 'text-teal', blue: 'text-blue', ok: 'text-ok', warn: 'text-warn', err: 'text-err', fg: 'text-fg' }

/** A measured value: small caps label, large tabular number. Only ever fed computed data. */
export function Metric({ label, value, unit, hint, tone = 'fg' }: { label: string; value: string; unit?: string; hint?: string; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-3">{label}</div>
      <div className={cn('mt-1 font-mono text-[22px] leading-none', TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1 text-[12px] text-fg-3">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[12px] leading-snug text-fg-3">{hint}</div>}
    </div>
  )
}

/** Key/value row for technical annotations. */
export function Readout({ label, value, tone = 'fg' }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-1.5 last:border-b-0">
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right font-mono text-[12px]', TONE_TEXT[tone])}>{value}</dd>
    </div>
  )
}

export function Notice({ tone, title, children, className }: { tone: 'error' | 'warning' | 'ok' | 'info'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = {
    error: { Icon: CircleAlert, bar: 'border-err', icon: 'text-err' },
    warning: { Icon: TriangleAlert, bar: 'border-warn', icon: 'text-warn' },
    ok: { Icon: CircleCheck, bar: 'border-ok', icon: 'text-ok' },
    info: { Icon: Info, bar: 'border-blue', icon: 'text-blue' },
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('flex items-start gap-3 border-l-2 bg-bg-2 py-2.5 pl-3 pr-4 text-[13px] leading-relaxed text-fg-2', t.bar, className)}>
      <t.Icon className={cn('mt-0.5 size-4 shrink-0', t.icon)} aria-hidden="true" />
      <div className="min-w-0">
        {title && <div className="font-medium text-fg">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  )
}

export function fmtDb(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞'
  return v.toFixed(digits).replace('-', '−')
}

export function fmtMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString('en-US')
}
