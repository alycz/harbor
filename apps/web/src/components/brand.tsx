import { TabsList, TabsTrigger } from '@harbor/ui/components/tabs';
import type { ReactNode } from 'react';

/** The small cobalt label that opens a section. On an ink band it turns sky blue. */
export function Eyebrow({
  children,
  onBand = false,
  className = 'mb-6',
}: {
  children: ReactNode;
  onBand?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`text-xs font-medium tracking-[0.6px] uppercase ${onBand ? 'text-sky' : 'text-primary'} ${className}`}
    >
      ■ {children}
    </p>
  );
}

/** A faint scanline texture for ink bands. */
export function Scanlines() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_4px,var(--harbor-band-text)_4px_5px)] opacity-[0.06]"
    />
  );
}

/** An ink section with paper text and the scanline texture. */
export function Band({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-band text-band-foreground ${className}`}>
      <Scanlines />
      <div className="relative">{children}</div>
    </div>
  );
}

/**
 * A ruled panel: a label row over its content, like the figure on the landing page. `aside` sits at
 * the right of the label row, for a status or a count.
 */
export function Panel({
  label,
  aside,
  children,
  className = '',
  bodyClassName = 'p-5',
  labelId,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelId?: string;
}) {
  return (
    <section aria-labelledby={labelId} className={`min-w-0 border border-line bg-card ${className}`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-2.5 text-[11px] font-medium tracking-[0.6px] uppercase">
        <h2 id={labelId} className="font-sans text-[11px] font-medium">
          {label}
        </h2>
        {aside ? <div className="text-primary">{aside}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A label and value on one ruled row. Values are tabular so columns of numbers line up. */
export function FactRow({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums [overflow-wrap:anywhere]" title={title}>
        {value}
      </dd>
    </div>
  );
}

/** Section tabs: uppercase labels on a rule, underlined in the accent like the primary nav. */
export function LineTabsList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <TabsList variant="line" aria-label={label} className="h-auto w-full justify-start gap-7 border-b border-line p-0">
      {children}
    </TabsList>
  );
}

export function LineTab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 flex-none px-0 text-xs tracking-[0.6px] text-muted-foreground uppercase after:bg-primary hover:text-primary data-active:text-primary group-data-horizontal/tabs:after:-bottom-px"
    >
      {children}
    </TabsTrigger>
  );
}
