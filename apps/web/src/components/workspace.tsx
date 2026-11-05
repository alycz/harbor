import { TabsIndicator, TabsList, TabsTrigger } from '@harbor/ui/components/tabs';
import type { ReactNode } from 'react';

/*
 * The workspace's building blocks, in Pilot's and Royco's grammar: paper, off-white cards with soft
 * corners and hairlines, sentence-case labels, one cobalt accent, and the ink hero card for the one
 * place a page spends its emphasis. Tokens live in styles/workspace.css.
 */

/** A page's title block: a small label, a serif title, one paragraph, and actions to the right. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** A line under the description, such as when the data was captured. */
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="font-display text-[30px] leading-[1.12] text-foreground @xl/workspace:text-[34px]">{title}</h1>
        {description ? (
          <p className="mt-2.5 max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <div className="mt-3">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}

export type HeroStat = { label: string; value: ReactNode; title?: string };

/**
 * Royco's ink hero card: a serif statement on the left and the page's few headline figures on the
 * right, each on its own hairline. One per page, where the page spends its emphasis.
 */
export function HeroCard({
  title,
  description,
  stats,
  actions,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  stats: HeroStat[];
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="ws-hero" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex flex-col gap-7 px-5 py-6 @xl/workspace:px-8 @xl/workspace:py-8 @4xl/workspace:flex-row @4xl/workspace:items-end @4xl/workspace:justify-between @4xl/workspace:gap-12">
        <div className="min-w-0 max-w-2xl @4xl/workspace:min-w-[22rem] @4xl/workspace:flex-1">
          <h1 className="font-display text-[28px] leading-[1.12] text-band-foreground @xl/workspace:text-[34px] @5xl/workspace:text-[38px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[var(--ws-band-muted)]">{description}</p>
          ) : null}
          {actions ? <div className="mt-6 flex flex-wrap items-center gap-2.5">{actions}</div> : null}
        </div>
        <dl className="grid min-w-0 shrink-0 border-t border-[var(--ws-band-rule)] @xl/workspace:grid-cols-3 @xl/workspace:pt-5 @4xl/workspace:flex @4xl/workspace:border-t-0 @4xl/workspace:pt-0">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-baseline justify-between gap-6 border-b border-[var(--ws-band-rule)] py-3 last:border-b-0 @xl/workspace:flex-col-reverse @xl/workspace:items-start @xl/workspace:justify-end @xl/workspace:gap-1 @xl/workspace:border-b-0 @xl/workspace:border-l @xl/workspace:py-0 @xl/workspace:pl-5 @xl/workspace:first:border-l-0 @xl/workspace:first:pl-0 @4xl/workspace:items-end @4xl/workspace:pl-7 @4xl/workspace:[&+&]:ml-7"
            >
              <dt className="text-[12.5px] whitespace-nowrap text-[var(--ws-band-muted)]">{stat.label}</dt>
              <dd
                className="ws-num text-[17px] font-medium tracking-[-0.01em] whitespace-nowrap text-band-foreground @xl/workspace:text-[24px] @xl/workspace:leading-none @4xl/workspace:text-[27px]"
                title={stat.title}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {footer ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--ws-band-rule)] px-5 py-3 text-[12.5px] text-[var(--ws-band-muted)] @xl/workspace:px-8">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** A section heading over a card, as Royco's "Markets · 6 markets · $7.54M TVL". */
export function SectionTitle({
  id,
  title,
  meta,
  actions,
}: {
  id?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h2 id={id} className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-[17px] font-medium">
        {title}
        {meta ? <span className="text-[13px] font-normal text-muted-foreground">{meta}</span> : null}
      </h2>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A card with an optional header row: a title, an icon, and a status or count at the right. `bodyClassName`
 * sets the content's padding; tables and grids pass `p-0` and run to the card's edges.
 */
export function Panel({
  label,
  icon,
  aside,
  children,
  className = '',
  bodyClassName = 'p-5',
  labelId,
}: {
  label?: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelId?: string;
}) {
  return (
    <section aria-labelledby={label ? labelId : undefined} className={`ws-card overflow-hidden ${className}`}>
      {label ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3">
          <h2 id={labelId} className="flex items-center gap-2 text-[14px] font-medium">
            {icon ? (
              <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-4">
                {icon}
              </span>
            ) : null}
            {label}
          </h2>
          {aside ? <div className="text-[12.5px] text-muted-foreground">{aside}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A label and its value on one line. Values are tabular so columns of numbers line up. */
export function FactRow({ label, value, title }: { label: ReactNode; value: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 last:border-b-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="ws-num min-w-0 text-right text-[13.5px] font-medium [overflow-wrap:anywhere]" title={title}>
        {value}
      </dd>
    </div>
  );
}

/** A small figure: label over value, as the KPI row on Royco's market page. */
export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="ws-label">{label}</dt>
      <dd className="ws-num mt-1 truncate text-[16px] font-medium tracking-[-0.01em]" title={title}>
        {value}
      </dd>
    </div>
  );
}

/** Underline tabs: sentence-case labels on a rule, with an ink bar that slides between them. */
export function LineTabsList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <TabsList
      variant="line"
      aria-label={label}
      className="relative h-auto w-full justify-start gap-6 overflow-x-auto overflow-y-hidden border-b border-border p-0 [scrollbar-width:none]"
    >
      {children}
      <TabsIndicator className="bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-foreground transition-[translate,width] duration-[360ms] ease-[cubic-bezier(0.45,0,0.1,1)] motion-reduce:transition-none" />
    </TabsList>
  );
}

export function LineTab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 flex-none rounded-none border-0 px-0.5 text-[14px] font-normal text-muted-foreground transition-colors duration-150 after:hidden hover:text-foreground focus-visible:ring-0 data-active:text-foreground"
    >
      {children}
    </TabsTrigger>
  );
}

/** Royco's segmented control: a sand track with a raised pill that slides to the choice. */
export function SegmentedList({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <TabsList
      aria-label={label}
      className={`relative h-9 gap-0 rounded-lg border border-border bg-secondary p-[3px] ${className}`}
    >
      <TabsIndicator className="top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-card shadow-[0_1px_2px_rgb(23_25_31/0.08)] ring-1 ring-border transition-[translate,width] duration-[320ms] ease-[cubic-bezier(0.45,0,0.1,1)] motion-reduce:transition-none" />
      {children}
    </TabsList>
  );
}

export function Segment({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="z-[1] h-full flex-none rounded-md border-0 px-3 text-[13px] font-medium text-muted-foreground transition-colors duration-150 after:hidden hover:text-foreground focus-visible:ring-0 data-active:bg-transparent data-active:text-foreground data-active:shadow-none"
    >
      {children}
    </TabsTrigger>
  );
}

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'border-border-strong/80 bg-secondary/60 text-muted-foreground [--dot:var(--harbor-text-muted)]',
  accent:
    'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)] [--dot:var(--harbor-accent)]',
  success: 'border-success/25 bg-success/8 text-success [--dot:var(--harbor-success)]',
  warning: 'border-warning/25 bg-warning/8 text-warning [--dot:var(--harbor-warning)]',
  danger: 'border-destructive/25 bg-destructive/8 text-destructive [--dot:var(--harbor-error)]',
};

/** A small rounded status label, coloured by meaning only. */
export function Chip({
  tone = 'neutral',
  dot = false,
  children,
  className = '',
}: {
  tone?: ChipTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[5px] border px-1.5 text-[12px] leading-none font-medium whitespace-nowrap ${CHIP_TONES[tone]} ${className}`}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-(--dot)" /> : null}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 grid size-11 place-items-center rounded-xl border border-border bg-secondary/60 text-muted-foreground [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

/** A disc coloured from an address, so the same account always looks the same. */
export function AccountDot({ address, className = 'size-4' }: { address: string; className?: string }) {
  let hash = 0;
  for (const char of address) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-full ring-1 ring-[rgb(23_25_31/0.1)] ${className}`}
      style={{
        background: `conic-gradient(from ${hash % 90}deg, hsl(${hue} 62% 58%), hsl(${(hue + 70) % 360} 64% 52%), hsl(${(hue + 160) % 360} 58% 60%), hsl(${hue} 62% 58%))`,
      }}
    />
  );
}

/** A small on/off switch with its label, for table filters. The thumb slides; on is the accent. */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-9 items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground aria-checked:text-foreground"
    >
      <span
        aria-hidden="true"
        className="relative h-[18px] w-[30px] shrink-0 rounded-full bg-border-strong transition-colors duration-200 group-aria-checked:bg-primary"
      >
        <span className="absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(23_25_31/0.25)] transition-transform duration-200 ease-[cubic-bezier(0.45,0,0.1,1)] group-aria-checked:translate-x-3 motion-reduce:transition-none" />
      </span>
      {children}
    </button>
  );
}
