import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Eyebrow } from './brand.tsx';
import { HarborMark } from './harbor-logo.tsx';

export function PageHeader({
  title,
  description,
  kicker,
  actions,
  meta,
}: {
  title: string;
  description: string;
  kicker?: string;
  actions?: ReactNode;
  /** A line under the description, such as when the data was captured. */
  meta?: ReactNode;
}) {
  return (
    <header className="workspace-page-header flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-3xl">
        {kicker ? <Eyebrow className="mb-4">{kicker}</Eyebrow> : null}
        <h1>{title}</h1>
        {description ? <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        {meta ? <div className="mt-3 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <HarborMark className="size-9 text-line" beacon="var(--harbor-line)" />
      <h3 className="text-lg tracking-[-0.3px]">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function DraftNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border border-line border-l-2 border-l-primary bg-secondary p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p>{children ?? 'Unsaved draft only. Nothing is submitted or executed from this form.'}</p>
    </div>
  );
}
