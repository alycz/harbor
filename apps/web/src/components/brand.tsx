import type { ReactNode } from 'react';

/*
 * The NEAR hackathon look, used by the landing page only. Workspace pages build on the primitives in
 * workspace.tsx, which follow Pilot and Royco instead.
 */

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
