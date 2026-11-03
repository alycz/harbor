/**
 * 1Click quote signatures, verified without the provider SDK. 1Click signs the base58 SHA-256 of a
 * key-sorted JSON object built from fixed quote request and quote fields plus the response
 * timestamp, using its manager ed25519 key. Field selection follows the provider's published
 * algorithm exactly: a missing or falsy optional field is left out, not serialized.
 */

/** The 1Click manager key that signs every quote. */
export const ONE_CLICK_MANAGER_PUBLIC_KEY = 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';

const ED25519_PREFIX = 'ed25519:';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type JsonRecord = Record<string, unknown>;

export class QuoteSignatureError extends Error {
  override name = 'QuoteSignatureError';
}

/** The provider's canonical hash of a quote response, as base58. Throws on a malformed response. */
export async function oneClickQuoteHash(response: unknown): Promise<string> {
  const record = asRecord(response, 'response');
  const request = asRecord(record.quoteRequest, 'quoteRequest');
  const quote = asRecord(record.quote, 'quote');
  const payload = {
    ...signedRequest(request),
    ...signedQuote(quote, request.dry === true),
    timestamp: record.timestamp,
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(payload)));
  return base58Encode(new Uint8Array(digest));
}

/** Whether 1Click's manager key signed exactly this quote. Never throws: anything malformed is false. */
export async function verifyOneClickQuoteSignature(
  response: unknown,
  publicKey: string = ONE_CLICK_MANAGER_PUBLIC_KEY,
): Promise<boolean> {
  try {
    const signature = asRecord(response, 'response').signature;
    if (typeof signature !== 'string') return false;
    const key = await crypto.subtle.importKey('raw', decodeEd25519(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const message = new TextEncoder().encode(await oneClickQuoteHash(response));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, decodeEd25519(signature), message);
  } catch {
    return false;
  }
}

function signedRequest(request: JsonRecord): JsonRecord {
  return {
    dry: request.dry,
    swapType: request.swapType,
    slippageTolerance: request.slippageTolerance,
    originAsset: request.originAsset,
    depositType: request.depositType,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    refundTo: request.refundTo,
    refundType: request.refundType,
    recipient: request.recipient,
    recipientType: request.recipientType,
    deadline: request.deadline,
    quoteWaitingTimeMs: request.quoteWaitingTimeMs || undefined,
    referral: request.referral || undefined,
    virtualChainRecipient: request.virtualChainRecipient || undefined,
    virtualChainRefundRecipient: request.virtualChainRefundRecipient || undefined,
    customRecipientMsg: request.customRecipientMsg || undefined,
  };
}

function signedQuote(quote: JsonRecord, dry: boolean): JsonRecord {
  const amounts = {
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountInUsd: quote.amountInUsd,
    minAmountIn: quote.minAmountIn,
    amountOut: quote.amountOut,
    amountOutFormatted: quote.amountOutFormatted,
    amountOutUsd: quote.amountOutUsd,
    minAmountOut: quote.minAmountOut,
  };
  if (dry) return amounts;
  return {
    ...amounts,
    depositAddress: quote.depositAddress || undefined,
    depositMemo: quote.depositMemo || undefined,
    deadline: quote.deadline || undefined,
    timeWhenInactive: quote.timeWhenInactive || undefined,
    timeEstimate: quote.timeEstimate || undefined,
    refundFee: quote.refundFee || undefined,
    withdrawFee: quote.withdrawFee || undefined,
  };
}

/** Key-sorted JSON that skips undefined object values, matching json-stable-stringify. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new QuoteSignatureError('Quote fields must be finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as JsonRecord;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new QuoteSignatureError('Quote fields must be JSON values.');
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuoteSignatureError(`The ${label} is not an object.`);
  }
  return value as JsonRecord;
}

function decodeEd25519(value: string): Uint8Array<ArrayBuffer> {
  return base58Decode(value.startsWith(ED25519_PREFIX) ? value.slice(ED25519_PREFIX.length) : value);
}

export function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    encoded = BASE58_ALPHABET.charAt(Number(number % 58n)) + encoded;
    number /= 58n;
  }
  return '1'.repeat(leadingZeros) + encoded;
}

export function base58Decode(text: string): Uint8Array<ArrayBuffer> {
  if (text.length === 0 || text.length > 128) throw new QuoteSignatureError('Base58 text has an invalid length.');
  let number = 0n;
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new QuoteSignatureError('Base58 text has an invalid character.');
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  }
  let leadingZeros = 0;
  while (text[leadingZeros] === '1') leadingZeros += 1;
  return new Uint8Array([...new Array<number>(leadingZeros).fill(0), ...bytes]);
}
