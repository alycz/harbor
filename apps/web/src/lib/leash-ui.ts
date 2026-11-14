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
