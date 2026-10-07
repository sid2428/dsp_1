import * as RadixSlider from '@radix-ui/react-slider'
import * as RadixSwitch from '@radix-ui/react-switch'
import * as RadixTabs from '@radix-ui/react-tabs'
import { clsx, type ClassValue } from 'clsx'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-cyan-400 to-violet-400 text-ink-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 disabled:from-slate-600 disabled:to-slate-600 disabled:text-slate-300 disabled:shadow-none',
  secondary: 'bg-white/5 text-slate-100 ring-1 ring-white/10 hover:bg-white/10',
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
  danger: 'bg-rose-500/90 text-white hover:bg-rose-500',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'primary', loading, icon, size = 'md', className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-white/10 bg-ink-900/70 p-5 shadow-xl shadow-black/30 backdrop-blur', className)}
      {...rest}
    />
  )
}

export function CardTitle({ icon, title, hint, right }: { icon?: ReactNode; title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 rounded-lg bg-white/5 p-2 text-cyan-300 ring-1 ring-white/10">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold tracking-wide text-white">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function Badge({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-slate-300 ring-1 ring-white/10', className)}
      {...rest}
    />
  )
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
    <div className={cn('space-y-2', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-cyan-300">{format ? format(value) : value}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      >
        <RadixSlider.Track className="relative h-1.5 grow rounded-full bg-white/10">
          <RadixSlider.Range className="absolute h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block size-4 rounded-full bg-white shadow ring-4 ring-cyan-400/30" />
      </RadixSlider.Root>
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-slate-300">
      {label}
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-5 w-9 rounded-full bg-white/10 transition data-[state=checked]:bg-cyan-400"
      >
        <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-[18px]" />
      </RadixSwitch.Root>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            value === o.value ? 'bg-cyan-400 text-ink-950' : 'text-slate-300 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const Tabs = RadixTabs.Root

export function TabsList({ tabs }: { tabs: { value: string; label: string; icon?: ReactNode }[] }) {
  return (
    <RadixTabs.List className="mb-4 inline-flex gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
      {tabs.map((t) => (
        <RadixTabs.Trigger
          key={t.value}
          value={t.value}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 transition data-[state=active]:bg-white/10 data-[state=active]:text-white"
        >
          {t.icon}
          {t.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  )
}

export const TabsContent = RadixTabs.Content

export function Metric({ label, value, unit, hint, tone = 'cyan' }: { label: string; value: string; unit?: string; hint?: string; tone?: 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber' }) {
  const tones = {
    cyan: 'text-cyan-300',
    violet: 'text-violet-300',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
  }
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl font-semibold', tones[tone])}>
        {value}
        {unit && <span className="ml-1 text-sm text-slate-400">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div>}
    </div>
  )
}

export function fmtDb(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞'
  return v.toFixed(digits)
}
