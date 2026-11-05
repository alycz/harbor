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
export function PageSkeleton() {
  return (
    <Loading label="Loading" className="flex flex-col gap-7">
      <div className="max-w-2xl space-y-3">
        <SkeletonBox width={110} height={11} />
        <SkeletonBox width={260} height={30} radius={7} />
        <SkeletonBox width="88%" height={12} />
        <SkeletonBox width="62%" height={12} />
      </div>
      <div className="ws-card grid gap-6 p-6 sm:grid-cols-4">
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

/** The chat page while its code loads: the welcome, the prompts and the composer. */
export function ChatSkeleton() {
  return (
    <Loading label="Loading chat" className="chat-column flex h-full flex-col gap-6 pt-10">
      <div className="flex flex-col items-center gap-3">
        <SkeletonBox width={40} height={40} radius={10} />
        <SkeletonBox width={300} height={28} radius={7} />
        <SkeletonBox width={360} height={12} />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
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
