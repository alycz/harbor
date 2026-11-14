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
