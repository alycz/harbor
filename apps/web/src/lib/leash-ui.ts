/** Reject rounded, signed, scientific and overflowing token amounts before wallet preparation. */
export function requireLeashAmount(value: string, positive = false): string {
  if (!/^(0|[1-9][0-9]{0,38})$/.test(value) || BigInt(value) >= 2n ** 128n || (positive && value === '0')) {
    throw new Error('Enter a canonical whole-number amount in atomic units.');
  }
  return value;
}

/** A prior send attempt, including an unknown outcome, only permits read-only recovery. */
export function canSubmitLeash(available: boolean, busy: boolean, attempted: boolean, state: string | undefined) {
  return available && !busy && !attempted && state === 'approved-not-submitted';
}

/**
 * A decimal token amount as the contract's atomic units, exactly: "1.5" with 6 decimals is "1500000".
 * Throws on more decimals than the token has, signs, exponents or an empty value.
 */
export function toAtomic(value: string, decimals: number): string {
  const text = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (!match) throw new Error('Enter an amount such as 25 or 25.5.');
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) throw new Error(`This token has ${decimals} decimals at most.`);
  const raw = BigInt((match[1] ?? '0') + fraction.padEnd(decimals, '0'));
  if (raw >= 2n ** 128n) throw new Error('That amount is too large.');
  return raw.toString();
}

/** Atomic units as a readable decimal, trimmed: "1500000" with 6 decimals is "1.5". */
export function fromAtomic(raw: string, decimals: number): string {
  if (!/^[0-9]+$/.test(raw)) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

/** How long a vault's allowance lasts, offered as three plain choices. */
export const ALLOWANCE_DAYS = [1, 7, 30] as const;

export function expiryAfterDays(days: number, nowMs: number): number {
  return nowMs + days * 86_400_000;
}

/** A list read the way a person says it: "NEAR", "NEAR and USDT", "NEAR, USDT and ETH". */
export function spokenList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The vault's rules as one sentence, so an owner reads what they grant rather than a form:
 * "Harbor's agent may spend up to 2 USDC a day, only to buy NEAR for your own account, until Fri 21 Nov."
 */
export function allowanceSentence(input: {
  daily: string;
  perTrade: string;
  symbol: string;
  buys: readonly string[];
  toOwnAccount: boolean;
  recipients: number;
  endsAt: Date;
}): string {
  const budget = `${input.daily || '…'} ${input.symbol}`.trim();
  const cap = input.perTrade && input.perTrade !== input.daily ? `, at most ${input.perTrade} per trade` : '';
  const buys = input.buys.length ? spokenList(input.buys) : 'nothing yet';
  const to = input.toOwnAccount ? 'your own account' : `your ${input.recipients} chosen addresses`;
  const until = input.endsAt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `Harbor's agent may spend up to ${budget} a day${cap}, only to buy ${buys} for ${to}, until ${until}.`;
}
