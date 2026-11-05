/*
 * The landing hero's texture. Pages build on the primitives in workspace.tsx.
 */

/** A faint scanline texture for ink bands. */
export function Scanlines() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_4px,var(--harbor-band-text)_4px_5px)] opacity-[0.06]"
    />
  );
}
