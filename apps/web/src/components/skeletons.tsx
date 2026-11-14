import { Skeleton } from '@harbor/ui/components/skeleton';
import type { ReactNode } from 'react';
import { SkeletonBox } from 'skullet/react';

/*
 * Loading states. Data that arrives into a known layout (activity, a plan, the ticket, the account)
 * is wrapped in Skullet's <Skeleton> where it renders, with a sample from lib/samples.ts, so the
 * skeleton is measured from the real content and nothing moves when it lands. What is left here is
 * the frame a page shows while its code loads, drawn with Skullet's boxes in the workspace's shapes.
 */

/** Announces the loading state once, and hides the placeholders from assistive technology. */
function Loading({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

/** Label and value placeholders on lines, like FactRow. */
export function FactRowsSkeleton({ rows = 4 }: { rows?: number }) {
  const widths = ['42%', '30%', '36%', '26%', '40%', '33%', '28%', '38%'];
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0"
        >
          <SkeletonBox width={`${22 + (index % 3) * 4}%`} height={11} />
          <SkeletonBox width={widths[index % widths.length] ?? '30%'} height={12} />
        </div>
      ))}
    </div>
  );
}

/** A quote on its way: the card it will fill. */
export function QuoteSkeleton({ label = 'Getting a live quote' }: { label?: string }) {
  return (
    <Loading label={label} className="block overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <SkeletonBox width={150} height={14} />
        <SkeletonBox width={70} height={14} />
      </div>
      <div className="px-4 py-1.5">
        <FactRowsSkeleton rows={4} />
      </div>
    </Loading>
  );
}

/** Any workspace page while its code loads: a title block, a wide card and a list. */
function PageSkeleton() {
  return (
    <Loading label="Loading" className="flex flex-col gap-7">
      <div className="max-w-2xl space-y-3">
        <SkeletonBox width={110} height={11} />
        <SkeletonBox width={260} height={30} radius={7} />
        <SkeletonBox width="88%" height={12} />
        <SkeletonBox width="62%" height={12} />
      </div>
      <div className="ws-card grid gap-6 p-6 @xl/workspace:grid-cols-4">
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className="space-y-2.5">
            <SkeletonBox width="45%" height={11} />
            <SkeletonBox width="70%" height={22} radius={6} />
          </div>
        ))}
      </div>
      <div className="ws-card">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4 border-b border-border/70 px-5 py-4 last:border-b-0">
            <SkeletonBox width={32} height={32} radius="50%" />
            <div className="flex-1 space-y-2">
              <SkeletonBox width={`${30 + (row % 3) * 8}%`} height={12} />
              <SkeletonBox width={`${18 + (row % 2) * 6}%`} height={10} />
            </div>
            <SkeletonBox width={64} height={12} />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A card of label and value cells on a line, like the Stat rows under a pair or plan title. */
function StatStripSkeleton({ cells }: { cells: number }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border px-5 py-4 @xl/workspace:px-6 @3xl/workspace:grid-cols-5">
      {Array.from({ length: cells }, (_, cell) => (
        <div key={cell} className="space-y-2">
          <SkeletonBox width="50%" height={10} />
          <SkeletonBox width="72%" height={16} radius={5} />
        </div>
      ))}
    </div>
  );
}

/** The dark hero card with its title, a call to action and three figures on the right. */
function HeroSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="ws-hero">
      <div className="flex flex-col gap-7 px-5 py-6 @xl/workspace:px-8 @xl/workspace:py-8 @4xl/workspace:flex-row @4xl/workspace:items-end @4xl/workspace:justify-between @4xl/workspace:gap-12">
        <div className="min-w-0 max-w-2xl space-y-3 @4xl/workspace:flex-1">
          <Bone className="h-9 w-full max-w-[28rem] rounded-md" />
          <Bone className="h-9 w-3/5 rounded-md" />
          {action ? <Bone className="mt-5 h-10 w-64 rounded-md" /> : null}
        </div>
        <div className="flex shrink-0 gap-7">
          {[0, 1, 2].map((cell) => (
            <div key={cell} className="space-y-2.5">
              <Bone className="h-6 w-16 rounded-md" />
              <Bone className="h-3 w-14 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A section heading with a control or two on the right. */
function SectionTitleSkeleton({ controls = 0 }: { controls?: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <SkeletonBox width={150} height={18} radius={6} />
      <div className="flex gap-2.5">
        {Array.from({ length: controls }, (_, control) => (
          <SkeletonBox key={control} width={control === 0 ? 120 : 170} height={34} radius={8} />
        ))}
      </div>
    </div>
  );
}

/** Table rows: a name with a logo, then a few figures. */
function TableSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="ws-card">
      <div className="flex gap-6 border-b border-border px-5 py-3">
        {[90, 60, 70, 60].map((width, column) => (
          <SkeletonBox key={column} width={width} height={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-border/70 px-5 py-3.5 last:border-b-0">
          <SkeletonBox width={24} height={24} radius="50%" />
          <SkeletonBox width={`${22 + (row % 3) * 6}%`} height={12} />
          <div className="ml-auto flex gap-8">
            <SkeletonBox width={52} height={12} />
            <SkeletonBox width={64} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Research: the hero, a title with the chain filter and view switch, and the table. */
export function ResearchSkeleton() {
  return (
    <Loading label="Loading research" className="flex flex-col gap-8">
      <HeroSkeleton />
      <div className="flex flex-col gap-3.5">
        <SectionTitleSkeleton controls={2} />
        <TableSkeleton rows={8} />
      </div>
    </Loading>
  );
}

/** Earn: the hero with its action, the vaults, a grid of chain rate cards and the pools table. */
export function EarnSkeleton() {
  return (
    <Loading label="Loading earn" className="flex flex-col gap-8">
      <HeroSkeleton action />
      <div className="flex flex-col gap-3.5">
        <SectionTitleSkeleton />
        <div className="grid gap-3 @xl/workspace:grid-cols-2">
          {[0, 1].map((card) => (
            <div key={card} className="ws-card space-y-4 p-5">
              <SkeletonBox width="50%" height={13} />
              <SkeletonBox width="40%" height={38} radius={7} />
              <SkeletonBox width="72%" height={13} />
              <div className="grid grid-cols-3 gap-3 border-t border-border pt-3.5">
                {[0, 1, 2].map((figure) => (
                  <SkeletonBox key={figure} width="80%" height={22} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <SectionTitleSkeleton />
        <div className="grid gap-3 @xl/workspace:grid-cols-2 @5xl/workspace:grid-cols-3">
          {[0, 1, 2].map((card) => (
            <div key={card} className="ws-card space-y-4 p-5">
              <SkeletonBox width="40%" height={13} />
              <SkeletonBox width="46%" height={38} radius={7} />
              <SkeletonBox width="68%" height={13} />
              <div className="grid grid-cols-3 gap-3 border-t border-border pt-3.5">
                {[0, 1, 2].map((figure) => (
                  <SkeletonBox key={figure} width="80%" height={22} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <SectionTitleSkeleton />
        <TableSkeleton rows={6} />
      </div>
    </Loading>
  );
}

/** Trade: the pair card with its terms beside the sticky swap ticket. */
export function TradeSkeleton() {
  return (
    <Loading label="Loading trade" className="trade-layout">
      <div className="ws-card min-w-0">
        <div className="flex items-start justify-between gap-4 px-5 pt-5 @xl/workspace:px-6 @xl/workspace:pt-6">
          <div className="flex items-center gap-3.5">
            <div className="flex -space-x-2.5">
              <SkeletonBox width={40} height={40} radius="50%" />
              <SkeletonBox width={40} height={40} radius="50%" />
            </div>
            <SkeletonBox width={200} height={28} radius={7} />
          </div>
          <SkeletonBox width={92} height={24} radius={12} />
        </div>
        <StatStripSkeleton cells={5} />
      </div>
      <div className="trade-ticket ws-card min-w-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <SkeletonBox width={64} height={14} />
          <SkeletonBox width={64} height={20} radius={10} />
        </div>
        <div className="space-y-3 p-5">
          <SkeletonBox width="100%" height={84} radius={10} />
          <SkeletonBox width="100%" height={84} radius={10} />
          <SkeletonBox width="100%" height={44} radius={8} />
        </div>
      </div>
    </Loading>
  );
}

/** Portfolio: the dark hero with its showcase, then three feature cards. */
export function PortfolioSkeleton() {
  return (
    <Loading label="Loading portfolio" className="flex flex-col gap-5">
      <div className="ws-hero grid min-h-[420px] @3xl/workspace:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col justify-center gap-3 px-6 py-10 @xl/workspace:px-10">
          <Bone className="h-10 w-4/5 rounded-md" />
          <Bone className="h-10 w-3/5 rounded-md" />
          <div className="mt-5 flex gap-3">
            <Bone className="h-11 w-40 rounded-md" />
            <Bone className="h-11 w-36 rounded-md" />
          </div>
        </div>
        <div className="hidden items-center py-10 pr-10 pl-4 @3xl/workspace:flex">
          <Bone className="h-64 w-full rounded-xl" />
        </div>
      </div>
      <div className="grid gap-3 @xl/workspace:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className="ws-card flex gap-3.5 p-4">
            <SkeletonBox width={36} height={36} radius={8} />
            <div className="flex-1 space-y-2">
              <SkeletonBox width="55%" height={13} />
              <SkeletonBox width="90%" height={11} />
              <SkeletonBox width="70%" height={11} />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** One plan: the swap title with its terms and lifecycle, beside the identity card. */
export function PlanSkeleton() {
  return (
    <Loading label="Loading plan" className="grid items-start gap-5 @3xl/workspace:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="ws-card">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 @xl/workspace:px-6">
            <div className="flex items-center gap-3.5">
              <div className="flex -space-x-2.5">
                <SkeletonBox width={36} height={36} radius="50%" />
                <SkeletonBox width={36} height={36} radius="50%" />
              </div>
              <SkeletonBox width={220} height={24} radius={7} />
            </div>
            <SkeletonBox width={80} height={24} radius={12} />
          </div>
          <StatStripSkeleton cells={4} />
        </div>
        <div className="ws-card space-y-4 p-5">
          <SkeletonBox width={90} height={13} />
          {[0, 1, 2].map((step) => (
            <div key={step} className="flex items-center gap-3">
              <SkeletonBox width={20} height={20} radius="50%" />
              <SkeletonBox width={`${40 + step * 10}%`} height={12} />
            </div>
          ))}
        </div>
      </div>
      <div className="ws-card px-5 py-4">
        <SkeletonBox width={100} height={13} />
        <FactRowsSkeleton rows={5} />
      </div>
    </Loading>
  );
}

/** Policy: the page title, the cards to set limits on, and the dark rules card beside them. */
export function PolicySkeleton() {
  return (
    <Loading label="Loading policy" className="flex flex-col gap-7">
      <SkeletonBox width={200} height={34} radius={7} />
      <div className="grid items-start gap-5 @3xl/workspace:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="ws-card space-y-5 p-6">
          <SkeletonBox width={140} height={14} />
          {[0, 1, 2, 3].map((field) => (
            <div key={field} className="space-y-2">
              <SkeletonBox width={120} height={11} />
              <SkeletonBox width="100%" height={40} radius={8} />
            </div>
          ))}
          <SkeletonBox width={150} height={40} radius={8} />
        </div>
        <div className="ws-hero space-y-3 p-6 @xl/workspace:p-7">
          <Bone className="h-8 w-4/5 rounded-md" />
          {[0, 1, 2, 3].map((rule) => (
            <Bone key={rule} className="h-4 w-full rounded-md" />
          ))}
        </div>
      </div>
    </Loading>
  );
}

/** The chat page while its code loads: the welcome, the prompts and the composer. */
export function ChatSkeleton() {
  return (
    <Loading label="Loading chat" className="chat-column flex h-full flex-col gap-6 pt-10">
      <div className="flex flex-col items-center gap-3">
        <SkeletonBox width={40} height={40} radius={10} />
        <SkeletonBox width={300} height={28} radius={7} />
        <SkeletonBox width={360} height={12} />
      </div>
      <div className="grid gap-2.5 @xl/workspace:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="ws-card flex items-center gap-3 p-4">
            <SkeletonBox width={28} height={28} radius={8} />
            <SkeletonBox width="60%" height={12} />
          </div>
        ))}
      </div>
      <div className="ws-card mt-auto">
        <div className="p-4">
          <SkeletonBox width={200} height={14} />
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <SkeletonBox width={180} height={11} />
          <SkeletonBox width={76} height={34} radius={6} />
        </div>
      </div>
    </Loading>
  );
}

/** One landing placeholder block, on the ink band. The landing keeps its own look. */
function Bone({ className = '' }: { className?: string }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={`rounded-none bg-band-foreground/15 motion-reduce:animate-none ${className}`}
    />
  );
}

/** The landing page's black hero, so loading never flashes a light screen first. */
export function LandingSkeleton() {
  return (
    <Loading label="Loading Harbor" className="block min-h-svh bg-black">
      <div className="flex items-center justify-between px-[clamp(20px,3.5vw,56px)] py-6">
        <Bone className="h-9 w-36" />
        <Bone className="h-11 w-36" />
      </div>
      <div className="max-w-[40rem] px-[clamp(20px,3.5vw,56px)] pt-[18vh]">
        <Bone className="mb-6 h-3 w-64" />
        <Bone className="h-16 w-full" />
        <Bone className="mt-3 h-16 w-4/5" />
        <Bone className="mt-3 h-16 w-3/5" />
        <Bone className="mt-8 h-3.5 w-96 max-w-full" />
        <Bone className="mt-2.5 h-3.5 w-80 max-w-full" />
      </div>
    </Loading>
  );
}

/** The skeleton for a workspace path, for the Suspense that waits on a page's code. */
export function SkeletonForPath({ pathname }: { pathname: string }) {
  if (pathname === '/research') return <ResearchSkeleton />;
  if (pathname === '/earn') return <EarnSkeleton />;
  if (pathname === '/trade') return <TradeSkeleton />;
  if (pathname === '/portfolio') return <PortfolioSkeleton />;
  if (pathname.startsWith('/plans/')) return <PlanSkeleton />;
  if (pathname === '/settings/policy') return <PolicySkeleton />;
  if (pathname === '/chat') return <ChatSkeleton />;
  return <PageSkeleton />;
}
