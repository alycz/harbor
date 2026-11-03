import { baseDecode, JsonRpcProvider, type Provider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError } from 'near-api-js/rpc-errors';

const NONCE_BYTES = 32;
const SIGNATURE_BYTES = 64;
const LOOKUP_TIMEOUT_MS = 8_000;
const ED25519_PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/** Reads one key of an account from the chain. */
export type AccessKeyReader = Pick<Provider, 'viewAccessKey'>;

export interface SignedSignIn {
  accountId: string;
  /** `ed25519:<base58>`, as wallets return it. */
  publicKey: string;
  /** The wallet's NEP-413 signature: base64, or `ed25519:<base58>` from some wallets. */
  signature: string;
  /** What the server asked the wallet to sign, never what the client says was signed. */
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

export type SignInRejection = 'MALFORMED' | 'UNKNOWN_KEY' | 'NOT_FULL_ACCESS' | 'BAD_SIGNATURE';

/** The signed message does not prove control of this account. Retrying with the same input cannot help. */
export class SignInRejected extends Error {
  override name = 'SignInRejected';
  readonly reason: SignInRejection;

  constructor(reason: SignInRejection) {
    super(`Sign-in rejected: ${reason}`);
    this.reason = reason;
  }
}

/** The chain could not be asked. This says nothing about the account, so it is never a rejection. */
export class AccessKeyLookupFailed extends Error {
  override name = 'AccessKeyLookupFailed';
}

export function createAccessKeyReader(rpcUrl: string): AccessKeyReader {
  return new JsonRpcProvider({ url: rpcUrl }, { retries: 2, backoff: 1.5, wait: 200 });
}

/**
 * Proves the signer controls `accountId`: an ed25519 NEP-413 signature over exactly this message,
 * nonce and recipient, by a key the chain says is a full-access key on that account. A function-call
 * key can be handed to an app, so it proves nothing about who owns the account. Fails closed.
 */
export async function verifySignIn(input: SignedSignIn, keys: AccessKeyReader): Promise<void> {
  const signature = decodeSignature(input.signature);
  if (!signature || input.nonce.length !== NONCE_BYTES || !ED25519_PUBLIC_KEY.test(input.publicKey)) {
    throw new SignInRejected('MALFORMED');
  }

  let permission: unknown;
  const recording: AccessKeyReader = {
    viewAccessKey: async (args) => {
      const key = await lookUp(keys, args);
      permission = key.permission;
      return key;
    },
  };
  try {
    await verifyMessage({
      signerAccountId: input.accountId,
      signerPublicKey: input.publicKey,
      payload: { message: input.message, recipient: input.recipient, nonce: input.nonce },
      signature,
      // verifyMessage only reads this one method.
      provider: recording as Provider,
    });
  } catch (error) {
    if (error instanceof SignInRejected || error instanceof AccessKeyLookupFailed) throw error;
    throw new SignInRejected(
      permission === 'FullAccess' ? 'BAD_SIGNATURE' : permission ? 'NOT_FULL_ACCESS' : 'MALFORMED',
    );
  }
}

async function lookUp(keys: AccessKeyReader, args: Parameters<AccessKeyReader['viewAccessKey']>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      keys.viewAccessKey({ ...args, finalityQuery: { finality: 'final' } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AccessKeyLookupFailed('The chain did not answer in time.')),
          LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof AccessKeyLookupFailed) throw error;
    if (error instanceof AccessKeyDoesNotExistError || error instanceof AccountDoesNotExistError) {
      throw new SignInRejected('UNKNOWN_KEY');
    }
    throw new AccessKeyLookupFailed('The chain could not be read.', { cause: error });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function decodeSignature(value: string): Uint8Array | null {
  try {
    const bytes = value.startsWith('ed25519:')
      ? baseDecode(value.slice('ed25519:'.length))
      : Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return bytes.length === SIGNATURE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}
