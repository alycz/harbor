const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const PERCENT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const TIMESTAMP = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const UNAVAILABLE = 'Unavailable';

export function formatUsd(value: number | null): string {
  return value === null ? UNAVAILABLE : USD_COMPACT.format(value);
}

/** Formats a value already expressed in percentage points, e.g. 3.73 → "+3.73%". */
export function formatPercentPoints(value: number | null): string {
  return value === null ? UNAVAILABLE : PERCENT.format(value / 100);
}

const APY = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });

/** A yield in percentage points, unsigned: 11.949 → "11.95%". A dash when the source gave none. */
export function formatApy(value: number | null): string {
  return value === null ? '—' : APY.format(value / 100);
}

export function formatUtc(iso: string): string {
  return `${TIMESTAMP.format(new Date(iso))} UTC`;
}

/**
 * A token amount trimmed for reading: at most `places` decimals, cut rather than rounded so a
 * minimum is never shown as more than it is. The full amount belongs in a title or tooltip.
 */
export function formatTokenAmount(amount: string, places = 6): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  const kept = fraction.slice(0, places).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return kept ? `${grouped}.${kept}` : grouped;
}

const VENUE_NAMES: Record<string, string> = { oneclick: 'NEAR Intents' };

/** The name a person knows a venue by. */
export function venueName(id: string): string {
  return VENUE_NAMES[id] ?? id;
}
