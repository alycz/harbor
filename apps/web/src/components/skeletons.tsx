import { Skeleton } from '@harbor/ui/components/skeleton';
import type { ReactNode } from 'react';

/**
 * Loading states shaped like the pages they stand in for, so nothing jumps when the content arrives.
 * Panel frames and their labels are drawn for real; only the content is a placeholder.
 */

/** One placeholder block. Sand on paper; it holds still for readers who asked for less motion. */
function Bone({ className = '', onBand = false }: { className?: string; onBand?: boolean }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={`rounded-none motion-reduce:animate-none ${onBand ? 'bg-band-foreground/15' : 'bg-secondary'} ${className}`}
    />
  );
}

/** Announces the loading state once, and hides the placeholders from assistive technology. */
function Loading({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

/** The frame of a ruled panel with its real label, and placeholder content. */
function PanelFrame({
  label,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`min-w-0 border border-line bg-card ${className}`}>
      <div className="flex min-h-11 items-center justify-between border-b border-line px-5 py-2.5 text-[11px] font-medium tracking-[0.6px] uppercase">
        <span>{label}</span>
        <Bone className="h-3 w-20" />
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

function HeaderSkeleton({ meta = false, action = false }: { meta?: boolean; action?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="w-full max-w-3xl">
        <Bone className="mb-4 h-3 w-40" />
        <Bone className="h-11 w-64" />
        <Bone className="mt-5 h-3.5 w-full max-w-xl" />
        <Bone className="mt-2.5 h-3.5 w-2/3 max-w-md" />
        {meta ? <Bone className="mt-4 h-5 w-80 max-w-full" /> : null}
      </div>
      {action ? <Bone className="h-14 w-44" /> : null}
    </div>
  );
}

/** Label and value placeholders on ruled rows, like FactRow. */
export function FactRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
          <Bone className="h-3 w-24" />
          <Bone className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A ruled table: the sand header row and a few body rows. */
function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="border border-line bg-card">
      <div className="flex h-10 items-center gap-6 border-b border-line bg-secondary px-3">
        {Array.from({ length: columns }, (_, index) => (
          <Bone
            key={index}
            className={`h-2.5 bg-line/60 ${index === 0 ? 'w-24' : 'w-14'} ${index > 0 ? 'ml-auto' : ''}`}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-6 border-b border-line px-3 py-3.5 last:border-b-0">
          <div className="w-40 space-y-2">
            <Bone className="h-3.5 w-28" />
            <Bone className="h-2.5 w-20" />
          </div>
          {Array.from({ length: columns - 1 }, (_, column) => (
            <Bone key={column} className="ml-auto h-3.5 w-14" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A ruled grid of cells, like the chain grid or the best-rate grid. */
function GridSkeleton({ cells, columns, tall = false }: { cells: number; columns: string; tall?: boolean }) {
  return (
    <div className={`grid ${columns}`}>
      {Array.from({ length: cells }, (_, index) => (
        <div
          key={index}
          className={`-mr-px -mb-px flex flex-col justify-between gap-4 border-r border-b border-line ${tall ? 'min-h-56 p-6' : 'min-h-24 p-4'}`}
        >
          <Bone className="h-2.5 w-16" />
          <Bone className={tall ? 'h-11 w-36' : 'h-6 w-24'} />
          {tall ? <Bone className="h-3.5 w-44" /> : null}
          <Bone className="h-2.5 w-14" />
        </div>
      ))}
    </div>
  );
}

function TabsSkeleton({ tabs = 2 }: { tabs?: number }) {
  return (
    <div className="flex h-11 items-center gap-7 border-b border-line">
      {Array.from({ length: tabs }, (_, index) => (
        <Bone key={index} className="h-3 w-24" />
      ))}
    </div>
  );
}

export function ResearchSkeleton() {
  return (
    <Loading label="Loading research" className="flex flex-col gap-8">
      <HeaderSkeleton meta />
      <PanelFrame label="Chains" bodyClassName="p-0 overflow-hidden">
        <GridSkeleton cells={12} columns="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" />
      </PanelFrame>
      <div className="flex flex-col gap-5">
        <TabsSkeleton />
        <div className="flex gap-4">
          <Bone className="h-11 w-full sm:w-64" />
          <Bone className="ml-auto h-11 w-32" />
        </div>
        <TableSkeleton rows={8} columns={7} />
      </div>
    </Loading>
  );
}

export function EarnSkeleton() {
  return (
    <Loading label="Loading stablecoin rates" className="flex flex-col gap-8">
      <HeaderSkeleton meta action />
      <PanelFrame label="Best stablecoin rate by chain" bodyClassName="p-0 overflow-hidden">
        <GridSkeleton cells={6} columns="sm:grid-cols-2 xl:grid-cols-3" tall />
      </PanelFrame>
    </Loading>
  );
}

/** The ticket's two asset boxes with an amount and a picker each. */
export function TicketSkeleton() {
  return (
    <div className="space-y-4">
      {['You pay', 'You receive'].map((label) => (
        <div key={label} className="trade-asset-box">
          <p className="trade-box-label">{label}</p>
          <div className="flex items-center gap-3">
            <Bone className="h-10 flex-1" />
            <Bone className="h-11 w-28" />
          </div>
        </div>
      ))}
      <Bone className="h-3 w-48" />
    </div>
  );
}

/** The supported-asset grid in the Route panel. */
export function AssetGridSkeleton() {
  return (
    <div className="space-y-4">
      <Bone className="h-3.5 w-full max-w-lg" />
      <div className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-r border-b border-line p-3">
            <Bone className="size-8" />
            <div className="space-y-1.5">
              <Bone className="h-3 w-14" />
              <Bone className="h-2.5 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TradeSkeleton() {
  return (
    <Loading label="Loading trade" className="flex flex-col gap-8">
      <HeaderSkeleton />
      <div className="trade-grid">
        <PanelFrame label="Route" className="trade-routes">
          <AssetGridSkeleton />
        </PanelFrame>
        <PanelFrame label="Market swap" className="trade-ticket">
          <TicketSkeleton />
        </PanelFrame>
        <PanelFrame label="Swap history" className="trade-positions">
          <TableSkeleton rows={3} columns={5} />
        </PanelFrame>
      </div>
    </Loading>
  );
}

/** Portfolio while its code loads or while a returning user's session is restored. */
export function PortfolioSkeleton({ header = true }: { header?: boolean }) {
  return (
    <Loading label="Loading your account" className="flex flex-col gap-8">
      {header ? <HeaderSkeleton /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PanelFrame label="Activity">
          <TabsSkeleton tabs={3} />
          <div className="mt-4">
            <TableSkeleton rows={3} columns={5} />
          </div>
        </PanelFrame>
        <PanelFrame label="Account">
          <FactRowsSkeleton rows={3} />
          <Bone className="mt-5 h-11 w-full" />
        </PanelFrame>
      </div>
    </Loading>
  );
}

export function PolicySkeleton() {
  return (
    <Loading label="Loading your policy" className="flex flex-col gap-8">
      <HeaderSkeleton />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <PanelFrame label="Policy draft">
          <div className="space-y-6">
            {[3, 2, 4].map((fields, section) => (
              <div
                key={section}
                className="grid gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0 sm:grid-cols-2"
              >
                <Bone className="h-3 w-24 sm:col-span-2" />
                {Array.from({ length: fields }, (_, index) => (
                  <div key={index} className="space-y-2">
                    <Bone className="h-3 w-28" />
                    <Bone className="h-11 w-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </PanelFrame>
        <div className="space-y-4 bg-band p-7">
          <Bone onBand className="h-3 w-24" />
          <Bone onBand className="h-8 w-60" />
          {Array.from({ length: 5 }, (_, index) => (
            <Bone key={index} onBand className="h-3.5 w-full" />
          ))}
        </div>
      </div>
    </Loading>
  );
}

export function ChatSkeleton() {
  return (
    <Loading label="Loading chat" className="mx-auto flex h-full w-full max-w-[800px] flex-col gap-6">
      <div className="border-b border-line pb-5">
        <Bone className="mb-3 h-3 w-16" />
        <Bone className="h-8 w-48" />
      </div>
      <div className="flex flex-col items-center gap-4 pt-6">
        <Bone className="size-9" />
        <Bone className="h-8 w-80 max-w-full" />
        <Bone className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="grid sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="-mr-px -mb-px flex min-h-16 items-center gap-3 border border-line bg-card p-4">
            <Bone className="size-4" />
            <Bone className="h-3.5 w-40" />
          </div>
        ))}
      </div>
      <div className="mt-auto border border-line bg-card">
        <Bone className="m-5 h-4 w-48" />
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <Bone className="h-3 w-48" />
          <Bone className="h-11 w-24" />
        </div>
      </div>
    </Loading>
  );
}

export function PlanSkeleton({ header = true }: { header?: boolean }) {
  return (
    <Loading label="Loading plan" className="flex flex-col gap-8">
      {header ? <HeaderSkeleton action /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PanelFrame label="Plan">
          <FactRowsSkeleton rows={4} />
        </PanelFrame>
        <PanelFrame label="Plan identity">
          <FactRowsSkeleton rows={4} />
        </PanelFrame>
      </div>
    </Loading>
  );
}

/** Any other workspace page: a header and a panel. */
export function PageSkeleton() {
  return (
    <Loading label="Loading" className="flex flex-col gap-8">
      <HeaderSkeleton />
      <PanelFrame label="Loading">
        <FactRowsSkeleton rows={4} />
      </PanelFrame>
    </Loading>
  );
}

/** The landing page's black hero, so loading never flashes a light screen first. */
export function LandingSkeleton() {
  return (
    <Loading label="Loading Harbor" className="block min-h-svh bg-black">
      <div className="flex items-center justify-between px-[clamp(20px,3.5vw,56px)] py-6">
        <Bone onBand className="h-9 w-36" />
        <Bone onBand className="h-11 w-36" />
      </div>
      <div className="max-w-[40rem] px-[clamp(20px,3.5vw,56px)] pt-[18vh]">
        <Bone onBand className="mb-6 h-3 w-64" />
        <Bone onBand className="h-16 w-full" />
        <Bone onBand className="mt-3 h-16 w-4/5" />
        <Bone onBand className="mt-3 h-16 w-3/5" />
        <Bone onBand className="mt-8 h-3.5 w-96 max-w-full" />
        <Bone onBand className="mt-2.5 h-3.5 w-80 max-w-full" />
      </div>
    </Loading>
  );
}

/** Swap history while the session or the activity loads. */
export function ActivitySkeleton() {
  return (
    <Loading label="Loading activity" className="flex flex-col gap-4">
      <TabsSkeleton tabs={3} />
      <TableSkeleton rows={3} columns={5} />
    </Loading>
  );
}

/** A quote on its way: the fact rows it will fill, in a ruled box. */
export function QuoteSkeleton({ label = 'Getting a live quote' }: { label?: string }) {
  return (
    <Loading label={label} className="block border border-line bg-background">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <Bone className="h-3.5 w-32" />
        <Bone className="h-3 w-28" />
      </div>
      <div className="px-4 py-2">
        <FactRowsSkeleton rows={4} />
      </div>
    </Loading>
  );
}

/** A small placeholder for the header's status tag and wallet button. */
export function HeaderControlSkeleton({ className }: { className: string }) {
  return (
    <Loading label="Loading">
      <Bone className={className} />
    </Loading>
  );
}
