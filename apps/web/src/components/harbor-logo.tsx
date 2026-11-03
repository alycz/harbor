/**
 * Harbor's mark, drawn on a 12×12 pixel grid: a breakwater arch with a beacon inside it, over a
 * waterline. `#` is the mark, `b` the beacon, `~` the water (drawn at 40%). Square cells only, so
 * nothing can be clipped at any size; it reads best at multiples of 12px.
 */
const GRID = [
  '............',
  '....####....',
  '...######...',
  '..##....##..',
  '..##.bb.##..',
  '..##.bb.##..',
  '..##....##..',
  '..##....##..',
  '..##....##..',
  '............',
  '.~~..~~..~~.',
  '~..~~..~~..~',
];

const CELLS = GRID.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === '.' ? [] : [{ x, y, kind: cell as '#' | 'b' | '~' }])),
);

/** The pixel mark. It takes the text colour; the beacon defaults to NEAR's brand blue. */
export function HarborMark({
  className = 'size-9',
  beacon = 'var(--harbor-brand-blue)',
}: {
  className?: string;
  beacon?: string;
}) {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" className={className}>
      {CELLS.map(({ x, y, kind }) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="1"
          height="1"
          fill={kind === 'b' ? beacon : 'currentColor'}
          fillOpacity={kind === '~' ? 0.4 : 1}
        />
      ))}
    </svg>
  );
}

/** The mark and the wordmark together. `band` is for dark ink sections. */
export function HarborLogo({ tone = 'paper', className = '' }: { tone?: 'paper' | 'band'; className?: string }) {
  const band = tone === 'band';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <HarborMark
        className={`size-9 ${band ? 'text-[var(--harbor-band-text)]' : 'text-primary'}`}
        beacon={band ? 'var(--harbor-sky)' : 'var(--harbor-brand-blue)'}
      />
      <span
        className={`font-serif text-[22px] font-bold leading-none tracking-[-0.04em] ${band ? 'text-[var(--harbor-band-text)]' : 'text-foreground'}`}
      >
        HARBOR
      </span>
    </span>
  );
}
